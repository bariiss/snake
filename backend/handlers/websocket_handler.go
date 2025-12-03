package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"

	"snake-backend/auth"
	"snake-backend/game"
	"snake-backend/models"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 512
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins in development
	},
}

type WebSocketHandler struct {
	gameManager *game.Manager
}

func NewWebSocketHandler(gameManager *game.Manager) *WebSocketHandler {
	return &WebSocketHandler{
		gameManager: gameManager,
	}
}

// sendErrorAndClose sends an error message and closes the connection
func (h *WebSocketHandler) sendErrorAndClose(w http.ResponseWriter, r *http.Request, code, message string) {
	conn, _ := upgrader.Upgrade(w, r, nil)
	if conn == nil {
		return
	}
	errorMsg := map[string]any{
		"type":    "error",
		"code":    code,
		"message": message,
	}
	jsonError, _ := json.Marshal(errorMsg)
	conn.WriteMessage(websocket.TextMessage, jsonError)
	conn.Close()
}

// handleTokenConnection handles token-based connection
func (h *WebSocketHandler) handleTokenConnection(tokenString string, w http.ResponseWriter, r *http.Request) (*models.Player, string) {
	// Validate token
	claims, err := auth.ValidateToken(tokenString)
	if err != nil {
		log.Printf("Token validation error: %v", err)
		h.sendErrorAndClose(w, r, "INVALID_TOKEN", "Invalid token")
		return nil, ""
	}

	// Find player by ID from token
	player := h.gameManager.FindPlayerByID(claims.PlayerID)
	if player == nil {
		// Player not found - create new player from token claims
		// This can happen if server restarted or player was removed
		log.Printf("Player not found for token, creating new player: %s (username: %s)", claims.PlayerID, claims.Username)
		player = &models.Player{
			ID:       claims.PlayerID,
			Username: claims.Username,
			Send:     make(chan []byte, 256),
			JoinedAt: time.Now(),
		}

		// Register player in global registry
		h.gameManager.Mutex.Lock()
		h.gameManager.Players[player.ID] = player
		h.gameManager.Mutex.Unlock()
	}

	// If player already has an active connection, close it but DON'T remove player
	// This allows the new connection to use the same player object
	if player.Send == nil {
		// No existing connection, create new channel
		player.Send = make(chan []byte, 256)
		return player, tokenString
	}

	// Player already has an active connection, close it
	log.Printf("Player %s already has active connection, closing old connection", player.ID)
	// Close old channel to signal old connection to stop
	// Use recover to handle case where channel is already closed
	func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("Channel already closed for player %s (ignored): %v", player.ID, r)
			}
		}()
		close(player.Send)
	}()
	// Don't call RemovePlayer here - we want to keep the player for the new connection
	// Just wait a bit for the old connection to clean up
	time.Sleep(100 * time.Millisecond)
	// Recreate Send channel for new connection
	player.Send = make(chan []byte, 256)

	return player, tokenString
}

// handleUsernameConnection handles username-based connection (for initial login)
func (h *WebSocketHandler) handleUsernameConnection(r *http.Request, w http.ResponseWriter) (*models.Player, string) {
	username := r.URL.Query().Get("username")
	if username == "" {
		username = r.Header.Get("X-Username")
	}

	if username == "" {
		log.Printf("No username or token provided, closing connection")
		conn, _ := upgrader.Upgrade(w, r, nil)
		if conn == nil {
			return nil, ""
		}
		conn.Close()
		return nil, ""
	}

	username = strings.TrimSpace(username)

	// Check if username already exists and disconnect old connection if same username
	existingPlayer := h.gameManager.FindPlayerByUsername(username)
	if existingPlayer == nil {
		// No existing player, continue
	} else if existingPlayer.Send != nil {
		// Same username is already connected - close old connection
		log.Printf("Username %s already connected, closing old connection (old ID: %s)", username, existingPlayer.ID)
		// Use recover to handle case where channel is already closed
		func() {
			defer func() {
				if r := recover(); r != nil {
					log.Printf("Channel already closed for player %s (ignored): %v", existingPlayer.ID, r)
				}
			}()
			close(existingPlayer.Send)
		}()
		existingPlayer.Send = nil
		h.gameManager.RemovePlayer(existingPlayer.ID)
		time.Sleep(50 * time.Millisecond)
	}

	// Check again if username exists (after cleanup)
	if h.gameManager.UsernameExists(username) {
		log.Printf("Username %s still in use after cleanup, closing connection", username)
		h.sendErrorAndClose(w, r, "USERNAME_EXISTS", "Username already in use. Please choose another name.")
		return nil, ""
	}

	// Create new player
	player := &models.Player{
		ID:       uuid.New().String(),
		Username: username,
		Send:     make(chan []byte, 256),
		JoinedAt: time.Now(),
	}

	// Register player in global registry
	h.gameManager.Mutex.Lock()
	h.gameManager.Players[player.ID] = player
	h.gameManager.Mutex.Unlock()

	// Generate token for new player
	token, err := auth.GenerateToken(player.ID, player.Username)
	if err != nil {
		log.Printf("Error generating token: %v", err)
		conn, _ := upgrader.Upgrade(w, r, nil)
		if conn == nil {
			return nil, ""
		}
		conn.Close()
		return nil, ""
	}

	return player, token
}

