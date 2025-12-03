package game

import (
	"snake-backend/constants"
	"snake-backend/models"
)

// PlayerReady handles player ready status for single player games
func (gm *Manager) PlayerReadySingle(player *models.Player, gameID string) {
	gm.Mutex.RLock()
	game, exists := gm.Games[gameID]
	gm.Mutex.RUnlock()

	if !exists {
		return
	}

	game.Mutex.Lock()
	if game.Player1.ID == player.ID {
		game.Player1.Ready = true
	}

	game.State.Players = []models.PlayerStatus{
		{ID: game.Player1.ID, Username: game.Player1.Username, Ready: game.Player1.Ready},
	}
	gameState := game.State
	game.Mutex.Unlock()

	gm.broadcastToPlayers(game, constants.MSG_GAME_UPDATE, map[string]any{"data": gameState})
	if game.Player1.Ready {
		go gm.StartSinglePlayerGame(player)
	}
}

// checkCollisionsSingle checks collisions for single player games
func (gm *Manager) checkCollisionsSingle(game *models.Game) string {
	if len(game.State.Snakes) == 0 {
		return ""
	}
	head := game.State.Snakes[0].Body[0]
	for j := 1; j < len(game.State.Snakes[0].Body); j++ {
		if head.X != game.State.Snakes[0].Body[j].X || head.Y != game.State.Snakes[0].Body[j].Y {
			continue
		}
		// Game over - player lost
		return "game_over"
	}
	return ""
}
