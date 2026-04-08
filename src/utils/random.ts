/**
 * Seeded pseudo-random number generator (mulberry32).
 * Deterministic: same seed produces the same city every time.
 */
export function createRNG(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random float in [min, max) */
export function randRange(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

/** Random integer in [min, max] inclusive */
export function randInt(rng: () => number, min: number, max: number): number {
  return Math.floor(min + rng() * (max - min + 1));
}

/** Pick a random element from an array */
export function randPick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}
