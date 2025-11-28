package main

import (
	"log"
	"net/http"
	"os"

	gamepkg "snake-backend/game"
)

func main() {
	gameManager := gamepkg.NewGameManager()

	http.HandleFunc("/ws", gameManager.HandleWebSocket)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Server starting on port %s", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}
