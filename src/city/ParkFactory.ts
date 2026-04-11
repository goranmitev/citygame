import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BlockDef } from './CityLayout';
import { createRNG, randRange, randInt } from '../utils/random';

const GRASS_COLOR = 0x5a8a3a;
const GRASS_DARK_COLOR = 0x4a7a2a;
const PATH_COLOR = 0xc8b89a;
const TRUNK_COLOR = 0x6b4a2a;
const LEAF_COLOR_A = 0x3a7a2a;
const LEAF_COLOR_B = 0x4a9a3a;
const LEAF_COLOR_C = 0x2d6622;
const BENCH_SEAT_COLOR = 0x8b5e3c;
const BENCH_LEG_COLOR = 0x5a3a1a;

const LEAF_COLORS = [LEAF_COLOR_A, LEAF_COLOR_B, LEAF_COLOR_C];

const _mat4 = new THREE.Matrix4();
const _color = new THREE.Color();

function applyVertexColor(geo: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  _color.set(hex);
  const count = geo.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = _color.r;
    colors[i * 3 + 1] = _color.g;
    colors[i * 3 + 2] = _color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

function positioned(geo: THREE.BufferGeometry, x: number, y: number, z: number): THREE.BufferGeometry {
  const c = geo.clone();
  _mat4.makeTranslation(x, y, z);
  c.applyMatrix4(_mat4);
  return c;
}

export interface ParkGeometry {
  grassGeos: THREE.BufferGeometry[];
  pathGeos: THREE.BufferGeometry[];
  trunkGeos: THREE.BufferGeometry[];
  leafGeos: THREE.BufferGeometry[];
  benchGeos: THREE.BufferGeometry[];
  /** AABB for each tree trunk (for car collision) */
  treeColliders: THREE.Box3[];
}

export function buildPark(block: BlockDef, seed: number): ParkGeometry {
  const rng = createRNG(seed);
  const { x, z, width, depth } = block;
  const cx = x + width / 2;
  const cz = z + depth / 2;

  const grassGeos: THREE.BufferGeometry[] = [];
  const pathGeos: THREE.BufferGeometry[] = [];
  const trunkGeos: THREE.BufferGeometry[] = [];
  const leafGeos: THREE.BufferGeometry[] = [];
  const benchGeos: THREE.BufferGeometry[] = [];
  const treeColliders: THREE.Box3[] = [];

  // --- Grass base (slight raise over ground) ---
  const grassGeo = new THREE.BoxGeometry(width, 0.08, depth);
  _mat4.makeTranslation(cx, 0.04, cz);
  grassGeo.applyMatrix4(_mat4);
  applyVertexColor(grassGeo, GRASS_COLOR);
  grassGeos.push(grassGeo);

  // --- Diagonal cross paths ---
  const pathW = Math.max(1.2, Math.min(2.0, width * 0.06));
  const pathH = 0.1;

  // Horizontal center path
  const hPath = new THREE.BoxGeometry(width - 2, pathH, pathW);
  _mat4.makeTranslation(cx, pathH / 2, cz);
  hPath.applyMatrix4(_mat4);
  applyVertexColor(hPath, PATH_COLOR);
  pathGeos.push(hPath);

  // Vertical center path
  const vPath = new THREE.BoxGeometry(pathW, pathH, depth - 2);
  _mat4.makeTranslation(cx, pathH / 2, cz);
  vPath.applyMatrix4(_mat4);
  applyVertexColor(vPath, PATH_COLOR);
  pathGeos.push(vPath);

  // Diagonal paths (corner to corner)
  const diagLen = Math.sqrt(width * width + depth * depth) * 0.45;
  const diagAngle = Math.atan2(width, depth);
  for (const angle of [diagAngle, -diagAngle]) {
    const diagGeo = new THREE.BoxGeometry(pathW * 0.8, pathH, diagLen);
    _mat4.makeRotationY(angle);
    _mat4.setPosition(cx, pathH / 2, cz);
    diagGeo.applyMatrix4(_mat4);
    applyVertexColor(diagGeo, PATH_COLOR);
    pathGeos.push(diagGeo);
  }

  // --- Trees ---
  // Place trees in a grid pattern with jitter, avoiding center paths
  const treeSpacingX = Math.max(5, width / 4);
  const treeSpacingZ = Math.max(5, depth / 4);
  const margin = 2.5;

  for (let tx = x + margin; tx < x + width - margin; tx += treeSpacingX) {
    for (let tz = z + margin; tz < z + depth - margin; tz += treeSpacingZ) {
      // Jitter position
      const jx = tx + randRange(rng, -treeSpacingX * 0.25, treeSpacingX * 0.25);
      const jz = tz + randRange(rng, -treeSpacingZ * 0.25, treeSpacingZ * 0.25);

      // Skip if too close to a path center
      const dxFromCenter = Math.abs(jx - cx);
      const dzFromCenter = Math.abs(jz - cz);
      if (dxFromCenter < pathW + 0.8 || dzFromCenter < pathW + 0.8) continue;

      // Randomize tree size
      const trunkH = randRange(rng, 2.0, 3.5);
      const trunkR = randRange(rng, 0.18, 0.28);
      const leafR = randRange(rng, 1.2, 2.2);
      const leafH = randRange(rng, 1.8, 3.0);
      const leafColor = LEAF_COLORS[randInt(rng, 0, 2)];

      // Trunk (cylinder)
      const trunkGeo = new THREE.CylinderGeometry(trunkR, trunkR * 1.3, trunkH, 6);
      _mat4.makeTranslation(jx, trunkH / 2, jz);
      trunkGeo.applyMatrix4(_mat4);
      applyVertexColor(trunkGeo, TRUNK_COLOR);
      trunkGeos.push(trunkGeo);

      // Leaves (cone)
      const leavesGeo = new THREE.ConeGeometry(leafR, leafH, 7);
      _mat4.makeTranslation(jx, trunkH + leafH / 2 - 0.3, jz);
      leavesGeo.applyMatrix4(_mat4);
      applyVertexColor(leavesGeo, leafColor);
      leafGeos.push(leavesGeo);

      // Second smaller cone on top for fuller look
      const topGeo = new THREE.ConeGeometry(leafR * 0.65, leafH * 0.7, 7);
      _mat4.makeTranslation(jx, trunkH + leafH * 0.65, jz);
      topGeo.applyMatrix4(_mat4);
      applyVertexColor(topGeo, leafColor);
      leafGeos.push(topGeo);

      // Collider for trunk
      treeColliders.push(new THREE.Box3(
        new THREE.Vector3(jx - trunkR * 2, 0, jz - trunkR * 2),
        new THREE.Vector3(jx + trunkR * 2, trunkH, jz + trunkR * 2),
      ));
    }
  }

  // --- Benches along the paths ---
  // Place 4 benches near path intersections, facing inward
  const benchPositions: Array<{ bx: number; bz: number; angle: number }> = [
    { bx: cx + pathW + 1.2, bz: cz, angle: 0 },
    { bx: cx - pathW - 1.2, bz: cz, angle: Math.PI },
    { bx: cx, bz: cz + pathW + 1.2, angle: Math.PI / 2 },
    { bx: cx, bz: cz - pathW - 1.2, angle: -Math.PI / 2 },
  ];

  for (const bp of benchPositions) {
    if (
      bp.bx < x + 1.5 || bp.bx > x + width - 1.5 ||
      bp.bz < z + 1.5 || bp.bz > z + depth - 1.5
    ) continue;
    pushBench(benchGeos, bp.bx, bp.bz, bp.angle);
  }

  return { grassGeos, pathGeos, trunkGeos, leafGeos, benchGeos, treeColliders };
}

function pushBench(
  benchGeos: THREE.BufferGeometry[],
  bx: number,
  bz: number,
  angle: number,
): void {
  const seatW = 1.6;
  const seatD = 0.4;
  const seatH = 0.04;
  const seatY = 0.48;
  const backH = 0.5;
  const legH = 0.46;
  const legW = 0.08;

  // Seat
  const seat = new THREE.BoxGeometry(seatW, seatH, seatD);
  const rm = new THREE.Matrix4().makeRotationY(angle);
  rm.setPosition(bx, seatY, bz);
  seat.applyMatrix4(rm);
  applyVertexColor(seat, BENCH_SEAT_COLOR);
  benchGeos.push(seat);

  // Backrest
  const back = new THREE.BoxGeometry(seatW, backH, seatH);
  const back_rm = new THREE.Matrix4().makeRotationY(angle);
  const backOffset = new THREE.Vector3(0, seatY + backH / 2 + 0.02, -seatD / 2);
  backOffset.applyMatrix4(new THREE.Matrix4().makeRotationY(angle));
  back_rm.setPosition(bx + backOffset.x, backOffset.y, bz + backOffset.z);
  back.applyMatrix4(back_rm);
  applyVertexColor(back, BENCH_SEAT_COLOR);
  benchGeos.push(back);

  // Legs (2 pairs)
  for (const side of [-0.55, 0.55]) {
    const legOffset = new THREE.Vector3(side, legH / 2, 0);
    legOffset.applyMatrix4(new THREE.Matrix4().makeRotationY(angle));
    const leg = new THREE.BoxGeometry(legW, legH, legW);
    _mat4.makeTranslation(bx + legOffset.x, legOffset.y, bz + legOffset.z);
    leg.applyMatrix4(_mat4);
    applyVertexColor(leg, BENCH_LEG_COLOR);
    benchGeos.push(leg);
  }
}

// Shared materials for park elements
let _parkMats: ReturnType<typeof createParkMaterials> | null = null;

function createParkMaterials() {
  return {
    grass: new THREE.MeshStandardMaterial({ color: GRASS_COLOR, roughness: 0.9, vertexColors: true }),
    path: new THREE.MeshStandardMaterial({ color: PATH_COLOR, roughness: 0.85, vertexColors: true }),
    trunk: new THREE.MeshStandardMaterial({ color: TRUNK_COLOR, roughness: 0.95, vertexColors: true }),
    leaves: new THREE.MeshStandardMaterial({ color: LEAF_COLOR_A, roughness: 0.8, vertexColors: true }),
    bench: new THREE.MeshStandardMaterial({ color: BENCH_SEAT_COLOR, roughness: 0.7, vertexColors: true }),
  };
}

export function getParkMaterials() {
  if (!_parkMats) _parkMats = createParkMaterials();
  return _parkMats;
}

export function mergeParkGeos(
  scene: THREE.Scene,
  geosList: THREE.BufferGeometry[],
  material: THREE.Material,
  castShadow: boolean,
): void {
  if (geosList.length === 0) return;
  const normalized = geosList.map(g => g.index ? g.toNonIndexed() : g);
  const merged = mergeGeometries(normalized, false);
  if (!merged) return;
  const mesh = new THREE.Mesh(merged, material);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  scene.add(mesh);
  for (let i = 0; i < geosList.length; i++) {
    if (normalized[i] !== geosList[i]) normalized[i].dispose();
    geosList[i].dispose();
  }
}
