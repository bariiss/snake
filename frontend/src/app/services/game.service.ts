import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { WebSocketService } from './websocket.service';
import { WebRTCService } from './webrtc.service';
import { Router } from '@angular/router';

export interface Player {
  id: string;
  username: string;
  ready: boolean;
  joinedAt?: string;
  in_game?: boolean; // True if player is currently in an active game
}

export interface PlayerStatus {
  id: string;
  username: string;
  ready: boolean;
}

export interface GameState {
  id: string;
  snakes: Snake[];
  food: Food;
  status: 'waiting' | 'countdown' | 'playing' | 'finished' | 'rematch_countdown';
  countdown?: number;
  winner?: string;
  players?: PlayerStatus[];
  rematchRequesterId?: string;
  rematchRequesterName?: string;
}

export interface Snake {
  id: string;
  body: Position[];
  direction: string;
  color: string;
  score: number;
  username?: string;
}

export interface Food {
  position: Position;
}

export interface Position {
  x: number;
  y: number;
}

@Injectable({
  providedIn: 'root'
})
export class GameService {
  private currentGameState$ = new BehaviorSubject<GameState | null>(null);
  private lobbyPlayers$ = new BehaviorSubject<Player[]>([]);
  private currentPlayer$ = new BehaviorSubject<Player | null>(null);
  private gameRequest$ = new BehaviorSubject<any[]>([]);
  private pendingRequest$ = new BehaviorSubject<any[]>([]);
  private activeGames$ = new BehaviorSubject<any[]>([]);
  private isSpectator$ = new BehaviorSubject<boolean>(false);
  private banner$ = new BehaviorSubject<{ type: 'info' | 'warning'; message: string } | null>(null);
  private connectionError$ = new BehaviorSubject<string | null>(null);
  private connectionStatus$ = new BehaviorSubject<{ step: string; completed: boolean }>({ step: 'idle', completed: false });

  constructor(
    private wsService: WebSocketService,
    private webrtcService: WebRTCService,
    private router: Router
  ) {
    this.setupMessageHandlers();
    this.setupPeerToPeerMessageHandlers();
  }

  private setupPeerToPeerMessageHandlers(): void {
    // Peer-to-peer messages (game updates, moves, etc.)
    this.webrtcService.peerToPeerMessages$.subscribe(message => {
      switch (message.type) {
        case 'game_update':
          if (message.data) {
            this.currentGameState$.next(message.data);
          }
          break;
        case 'game_start':
          this.currentGameState$.next({
            ...(message.data || {}),
            rematchRequesterId: undefined,
            rematchRequesterName: undefined
          });
          break;
        case 'game_over':
          this.currentGameState$.next({
            ...(message.data || {}),
            rematchRequesterId: undefined,
            rematchRequesterName: undefined
          });
          break;
        case 'player_move':
          // Forward player move to server for game logic
          // (Server still manages game state, peer-to-peer is for low-latency input)
          this.wsService.send({
            type: 'player_move',
            game_id: message.game_id,
            direction: message.direction
          });
          break;
      }
    });
  }

