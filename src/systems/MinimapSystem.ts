import { Game, GameSystem } from '../core/Game';
import { CarSystem } from './CarSystem';
import { CityBuilder } from '../city/CityBuilder';
import { CityLayoutData } from '../city/CityLayout';

const MAP_SIZE = 180;       // px — canvas size
const PADDING = 10;         // px from corner
const DOT_RADIUS = 4;       // px — player dot
const ARROW_SIZE = 7;       // px — arrowhead half-size

export class MinimapSystem implements GameSystem {
  readonly name = 'minimap';

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private car!: CarSystem;
  private layout!: CityLayoutData;

  // Pre-rendered static city background
  private cityCanvas!: HTMLCanvasElement;

  init(game: Game): void {
    this.car = game.getSystem<CarSystem>('player')!;

    // CityBuilder exposes the layout after init
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

    // Background (streets / asphalt)
    ctx.fillStyle = '#3a3a3a';
    ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);

    // Sidewalks
    ctx.fillStyle = '#5a5a5a';
    for (const sw of this.layout.sidewalks) {
      ctx.fillRect(
        sw.x * scaleX,
        sw.z * scaleZ,
        sw.width * scaleX,
        sw.depth * scaleZ,
      );
    }

    // Building blocks (filled rectangles per block)
    ctx.fillStyle = '#8b9eb5';
    for (const block of this.layout.blocks) {
      ctx.fillRect(
        block.x * scaleX,
        block.z * scaleZ,
        block.width * scaleX,
        block.depth * scaleZ,
      );
    }
  }

  private buildOverlayCanvas(): void {
    this.canvas = document.createElement('canvas');
    this.canvas.width = MAP_SIZE;
    this.canvas.height = MAP_SIZE;

    Object.assign(this.canvas.style, {
      position: 'fixed',
      bottom: `${PADDING}px`,
      right: `${PADDING}px`,
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

    // Stamp pre-rendered city
    ctx.drawImage(this.cityCanvas, 0, 0);

    // Player dot + heading arrow
    const px = this.car.position.x * scaleX;
    const pz = this.car.position.z * scaleZ;

    // Outer glow
    ctx.beginPath();
    ctx.arc(px, pz, DOT_RADIUS + 2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 80, 80, 0.35)';
    ctx.fill();

    // Solid dot
    ctx.beginPath();
    ctx.arc(px, pz, DOT_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = '#ff4040';
    ctx.fill();

    // Heading arrow — CarSystem.heading: 0 = +Z, increasing = CCW
    // On the minimap +Z maps to +Y (down), so we negate to get screen angle
    const angle = -this.carHeading();
    const ax = px + Math.sin(angle) * ARROW_SIZE;
    const az = pz + Math.cos(angle) * ARROW_SIZE;

    ctx.beginPath();
    ctx.moveTo(ax, az);
    ctx.lineTo(
      px + Math.cos(angle + Math.PI * 0.8) * (ARROW_SIZE * 0.55),
      pz - Math.sin(angle + Math.PI * 0.8) * (ARROW_SIZE * 0.55),
    );
    ctx.lineTo(
      px + Math.cos(angle - Math.PI * 0.8) * (ARROW_SIZE * 0.55),
      pz - Math.sin(angle - Math.PI * 0.8) * (ARROW_SIZE * 0.55),
    );
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }

  /** Read heading from CarSystem (private field — accessed via reflection). */
  private carHeading(): number {
    // CarSystem exposes `heading` as a private field; we read it via bracket access
    return (this.car as unknown as { heading: number }).heading;
  }
}
