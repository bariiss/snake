import { Injectable } from '@angular/core';
import { Subject, Observable } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class WebSocketService {
  private ws: WebSocket | null = null;
  private messageSubject = new Subject<any>();
  public messages$ = this.messageSubject.asObservable();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 3000;
  private shouldReconnect = true;
  private playerId: string | null = null;
  private token: string | null = null;

  connect(username: string, token?: string): void {
    // If no token provided and no token in storage, only allow connection for initial login
    // After initial login, token is required
    const storedToken = localStorage.getItem('snake_game_token');
    const finalToken = token || storedToken;
    
    // If we have a stored token but trying to connect without it, require token
    if (storedToken && !token && !username) {
      console.warn('Token required for WebSocket connection');
      return;
    }
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.shouldReconnect = true;
    this.reconnectAttempts = 0;
    this.token = finalToken;
    this.setupConnection(username);
  }

  setToken(token: string): void {
    this.token = token;
    localStorage.setItem('snake_game_token', token);
  }

  getToken(): string | null {
    return this.token || localStorage.getItem('snake_game_token');
  }

  private setupConnection(username: string): void {
    try {
      let wsUrl = this.getWebSocketUrl();
      if (this.token) {
        // Use token for authentication
        wsUrl += `?token=${encodeURIComponent(this.token)}`;
      } else if (username) {
        // Fallback to username (only for initial login, before token is received)
        wsUrl += `?username=${encodeURIComponent(username)}`;
      } else {
        // No token and no username - cannot connect
        console.error('Cannot connect: Token or username required');
        return;
      }
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('WebSocket connected');
        this.reconnectAttempts = 0;
      };

      this.ws.onmessage = (event) => {
        try {
          // Split by newline in case multiple messages are concatenated
          const messages = event.data.split('\n').filter((m: string) => m.trim());
          messages.forEach((msg: string) => {
            const message = JSON.parse(msg);
            this.messageSubject.next(message);
          });
        } catch (error) {
          console.error('Error parsing WebSocket message:', error, 'Raw data:', event.data);
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

      this.ws.onclose = (event) => {
        console.log('WebSocket closed', event.code, event.reason);
        if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          setTimeout(() => {
            console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
            this.setupConnection(username);
          }, this.reconnectDelay);
        }
      };
    } catch (error) {
      console.error('Error setting up WebSocket:', error);
      if (this.shouldReconnect) {
        this.attemptReconnect(username);
      }
    }
  }

  send(message: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn('WebSocket not open, message not sent:', message);
    }
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.ws) {
      this.ws.close(1000, 'Normal closure');
      this.ws = null;
    }
    this.playerId = null;
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  getPlayerId(): string | null {
    return this.playerId;
  }

  setPlayerId(id: string): void {
    this.playerId = id;
  }

  private attemptReconnect(username: string): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      setTimeout(() => {
        console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
        this.setupConnection(username);
      }, this.reconnectDelay);
    } else {
      console.error('Max reconnection attempts reached');
    }
  }

  private getWebSocketUrl(): string {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname;

    // Development: Angular dev server (4200) -> Backend (8020)
    if (host === 'localhost' || host === '127.0.0.1') {
      if (window.location.port === '4200' || !window.location.port) {
        return `${protocol}//${host}:8020/ws`;
      }
    }

    // Production: Use environment or default to same host
    if (environment.production) {
      const apiUrl = environment.apiUrl || `${protocol === 'wss:' ? 'https:' : 'http:'}//${host}`;
      const baseUrl = apiUrl.replace('/api', '').replace('http://', '').replace('https://', '');
      return `${protocol}//${baseUrl}/ws`;
    }

    // Default: Use port 8020 (backend port)
    return `${protocol}//${host}:8020/ws`;
  }
}

