import * as THREE from 'three';
import { Game, GameSystem } from '../core/Game';
import { WalkSystem, InteractZone } from './WalkSystem';
import { CityBuilder } from '../city/CityBuilder';
import { BlockDef } from '../city/CityLayout';
import { EventBus, Events, OrderSpawnedEvent, OrderPickedUpEvent, OrderDeliveredEvent } from '../core/EventBus';
import { createRNG } from '../utils/random';
import {
  DELIVERY_RESTAURANT_COUNT,
  DELIVERY_INTERACT_RADIUS,
  DELIVERY_MAX_FAILURES,
  DELIVERY_BASE_PAY,
  DELIVERY_MAX_TIP,
  DELIVERY_ORDER_VALUE_MIN,
  DELIVERY_ORDER_VALUE_MAX,
  DELIVERY_TIME_BASE,
  DELIVERY_TIME_PER_UNIT,
  DELIVERY_ORDER_INTERVAL_MIN,
  DELIVERY_ORDER_INTERVAL_MAX,
  DELIVERY_NEXT_ORDER_DELAY,
  CITY_SEED,
} from '../constants';

const RESTAURANT_NAMES = [
  "Kiro's Kitchen",
  'Gourmet Pizza',
  'Ice Cream Shop',
  'The Burger Joint',
  'Pasta Palace',
  'Dragon Wok',
  'Le Bistro',
  'Taco Town',
  'Sushi Garden',
  'The Bakery',
  "Mario's Trattoria",
  'Golden Dragon',
];

interface Restaurant {
  name: string;
  block: BlockDef;
  /** World-space center of interact zone (in front of south face). */
  cx: number;
  cz: number;
  markerGroup: THREE.Group;
  markerCap: THREE.Mesh;
  signMesh: THREE.Mesh;
  hasOrder: boolean;
  orderValue: number;
}

interface CarriedOrder {
  restaurantIndex: number;
  orderValue: number;
  timeLimit: number;
  elapsed: number;
  destCx: number;
  destCz: number;
  destMarkerGroup: THREE.Group;
  destMarkerCap: THREE.Mesh;
}

export class DeliverySystem implements GameSystem {
  readonly name = 'delivery';

  /** Exposed to MinimapSystem — world-space positions of restaurants with active orders. */
  readonly pickupDots: Array<{ x: number; z: number }> = [];
  /** Exposed to MinimapSystem — world-space position of current delivery destination. */
  destDot: { x: number; z: number } | null = null;

  private scene!: THREE.Scene;
  private walker!: WalkSystem;
  private restaurants: Restaurant[] = [];
  private nonRestaurantBlocks: BlockDef[] = [];
  private carried: CarriedOrder | null = null;
  private balance = 0;
  private failures = 0;
  private nextSpawnIn = 2; // first order after 2 seconds
  private gameOver = false;
  private notifyTimeout = 0;
  private _elapsed = 0;

  // HUD elements
  private timerEl!: HTMLDivElement;
  private statsEl!: HTMLDivElement;
  private notifyEl!: HTMLDivElement;

  init(game: Game): void {
    this.scene = game.scene;
    this.walker = game.getSystem<WalkSystem>('player')!;
    const builder = game.getSystem<CityBuilder>('city')!;
    const { blocks } = builder.layout;

    // Shuffle non-park blocks and pick restaurants
    const rng = createRNG(CITY_SEED + 9973);
    const nonPark = blocks.filter(b => !b.isPark && b.plots.length > 0);
    const shuffled = [...nonPark];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const rBlocks = shuffled.slice(0, Math.min(DELIVERY_RESTAURANT_COUNT, shuffled.length));
    const rSet = new Set(rBlocks);
    this.nonRestaurantBlocks = nonPark.filter(b => !rSet.has(b));

    // Shuffle restaurant names
    const names = [...RESTAURANT_NAMES];
    for (let i = names.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [names[i], names[j]] = [names[j], names[i]];
    }

    rBlocks.forEach((block, i) => {
      const name = names[i % names.length];
      // Interact zone just in front of the south face, in the sidewalk
      const cx = block.x + block.width / 2;
      const cz = block.z + block.depth + 2;

      const signMesh = this.buildSign(block, name, cx);
      const { group: markerGroup, cap: markerCap } = this.buildMarker(cx, cz, 0x22cc44);
      markerGroup.visible = false;

      this.restaurants.push({ name, block, cx, cz, markerGroup, markerCap, signMesh, hasOrder: false, orderValue: 0 });
    });

    this.buildHUD();
    this.refreshStats();
  }

