package game

import (
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"

	"snake-backend/constants"
	"snake-backend/models"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

func (gm *Manager) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}

	player := &models.Player{
		ID:       uuid.New().String(),
		Conn:     conn,
		Send:     make(chan []byte, 256),
		Username: r.URL.Query().Get("username"),
		Ready:    false,
		JoinedAt: time.Now(),
	}

	if player.Username == "" {
		player.Username = "Player_" + player.ID[:8]
	}

	if gm.usernameExists(player.Username) {
		sendMessage(player, constants.MSG_ERROR, map[string]any{
			"message": "Username already taken. Please choose a different username.",
			"code":    "USERNAME_EXISTS",
		})
		conn.Close()
		return
	}

	go readPump(player, gm)
	go writePump(player)

	sendMessage(player, constants.MSG_CONNECTED, map[string]any{
		"player": player,
	})

	gm.AddToLobby(player)
}

func readPump(player *models.Player, gm *Manager) {
	defer func() {
		gm.RemovePlayer(player.ID)
		player.Conn.Close()
	}()

	player.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	player.Conn.SetPongHandler(func(string) error {
		player.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		_, message, err := player.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket error: %v", err)
			}
			break
		}

		var msg map[string]any
		if err := json.Unmarshal(message, &msg); err != nil {
			log.Printf("Error unmarshaling message: %v", err)
			continue
		}

		msgType, ok := msg["type"].(string)
		if !ok {
			continue
		}

		gm.handleMessage(player, msgType, msg)
	}
}

func writePump(player *models.Player) {
	ticker := time.NewTicker(54 * time.Second)
	defer func() {
		ticker.Stop()
		player.Conn.Close()
	}()

	for {
		select {
		case message, ok := <-player.Send:
			player.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				player.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := player.Conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)

			n := len(player.Send)
			for i := 0; i < n; i++ {
				w.Write([]byte{'\n'})
				w.Write(<-player.Send)
			}

			if err := w.Close(); err != nil {
				return
			}
		case <-ticker.C:
			player.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := player.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (gm *Manager) handleMessage(player *models.Player, msgType string, msg map[string]any) {
	switch msgType {
	case constants.MSG_JOIN_LOBBY:
		gm.AddToLobby(player)
	case constants.MSG_LEAVE_LOBBY:
		gm.RemoveFromLobby(player.ID)
	case constants.MSG_GAME_REQUEST:
		if targetID, ok := msg["target_id"].(string); ok {
			gm.SendGameRequest(player, targetID)
		}
	case constants.MSG_GAME_REQUEST_CANCEL:
		if targetID, ok := msg["target_id"].(string); ok {
			gm.CancelGameRequest(player, targetID)
		}
	case constants.MSG_GAME_ACCEPT:
		if gameID, ok := msg["game_id"].(string); ok {
			gm.AcceptGameRequest(player, gameID)
		}
	case constants.MSG_GAME_REJECT:
		if gameID, ok := msg["game_id"].(string); ok {
			gm.RejectGameRequest(player, gameID)
		}
	case constants.MSG_PLAYER_READY:
		if gameID, ok := msg["game_id"].(string); ok {
			gm.PlayerReady(player, gameID)
		}
	case constants.MSG_PLAYER_MOVE:
		if gameID, ok := msg["game_id"].(string); ok {
			if direction, ok := msg["direction"].(string); ok {
				gm.HandlePlayerMove(player, gameID, direction)
			}
		}
	case constants.MSG_LIST_GAMES:
		gm.SendGamesList(player)
	case constants.MSG_JOIN_SPECTATOR:
		if gameID, ok := msg["game_id"].(string); ok {
			gm.AddSpectator(player, gameID)
		}
	case constants.MSG_REMATCH_REQUEST:
		if gameID, ok := msg["game_id"].(string); ok {
			gm.HandleRematchRequest(player, gameID)
		}
	}
}

func (gm *Manager) usernameExists(username string) bool {
	if gm.Lobby.ExistsByUsername(username) {
		return true
	}

	gm.Mutex.RLock()
	defer gm.Mutex.RUnlock()

	for _, game := range gm.Games {
		if game.Player1.Username == username || game.Player2.Username == username {
			return true
		}
		game.Mutex.RLock()
		for _, spec := range game.Spectators {
			if spec.Username == username {
				game.Mutex.RUnlock()
				return true
			}
		}
		game.Mutex.RUnlock()
	}
	return false
}

func sendMessage(player *models.Player, msgType string, data map[string]any) {
	message := map[string]any{
		"type": msgType,
	}
	for k, v := range data {
		message[k] = v
	}

	jsonData, _ := json.Marshal(message)

	select {
	case player.Send <- jsonData:
	default:
		close(player.Send)
	}
}
