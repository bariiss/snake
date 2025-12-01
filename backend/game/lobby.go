package game

import (
	"encoding/json"
	"log"
	"strings"

	"snake-backend/constants"
	"snake-backend/models"
)

// UsernameExists checks if a username is already in use (in lobby, active games, or spectators)
// Case-insensitive comparison
func (gm *Manager) UsernameExists(username string) bool {
	usernameLower := strings.ToLower(strings.TrimSpace(username))
	if usernameLower == "" {
		return false
	}

	// Check lobby (case-insensitive)
	if gm.Lobby.ExistsByUsername(username) {
		return true
	}

	// Check active games and spectators
	gm.Mutex.RLock()
	defer gm.Mutex.RUnlock()

	for _, game := range gm.Games {
		game.Mutex.RLock()
		if strings.EqualFold(game.Player1.Username, username) || strings.EqualFold(game.Player2.Username, username) {
			game.Mutex.RUnlock()
			return true
		}
		// Check spectators
		for _, spectator := range game.Spectators {
			if strings.EqualFold(spectator.Username, username) {
				game.Mutex.RUnlock()
				return true
			}
		}
		game.Mutex.RUnlock()
	}

	return false
}

func (gm *Manager) AddToLobby(player *models.Player) {
	if added := gm.Lobby.Add(player); !added {
		log.Printf("Player %s (%s) already in lobby", player.ID, player.Username)
		return
	}

	log.Printf("Player %s (%s) added to lobby, total players: %d", player.ID, player.Username, gm.Lobby.Len())

	gm.BroadcastLobbyStatus()
	gm.SendGamesList(player)
}

func (gm *Manager) RemoveFromLobby(playerID string) {
	gm.Lobby.Remove(playerID)
	gm.BroadcastLobbyStatus()
}

func (gm *Manager) BroadcastLobbyStatus() {
	players := gm.Lobby.Snapshot()

	log.Printf("Broadcasting lobby status to %d players", len(players))

	for _, p := range players {
		gm.sendMessage(p, constants.MSG_LOBBY_STATUS, map[string]any{
			"players": players,
		})
		log.Printf("Sent lobby status to player %s (%s)", p.ID, p.Username)
	}
}

func (gm *Manager) sendMessage(player *models.Player, msgType string, data map[string]any) {
	message := map[string]any{
		"type": msgType,
	}
	for k, v := range data {
		message[k] = v
	}

	jsonData, _ := json.Marshal(message)

	// Try WebSocket first (for lobby/matchmaking)
	if player.Send != nil {
		select {
		case player.Send <- jsonData:
			return
		default:
			log.Printf("Failed to send WebSocket message to player %s (%s) - channel full", player.ID, player.Username)
		}
	}

	// Fallback to WebRTC (if available)
	if gm.WebRTCManager != nil {
		gm.WebRTCManager.SendMessage(player.ID, msgType, data)
	}
}

// SendPeerOffer sends a peer-to-peer offer to a player
func (gm *Manager) SendPeerOffer(playerID string, offer interface{}) {
	gm.Mutex.RLock()
	player, exists := gm.Lobby.Get(playerID)
	gm.Mutex.RUnlock()

	if !exists {
		return
	}

	// Send via WebSocket (preferred) or WebRTC
	gm.sendMessage(player, constants.MSG_PEER_OFFER, map[string]any{
		"offer": offer,
	})
}

// SendPeerAnswer sends a peer-to-peer answer to a player
func (gm *Manager) SendPeerAnswer(playerID string, answer interface{}) {
	gm.Mutex.RLock()
	player, exists := gm.Lobby.Get(playerID)
	gm.Mutex.RUnlock()

	if !exists {
		return
	}

	// Send via WebSocket (preferred) or WebRTC
	gm.sendMessage(player, constants.MSG_PEER_ANSWER, map[string]any{
		"answer": answer,
	})
}

// SendICECandidate sends an ICE candidate to a player
func (gm *Manager) SendICECandidate(playerID string, candidate interface{}) {
	gm.Mutex.RLock()
	player, exists := gm.Lobby.Get(playerID)
	gm.Mutex.RUnlock()

	if !exists {
		return
	}

	// Send via WebSocket (preferred) or WebRTC
	gm.sendMessage(player, constants.MSG_PEER_ICE_CANDIDATE, map[string]any{
		"candidate": candidate,
	})
}

func (gm *Manager) SendGamesList(player *models.Player) {
	gm.Mutex.RLock()
	gamesList := make([]map[string]any, 0, len(gm.Games))
	for gameID, game := range gm.Games {
		game.Mutex.RLock()
		gameInfo := map[string]any{
			"id":         gameID,
			"player1":    game.Player1.Username,
			"player2":    game.Player2.Username,
			"status":     game.State.Status,
			"spectators": len(game.Spectators),
		}
		if game.State.Status == "playing" {
			gameInfo["scores"] = map[string]int{
				game.Player1.Username: 0,
				game.Player2.Username: 0,
			}
			for _, snake := range game.State.Snakes {
				switch snake.ID {
				case game.Player1.ID:
					gameInfo["scores"].(map[string]int)[game.Player1.Username] = snake.Score
				case game.Player2.ID:
					gameInfo["scores"].(map[string]int)[game.Player2.Username] = snake.Score
				}
			}
		}
		game.Mutex.RUnlock()
		gamesList = append(gamesList, gameInfo)
	}
	gm.Mutex.RUnlock()

	gm.sendMessage(player, constants.MSG_GAMES_LIST, map[string]any{
		"games": gamesList,
	})
}

func (gm *Manager) BroadcastGamesList() {
	players := gm.Lobby.Snapshot()
	for _, p := range players {
		gm.SendGamesList(p)
	}
}
