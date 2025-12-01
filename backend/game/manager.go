package game

import (
	"sync"

	"snake-backend/lobby"
	"snake-backend/models"
	webrtcManager "snake-backend/webrtc"
)

type Manager struct {
	Lobby           *lobby.Service
	Games           map[string]*models.Game
	PendingRequests map[string]map[string]*models.Game
	MatchQueue      []*models.Player
	Mutex           sync.RWMutex
	WebRTCManager   *webrtcManager.Manager
}

func (gm *Manager) SetWebRTCManager(webrtcMgr *webrtcManager.Manager) {
	gm.WebRTCManager = webrtcMgr
}

func NewGameManager() *Manager {
	return &Manager{
		Lobby:           lobby.NewService(),
		Games:           make(map[string]*models.Game),
		PendingRequests: make(map[string]map[string]*models.Game),
		MatchQueue:      make([]*models.Player, 0),
	}
}
