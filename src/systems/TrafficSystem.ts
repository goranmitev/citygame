import * as THREE from 'three';
import { Game, GameSystem } from '../core/Game';
import { CityBuilder } from '../city/CityBuilder';
import { CarSystem } from './CarSystem';
import { EventBus, Events, CarHitEvent } from '../core/EventBus';

// Traffic light phase durations (seconds)
const GREEN_DURATION = 8;
const YELLOW_DURATION = 2;
const RED_DURATION = 10; // green + yellow of cross direction

const LIGHT_RED    = 0xff2200;
const LIGHT_YELLOW = 0xffcc00;
const LIGHT_GREEN  = 0x22ff44;
const LIGHT_OFF    = 0x222222;

// Stop sign threshold — streets narrower than this get stop signs instead of lights
const STOP_SIGN_WIDTH_THRESHOLD = 7.5;

// Collision box half-extents for a sign/light pole (XZ plane)
const KNOCKABLE_HALF = 0.18;
// How high car must overlap to register a hit (avoids false positives)
const KNOCKABLE_HEIGHT = 2.0;
// Gravity for knocked objects
const GRAVITY = -18;
// Bounce damping when hitting ground
const BOUNCE_DAMPING = 0.35;
// Angular spin rate when knocked (rad/s)
const SPIN_BASE = 4.0;

type Phase = 'green' | 'yellow' | 'red';

interface TrafficLight {
  group: THREE.Group;
  /** Which street axis this light controls: 'h' = horizontal traffic flows, 'v' = vertical */
  axis: 'h' | 'v';
  redMesh: THREE.Mesh;
  yellowMesh: THREE.Mesh;
  greenMesh: THREE.Mesh;
}

interface Intersection {
  /** Center of the intersection in world space */
  cx: number;
  cz: number;
  lights: TrafficLight[];
  /** Timer drives the phase cycle */
  timer: number;
  /** Current phase for horizontal-going traffic */
  hPhase: Phase;
  hStreetW: number;
  vStreetW: number;
}

type KnockState = 'standing' | 'flying' | 'fading' | 'done';

interface KnockableObject {
  group: THREE.Group;
  /** World-space XZ position (base) — used for broad-phase collision */
  baseX: number;
  baseZ: number;
  state: KnockState;
  vel: THREE.Vector3;
  angularVel: THREE.Vector3;
  originY: number;
  opacity: number;
}

export class TrafficSystem implements GameSystem {
  readonly name = 'traffic';

  private intersections: Intersection[] = [];
  private knockables: KnockableObject[] = [];
  private car!: CarSystem;
  private scene!: THREE.Scene;

  // Reusable box — avoids per-frame allocation in updateKnockables
  private _knockBox = new THREE.Box3();

