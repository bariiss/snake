package game

import (
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins for development
	},
}

const (
	// Game constants
	GRID_WIDTH  = 40
	GRID_HEIGHT = 30
	TICK_RATE   = 100 * time.Millisecond

	// Message types
	MSG_CONNECTED           = "connected"
	MSG_JOIN_LOBBY          = "join_lobby"
	MSG_LEAVE_LOBBY         = "leave_lobby"
	MSG_GAME_REQUEST        = "game_request"
	MSG_GAME_REQUEST_SENT   = "game_request_sent"
	MSG_GAME_ACCEPT         = "game_accept"
	MSG_GAME_REJECT         = "game_reject"
	MSG_PLAYER_READY        = "player_ready"
	MSG_GAME_START          = "game_start"
	MSG_GAME_UPDATE         = "game_update"
	MSG_PLAYER_MOVE         = "player_move"
	MSG_GAME_OVER           = "game_over"
	MSG_ERROR               = "error"
	MSG_LOBBY_STATUS        = "lobby_status"
	MSG_MATCH_FOUND         = "match_found"
	MSG_LIST_GAMES          = "list_games"
	MSG_GAMES_LIST          = "games_list"
	MSG_JOIN_SPECTATOR      = "join_spectator"
	MSG_SPECTATOR_UPDATE    = "spectator_update"
	MSG_REMATCH_REQUEST     = "rematch_request"
	MSG_REMATCH_COUNTDOWN   = "rematch_countdown"
	MSG_REMATCH_START       = "rematch_start"
	MSG_PLAYER_DISCONNECTED = "player_disconnected"
	MSG_GAME_REQUEST_CANCEL = "game_request_cancel"
)

type Direction int

const (
	UP Direction = iota
	DOWN
	LEFT
	RIGHT
)

type Position struct {
	X int `json:"x"`
	Y int `json:"y"`
}

type PlayerStatus struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Ready    bool   `json:"ready"`
}

type Snake struct {
	ID        string     `json:"id"`
	Body      []Position `json:"body"`
	Direction Direction  `json:"direction"`
	NextDir   Direction  `json:"-"`
	Color     string     `json:"color"`
	Score     int        `json:"score"`
	Username  string     `json:"username,omitempty"`
}

type Food struct {
	Position Position `json:"position"`
}

type GameState struct {
	ID        string         `json:"id"`
	Snakes    []Snake        `json:"snakes"`
	Food      Food           `json:"food"`
	Status    string         `json:"status"` // "waiting", "countdown", "playing", "finished"
	Countdown int            `json:"countdown"`
	Winner    string         `json:"winner,omitempty"`
	Players   []PlayerStatus `json:"players,omitempty"`
}

type Player struct {
	ID       string          `json:"id"`
	Conn     *websocket.Conn `json:"-"`
	Send     chan []byte     `json:"-"`
	Username string          `json:"username"`
	Ready    bool            `json:"ready"`
}

type Game struct {
	ID         string
	Player1    *Player
	Player2    *Player
	State      *GameState
	Ticker     *time.Ticker
	Mutex      sync.RWMutex
	IsActive   bool
	Spectators map[string]*Player
}

type GameManager struct {
	Lobby           map[string]*Player
	LobbyOrder      []string // Maintain insertion order for lobby
	Games           map[string]*Game
	PendingRequests map[string]map[string]*Game // targetID -> fromID -> Game
	Mutex           sync.RWMutex
	MatchQueue      []*Player
}

func NewGameManager() *GameManager {
	return &GameManager{
		Lobby:           make(map[string]*Player),
		LobbyOrder:      make([]string, 0),
		Games:           make(map[string]*Game),
		PendingRequests: make(map[string]map[string]*Game),
		MatchQueue:      make([]*Player, 0),
	}
}

