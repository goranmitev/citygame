import * as THREE from 'three';
import { Game, GameSystem } from '../core/Game';
import { StreetSegment } from '../city/CityLayout';
import { CarSystem } from './CarSystem';
import { EventBus, Events, CarHitEvent } from '../core/EventBus';

type PedState = 'walking' | 'flying' | 'fading' | 'done';

interface Pedestrian {
  group: THREE.Group;
  position: THREE.Vector3;
  target: THREE.Vector3;
  speed: number;
  currentSegmentIndex: number;
  state: PedState;
  vel: THREE.Vector3;
  angularVel: THREE.Vector3;
  opacity: number;
}

// Material pools — created once, shared across all pedestrians
const SKIN_COLORS  = [0xf5c5a0, 0xd4956a, 0x8d5524];
const SHIRT_COLORS = [0x3a6bbf, 0xbf3a3a, 0x3abf5a, 0x999999, 0xbf9a3a, 0xeeeeee, 0x6a3abf, 0xbf3a9a, 0xe07030];
const PANTS_COLORS = [0x2a2a4a, 0x3a3a2a, 0x4a2a2a, 0x1a1a1a, 0x5a4a2a, 0x2a4a3a];

const skinMats  = SKIN_COLORS.map(c  => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }));
const shirtMats = SHIRT_COLORS.map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 }));
const pantsMats = PANTS_COLORS.map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 }));

// Shared leg geometry — same shape for every pedestrian
const _legGeo = new THREE.BoxGeometry(0.14, 0.90, 0.14);

// Knock physics — matches TrafficSystem knockables
const GRAVITY        = -18;
const BOUNCE_DAMPING = 0.35;
const SPIN_BASE      = 6.0;
// Pedestrian collision box half-extents (XZ) and height
const PED_HALF   = 0.3;
const PED_HEIGHT = 1.6;

export class PedestrianSystem implements GameSystem {
  readonly name = 'pedestrian';

  private scene!: THREE.Scene;
  private car!: CarSystem;
  private sidewalks: StreetSegment[] = [];
  private pedestrians: Pedestrian[] = [];
  private maxPedestrians = 60;
  private spawnInterval = 1.5;
  private timer = 0;

  // Reusable objects — avoids per-frame allocation
  private _dir    = new THREE.Vector3();
  private _pedBox = new THREE.Box3();

  init(game: Game): void {
    this.scene = game.scene;
    this.car   = game.getSystem<CarSystem>('car')!;
  }

  setSidewalks(sidewalks: StreetSegment[]): void {
    this.sidewalks = sidewalks;
  }

  addColliders(_boxes: THREE.Box3[]): void {}
  clearColliders(): void {}

