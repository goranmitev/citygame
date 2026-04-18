// =============================================================================
// Singleton EventBus — all cross-system communication goes through here.
// Systems should never import each other solely to communicate state changes.
// =============================================================================

type Handler<T = unknown> = (data: T) => void;

class EventBusClass {
  private listeners = new Map<string, Set<Handler<unknown>>>();

  on<T>(event: string, handler: Handler<T>): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler as Handler<unknown>);
  }

  off<T>(event: string, handler: Handler<T>): void {
    this.listeners.get(event)?.delete(handler as Handler<unknown>);
  }

  emit<T>(event: string, data: T): void {
    this.listeners.get(event)?.forEach((h) => h(data));
  }

  /** Remove all listeners — call on game reset/dispose. */
  clear(): void {
    this.listeners.clear();
  }
}

export const EventBus = new EventBusClass();

// =============================================================================
// Event catalogue — one place for all event names and their payload types.
// =============================================================================

export const Events = {
  // Car enter/exit
  CAR_ENTERED:      'car:entered',          // payload: CarEnteredEvent
  CAR_EXITED:       'car:exited',           // payload: CarExitedEvent

  // Car collisions
  CAR_HIT_WALL:     'car:hit:wall',         // payload: CarHitEvent
  CAR_HIT_PED:      'car:hit:ped',          // payload: CarHitEvent
  CAR_HIT_OBJECT:   'car:hit:object',       // payload: CarHitEvent

  // Game flow
  GAME_RESET:       'game:reset',           // payload: none

  // Delivery
  ORDER_SPAWNED:    'delivery:spawned',     // payload: OrderSpawnedEvent
  ORDER_PICKED_UP:  'delivery:picked_up',   // payload: OrderPickedUpEvent
  ORDER_DELIVERED:  'delivery:delivered',   // payload: OrderDeliveredEvent
  ORDER_FAILED:     'delivery:failed',      // payload: none

  // Network — server-to-client events
  NET_WELCOME:          'net:welcome',           // payload: NetWelcomeEvent
  NET_PLAYER_JOINED:    'net:player_joined',     // payload: NetPlayerJoinedEvent
  NET_PLAYER_LEFT:      'net:player_left',       // payload: NetPlayerLeftEvent
  NET_PLAYER_POS:       'net:player_pos',        // payload: NetPlayerPosEvent
  NET_ORDER_SPAWNED:    'net:order_spawned',     // payload: NetOrderSpawnedEvent
  NET_PICKUP_CONFIRMED: 'net:pickup_confirmed',  // payload: NetPickupConfirmedEvent
  NET_PICKUP_DENIED:    'net:pickup_denied',     // payload: NetPickupDeniedEvent
  NET_PICKUP_LOCKED:    'net:pickup_locked',     // payload: NetPickupLockedEvent
  NET_DELIVERED:        'net:delivered',         // payload: NetDeliveredEvent
  NET_FAILED:           'net:failed',            // payload: NetFailedEvent

  // Car-to-car impact (multiplayer)
  NET_CAR_IMPACT:       'net:car_impact',        // payload: NetCarImpactEvent  (received hit)
  NET_SEND_CAR_IMPACT:  'net:send_car_impact',   // payload: NetSendCarImpactEvent (send hit to remote)
} as const;

export interface CarEnteredEvent {
  /** World position of the car at the moment of entry. */
  carPosition: { x: number; z: number };
}

export interface CarExitedEvent {
  /** World position where the player exits (driver's door). */
  exitPosition: { x: number; y: number; z: number };
  /** Car heading (radians) at exit — so player faces the same way. */
  carHeading: number;
}

export interface OrderSpawnedEvent {
  restaurantName: string;
  orderValue: number;
}

export interface OrderPickedUpEvent {
  restaurantName: string;
  orderValue: number;
  timeLimit: number;
}

export interface CarHitEvent {
  /** Car speed (m/s) at moment of impact. */
  speed: number;
}

export interface OrderDeliveredEvent {
  pay: number;
  tipPercent: number;
}

// ── Network event payloads ──────────────────────────────────────────────────

export interface ScoreEntry { color: string; balance: number; failures: number; nickname: string; }

export interface NetWelcomeEvent {
  playerId: string;
  carColor: string;
  shirtColor: string;
  playerIndex: number;
  gameState: {
    players: Array<{ id: string; carColor: string; shirtColor: string; x: number; y: number; z: number; heading: number; speed: number; steer: number; isInCar: boolean }>;
    restaurants: Array<{ hasOrder: boolean; orderValue: number; lockedBy: string | null }>;
    scores: Record<string, ScoreEntry>;
  };
}

export interface NetPlayerJoinedEvent { playerId: string; carColor: string; shirtColor: string; nickname: string; }
export interface NetPlayerLeftEvent   { playerId: string; }

export interface NetPlayerPosEvent {
  playerId: string;
  x: number; y: number; z: number;
  heading: number; speed: number; steer: number;
  isInCar: boolean;
}

export interface NetOrderSpawnedEvent  { restaurantIndex: number; orderValue: number; }
export interface NetPickupDeniedEvent  { restaurantIndex: number; }
export interface NetPickupLockedEvent  { playerId: string; restaurantIndex: number; }

export interface NetPickupConfirmedEvent {
  restaurantIndex: number;
  orderValue: number;
  timeLimit: number;
  destCx: number;
  destCz: number;
}

export interface NetDeliveredEvent {
  playerId: string;
  pay: number;
  scores: Record<string, ScoreEntry>;
}

export interface NetCarImpactEvent     { fromId: string; vx: number; vz: number; }
export interface NetSendCarImpactEvent { targetId: string; vx: number; vz: number; }

export interface NetFailedEvent {
  playerId: string;
  failures: number;
  scores: Record<string, ScoreEntry>;
}
