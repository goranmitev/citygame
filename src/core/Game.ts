import * as THREE from 'three';

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
  readonly clock: THREE.Clock;

  private systems: GameSystem[] = [];
  private running = false;
  private animFrameId = 0;

  constructor(canvas?: HTMLCanvasElement) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000,
    );
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    if (!canvas) {
      document.body.appendChild(this.renderer.domElement);
    }

    this.clock = new THREE.Clock();

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
    this.clock.start();
    this.loop();
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.animFrameId);
  }

  dispose(): void {
    this.stop();
    for (const system of this.systems) {
      system.dispose?.();
    }
    this.renderer.dispose();
    window.removeEventListener('resize', this.onResize);
  }

  private loop = (): void => {
    if (!this.running) return;
    this.animFrameId = requestAnimationFrame(this.loop);

    const delta = Math.min(this.clock.getDelta(), 0.1); // cap at 100ms
    const elapsed = this.clock.getElapsedTime();

    for (const system of this.systems) {
      system.update?.(delta, elapsed);
    }

    this.renderer.render(this.scene, this.camera);
  };

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };
}
