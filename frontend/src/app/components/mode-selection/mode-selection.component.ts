import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { GameService } from '../../services/game.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-mode-selection',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './mode-selection.component.html',
  styleUrls: ['./mode-selection.component.css']
})
export class ModeSelectionComponent implements OnInit, OnDestroy {
  private subscriptions = new Subscription();
  isConnected: boolean = false;

  constructor(
    private gameService: GameService,
    private router: Router
  ) {}

  ngOnInit(): void {
    // Check if we have a token - if yes, try to connect first
    const token = localStorage.getItem('snake_game_token');
    if (token) {
      // Token exists - try to connect with it
      console.log('Mode selection: Token found, attempting to connect...');
      this.gameService.connectWithToken(token);
    } else {
      // No token - redirect to login immediately
      this.router.navigate(['/login']);
      return;
    }

    // Listen for successful connection
    this.subscriptions.add(
      this.gameService.getCurrentPlayer().subscribe(player => {
        if (player) {
          this.isConnected = true;
        } else {
          // Player is null - check connection status after a delay
          setTimeout(() => {
            this.checkConnectionStatus();
          }, 3000);
        }
      })
    );

    // Listen for connection errors
    this.subscriptions.add(
      this.gameService.getConnectionError().subscribe(error => {
        if (error && (error.includes('INVALID_TOKEN') || error.includes('PLAYER_NOT_FOUND'))) {
          // Token is invalid - clear and redirect
          console.log('Mode selection: Invalid token, clearing and redirecting');
          localStorage.removeItem('snake_game_token');
          localStorage.removeItem('snake_game_access_token');
          this.router.navigate(['/login']);
        }
      })
    );

    // Listen for lobby players (multiplayer mode selected)
    this.subscriptions.add(
      this.gameService.getLobbyPlayers().subscribe(players => {
        if (players.length > 0) {
          // Multiplayer mode selected, navigate to lobby
          this.router.navigate(['/lobby']);
        }
      })
    );

    // Listen for single player game start
    this.subscriptions.add(
      this.gameService.getCurrentGameState().subscribe(state => {
        // Only navigate if game is not finished and has an ID
        if (state && state.id && state.status !== 'finished') {
          // Single player game started, navigate to game
          this.router.navigate(['/game/single', state.id]);
        }
      })
    );
  }

  private checkConnectionStatus(): void {
    // Check if we're still connecting or if connection failed
    this.gameService.getConnectionStatus().subscribe(status => {
      // If we're still connecting, wait a bit more
      if (status.step === 'connecting' && !status.completed) {
        setTimeout(() => {
          this.checkConnectionStatus();
        }, 2000);
        return;
      }

      // Not connecting - check if we have a player
      this.gameService.getCurrentPlayer().subscribe(player => {
        if (!player) {
          // No player and not connecting - token might be invalid
          const token = localStorage.getItem('snake_game_token');
          if (token) {
            console.log('Mode selection: Connection failed after timeout, clearing tokens');
            localStorage.removeItem('snake_game_token');
            localStorage.removeItem('snake_game_access_token');
          }
          this.router.navigate(['/login']);
        }
      }).unsubscribe();
    }).unsubscribe();
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  selectSinglePlayer(): void {
    this.gameService.startSinglePlayer();
  }

  selectMultiplayer(): void {
    this.gameService.joinLobby();
  }
}

