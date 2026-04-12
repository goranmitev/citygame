import { Game, GameSystem } from '../core/Game';
import { CarSystem } from './CarSystem';
import { SPEEDO_SIZE as SIZE, SPEEDO_PADDING as PADDING, SPEEDO_MAX_SPEED as MAX_SPEED } from '../constants';

export class SpeedometerSystem implements GameSystem {
  readonly name = 'speedometer';

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private car!: CarSystem;

  init(game: Game): void {
    this.car = game.getSystem<CarSystem>('car')!;
    this.buildCanvas();
  }

  update(): void {
    // Only show speedometer while driving
    this.canvas.style.display = this.car.isOccupied ? 'block' : 'none';
    if (this.car.isOccupied) {
      this.draw(this.car.getSpeedKmh());
    }
  }

  dispose(): void {
    this.canvas.remove();
  }

  // ---------------------------------------------------------------------------

  private buildCanvas(): void {
    this.canvas = document.createElement('canvas');
    this.canvas.width = SIZE;
    this.canvas.height = SIZE;

    const isMobile = 'ontouchstart' in window;
    const displaySize = isMobile ? Math.round(SIZE * 0.7) : SIZE;

    // Desktop: bottom-left. Mobile: top-left (out of joystick zone)
    Object.assign(this.canvas.style, {
      position: 'fixed',
      top: isMobile ? '10px' : 'auto',
      bottom: isMobile ? 'auto' : `${PADDING}px`,
      left: `${isMobile ? 10 : PADDING}px`,
      width: `${displaySize}px`,
      height: `${displaySize}px`,
      pointerEvents: 'none',
      zIndex: '100',
      opacity: isMobile ? '0.8' : '1',
    });

    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
  }

  private draw(kmh: number): void {
    const ctx = this.ctx;
    const cx = SIZE / 2;
    const cy = SIZE / 2;
    const r = SIZE / 2 - 6;

    ctx.clearRect(0, 0, SIZE, SIZE);

    // --- Dial background ---
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(10, 12, 20, 0.75)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Arc angles: start = 135° (bottom-left), sweep 270° clockwise to 45° (bottom-right)
    const START_ANGLE = (135 * Math.PI) / 180;
    const SWEEP = (270 * Math.PI) / 180;

    // --- Tick marks ---
    const tickCount = 8; // 0, 20, 40 … 160
    for (let i = 0; i <= tickCount; i++) {
      const frac = i / tickCount;
      const angle = START_ANGLE + frac * SWEEP;
      const isMajor = true; // all ticks are spaced 20 km/h
      const inner = r - (isMajor ? 12 : 8);
      const outer = r - 2;

      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
      ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = i % 2 === 0 ? 2 : 1;
      ctx.stroke();

      // Label every 40 km/h
      if (i % 2 === 0) {
        const labelR = r - 22;
        const lx = cx + Math.cos(angle) * labelR;
        const ly = cy + Math.sin(angle) * labelR;
        ctx.font = 'bold 9px sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i * 20), lx, ly);
      }
    }

    // --- Speed arc ---
    const speedFrac = Math.min(kmh / MAX_SPEED, 1);
    const arcEnd = START_ANGLE + speedFrac * SWEEP;
    const arcR = r - 16;

    ctx.beginPath();
    ctx.arc(cx, cy, arcR, START_ANGLE, arcEnd);
    ctx.strokeStyle = speedFrac > 0.75 ? '#ff4444' : speedFrac > 0.45 ? '#f5a623' : '#4af';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.stroke();

    // --- Needle ---
    const needleAngle = START_ANGLE + speedFrac * SWEEP;
    const nLen = arcR - 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(needleAngle) * nLen, cy + Math.sin(needleAngle) * nLen);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Needle pivot dot
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    // --- Digital readout ---
    const digits = Math.round(kmh).toString().padStart(3, ' ');
    ctx.font = 'bold 18px monospace';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(digits, cx, cy + 22);

    ctx.font = '8px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillText('km/h', cx, cy + 34);
  }
}
