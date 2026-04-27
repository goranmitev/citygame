import { GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

export const GAME_ASSETS = {
  carModel: '/assets/models/car_optimized.glb',
  runnerModel: '/delivery_guy_running_optimized.glb',
  textures: [
    '/textures/ground-atlas.webp',
    '/textures/walls-atlas.webp',
    '/textures/roofs-atlas.webp',
  ],
} as const;

export interface AssetPreloadSnapshot {
  status: 'idle' | 'loading' | 'ready' | 'error';
  loaded: number;
  total: number;
  errors: string[];
}

const gltfPromises = new Map<string, Promise<GLTF>>();
const texturePromises = new Map<string, Promise<void>>();
const listeners = new Set<(snapshot: AssetPreloadSnapshot) => void>();

let sharedGltfLoader: GLTFLoader | null = null;
let preloadPromise: Promise<void> | null = null;
let snapshot: AssetPreloadSnapshot = {
  status: 'idle',
  loaded: 0,
  total: 0,
  errors: [],
};

function getGltfLoader(): GLTFLoader {
  if (!sharedGltfLoader) {
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('/draco/');

    sharedGltfLoader = new GLTFLoader();
    sharedGltfLoader.setDRACOLoader(dracoLoader);
  }

  return sharedGltfLoader;
}

function emit(): void {
  const current = getGameAssetPreloadSnapshot();
  for (const listener of listeners) {
    listener(current);
  }
}

function markLoaded(): void {
  snapshot = { ...snapshot, loaded: snapshot.loaded + 1 };
  emit();
}

function markError(label: string, error: unknown): void {
  console.error(`Failed to preload ${label}:`, error);
  snapshot = {
    ...snapshot,
    loaded: snapshot.loaded + 1,
    errors: [...snapshot.errors, label],
  };
  emit();
}

export function loadGameGltf(path: string): Promise<GLTF> {
  let promise = gltfPromises.get(path);
  if (!promise) {
    promise = getGltfLoader().loadAsync(path);
    gltfPromises.set(path, promise);
  }

  return promise;
}

export function loadFreshGameGltf(path: string): Promise<GLTF> {
  return getGltfLoader().loadAsync(path);
}

function preloadTexture(path: string): Promise<void> {
  let promise = texturePromises.get(path);
  if (!promise) {
    promise = fetch(path, { cache: 'force-cache' }).then((response) => {
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      return response.blob();
    }).then(() => undefined);
    texturePromises.set(path, promise);
  }

  return promise;
}

export function preloadGameAssets(): Promise<void> {
  if (preloadPromise) return preloadPromise;

  const tasks: Array<{ label: string; promise: Promise<unknown> }> = [
    { label: 'car model', promise: loadGameGltf(GAME_ASSETS.carModel) },
    { label: 'runner model', promise: loadGameGltf(GAME_ASSETS.runnerModel) },
    ...GAME_ASSETS.textures.map((path) => ({ label: path, promise: preloadTexture(path) })),
  ];

  snapshot = {
    status: 'loading',
    loaded: 0,
    total: tasks.length,
    errors: [],
  };
  emit();

  preloadPromise = Promise.all(tasks.map(({ label, promise }) => (
    promise.then(markLoaded).catch((error) => markError(label, error))
  ))).then(() => {
    snapshot = {
      ...snapshot,
      status: snapshot.errors.length > 0 ? 'error' : 'ready',
    };
    emit();
  });

  return preloadPromise;
}

export function getGameAssetPreloadSnapshot(): AssetPreloadSnapshot {
  return {
    status: snapshot.status,
    loaded: snapshot.loaded,
    total: snapshot.total,
    errors: [...snapshot.errors],
  };
}

export function onGameAssetPreloadChange(
  listener: (snapshot: AssetPreloadSnapshot) => void,
): () => void {
  listeners.add(listener);
  listener(getGameAssetPreloadSnapshot());
  return () => {
    listeners.delete(listener);
  };
}