  update(delta: number): void {
    if (this.gameOver) return;
    this._elapsed += delta;

    // Spawn orders
    this.nextSpawnIn -= delta;
    if (this.nextSpawnIn <= 0) {
      this.spawnOrder();
      this.nextSpawnIn = DELIVERY_ORDER_INTERVAL_MIN +
        Math.random() * (DELIVERY_ORDER_INTERVAL_MAX - DELIVERY_ORDER_INTERVAL_MIN);
    }

    // Tick timer for carried order
    if (this.carried) {
      this.carried.elapsed += delta;
      const remaining = this.carried.timeLimit - this.carried.elapsed;
      if (remaining <= 0) {
        this.failDelivery();
      } else {
        this.drawTimer(remaining, this.carried.timeLimit, this.carried.orderValue);
      }
    }

    // Animate marker caps (bob up and down)
    const bob = Math.sin(this._elapsed * (1000 / 300)) * 0.4;
    for (const r of this.restaurants) {
      if (r.hasOrder) r.markerCap.position.y = 11 + bob;
    }
    if (this.carried) {
      this.carried.destMarkerCap.position.y = 11 + bob;
    }

    // Notification fade
    if (this.notifyTimeout > 0) {
      this.notifyTimeout -= delta;
      if (this.notifyTimeout <= 0) this.notifyEl.style.display = 'none';
    }
  }

  dispose(): void {
    this.timerEl.remove();
    this.statsEl.remove();
    this.notifyEl.remove();
    for (let i = 0; i < this.restaurants.length; i++) {
      const r = this.restaurants[i];
      this.scene.remove(r.signMesh, r.markerGroup);
      this.walker.unregisterInteractZone(`restaurant_${i}`);
    }
    if (this.carried) {
      this.scene.remove(this.carried.destMarkerGroup);
      this.walker.unregisterInteractZone('delivery_dest');
    }
  }

  // ---------------------------------------------------------------------------

  private spawnOrder(): void {
    const available = this.restaurants.filter(r => !r.hasOrder);
    if (available.length === 0) return;

    const r = available[Math.floor(Math.random() * available.length)];
    const idx = this.restaurants.indexOf(r);
    r.orderValue = Math.round(
      DELIVERY_ORDER_VALUE_MIN + Math.random() * (DELIVERY_ORDER_VALUE_MAX - DELIVERY_ORDER_VALUE_MIN)
    );
    r.hasOrder = true;
    r.markerGroup.visible = true;
    this.refreshPickupDots();

    const zone: InteractZone = {
      id: `restaurant_${idx}`,
      center: new THREE.Vector3(r.cx, 0, r.cz),
      radius: DELIVERY_INTERACT_RADIUS,
      getPrompt: () => this.carried
        ? 'Already carrying an order!'
        : `Press E to pick up — $${r.orderValue} order`,
      onInteract: () => { if (!this.carried) this.pickUp(idx); },
    };
    this.walker.registerInteractZone(zone);

    EventBus.emit<OrderSpawnedEvent>(Events.ORDER_SPAWNED, { restaurantName: r.name, orderValue: r.orderValue });
  }

  private pickUp(restaurantIndex: number): void {
    const r = this.restaurants[restaurantIndex];
    if (!r.hasOrder || this.nonRestaurantBlocks.length === 0) return;

    // Random delivery destination (non-restaurant building)
    const destBlock = this.nonRestaurantBlocks[Math.floor(Math.random() * this.nonRestaurantBlocks.length)];
    const destCx = destBlock.x + destBlock.width / 2;
    const destCz = destBlock.z + destBlock.depth + 2;

    const dist = Math.hypot(destCx - r.cx, destCz - r.cz);
    const timeLimit = DELIVERY_TIME_BASE + dist * DELIVERY_TIME_PER_UNIT;

    const { group: destGroup, cap: destCap } = this.buildMarker(destCx, destCz, 0xff8800);

    this.carried = {
      restaurantIndex,
      orderValue: r.orderValue,
      timeLimit,
      elapsed: 0,
      destCx,
      destCz,
      destMarkerGroup: destGroup,
      destMarkerCap: destCap,
    };

    r.hasOrder = false;
    r.markerGroup.visible = false;
    this.walker.unregisterInteractZone(`restaurant_${restaurantIndex}`);
    this.refreshPickupDots();

    this.walker.registerInteractZone({
      id: 'delivery_dest',
      center: new THREE.Vector3(destCx, 0, destCz),
      radius: DELIVERY_INTERACT_RADIUS,
      getPrompt: () => 'Press E to deliver order',
      onInteract: () => this.deliver(),
    });

    this.destDot = { x: destCx, z: destCz };
    this.timerEl.style.display = 'block';

    EventBus.emit<OrderPickedUpEvent>(Events.ORDER_PICKED_UP, {
      restaurantName: r.name,
      orderValue: r.orderValue,
      timeLimit,
    });

    this.notify(`Order picked up! Deliver within ${Math.ceil(timeLimit)}s`, '#22cc44');
  }

