# Snake Game - Multiplayer Real-Time Game

A real-time multiplayer Snake game built with Go backend and Angular frontend, featuring WebSocket and WebRTC peer-to-peer communication.

## Project Structure

```text
snake/
├── backend/                     # Go WebSocket/WebRTC server
│   ├── main.go                  # Server entry point
│   ├── go.mod                   # Go module dependencies
│   ├── go.sum                   # Go module checksums
│   ├── Dockerfile               # Backend container image
│   ├── .dockerignore            # Docker ignore rules
│   ├── auth/                    # JWT authentication
│   │   ├── jwt.go               # JWT token generation/validation
│   │   └── middleware.go        # Authentication middleware
│   ├── constants/               # Application constants
│   │   └── constants.go         # Game constants and message types
│   ├── models/                  # Data models
│   │   └── models.go            # Game, Player, Snake models
│   ├── game/                    # Game logic and managers
│   │   ├── manager.go           # Main game manager
│   │   ├── lobby.go             # Lobby management
│   │   ├── players.go           # Player management
│   │   ├── message_handler.go   # Message routing
│   │   ├── matchmaking.go       # Matchmaking logic
│   │   ├── gameplay.go          # Game flow routing
│   │   ├── gameplay_common.go   # Common game logic
│   │   ├── gameplay_single.go   # Single player game logic
│   │   ├── gameplay_multi.go    # Multiplayer game logic
│   │   ├── single_game.go       # Single player game manager
│   │   ├── single_manager.go    # Single player manager
│   │   └── multi_manager.go     # Multiplayer manager
│   ├── handlers/                # HTTP/WebSocket/WebRTC handlers
│   │   ├── websocket_handler.go # WebSocket connection handler
│   │   ├── webrtc_handler.go    # WebRTC signaling handler
│   │   └── peer_signaling.go    # Peer-to-peer signaling
│   ├── lobby/                   # Lobby service
│   │   └── service.go           # Lobby service implementation
│   └── webrtc/                  # WebRTC peer management
│       └── peer.go              # Peer connection management
├── frontend/                    # Angular frontend
│   ├── src/
│   │   ├── app/
│   │   │   ├── components/
│   │   │   │   ├── login/              # Login component
│   │   │   │   ├── mode-selection/     # Game mode selection
│   │   │   │   ├── lobby/              # Lobby component
│   │   │   │   ├── game/               # Game component
│   │   │   │   └── connection-status/  # Connection monitoring
│   │   │   ├── services/
│   │   │   │   ├── websocket.service.ts
│   │   │   │   ├── webrtc.service.ts
│   │   │   │   ├── game.service.ts
│   │   │   │   └── connection-status.service.ts
│   │   │   ├── app.component.*         # Root component
│   │   │   └── app.routes.ts           # Application routes
│   │   ├── environments/               # Environment configs
│   │   │   ├── environment.ts
│   │   │   ├── environment.prod.ts
│   │   │   └── environment.prod.template.ts
│   │   ├── assets/                     # Static assets
│   │   ├── index.html                  # Entry HTML
│   │   ├── main.ts                     # Application bootstrap
│   │   └── styles.css                  # Global styles
│   ├── Dockerfile                      # Frontend container image
│   ├── entrypoint.sh                   # Runtime env injection script
│   ├── generate-env.js                 # Environment generator
│   ├── angular.json                    # Angular configuration
│   ├── package.json                    # Node dependencies
│   ├── tsconfig.json                   # TypeScript config
│   ├── tsconfig.app.json               # App TypeScript config
│   └── .dockerignore                   # Docker ignore rules
├── coturn/                             # TURN server configuration
│   └── docker-compose.yaml             # CoTURN server setup
├── proxy/                              # Reverse proxy configuration
│   └── nginx.conf                      # Nginx configuration
├── docker-compose.yaml                 # Development setup
├── docker-compose.prod.yaml            # Production setup
├── traefik.snake.yml                   # Traefik configuration
└── README.md                           # This file
```

## Features

### Game Modes

- **Single Player**: Play against yourself
- **Multiplayer**: 2-player real-time Snake game

### Communication

- **WebSocket**: Real-time communication for lobby, matchmaking, and game signaling
- **WebRTC**: Peer-to-peer connection for low-latency game updates during multiplayer games
- **Connection Status Monitoring**: Real-time display of WebSocket, WebRTC, and P2P connection status with traffic statistics

### Game Features

- Real-time multiplayer gameplay
- Matchmaking system (lobby)
- Game request system (send/accept/reject)
- Ready system with countdown
- Collision detection (self and opponent)
- Score tracking
- Rematch functionality
- Spectator mode
- Speed boost when holding arrow keys (1.3x faster)

### UI Features

- Connection status panel with real-time traffic monitoring
- IP and port display for peer-to-peer connections
- Responsive design (mobile and desktop)
- Canvas-based game rendering
- Dark theme UI

