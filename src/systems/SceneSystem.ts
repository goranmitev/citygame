import * as THREE from 'three';
import { Game, GameSystem } from '../core/Game';
import {
  SKY_COLOR, FOG_COLOR, FOG_NEAR, FOG_FAR,
  SUN_COLOR, SUN_INTENSITY, HEMI_INTENSITY, AMBIENT_INTENSITY,
  SHADOW_CAMERA_SIZE, SHADOW_MAP_SIZE, CAMERA_FAR,
} from '../constants';

/**
 * Sets up the base scene: sky, fog, sun, ambient light, and ground.
 */
export class SceneSystem implements GameSystem {
  readonly name = 'scene';

  private sun!: THREE.DirectionalLight;

  init(game: Game): void {
    const { scene } = game;

    // Sky color
    scene.background = new THREE.Color(SKY_COLOR);

    // Distance fog for depth cue and performance
    scene.fog = new THREE.Fog(FOG_COLOR, FOG_NEAR, FOG_FAR);

    // Hemisphere light (sky + ground bounce) — fills shadows
    const hemi = new THREE.HemisphereLight(SKY_COLOR, 0x556655, HEMI_INTENSITY);
    scene.add(hemi);

    // Extra ambient to lift shadow darkness
    const ambient = new THREE.AmbientLight(0xffffff, AMBIENT_INTENSITY);
    scene.add(ambient);

    // Directional sun light with shadows
    this.sun = new THREE.DirectionalLight(SUN_COLOR, SUN_INTENSITY);
    this.sun.position.set(100, 120, 60);
    this.sun.castShadow = true;

    const s = SHADOW_CAMERA_SIZE;
    this.sun.shadow.camera.left = -s;
    this.sun.shadow.camera.right = s;
    this.sun.shadow.camera.top = s;
    this.sun.shadow.camera.bottom = -s;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = CAMERA_FAR;
    this.sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    this.sun.shadow.bias = -0.001;

    scene.add(this.sun);
    scene.add(this.sun.target);
  }

  /** Call to re-center the shadow camera on the player. */
  updateShadowTarget(x: number, z: number): void {
    this.sun.target.position.set(x, 0, z);
    this.sun.position.set(x + 100, 120, z + 60);
  }
}
