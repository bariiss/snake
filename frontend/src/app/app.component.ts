import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';

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
          <div class="loading-dots">
            <span></span>
            <span></span>
            <span></span>
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

    .loading-dots {
      display: flex;
      justify-content: center;
      gap: 10px;
      margin-top: 20px;
    }

    .loading-dots span {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: white;
      animation: dotBounce 1.4s ease-in-out infinite;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
    }

    .loading-dots span:nth-child(1) {
      animation-delay: 0s;
    }

    .loading-dots span:nth-child(2) {
      animation-delay: 0.2s;
    }

    .loading-dots span:nth-child(3) {
      animation-delay: 0.4s;
    }

    @keyframes dotBounce {
      0%, 80%, 100% {
        transform: translateY(0) scale(1);
        opacity: 0.7;
      }
      40% {
        transform: translateY(-20px) scale(1.2);
        opacity: 1;
      }
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
export class AppComponent implements OnInit {
  title = 'Snake Game';
  isLoading = true;

  ngOnInit() {
    // Show loading screen for 2 seconds, then fade out
    setTimeout(() => {
      this.isLoading = false;
    }, 2000);
  }
}

