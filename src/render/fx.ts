/**
 * Visual effects state (particles, rings, beams, damage numbers, screen shake…).
 *
 * Pure data with no DOM access: the simulation spawns effects, the renderer draws them. Effects
 * never feed back into gameplay, so they use `Math.random()` rather than the deterministic sim RNG.
 *
 * Particles — by far the most numerous effect — live in a struct-of-arrays pool of typed arrays:
 * zero allocation per particle, cache-friendly updates, and O(1) swap-removal.
 */
import { TAU, U } from '../core/util';
import type { Enemy } from '../game/types';

const MAX_PARTICLES = 4096;
/** Bursts are skipped above this count so ambient/trail particles always have headroom. */
const BURST_LIMIT = 3200;
const AMBIENT_LIMIT = 2800;

const rnd = Math.random;
const rr = (a: number, b: number) => a + rnd() * (b - a);

export interface BurstOpts {
  speed?: number;
  life?: number;
  size?: number;
  up?: boolean;
  /** Additive glow (default) vs. solid square debris. */
  add?: boolean;
  grav?: number;
}

/** Struct-of-arrays particle pool. Index `i < count` is alive. */
export class Particles {
  readonly cap = MAX_PARTICLES;
  count = 0;
  readonly x = new Float32Array(MAX_PARTICLES);
  readonly y = new Float32Array(MAX_PARTICLES);
  readonly vx = new Float32Array(MAX_PARTICLES);
  readonly vy = new Float32Array(MAX_PARTICLES);
  readonly life = new Float32Array(MAX_PARTICLES);
  readonly max = new Float32Array(MAX_PARTICLES);
  readonly size = new Float32Array(MAX_PARTICLES);
  readonly grav = new Float32Array(MAX_PARTICLES);
  readonly r = new Uint8Array(MAX_PARTICLES);
  readonly g = new Uint8Array(MAX_PARTICLES);
  readonly b = new Uint8Array(MAX_PARTICLES);
  /** bit 0: additive glow, bit 1: ambient (no damping, sine fade). */
  readonly flags = new Uint8Array(MAX_PARTICLES);

  spawn(x: number, y: number, vx: number, vy: number, life: number, size: number, color: string, flags: number, grav = 0): void {
    if (this.count >= this.cap) return;
    const i = this.count++;
    const c = U.hexToRgb(color);
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.life[i] = life;
    this.max[i] = life;
    this.size[i] = size;
    this.grav[i] = grav;
    this.r[i] = c[0];
    this.g[i] = c[1];
    this.b[i] = c[2];
    this.flags[i] = flags;
  }

  private kill(i: number): void {
    const j = --this.count;
    if (i === j) return;
    this.x[i] = this.x[j]!;
    this.y[i] = this.y[j]!;
    this.vx[i] = this.vx[j]!;
    this.vy[i] = this.vy[j]!;
    this.life[i] = this.life[j]!;
    this.max[i] = this.max[j]!;
    this.size[i] = this.size[j]!;
    this.grav[i] = this.grav[j]!;
    this.r[i] = this.r[j]!;
    this.g[i] = this.g[j]!;
    this.b[i] = this.b[j]!;
    this.flags[i] = this.flags[j]!;
  }

  update(dt: number, extraVy = 0, swirl?: (y: number) => number): void {
    const damp = Math.pow(0.1, dt);
    for (let i = this.count - 1; i >= 0; i--) {
      const life = this.life[i]! - dt;
      if (life <= 0) {
        this.kill(i);
        continue;
      }
      this.life[i] = life;
      this.x[i]! += this.vx[i]! * dt;
      this.y[i]! += this.vy[i]! * dt;
      this.vy[i]! += this.grav[i]! * dt + extraVy * dt;
      if (swirl) this.vx[i]! += swirl(this.y[i]!) * dt;
      if (!(this.flags[i]! & 2)) {
        this.vx[i]! *= damp;
        this.vy[i]! *= damp;
      }
    }
  }

  clear(): void {
    this.count = 0;
  }
}

/* ---- short-lived vector effects (few dozen at a time; plain objects are fine) ---- */
interface Timed {
  life: number;
  max: number;
}
export interface RingFx extends Timed {
  x: number;
  y: number;
  r: number;
  color: string;
  thin: boolean;
}
export interface NovaFx {
  n: { x: number; y: number; r: number; maxR: number; dead: boolean };
  color: string;
  thin?: boolean;
}
export interface BeamFx extends Timed {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  w: number;
  seed: number;
}
export interface LineFx extends Timed {
  x: number;
  y: number;
  angle: number;
  len: number;
  width: number;
  color: string;
}
export interface ArcFx extends Timed {
  x: number;
  y: number;
  angle: number;
  r: number;
  halfArc: number;
  color: string;
  thin?: boolean;
}
export interface ExplosionFx extends Timed {
  x: number;
  y: number;
  r: number;
  color: string;
}
export interface BoltFx extends Timed {
  x: number;
  y: number;
  color: string;
  seed: number;
}
export interface WhipFx extends Timed {
  x: number;
  y: number;
  sd: number;
  len: number;
  hgt: number;
  color: string;
}
export interface TextFx extends Timed {
  x: number;
  y: number;
  text: string;
  color: string;
  vy: number;
  small?: boolean;
  crit?: boolean;
  dmg?: boolean;
}
export interface CorpseFx extends Timed {
  x: number;
  y: number;
  type: string;
  r: number;
  col: Enemy['def']['col'];
  tier: number;
  flip: number;
}
interface Progress {
  t: number;
  max: number;
}
export interface LobFx extends Progress {
  x: number;
  y: number;
  tx: number;
  ty: number;
  color: string;
}
export interface MeteorFx extends Progress {
  x: number;
  y: number;
  small?: boolean;
  color?: string;
}
export type TelegraphFx =
  | (Progress & { type: 'circle'; x: number; y: number; r: number; color?: string })
  | (Progress & { type: 'line'; e: Enemy; px: number; py: number });

