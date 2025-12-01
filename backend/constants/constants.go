package constants

import "time"

const (
	// Game constants
	GRID_WIDTH  = 40
	GRID_HEIGHT = 30
	TICK_RATE   = 100 * time.Millisecond

	// Message types
	MSG_CONNECTED           = "connected"
	MSG_JOIN_LOBBY          = "join_lobby"
	MSG_LEAVE_LOBBY         = "leave_lobby"
	MSG_GAME_REQUEST        = "game_request"
	MSG_GAME_REQUEST_SENT   = "game_request_sent"
	MSG_GAME_ACCEPT         = "game_accept"
	MSG_GAME_REJECT         = "game_reject"
	MSG_PLAYER_READY        = "player_ready"
	MSG_GAME_START          = "game_start"
	MSG_GAME_UPDATE         = "game_update"
	MSG_PLAYER_MOVE         = "player_move"
	MSG_GAME_OVER           = "game_over"
	MSG_ERROR               = "error"
	MSG_LOBBY_STATUS        = "lobby_status"
	MSG_MATCH_FOUND         = "match_found"
	MSG_LIST_GAMES          = "list_games"
	MSG_GAMES_LIST          = "games_list"
	MSG_JOIN_SPECTATOR      = "join_spectator"
	MSG_SPECTATOR_UPDATE    = "spectator_update"
	MSG_REMATCH_REQUEST     = "rematch_request"
	MSG_REMATCH_ACCEPT      = "rematch_accept"
	MSG_REMATCH_COUNTDOWN   = "rematch_countdown"
	MSG_REMATCH_START       = "rematch_start"
	MSG_PLAYER_DISCONNECTED = "player_disconnected"
	MSG_GAME_REQUEST_CANCEL = "game_request_cancel"
	MSG_PEER_OFFER          = "peer_offer"
	MSG_PEER_ANSWER         = "peer_answer"
	MSG_PEER_ICE_CANDIDATE  = "peer_ice_candidate"
)

type Direction int

const (
	UP Direction = iota
	DOWN
	LEFT
	RIGHT
)
