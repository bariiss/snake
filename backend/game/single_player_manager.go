package game

import (
	"snake-backend/constants"
	"snake-backend/models"
)

// SinglePlayerGameManager handles all single player game logic
type SinglePlayerGameManager struct {
	manager *Manager
}

// NewSinglePlayerGameManager creates a new single player game manager
func NewSinglePlayerGameManager(manager *Manager) *SinglePlayerGameManager {
	return &SinglePlayerGameManager{
		manager: manager,
	}
}

// AuthorizeGameAccess checks if player is authorized to access a single player game
func (spgm *SinglePlayerGameManager) AuthorizeGameAccess(playerID, gameID string) bool {
	spgm.manager.Mutex.RLock()
	defer spgm.manager.Mutex.RUnlock()

	game, exists := spgm.manager.Games[gameID]
	if !exists {
		return false
	}

	game.Mutex.RLock()
	defer game.Mutex.RUnlock()

	// Single player games only have Player1
	if !game.IsSinglePlayer {
		return false
	}

	return game.Player1 != nil && game.Player1.ID == playerID
}

// HandlePlayerMove handles player move in single player game
func (spgm *SinglePlayerGameManager) HandlePlayerMove(player *models.Player, gameID string, direction string) {
	// Check authorization
	if !spgm.AuthorizeGameAccess(player.ID, gameID) {
		spgm.manager.sendMessage(player, constants.MSG_ERROR, map[string]any{
			"code":    "UNAUTHORIZED",
			"message": "You are not authorized to perform this action",
		})
		return
	}

	spgm.manager.HandlePlayerMove(player, gameID, direction)
}

// HandlePlayerReady handles player ready in single player game
func (spgm *SinglePlayerGameManager) HandlePlayerReady(player *models.Player, gameID string) {
	// Check authorization
	if !spgm.AuthorizeGameAccess(player.ID, gameID) {
		spgm.manager.sendMessage(player, constants.MSG_ERROR, map[string]any{
			"code":    "UNAUTHORIZED",
			"message": "You are not authorized to perform this action",
		})
		return
	}

	spgm.manager.PlayerReady(player, gameID)
}
