import * as THREE from 'three';
import { Game, GameSystem } from '../core/Game';
import {
  EventBus, Events,
  NetWelcomeEvent, NetPlayerJoinedEvent, NetPlayerLeftEvent, NetPlayerPosEvent,
} from '../core/EventBus';

interface RemotePlayer {
  targetPos:     THREE.Vector3;
  targetHeading: number;
  isInCar:       boolean;
  displayPos:    THREE.Vector3;
  displayHeading:number;
  carGroup:      THREE.Group;
  walkGroup:     THREE.Group;
}

const LERP_K = 10;

export class RemotePlayerSystem implements GameSystem {
  readonly name = 'remote';

  private scene!: THREE.Scene;
  private remotes = new Map<string, RemotePlayer>();

  init(game: Game): void {
    this.scene = game.scene;
    EventBus.on<NetWelcomeEvent>    (Events.NET_WELCOME,       this.onWelcome);
    EventBus.on<NetPlayerJoinedEvent>(Events.NET_PLAYER_JOINED, this.onJoined);
    EventBus.on<NetPlayerLeftEvent> (Events.NET_PLAYER_LEFT,   this.onLeft);
    EventBus.on<NetPlayerPosEvent>  (Events.NET_PLAYER_POS,    this.onPos);
  }

  private onWelcome = (data: NetWelcomeEvent): void => {
    for (const p of data.gameState.players) {
      const r = this.addPlayer(p.id, p.color);
      r.targetPos.set(p.x, p.y, p.z);
      r.displayPos.set(p.x, p.y, p.z);
      r.targetHeading  = p.heading;
      r.displayHeading = p.heading;
      r.isInCar        = p.isInCar;
    }
  };

  private onJoined = (data: NetPlayerJoinedEvent): void => {
    this.addPlayer(data.playerId, data.color);
  };

  private onLeft = (data: NetPlayerLeftEvent): void => {
    const r = this.remotes.get(data.playerId);
    if (!r) return;
    this.scene.remove(r.carGroup, r.walkGroup);
    this.remotes.delete(data.playerId);
  };

  private onPos = (data: NetPlayerPosEvent): void => {
    const r = this.remotes.get(data.playerId);
    if (!r) return;
    r.targetPos.set(data.x, data.y, data.z);
    r.targetHeading = data.heading;
    r.isInCar       = data.isInCar;
  };

  private addPlayer(id: string, color: string): RemotePlayer {
    const existing = this.remotes.get(id);
    if (existing) return existing;

    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.3 });

    // Car proxy: body block + smaller roof block
    const carGroup = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.0, 5.0), mat);
    body.position.y = 0.5;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.75, 2.6), mat);
    roof.position.y = 1.38;
    carGroup.add(body, roof);

    // Walker proxy: capsule, feet at y=0
    const walkGroup = new THREE.Group();
    const capsule = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.1, 4, 8), mat);
    capsule.position.y = 0.95;
    walkGroup.add(capsule);

    this.scene.add(carGroup, walkGroup);

    const r: RemotePlayer = {
      targetPos: new THREE.Vector3(),
      targetHeading: 0,
      isInCar: false,
      displayPos: new THREE.Vector3(),
      displayHeading: 0,
      carGroup,
      walkGroup,
    };
    this.remotes.set(id, r);
    return r;
  }

  update(delta: number): void {
    const alpha = Math.min(1, LERP_K * delta);
    for (const r of this.remotes.values()) {
      r.displayPos.lerp(r.targetPos, alpha);
      r.displayHeading = lerpAngle(r.displayHeading, r.targetHeading, alpha);

      r.carGroup.visible  =  r.isInCar;
      r.walkGroup.visible = !r.isInCar;

      const root = r.isInCar ? r.carGroup : r.walkGroup;
      root.position.copy(r.displayPos);
      root.rotation.y = r.displayHeading;
    }
  }

  dispose(): void {
    EventBus.off(Events.NET_WELCOME,       this.onWelcome);
    EventBus.off(Events.NET_PLAYER_JOINED, this.onJoined);
    EventBus.off(Events.NET_PLAYER_LEFT,   this.onLeft);
    EventBus.off(Events.NET_PLAYER_POS,    this.onPos);
    for (const r of this.remotes.values()) {
      this.scene.remove(r.carGroup, r.walkGroup);
    }
    this.remotes.clear();
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = ((b - a) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
  return a + d * t;
}
