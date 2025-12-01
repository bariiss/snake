package game

import (
	"fmt"
	"time"

	"snake-backend/constants"
	"snake-backend/models"
)

func (gm *Manager) RemovePlayer(playerID string) {
	gm.Lobby.Remove(playerID)

	gm.Mutex.Lock()
	defer gm.Mutex.Unlock()

	for i, p := range gm.MatchQueue {
		if p.ID == playerID {
			gm.MatchQueue = append(gm.MatchQueue[:i], gm.MatchQueue[i+1:]...)
			break
		}
	}

	for gameID, game := range gm.Games {
		game.Mutex.Lock()
		if game.Player1.ID == playerID || game.Player2.ID == playerID {
			isActive := game.IsActive
			var disconnectedPlayer, otherPlayer *models.Player
			if game.Player1.ID == playerID {
				disconnectedPlayer = game.Player1
				otherPlayer = game.Player2
				// Clear disconnected player's Send channel to mark as inactive
				game.Player1.Send = nil
			} else {
				disconnectedPlayer = game.Player2
				otherPlayer = game.Player1
				// Clear disconnected player's Send channel to mark as inactive
				game.Player2.Send = nil
			}
			game.Mutex.Unlock()
			if isActive {
				gm.endGame(game, "disconnect", game.State)
			}
			if otherPlayer != nil && disconnectedPlayer != nil {
				if isActive {
					gm.sendMessage(otherPlayer, constants.MSG_PLAYER_DISCONNECTED, map[string]any{
						"game_id": gameID,
						"player":  disconnectedPlayer.Username,
						"message": disconnectedPlayer.Username + " has left the game",
					})
					// Add other player back to lobby if they still have active connection
					if otherPlayer.Send != nil {
						if _, exists := gm.Lobby.Get(otherPlayer.ID); !exists {
							gm.AddToLobby(otherPlayer)
						}
					}
					// Broadcast updated lobby status (disconnected player will show as "in game" until they reconnect)
					gm.BroadcastLobbyStatus()
				} else {
					gm.sendMessage(otherPlayer, constants.MSG_GAME_REQUEST_CANCEL, map[string]any{
						"from_player": disconnectedPlayer,
						"message":     fmt.Sprintf("%s left the lobby", disconnectedPlayer.Username),
					})
					// Add other player back to lobby if they still have active connection
					if otherPlayer.Send != nil {
						if _, exists := gm.Lobby.Get(otherPlayer.ID); !exists {
							gm.AddToLobby(otherPlayer)
						}
					}
				}
			}
			delete(gm.Games, gameID)
			return
		}
		if _, isSpectator := game.Spectators[playerID]; isSpectator {
			delete(game.Spectators, playerID)
			game.Mutex.Unlock()
			gm.BroadcastGamesList()
			return
		}
		game.Mutex.Unlock()
	}
}

func (gm *Manager) AddSpectator(player *models.Player, gameID string) {
	gm.Mutex.RLock()
	game, exists := gm.Games[gameID]
	gm.Mutex.RUnlock()

	if !exists {
		gm.sendMessage(player, constants.MSG_ERROR, map[string]any{
			"message": "Game not found",
			"code":    "GAME_NOT_FOUND",
		})
		return
	}

	game.Mutex.Lock()
	if game.Player1.ID == player.ID || game.Player2.ID == player.ID {
		game.Mutex.Unlock()
		gm.sendMessage(player, constants.MSG_ERROR, map[string]any{
			"message": "You are already a player in this game",
			"code":    "ALREADY_PLAYER",
		})
		return
	}

	if _, exists := game.Spectators[player.ID]; exists {
		game.Mutex.Unlock()
		return
	}

	game.Spectators[player.ID] = player
	game.Mutex.Unlock()

	game.Mutex.RLock()
	currentState := game.State
	game.Mutex.RUnlock()

	gm.sendMessage(player, constants.MSG_SPECTATOR_UPDATE, map[string]any{
		"game_id": gameID,
		"data":    currentState,
	})

	gm.BroadcastGamesList()
}

