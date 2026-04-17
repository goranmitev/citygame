import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { Game, GameSystem } from '../core/Game';
import { EventBus, Events } from '../core/EventBus';
import { InputSystem } from './InputSystem';
import { SceneSystem } from './SceneSystem';
import {
  CAR_HALF_W, CAR_HALF_L, CAR_HEIGHT,
  CAR_MAX_SPEED_FWD, CAR_MAX_SPEED_REV,
  CAR_ACCEL, CAR_BRAKE_FORCE, CAR_DRAG,
  CAR_STEER_SPEED, CAR_SPEED_STEER_FACTOR,
  CAR_MIN_TURN_SPEED, CAR_FULL_TURN_SPEED,
  CAR_CAM_DIST, CAR_CAM_HEIGHT, CAR_CAM_LERP,
  CAR_MOUSE_SENSITIVITY, CAR_PITCH_MIN, CAR_PITCH_MAX,
  CAR_MODEL_SCALE, CAR_GROUND_CLEARANCE,
  CAR_BODY_ROUGHNESS, CAR_BODY_METALNESS, CAR_ENV_INTENSITY,
} from '../constants';
import type { StreetSegment } from '../city/CityLayout';

const SIDEWALK_HEIGHT = 0.15;
const SIDEWALK_Y_LERP = 10;

const _camHit = new THREE.Vector3();

export class CarSystem implements GameSystem {
  readonly name = 'car';

  // World position (feet of car, Y=0)
  readonly position = new THREE.Vector3(0, 0, 0);

  // Public so minimap can read heading
  heading = 0;

  // Whether a player is sitting in the car
  isOccupied = false;

  private input!: InputSystem;
  private sceneSystem!: SceneSystem;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;

  private carGroup!: THREE.Group;
  private wheelPivots: THREE.Group[] = [];
  private _wheelAngle = 0;
  private gltfLoader!: GLTFLoader;
  private modelLoaded = false;
  private suspensionOffset = 0;
  private carYOffset = 0; // computed from bounding box to prevent floating/sinking

  // Collision half-extents — set from actual GLB bounding box after load
  private halfW = CAR_HALF_W;
  private halfL = CAR_HALF_L;

  // Physics state
  private speed = 0;
  private steer = 0;

  // Camera state (active only while occupied)
  private camPos = new THREE.Vector3();
  private camTarget = new THREE.Vector3();
  private camYaw = 0;
  private camPitch = 0;

  // Reusable objects — allocated once, mutated each frame
  private _tryBox = new THREE.Box3();
  private _idealPos = new THREE.Vector3();
  private _lookAt = new THREE.Vector3();
  private _camRay = new THREE.Ray();
  private _camRayDir = new THREE.Vector3();

  // Colliders registered by the city
  private colliders: THREE.Box3[] = [];

  // Initial spawn state for reset
  private spawnPosition = new THREE.Vector3();
  private spawnHeading = 0;

  // Sidewalk segments — used for Y adjustment when driving over curbs
  private sidewalks: StreetSegment[] = [];

  // City boundary limits (set by CityBuilder)
  private boundsMin = new THREE.Vector2(-Infinity, -Infinity);
  private boundsMax = new THREE.Vector2(Infinity, Infinity);

  init(game: Game): void {
    this.camera = game.camera;
    this.input = game.getSystem<InputSystem>('input')!;
    this.sceneSystem = game.getSystem<SceneSystem>('scene')!;
    this.scene = game.scene;
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('/draco/');
    this.gltfLoader = new GLTFLoader();
    this.gltfLoader.setDRACOLoader(dracoLoader);
    this.loadCarModel();  // async load Meshy model (falls back to procedural if fails)

    // React to enter/exit events emitted by WalkSystem
    EventBus.on(Events.CAR_ENTERED, this.onEntered);
    EventBus.on(Events.CAR_EXITED, this.onExited);
  }

  /** Speed in km/h (always positive). */
  getSpeedKmh(): number {
    return Math.abs(this.speed) * 3.6;
  }

