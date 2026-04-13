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
  private _elapsed = 0;

  /** World-X centers of vertical streets (extracted once from layout). */
  private vCenters: number[] = [];
  /** World-Z centers of horizontal streets. */
  private hCenters: number[] = [];
  /** A* result cache — recomputed only when the snapped start/goal changes. */
  private _pathCache: { key: string; nodes: Array<{ x: number; z: number }> } = { key: '', nodes: [] };

  private overlay: HTMLElement | null = null;
  private overlayObserver: MutationObserver | null = null;

  init(game: Game): void {
    this.walker = game.getSystem<WalkSystem>('player')!;
    this.car = game.getSystem<CarSystem>('car')!;
    this.delivery = game.getSystem<DeliverySystem>('delivery') ?? null;

    const builder = game.getSystem<CityBuilder>('city')!;
    this.layout = builder.layout;

    this.buildStreetGraph();
    this.buildStaticMap();
    this.buildOverlayCanvas();

    // Hide minimap while the intro overlay is visible
    this.overlay = document.getElementById('overlay');
    this.syncVisibility();
    this.overlayObserver = new MutationObserver(() => this.syncVisibility());
    if (this.overlay) {
      this.overlayObserver.observe(this.overlay, { attributes: true, attributeFilter: ['class'] });
    }
  }

  update(delta: number): void {
    this._elapsed += delta;
    this.draw();
  }

  dispose(): void {
    this.overlayObserver?.disconnect();
    this.canvas.remove();
  }

  private syncVisibility(): void {
    const hidden = this.overlay != null && !this.overlay.classList.contains('hidden');
    this.canvas.style.display = hidden ? 'none' : 'block';
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

    const isMobile = 'ontouchstart' in window;
    const displaySize = isMobile ? Math.round(MAP_SIZE * 0.65) : MAP_SIZE;

    Object.assign(this.canvas.style, {
      position: 'fixed',
      top: isMobile ? '10px' : 'auto',
      bottom: isMobile ? 'auto' : `${MAP_PADDING}px`,
      right: isMobile ? '10px' : `${MAP_PADDING}px`,
      width: `${displaySize}px`,
      height: `${displaySize}px`,
      borderRadius: '6px',
      border: '1px solid rgba(255,255,255,0.25)',
      opacity: isMobile ? '0.7' : '0.85',
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

    // --- Route to nearest pickup / delivery destination ---
    if (this.delivery) {
      const px = this.car.position.x;
      const pz = this.car.position.z;
      if (this.delivery.destDot) {
        this.drawRoute(ctx, scaleX, scaleZ, px, pz, this.delivery.destDot.x, this.delivery.destDot.z, '#ff8800');
      } else if (this.delivery.pickupDots.length > 0) {
        let closest = this.delivery.pickupDots[0];
        let closestDist = Math.hypot(px - closest.x, pz - closest.z);
        for (let i = 1; i < this.delivery.pickupDots.length; i++) {
          const d = Math.hypot(px - this.delivery.pickupDots[i].x, pz - this.delivery.pickupDots[i].z);
          if (d < closestDist) { closestDist = d; closest = this.delivery.pickupDots[i]; }
        }
        this.drawRoute(ctx, scaleX, scaleZ, px, pz, closest.x, closest.z, '#22cc44');
      }
    }

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
        const pulse = Math.sin(this._elapsed * (1000 / 300)) * 0.5 + 0.5;
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
        const pulse = Math.sin(this._elapsed * (1000 / 250)) * 0.5 + 0.5;
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

  // ---------------------------------------------------------------------------
  // Pathfinding

  private buildStreetGraph(): void {
    const { totalWidth, totalDepth } = this.layout;
    this.vCenters = [];
    this.hCenters = [];
    for (const seg of this.layout.streets) {
      if (Math.abs(seg.depth - totalDepth) < 0.1) {
        this.vCenters.push(seg.x + seg.width / 2);
      } else if (Math.abs(seg.width - totalWidth) < 0.1) {
        this.hCenters.push(seg.z + seg.depth / 2);
      }
    }
    this.vCenters.sort((a, b) => a - b);
    this.hCenters.sort((a, b) => a - b);
  }

  private snapToGrid(wx: number, wz: number): { col: number; row: number } {
    let col = 0, minDx = Infinity;
    for (let i = 0; i < this.vCenters.length; i++) {
      const dx = Math.abs(wx - this.vCenters[i]);
      if (dx < minDx) { minDx = dx; col = i; }
    }
    let row = 0, minDz = Infinity;
    for (let j = 0; j < this.hCenters.length; j++) {
      const dz = Math.abs(wz - this.hCenters[j]);
      if (dz < minDz) { minDz = dz; row = j; }
    }
    return { col, row };
  }

  private findPath(fromX: number, fromZ: number, toX: number, toZ: number): Array<{ x: number; z: number }> {
    const vc = this.vCenters;
    const hc = this.hCenters;
    const cols = vc.length;
    const rows = hc.length;
    if (cols === 0 || rows === 0) return [];

    const start = this.snapToGrid(fromX, fromZ);
    const goal = this.snapToGrid(toX, toZ);
    const cacheKey = `${start.col},${start.row}|${goal.col},${goal.row}`;
    if (this._pathCache.key === cacheKey) return this._pathCache.nodes;

    const idx = (c: number, r: number) => c * rows + r;
    const heuristic = (c: number, r: number) =>
      Math.hypot(vc[c] - vc[goal.col], hc[r] - hc[goal.row]);

    const size = cols * rows;
    const gScore = new Float32Array(size).fill(Infinity);
    const came = new Int32Array(size).fill(-1);
    const startIdx = idx(start.col, start.row);
    gScore[startIdx] = 0;

    const open: Array<{ i: number; f: number }> = [{ i: startIdx, f: heuristic(start.col, start.row) }];

    while (open.length > 0) {
      let bestK = 0;
      for (let k = 1; k < open.length; k++) {
        if (open[k].f < open[bestK].f) bestK = k;
      }
      const { i: current } = open[bestK];
      open.splice(bestK, 1);

      const cc = Math.floor(current / rows);
      const cr = current % rows;

      if (cc === goal.col && cr === goal.row) {
        const nodes: Array<{ x: number; z: number }> = [];
        let n = current;
        while (n !== -1) {
          nodes.unshift({ x: vc[Math.floor(n / rows)], z: hc[n % rows] });
          n = came[n];
        }
        this._pathCache = { key: cacheKey, nodes };
        return nodes;
      }

      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = cc + dc, nr = cr + dr;
        if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
        const ni = idx(nc, nr);
        const tentG = gScore[current] + Math.hypot(vc[nc] - vc[cc], hc[nr] - hc[cr]);
        if (tentG < gScore[ni]) {
          came[ni] = current;
          gScore[ni] = tentG;
          const f = tentG + heuristic(nc, nr);
          const existing = open.findIndex(e => e.i === ni);
          if (existing >= 0) open[existing].f = f;
          else open.push({ i: ni, f });
        }
      }
    }

    this._pathCache = { key: cacheKey, nodes: [] };
    return [];
  }

  private drawRoute(
    ctx: CanvasRenderingContext2D,
    scaleX: number, scaleZ: number,
    fromX: number, fromZ: number,
    toX: number, toZ: number,
    color: string,
  ): void {
    const nodes = this.findPath(fromX, fromZ, toX, toZ);
    const pts: Array<[number, number]> = [
      [fromX * scaleX, fromZ * scaleZ],
      ...nodes.map(n => [n.x * scaleX, n.z * scaleZ] as [number, number]),
      [toX * scaleX, toZ * scaleZ],
    ];

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
    ctx.restore();
  }

  // ---------------------------------------------------------------------------

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
