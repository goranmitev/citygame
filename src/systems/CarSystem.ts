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
const DRAG = 3.5;          // passive deceleration when no input
const STEER_SPEED = 2.0;   // rad/s max turn rate at low speed
const SPEED_STEER_FACTOR = 0.06; // reduces steering at high speed

// Camera spring-arm
const CAM_DIST = 9;
const CAM_HEIGHT = 3.5;
const CAM_LERP = 8;        // higher = snappier follow

// Mouse look
const MOUSE_SENSITIVITY = 0.003;   // rad per pixel
const PITCH_MIN = -0.3;            // rad — max look-up angle
const PITCH_MAX = 0.6;             // rad — max look-down angle
const CAM_RESET_SPEED = 2.0;       // rad/s — auto-return to behind car

export class CarSystem implements GameSystem {
  readonly name = 'player'; // keep 'player' so CityBuilder can find it via getSystem('player')

  // Exposed so CityBuilder can set spawn position
  readonly position = new THREE.Vector3(0, 0, 0);

  /** Call after setting position to snap camera to the new spawn. */
  snapToSpawn(): void {
    this.snapCamera();
    this.updateCarMesh();
  }

  private camera!: THREE.PerspectiveCamera;
  private input!: InputSystem;
  private sceneSystem!: SceneSystem;
  private scene!: THREE.Scene;

  private carGroup!: THREE.Group;  // visual mesh group

  // Physics state
  private speed = 0;        // current speed along car's forward axis (signed)
  private heading = 0;      // world Y rotation in radians
  private steer = 0;        // current steering angle (rad), lerped to target

  // Camera state — smoothed with lerp
  private camPos = new THREE.Vector3();
  private camTarget = new THREE.Vector3();

  // Mouse-look offsets relative to car heading
  private camYaw = 0;    // horizontal orbit offset (rad)
  private camPitch = 0;  // vertical pitch offset (rad)

  // Colliders registered by the city
  private colliders: THREE.Box3[] = [];

  // Scratch objects (avoid per-frame allocation)
  private readonly _forward = new THREE.Vector3();
  private readonly _right = new THREE.Vector3();
  private readonly _up = new THREE.Vector3(0, 1, 0);

  init(game: Game): void {
    this.camera = game.camera;
    this.input = game.getSystem<InputSystem>('input')!;
    this.sceneSystem = game.getSystem<SceneSystem>('scene')!;
    this.scene = game.scene;

    this.buildCarMesh();

    // Snap camera to initial position behind car
    this.snapCamera();
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

    this.updatePhysics(delta, state);
    this.updateCarMesh();
    this.updateCamera(delta);
    this.sceneSystem.updateShadowTarget(this.position.x, this.position.z);
    this.input.resetDeltas();
  }

  // ---------------------------------------------------------------------------

