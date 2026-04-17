import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { Game, GameSystem } from '../core/Game';
import { EventBus, Events, CarEnteredEvent, CarExitedEvent } from '../core/EventBus';
import { InputSystem } from './InputSystem';
import { SceneSystem } from './SceneSystem';
import { CarSystem } from './CarSystem';
import {
  WALK_SPEED, SPRINT_SPEED, PLAYER_RADIUS, PLAYER_HEIGHT,
  WALK_CAM_DIST, WALK_CAM_HEIGHT, WALK_CAM_LERP,
  WALK_MOUSE_SENSITIVITY, WALK_PITCH_MIN, WALK_PITCH_MAX,
  CAR_ENTER_RADIUS,
} from '../constants';
import type { StreetSegment } from '../city/CityLayout';
import { playerOptions } from '../playerOptions';

const SIDEWALK_HEIGHT = 0.15;
const SIDEWALK_Y_LERP = 12;

export interface InteractZone {
  id: string;
  center: THREE.Vector3;
  radius: number;
  /** Dynamic — can reflect order value, state, etc. */
  getPrompt(): string;
  onInteract(): void;
}

const _camHit = new THREE.Vector3();
const _camRay = new THREE.Ray();
const _camRayDir = new THREE.Vector3();

export class WalkSystem implements GameSystem {
  /** Name 'player' — CityBuilder still uses getSystem('player') to set spawn. */
  readonly name = 'player';

  // Exposed position — used by minimap and city spawn
  readonly position = new THREE.Vector3(0, 0, 0);

  // Read by minimap to draw heading arrow
  heading = 0;

  get isDriving(): boolean { return this.driving; }
  get isWalking(): boolean { return this.isMoving && !this.driving; }

  private driving = false;
  private interactZones = new Map<string, InteractZone>();

  private camera!: THREE.PerspectiveCamera;
  private input!: InputSystem;
  private sceneSystem!: SceneSystem;
  private scene!: THREE.Scene;
  private car!: CarSystem;

  // Character mesh group (loaded GLB model)
  private characterGroup!: THREE.Group;
  private mixer: THREE.AnimationMixer | null = null;
  private runAction: THREE.AnimationAction | null = null;
  private isMoving = false;

  // Camera state
  private camPos = new THREE.Vector3();
  private camTarget = new THREE.Vector3();
  private camYaw = 0;
  private camPitch = 0.1;

  // Colliders (buildings only — car collision is checked via car.getWorldBox())
  private colliders: THREE.Box3[] = [];

  // Sidewalk segments — used for Y adjustment when walking over curbs
  private sidewalks: StreetSegment[] = [];

  // Initial spawn state for reset
  private spawnPosition = new THREE.Vector3();
  private spawnHeading = 0;

  // City boundary limits (set by CityBuilder)
  private boundsMin = new THREE.Vector2(-Infinity, -Infinity);
  private boundsMax = new THREE.Vector2(Infinity, Infinity);

  // "Press E" prompt HUD element
  private promptEl!: HTMLDivElement;

  init(game: Game): void {
    this.camera = game.camera;
    this.input = game.getSystem<InputSystem>('input')!;
    this.sceneSystem = game.getSystem<SceneSystem>('scene')!;
    this.scene = game.scene;
    this.car = game.getSystem<CarSystem>('car')!;

    this.buildCharacterMesh();
    this.buildPromptHUD();
    this.snapCamera();
  }

  /** Required by CityBuilder — sets spawn position for the walking player. */
  snapToSpawn(): void {
    this.snapCamera();
    this.updateCharacterMesh();
  }

  setSpawn(x: number, y: number, z: number, heading: number): void {
    this.spawnPosition.set(x, y, z);
    this.spawnHeading = heading;
  }

  resetToSpawn(): void {
    this.position.copy(this.spawnPosition);
    this.heading = this.spawnHeading;
    this.isMoving = false;
    if (this.runAction) {
      this.runAction.stop();
    }
    this.snapToSpawn();
    this.updateCharacterMesh();
  }

  registerInteractZone(zone: InteractZone): void {
    this.interactZones.set(zone.id, zone);
  }

  unregisterInteractZone(id: string): void {
    this.interactZones.delete(id);
  }

  /** Register collision AABBs (buildings). Also forwards to CarSystem. */
  addColliders(boxes: THREE.Box3[]): void {
    this.colliders.push(...boxes);
    this.car.addColliders(boxes);
  }

  clearColliders(): void {
    this.colliders.length = 0;
    this.car.clearColliders();
  }

  /** Set hard limits the player cannot cross (called by CityBuilder). */
  setCityBounds(minX: number, maxX: number, minZ: number, maxZ: number): void {
    this.boundsMin.set(minX, minZ);
    this.boundsMax.set(maxX, maxZ);
  }

