/**
 * Visual effects state (particles, rings, beams, damage numbers, screen shake…).
 *
 * Pure data with no DOM access: the simulation spawns effects, the renderer draws them. Effects
 * never feed back into gameplay, so they use `Math.random()` rather than the deterministic sim RNG.
 *
 * Particles — by far the most numerous effect — live in a struct-of-arrays pool of typed arrays:
 * zero allocation per particle, cache-friendly updates, and O(1) swap-removal. Particles can be
 * flat glows, streaks, souls that home in on the player, or pseudo-3D debris with a height `z` that
 * falls under gravity, bounces and skids along the ground.
 */
import { TAU, U } from '../core/util';
import type { Enemy } from '../game/types';

const MAX_PARTICLES = 6144;
/** Bursts are skipped above this count so ambient/trail particles always have headroom. */
const BURST_LIMIT = 4800;
const AMBIENT_LIMIT = 4200;

const rnd = Math.random;
const rr = (a: number, b: number) => a + rnd() * (b - a);

/** Particle flags. */
export const PF = {
  /** Additive glow (else a solid square, drawn lit, in the normal pass). */
  GLOW: 1,
  /** Ambient: no damping, sine fade in/out. */
  AMBIENT: 2,
  /** Pseudo-3D debris: falls along `z` under gravity, bounces, skids and spins. */
  DEBRIS: 4,
  /** Drawn as a streak along its velocity. */
  STREAK: 8,
  /** Homes in on `FX.soulX/soulY` (souls flowing into the champion) and dies on arrival. */
  SOUL: 16,
} as const;

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
  /** Height above the ground (debris) and its velocity. */
  readonly z = new Float32Array(MAX_PARTICLES);
  readonly vz = new Float32Array(MAX_PARTICLES);
  readonly rot = new Float32Array(MAX_PARTICLES);
  readonly vrot = new Float32Array(MAX_PARTICLES);
  readonly life = new Float32Array(MAX_PARTICLES);
  readonly max = new Float32Array(MAX_PARTICLES);
  readonly size = new Float32Array(MAX_PARTICLES);
  readonly grav = new Float32Array(MAX_PARTICLES);
  readonly r = new Uint8Array(MAX_PARTICLES);
  readonly g = new Uint8Array(MAX_PARTICLES);
  readonly b = new Uint8Array(MAX_PARTICLES);
  /** See {@link PF}. */
  readonly flags = new Uint8Array(MAX_PARTICLES);

  /** Spawn a particle; returns its index (or -1 when the pool is full). */
  spawn(x: number, y: number, vx: number, vy: number, life: number, size: number, color: string, flags: number, grav = 0): number {
    if (this.count >= this.cap) return -1;
    const i = this.count++;
    const c = U.hexToRgb(color);
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.z[i] = 0;
    this.vz[i] = 0;
    this.rot[i] = 0;
    this.vrot[i] = 0;
    this.life[i] = life;
    this.max[i] = life;
    this.size[i] = size;
    this.grav[i] = grav;
    this.r[i] = c[0];
    this.g[i] = c[1];
    this.b[i] = c[2];
    this.flags[i] = flags;
    return i;
  }

  private kill(i: number): void {
    const j = --this.count;
    if (i === j) return;
    this.x[i] = this.x[j]!;
    this.y[i] = this.y[j]!;
    this.vx[i] = this.vx[j]!;
    this.vy[i] = this.vy[j]!;
    this.z[i] = this.z[j]!;
    this.vz[i] = this.vz[j]!;
    this.rot[i] = this.rot[j]!;
    this.vrot[i] = this.vrot[j]!;
    this.life[i] = this.life[j]!;
    this.max[i] = this.max[j]!;
    this.size[i] = this.size[j]!;
    this.grav[i] = this.grav[j]!;
    this.r[i] = this.r[j]!;
    this.g[i] = this.g[j]!;
    this.b[i] = this.b[j]!;
    this.flags[i] = this.flags[j]!;
  }

  /** Advance by `dt`; souls home towards (sx, sy). */
  update(dt: number, sx = 0, sy = 0): void {
    const damp = Math.pow(0.1, dt),
      skid = Math.pow(0.004, dt);
    for (let i = this.count - 1; i >= 0; i--) {
      const life = this.life[i]! - dt;
      if (life <= 0) {
        this.kill(i);
        continue;
      }
      this.life[i] = life;
      const f = this.flags[i]!;
      if (f & PF.SOUL) {
        // accelerate towards the champion; the pull grows as the soul ages so it always arrives
        const dx = sx - this.x[i]!,
          dy = sy - 20 - this.y[i]!,
          d = Math.hypot(dx, dy) || 1,
          age = this.max[i]! - life,
          pull = 900 + age * 2600;
        this.vx[i] = this.vx[i]! * Math.pow(0.05, dt) + (dx / d) * pull * dt;
        this.vy[i] = this.vy[i]! * Math.pow(0.05, dt) + (dy / d) * pull * dt;
        if (d < 18 && age > 0.15) {
          this.kill(i);
          continue;
        }
      }
      this.x[i]! += this.vx[i]! * dt;
      this.y[i]! += this.vy[i]! * dt;
      if (f & PF.DEBRIS) {
        this.vz[i]! -= 980 * dt;
        this.z[i]! += this.vz[i]! * dt;
        this.rot[i]! += this.vrot[i]! * dt;
        if (this.z[i]! <= 0) {
          this.z[i] = 0;
          if (this.vz[i]! < -60) {
            // bounce, losing most of the energy; the ground steals spin and speed
            this.vz[i] = -this.vz[i]! * 0.38;
            this.vx[i]! *= 0.6;
            this.vy[i]! *= 0.6;
            this.vrot[i]! *= 0.5;
          } else {
            this.vz[i] = 0;
            this.vx[i]! *= skid;
            this.vy[i]! *= skid;
            this.vrot[i]! *= skid;
          }
        }
        continue;
      }
      if (!(f & PF.SOUL)) this.vy[i]! += this.grav[i]! * dt;
      if (!(f & (PF.AMBIENT | PF.SOUL))) {
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
  /** Large callout (reactions, streaks) that pops in and lingers. */
  big?: boolean;
  /** Damage numbers: accumulated value, spawn position (for merging) and time since the last merge. */
  value?: number;
  x0?: number;
  y0?: number;
  pop?: number;
  merges?: number;
}
/** Ground mark left by explosions and deaths; drawn under everything, fades slowly. */
export interface DecalFx extends Timed {
  x: number;
  y: number;
  r: number;
  rot: number;
  color: string;
  kind: 'scorch' | 'splat';
}
export interface CorpseFx extends Timed {
  x: number;
  y: number;
  type: string;
  r: number;
  col: Enemy['def']['col'];
  tier: number;
  flip: number;
  /** Direction it topples (−1 / 1) and the dissolve noise seed. */
  fall: number;
  seed: number;
  boss: boolean;
}
/** Screen refraction ring in world space (explosions, slams). */
export interface WaveFx extends Timed {
  x: number;
  y: number;
  maxR: number;
  str: number;
}
/** Short coloured light flash (lightning strikes, muzzle flashes). */
export interface FlashLightFx extends Timed {
  x: number;
  y: number;
  r: number;
  color: string;
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
/** A scheduled presentation callback (boss death sequences), in real seconds. */
interface Cue {
  t: number;
  fn: () => void;
}

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
  decals: DecalFx[] = [];
  waves: WaveFx[] = [];
  flashLights: FlashLightFx[] = [];
  private cues: Cue[] = [];
  shakeAmt = 0;
  /** Camera zoom offset from punches (+ in, − out); springs back to 0. */
  zoom = 0;
  private zoomV = 0;
  /** Directional damage indicator: angle towards the attacker (null = all around) and intensity. */
  hurtAng: number | null = null;
  hurtA = 0;
  /** Slow motion / hit-stop requested by the simulation: real-time scale and seconds remaining. */
  private warpScale = 1;
  private warpT = 0;
  private warpMax = 0;
  flashA = 0;
  flashCol = '#fff';
  dmgEnabled = true;
  shakeMul = 1;
  /** Scales full-screen flashes (reduced motion). */
  flashMul = 1;
  /** Where souls fly to (the champion), set by the renderer each frame. */
  soulX = 0;
  soulY = 0;

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
    this.decals = [];
    this.waves = [];
    this.flashLights = [];
    this.cues = [];
    this.shakeAmt = 0;
    this.flashA = 0;
    this.zoom = this.zoomV = 0;
    this.hurtA = 0;
    this.warpScale = 1;
    this.warpT = this.warpMax = 0;
  }

  /**
   * Request slow motion: simulation time runs at `scale` × real time for `dur` real seconds, easing
   * back to normal over the last half. The strongest active request wins. Presentation-only: the
   * simulation still advances in identical fixed steps, so determinism is unaffected.
   */
  timeWarp(scale: number, dur: number): void {
    if (this.warpT > 0 && scale > this.warpScale) return;
    this.warpScale = scale;
    this.warpT = this.warpMax = dur;
  }
  /** Advance the time warp by real seconds and return the current time scale. */
  stepWarp(realDt: number): number {
    if (this.warpT <= 0) return 1;
    this.warpT -= realDt;
    if (this.warpT <= 0) return 1;
    const k = Math.min(1, this.warpT / (this.warpMax * 0.5));
    return 1 - (1 - this.warpScale) * k;
  }
  /** Kick the camera zoom (positive = in). */
  zoomPunch(a: number): void {
    this.zoomV += a * 14 * this.shakeMul;
  }
  /** The player was hurt: `ang` points at the attacker (null when unknown), `k` 0..1 severity. */
  hurt(ang: number | null, k: number): void {
    this.hurtAng = ang;
    this.hurtA = Math.max(this.hurtA, 0.35 + k * 0.65);
  }
  /** Big floating callout (reaction names, streak tiers). */
  callout(x: number, y: number, text: string, color: string): void {
    if (this.texts.length > 150) return;
    // in a dense horde reactions fire constantly: a few readable callouts beat a wall of text
    let big = 0;
    for (const t of this.texts) if (t.big && ++big >= 3) return;
    this.texts.push({ x, y, text, color, life: 1.1, max: 1.1, vy: -55, big: true });
  }
  decal(x: number, y: number, r: number, color: string, kind: DecalFx['kind'], life = 9): void {
    if (this.decals.length >= 220) this.decals.shift();
    this.decals.push({ x, y, r, color, kind, rot: rnd() * TAU, life, max: life });
  }
  /** A refraction ring rippling out from (x, y) to `maxR` world units; `str` is its displacement in pixels. */
  shockwave(x: number, y: number, maxR: number, str = 14, life = 0.55): void {
    if (this.shakeMul <= 0) return; // reduced motion
    if (this.waves.length >= 8) this.waves.shift();
    this.waves.push({ x, y, maxR, str, life, max: life });
  }
  /** A brief coloured light at (x, y). */
  flashLight(x: number, y: number, r: number, color: string, life = 0.18): void {
    if (this.flashLights.length >= 48) this.flashLights.shift();
    this.flashLights.push({ x, y, r, color, life, max: life });
  }

  burst(x: number, y: number, color: string, n: number, o: BurstOpts = {}): void {
    const P = this.parts;
    if (P.count > BURST_LIMIT) return;
    const speed = o.speed || 90,
      life = o.life || 0.5,
      size = o.size || 4,
      up = o.up ? 60 : 0;
    const flags = o.add !== false ? PF.GLOW : 0;
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
  /**
   * Physical chunks flung from (x, y): they arc up, fall, bounce and skid to rest, spinning.
   * `dirX/dirY` biases the throw (a knockback direction); `h` is the launch height.
   */
  debris(x: number, y: number, color: string, n: number, speed = 140, size = 4, life = 1.4, dirX = 0, dirY = 0, h = 10): void {
    const P = this.parts;
    if (P.count > BURST_LIMIT) return;
    for (let k = 0; k < n; k++) {
      const a = rnd() * TAU,
        sp = speed * (0.35 + rnd() * 0.75);
      const i = P.spawn(
        x,
        y,
        Math.cos(a) * sp + dirX * speed * 0.8,
        Math.sin(a) * sp * 0.6 + dirY * speed * 0.6,
        life * (0.7 + rnd() * 0.6),
        size * (0.6 + rnd() * 0.9),
        color,
        PF.DEBRIS,
      );
      if (i < 0) return;
      P.z[i] = h * (0.5 + rnd());
      P.vz[i] = rr(140, 330) * (speed / 140);
      P.rot[i] = rnd() * TAU;
      P.vrot[i] = rr(-14, 14);
    }
  }
  /** Fast streaks fanning out around `angle` (hit sparks, slashes). */
  sparks(x: number, y: number, angle: number, spread: number, color: string, n: number, speed = 380, life = 0.22, size = 2.2): void {
    const P = this.parts;
    if (P.count > BURST_LIMIT) return;
    for (let k = 0; k < n; k++) {
      const a = angle + (rnd() - 0.5) * spread * 2,
        sp = speed * (0.5 + rnd() * 0.7);
      P.spawn(x, y, Math.cos(a) * sp, Math.sin(a) * sp, life * (0.6 + rnd() * 0.6), size, color, PF.GLOW | PF.STREAK);
    }
  }
  /** Souls rising from (x, y) and streaming into the champion. */
  souls(x: number, y: number, color: string, n: number, size = 4): void {
    const P = this.parts;
    if (P.count > AMBIENT_LIMIT) return;
    for (let k = 0; k < n; k++) {
      const a = rnd() * TAU;
      P.spawn(
        x,
        y,
        Math.cos(a) * rr(60, 160),
        Math.sin(a) * rr(40, 120) - rr(80, 160),
        rr(1.6, 2.4),
        size * rr(0.7, 1.2),
        color,
        PF.GLOW | PF.SOUL,
      );
    }
  }
  /** An enemy was struck: sparks flying along the hit direction (kx, ky). */
  hit(x: number, y: number, kx: number, ky: number, color: string, crit = false): void {
    if (this.parts.count > BURST_LIMIT - 400) return;
    const a = Math.atan2(ky, kx);
    this.sparks(x, y, a, crit ? 0.7 : 0.45, crit ? '#fff7c2' : color, crit ? 7 : 3, crit ? 520 : 360, crit ? 0.28 : 0.18, crit ? 2.8 : 2);
    if (crit) this.flashLight(x, y, 70, '#ffe9a8', 0.12);
  }
  trail(x: number, y: number, color: string, size?: number): void {
    if (this.parts.count > BURST_LIMIT) return;
    this.parts.spawn(x, y, rr(-10, 10), rr(-10, 10), 0.25, size || 4, color, PF.GLOW);
  }
  ambient(x: number, y: number, vx: number, vy: number, life: number, size: number, color: string): void {
    if (this.parts.count > AMBIENT_LIMIT) return;
    this.parts.spawn(x, y, vx, vy, life, size, color, PF.GLOW | PF.AMBIENT);
  }
  ring(x: number, y: number, r: number, color: string, o: { life?: number; thin?: boolean } = {}): void {
    const life = o.life || 0.45;
    this.rings.push({ x, y, r, color, life, max: life, thin: !!o.thin });
    if (!o.thin && r >= 100) this.shockwave(x, y, r, Math.min(18, 6 + r * 0.04), 0.45);
  }
  nova(n: NovaFx['n'], color: string, thin?: boolean): void {
    this.novas.push({ n, color, thin });
  }
  beam(x1: number, y1: number, x2: number, y2: number, color: string, w?: number, life?: number): void {
    const l = life || 0.15;
    this.beams.push({ x1, y1, x2, y2, color, w: w || 3, life: l, max: l, seed: rnd() * 1000 });
    if (this.flashLights.length < 40) this.flashLight(x2, y2, 60 + (w || 3) * 10, color, l);
  }
  line(x: number, y: number, angle: number, len: number, width: number, color: string): void {
    this.lines.push({ x, y, angle, len, width, color, life: 0.4, max: 0.4 });
    this.burst(x + (Math.cos(angle) * len) / 2, y + (Math.sin(angle) * len) / 2, color, 8, { speed: 80, life: 0.4 });
  }
  arc(x: number, y: number, angle: number, r: number, halfArc: number, color: string, thin?: boolean): void {
    const l = thin ? 0.16 : 0.28;
    this.arcs.push({ x, y, angle, r, halfArc, color, life: l, max: l, thin });
    if (!thin) this.sparks(x + Math.cos(angle) * r * 0.8, y + Math.sin(angle) * r * 0.8, angle, halfArc * 0.6, color, 4, 300, 0.2);
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
    const l = small ? 0.25 : 0.5;
    this.explosions.push({ x, y, r, color, life: l, max: l });
    if (!small || r > 50) this.decal(x, y, r * 0.75, color, 'scorch', 6);
    this.burst(x, y, color, small ? 6 : Math.min(30, 8 + r * 0.25), { speed: r * 2.2, life: 0.5, size: small ? 3 : 5 });
    if (!small) {
      this.burst(x, y, '#fff', 4, { speed: r, life: 0.3, size: 3 });
      this.sparks(x, y, 0, Math.PI, color, Math.min(18, 6 + r * 0.1), r * 4, 0.3, 2.6);
      this.debris(x, y, '#2a2024', Math.min(10, 3 + Math.floor(r / 25)), r * 1.6, 3.5, 1.2);
      if (r >= 55) this.shockwave(x, y, r * 1.6, Math.min(22, 6 + r * 0.06));
    }
  }
  lightning(x: number, y: number, color?: string): void {
    const c = color || '#fde047';
    this.bolts.push({ x, y, color: c, life: 0.22, max: 0.22, seed: rnd() * 100 });
    this.burst(x, y, c, 10, { speed: 120, life: 0.35, size: 3 });
    this.sparks(x, y, -Math.PI / 2, Math.PI, '#fffbe0', 6, 420, 0.2);
    this.flashLight(x, y, 220, c, 0.22);
  }
  whip(x: number, y: number, sd: number, len: number, hgt: number, color: string): void {
    this.whips.push({ x, y, sd, len, hgt, color, life: 0.2, max: 0.2 });
  }
  shake(a: number): void {
    this.shakeAmt = Math.max(this.shakeAmt, a * this.shakeMul);
  }
  flash(color: string, a: number): void {
    this.flashCol = color;
    this.flashA = Math.max(this.flashA, a * this.flashMul);
  }
  text(x: number, y: number, text: string, color: string, small?: boolean): void {
    if (this.texts.length > 160) this.texts.shift();
    this.texts.push({ x, y, text, color, life: 1.0, max: 1.0, vy: -40, small });
  }
  /**
   * Floating damage number. Hits landing on the same spot within a short window merge into one
   * number that grows and re-pops, so a horde under fire reads as a few climbing totals instead of a
   * wall of digits.
   */
  dmgNumber(x: number, y: number, dmg: number, crit: boolean, _boss?: boolean): void {
    if (!this.dmgEnabled || dmg <= 0) return;
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i]!;
      if (!t.dmg || !!t.crit !== crit || t.max - t.life > 0.45) continue;
      if (Math.abs(t.x0! - x) > 22 || Math.abs(t.y0! - y) > 22) continue;
      t.value! += dmg;
      t.text = U.fmt(t.value!);
      t.life = t.max;
      t.pop = 0;
      t.merges = Math.min(8, (t.merges ?? 0) + 1);
      t.vy = Math.min(t.vy, crit ? -60 : -30);
      return;
    }
    if (this.texts.length > (crit ? 90 : 70)) return;
    const l = crit ? 0.9 : 0.65;
    this.texts.push({
      x: x + rr(-8, 8),
      y,
      x0: x,
      y0: y,
      text: U.fmt(dmg),
      value: dmg,
      color: crit ? '#fde047' : '#fff',
      life: l,
      max: l,
      vy: crit ? -80 : -48,
      crit,
      dmg: true,
      pop: 0,
      merges: 0,
    });
  }
  death(e: Enemy): void {
    const col = e.def.col;
    // the killing blow's knockback (if any) throws the remains
    const sp = Math.hypot(e.vx, e.vy),
      kx = sp > 1 ? e.vx / sp : 0,
      ky = sp > 1 ? e.vy / sp : 0;
    const big = e.boss ? 3 : e.elite ? 2 : 1;
    this.debris(
      e.x,
      e.y,
      col.body,
      e.boss ? 26 : e.elite ? 12 : 4 + Math.floor(e.r / 6),
      110 + e.r * 3,
      e.boss ? 7 : 3 + e.r * 0.12,
      1.5,
      kx,
      ky,
      e.r * 0.5,
    );
    this.burst(e.x, e.y, col.eye, e.boss ? 30 : 4 * big, { speed: 100, life: 0.5, size: 3 });
    // souls stream into the champion — one wisp per kill, a torrent from elites and Heralds
    if (e.boss) this.souls(e.x, e.y - e.r * 0.3, col.eye, 40, 7);
    else if (e.elite) this.souls(e.x, e.y - e.r * 0.3, col.eye, 10, 6);
    else if (rnd() < 0.5) this.souls(e.x, e.y - e.r * 0.3, col.eye, 1, 4);
    if (e.r >= 12 && rnd() < (e.boss || e.elite ? 1 : 0.35))
      this.decal(e.x, e.y + e.r * 0.4, e.r * (e.boss ? 1.6 : 1.1), col.body, 'splat', e.boss ? 20 : 8);
    if (this.corpses.length < 90 || e.boss || e.elite) {
      if (this.corpses.length >= 120) this.corpses.shift();
      this.corpses.push({
        x: e.x,
        y: e.y,
        type: e.type,
        r: e.r,
        col,
        tier: e.boss ? 0 : e.elite ? 3 : e.tier,
        flip: e.flip,
        fall: kx !== 0 ? Math.sign(kx) : rnd() < 0.5 ? -1 : 1,
        seed: rnd() * 50,
        boss: e.boss,
        life: e.boss ? 2.6 : 0.95,
        max: e.boss ? 2.6 : 0.95,
      });
    }
    if (e.boss) this.bossDeath(e.x, e.y, e.r, col.eye, col.body);
  }
  /** A Herald's fall: a chain of eruptions across the body, then one last blast. */
  private bossDeath(x: number, y: number, r: number, eye: string, body: string): void {
    for (let i = 0; i < 9; i++) {
      const t = 0.12 + i * 0.16;
      this.cues.push({
        t,
        fn: () => {
          const a = rnd() * TAU,
            d = rnd() * r * 0.9;
          this.explosion(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.7, r * rr(0.45, 0.8), i % 2 ? eye : body);
          this.shake(6);
        },
      });
    }
    this.cues.push({
      t: 1.65,
      fn: () => {
        this.explosion(x, y, r * 2.4, eye);
        this.shockwave(x, y, r * 7, 30, 0.9);
        this.flash('#fff', 0.5);
        this.shake(20);
        this.debris(x, y, body, 30, 420, 8, 2.2, 0, 0, r);
        this.souls(x, y, eye, 30, 8);
      },
    });
  }

  /** Advance all effects by the real frame time (not called while paused). */
  update(dt: number): void {
    this.parts.update(dt, this.soulX, this.soulY);
    if (this.cues.length) {
      let w = 0;
      for (const c of this.cues) {
        c.t -= dt;
        if (c.t <= 0) c.fn();
        else this.cues[w++] = c;
      }
      this.cues.length = w;
    }
    decay(this.rings, dt);
    decay(this.beams, dt);
    decay(this.lines, dt);
    decay(this.arcs, dt);
    decay(this.explosions, dt);
    decay(this.bolts, dt);
    decay(this.whips, dt);
    decay(this.corpses, dt);
    decay(this.decals, dt);
    decay(this.waves, dt);
    decay(this.flashLights, dt);
    // critically damped-ish spring back to zero zoom
    this.zoomV += (-this.zoom * 90 - this.zoomV * 14) * dt;
    this.zoom = Math.max(-0.25, Math.min(0.25, this.zoom + this.zoomV * dt));
    this.hurtA = Math.max(0, this.hurtA - dt * 1.8);
    // Frame-rate independent equivalent of the original per-60Hz-frame `vy *= 0.92`.
    const textDamp = Math.pow(0.92, dt * 60);
    let w = 0;
    for (const t of this.texts) {
      t.life -= dt;
      t.y += t.vy * dt;
      t.vy *= textDamp;
      if (t.pop != null) t.pop += dt;
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
