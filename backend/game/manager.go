package game

import (
	"sync"

	"snake-backend/lobby"
	"snake-backend/models"
	webrtcManager "snake-backend/webrtc"
)

type Manager struct {
	Lobby               *lobby.Service
	Games               map[string]*models.Game
	PendingRequests     map[string]map[string]*models.Game
	MatchQueue          []*models.Player
	Players             map[string]*models.Player // Global player registry
	Mutex               sync.RWMutex
	WebRTCManager       *webrtcManager.Manager
	MultiplayerManager  *MultiplayerGameManager
	SinglePlayerManager *SinglePlayerGameManager
}

func (gm *Manager) SetWebRTCManager(webrtcMgr *webrtcManager.Manager) {
	gm.WebRTCManager = webrtcMgr
}

func NewGameManager() *Manager {
	manager := &Manager{
		Lobby:           lobby.NewService(),
		Games:           make(map[string]*models.Game),
		PendingRequests: make(map[string]map[string]*models.Game),
		MatchQueue:      make([]*models.Player, 0),
		Players:         make(map[string]*models.Player),
	}

	// Initialize game mode managers
	manager.MultiplayerManager = NewMultiplayerGameManager(manager)
	manager.SinglePlayerManager = NewSinglePlayerGameManager(manager)

	return manager
}
