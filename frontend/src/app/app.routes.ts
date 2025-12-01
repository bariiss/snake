import { Routes } from '@angular/router';
import { LoginComponent } from './components/login/login.component';
import { ModeSelectionComponent } from './components/mode-selection/mode-selection.component';
import { LobbyComponent } from './components/lobby/lobby.component';
import { GameComponent } from './components/game/game.component';

export const routes: Routes = [
  { path: '', redirectTo: '/login', pathMatch: 'full' },
  { path: 'login', component: LoginComponent },
  { path: 'mode-selection', component: ModeSelectionComponent },
  { path: 'lobby', component: LobbyComponent },
  { path: 'game/single/:gameId', component: GameComponent },
  { path: 'game/multiplayer/:gameId', component: GameComponent },
  { path: 'game/:gameId', component: GameComponent }, // Legacy support
  { path: '**', redirectTo: '/login' }
];