  /** World-space position just outside the driver's door (left side). */
  entryPoint(): THREE.Vector3 {
    const sinH = Math.sin(this.heading);
    const cosH = Math.cos(this.heading);
    return new THREE.Vector3(
      this.position.x - cosH * 4.5, // scaled for larger car to avoid trapping
      0,
      this.position.z + sinH * 4.5,
    );
  }

  /** Current velocity vector (world space, m/s). */
  getVelocity(): THREE.Vector3 {
    const sinH = Math.sin(this.heading);
    const cosH = Math.cos(this.heading);
    return new THREE.Vector3(sinH * this.speed, 0, cosH * this.speed);
  }

  /**
   * Returns a world-space AABB that tightly wraps the car's rotated footprint.
   * Recomputed each call — call once per frame from WalkSystem.
   */
  getWorldBox(): THREE.Box3 {
    const sinH = Math.sin(this.heading);
    const cosH = Math.cos(this.heading);
    const corners = [
      [ this.halfW,  this.halfL],
      [-this.halfW,  this.halfL],
      [ this.halfW, -this.halfL],
      [-this.halfW, -this.halfL],
    ].map(([lx, lz]) => ({
      x: this.position.x + lx * cosH - lz * sinH,
      z: this.position.z + lx * sinH + lz * cosH,
    }));

    const xs = corners.map((c) => c.x);
    const zs = corners.map((c) => c.z);
    return new THREE.Box3(
      new THREE.Vector3(Math.min(...xs), 0,          Math.min(...zs)),
      new THREE.Vector3(Math.max(...xs), CAR_HEIGHT, Math.max(...zs)),
    );
  }

  /** Bring the car to an immediate stop. */
  stop(): void {
    this.speed = 0;
    this.steer = 0;
  }

  setSpawn(x: number, y: number, z: number, heading: number): void {
    this.spawnPosition.set(x, y, z);
    this.spawnHeading = heading;
  }