  private updatePhysics(delta: number, state: { forward: boolean; backward: boolean; left: boolean; right: boolean }): void {
    const throttle = state.forward ? 1 : 0;
    const brake = state.backward ? 1 : 0;
    const steerInput = state.left ? -1 : state.right ? 1 : 0;

    // --- Longitudinal speed ---
    if (throttle > 0) {
      this.speed += ACCEL * delta;
    } else if (brake > 0) {
      if (this.speed > 0.1) {
        this.speed -= BRAKE_FORCE * delta;
      } else {
        // reverse
        this.speed -= ACCEL * delta;
      }
    } else {
      // passive drag
      if (this.speed > 0) {
        this.speed = Math.max(0, this.speed - DRAG * delta);
      } else if (this.speed < 0) {
        this.speed = Math.min(0, this.speed + DRAG * delta);
      }
    }

    this.speed = Math.max(-MAX_SPEED_REV, Math.min(MAX_SPEED_FWD, this.speed));

    // --- Steering (only effective when moving) ---
    const targetSteer = steerInput;
    this.steer += (targetSteer - this.steer) * Math.min(1, 8 * delta);

    const speedFactor = Math.abs(this.speed) / (MAX_SPEED_FWD * 0.5);
    const steerRate = STEER_SPEED / (1 + speedFactor * SPEED_STEER_FACTOR * 60);
    const turnDelta = this.steer * steerRate * delta * Math.sign(this.speed || 1);

    this.heading -= turnDelta;

    // --- Movement vector ---
    const sinH = Math.sin(this.heading);
    const cosH = Math.cos(this.heading);
    const dx = sinH * this.speed * delta;
    const dz = cosH * this.speed * delta;

    // Try X then Z independently (sliding collision)
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
        // Bounce: kill speed on collision
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

    // Apply mouse look
    this.camYaw -= mouseDX * MOUSE_SENSITIVITY;
    this.camPitch += mouseDY * MOUSE_SENSITIVITY;
    this.camPitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, this.camPitch));

    // Slowly return yaw to zero when car is moving
    if (Math.abs(this.speed) > 1) {
      this.camYaw *= Math.max(0, 1 - CAM_RESET_SPEED * delta);
    }

    // Camera angle = car heading + yaw offset
    const angle = this.heading + this.camYaw;
    const sinA = Math.sin(angle);
    const cosA = Math.cos(angle);

    // Pitch: elevate/depress camera arm
    const pitchCos = Math.cos(this.camPitch);
    const pitchSin = Math.sin(this.camPitch);
    const dist = CAM_DIST * pitchCos;
    const height = CAM_HEIGHT + CAM_DIST * pitchSin;

    const idealPos = new THREE.Vector3(
      this.position.x - sinA * dist,
      this.position.y + height,
      this.position.z - cosA * dist,
    );

    // Look-at point stays on the car (slightly ahead and up)
    const sinH = Math.sin(this.heading);
    const cosH = Math.cos(this.heading);
    const lookAt = new THREE.Vector3(
      this.position.x + sinH * 2,
      this.position.y + 1.2,
      this.position.z + cosH * 2,
    );

    const t = Math.min(1, CAM_LERP * delta);
    this.camPos.lerp(idealPos, t);
    this.camTarget.lerp(lookAt, t);

    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);
  }

  private snapCamera(): void {
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

    // --- Body ---
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xcc2222, roughness: 0.4, metalness: 0.5 });
    const bodyGeo = new THREE.BoxGeometry(1.8, 0.55, 4.0);
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.set(0, 0.45, 0);
    body.castShadow = true;
    this.carGroup.add(body);

    // --- Cabin ---
    const cabinMat = new THREE.MeshStandardMaterial({ color: 0x991818, roughness: 0.5, metalness: 0.3 });
    const cabinGeo = new THREE.BoxGeometry(1.5, 0.55, 2.2);
    const cabin = new THREE.Mesh(cabinGeo, cabinMat);
    cabin.position.set(0, 0.95, -0.1);
    cabin.castShadow = true;
    this.carGroup.add(cabin);

    // --- Windows ---
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x88aacc, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.7 });

    // Front windshield
    const windshieldGeo = new THREE.BoxGeometry(1.3, 0.45, 0.05);
    const windshield = new THREE.Mesh(windshieldGeo, glassMat);
    windshield.position.set(0, 1.0, 0.97);
    windshield.rotation.x = 0.25;
    this.carGroup.add(windshield);

    // Rear window
    const rearGeo = new THREE.BoxGeometry(1.3, 0.4, 0.05);
    const rear = new THREE.Mesh(rearGeo, glassMat);
    rear.position.set(0, 1.0, -1.2);
    rear.rotation.x = -0.2;
    this.carGroup.add(rear);

    // --- Wheels ---
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.3, metalness: 0.8 });

    const wheelPositions = [
      { x: -1.0, z: 1.3 },   // front left
      { x:  1.0, z: 1.3 },   // front right
      { x: -1.0, z: -1.3 },  // rear left
      { x:  1.0, z: -1.3 },  // rear right
    ];

    for (const wp of wheelPositions) {
      const wGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.25, 16);
      const wheel = new THREE.Mesh(wGeo, wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(wp.x, 0.35, wp.z);
      wheel.castShadow = true;
      this.carGroup.add(wheel);

      // Rim
      const rGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.26, 8);
      const rim = new THREE.Mesh(rGeo, rimMat);
      rim.rotation.z = Math.PI / 2;
      rim.position.set(wp.x, 0.35, wp.z);
      this.carGroup.add(rim);
    }

    // --- Headlights ---
    const lightMat = new THREE.MeshStandardMaterial({ color: 0xffffcc, emissive: 0xffffcc, emissiveIntensity: 1.5 });
    for (const sx of [-0.6, 0.6]) {
      const hGeo = new THREE.BoxGeometry(0.3, 0.15, 0.05);
      const h = new THREE.Mesh(hGeo, lightMat);
      h.position.set(sx, 0.5, 2.02);
      this.carGroup.add(h);
    }

    // --- Taillights ---
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
