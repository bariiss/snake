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
			} else {
				disconnectedPlayer = game.Player2
				otherPlayer = game.Player1
			}
			game.Mutex.Unlock()
			if isActive {
				gm.endGame(game, "disconnect", game.State)
			}
			if otherPlayer != nil && disconnectedPlayer != nil {
				if isActive {
					sendMessage(otherPlayer, constants.MSG_PLAYER_DISCONNECTED, map[string]any{
						"game_id": gameID,
						"player":  disconnectedPlayer.Username,
						"message": disconnectedPlayer.Username + " has left the game",
					})
				} else {
					sendMessage(otherPlayer, constants.MSG_GAME_REQUEST_CANCEL, map[string]any{
						"from_player": disconnectedPlayer,
						"message":     fmt.Sprintf("%s left the lobby", disconnectedPlayer.Username),
					})
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
		sendMessage(player, constants.MSG_ERROR, map[string]any{
			"message": "Game not found",
			"code":    "GAME_NOT_FOUND",
		})
		return
	}

	game.Mutex.Lock()
	if game.Player1.ID == player.ID || game.Player2.ID == player.ID {
		game.Mutex.Unlock()
		sendMessage(player, constants.MSG_ERROR, map[string]any{
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

	sendMessage(player, constants.MSG_SPECTATOR_UPDATE, map[string]any{
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
		sendMessage(player, constants.MSG_ERROR, map[string]any{
			"message": "Game not found",
			"code":    "GAME_NOT_FOUND",
		})
		return
	}

	game.Mutex.Lock()
	if game.Player1.ID != player.ID && game.Player2.ID != player.ID {
		game.Mutex.Unlock()
		sendMessage(player, constants.MSG_ERROR, map[string]any{
			"message": "Only players can request rematch",
			"code":    "NOT_A_PLAYER",
		})
		return
	}

	if game.Player1.ID == player.ID {
		game.Player1.Ready = true
	} else {
		game.Player2.Ready = true
	}
	bothReady := game.Player1.Ready && game.Player2.Ready
	game.Mutex.Unlock()

	if bothReady {
		go gm.startRematch(gameID)
	} else {
		broadcastToPlayers(game, constants.MSG_REMATCH_REQUEST, map[string]any{
			"game_id":        gameID,
			"requester_id":   player.ID,
			"requester_name": player.Username,
		})
	}
}

func (gm *Manager) startRematch(gameID string) {
	gm.Mutex.RLock()
	game, exists := gm.Games[gameID]
	gm.Mutex.RUnlock()

	if !exists {
		return
	}

	for i := 10; i > 0; i-- {
		broadcastToPlayers(game, constants.MSG_REMATCH_COUNTDOWN, map[string]any{
			"game_id":   gameID,
			"countdown": i,
		})
		time.Sleep(1 * time.Second)
	}

	game.Mutex.Lock()
	game.State.Status = "countdown"
	game.State.Countdown = 3
	game.State.Winner = ""
	game.Player1.Ready = false
	game.Player2.Ready = false
	game.Mutex.Unlock()

	for i := 3; i > 0; i-- {
		game.Mutex.Lock()
		game.State.Countdown = i
		game.Mutex.Unlock()
		broadcastToPlayers(game, constants.MSG_GAME_UPDATE, game.State)
		time.Sleep(1 * time.Second)
	}

	gm.StartGame(gameID)
}
