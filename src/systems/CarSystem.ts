import * as THREE from 'three';
import { Game, GameSystem } from '../core/Game';
import { InputSystem } from './InputSystem';
import { SceneSystem } from './SceneSystem';

// --- Tuning constants ---
const CAR_HALF_W = 1.0;   // half-width for collision
const CAR_HALF_L = 2.2;   // half-length for collision
const CAR_HEIGHT = 0.8;   // collision box height

const MAX_SPEED_FWD = 22;  // m/s (~80 km/h)
const MAX_SPEED_REV = 6;
const ACCEL = 14;          // m/s² while throttle pressed
const BRAKE_FORCE = 20;    // m/s² while braking
const DRAG = 10;           // passive deceleration when no input
const STEER_SPEED = 3.2;   // rad/s max turn rate at low speed
const SPEED_STEER_FACTOR = 0.03; // reduces steering at high speed

// Camera spring-arm (used when player is driving)
const CAM_DIST = 9;
const CAM_HEIGHT = 3.5;
const CAM_LERP = 8;

// Mouse look
const MOUSE_SENSITIVITY = 0.003;
const PITCH_MIN = -0.3;
const PITCH_MAX = 0.6;

export class CarSystem implements GameSystem {
  readonly name = 'car';

  // World position (feet of car, Y=0)
  readonly position = new THREE.Vector3(0, 0, 0);

  // Public so WalkSystem can read heading for minimap / entry logic
  heading = 0;

  // Whether a player is sitting in the car
  isOccupied = false;

  private input!: InputSystem;
  private sceneSystem!: SceneSystem;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;

  private carGroup!: THREE.Group;

  // Physics state
  private speed = 0;
  private steer = 0;

  // Camera state (active only while occupied)
  private camPos = new THREE.Vector3();
  private camTarget = new THREE.Vector3();
  private camYaw = 0;
  private camPitch = 0;

  // Colliders registered by the city
  private colliders: THREE.Box3[] = [];

  init(game: Game): void {
    this.camera = game.camera;
    this.input = game.getSystem<InputSystem>('input')!;
    this.sceneSystem = game.getSystem<SceneSystem>('scene')!;
    this.scene = game.scene;
    this.buildCarMesh();
  }

  /** Speed in km/h (always positive). */
  getSpeedKmh(): number {
    return Math.abs(this.speed) * 3.6;
  }

  /** World-space position just outside the driver's door (left side). */
  entryPoint(): THREE.Vector3 {
    const sinH = Math.sin(this.heading);
    const cosH = Math.cos(this.heading);
    // Left side of car in car-local space: (-1.8, 0, 0) rotated by heading
    return new THREE.Vector3(
      this.position.x - cosH * 1.8,
      0,
      this.position.z + sinH * 1.8,
    );
  }

  /**
   * Returns a world-space AABB that tightly wraps the car's rotated footprint.
   * Recomputed each call — call once per frame from WalkSystem.
   */
  getWorldBox(): THREE.Box3 {
    const sinH = Math.sin(this.heading);
    const cosH = Math.cos(this.heading);
    // Four corners of the car footprint in world space
    const corners = [
      [ CAR_HALF_W,  CAR_HALF_L],
      [-CAR_HALF_W,  CAR_HALF_L],
      [ CAR_HALF_W, -CAR_HALF_L],
      [-CAR_HALF_W, -CAR_HALF_L],
    ].map(([lx, lz]) => ({
      x: this.position.x + lx * cosH - lz * sinH,
      z: this.position.z + lx * sinH + lz * cosH,
    }));

    const xs = corners.map((c) => c.x);
    const zs = corners.map((c) => c.z);
    return new THREE.Box3(
      new THREE.Vector3(Math.min(...xs), 0,           Math.min(...zs)),
      new THREE.Vector3(Math.max(...xs), CAR_HEIGHT,  Math.max(...zs)),
    );
  }

  /** Bring the car to an immediate stop (called on exit). */
  stop(): void {
    this.speed = 0;
    this.steer = 0;
  }

