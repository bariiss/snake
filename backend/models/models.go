package models

import (
	"sync"
	"time"

	"snake-backend/constants"
)

type Position struct {
	X int `json:"x"`
	Y int `json:"y"`
}

type PlayerStatus struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Ready    bool   `json:"ready"`
}

type Snake struct {
	ID        string              `json:"id"`
	Body      []Position          `json:"body"`
	Direction constants.Direction `json:"direction"`
	NextDir   constants.Direction `json:"-"`
	Color     string              `json:"color"`
	Score     int                 `json:"score"`
	Username  string              `json:"username,omitempty"`
}

type Food struct {
	Position Position `json:"position"`
}

type GameState struct {
	ID        string         `json:"id"`
	Snakes    []Snake        `json:"snakes"`
	Food      Food           `json:"food"`
	Status    string         `json:"status"` // "waiting", "countdown", "playing", "finished"
	Countdown int            `json:"countdown"`
	Winner    string         `json:"winner,omitempty"`
	Players   []PlayerStatus `json:"players,omitempty"`
}

type Player struct {
	ID       string      `json:"id"`
	Send     chan []byte `json:"-"` // Used for WebSocket
	Username string      `json:"username"`
	Ready    bool        `json:"ready"`
	JoinedAt time.Time   `json:"joined_at"`
}

type Game struct {
	ID         string
	Player1    *Player
	Player2    *Player
	State      *GameState
	Ticker     *time.Ticker
	Mutex      sync.RWMutex
	IsActive   bool
	Spectators map[string]*Player
}
