package game

import (
	"time"

	"snake-backend/constants"
	"snake-backend/models"
)

// PlayerReady handles player ready status for multiplayer games
func (gm *Manager) PlayerReadyMulti(player *models.Player, gameID string) {
	gm.Mutex.RLock()
	game, exists := gm.Games[gameID]
	gm.Mutex.RUnlock()

	if !exists {
		return
	}

	game.Mutex.Lock()
	if game.Player1.ID == player.ID {
		game.Player1.Ready = true
	} else if game.Player2 != nil && game.Player2.ID == player.ID {
		game.Player2.Ready = true
	}

	game.State.Players = []models.PlayerStatus{
		{ID: game.Player1.ID, Username: game.Player1.Username, Ready: game.Player1.Ready},
		{ID: game.Player2.ID, Username: game.Player2.Username, Ready: game.Player2.Ready},
	}
	bothReady := game.Player1.Ready && game.Player2 != nil && game.Player2.Ready
	gameState := game.State
	game.Mutex.Unlock()

	gm.broadcastToPlayers(game, constants.MSG_GAME_UPDATE, map[string]any{"data": gameState})

	if !bothReady {
		return
	}
	go gm.StartGame(gameID)
}

// StartGame starts a multiplayer game
func (gm *Manager) StartGame(gameID string) {
	gm.Mutex.RLock()
	game, exists := gm.Games[gameID]
	gm.Mutex.RUnlock()

	if !exists {
		return
	}

	game.Mutex.Lock()
	game.State.Status = "countdown"
	game.State.Countdown = 3
	game.State.IsSinglePlayer = game.IsSinglePlayer
	game.Mutex.Unlock()

	for i := 3; i > 0; i-- {
		game.Mutex.Lock()
		game.State.Countdown = i
		game.State.IsSinglePlayer = game.IsSinglePlayer
		game.Mutex.Unlock()

		gm.broadcastToPlayers(game, constants.MSG_GAME_UPDATE, map[string]any{"data": game.State})
		time.Sleep(1 * time.Second)
	}

	game.Mutex.Lock()
	game.State.Status = "playing"
	game.State.Countdown = 0
	game.State.IsSinglePlayer = game.IsSinglePlayer

	snake1 := models.Snake{
		ID:        game.Player1.ID,
		Body:      []models.Position{{X: 5, Y: 15}, {X: 4, Y: 15}, {X: 3, Y: 15}},
		Direction: constants.RIGHT,
		NextDir:   constants.RIGHT,
		Color:     "#FF0000",
		Score:     0,
		Username:  game.Player1.Username,
	}

	snake2 := models.Snake{
		ID:        game.Player2.ID,
		Body:      []models.Position{{X: 35, Y: 15}, {X: 36, Y: 15}, {X: 37, Y: 15}},
		Direction: constants.LEFT,
		NextDir:   constants.LEFT,
		Color:     "#0000FF",
		Score:     0,
		Username:  game.Player2.Username,
	}

	game.State.Snakes = []models.Snake{snake1, snake2}
	game.State.Food = models.Food{Position: gm.generateFood(game.State.Snakes)}
	game.IsActive = true
	game.Mutex.Unlock()

	gm.broadcastToPlayers(game, constants.MSG_GAME_START, map[string]any{"data": game.State})

	gm.RemoveFromLobby(game.Player1.ID)
	gm.RemoveFromLobby(game.Player2.ID)

	gm.BroadcastGamesList()

	// Stop existing ticker if any (for rematch scenarios)
	if game.Ticker != nil {
		game.Ticker.Stop()
	}

	game.Ticker = time.NewTicker(constants.TICK_RATE)
	go gm.gameLoop(game)
}

// checkCollisionsMulti checks collisions for multiplayer games
func (gm *Manager) checkCollisionsMulti(game *models.Game) string {
	// Multiplayer: check all collisions
	for i := range game.State.Snakes {
		head := game.State.Snakes[i].Body[0]
		for j := 1; j < len(game.State.Snakes[i].Body); j++ {
			if head.X != game.State.Snakes[i].Body[j].X || head.Y != game.State.Snakes[i].Body[j].Y {
				continue
			}
			// Snake i collided with itself, the other snake wins
			if i == 0 {
				return game.State.Snakes[1].ID
			}
			return game.State.Snakes[0].ID
		}
	}

	snake1Head := game.State.Snakes[0].Body[0]
	snake2Head := game.State.Snakes[1].Body[0]

	if snake1Head.X != snake2Head.X || snake1Head.Y != snake2Head.Y {
		// Check body collisions
		for _, bodyPart := range game.State.Snakes[1].Body[1:] {
			if snake1Head.X == bodyPart.X && snake1Head.Y == bodyPart.Y {
				return game.State.Snakes[1].ID
			}
		}
		for _, bodyPart := range game.State.Snakes[0].Body[1:] {
			if snake2Head.X == bodyPart.X && snake2Head.Y == bodyPart.Y {
				return game.State.Snakes[0].ID
			}
		}
		return ""
	}

	// Heads collided - check scores
	if game.State.Snakes[0].Score > game.State.Snakes[1].Score {
		return game.State.Snakes[0].ID
	}
	if game.State.Snakes[1].Score > game.State.Snakes[0].Score {
		return game.State.Snakes[1].ID
	}
	return "tie"
}
