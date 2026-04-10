import * as THREE from 'three';
import { Game, GameSystem } from '../core/Game';
import { StreetSegment } from '../city/CityLayout';

interface Pedestrian {
  group: THREE.Group;
  position: THREE.Vector3;
  target: THREE.Vector3;
  speed: number;
  currentSegmentIndex: number;
}

export class PedestrianSystem implements GameSystem {
  readonly name = 'pedestrian';

  private scene!: THREE.Scene;
  private sidewalks: StreetSegment[] = [];
  private pedestrians: Pedestrian[] = [];
  private maxPedestrians = 60;
  private spawnInterval = 1.5;
  private timer = 0;

  init(game: Game): void {
    this.scene = game.scene;
  }

  setSidewalks(sidewalks: StreetSegment[]): void {
    this.sidewalks = sidewalks;
  }

  addColliders(boxes: THREE.Box3[]): void {}
  clearColliders(): void {}

  update(delta: number): void {
    if (this.sidewalks.length === 0) return;

    this.timer += delta;
    if (this.timer >= this.spawnInterval && this.pedestrians.length < this.maxPedestrians) {
      this.spawnPedestrian();
      this.timer = 0;
    }

    for (let i = this.pedestrians.length - 1; i >= 0; i--) {
      const p = this.pedestrians[i];
      this.updatePedestrian(p, delta);
    }

  }

  private spawnPedestrian(): void {
    if (this.sidewalks.length === 0) return;

    const segmentIndex = Math.floor(Math.random() * this.sidewalks.length);
    const segment = this.sidewalks[segmentIndex];

    const x = segment.x + Math.random() * segment.width;
    const z = segment.z + Math.random() * segment.depth;
    const pos = new THREE.Vector3(x, 0.15, z); // 0.15 = sidewalk surface height

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
      currentSegmentIndex: segmentIndex
    });
  }

  private updatePedestrian(p: Pedestrian, delta: number): void {
    const direction = new THREE.Vector3().subVectors(p.target, p.position);
    const distanceToTarget = direction.length();

    if (distanceToTarget < 0.5) {
      this.pickNewTarget(p);
      return;
    }

    direction.normalize();
    const moveStep = p.speed * delta;
    p.position.x += direction.x * moveStep;
    p.position.z += direction.z * moveStep;
    p.group.position.copy(p.position);

    const targetRotation = Math.atan2(direction.x, direction.z);
    // Simple angular interpolation to avoid lerpAngle issue
    let diff = targetRotation - p.group.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    p.group.rotation.y += diff * 0.1;
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

    // Randomise appearance
    const skinTones  = [0xf5c5a0, 0xd4956a, 0x8d5524];
    const shirtColors = [0x3a6bbf, 0xbf3a3a, 0x3abf5a, 0x999999, 0xbf9a3a, 0xeeeeee, 0x6a3abf, 0xbf3a9a, 0xe07030];
    const pantsColors = [0x2a2a4a, 0x3a3a2a, 0x4a2a2a, 0x1a1a1a, 0x5a4a2a, 0x2a4a3a];

    const skinMat  = new THREE.MeshStandardMaterial({ color: skinTones[Math.floor(Math.random() * skinTones.length)], roughness: 0.8 });
    const shirtMat = new THREE.MeshStandardMaterial({ color: shirtColors[Math.floor(Math.random() * shirtColors.length)], roughness: 0.9 });
    const pantsMat = new THREE.MeshStandardMaterial({ color: pantsColors[Math.floor(Math.random() * pantsColors.length)], roughness: 0.9 });

    // Uniform height scale — feet stay at y=0, character grows upward.
    // Base mesh is designed at PLAYER_HEIGHT (~1.75); scale varies ±10%.
    group.scale.setScalar(0.90 + Math.random() * 0.20);

    // Legs — two boxes, bottoms flush at y=0
    const legGeo = new THREE.BoxGeometry(0.14, 0.90, 0.14);
    const legL = new THREE.Mesh(legGeo, pantsMat);
    legL.position.set(-0.09, 0.45, 0);
    group.add(legL);

    const legR = new THREE.Mesh(legGeo.clone(), pantsMat);
    legR.position.set(0.09, 0.45, 0);
    group.add(legR);

    // Torso sits directly on top of legs (y=0.90)
    const torsoGeo = new THREE.BoxGeometry(0.32, 0.55, 0.20);
    const torso = new THREE.Mesh(torsoGeo, shirtMat);
    torso.position.set(0, 1.175, 0);
    group.add(torso);

    // Head sits on top of torso (y=1.45)
    const headGeo = new THREE.BoxGeometry(0.24, 0.28, 0.24);
    const head = new THREE.Mesh(headGeo, skinMat);
    head.position.set(0, 1.59, 0);
    group.add(head);

    return group;
  }
}