  resetToSpawn(): void {
    this.position.copy(this.spawnPosition);
    this.heading = this.spawnHeading;
    this.stop();
    this.snapToSpawn();
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

  /** Register sidewalk segments for Y-height adjustment. */
  setSidewalks(segments: StreetSegment[]): void {
    this.sidewalks = segments;
  }

  /** Check if position overlaps any sidewalk and return target Y. */
  private getSidewalkY(px: number, pz: number): number {
    for (const sw of this.sidewalks) {
      if (px >= sw.x && px <= sw.x + sw.width && pz >= sw.z && pz <= sw.z + sw.depth) {
        return SIDEWALK_HEIGHT;
      }
    }
    return 0;
  }

  /** Set hard limits the car cannot cross (called by CityBuilder). */
  setCityBounds(minX: number, maxX: number, minZ: number, maxZ: number): void {
    this.boundsMin.set(minX, minZ);
    this.boundsMax.set(maxX, maxZ);
  }

  update(delta: number): void {
    if (this.isOccupied) {
      this.updatePhysics(delta);
      this.updateCamera(delta);
      this.sceneSystem.updateShadowTarget(this.position.x, this.position.z);
    }

    // Smoothly adjust Y to match sidewalk height
    const targetY = this.getSidewalkY(this.position.x, this.position.z);
    this.position.y += (targetY - this.position.y) * Math.min(1, SIDEWALK_Y_LERP * delta);

    this._wheelAngle += (this.speed / 0.35) * delta;

    // Simple suspension bob (works for both procedural and Meshy model)
    this.suspensionOffset = Math.sin(this._wheelAngle * 1.5) * 0.025 * Math.min(1.0, Math.abs(this.speed) / 8);

    this.updateCarMesh();
  }

  dispose(): void {
    EventBus.off(Events.CAR_ENTERED, this.onEntered);
    EventBus.off(Events.CAR_EXITED, this.onExited);

    // Dispose all geometries and materials in the car group
    this.carGroup.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    });
    this.scene.remove(this.carGroup);
  }

  // ---------------------------------------------------------------------------
  // EventBus handlers
  // ---------------------------------------------------------------------------

  private onEntered = (): void => {
    this.isOccupied = true;
    this.snapCamera();
  };

  private onExited = (): void => {
    this.isOccupied = false;
    this.stop();
  };

  // ---------------------------------------------------------------------------

  private updatePhysics(delta: number): void {
    const { state } = this.input;
    const throttle = state.forward ? 1 : 0;
    const brake = state.backward ? 1 : 0;
    const steerInput = state.left ? -1 : state.right ? 1 : 0;

    if (throttle > 0) {
      this.speed += CAR_ACCEL * delta;
    } else if (brake > 0) {
      if (this.speed > 0.1) {
        this.speed -= CAR_BRAKE_FORCE * delta;
      } else {
        this.speed -= CAR_ACCEL * delta;
      }
    } else {
      if (this.speed > 0) {
        this.speed = Math.max(0, this.speed - CAR_DRAG * delta);
      } else if (this.speed < 0) {
        this.speed = Math.min(0, this.speed + CAR_DRAG * delta);
      }
    }

    this.speed = Math.max(-CAR_MAX_SPEED_REV, Math.min(CAR_MAX_SPEED_FWD, this.speed));

    const targetSteer = steerInput;
    this.steer += (targetSteer - this.steer) * Math.min(1, 8 * delta);

    // Improved handling: only turn/rotate when moving (prevents spinning in place)
    let turnDelta = 0;
    if (Math.abs(this.speed) >= CAR_MIN_TURN_SPEED) {
      const spd = Math.abs(this.speed);
      const speedFactor = spd / (CAR_MAX_SPEED_FWD * 0.5);
      const steerRate = CAR_STEER_SPEED / (1 + speedFactor * CAR_SPEED_STEER_FACTOR * 60);
      const lowSpeedRamp = Math.min(1, spd / CAR_FULL_TURN_SPEED);
      turnDelta = this.steer * steerRate * lowSpeedRamp * delta * Math.sign(this.speed);
    }
    this.heading -= turnDelta;

    const sinH = Math.sin(this.heading);
    const cosH = Math.cos(this.heading);
    const dx = sinH * this.speed * delta;
    const dz = cosH * this.speed * delta;

    const blockedX = !this.tryMove(dx, 0);
    const blockedZ = !this.tryMove(0, dz);

    if (blockedX && blockedZ) {
      // Head-on hit — bounce back hard
      this.speed *= -0.3;
    } else if (blockedX) {
      // Wall perpendicular to X — auto-steer to align along Z
      const correction = Math.sin(this.heading) * Math.cos(this.heading) * 8.0 * delta;
      this.heading -= correction;
      this.speed *= 0.97;
    } else if (blockedZ) {
      // Wall perpendicular to Z — auto-steer to align along X
      const correction = Math.sin(this.heading) * Math.cos(this.heading) * 8.0 * delta;
      this.heading += correction;
      this.speed *= 0.97;
    }
  }

  /** Try to move along one axis. Returns true if the move succeeded. */
  private tryMove(dx: number, dz: number): boolean {
    const nx = this.position.x + dx;
    const nz = this.position.z + dz;

    // Axis-aligned bounding box of the rotated car footprint
    const sinH = Math.abs(Math.sin(this.heading));
    const cosH = Math.abs(Math.cos(this.heading));
    const hwX = cosH * this.halfW + sinH * this.halfL;
    const hwZ = sinH * this.halfW + cosH * this.halfL;

    this._tryBox.min.set(nx - hwX, 0,          nz - hwZ);
    this._tryBox.max.set(nx + hwX, CAR_HEIGHT, nz + hwZ);

    for (const box of this.colliders) {
      if (this._tryBox.intersectsBox(box)) {
        return false;
      }
    }

    // Clamp to city bounds using heading-aware extents
    const clampedX = Math.max(this.boundsMin.x + hwX, Math.min(this.boundsMax.x - hwX, nx));
    const clampedZ = Math.max(this.boundsMin.y + hwZ, Math.min(this.boundsMax.y - hwZ, nz));
    if (clampedX !== nx || clampedZ !== nz) {
      this.position.x = clampedX;
      this.position.z = clampedZ;
      return false;
    }
    this.position.x = clampedX;
    this.position.z = clampedZ;
    return true;
  }

  private updateCarMesh(): void {
    if (!this.carGroup) return;

    const bodyY = this.position.y + this.suspensionOffset * 0.6 + this.carYOffset;
    this.carGroup.position.set(this.position.x, bodyY, this.position.z);
    this.carGroup.rotation.y = this.heading;

    // Rotate wheels (works for both Meshy-derived pivots and procedural)
    for (const pivot of this.wheelPivots) {
      const wheelY = 0.35 + this.suspensionOffset * 0.8;
      pivot.position.y = wheelY;
      pivot.rotation.x = this._wheelAngle;
    }
  }

  private updateCamera(delta: number): void {
    const { mouseDX, mouseDY } = this.input.state;

    this.camYaw -= mouseDX * CAR_MOUSE_SENSITIVITY;
    this.camPitch += mouseDY * CAR_MOUSE_SENSITIVITY;
    this.camPitch = Math.max(CAR_PITCH_MIN, Math.min(CAR_PITCH_MAX, this.camPitch));

    const angle = this.heading + this.camYaw;
    const sinA = Math.sin(angle);
    const cosA = Math.cos(angle);

    const pitchCos = Math.cos(this.camPitch);
    const pitchSin = Math.sin(this.camPitch);
    const dist = CAR_CAM_DIST * pitchCos;
    const height = CAR_CAM_HEIGHT + CAR_CAM_DIST * pitchSin;

    this._idealPos.set(
      this.position.x - sinA * dist,
      this.position.y + height,
      this.position.z - cosA * dist,
    );

    this._lookAt.set(
      this.position.x + sinA * 2,
      this.position.y + 1.2,
      this.position.z + cosA * 2,
    );

    // Pull camera forward if a building AABB blocks the line of sight
    this._camRayDir.subVectors(this._idealPos, this._lookAt);
    const fullDist = this._camRayDir.length();
    if (fullDist > 0.01) {
      this._camRayDir.divideScalar(fullDist); // normalize
      this._camRay.set(this._lookAt, this._camRayDir);
      let closest = fullDist;
      for (let i = 0; i < this.colliders.length; i++) {
        const hitPt = this._camRay.intersectBox(this.colliders[i], _camHit);
        if (hitPt) {
          const d = hitPt.distanceTo(this._lookAt);
          if (d < closest) closest = d;
        }
      }
      if (closest < fullDist) {
        // Place camera slightly in front of the hit point
        const safeDist = Math.max(0.5, closest - 0.3);
        this._idealPos.copy(this._lookAt).addScaledVector(this._camRayDir, safeDist);
      }
    }

    const t = Math.min(1, CAR_CAM_LERP * delta);
    this.camPos.lerp(this._idealPos, t);
    this.camTarget.lerp(this._lookAt, t);

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
      this.position.x - sinH * CAR_CAM_DIST,
      this.position.y + CAR_CAM_HEIGHT,
      this.position.z - cosH * CAR_CAM_DIST,
    );
    this.camTarget.set(this.position.x, this.position.y + 1.2, this.position.z);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);
  }

  // ---------------------------------------------------------------------------
  // Car mesh construction (Meshy GLB preferred)
  // ---------------------------------------------------------------------------

  private async loadCarModel(): Promise<void> {
    try {
      console.log('Loading Meshy-generated car model...');
      const gltf = await new Promise<any>((resolve, reject) => {
        this.gltfLoader.load(
          '/assets/models/car_optimized.glb',
          resolve,
          (progress) => console.log('Load progress:', (progress.loaded / progress.total * 100).toFixed(1) + '%'),
          reject
        );
      });

      // Wrap the model so carGroup owns heading (Y) and the model keeps its fixed orientation
      const model = gltf.scene;
      model.scale.setScalar(CAR_MODEL_SCALE);
      model.rotation.y = Math.PI / 2; // GLB natural front is -X; rotate to face +Z (physics forward)

      this.carGroup = new THREE.Group();
      this.carGroup.add(model);

      // Enable shadows on all meshes + refined materials (less shiny, brighter per request)
      this.carGroup.traverse((child: THREE.Object3D) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          // Ensure PBR materials from Meshy are configured for scene lighting
          if (child.material) {
            const mat = child.material as THREE.MeshStandardMaterial;
            if (mat.map) mat.map.needsUpdate = true;
            mat.roughness = CAR_BODY_ROUGHNESS;
            mat.metalness = CAR_BODY_METALNESS;
            mat.envMapIntensity = CAR_ENV_INTENSITY;
            mat.emissive = new THREE.Color(0x111111); // subtle brightness boost
            mat.emissiveIntensity = 0.3;
          }
        }
      });

      // Calculate exact Y offset and collision extents from actual model bounding box
      const box = new THREE.Box3().setFromObject(this.carGroup);
      const size = new THREE.Vector3();
      box.getSize(size);
      this.carYOffset = -box.min.y + CAR_GROUND_CLEARANCE;
      this.halfW = size.x / 2;
      this.halfL = size.z / 2;
      console.log(`Car bbox: ${size.x.toFixed(2)}w × ${size.z.toFixed(2)}l × ${size.y.toFixed(2)}h (halfW=${this.halfW.toFixed(2)}, halfL=${this.halfL.toFixed(2)}`);

      // Find wheel meshes if present in Meshy model (single-mesh car has integrated tires; no geometric fallback)
      this.wheelPivots = [];
      this.carGroup.traverse((child: THREE.Object3D) => {
        if (child instanceof THREE.Mesh && 
            (child.name.toLowerCase().includes('wheel') || 
             child.name.toLowerCase().includes('tire') || 
             child.name.toLowerCase().includes('rim'))) {
          const pivot = new THREE.Group();
          pivot.add(child);
          this.carGroup.add(pivot);
          this.wheelPivots.push(pivot);
        }
      });

      this.scene.add(this.carGroup);
      this.modelLoaded = true;
      console.log(`✅ Meshy car model loaded successfully (${this.wheelPivots.length} wheels detected, geometric tires removed)`);
    } catch (error) {
      console.error('Failed to load Meshy car model, falling back to procedural:', error);
      this.buildCarMesh();
    }
  }

  private buildCarMesh(): void {
    this.carGroup = new THREE.Group();

    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xcc2222, roughness: 0.4, metalness: 0.5 });
    const bodyGeo = new THREE.BoxGeometry(1.8, 0.55, 4.0);
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.set(0, 0.45, 0);
    body.castShadow = true;
    this.carGroup.add(body);

    const cabinMat = new THREE.MeshStandardMaterial({ color: 0x991818, roughness: 0.5, metalness: 0.3 });
    const cabinGeo = new THREE.BoxGeometry(1.5, 0.55, 2.2);
    const cabin = new THREE.Mesh(cabinGeo, cabinMat);
    cabin.position.set(0, 0.95, -0.1);
    cabin.castShadow = true;
    this.carGroup.add(cabin);

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

    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.3, metalness: 0.8 });

    const wheelPositions = [
      { x: -1.0, z: 1.3 },
      { x:  1.0, z: 1.3 },
      { x: -1.0, z: -1.3 },
      { x:  1.0, z: -1.3 },
    ];

    for (const wp of wheelPositions) {
      const pivot = new THREE.Group();
      pivot.position.set(wp.x, 0.35, wp.z);
      this.carGroup.add(pivot);
      this.wheelPivots.push(pivot);

      const wGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.25, 16);
      const wheel = new THREE.Mesh(wGeo, wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.castShadow = true;
      pivot.add(wheel);

      const rGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.26, 8);
      const rim = new THREE.Mesh(rGeo, rimMat);
      rim.rotation.z = Math.PI / 2;
      pivot.add(rim);
    }

    const lightMat = new THREE.MeshStandardMaterial({ color: 0xffffcc, emissive: 0xffffcc, emissiveIntensity: 1.5 });
    for (const sx of [-0.6, 0.6]) {
      const hGeo = new THREE.BoxGeometry(0.3, 0.15, 0.05);
      const h = new THREE.Mesh(hGeo, lightMat);
      h.position.set(sx, 0.5, 2.02);
      this.carGroup.add(h);
    }

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
