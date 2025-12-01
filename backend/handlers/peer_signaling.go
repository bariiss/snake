package handlers

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"sync"

	"snake-backend/game"
)

// PeerSignalingHandler handles peer-to-peer WebRTC signaling
type PeerSignalingHandler struct {
	gameManager   *game.Manager
	offers        map[string]*PeerOffer     // playerID -> offer
	answers       map[string]*PeerAnswer    // playerID -> answer
	iceCandidates map[string][]ICECandidate // playerID -> candidates
	mutex         sync.RWMutex
}

type PeerOffer struct {
	FromPlayerID string `json:"from_player_id"`
	ToPlayerID   string `json:"to_player_id"`
	Offer        struct {
		Type string `json:"type"`
		SDP  string `json:"sdp"`
	} `json:"offer"`
}

type PeerAnswer struct {
	FromPlayerID string `json:"from_player_id"`
	ToPlayerID   string `json:"to_player_id"`
	Answer       struct {
		Type string `json:"type"`
		SDP  string `json:"sdp"`
	} `json:"answer"`
}

type ICECandidate struct {
	FromPlayerID  string `json:"from_player_id"`
	ToPlayerID    string `json:"to_player_id"`
	Candidate     string `json:"candidate"`
	SDPMLineIndex int    `json:"sdpMLineIndex"`
	SDPMid        string `json:"sdpMid"`
}

func NewPeerSignalingHandler(gameManager *game.Manager) *PeerSignalingHandler {
	return &PeerSignalingHandler{
		gameManager:   gameManager,
		offers:        make(map[string]*PeerOffer),
		answers:       make(map[string]*PeerAnswer),
		iceCandidates: make(map[string][]ICECandidate),
	}
}

// HandlePeerOffer handles WebRTC offer from one client to another
func (h *PeerSignalingHandler) HandlePeerOffer(w http.ResponseWriter, r *http.Request) {
	h.enableCORS(w, r)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Failed to read body", http.StatusBadRequest)
		return
	}

	var offer PeerOffer
	if err := json.Unmarshal(body, &offer); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	log.Printf("Peer offer from %s to %s", offer.FromPlayerID, offer.ToPlayerID)

	// Store offer
	h.mutex.Lock()
	h.offers[offer.ToPlayerID] = &offer
	h.mutex.Unlock()

	// Notify target player about the offer
	h.gameManager.SendPeerOffer(offer.ToPlayerID, &offer)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// HandlePeerAnswer handles WebRTC answer from one client to another
func (h *PeerSignalingHandler) HandlePeerAnswer(w http.ResponseWriter, r *http.Request) {
	h.enableCORS(w, r)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Failed to read body", http.StatusBadRequest)
		return
	}

	var answer PeerAnswer
	if err := json.Unmarshal(body, &answer); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	log.Printf("Peer answer from %s to %s", answer.FromPlayerID, answer.ToPlayerID)

	// Store answer
	h.mutex.Lock()
	h.answers[answer.ToPlayerID] = &answer
	h.mutex.Unlock()

	// Notify target player about the answer
	h.gameManager.SendPeerAnswer(answer.ToPlayerID, &answer)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// HandleICECandidate handles ICE candidate exchange between peers
func (h *PeerSignalingHandler) HandleICECandidate(w http.ResponseWriter, r *http.Request) {
	h.enableCORS(w, r)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Failed to read body", http.StatusBadRequest)
		return
	}

	var candidate ICECandidate
	if err := json.Unmarshal(body, &candidate); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	log.Printf("ICE candidate from %s to %s", candidate.FromPlayerID, candidate.ToPlayerID)

	// Forward ICE candidate to target player
	h.gameManager.SendICECandidate(candidate.ToPlayerID, &candidate)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func (h *PeerSignalingHandler) enableCORS(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
}
