import * as THREE from 'three';
import { WebGPURenderer, RenderPipeline } from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { EventBus, Events } from './EventBus';
import {
  CAMERA_FOV, CAMERA_NEAR, CAMERA_FAR,
  MAX_PIXEL_RATIO, TONE_MAPPING_EXPOSURE,
  BLOOM_STRENGTH, BLOOM_THRESHOLD, BLOOM_SMOOTHING,
  MAX_DELTA,
} from '../constants';

export interface GameSystem {
  readonly name: string;
  init?(game: Game): void;
  update?(delta: number, elapsed: number): void;
  dispose?(): void;
}

export class Game {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: WebGPURenderer;
  readonly postProcessing: RenderPipeline;
  private timer = new THREE.Timer();

  private systems: GameSystem[] = [];
  private running = false;

  constructor(canvas?: HTMLCanvasElement) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      CAMERA_FOV,
      window.innerWidth / window.innerHeight,
      CAMERA_NEAR,
      CAMERA_FAR,
    );
    this.renderer = new WebGPURenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = TONE_MAPPING_EXPOSURE;

    const scenePass = pass(this.scene, this.camera);
    const sceneColor = scenePass.getTextureNode();
    const bloomEffect = bloom(sceneColor, BLOOM_STRENGTH, BLOOM_THRESHOLD, BLOOM_SMOOTHING);

    this.postProcessing = new RenderPipeline(this.renderer);
    this.postProcessing.outputNode = sceneColor.add(bloomEffect);

    if (!canvas) {
      document.body.appendChild(this.renderer.domElement);
    }

    window.addEventListener('resize', this.onResize);
  }

  addSystem(system: GameSystem): this {
    this.systems.push(system);
    system.init?.(this);
    return this;
  }

  getSystem<T extends GameSystem>(name: string): T | undefined {
    return this.systems.find((s) => s.name === name) as T | undefined;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.renderer.init().then(() => {
      if (this.running) this.renderer.setAnimationLoop(this.loop);
    });
  }

  stop(): void {
    this.running = false;
    this.renderer.setAnimationLoop(null);
  }

  /**
   * Dispose all systems and clean the scene, then re-initialize each system
   * so the game can be restarted without a page reload.
   * All EventBus listeners are cleared first so stale handlers don't fire.
   */
  reset(): void {
    this.stop();

    // Clear all EventBus subscriptions before systems re-register their handlers
    EventBus.clear();

    for (const system of this.systems) {
      system.dispose?.();
    }

    // Clear the Three.js scene of all objects (lights, meshes, etc.)
    while (this.scene.children.length > 0) {
      this.scene.remove(this.scene.children[0]);
    }

    // Re-initialize every system in the same registered order
    for (const system of this.systems) {
      system.init?.(this);
    }

    EventBus.emit(Events.GAME_RESET, undefined);

    this.start();
  }

  dispose(): void {
    this.stop();
    EventBus.clear();
    for (const system of this.systems) {
      system.dispose?.();
    }
    this.renderer.dispose();
    window.removeEventListener('resize', this.onResize);
  }

  private loop = (): void => {
    this.timer.update();
    const delta = Math.min(this.timer.getDelta(), MAX_DELTA);
    const elapsed = this.timer.getElapsed();

    for (const system of this.systems) {
      system.update?.(delta, elapsed);
    }

    this.postProcessing.render();
  };

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };
}
