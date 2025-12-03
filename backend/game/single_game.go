package game

import (
	"time"

	"snake-backend/constants"
	"snake-backend/models"

	"github.com/google/uuid"
)

// StartSinglePlayerGame starts a single player game
func (gm *Manager) StartSinglePlayerGame(player *models.Player) {
	gameID := uuid.New().String()

	game := &models.Game{
		ID:             gameID,
		Player1:        player,
		Player2:        nil,
		IsActive:       false,
		IsSinglePlayer: true,
		Spectators:     make(map[string]*models.Player),
	}

	game.State = &models.GameState{
		ID:             gameID,
		Status:         "countdown",
		Countdown:      3,
		IsSinglePlayer: true,
		Players: []models.PlayerStatus{
			{ID: player.ID, Username: player.Username, Ready: true},
		},
	}

	gm.Mutex.Lock()
	gm.Games[gameID] = game
	gm.Mutex.Unlock()

	// Countdown
	for i := 3; i > 0; i-- {
		game.Mutex.Lock()
		game.State.Countdown = i
		game.State.IsSinglePlayer = true
		game.Mutex.Unlock()

		gm.sendMessage(player, constants.MSG_GAME_UPDATE, map[string]any{"data": game.State})
		time.Sleep(1 * time.Second)
	}

	// Start game
	game.Mutex.Lock()
	game.State.Status = "playing"
	game.State.Countdown = 0
	game.State.IsSinglePlayer = true

	snake := models.Snake{
		ID:        player.ID,
		Body:      []models.Position{{X: 20, Y: 15}, {X: 19, Y: 15}, {X: 18, Y: 15}},
		Direction: constants.RIGHT,
		NextDir:   constants.RIGHT,
		Color:     "#4CAF50",
		Score:     0,
		Username:  player.Username,
	}

	game.State.Snakes = []models.Snake{snake}
	game.State.Food = models.Food{Position: gm.generateFood(game.State.Snakes)}
	game.IsActive = true
	game.Mutex.Unlock()

	gm.sendMessage(player, constants.MSG_GAME_START, map[string]any{"data": game.State})

	// Remove from lobby
	gm.RemoveFromLobby(player.ID)

	// Stop existing ticker if any
	if game.Ticker != nil {
		game.Ticker.Stop()
	}

	game.Ticker = time.NewTicker(constants.TICK_RATE)
	go gm.gameLoop(game)
}
