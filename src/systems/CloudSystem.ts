import * as THREE from 'three';
import { Game, GameSystem } from '../core/Game';
import {
  CLOUD_COUNT, CLOUD_MIN_Y, CLOUD_MAX_Y, CLOUD_DRIFT_SPEED,
  CLOUD_DRIFT_DIR_X, CLOUD_DRIFT_DIR_Z, SPRITES_PER_CLOUD,
  SPRITE_MIN_SIZE, SPRITE_MAX_SIZE, CLOUD_SPREAD_X, CLOUD_SPREAD_Z,
  CLOUD_FIELD_HALF as FIELD_HALF,
} from '../constants';

/**
 * Sprite-based clouds. Each cloud is a group of billboard sprites sharing a
 * single canvas-generated soft cloud texture. Sprites always face the camera
 * so they look flat and natural when viewed from ground level.
 */
export class CloudSystem implements GameSystem {
  readonly name = 'clouds';

  private sprites: THREE.Sprite[] = [];
  private positions: THREE.Vector3[] = [];
  private driftX: number;
  private driftZ: number;
  private centreX: number;
  private centreZ: number;

  constructor(cityCentreX = 0, cityCentreZ = 0) {
    this.centreX = cityCentreX;
    this.centreZ = cityCentreZ;
    const len = Math.hypot(CLOUD_DRIFT_DIR_X, CLOUD_DRIFT_DIR_Z);
    this.driftX = CLOUD_DRIFT_DIR_X / len;
    this.driftZ = CLOUD_DRIFT_DIR_Z / len;
  }

  init(game: Game): void {
    const { scene } = game;
    const texture = buildCloudTexture();
    const rng = seededRng(4917);

    for (let i = 0; i < CLOUD_COUNT; i++) {
      // Anchor position for this cloud group
      const ax = this.centreX + (rng() - 0.5) * FIELD_HALF * 2;
      const ay = CLOUD_MIN_Y + rng() * (CLOUD_MAX_Y - CLOUD_MIN_Y);
      const az = this.centreZ + (rng() - 0.5) * FIELD_HALF * 2;

      // Place several sprites offset around the anchor to form one puffy cloud
      for (let s = 0; s < SPRITES_PER_CLOUD; s++) {
        const mat = new THREE.SpriteMaterial({
          map: texture,
          transparent: true,
          opacity: 0.55 + rng() * 0.3,
          depthWrite: false,
          color: new THREE.Color(1, 1, 1),
        });
        const sprite = new THREE.Sprite(mat);

        const size = SPRITE_MIN_SIZE + rng() * (SPRITE_MAX_SIZE - SPRITE_MIN_SIZE);
        sprite.scale.set(size * (1.4 + rng() * 0.4), size * 0.55, 1);

        const ox = (rng() - 0.5) * CLOUD_SPREAD_X;
        const oy = (rng() - 0.5) * size * 0.15;
        const oz = (rng() - 0.5) * CLOUD_SPREAD_Z;

        sprite.position.set(ax + ox, ay + oy, az + oz);
        scene.add(sprite);
        this.sprites.push(sprite);
      }

      // Track the anchor for drift/wrap (one per cloud group)
      this.positions.push(new THREE.Vector3(ax, ay, az));
    }
  }

  update(delta: number): void {
    const dx = this.driftX * CLOUD_DRIFT_SPEED * delta;
    const dz = this.driftZ * CLOUD_DRIFT_SPEED * delta;

    for (let i = 0; i < CLOUD_COUNT; i++) {
      const pos = this.positions[i];
      const prevX = pos.x;
      const prevZ = pos.z;

      pos.x += dx;
      pos.z += dz;

      let wrapDX = 0;
      let wrapDZ = 0;
      if (pos.x - this.centreX >  FIELD_HALF) { pos.x -= FIELD_HALF * 2; wrapDX = pos.x - prevX; }
      if (pos.x - this.centreX < -FIELD_HALF) { pos.x += FIELD_HALF * 2; wrapDX = pos.x - prevX; }
      if (pos.z - this.centreZ >  FIELD_HALF) { pos.z -= FIELD_HALF * 2; wrapDZ = pos.z - prevZ; }
      if (pos.z - this.centreZ < -FIELD_HALF) { pos.z += FIELD_HALF * 2; wrapDZ = pos.z - prevZ; }

      const base = i * SPRITES_PER_CLOUD;
      for (let s = 0; s < SPRITES_PER_CLOUD; s++) {
        const sp = this.sprites[base + s];
        if (wrapDX !== 0 || wrapDZ !== 0) {
          // Teleport the whole group on wrap
          sp.position.x += wrapDX;
          sp.position.z += wrapDZ;
        } else {
          sp.position.x += dx;
          sp.position.z += dz;
        }
      }
    }
  }

  dispose(): void {
    for (const sprite of this.sprites) {
      sprite.material.dispose();
    }
  }
}

/**
 * Generates a soft, blurry cloud puff texture on a canvas.
 * Multiple radial gradients layered to break up the circle shape.
 */
function buildCloudTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const cx = size / 2;
  const cy = size / 2;

  // Several overlapping soft white blobs
  const blobs = [
    { x: cx,           y: cy,           r: size * 0.38 },
    { x: cx - size * 0.18, y: cy + size * 0.05, r: size * 0.28 },
    { x: cx + size * 0.18, y: cy + size * 0.05, r: size * 0.28 },
    { x: cx - size * 0.08, y: cy - size * 0.08, r: size * 0.22 },
    { x: cx + size * 0.10, y: cy - size * 0.06, r: size * 0.20 },
  ];

  for (const b of blobs) {
    const grad = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
    grad.addColorStop(0.0, 'rgba(255,255,255,0.90)');
    grad.addColorStop(0.4, 'rgba(255,255,255,0.60)');
    grad.addColorStop(0.75, 'rgba(255,255,255,0.15)');
    grad.addColorStop(1.0, 'rgba(255,255,255,0.00)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }

  const tex = new THREE.CanvasTexture(canvas);
  return tex;
}

function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return (): number => {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0xffffffff;
  };
}
