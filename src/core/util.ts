/* SOULFORGE: Endless Night — math, formatting and colour utilities */
import { simRng } from './rng';

export const TAU = Math.PI * 2;

let uidCounter = 1;
const rgbCache = new Map<string, [number, number, number]>();

export const U = {
  TAU,
  clamp: (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v),
  lerp: (a: number, b: number, t: number): number => a + (b - a) * t,

  /* --- randomness: always the deterministic simulation stream (see core/rng.ts) --- */
  rand: (a = 0, b = 1): number => simRng.range(a, b),
  randi: (a: number, b: number): number => simRng.int(a, b),
  pick: <T>(arr: readonly T[]): T => simRng.pick(arr),
  chance: (p: number): boolean => simRng.chance(p),
  shuffle: <T>(arr: T[]): T[] => simRng.shuffle(arr),
  weightedPick: <T>(items: readonly T[], wfn: (it: T) => number): T => simRng.weightedPick(items, wfn),

  dist: (ax: number, ay: number, bx: number, by: number): number => Math.hypot(bx - ax, by - ay),
  dist2: (ax: number, ay: number, bx: number, by: number): number => (bx - ax) * (bx - ax) + (by - ay) * (by - ay),
  angle: (ax: number, ay: number, bx: number, by: number): number => Math.atan2(by - ay, bx - ax),
  norm(x: number, y: number): [number, number] {
    const l = Math.hypot(x, y) || 1;
    return [x / l, y / l];
  },

  fmt(n: number): string {
    n = Math.round(n);
    const a = Math.abs(n);
    if (a < 1000) return String(n);
    if (a < 1e6) return (n / 1e3).toFixed(n % 1000 === 0 ? 0 : 1) + 'K';
    if (a < 1e9) return (n / 1e6).toFixed(2) + 'M';
    return (n / 1e9).toFixed(2) + 'B';
  },
  fmtTime(sec: number): string {
    sec = Math.floor(sec);
    const m = Math.floor(sec / 60),
      s = sec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  },
  pct: (v: number, digits = 0): string => (v * 100).toFixed(digits) + '%',
  sign: (v: number, digits = 0): string => (v >= 0 ? '+' : '') + (digits ? v.toFixed(digits) : Math.round(v)),

  /** Stateless integer hash → [0, 1). Used for procedural placement (props, fog) and jitter. */
  hash2(x: number, y: number, seed = 0): number {
    let h = (x * 374761393 + y * 668265263 + seed * 1274126177) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h = (h ^ (h >>> 16)) >>> 0;
    return h / 4294967296;
  },
  mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },

  /** '#rgb' | '#rrggbb' | 'rgb(...)' | 'rgba(...)' → [r, g, b] in 0..255 (memoised). */
  hexToRgb(hex: string): [number, number, number] {
    let c = rgbCache.get(hex);
    if (c) return c;
    if (hex[0] !== '#') {
      const m = hex.match(/[\d.]+/g);
      c = m ? [+m[0]!, +m[1]!, +m[2]!] : [255, 255, 255];
    } else {
      let h = hex.slice(1);
      if (h.length === 3 || h.length === 4)
        h = h
          .split('')
          .map((ch) => ch + ch)
          .join('');
      const n = parseInt(h.slice(0, 6), 16);
      c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    rgbCache.set(hex, c);
    return c;
  },
  rgba(hex: string, a: number): string {
    if (hex[0] !== '#') return U.withAlpha(hex, a);
    const [r, g, b] = U.hexToRgb(hex);
    return `rgba(${r},${g},${b},${a})`;
  },
  /** accepts '#hex', 'rgb(r,g,b)' or 'rgba(...)' */
  withAlpha(color: string, a: number): string {
    if (color[0] === '#') return U.rgba(color, a);
    const m = color.match(/[\d.]+/g);
    if (!m) return color;
    return `rgba(${m[0]},${m[1]},${m[2]},${a})`;
  },
  shade(hex: string, amt: number): string {
    const [r, g, b] = U.hexToRgb(hex);
    const f = (c: number) => U.clamp(Math.round(c + amt * 255), 0, 255);
    return `rgb(${f(r)},${f(g)},${f(b)})`;
  },
  mix(hexA: string, hexB: string, t: number): string {
    const a = U.hexToRgb(hexA),
      b = U.hexToRgb(hexB);
    return `rgb(${Math.round(U.lerp(a[0], b[0], t))},${Math.round(U.lerp(a[1], b[1], t))},${Math.round(U.lerp(a[2], b[2], t))})`;
  },

  uid: (): number => uidCounter++,
  /** Reset entity ids at the start of a run so runs are reproducible from their seed. */
  resetUid(): void {
    uidCounter = 1;
  },
  esc(s: unknown): string {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  },
  deepClone: <T>(o: T): T => structuredClone(o),
};
