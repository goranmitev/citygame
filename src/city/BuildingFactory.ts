import * as THREE from 'three';
import { PlotDef } from './CityLayout';
import { createRNG, randRange, randPick } from '../utils/random';

const FLOOR_HEIGHT = 3.2;

const WALL_COLORS = [
  0xf2c57c, // warm yellow
  0xe8a87c, // peach / terracotta
  0xd4e6b5, // light green
  0xb5d4e6, // sky blue
  0xf5b5b5, // salmon pink
  0xe6ccf5, // lavender
  0xf5deb3, // wheat gold
  0xf0e68c, // khaki yellow
  0xffcba4, // light apricot
  0xc9e4de, // mint
  0xf7c8a0, // pastel orange
  0xd5e8d4, // sage green
  0xe0c8f0, // soft purple
  0xfce4ec, // blush pink
  0xc5dbe0, // powder blue
  0xfff8dc, // cornsilk
];
const WINDOW_COLOR = 0x8ec8e8;
const WINDOW_FRAME_COLOR = 0xf5f0e8;
const ROOF_COLORS = [0xb85c38, 0xc96a4b, 0xa34a28, 0x8b4513, 0x7a3b10];

/**
 * Geometry buckets keyed by material name.
 * Accumulated across all buildings, then merged into single meshes.
 */
export interface GeometryBuckets {
  walls: THREE.BufferGeometry[];
  groundFloors: THREE.BufferGeometry[];
  windows: THREE.BufferGeometry[];
  windowFrames: THREE.BufferGeometry[];
  roofs: THREE.BufferGeometry[];
}

export function createBuckets(): GeometryBuckets {
  return { walls: [], groundFloors: [], windows: [], windowFrames: [], roofs: [] };
}

// Shared materials — created once
let _materials: ReturnType<typeof createMaterials> | null = null;

function createMaterials() {
  return {
    wall: new THREE.MeshStandardMaterial({ color: 0xd4c5a9, roughness: 0.85, vertexColors: true }),
    groundFloor: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, vertexColors: true }),
    window: new THREE.MeshStandardMaterial({ color: WINDOW_COLOR, roughness: 0.05, metalness: 0.6 }),
    windowFrame: new THREE.MeshStandardMaterial({ color: WINDOW_FRAME_COLOR, roughness: 0.7 }),
    roof: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, vertexColors: true }),
  };
}

export function getMaterials() {
  if (!_materials) _materials = createMaterials();
  return _materials;
}

// Reusable temp objects
const _mat4 = new THREE.Matrix4();
const _color = new THREE.Color();

/** Apply a position transform to a geometry and optionally set vertex colors. */
function positionGeo(
  geo: THREE.BufferGeometry,
  x: number, y: number, z: number,
  color?: number,
): THREE.BufferGeometry {
  const clone = geo.clone();
  _mat4.makeTranslation(x, y, z);
  clone.applyMatrix4(_mat4);
  if (color !== undefined) {
    applyVertexColor(clone, color);
  }
  return clone;
}