func (gm *GameManager) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}

	player := &Player{
		ID:       uuid.New().String(),
		Conn:     conn,
		Send:     make(chan []byte, 256),
		Username: r.URL.Query().Get("username"),
		Ready:    false,
	}

	if player.Username == "" {
		player.Username = "Player_" + player.ID[:8]
	}

	// Check if username already exists in lobby or active games
	gm.Mutex.RLock()
	usernameExists := false
	// Check in lobby
	for _, p := range gm.Lobby {
		if p.Username == player.Username {
			usernameExists = true
			break
		}
	}
	// Check in active games (players and spectators)
	if !usernameExists {
		for _, game := range gm.Games {
			if game.Player1.Username == player.Username || game.Player2.Username == player.Username {
				usernameExists = true
				break
			}
			game.Mutex.RLock()
			for _, spec := range game.Spectators {
				if spec.Username == player.Username {
					usernameExists = true
					game.Mutex.RUnlock()
					break
				}
			}
			if !usernameExists {
				game.Mutex.RUnlock()
			}
			if usernameExists {
				break
			}
		}
	}
	gm.Mutex.RUnlock()

	if usernameExists {
		player.SendMessage(MSG_ERROR, map[string]interface{}{
			"message": "Username already taken. Please choose a different username.",
			"code":    "USERNAME_EXISTS",
		})
		conn.Close()
		return
	}

	go player.writePump()
	go player.readPump(gm)

	// Send connected message with player info
	// Channel has buffer, so this should be safe
	player.SendMessage(MSG_CONNECTED, map[string]interface{}{
		"player": player,
	})

	// Automatically add player to lobby after connection
	gm.AddToLobby(player)
}

func (p *Player) readPump(gm *GameManager) {
	defer func() {
		gm.RemovePlayer(p.ID)
		p.Conn.Close()
	}()

	p.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	p.Conn.SetPongHandler(func(string) error {
		p.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		_, message, err := p.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket error: %v", err)
			}
			break
		}

		var msg map[string]interface{}
		if err := json.Unmarshal(message, &msg); err != nil {
			log.Printf("Error unmarshaling message: %v", err)
			continue
		}

		msgType, ok := msg["type"].(string)
		if !ok {
			continue
		}

		gm.HandleMessage(p, msgType, msg)
	}
}

