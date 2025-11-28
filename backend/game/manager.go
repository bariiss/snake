package game

import (
	"sync"

	"snake-backend/lobby"
	"snake-backend/models"
)

type Manager struct {
	Lobby           *lobby.Service
	Games           map[string]*models.Game
	PendingRequests map[string]map[string]*models.Game
	MatchQueue      []*models.Player
	Mutex           sync.RWMutex
}

func NewGameManager() *Manager {
	return &Manager{
		Lobby:           lobby.NewService(),
		Games:           make(map[string]*models.Game),
		PendingRequests: make(map[string]map[string]*models.Game),
		MatchQueue:      make([]*models.Player, 0),
	}
}