function applyVertexColor(geo: THREE.BufferGeometry, hex: number): void {
  _color.set(hex);
  const count = geo.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = _color.r;
    colors[i * 3 + 1] = _color.g;
    colors[i * 3 + 2] = _color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

// Pre-created shared geometries (created lazily)
let _windowGeo: THREE.BufferGeometry | null = null;
let _frameGeo: THREE.BufferGeometry | null = null;

function getWindowGeo() {
  if (!_windowGeo) _windowGeo = new THREE.BoxGeometry(1.2, 1.8, 0.08);
  return _windowGeo;
}
function getFrameGeo() {
  if (!_frameGeo) _frameGeo = new THREE.BoxGeometry(1.36, 1.96, 0.04);
  return _frameGeo;
}

/**
 * Push building geometry into buckets (no Mesh creation).
 * Returns the collision AABB.
 */
export function pushBuilding(
  buckets: GeometryBuckets,
  plot: PlotDef,
  seed: number,
): THREE.Box3 {
  const rng = createRNG(seed);
  const height = plot.floors * FLOOR_HEIGHT;
  const wallColor = randPick(rng, WALL_COLORS);
  const roofColor = randPick(rng, ROOF_COLORS);
  const cx = plot.x + plot.width / 2;
  const cz = plot.z + plot.depth / 2;

  // Main body
  const bodyGeo = new THREE.BoxGeometry(plot.width, height, plot.depth);
  buckets.walls.push(positionGeo(bodyGeo, cx, height / 2, cz, wallColor));

  // Darker ground floor overlay
  const gh = FLOOR_HEIGHT * 0.9;
  const gfGeo = new THREE.BoxGeometry(plot.width + 0.05, gh, plot.depth + 0.05);
  const gfColor = _color.set(wallColor).multiplyScalar(0.8).getHex();
  buckets.groundFloors.push(positionGeo(gfGeo, cx, gh / 2, cz, gfColor));

  // Windows
  pushWindows(buckets, plot, height, rng);

  // Roof
  pushRoof(buckets, plot, height, roofColor, rng);

  return new THREE.Box3(
    new THREE.Vector3(plot.x, 0, plot.z),
    new THREE.Vector3(plot.x + plot.width, height, plot.z + plot.depth),
  );
}

function pushWindows(
  buckets: GeometryBuckets,
  plot: PlotDef,
  height: number,
  rng: () => number,
): void {
  const windowSpacing = randRange(rng, 2.8, 3.5);
  const sillHeight = 0.9;
  const winH = 1.8;

  const faces: Array<{ axis: 'x' | 'z'; length: number; fixedPos: number }> = [
    { axis: 'z', length: plot.width, fixedPos: plot.z - 0.04 },
    { axis: 'z', length: plot.width, fixedPos: plot.z + plot.depth + 0.04 },
  ];
  if (plot.depth > 8) {
    faces.push(
      { axis: 'x', length: plot.depth, fixedPos: plot.x - 0.04 },
      { axis: 'x', length: plot.depth, fixedPos: plot.x + plot.width + 0.04 },
    );
  }

  const wGeo = getWindowGeo();
  const fGeo = getFrameGeo();

  for (const face of faces) {
    const count = Math.max(1, Math.floor(face.length / windowSpacing));
    const spacing = face.length / (count + 1);

    for (let floor = 1; floor < plot.floors; floor++) {
      const y = floor * FLOOR_HEIGHT + sillHeight + winH / 2;
      if (y + winH / 2 > height - 0.5) continue;

      for (let w = 0; w < count; w++) {
        const offset = (w + 1) * spacing;
        let wx: number, wz: number;

        if (face.axis === 'z') {
          wx = plot.x + offset;
          wz = face.fixedPos;
        } else {
          wx = face.fixedPos;
          wz = plot.z + offset;
        }

        const wClone = wGeo.clone();
        const fClone = fGeo.clone();

        if (face.axis === 'x') {
          _mat4.makeRotationY(Math.PI / 2);
          _mat4.setPosition(wx, y, wz);
        } else {
          _mat4.makeTranslation(wx, y, wz);
        }

        wClone.applyMatrix4(_mat4);
        fClone.applyMatrix4(_mat4);

        buckets.windows.push(wClone);
        buckets.windowFrames.push(fClone);
      }
    }
  }
}

function pushRoof(
  buckets: GeometryBuckets,
  plot: PlotDef,
  height: number,
  roofColor: number,
  rng: () => number,
): void {
  const cx = plot.x + plot.width / 2;
  const cz = plot.z + plot.depth / 2;

  if (rng() > 0.4) {
    // Pitched roof
    const roofH = randRange(rng, 1.5, 3.0);
    const overhang = 0.3;
    const hw = plot.width / 2 + overhang;

    const shape = new THREE.Shape();
    shape.moveTo(-hw, 0);
    shape.lineTo(0, roofH);
    shape.lineTo(hw, 0);
    shape.lineTo(-hw, 0);

    const extrudeDepth = plot.depth + overhang * 2;
    const roofGeo = new THREE.ExtrudeGeometry(shape, {
      depth: extrudeDepth,
      bevelEnabled: false,
    });
    // Shape is centered at X=0, extruded along +Z from Z=0 to Z=extrudeDepth.
    _mat4.makeTranslation(cx, height, cz - extrudeDepth / 2);
    roofGeo.applyMatrix4(_mat4);
    applyVertexColor(roofGeo, roofColor);
    buckets.roofs.push(roofGeo);
  } else {
    // Flat roof with parapet
    const slabGeo = new THREE.BoxGeometry(plot.width + 0.1, 0.15, plot.depth + 0.1);
    buckets.roofs.push(positionGeo(slabGeo, cx, height + 0.075, cz, roofColor));

    const ph = 0.5;
    const pt = 0.2;
    // Front/back parapets
    for (const dz of [-plot.depth / 2, plot.depth / 2]) {
      const geo = new THREE.BoxGeometry(plot.width + 0.2, ph, pt);
      buckets.roofs.push(positionGeo(geo, cx, height + ph / 2, cz + dz, roofColor));
    }
    // Side parapets
    for (const dx of [-plot.width / 2, plot.width / 2]) {
      const geo = new THREE.BoxGeometry(pt, ph, plot.depth + 0.2);
      buckets.roofs.push(positionGeo(geo, cx + dx, height + ph / 2, cz, roofColor));
    }
  }
}
