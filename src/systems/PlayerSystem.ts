import * as THREE from 'three';
import { Game, GameSystem } from '../core/Game';
import { InputSystem } from './InputSystem';
import { SceneSystem } from './SceneSystem';

const PLAYER_HEIGHT = 1.7;
const PLAYER_RADIUS = 0.3;
const WALK_SPEED = 5;
const SPRINT_SPEED = 9;
const MOUSE_SENSITIVITY = 0.002;

/**
 * First-person player controller with AABB collision against city geometry.
 */
export class PlayerSystem implements GameSystem {
  readonly name = 'player';

  private camera!: THREE.PerspectiveCamera;
  private input!: InputSystem;
  private sceneSystem!: SceneSystem;

  /** Euler yaw (Y-axis rotation) */
  private yaw = 0;
  /** Euler pitch (X-axis rotation), clamped */
  private pitch = 0;

  /** Player world position (feet) */
  readonly position = new THREE.Vector3(0, 0, 0);

  /** AABB collision boxes registered by the city generator */
  private colliders: THREE.Box3[] = [];

  init(game: Game): void {
    this.camera = game.camera;
    this.input = game.getSystem<InputSystem>('input')!;
    this.sceneSystem = game.getSystem<SceneSystem>('scene')!;

    // Start position — will be set by city generator
    this.position.set(0, 0, 0);
    this.camera.position.copy(this.position).y += PLAYER_HEIGHT;
  }

  /** Register collision AABBs (called by city generator). */
  addColliders(boxes: THREE.Box3[]): void {
    this.colliders.push(...boxes);
  }

  clearColliders(): void {
    this.colliders.length = 0;
  }

  update(delta: number): void {
    const { state } = this.input;
    if (!state.pointerLocked) return;

    // --- Look ---
    this.yaw -= state.mouseDX * MOUSE_SENSITIVITY;
    this.pitch -= state.mouseDY * MOUSE_SENSITIVITY;
    this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch));

    this.camera.quaternion.setFromEuler(
      new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'),
    );

    // --- Movement ---
    const speed = state.sprint ? SPRINT_SPEED : WALK_SPEED;
    const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(
      new THREE.Vector3(0, 1, 0),
      this.yaw,
    );
    const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(
      new THREE.Vector3(0, 1, 0),
      this.yaw,
    );

    const move = new THREE.Vector3();
    if (state.forward) move.add(forward);
    if (state.backward) move.sub(forward);
    if (state.right) move.add(right);
    if (state.left) move.sub(right);

    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(speed * delta);

      // Slide collision: try X, then Z independently
      this.tryMove(move.x, 0);
      this.tryMove(0, move.z);
    }

    // Update camera
    this.camera.position.set(
      this.position.x,
      this.position.y + PLAYER_HEIGHT,
      this.position.z,
    );

    // Move shadow camera with player
    this.sceneSystem.updateShadowTarget(this.position.x, this.position.z);

    // Reset mouse deltas
    this.input.resetDeltas();
  }

  private tryMove(dx: number, dz: number): void {
    const newX = this.position.x + dx;
    const newZ = this.position.z + dz;

    // Build player AABB at new position
    const playerMin = new THREE.Vector3(
      newX - PLAYER_RADIUS,
      this.position.y,
      newZ - PLAYER_RADIUS,
    );
    const playerMax = new THREE.Vector3(
      newX + PLAYER_RADIUS,
      this.position.y + PLAYER_HEIGHT,
      newZ + PLAYER_RADIUS,
    );
    const playerBox = new THREE.Box3(playerMin, playerMax);

    for (const box of this.colliders) {
      if (playerBox.intersectsBox(box)) {
        return; // blocked
      }
    }

    this.position.x = newX;
    this.position.z = newZ;
  }
}
