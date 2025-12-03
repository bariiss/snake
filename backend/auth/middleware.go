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
			// Extract and validate token
			claims, err := extractAndValidateToken(r, w)
			if err != nil {
				return
			}

			// Verify player exists and is active
			player := gameManager.FindPlayerByID(claims.PlayerID)
			if player == nil {
				http.Error(w, "Unauthorized: Player not found or inactive", http.StatusUnauthorized)
				return
			}
			if player.Send == nil {
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

// extractTokenFromRequest extracts token from Authorization header or query parameter
func extractTokenFromRequest(r *http.Request, w http.ResponseWriter) (string, error) {
	authHeader := r.Header.Get("Authorization")
	if authHeader != "" {
		return authHeader, nil
	}

	// Try to get from query parameter for WebSocket connections
	token := r.URL.Query().Get("token")
	if token == "" {
		http.Error(w, "Unauthorized: Missing token", http.StatusUnauthorized)
		return "", http.ErrBodyReadAfterClose
	}
	return "Bearer " + token, nil
}

// extractAndValidateToken extracts token from request and validates it
// Returns nil claims and error if validation fails (error already sent to client)
func extractAndValidateToken(r *http.Request, w http.ResponseWriter) (*Claims, error) {
	// Extract token from request
	authHeader, err := extractTokenFromRequest(r, w)
	if err != nil {
		return nil, err
	}

	tokenString, err := ExtractTokenFromHeader(authHeader)
	if err != nil {
		http.Error(w, "Unauthorized: Invalid token format", http.StatusUnauthorized)
		return nil, err
	}

	// Validate token
	claims, err := ValidateToken(tokenString)
	if err != nil {
		log.Printf("Token validation error: %v", err)
		http.Error(w, "Unauthorized: Invalid token", http.StatusUnauthorized)
		return nil, err
	}

	return claims, nil
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
	if game.Spectators == nil {
		return false
	}
	_, spectatorExists := game.Spectators[playerID]
	return spectatorExists
}

// GetPlayerFromRequest extracts player from request headers
func GetPlayerFromRequest(r *http.Request, gameManager *game.Manager) *models.Player {
	playerID := r.Header.Get("X-Player-ID")
	if playerID == "" {
		return nil
	}
	return gameManager.FindPlayerByID(playerID)
}
