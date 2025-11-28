import { Component, OnInit, OnDestroy, ViewChild, ElementRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { GameService, GameState, Snake, Position, Food, PlayerStatus } from '../../services/game.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-game',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './game.component.html',
  styleUrls: ['./game.component.css']
})
export class GameComponent implements OnInit, OnDestroy {
  @ViewChild('gameCanvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;
  
  gameState: GameState | null = null;
  gameId: string = '';
  isSpectator: boolean = false;
  rematchCountdown: number = 0;
  showRematchButton: boolean = false;
  isRematchReady: boolean = false;
  currentPlayerId: string = '';
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private cellSize = 20;
  private gridWidth = 40;
  private gridHeight = 30;
  private subscriptions = new Subscription();
  isReady = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private gameService: GameService
  ) {}

  ngOnInit(): void {
    this.gameId = this.route.snapshot.paramMap.get('gameId') || '';
    
    this.canvas = this.canvasRef.nativeElement;
    this.ctx = this.canvas.getContext('2d')!;
    this.setupCanvas();

    // Subscribe to game state updates
    this.subscriptions.add(
      this.gameService.getCurrentGameState().subscribe(state => {
        if (state) {
          this.gameState = state;
          // Update ready status based on current player
          if (state.players && this.currentPlayerId) {
            const currentPlayer = state.players.find((p: PlayerStatus) => p.id === this.currentPlayerId);
            this.isReady = currentPlayer?.ready || false;
          }
          // Check if game is finished to show rematch button
          if (state.status === 'finished' && !this.isSpectator) {
            this.showRematchButton = true;
            this.isRematchReady = false;
          }
          // Handle rematch countdown
          if (state.status === 'rematch_countdown' && (state as any).countdown) {
            this.rematchCountdown = (state as any).countdown;
          }
          this.drawGame();
        }
      })
    );

    // Check if spectator mode
    this.subscriptions.add(
      this.gameService.isSpectator().subscribe(isSpec => {
        this.isSpectator = isSpec;
      })
    );

    // Get current player ID
    this.subscriptions.add(
      this.gameService.getCurrentPlayer().subscribe(player => {
        if (player) {
          this.currentPlayerId = player.id;
        }
      })
    );

    // If no game state yet, check if we already have one from game_accept message
    // The state should be set when navigating to this route
    setTimeout(() => {
      if (!this.gameState && this.gameId) {
        console.log('No game state found, waiting for initial state...');
      }
    }, 100);
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  setupCanvas(): void {
    // Calculate responsive cell size for mobile
    const maxWidth = Math.min(window.innerWidth - 40, 800);
    const maxHeight = Math.min(window.innerHeight - 200, 600);
    
    const cellSizeX = Math.floor(maxWidth / this.gridWidth);
    const cellSizeY = Math.floor(maxHeight / this.gridHeight);
    this.cellSize = Math.min(cellSizeX, cellSizeY, 20);
    
    const canvasWidth = this.gridWidth * this.cellSize;
    const canvasHeight = this.gridHeight * this.cellSize;
    this.canvas.width = canvasWidth;
    this.canvas.height = canvasHeight;
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyDown(event: KeyboardEvent): void {
    // Spectators cannot move
    if (this.isSpectator) {
      return;
    }

    if (!this.gameState || this.gameState.status !== 'playing') {
      return;
    }

    let direction = '';
    switch (event.key) {
      case 'ArrowUp':
      case 'w':
      case 'W':
        direction = 'up';
        break;
      case 'ArrowDown':
      case 's':
      case 'S':
        direction = 'down';
        break;
      case 'ArrowLeft':
      case 'a':
      case 'A':
        direction = 'left';
        break;
      case 'ArrowRight':
      case 'd':
      case 'D':
        direction = 'right';
        break;
    }

    if (direction) {
      event.preventDefault();
      this.gameService.sendPlayerMove(this.gameId, direction);
    }
  }

  playerReady(): void {
    if (!this.isReady && this.gameState?.status === 'waiting') {
      this.gameService.playerReady(this.gameId);
      // Optimistically update UI
      this.isReady = true;
    }
  }

  getOtherPlayer(): { username: string; ready: boolean } | null {
    if (!this.gameState?.players || !this.currentPlayerId) {
      return null;
    }
    const otherPlayer = this.gameState.players.find((p: PlayerStatus) => p.id !== this.currentPlayerId);
    return otherPlayer ? { username: otherPlayer.username, ready: otherPlayer.ready } : null;
  }

  getCurrentPlayerStatus(): { username: string; ready: boolean } | null {
    if (!this.gameState?.players || !this.currentPlayerId) {
      return null;
    }
    const currentPlayer = this.gameState.players.find((p: PlayerStatus) => p.id === this.currentPlayerId);
    return currentPlayer ? { username: currentPlayer.username, ready: currentPlayer.ready } : null;
  }

  requestRematch(): void {
    if (!this.isRematchReady) {
      this.gameService.requestRematch(this.gameId);
      this.isRematchReady = true;
    }
  }

  drawGame(): void {
    if (!this.gameState || !this.ctx) return;

    // Clear canvas
    this.ctx.fillStyle = '#1a1a2e';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Draw grid
    this.drawGrid();

    // Draw food
    if (this.gameState.food) {
      this.drawFood(this.gameState.food.position);
    }

    // Draw snakes
    if (this.gameState.snakes) {
      this.gameState.snakes.forEach(snake => {
        this.drawSnake(snake);
      });
    }
  }

  drawGrid(): void {
    this.ctx.strokeStyle = '#16213e';
    this.ctx.lineWidth = 1;

    for (let x = 0; x <= this.gridWidth; x++) {
      this.ctx.beginPath();
      this.ctx.moveTo(x * this.cellSize, 0);
      this.ctx.lineTo(x * this.cellSize, this.canvas.height);
      this.ctx.stroke();
    }

    for (let y = 0; y <= this.gridHeight; y++) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, y * this.cellSize);
      this.ctx.lineTo(this.canvas.width, y * this.cellSize);
      this.ctx.stroke();
    }
  }