/** Remove entries whose `life` has run out — in place, order-preserving, no allocation. */
function decay<T extends Timed>(arr: T[], dt: number): void {
  let w = 0;
  for (let i = 0; i < arr.length; i++) {
    const it = arr[i]!;
    it.life -= dt;
    if (it.life > 0) arr[w++] = it;
  }
  arr.length = w;
}
function advance<T extends Progress>(arr: T[], dt: number): void {
  let w = 0;
  for (let i = 0; i < arr.length; i++) {
    const it = arr[i]!;
    it.t += dt;
    if (it.t < it.max) arr[w++] = it;
  }
  arr.length = w;
}

export class FX {
  readonly parts = new Particles();
  texts: TextFx[] = [];
  rings: RingFx[] = [];
  novas: NovaFx[] = [];
  beams: BeamFx[] = [];
  lines: LineFx[] = [];
  arcs: ArcFx[] = [];
  lobs: LobFx[] = [];
  meteors: MeteorFx[] = [];
  tele: TelegraphFx[] = [];
  explosions: ExplosionFx[] = [];
  bolts: BoltFx[] = [];
  whips: WhipFx[] = [];
  corpses: CorpseFx[] = [];
  shakeAmt = 0;
  flashA = 0;
  flashCol = '#fff';
  dmgEnabled = true;
  shakeMul = 1;

  clear(): void {
    this.parts.clear();
    this.texts = [];
    this.rings = [];
    this.novas = [];
    this.beams = [];
    this.lines = [];
    this.arcs = [];
    this.lobs = [];
    this.meteors = [];
    this.tele = [];
    this.explosions = [];
    this.bolts = [];
    this.whips = [];
    this.corpses = [];
    this.shakeAmt = 0;
    this.flashA = 0;
  }

