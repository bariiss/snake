package game

import (
	"snake-backend/constants"
	"snake-backend/models"
)

// HandleWebRTCMessage handles messages from WebRTC DataChannel
func (gm *Manager) HandleWebRTCMessage(player *models.Player, msgType string, msg map[string]any) {
	// Reuse the same message handler
	gm.handleMessage(player, msgType, msg)
}

// HandleWebSocketMessage handles messages from WebSocket
func (gm *Manager) HandleWebSocketMessage(player *models.Player, msgType string, msg map[string]any) {
	// Reuse the same message handler
	gm.handleMessage(player, msgType, msg)
}

// handleMessage processes incoming messages from players
func (gm *Manager) handleMessage(player *models.Player, msgType string, msg map[string]any) {
	switch msgType {
	case constants.MSG_JOIN_LOBBY:
		gm.AddToLobby(player)
	case constants.MSG_LEAVE_LOBBY:
		gm.RemoveFromLobby(player.ID)
	case constants.MSG_GAME_REQUEST:
		if targetID, ok := msg["target_id"].(string); ok {
			gm.SendGameRequest(player, targetID)
		}
	case constants.MSG_GAME_REQUEST_CANCEL:
		if targetID, ok := msg["target_id"].(string); ok {
			gm.CancelGameRequest(player, targetID)
		}
	case constants.MSG_GAME_ACCEPT:
		if gameID, ok := msg["game_id"].(string); ok {
			gm.AcceptGameRequest(player, gameID)
		}
	case constants.MSG_GAME_REJECT:
		if gameID, ok := msg["game_id"].(string); ok {
			gm.RejectGameRequest(player, gameID)
		}
	case constants.MSG_PLAYER_READY:
		gameID, ok := msg["game_id"].(string)
		if !ok {
			break
		}
		// Check if single player or multiplayer
		gm.Mutex.RLock()
		game, exists := gm.Games[gameID]
		gm.Mutex.RUnlock()

		if exists && game.IsSinglePlayer {
			gm.SinglePlayerManager.HandlePlayerReady(player, gameID)
		} else {
			gm.MultiplayerManager.HandlePlayerReady(player, gameID)
		}
	case constants.MSG_PLAYER_MOVE:
		gameID, ok := msg["game_id"].(string)
		if !ok {
			break
		}
		direction, ok := msg["direction"].(string)
		if !ok {
			break
		}
		// Check if single player or multiplayer
		gm.Mutex.RLock()
		game, exists := gm.Games[gameID]
		gm.Mutex.RUnlock()

		if exists && game.IsSinglePlayer {
			gm.SinglePlayerManager.HandlePlayerMove(player, gameID, direction)
		} else {
			gm.MultiplayerManager.HandlePlayerMove(player, gameID, direction)
		}
	case constants.MSG_LIST_GAMES:
		gm.SendGamesList(player)
	case constants.MSG_JOIN_SPECTATOR:
		if gameID, ok := msg["game_id"].(string); ok {
			gm.AddSpectator(player, gameID)
		}
	case constants.MSG_REMATCH_REQUEST:
		if gameID, ok := msg["game_id"].(string); ok {
			// Rematch is only for multiplayer games
			gm.MultiplayerManager.HandleRematchRequest(player, gameID)
		}
	case constants.MSG_REMATCH_ACCEPT:
		if gameID, ok := msg["game_id"].(string); ok {
			// Rematch is only for multiplayer games
			gm.MultiplayerManager.HandleRematchAccept(player, gameID)
		}
	case constants.MSG_START_SINGLE_PLAYER:
		gm.StartSinglePlayerGame(player)
	case constants.MSG_GET_GAME_STATE:
		if gameID, ok := msg["game_id"].(string); ok {
			gm.SendGameState(player, gameID)
		}
	case constants.MSG_LEAVE_GAME:
		if gameID, ok := msg["game_id"].(string); ok {
			gm.LeaveGame(player, gameID)
		}
	}
}
