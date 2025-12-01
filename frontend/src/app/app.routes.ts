import { Routes } from '@angular/router';
import { LobbyComponent } from './components/lobby/lobby.component';
import { GameComponent } from './components/game/game.component';

export const routes: Routes = [
  { path: '', redirectTo: '/lobby', pathMatch: 'full' },
  { path: 'lobby', component: LobbyComponent },
  { path: 'game/single/:gameId', component: GameComponent },
  { path: 'game/multiplayer/:gameId', component: GameComponent },
  { path: 'game/:gameId', component: GameComponent }, // Legacy support
  { path: '**', redirectTo: '/lobby' }
];

