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
// Only checks players with active connections (Send channel is not nil)
func (gm *Manager) UsernameExists(username string) bool {
	usernameLower := strings.ToLower(strings.TrimSpace(username))
	if usernameLower == "" {
		return false
	}

	// Check lobby (case-insensitive) - only players with active connections
	for _, p := range gm.Lobby.Snapshot() {
		if strings.EqualFold(p.Username, username) && p.Send != nil {
			return true
		}
	}

	// Check active games and spectators - only players with active connections
	gm.Mutex.RLock()
	defer gm.Mutex.RUnlock()

	for _, game := range gm.Games {
		game.Mutex.RLock()
		// Check Player1 - only if has active connection
		if game.Player1 != nil && strings.EqualFold(game.Player1.Username, username) && game.Player1.Send != nil {
			game.Mutex.RUnlock()
			return true
		}
		// Check Player2 - only if has active connection
		if game.Player2 != nil && strings.EqualFold(game.Player2.Username, username) && game.Player2.Send != nil {
			game.Mutex.RUnlock()
			return true
		}
		// Check spectators - only if has active connection
		for _, spectator := range game.Spectators {
			if strings.EqualFold(spectator.Username, username) && spectator.Send != nil {
				game.Mutex.RUnlock()
				return true
			}
		}
		game.Mutex.RUnlock()
	}

	return false
}

// FindPlayerByUsername finds a player by username (case-insensitive)
// Returns the player if found, nil otherwise
func (gm *Manager) FindPlayerByUsername(username string) *models.Player {
	usernameLower := strings.ToLower(strings.TrimSpace(username))
	if usernameLower == "" {
		return nil
	}

	// Check lobby
	for _, p := range gm.Lobby.Snapshot() {
		if strings.EqualFold(p.Username, username) {
			return p
		}
	}

	// Check active games
	gm.Mutex.RLock()
	defer gm.Mutex.RUnlock()

	for _, game := range gm.Games {
		game.Mutex.RLock()
		if game.Player1 != nil && strings.EqualFold(game.Player1.Username, username) {
			game.Mutex.RUnlock()
			return game.Player1
		}
		if game.Player2 != nil && strings.EqualFold(game.Player2.Username, username) {
			game.Mutex.RUnlock()
			return game.Player2
		}
		// Check spectators
		for _, spectator := range game.Spectators {
			if strings.EqualFold(spectator.Username, username) {
				game.Mutex.RUnlock()
				return spectator
			}
		}
		game.Mutex.RUnlock()
	}

	return nil
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

	// Check which players are in active games
	gm.Mutex.RLock()
	playersInGame := make(map[string]bool)
	for _, game := range gm.Games {
		game.Mutex.RLock()
		if game.State.Status != "finished" {
			playersInGame[game.Player1.ID] = true
			playersInGame[game.Player2.ID] = true
		}
		game.Mutex.RUnlock()
	}
	gm.Mutex.RUnlock()

	// Add in_game status to players
	playersWithStatus := make([]map[string]any, 0, len(players))
	for _, p := range players {
		playerData := map[string]any{
			"id":        p.ID,
			"username":  p.Username,
			"ready":     p.Ready,
			"joined_at": p.JoinedAt,
		}
		if playersInGame[p.ID] {
			playerData["in_game"] = true
		}
		playersWithStatus = append(playersWithStatus, playerData)
	}

	for _, p := range players {
		gm.sendMessage(p, constants.MSG_LOBBY_STATUS, map[string]any{
			"players": playersWithStatus,
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
		// Skip finished games - they shouldn't appear in the lobby
		if game.State.Status == "finished" {
			game.Mutex.RUnlock()
			continue
		}

		gameInfo := map[string]any{
			"id":         gameID,
			"player1":    game.Player1.Username,
			"status":     game.State.Status,
			"spectators": len(game.Spectators),
		}
		// Only include player2 if it's a multiplayer game
		if !game.IsSinglePlayer && game.Player2 != nil {
			gameInfo["player2"] = game.Player2.Username
		}
		if game.State.Status == "playing" {
			if game.IsSinglePlayer {
				// Single player game - only one score
				gameInfo["scores"] = map[string]int{
					game.Player1.Username: 0,
				}
				for _, snake := range game.State.Snakes {
					if snake.ID == game.Player1.ID {
						gameInfo["scores"].(map[string]int)[game.Player1.Username] = snake.Score
					}
				}
			} else {
				// Multiplayer game - two scores
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
