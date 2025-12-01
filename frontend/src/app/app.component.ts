import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { GameService } from './services/game.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet],
  template: `
    <div class="app-container">
      <!-- Loading Screen -->
      <div class="loading-screen" *ngIf="isLoading">
        <div class="loading-content">
          <div class="snake-emoji">🐍</div>
          <h1 class="game-title">Slither Arena</h1>
          <div class="connection-steps">
            <!-- Connection Steps -->
            <div *ngIf="!isDisconnecting()" class="steps-container">
              <div class="step" [class.active]="currentStep === 'connecting'" [class.completed]="isStepCompleted('connecting')">
                <span class="step-icon">{{ isStepCompleted('connecting') ? '✓' : '⟳' }}</span>
                <span class="step-text">Establishing WebSocket connection...</span>
              </div>
              <div class="step" [class.active]="currentStep === 'connected'" [class.completed]="isStepCompleted('connected')">
                <span class="step-icon">{{ isStepCompleted('connected') ? '✓' : (currentStep === 'connected' ? '⟳' : '○') }}</span>
                <span class="step-text">Connection established, retrieving user information...</span>
              </div>
              <div class="step" [class.active]="currentStep === 'loading_lobby'" [class.completed]="isStepCompleted('lobby_loaded')">
                <span class="step-icon">{{ isStepCompleted('lobby_loaded') ? '✓' : (currentStep === 'loading_lobby' ? '⟳' : '○') }}</span>
                <span class="step-text">Loading lobby status...</span>
              </div>
              <div class="step" [class.active]="currentStep === 'ready'" [class.completed]="isStepCompleted('ready')">
                <span class="step-icon">{{ isStepCompleted('ready') ? '✓' : (currentStep === 'ready' ? '⟳' : '○') }}</span>
                <span class="step-text">Retrieving game list...</span>
              </div>
            </div>
            
            <!-- Disconnection Steps -->
            <div *ngIf="isDisconnecting()" class="steps-container">
              <div class="step" [class.active]="currentStep === 'disconnecting_peer'" [class.completed]="isStepCompleted('disconnecting_peer')">
                <span class="step-icon">{{ isStepCompleted('disconnecting_peer') ? '✓' : '⟳' }}</span>
                <span class="step-text">Disconnecting peer-to-peer connection...</span>
              </div>
              <div class="step" [class.active]="currentStep === 'disconnecting_websocket'" [class.completed]="isStepCompleted('disconnecting_websocket')">
                <span class="step-icon">{{ isStepCompleted('disconnecting_websocket') ? '✓' : (currentStep === 'disconnecting_websocket' ? '⟳' : '○') }}</span>
                <span class="step-text">Disconnecting WebSocket connection...</span>
              </div>
              <div class="step" [class.active]="currentStep === 'disconnecting_lobby'" [class.completed]="isStepCompleted('disconnecting_lobby')">
                <span class="step-icon">{{ isStepCompleted('disconnecting_lobby') ? '✓' : (currentStep === 'disconnecting_lobby' ? '⟳' : '○') }}</span>
                <span class="step-text">Leaving lobby...</span>
              </div>
              <div class="step" [class.active]="currentStep === 'disconnected'" [class.completed]="isStepCompleted('disconnected')">
                <span class="step-icon">{{ isStepCompleted('disconnected') ? '✓' : (currentStep === 'disconnected' ? '⟳' : '○') }}</span>
                <span class="step-text">Connection closed</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Main Content -->
      <div class="main-content" [class.fade-in]="!isLoading">
        <router-outlet></router-outlet>
      </div>
    </div>
  `,
  styles: [`
    .app-container {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 20px;
      position: relative;
    }

    .loading-screen {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999;
      animation: fadeOut 0.5s ease-out 2s forwards;
    }

    .loading-content {
      text-align: center;
      color: white;
    }

    .snake-emoji {
      font-size: 120px;
      animation: snakeMove 1.5s ease-in-out infinite;
      margin-bottom: 20px;
      display: inline-block;
    }

    @keyframes snakeMove {
      0%, 100% {
        transform: translateX(0) rotate(0deg) scale(1);
      }
      25% {
        transform: translateX(10px) rotate(-5deg) scale(1.1);
      }
      50% {
        transform: translateX(0) rotate(0deg) scale(1);
      }
      75% {
        transform: translateX(-10px) rotate(5deg) scale(1.1);
      }
    }

    .game-title {
      font-size: 2.5rem;
      font-weight: bold;
      margin: 0 0 30px 0;
      text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
      animation: titleSlide 1s ease-out;
      letter-spacing: 2px;
    }

    @keyframes titleSlide {
      from {
        opacity: 0;
        transform: translateY(-30px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .connection-steps {
      margin-top: 40px;
      display: flex;
      flex-direction: column;
      gap: 15px;
      align-items: center;
      min-width: 300px;
    }

    .steps-container {
      display: flex;
      flex-direction: column;
      gap: 15px;
      width: 100%;
      align-items: center;
    }

    .step {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 20px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      width: 100%;
      max-width: 400px;
      transition: all 0.3s ease;
      opacity: 0.5;
    }

    .step.active {
      opacity: 1;
      background: rgba(255, 255, 255, 0.2);
      transform: scale(1.02);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    }

    .step.completed {
      opacity: 1;
      background: rgba(76, 175, 80, 0.2);
    }

    .step-icon {
      font-size: 20px;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
    }

    .step.completed .step-icon {
      color: #4caf50;
      animation: checkmark 0.3s ease;
    }

    .step.active:not(.completed) .step-icon {
      animation: spin 1s linear infinite;
    }

    @keyframes checkmark {
      0% {
        transform: scale(0);
      }
      50% {
        transform: scale(1.2);
      }
      100% {
        transform: scale(1);
      }
    }

    @keyframes spin {
      from {
        transform: rotate(0deg);
      }
      to {
        transform: rotate(360deg);
      }
    }

    .step-text {
      font-size: 0.95rem;
      flex: 1;
    }

    @keyframes fadeOut {
      from {
        opacity: 1;
      }
      to {
        opacity: 0;
        visibility: hidden;
      }
    }

    .main-content {
      width: 100%;
      opacity: 0;
      transition: opacity 0.5s ease-in;
    }

    .main-content.fade-in {
      opacity: 1;
    }

    @media (max-width: 768px) {
      .game-title {
        font-size: 1.8rem;
      }

      .snake-emoji {
        font-size: 80px;
      }
    }
  `]
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
          // If ready, hide loading after a short delay
          if (status.step === 'ready') {
            setTimeout(() => {
              this.isLoading = false;
            }, 500);
          }
          // If disconnected, hide loading after a short delay
          if (status.step === 'disconnected') {
            setTimeout(() => {
              this.isLoading = false;
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