// extractTokenFromRequest extracts token from query parameter or Authorization header
func (h *WebSocketHandler) extractTokenFromRequest(r *http.Request, w http.ResponseWriter) string {
	tokenString := r.URL.Query().Get("token")
	if tokenString != "" {
		return tokenString
	}

	authHeader := r.Header.Get("Authorization")
	if authHeader == "" {
		return ""
	}

	var err error
	tokenString, err = auth.ExtractTokenFromHeader(authHeader)
	if err != nil {
		log.Printf("Invalid authorization header: %v", err)
		h.sendErrorAndClose(w, r, "INVALID_TOKEN", "Invalid or missing token")
		return ""
	}

	return tokenString
}

func (h *WebSocketHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Try to get token from query parameter or Authorization header
	tokenString := h.extractTokenFromRequest(r, w)
	// If extractTokenFromRequest returns "" and there was an Authorization header,
	// it already sent an error and closed the connection, so we can return
	if tokenString == "" && r.Header.Get("Authorization") != "" {
		return
	}

	// If no token, fall back to username-based connection (for initial login)
	var player *models.Player
	var token string

	if tokenString != "" {
		player, token = h.handleTokenConnection(tokenString, w, r)
		if player == nil {
			return
		}
	}
	if tokenString == "" {
		// Legacy: username-based connection (for initial login)
		player, token = h.handleUsernameConnection(r, w)
		if player == nil {
			return
		}
	}

	// Upgrade connection after all checks
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}

	// Don't add player to lobby automatically - wait for join_lobby message
	// This allows frontend to show mode selection first

	// Send connected message with token directly via WebSocket (before writePump starts)
	// This ensures the message is sent immediately after connection is established
	connectedMsg := map[string]any{
		"type": "connected",
		"player": map[string]any{
			"id":       player.ID,
			"username": player.Username,
		},
		"token": token,
	}
	jsonData, _ := json.Marshal(connectedMsg)

	// Send directly via WebSocket connection to ensure it's sent immediately
	conn.SetWriteDeadline(time.Now().Add(writeWait))
	if err := conn.WriteMessage(websocket.TextMessage, jsonData); err != nil {
		log.Printf("Failed to send connected message to player %s: %v", player.Username, err)
		conn.Close()
		return
	}

	// Check if player is in an active game and restore game state
	h.gameManager.RestorePlayerGameState(player)

	// Start goroutines for reading and writing
	go h.writePump(player, conn)
	h.readPump(player, conn)
}

func (h *WebSocketHandler) readPump(player *models.Player, conn *websocket.Conn) {
	defer func() {
		// Only remove player if Send channel is nil (no new connection established)
		// If Send channel is still active, a new connection is being established
		// and we should not remove the player
		if player.Send == nil {
			h.gameManager.RemovePlayer(player.ID)
		} else {
			log.Printf("Player %s (%s) has new connection, not removing from manager", player.ID, player.Username)
		}
		conn.Close()
	}()

	conn.SetReadDeadline(time.Now().Add(pongWait))
	conn.SetReadLimit(maxMessageSize)
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket error for %s: %v", player.Username, err)
			}
			break
		}

		var msgData map[string]any
		if err := json.Unmarshal(message, &msgData); err != nil {
			log.Printf("Error unmarshaling message from %s: %v", player.Username, err)
			continue
		}

		msgType, ok := msgData["type"].(string)
		if !ok {
			log.Printf("Message from %s missing type field", player.Username)
			continue
		}

		// Handle message through game manager
		h.gameManager.HandleWebSocketMessage(player, msgType, msgData)
	}
}

func (h *WebSocketHandler) writePump(player *models.Player, conn *websocket.Conn) {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		conn.Close()
	}()

	for {
		select {
		case message, ok := <-player.Send:
			conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)

			// Add queued messages
			n := len(player.Send)
			for range n {
				w.Write([]byte{'\n'})
				w.Write(<-player.Send)
			}

			if err := w.Close(); err != nil {
				return
			}
		case <-ticker.C:
			conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
