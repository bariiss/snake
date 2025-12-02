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
      
      // Wait a bit for connection to establish, then check
      setTimeout(() => {
        this.checkConnection();
      }, 2000);
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
        if (state && state.id) {
          // Single player game started, navigate to game
          this.router.navigate(['/game/single', state.id]);
        }
      })
    );
  }

  private checkConnection(): void {
    // Check connection status first
    this.subscriptions.add(
      this.gameService.getConnectionStatus().subscribe(status => {
        // If we're still connecting, wait a bit more
        if (status.step === 'connecting' && !status.completed) {
          setTimeout(() => {
            this.verifyConnection();
          }, 3000);
          return;
        }
        
        // Check if we have a player
        this.verifyConnection();
      })
    );
  }

  private verifyConnection(): void {
    this.gameService.getCurrentPlayer().subscribe(player => {
      if (player) {
        this.isConnected = true;
        // Connected successfully, stay on mode selection page
        return;
      }

      // Not connected - check if we're still trying to connect
      this.gameService.getConnectionStatus().subscribe(status => {
        if (status.step === 'connecting' && !status.completed) {
          // Still connecting, wait a bit more
          setTimeout(() => {
            this.verifyConnection();
          }, 2000);
          return;
        }

        // Not connecting or connection failed - clear tokens and redirect
        const token = localStorage.getItem('snake_game_token');
        if (token) {
          console.log('Mode selection: Connection failed, clearing tokens');
          localStorage.removeItem('snake_game_token');
          localStorage.removeItem('snake_game_access_token');
        }
        this.router.navigate(['/login']);
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

