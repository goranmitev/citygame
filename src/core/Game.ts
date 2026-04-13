import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { EventBus, Events } from './EventBus';

export interface GameSystem {
  readonly name: string;
  init?(game: Game): void;
  update?(delta: number, elapsed: number): void;
  dispose?(): void;
}

export class Game {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly composer: EffectComposer;
  private timer = new THREE.Timer();

  private systems: GameSystem[] = [];
  private running = false;
  private animFrameId = 0;

  constructor(canvas?: HTMLCanvasElement) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      400,
    );
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    // Post-processing pipeline
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    const bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.3,   // strength — subtle glow
      0.4,   // radius
      0.85,  // threshold — only bright areas bloom
    );
    this.composer.addPass(bloom);

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
    this.loop();
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.animFrameId);
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
    if (!this.running) return;
    this.animFrameId = requestAnimationFrame(this.loop);

    this.timer.update();
    const delta = Math.min(this.timer.getDelta(), 0.1); // cap at 100ms
    const elapsed = this.timer.getElapsed();

    for (const system of this.systems) {
      system.update?.(delta, elapsed);
    }

    this.composer.render();
  };

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);
  };
}
