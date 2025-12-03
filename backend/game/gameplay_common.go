package game

import (
	"log"
	"math/rand"

	"snake-backend/constants"
	"snake-backend/models"
)

// HandlePlayerMove handles player move input (common for both single and multiplayer)
func (gm *Manager) HandlePlayerMove(player *models.Player, gameID string, directionStr string) {
	gm.Mutex.RLock()
	game, exists := gm.Games[gameID]
	gm.Mutex.RUnlock()

	if !exists || !game.IsActive {
		return
	}

	game.Mutex.RLock()
	isPlayer := game.Player1.ID == player.ID || (game.Player2 != nil && game.Player2.ID == player.ID)
	game.Mutex.RUnlock()

	if !isPlayer {
		gm.sendMessage(player, constants.MSG_ERROR, map[string]any{
			"message": "Only players can move. Spectators can only watch.",
			"code":    "NOT_A_PLAYER",
		})
		return
	}

	var direction constants.Direction
	switch directionStr {
	case "up":
		direction = constants.UP
	case "down":
		direction = constants.DOWN
	case "left":
		direction = constants.LEFT
	case "right":
		direction = constants.RIGHT
	default:
		return
	}

	game.Mutex.Lock()
	opposites := map[constants.Direction]constants.Direction{
		constants.UP:    constants.DOWN,
		constants.DOWN:  constants.UP,
		constants.LEFT:  constants.RIGHT,
		constants.RIGHT: constants.LEFT,
	}
	for i := range game.State.Snakes {
		if game.State.Snakes[i].ID != player.ID {
			continue
		}
		if direction == opposites[game.State.Snakes[i].Direction] {
			break
		}
		game.State.Snakes[i].NextDir = direction
		break
	}
	game.Mutex.Unlock()
}

// gameLoop is the main game loop (common for both single and multiplayer)
func (gm *Manager) gameLoop(game *models.Game) {
	defer game.Ticker.Stop()

	for range game.Ticker.C {
		game.Mutex.Lock()
		if !game.IsActive {
			game.Mutex.Unlock()
			return
		}

		for i := range game.State.Snakes {
			game.State.Snakes[i].Direction = game.State.Snakes[i].NextDir
		}

		for i := range game.State.Snakes {
			head := game.State.Snakes[i].Body[0]
			var newHead models.Position

			switch game.State.Snakes[i].Direction {
			case constants.UP:
				newHead = models.Position{X: head.X, Y: head.Y - 1}
			case constants.DOWN:
				newHead = models.Position{X: head.X, Y: head.Y + 1}
			case constants.LEFT:
				newHead = models.Position{X: head.X - 1, Y: head.Y}
			case constants.RIGHT:
				newHead = models.Position{X: head.X + 1, Y: head.Y}
			}

			if newHead.X < 0 {
				newHead.X = constants.GRID_WIDTH - 1
			} else if newHead.X >= constants.GRID_WIDTH {
				newHead.X = 0
			}
			if newHead.Y < 0 {
				newHead.Y = constants.GRID_HEIGHT - 1
			} else if newHead.Y >= constants.GRID_HEIGHT {
				newHead.Y = 0
			}

			game.State.Snakes[i].Body = append([]models.Position{newHead}, game.State.Snakes[i].Body...)

			if newHead.X == game.State.Food.Position.X && newHead.Y == game.State.Food.Position.Y {
				game.State.Snakes[i].Score++
				game.State.Food = models.Food{Position: gm.generateFood(game.State.Snakes)}
			} else {
				game.State.Snakes[i].Body = game.State.Snakes[i].Body[:len(game.State.Snakes[i].Body)-1]
			}
		}

		winner := gm.checkCollisions(game)
		if winner != "" {
			// Ensure IsSinglePlayer flag is set correctly before copying
			game.State.IsSinglePlayer = game.IsSinglePlayer
			gameState := game.State
			game.Mutex.Unlock()
			// For single player, "game_over" means player lost
			if winner == "game_over" {
				gameState.Winner = "" // No winner in single player loss
			}
			gm.endGame(game, winner, gameState)
			return
		}

		// Ensure IsSinglePlayer flag is set correctly
		game.State.IsSinglePlayer = game.IsSinglePlayer
		stateCopy := game.State
		game.Mutex.Unlock()
		// Log for debugging
		if game.IsSinglePlayer {
			log.Printf("Single player game update: status=%s, snakes=%d", stateCopy.Status, len(stateCopy.Snakes))
		}
		gm.broadcastToPlayers(game, constants.MSG_GAME_UPDATE, map[string]any{"data": stateCopy})
	}
}

// endGame handles game ending (common for both single and multiplayer)
func (gm *Manager) endGame(game *models.Game, winner string, stateCopy *models.GameState) {
	game.Mutex.Lock()
	game.IsActive = false
	game.State.Status = "finished"
	game.State.Winner = winner
	game.State.IsSinglePlayer = game.IsSinglePlayer
	game.Player1.Ready = false
	if game.Player2 != nil {
		game.Player2.Ready = false
	}

	// Update stateCopy with IsSinglePlayer flag
	if stateCopy != nil {
		stateCopy.IsSinglePlayer = game.IsSinglePlayer
		stateCopy.Status = "finished"
		stateCopy.Winner = winner
	}

	// Get player references before unlocking
	player1 := game.Player1
	player2 := game.Player2
	game.Mutex.Unlock()

	// Broadcast game over
	gm.broadcastToPlayers(game, constants.MSG_GAME_OVER, map[string]any{"data": stateCopy})

	// Add players back to lobby if they still have active connections
	// Check if player still exists (has active WebSocket connection)
	if player1.Send == nil {
		gm.BroadcastGamesList()
		gm.BroadcastLobbyStatus()
		return
	}
	if _, exists := gm.Lobby.Get(player1.ID); !exists {
		gm.AddToLobby(player1)
	}

	if player2 == nil || player2.Send == nil {
		gm.BroadcastGamesList()
		gm.BroadcastLobbyStatus()
		return
	}
	if _, exists := gm.Lobby.Get(player2.ID); !exists {
		gm.AddToLobby(player2)
	}

	// Broadcast updated games list (finished games will be filtered out)
	gm.BroadcastGamesList()

	// Broadcast updated lobby status (players will show as "in game" until they leave)
	gm.BroadcastLobbyStatus()
}

// generateFood generates food position avoiding snake bodies (common utility)
func (gm *Manager) generateFood(snakes []models.Snake) models.Position {
	for {
		food := models.Position{
			X: rand.Intn(constants.GRID_WIDTH),
			Y: rand.Intn(constants.GRID_HEIGHT),
		}

		valid := true
		for _, snake := range snakes {
			for _, bodyPart := range snake.Body {
				if food.X == bodyPart.X && food.Y == bodyPart.Y {
					valid = false
					break
				}
			}
			if !valid {
				break
			}
		}

		if valid {
			return food
		}
	}
}

// broadcastToPlayers broadcasts message to all players and spectators (common utility)
func (gm *Manager) broadcastToPlayers(game *models.Game, msgType string, data map[string]any) {
	// Send to Player1 (prioritize WebSocket, fallback to WebRTC)
	gm.sendMessage(game.Player1, msgType, data)

	// Send to Player2 if exists (multiplayer only)
	if game.Player2 != nil {
		gm.sendMessage(game.Player2, msgType, data)
	}

	// Send to spectators (prioritize WebSocket, fallback to WebRTC)
	game.Mutex.RLock()
	for _, spectator := range game.Spectators {
		gm.sendMessage(spectator, msgType, data)
	}
	game.Mutex.RUnlock()
}