  private deliver(): void {
    if (!this.carried) return;
    const { orderValue, timeLimit, elapsed, destMarkerGroup } = this.carried;

    const remaining = Math.max(0, timeLimit - elapsed);
    const tipFrac = (remaining / timeLimit) * DELIVERY_MAX_TIP;
    const pay = Math.round(orderValue * (DELIVERY_BASE_PAY + tipFrac));

    this.balance += pay;
    this.walker.unregisterInteractZone('delivery_dest');
    this.removeMarker(destMarkerGroup);
    this.carried = null;
    this.destDot = null;
    this.timerEl.style.display = 'none';

    this.refreshStats();
    EventBus.emit<OrderDeliveredEvent>(Events.ORDER_DELIVERED, {
      pay,
      tipPercent: Math.round(tipFrac * 100),
    });
    this.notify(`Delivered! +$${pay}  (tip ${Math.round(tipFrac * 100)}%)`, '#22cc44');

    this.nextSpawnIn = Math.min(this.nextSpawnIn, DELIVERY_NEXT_ORDER_DELAY);
  }

  private failDelivery(): void {
    if (!this.carried) return;
    const { destMarkerGroup } = this.carried;

    this.walker.unregisterInteractZone('delivery_dest');
    this.removeMarker(destMarkerGroup);
    this.carried = null;
    this.destDot = null;
    this.timerEl.style.display = 'none';

    this.failures++;
    this.refreshStats();
    EventBus.emit(Events.ORDER_FAILED, undefined);
    this.notify('Time out! Order failed.', '#cc2200');

    if (this.failures >= DELIVERY_MAX_FAILURES) {
      this.showGameOver();
      return;
    }
    this.nextSpawnIn = Math.min(this.nextSpawnIn, DELIVERY_NEXT_ORDER_DELAY);
  }

  private showGameOver(): void {
    this.gameOver = true;
    const el = document.createElement('div');
    Object.assign(el.style, {
      position: 'fixed',
      inset: '0',
      background: 'rgba(0,0,0,0.8)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#fff',
      fontFamily: 'sans-serif',
      zIndex: '1000',
    });
    el.innerHTML = `
      <div style="font-size:52px;font-weight:bold;color:#ff4444;letter-spacing:0.05em">GAME OVER</div>
      <div style="font-size:22px;margin-top:14px;opacity:0.8">You failed ${DELIVERY_MAX_FAILURES} deliveries</div>
      <div style="font-size:34px;margin-top:16px;color:#f5c842">Final earnings: $${this.balance}</div>
      <div style="font-size:15px;margin-top:28px;opacity:0.5">Refresh the page to play again</div>
    `;
    document.body.appendChild(el);
  }

  private refreshPickupDots(): void {
    this.pickupDots.length = 0;
    for (const r of this.restaurants) {
      if (r.hasOrder) this.pickupDots.push({ x: r.cx, z: r.cz });
    }
  }

  // ---------------------------------------------------------------------------
  // 3D helpers

  private buildSign(block: BlockDef, name: string, cx: number): THREE.Mesh {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 96;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#b81c00';
    ctx.fillRect(0, 0, 512, 96);
    ctx.strokeStyle = '#ffcc00';
    ctx.lineWidth = 5;
    ctx.strokeRect(5, 5, 502, 86);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, 256, 48);

    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
    const geo = new THREE.PlaneGeometry(4, 0.75);
    const mesh = new THREE.Mesh(geo, mat);

    // Find the plot with the largest Z face (closest to south/+Z side of block)
    // and place the sign flush against that building wall
    let signX = cx;
    let signZ = block.z + block.depth; // fallback
    if (block.plots.length > 0) {
      let best = block.plots[0];
      for (const p of block.plots) {
        if (p.z + p.depth > best.z + best.depth) best = p;
      }
      signX = best.x + best.width / 2;
      signZ = best.z + best.depth + 0.02; // flush on the south wall
    }

