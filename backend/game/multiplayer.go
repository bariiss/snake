package game

import (
	"snake-backend/constants"
	"snake-backend/models"
)

// MultiplayerGameManager handles all multiplayer game logic
type MultiplayerGameManager struct {
	manager *Manager
}

// NewMultiplayerGameManager creates a new multiplayer game manager
func NewMultiplayerGameManager(manager *Manager) *MultiplayerGameManager {
	return &MultiplayerGameManager{
		manager: manager,
	}
}

// AuthorizeGameAccess checks if player is authorized to access a game
func (mgm *MultiplayerGameManager) AuthorizeGameAccess(playerID, gameID string) bool {
	mgm.manager.Mutex.RLock()
	defer mgm.manager.Mutex.RUnlock()

	game, exists := mgm.manager.Games[gameID]
	if !exists {
		return false
	}

	game.Mutex.RLock()
	defer game.Mutex.RUnlock()

	// Check if player is Player1, Player2, or a spectator
	if game.Player1 != nil && game.Player1.ID == playerID {
		return true
	}
	if game.Player2 != nil && game.Player2.ID == playerID {
		return true
	}
	if game.Spectators != nil {
		if _, exists := game.Spectators[playerID]; exists {
			return true
		}
	}

	return false
}

// HandlePlayerMove handles player move in multiplayer game
func (mgm *MultiplayerGameManager) HandlePlayerMove(player *models.Player, gameID string, direction string) {
	// Check authorization
	if !mgm.AuthorizeGameAccess(player.ID, gameID) {
		mgm.manager.sendMessage(player, constants.MSG_ERROR, map[string]any{
			"code":    "UNAUTHORIZED",
			"message": "You are not authorized to perform this action",
		})
		return
	}

	mgm.manager.HandlePlayerMove(player, gameID, direction)
}

// HandlePlayerReady handles player ready in multiplayer game
func (mgm *MultiplayerGameManager) HandlePlayerReady(player *models.Player, gameID string) {
	// Check authorization
	if !mgm.AuthorizeGameAccess(player.ID, gameID) {
		mgm.manager.sendMessage(player, constants.MSG_ERROR, map[string]any{
			"code":    "UNAUTHORIZED",
			"message": "You are not authorized to perform this action",
		})
		return
	}

	mgm.manager.PlayerReady(player, gameID)
}

// HandleRematchRequest handles rematch request in multiplayer game
func (mgm *MultiplayerGameManager) HandleRematchRequest(player *models.Player, gameID string) {
	// Check authorization
	if !mgm.AuthorizeGameAccess(player.ID, gameID) {
		mgm.manager.sendMessage(player, constants.MSG_ERROR, map[string]any{
			"code":    "UNAUTHORIZED",
			"message": "You are not authorized to perform this action",
		})
		return
	}

	mgm.manager.HandleRematchRequest(player, gameID)
}

// HandleRematchAccept handles rematch accept in multiplayer game
func (mgm *MultiplayerGameManager) HandleRematchAccept(player *models.Player, gameID string) {
	// Check authorization
	if !mgm.AuthorizeGameAccess(player.ID, gameID) {
		mgm.manager.sendMessage(player, constants.MSG_ERROR, map[string]any{
			"code":    "UNAUTHORIZED",
			"message": "You are not authorized to perform this action",
		})
		return
	}

	mgm.manager.HandleRematchAccept(player, gameID)
}
