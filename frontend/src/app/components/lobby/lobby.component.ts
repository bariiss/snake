import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { GameService, Player } from '../../services/game.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-lobby',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './lobby.component.html',
  styleUrls: ['./lobby.component.css']
})
export class LobbyComponent implements OnInit, OnDestroy {
  username: string = '';
  isConnected: boolean = false;
  players: Player[] = [];
  gameRequests: any[] = [];
  pendingRequests: any[] = [];
  currentPlayer: Player | null = null;
  showUsernameEdit: boolean = false;
  errorMessage: string = '';
  activeGames: any[] = [];

  private subscriptions = new Subscription();
  private readonly SESSION_LOCK_KEY = 'snake_active_session';
  private readonly SESSION_HEARTBEAT_MS = 5000;
  private readonly SESSION_TTL_MS = 30000;
  private sessionId: string = self.crypto?.randomUUID ? self.crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  private sessionHeartbeat?: number;
  private readonly USERNAME_STORAGE_KEY = 'snake_game_username';

  constructor(
    private gameService: GameService,
    private router: Router
  ) {}

  ngOnInit(): void {
    window.addEventListener('beforeunload', this.handleBeforeUnload);
    window.addEventListener('storage', this.handleStorageEvent);

    // Load username from local storage
    const savedUsername = localStorage.getItem(this.USERNAME_STORAGE_KEY);
    if (savedUsername) {
      this.username = savedUsername;
      // Auto-connect if username exists
      this.connect();
    }
    
    this.subscriptions.add(
      this.gameService.getLobbyPlayers().subscribe(players => {
        this.players = (players || [])
          .map(player => ({
            ...player,
            joinedAt: player.joinedAt || (player as any).joined_at
          }))
          .sort((a, b) => {
            const aTime = new Date(a.joinedAt || 0).getTime();
            const bTime = new Date(b.joinedAt || 0).getTime();
            return aTime - bTime;
          });
      })
    );

    this.subscriptions.add(
      this.gameService.getGameRequest().subscribe(requests => {
        this.gameRequests = requests || [];
        this.errorMessage = '';
      })
    );

    this.subscriptions.add(
      this.gameService.getPendingRequest().subscribe(requests => {
        this.pendingRequests = requests || [];
      })
    );

    this.subscriptions.add(
      this.gameService.getCurrentPlayer().subscribe(player => {
        this.currentPlayer = player;
        // Update username from player if available and not set
        if (player && player.username && !this.username) {
          this.username = player.username;
          localStorage.setItem(this.USERNAME_STORAGE_KEY, player.username);
        }
      })
    );

    this.subscriptions.add(
      this.gameService.getActiveGames().subscribe(games => {
        this.activeGames = games;
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    window.removeEventListener('beforeunload', this.handleBeforeUnload);
    window.removeEventListener('storage', this.handleStorageEvent);
    this.releaseSessionLock();
  }

  connect(): void {
    if (this.username.trim()) {
      if (!this.acquireSessionLock()) {
        this.errorMessage = 'You already have an active game in another tab.';
        return;
      }
      // Save username to local storage
      const trimmedUsername = this.username.trim();
      localStorage.setItem(this.USERNAME_STORAGE_KEY, trimmedUsername);
      this.username = trimmedUsername; // Ensure username is set
      this.gameService.connect(trimmedUsername);
      // joinLobby will be called automatically after 'connected' message
      this.isConnected = true;
      this.showUsernameEdit = false;
    }
  }

  editUsername(): void {
    this.showUsernameEdit = true;
  }

  updateUsername(): void {
    if (this.username.trim()) {
      localStorage.setItem(this.USERNAME_STORAGE_KEY, this.username.trim());
      // Disconnect and reconnect with new username
      this.disconnect();
      setTimeout(() => {
        this.connect();
      }, 100);
    }
  }

  cancelEditUsername(): void {
    // Restore saved username
    const savedUsername = localStorage.getItem(this.USERNAME_STORAGE_KEY);
    if (savedUsername) {
      this.username = savedUsername;
    }
    this.showUsernameEdit = false;
  }

  disconnect(): void {
    this.gameService.leaveLobby();
    this.gameService.disconnect();
    // Remove username from local storage
    localStorage.removeItem(this.USERNAME_STORAGE_KEY);
    this.releaseSessionLock();
    this.isConnected = false;
    this.username = '';
  }

  sendGameRequest(playerId: string): void {
    this.gameService.sendGameRequest(playerId);
  }

  acceptGameRequest(gameId: string): void {
    this.gameService.acceptGameRequest(gameId);
  }

  rejectGameRequest(gameId: string): void {
    this.gameService.rejectGameRequest(gameId);
  }

  isCurrentPlayer(playerId: string): boolean {
    return this.currentPlayer?.id === playerId;
  }

  hasPendingRequestTo(playerId: string): boolean {
    return this.pendingRequests.some((req: any) => req.to_player?.id === playerId);
  }

  cancelGameRequest(targetId: string): void {
    this.gameService.cancelGameRequest(targetId);
  }

  watchGame(gameId: string): void {
    this.gameService.joinAsSpectator(gameId);
    this.router.navigate(['/game', gameId]);
  }

  private acquireSessionLock(): boolean {
    const existing = this.getLockValue();
    if (existing && existing.sessionId !== this.sessionId) {
      const age = Date.now() - existing.timestamp;
      if (age < this.SESSION_TTL_MS) {
        return false;
      }
    }
    this.setLockValue({
      sessionId: this.sessionId,
      timestamp: Date.now(),
    });
    this.startSessionHeartbeat();
    return true;
  }

  private releaseSessionLock(): void {
    const existing = this.getLockValue();
    if (existing && existing.sessionId === this.sessionId) {
      localStorage.removeItem(this.SESSION_LOCK_KEY);
    }
    this.stopSessionHeartbeat();
  }

  private startSessionHeartbeat(): void {
    this.stopSessionHeartbeat();
    this.sessionHeartbeat = window.setInterval(() => {
      const existing = this.getLockValue();
      if (existing && existing.sessionId === this.sessionId) {
        this.setLockValue({
          sessionId: this.sessionId,
          timestamp: Date.now(),
        });
      }
    }, this.SESSION_HEARTBEAT_MS);
  }

  private stopSessionHeartbeat(): void {
    if (this.sessionHeartbeat) {
      clearInterval(this.sessionHeartbeat);
      this.sessionHeartbeat = undefined;
    }
  }

  private getLockValue(): { sessionId: string; timestamp: number } | null {
    const raw = localStorage.getItem(this.SESSION_LOCK_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  private setLockValue(value: { sessionId: string; timestamp: number }): void {
    localStorage.setItem(this.SESSION_LOCK_KEY, JSON.stringify(value));
  }

  private handleBeforeUnload = (): void => {
    this.releaseSessionLock();
  };

  private handleStorageEvent = (event: StorageEvent): void => {
    if (event.key !== this.SESSION_LOCK_KEY) {
      return;
    }
    const existing = this.getLockValue();
    if (existing && existing.sessionId !== this.sessionId) {
      if (this.isConnected) {
        this.errorMessage = 'Session active in another tab. Disconnecting...';
        this.disconnect();
      }
    }
  };
}

