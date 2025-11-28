import { Routes } from '@angular/router';
import { LobbyComponent } from './components/lobby/lobby.component';
import { GameComponent } from './components/game/game.component';

export const routes: Routes = [
  { path: '', component: LobbyComponent },
  { path: 'game/:gameId', component: GameComponent },
  { path: '**', redirectTo: '' }
];

