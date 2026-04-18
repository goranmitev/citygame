import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { Game, GameSystem } from '../core/Game';
import {
  EventBus, Events,
  NetWelcomeEvent, NetPlayerJoinedEvent, NetPlayerLeftEvent, NetPlayerPosEvent,
} from '../core/EventBus';
import {
  CAR_MODEL_SCALE, CAR_GROUND_CLEARANCE,
  CAR_BODY_ROUGHNESS, CAR_BODY_METALNESS, CAR_ENV_INTENSITY,
  PLAYER_HEIGHT,
  CAR_HALF_W, CAR_HALF_L, CAR_HEIGHT,
} from '../constants';

interface RemotePlayer {
  targetPos:      THREE.Vector3;
  targetHeading:  number;
  isInCar:        boolean;
  displayPos:     THREE.Vector3;
  displayHeading: number;
  carGroup:       THREE.Group;
  walkGroup:      THREE.Group;
  mixer:          THREE.AnimationMixer | null;
  runAction:      THREE.AnimationAction | null;
  prevPos:        THREE.Vector3;
}

interface QueuedPlayer {
  id:         string;
  carColor:   string;
  shirtColor: string;
}

const LERP_K          = 10;
const MOVE_THRESHOLD  = 0.05; // m/s — below this speed, idle (no run anim)

export class RemotePlayerSystem implements GameSystem {
  readonly name = 'remote';

  private scene!: THREE.Scene;
  private remotes = new Map<string, RemotePlayer>();

  private carTemplate:    THREE.Group | null = null;
  private walkerTemplate: THREE.Group | null = null;
  private walkerClips:    THREE.AnimationClip[] = [];
  private carYOffset    = 0;
  private modelsReady   = false;
  private pendingQueue:   QueuedPlayer[] = [];

  init(game: Game): void {
    this.scene = game.scene;

    const draco = new DRACOLoader();
    draco.setDecoderPath('/draco/');
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);

    const carPromise = new Promise<void>((resolve, reject) => {
      loader.load('/assets/models/car_optimized.glb', (gltf) => {
        const model = gltf.scene;
        model.scale.setScalar(CAR_MODEL_SCALE);
        model.rotation.y = Math.PI / 2;

        const wrapper = new THREE.Group();
        wrapper.add(model);

        const box = new THREE.Box3().setFromObject(wrapper);
        this.carYOffset = -box.min.y + CAR_GROUND_CLEARANCE;

        this.carTemplate = wrapper;
        resolve();
      }, undefined, reject);
    });

    const walkerPromise = new Promise<void>((resolve, reject) => {
      loader.load('delivery_guy_running_optimized.glb', (gltf) => {
        const model = gltf.scene;

        const box = new THREE.Box3().setFromObject(model);
        const modelHeight = box.max.y - box.min.y;
        const scale = PLAYER_HEIGHT / modelHeight;
        model.scale.setScalar(scale);

        const scaledMinY = box.min.y * scale;
        model.position.y = -scaledMinY;

        this.walkerTemplate = model;
        this.walkerClips    = gltf.animations;
        resolve();
      }, undefined, reject);
    });

    Promise.all([carPromise, walkerPromise]).then(() => {
      this.modelsReady = true;
      for (const q of this.pendingQueue) {
        this.spawnPlayer(q.id, q.carColor, q.shirtColor);
      }
      this.pendingQueue = [];
    });