  drawFood(position: Position): void {
    const x = position.x * this.cellSize;
    const y = position.y * this.cellSize;

    this.ctx.fillStyle = '#ffd700';
    this.ctx.beginPath();
    this.ctx.arc(
      x + this.cellSize / 2,
      y + this.cellSize / 2,
      this.cellSize / 2 - 2,
      0,
      2 * Math.PI
    );
    this.ctx.fill();

    // Glow effect
    this.ctx.shadowBlur = 10;
    this.ctx.shadowColor = '#ffd700';
    this.ctx.fill();
    this.ctx.shadowBlur = 0;
  }

  drawSnake(snake: Snake): void {
    if (!snake.body || snake.body.length === 0) return;

    // Draw body
    snake.body.forEach((segment, index) => {
      const x = segment.x * this.cellSize;
      const y = segment.y * this.cellSize;

      if (index === 0) {
        // Head
        this.ctx.fillStyle = snake.color;
        this.ctx.fillRect(x + 1, y + 1, this.cellSize - 2, this.cellSize - 2);
        
        // Head border
        this.ctx.strokeStyle = '#fff';
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(x + 1, y + 1, this.cellSize - 2, this.cellSize - 2);
      } else {
        // Body
        this.ctx.fillStyle = snake.color;
        this.ctx.fillRect(x + 2, y + 2, this.cellSize - 4, this.cellSize - 4);
      }
    });
  }

  backToLobby(): void {
    this.router.navigate(['/']);
  }

  getStatusText(): string {
    if (!this.gameState) return '';
    
    switch (this.gameState.status) {
      case 'waiting':
        return 'Waiting for other player...';
      case 'countdown':
        return `Game starting: ${this.gameState.countdown}`;
      case 'playing':
        return 'Game in progress';
      case 'finished':
        return this.gameState.winner ? 'Game Over!' : 'Game Over (Tie)';
      case 'rematch_countdown':
        return `Rematch starting: ${this.rematchCountdown}`;
      default:
        return '';
    }
  }

  getSnakeScore(snakeId: string): number {
    if (!this.gameState?.snakes) return 0;
    const snake = this.gameState.snakes.find(s => s.id === snakeId);
    return snake?.score || 0;
  }

  getWinnerUsername(): string {
    if (!this.gameState || !this.gameState.winner || this.gameState.winner === 'tie') {
      return '';
    }
    const winnerSnake = this.gameState.snakes.find(s => s.id === this.gameState!.winner);
    return winnerSnake?.username || `Player ${this.gameState.winner.substring(0, 8)}`;
  }

  handleTouchMove(direction: string): void {
    if (this.isSpectator || !this.gameState || this.gameState.status !== 'playing') {
      return;
    }
    this.gameService.sendPlayerMove(this.gameId, direction);
  }
}

