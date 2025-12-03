import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, combineLatest } from 'rxjs';
import { map } from 'rxjs/operators';
import { WebSocketService } from './websocket.service';
import { WebRTCService } from './webrtc.service';

export interface ConnectionStatus {
  websocket: {
    status: 'connected' | 'disconnected' | 'connecting' | 'error';
    readyState?: number;
    bytesSent?: number;
    bytesReceived?: number;
  };
  webrtc: {
    status: 'connected' | 'disconnected' | 'connecting' | 'error';
    iceConnectionState?: string;
    connectionState?: string;
    bytesSent?: number;
    bytesReceived?: number;
  };
  peerToPeer: {
    status: 'connected' | 'disconnected' | 'connecting' | 'error';
    iceConnectionState?: string;
    connectionState?: string;
    bytesSent?: number;
    bytesReceived?: number;
    localIP?: string;
    localPort?: number;
    remoteIP?: string;
    remotePort?: number;
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
      const ws = (this.wsService as any).ws;
      if (ws) {
        const readyState = ws.readyState;
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
          readyState,
          bytesSent: this.wsService.getBytesSent(),
          bytesReceived: this.wsService.getBytesReceived()
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
    // Check both peerConnection (legacy) and peerToPeerConnection (active during games)
    setInterval(async () => {
      const pc = (this.webrtcService as any).peerConnection;
      const p2pPc = (this.webrtcService as any).peerToPeerConnection;
      
      // Prefer peerToPeerConnection if it exists (active during games)
      const activePc = p2pPc || pc;
      
      if (activePc) {
        const iceConnectionState = activePc.iceConnectionState;
        const connectionState = activePc.connectionState;
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
        
        // Get traffic stats from WebRTC stats API
        let bytesSent = 0;
        let bytesReceived = 0;
        try {
          const stats = await activePc.getStats();
          stats.forEach((report: any) => {
            if (report.type === 'transport') {
              bytesSent += report.bytesSent || 0;
              bytesReceived += report.bytesReceived || 0;
            }
          });
        } catch (error) {
          // Stats not available yet
        }
        
        this.webrtcStatus$.next({
          status,
          iceConnectionState,
          connectionState,
          bytesSent,
          bytesReceived
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
    setInterval(async () => {
      if (this.webrtcService.isPeerConnected()) {
        const pc = (this.webrtcService as any).peerToPeerConnection;
        const dataChannel = (this.webrtcService as any).peerToPeerDataChannel;
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
        
        // Get traffic stats from WebRTC stats API and DataChannel
        let bytesSent = 0;
        let bytesReceived = 0;
        let localIP: string | undefined;
        let localPort: number | undefined;
        let remoteIP: string | undefined;
        let remotePort: number | undefined;
        
        try {
          const stats = await pc.getStats();
          stats.forEach((report: any) => {
            if (report.type === 'data-channel' && report.label === 'game') {
              bytesSent += report.bytesSent || 0;
              bytesReceived += report.bytesReceived || 0;
            }
            // Get IP and port from candidate-pair
            if (report.type === 'candidate-pair' && report.state === 'succeeded') {
              // Find local candidate
              const localCandidate = Array.from(stats.values()).find((r: any) => 
                r.type === 'local-candidate' && r.id === report.localCandidateId
              ) as any;
              if (localCandidate) {
                localIP = localCandidate.ip || localCandidate.address;
                localPort = localCandidate.port;
              }
              // Find remote candidate
              const remoteCandidate = Array.from(stats.values()).find((r: any) => 
                r.type === 'remote-candidate' && r.id === report.remoteCandidateId
              ) as any;
              if (remoteCandidate) {
                remoteIP = remoteCandidate.ip || remoteCandidate.address;
                remotePort = remoteCandidate.port;
              }
            }
          });
        } catch (error) {
          // Stats not available yet
        }
        
        this.peerToPeerStatus$.next({
          status,
          iceConnectionState,
          connectionState,
          bytesSent,
          bytesReceived,
          localIP,
          localPort,
          remoteIP,
          remotePort
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