/**
 * Deterministic pseudo-random numbers.
 *
 * The simulation draws every random number from {@link simRng}, which `Game.start()` seeds per run.
 * Given the same seed and the same inputs, a run replays identically — this is what makes headless
 * simulation tests, bug reproduction and seeded/daily runs possible.
 *
 * Presentation code (particles, screen shake, audio jitter) must NOT use `simRng`; it runs at the
 * display rate and would desynchronise the simulation. It uses `Math.random()` instead.
 */

/** SplitMix32 — used to expand a single 32-bit seed into well-mixed generator state. */
function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
}

/** sfc32 (Small Fast Counting) — 128-bit state, passes PractRand, ~1ns per draw in V8. */
export class Rng {
  private a = 0;
  private b = 0;
  private c = 0;
  private d = 0;
  seed = 0;

  constructor(seed: number = (Math.random() * 2 ** 32) >>> 0) {
    this.reseed(seed);
  }

  reseed(seed: number): void {
    this.seed = seed >>> 0;
    const sm = splitmix32(this.seed);
    this.a = sm();
    this.b = sm();
    this.c = sm();
    this.d = sm();
    for (let i = 0; i < 12; i++) this.next();
  }

  /** Uniform float in [0, 1). */
  next(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return (t >>> 0) / 4294967296;
  }

  /** Uniform float in [a, b). */
  range(a = 0, b = 1): number {
    return a + this.next() * (b - a);
  }

  /** Uniform integer in [a, b] (inclusive). */
  int(a: number, b: number): number {
    return Math.floor(a + this.next() * (b - a + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)]!;
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const t = arr[i]!;
      arr[i] = arr[j]!;
      arr[j] = t;
    }
    return arr;
  }

  weightedPick<T>(items: readonly T[], weight: (item: T) => number): T {
    let total = 0;
    for (const it of items) total += weight(it);
    let r = this.next() * total;
    for (const it of items) {
      r -= weight(it);
      if (r <= 0) return it;
    }
    return items[items.length - 1]!;
  }

  /** Snapshot/restore the full generator state (for replays and save-states). */
  getState(): [number, number, number, number] {
    return [this.a, this.b, this.c, this.d];
  }

  setState(s: readonly [number, number, number, number]): void {
    [this.a, this.b, this.c, this.d] = s;
  }
}

/** The single source of randomness for all gameplay simulation. */
export const simRng = new Rng();

/** Shorthand for `simRng.next()` — the deterministic replacement for `Math.random()` in gameplay code. */
export const rand = (): number => simRng.next();
