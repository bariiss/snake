import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { GameService } from './services/game.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements OnInit, OnDestroy {
  title = 'Snake Game';
  isLoading = false; // Don't show loading on initial page load
  currentStep = 'idle';
  completedSteps: string[] = [];
  private subscriptions = new Subscription();
  private initialLoadComplete = false;

  constructor(private gameService: GameService) {}

  ngOnInit() {
    // Mark initial load as complete immediately (no initial loading screen)
    this.initialLoadComplete = true;
    
    // Listen to connection status
    this.subscriptions.add(
      this.gameService.getConnectionStatus().subscribe(status => {
        this.currentStep = status.step;
        
        // Show loading screen ONLY when connection starts (user clicked Connect)
        // or when disconnecting (user clicked Disconnect)
        if ((status.step === 'connecting' || status.step.startsWith('disconnecting')) && !status.completed) {
          this.isLoading = true;
          if (status.step === 'connecting' || status.step.startsWith('disconnecting')) {
            this.completedSteps = []; // Reset completed steps
          }
        }
        
        // Hide loading if we go back to idle (disconnected)
        if (status.step === 'idle') {
          // Don't hide immediately, wait a bit in case reconnection happens
          setTimeout(() => {
            if (this.currentStep === 'idle') {
              this.isLoading = false;
            }
          }, 300);
        }
        
        if (status.completed) {
          if (!this.completedSteps.includes(status.step)) {
            this.completedSteps.push(status.step);
          }
          // If ready, hide loading after a short delay (connection process completed)
          if (status.step === 'ready') {
            setTimeout(() => {
              // Only hide if we're still on ready step (process completed)
              if (this.currentStep === 'ready') {
                this.isLoading = false;
              }
            }, 500);
          }
          // If disconnected, hide loading after a short delay (disconnection process completed)
          if (status.step === 'disconnected') {
            setTimeout(() => {
              // Only hide if we're still on disconnected step (process completed)
              if (this.currentStep === 'disconnected') {
                this.isLoading = false;
              }
            }, 800);
          }
        }
      })
    );
  }

  ngOnDestroy() {
    this.subscriptions.unsubscribe();
  }

  isStepCompleted(step: string): boolean {
    return this.completedSteps.includes(step);
  }

  isDisconnecting(): boolean {
    return this.currentStep.startsWith('disconnecting') || this.currentStep === 'disconnected';
  }
}