  dispose(): void {
    for (const p of this.pedestrians) {
      this.scene.remove(p.group);
      p.group.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          // Only dispose if this is a cloned material (set on hit)
          if ((obj.material as THREE.MeshStandardMaterial).userData['cloned']) {
            (obj.material as THREE.Material).dispose();
          }
        }
      });
    }
    this.pedestrians.length = 0;
  }

  update(delta: number): void {
    if (this.sidewalks.length === 0) return;

    this.timer += delta;
    if (this.timer >= this.spawnInterval && this.pedestrians.length < this.maxPedestrians) {
      this.spawnPedestrian();
      this.timer = 0;
    }

    const carBox = this.car.getWorldBox();
    const carVel = this.car.getVelocity();

    for (let i = this.pedestrians.length - 1; i >= 0; i--) {
      const p = this.pedestrians[i];

      if (p.state === 'walking') {
        // Broad phase — skip if clearly out of range
        const dx = p.position.x - this.car.position.x;
        const dz = p.position.z - this.car.position.z;
        if (dx * dx + dz * dz < 36) {
          this._pedBox.min.set(p.position.x - PED_HALF, 0,          p.position.z - PED_HALF);
          this._pedBox.max.set(p.position.x + PED_HALF, PED_HEIGHT, p.position.z + PED_HALF);

          if (carBox.intersectsBox(this._pedBox)) {
            this.knockPedestrian(p, carVel);
          }
        }

        if (p.state === 'walking') {
          this.updateWalking(p, delta);
        }

      } else if (p.state === 'flying') {
        p.vel.y += GRAVITY * delta;

        p.group.position.x += p.vel.x * delta;
        p.group.position.y += p.vel.y * delta;
        p.group.position.z += p.vel.z * delta;

        p.group.rotation.x += p.angularVel.x * delta;
        p.group.rotation.y += p.angularVel.y * delta;
        p.group.rotation.z += p.angularVel.z * delta;

        if (p.group.position.y <= 0) {
          p.group.position.y = 0;
          if (Math.abs(p.vel.y) > 0.5) {
            p.vel.y *= -BOUNCE_DAMPING;
            p.vel.x *= 0.7;
            p.vel.z *= 0.7;
            p.angularVel.multiplyScalar(0.6);
          } else {
            p.opacity = 1;
            p.state = 'fading';
          }
        }

      } else if (p.state === 'fading') {
        p.opacity -= delta / 1.2;
        if (p.opacity <= 0) {
          this.scene.remove(p.group);
          p.group.traverse((obj) => {
            if (obj instanceof THREE.Mesh) {
              obj.geometry.dispose();
              if ((obj.material as THREE.MeshStandardMaterial).userData['cloned']) {
                (obj.material as THREE.Material).dispose();
              }
            }
          });
          p.state = 'done';
          this.pedestrians.splice(i, 1);
        } else {
          p.group.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              (child.material as THREE.MeshStandardMaterial).opacity = p.opacity;
            }
          });
        }
      }
      // 'done' never reached here since we splice immediately
    }
  }

  private knockPedestrian(p: Pedestrian, carVel: THREE.Vector3): void {
    p.state = 'flying';
    EventBus.emit<CarHitEvent>(Events.CAR_HIT_PED, { speed: carVel.length() });

    // Clone pooled materials so we can set them transparent independently
    p.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        const cloned = (obj.material as THREE.MeshStandardMaterial).clone();
        cloned.transparent = true;
        cloned.userData['cloned'] = true;
        obj.material = cloned;
      }
    });

    const speed = carVel.length();
    p.vel.set(
      carVel.x * 0.7 + (Math.random() - 0.5) * 3,
      speed * 0.5 + 4,
      carVel.z * 0.7 + (Math.random() - 0.5) * 3,
    );
    p.angularVel.set(
      (Math.random() - 0.5) * SPIN_BASE,
      (Math.random() - 0.5) * SPIN_BASE * 0.5,
      (Math.random() - 0.5) * SPIN_BASE,
    );
  }

  private updateWalking(p: Pedestrian, delta: number): void {
    this._dir.subVectors(p.target, p.position);
    const distanceToTarget = this._dir.length();

    if (distanceToTarget < 0.5) {
      this.pickNewTarget(p);
      return;
    }

    this._dir.normalize();
    const moveStep = p.speed * delta;
    p.position.x += this._dir.x * moveStep;
    p.position.z += this._dir.z * moveStep;
    p.group.position.copy(p.position);

    const targetRotation = Math.atan2(this._dir.x, this._dir.z);
    let diff = targetRotation - p.group.rotation.y;
    while (diff > Math.PI)  diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    p.group.rotation.y += diff * 0.1;
  }

  private spawnPedestrian(): void {
    if (this.sidewalks.length === 0) return;

    const segmentIndex = Math.floor(Math.random() * this.sidewalks.length);
    const segment = this.sidewalks[segmentIndex];

    const x = segment.x + Math.random() * segment.width;
    const z = segment.z + Math.random() * segment.depth;
    const pos = new THREE.Vector3(x, 0.15, z);

    const targetX = segment.x + Math.random() * segment.width;
    const targetZ = segment.z + Math.random() * segment.depth;
    const target = new THREE.Vector3(targetX, 0.15, targetZ);

    const group = this.createPedestrianMesh();
    group.position.copy(pos);
    this.scene.add(group);

    this.pedestrians.push({
      group,
      position: pos,
      target,
      speed: 0.8 + Math.random() * 0.7,
      currentSegmentIndex: segmentIndex,
      state: 'walking',
      vel: new THREE.Vector3(),
      angularVel: new THREE.Vector3(),
      opacity: 1,
    });
  }

  private pickNewTarget(p: Pedestrian): void {
    const segment = this.sidewalks[p.currentSegmentIndex];
    const targetX = segment.x + Math.random() * segment.width;
    const targetZ = segment.z + Math.random() * segment.depth;
    p.target.set(targetX, 0.15, targetZ);

    if (Math.random() < 0.3 && this.sidewalks.length > 1) {
      p.currentSegmentIndex = (p.currentSegmentIndex + 1) % this.sidewalks.length;
    }
  }

  private createPedestrianMesh(): THREE.Group {
    const group = new THREE.Group();

    const skinMat  = skinMats[Math.floor(Math.random() * skinMats.length)];
    const shirtMat = shirtMats[Math.floor(Math.random() * shirtMats.length)];
    const pantsMat = pantsMats[Math.floor(Math.random() * pantsMats.length)];

    group.scale.setScalar(0.90 + Math.random() * 0.20);

    const legL = new THREE.Mesh(_legGeo, pantsMat);
    legL.position.set(-0.09, 0.45, 0);
    group.add(legL);

    const legR = new THREE.Mesh(_legGeo, pantsMat);
    legR.position.set(0.09, 0.45, 0);
    group.add(legR);

    const torsoGeo = new THREE.BoxGeometry(0.32, 0.55, 0.20);
    const torso = new THREE.Mesh(torsoGeo, shirtMat);
    torso.position.set(0, 1.175, 0);
    group.add(torso);

    const headGeo = new THREE.BoxGeometry(0.24, 0.28, 0.24);
    const head = new THREE.Mesh(headGeo, skinMat);
    head.position.set(0, 1.59, 0);
    group.add(head);

    return group;
  }
}
