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
  showModeSelection: boolean = false;
  showUsernameEdit: boolean = false;
  editUsernameValue: string = '';
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
    }
    
    // Check if already connected first
    this.subscriptions.add(
      this.gameService.getCurrentPlayer().subscribe(player => {
        this.currentPlayer = player;
        // Update username from player if available
        if (player && player.username) {
          // Always update username from player to keep it in sync
          this.username = player.username;
          localStorage.setItem(this.USERNAME_STORAGE_KEY, player.username);
        }
        // If we have a player, we're connected
        if (player) {
          this.isConnected = true;
          // Show mode selection if not already in lobby
          if (!this.showModeSelection && this.players.length === 0) {
            this.showModeSelection = true;
          }
        } else if (savedUsername && !this.isConnected) {
          // Not connected but have username - auto-connect
          // Use setTimeout to avoid race condition
          setTimeout(() => {
            if (!this.isConnected && this.username) {
              this.connect();
            }
          }, 100);
        }
      })
    );
    
    this.subscriptions.add(
      this.gameService.getLobbyPlayers().subscribe(players => {
        this.players = (players || [])
          .map(player => ({
            ...player,
            joinedAt: player.joinedAt || (player as any).joined_at,
            in_game: (player as any).in_game || false
          }))
          .sort((a, b) => {
            const aTime = new Date(a.joinedAt || 0).getTime();
            const bTime = new Date(b.joinedAt || 0).getTime();
            return aTime - bTime;
          });
        // Hide mode selection once we're in lobby
        if (this.players.length > 0) {
          this.showModeSelection = false;
        }
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
      this.gameService.getActiveGames().subscribe(games => {
        this.activeGames = games;
      })
    );

    this.subscriptions.add(
      this.gameService.getConnectionError().subscribe(error => {
        if (error) {
          this.errorMessage = error;
          this.isConnected = false;
          this.releaseSessionLock();
          // Don't show username edit modal on connection error
          // User should manually click "Edit" if they want to change username
          this.showUsernameEdit = false;
          this.gameService.clearConnectionError();
        }
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
      const trimmedUsername = this.username.trim();
      const duplicate = this.players.some(
        player => player.username?.toLowerCase() === trimmedUsername.toLowerCase()
      );
      if (duplicate) {
        this.errorMessage = 'Nickname already in use. Please choose another.';
        return;
      }
      if (!this.acquireSessionLock()) {
        this.errorMessage = 'You already have an active game in another tab.';
        return;
      }
      // Save username to local storage
      localStorage.setItem(this.USERNAME_STORAGE_KEY, trimmedUsername);
      this.username = trimmedUsername; // Ensure username is set
      this.gameService.connect(trimmedUsername);
      // Mode selection will be shown after 'connected' message
      this.isConnected = true;
      this.showUsernameEdit = false;
    }
  }

  selectSinglePlayer(): void {
    this.showModeSelection = false;
    this.gameService.startSinglePlayer();
  }

  selectMultiplayer(): void {
    this.showModeSelection = false;
    this.gameService.joinLobby();
  }

  editUsername(): void {
    this.editUsernameValue = this.currentPlayer?.username || this.username || '';
    this.showUsernameEdit = true;
  }

  updateUsername(): void {
    if (this.editUsernameValue.trim()) {
      const newUsername = this.editUsernameValue.trim();
      
      // Check if new username is same as current username
      if (newUsername.toLowerCase() === (this.currentPlayer?.username || this.username).toLowerCase()) {
        this.showUsernameEdit = false;
        this.editUsernameValue = '';
        return;
      }
      
      // Check if new username already exists in lobby
      const duplicate = this.players.some(
        player => player.username?.toLowerCase() === newUsername.toLowerCase()
      );
      if (duplicate) {
        this.errorMessage = 'Nickname already in use. Please choose another.';
        return;
      }
      
      // Save new username to local storage (will be updated by subscription after reconnect)
      localStorage.setItem(this.USERNAME_STORAGE_KEY, newUsername);
      
      // Disconnect first to free up old username, then reconnect with new username
      this.gameService.leaveLobby();
      this.gameService.disconnect();
      this.releaseSessionLock();
      this.isConnected = false;
      this.currentPlayer = null; // Clear current player
      
      // Wait a bit for backend to process disconnect before reconnecting
      setTimeout(() => {
        if (this.acquireSessionLock()) {
          this.gameService.connect(newUsername);
          // isConnected will be set to true by getCurrentPlayer subscription
        } else {
          this.errorMessage = 'Could not acquire session lock. Please try again.';
        }
      }, 500);
      
      this.showUsernameEdit = false;
      this.editUsernameValue = '';
      this.errorMessage = ''; // Clear any previous errors
    }
  }

  cancelEditUsername(): void {
    this.showUsernameEdit = false;
    this.editUsernameValue = '';
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

  hasGameRequestFrom(playerId: string): boolean {
    return this.gameRequests.some((req: any) => req.from_player?.id === playerId);
  }

  getGameRequestFrom(playerId: string): any {
    return this.gameRequests.find((req: any) => req.from_player?.id === playerId);
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

