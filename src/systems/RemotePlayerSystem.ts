import * as THREE from 'three';
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
import { createCarDebugHelper } from '../utils/carCollider';
import { GAME_ASSETS, loadFreshGameGltf, loadGameGltf } from '../assets/AssetPreloader';

interface RemotePlayer {
  targetPos:      THREE.Vector3;
  targetHeading:  number;
  isInCar:        boolean;
  displayPos:     THREE.Vector3;
  displayHeading: number;
  carGroup:       THREE.Group;
  walkGroup:      THREE.Group;
  debugBox?:      THREE.LineSegments;
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
const DEBUG_REMOTE_CAR_COLLIDER = false;
const DEBUG_REMOTE_CAR_COLLIDER_COLOR = 0x0000ff;

export class RemotePlayerSystem implements GameSystem {
  readonly name = 'remote';

  private scene!: THREE.Scene;
  private remotes = new Map<string, RemotePlayer>();

  private carTemplate:    THREE.Group | null = null;
  private walkerTemplate: THREE.Group | null = null;
  private walkerClips:    THREE.AnimationClip[] = [];
  private carYOffset    = 0;
  private remoteHalfW   = CAR_HALF_W;
  private remoteHalfL   = CAR_HALF_L;
  private modelsReady   = false;
  private pendingQueue:   QueuedPlayer[] = [];

  init(game: Game): void {
    this.scene = game.scene;

    const carPromise = loadGameGltf(GAME_ASSETS.carModel).then((gltf) => {
      const model = skeletonClone(gltf.scene) as THREE.Group;
      model.scale.setScalar(CAR_MODEL_SCALE);
      model.rotation.y = Math.PI / 2;

      const wrapper = new THREE.Group();
      wrapper.add(model);

      const box = new THREE.Box3().setFromObject(wrapper);
      const size = new THREE.Vector3();
      box.getSize(size);
      this.carYOffset = -box.min.y + CAR_GROUND_CLEARANCE;
      this.remoteHalfW = size.x / 2;
      this.remoteHalfL = size.z / 2;

      this.carTemplate = wrapper;
    });

    const walkerPromise = loadFreshGameGltf(GAME_ASSETS.runnerModel).then((gltf) => {
      const model = gltf.scene;

      const box = new THREE.Box3().setFromObject(model);
      const modelHeight = box.max.y - box.min.y;
      const scale = PLAYER_HEIGHT / modelHeight;
      model.scale.setScalar(scale);

      const scaledMinY = box.min.y * scale;
      model.position.y = -scaledMinY;

      this.walkerTemplate = model;
      this.walkerClips    = gltf.animations;
    });

    Promise.all([carPromise, walkerPromise]).then(() => {
      this.modelsReady = true;
      for (const q of this.pendingQueue) {
        this.spawnPlayer(q.id, q.carColor, q.shirtColor);
      }
      this.pendingQueue = [];
    }).catch((error) => {
      console.error('Failed to load remote player models:', error);
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
    if (r.debugBox) {
      this.scene.remove(r.debugBox);
      r.debugBox.geometry.dispose();
      (r.debugBox.material as THREE.Material).dispose();
    }
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

    const debugBox = DEBUG_REMOTE_CAR_COLLIDER
      ? createCarDebugHelper(DEBUG_REMOTE_CAR_COLLIDER_COLOR)
      : undefined;
    if (debugBox) this.scene.add(debugBox);

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
      debugBox,
      mixer,
      runAction,
    };
    this.remotes.set(id, r);
    return r;
  }

  /** Returns collision data for all remote players currently driving. */
  getCarColliders(): Array<{ id: string; pos: THREE.Vector3; heading: number; halfW: number; halfL: number }> {
    const result: Array<{ id: string; pos: THREE.Vector3; heading: number; halfW: number; halfL: number }> = [];
    for (const [id, r] of this.remotes) {
      if (!r.isInCar || !this.scene.children.includes(r.carGroup)) continue;
      result.push({
        id,
        pos: r.displayPos,
        heading: r.displayHeading,
        halfW: this.remoteHalfW,
        halfL: this.remoteHalfL,
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

      if (r.debugBox) {
        r.debugBox.visible = r.isInCar;
        if (r.isInCar) {
          r.debugBox.scale.set(this.remoteHalfW, CAR_HEIGHT, this.remoteHalfL);
          r.debugBox.position.set(r.displayPos.x, 0, r.displayPos.z);
          r.debugBox.rotation.y = r.displayHeading;
        }
      }

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
      if (r.debugBox) {
        this.scene.remove(r.debugBox);
        r.debugBox.geometry.dispose();
        (r.debugBox.material as THREE.Material).dispose();
      }
      r.mixer?.stopAllAction();
    }
    this.remotes.clear();
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  const d = ((b - a) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
  return a + d * t;
}