  /** Register sidewalk segments for Y-height adjustment. */
  setSidewalks(segments: StreetSegment[]): void {
    this.sidewalks = segments;
    this.car.setSidewalks(segments);
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

  update(delta: number): void {
    const { state } = this.input;

    if (state.resetPressed) {
      if (this.driving) {
        this.car.resetToSpawn();
      } else {
        this.resetToSpawn();
      }
    }

    if (!state.pointerLocked) return;

    // --- Enter / Exit car / Interact with zones ---
    const nearCar = !this.driving && this.position.distanceTo(this.car.position) <= CAR_ENTER_RADIUS;
    const nearestZone = (!this.driving && !nearCar) ? this.getNearestZone() : null;

    if (state.interactPressed) {
      if (this.driving) {
        this.exitCar();
      } else if (nearCar) {
        this.enterCar();
      } else if (nearestZone) {
        nearestZone.onInteract();
      }
    }

    // Show/hide interact prompt
    const mobile = this.input.isMobile;
    if (this.driving) {
      this.promptEl.style.display = 'none';
    } else if (nearCar) {
      this.promptEl.textContent = mobile ? 'Tap E to enter' : 'Press E to enter';
      this.promptEl.style.display = 'block';
    } else if (nearestZone) {
      const prompt = nearestZone.getPrompt();
      this.promptEl.textContent = mobile ? prompt.replace('Press E', 'Tap E') : prompt;
      this.promptEl.style.display = 'block';
    } else {
      this.promptEl.style.display = 'none';
    }

    if (this.driving) {
      this.sceneSystem.updateShadowTarget(this.car.position.x, this.car.position.z);
      this.input.resetDeltas();
      return;
    }

    this.updateWalk(delta, state);
    this.updateCamera(delta);
    this.sceneSystem.updateShadowTarget(this.position.x, this.position.z);
    this.input.resetDeltas();
  }

  dispose(): void {
    this.promptEl.remove();
  }

  private getNearestZone(): InteractZone | null {
    let nearest: InteractZone | null = null;
    let nearestDist = Infinity;
    for (const zone of this.interactZones.values()) {
      const dist = this.position.distanceTo(zone.center);
      if (dist <= zone.radius && dist < nearestDist) {
        nearestDist = dist;
        nearest = zone;
      }
    }
    return nearest;
  }

  // ---------------------------------------------------------------------------

  private enterCar(): void {
    this.driving = true;
    this.characterGroup.visible = false;
    this.promptEl.style.display = 'none';

    EventBus.emit<CarEnteredEvent>(Events.CAR_ENTERED, {
      carPosition: { x: this.car.position.x, z: this.car.position.z },
    });
  }

  private exitCar(): void {
    this.driving = false;

    const exit = this.car.entryPoint();
    this.position.copy(exit);
    this.heading = this.car.heading;

    this.characterGroup.visible = true;
    this.snapCamera();

    EventBus.emit<CarExitedEvent>(Events.CAR_EXITED, {
      exitPosition: { x: exit.x, y: exit.y, z: exit.z },
      carHeading: this.car.heading,
    });
  }

  private updateWalk(
    delta: number,
    state: { forward: boolean; backward: boolean; left: boolean; right: boolean; sprint: boolean },
  ): void {
    const speed = state.sprint ? SPRINT_SPEED : WALK_SPEED;

    const sinY = Math.sin(this.camYaw);
    const cosY = Math.cos(this.camYaw);

    let dx = 0;
    let dz = 0;
    if (state.forward)  { dx -= sinY; dz -= cosY; }
    if (state.backward) { dx += sinY; dz += cosY; }
    if (state.left)     { dx -= cosY; dz += sinY; }
    if (state.right)    { dx += cosY; dz -= sinY; }

    const len = Math.sqrt(dx * dx + dz * dz);
    const moving = len > 0;
    if (moving) {
      dx = (dx / len) * speed * delta;
      dz = (dz / len) * speed * delta;

      this.heading = Math.atan2(dx, dz);

      this.tryMove(dx, 0);
      this.tryMove(0, dz);
    }

    // Play / stop run animation
    if (moving !== this.isMoving) {
      this.isMoving = moving;
      if (this.runAction) {
        if (moving) {
          this.runAction.play();
        } else {
          this.runAction.stop();
        }
      }
    }

    if (this.mixer) this.mixer.update(delta);

    // Smoothly adjust Y to match sidewalk height
    const targetY = this.getSidewalkY(this.position.x, this.position.z);
    this.position.y += (targetY - this.position.y) * Math.min(1, SIDEWALK_Y_LERP * delta);

    this.updateCharacterMesh();
  }

  private tryMove(dx: number, dz: number): void {
    const nx = this.position.x + dx;
    const nz = this.position.z + dz;

    const pBox = new THREE.Box3(
      new THREE.Vector3(nx - PLAYER_RADIUS, this.position.y,                nz - PLAYER_RADIUS),
      new THREE.Vector3(nx + PLAYER_RADIUS, this.position.y + PLAYER_HEIGHT, nz + PLAYER_RADIUS),
    );

    for (const box of this.colliders) {
      if (pBox.intersectsBox(box)) return;
    }

    if (pBox.intersectsBox(this.car.getWorldBox())) return;

    this.position.x = Math.max(this.boundsMin.x + PLAYER_RADIUS, Math.min(this.boundsMax.x - PLAYER_RADIUS, nx));
    this.position.z = Math.max(this.boundsMin.y + PLAYER_RADIUS, Math.min(this.boundsMax.y - PLAYER_RADIUS, nz));
  }

  private updateCharacterMesh(): void {
    this.characterGroup.position.set(this.position.x, this.position.y, this.position.z);
    this.characterGroup.rotation.y = this.heading;
  }

  private updateCamera(delta: number): void {
    const { mouseDX, mouseDY } = this.input.state;

    this.camYaw -= mouseDX * WALK_MOUSE_SENSITIVITY;
    this.camPitch += mouseDY * WALK_MOUSE_SENSITIVITY;
    this.camPitch = Math.max(WALK_PITCH_MIN, Math.min(WALK_PITCH_MAX, this.camPitch));

    const sinY = Math.sin(this.camYaw);
    const cosY = Math.cos(this.camYaw);
    const pitchCos = Math.cos(this.camPitch);
    const pitchSin = Math.sin(this.camPitch);

    const dist = WALK_CAM_DIST * pitchCos;
    const height = WALK_CAM_HEIGHT + WALK_CAM_DIST * pitchSin;

    const idealPos = new THREE.Vector3(
      this.position.x + sinY * dist,
      this.position.y + height,
      this.position.z + cosY * dist,
    );

    const lookAt = new THREE.Vector3(
      this.position.x,
      this.position.y + PLAYER_HEIGHT * 0.8,
      this.position.z,
    );

    // Pull camera forward if a building AABB blocks the line of sight
    _camRayDir.subVectors(idealPos, lookAt);
    const fullDist = _camRayDir.length();
    if (fullDist > 0.01) {
      _camRayDir.divideScalar(fullDist);
      _camRay.set(lookAt, _camRayDir);
      let closest = fullDist;
      for (let i = 0; i < this.colliders.length; i++) {
        const hitPt = _camRay.intersectBox(this.colliders[i], _camHit);
        if (hitPt) {
          const d = hitPt.distanceTo(lookAt);
          if (d < closest) closest = d;
        }
      }
      if (closest < fullDist) {
        const safeDist = Math.max(0.5, closest - 0.3);
        idealPos.copy(lookAt).addScaledVector(_camRayDir, safeDist);
      }
    }

    const t = Math.min(1, WALK_CAM_LERP * delta);
    this.camPos.lerp(idealPos, t);
    this.camTarget.lerp(lookAt, t);

    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);
  }

