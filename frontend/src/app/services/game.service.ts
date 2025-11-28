import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { WebSocketService } from './websocket.service';
import { Router } from '@angular/router';

export interface Player {
  id: string;
  username: string;
  ready: boolean;
  joinedAt?: string;
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

  constructor(
    private wsService: WebSocketService,
    private router: Router
  ) {
    this.setupMessageHandlers();
  }

  private setupMessageHandlers(): void {
    this.wsService.messages$.subscribe(message => {
      switch (message.type) {
        case 'connected':
          if (message.player) {
            this.currentPlayer$.next(message.player);
            // Update username in case it was changed or not set
            if (message.player.username) {
              localStorage.setItem('snake_game_username', message.player.username);
            }
            // Backend automatically adds player to lobby, so we don't need to call joinLobby()
            // But we can request games list
            this.listGames();
          }
          break;
        case 'lobby_status':
          const normalizedPlayers = (message.players || []).map((player: any) => ({
            ...player,
            joinedAt: player.joinedAt || player.joined_at
          }));
          this.lobbyPlayers$.next(normalizedPlayers);
          break;
        case 'games_list':
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
            this.router.navigate(['/game', message.game_id]);
          }
          break;
        case 'game_reject':
          // Remove rejected request from pending
          const pendingAfterReject = (this.pendingRequest$.value || []).filter(
            (req: any) => req.game_id !== message.game_id
          );
          this.pendingRequest$.next(pendingAfterReject);
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
          this.currentGameState$.next(message.data);
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
        case 'player_disconnected':
          // Player disconnected - show message and return to lobby
          if (message.message && message.player) {
            this.showInfoBanner(`${message.player} has left the game. Returning to lobby...`, 'warning');
            setTimeout(() => this.router.navigate(['/']), 2500);
          }
          break;
        case 'rematch_request':
          this.currentGameState$.next({
            ...this.currentGameState$.value,
            rematchRequesterId: message.requester_id,
            rematchRequesterName: message.requester_name
          } as any);
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
          console.error('Game error:', message.message);
          // Error handling is done in components via error messages
          break;
      }
    });
  }

  connect(username: string): void {
    this.wsService.connect(username);
    // Player ID will be set when 'connected' message is received from backend
  }

  joinLobby(): void {
    this.wsService.send({ type: 'join_lobby' });
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
    this.wsService.send({
      type: 'player_move',
      game_id: gameId,
      direction: direction
    });
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

  private showInfoBanner(message: string, type: 'info' | 'warning' = 'info'): void {
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

  disconnect(): void {
    this.wsService.disconnect();
  }
}

