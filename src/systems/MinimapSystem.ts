import { Game, GameSystem } from '../core/Game';
import { WalkSystem } from './WalkSystem';
import { CarSystem } from './CarSystem';
import { CityBuilder } from '../city/CityBuilder';
import { DeliverySystem } from './DeliverySystem';
import { CityLayoutData } from '../city/CityLayout';
import { MAP_SIZE, MAP_PADDING, MAP_DOT_RADIUS, MAP_ARROW_SIZE } from '../constants';

export class MinimapSystem implements GameSystem {
  readonly name = 'minimap';

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private walker!: WalkSystem;
  private car!: CarSystem;
  private delivery!: DeliverySystem | null;
  private layout!: CityLayoutData;

  private cityCanvas!: HTMLCanvasElement;

  init(game: Game): void {
    this.walker = game.getSystem<WalkSystem>('player')!;
    this.car = game.getSystem<CarSystem>('car')!;
    this.delivery = game.getSystem<DeliverySystem>('delivery') ?? null;

    const builder = game.getSystem<CityBuilder>('city')!;
    this.layout = builder.layout;

    this.buildStaticMap();
    this.buildOverlayCanvas();
  }

  update(): void {
    this.draw();
  }

  dispose(): void {
    this.canvas.remove();
  }

  // ---------------------------------------------------------------------------

  private buildStaticMap(): void {
    const { totalWidth, totalDepth } = this.layout;

    this.cityCanvas = document.createElement('canvas');
    this.cityCanvas.width = MAP_SIZE;
    this.cityCanvas.height = MAP_SIZE;
    const ctx = this.cityCanvas.getContext('2d')!;

    const scaleX = MAP_SIZE / totalWidth;
    const scaleZ = MAP_SIZE / totalDepth;

    ctx.fillStyle = '#3a3a3a';
    ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);

    ctx.fillStyle = '#5a5a5a';
    for (const sw of this.layout.sidewalks) {
      ctx.fillRect(sw.x * scaleX, sw.z * scaleZ, sw.width * scaleX, sw.depth * scaleZ);
    }

    for (const block of this.layout.blocks) {
      ctx.fillStyle = block.isPark ? '#4a8a2a' : '#8b9eb5';
      ctx.fillRect(block.x * scaleX, block.z * scaleZ, block.width * scaleX, block.depth * scaleZ);
    }
  }

  private buildOverlayCanvas(): void {
    this.canvas = document.createElement('canvas');
    this.canvas.width = MAP_SIZE;
    this.canvas.height = MAP_SIZE;

    Object.assign(this.canvas.style, {
      position: 'fixed',
      bottom: `${MAP_PADDING}px`,
      right: `${MAP_PADDING}px`,
      width: `${MAP_SIZE}px`,
      height: `${MAP_SIZE}px`,
      borderRadius: '6px',
      border: '1px solid rgba(255,255,255,0.25)',
      opacity: '0.85',
      pointerEvents: 'none',
      zIndex: '100',
    });

    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
  }

  private draw(): void {
    const ctx = this.ctx;
    const { totalWidth, totalDepth } = this.layout;
    const scaleX = MAP_SIZE / totalWidth;
    const scaleZ = MAP_SIZE / totalDepth;

    ctx.drawImage(this.cityCanvas, 0, 0);

    // --- Car dot (yellow) ---
    const cx = this.car.position.x * scaleX;
    const cz = this.car.position.z * scaleZ;
    ctx.beginPath();
    ctx.arc(cx, cz, MAP_DOT_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = '#f5c842';
    ctx.fill();

    // Car heading arrow
    this.drawArrow(ctx, cx, cz, -this.car.heading, '#f5c842');

    // --- Delivery: pickup dots (green) ---
    if (this.delivery) {
      for (const dot of this.delivery.pickupDots) {
        const dx = dot.x * scaleX;
        const dz = dot.z * scaleZ;
        const pulse = Math.sin(performance.now() / 300) * 0.5 + 0.5;
        // Outer pulse ring
        ctx.beginPath();
        ctx.arc(dx, dz, MAP_DOT_RADIUS + 4 + pulse * 2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(34,204,68,${0.2 + pulse * 0.25})`;
        ctx.fill();
        // Solid dot
        ctx.beginPath();
        ctx.arc(dx, dz, MAP_DOT_RADIUS + 1, 0, Math.PI * 2);
        ctx.fillStyle = '#22cc44';
        ctx.fill();
      }

      // Delivery destination dot (orange)
      if (this.delivery.destDot) {
        const dx = this.delivery.destDot.x * scaleX;
        const dz = this.delivery.destDot.z * scaleZ;
        const pulse = Math.sin(performance.now() / 250) * 0.5 + 0.5;
        ctx.beginPath();
        ctx.arc(dx, dz, MAP_DOT_RADIUS + 4 + pulse * 2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,136,0,${0.2 + pulse * 0.25})`;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(dx, dz, MAP_DOT_RADIUS + 1, 0, Math.PI * 2);
        ctx.fillStyle = '#ff8800';
        ctx.fill();
      }
    }

    // --- Player dot (red) — only when on foot ---
    if (!this.car.isOccupied) {
      const px = this.walker.position.x * scaleX;
      const pz = this.walker.position.z * scaleZ;

      ctx.beginPath();
      ctx.arc(px, pz, MAP_DOT_RADIUS + 2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 80, 80, 0.35)';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(px, pz, MAP_DOT_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = '#ff4040';
      ctx.fill();

      this.drawArrow(ctx, px, pz, -this.walker.heading, '#ffffff');
    }
  }

  private drawArrow(ctx: CanvasRenderingContext2D, px: number, pz: number, angle: number, color: string): void {
    const ax = px + Math.sin(angle) * MAP_ARROW_SIZE;
    const az = pz + Math.cos(angle) * MAP_ARROW_SIZE;

    ctx.beginPath();
    ctx.moveTo(ax, az);
    ctx.lineTo(
      px + Math.cos(angle + Math.PI * 0.8) * (MAP_ARROW_SIZE * 0.55),
      pz - Math.sin(angle + Math.PI * 0.8) * (MAP_ARROW_SIZE * 0.55),
    );
    ctx.lineTo(
      px + Math.cos(angle - Math.PI * 0.8) * (MAP_ARROW_SIZE * 0.55),
      pz - Math.sin(angle - Math.PI * 0.8) * (MAP_ARROW_SIZE * 0.55),
    );
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }
}