  private startPeerToPeerConnection(message: any): void {
    // Determine if we're the initiator (Player1) or receiver (Player2)
    const currentPlayer = this.currentPlayer$.value;
    if (!currentPlayer || !message.data) return;

    const gameState = message.data;
    
    // Find the other player's ID from game state
    // Try players array first (available in waiting state)
    let peerPlayerId: string | null = null;
    let isInitiator = false;
    
    if (gameState.players && gameState.players.length >= 2) {
      // Find our player and the other player
      const myPlayer = gameState.players.find((p: any) => p.id === currentPlayer.id);
      const otherPlayer = gameState.players.find((p: any) => p.id !== currentPlayer.id);
      
      if (otherPlayer) {
        peerPlayerId = otherPlayer.id;
        // First player in array is usually Player1 (initiator)
        isInitiator = gameState.players[0].id === currentPlayer.id;
      }
    } else if (gameState.snakes && gameState.snakes.length >= 2) {
      // Fallback to snakes array (if game has started)
      const mySnake = gameState.snakes.find((s: any) => s.id === currentPlayer.id);
      const otherSnake = gameState.snakes.find((s: any) => s.id !== currentPlayer.id);
      
      if (otherSnake) {
        peerPlayerId = otherSnake.id;
        // First snake in array is usually Player1 (initiator)
        isInitiator = gameState.snakes[0].id === currentPlayer.id;
      }
    }

    if (peerPlayerId) {
      console.log(`Starting peer-to-peer connection to ${peerPlayerId} (initiator: ${isInitiator})`);
      // Set player ID in WebRTC service from WebSocket service
      const wsPlayerId = this.wsService.getPlayerId();
      if (wsPlayerId) {
        this.webrtcService.setPlayerId(wsPlayerId);
      }
      this.webrtcService.connectToPeer(peerPlayerId, isInitiator).catch(err => {
        console.error('Error starting peer-to-peer connection:', err);
      });
    } else {
      console.warn('Could not find peer player ID for peer-to-peer connection', {
        hasPlayers: !!gameState.players,
        playersLength: gameState.players?.length,
        hasSnakes: !!gameState.snakes,
        snakesLength: gameState.snakes?.length,
        currentPlayerId: currentPlayer.id
      });
    }
  }