  init(game: Game): void {
    this.scene = game.scene;
    this.car = game.getSystem<CarSystem>('car')!;
    const city = game.getSystem<CityBuilder>('city');
    if (!city) return;

    const layout = city.layout;
    const ROAD_FRACTION = 0.65;

    // Reconstruct per-street geometry the same way CityLayout does
    const { streets, totalWidth, totalDepth } = layout;

    // Separate horizontal and vertical streets from the merged streets array
    const hStreets = streets.filter(s => s.width > s.depth);
    const vStreets = streets.filter(s => s.depth >= s.width);

    // Sort by position for deterministic processing
    hStreets.sort((a, b) => a.z - b.z);
    vStreets.sort((a, b) => a.x - b.x);

    for (const hSt of hStreets) {
      for (const vSt of vStreets) {
        // The road center for horizontal street: hSt.z + hSt.depth/2
        // The road center for vertical street: vSt.x + vSt.width/2
        const cx = vSt.x + vSt.width / 2;
        const cz = hSt.z + hSt.depth / 2;

        const hW = hSt.depth; // road width of horizontal street (depth dimension)
        const vW = vSt.width; // road width of vertical street (width dimension)

        // Full street width (road + sidewalks on both sides)
        // road = street * ROAD_FRACTION, sidewalk = (street - road) / 2 each side
        const hFullW = hW / ROAD_FRACTION;
        const vFullW = vW / ROAD_FRACTION;

        const hSideW = (hFullW - hW) / 2;
        const vSideW = (vFullW - vW) / 2;

        // Skip tiny streets with no sidewalk room
        if (hSideW < 0.3 && vSideW < 0.3) continue;
        if (hFullW < 1 || vFullW < 1) continue;

        const useStopSign = hFullW < STOP_SIGN_WIDTH_THRESHOLD || vFullW < STOP_SIGN_WIDTH_THRESHOLD;

        const intersection: Intersection = {
          cx,
          cz,
          lights: [],
          timer: 0,
          hPhase: 'green',
          hStreetW: hFullW,
          vStreetW: vFullW,
        };

        if (useStopSign) {
          // Place stop signs on the narrower street approaches
          this.placeStopSigns(intersection, hSt, vSt, hW, vW, hSideW, vSideW, hFullW, vFullW);
        } else {
          // Place traffic lights at the 4 corners
          this.placeTrafficLights(intersection, cx, cz, hW, vW, hSideW, vSideW);
          // Offset phases so adjacent intersections aren't perfectly synchronized
          intersection.timer = (this.intersections.length % 3) * (GREEN_DURATION / 3);
        }

        this.intersections.push(intersection);
      }
    }

    // --- Street sign poles + blades (knockable, one per intersection corner) ---
    const POLE_H = 5.5;
    const SIGN_W = 2.8;
    const SIGN_H = 0.65;
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x3a6b3a, roughness: 0.7, metalness: 0.2 });

    const signTexCache = new Map<string, THREE.CanvasTexture>();
    const getSignTex = (label: string): THREE.CanvasTexture => {
      if (signTexCache.has(label)) return signTexCache.get(label)!;
      const CW = 512, CH = 128;
      const canvas = document.createElement('canvas');
      canvas.width = CW; canvas.height = CH;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#1a5c2a';
      ctx.fillRect(0, 0, CW, CH);
      const B = 8;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = B;
      ctx.strokeRect(B / 2, B / 2, CW - B, CH - B);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 56px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, CW / 2, CH / 2);
      const tex = new THREE.CanvasTexture(canvas);
      signTexCache.set(label, tex);
      return tex;
    };

    const addBlade = (group: THREE.Group, label: string, y: number, rotY: number) => {
      const mat = new THREE.MeshStandardMaterial({ map: getSignTex(label), roughness: 0.6, metalness: 0.1 });
      for (const r of [rotY, rotY + Math.PI]) {
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(SIGN_W, SIGN_H), mat);
        mesh.rotation.y = r;
        mesh.position.y = y;
        group.add(mesh);
      }
    };

    for (const ix of layout.intersections) {
      const group = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, POLE_H, 6), poleMat);
      pole.position.y = POLE_H / 2;
      pole.castShadow = true;
      group.add(pole);
      addBlade(group, layout.hStreetNames[ix.hIdx], POLE_H - SIGN_H * 0.6, 0);
      addBlade(group, layout.vStreetNames[ix.vIdx], POLE_H + SIGN_H * 0.6, Math.PI / 2);
      group.position.set(ix.px, 0, ix.pz);
      this.scene.add(group);
      this.knockables.push({
        group,
        baseX: ix.px,
        baseZ: ix.pz,
        state: 'standing',
        vel: new THREE.Vector3(),
        angularVel: new THREE.Vector3(),
        originY: 0,
        opacity: 1,
      });
    }
  }

  update(delta: number): void {
    for (const inter of this.intersections) {
      if (inter.lights.length === 0) continue;

      inter.timer += delta;

      // Determine phase based on timer
      const cycleDuration = GREEN_DURATION + YELLOW_DURATION + RED_DURATION;
      const t = inter.timer % cycleDuration;

      let hPhase: Phase;
      if (t < GREEN_DURATION) {
        hPhase = 'green';
      } else if (t < GREEN_DURATION + YELLOW_DURATION) {
        hPhase = 'yellow';
      } else {
        hPhase = 'red';
      }

      if (hPhase !== inter.hPhase) {
        inter.hPhase = hPhase;
        this.applyPhases(inter);
      }
    }

    this.updateKnockables(delta);
  }

  private updateKnockables(delta: number): void {
    const carBox = this.car.getWorldBox();
    const carVel = this.car.getVelocity();

    for (const obj of this.knockables) {
      if (obj.state === 'standing') {
        const dx = obj.baseX - this.car.position.x;
        const dz = obj.baseZ - this.car.position.z;
        if (dx * dx + dz * dz > 16) continue;

        this._knockBox.min.set(obj.baseX - KNOCKABLE_HALF, 0,               obj.baseZ - KNOCKABLE_HALF);
        this._knockBox.max.set(obj.baseX + KNOCKABLE_HALF, KNOCKABLE_HEIGHT, obj.baseZ + KNOCKABLE_HALF);

        if (carBox.intersectsBox(this._knockBox)) {
          obj.state = 'flying';
          const speed = carVel.length();
          EventBus.emit<CarHitEvent>(Events.CAR_HIT_OBJECT, { speed });
          obj.vel.set(
            carVel.x * 0.6 + (Math.random() - 0.5) * 2,
            speed * 0.5 + 3,
            carVel.z * 0.6 + (Math.random() - 0.5) * 2,
          );
          obj.angularVel.set(
            (Math.random() - 0.5) * SPIN_BASE,
            (Math.random() - 0.5) * SPIN_BASE * 0.5,
            (Math.random() - 0.5) * SPIN_BASE,
          );
        }
      } else if (obj.state === 'flying') {
        obj.vel.y += GRAVITY * delta;

        obj.group.position.x += obj.vel.x * delta;
        obj.group.position.y += obj.vel.y * delta;
        obj.group.position.z += obj.vel.z * delta;

        obj.group.rotation.x += obj.angularVel.x * delta;
        obj.group.rotation.y += obj.angularVel.y * delta;
        obj.group.rotation.z += obj.angularVel.z * delta;

        if (obj.group.position.y <= obj.originY) {
          obj.group.position.y = obj.originY;
          if (Math.abs(obj.vel.y) > 0.5) {
            obj.vel.y *= -BOUNCE_DAMPING;
            obj.vel.x *= 0.7;
            obj.vel.z *= 0.7;
            obj.angularVel.multiplyScalar(0.6);
          } else {
            // Start fading — make all materials transparent
            obj.group.traverse((child) => {
              if (child instanceof THREE.Mesh) {
                const mat = child.material as THREE.MeshStandardMaterial;
                mat.transparent = true;
              }
            });
            obj.opacity = 1;
            obj.state = 'fading';
          }
        }
      } else if (obj.state === 'fading') {
        obj.opacity -= delta / 1.2; // fade over 1.2 seconds
        if (obj.opacity <= 0) {
          this.scene.remove(obj.group);
          obj.state = 'done';
        } else {
          obj.group.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              (child.material as THREE.MeshStandardMaterial).opacity = obj.opacity;
            }
          });
        }
      }
      // 'done' — removed from scene, no update needed
    }
  }

  dispose(): void {
    for (const inter of this.intersections) {
      for (const light of inter.lights) {
        light.group.traverse((obj) => {
          if (obj instanceof THREE.Mesh) {
            obj.geometry.dispose();
            (obj.material as THREE.Material).dispose();
          }
        });
        this.scene.remove(light.group);
      }
    }
    for (const obj of this.knockables) {
      obj.group.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      });
      this.scene.remove(obj.group);
    }
    this.intersections = [];
    this.knockables = [];
  }

  // ---------------------------------------------------------------------------

  private applyPhases(inter: Intersection): void {
    // Vertical-going traffic is opposite phase to horizontal
    const vPhase: Phase = inter.hPhase === 'green' ? 'red'
      : inter.hPhase === 'yellow' ? 'red'
      : 'green';

    for (const light of inter.lights) {
      const phase = light.axis === 'h' ? inter.hPhase : vPhase;
      this.setLightColor(light, phase);
    }
  }

  private setLightColor(light: TrafficLight, phase: Phase): void {
    const setEmissive = (mesh: THREE.Mesh, color: number, on: boolean) => {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.color.setHex(on ? color : LIGHT_OFF);
      mat.emissive.setHex(on ? color : 0x000000);
      mat.emissiveIntensity = on ? 1.2 : 0;
    };

    setEmissive(light.redMesh,    LIGHT_RED,    phase === 'red');
    setEmissive(light.yellowMesh, LIGHT_YELLOW, phase === 'yellow');
    setEmissive(light.greenMesh,  LIGHT_GREEN,  phase === 'green');
  }

  /** Build a traffic light pole + housing + 3 lamps. Returns the group. */
  private buildTrafficLightMesh(axis: 'h' | 'v'): TrafficLight {
    const group = new THREE.Group();

    // Pole
    const poleGeo = new THREE.CylinderGeometry(0.05, 0.06, 3.5, 6);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.8 });
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.y = 1.75;
    pole.castShadow = true;
    group.add(pole);

    // Housing box
    const housingGeo = new THREE.BoxGeometry(0.28, 0.75, 0.22);
    const housingMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.7 });
    const housing = new THREE.Mesh(housingGeo, housingMat);
    housing.position.set(0, 3.5, 0);
    housing.castShadow = true;
    group.add(housing);

    // Rotate housing to face traffic direction
    // 'h' axis = horizontal traffic flows along X → lights face Z direction
    // 'v' axis = vertical traffic flows along Z → lights face X direction
    housing.rotation.y = axis === 'h' ? 0 : Math.PI / 2;

    const makeLamp = (yOffset: number, color: number): THREE.Mesh => {
      const geo = new THREE.SphereGeometry(0.08, 8, 6);
      const mat = new THREE.MeshStandardMaterial({
        color: LIGHT_OFF,
        emissive: 0x000000,
        emissiveIntensity: 0,
        roughness: 0.3,
      });
      const mesh = new THREE.Mesh(geo, mat);
      const fwd = axis === 'h' ? 0.12 : 0;
      const side = axis === 'v' ? 0.12 : 0;
      mesh.position.set(side, 3.5 + yOffset, fwd);
      group.add(mesh);
      return mesh;
    };

    const redMesh    = makeLamp(0.25, LIGHT_RED);
    const yellowMesh = makeLamp(0,    LIGHT_YELLOW);
    const greenMesh  = makeLamp(-0.25, LIGHT_GREEN);

    return { group, axis, redMesh, yellowMesh, greenMesh };
  }

  private placeTrafficLights(
    inter: Intersection,
    cx: number, cz: number,
    hRoadW: number, vRoadW: number,
    hSideW: number, vSideW: number,
  ): void {
    // 4 corners: (±vRoadW/2 ± vSideW/2, ±hRoadW/2 ± hSideW/2)
    // Place on the corner closest to the sidewalk, facing inward
    const hHalf = hRoadW / 2;
    const vHalf = vRoadW / 2;
    const sideOffset = 0.5; // inset from outer sidewalk edge

    const corners = [
      { x: cx - vHalf - Math.max(vSideW * 0.5, 0.4), z: cz - hHalf - Math.max(hSideW * 0.5, 0.4), axis: 'h' as const },
      { x: cx + vHalf + Math.max(vSideW * 0.5, 0.4), z: cz - hHalf - Math.max(hSideW * 0.5, 0.4), axis: 'h' as const },
      { x: cx - vHalf - Math.max(vSideW * 0.5, 0.4), z: cz + hHalf + Math.max(hSideW * 0.5, 0.4), axis: 'v' as const },
      { x: cx + vHalf + Math.max(vSideW * 0.5, 0.4), z: cz + hHalf + Math.max(hSideW * 0.5, 0.4), axis: 'v' as const },
    ];

    for (const corner of corners) {
      const light = this.buildTrafficLightMesh(corner.axis);
      light.group.position.set(corner.x, 0, corner.z);
      this.scene.add(light.group);
      inter.lights.push(light);
      this.knockables.push({
        group: light.group,
        baseX: corner.x,
        baseZ: corner.z,
        state: 'standing',
        vel: new THREE.Vector3(),
        angularVel: new THREE.Vector3(),
        originY: 0,
        opacity: 1,
      });
    }

    // Set initial state
    this.applyPhases(inter);
  }

  private placeStopSigns(
    inter: Intersection,
    hSt: { x: number; z: number; width: number; depth: number },
    vSt: { x: number; z: number; width: number; depth: number },
    hRoadW: number, vRoadW: number,
    hSideW: number, vSideW: number,
    hFullW: number, vFullW: number,
  ): void {
    const { cx, cz } = inter;
    const hHalf = hRoadW / 2;
    const vHalf = vRoadW / 2;

    // Same corner positions as traffic lights — on the sidewalk at each corner
    const corners = [
      { x: cx - vHalf - Math.max(vSideW * 0.5, 0.4), z: cz - hHalf - Math.max(hSideW * 0.5, 0.4) },
      { x: cx + vHalf + Math.max(vSideW * 0.5, 0.4), z: cz - hHalf - Math.max(hSideW * 0.5, 0.4) },
      { x: cx - vHalf - Math.max(vSideW * 0.5, 0.4), z: cz + hHalf + Math.max(hSideW * 0.5, 0.4) },
      { x: cx + vHalf + Math.max(vSideW * 0.5, 0.4), z: cz + hHalf + Math.max(hSideW * 0.5, 0.4) },
    ];

    for (const corner of corners) {
      const group = this.buildStopSign(corner.x, corner.z, 0);
      this.scene.add(group);
      this.knockables.push({
        group,
        baseX: corner.x,
        baseZ: corner.z,
        state: 'standing',
        vel: new THREE.Vector3(),
        angularVel: new THREE.Vector3(),
        originY: 0,
        opacity: 1,
      });
    }
  }

  private buildStopSign(x: number, z: number, rotation: number): THREE.Group {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = rotation;

    // Pole
    const poleGeo = new THREE.CylinderGeometry(0.04, 0.05, 2.15, 6);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.7 });
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.y = 0.975;
    pole.castShadow = true;
    group.add(pole);

    // Canvas texture with red background, white border and "STOP" text
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;

    // Draw octagon
    const cx2 = 64, cy2 = 64, r = 58;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI / 8) + (i * Math.PI / 4);
      const px = cx2 + r * Math.cos(angle);
      const py = cy2 + r * Math.sin(angle);
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = '#cc1111';
    ctx.fill();
    // White border inset
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 7;
    ctx.stroke();
    // "STOP" text
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('STOP', 64, 64);

    const texture = new THREE.CanvasTexture(canvas);
    const signGeo = new THREE.PlaneGeometry(0.6, 0.6);
    const signMat = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.5, transparent: true, alphaTest: 0.5 });

    // Front face
    const signFront = new THREE.Mesh(signGeo, signMat);
    signFront.position.set(0, 2.3, 0.01);
    group.add(signFront);

    // Back face — flipped 180° so text reads correctly from both sides
    const signBack = new THREE.Mesh(signGeo, signMat);
    signBack.position.set(0, 2.3, -0.01);
    signBack.rotation.y = Math.PI;
    group.add(signBack);

    return group;
  }
}
