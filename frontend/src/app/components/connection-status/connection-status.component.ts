import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { ConnectionStatusService, ConnectionStatus } from '../../services/connection-status.service';

@Component({
  selector: 'app-connection-status',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './connection-status.component.html',
  styleUrls: ['./connection-status.component.css']
})
export class ConnectionStatusComponent implements OnInit, OnDestroy {
  connectionStatus: ConnectionStatus | null = null;
  isEnabled = false;
  private subscriptions = new Subscription();

  constructor(private connectionStatusService: ConnectionStatusService) {}

  ngOnInit(): void {
    this.subscriptions.add(
      this.connectionStatusService.connectionStatus$.subscribe(status => {
        this.connectionStatus = status;
      })
    );

    this.subscriptions.add(
      this.connectionStatusService.isEnabled$.subscribe(enabled => {
        this.isEnabled = enabled;
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  toggle(): void {
    this.connectionStatusService.toggle();
  }

  getStatusClass(status: string): string {
    switch (status) {
      case 'connected':
        return 'status-connected';
      case 'connecting':
        return 'status-connecting';
      case 'error':
        return 'status-error';
      default:
        return 'status-disconnected';
    }
  }

  getStatusIcon(status: string): string {
    switch (status) {
      case 'connected':
        return '✓';
      case 'connecting':
        return '⟳';
      case 'error':
        return '✗';
      default:
        return '○';
    }
  }
}

