package lobby

import (
	"sync"

	"snake-backend/models"
)

type Service struct {
	mu      sync.RWMutex
	players map[string]*models.Player
	order   []string
}

func NewService() *Service {
	return &Service{
		players: make(map[string]*models.Player),
		order:   make([]string, 0),
	}
}

func (s *Service) Add(player *models.Player) bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, exists := s.players[player.ID]; exists {
		return false
	}

	s.players[player.ID] = player
	s.order = append(s.order, player.ID)
	return true
}

func (s *Service) Remove(playerID string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	delete(s.players, playerID)
	for i, id := range s.order {
		if id == playerID {
			s.order = append(s.order[:i], s.order[i+1:]...)
			break
		}
	}
}

func (s *Service) Get(playerID string) (*models.Player, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	player, exists := s.players[playerID]
	return player, exists
}

func (s *Service) ExistsByUsername(username string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, p := range s.players {
		if p.Username == username {
			return true
		}
	}
	return false
}

func (s *Service) Snapshot() []*models.Player {
	s.mu.RLock()
	defer s.mu.RUnlock()

	result := make([]*models.Player, 0, len(s.order))
	for _, id := range s.order {
		if player, exists := s.players[id]; exists {
			result = append(result, player)
		}
	}
	return result
}

func (s *Service) Len() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.players)
}