  private setupMessageHandlers(): void {
    // Server-client messages (lobby, matchmaking) via WebSocket
    this.wsService.messages$.subscribe(message => {
      switch (message.type) {
        case 'connected':
          this.connectionStatus$.next({ step: 'connected', completed: true });
          if (message.player) {
            this.currentPlayer$.next(message.player);
            this.wsService.setPlayerId(message.player.id);
            // Update username in case it was changed or not set
            if (message.player.username) {
              localStorage.setItem('snake_game_username', message.player.username);
            }
            // Store token if provided
            if (message.token) {
              localStorage.setItem('snake_game_token', message.token);
            }
            // Player is connected but not in lobby yet
            // Frontend will show mode selection (single/multiplayer)
            // joinLobby() will be called when multiplayer is selected
            // Set to ready immediately so loading screen closes and mode selection shows
            this.connectionStatus$.next({ step: 'ready', completed: true });
          }
          break;
        case 'lobby_status':
          this.connectionStatus$.next({ step: 'lobby_loaded', completed: true });
          const normalizedPlayers = (message.players || []).map((player: any) => ({
            ...player,
            joinedAt: player.joinedAt || player.joined_at
          }));
          this.lobbyPlayers$.next(normalizedPlayers);
          break;
        case 'games_list':
          this.connectionStatus$.next({ step: 'ready', completed: true });
          this.activeGames$.next(message.games || []);
          break;
        case 'spectator_update':
          if (message.data) {
            this.currentGameState$.next(message.data);
            this.isSpectator$.next(true);
          }
          break;
        case 'game_request_sent':
          // Add to pending requests array
          const currentPending = this.pendingRequest$.value || [];
          const newPending = [...currentPending, message];
          this.pendingRequest$.next(newPending);
          break;
        case 'match_found':
          // Add to incoming requests array
          const currentRequests = this.gameRequest$.value || [];
          const newRequests = [...currentRequests, message];
          this.gameRequest$.next(newRequests);
          break;
        case 'game_accept':
          // Clear all pending requests when game is accepted
          this.pendingRequest$.next([]);
          this.gameRequest$.next([]);
          // Not a spectator when accepting game
          this.isSpectator$.next(false);
          if (message.game_id) {
            // Set initial game state if provided
            if (message.data) {
              this.currentGameState$.next(message.data);
            }
            // Start peer-to-peer connection
            this.startPeerToPeerConnection(message);
            // Navigate to multiplayer game
            this.router.navigate(['/game/multiplayer', message.game_id]);
          }
          break;
        case 'peer_offer':
          // Handle peer-to-peer offer (received via WebSocket from server)
          // Ensure player ID is set before handling offer
          const wsPlayerId = this.wsService.getPlayerId();
          if (wsPlayerId) {
            this.webrtcService.setPlayerId(wsPlayerId);
          }
          this.webrtcService.handlePeerOffer(message.offer).catch(err => {
            console.error('Error handling peer offer:', err);
          });
          break;
        case 'peer_answer':
          // Handle peer-to-peer answer (received via WebSocket from server)
          this.webrtcService.handlePeerAnswer(message.answer).catch(err => {
            console.error('Error handling peer answer:', err);
          });
          break;
        case 'peer_ice_candidate':
          // Handle peer-to-peer ICE candidate (received via WebSocket from server)
          this.webrtcService.handleICECandidate(message.candidate).catch(err => {
            console.error('Error handling ICE candidate:', err);
          });
          break;
        case 'game_reject':
          // Remove rejected request from pending
          const pendingAfterReject = (this.pendingRequest$.value || []).filter(
            (req: any) => req.game_id !== message.game_id
          );
          this.pendingRequest$.next(pendingAfterReject);
          // Show notification that request was rejected
          if (message.from_player) {
            this.showInfoBanner(`${message.from_player.username} rejected your game request.`, 'warning');
          } else {
            this.showInfoBanner('Your game request was rejected.', 'warning');
          }
          break;
        case 'game_request_cancel':
          // Remove cancelled request
          if (message.from_player) {
            // Someone cancelled their request to us
            const requestsAfterCancel = (this.gameRequest$.value || []).filter(
              (req: any) => req.from_player?.id !== message.from_player.id
            );
            this.gameRequest$.next(requestsAfterCancel);
            this.showInfoBanner(`${message.from_player?.username || 'Opponent'} cancelled the invitation.`);
          } else {
            // We cancelled our request
            const pendingAfterCancel = (this.pendingRequest$.value || []).filter(
              (req: any) => req.to_player?.id !== message.to_player
            );
            this.pendingRequest$.next(pendingAfterCancel);
          }
          break;
        case 'game_update':
          const previousState = this.currentGameState$.value;
          this.currentGameState$.next(message.data);
          // For single player games, navigate to game on first update (countdown starts)
          // Only navigate if we're not already on the game page
          if (message.data?.id && !previousState) {
            const isSinglePlayer = message.data.is_single_player || !message.data.player2;
            const gamePath = isSinglePlayer ? `/game/single/${message.data.id}` : `/game/multiplayer/${message.data.id}`;
            if (this.router.url !== gamePath) {
              // First game update (countdown) - navigate to game page
              this.router.navigate([isSinglePlayer ? '/game/single' : '/game/multiplayer', message.data.id]);
            }
          }
          break;
        case 'game_start':
          this.currentGameState$.next({
            ...(message.data || {}),
            rematchRequesterId: undefined,
            rematchRequesterName: undefined
          });
          // Navigate to game if we have a game ID
          // Check if single player or multiplayer based on game state
          if (message.data?.id) {
            const isSinglePlayer = message.data.is_single_player || !message.data.player2;
            const gamePath = isSinglePlayer ? `/game/single/${message.data.id}` : `/game/multiplayer/${message.data.id}`;
            if (this.router.url !== gamePath) {
              if (isSinglePlayer) {
                this.router.navigate(['/game/single', message.data.id]);
              } else {
                this.router.navigate(['/game/multiplayer', message.data.id]);
              }
            }
          }
          break;
        case 'game_over':
          this.currentGameState$.next({
            ...(message.data || {}),
            rematchRequesterId: undefined,
            rematchRequesterName: undefined
          });
          break;
        case 'player_disconnected':
          // Player disconnected - update game state to show opponent disconnected
          if (message.message && message.player) {
            this.showInfoBanner(`${message.player} has left the game. Returning to lobby...`, 'warning');
            // Update game state to mark opponent as disconnected
            const currentState = this.currentGameState$.value;
            if (currentState) {
              // Remove disconnected player from players list and mark game as finished
              const updatedPlayers = currentState.players?.filter((p: PlayerStatus) => p.username !== message.player) || [];
              this.currentGameState$.next({
                ...currentState,
                status: 'finished' as any, // Mark as finished so ready button doesn't show
                players: updatedPlayers
              });
            }
            // Automatically redirect to lobby after showing message
            setTimeout(() => {
              this.currentGameState$.next(null); // Clear game state
              this.router.navigate(['/lobby']);
            }, 2000);
          }
          break;
        case 'rematch_request':
          this.currentGameState$.next({
            ...this.currentGameState$.value,
            rematchRequesterId: message.requester_id,
            rematchRequesterName: message.requester_name
          } as any);
          break;
        case 'rematch_accept':
          // Clear rematch request state when accepted
          this.currentGameState$.next({
            ...this.currentGameState$.value,
            rematchRequesterId: undefined,
            rematchRequesterName: undefined
          } as any);
          if (message.data?.accepted_by) {
            this.showInfoBanner(`${message.data.accepted_by} accepted the rematch! Starting...`);
          }
          break;
        case 'rematch_countdown':
          // Rematch countdown
          if (message.countdown !== undefined) {
            this.currentGameState$.next({
              ...this.currentGameState$.value,
              status: 'rematch_countdown',
              countdown: message.countdown,
              rematchRequesterId: undefined,
              rematchRequesterName: undefined
            } as any);
          }
          break;
        case 'error':
          if (message.code === 'OPPONENT_DISCONNECTED') {
            // Opponent disconnected - show message and return to lobby
            this.showInfoBanner(message.message || 'Opponent has left the game. Returning to lobby...', 'warning');
            this.currentGameState$.next(null); // Clear game state
            setTimeout(() => this.router.navigate(['/lobby']), 2500);
          } else if (message.code === 'USERNAME_EXISTS') {
            this.connectionError$.next('Username already in use. Please choose another name.');
            this.wsService.disconnect();
          } else if (message.code === 'INVALID_TOKEN' || message.code === 'PLAYER_NOT_FOUND') {
            // Token is invalid or player not found - clear token and redirect to login
            localStorage.removeItem('snake_game_token');
            this.currentPlayer$.next(null);
            this.connectionError$.next(message.message || 'Session expired. Please login again.');
            this.wsService.disconnect();
            setTimeout(() => {
              this.router.navigate(['/login']);
            }, 1000);
          } else {
            console.error('Game error:', message.message);
            // Show error banner for other errors
            if (message.message) {
              this.showInfoBanner(message.message, 'warning');
            }
          }
          break;
      }
    });
  }

