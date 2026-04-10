import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Game, GameSystem } from '../core/Game';
import { WalkSystem } from '../systems/WalkSystem';
import { CarSystem } from '../systems/CarSystem';
import { PedestrianSystem } from '../systems/PedestrianSystem';
import { generateCityLayout, CityLayoutData } from './CityLayout';
import { createBuckets, pushBuilding, getMaterials } from './BuildingFactory';
import { buildPark, getParkMaterials, mergeParkGeos } from './ParkFactory';
import { ROAD_COLOR, SIDEWALK_COLOR, GROUND_COLOR, MARKING_COLOR } from '../constants';

/**
 * Assembles the city using merged geometry for maximum draw-call efficiency.
 * The entire city becomes ~8 meshes total regardless of building count.
 */
export class CityBuilder implements GameSystem {
  readonly name = 'city';

  layout!: CityLayoutData;

  constructor(
    private gridX = 12,
    private gridZ = 12,
    private seed = 42,
  ) {}

  init(game: Game): void {
    this.layout = generateCityLayout(this.gridX, this.gridZ, this.seed);

    const { scene } = game;
    const colliders: THREE.Box3[] = [];

    // --- Ground plane (1 mesh) ---
    this.createGround(scene);

    // --- Roads: merge all into 1 mesh ---
    this.createRoads(scene);

    // --- Sidewalks: merge all into 1 mesh ---
    this.createSidewalks(scene);

    // --- Buildings and parks ---
    const buckets = createBuckets();
    let plotSeed = this.seed * 1000;

    // Accumulate park geometry across all parks, merge into shared meshes
    const parkGrass: THREE.BufferGeometry[] = [];
    const parkPaths: THREE.BufferGeometry[] = [];
    const parkTrunks: THREE.BufferGeometry[] = [];
    const parkLeaves: THREE.BufferGeometry[] = [];
    const parkBenches: THREE.BufferGeometry[] = [];

    for (const block of this.layout.blocks) {
      if (block.isPark) {
        const pg = buildPark(block, plotSeed++);
        parkGrass.push(...pg.grassGeos);
        parkPaths.push(...pg.pathGeos);
        parkTrunks.push(...pg.trunkGeos);
        parkLeaves.push(...pg.leafGeos);
        parkBenches.push(...pg.benchGeos);
        for (const col of pg.treeColliders) colliders.push(col);
      } else {
        for (const plot of block.plots) {
          const collider = pushBuilding(buckets, plot, plotSeed++);
          colliders.push(collider);
        }
      }
    }

    const mats = getMaterials();

    this.mergeBucket(scene, buckets.walls, mats.wall, true);
    this.mergeBucket(scene, buckets.groundFloors, mats.groundFloor, true);
    this.mergeBucket(scene, buckets.windows, mats.window, false);
    this.mergeBucket(scene, buckets.windowFrames, mats.windowFrame, false);
    this.mergeBucket(scene, buckets.roofs, mats.roof, true);

    const pm = getParkMaterials();
    mergeParkGeos(scene, parkGrass, pm.grass, false);
    mergeParkGeos(scene, parkPaths, pm.path, false);
    mergeParkGeos(scene, parkTrunks, pm.trunk, true);
    mergeParkGeos(scene, parkLeaves, pm.leaves, true);
    mergeParkGeos(scene, parkBenches, pm.bench, true);

    // --- Register colliders and set spawn positions ---
    const player = game.getSystem<WalkSystem>('player');
    const car = game.getSystem<CarSystem>('car');
    const pedestrian = game.getSystem<PedestrianSystem>('pedestrian');

    // Always wire up pedestrian sidewalks — independent of player system
    if (pedestrian) {
      pedestrian.setSidewalks(this.layout.sidewalks);
    }

    if (player) {
      player.addColliders(colliders);
      // Spawn in the center of the first horizontal street (width > depth = runs along X)
      const firstHStreet = this.layout.streets.find((s) => s.width > s.depth);
      const spawnX = firstHStreet ? firstHStreet.x + firstHStreet.width / 2 : this.layout.totalWidth / 2;
      const spawnZ = firstHStreet ? firstHStreet.z + firstHStreet.depth / 2 : this.layout.totalDepth / 2;

      if (car) {
        car.position.set(spawnX + 4, 0, spawnZ);
        car.snapToSpawn();
      }

      player.position.set(spawnX, 0, spawnZ);
      player.snapToSpawn();
    }
  }

