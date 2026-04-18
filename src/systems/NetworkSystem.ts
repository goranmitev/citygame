import { io, Socket } from 'socket.io-client';
import { Game, GameSystem } from '../core/Game';
import { CarSystem } from './CarSystem';
import { WalkSystem } from './WalkSystem';
import { CityBuilder } from '../city/CityBuilder';
import { EventBus, Events, ScoreEntry } from '../core/EventBus';
import { playerOptions } from '../playerOptions';
import { DELIVERY_RESTAURANT_COUNT, DELIVERY_MAX_FAILURES } from '../constants';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SERVER_URL: string = ((import.meta as any).env?.VITE_SERVER_URL) ?? 'http://localhost:3001';
const SEND_INTERVAL = 1 / 20; // 20 Hz

// Singleplayer simulation constants
const SP_ORDER_INTERVAL_MIN = 5;
const SP_ORDER_INTERVAL_MAX = 15;
const SP_ORDER_VALUE_MIN = 8;
const SP_ORDER_VALUE_MAX = 25;
const SP_MAX_TIP = 0.5;
const SP_BASE_PAY = 1.0;

interface SpCarried {
  restaurantIndex: number; orderValue: number;
  timeLimit: number; startedAt: number;
  destCx: number; destCz: number;
}

export class NetworkSystem implements GameSystem {
  readonly name = 'network';

  private socket!: Socket;
  private car!: CarSystem;
  private walk!: WalkSystem;
  private game!: Game;
  private sendAccum = 0;
  private connected = false;

  // Singleplayer simulation state
  private spMode = false;
  private spOrderTimer = 2;
  private spOrders = new Map<number, number>(); // restaurantIndex → orderValue
  private spCarried: SpCarried | null = null;
  private spBalance = 0;
  private spFailures = 0;

  playerId = '';
  playerColor = '';

  init(game: Game): void {
    this.game  = game;
    this.car   = game.getSystem<CarSystem>('car')!;
    this.walk  = game.getSystem<WalkSystem>('player')!;

    if (playerOptions.mode === 'single') {
      this.spMode    = true;
      this.playerId  = 'local';
      this.playerColor = playerOptions.carColor;
      // Emit welcome on next tick so DeliverySystem listeners are registered
      setTimeout(() => {
        EventBus.emit(Events.NET_WELCOME, {
          playerId: 'local',
          carColor:   playerOptions.carColor,
          shirtColor: playerOptions.shirtColor,
          playerIndex: 0,
          gameState: {
            players: [],
            restaurants: Array.from({ length: DELIVERY_RESTAURANT_COUNT }, () => ({ hasOrder: false, orderValue: 0, lockedBy: null })),
            scores: this.buildSpScores(),
          },
        });
      }, 0);
      return;
    }

    this.socket = io(SERVER_URL, { transports: ['websocket'] });
    this.connected = true;

    this.socket.on('connect', () => {
      this.socket.emit('player:configure', {
        nickname:    playerOptions.nickname,
        carColor:    playerOptions.carColor,
        shirtColor:  playerOptions.shirtColor,
      });
    });

    this.socket.on('server:full', () => {
      alert('Server is full (max 4 players). Try again later.');
    });

    this.socket.on('game:welcome', (d) => {
      this.playerId    = d.playerId;
      this.playerColor = d.carColor;
      playerOptions.carColor   = d.carColor;
      playerOptions.shirtColor = d.shirtColor;
      this.overrideSpawn(d.playerIndex);
      EventBus.emit(Events.NET_WELCOME, d);
    });

    this.socket.on('player:joined',            (d) => EventBus.emit(Events.NET_PLAYER_JOINED, d));
    this.socket.on('player:left',              (d) => EventBus.emit(Events.NET_PLAYER_LEFT,   d));
    this.socket.on('player:position',          (d) => EventBus.emit(Events.NET_PLAYER_POS,    d));
    this.socket.on('delivery:order_spawned',   (d) => EventBus.emit(Events.NET_ORDER_SPAWNED,    d));
    this.socket.on('delivery:pickup_confirmed',(d) => EventBus.emit(Events.NET_PICKUP_CONFIRMED, d));
    this.socket.on('delivery:pickup_denied',   (d) => EventBus.emit(Events.NET_PICKUP_DENIED,    d));
    this.socket.on('delivery:pickup_locked',   (d) => EventBus.emit(Events.NET_PICKUP_LOCKED,    d));
    this.socket.on('delivery:delivered',       (d) => EventBus.emit(Events.NET_DELIVERED,        d));
    this.socket.on('delivery:failed',          (d) => EventBus.emit(Events.NET_FAILED,           d));
  }

