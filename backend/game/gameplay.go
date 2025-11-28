package game

import (
	"encoding/json"
	"math/rand"
	"time"

	"snake-backend/constants"
	"snake-backend/models"
)

func (gm *Manager) PlayerReady(player *models.Player, gameID string) {
	gm.Mutex.RLock()
	game, exists := gm.Games[gameID]
	gm.Mutex.RUnlock()

	if !exists {
		return
	}

	game.Mutex.Lock()
	if game.Player1.ID == player.ID {
		game.Player1.Ready = true
	} else if game.Player2.ID == player.ID {
		game.Player2.Ready = true
	}

	game.State.Players = []models.PlayerStatus{
		{ID: game.Player1.ID, Username: game.Player1.Username, Ready: game.Player1.Ready},
		{ID: game.Player2.ID, Username: game.Player2.Username, Ready: game.Player2.Ready},
	}

	bothReady := game.Player1.Ready && game.Player2.Ready
	gameState := game.State
	game.Mutex.Unlock()

	broadcastToPlayers(game, constants.MSG_GAME_UPDATE, gameState)

	if bothReady {
		go gm.StartGame(gameID)
	}
}

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
	game.Mutex.Unlock()

	for i := 3; i > 0; i-- {
		game.Mutex.Lock()
		game.State.Countdown = i
		game.Mutex.Unlock()

		broadcastToPlayers(game, constants.MSG_GAME_UPDATE, game.State)
		time.Sleep(1 * time.Second)
	}

	game.Mutex.Lock()
	game.State.Status = "playing"
	game.State.Countdown = 0

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

	broadcastToPlayers(game, constants.MSG_GAME_START, game.State)

	gm.RemoveFromLobby(game.Player1.ID)
	gm.RemoveFromLobby(game.Player2.ID)

	gm.BroadcastGamesList()

	game.Ticker = time.NewTicker(constants.TICK_RATE)
	go gm.gameLoop(game)
}

func (gm *Manager) HandlePlayerMove(player *models.Player, gameID string, directionStr string) {
	gm.Mutex.RLock()
	game, exists := gm.Games[gameID]
	gm.Mutex.RUnlock()

	if !exists || !game.IsActive {
		return
	}

	game.Mutex.RLock()
	isPlayer := game.Player1.ID == player.ID || game.Player2.ID == player.ID
	game.Mutex.RUnlock()

	if !isPlayer {
		sendMessage(player, constants.MSG_ERROR, map[string]any{
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
	for i := range game.State.Snakes {
		if game.State.Snakes[i].ID == player.ID {
			opposites := map[constants.Direction]constants.Direction{
				constants.UP:    constants.DOWN,
				constants.DOWN:  constants.UP,
				constants.LEFT:  constants.RIGHT,
				constants.RIGHT: constants.LEFT,
			}
			if direction != opposites[game.State.Snakes[i].Direction] {
				game.State.Snakes[i].NextDir = direction
			}
			break
		}
	}
	game.Mutex.Unlock()
}

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
			gameState := game.State
			game.Mutex.Unlock()
			gm.endGame(game, winner, gameState)
			return
		}

		stateCopy := game.State
		game.Mutex.Unlock()
		broadcastToPlayers(game, constants.MSG_GAME_UPDATE, stateCopy)
	}
}

func (gm *Manager) checkCollisions(game *models.Game) string {
	for i := range game.State.Snakes {
		head := game.State.Snakes[i].Body[0]
		for j := 1; j < len(game.State.Snakes[i].Body); j++ {
			if head.X == game.State.Snakes[i].Body[j].X && head.Y == game.State.Snakes[i].Body[j].Y {
				if i == 0 {
					return game.State.Snakes[1].ID
				}
				return game.State.Snakes[0].ID
			}
		}
	}

	snake1Head := game.State.Snakes[0].Body[0]
	snake2Head := game.State.Snakes[1].Body[0]

	if snake1Head.X == snake2Head.X && snake1Head.Y == snake2Head.Y {
		if game.State.Snakes[0].Score > game.State.Snakes[1].Score {
			return game.State.Snakes[0].ID
		} else if game.State.Snakes[1].Score > game.State.Snakes[0].Score {
			return game.State.Snakes[1].ID
		}
		return "tie"
	}

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

func (gm *Manager) endGame(game *models.Game, winner string, stateCopy *models.GameState) {
	game.Mutex.Lock()
	game.IsActive = false
	game.State.Status = "finished"
	game.State.Winner = winner
	game.Player1.Ready = false
	game.Player2.Ready = false
	game.Mutex.Unlock()

	broadcastToPlayers(game, constants.MSG_GAME_OVER, stateCopy)
}

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

func broadcastToPlayers(game *models.Game, msgType string, data any) {
	payload := map[string]any{
		"type": msgType,
		"data": data,
	}
	jsonData, _ := json.Marshal(payload)

	select {
	case game.Player1.Send <- jsonData:
	default:
	}

	select {
	case game.Player2.Send <- jsonData:
	default:
	}

	game.Mutex.RLock()
	for _, spectator := range game.Spectators {
		select {
		case spectator.Send <- jsonData:
		default:
		}
	}
	game.Mutex.RUnlock()
}
