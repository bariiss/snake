package game

import (
	"fmt"

	"snake-backend/constants"
	"snake-backend/models"

	"github.com/google/uuid"
)

func (gm *Manager) SendGameRequest(from *models.Player, toID string) {
	target, exists := gm.Lobby.Get(toID)
	if !exists {
		gm.sendMessage(from, constants.MSG_ERROR, map[string]any{
			"message": "Player not found in lobby",
		})
		return
	}

	gameID := uuid.New().String()
	game := &models.Game{
		ID:         gameID,
		Player1:    from,
		Player2:    target,
		IsActive:   false,
		Spectators: make(map[string]*models.Player),
	}
	game.State = &models.GameState{
		ID:             gameID,
		Status:         "waiting",
		IsSinglePlayer: false,
		Players: []models.PlayerStatus{
			{ID: from.ID, Username: from.Username, Ready: false},
			{ID: target.ID, Username: target.Username, Ready: false},
		},
	}

	gm.Mutex.Lock()
	if gm.PendingRequests[toID] == nil {
		gm.PendingRequests[toID] = make(map[string]*models.Game)
	}
	if _, exists := gm.PendingRequests[toID][from.ID]; exists {
		gm.Mutex.Unlock()
		gm.sendMessage(from, constants.MSG_ERROR, map[string]any{
			"message": "You already sent a request to this player",
		})
		return
	}

	gm.Games[gameID] = game
	gm.PendingRequests[toID][from.ID] = game
	gm.Mutex.Unlock()

	gm.sendMessage(target, constants.MSG_MATCH_FOUND, map[string]any{
		"game_id":     gameID,
		"from_player": from,
	})

	gm.sendMessage(from, constants.MSG_GAME_REQUEST_SENT, map[string]any{
		"game_id":   gameID,
		"to_player": target,
		"status":    "pending",
	})
}

func (gm *Manager) CancelGameRequest(from *models.Player, toID string) {
	gm.Mutex.Lock()
	defer gm.Mutex.Unlock()

	if targetRequests, exists := gm.PendingRequests[toID]; exists {
		if game, hasRequest := targetRequests[from.ID]; hasRequest {
			delete(targetRequests, from.ID)
			if len(targetRequests) == 0 {
				delete(gm.PendingRequests, toID)
			}

			delete(gm.Games, game.ID)

			if target, ok := gm.Lobby.Get(toID); ok {
				gm.sendMessage(target, constants.MSG_GAME_REQUEST_CANCEL, map[string]any{
					"from_player": from,
					"message":     fmt.Sprintf("%s cancelled the game request", from.Username),
				})
			}

			gm.sendMessage(from, constants.MSG_GAME_REQUEST_CANCEL, map[string]any{
				"to_player": toID,
				"status":    "cancelled",
			})
		}
	}
}

func (gm *Manager) AcceptGameRequest(player *models.Player, gameID string) {
	gm.Mutex.RLock()
	game, exists := gm.Games[gameID]
	gm.Mutex.RUnlock()

	if !exists {
		gm.sendMessage(player, constants.MSG_ERROR, map[string]any{
			"message": "Game not found",
		})
		return
	}

	if game.Player2.ID != player.ID {
		gm.sendMessage(player, constants.MSG_ERROR, map[string]any{
			"message": "You are not the target player",
		})
		return
	}

	gm.Mutex.Lock()
	if targetRequests, exists := gm.PendingRequests[player.ID]; exists {
		delete(targetRequests, game.Player1.ID)
		if len(targetRequests) == 0 {
			delete(gm.PendingRequests, player.ID)
		}
	}
	for targetID, requests := range gm.PendingRequests {
		if targetID != player.ID {
			delete(requests, player.ID)
			if len(requests) == 0 {
				delete(gm.PendingRequests, targetID)
			}
		}
	}
	gm.Mutex.Unlock()

	gameState := game.State

	gm.sendMessage(game.Player1, constants.MSG_GAME_ACCEPT, map[string]any{
		"game_id": gameID,
		"data":    gameState,
	})
	gm.sendMessage(game.Player2, constants.MSG_GAME_ACCEPT, map[string]any{
		"game_id": gameID,
		"data":    gameState,
	})

	gm.BroadcastGamesList()
}

func (gm *Manager) RejectGameRequest(player *models.Player, gameID string) {
	gm.Mutex.Lock()
	game, exists := gm.Games[gameID]
	if !exists {
		gm.Mutex.Unlock()
		return
	}

	if game.Player2.ID == player.ID {
		if targetRequests, exists := gm.PendingRequests[player.ID]; exists {
			delete(targetRequests, game.Player1.ID)
			if len(targetRequests) == 0 {
				delete(gm.PendingRequests, player.ID)
			}
		}
		delete(gm.Games, gameID)
		gm.Mutex.Unlock()

		gm.sendMessage(game.Player1, constants.MSG_GAME_REJECT, map[string]any{
			"game_id":     gameID,
			"from_player": player,
		})
	} else {
		gm.Mutex.Unlock()
	}
}
