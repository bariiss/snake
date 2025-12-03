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
  private connectionStateSubject = new Subject<'connecting' | 'connected' | 'error' | 'closed'>();
  public connectionState$ = this.connectionStateSubject.asObservable();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 3000;
  private shouldReconnect = true;
  private playerId: string | null = null;
  private token: string | null = null;
  
  // Traffic tracking
  private bytesSent = 0;
  private bytesReceived = 0;

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
    
    // Clean up any existing connection first
    if (this.ws) {
      // Prevent reconnection attempts from old connection
      this.shouldReconnect = false;
      
      // Remove event handlers to prevent errors
      try {
        const oldWs = this.ws;
        const oldReadyState = oldWs.readyState;
        
        // Clear all handlers
        oldWs.onopen = null;
        oldWs.onmessage = null;
        oldWs.onerror = null;
        
        // Set onclose handler to clear ws reference when closed
        oldWs.onclose = () => {
          console.log('Old WebSocket connection closed');
        };
        
        // Close the connection if it's still open or connecting
        if (oldReadyState === WebSocket.OPEN || oldReadyState === WebSocket.CONNECTING) {
          try {
            oldWs.close(1000, 'Reconnecting');
          } catch (closeError) {
            console.warn('Error closing old WebSocket (ignored):', closeError);
          }
        }
      } catch (error) {
        // Ignore errors during cleanup
        console.warn('Error cleaning up old WebSocket connection (ignored):', error);
      }
      
      // Clear reference immediately
      this.ws = null;
    }
    
    // Setup new connection immediately (old connection cleanup is done)
    this.setupNewConnection(username, finalToken);
  }

  private setupNewConnection(username: string, token: string | null): void {
    // Reset state for new connection
    this.shouldReconnect = true;
    this.reconnectAttempts = 0;
    this.token = token;
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
      this.connectionStateSubject.next('connecting');

      this.ws.onopen = () => {
        console.log('WebSocket connected, readyState:', this.ws?.readyState);
        this.reconnectAttempts = 0;
        this.connectionStateSubject.next('connected');
      };

      this.ws.onmessage = (event) => {
        try {
          // Track received bytes
          const bytes = new Blob([event.data]).size;
          this.bytesReceived += bytes;
          
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
        // Only log error if connection was actually attempted (not during cleanup)
        if (this.shouldReconnect) {
          console.error('WebSocket error:', error);
          this.connectionStateSubject.next('error');
        }
      };

      this.ws.onclose = (event) => {
        console.log('WebSocket closed', event.code, event.reason);
        this.connectionStateSubject.next('closed');
        // Only attempt reconnect if:
        // 1. shouldReconnect is true (not manually disconnected)
        // 2. We haven't exceeded max attempts
        // 3. We have a token or username (don't reconnect with invalid tokens)
        // 4. The WebSocket instance is still the same (not cleaned up for new connection)
        if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts && this.ws !== null) {
          const hasToken = this.token || localStorage.getItem('snake_game_token');
          if (hasToken || username) {
            this.reconnectAttempts++;
            setTimeout(() => {
              // Check again before reconnecting (token might have been cleared, or new connection started)
              if (this.shouldReconnect && this.ws !== null && (this.token || localStorage.getItem('snake_game_token') || username)) {
                console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
                this.setupConnection(username);
              }
            }, this.reconnectDelay);
          } else {
            console.log('No token or username available, not reconnecting');
          }
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
      const messageStr = JSON.stringify(message);
      const bytes = new Blob([messageStr]).size;
      this.bytesSent += bytes;
      this.ws.send(messageStr);
    } else {
      // Only warn if we're supposed to be connected (not during disconnect/cleanup)
      if (this.shouldReconnect) {
        console.warn('WebSocket not open, message not sent:', message);
      }
    }
  }
  
  getBytesSent(): number {
    return this.bytesSent;
  }
  
  getBytesReceived(): number {
    return this.bytesReceived;
  }
  
  resetTrafficStats(): void {
    this.bytesSent = 0;
    this.bytesReceived = 0;
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.reconnectAttempts = this.maxReconnectAttempts; // Prevent any pending reconnects
    
    if (this.ws) {
      // Close WebSocket connection properly
      try {
        // Remove event handlers to prevent errors during close
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onerror = null;
        this.ws.onclose = null;
        
        if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
          this.ws.close(1000, 'Normal closure');
        }
      } catch (error) {
        // Ignore errors during disconnect - connection might already be closed
        console.warn('Error closing WebSocket (ignored):', error);
      } finally {
        this.ws = null;
      }
    }
    this.playerId = null;
    this.token = null;
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
    const port = window.location.port;

    // Development: Angular dev server (4200) -> Backend (8020)
    if (host === 'localhost' || host === '127.0.0.1') {
      if (port === '4200' || !port) {
        const url = `${protocol}//${host}:8020/ws`;
        console.log('WebSocket URL (dev):', url);
        return url;
      }
    }

    // Production or Docker: Use same hostname as frontend, but with backend port (8020)
    // This works for Docker Compose where frontend is on port 80 and backend on 8020
    // Never use 'backend' hostname - it's only valid inside Docker network, not in browser
    const url = `${protocol}//${host}:8020/ws`;
    console.log('WebSocket URL:', url, 'hostname:', host, 'production:', environment.production);
    return url;
  }
}