func (gm *Manager) HandleRematchRequest(player *models.Player, gameID string) {
	gm.Mutex.RLock()
	game, exists := gm.Games[gameID]
	gm.Mutex.RUnlock()

	if !exists {
		gm.sendMessage(player, constants.MSG_ERROR, map[string]any{
			"message": "Game not found",
			"code":    "GAME_NOT_FOUND",
		})
		return
	}

	game.Mutex.Lock()
	if game.Player1.ID != player.ID && game.Player2.ID != player.ID {
		game.Mutex.Unlock()
		gm.sendMessage(player, constants.MSG_ERROR, map[string]any{
			"message": "Only players can request rematch",
			"code":    "NOT_A_PLAYER",
		})
		return
	}

	var otherPlayer *models.Player
	if game.Player1.ID == player.ID {
		otherPlayer = game.Player2
	} else {
		otherPlayer = game.Player1
	}
	game.Mutex.Unlock()

	// Check if other player is still connected
	if otherPlayer == nil || otherPlayer.Send == nil {
		gm.sendMessage(player, constants.MSG_ERROR, map[string]any{
			"message": "Opponent has left the game. Returning to lobby...",
			"code":    "OPPONENT_DISCONNECTED",
		})
		// Remove player from game and add back to lobby
		delete(gm.Games, gameID)
		if player.Send != nil {
			if _, exists := gm.Lobby.Get(player.ID); !exists {
				gm.AddToLobby(player)
			}
		}
		return
	}

	// Send rematch request to other player
	gm.sendMessage(otherPlayer, constants.MSG_REMATCH_REQUEST, map[string]any{
		"game_id":        gameID,
		"requester_id":   player.ID,
		"requester_name": player.Username,
	})
}

func (gm *Manager) HandleRematchAccept(player *models.Player, gameID string) {
	gm.Mutex.RLock()
	game, exists := gm.Games[gameID]
	gm.Mutex.RUnlock()

	if !exists {
		gm.sendMessage(player, constants.MSG_ERROR, map[string]any{
			"message": "Game not found",
			"code":    "GAME_NOT_FOUND",
		})
		return
	}

	game.Mutex.Lock()
	if game.Player1.ID != player.ID && game.Player2.ID != player.ID {
		game.Mutex.Unlock()
		gm.sendMessage(player, constants.MSG_ERROR, map[string]any{
			"message": "Only players can accept rematch",
			"code":    "NOT_A_PLAYER",
		})
		return
	}
	game.Mutex.Unlock()

	// Notify both players that rematch was accepted
	gm.broadcastToPlayers(game, constants.MSG_REMATCH_ACCEPT, map[string]any{
		"game_id":        gameID,
		"accepted_by":    player.Username,
		"accepted_by_id": player.ID,
	})

	// Start rematch
	go gm.startRematch(gameID)
}

func (gm *Manager) startRematch(gameID string) {
	gm.Mutex.RLock()
	game, exists := gm.Games[gameID]
	gm.Mutex.RUnlock()

	if !exists {
		return
	}

	// Countdown from 5 to 1
	for i := 5; i > 0; i-- {
		gm.broadcastToPlayers(game, constants.MSG_REMATCH_COUNTDOWN, map[string]any{
			"game_id":   gameID,
			"countdown": i,
		})
		time.Sleep(1 * time.Second)
	}

	// Reset game state and start game directly (no additional countdown)
	game.Mutex.Lock()
	game.State.Status = "playing"
	game.State.Countdown = 0
	game.State.Winner = ""
	game.Player1.Ready = false
	game.Player2.Ready = false

	// Reset snakes
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
	game.State.Food = models.Food{Position: gm.generateFood([]models.Snake{snake1, snake2})}
	game.IsActive = true
	game.Mutex.Unlock()

	// Stop existing ticker if any
	if game.Ticker != nil {
		game.Ticker.Stop()
	}

	game.Ticker = time.NewTicker(constants.TICK_RATE)
	go gm.gameLoop(game)

	// Broadcast game start
	gm.broadcastToPlayers(game, constants.MSG_GAME_START, map[string]any{"data": game.State})
}