  connect(username: string): void {
    this.connectionStatus$.next({ step: 'connecting', completed: false });
    this.wsService.connect(username);
    // Player ID will be set when 'connected' message is received from backend
  }

  connectWithToken(token: string): void {
    this.connectionStatus$.next({ step: 'connecting', completed: false });
    // Get username from token or localStorage
    const username = localStorage.getItem('snake_game_username') || 'player';
    this.wsService.connect(username, token);
  }

  joinLobby(): void {
    this.wsService.send({ type: 'join_lobby' });
  }

  startSinglePlayer(): void {
    this.wsService.send({ type: 'start_single_player' });
  }

  leaveLobby(): void {
    this.wsService.send({ type: 'leave_lobby' });
  }

  sendGameRequest(targetId: string): void {
    this.wsService.send({
      type: 'game_request',
      target_id: targetId
    });
  }

  acceptGameRequest(gameId: string): void {
    this.wsService.send({
      type: 'game_accept',
      game_id: gameId
    });
  }

  rejectGameRequest(gameId: string): void {
    this.wsService.send({
      type: 'game_reject',
      game_id: gameId
    });
    // Remove from requests
    const requests = (this.gameRequest$.value || []).filter(
      (req: any) => req.game_id !== gameId
    );
    this.gameRequest$.next(requests);
  }

  cancelGameRequest(targetId: string): void {
    this.wsService.send({
      type: 'game_request_cancel',
      target_id: targetId
    });
  }

  playerReady(gameId: string): void {
    this.wsService.send({
      type: 'player_ready',
      game_id: gameId
    });
  }