  burst(x: number, y: number, color: string, n: number, o: BurstOpts = {}): void {
    const P = this.parts;
    if (P.count > BURST_LIMIT) return;
    const speed = o.speed || 90,
      life = o.life || 0.5,
      size = o.size || 4,
      up = o.up ? 60 : 0;
    const flags = o.add !== false ? 1 : 0;
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU,
        sp = speed * (0.4 + rnd() * 0.8);
      P.spawn(
        x,
        y,
        Math.cos(a) * sp,
        Math.sin(a) * sp - up,
        life * (0.6 + rnd() * 0.6),
        size * (0.6 + rnd() * 0.8),
        color,
        flags,
        o.grav || 0,
      );
    }
  }
  trail(x: number, y: number, color: string, size?: number): void {
    if (this.parts.count > BURST_LIMIT) return;
    this.parts.spawn(x, y, rr(-10, 10), rr(-10, 10), 0.25, size || 4, color, 1);
  }
  ambient(x: number, y: number, vx: number, vy: number, life: number, size: number, color: string): void {
    if (this.parts.count > AMBIENT_LIMIT) return;
    this.parts.spawn(x, y, vx, vy, life, size, color, 1 | 2);
  }
  ring(x: number, y: number, r: number, color: string, o: { life?: number; thin?: boolean } = {}): void {
    const life = o.life || 0.45;
    this.rings.push({ x, y, r, color, life, max: life, thin: !!o.thin });
  }
  nova(n: NovaFx['n'], color: string, thin?: boolean): void {
    this.novas.push({ n, color, thin });
  }
  beam(x1: number, y1: number, x2: number, y2: number, color: string, w?: number, life?: number): void {
    const l = life || 0.15;
    this.beams.push({ x1, y1, x2, y2, color, w: w || 3, life: l, max: l, seed: rnd() * 1000 });
  }
  line(x: number, y: number, angle: number, len: number, width: number, color: string): void {
    this.lines.push({ x, y, angle, len, width, color, life: 0.4, max: 0.4 });
    this.burst(x + (Math.cos(angle) * len) / 2, y + (Math.sin(angle) * len) / 2, color, 8, { speed: 80, life: 0.4 });
  }
  arc(x: number, y: number, angle: number, r: number, halfArc: number, color: string, thin?: boolean): void {
    const l = thin ? 0.16 : 0.28;
    this.arcs.push({ x, y, angle, r, halfArc, color, life: l, max: l, thin });
  }
  lob(x: number, y: number, tx: number, ty: number, t: number, color: string): void {
    this.lobs.push({ x, y, tx, ty, t: 0, max: t, color });
  }
  meteor(x: number, y: number, t: number): void {
    this.meteors.push({ x, y, t: 0, max: t });
    this.tele.push({ type: 'circle', x, y, r: 60, t: 0, max: t, color: '#ff7043' });
  }
  arrowFall(x: number, y: number, color: string, t: number): void {
    this.meteors.push({ x, y, t: 0, max: t, small: true, color });
  }
  telegraphLine(e: Enemy, px: number, py: number, t: number): void {
    this.tele.push({ type: 'line', e, px, py, t: 0, max: t });
  }
  telegraphCircle(x: number, y: number, r: number, t: number, color?: string): void {
    this.tele.push({ type: 'circle', x, y, r, t: 0, max: t, color });
  }
  explosion(x: number, y: number, r: number, color: string, small?: boolean): void {
    const l = small ? 0.25 : 0.45;
    this.explosions.push({ x, y, r, color, life: l, max: l });
    this.burst(x, y, color, small ? 6 : Math.min(30, 8 + r * 0.25), { speed: r * 2.2, life: 0.5, size: small ? 3 : 5 });
    if (!small) this.burst(x, y, '#fff', 4, { speed: r, life: 0.3, size: 3 });
  }
  lightning(x: number, y: number, color?: string): void {
    const c = color || '#fde047';
    this.bolts.push({ x, y, color: c, life: 0.22, max: 0.22, seed: rnd() * 100 });
    this.burst(x, y, c, 10, { speed: 120, life: 0.35, size: 3 });
  }
  whip(x: number, y: number, sd: number, len: number, hgt: number, color: string): void {
    this.whips.push({ x, y, sd, len, hgt, color, life: 0.2, max: 0.2 });
  }
  shake(a: number): void {
    this.shakeAmt = Math.max(this.shakeAmt, a * this.shakeMul);
  }
  flash(color: string, a: number): void {
    this.flashCol = color;
    this.flashA = Math.max(this.flashA, a);
  }
  text(x: number, y: number, text: string, color: string, small?: boolean): void {
    if (this.texts.length > 160) this.texts.shift();
    this.texts.push({ x, y, text, color, life: 1.0, max: 1.0, vy: -40, small });
  }
  dmgNumber(x: number, y: number, dmg: number, crit: boolean, _boss?: boolean): void {
    if (!this.dmgEnabled) return;
    if (this.texts.length > 140 && !crit) return;
    const l = crit ? 0.9 : 0.6;
    this.texts.push({
      x: x + rr(-8, 8),
      y,
      text: U.fmt(dmg),
      color: crit ? '#fde047' : '#fff',
      life: l,
      max: l,
      vy: crit ? -70 : -45,
      crit,
      dmg: true,
    });
  }
  death(e: Enemy): void {
    const col = e.def.col;
    this.burst(e.x, e.y, col.body, e.boss ? 60 : e.elite ? 30 : 8, {
      speed: e.boss ? 260 : 110,
      life: 0.6,
      size: e.boss ? 7 : 4,
      add: false,
      grav: 200,
    });
    this.burst(e.x, e.y, col.eye, e.boss ? 30 : 4, { speed: 100, life: 0.5, size: 3 });
    if (this.corpses.length < 60)
      this.corpses.push({
        x: e.x,
        y: e.y,
        type: e.type,
        r: e.r,
        col,
        tier: e.boss ? 0 : e.elite ? 3 : e.tier,
        flip: e.flip,
        life: 1.2,
        max: 1.2,
      });
  }

  /** Advance all effects by the real frame time (not called while paused). */
  update(dt: number): void {
    this.parts.update(dt);
    decay(this.rings, dt);
    decay(this.beams, dt);
    decay(this.lines, dt);
    decay(this.arcs, dt);
    decay(this.explosions, dt);
    decay(this.bolts, dt);
    decay(this.whips, dt);
    decay(this.corpses, dt);
    // Frame-rate independent equivalent of the original per-60Hz-frame `vy *= 0.92`.
    const textDamp = Math.pow(0.92, dt * 60);
    let w = 0;
    for (const t of this.texts) {
      t.life -= dt;
      t.y += t.vy * dt;
      t.vy *= textDamp;
      if (t.life > 0) this.texts[w++] = t;
    }
    this.texts.length = w;
    w = 0;
    for (const n of this.novas) if (!n.n.dead) this.novas[w++] = n;
    this.novas.length = w;
    advance(this.lobs, dt);
    advance(this.meteors, dt);
    advance(this.tele, dt);
    this.shakeAmt *= Math.pow(0.02, dt);
    if (this.shakeAmt < 0.3) this.shakeAmt = 0;
    this.flashA = Math.max(0, this.flashA - dt * 2.2);
  }
}
