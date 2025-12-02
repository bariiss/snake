package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/websocket"

	"snake-backend/auth"
	"snake-backend/game"
	"snake-backend/models"

	"github.com/google/uuid"
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

func (h *WebSocketHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Try to get token from query parameter or Authorization header
	tokenString := r.URL.Query().Get("token")
	if tokenString == "" {
		authHeader := r.Header.Get("Authorization")
		if authHeader != "" {
			var err error
			tokenString, err = auth.ExtractTokenFromHeader(authHeader)
			if err != nil {
				log.Printf("Invalid authorization header: %v", err)
				conn, _ := upgrader.Upgrade(w, r, nil)
				if conn != nil {
					errorMsg := map[string]interface{}{
						"type":    "error",
						"code":    "INVALID_TOKEN",
						"message": "Invalid or missing token",
					}
					jsonError, _ := json.Marshal(errorMsg)
					conn.WriteMessage(websocket.TextMessage, jsonError)
					conn.Close()
				}
				return
			}
		}
	}

	// If no token, fall back to username-based connection (for initial login)
	var player *models.Player
	var username string
	var token string

	if tokenString != "" {
		// Validate token
		claims, err := auth.ValidateToken(tokenString)
		if err != nil {
			log.Printf("Token validation error: %v", err)
			conn, _ := upgrader.Upgrade(w, r, nil)
			if conn != nil {
				errorMsg := map[string]interface{}{
					"type":    "error",
					"code":    "INVALID_TOKEN",
					"message": "Invalid token",
				}
				jsonError, _ := json.Marshal(errorMsg)
				conn.WriteMessage(websocket.TextMessage, jsonError)
				conn.Close()
			}
			return
		}

		// Find player by ID from token
		player = h.gameManager.FindPlayerByID(claims.PlayerID)
		if player == nil {
			log.Printf("Player not found for token: %s", claims.PlayerID)
			conn, _ := upgrader.Upgrade(w, r, nil)
			if conn != nil {
				errorMsg := map[string]interface{}{
					"type":    "error",
					"code":    "PLAYER_NOT_FOUND",
					"message": "Player not found",
				}
				jsonError, _ := json.Marshal(errorMsg)
				conn.WriteMessage(websocket.TextMessage, jsonError)
				conn.Close()
			}
			return
		}

		token = tokenString

		// If player already has an active connection, close it
		if player.Send != nil {
			log.Printf("Player %s already has active connection, closing old connection", player.ID)
			close(player.Send)
			player.Send = nil
			h.gameManager.RemovePlayer(player.ID)
			time.Sleep(50 * time.Millisecond)
		}

		// Recreate Send channel for new connection
		player.Send = make(chan []byte, 256)
	} else {
		// Legacy: username-based connection (for initial login)
		username = r.URL.Query().Get("username")
		if username == "" {
			username = r.Header.Get("X-Username")
		}

		if username == "" {
			log.Printf("No username or token provided, closing connection")
			conn, _ := upgrader.Upgrade(w, r, nil)
			if conn != nil {
				conn.Close()
			}
			return
		}

		username = strings.TrimSpace(username)

		// Check if username already exists and disconnect old connection if same username
		existingPlayer := h.gameManager.FindPlayerByUsername(username)
		if existingPlayer != nil && existingPlayer.Send != nil {
			// Same username is already connected - close old connection
			log.Printf("Username %s already connected, closing old connection (old ID: %s)", username, existingPlayer.ID)
			close(existingPlayer.Send)
			existingPlayer.Send = nil
			h.gameManager.RemovePlayer(existingPlayer.ID)
			time.Sleep(50 * time.Millisecond)
		}

		// Check again if username exists (after cleanup)
		if h.gameManager.UsernameExists(username) {
			log.Printf("Username %s still in use after cleanup, closing connection", username)
			conn, _ := upgrader.Upgrade(w, r, nil)
			if conn != nil {
				errorMsg := map[string]any{
					"type":    "error",
					"code":    "USERNAME_EXISTS",
					"message": "Username already in use. Please choose another name.",
				}
				jsonError, _ := json.Marshal(errorMsg)
				conn.WriteMessage(websocket.TextMessage, jsonError)
				conn.Close()
			}
			return
		}

		// Create new player
		player = &models.Player{
			ID:       uuid.New().String(),
			Username: username,
			Send:     make(chan []byte, 256),
			JoinedAt: time.Now(),
		}

		// Generate token for new player
		var err error
		token, err = auth.GenerateToken(player.ID, player.Username)
		if err != nil {
			log.Printf("Error generating token: %v", err)
			conn, _ := upgrader.Upgrade(w, r, nil)
			if conn != nil {
				conn.Close()
			}
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
	connectedMsg := map[string]interface{}{
		"type": "connected",
		"player": map[string]interface{}{
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

	// Start goroutines for reading and writing
	go h.writePump(player, conn)
	h.readPump(player, conn)
}

func (h *WebSocketHandler) readPump(player *models.Player, conn *websocket.Conn) {
	defer func() {
		h.gameManager.RemovePlayer(player.ID)
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

		var msgData map[string]interface{}
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
			for i := 0; i < n; i++ {
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