  sendPlayerMove(gameId: string, direction: string): void {
    // Try sending via peer-to-peer first (low latency)
    if (this.webrtcService.isPeerConnected()) {
      this.webrtcService.sendToPeer({
        type: 'player_move',
        game_id: gameId,
        direction: direction
      });
    } else {
      // Fallback to WebSocket (always available)
      this.wsService.send({
        type: 'player_move',
        game_id: gameId,
        direction: direction
      });
    }
  }

  getCurrentGameState(): Observable<GameState | null> {
    return this.currentGameState$.asObservable();
  }

  getLobbyPlayers(): Observable<Player[]> {
    return this.lobbyPlayers$.asObservable();
  }

  getCurrentPlayer(): Observable<Player | null> {
    return this.currentPlayer$.asObservable();
  }

  getGameRequest(): Observable<any[]> {
    return this.gameRequest$.asObservable();
  }

  getPendingRequest(): Observable<any[]> {
    return this.pendingRequest$.asObservable();
  }

  getActiveGames(): Observable<any[]> {
    return this.activeGames$.asObservable();
  }

  isSpectator(): Observable<boolean> {
    return this.isSpectator$.asObservable();
  }

  getBanner(): Observable<{ type: 'info' | 'warning'; message: string } | null> {
    return this.banner$.asObservable();
  }

  clearBanner(): void {
    this.banner$.next(null);
  }

  getConnectionError(): Observable<string | null> {
    return this.connectionError$.asObservable();
  }

  getConnectionStatus(): Observable<{ step: string; completed: boolean }> {
    return this.connectionStatus$.asObservable();
  }

  clearConnectionError(): void {
    this.connectionError$.next(null);
  }

  showInfoBanner(message: string, type: 'info' | 'warning' = 'info'): void {
    this.banner$.next({ type, message });
    setTimeout(() => {
      if (this.banner$.value?.message === message) {
        this.banner$.next(null);
      }
    }, 4000);
  }

  listGames(): void {
    this.wsService.send({ type: 'list_games' });
  }

  joinAsSpectator(gameId: string): void {
    this.wsService.send({
      type: 'join_spectator',
      game_id: gameId
    });
  }

  requestRematch(gameId: string): void {
    this.wsService.send({
      type: 'rematch_request',
      game_id: gameId
    });
  }

  acceptRematch(gameId: string): void {
    this.wsService.send({
      type: 'rematch_accept',
      game_id: gameId
    });
  }

  disconnect(): void {
    // Show disconnecting steps
    this.connectionStatus$.next({ step: 'disconnecting_peer', completed: false });
    
    // Disconnect peer-to-peer first
    this.webrtcService.disconnectPeer();
    
    setTimeout(() => {
      this.connectionStatus$.next({ step: 'disconnecting_peer', completed: true });
      this.connectionStatus$.next({ step: 'disconnecting_lobby', completed: false });
      
      // Leave lobby BEFORE disconnecting WebSocket
      this.leaveLobby();
      
      setTimeout(() => {
        this.connectionStatus$.next({ step: 'disconnecting_lobby', completed: true });
        this.connectionStatus$.next({ step: 'disconnecting_websocket', completed: false });
        
        // Disconnect WebSocket after leaving lobby
        this.wsService.disconnect();
        
        setTimeout(() => {
          this.connectionStatus$.next({ step: 'disconnecting_websocket', completed: true });
          this.connectionStatus$.next({ step: 'disconnected', completed: true });
          
          // Reset state after showing disconnected
          setTimeout(() => {
            this.resetState();
            this.connectionStatus$.next({ step: 'idle', completed: false });
          }, 500);
        }, 300);
      }, 300);
    }, 300);
  }

  resetState(): void {
    this.currentGameState$.next(null);
    this.lobbyPlayers$.next([]);
    this.currentPlayer$.next(null); // Clear player on disconnect
    this.gameRequest$.next([]);
    this.pendingRequest$.next([]);
    this.activeGames$.next([]);
    this.isSpectator$.next(false);
    this.clearBanner();
    // Reset connection status to idle (not connecting, so loading won't show)
    this.connectionStatus$.next({ step: 'idle', completed: false });
  }
}

