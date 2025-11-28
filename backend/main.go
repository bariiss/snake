package main

import (
	"log"
	"net/http"
	"os"

	"snake-backend/game"
	"snake-backend/handlers"
)

func main() {
	gameManager := game.NewGameManager()
	wsHandler := handlers.NewWebSocketHandler(gameManager)

	http.Handle("/ws", wsHandler)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Server starting on port %s", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}