  update(delta: number): void {
    if (this.spMode) {
      this.updateSingleplayer(delta);
      return;
    }
    if (!this.connected) return;

    this.sendAccum += delta;
    if (this.sendAccum < SEND_INTERVAL) return;
    this.sendAccum -= SEND_INTERVAL;

    const isInCar = this.car.isOccupied;
    const pos     = isInCar ? this.car.position : this.walk.position;
    this.socket.emit('player:position', {
      x: pos.x, y: pos.y, z: pos.z,
      heading: isInCar ? this.car.heading : this.walk.heading,
      speed:   isInCar ? this.car.currentSpeed : 0,
      steer:   isInCar ? this.car.currentSteer : 0,
      isInCar,
    });
  }

  requestPickup(restaurantIndex: number, destCx: number, destCz: number, timeLimit: number): void {
    if (this.spMode) {
      const orderValue = this.spOrders.get(restaurantIndex);
      if (orderValue === undefined) {
        EventBus.emit(Events.NET_PICKUP_DENIED, { restaurantIndex });
        return;
      }
      this.spOrders.delete(restaurantIndex);
      this.spCarried = { restaurantIndex, orderValue, timeLimit, startedAt: Date.now(), destCx, destCz };
      EventBus.emit(Events.NET_PICKUP_CONFIRMED, { restaurantIndex, orderValue, timeLimit, destCx, destCz });
      return;
    }
    this.socket.emit('delivery:pickup_request', { restaurantIndex, destCx, destCz, timeLimit });
  }

  requestDeliver(): void {
    if (this.spMode) {
      if (!this.spCarried) return;
      const elapsed   = (Date.now() - this.spCarried.startedAt) / 1000;
      const remaining = Math.max(0, this.spCarried.timeLimit - elapsed);
      const tipFrac   = (remaining / this.spCarried.timeLimit) * SP_MAX_TIP;
      const pay       = Math.round(this.spCarried.orderValue * (SP_BASE_PAY + tipFrac));
      this.spBalance += pay;
      this.spCarried  = null;
      EventBus.emit(Events.NET_DELIVERED, { playerId: 'local', pay, scores: this.buildSpScores() });
      return;
    }
    this.socket.emit('delivery:deliver_request');
  }

  dispose(): void {
    if (this.connected) this.socket.disconnect();
  }

  // ---------------------------------------------------------------------------

  private overrideSpawn(playerIndex: number): void {
    if (playerIndex === 0) return; // index 0 is the default spawn CityBuilder already set
    const builder = this.game.getSystem<CityBuilder>('city');
    if (!builder) return;
    const spawns = builder.getSpawnPositions();
    const s = spawns[playerIndex % spawns.length];
    this.car.setSpawn(s.x, 0, s.z, s.heading);
    this.car.resetToSpawn();
    const ep = this.car.entryPoint();
    this.walk.setSpawn(ep.x, 0, ep.z, s.heading);
    this.walk.resetToSpawn();
  }

  private updateSingleplayer(delta: number): void {
    // Autonomous order spawning
    this.spOrderTimer -= delta;
    if (this.spOrderTimer <= 0) {
      this.trySpawnSpOrder();
      this.spOrderTimer = SP_ORDER_INTERVAL_MIN + Math.random() * (SP_ORDER_INTERVAL_MAX - SP_ORDER_INTERVAL_MIN);
    }

    // Delivery timeout check
    if (this.spCarried) {
      const elapsed = (Date.now() - this.spCarried.startedAt) / 1000;
      if (elapsed >= this.spCarried.timeLimit) {
        this.spCarried = null;
        this.spFailures++;
        EventBus.emit(Events.NET_FAILED, { playerId: 'local', failures: this.spFailures, scores: this.buildSpScores() });
        if (this.spFailures >= DELIVERY_MAX_FAILURES) this.spMode = false; // stop spawning after game over
      }
    }
  }

  private trySpawnSpOrder(): void {
    const available: number[] = [];
    for (let i = 0; i < DELIVERY_RESTAURANT_COUNT; i++) {
      if (!this.spOrders.has(i) && this.spCarried?.restaurantIndex !== i) available.push(i);
    }
    if (available.length === 0) return;
    const idx        = available[Math.floor(Math.random() * available.length)];
    const orderValue = SP_ORDER_VALUE_MIN + Math.round(Math.random() * (SP_ORDER_VALUE_MAX - SP_ORDER_VALUE_MIN));
    this.spOrders.set(idx, orderValue);
    EventBus.emit(Events.NET_ORDER_SPAWNED, { restaurantIndex: idx, orderValue });
  }

  private buildSpScores(): Record<string, ScoreEntry> {
    return {
      local: {
        color:    playerOptions.carColor,
        balance:  this.spBalance,
        failures: this.spFailures,
        nickname: playerOptions.nickname,
      },
    };
  }
}