  /** Merge an array of geometries into a single mesh and add to scene. */
  private mergeBucket(
    scene: THREE.Scene,
    geos: THREE.BufferGeometry[],
    material: THREE.Material,
    shadows: boolean,
  ): void {
    if (geos.length === 0) return;
    const normalized = geos.map((g) => g.index ? g.toNonIndexed() : g);
    const merged = mergeGeometries(normalized, false);
    if (!merged) return;
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    scene.add(mesh);

    // Dispose source and any newly created non-indexed copies
    for (let i = 0; i < geos.length; i++) {
      if (normalized[i] !== geos[i]) normalized[i].dispose();
      geos[i].dispose();
    }
    geos.length = 0;
  }

  private createGround(scene: THREE.Scene): void {
    const geo = new THREE.PlaneGeometry(
      this.layout.totalWidth + 40,
      this.layout.totalDepth + 40,
    );
    const mat = new THREE.MeshStandardMaterial({ color: GROUND_COLOR, roughness: 0.95 });
    const ground = new THREE.Mesh(geo, mat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(this.layout.totalWidth / 2, -0.05, this.layout.totalDepth / 2);
    ground.receiveShadow = true;
    scene.add(ground);
  }

  private createRoads(scene: THREE.Scene): void {
    const roadGeos: THREE.BufferGeometry[] = [];
    const markingGeos: THREE.BufferGeometry[] = [];

    for (const street of this.layout.streets) {
      const geo = new THREE.PlaneGeometry(street.width, street.depth);
      const m = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
      m.setPosition(street.x + street.width / 2, 0.01, street.z + street.depth / 2);
      geo.applyMatrix4(m);
      roadGeos.push(geo);

      // Center dashed line
      const isH = street.width > street.depth;
      const length = isH ? street.width : street.depth;
      const dashLen = 2;
      const gap = 3;

      for (let d = 0; d < length; d += dashLen + gap) {
        const dLen = Math.min(dashLen, length - d);
        const dGeo = new THREE.PlaneGeometry(
          isH ? dLen : 0.15,
          isH ? 0.15 : dLen,
        );
        const dm = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
        if (isH) {
          dm.setPosition(street.x + d + dLen / 2, 0.02, street.z + street.depth / 2);
        } else {
          dm.setPosition(street.x + street.width / 2, 0.02, street.z + d + dLen / 2);
        }
        dGeo.applyMatrix4(dm);
        markingGeos.push(dGeo);
      }
    }

    // Merge roads
    const roadMerged = mergeGeometries(roadGeos.map((g) => g.index ? g.toNonIndexed() : g), false);
    if (roadMerged) {
      const mesh = new THREE.Mesh(roadMerged, new THREE.MeshStandardMaterial({ color: ROAD_COLOR, roughness: 0.85 }));
      mesh.receiveShadow = true;
      scene.add(mesh);
    }
    for (const g of roadGeos) g.dispose();

    // Merge markings
    const markingMerged = mergeGeometries(markingGeos.map((g) => g.index ? g.toNonIndexed() : g), false);
    if (markingMerged) {
      scene.add(new THREE.Mesh(markingMerged, new THREE.MeshStandardMaterial({ color: MARKING_COLOR, roughness: 0.5 })));
    }
    for (const g of markingGeos) g.dispose();
  }

  private createSidewalks(scene: THREE.Scene): void {
    const geos: THREE.BufferGeometry[] = [];
    const height = 0.15;

    for (const sw of this.layout.sidewalks) {
      const geo = new THREE.BoxGeometry(sw.width, height, sw.depth);
      const m = new THREE.Matrix4().makeTranslation(
        sw.x + sw.width / 2,
        height / 2,
        sw.z + sw.depth / 2,
      );
      geo.applyMatrix4(m);
      geos.push(geo);
    }

    const merged = mergeGeometries(geos.map((g) => g.index ? g.toNonIndexed() : g), false);
    if (merged) {
      const mesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ color: SIDEWALK_COLOR, roughness: 0.8 }));
      mesh.receiveShadow = true;
      scene.add(mesh);
    }
    for (const g of geos) g.dispose();
  }
}