    mesh.position.set(signX, 3.5, signZ);
    this.scene.add(mesh);
    return mesh;
  }

  private buildMarker(cx: number, cz: number, color: number): { group: THREE.Group; cap: THREE.Mesh } {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4 });

    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.14, 11, 0.14), mat);
    pole.position.set(0, 5.5, 0);
    group.add(pole);

    // Diamond cap (rotated box)
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.85, 0.85), mat);
    cap.position.set(0, 11, 0);
    cap.rotation.z = Math.PI / 4;
    cap.rotation.y = Math.PI / 4;
    group.add(cap);

    group.position.set(cx, 0, cz);
    this.scene.add(group);
    return { group, cap };
  }

  private removeMarker(group: THREE.Group): void {
    this.scene.remove(group);
    for (const child of group.children) {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // HUD

  private buildHUD(): void {
    // Timer — right of speedometer (which is 120px wide at left:10)
    this.timerEl = document.createElement('div');
    Object.assign(this.timerEl.style, {
      position: 'fixed',
      bottom: '10px',
      left: '140px',
      background: 'rgba(10,12,20,0.78)',
      color: '#fff',
      fontFamily: 'monospace',
      fontSize: '14px',
      padding: '8px 16px',
      borderRadius: '8px',
      border: '1px solid rgba(255,255,255,0.2)',
      pointerEvents: 'none',
      display: 'none',
      zIndex: '100',
      minWidth: '110px',
      textAlign: 'center',
    });
    document.body.appendChild(this.timerEl);

    // Stats panel — top right (desktop), top center (mobile to avoid minimap)
    const isMobile = 'ontouchstart' in window;
    this.statsEl = document.createElement('div');
    Object.assign(this.statsEl.style, {
      position: 'fixed',
      top: '10px',
      right: isMobile ? 'auto' : '10px',
      left: isMobile ? '50%' : 'auto',
      transform: isMobile ? 'translateX(-50%)' : 'none',
      background: 'rgba(10,12,20,0.78)',
      color: '#f5c842',
      fontFamily: 'monospace',
      fontSize: '17px',
      fontWeight: 'bold',
      padding: '8px 16px',
      borderRadius: '8px',
      border: '1px solid rgba(255,255,255,0.18)',
      pointerEvents: 'none',
      zIndex: '100',
      lineHeight: '1.6',
      textAlign: isMobile ? 'center' : 'right',
    });
    document.body.appendChild(this.statsEl);

    // Notification — upper center
    this.notifyEl = document.createElement('div');
    Object.assign(this.notifyEl.style, {
      position: 'fixed',
      top: '18%',
      left: '50%',
      transform: 'translateX(-50%)',
      background: 'rgba(10,12,20,0.85)',
      color: '#fff',
      fontFamily: 'sans-serif',
      fontSize: '18px',
      padding: '12px 28px',
      borderRadius: '8px',
      border: '1px solid rgba(255,255,255,0.2)',
      pointerEvents: 'none',
      display: 'none',
      zIndex: '200',
      whiteSpace: 'nowrap',
    });
    document.body.appendChild(this.notifyEl);
  }

  private refreshStats(): void {
    const livesLeft = DELIVERY_MAX_FAILURES - this.failures;
    const liveDots = '\u25cf'.repeat(livesLeft) + '\u25cb'.repeat(this.failures);
    this.statsEl.innerHTML =
      `<div>$${this.balance}</div>` +
      `<div style="font-size:13px;color:#ff6666;letter-spacing:0.1em">${liveDots}</div>`;
  }

  private drawTimer(remaining: number, total: number, orderValue: number): void {
    const frac = remaining / total;
    const col = frac > 0.5 ? '#22cc44' : frac > 0.25 ? '#f5a623' : '#ff4444';
    this.timerEl.innerHTML =
      `<div style="font-size:24px;font-weight:bold;color:${col}">${Math.ceil(remaining)}s</div>` +
      `<div style="color:#aaa;font-size:12px">$${orderValue} order</div>`;
    this.timerEl.style.borderColor = col;
  }

  private notify(msg: string, color: string): void {
    this.notifyEl.textContent = msg;
    this.notifyEl.style.color = color;
    this.notifyEl.style.display = 'block';
    this.notifyTimeout = 3;
  }
}
