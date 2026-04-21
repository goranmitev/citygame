import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Game, GameSystem } from '../core/Game';
import { WalkSystem } from '../systems/WalkSystem';
import { CarSystem } from '../systems/CarSystem';
import { PedestrianSystem } from '../systems/PedestrianSystem';
import { generateCityLayout, CityLayoutData } from './CityLayout';
import { ATLAS_TILE_COUNT, createBuckets, pushBuilding, getMaterials, makeAtlasMaterial, UV_WORLD_SCALE } from './BuildingFactory';
import {
  SIDEWALK_HEIGHT, CITY_WALL_HEIGHT, CITY_WALL_THICK,
  ZEBRA_STRIPE_W, ZEBRA_STRIPE_GAP, ZEBRA_N_STRIPES, ZEBRA_Y,
} from '../constants';
import { buildPark, getParkMaterials, mergeParkGeos } from './ParkFactory';

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

    // --- Zebra crossings at intersections ---
    this.createZebraCrossings(scene);

    // --- Dead-end walls at city edges ---
    this.createDeadEndWalls(scene);

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

    for (let tile = 0; tile < ATLAS_TILE_COUNT; tile++) {
      this.mergeBucket(scene, buckets.walls[tile], mats.wall[tile], true);
      // this.mergeBucket(scene, buckets.groundFloors[tile], mats.groundFloor[tile], true);
      this.mergeBucket(scene, buckets.roofs[tile], mats.roof[tile], true);
    }
    this.mergeBucket(scene, buckets.windows, mats.window, false);
    this.mergeBucket(scene, buckets.windowFrames, mats.windowFrame, false);

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
      player.setSidewalks(this.layout.sidewalks);
      player.setCityBounds(0, this.layout.totalWidth, 0, this.layout.totalDepth);
      // Spawn in the center of the first vertical street (depth > width = runs along Z)
      // heading=0 drives in +Z which feels like "forward" from the player's camera perspective
      const firstVStreet = this.layout.streets.find((s) => s.depth > s.width);
      const spawnX = firstVStreet ? firstVStreet.x + firstVStreet.width / 2 : this.layout.totalWidth / 2;
      const spawnZ = firstVStreet ? firstVStreet.z + firstVStreet.depth / 2 : this.layout.totalDepth / 2;

      if (car) {
        car.setCityBounds(0, this.layout.totalWidth, 0, this.layout.totalDepth);
        car.setSpawn(spawnX, 0, spawnZ, 0);
        car.resetToSpawn();
      }

      // Spawn player just outside the driver's door, clear of the car's collision box
      const ep = car ? car.entryPoint() : null;
      player.setSpawn(ep ? ep.x : spawnX, 0, ep ? ep.z : spawnZ, 0);
      player.resetToSpawn();
    }
  }

  /** Returns 4 spawn positions spread across the city street grid (one per quadrant). */
  getSpawnPositions(): Array<{ x: number; z: number; heading: number }> {
    const vStreets = this.layout.streets
      .filter(s => s.depth > s.width)
      .sort((a, b) => (a.x + a.width / 2) - (b.x + b.width / 2));

    if (vStreets.length === 0) {
      const cx = this.layout.totalWidth / 2;
      const cz = this.layout.totalDepth / 2;
      return [
        { x: cx - 60, z: cz - 60, heading: 0 },
        { x: cx + 60, z: cz - 60, heading: 0 },
        { x: cx + 60, z: cz + 60, heading: Math.PI },
        { x: cx - 60, z: cz + 60, heading: Math.PI },
      ];
    }

    const midX  = this.layout.totalWidth  / 2;
    const q1z   = this.layout.totalDepth  * 0.25;
    const q3z   = this.layout.totalDepth  * 0.75;
    const left  = vStreets.filter(s => s.x + s.width / 2 <  midX);
    const right = vStreets.filter(s => s.x + s.width / 2 >= midX);

    const pick = (group: typeof vStreets, zOff: number, heading: number) => {
      const s = group.length > 0 ? group[Math.floor(group.length / 2)] : vStreets[0];
      return { x: s.x + s.width / 2, z: s.z + zOff, heading };
    };

    return [
      pick(left,  q1z, 0),          // spawn 0: NW  (default, also used in singleplayer)
      pick(right, q1z, Math.PI),     // spawn 1: NE
      pick(right, q3z, Math.PI),     // spawn 2: SE
      pick(left,  q3z, 0),           // spawn 3: SW
    ];
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
    mesh.matrixAutoUpdate = false;  // geometry has baked-in transforms; matrix is identity
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
      this.layout.totalWidth,
      this.layout.totalDepth,
    );
    const texture = new THREE.TextureLoader().load('/textures/ground-atlas.webp');
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    // Select bottom-left quadrant (grass) from the 2x2 atlas
    texture.repeat.set((this.layout.totalWidth + 40) / 40, (this.layout.totalDepth + 40) / 40);
    texture.offset.set(0, 1);
    const mat = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.95 });
    const ground = new THREE.Mesh(geo, mat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(this.layout.totalWidth / 2, -0.05, this.layout.totalDepth / 2);
    ground.receiveShadow = true;
    ground.updateMatrix();
    ground.matrixAutoUpdate = false;
    scene.add(ground);

  }
  private createRoads(scene: THREE.Scene): void {
    const roadGeos: THREE.BufferGeometry[] = [];

    for (const street of this.layout.streets) {
      const geo = new THREE.PlaneGeometry(street.width, street.depth);
      // Scale UVs to world size for atlas tiling
      const ruv = geo.getAttribute('uv');
      for (let i = 0; i < ruv.count; i++) {
        ruv.setXY(i, ruv.getX(i) * street.width / UV_WORLD_SCALE, ruv.getY(i) * street.depth / UV_WORLD_SCALE);
      }
      ruv.needsUpdate = true;
      // Horizontal roads sit slightly above vertical roads to avoid z-fighting at intersections
      const isHorizontal = street.width > street.depth;
      const y = isHorizontal ? 0.012 : 0.008;
      const m = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
      m.setPosition(street.x + street.width / 2, y, street.z + street.depth / 2);
      geo.applyMatrix4(m);
      roadGeos.push(geo);
    }

    // Merge roads — use ground atlas tile (0,0) image = asphalt
    const roadMerged = mergeGeometries(roadGeos.map((g) => g.index ? g.toNonIndexed() : g), false);
    if (roadMerged) {
      const groundMap = new THREE.TextureLoader().load('/textures/ground-atlas.webp');
      groundMap.wrapS = groundMap.wrapT = THREE.ClampToEdgeWrapping;
      const roadMat = makeAtlasMaterial(groundMap, 0, 3, 0.85);
      const mesh = new THREE.Mesh(roadMerged, roadMat);
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      scene.add(mesh);
    }
    for (const g of roadGeos) g.dispose();
  }

  private createZebraCrossings(scene: THREE.Scene): void {
    const stripeGeos: THREE.BufferGeometry[] = [];
    const STRIPE_W = ZEBRA_STRIPE_W;
    const STRIPE_GAP = ZEBRA_STRIPE_GAP;
    const N_STRIPES = ZEBRA_N_STRIPES;
    const Y = ZEBRA_Y;

    const hStreets = this.layout.streets.filter(s => s.width > s.depth);
    const vStreets = this.layout.streets.filter(s => s.depth >= s.width);

    const addStripe = (cx: number, cz: number, w: number, d: number) => {
      const geo = new THREE.PlaneGeometry(w, d);
      const m = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
      m.setPosition(cx, Y, cz);
      geo.applyMatrix4(m);
      stripeGeos.push(geo);
    };

    // Crossing depth in the direction away from the intersection
    const CROSSING_D = N_STRIPES * STRIPE_W + (N_STRIPES - 1) * STRIPE_GAP;

    const { totalWidth, totalDepth } = this.layout;

    for (const h of hStreets) {
      for (const v of vStreets) {
        const ix0 = v.x;
        const ix1 = v.x + v.width;
        const iz0 = h.z;
        const iz1 = h.z + h.depth;

        // South crossing: only when there is city south of this road
        if (iz1 < totalDepth) {
          const southCenterZ = iz1 + CROSSING_D / 2;
          for (let k = 0; ; k++) {
            const x = ix0 + k * (STRIPE_W + STRIPE_GAP) + STRIPE_W / 2;
            if (x - STRIPE_W / 2 >= ix1) break;
            const stripeW = Math.min(STRIPE_W, ix1 - (x - STRIPE_W / 2));
            addStripe(x - STRIPE_W / 2 + stripeW / 2, southCenterZ, stripeW, CROSSING_D);
          }
        }

        // East crossing: only when there is city east of this road
        if (ix1 < totalWidth) {
          const eastCenterX = ix1 + CROSSING_D / 2;
          for (let k = 0; ; k++) {
            const z = iz0 + k * (STRIPE_W + STRIPE_GAP) + STRIPE_W / 2;
            if (z - STRIPE_W / 2 >= iz1) break;
            const stripeD = Math.min(STRIPE_W, iz1 - (z - STRIPE_W / 2));
            addStripe(eastCenterX, z - STRIPE_W / 2 + stripeD / 2, CROSSING_D, stripeD);
          }
        }
      }
    }

    if (stripeGeos.length === 0) return;
    const normalized = stripeGeos.map(g => g.index ? g.toNonIndexed() : g);
    const merged = mergeGeometries(normalized, false);
    if (merged) {
      const mesh = new THREE.Mesh(
        merged,
        new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.4 }),
      );
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      scene.add(mesh);
    }
    for (let i = 0; i < stripeGeos.length; i++) {
      if (normalized[i] !== stripeGeos[i]) normalized[i].dispose();
      stripeGeos[i].dispose();
    }
  }

  /** Place a continuous perimeter wall around the entire city. */
  private createDeadEndWalls(scene: THREE.Scene): void {
    const WALL_HEIGHT = CITY_WALL_HEIGHT;
    const WALL_THICK = CITY_WALL_THICK;
    const geos: THREE.BufferGeometry[] = [];
    const { totalWidth, totalDepth } = this.layout;

    // Four walls: north (z=0), south (z=totalDepth), west (x=0), east (x=totalWidth)
    const OVR = WALL_THICK;

    const scaleUVs = (geo: THREE.BoxGeometry, w: number, h: number, d: number) => {
      // Scale UVs to world size so the atlas fract() shader tiles properly.
      // BoxGeometry faces: +x,-x,+y,-y,+z,-z (4 verts each)
      const uv = geo.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) {
        const face = Math.floor(i / 4);
        let su: number, sv: number;
        if (face <= 1) { su = d / UV_WORLD_SCALE; sv = h / UV_WORLD_SCALE; }       // +x, -x
        else if (face <= 3) { su = w / UV_WORLD_SCALE; sv = d / UV_WORLD_SCALE; }   // +y, -y
        else { su = w / UV_WORLD_SCALE; sv = h / UV_WORLD_SCALE; }                  // +z, -z
        uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
      }
      uv.needsUpdate = true;
    };

    // North wall (along X at z=0)
    {
      const w = totalWidth + 2 * OVR;
      const geo = new THREE.BoxGeometry(w, WALL_HEIGHT, WALL_THICK);
      scaleUVs(geo, w, WALL_HEIGHT, WALL_THICK);
      geo.applyMatrix4(new THREE.Matrix4().makeTranslation(
        totalWidth / 2, WALL_HEIGHT / 2, -WALL_THICK / 2,
      ));
      geos.push(geo);
    }
    // South wall (along X at z=totalDepth)
    {
      const w = totalWidth + 2 * OVR;
      const geo = new THREE.BoxGeometry(w, WALL_HEIGHT, WALL_THICK);
      scaleUVs(geo, w, WALL_HEIGHT, WALL_THICK);
      geo.applyMatrix4(new THREE.Matrix4().makeTranslation(
        totalWidth / 2, WALL_HEIGHT / 2, totalDepth + WALL_THICK / 2,
      ));
      geos.push(geo);
    }
    // West wall (along Z at x=0)
    {
      const d = totalDepth + 2 * OVR;
      const geo = new THREE.BoxGeometry(WALL_THICK, WALL_HEIGHT, d);
      scaleUVs(geo, WALL_THICK, WALL_HEIGHT, d);
      geo.applyMatrix4(new THREE.Matrix4().makeTranslation(
        -WALL_THICK / 2, WALL_HEIGHT / 2, totalDepth / 2,
      ));
      geos.push(geo);
    }
    // East wall (along Z at x=totalWidth)
    {
      const d = totalDepth + 2 * OVR;
      const geo = new THREE.BoxGeometry(WALL_THICK, WALL_HEIGHT, d);
      scaleUVs(geo, WALL_THICK, WALL_HEIGHT, d);
      geo.applyMatrix4(new THREE.Matrix4().makeTranslation(
        totalWidth + WALL_THICK / 2, WALL_HEIGHT / 2, totalDepth / 2,
      ));
      geos.push(geo);
    }

    const normalized = geos.map(g => g.index ? g.toNonIndexed() : g);
    const merged = mergeGeometries(normalized, false);
    if (merged) {
      const wallMap = new THREE.TextureLoader().load('/textures/walls-atlas.webp');
      wallMap.wrapS = wallMap.wrapT = THREE.ClampToEdgeWrapping;
      const mat = makeAtlasMaterial(wallMap, 0, 3, 0.9);
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      scene.add(mesh);
    }
    for (let i = 0; i < geos.length; i++) {
      if (normalized[i] !== geos[i]) normalized[i].dispose();
      geos[i].dispose();
    }
  }

  private createSidewalks(scene: THREE.Scene): void {
    const geos: THREE.BufferGeometry[] = [];
    const height = SIDEWALK_HEIGHT;

    for (const sw of this.layout.sidewalks) {
      const geo = new THREE.BoxGeometry(sw.width, height, sw.depth);
      // Scale top-face UVs to world size for atlas tiling (top face = verts 8-11)
      const suv = geo.getAttribute('uv');
      for (let i = 0; i < suv.count; i++) {
        // BoxGeometry faces: +x,-x,+y,-y,+z,-z (4 verts each). Top (+y) = verts 8-11.
        const face = Math.floor(i / 4);
        if (face === 2) { // +y (top face)
          suv.setXY(i, suv.getX(i) * sw.width / UV_WORLD_SCALE, suv.getY(i) * sw.depth / UV_WORLD_SCALE);
        }
      }
      suv.needsUpdate = true;
      const m = new THREE.Matrix4().makeTranslation(
        sw.x + sw.width / 2,
        height / 2,
        sw.z + sw.depth / 2,
      );
      geo.applyMatrix4(m);
      geos.push(geo);
    }
    // Use ground atlas tile (1,1) image = cobblestone (tileX=1, tileY=0 in UV)
    const merged = mergeGeometries(geos.map((g) => g.index ? g.toNonIndexed() : g), false);
    if (merged) {
      const groundMap = new THREE.TextureLoader().load('/textures/ground-atlas.webp');
      groundMap.wrapS = groundMap.wrapT = THREE.ClampToEdgeWrapping;
      const swMat = makeAtlasMaterial(groundMap, 1, 0, 0.8);
      const mesh = new THREE.Mesh(merged, swMat);
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      scene.add(mesh);
    }
    for (const g of geos) g.dispose();
  }
}
