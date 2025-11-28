import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';
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

  connect(username: string): void {
    // Disconnect existing connection if any
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.shouldReconnect = true;
    
    const wsUrl = this.getWebSocketUrl();
    const url = `${wsUrl}/ws?username=${encodeURIComponent(username)}`;
    
    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        console.log('WebSocket connected');
        this.reconnectAttempts = 0;
      };

      this.ws.onmessage = (event) => {
        try {
          // Backend may send multiple JSON messages separated by newlines
          const data = event.data;
          if (typeof data === 'string') {
            // Split by newlines and parse each message
            const messages = data.split('\n').filter(line => line.trim().length > 0);
            for (const messageStr of messages) {
              try {
                const message = JSON.parse(messageStr);
                this.messageSubject.next(message);
              } catch (parseError) {
                console.error('Error parsing individual message:', parseError, 'Data:', messageStr);
              }
            }
          } else {
            // Handle Blob or ArrayBuffer if needed
            const message = JSON.parse(data);
            this.messageSubject.next(message);
          }
        } catch (error) {
          console.error('Error parsing message:', error, 'Raw data:', event.data);
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

      this.ws.onclose = (event) => {
        console.log('WebSocket closed', event.code, event.reason);
        // Only attempt reconnect if not a normal closure
        if (this.shouldReconnect && event.code !== 1000 && event.code !== 1001) {
          this.attemptReconnect(username);
        }
      };
    } catch (error) {
      console.error('Error connecting to WebSocket:', error);
    }
  }

  private attemptReconnect(username: string): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      setTimeout(() => {
        console.log(`Reconnecting attempt ${this.reconnectAttempts}...`);
        this.connect(username);
      }, this.reconnectDelay);
    } else {
      console.error('Max reconnection attempts reached');
    }
  }

  send(message: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.error('WebSocket is not connected');
    }
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.reconnectAttempts = 0;
    if (this.ws) {
      try {
        this.ws.close(1000, 'client disconnect');
      } catch (error) {
        console.error('Error closing WebSocket:', error);
      }
      this.ws = null;
    }
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  private getWebSocketUrl(): string {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname;
    
    // Development: Angular dev server (4200) -> Backend (8020)
    if (host === 'localhost' || host === '127.0.0.1') {
      // Check if we're in development mode (Angular dev server)
      if (window.location.port === '4200' || !window.location.port) {
        return `${protocol}//${host}:8020`;
      }
    }
    
    // Production: Browser'dan backend'e doğrudan erişim
    // Docker Compose'da backend 8020 portunda expose edilmiş
    // Eğer frontend ve backend aynı host'ta ise backend portunu kullan
    if (environment.production) {
      // Production'da environment'dan al, yoksa host:8020 kullan
      if (environment.wsUrl && !environment.wsUrl.includes('backend')) {
        return environment.wsUrl;
      }
      // Browser'dan erişilebilir backend URL'i
      return `${protocol}//${host}:8020`;
    }
    
    // Development fallback
    return environment.wsUrl || `${protocol}//${host}:8020`;
  }
}