  /** Snap camera to spawn position (called after city sets position). */
  snapToSpawn(): void {
    this.snapCamera();
    this.updateCarMesh();
  }

  /** Register collision AABBs (called by city generator). */
  addColliders(boxes: THREE.Box3[]): void {
    this.colliders.push(...boxes);
  }

  clearColliders(): void {
    this.colliders.length = 0;
  }

  update(delta: number): void {
    if (this.isOccupied) {
      this.updatePhysics(delta);
      this.updateCamera(delta);
      this.sceneSystem.updateShadowTarget(this.position.x, this.position.z);
      // Do NOT call input.resetDeltas() here — WalkSystem runs after us and
      // needs interactPressed to detect the E key for exiting the car.
    }
    // Always keep mesh in sync (visible even when unoccupied)
    this.updateCarMesh();
  }

  // ---------------------------------------------------------------------------

  private updatePhysics(delta: number): void {
    const { state } = this.input;
    const throttle = state.forward ? 1 : 0;
    const brake = state.backward ? 1 : 0;
    const steerInput = state.left ? -1 : state.right ? 1 : 0;

    if (throttle > 0) {
      this.speed += ACCEL * delta;
    } else if (brake > 0) {
      if (this.speed > 0.1) {
        this.speed -= BRAKE_FORCE * delta;
      } else {
        this.speed -= ACCEL * delta;
      }
    } else {
      if (this.speed > 0) {
        this.speed = Math.max(0, this.speed - DRAG * delta);
      } else if (this.speed < 0) {
        this.speed = Math.min(0, this.speed + DRAG * delta);
      }
    }

    this.speed = Math.max(-MAX_SPEED_REV, Math.min(MAX_SPEED_FWD, this.speed));

    const targetSteer = steerInput;
    this.steer += (targetSteer - this.steer) * Math.min(1, 8 * delta);

    const speedFactor = Math.abs(this.speed) / (MAX_SPEED_FWD * 0.5);
    const steerRate = STEER_SPEED / (1 + speedFactor * SPEED_STEER_FACTOR * 60);
    const turnDelta = this.steer * steerRate * delta * Math.sign(this.speed || 1);
    this.heading -= turnDelta;

    const sinH = Math.sin(this.heading);
    const cosH = Math.cos(this.heading);
    const dx = sinH * this.speed * delta;
    const dz = cosH * this.speed * delta;

    this.tryMove(dx, 0);
    this.tryMove(0, dz);
  }

  private tryMove(dx: number, dz: number): void {
    const nx = this.position.x + dx;
    const nz = this.position.z + dz;

    const carMin = new THREE.Vector3(nx - CAR_HALF_W, 0, nz - CAR_HALF_L);
    const carMax = new THREE.Vector3(nx + CAR_HALF_W, CAR_HEIGHT, nz + CAR_HALF_L);
    const carBox = new THREE.Box3(carMin, carMax);

    for (const box of this.colliders) {
      if (carBox.intersectsBox(box)) {
        this.speed *= -0.2;
        return;
      }
    }

    this.position.x = nx;
    this.position.z = nz;
  }

  private updateCarMesh(): void {
    this.carGroup.position.set(this.position.x, this.position.y, this.position.z);
    this.carGroup.rotation.y = this.heading;
  }

