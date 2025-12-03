package game

import (
	"snake-backend/models"
)

// PlayerReady routes to appropriate handler based on game type
func (gm *Manager) PlayerReady(player *models.Player, gameID string) {
	gm.Mutex.RLock()
	game, exists := gm.Games[gameID]
	gm.Mutex.RUnlock()

	if !exists {
		return
	}

	if game.IsSinglePlayer {
		gm.PlayerReadySingle(player, gameID)
	} else {
		gm.PlayerReadyMulti(player, gameID)
	}
}

// checkCollisions routes to appropriate collision checker based on game type
func (gm *Manager) checkCollisions(game *models.Game) string {
	if game.IsSinglePlayer {
		return gm.checkCollisionsSingle(game)
	}
	return gm.checkCollisionsMulti(game)
}
