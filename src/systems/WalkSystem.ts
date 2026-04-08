import * as THREE from 'three';
import { Game, GameSystem } from '../core/Game';
import { InputSystem } from './InputSystem';
import { SceneSystem } from './SceneSystem';
import { CarSystem } from './CarSystem';

// --- Character tuning ---
const WALK_SPEED = 5;      // m/s
const SPRINT_SPEED = 9;    // m/s
const PLAYER_RADIUS = 0.3; // collision cylinder radius
const PLAYER_HEIGHT = 1.75;

// --- Camera (third-person) ---
const CAM_DIST = 5;        // spring-arm length
const CAM_HEIGHT = 2.0;    // height offset above character
const CAM_LERP = 10;
const MOUSE_SENSITIVITY = 0.003;
const PITCH_MIN = -0.4;
const PITCH_MAX = 0.8;

// --- Enter/exit car ---
const ENTER_RADIUS = 3.5;  // max distance from car to trigger entry

export class WalkSystem implements GameSystem {
  /** Name 'player' — CityBuilder still uses getSystem('player') to set spawn. */
  readonly name = 'player';

  // Exposed position — used by minimap and city spawn
  readonly position = new THREE.Vector3(0, 0, 0);

  // Read by minimap to draw heading arrow
  heading = 0; // world-Y rotation of character (rad)

  private driving = false;

  private camera!: THREE.PerspectiveCamera;
  private input!: InputSystem;
  private sceneSystem!: SceneSystem;
  private scene!: THREE.Scene;
  private car!: CarSystem;

  // Character mesh group (humanoid placeholder)
  private characterGroup!: THREE.Group;

  // Camera state
  private camPos = new THREE.Vector3();
  private camTarget = new THREE.Vector3();
  private camYaw = 0;
  private camPitch = 0.1;

  // Colliders
  private colliders: THREE.Box3[] = [];

  // "Press E" prompt HUD element
  private promptEl!: HTMLDivElement;

  // Scratch
  private readonly _fwd = new THREE.Vector3();

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

  /** Register collision AABBs (called by city generator). */
  addColliders(boxes: THREE.Box3[]): void {
    this.colliders.push(...boxes);
    // Also pass to car so it can collide with buildings
    this.car.addColliders(boxes);
  }

  clearColliders(): void {
    this.colliders.length = 0;
    this.car.clearColliders();
  }

  update(delta: number): void {
    const { state } = this.input;

    if (!state.pointerLocked) return;

    // --- Enter / Exit car ---
    if (state.interactPressed) {
      if (this.driving) {
        this.exitCar();
      } else {
        const dist = this.position.distanceTo(this.car.position);
        if (dist <= ENTER_RADIUS) {
          this.enterCar();
        }
      }
    }

    // Show/hide "Press E" prompt
    const nearCar = !this.driving && this.position.distanceTo(this.car.position) <= ENTER_RADIUS;
    this.promptEl.style.display = nearCar ? 'block' : 'none';

    if (this.driving) {
      // Car handles its own physics and camera update
      this.sceneSystem.updateShadowTarget(this.car.position.x, this.car.position.z);
      this.input.resetDeltas();
      return;
    }

    // --- On-foot update ---
    this.updateWalk(delta, state);
    this.updateCamera(delta);
    this.sceneSystem.updateShadowTarget(this.position.x, this.position.z);
    this.input.resetDeltas();
  }

  // ---------------------------------------------------------------------------

  private enterCar(): void {
    this.driving = true;
    this.car.isOccupied = true;
    this.car.snapCamera();

    // Hide character while inside car
    this.characterGroup.visible = false;
    this.promptEl.style.display = 'none';
  }

  private exitCar(): void {
    this.driving = false;
    this.car.isOccupied = false;
    this.car.stop();

    // Teleport character to driver's door exit point
    const exit = this.car.entryPoint();
    this.position.copy(exit);
    this.heading = this.car.heading;

    this.characterGroup.visible = true;
    this.snapCamera();
  }

  private updateWalk(
    delta: number,
    state: { forward: boolean; backward: boolean; left: boolean; right: boolean; sprint: boolean },
  ): void {
    const speed = state.sprint ? SPRINT_SPEED : WALK_SPEED;

    // Move direction is relative to camera yaw (not character heading)
    const sinY = Math.sin(this.camYaw);
    const cosY = Math.cos(this.camYaw);

    let dx = 0;
    let dz = 0;
    if (state.forward)  { dx -= sinY; dz -= cosY; }
    if (state.backward) { dx += sinY; dz += cosY; }
    if (state.left)     { dx -= cosY; dz += sinY; }
    if (state.right)    { dx += cosY; dz -= sinY; }

    const len = Math.sqrt(dx * dx + dz * dz);
    if (len > 0) {
      dx = (dx / len) * speed * delta;
      dz = (dz / len) * speed * delta;

      // Face movement direction
      this.heading = Math.atan2(dx, dz);

      this.tryMove(dx, 0);
      this.tryMove(0, dz);
    }

    this.updateCharacterMesh();
  }

  private tryMove(dx: number, dz: number): void {
    const nx = this.position.x + dx;
    const nz = this.position.z + dz;

    const pMin = new THREE.Vector3(nx - PLAYER_RADIUS, this.position.y, nz - PLAYER_RADIUS);
    const pMax = new THREE.Vector3(nx + PLAYER_RADIUS, this.position.y + PLAYER_HEIGHT, nz + PLAYER_RADIUS);
    const pBox = new THREE.Box3(pMin, pMax);

    for (const box of this.colliders) {
      if (pBox.intersectsBox(box)) return;
    }

    // Collide with the car when on foot
    if (pBox.intersectsBox(this.car.getWorldBox())) return;

    this.position.x = nx;
    this.position.z = nz;
  }

