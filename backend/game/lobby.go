package game

import (
	"encoding/json"
	"log"

	"snake-backend/constants"
	"snake-backend/models"
)

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

	payload := map[string]any{
		"type":    constants.MSG_LOBBY_STATUS,
		"players": players,
	}

	data, _ := json.Marshal(payload)

	for _, p := range players {
		select {
		case p.Send <- data:
			log.Printf("Sent lobby status to player %s (%s)", p.ID, p.Username)
		default:
			log.Printf("Failed to send lobby status to player %s (%s) - channel full", p.ID, p.Username)
			close(p.Send)
		}
	}
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

	sendMessage(player, constants.MSG_GAMES_LIST, map[string]any{
		"games": gamesList,
	})
}

func (gm *Manager) BroadcastGamesList() {
	players := gm.Lobby.Snapshot()
	for _, p := range players {
		gm.SendGamesList(p)
	}
}
