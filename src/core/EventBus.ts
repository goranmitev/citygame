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
  CAR_ENTERED:  'car:entered',   // payload: CarEnteredEvent
  CAR_EXITED:   'car:exited',    // payload: CarExitedEvent

  // Game flow
  GAME_RESET:   'game:reset',    // payload: none
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