  private updateCharacterMesh(): void {
    this.characterGroup.position.set(this.position.x, this.position.y, this.position.z);
    this.characterGroup.rotation.y = this.heading;
  }

  private updateCamera(delta: number): void {
    const { mouseDX, mouseDY } = this.input.state;

    this.camYaw -= mouseDX * MOUSE_SENSITIVITY;
    this.camPitch += mouseDY * MOUSE_SENSITIVITY;
    this.camPitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, this.camPitch));

    const sinY = Math.sin(this.camYaw);
    const cosY = Math.cos(this.camYaw);
    const pitchCos = Math.cos(this.camPitch);
    const pitchSin = Math.sin(this.camPitch);

    const dist = CAM_DIST * pitchCos;
    const height = CAM_HEIGHT + CAM_DIST * pitchSin;

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

    const t = Math.min(1, CAM_LERP * delta);
    this.camPos.lerp(idealPos, t);
    this.camTarget.lerp(lookAt, t);

    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);
  }

  private snapCamera(): void {
    this.camYaw = this.heading + Math.PI; // camera starts behind character
    this.camPitch = 0.1;

    const sinY = Math.sin(this.camYaw);
    const cosY = Math.cos(this.camYaw);
    this.camPos.set(
      this.position.x + sinY * CAM_DIST,
      this.position.y + CAM_HEIGHT,
      this.position.z + cosY * CAM_DIST,
    );
    this.camTarget.set(this.position.x, this.position.y + PLAYER_HEIGHT * 0.8, this.position.z);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);
  }

  // ---------------------------------------------------------------------------
  // Humanoid placeholder mesh (head + torso + arms + legs)
  // Designed so it's easy to swap for a GLB model later.
  // ---------------------------------------------------------------------------

  private buildCharacterMesh(): void {
    this.characterGroup = new THREE.Group();

    const skinMat = new THREE.MeshStandardMaterial({ color: 0xf5c5a3, roughness: 0.8 });
    const shirtMat = new THREE.MeshStandardMaterial({ color: 0x3a6bbf, roughness: 0.9 });
    const pantsMat = new THREE.MeshStandardMaterial({ color: 0x2a2a4a, roughness: 0.9 });
    const hairMat = new THREE.MeshStandardMaterial({ color: 0x3b2507, roughness: 1.0 });
    const shoeMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8 });

    // --- Head ---
    const headGeo = new THREE.BoxGeometry(0.28, 0.3, 0.28);
    const head = new THREE.Mesh(headGeo, skinMat);
    head.position.set(0, 1.58, 0);
    head.castShadow = true;
    this.characterGroup.add(head);

    // Hair (flat cap on top)
    const hairGeo = new THREE.BoxGeometry(0.30, 0.08, 0.30);
    const hair = new THREE.Mesh(hairGeo, hairMat);
    hair.position.set(0, 1.76, 0);
    this.characterGroup.add(hair);

    // --- Torso ---
    const torsoGeo = new THREE.BoxGeometry(0.38, 0.48, 0.22);
    const torso = new THREE.Mesh(torsoGeo, shirtMat);
    torso.position.set(0, 1.18, 0);
    torso.castShadow = true;
    this.characterGroup.add(torso);

    // --- Upper arms ---
    for (const sx of [-1, 1]) {
      const uaGeo = new THREE.BoxGeometry(0.12, 0.28, 0.14);
      const ua = new THREE.Mesh(uaGeo, shirtMat);
      ua.position.set(sx * 0.27, 1.20, 0);
      ua.castShadow = true;
      this.characterGroup.add(ua);

      // Forearms
      const faGeo = new THREE.BoxGeometry(0.10, 0.25, 0.12);
      const fa = new THREE.Mesh(faGeo, skinMat);
      fa.position.set(sx * 0.27, 0.94, 0);
      this.characterGroup.add(fa);

      // Hands
      const hGeo = new THREE.BoxGeometry(0.09, 0.09, 0.09);
      const hand = new THREE.Mesh(hGeo, skinMat);
      hand.position.set(sx * 0.27, 0.80, 0);
      this.characterGroup.add(hand);
    }

    // --- Upper legs ---
    for (const sx of [-1, 1]) {
      const ulGeo = new THREE.BoxGeometry(0.15, 0.35, 0.17);
      const ul = new THREE.Mesh(ulGeo, pantsMat);
      ul.position.set(sx * 0.10, 0.76, 0);
      ul.castShadow = true;
      this.characterGroup.add(ul);

      // Lower legs
      const llGeo = new THREE.BoxGeometry(0.13, 0.34, 0.15);
      const ll = new THREE.Mesh(llGeo, pantsMat);
      ll.position.set(sx * 0.10, 0.41, 0);
      this.characterGroup.add(ll);

      // Shoes
      const shGeo = new THREE.BoxGeometry(0.14, 0.09, 0.22);
      const shoe = new THREE.Mesh(shGeo, shoeMat);
      shoe.position.set(sx * 0.10, 0.22, 0.03);
      this.characterGroup.add(shoe);
    }

    this.scene.add(this.characterGroup);
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

  dispose(): void {
    this.promptEl.remove();
  }
}
