package handlers

import (
	"net/http"

	"snake-backend/game"
)

type WebSocketHandler struct {
	manager *game.Manager
}

func NewWebSocketHandler(manager *game.Manager) *WebSocketHandler {
	return &WebSocketHandler{manager: manager}
}

func (h *WebSocketHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h.manager.HandleWebSocket(w, r)
}