func (p *Player) writePump() {
	ticker := time.NewTicker(54 * time.Second)
	defer func() {
		ticker.Stop()
		p.Conn.Close()
	}()

	for {
		select {
		case message, ok := <-p.Send:
			p.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				p.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := p.Conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)

			n := len(p.Send)
			for i := 0; i < n; i++ {
				w.Write([]byte{'\n'})
				w.Write(<-p.Send)
			}

			if err := w.Close(); err != nil {
				return
			}
		case <-ticker.C:
			p.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := p.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (gm *GameManager) HandleMessage(player *Player, msgType string, msg map[string]interface{}) {
	switch msgType {
	case MSG_JOIN_LOBBY:
		log.Printf("Player %s (%s) joining lobby", player.ID, player.Username)
		gm.AddToLobby(player)
	case MSG_LEAVE_LOBBY:
		gm.RemoveFromLobby(player.ID)
	case MSG_GAME_REQUEST:
		if targetID, ok := msg["target_id"].(string); ok {
			gm.SendGameRequest(player, targetID)
		}
	case MSG_GAME_REQUEST_CANCEL:
		if targetID, ok := msg["target_id"].(string); ok {
			gm.CancelGameRequest(player, targetID)
		}
	case MSG_GAME_ACCEPT:
		if gameID, ok := msg["game_id"].(string); ok {
			gm.AcceptGameRequest(player, gameID)
		}
	case MSG_GAME_REJECT:
		if gameID, ok := msg["game_id"].(string); ok {
			gm.RejectGameRequest(player, gameID)
		}
	case MSG_PLAYER_READY:
		if gameID, ok := msg["game_id"].(string); ok {
			gm.PlayerReady(player, gameID)
		}
	case MSG_PLAYER_MOVE:
		if gameID, ok := msg["game_id"].(string); ok {
			if direction, ok := msg["direction"].(string); ok {
				gm.HandlePlayerMove(player, gameID, direction)
			}
		}
	case MSG_LIST_GAMES:
		gm.SendGamesList(player)
	case MSG_JOIN_SPECTATOR:
		if gameID, ok := msg["game_id"].(string); ok {
			gm.AddSpectator(player, gameID)
		}
	case MSG_REMATCH_REQUEST:
		if gameID, ok := msg["game_id"].(string); ok {
			gm.HandleRematchRequest(player, gameID)
		}
	}
}

func (gm *GameManager) AddToLobby(player *Player) {
	gm.Mutex.Lock()
	// Check if player is already in lobby
	if _, exists := gm.Lobby[player.ID]; exists {
		gm.Mutex.Unlock()
		log.Printf("Player %s (%s) already in lobby", player.ID, player.Username)
		return
	}
	gm.Lobby[player.ID] = player
	// Add to order list (maintain insertion order)
	gm.LobbyOrder = append(gm.LobbyOrder, player.ID)
	gm.Mutex.Unlock()

	log.Printf("Player %s (%s) added to lobby, total players: %d", player.ID, player.Username, len(gm.Lobby))

	gm.BroadcastLobbyStatus()
	// Send games list when joining lobby
	gm.SendGamesList(player)
}

func (gm *GameManager) RemoveFromLobby(playerID string) {
	gm.Mutex.Lock()
	delete(gm.Lobby, playerID)
	// Remove from order list
	for i, id := range gm.LobbyOrder {
		if id == playerID {
			gm.LobbyOrder = append(gm.LobbyOrder[:i], gm.LobbyOrder[i+1:]...)
			break
		}
	}
	gm.Mutex.Unlock()

	gm.BroadcastLobbyStatus()
}

func (gm *GameManager) RemovePlayer(playerID string) {
	gm.Mutex.Lock()
	delete(gm.Lobby, playerID)
	// Remove from order list
	for i, id := range gm.LobbyOrder {
		if id == playerID {
			gm.LobbyOrder = append(gm.LobbyOrder[:i], gm.LobbyOrder[i+1:]...)
			break
		}
	}

	// Remove from match queue
	for i, p := range gm.MatchQueue {
		if p.ID == playerID {
			gm.MatchQueue = append(gm.MatchQueue[:i], gm.MatchQueue[i+1:]...)
			break
		}
	}

	// Handle game cleanup
	for gameID, game := range gm.Games {
		game.Mutex.Lock()
		// Check if player is in this game
		if game.Player1.ID == playerID || game.Player2.ID == playerID {
			isActive := game.IsActive
			var disconnectedPlayer, otherPlayer *Player
			if game.Player1.ID == playerID {
				disconnectedPlayer = game.Player1
				otherPlayer = game.Player2
			} else {
				disconnectedPlayer = game.Player2
				otherPlayer = game.Player1
			}
			game.Mutex.Unlock()
			if isActive {
				game.EndGame("disconnect")
			}
			// Notify other player about disconnection
			if otherPlayer != nil && disconnectedPlayer != nil {
				otherPlayer.SendMessage(MSG_PLAYER_DISCONNECTED, map[string]interface{}{
					"game_id": gameID,
					"player":  disconnectedPlayer.Username,
					"message": fmt.Sprintf("%s has left the game", disconnectedPlayer.Username),
				})
			}
			gm.Mutex.Unlock()
			gm.Mutex.Lock()
			delete(gm.Games, gameID)
			gm.Mutex.Unlock()
			return
		}
		// Check if player is a spectator
		if _, isSpectator := game.Spectators[playerID]; isSpectator {
			delete(game.Spectators, playerID)
			game.Mutex.Unlock()
			gm.Mutex.Unlock()
			// Broadcast updated spectator count
			gm.BroadcastGamesList()
			return
		}
		game.Mutex.Unlock()
	}
	gm.Mutex.Unlock()
}

func (gm *GameManager) BroadcastLobbyStatus() {
	gm.Mutex.RLock()
	// Create ordered list - maintain insertion order (first come first serve)
	players := make([]*Player, 0, len(gm.LobbyOrder))
	for _, playerID := range gm.LobbyOrder {
		if player, exists := gm.Lobby[playerID]; exists {
			players = append(players, player)
		}
	}
	gm.Mutex.RUnlock()

	log.Printf("Broadcasting lobby status to %d players", len(players))

	lobbyData := map[string]interface{}{
		"type":    MSG_LOBBY_STATUS,
		"players": players,
	}

	data, _ := json.Marshal(lobbyData)

	for _, p := range players {
		select {
		case p.Send <- data:
			log.Printf("Sent lobby status to player %s (%s)", p.ID, p.Username)
		default:
			log.Printf("Failed to send lobby status to player %s (%s) - channel full", p.ID, p.Username)
			close(p.Send)
		}
	}
}

func (gm *GameManager) SendGameRequest(from *Player, toID string) {
	gm.Mutex.RLock()
	target, exists := gm.Lobby[toID]
	gm.Mutex.RUnlock()

	if !exists {
		from.SendMessage(MSG_ERROR, map[string]interface{}{
			"message": "Player not found in lobby",
		})
		return
	}

	gameID := uuid.New().String()
	game := &Game{
		ID:         gameID,
		Player1:    from,
		Player2:    target,
		IsActive:   false,
		Spectators: make(map[string]*Player),
	}
	game.State = &GameState{
		ID:     gameID,
		Status: "waiting",
		Players: []PlayerStatus{
			{ID: from.ID, Username: from.Username, Ready: false},
			{ID: target.ID, Username: target.Username, Ready: false},
		},
	}

	gm.Mutex.Lock()
	// Check if there's already a pending request from this player to target
	if targetRequests, exists := gm.PendingRequests[toID]; exists {
		if _, alreadyRequested := targetRequests[from.ID]; alreadyRequested {
			gm.Mutex.Unlock()
			from.SendMessage(MSG_ERROR, map[string]interface{}{
				"message": "You already sent a request to this player",
			})
			return
		}
	}

	gm.Games[gameID] = game

	// Add to pending requests
	if gm.PendingRequests[toID] == nil {
		gm.PendingRequests[toID] = make(map[string]*Game)
	}
	gm.PendingRequests[toID][from.ID] = game
	gm.Mutex.Unlock()

	// Notify target player about the game request
	target.SendMessage(MSG_MATCH_FOUND, map[string]interface{}{
		"game_id":     gameID,
		"from_player": from,
	})

	// Notify sender that request was sent
	from.SendMessage(MSG_GAME_REQUEST_SENT, map[string]interface{}{
		"game_id":   gameID,
		"to_player": target,
		"status":    "pending",
	})
}

func (gm *GameManager) CancelGameRequest(from *Player, toID string) {
	gm.Mutex.Lock()
	defer gm.Mutex.Unlock()

	// Check if there's a pending request
	if targetRequests, exists := gm.PendingRequests[toID]; exists {
		if game, hasRequest := targetRequests[from.ID]; hasRequest {
			// Remove from pending requests
			delete(targetRequests, from.ID)
			if len(targetRequests) == 0 {
				delete(gm.PendingRequests, toID)
			}

			// Remove game
			delete(gm.Games, game.ID)

			// Notify target that request was cancelled
			if target, exists := gm.Lobby[toID]; exists {
				target.SendMessage(MSG_GAME_REQUEST_CANCEL, map[string]interface{}{
					"from_player": from,
					"message":     fmt.Sprintf("%s cancelled the game request", from.Username),
				})
			}

			// Notify sender
			from.SendMessage(MSG_GAME_REQUEST_CANCEL, map[string]interface{}{
				"to_player": toID,
				"status":    "cancelled",
			})
		}
	}
}

func (gm *GameManager) AcceptGameRequest(player *Player, gameID string) {
	gm.Mutex.RLock()
	game, exists := gm.Games[gameID]
	gm.Mutex.RUnlock()

	if !exists {
		player.SendMessage(MSG_ERROR, map[string]interface{}{
			"message": "Game not found",
		})
		return
	}

	if game.Player2.ID != player.ID {
		player.SendMessage(MSG_ERROR, map[string]interface{}{
			"message": "You are not the target player",
		})
		return
	}

	// Remove from pending requests
	gm.Mutex.Lock()
	if targetRequests, exists := gm.PendingRequests[player.ID]; exists {
		delete(targetRequests, game.Player1.ID)
		if len(targetRequests) == 0 {
			delete(gm.PendingRequests, player.ID)
		}
	}
	// Also remove any other pending requests from this player to others
	for targetID, requests := range gm.PendingRequests {
		if targetID != player.ID {
			delete(requests, player.ID)
			if len(requests) == 0 {
				delete(gm.PendingRequests, targetID)
			}
		}
	}
	gm.Mutex.Unlock()

	// Send game accept with initial game state
	game.Mutex.RLock()
	gameState := game.State
	game.Mutex.RUnlock()

	game.Player1.SendMessage(MSG_GAME_ACCEPT, map[string]interface{}{
		"game_id": gameID,
		"data":    gameState,
	})
	game.Player2.SendMessage(MSG_GAME_ACCEPT, map[string]interface{}{
		"game_id": gameID,
		"data":    gameState,
	})

	// Broadcast updated games list
	gm.BroadcastGamesList()
}

func (gm *GameManager) RejectGameRequest(player *Player, gameID string) {
	gm.Mutex.Lock()
	game, exists := gm.Games[gameID]
	if !exists {
		gm.Mutex.Unlock()
		return
	}

	if game.Player2.ID == player.ID {
		// Remove from pending requests
		if targetRequests, exists := gm.PendingRequests[player.ID]; exists {
			delete(targetRequests, game.Player1.ID)
			if len(targetRequests) == 0 {
				delete(gm.PendingRequests, player.ID)
			}
		}
		delete(gm.Games, gameID)
		gm.Mutex.Unlock()

		// Notify Player1 that request was rejected
		game.Player1.SendMessage(MSG_GAME_REJECT, map[string]interface{}{
			"game_id": gameID,
		})
	} else {
		gm.Mutex.Unlock()
	}
}

func (gm *GameManager) PlayerReady(player *Player, gameID string) {
	gm.Mutex.RLock()
	game, exists := gm.Games[gameID]
	gm.Mutex.RUnlock()

	if !exists {
		return
	}

	game.Mutex.Lock()
	if game.Player1.ID == player.ID {
		game.Player1.Ready = true
	} else if game.Player2.ID == player.ID {
		game.Player2.Ready = true
	}

	// Update game state with player status
	game.State.Players = []PlayerStatus{
		{ID: game.Player1.ID, Username: game.Player1.Username, Ready: game.Player1.Ready},
		{ID: game.Player2.ID, Username: game.Player2.Username, Ready: game.Player2.Ready},
	}

	bothReady := game.Player1.Ready && game.Player2.Ready
	gameState := game.State
	game.Mutex.Unlock()

	// Broadcast updated state to both players
	game.BroadcastToPlayers(MSG_GAME_UPDATE, gameState)

	if bothReady {
		go gm.StartGame(gameID)
	}
}

func (gm *GameManager) StartGame(gameID string) {
	gm.Mutex.RLock()
	game, exists := gm.Games[gameID]
	gm.Mutex.RUnlock()

	if !exists {
		return
	}

	game.Mutex.Lock()
	game.State.Status = "countdown"
	game.State.Countdown = 3
	game.Mutex.Unlock()

	// Countdown
	for i := 3; i > 0; i-- {
		game.Mutex.Lock()
		game.State.Countdown = i
		game.Mutex.Unlock()

		game.BroadcastToPlayers(MSG_GAME_UPDATE, game.State)
		time.Sleep(1 * time.Second)
	}

	// Initialize game
	game.Mutex.Lock()
	game.State.Status = "playing"
	game.State.Countdown = 0

	// Initialize snakes
	snake1 := Snake{
		ID:        game.Player1.ID,
		Body:      []Position{{X: 5, Y: 15}, {X: 4, Y: 15}, {X: 3, Y: 15}},
		Direction: RIGHT,
		NextDir:   RIGHT,
		Color:     "#FF0000",
		Score:     0,
		Username:  game.Player1.Username,
	}

	snake2 := Snake{
		ID:        game.Player2.ID,
		Body:      []Position{{X: 35, Y: 15}, {X: 36, Y: 15}, {X: 37, Y: 15}},
		Direction: LEFT,
		NextDir:   LEFT,
		Color:     "#0000FF",
		Score:     0,
		Username:  game.Player2.Username,
	}

	game.State.Snakes = []Snake{snake1, snake2}
	game.State.Food = Food{Position: gm.generateFood(game.State.Snakes)}
	game.IsActive = true
	game.Mutex.Unlock()

	game.BroadcastToPlayers(MSG_GAME_START, game.State)

	// Broadcast updated games list (game started)
	gm.BroadcastGamesList()

	// Start game loop
	game.Ticker = time.NewTicker(TICK_RATE)
	go game.GameLoop(gm)
}

func (gm *GameManager) HandlePlayerMove(player *Player, gameID string, directionStr string) {
	gm.Mutex.RLock()
	game, exists := gm.Games[gameID]
	gm.Mutex.RUnlock()

	if !exists || !game.IsActive {
		return
	}

	// Security: Only players can move, not spectators
	game.Mutex.RLock()
	isPlayer := game.Player1.ID == player.ID || game.Player2.ID == player.ID
	game.Mutex.RUnlock()

	if !isPlayer {
		player.SendMessage(MSG_ERROR, map[string]interface{}{
			"message": "Only players can move. Spectators can only watch.",
			"code":    "NOT_A_PLAYER",
		})
		return
	}

	var direction Direction
	switch directionStr {
	case "up":
		direction = UP
	case "down":
		direction = DOWN
	case "left":
		direction = LEFT
	case "right":
		direction = RIGHT
	default:
		return
	}

	game.Mutex.Lock()
	for i := range game.State.Snakes {
		if game.State.Snakes[i].ID == player.ID {
			// Prevent reversing into itself
			opposite := map[Direction]Direction{
				UP:    DOWN,
				DOWN:  UP,
				LEFT:  RIGHT,
				RIGHT: LEFT,
			}
			if direction != opposite[game.State.Snakes[i].Direction] {
				game.State.Snakes[i].NextDir = direction
			}
			break
		}
	}
	game.Mutex.Unlock()
}

func (game *Game) GameLoop(gm *GameManager) {
	defer game.Ticker.Stop()

	for range game.Ticker.C {
		game.Mutex.Lock()
		if !game.IsActive {
			game.Mutex.Unlock()
			return
		}

		// Update snake directions
		for i := range game.State.Snakes {
			game.State.Snakes[i].Direction = game.State.Snakes[i].NextDir
		}

		// Move snakes
		for i := range game.State.Snakes {
			head := game.State.Snakes[i].Body[0]
			var newHead Position

			switch game.State.Snakes[i].Direction {
			case UP:
				newHead = Position{X: head.X, Y: head.Y - 1}
			case DOWN:
				newHead = Position{X: head.X, Y: head.Y + 1}
			case LEFT:
				newHead = Position{X: head.X - 1, Y: head.Y}
			case RIGHT:
				newHead = Position{X: head.X + 1, Y: head.Y}
			}

			// Wrap around
			if newHead.X < 0 {
				newHead.X = GRID_WIDTH - 1
			} else if newHead.X >= GRID_WIDTH {
				newHead.X = 0
			}
			if newHead.Y < 0 {
				newHead.Y = GRID_HEIGHT - 1
			} else if newHead.Y >= GRID_HEIGHT {
				newHead.Y = 0
			}

			game.State.Snakes[i].Body = append([]Position{newHead}, game.State.Snakes[i].Body...)

			// Check food collision
			if newHead.X == game.State.Food.Position.X && newHead.Y == game.State.Food.Position.Y {
				game.State.Snakes[i].Score++
				game.State.Food = Food{Position: gm.generateFood(game.State.Snakes)}
			} else {
				game.State.Snakes[i].Body = game.State.Snakes[i].Body[:len(game.State.Snakes[i].Body)-1]
			}
		}

		// Check collisions
		winner := game.CheckCollisions()
		if winner != "" {
			gameState := game.State
			game.Mutex.Unlock()
			game.EndGame(winner)
			// Broadcast final state one more time to ensure both players see it
			game.BroadcastToPlayers(MSG_GAME_OVER, gameState)
			return
		}

		game.Mutex.Unlock()

		// Broadcast game state
		game.BroadcastToPlayers(MSG_GAME_UPDATE, game.State)
	}
}

func (game *Game) CheckCollisions() string {
	// Check wall collisions (wrapped, so no wall collisions)
	// Check self collisions
	for i := range game.State.Snakes {
		head := game.State.Snakes[i].Body[0]
		for j := 1; j < len(game.State.Snakes[i].Body); j++ {
			if head.X == game.State.Snakes[i].Body[j].X && head.Y == game.State.Snakes[i].Body[j].Y {
				// Self collision - other player wins
				if i == 0 {
					return game.State.Snakes[1].ID
				}
				return game.State.Snakes[0].ID
			}
		}
	}

	// Check snake-to-snake collisions
	snake1Head := game.State.Snakes[0].Body[0]
	snake2Head := game.State.Snakes[1].Body[0]

	// Head-to-head collision
	if snake1Head.X == snake2Head.X && snake1Head.Y == snake2Head.Y {
		// Both lose, but we'll give it to the one with higher score
		if game.State.Snakes[0].Score > game.State.Snakes[1].Score {
			return game.State.Snakes[0].ID
		} else if game.State.Snakes[1].Score > game.State.Snakes[0].Score {
			return game.State.Snakes[1].ID
		}
		// Tie - no winner
		return "tie"
	}

	// Check if snake1 head hits snake2 body
	for _, bodyPart := range game.State.Snakes[1].Body[1:] {
		if snake1Head.X == bodyPart.X && snake1Head.Y == bodyPart.Y {
			return game.State.Snakes[1].ID
		}
	}

	// Check if snake2 head hits snake1 body
	for _, bodyPart := range game.State.Snakes[0].Body[1:] {
		if snake2Head.X == bodyPart.X && snake2Head.Y == bodyPart.Y {
			return game.State.Snakes[0].ID
		}
	}

	return ""
}

func (game *Game) EndGame(winner string) {
	game.Mutex.Lock()
	game.IsActive = false
	game.State.Status = "finished"
	game.State.Winner = winner
	// Reset ready status for rematch
	game.Player1.Ready = false
	game.Player2.Ready = false
	gameState := game.State // Copy state before unlocking
	game.Mutex.Unlock()

	// Broadcast game over with final state
	game.BroadcastToPlayers(MSG_GAME_OVER, gameState)
}

func (gm *GameManager) generateFood(snakes []Snake) Position {
	for {
		food := Position{
			X: rand.Intn(GRID_WIDTH),
			Y: rand.Intn(GRID_HEIGHT),
		}

		// Check if food is on any snake
		valid := true
		for _, snake := range snakes {
			for _, bodyPart := range snake.Body {
				if food.X == bodyPart.X && food.Y == bodyPart.Y {
					valid = false
					break
				}
			}
			if !valid {
				break
			}
		}

		if valid {
			return food
		}
	}
}

func (game *Game) BroadcastToPlayers(msgType string, data interface{}) {
	message := map[string]any{
		"type": msgType,
		"data": data,
	}

	jsonData, _ := json.Marshal(message)

	// Send to players
	select {
	case game.Player1.Send <- jsonData:
	default:
	}

	select {
	case game.Player2.Send <- jsonData:
	default:
	}

	// Send to spectators
	game.Mutex.RLock()
	for _, spectator := range game.Spectators {
		select {
		case spectator.Send <- jsonData:
		default:
		}
	}
	game.Mutex.RUnlock()
}

func (p *Player) SendMessage(msgType string, data map[string]interface{}) {
	message := map[string]interface{}{
		"type": msgType,
	}
	for k, v := range data {
		message[k] = v
	}

	jsonData, _ := json.Marshal(message)

	select {
	case p.Send <- jsonData:
	default:
		close(p.Send)
	}
}

// SendGamesList sends list of active games to a player
func (gm *GameManager) SendGamesList(player *Player) {
	gm.Mutex.RLock()
	gamesList := make([]map[string]interface{}, 0)
	for gameID, game := range gm.Games {
		game.Mutex.RLock()
		gameInfo := map[string]interface{}{
			"id":         gameID,
			"player1":    game.Player1.Username,
			"player2":    game.Player2.Username,
			"status":     game.State.Status,
			"spectators": len(game.Spectators),
		}
		if game.State.Status == "playing" {
			gameInfo["scores"] = map[string]int{
				game.Player1.Username: 0,
				game.Player2.Username: 0,
			}
			for _, snake := range game.State.Snakes {
				if snake.ID == game.Player1.ID {
					gameInfo["scores"].(map[string]int)[game.Player1.Username] = snake.Score
				} else if snake.ID == game.Player2.ID {
					gameInfo["scores"].(map[string]int)[game.Player2.Username] = snake.Score
				}
			}
		}
		game.Mutex.RUnlock()
		gamesList = append(gamesList, gameInfo)
	}
	gm.Mutex.RUnlock()

	player.SendMessage(MSG_GAMES_LIST, map[string]interface{}{
		"games": gamesList,
	})
}

// BroadcastGamesList broadcasts games list to all lobby players
func (gm *GameManager) BroadcastGamesList() {
	gm.Mutex.RLock()
	players := make([]*Player, 0, len(gm.Lobby))
	for _, p := range gm.Lobby {
		players = append(players, p)
	}
	gm.Mutex.RUnlock()

	for _, p := range players {
		gm.SendGamesList(p)
	}
}

// AddSpectator adds a player as spectator to a game
func (gm *GameManager) AddSpectator(player *Player, gameID string) {
	gm.Mutex.RLock()
	game, exists := gm.Games[gameID]
	gm.Mutex.RUnlock()

	if !exists {
		player.SendMessage(MSG_ERROR, map[string]interface{}{
			"message": "Game not found",
			"code":    "GAME_NOT_FOUND",
		})
		return
	}

	// Security: Check if player is already a player in this game
	game.Mutex.Lock()
	if game.Player1.ID == player.ID || game.Player2.ID == player.ID {
		game.Mutex.Unlock()
		player.SendMessage(MSG_ERROR, map[string]interface{}{
			"message": "You are already a player in this game",
			"code":    "ALREADY_PLAYER",
		})
		return
	}

	// Check if already a spectator
	if _, exists := game.Spectators[player.ID]; exists {
		game.Mutex.Unlock()
		return
	}

	// Add as spectator
	game.Spectators[player.ID] = player
	game.Mutex.Unlock()

	// Send current game state to new spectator
	game.Mutex.RLock()
	currentState := game.State
	game.Mutex.RUnlock()

	player.SendMessage(MSG_SPECTATOR_UPDATE, map[string]interface{}{
		"game_id": gameID,
		"data":    currentState,
	})

	// Broadcast updated games list
	gm.BroadcastGamesList()
}

// HandleRematchRequest handles rematch request from a player
func (gm *GameManager) HandleRematchRequest(player *Player, gameID string) {
	gm.Mutex.RLock()
	game, exists := gm.Games[gameID]
	gm.Mutex.RUnlock()

	if !exists {
		player.SendMessage(MSG_ERROR, map[string]interface{}{
			"message": "Game not found",
			"code":    "GAME_NOT_FOUND",
		})
		return
	}

	// Security: Only players can request rematch, not spectators
	game.Mutex.Lock()
	if game.Player1.ID != player.ID && game.Player2.ID != player.ID {
		game.Mutex.Unlock()
		player.SendMessage(MSG_ERROR, map[string]interface{}{
			"message": "Only players can request rematch",
			"code":    "NOT_A_PLAYER",
		})
		return
	}

	// Mark player as ready for rematch
	if game.Player1.ID == player.ID {
		game.Player1.Ready = true
	} else {
		game.Player2.Ready = true
	}

	bothReady := game.Player1.Ready && game.Player2.Ready
	game.Mutex.Unlock()

	if bothReady {
		// Start rematch countdown
		go gm.StartRematch(gameID)
	} else {
		// Notify other player that rematch was requested
		game.BroadcastToPlayers(MSG_REMATCH_REQUEST, map[string]interface{}{
			"game_id": gameID,
		})
	}
}

// StartRematch starts a rematch with countdown
func (gm *GameManager) StartRematch(gameID string) {
	gm.Mutex.RLock()
	game, exists := gm.Games[gameID]
	gm.Mutex.RUnlock()

	if !exists {
		return
	}

	// Countdown from 10
	for i := 10; i > 0; i-- {
		game.BroadcastToPlayers(MSG_REMATCH_COUNTDOWN, map[string]interface{}{
			"game_id":   gameID,
			"countdown": i,
		})
		time.Sleep(1 * time.Second)
	}

	// Reset game state
	game.Mutex.Lock()
	game.State.Status = "countdown"
	game.State.Countdown = 3
	game.State.Winner = ""
	game.Player1.Ready = false
	game.Player2.Ready = false
	game.Mutex.Unlock()

	// Countdown 3-2-1
	for i := 3; i > 0; i-- {
		game.Mutex.Lock()
		game.State.Countdown = i
		game.Mutex.Unlock()

		game.BroadcastToPlayers(MSG_GAME_UPDATE, game.State)
		time.Sleep(1 * time.Second)
	}

	// Initialize new game
	game.Mutex.Lock()
	game.State.Status = "playing"
	game.State.Countdown = 0

	// Initialize snakes
	snake1 := Snake{
		ID:        game.Player1.ID,
		Body:      []Position{{X: 5, Y: 15}, {X: 4, Y: 15}, {X: 3, Y: 15}},
		Direction: RIGHT,
		NextDir:   RIGHT,
		Color:     "#FF0000",
		Score:     0,
		Username:  game.Player1.Username,
	}

	snake2 := Snake{
		ID:        game.Player2.ID,
		Body:      []Position{{X: 35, Y: 15}, {X: 36, Y: 15}, {X: 37, Y: 15}},
		Direction: LEFT,
		NextDir:   LEFT,
		Color:     "#0000FF",
		Score:     0,
		Username:  game.Player2.Username,
	}

	game.State.Snakes = []Snake{snake1, snake2}
	game.State.Food = Food{Position: gm.generateFood(game.State.Snakes)}
	game.IsActive = true
	game.Mutex.Unlock()

	game.BroadcastToPlayers(MSG_GAME_START, game.State)

	// Start game loop
	game.Ticker = time.NewTicker(TICK_RATE)
	go game.GameLoop(gm)
}
