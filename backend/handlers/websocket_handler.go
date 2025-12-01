package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/websocket"

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
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}

	// Read username from query parameter or header
	username := r.URL.Query().Get("username")
	if username == "" {
		username = r.Header.Get("X-Username")
	}

	if username == "" {
		log.Printf("No username provided, closing connection")
		conn.Close()
		return
	}

	username = strings.TrimSpace(username)

	// Check if username already exists and disconnect old connection if same username
	existingPlayer := h.gameManager.FindPlayerByUsername(username)
	if existingPlayer != nil && existingPlayer.Send != nil {
		// Same username is already connected - close old connection
		log.Printf("Username %s already connected, closing old connection (old ID: %s)", username, existingPlayer.ID)
		// Close the old WebSocket connection by closing the Send channel
		// This will trigger the readPump defer which calls RemovePlayer
		close(existingPlayer.Send)
		existingPlayer.Send = nil
		// Remove from lobby and games immediately
		h.gameManager.RemovePlayer(existingPlayer.ID)
		// Wait a bit for cleanup
		time.Sleep(50 * time.Millisecond)
	}

	// Check again if username exists (after cleanup)
	if h.gameManager.UsernameExists(username) {
		log.Printf("Username %s still in use after cleanup, closing connection", username)
		errorMsg := map[string]interface{}{
			"type":    "error",
			"code":    "USERNAME_EXISTS",
			"message": "Username already in use. Please choose another name.",
		}
		jsonError, _ := json.Marshal(errorMsg)
		conn.WriteMessage(websocket.TextMessage, jsonError)
		conn.Close()
		return
	}

	player := &models.Player{
		ID:       uuid.New().String(),
		Username: username,
		Send:     make(chan []byte, 256),
		JoinedAt: time.Now(),
	}

	// Add player to lobby
	h.gameManager.AddToLobby(player)

	// Send connected message
	connectedMsg := map[string]interface{}{
		"type": "connected",
		"player": map[string]interface{}{
			"id":       player.ID,
			"username": player.Username,
		},
	}
	jsonData, _ := json.Marshal(connectedMsg)
	select {
	case player.Send <- jsonData:
	default:
		log.Printf("Failed to send connected message to player %s", player.Username)
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
