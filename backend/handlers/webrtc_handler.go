package handlers

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/google/uuid"
	"github.com/pion/webrtc/v3"

	"snake-backend/game"
	"snake-backend/models"
	webrtcManager "snake-backend/webrtc"
)

type WebRTCHandler struct {
	gameManager   *game.Manager
	webrtcManager *webrtcManager.Manager
}

func NewWebRTCHandler(gameManager *game.Manager, webrtcManager *webrtcManager.Manager) *WebRTCHandler {
	return &WebRTCHandler{
		gameManager:   gameManager,
		webrtcManager: webrtcManager,
	}
}

// HandleOffer handles WebRTC offer from client
func (h *WebRTCHandler) HandleOffer(w http.ResponseWriter, r *http.Request) {
	// Enable CORS
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

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

	var offerData struct {
		Username string `json:"username"`
		Offer    struct {
			Type string `json:"type"`
			SDP  string `json:"sdp"`
		} `json:"offer"`
	}

	if err := json.Unmarshal(body, &offerData); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	// Validate username
	if offerData.Username == "" {
		http.Error(w, "Username is required", http.StatusBadRequest)
		return
	}

	// Create player and peer connection
	player := &models.Player{
		ID:       uuid.New().String(),
		Username: offerData.Username,
		Send:     make(chan []byte, 256),
	}

	peer, err := h.webrtcManager.CreatePeerConnection(player)
	if err != nil {
		http.Error(w, "Failed to create peer connection: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Set remote description (offer from client)
	offer := webrtc.SessionDescription{
		Type: webrtc.SDPTypeOffer,
		SDP:  offerData.Offer.SDP,
	}

	if err := peer.PeerConnection.SetRemoteDescription(offer); err != nil {
		http.Error(w, "Failed to set remote description", http.StatusInternalServerError)
		return
	}

	// Create answer
	answer, err := peer.PeerConnection.CreateAnswer(nil)
	if err != nil {
		http.Error(w, "Failed to create answer", http.StatusInternalServerError)
		return
	}

	// Set local description
	if err := peer.PeerConnection.SetLocalDescription(answer); err != nil {
		http.Error(w, "Failed to set local description", http.StatusInternalServerError)
		return
	}

	// Return answer to client
	response := map[string]any{
		"player_id": player.ID,
		"answer": map[string]string{
			"type": answer.Type.String(),
			"sdp":  answer.SDP,
		},
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(response); err != nil {
		http.Error(w, "Failed to encode response", http.StatusInternalServerError)
		return
	}

	// Add player to lobby (similar to WebSocket handler)
	h.gameManager.AddToLobby(player)

	// Set up data channel message handler
	peer.DataChannel.OnMessage(func(msg webrtc.DataChannelMessage) {
		var messageData map[string]any
		if err := json.Unmarshal(msg.Data, &messageData); err != nil {
			return
		}

		msgType, ok := messageData["type"].(string)
		if !ok {
			return
		}

		// Handle message through game manager
		h.gameManager.HandleWebRTCMessage(player, msgType, messageData)
	})

	// Send connected message
	h.webrtcManager.SendMessage(player.ID, "connected", map[string]any{
		"player": player,
	})
}
