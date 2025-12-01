import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { GameService } from '../../services/game.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css']
})
export class LoginComponent implements OnInit, OnDestroy {
  username: string = '';
  errorMessage: string = '';
  isConnecting: boolean = false;
  private subscriptions = new Subscription();
  private readonly USERNAME_STORAGE_KEY = 'snake_game_username';

  constructor(
    private gameService: GameService,
    private router: Router
  ) {}

  ngOnInit(): void {
    // Check if token exists and is valid
    const token = localStorage.getItem('snake_game_token');
    if (token) {
      // Try to connect with token
      this.connectWithToken(token);
    } else {
      // Load saved username if exists
      const savedUsername = localStorage.getItem(this.USERNAME_STORAGE_KEY);
      if (savedUsername) {
        this.username = savedUsername;
      }
    }

    // Listen for connection errors
    this.subscriptions.add(
      this.gameService.getConnectionError().subscribe(error => {
        if (error) {
          this.errorMessage = error;
          this.isConnecting = false;
          // If error occurs with token, clear token and allow manual login
          if (error.includes('Player not found') || error.includes('Invalid token') || error.includes('INVALID_TOKEN')) {
            localStorage.removeItem('snake_game_token');
            this.errorMessage = 'Session expired. Please login again.';
          }
          this.gameService.clearConnectionError();
        }
      })
    );

    // Listen for error messages from WebSocket
    this.subscriptions.add(
      this.gameService.getBanner().subscribe(banner => {
        if (banner && banner.type === 'warning' && banner.message.includes('Player not found')) {
          // Token is invalid, clear it
          localStorage.removeItem('snake_game_token');
          this.isConnecting = false;
          this.errorMessage = 'Session expired. Please login again.';
        }
      })
    );

    // Listen for successful connection
    this.subscriptions.add(
      this.gameService.getCurrentPlayer().subscribe(player => {
        if (player) {
          // Connected successfully, navigate to mode selection
          this.isConnecting = false;
          setTimeout(() => {
            this.router.navigate(['/mode-selection']);
          }, 100);
        }
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  connectWithToken(token: string): void {
    this.isConnecting = true;
    this.errorMessage = '';
    
    // Connect using token via WebSocket
    this.gameService.connectWithToken(token);
  }

  connect(): void {
    if (!this.username.trim()) {
      this.errorMessage = 'Please enter a nickname';
      return;
    }

    this.isConnecting = true;
    this.errorMessage = '';
    
    // Save username
    localStorage.setItem(this.USERNAME_STORAGE_KEY, this.username);
    
    // Connect with username (will receive token on connection)
    this.gameService.connect(this.username);
  }

  onConnected(): void {
    // Navigate to mode selection after successful connection
    this.router.navigate(['/mode-selection']);
  }
}

