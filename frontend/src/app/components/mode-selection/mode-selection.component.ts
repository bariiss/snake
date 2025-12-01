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
    // Check if connected
    this.subscriptions.add(
      this.gameService.getCurrentPlayer().subscribe(player => {
        this.isConnected = !!player;
        if (!player) {
          // Not connected - clear any invalid tokens before redirecting
          // This prevents login component from trying to auto-connect with invalid token
          const token = localStorage.getItem('snake_game_token');
          if (token) {
            // Token exists but player is not connected - token is invalid
            localStorage.removeItem('snake_game_token');
            localStorage.removeItem('snake_game_access_token');
          }
          // Redirect to login
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
        if (state && state.id) {
          // Single player game started, navigate to game
          this.router.navigate(['/game/single', state.id]);
        }
      })
    );
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

