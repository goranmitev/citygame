import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { texture as texNode, uv, fract, vec2 } from 'three/tsl';
import { PlotDef } from './CityLayout';
import { createRNG, randRange } from '../utils/random';
import { FLOOR_HEIGHT, WINDOW_COLOR, WINDOW_FRAME_COLOR } from '../constants';

const ATLAS_TILES = 4; // 4x4 atlas
export const ATLAS_TILE_COUNT = ATLAS_TILES * ATLAS_TILES;
export const UV_WORLD_SCALE = 4.0;

/**
 * Geometry buckets keyed by material name.
 * Accumulated across all buildings, then merged into single meshes.
 */
export interface GeometryBuckets {
  walls: THREE.BufferGeometry[][];
  groundFloors: THREE.BufferGeometry[][];
  windows: THREE.BufferGeometry[];
  windowFrames: THREE.BufferGeometry[];
  roofs: THREE.BufferGeometry[][];
}

function createLayeredBuckets(): THREE.BufferGeometry[][] {
  return Array.from({ length: ATLAS_TILE_COUNT }, () => [] as THREE.BufferGeometry[]);
}

export function createBuckets(): GeometryBuckets {
  return {
    walls: createLayeredBuckets(),
    groundFloors: createLayeredBuckets(),
    windows: [],
    windowFrames: [],
    roofs: createLayeredBuckets(),
  };
}

/** Create an atlas-tiling material. UVs are world-scaled; fract() tiles within the correct atlas quadrant. */
export function makeAtlasMaterial(
  baseMap: THREE.Texture,
  tileX: number,
  tileY: number,
  roughness: number,
): MeshStandardNodeMaterial {
  const scale = 1 / ATLAS_TILES;
  const tiledUv = fract(uv()).mul(scale).add(vec2(tileX / ATLAS_TILES, tileY / ATLAS_TILES));

  const mat = new MeshStandardNodeMaterial({ roughness });
  mat.colorNode = texNode(baseMap, tiledUv);
  return mat;
}

// Shared materials — created once
let _materials: ReturnType<typeof createMaterials> | null = null;

function createMaterials() {
  const loader = new THREE.TextureLoader();
  const wallMap = loader.load('/textures/walls-atlas.webp');
  const roofMap = loader.load('/textures/roofs-atlas.webp');

  // No repeat/offset needed — the shader handles atlas tiling
  wallMap.wrapS = wallMap.wrapT = THREE.ClampToEdgeWrapping;
  roofMap.wrapS = roofMap.wrapT = THREE.ClampToEdgeWrapping;

  const wallMaterials: THREE.Material[] = [];
  const groundFloorMaterials: THREE.Material[] = [];
  const roofMaterials: THREE.Material[] = [];

  for (let tile = 0; tile < ATLAS_TILE_COUNT; tile++) {
    const tileX = tile % ATLAS_TILES;
    const tileY = Math.floor(tile / ATLAS_TILES);

    wallMaterials.push(makeAtlasMaterial(wallMap, tileX, tileY, 0.85));
    // groundFloorMaterials.push(makeAtlasMaterial(wallMap, tileX, tileY, 0.8));
    roofMaterials.push(makeAtlasMaterial(roofMap, tileX, tileY, 0.9));
  }

  return {
    wall: wallMaterials,
    // groundFloor: groundFloorMaterials,
    window: new THREE.MeshStandardMaterial({ color: WINDOW_COLOR, roughness: 0.05, metalness: 0.6 }),
    windowFrame: new THREE.MeshStandardMaterial({ color: WINDOW_FRAME_COLOR, roughness: 0.7 }),
    roof: roofMaterials,
  };
}

export function getMaterials() {
  if (!_materials) _materials = createMaterials();
  return _materials;
}

// Reusable temp objects
const _mat4 = new THREE.Matrix4();

/** Apply a position transform to a geometry. */
function positionGeo(
  geo: THREE.BufferGeometry,
  x: number, y: number, z: number,
): THREE.BufferGeometry {
  const clone = geo.clone();
  _mat4.makeTranslation(x, y, z);
  clone.applyMatrix4(_mat4);
  return clone;
}

