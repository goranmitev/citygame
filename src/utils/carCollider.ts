import * as THREE from 'three';
import { CAR_HEIGHT } from '../constants';

interface Vec2 { x: number; z: number; }

function getCarCorners(
  position: THREE.Vector3,
  heading: number,
  halfW: number,
  halfL: number,
): Vec2[] {
  const sinH = Math.sin(heading);
  const cosH = Math.cos(heading);
  return [
    [ halfW,  halfL],
    [-halfW,  halfL],
    [ halfW, -halfL],
    [-halfW, -halfL],
  ].map(([lx, lz]) => ({
    x: position.x + lx * cosH - lz * sinH,
    z: position.z + lx * sinH + lz * cosH,
  }));
}

function projectPointsOnAxis(points: Vec2[], axis: Vec2): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    const value = p.x * axis.x + p.z * axis.z;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return { min, max };
}

function projectAABBOnAxis(box: THREE.Box3, axis: Vec2): { min: number; max: number } {
  const corners: Vec2[] = [
    { x: box.min.x, z: box.min.z },
    { x: box.min.x, z: box.max.z },
    { x: box.max.x, z: box.min.z },
    { x: box.max.x, z: box.max.z },
  ];
  return projectPointsOnAxis(corners, axis);
}

export function getCarAABB(
  position: THREE.Vector3,
  heading: number,
  halfW: number,
  halfL: number,
  height = CAR_HEIGHT,
): THREE.Box3 {
  const corners = getCarCorners(position, heading, halfW, halfL);
  const xs = corners.map((c) => c.x);
  const zs = corners.map((c) => c.z);
  return new THREE.Box3(
    new THREE.Vector3(Math.min(...xs), 0, Math.min(...zs)),
    new THREE.Vector3(Math.max(...xs), height, Math.max(...zs)),
  );
}

export function getCarRotationExtents(
  halfW: number,
  halfL: number,
  heading: number,
): { hwX: number; hwZ: number } {
  const sinH = Math.abs(Math.sin(heading));
  const cosH = Math.abs(Math.cos(heading));
  return {
    hwX: cosH * halfW + sinH * halfL,
    hwZ: sinH * halfW + cosH * halfL,
  };
}

function overlapsInterval(a: { min: number; max: number }, b: { min: number; max: number }): boolean {
  return a.max >= b.min && b.max >= a.min;
}

export function obbIntersectsAabbXZ(
  position: THREE.Vector3,
  heading: number,
  halfW: number,
  halfL: number,
  box: THREE.Box3,
  height = CAR_HEIGHT,
): boolean {
  if (box.max.y < 0 || box.min.y > height) return false;

  const corners = getCarCorners(position, heading, halfW, halfL);
  const sinH = Math.sin(heading);
  const cosH = Math.cos(heading);
  const axes = [
    { x: 1, z: 0 },
    { x: 0, z: 1 },
    { x: cosH, z: sinH },
    { x: -sinH, z: cosH },
  ];

  for (const axis of axes) {
    const projCar = projectPointsOnAxis(corners, axis);
    const projBox = projectAABBOnAxis(box, axis);
    if (!overlapsInterval(projCar, projBox)) return false;
  }

  return true;
}

export function obbIntersectsObbXZ(
  posA: THREE.Vector3,
  headingA: number,
  halfWA: number,
  halfLA: number,
  posB: THREE.Vector3,
  headingB: number,
  halfWB: number,
  halfLB: number,
): boolean {
  const cornersA = getCarCorners(posA, headingA, halfWA, halfLA);
  const cornersB = getCarCorners(posB, headingB, halfWB, halfLB);
  const axes = [
    { x: Math.cos(headingA), z: Math.sin(headingA) },
    { x: -Math.sin(headingA), z: Math.cos(headingA) },
    { x: Math.cos(headingB), z: Math.sin(headingB) },
    { x: -Math.sin(headingB), z: Math.cos(headingB) },
  ];

  for (const axis of axes) {
    const projA = projectPointsOnAxis(cornersA, axis);
    const projB = projectPointsOnAxis(cornersB, axis);
    if (!overlapsInterval(projA, projB)) return false;
  }

  return true;
}

export function createCarDebugHelper(color = 0xff0000): THREE.LineSegments {
  const positions = new Float32Array([
    -1, 0, -1,  1, 0, -1,
     1, 0, -1,  1, 0,  1,
     1, 0,  1, -1, 0,  1,
    -1, 0,  1, -1, 0, -1,
    -1, 1, -1,  1, 1, -1,
     1, 1, -1,  1, 1,  1,
     1, 1,  1, -1, 1,  1,
    -1, 1,  1, -1, 1, -1,
    -1, 0, -1, -1, 1, -1,
     1, 0, -1,  1, 1, -1,
     1, 0,  1,  1, 1,  1,
    -1, 0,  1, -1, 1,  1,
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.LineBasicMaterial({ color, toneMapped: false });
  const helper = new THREE.LineSegments(geometry, material);
  helper.frustumCulled = false;
  return helper;
}
