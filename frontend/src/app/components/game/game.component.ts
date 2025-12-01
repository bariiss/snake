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
  currentPlayerId: string = '';
  banner: { type: 'info' | 'warning'; message: string } | null = null;
  opponentDisconnected: boolean = false; // Track if opponent disconnected
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private cellSize = 20;
  private gridWidth = 40;
  private gridHeight = 30;
  private subscriptions = new Subscription();
  private gameStateTimeout: any = null;
  isReady = false;
  private previousScores: Map<string, number> = new Map();
  private audioContext: AudioContext | null = null;

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
    
    // Initialize audio context for sound effects
    try {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch (e) {
      console.warn('AudioContext not supported:', e);
    }

          // Subscribe to game state updates
          this.subscriptions.add(
            this.gameService.getCurrentGameState().subscribe(state => {
              if (state) {
                // Check for food eaten (score increase)
                if (state.status === 'playing' && state.snakes) {
                  this.checkFoodEaten(state);
                }
                
                this.gameState = state;
                // Clear timeout if game state is received
                if (this.gameStateTimeout) {
                  clearTimeout(this.gameStateTimeout);
                  this.gameStateTimeout = null;
                }
                // Update ready status based on current player
                if (state.players && this.currentPlayerId) {
                  const currentPlayer = state.players.find((p: PlayerStatus) => p.id === this.currentPlayerId);
                  this.isReady = currentPlayer?.ready || false;
                  
                  // Check if opponent disconnected (other player not in players list or game status is finished)
                  const otherPlayer = state.players.find((p: PlayerStatus) => p.id !== this.currentPlayerId);
                  this.opponentDisconnected = !otherPlayer && state.status === 'finished';
                }
                // Check if game is finished to show rematch button
                if (state.status === 'finished' && !this.isSpectator) {
                  this.showRematchButton = true;
                  // Update statistics
                  this.updateGameStats(state);
                  
                  // If opponent disconnected and game is finished, don't show rematch
                  if (this.opponentDisconnected) {
                    this.showRematchButton = false;
                  }
                  // Clear previous scores when game ends
                  this.previousScores.clear();
                }
                // Rematch countdown removed - no longer displaying countdown
                this.drawGame();
              } else {
                // If game state is null and we're on a game page, check if we should redirect
                // This handles page refresh when game doesn't exist or is finished
                if (this.gameId && !this.isSpectator) {
                  // Wait a bit to see if state arrives, then redirect if still null
                  setTimeout(() => {
                    if (!this.gameState) {
                      console.log('Game state is null, redirecting to lobby...');
                      this.gameService.showInfoBanner('Game not found or has ended. Returning to lobby...', 'warning');
                      setTimeout(() => {
                        this.router.navigate(['/']);
                      }, 1500);
                    }
                  }, 2000);
                }
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

    this.subscriptions.add(
      this.gameService.getBanner().subscribe(banner => {
        this.banner = banner;
        // If player disconnected, redirect to lobby
        if (banner && banner.type === 'warning' && banner.message.includes('left the game')) {
          setTimeout(() => {
            this.router.navigate(['/']);
          }, 2000);
        }
      })
    );

    // If no game state yet, check if we already have one from game_accept message
    // The state should be set when navigating to this route
    // If no state after timeout, redirect to lobby (game might not exist or player disconnected)
    this.gameStateTimeout = setTimeout(() => {
      if (!this.gameState && this.gameId) {
        console.log('No game state found after timeout, redirecting to lobby...');
        this.gameService.showInfoBanner('Game not found or has ended. Returning to lobby...', 'warning');
        setTimeout(() => {
          this.router.navigate(['/']);
        }, 1500);
      }
    }, 2000); // Wait 2 seconds for game state
  }

  ngOnDestroy(): void {
    if (this.gameStateTimeout) {
      clearTimeout(this.gameStateTimeout);
    }
    this.subscriptions.unsubscribe();
    if (this.audioContext) {
      this.audioContext.close();
    }
  }

  private checkFoodEaten(state: GameState): void {
    if (!state.snakes) return;
    
    state.snakes.forEach(snake => {
      const previousScore = this.previousScores.get(snake.id) || 0;
      const currentScore = snake.score || 0;
      
      // If score increased, food was eaten
      if (currentScore > previousScore) {
        this.playFoodSound();
        this.previousScores.set(snake.id, currentScore);
      } else if (currentScore === 0 && previousScore > 0) {
        // Score reset (new game started)
        this.previousScores.set(snake.id, 0);
      } else if (!this.previousScores.has(snake.id)) {
        // First time seeing this snake
        this.previousScores.set(snake.id, currentScore);
      }
    });
  }

  private playFoodSound(): void {
    if (!this.audioContext) return;
    
    try {
      const oscillator = this.audioContext.createOscillator();
      const gainNode = this.audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(this.audioContext.destination);
      
      // Play a pleasant "pop" sound
      oscillator.frequency.value = 800; // Higher pitch for food
      oscillator.type = 'sine';
      
      gainNode.gain.setValueAtTime(0.3, this.audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.1);
      
      oscillator.start(this.audioContext.currentTime);
      oscillator.stop(this.audioContext.currentTime + 0.1);
    } catch (e) {
      console.warn('Error playing food sound:', e);
    }
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
    if (!this.hasRequestedRematch()) {
      this.gameService.requestRematch(this.gameId);
      if (this.gameState) {
        this.gameState = {
          ...this.gameState,
          rematchRequesterId: this.currentPlayerId,
          rematchRequesterName: this.getCurrentPlayerStatus()?.username
        } as any;
      }
    }
  }

  acceptRematch(): void {
    this.gameService.acceptRematch(this.gameId);
  }

  hasRequestedRematch(): boolean {
    if (!this.gameState?.rematchRequesterId || !this.currentPlayerId) {
      return false;
    }
    return this.gameState.rematchRequesterId === this.currentPlayerId;
  }

  drawGame(): void {
    if (!this.gameState || !this.ctx) return;

    this.ctx.fillStyle = '#1a1a2e';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    this.drawGrid();

    if (this.gameState.food) {
      this.drawFood(this.gameState.food.position);
    }

    let snakesToDraw = this.gameState.snakes;
    let usePlaceholder = false;

    if ((!snakesToDraw || snakesToDraw.length === 0) && this.gameState.status === 'waiting') {
      const placeholders = this.getPlaceholderSnakes();
      if (placeholders) {
        snakesToDraw = placeholders;
        usePlaceholder = true;
      }
    }

    if (snakesToDraw) {
      snakesToDraw.forEach(snake => {
        this.drawSnake(snake, usePlaceholder);
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

  drawSnake(snake: Snake, isPlaceholder: boolean = false): void {
    if (!snake.body || snake.body.length === 0) return;

    const previousAlpha = this.ctx.globalAlpha;
    if (isPlaceholder) {
      this.ctx.globalAlpha = 0.45;
    }

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

    this.ctx.globalAlpha = previousAlpha;
  }

  backToLobby(): void {
    // Don't disconnect - just navigate to lobby
    // The lobby component will check if we're already connected
    this.router.navigate(['/']);
  }

  shouldShowStatusBanner(): boolean {
    if (!this.gameState) return false;
    return ['waiting', 'countdown', 'rematch_countdown'].includes(this.gameState.status);
  }

  getStatusBannerText(): string {
    if (!this.gameState) return '';
    if (this.gameState.status === 'waiting') {
      const otherName = this.getOtherPlayer()?.username;
      return otherName ? `Waiting for ${otherName}...` : 'Waiting for other player...';
    }
    if (this.gameState.status === 'countdown') {
      return `Game starting in ${this.gameState.countdown}`;
    }
    if (this.gameState.status === 'rematch_countdown') {
      return `Rematch starting in ${this.gameState.countdown || 0}`;
    }
    return '';
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
  dismissBanner(): void {
    this.gameService.clearBanner();
  }

  get rematchRequestedByOpponent(): boolean {
    if (!this.gameState?.rematchRequesterId || !this.currentPlayerId) {
      return false;
    }
    return this.gameState.rematchRequesterId !== this.currentPlayerId;
  }

  get rematchRequestMessage(): string {
    const name = this.gameState?.rematchRequesterName || 'Opponent';
    return `${name} wants a rematch`;
  }

  getInitial(name?: string | null): string {
    if (!name || !name.length) {
      return '?';
    }
    return name.charAt(0).toUpperCase();
  }

  private getPlaceholderSnakes(): Snake[] | null {
    if (!this.gameState?.players || this.gameState.players.length === 0) {
      return null;
    }

    const templates = [
      [
        { x: 5, y: 15 },
        { x: 4, y: 15 },
        { x: 3, y: 15 }
      ],
      [
        { x: 35, y: 15 },
        { x: 36, y: 15 },
        { x: 37, y: 15 }
      ]
    ];

    const colors = ['#FF0000', '#0000FF'];
    const directions = ['right', 'left'];

    return this.gameState.players.slice(0, 2).map((player, index) => ({
      id: player.id,
      username: player.username,
      score: 0,
      direction: directions[index] || 'right',
      color: colors[index] || '#ffffff',
      body: templates[index] ? templates[index].map(seg => ({ x: seg.x, y: seg.y })) : []
    }));
  }

  handleTouchMove(direction: string): void {
    if (this.isSpectator || !this.gameState || this.gameState.status !== 'playing') {
      return;
    }
    this.gameService.sendPlayerMove(this.gameId, direction);
  }

  private readonly STATS_KEY = 'snake_game_stats';

  getTotalFoodEaten(): number {
    const stats = this.getStats();
    return stats.totalFoodEaten || 0;
  }

  getGamesWon(): number {
    const stats = this.getStats();
    return stats.gamesWon || 0;
  }

  getGamesPlayed(): number {
    const stats = this.getStats();
    return stats.gamesPlayed || 0;
  }

  private getStats(): { totalFoodEaten: number; gamesWon: number; gamesPlayed: number } {
    const stored = localStorage.getItem(this.STATS_KEY);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        return { totalFoodEaten: 0, gamesWon: 0, gamesPlayed: 0 };
      }
    }
    return { totalFoodEaten: 0, gamesWon: 0, gamesPlayed: 0 };
  }

  private updateGameStats(state: GameState): void {
    if (!state.snakes || !this.currentPlayerId) return;
    
    const currentPlayerSnake = state.snakes.find(s => s.id === this.currentPlayerId);
    if (!currentPlayerSnake) return;
    
    const foodEaten = currentPlayerSnake.score || 0;
    const won = state.winner === this.currentPlayerId;
    
    this.updateStats(foodEaten, won);
  }

  private updateStats(foodEaten: number, won: boolean): void {
    const stats = this.getStats();
    stats.totalFoodEaten = (stats.totalFoodEaten || 0) + foodEaten;
    stats.gamesPlayed = (stats.gamesPlayed || 0) + 1;
    if (won) {
      stats.gamesWon = (stats.gamesWon || 0) + 1;
    }
    localStorage.setItem(this.STATS_KEY, JSON.stringify(stats));
  }
}