  private updateCamera(delta: number): void {
    const { mouseDX, mouseDY } = this.input.state;

    this.camYaw -= mouseDX * MOUSE_SENSITIVITY;
    this.camPitch += mouseDY * MOUSE_SENSITIVITY;
    this.camPitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, this.camPitch));

    const angle = this.heading + this.camYaw;
    const sinA = Math.sin(angle);
    const cosA = Math.cos(angle);

    const pitchCos = Math.cos(this.camPitch);
    const pitchSin = Math.sin(this.camPitch);
    const dist = CAM_DIST * pitchCos;
    const height = CAM_HEIGHT + CAM_DIST * pitchSin;

    const idealPos = new THREE.Vector3(
      this.position.x - sinA * dist,
      this.position.y + height,
      this.position.z - cosA * dist,
    );

    const lookAt = new THREE.Vector3(
      this.position.x + sinA * 2,
      this.position.y + 1.2,
      this.position.z + cosA * 2,
    );

    const t = Math.min(1, CAM_LERP * delta);
    this.camPos.lerp(idealPos, t);
    this.camTarget.lerp(lookAt, t);

    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);
  }

  /** Snap camera immediately (no lerp) to current position. */
  snapCamera(): void {
    this.camYaw = 0;
    this.camPitch = 0;
    const sinH = Math.sin(this.heading);
    const cosH = Math.cos(this.heading);
    this.camPos.set(
      this.position.x - sinH * CAM_DIST,
      this.position.y + CAM_HEIGHT,
      this.position.z - cosH * CAM_DIST,
    );
    this.camTarget.set(this.position.x, this.position.y + 1.2, this.position.z);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);
  }

  // ---------------------------------------------------------------------------
  // Car mesh construction
  // ---------------------------------------------------------------------------

  private buildCarMesh(): void {
    this.carGroup = new THREE.Group();

    // Body
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xcc2222, roughness: 0.4, metalness: 0.5 });
    const bodyGeo = new THREE.BoxGeometry(1.8, 0.55, 4.0);
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.set(0, 0.45, 0);
    body.castShadow = true;
    this.carGroup.add(body);

    // Cabin
    const cabinMat = new THREE.MeshStandardMaterial({ color: 0x991818, roughness: 0.5, metalness: 0.3 });
    const cabinGeo = new THREE.BoxGeometry(1.5, 0.55, 2.2);
    const cabin = new THREE.Mesh(cabinGeo, cabinMat);
    cabin.position.set(0, 0.95, -0.1);
    cabin.castShadow = true;
    this.carGroup.add(cabin);

    // Windows
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x88aacc, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.7 });

    const windshieldGeo = new THREE.BoxGeometry(1.3, 0.45, 0.05);
    const windshield = new THREE.Mesh(windshieldGeo, glassMat);
    windshield.position.set(0, 1.0, 0.97);
    windshield.rotation.x = 0.25;
    this.carGroup.add(windshield);

    const rearGeo = new THREE.BoxGeometry(1.3, 0.4, 0.05);
    const rear = new THREE.Mesh(rearGeo, glassMat);
    rear.position.set(0, 1.0, -1.2);
    rear.rotation.x = -0.2;
    this.carGroup.add(rear);

    // Wheels
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.3, metalness: 0.8 });

    const wheelPositions = [
      { x: -1.0, z: 1.3 },
      { x:  1.0, z: 1.3 },
      { x: -1.0, z: -1.3 },
      { x:  1.0, z: -1.3 },
    ];

    for (const wp of wheelPositions) {
      const wGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.25, 16);
      const wheel = new THREE.Mesh(wGeo, wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(wp.x, 0.35, wp.z);
      wheel.castShadow = true;
      this.carGroup.add(wheel);

      const rGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.26, 8);
      const rim = new THREE.Mesh(rGeo, rimMat);
      rim.rotation.z = Math.PI / 2;
      rim.position.set(wp.x, 0.35, wp.z);
      this.carGroup.add(rim);
    }

    // Headlights
    const lightMat = new THREE.MeshStandardMaterial({ color: 0xffffcc, emissive: 0xffffcc, emissiveIntensity: 1.5 });
    for (const sx of [-0.6, 0.6]) {
      const hGeo = new THREE.BoxGeometry(0.3, 0.15, 0.05);
      const h = new THREE.Mesh(hGeo, lightMat);
      h.position.set(sx, 0.5, 2.02);
      this.carGroup.add(h);
    }

    // Taillights
    const tailMat = new THREE.MeshStandardMaterial({ color: 0xff1111, emissive: 0xff1111, emissiveIntensity: 1.0 });
    for (const sx of [-0.6, 0.6]) {
      const tGeo = new THREE.BoxGeometry(0.3, 0.15, 0.05);
      const t = new THREE.Mesh(tGeo, tailMat);
      t.position.set(sx, 0.5, -2.02);
      this.carGroup.add(t);
    }

    this.scene.add(this.carGroup);
  }
}
