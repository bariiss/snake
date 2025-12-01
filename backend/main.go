package main

import (
	"log"
	"net/http"
	"os"

	"snake-backend/game"
	"snake-backend/handlers"
	"snake-backend/webrtc"
)

func main() {
	gameManager := game.NewGameManager()
	webrtcManager := webrtc.NewManager()
	gameManager.SetWebRTCManager(webrtcManager)

	wsHandler := handlers.NewWebSocketHandler(gameManager)
	peerSignalingHandler := handlers.NewPeerSignalingHandler(gameManager)

	// WebSocket (for lobby, matchmaking)
	http.Handle("/ws", wsHandler)

	// Peer-to-peer signaling
	http.HandleFunc("/webrtc/peer/offer", peerSignalingHandler.HandlePeerOffer)
	http.HandleFunc("/webrtc/peer/answer", peerSignalingHandler.HandlePeerAnswer)
	http.HandleFunc("/webrtc/peer/ice", peerSignalingHandler.HandleICECandidate)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Server starting on port %s", port)
	log.Printf("WebSocket endpoint: /ws")
	log.Printf("Peer signaling endpoints: /webrtc/peer/offer, /webrtc/peer/answer, /webrtc/peer/ice")
	log.Fatal(http.ListenAndServe(":"+port, nil))
}
