import * as THREE from 'three';
import { Game, GameSystem } from '../core/Game';

/**
 * Sets up the base scene: sky, fog, sun, ambient light, and ground.
 */
export class SceneSystem implements GameSystem {
  readonly name = 'scene';

  private sun!: THREE.DirectionalLight;

  init(game: Game): void {
    const { scene } = game;

    // Sky color
    scene.background = new THREE.Color(0x87ceeb);

    // Distance fog for depth cue and performance
    scene.fog = new THREE.Fog(0xc8dce8, 80, 400);

    // Hemisphere light (sky + ground bounce) — fills shadows
    const hemi = new THREE.HemisphereLight(0x87ceeb, 0x556655, 1.2);
    scene.add(hemi);

    // Extra ambient to lift shadow darkness
    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambient);

    // Directional sun light with shadows
    this.sun = new THREE.DirectionalLight(0xfff5e6, 1.2);
    this.sun.position.set(100, 120, 60);
    this.sun.castShadow = true;

    const s = 150;
    this.sun.shadow.camera.left = -s;
    this.sun.shadow.camera.right = s;
    this.sun.shadow.camera.top = s;
    this.sun.shadow.camera.bottom = -s;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 400;
    this.sun.shadow.mapSize.set(2048, 2048);
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
