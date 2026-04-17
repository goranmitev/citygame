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
