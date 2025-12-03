package webrtc

import (
	"encoding/json"
	"log"
	"sync"

	"snake-backend/models"

	"github.com/pion/webrtc/v3"
)

type PeerConnection struct {
	PeerConnection *webrtc.PeerConnection
	DataChannel    *webrtc.DataChannel
	Player         *models.Player
	Mutex          sync.RWMutex
}

type Manager struct {
	peers map[string]*PeerConnection
	mutex sync.RWMutex
}

func NewManager() *Manager {
	return &Manager{
		peers: make(map[string]*PeerConnection),
	}
}

func (m *Manager) CreatePeerConnection(player *models.Player) (*PeerConnection, error) {
	config := m.getICEConfiguration()

	peerConnection, err := webrtc.NewPeerConnection(config)
	if err != nil {
		return nil, err
	}

	// Handle ICE candidates
	peerConnection.OnICECandidate(func(candidate *webrtc.ICECandidate) {
		if candidate != nil {
			log.Printf("ICE Candidate for %s: %s", player.Username, candidate.String())
		} else {
			log.Printf("ICE Candidate gathering completed for %s", player.Username)
		}
	})

	// Handle ICE connection state
	peerConnection.OnICEConnectionStateChange(func(state webrtc.ICEConnectionState) {
		log.Printf("ICE Connection State for %s: %s", player.Username, state.String())
		if state == webrtc.ICEConnectionStateDisconnected || state == webrtc.ICEConnectionStateFailed {
			log.Printf("ICE Connection failed for %s, removing peer", player.Username)
			m.RemovePeer(player.ID)
		}
	})

	// Handle ICE gathering state
	peerConnection.OnICEGatheringStateChange(func(state webrtc.ICEGathererState) {
		log.Printf("ICE Gathering State for %s: %s", player.Username, state.String())
	})

	// Create data channel
	dataChannel, err := peerConnection.CreateDataChannel("game", nil)
	if err != nil {
		peerConnection.Close()
		return nil, err
	}

	peer := &PeerConnection{
		PeerConnection: peerConnection,
		DataChannel:    dataChannel,
		Player:         player,
	}

	// Set up data channel handlers
	dataChannel.OnOpen(func() {
		log.Printf("DataChannel opened for player %s", player.Username)
	})

	dataChannel.OnMessage(func(msg webrtc.DataChannelMessage) {
		// Messages will be handled by the game manager
		// This is just for logging
		log.Printf("Received message from %s", player.Username)
	})

	dataChannel.OnClose(func() {
		log.Printf("DataChannel closed for player %s", player.Username)
		m.RemovePeer(player.ID)
	})

	dataChannel.OnError(func(err error) {
		log.Printf("DataChannel error for %s: %v", player.Username, err)
	})

	m.mutex.Lock()
	m.peers[player.ID] = peer
	m.mutex.Unlock()

	return peer, nil
}

func (m *Manager) GetPeer(playerID string) (*PeerConnection, bool) {
	m.mutex.RLock()
	defer m.mutex.RUnlock()
	peer, exists := m.peers[playerID]
	return peer, exists
}

func (m *Manager) RemovePeer(playerID string) {
	m.mutex.Lock()
	defer m.mutex.Unlock()
	if peer, exists := m.peers[playerID]; exists {
		if peer.PeerConnection != nil {
			peer.PeerConnection.Close()
		}
		delete(m.peers, playerID)
	}
}

func (m *Manager) SendMessage(playerID string, messageType string, data any) error {
	peer, exists := m.GetPeer(playerID)
	if !exists || peer.DataChannel == nil {
		return nil // Peer not found or channel not ready
	}

	if peer.DataChannel.ReadyState() != webrtc.DataChannelStateOpen {
		return nil // Channel not open
	}

	payload := map[string]any{
		"type": messageType,
		"data": data,
	}

	jsonData, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	return peer.DataChannel.Send(jsonData)
}

func (m *Manager) BroadcastToGame(player1ID, player2ID string, messageType string, data any) {
	m.SendMessage(player1ID, messageType, data)
	m.SendMessage(player2ID, messageType, data)
}

// getICEConfiguration returns the ICE server configuration with STUN and TURN servers
func (m *Manager) getICEConfiguration() webrtc.Configuration {
	return webrtc.Configuration{
		ICEServers: []webrtc.ICEServer{
			// STUN server
			{
				URLs: []string{"stun:turn.li1.nl:3478"},
			},
			// TURN server (non-TLS) - turn.li1.nl:3478 with UDP and TCP transports
			{
				URLs: []string{
					"turn:turn.li1.nl:3478?transport=udp",
					"turn:turn.li1.nl:3478?transport=tcp",
				},
				Username:   "peaceast",
				Credential: "endoplazmikretikulum",
			},
		},
		ICETransportPolicy: webrtc.ICETransportPolicyAll,
	}
}