    EventBus.on<NetWelcomeEvent>     (Events.NET_WELCOME,        this.onWelcome);
    EventBus.on<NetPlayerJoinedEvent>(Events.NET_PLAYER_JOINED,  this.onJoined);
    EventBus.on<NetPlayerLeftEvent>  (Events.NET_PLAYER_LEFT,    this.onLeft);
    EventBus.on<NetPlayerPosEvent>   (Events.NET_PLAYER_POS,     this.onPos);
  }

  private onWelcome = (data: NetWelcomeEvent): void => {
    for (const p of data.gameState.players) {
      const r = this.addPlayer(p.id, p.carColor, p.shirtColor);
      r.targetPos.set(p.x, p.y, p.z);
      r.displayPos.set(p.x, p.y, p.z);
      r.prevPos.set(p.x, p.y, p.z);
      r.targetHeading  = p.heading;
      r.displayHeading = p.heading;
      r.isInCar        = p.isInCar;
    }
  };

  private onJoined = (data: NetPlayerJoinedEvent): void => {
    this.addPlayer(data.playerId, data.carColor, data.shirtColor);
  };

  private onLeft = (data: NetPlayerLeftEvent): void => {
    const r = this.remotes.get(data.playerId);
    if (!r) return;
    this.scene.remove(r.carGroup, r.walkGroup);
    r.mixer?.stopAllAction();
    this.remotes.delete(data.playerId);
  };

  private onPos = (data: NetPlayerPosEvent): void => {
    const r = this.remotes.get(data.playerId);
    if (!r) return;
    r.targetPos.set(data.x, data.y, data.z);
    r.targetHeading = data.heading;
    r.isInCar       = data.isInCar;
  };

  private addPlayer(id: string, carColor: string, shirtColor: string): RemotePlayer {
    const existing = this.remotes.get(id);
    if (existing) return existing;

    if (!this.modelsReady) {
      this.pendingQueue.push({ id, carColor, shirtColor });
      // Return a placeholder so callers can set initial pos/heading
      return this.makePlaceholder(id);
    }

    return this.spawnPlayer(id, carColor, shirtColor);
  }

  private makePlaceholder(id: string): RemotePlayer {
    const placeholder: RemotePlayer = {
      targetPos:      new THREE.Vector3(),
      targetHeading:  0,
      isInCar:        false,
      displayPos:     new THREE.Vector3(),
      displayHeading: 0,
      carGroup:       new THREE.Group(),
      walkGroup:      new THREE.Group(),
      mixer:          null,
      runAction:      null,
      prevPos:        new THREE.Vector3(),
    };
    this.remotes.set(id, placeholder);
    return placeholder;
  }

  private spawnPlayer(id: string, carColor: string, shirtColor: string): RemotePlayer {
    // Merge pos/heading from placeholder if one was created before models loaded
    const placeholder = this.remotes.get(id);

    // --- Car ---
    const carClone = skeletonClone(this.carTemplate!) as THREE.Group;
    carClone.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
        mat.color          = new THREE.Color(carColor);
        mat.roughness      = CAR_BODY_ROUGHNESS;
        mat.metalness      = CAR_BODY_METALNESS;
        mat.envMapIntensity = CAR_ENV_INTENSITY;
        mat.emissive       = new THREE.Color(0x111111);
        mat.emissiveIntensity = 0.3;
        mesh.material = mat;
      }
    });
    const carGroup = new THREE.Group();
    carGroup.add(carClone);

    // --- Walker ---
    const walkClone = skeletonClone(this.walkerTemplate!) as THREE.Group;
    walkClone.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.castShadow = true;
        const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
        mat.color        = new THREE.Color(shirtColor);
        mat.transparent  = false;
        mat.depthWrite   = true;
        mat.alphaTest    = 0;
        mesh.material = mat;
      }
    });
    const walkGroup = new THREE.Group();
    walkGroup.add(walkClone);

    // --- Animation ---
    let mixer: THREE.AnimationMixer | null = null;
    let runAction: THREE.AnimationAction | null = null;
    if (this.walkerClips.length > 0) {
      mixer     = new THREE.AnimationMixer(walkClone);
      runAction = mixer.clipAction(this.walkerClips[0]);
      runAction.setLoop(THREE.LoopRepeat, Infinity);
    }

    this.scene.add(carGroup, walkGroup);

    const r: RemotePlayer = {
      targetPos:      placeholder ? placeholder.targetPos.clone()  : new THREE.Vector3(),
      targetHeading:  placeholder ? placeholder.targetHeading       : 0,
      isInCar:        placeholder ? placeholder.isInCar             : false,
      displayPos:     placeholder ? placeholder.displayPos.clone()  : new THREE.Vector3(),
      displayHeading: placeholder ? placeholder.displayHeading      : 0,
      prevPos:        placeholder ? placeholder.prevPos.clone()     : new THREE.Vector3(),
      carGroup,
      walkGroup,
      mixer,
      runAction,
    };
    this.remotes.set(id, r);
    return r;
  }

  /** Returns collision data for all remote players currently driving. */
  getCarColliders(): Array<{ id: string; box: THREE.Box3; pos: THREE.Vector3 }> {
    const result: Array<{ id: string; box: THREE.Box3; pos: THREE.Vector3 }> = [];
    for (const [id, r] of this.remotes) {
      if (!r.isInCar || !this.scene.children.includes(r.carGroup)) continue;
      const sinH = Math.abs(Math.sin(r.displayHeading));
      const cosH = Math.abs(Math.cos(r.displayHeading));
      const hwX = cosH * CAR_HALF_W + sinH * CAR_HALF_L;
      const hwZ = sinH * CAR_HALF_W + cosH * CAR_HALF_L;
      result.push({
        id,
        pos: r.displayPos,
        box: new THREE.Box3(
          new THREE.Vector3(r.displayPos.x - hwX, 0,          r.displayPos.z - hwZ),
          new THREE.Vector3(r.displayPos.x + hwX, CAR_HEIGHT, r.displayPos.z + hwZ),
        ),
      });
    }
    return result;
  }

  update(delta: number): void {
    const alpha = Math.min(1, LERP_K * delta);

    for (const r of this.remotes.values()) {
      // Skip placeholders (no scene objects yet)
      if (!this.scene.children.includes(r.carGroup)) continue;

      r.displayPos.lerp(r.targetPos, alpha);
      r.displayHeading = lerpAngle(r.displayHeading, r.targetHeading, alpha);

      r.carGroup.visible  =  r.isInCar;
      r.walkGroup.visible = !r.isInCar;

      const root = r.isInCar ? r.carGroup : r.walkGroup;
      root.position.copy(r.displayPos);
      if (r.isInCar) {
        root.position.y += this.carYOffset;
      }
      root.rotation.y = r.displayHeading;

      // Drive walk animation from movement speed
      if (!r.isInCar && r.mixer && r.runAction) {
        const speed = r.displayPos.distanceTo(r.prevPos) / delta;
        if (speed > MOVE_THRESHOLD) {
          if (!r.runAction.isRunning()) r.runAction.play();
        } else {
          if (r.runAction.isRunning()) r.runAction.stop();
        }
        r.mixer.update(delta);
      }

      r.prevPos.copy(r.displayPos);
    }
  }

  dispose(): void {
    EventBus.off(Events.NET_WELCOME,        this.onWelcome);
    EventBus.off(Events.NET_PLAYER_JOINED,  this.onJoined);
    EventBus.off(Events.NET_PLAYER_LEFT,    this.onLeft);
    EventBus.off(Events.NET_PLAYER_POS,     this.onPos);
    for (const r of this.remotes.values()) {
      this.scene.remove(r.carGroup, r.walkGroup);
      r.mixer?.stopAllAction();
    }
    this.remotes.clear();
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  const d = ((b - a) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
  return a + d * t;
}