## Installation

### Docker (Recommended)

#### Docker Development

```bash
docker-compose up --build
```

- Backend: `http://localhost:8020`
- Frontend: `http://localhost:80`

#### Docker Production

```bash
docker-compose -f docker-compose.prod.yaml up --build
```

Configure environment variables:

- `WEBRTC_TURN_IP`: TURN server IP address (default: `turn.li1.nl`)

### Manual Setup

#### Backend Setup

```bash
cd backend
go mod download
go run main.go
```

Backend runs on port `8020` by default.

#### Frontend Setup

```bash
cd frontend
npm install
ng serve
```

Frontend runs on `http://localhost:4200` (development server).

## Configuration

### Environment Variables

#### Backend Environment Variables

- `PORT`: Server port (default: `8020`)
- `WEBRTC_TURN_IP`: TURN server IP for WebRTC (default: `turn.li1.nl`)

#### Frontend Environment Variables

- `WEBRTC_TURN_IP`: TURN server IP for WebRTC (injected at runtime via `entrypoint.sh`)

### TURN Server

The game uses STUN/TURN servers for WebRTC peer-to-peer connections. Configure the TURN server IP via environment variables:

- **Development**: `192.168.50.198` (local network)
- **Production**: `213.14.134.174` or `turn.li1.nl` (public server)

## WebSocket API

### Message Types

#### Authentication

- `connected`: Connection established (includes JWT token)

#### Lobby

- `join_lobby`: Join the lobby
- `leave_lobby`: Leave the lobby
- `lobby_status`: Lobby player list update

#### Game Requests

- `game_request`: Send game request to another player
- `game_accept`: Accept game request
- `game_reject`: Reject game request
- `game_request_cancel`: Cancel pending game request

#### Game Flow

- `player_ready`: Player is ready to start
- `game_start`: Game has started
- `game_update`: Game state update (snakes, food, scores)
- `game_over`: Game has ended
- `player_move`: Player direction change (direction: "up", "down", "left", "right")
- `leave_game`: Leave active game

#### Rematch

- `rematch_request`: Request rematch
- `rematch_accept`: Accept rematch
- `rematch_countdown`: Rematch countdown
- `rematch_start`: Rematch game started

#### Spectator

- `join_spectator`: Join game as spectator
- `spectator_update`: Spectator game update

## WebRTC API

### Endpoints

- `POST /webrtc/offer`: Create WebRTC offer (server-client)
- `POST /webrtc/peer/offer`: Create peer-to-peer offer
- `POST /webrtc/peer/answer`: Send peer-to-peer answer
- `POST /webrtc/peer/ice`: Send ICE candidate

### Peer-to-Peer Flow

1. Player 1 creates offer and sends to backend
2. Backend forwards offer to Player 2
3. Player 2 creates answer and sends to backend
4. Backend forwards answer to Player 1
5. Both players exchange ICE candidates via backend
6. Direct peer-to-peer connection established
7. Game updates flow through P2P connection (lower latency)

## Game Rules

- Each player starts with a 3-segment snake
- Eating food makes the snake grow and increases score
- Colliding with yourself or opponent ends the game
- Game area is wrap-around (snakes can pass through edges)
- Controls: Arrow keys or WASD
- Speed boost: Hold arrow keys for 1.3x faster movement

## Technologies

### Backend

- **Go 1.25.5**: Programming language
- **Gorilla WebSocket**: WebSocket implementation
- **Pion WebRTC**: WebRTC library
- **JWT**: Authentication tokens

### Frontend

- **Angular 17**: Framework
- **TypeScript**: Programming language
- **RxJS**: Reactive programming
- **WebRTC API**: Peer-to-peer connections
- **Canvas API**: Game rendering

### Infrastructure

- **Docker**: Containerization
- **Docker Compose**: Multi-container orchestration
- **Nginx**: Production web server (frontend)
- **TURN Server**: WebRTC NAT traversal

## Connection Status Monitoring

The application includes a real-time connection status panel that displays:

- **WebSocket**: Connection status and traffic (bytes sent/received)
- **WebRTC**: Connection status, ICE state, and traffic
- **Peer-to-Peer**: Connection status, ICE state, traffic, and IP addresses with ports

The panel can be toggled on/off and shows detailed information about all active connections.

## Development

### Backend Development

```bash
cd backend
go run main.go
```

### Frontend Development

```bash
cd frontend
ng serve
```

The frontend will proxy WebSocket requests to `localhost:8020` in development mode.

## Production Deployment

1. Set environment variables in `docker-compose.prod.yaml`
2. Configure TURN server IP (`WEBRTC_TURN_IP`)
3. Build and deploy:

```bash
docker-compose -f docker-compose.prod.yaml up --build -d
```

The production setup uses:

- HTTPS/WSS for secure connections
- No explicit ports in URLs (uses standard 443/80)
- Environment variable injection at runtime

## License

This project is open source and available for use.
