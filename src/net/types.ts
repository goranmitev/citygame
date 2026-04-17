// Shared network message types for socket.io communication

export interface PlayerPositionMsg {
  x: number;
  y: number;
  z: number;
  heading: number;
  speed: number;
  steer: number;
  isInCar: boolean;
}

export interface RemotePlayerSnapshot extends PlayerPositionMsg {
  id: string;
  color: string;
}

export interface RestaurantNetState {
  hasOrder: boolean;
  orderValue: number;
  lockedBy: string | null;
}

export interface ScoreEntry {
  color: string;
  balance: number;
  failures: number;
}

export interface InitialGameState {
  players: RemotePlayerSnapshot[];
  restaurants: RestaurantNetState[];
  scores: Record<string, ScoreEntry>;
}
