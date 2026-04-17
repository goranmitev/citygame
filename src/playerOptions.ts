export type GameMode = 'single' | 'multi';

export interface PlayerOptions {
  mode: GameMode;
  nickname: string;
  carColor: string;
  shirtColor: string;
}

export const playerOptions: PlayerOptions = {
  mode: 'single',
  nickname: 'Player',
  carColor: '#e74c3c',
  shirtColor: '#3498db',
};
