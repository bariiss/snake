package auth

import (
	"log"
	"net/http"
	"snake-backend/game"
	"snake-backend/models"
)

// AuthMiddleware validates JWT token and adds player info to request context
func AuthMiddleware(gameManager *game.Manager) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Extract token from Authorization header
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				// Try to get from query parameter for WebSocket connections
				token := r.URL.Query().Get("token")
				if token == "" {
					http.Error(w, "Unauthorized: Missing token", http.StatusUnauthorized)
					return
				}
				authHeader = "Bearer " + token
			}

			tokenString, err := ExtractTokenFromHeader(authHeader)
			if err != nil {
				http.Error(w, "Unauthorized: Invalid token format", http.StatusUnauthorized)
				return
			}

			// Validate token
			claims, err := ValidateToken(tokenString)
			if err != nil {
				log.Printf("Token validation error: %v", err)
				http.Error(w, "Unauthorized: Invalid token", http.StatusUnauthorized)
				return
			}

			// Verify player exists and is active
			player := gameManager.FindPlayerByID(claims.PlayerID)
			if player == nil || player.Send == nil {
				http.Error(w, "Unauthorized: Player not found or inactive", http.StatusUnauthorized)
				return
			}

			// Verify username matches
			if player.Username != claims.Username {
				http.Error(w, "Unauthorized: Username mismatch", http.StatusUnauthorized)
				return
			}

			// Add player to request context (we'll use a simple approach with header)
			r.Header.Set("X-Player-ID", claims.PlayerID)
			r.Header.Set("X-Username", claims.Username)

			next.ServeHTTP(w, r)
		})
	}
}

// GameAuthorization checks if player is authorized to access a specific game
func GameAuthorization(gameManager *game.Manager, gameID string, playerID string) bool {
	gameManager.Mutex.RLock()
	defer gameManager.Mutex.RUnlock()

	game, exists := gameManager.Games[gameID]
	if !exists {
		return false
	}

	game.Mutex.RLock()
	defer game.Mutex.RUnlock()

	// Check if player is Player1, Player2, or a spectator
	if game.Player1 != nil && game.Player1.ID == playerID {
		return true
	}
	if game.Player2 != nil && game.Player2.ID == playerID {
		return true
	}
	if game.Spectators != nil {
		if _, exists := game.Spectators[playerID]; exists {
			return true
		}
	}

	return false
}

// GetPlayerFromRequest extracts player from request headers
func GetPlayerFromRequest(r *http.Request, gameManager *game.Manager) *models.Player {
	playerID := r.Header.Get("X-Player-ID")
	if playerID == "" {
		return nil
	}
	return gameManager.FindPlayerByID(playerID)
}
