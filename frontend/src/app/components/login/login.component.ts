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
  private connectionTimeout: any = null;

  constructor(
    private gameService: GameService,
    private router: Router
  ) {}

  ngOnInit(): void {
    // Check if token exists and is valid
    const token = localStorage.getItem('snake_game_token');
    const savedUsername = localStorage.getItem(this.USERNAME_STORAGE_KEY);
    
    // Clear any existing connection errors first
    this.gameService.clearConnectionError();
    
    if (token) {
      // Try to connect with token
      this.isConnecting = true;
      this.errorMessage = '';
      this.connectWithToken(token);
      
      // Set timeout - if connection doesn't succeed within 5 seconds, clear token and show login form
      this.connectionTimeout = setTimeout(() => {
        if (this.isConnecting) {
          // Still connecting after timeout, clear token and allow manual login
          // Disconnect any ongoing connection attempts
          this.gameService.disconnect();
          localStorage.removeItem('snake_game_token');
          localStorage.removeItem('snake_game_access_token');
          this.isConnecting = false;
          this.errorMessage = 'Connection timeout. Please login again.';
          if (savedUsername) {
            this.username = savedUsername;
          }
        }
      }, 5000);
    } else {
      // Load saved username if exists
      if (savedUsername) {
        this.username = savedUsername;
      }
    }

    // Listen for successful connection (also clears timeout)
    this.subscriptions.add(
      this.gameService.getCurrentPlayer().subscribe(player => {
        if (player && this.isConnecting) {
          // Connected successfully, clear timeout and navigate to mode selection
          if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
            this.connectionTimeout = null;
          }
          this.isConnecting = false;
          setTimeout(() => {
            this.router.navigate(['/mode-selection']);
          }, 100);
        }
      })
    );

    // Listen for connection errors
    this.subscriptions.add(
      this.gameService.getConnectionError().subscribe(error => {
        if (error) {
          // Don't show error if it's a logout message
          if (error.includes('Successfully logged out') || error.includes('logged out')) {
            this.errorMessage = '';
            this.isConnecting = false;
            this.gameService.clearConnectionError();
            return;
          }
          
          this.errorMessage = error;
          this.isConnecting = false;
          // If error occurs with token, try access token first, then clear and allow manual login
          if (error.includes('Player not found') || error.includes('Invalid token') || error.includes('INVALID_TOKEN') || error.includes('PLAYER_NOT_FOUND')) {
            const currentToken = localStorage.getItem('snake_game_token');
            const accessToken = localStorage.getItem('snake_game_access_token');
            if (accessToken && accessToken !== currentToken) {
              // Try to reconnect with access token (only once)
              this.isConnecting = true;
              this.connectWithToken(accessToken);
              return;
            }
            // No access token or same as current token, clear both and allow manual login
            if (this.connectionTimeout) {
              clearTimeout(this.connectionTimeout);
              this.connectionTimeout = null;
            }
            localStorage.removeItem('snake_game_token');
            localStorage.removeItem('snake_game_access_token');
            this.errorMessage = 'Session expired. Please login again.';
            this.isConnecting = false; // Stop trying to connect
            if (savedUsername) {
              this.username = savedUsername;
            }
          }
          this.gameService.clearConnectionError();
        }
      })
    );

    // Listen for error messages from WebSocket
    this.subscriptions.add(
      this.gameService.getBanner().subscribe(banner => {
        if (banner && banner.type === 'warning' && (banner.message.includes('Player not found') || banner.message.includes('Invalid token'))) {
          // Token is invalid, try access token first
          const accessToken = localStorage.getItem('snake_game_access_token');
          if (accessToken && accessToken !== token) {
            // Try to reconnect with access token
            this.isConnecting = true;
            this.connectWithToken(accessToken);
            return;
          }
          // No access token or same as current token, clear both
          if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
            this.connectionTimeout = null;
          }
          localStorage.removeItem('snake_game_token');
          localStorage.removeItem('snake_game_access_token');
          this.isConnecting = false;
          this.errorMessage = 'Session expired. Please login again.';
          if (savedUsername) {
            this.username = savedUsername;
          }
        }
      })
    );

  }

  ngOnDestroy(): void {
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
    }
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