  private snapCamera(): void {
    this.camYaw = this.heading + Math.PI;
    this.camPitch = 0.1;

    const sinY = Math.sin(this.camYaw);
    const cosY = Math.cos(this.camYaw);
    this.camPos.set(
      this.position.x + sinY * WALK_CAM_DIST,
      this.position.y + WALK_CAM_HEIGHT,
      this.position.z + cosY * WALK_CAM_DIST,
    );
    this.camTarget.set(this.position.x, this.position.y + PLAYER_HEIGHT * 0.8, this.position.z);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);
  }

  // ---------------------------------------------------------------------------
  // GLB character model
  // ---------------------------------------------------------------------------

  private buildCharacterMesh(): void {
    this.characterGroup = new THREE.Group();
    this.scene.add(this.characterGroup);

    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('/draco/');
    const loader = new GLTFLoader();
    loader.setDRACOLoader(dracoLoader);
    loader.load('delivery_guy_running_optimized.glb', (gltf) => {
      const model = gltf.scene;

      // Scale model to match PLAYER_HEIGHT
      const box = new THREE.Box3().setFromObject(model);
      const modelHeight = box.max.y - box.min.y;
      const scale = PLAYER_HEIGHT / modelHeight;
      model.scale.setScalar(scale);

      // Ground the model (shift so feet sit at y=0)
      const scaledMinY = box.min.y * scale;
      model.position.y = -scaledMinY;

      model.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          child.castShadow = true;
          const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
          if (mat) {
            mat.transparent = false;
            mat.depthWrite = true;
            mat.alphaTest = 0;
            mat.color = new THREE.Color(playerOptions.shirtColor);
          }
        }
      });

      this.characterGroup.add(model);

      // Set up animations
      if (gltf.animations.length > 0) {
        this.mixer = new THREE.AnimationMixer(model);

        this.runAction = this.mixer.clipAction(gltf.animations[0]);
        this.runAction.setLoop(THREE.LoopRepeat, Infinity);
      }
    });
  }

  private buildPromptHUD(): void {
    this.promptEl = document.createElement('div');
    Object.assign(this.promptEl.style, {
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      marginTop: '60px',
      color: '#ffffff',
      fontFamily: 'sans-serif',
      fontSize: '16px',
      background: 'rgba(0,0,0,0.55)',
      padding: '6px 14px',
      borderRadius: '6px',
      pointerEvents: 'none',
      display: 'none',
      zIndex: '200',
      letterSpacing: '0.04em',
    });
    this.promptEl.textContent = 'Press E to enter';
    document.body.appendChild(this.promptEl);
  }
}
