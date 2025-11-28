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
  private readonly USERNAME_STORAGE_KEY = 'snake_game_username';

  constructor(
    private gameService: GameService,
    private router: Router
  ) {}

  ngOnInit(): void {
    // Load username from local storage
    const savedUsername = localStorage.getItem(this.USERNAME_STORAGE_KEY);
    if (savedUsername) {
      this.username = savedUsername;
      // Auto-connect if username exists
      this.connect();
    }
    
    this.subscriptions.add(
      this.gameService.getLobbyPlayers().subscribe(players => {
        this.players = players;
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
  }

  connect(): void {
    if (this.username.trim()) {
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
}

