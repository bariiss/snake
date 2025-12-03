import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class WebRTCService {
  // Server-client connection (for lobby, matchmaking)
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private messageSubject = new Subject<any>();
  public messages$ = this.messageSubject.asObservable();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 3000;
  private shouldReconnect = true;
  private playerId: string | null = null;
  
  setPlayerId(id: string): void {
    this.playerId = id;
  }
  
  getPlayerId(): string | null {
    return this.playerId;
  }

  // Peer-to-peer connection (for game)
  private peerToPeerConnection: RTCPeerConnection | null = null;
  private peerToPeerDataChannel: RTCDataChannel | null = null;
  private peerToPeerMessageSubject = new Subject<any>();
  public peerToPeerMessages$ = this.peerToPeerMessageSubject.asObservable();
  private peerPlayerId: string | null = null;

  connect(username: string, token?: string): void {
    // WebRTC requires token for authentication
    const finalToken = token || localStorage.getItem('snake_game_token');
    if (!finalToken) {
      console.warn('Token required for WebRTC connection');
      return;
    }
    this.shouldReconnect = true;
    this.setupPeerConnection(username, finalToken);
  }

  private async setupPeerConnection(username: string, token: string): Promise<void> {
    try {
      // Create peer connection with STUN and TURN servers
      const configuration = this.getICEConfiguration();

      this.peerConnection = new RTCPeerConnection(configuration);

      // Create data channel
      this.dataChannel = this.peerConnection.createDataChannel('game', {
        ordered: true
      });

      this.setupDataChannel();

      // Handle ICE candidates
      this.peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          console.log('ICE Candidate:', event.candidate.candidate);
        } else {
          console.log('ICE Candidate gathering completed');
        }
      };

      // Handle ICE connection state
      this.peerConnection.oniceconnectionstatechange = () => {
        console.log('ICE Connection State:', this.peerConnection?.iceConnectionState);
      };

      // Handle ICE gathering state
      this.peerConnection.onicegatheringstatechange = () => {
        console.log('ICE Gathering State:', this.peerConnection?.iceGatheringState);
      };

      // Handle connection state changes
      this.peerConnection.onconnectionstatechange = () => {
        const state = this.peerConnection?.connectionState;
        console.log('WebRTC connection state:', state);
        
        if (state === 'disconnected' || state === 'failed') {
          console.error('WebRTC connection failed. ICE state:', this.peerConnection?.iceConnectionState);
          if (this.shouldReconnect) {
            this.attemptReconnect(username, token);
          }
        }
      };

      // Create offer
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);

      // Send offer to server with token
      const response = await fetch(this.getWebRTCUrl() + '/webrtc/offer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          username: username,
          offer: {
            type: offer.type,
            sdp: offer.sdp
          }
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      this.playerId = data.player_id;

      // Set remote description (answer from server)
      // Validate SDP format before setting
      if (!data.answer || !data.answer.sdp || typeof data.answer.sdp !== 'string') {
        throw new Error('Invalid answer format from server');
      }
      
      const answer: RTCSessionDescriptionInit = {
        type: 'answer' as RTCSdpType,
        sdp: data.answer.sdp
      };
      
      await this.peerConnection.setRemoteDescription(answer);

      console.log('WebRTC connected');
      this.reconnectAttempts = 0;
    } catch (error) {
      console.error('Error setting up WebRTC:', error);
      // Only attempt reconnect if we're in a multiplayer game context
      // For single player games or initial connection, don't reconnect
      // WebRTC is only needed for peer-to-peer multiplayer communication
      if (this.shouldReconnect && this.playerId) {
        // Only reconnect if we have a playerId (meaning we're in a game)
        this.attemptReconnect(username, token);
      } else {
        console.log('WebRTC connection not needed (single player or not in game), stopping reconnect attempts');
        this.shouldReconnect = false;
      }
    }
  }

  private setupDataChannel(): void {
    if (!this.dataChannel) return;

    this.dataChannel.onopen = () => {
      console.log('DataChannel opened');
    };

    this.dataChannel.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        this.messageSubject.next(message);
      } catch (error) {
        console.error('Error parsing WebRTC message:', error);
      }
    };

    this.dataChannel.onerror = (error) => {
      console.error('DataChannel error:', error);
    };

    this.dataChannel.onclose = () => {
      console.log('DataChannel closed');
    };
  }

  send(message: any): void {
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      this.dataChannel.send(JSON.stringify(message));
    } else {
      console.warn('DataChannel not open, message not sent:', message);
    }
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    this.playerId = null;
  }

  isConnected(): boolean {
    return this.dataChannel !== null && 
           this.dataChannel.readyState === 'open' &&
           this.peerConnection !== null &&
           this.peerConnection.connectionState === 'connected';
  }

  private attemptReconnect(username: string, token: string): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      setTimeout(() => {
        console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
        this.setupPeerConnection(username, token);
      }, this.reconnectDelay);
    } else {
      console.error('Max reconnection attempts reached');
    }
  }

  // Peer-to-peer methods
  async connectToPeer(peerPlayerId: string, isInitiator: boolean): Promise<void> {
    try {
      const configuration = this.getICEConfiguration();

      this.peerToPeerConnection = new RTCPeerConnection(configuration);
      this.peerPlayerId = peerPlayerId;
      this.addedCandidates.clear(); // Clear previous candidates when starting new connection

      // Handle incoming data channel (for non-initiator)
      if (!isInitiator) {
        this.peerToPeerConnection.ondatachannel = (event) => {
          this.peerToPeerDataChannel = event.channel;
          this.setupPeerToPeerDataChannel();
        };
      } else {
        // Create data channel (for initiator)
        this.peerToPeerDataChannel = this.peerToPeerConnection.createDataChannel('game', {
          ordered: true
        });
        this.setupPeerToPeerDataChannel();
      }

      // Handle ICE candidates
      this.peerToPeerConnection.onicecandidate = async (event) => {
        if (event.candidate) {
          console.log('Peer-to-peer ICE Candidate:', event.candidate.candidate);
          // Send ICE candidate to server for forwarding
          await this.sendICECandidateToServer(peerPlayerId, event.candidate);
        } else {
          console.log('Peer-to-peer ICE Candidate gathering completed');
        }
      };

      // Handle ICE connection state
      this.peerToPeerConnection.oniceconnectionstatechange = () => {
        console.log('Peer-to-peer ICE Connection State:', this.peerToPeerConnection?.iceConnectionState);
      };

      // Handle connection state
      this.peerToPeerConnection.onconnectionstatechange = () => {
        const state = this.peerToPeerConnection?.connectionState;
        console.log('Peer-to-peer connection state:', state);
        
        if (state === 'connected') {
          console.log('Peer-to-peer connection established!');
        } else if (state === 'disconnected' || state === 'failed') {
          console.error('Peer-to-peer connection failed');
        }
      };

      if (isInitiator) {
        // Create offer
        const offer = await this.peerToPeerConnection.createOffer();
        await this.peerToPeerConnection.setLocalDescription(offer);

        // Send offer to server for forwarding
        await this.sendOfferToServer(peerPlayerId, offer);
      }
    } catch (error) {
      console.error('Error setting up peer-to-peer connection:', error);
    }
  }

  async handlePeerOffer(offer: any): Promise<void> {
    // Ensure playerId is set before handling offer
    if (!this.playerId) {
      console.warn('Player ID not set in WebRTC service, cannot handle peer offer');
      return;
    }

    if (!this.peerToPeerConnection) {
      // Initialize peer-to-peer connection if not already done
      // This happens when we receive an offer before we initiate
      const configuration = this.getICEConfiguration();

      this.peerToPeerConnection = new RTCPeerConnection(configuration);
      this.peerPlayerId = offer.from_player_id;
      this.addedCandidates.clear(); // Clear previous candidates when starting new connection

      // Handle incoming data channel
      this.peerToPeerConnection.ondatachannel = (event) => {
        this.peerToPeerDataChannel = event.channel;
        this.setupPeerToPeerDataChannel();
      };

      // Handle ICE candidates
      this.peerToPeerConnection.onicecandidate = async (event) => {
        if (event.candidate) {
          console.log('Peer-to-peer ICE Candidate:', event.candidate.candidate);
          await this.sendICECandidateToServer(offer.from_player_id, event.candidate);
        } else {
          console.log('Peer-to-peer ICE Candidate gathering completed');
        }
      };

      // Handle ICE connection state
      this.peerToPeerConnection.oniceconnectionstatechange = () => {
        console.log('Peer-to-peer ICE Connection State:', this.peerToPeerConnection?.iceConnectionState);
      };

      // Handle connection state
      this.peerToPeerConnection.onconnectionstatechange = () => {
        const state = this.peerToPeerConnection?.connectionState;
        console.log('Peer-to-peer connection state:', state);
        
        if (state === 'connected') {
          console.log('Peer-to-peer connection established!');
        } else if (state === 'disconnected' || state === 'failed') {
          console.error('Peer-to-peer connection failed');
        }
      };
    }

    try {
      // Validate offer format
      if (!offer.offer || !offer.offer.sdp || typeof offer.offer.sdp !== 'string') {
        throw new Error('Invalid offer format');
      }
      
      const offerDesc: RTCSessionDescriptionInit = {
        type: 'offer' as RTCSdpType,
        sdp: offer.offer.sdp
      };
      
      await this.peerToPeerConnection.setRemoteDescription(offerDesc);

      // Create answer
      const answer = await this.peerToPeerConnection.createAnswer();
      await this.peerToPeerConnection.setLocalDescription(answer);

      // Send answer to server for forwarding
      await this.sendAnswerToServer(offer.from_player_id, answer);
    } catch (error) {
      console.error('Error handling peer offer:', error);
    }
  }

  async handlePeerAnswer(answer: any): Promise<void> {
    if (!this.peerToPeerConnection) {
      console.error('Peer-to-peer connection not initialized');
      return;
    }

    try {
      // Validate answer format
      if (!answer.answer || !answer.answer.sdp || typeof answer.answer.sdp !== 'string') {
        throw new Error('Invalid answer format');
      }
      
      const answerDesc: RTCSessionDescriptionInit = {
        type: 'answer' as RTCSdpType,
        sdp: answer.answer.sdp
      };
      
      await this.peerToPeerConnection.setRemoteDescription(answerDesc);
    } catch (error) {
      console.error('Error handling peer answer:', error);
    }
  }

  private addedCandidates = new Set<string>(); // Track added candidates to prevent duplicates

  async handleICECandidate(candidate: any): Promise<void> {
    if (!this.peerToPeerConnection) {
      console.error('Peer-to-peer connection not initialized');
      return;
    }

    // Check connection state - don't add candidates if connection is not in a valid state
    const connectionState = this.peerToPeerConnection.connectionState;
    if (connectionState === 'closed' || connectionState === 'failed' || connectionState === 'disconnected') {
      console.warn('Cannot add ICE candidate - connection state is:', connectionState);
      return;
    }

    // Check if candidate is null or empty (end-of-candidates marker)
    if (!candidate || !candidate.candidate || candidate.candidate.trim() === '') {
      // This is the end-of-candidates marker, try to add it
      try {
        await this.peerToPeerConnection.addIceCandidate(undefined);
      } catch (error) {
        // Ignore errors for end-of-candidates marker
        console.debug('End-of-candidates marker (ignored):', error);
      }
      return;
    }

    // Create a unique key for this candidate to prevent duplicates
    const candidateKey = `${candidate.sdpMid || ''}_${candidate.sdpMLineIndex || ''}_${candidate.candidate}`;
    
    if (this.addedCandidates.has(candidateKey)) {
      console.debug('Skipping duplicate ICE candidate:', candidateKey);
      return;
    }

    try {
      await this.peerToPeerConnection.addIceCandidate({
        candidate: candidate.candidate,
        sdpMLineIndex: candidate.sdpMLineIndex,
        sdpMid: candidate.sdpMid
      } as RTCIceCandidateInit);
      
      // Mark candidate as added
      this.addedCandidates.add(candidateKey);
    } catch (error: any) {
      // Check if error is due to connection state change (common and harmless)
      if (error?.message?.includes('closed') || 
          error?.message?.includes('failed') ||
          error?.message?.includes('disconnected') ||
          this.peerToPeerConnection.connectionState === 'disconnected') {
        console.debug('ICE candidate not added - connection state changed:', error.message);
      } else {
        console.warn('Error handling ICE candidate:', error, 'candidate:', candidate);
      }
    }
  }

  private setupPeerToPeerDataChannel(): void {
    if (!this.peerToPeerDataChannel) return;

    this.peerToPeerDataChannel.onopen = () => {
      console.log('Peer-to-peer DataChannel opened');
    };

    this.peerToPeerDataChannel.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        this.peerToPeerMessageSubject.next(message);
      } catch (error) {
        console.error('Error parsing peer-to-peer message:', error);
      }
    };

    this.peerToPeerDataChannel.onerror = (error) => {
      console.error('Peer-to-peer DataChannel error:', error);
    };

    this.peerToPeerDataChannel.onclose = () => {
      console.log('Peer-to-peer DataChannel closed');
    };
  }

  sendToPeer(message: any): void {
    if (this.peerToPeerDataChannel && this.peerToPeerDataChannel.readyState === 'open') {
      this.peerToPeerDataChannel.send(JSON.stringify(message));
    } else {
      console.warn('Peer-to-peer DataChannel not open, message not sent:', message);
    }
  }

  private async sendOfferToServer(toPlayerId: string, offer: RTCSessionDescriptionInit): Promise<void> {
    // Ensure playerId is set before sending
    if (!this.playerId) {
      console.warn('Player ID not set in WebRTC service, cannot send offer');
      return;
    }

    const response = await fetch(this.getWebRTCUrl() + '/webrtc/peer/offer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from_player_id: this.playerId,
        to_player_id: toPlayerId,
        offer: {
          type: offer.type,
          sdp: offer.sdp
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to send offer: ${response.status}`);
    }
  }

  private async sendAnswerToServer(toPlayerId: string, answer: RTCSessionDescriptionInit): Promise<void> {
    // Ensure playerId is set before sending
    if (!this.playerId) {
      console.warn('Player ID not set in WebRTC service, cannot send answer');
      return;
    }

    const response = await fetch(this.getWebRTCUrl() + '/webrtc/peer/answer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from_player_id: this.playerId,
        to_player_id: toPlayerId,
        answer: {
          type: answer.type,
          sdp: answer.sdp
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to send answer: ${response.status}`);
    }
  }

  private async sendICECandidateToServer(toPlayerId: string, candidate: RTCIceCandidate): Promise<void> {
    // Ensure playerId is set before sending
    if (!this.playerId) {
      console.warn('Player ID not set in WebRTC service, cannot send ICE candidate');
      return;
    }

    const response = await fetch(this.getWebRTCUrl() + '/webrtc/peer/ice', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from_player_id: this.playerId,
        to_player_id: toPlayerId,
        candidate: candidate.candidate,
        sdpMLineIndex: candidate.sdpMLineIndex,
        sdpMid: candidate.sdpMid
      })
    });

    if (!response.ok) {
      console.error(`Failed to send ICE candidate: ${response.status}`);
    }
  }

  disconnectPeer(): void {
    if (this.peerToPeerDataChannel) {
      this.peerToPeerDataChannel.close();
      this.peerToPeerDataChannel = null;
    }
    if (this.peerToPeerConnection) {
      this.peerToPeerConnection.close();
      this.peerToPeerConnection = null;
    }
    this.peerPlayerId = null;
  }

  isPeerConnected(): boolean {
    return this.peerToPeerDataChannel !== null && 
           this.peerToPeerDataChannel.readyState === 'open' &&
           this.peerToPeerConnection !== null &&
           this.peerToPeerConnection.connectionState === 'connected';
  }

  private getWebRTCUrl(): string {
    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
    const host = window.location.hostname;
    
    // Development: Angular dev server (4200) -> Backend (8020)
    if (host === 'localhost' || host === '127.0.0.1') {
      // Check if we're in development mode (Angular dev server)
      if (window.location.port === '4200' || !window.location.port) {
        const url = `${protocol}//${host}:8020`;
        console.log('WebRTC URL (dev):', url);
        return url;
      }
    }
    
    // Production: Use same hostname as frontend, no port (HTTPS handles it)
    // Development/Docker: Use same hostname with backend port (8020)
    if (environment.production) {
      const url = `${protocol}//${host}`;
      console.log('WebRTC URL (production):', url, 'hostname:', host);
      return url;
    }

    // Docker/Development: Use same hostname as frontend, but with backend port (8020)
    // This works for Docker Compose where frontend is on port 80 and backend on 8020
    // Never use 'backend' hostname - it's only valid inside Docker network, not in browser
    const url = `${protocol}//${host}:8020`;
    console.log('WebRTC URL (docker/dev):', url, 'hostname:', host);
    return url;
  }

  /**
   * Returns the ICE server configuration with STUN and TURN servers
   * This configuration is used for all WebRTC peer connections
   * TURN server IP is read from environment variable WEBRTC_TURN_IP
   * Default: turn.li1.nl
   */
  private getICEConfiguration(): RTCConfiguration {
    // Get TURN server IP from environment variable or use default
    const turnServerIP = this.getTurnServerIP();
    
    return {
      iceServers: [
        // STUN server
        { urls: `stun:${turnServerIP}:3478` },
        // TURN server (non-TLS) with UDP and TCP transports
        {
          urls: [
            `turn:${turnServerIP}:3478?transport=udp`,
            `turn:${turnServerIP}:3478?transport=tcp`
          ],
          username: 'peaceast',
          credential: 'endoplazmikretikulum'
        }
      ]
    };
  }

  /**
   * Gets TURN server IP from environment variable or uses default
   * Checks window object for runtime environment variables (set by Docker)
   */
  private getTurnServerIP(): string {
    // Try to get from window object (set by Docker environment variables)
    if (typeof window !== 'undefined' && (window as any).__TURN_SERVER_IP__) {
      return (window as any).__TURN_SERVER_IP__;
    }
    // Default fallback
    return 'turn.li1.nl';
  }
}

