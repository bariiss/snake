import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, combineLatest } from 'rxjs';
import { map } from 'rxjs/operators';
import { WebSocketService } from './websocket.service';
import { WebRTCService } from './webrtc.service';

export interface ConnectionStatus {
  websocket: {
    status: 'connected' | 'disconnected' | 'connecting' | 'error';
    readyState?: number;
  };
  webrtc: {
    status: 'connected' | 'disconnected' | 'connecting' | 'error';
    iceConnectionState?: string;
    connectionState?: string;
  };
  peerToPeer: {
    status: 'connected' | 'disconnected' | 'connecting' | 'error';
    iceConnectionState?: string;
    connectionState?: string;
  };
}

@Injectable({
  providedIn: 'root'
})
export class ConnectionStatusService {
  private websocketStatus$ = new BehaviorSubject<ConnectionStatus['websocket']>({
    status: 'disconnected'
  });
  private webrtcStatus$ = new BehaviorSubject<ConnectionStatus['webrtc']>({
    status: 'disconnected'
  });
  private peerToPeerStatus$ = new BehaviorSubject<ConnectionStatus['peerToPeer']>({
    status: 'disconnected'
  });
  private isEnabledSubject$ = new BehaviorSubject<boolean>(this.getStoredEnabledState());

  public connectionStatus$: Observable<ConnectionStatus>;
  public isEnabled$: Observable<boolean> = this.isEnabledSubject$.asObservable();

  constructor(
    private wsService: WebSocketService,
    private webrtcService: WebRTCService
  ) {
    // Combine all status observables
    this.connectionStatus$ = combineLatest([
      this.websocketStatus$,
      this.webrtcStatus$,
      this.peerToPeerStatus$
    ]).pipe(
      map(([websocket, webrtc, peerToPeer]) => ({
        websocket,
        webrtc,
        peerToPeer
      }))
    );

    this.startMonitoring();
  }

  private getStoredEnabledState(): boolean {
    const stored = localStorage.getItem('connection_status_enabled');
    return stored === 'true';
  }

  toggle(): void {
    const current = this.isEnabledSubject$.value;
    const newValue = !current;
    this.isEnabledSubject$.next(newValue);
    localStorage.setItem('connection_status_enabled', String(newValue));
  }

  isEnabled(): boolean {
    return this.isEnabledSubject$.value;
  }

  private startMonitoring(): void {
    // Monitor WebSocket status
    this.monitorWebSocket();
    
    // Monitor WebRTC status
    this.monitorWebRTC();
    
    // Monitor Peer-to-Peer status
    this.monitorPeerToPeer();
  }

  private monitorWebSocket(): void {
    // Check WebSocket status periodically
    setInterval(() => {
      if (this.wsService.isConnected()) {
        const ws = (this.wsService as any).ws;
        const readyState = ws?.readyState;
        let status: ConnectionStatus['websocket']['status'];
        
        switch (readyState) {
          case WebSocket.CONNECTING:
            status = 'connecting';
            break;
          case WebSocket.OPEN:
            status = 'connected';
            break;
          case WebSocket.CLOSING:
          case WebSocket.CLOSED:
            status = 'disconnected';
            break;
          default:
            status = 'disconnected';
        }
        
        this.websocketStatus$.next({
          status,
          readyState
        });
      } else {
        this.websocketStatus$.next({
          status: 'disconnected'
        });
      }
    }, 1000);
  }

  private monitorWebRTC(): void {
    // Check WebRTC status periodically
    setInterval(() => {
      const pc = (this.webrtcService as any).peerConnection;
      if (pc) {
        const iceConnectionState = pc.iceConnectionState;
        const connectionState = pc.connectionState;
        let status: ConnectionStatus['webrtc']['status'];
        
        switch (connectionState) {
          case 'connected':
            status = 'connected';
            break;
          case 'connecting':
            status = 'connecting';
            break;
          case 'failed':
          case 'disconnected':
            status = 'error';
            break;
          default:
            status = 'disconnected';
        }
        
        this.webrtcStatus$.next({
          status,
          iceConnectionState,
          connectionState
        });
      } else {
        this.webrtcStatus$.next({
          status: 'disconnected'
        });
      }
    }, 1000);
  }

  private monitorPeerToPeer(): void {
    // Check Peer-to-Peer status periodically
    setInterval(() => {
      if (this.webrtcService.isPeerConnected()) {
        const pc = (this.webrtcService as any).peerToPeerConnection;
        const iceConnectionState = pc?.iceConnectionState;
        const connectionState = pc?.connectionState;
        let status: ConnectionStatus['peerToPeer']['status'];
        
        switch (connectionState) {
          case 'connected':
            status = 'connected';
            break;
          case 'connecting':
            status = 'connecting';
            break;
          case 'failed':
          case 'disconnected':
            status = 'error';
            break;
          default:
            status = 'disconnected';
        }
        
        this.peerToPeerStatus$.next({
          status,
          iceConnectionState,
          connectionState
        });
      } else {
        const pc = (this.webrtcService as any).peerToPeerConnection;
        if (pc) {
          // Connection exists but not connected
          const connectionState = pc.connectionState;
          let status: ConnectionStatus['peerToPeer']['status'];
          
          switch (connectionState) {
            case 'connecting':
            case 'new':
              status = 'connecting';
              break;
            case 'failed':
              status = 'error';
              break;
            default:
              status = 'disconnected';
          }
          
          this.peerToPeerStatus$.next({
            status,
            iceConnectionState: pc.iceConnectionState,
            connectionState
          });
        } else {
          this.peerToPeerStatus$.next({
            status: 'disconnected'
          });
        }
      }
    }, 1000);
  }
}