function applyWorldScaleUVs(geo: THREE.BufferGeometry): void {
  const uv = geo.getAttribute('uv');
  if (!uv) return;

  const params = (geo as any).parameters;
  if (params && params.width != null && params.height != null && params.depth != null) {
    applyBoxGeometryRepeatUVs(geo, params.width, params.height, params.depth);
    return;
  }

  uv.needsUpdate = true;
}

function applyBoxGeometryRepeatUVs(
  geo: THREE.BufferGeometry,
  width: number,
  height: number,
  depth: number,
): void {
  const uv = geo.getAttribute('uv');
  if (!uv) return;

  // BoxGeometry has 6 faces, 4 verts each, in order: +x, -x, +y, -y, +z, -z
  const repeats = [
    { u: depth / UV_WORLD_SCALE, v: height / UV_WORLD_SCALE },  // +x
    { u: depth / UV_WORLD_SCALE, v: height / UV_WORLD_SCALE },  // -x
    { u: width / UV_WORLD_SCALE, v: depth / UV_WORLD_SCALE },   // +y
    { u: width / UV_WORLD_SCALE, v: depth / UV_WORLD_SCALE },   // -y
    { u: width / UV_WORLD_SCALE, v: height / UV_WORLD_SCALE },  // +z
    { u: width / UV_WORLD_SCALE, v: height / UV_WORLD_SCALE },  // -z
  ];

  let index = 0;
  for (let face = 0; face < 6; face++) {
    const { u: faceU, v: faceV } = repeats[face];
    for (let vert = 0; vert < 4; vert++, index++) {
      uv.setXY(index, uv.getX(index) * faceU, uv.getY(index) * faceV);
    }
  }

  uv.needsUpdate = true;
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
  const cx = plot.x + plot.width / 2;
  const cz = plot.z + plot.depth / 2;

  // Main body
  const wallTile = Math.floor(rng() * ATLAS_TILE_COUNT);

  const bodyGeo = new THREE.BoxGeometry(plot.width, height, plot.depth);
  applyWorldScaleUVs(bodyGeo);
  buckets.walls[wallTile].push(positionGeo(bodyGeo, cx, height / 2, cz));

  // Darker ground floor overlay
  const gh = FLOOR_HEIGHT * 0.9;
  const gfGeo = new THREE.BoxGeometry(plot.width + 0.05, gh, plot.depth + 0.05);
  applyWorldScaleUVs(gfGeo);
  buckets.groundFloors[wallTile].push(positionGeo(gfGeo, cx, gh / 2, cz));

  // Windows
  pushWindows(buckets, plot, height, rng);

  // Roof
  pushRoof(buckets, plot, height, rng);

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
  rng: () => number,
): void {
  const cx = plot.x + plot.width / 2;
  const cz = plot.z + plot.depth / 2;
  const roofTile = Math.floor(rng() * ATLAS_TILE_COUNT);

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
    _mat4.makeTranslation(cx, height, cz - extrudeDepth / 2);
    roofGeo.applyMatrix4(_mat4);
    applyWorldScaleUVs(roofGeo);
    buckets.roofs[roofTile].push(roofGeo);
  } else {
    // Flat roof with parapet
    const slabGeo = new THREE.BoxGeometry(plot.width + 0.1, 0.15, plot.depth + 0.1);
    applyWorldScaleUVs(slabGeo);
    buckets.roofs[roofTile].push(positionGeo(slabGeo, cx, height + 0.075, cz));

    const ph = 0.5;
    const pt = 0.2;
    // Front/back parapets
    for (const dz of [-plot.depth / 2, plot.depth / 2]) {
      const geo = new THREE.BoxGeometry(plot.width + 0.2, ph, pt);
      applyWorldScaleUVs(geo);
      buckets.roofs[roofTile].push(positionGeo(geo, cx, height + ph / 2, cz + dz));
    }
    // Side parapets
    for (const dx of [-plot.width / 2, plot.width / 2]) {
      const geo = new THREE.BoxGeometry(pt, ph, plot.depth + 0.2);
      applyWorldScaleUVs(geo);
      buckets.roofs[roofTile].push(positionGeo(geo, cx + dx, height + ph / 2, cz));
    }
  }
}
