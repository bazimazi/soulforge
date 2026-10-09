/* SOULFORGE — procedural sprite factory. Everything is drawn at load time into offscreen canvases. */
import { U } from '../core/util';
import type { CharacterDef, EnemyColors, IconSpec, StagePalette } from '../game/types';

type Ctx = CanvasRenderingContext2D;
/**
 * A sprite canvas that carries its draw origin (anchor point, in canvas pixels) and its pixel density:
 * `res` canvas pixels per world unit (the backends draw it at width / res).
 */
export type Sprite = HTMLCanvasElement & { ox: number; oy: number; res?: number };
/** The parts of a character definition the sprite painter reads. */
export type CharacterArt = Pick<CharacterDef, 'id' | 'colors' | 'head' | 'weaponArt'> & { longHair?: boolean };
/** An icon glyph spec; `bg` optionally overrides the background tint. */
export type IconArt = IconSpec & { bg?: string };
export interface PropPalette {
  id?: string;
  propDark?: string;
  propLight?: string;
  crystal?: string;
}
export type GroundPalette = Pick<StagePalette, 'id' | 'ground' | 'groundDark' | 'groundLight'> & { seed?: number; rune?: string; tiles?: number };
type Paint = string | CanvasGradient;
type Pt = readonly [number, number];
type Stop = readonly [offset: number, color: string];

/** Generated canvases and data URLs, keyed by every parameter that affects the output. */
const cache = new Map<string, HTMLCanvasElement | string>();
/** Derived sprites (hit-flash silhouettes, colour tints) keyed by their source canvas. */
const flashCache = new WeakMap<HTMLCanvasElement, Sprite>();
const tintCache = new WeakMap<HTMLCanvasElement, Map<string, Sprite>>();

function cached<T extends HTMLCanvasElement | string>(key: string): T | undefined {
  return cache.get(key) as T | undefined;
}
function ctx2d(c: HTMLCanvasElement): Ctx {
  return c.getContext('2d')!;
}
function withOrigin(c: HTMLCanvasElement, ox: number, oy: number, res = 1): Sprite {
  const s = c as Sprite;
  s.ox = ox * res;
  s.oy = oy * res;
  if (res !== 1) s.res = res;
  return s;
}

/**
 * World sprites are baked at RES canvas pixels per world unit: the camera zooms in up to ~2× on
 * Retina screens, and 1:1 bakes looked soft there. Pivots and sizes stay in world units.
 */
const RES = 2;
/** A RES-scaled canvas of `w`×`h` world units, its context pre-scaled so drawing code stays in units. */
function mkRes(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = mk(w * RES, h * RES), x = ctx2d(c);
  x.scale(RES, RES);
  return [c, x];
}
/** Wrap a sprite in a dark outline (silhouette stamped around it) so it reads against any ground. */
function outlined(src: HTMLCanvasElement, px: number, color = 'rgba(8,5,12,0.9)'): HTMLCanvasElement {
  const sil = mk(src.width, src.height), sx = ctx2d(sil);
  sx.drawImage(src, 0, 0);
  sx.globalCompositeOperation = 'source-in';
  sx.fillStyle = color; sx.fillRect(0, 0, sil.width, sil.height);
  const out = mk(src.width, src.height), o = ctx2d(out);
  for (let i = 0; i < 8; i++) { const a = (i / 8) * U.TAU; o.drawImage(sil, Math.round(Math.cos(a) * px), Math.round(Math.sin(a) * px)); }
  o.drawImage(src, 0, 0);
  return out;
}

function mk(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
  return c;
}

/* ---------- glow / orbs ---------- */
function glow(color: string, r: number, inner = 0.0): HTMLCanvasElement {
  const key = 'glow|' + color + '|' + r + '|' + inner;
  const hit = cached<HTMLCanvasElement>(key); if (hit) return hit;
  const c = mk(r * 2, r * 2), x = ctx2d(c);
  const g = x.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, U.rgba(color, 1));
  g.addColorStop(inner + (1 - inner) * 0.3, U.rgba(color, 0.55));
  g.addColorStop(inner + (1 - inner) * 0.65, U.rgba(color, 0.15));
  g.addColorStop(1, U.rgba(color, 0));
  x.fillStyle = g; x.fillRect(0, 0, r * 2, r * 2);
  cache.set(key, c);
  return c;
}
function light(r: number): HTMLCanvasElement {
  const key = 'light|' + r;
  const hit = cached<HTMLCanvasElement>(key); if (hit) return hit;
  const c = mk(r * 2, r * 2), x = ctx2d(c);
  const g = x.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.7)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.2)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, r * 2, r * 2);
  cache.set(key, c);
  return c;
}
function orb(color: string, r: number, core = '#ffffff'): HTMLCanvasElement {
  const key = 'orb|' + color + '|' + r + '|' + core;
  const hit = cached<HTMLCanvasElement>(key); if (hit) return hit;
  const R = r * 2.6, [c, x] = mkRes(R * 2, R * 2);
  x.drawImage(glow(color, R * RES), 0, 0, R * 2, R * 2);
  const g = x.createRadialGradient(R - r * 0.3, R - r * 0.3, 0, R, R, r);
  g.addColorStop(0, core); g.addColorStop(0.5, color); g.addColorStop(1, U.rgba(color, 0.7));
  x.fillStyle = g; x.beginPath(); x.arc(R, R, r, 0, U.TAU); x.fill();
  const sp = withOrigin(c, R, R, RES);
  cache.set(key, sp);
  return sp;
}
/* elongated projectile (bolt/arrow/dagger) pointing +x */
function bolt(color: string, len: number, wid: number, kind = 'bolt'): Sprite {
  const key = 'bolt|' + color + '|' + len + '|' + wid + '|' + kind;
  const hit = cached<Sprite>(key); if (hit) return hit;
  const pad = wid * 2.5, W = len + pad * 2, H = wid * 2 + pad * 2;
  const [c, x] = mkRes(W, H);
  const cx = W / 2, cy = H / 2;
  x.globalCompositeOperation = 'lighter';
  x.drawImage(glow(color, Math.max(len, wid) * 0.7), cx - Math.max(len, wid) * 0.7, cy - Math.max(len, wid) * 0.7);
  x.globalCompositeOperation = 'source-over';
  x.translate(cx, cy);
  x.shadowColor = color; x.shadowBlur = wid * 1.5;
  if (kind === 'bolt') {
    const g = x.createLinearGradient(-len / 2, 0, len / 2, 0);
    g.addColorStop(0, U.rgba(color, 0)); g.addColorStop(0.6, color); g.addColorStop(1, '#fff');
    x.fillStyle = g; x.beginPath();
    x.moveTo(-len / 2, 0); x.lineTo(len * 0.2, -wid); x.lineTo(len / 2, 0); x.lineTo(len * 0.2, wid); x.closePath(); x.fill();
  } else if (kind === 'arrow') {
    x.strokeStyle = '#c9b07a'; x.lineWidth = wid * 0.5; x.beginPath(); x.moveTo(-len / 2, 0); x.lineTo(len * 0.3, 0); x.stroke();
    x.fillStyle = color; x.beginPath(); x.moveTo(len / 2, 0); x.lineTo(len * 0.2, -wid); x.lineTo(len * 0.28, 0); x.lineTo(len * 0.2, wid); x.closePath(); x.fill();
    x.fillStyle = '#eee'; x.beginPath(); x.moveTo(-len / 2, 0); x.lineTo(-len * 0.35, -wid * 0.8); x.lineTo(-len * 0.3, 0); x.lineTo(-len * 0.35, wid * 0.8); x.closePath(); x.fill();
  } else if (kind === 'dagger') {
    x.fillStyle = '#ddd'; x.beginPath(); x.moveTo(len / 2, 0); x.lineTo(-len * 0.1, -wid); x.lineTo(-len * 0.1, wid); x.closePath(); x.fill();
    x.fillStyle = color; x.fillRect(-len * 0.45, -wid * 0.5, len * 0.35, wid);
    x.fillStyle = '#fff'; x.beginPath(); x.moveTo(len / 2, 0); x.lineTo(-len * 0.1, -wid * 0.3); x.lineTo(-len * 0.1, 0); x.closePath(); x.fill();
  } else if (kind === 'shard') {
    const g = x.createLinearGradient(0, -wid, 0, wid);
    g.addColorStop(0, '#fff'); g.addColorStop(0.5, color); g.addColorStop(1, U.shade(color, -0.3));
    x.fillStyle = g; x.beginPath();
    x.moveTo(len / 2, 0); x.lineTo(0, -wid); x.lineTo(-len / 2, 0); x.lineTo(0, wid); x.closePath(); x.fill();
  } else if (kind === 'axe') {
    x.strokeStyle = '#8a6a3a'; x.lineWidth = wid * 0.6; x.beginPath(); x.moveTo(-len / 2, 0); x.lineTo(len * 0.25, 0); x.stroke();
    x.fillStyle = color; x.beginPath(); x.moveTo(len * 0.1, -wid * 1.6); x.quadraticCurveTo(len * 0.7, 0, len * 0.1, wid * 1.6); x.quadraticCurveTo(len * 0.3, 0, len * 0.1, -wid * 1.6); x.fill();
    x.fillStyle = '#fff8'; x.beginPath(); x.moveTo(len * 0.25, -wid * 1.2); x.quadraticCurveTo(len * 0.6, 0, len * 0.25, wid * 1.2); x.quadraticCurveTo(len * 0.4, 0, len * 0.25, -wid * 1.2); x.fill();
  }
  const sp = withOrigin(c, cx, cy, RES);
  cache.set(key, sp);
  return sp;
}

/* ---------- helpers ---------- */
function rgrad(x: Ctx, cx: number, cy: number, r: number, stops: readonly Stop[]): CanvasGradient {
  const g = x.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.05, cx, cy, r);
  stops.forEach(([o, c]) => g.addColorStop(o, c));
  return g;
}
function circle(x: Ctx, cx: number, cy: number, r: number, fill?: Paint | null, stroke?: Paint | null, lw?: number): void {
  x.beginPath(); x.arc(cx, cy, r, 0, U.TAU);
  if (fill) { x.fillStyle = fill; x.fill(); }
  if (stroke) { x.strokeStyle = stroke; x.lineWidth = lw || 1.5; x.stroke(); }
}
function poly(x: Ctx, pts: readonly Pt[], fill?: Paint | null, stroke?: Paint | null, lw?: number): void {
  x.beginPath(); x.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) x.lineTo(pts[i][0], pts[i][1]);
  x.closePath();
  if (fill) { x.fillStyle = fill; x.fill(); }
  if (stroke) { x.strokeStyle = stroke; x.lineWidth = lw || 1.5; x.stroke(); }
}
function eyes(x: Ctx, cx: number, cy: number, dx: number, r: number, color: string): void {
  x.shadowColor = color; x.shadowBlur = r * 3;
  circle(x, cx - dx, cy, r, color); circle(x, cx + dx, cy, r, color);
  x.shadowBlur = 0;
  circle(x, cx - dx, cy, r * 0.45, '#fff'); circle(x, cx + dx, cy, r * 0.45, '#fff');
}
const helpers = { circle, poly, rgrad, eyes };

/* ---------- character sprites ---------- */
/** Champion frames: 0 = idle, 1..HERO_FRAMES-1 = a seamless walk cycle. */
export const HERO_FRAMES = 8;
/** One champion pose: stride, arm swing, body bob, cloth/hair lag and an optional cast lean. */
interface HeroPose { lx: number; ll: number; rx: number; rl: number; aL: number; aR: number; bob: number; hem: number; hair: number; ph: number; cast: boolean }
function heroPose(step: number, cast: boolean): HeroPose {
  if (cast) return { lx: -3.6, ll: 0, rx: 3.8, rl: 0, aL: -0.6, aR: 1, bob: 0.6, hem: -2.2, hair: -2, ph: 0, cast };
  if (step <= 0) return { lx: 0, ll: 0, rx: 0, rl: 0, aL: 0, aR: 0, bob: 0, hem: 0, hair: 0, ph: 0, cast };
  const ph = ((step - 1) % (HERO_FRAMES - 1)) / (HERO_FRAMES - 1) * U.TAU, s = Math.sin(ph), co = Math.cos(ph);
  return { lx: 4.2 * s, ll: 3.4 * Math.max(0, co), rx: -4.2 * s, rl: 3.4 * Math.max(0, -co), aL: -s, aR: s, bob: 0.55 - 1.1 * co * co, hem: -1.6 * Math.sin(ph - 0.7), hair: -1.8 * Math.sin(ph - 1.1), ph, cast };
}
/** Round-capped polyline (limbs, tentacles, bones). */
function limb(x: Ctx, pts: readonly Pt[], w: number, color: Paint): void {
  x.beginPath(); x.moveTo(pts[0][0], pts[0][1]);
  if (pts.length === 3) x.quadraticCurveTo(pts[1][0], pts[1][1], pts[2][0], pts[2][1]);
  else for (let i = 1; i < pts.length; i++) x.lineTo(pts[i][0], pts[i][1]);
  x.strokeStyle = color; x.lineWidth = w; x.lineCap = 'round'; x.lineJoin = 'round'; x.stroke();
}
/** A vertical body gradient: lit top, shaded bottom. */
function vgrad(x: Ctx, y0: number, y1: number, col: string, hi = 0.18, lo = -0.32): CanvasGradient {
  const g = x.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, U.shade(col, hi)); g.addColorStop(1, U.shade(col, lo)); return g;
}
/**
 * A champion, drawn in a 72-unit box (feet at y≈62). `size` is the canvas size in pixels; `step`
 * picks a pose (0 standing, 1..HERO_FRAMES-1 the walk cycle); `cast` draws the attack/cast pose.
 */
function character(def: CharacterArt, size = 72, step = 0, cast = false): HTMLCanvasElement {
  const key = 'char|' + def.id + '|' + size + '|' + step + '|' + (cast ? 1 : 0);
  const hit = cached<HTMLCanvasElement>(key); if (hit) return hit;
  const c = mk(size, size), x = ctx2d(c);
  const col = def.colors, s = size / 72, P = heroPose(step, cast);
  const skin = col.skin || '#e9c9a8', hairC = col.hair || col.secondary, eyeC = col.eye || '#fff', A = col.accent;
  const hd = def.head || 'hood', wp = def.weaponArt || 'sword';
  x.save(); x.scale(s, s); x.lineJoin = 'round'; x.lineCap = 'round';
  const cx = 36, by = P.bob, ink = 'rgba(10,6,14,0.55)';
  // aura glow
  x.globalAlpha = cast ? 0.6 : 0.32; x.drawImage(glow(A, 30), cx - 30, 38 - 30); x.globalAlpha = 1;
  // upper body leans into a cast (pivot at the hips)
  const lean = (fn: () => void) => { x.save(); if (P.cast) { x.translate(cx, 48); x.rotate(0.09); x.translate(-cx, -48); } fn(); x.restore(); };
  // shoulders, hands (hand positions follow the arm swing)
  const shL: Pt = [cx - 11, 29 + by], shR: Pt = [cx + 11, 29 + by];
  const hL: Pt = P.cast ? [cx - 17, 40 + by] : [cx - 15.5 + P.aL * 3.6, 43.5 + by - Math.abs(P.aL) * 0.7];
  const hR: Pt = P.cast ? ({ staff: [cx + 13, 41 + by], ice: [cx + 13, 41 + by], bow: [cx + 15, 34 + by], hammer: [cx + 12, 37 + by], scythe: [cx + 13, 38 + by] } as Record<string, Pt>)[wp] || [cx + 14.5, 32 + by] : [cx + 15.5 + P.aR * 3.6, 43.5 + by - Math.abs(P.aR) * 0.7];
  /* --- back layer: quiver / backpack, cape, long hair --- */
  lean(() => {
    if (wp === 'bow') { x.save(); x.translate(cx - 9, 30 + by); x.rotate(-0.45); x.fillStyle = '#5a3a1e'; x.beginPath(); x.roundRect(-3, -12, 6, 22, 2); x.fill(); x.strokeStyle = ink; x.lineWidth = 1; x.stroke(); for (let i = -1; i <= 1; i++) poly(x, [[i * 1.8, -12], [i * 1.8 - 1.4, -16], [i * 1.8 + 1.4, -16]], '#e8e2d0'); x.restore(); }
    if (wp === 'wrench') { x.fillStyle = vgrad(x, 26, 50, col.secondary); x.beginPath(); x.roundRect(cx - 21, 27 + by, 11, 21, 3); x.fill(); x.strokeStyle = ink; x.lineWidth = 1.2; x.stroke(); x.fillStyle = A; x.fillRect(cx - 19.5, 31 + by, 4, 2.5); circle(x, cx - 18, 41 + by, 2.4, '#9aa2ad', ink, 0.8); limb(x, [[cx - 20, 27 + by], [cx - 22, 20 + by]], 1.3, '#9aa2ad'); circle(x, cx - 22, 19.5 + by, 1.3, A); }
    // cape: hangs behind, its hem trails the stride
    const hm = P.hem;
    x.beginPath(); x.moveTo(cx - 10, 26 + by); x.quadraticCurveTo(cx - 19, 40 + by, cx - 18 + hm, 59.5);
    x.lineTo(cx - 9 + hm * 1.2, 58); x.lineTo(cx + hm * 1.3, 60); x.lineTo(cx + 9 + hm * 1.2, 58); x.lineTo(cx + 18 + hm, 59.5);
    x.quadraticCurveTo(cx + 19, 40 + by, cx + 10, 26 + by); x.closePath();
    x.fillStyle = vgrad(x, 26, 60, col.primary, -0.12, -0.5); x.fill(); x.strokeStyle = ink; x.lineWidth = 1.2; x.stroke();
    x.strokeStyle = U.rgba(A, 0.45); x.lineWidth = 1.1; x.beginPath(); x.moveTo(cx + 11, 28 + by); x.quadraticCurveTo(cx + 18.6, 41 + by, cx + 17.6 + hm, 58.5); x.stroke();
    if (def.longHair) {
      const hs = P.hair; x.fillStyle = vgrad(x, 14, 44, hairC, 0.05, -0.3);
      x.beginPath(); x.moveTo(cx - 9.5, 15 + by); x.quadraticCurveTo(cx - 14.5 + hs * 0.4, 30 + by, cx - 12 + hs, 43 + by); x.lineTo(cx - 8 + hs * 0.8, 40 + by); x.lineTo(cx - 5, 26 + by);
      x.lineTo(cx + 5, 26 + by); x.lineTo(cx + 8 + hs * 0.8, 40 + by); x.lineTo(cx + 12 + hs, 43 + by); x.quadraticCurveTo(cx + 14.5 + hs * 0.4, 30 + by, cx + 9.5, 15 + by); x.closePath(); x.fill(); x.strokeStyle = ink; x.lineWidth = 1; x.stroke();
      x.strokeStyle = 'rgba(255,255,255,0.12)'; x.beginPath(); x.moveTo(cx - 11, 22 + by); x.quadraticCurveTo(cx - 13 + hs * 0.4, 32 + by, cx - 11 + hs, 41 + by); x.stroke();
    }
  });
  /* --- legs and boots --- */
  const trouser = U.mix(col.secondary, '#120c14', 0.55), boot = U.mix(col.secondary, '#160e0a', 0.72);
  const leg = (hx: number, fx: number, lift: number) => {
    const fy = 60.6 - lift, ky = 54.5 - lift * 0.6, kx = (hx + fx) / 2 + (fx - hx) * 0.15;
    limb(x, [[hx, 47 + by], [kx, ky], [fx, fy - 2.5]], 5, trouser);
    limb(x, [[hx - 1, 48 + by], [kx - 1.2, ky], [fx - 1.2, fy - 3]], 1, 'rgba(255,255,255,0.1)');
    x.fillStyle = vgrad(x, fy - 6, fy + 2.5, boot, 0.12, -0.15); x.beginPath(); x.moveTo(fx - 2.8, fy - 6.5); x.lineTo(fx + 2.8, fy - 6.5); x.lineTo(fx + 3, fy - 1.5); x.quadraticCurveTo(fx + 5.4, fy - 1, fx + 5.2, fy + 1.6); x.lineTo(fx - 3.4, fy + 1.6); x.quadraticCurveTo(fx - 3.8, fy - 2, fx - 2.8, fy - 6.5); x.closePath(); x.fill();
    x.strokeStyle = ink; x.lineWidth = 0.9; x.stroke();
    x.fillStyle = U.rgba(A, 0.5); x.fillRect(fx - 2.8, fy - 5.6, 5.6, 1);
    x.strokeStyle = 'rgba(255,255,255,0.22)'; x.lineWidth = 0.8; x.beginPath(); x.moveTo(fx - 1.6, fy - 4.5); x.lineTo(fx - 1.8, fy - 1); x.stroke();
  };
  const lFx = cx - 5.5 + P.lx, rFx = cx + 5.5 + P.rx;
  if (P.ll > P.rl) { leg(cx + 4.5, rFx, P.rl); leg(cx - 4.5, lFx, P.ll); } else { leg(cx - 4.5, lFx, P.ll); leg(cx + 4.5, rFx, P.rl); }
  lean(() => {
    // ambient occlusion where the tunic meets the legs
    const ao = x.createRadialGradient(cx, 53 + by, 1, cx, 53 + by, 13); ao.addColorStop(0, 'rgba(0,0,0,0.5)'); ao.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = ao; x.beginPath(); x.ellipse(cx, 54 + by, 13, 4.5, 0, 0, U.TAU); x.fill();
    /* --- tunic / robe --- */
    const hm = P.hem * 0.6, ty = 52 + by;
    x.beginPath(); x.moveTo(cx - 10, 25.5 + by); x.quadraticCurveTo(cx - 16, 40 + by, cx - 15 + hm, ty);
    x.lineTo(cx - 10 + hm, ty + 2); x.lineTo(cx - 4.5 + hm, ty + 0.6); x.lineTo(cx + 1 + hm, ty + 2.2); x.lineTo(cx + 6 + hm, ty + 0.6); x.lineTo(cx + 11 + hm, ty + 2); x.lineTo(cx + 15 + hm, ty);
    x.quadraticCurveTo(cx + 16, 40 + by, cx + 10, 25.5 + by); x.closePath();
    x.fillStyle = vgrad(x, 25, ty + 2, col.primary, 0.2, -0.3); x.fill();
    x.save(); x.clip();
    const sg = x.createLinearGradient(cx - 16, 0, cx + 16, 0); sg.addColorStop(0, 'rgba(255,255,255,0.10)'); sg.addColorStop(0.35, 'rgba(255,255,255,0)'); sg.addColorStop(0.75, 'rgba(0,0,0,0.18)'); sg.addColorStop(1, 'rgba(0,0,0,0.30)');
    x.fillStyle = sg; x.fillRect(cx - 18, 24, 36, 34);
    // front panel / trim in the secondary colour
    x.fillStyle = U.rgba(col.secondary, 0.3); x.beginPath(); x.moveTo(cx - 2, 30 + by); x.lineTo(cx + 2, 30 + by); x.lineTo(cx + 3 + hm, ty + 2); x.lineTo(cx - 3 + hm, ty + 2); x.closePath(); x.fill();
    x.strokeStyle = 'rgba(0,0,0,0.25)'; x.lineWidth = 1; x.beginPath(); x.moveTo(cx - 7, 46 + by); x.quadraticCurveTo(cx - 8, 50 + by, cx - 9.5 + hm, ty + 1); x.moveTo(cx + 7, 46 + by); x.quadraticCurveTo(cx + 8, 50 + by, cx + 9 + hm, ty + 1); x.stroke();
    x.fillStyle = U.rgba(A, 0.7); x.fillRect(cx - 18, ty + 0.2, 36, 1);
    x.restore();
    x.strokeStyle = ink; x.lineWidth = 1.2; x.stroke();
    // rim light (accent) down the right edge
    x.strokeStyle = U.rgba(A, 0.75); x.lineWidth = 1.2; x.beginPath(); x.moveTo(cx + 10.5, 27 + by); x.quadraticCurveTo(cx + 15.6, 40 + by, cx + 14.6 + hm, ty - 0.5); x.stroke();
    // belt with buckle, chest emblem
    x.fillStyle = vgrad(x, 41, 45, col.secondary, 0.1, -0.35); x.fillRect(cx - 14.5, 41.5 + by, 29, 3.6); x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(cx - 14.5, 44.6 + by, 29, 0.6);
    x.fillStyle = A; x.fillRect(cx - 2.6, 41 + by, 5.2, 4.6); x.fillStyle = 'rgba(255,255,255,0.6)'; x.fillRect(cx - 2, 41.4 + by, 1.6, 1.2);
    x.shadowColor = A; x.shadowBlur = 7; circle(x, cx, 34 + by, 2.6, A); x.shadowBlur = 0; circle(x, cx - 0.7, 33.3 + by, 0.9, 'rgba(255,255,255,0.85)');
    /* --- arms (sleeves bend at the elbow), pauldrons --- */
    const arm = (sh: Pt, hd2: Pt, side: number) => {
      const el: Pt = [sh[0] + side * 3 + (hd2[0] - sh[0]) * 0.25, (sh[1] + hd2[1]) / 2 + 0.5];
      limb(x, [sh, el, hd2], 5, U.shade(col.primary, -0.12));
      limb(x, [[sh[0] + side * 1.4, sh[1]], [el[0] + side * 1.4, el[1]], [hd2[0] + side * 1, hd2[1] - 0.5]], 1, side > 0 ? U.rgba(A, 0.65) : 'rgba(255,255,255,0.14)');
      x.fillStyle = col.secondary; x.beginPath(); x.ellipse(hd2[0] - (hd2[0] - el[0]) * 0.2, hd2[1] - (hd2[1] - el[1]) * 0.2, 2.9, 1.6, Math.atan2(hd2[1] - el[1], hd2[0] - el[0]) + Math.PI / 2, 0, U.TAU); x.fill();
      circle(x, hd2[0], hd2[1], 2.5, rgrad(x, hd2[0], hd2[1], 2.5, [[0, U.shade(skin, 0.1)], [1, U.shade(skin, -0.2)]]), ink, 0.8);
    };
    arm(shL, hL, -1); arm(shR, hR, 1);
    for (const [sx2, sd] of [[cx - 11.5, -1], [cx + 11.5, 1]] as const) {
      x.beginPath(); x.ellipse(sx2, 28 + by, 5.4, 4.4, sd * 0.25, 0, U.TAU); x.fillStyle = rgrad(x, sx2, 28 + by, 5.4, [[0, U.shade(col.secondary, 0.3)], [1, U.shade(col.secondary, -0.3)]]); x.fill(); x.strokeStyle = ink; x.lineWidth = 1; x.stroke();
      circle(x, sx2 - 1.6, 26.4 + by, 1.1, 'rgba(255,255,255,0.55)');
    }
    /* --- head --- */
    const hx = cx, hy = 18.5 + by;
    x.fillStyle = U.shade(skin, -0.25); x.fillRect(hx - 2.6, hy + 6, 5.2, 3.5);
    circle(x, hx, hy, 8.6, rgrad(x, hx, hy, 8.6, [[0, U.shade(skin, 0.12)], [0.7, skin], [1, U.shade(skin, -0.28)]]), ink, 1.1);
    x.strokeStyle = U.rgba(A, 0.5); x.lineWidth = 1; x.beginPath(); x.arc(hx, hy, 8, -0.9, 0.9); x.stroke();
    const fringe = (fill: Paint) => { x.beginPath(); x.moveTo(hx - 9.4, hy + 3); x.quadraticCurveTo(hx - 10.5, hy - 10.5, hx, hy - 10.6); x.quadraticCurveTo(hx + 10.5, hy - 10.5, hx + 9.4, hy + 3); x.quadraticCurveTo(hx + 7.5, hy - 4, hx + 2, hy - 4.4); x.lineTo(hx, hy - 2.6); x.lineTo(hx - 2.5, hy - 4.6); x.quadraticCurveTo(hx - 7.5, hy - 4, hx - 9.4, hy + 3); x.closePath(); x.fillStyle = fill; x.fill(); x.strokeStyle = ink; x.lineWidth = 1; x.stroke(); };
    if (hd === 'hood') {
      x.beginPath(); x.moveTo(hx - 11, hy + 5); x.quadraticCurveTo(hx - 12.5, hy - 12, hx + 1, hy - 13); x.quadraticCurveTo(hx + 12.5, hy - 12, hx + 11, hy + 5);
      x.quadraticCurveTo(hx + 8.5, hy - 3.5, hx, hy - 4.5); x.quadraticCurveTo(hx - 8.5, hy - 3.5, hx - 11, hy + 5); x.closePath();
      x.fillStyle = vgrad(x, hy - 13, hy + 5, col.primary, 0.1, -0.25); x.fill(); x.strokeStyle = ink; x.lineWidth = 1.1; x.stroke();
      x.fillStyle = 'rgba(0,0,0,0.38)'; x.beginPath(); x.ellipse(hx, hy - 2.5, 7.5, 2.6, 0, 0, U.TAU); x.fill();
      x.strokeStyle = U.rgba(A, 0.7); x.lineWidth = 1; x.beginPath(); x.moveTo(hx + 5, hy - 11.5); x.quadraticCurveTo(hx + 11.5, hy - 9, hx + 10.6, hy + 4); x.stroke();
    } else if (hd === 'helm') {
      x.beginPath(); x.moveTo(hx - 10, hy + 4); x.lineTo(hx - 10.2, hy - 2); x.arc(hx, hy - 2, 10.2, Math.PI, 0); x.lineTo(hx + 10, hy + 4); x.lineTo(hx + 6.5, hy + 4.5); x.lineTo(hx + 6, hy - 1.5); x.lineTo(hx - 6, hy - 1.5); x.lineTo(hx - 6.5, hy + 4.5); x.closePath();
      x.fillStyle = rgrad(x, hx, hy - 4, 11, [[0, U.shade(col.secondary, 0.35)], [0.6, col.secondary], [1, U.shade(col.secondary, -0.35)]]); x.fill(); x.strokeStyle = ink; x.lineWidth = 1.1; x.stroke();
      x.fillStyle = U.shade(col.secondary, -0.2); x.fillRect(hx - 1.2, hy - 2, 2.4, 6);
      x.strokeStyle = 'rgba(255,255,255,0.7)'; x.lineWidth = 1; x.beginPath(); x.arc(hx - 1, hy - 3, 7.5, -2.6, -1.9); x.stroke();
      // crest plume
      x.fillStyle = vgrad(x, hy - 18, hy - 8, A, 0.15, -0.2); x.beginPath(); x.moveTo(hx - 2, hy - 11.5); x.quadraticCurveTo(hx - 2 + P.hair * 0.4, hy - 19, hx - 9 + P.hair, hy - 16.5); x.quadraticCurveTo(hx - 4, hy - 14, hx + 2, hy - 11.5); x.closePath(); x.fill(); x.strokeStyle = ink; x.lineWidth = 0.9; x.stroke();
    } else if (hd === 'hair') {
      fringe(vgrad(x, hy - 11, hy + 3, hairC, 0.12, -0.2));
      x.strokeStyle = 'rgba(255,255,255,0.3)'; x.lineWidth = 1; x.beginPath(); x.arc(hx - 1, hy - 3, 6.5, -2.5, -1.6); x.stroke();
    } else if (hd === 'crown') {
      fringe(vgrad(x, hy - 11, hy + 3, hairC, 0.1, -0.2));
      x.shadowColor = A; x.shadowBlur = 6;
      poly(x, [[hx - 8.5, hy - 7], [hx - 7, hy - 14], [hx - 4, hy - 9.5], [hx, hy - 17], [hx + 4, hy - 9.5], [hx + 7, hy - 14], [hx + 8.5, hy - 7], [hx, hy - 5.5]], vgrad(x, hy - 17, hy - 6, A, 0.4, -0.15), ink, 0.9);
      x.shadowBlur = 0; circle(x, hx, hy - 9, 1.4, '#fff');
    } else if (hd === 'goggles') {
      x.beginPath(); x.arc(hx, hy - 1, 9.6, Math.PI * 1.02, -0.02); x.closePath(); x.fillStyle = vgrad(x, hy - 11, hy, col.secondary, 0.15, -0.25); x.fill(); x.strokeStyle = ink; x.lineWidth = 1; x.stroke();
      x.fillStyle = '#2a2026'; x.fillRect(hx - 9.4, hy - 6, 18.8, 2.4);
      for (const gx of [hx - 4.4, hx + 4.4]) { circle(x, gx, hy - 4.8, 3.6, '#3a3036', ink, 0.9); circle(x, gx, hy - 4.8, 2.6, rgrad(x, gx, hy - 4.8, 2.6, [[0, '#fff'], [0.35, A], [1, U.shade(A, -0.4)]])); circle(x, gx - 1, hy - 5.8, 0.8, 'rgba(255,255,255,0.9)'); }
    } else if (hd === 'horns') {
      fringe(vgrad(x, hy - 11, hy + 3, hairC, 0.1, -0.2));
      for (const sd of [-1, 1]) { x.beginPath(); x.moveTo(hx + sd * 5, hy - 8); x.quadraticCurveTo(hx + sd * 14, hy - 11, hx + sd * 11.5, hy - 19); x.quadraticCurveTo(hx + sd * 10.5, hy - 13, hx + sd * 3.5, hy - 6); x.closePath(); x.fillStyle = vgrad(x, hy - 19, hy - 6, A, 0.2, -0.35); x.fill(); x.strokeStyle = ink; x.lineWidth = 0.9; x.stroke(); }
    } else if (hd === 'bald') {
      x.strokeStyle = 'rgba(255,255,255,0.35)'; x.lineWidth = 1.1; x.beginPath(); x.arc(hx - 1, hy - 1.5, 6.4, -2.6, -1.7); x.stroke();
      x.fillStyle = A; x.fillRect(hx - 8.6, hy - 4, 17.2, 1.8);
      if (wp === 'hammer') { x.beginPath(); x.moveTo(hx - 7, hy + 2); x.quadraticCurveTo(hx - 6, hy + 11, hx, hy + 12); x.quadraticCurveTo(hx + 6, hy + 11, hx + 7, hy + 2); x.quadraticCurveTo(hx, hy + 5, hx - 7, hy + 2); x.fillStyle = vgrad(x, hy, hy + 12, '#7a4a28', 0.1, -0.2); x.fill(); x.strokeStyle = ink; x.lineWidth = 0.9; x.stroke(); }
    }
    if (def.longHair && hd !== 'hood') { x.fillStyle = vgrad(x, hy - 6, hy + 10, hairC, 0.08, -0.25); for (const sd of [-1, 1]) { x.beginPath(); x.moveTo(hx + sd * 9.4, hy + 1); x.quadraticCurveTo(hx + sd * 10.5, hy + 6, hx + sd * 8.6 + P.hair * 0.3, hy + 11); x.lineTo(hx + sd * 7.4, hy + 3); x.closePath(); x.fill(); } }
    // eyes
    x.fillStyle = eyeC; x.shadowColor = eyeC; x.shadowBlur = 5;
    x.fillRect(hx - 4.8, hy - 0.4, 2.8, 1.9); x.fillRect(hx + 2, hy - 0.4, 2.8, 1.9); x.shadowBlur = 0;
    x.fillStyle = 'rgba(60,20,20,0.35)'; x.fillRect(hx - 1.4, hy + 4.2, 2.8, 0.8);
  });
  /* --- weapon / accessory --- */
  const metal = '#cfd6e0', wood = '#6b4a2a';
  const spec = (x0: number, y0: number, x1: number, y1: number) => { x.strokeStyle = 'rgba(255,255,255,0.85)'; x.lineWidth = 0.8; x.beginPath(); x.moveTo(x0, y0); x.lineTo(x1, y1); x.stroke(); };
  const flare = (fx: number, fy: number, r = 6.5) => { if (!P.cast) return; x.globalCompositeOperation = 'lighter'; x.drawImage(glow(A, r * 2), fx - r * 2, fy - r * 2, r * 4, r * 4); x.drawImage(glow('#ffffff', r), fx - r * 0.6, fy - r * 0.6, r * 1.2, r * 1.2); x.globalCompositeOperation = 'source-over'; };
  /** Draw in a frame at the hand, rotated by `a` (0 = pointing up). */
  const held = (h: Pt, a: number, fn: () => void) => { x.save(); x.translate(h[0], h[1]); x.rotate(a); fn(); x.restore(); };
  const tipAt = (h: Pt, a: number, l: number): Pt => [h[0] + Math.sin(a) * l, h[1] - Math.cos(a) * l];
  const sw = P.aR * 0.12;
  x.strokeStyle = ink; x.lineWidth = 1.2;
  if (wp === 'sword') {
    const a = P.cast ? 0.7 : 0.32 + sw;
    held(hR, a, () => {
      x.shadowColor = A; x.shadowBlur = 5;
      poly(x, [[0, -27], [2.6, -23.5], [2.4, -4], [-2.4, -4], [-2.6, -23.5]], vgrad(x, -27, -4, metal, 0.15, -0.2), '#222', 1); x.shadowBlur = 0;
      x.fillStyle = U.rgba(A, 0.55); poly(x, [[0, -26], [0.9, -23], [0.9, -5], [-0.9, -5], [-0.9, -23]], U.rgba(A, 0.55));
      spec(-1.6, -22.5, -1.6, -6);
      x.fillStyle = vgrad(x, -5, -1.5, col.secondary, 0.3, -0.2); x.beginPath(); x.roundRect(-6.5, -4.6, 13, 3, 1.2); x.fill(); x.stroke();
      x.fillStyle = '#4a2c14'; x.fillRect(-1.4, -1.6, 2.8, 7); circle(x, 0, 6.2, 1.8, A, ink, 0.8);
    });
    const t2 = tipAt(hR, a, 27); flare(t2[0], t2[1]);
  } else if (wp === 'staff' || wp === 'ice') {
    const a = P.cast ? 0.3 : 0.04 + sw * 0.5, L = 30;
    held(hR, a, () => {
      x.fillStyle = vgrad(x, -L, 14, wp === 'ice' ? '#5b4a8a' : wood, 0.15, -0.2); x.beginPath(); x.roundRect(-1.5, -L + 2, 3, L + 12, 1.4); x.fill(); x.stroke();
      x.fillStyle = U.rgba(A, 0.8); x.fillRect(-1.8, -L + 6, 3.6, 1.4); x.fillRect(-1.8, -2, 3.6, 1.2);
      if (wp === 'staff') {
        x.strokeStyle = U.shade(wood, -0.15); x.lineWidth = 1.6; x.beginPath(); x.moveTo(-1.5, -L + 3); x.quadraticCurveTo(-6, -L - 1, -2.5, -L - 6); x.moveTo(1.5, -L + 3); x.quadraticCurveTo(6, -L - 1, 2.5, -L - 6); x.stroke();
        x.globalAlpha = 0.8; x.drawImage(glow(A, 11), -11, -L - 13, 22, 22); x.globalAlpha = 1;
        circle(x, 0, -L - 2.5, 4.6, rgrad(x, 0, -L - 2.5, 4.6, [[0, '#fff'], [0.35, A], [1, U.shade(A, -0.4)]]), 'rgba(255,255,255,0.4)', 0.8); circle(x, -1.4, -L - 4, 1.2, '#fff');
      } else {
        x.shadowColor = A; x.shadowBlur = 8;
        poly(x, [[0, -L - 12], [5, -L - 2], [0, -L + 4], [-5, -L - 2]], rgrad(x, 0, -L - 4, 9, [[0, '#fff'], [0.5, A], [1, U.shade(A, -0.3)]]), 'rgba(255,255,255,0.7)', 0.8);
        x.shadowBlur = 0; poly(x, [[0, -L - 12], [5, -L - 2], [0, -L - 3]], 'rgba(255,255,255,0.35)');
        poly(x, [[-3, -L + 1], [-7, -L - 4], [-3.5, -L - 1]], U.rgba(A, 0.8)); poly(x, [[3, -L + 1], [7, -L - 4], [3.5, -L - 1]], U.rgba(A, 0.8));
      }
    });
    const t2 = tipAt(hR, a, L + 3); flare(t2[0], t2[1], 7);
  } else if (wp === 'bow') {
    const bx = hR[0], byy = hR[1] - (P.cast ? 0 : 2);
    x.save(); x.translate(bx, byy); if (P.cast) x.rotate(-0.12);
    const pull = P.cast ? -9 : -2.5;
    x.strokeStyle = '#ddd'; x.lineWidth = 0.8; x.beginPath(); x.moveTo(-5, -15); x.lineTo(pull - 5 + 5, 0); x.lineTo(-5, 15); x.stroke();
    x.strokeStyle = '#3a220e'; x.lineWidth = 3.2; x.beginPath(); x.moveTo(-5, -15); x.quadraticCurveTo(5, -9, 0.5, 0); x.quadraticCurveTo(5, 9, -5, 15); x.stroke();
    x.strokeStyle = '#a0703a'; x.lineWidth = 1.8; x.stroke();
    x.strokeStyle = U.rgba(A, 0.8); x.lineWidth = 0.8; x.beginPath(); x.moveTo(-4, -13.5); x.quadraticCurveTo(4, -8.5, 1, -2); x.stroke();
    if (P.cast) { x.strokeStyle = '#c9b07a'; x.lineWidth = 1.2; x.beginPath(); x.moveTo(pull, 0); x.lineTo(14, 0); x.stroke(); poly(x, [[17, 0], [13, -2], [13, 2]], metal); poly(x, [[pull, 0], [pull - 2.5, -2], [pull + 1, 0], [pull - 2.5, 2]], '#eee'); }
    x.restore();
    flare(bx + 15, byy, 6);
  } else if (wp === 'daggers') {
    const dag = (h: Pt, a: number) => held(h, a, () => {
      x.shadowColor = A; x.shadowBlur = 4; poly(x, [[0, -14], [2.4, -9], [1.8, -1], [-1.8, -1], [-2.4, -9]], vgrad(x, -14, 0, metal, 0.2, -0.15), '#222', 0.9); x.shadowBlur = 0;
      spec(-1, -10, -1, -2); x.fillStyle = A; x.fillRect(-3.5, -1.2, 7, 2); x.fillStyle = '#2a1a2a'; x.fillRect(-1.1, 0.8, 2.2, 4.5);
    });
    dag(hL, P.cast ? -2.2 : Math.PI + 0.45 + P.aL * 0.1); dag(hR, P.cast ? 1.45 : Math.PI - 0.45 + sw);
    const t2 = tipAt(hR, 1.45, 14); flare(t2[0], t2[1], 7);
  } else if (wp === 'halo') {
    const hy2 = 6 + by + (P.cast ? -1.5 : 0) + Math.sin(P.ph * 2) * 0.4;
    x.shadowColor = A; x.shadowBlur = 8; x.strokeStyle = A; x.lineWidth = 2.4; x.beginPath(); x.ellipse(cx, hy2, 11.5, 3.3, 0, 0, U.TAU); x.stroke(); x.shadowBlur = 0;
    x.strokeStyle = '#fff'; x.lineWidth = 0.9; x.beginPath(); x.ellipse(cx, hy2, 11.5, 3.3, 0, Math.PI * 1.05, Math.PI * 1.7); x.stroke();
    for (const h of [hL, hR]) { x.globalCompositeOperation = 'lighter'; x.drawImage(glow(A, 7), h[0] - 7, h[1] - 7, 14, 14); x.globalCompositeOperation = 'source-over'; }
    // a small holy tome at the hip
    x.save(); x.translate(cx - 13, 47 + by); x.rotate(-0.25); x.fillStyle = U.shade(col.secondary, -0.15); x.fillRect(-3.5, -4.5, 7, 9); x.fillStyle = '#f4ecd8'; x.fillRect(-2.5, -4, 5.5, 8); x.fillStyle = col.secondary; x.fillRect(-3.5, -4.5, 1.6, 9); x.restore();
    flare(hR[0] + 2, hR[1] - 2, 7);
  } else if (wp === 'hammer') {
    const a = P.cast ? 0.35 : -0.18 + sw * 0.6;
    held(hR, a, () => {
      x.fillStyle = vgrad(x, -26, 10, wood, 0.15, -0.2); x.beginPath(); x.roundRect(-1.7, -24, 3.4, 33, 1.5); x.fill(); x.stroke();
      x.fillStyle = '#3a2410'; x.fillRect(-2, 2, 4, 1.2); x.fillRect(-2, 5, 4, 1.2);
      x.fillStyle = vgrad(x, -31, -19, '#8a929e', 0.3, -0.25); x.beginPath(); x.roundRect(-8.5, -31, 17, 11, 1.6); x.fill(); x.stroke();
      x.fillStyle = A; x.fillRect(-8.5, -26.6, 17, 2.2); x.shadowColor = A; x.shadowBlur = 6; circle(x, 0, -25.5, 1.8, A); x.shadowBlur = 0;
      spec(-7, -29.8, 6, -29.8);
    });
    const t2 = tipAt(hR, a, 26); flare(t2[0], t2[1], 7);
  } else if (wp === 'scythe') {
    const a = P.cast ? 0.45 : 0.1 + sw * 0.5, L = 34;
    held(hR, a, () => {
      x.fillStyle = vgrad(x, -L, 14, '#3a2a3a', 0.15, -0.15); x.beginPath(); x.roundRect(-1.4, -L, 2.8, L + 13, 1.3); x.fill(); x.stroke();
      x.fillStyle = col.secondary; x.fillRect(-1.8, -L + 1, 3.6, 2.2);
      x.shadowColor = A; x.shadowBlur = 7;
      x.beginPath(); x.moveTo(0.5, -L + 1); x.quadraticCurveTo(-9, -L - 7, -21, -L + 3); x.quadraticCurveTo(-10, -L - 2, 0.5, -L + 4); x.closePath();
      x.fillStyle = vgrad(x, -L - 6, -L + 4, A, 0.35, -0.2); x.fill(); x.shadowBlur = 0; x.strokeStyle = ink; x.lineWidth = 0.9; x.stroke();
      x.strokeStyle = 'rgba(255,255,255,0.85)'; x.lineWidth = 0.8; x.beginPath(); x.moveTo(-1, -L - 0.5); x.quadraticCurveTo(-9, -L - 5.5, -19, -L + 2.2); x.stroke();
    });
    const t2 = tipAt(hR, a, L); flare(t2[0] - 8, t2[1], 7);
  } else if (wp === 'orb') {
    const o = (h: Pt, side: number, ph: number) => { const ox = h[0] + side * 3, oy = h[1] - 5 + Math.sin(ph) * 1.2; x.globalAlpha = 0.85; x.drawImage(glow(A, 10), ox - 10, oy - 10, 20, 20); x.globalAlpha = 1; circle(x, ox, oy, 4.4, rgrad(x, ox, oy, 4.4, [[0, '#fff'], [0.35, A], [1, U.shade(A, -0.5)]]), 'rgba(255,255,255,0.35)', 0.8); circle(x, ox - 1.3, oy - 1.4, 1, '#fff'); };
    o(hL, -1, P.ph * 2); o(P.cast ? [hR[0] + 2, hR[1] - 2] : hR, 1, P.ph * 2 + Math.PI);
    flare(hR[0] + 5, hR[1] - 7, 7);
  } else if (wp === 'wrench') {
    const a = P.cast ? 0.8 : 0.42 + sw;
    held(hR, a, () => {
      x.fillStyle = vgrad(x, -16, 4, '#9aa2ad', 0.25, -0.2); x.beginPath(); x.roundRect(-1.6, -14, 3.2, 18, 1.2); x.fill(); x.stroke();
      x.beginPath(); x.arc(0, -17.5, 3.4, -Math.PI / 2 + 0.75, Math.PI * 1.5 - 0.75); x.strokeStyle = ink; x.lineWidth = 4.2; x.lineCap = 'butt'; x.stroke(); x.strokeStyle = '#a8b0bb'; x.lineWidth = 2.6; x.stroke(); x.lineCap = 'round';
      spec(-0.8, -12, -0.8, 2); x.fillStyle = col.primary; x.fillRect(-2, 0, 4, 3.5);
    });
    const t2 = tipAt(hR, a, 18); flare(t2[0], t2[1], 8);
  } else if (wp === 'fists') {
    for (const h of [hL, hR]) { x.shadowColor = A; x.shadowBlur = 7; circle(x, h[0], h[1], 4, rgrad(x, h[0], h[1], 4, [[0, U.shade(A, 0.35)], [1, U.shade(A, -0.3)]]), ink, 0.9); x.shadowBlur = 0; x.fillStyle = 'rgba(0,0,0,0.3)'; x.fillRect(h[0] - 3, h[1] - 1, 6, 0.8); circle(x, h[0] - 1.3, h[1] - 1.5, 0.9, 'rgba(255,255,255,0.8)'); }
    // flowing sash
    const sy = 45 + by, sw2 = P.hem;
    x.strokeStyle = A; x.lineWidth = 2; x.beginPath(); x.moveTo(cx - 12, sy); x.quadraticCurveTo(cx - 24 + sw2, sy + 4, cx - 30 + sw2 * 1.6, sy - 4 + Math.sin(P.ph) * 1.5); x.stroke();
    x.strokeStyle = U.rgba(A, 0.6); x.lineWidth = 1.4; x.beginPath(); x.moveTo(cx - 12, sy + 1); x.quadraticCurveTo(cx - 22 + sw2, sy + 7, cx - 27 + sw2 * 1.4, sy + 3 + Math.sin(P.ph + 1) * 1.5); x.stroke();
    flare(hR[0] + 2, hR[1], 9);
  }
  x.restore();
  const out = outlined(c, Math.max(1, Math.round(1.1 * s)));
  cache.set(key, out);
  return out;
}
/** In-world champion sprite: supersampled, pivot at the feet. `frame` 0 = idle, 1..HERO_FRAMES-1 = walk cycle. */
function hero(def: CharacterArt, frame = 0): Sprite {
  const f = Math.max(0, Math.floor(frame)) % HERO_FRAMES;
  const key = 'hero|' + def.id + '|' + f;
  const hit = cached<Sprite>(key); if (hit) return hit;
  const sp = withOrigin(character(def, 72 * RES, f), 36, 62, RES);
  cache.set(key, sp);
  return sp;
}
/** The attack/cast pose (weapon raised/thrust forward, slight lean), same box and pivot as `hero`. */
function heroCast(def: CharacterArt): Sprite {
  const key = 'herocast|' + def.id;
  const hit = cached<Sprite>(key); if (hit) return hit;
  const sp = withOrigin(character(def, 72 * RES, 0, true), 36, 62, RES);
  cache.set(key, sp);
  return sp;
}

/* ---------- enemy sprites ---------- */
/** Frames in an enemy's looping locomotion cycle: frame / ENEMY_FRAMES is the phase t in [0, 1). */
export const ENEMY_FRAMES = 6;
type EnemyDraw = (x: Ctx, r: number, col: EnemyColors, t: number) => void;
const OL = 'rgba(0,0,0,0.6)';
/** Lit-from-top-left radial body shading. */
function shadeR(x: Ctx, cx: number, cy: number, r: number, col: string, hi = 0.22, lo = -0.38): CanvasGradient {
  return rgrad(x, cx, cy, r, [[0, U.shade(col, hi)], [0.65, col], [1, U.shade(col, lo)]]);
}
/** Straight-segment polyline with round joints (bony legs with knees). */
function seg(x: Ctx, pts: readonly Pt[], w: number, color: Paint): void {
  x.beginPath(); x.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) x.lineTo(pts[i][0], pts[i][1]);
  x.strokeStyle = color; x.lineWidth = w; x.lineCap = 'round'; x.lineJoin = 'round'; x.stroke();
}
/** A tapered cubic-bezier stroke (tentacles, tails, hair). */
function taper(x: Ctx, p0: Pt, p1: Pt, p2: Pt, p3: Pt, w0: number, w1: number, color: Paint, n = 10): void {
  x.strokeStyle = color; x.lineCap = 'round';
  let px = p0[0], py = p0[1];
  for (let i = 1; i <= n; i++) {
    const k = i / n, u = 1 - k, a = u * u * u, b = 3 * u * u * k, c = 3 * u * k * k, d = k * k * k;
    const qx = a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], qy = a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1];
    x.lineWidth = Math.max(0.3, w0 + (w1 - w0) * (i - 0.5) / n); x.beginPath(); x.moveTo(px, py); x.lineTo(qx, qy); x.stroke();
    px = qx; py = qy;
  }
}
/** A flickering flame tongue rising from (fx, fy); `t` animates, k integer harmonics keep it looping. */
function flame(x: Ctx, fx: number, fy: number, w: number, h: number, t: number, c0: string, c1: string, seed = 0): void {
  const ph = t * U.TAU, f1 = Math.sin(ph * 2 + seed) * 0.18, f2 = Math.sin(ph * 3 + seed * 1.7) * 0.12, hh = h * (1 + f1 * 0.8);
  x.save(); x.globalCompositeOperation = 'lighter';
  x.drawImage(glow(c0, w * 2.2), fx - w * 2.2, fy - h * 0.5 - w * 2.2, w * 4.4, w * 4.4); x.restore();
  const g = x.createLinearGradient(0, fy, 0, fy - hh); g.addColorStop(0, c0); g.addColorStop(0.55, c1); g.addColorStop(1, U.rgba(c1, 0.0));
  x.fillStyle = g; x.beginPath(); x.moveTo(fx - w, fy);
  x.quadraticCurveTo(fx - w * 1.1, fy - hh * 0.45, fx + w * (f2 - 0.15), fy - hh * 0.7); x.quadraticCurveTo(fx + w * (0.2 + f1), fy - hh * 0.85, fx + w * f1 * 2, fy - hh);
  x.quadraticCurveTo(fx + w * (0.9 + f2), fy - hh * 0.5, fx + w, fy); x.quadraticCurveTo(fx, fy + w * 0.6, fx - w, fy); x.fill();
  x.fillStyle = 'rgba(255,250,220,0.85)'; x.beginPath(); x.ellipse(fx, fy - hh * 0.18, w * 0.42, hh * 0.28, 0, 0, U.TAU); x.fill();
}
/** The walking skeleton, shared by the Bone Walker and the Bone Colossus. */
function skeletonBody(x: Ctx, r: number, col: EnemyColors, t: number, boss: boolean): void {
  const ph = t * U.TAU, s = Math.sin(ph), bob = -r * 0.07 * (1 - Math.cos(ph * 2)) / 2;
  const bone = col.body, boneD = U.shade(col.body, -0.28), w = r * (boss ? 0.2 : 0.17);
  // legs: femur + tibia, the lifted leg's knee comes up and forward
  const leg = (sd: number, g: number) => {
    const lift = r * 0.24 * Math.max(0, Math.sin(g)), hip: Pt = [sd * r * 0.26, r * 0.42 + bob], foot: Pt = [sd * r * 0.38 + r * 0.04 * Math.cos(g) * sd, r * 1.05 - lift];
    const knee: Pt = [sd * r * 0.4, (hip[1] + foot[1]) / 2 - lift * 0.35];
    seg(x, [hip, knee, foot], w * 1.25, OL); seg(x, [hip, knee, foot], w, bone);
    circle(x, knee[0], knee[1], w * 0.62, U.shade(bone, 0.1));
    x.fillStyle = boneD; x.beginPath(); x.ellipse(foot[0] + sd * r * 0.06, foot[1], r * 0.16, r * 0.07, 0, 0, U.TAU); x.fill();
  };
  leg(-1, ph); leg(1, ph + Math.PI);
  x.save(); x.translate(0, bob);
  // pelvis, spine, ribs
  x.fillStyle = bone; x.beginPath(); x.ellipse(0, r * 0.4, r * 0.34, r * 0.13, 0, 0, U.TAU); x.fill(); x.strokeStyle = OL; x.lineWidth = 1; x.stroke();
  seg(x, [[0, r * 0.4], [0, -r * 0.3]], w * 0.85, bone);
  for (let i = 0; i < 4; i++) { const y = -r * 0.12 + i * r * 0.13, ww = r * (0.5 - i * 0.06); x.strokeStyle = OL; x.lineWidth = w * 0.85; x.beginPath(); x.moveTo(-ww, y + r * 0.08); x.quadraticCurveTo(0, y - r * 0.08, ww, y + r * 0.08); x.stroke(); x.strokeStyle = i % 2 ? boneD : bone; x.lineWidth = w * 0.55; x.stroke(); }
  // arms swing opposite the legs
  const arm = (sd: number, sw: number): Pt => {
    const sh: Pt = [sd * r * 0.55, -r * 0.2], hand: Pt = [sd * (r * 0.92 - r * 0.1 * sw), r * 0.55 - r * 0.22 * sw], el: Pt = [sd * r * 0.82, r * 0.18 - r * 0.08 * sw];
    seg(x, [sh, el, hand], w * 1.15, OL); seg(x, [sh, el, hand], w * 0.85, bone);
    circle(x, sh[0], sh[1], w * 0.85, U.shade(bone, 0.08), OL, 1);
    return hand;
  };
  arm(-1, s); const hR = arm(1, -s);
  if (!boss) {
    // a notched, rusty sword in the right hand
    x.save(); x.translate(hR[0], hR[1]); x.rotate(0.55 - s * 0.18);
    poly(x, [[-r * 0.07, 0], [-r * 0.08, -r * 0.95], [0, -r * 1.08], [r * 0.08, -r * 0.95], [r * 0.07, 0]], vgrad(x, -r, 0, '#8d8f95', 0.2, -0.15), '#222', 1);
    x.fillStyle = '#7a4a2a'; x.fillRect(-r * 0.04, -r * 0.6, r * 0.05, r * 0.12); x.fillRect(r * 0.0, -r * 0.35, r * 0.06, r * 0.1);
    x.strokeStyle = 'rgba(255,255,255,0.6)'; x.lineWidth = 0.8; x.beginPath(); x.moveTo(-r * 0.03, -r * 0.1); x.lineTo(-r * 0.03, -r * 0.9); x.stroke();
    x.fillStyle = '#4a3a2a'; x.fillRect(-r * 0.22, -r * 0.02, r * 0.44, r * 0.08); x.fillRect(-r * 0.04, 0, r * 0.08, r * 0.22);
    x.restore();
    circle(x, hR[0], hR[1], w * 0.7, bone);
  } else {
    // skull pauldrons
    for (const sd of [-1, 1]) { circle(x, sd * r * 0.58, -r * 0.28, r * 0.22, shadeR(x, sd * r * 0.58, -r * 0.28, r * 0.22, bone), OL, 1.5); circle(x, sd * r * 0.58 - r * 0.07, -r * 0.3, r * 0.05, '#111'); circle(x, sd * r * 0.58 + r * 0.07, -r * 0.3, r * 0.05, '#111'); }
  }
  // skull with a chattering jaw
  const jaw = r * (boss ? 0.1 : 0.06) * (1 - Math.cos(ph * 2)) / 2, sy = -r * 0.62;
  x.fillStyle = boneD; x.beginPath(); x.moveTo(-r * 0.3, sy + r * 0.22 + jaw); x.lineTo(r * 0.3, sy + r * 0.22 + jaw); x.lineTo(r * 0.24, sy + r * 0.42 + jaw); x.lineTo(-r * 0.24, sy + r * 0.42 + jaw); x.closePath(); x.fill(); x.strokeStyle = OL; x.lineWidth = 1; x.stroke();
  x.fillStyle = '#1a1414'; x.fillRect(-r * 0.24, sy + r * 0.2, r * 0.48, jaw + r * 0.04);
  x.fillStyle = bone; for (let i = 0; i < 4; i++) { x.fillRect(-r * 0.2 + i * r * 0.11, sy + r * 0.2, r * 0.07, r * 0.07); x.fillRect(-r * 0.2 + i * r * 0.11, sy + r * 0.17 + jaw + r * 0.04, r * 0.07, r * 0.06); }
  x.beginPath(); x.arc(0, sy, r * 0.46, Math.PI * 0.85, Math.PI * 2.15); x.lineTo(r * 0.3, sy + r * 0.26); x.lineTo(-r * 0.3, sy + r * 0.26); x.closePath();
  x.fillStyle = rgrad(x, 0, sy, r * 0.46, [[0, '#fffdf6'], [0.6, bone], [1, boneD]]); x.fill(); x.strokeStyle = OL; x.lineWidth = 1.2; x.stroke();
  x.fillStyle = 'rgba(0,0,0,0.75)'; x.beginPath(); x.ellipse(-r * 0.17, sy + r * 0.02, r * 0.13, r * 0.11, 0.2, 0, U.TAU); x.fill(); x.beginPath(); x.ellipse(r * 0.17, sy + r * 0.02, r * 0.13, r * 0.11, -0.2, 0, U.TAU); x.fill();
  poly(x, [[0, sy + r * 0.1], [-r * 0.05, sy + r * 0.19], [r * 0.05, sy + r * 0.19]], '#1a1414');
  x.strokeStyle = 'rgba(0,0,0,0.3)'; x.lineWidth = 0.8; x.beginPath(); x.moveTo(r * 0.1, sy - r * 0.42); x.lineTo(r * 0.16, sy - r * 0.26); x.lineTo(r * 0.1, sy - r * 0.18); x.stroke();
  eyes(x, 0, sy + r * 0.02, r * 0.17, r * 0.07, col.eye);
  x.restore();
}
/** Spider legs + body (Crypt Spider and Blood Matriarch): alternating tripod gait. */
function spiderBody(x: Ctx, r: number, col: EnemyColors, t: number): void {
  const ph = t * U.TAU, legC = U.shade(col.body, -0.12);
  for (const sd of [-1, 1]) for (let i = 0; i < 4; i++) {
    const g = ph + ((i + (sd > 0 ? 1 : 0)) % 2) * Math.PI, sw = Math.sin(g), up = Math.max(0, Math.cos(g));
    const hip: Pt = [sd * r * 0.32, -r * 0.3 + i * r * 0.17];
    const knee: Pt = [sd * r * (1.0 + i * 0.04), -r * 0.82 + i * r * 0.42 - up * r * 0.2 + sw * r * 0.08];
    const foot: Pt = [sd * r * (1.5 - up * 0.08), -r * 0.62 + i * r * 0.56 + r * 0.12 + sw * r * 0.2];
    seg(x, [hip, knee, foot], r * 0.2, OL); seg(x, [hip, knee, foot], r * 0.13, legC);
    seg(x, [[knee[0] - sd * r * 0.05, knee[1] - r * 0.02], [(knee[0] + foot[0]) / 2, (knee[1] + foot[1]) / 2 - r * 0.02]], r * 0.04, 'rgba(255,255,255,0.18)');
    circle(x, knee[0], knee[1], r * 0.07, U.shade(col.body, 0.1));
  }
  const br = 1 + Math.sin(ph * 2) * 0.03;
  // abdomen
  x.beginPath(); x.ellipse(0, r * 0.38, r * 0.72 * br, r * 0.78 * br, 0, 0, U.TAU); x.fillStyle = shadeR(x, 0, r * 0.38, r * 0.8, col.body); x.fill(); x.strokeStyle = OL; x.lineWidth = 1.5; x.stroke();
  x.strokeStyle = 'rgba(0,0,0,0.25)'; x.lineWidth = 1; for (let i = 1; i < 4; i++) { x.beginPath(); x.ellipse(0, r * 0.38, r * 0.72 * br * (1 - i * 0.2), r * 0.78 * br * (1 - i * 0.2), 0, Math.PI * 1.15, Math.PI * 1.85); x.stroke(); }
  const ac = col.accent || '#f44'; x.shadowColor = ac; x.shadowBlur = r * 0.3;
  poly(x, [[0, r * 0.08], [-r * 0.24, r * 0.32], [-r * 0.06, r * 0.45], [-r * 0.24, r * 0.68], [0, r * 0.88], [r * 0.24, r * 0.68], [r * 0.06, r * 0.45], [r * 0.24, r * 0.32]], ac); x.shadowBlur = 0;
  x.fillStyle = 'rgba(255,255,255,0.18)'; x.beginPath(); x.ellipse(-r * 0.28, r * 0.1, r * 0.18, r * 0.1, -0.6, 0, U.TAU); x.fill();
  // head + chelicerae
  const fang = Math.sin(ph * 2) * r * 0.04;
  for (const sd of [-1, 1]) poly(x, [[sd * r * 0.12, -r * 0.7], [sd * (r * 0.2 + fang), -r * 0.98], [sd * r * 0.04, -r * 0.82]], '#e8dcc8', OL, 1);
  circle(x, 0, -r * 0.5, r * 0.42, shadeR(x, 0, -r * 0.5, r * 0.42, col.body, 0.28), OL, 1.5);
  eyes(x, 0, -r * 0.55, r * 0.15, r * 0.085, col.eye); eyes(x, 0, -r * 0.72, r * 0.27, r * 0.06, col.eye); eyes(x, 0, -r * 0.38, r * 0.25, r * 0.045, col.eye);
}
/** The hulking stitched brute (Grave Brute and Infernal Titan). */
function bruteBody(x: Ctx, r: number, col: EnemyColors, t: number): void {
  const ph = t * U.TAU, s = Math.sin(ph), bob = -r * 0.05 * (1 - Math.cos(ph * 2)) / 2, dk = U.shade(col.body, -0.3);
  for (const sd of [-1, 1]) { const lift = r * 0.12 * Math.max(0, sd * s); seg(x, [[sd * r * 0.42, r * 0.55 + bob], [sd * r * 0.48, r * 0.95 - lift]], r * 0.38, OL); seg(x, [[sd * r * 0.42, r * 0.55 + bob], [sd * r * 0.48, r * 0.95 - lift]], r * 0.3, dk); x.fillStyle = '#2a201a'; x.beginPath(); x.ellipse(sd * r * 0.5, r * 1.02 - lift, r * 0.22, r * 0.1, 0, 0, U.TAU); x.fill(); }
  x.save(); x.translate(0, bob);
  // arms swing heavily, fists dragging low
  const arm = (sd: number, sw: number) => {
    const sh: Pt = [sd * r * 0.85, -r * 0.2], fist: Pt = [sd * (r * 1.12 + r * 0.06 * sw), r * 0.7 - r * 0.2 * sw], el: Pt = [sd * r * 1.18, r * 0.25 - r * 0.08 * sw];
    seg(x, [sh, el, fist], r * 0.5, OL); seg(x, [sh, el, fist], r * 0.4, U.shade(col.body, -0.08));
    circle(x, fist[0], fist[1], r * 0.3, shadeR(x, fist[0], fist[1], r * 0.3, col.body, 0.15), OL, 1.5);
    x.strokeStyle = 'rgba(0,0,0,0.35)'; x.lineWidth = 1; x.beginPath(); x.moveTo(fist[0] - r * 0.15, fist[1] - r * 0.05); x.lineTo(fist[0] + r * 0.15, fist[1] - r * 0.05); x.stroke();
  };
  arm(-1, s); arm(1, -s);
  // torso
  x.beginPath(); x.ellipse(0, r * 0.02, r * 0.95, r * 0.8, 0, 0, U.TAU); x.fillStyle = shadeR(x, 0, 0, r * 0.95, col.body, 0.18); x.fill(); x.strokeStyle = OL; x.lineWidth = 1.8; x.stroke();
  // shoulder humps
  for (const sd of [-1, 1]) circle(x, sd * r * 0.8, -r * 0.2, r * 0.4, shadeR(x, sd * r * 0.8, -r * 0.25, r * 0.42, col.body, 0.22), OL, 1.5);
  // stitches and a strap
  x.strokeStyle = '#2a1a14'; x.lineWidth = r * 0.04;
  x.beginPath(); x.moveTo(-r * 0.5, -r * 0.2); x.quadraticCurveTo(-r * 0.2, r * 0.2, -r * 0.3, r * 0.75); x.stroke();
  for (let i = 0; i < 5; i++) { const k = i / 4, px = -r * 0.5 + (r * 0.2) * k * 1.6 - k * k * r * 0.12, py = -r * 0.2 + k * r * 0.95; x.beginPath(); x.moveTo(px - r * 0.08, py - r * 0.03); x.lineTo(px + r * 0.08, py + r * 0.03); x.stroke(); }
  x.strokeStyle = '#3a2a1a'; x.lineWidth = r * 0.16; x.beginPath(); x.moveTo(r * 0.75, -r * 0.4); x.lineTo(-r * 0.45, r * 0.85); x.stroke();
  x.strokeStyle = '#5a4430'; x.lineWidth = r * 0.05; x.stroke();
  circle(x, r * 0.15, r * 0.22, r * 0.09, '#8a8a8a', '#222', 1);
  x.fillStyle = 'rgba(255,255,255,0.12)'; x.beginPath(); x.ellipse(-r * 0.35, -r * 0.25, r * 0.3, r * 0.16, -0.4, 0, U.TAU); x.fill();
  // small head sunk between the shoulders
  circle(x, 0, -r * 0.55, r * 0.42, shadeR(x, 0, -r * 0.58, r * 0.42, col.body, 0.25), OL, 1.5);
  x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(-r * 0.3, -r * 0.72, r * 0.6, r * 0.1);
  eyes(x, 0, -r * 0.6, r * 0.17, r * 0.1, col.eye);
  x.fillStyle = '#1a0e0e'; x.fillRect(-r * 0.2, -r * 0.42, r * 0.4, r * 0.1);
  poly(x, [[-r * 0.18, -r * 0.34], [-r * 0.12, -r * 0.52], [-r * 0.06, -r * 0.34]], '#eee'); poly(x, [[r * 0.18, -r * 0.34], [r * 0.12, -r * 0.52], [r * 0.06, -r * 0.34]], '#eee');
  x.restore();
}
const ENEMY_DRAW: Record<string, EnemyDraw> = {
  bat(x: Ctx, r: number, col: EnemyColors, t: number) {
    const ph = t * U.TAU, lift = Math.sin(ph), by = r * 0.2 * lift, mem = U.shade(col.body, -0.12);
    x.save(); x.translate(0, by);
    for (const sd of [-1, 1]) {
      const sh: Pt = [sd * r * 0.38, -r * 0.18], el: Pt = [sd * r * 1.0, -r * 0.4 - r * 0.62 * lift], tip: Pt = [sd * r * (2.0 - 0.42 * Math.abs(lift)), -r * 0.2 - r * 1.2 * lift];
      const lo: Pt = [sd * r * 0.3, r * 0.42];
      const f1: Pt = [U.lerp(tip[0], lo[0], 0.36), U.lerp(tip[1], lo[1], 0.36) + r * 0.35], f2: Pt = [U.lerp(tip[0], lo[0], 0.7), U.lerp(tip[1], lo[1], 0.7) + r * 0.3];
      x.beginPath(); x.moveTo(sh[0], sh[1]); x.lineTo(el[0], el[1]); x.lineTo(tip[0], tip[1]);
      x.quadraticCurveTo(U.lerp(tip[0], f1[0], 0.5) - sd * r * 0.05, U.lerp(tip[1], f1[1], 0.5) - r * 0.18, f1[0], f1[1]);
      x.quadraticCurveTo(U.lerp(f1[0], f2[0], 0.5), U.lerp(f1[1], f2[1], 0.5) - r * 0.16, f2[0], f2[1]);
      x.quadraticCurveTo(U.lerp(f2[0], lo[0], 0.5), U.lerp(f2[1], lo[1], 0.5) - r * 0.14, lo[0], lo[1]); x.closePath();
      const g = x.createLinearGradient(0, el[1], 0, lo[1] + r * 0.3); g.addColorStop(0, U.shade(col.body, 0.05)); g.addColorStop(1, U.shade(mem, -0.2));
      x.fillStyle = g; x.fill(); x.strokeStyle = OL; x.lineWidth = 1; x.stroke();
      x.strokeStyle = U.shade(col.body, -0.35); x.lineWidth = r * 0.07; x.lineCap = 'round';
      x.beginPath(); x.moveTo(sh[0], sh[1]); x.lineTo(el[0], el[1]); x.lineTo(tip[0], tip[1]); x.moveTo(el[0], el[1]); x.lineTo(f1[0], f1[1]); x.moveTo(el[0], el[1]); x.lineTo(f2[0], f2[1]); x.stroke();
      circle(x, el[0], el[1], r * 0.07, U.shade(col.body, 0.2));
    }
    // body, ears, feet
    for (const sd of [-1, 1]) seg(x, [[sd * r * 0.15, r * 0.45], [sd * r * 0.22, r * 0.72]], r * 0.08, U.shade(col.body, -0.3));
    x.beginPath(); x.ellipse(0, r * 0.05, r * 0.55, r * 0.68, 0, 0, U.TAU); x.fillStyle = shadeR(x, 0, 0, r * 0.68, col.body, 0.25); x.fill(); x.strokeStyle = OL; x.lineWidth = 1; x.stroke();
    x.fillStyle = U.rgba(U.shade(col.body, 0.3), 0.5); x.beginPath(); x.ellipse(0, r * 0.25, r * 0.3, r * 0.35, 0, 0, U.TAU); x.fill();
    for (const sd of [-1, 1]) poly(x, [[sd * r * 0.42, -r * 0.35], [sd * r * 0.38, -r * 1.0], [sd * r * 0.1, -r * 0.5]], shadeR(x, sd * r * 0.3, -r * 0.6, r * 0.5, col.body, 0.15), OL, 1);
    for (const sd of [-1, 1]) poly(x, [[sd * r * 0.34, -r * 0.42], [sd * r * 0.33, -r * 0.82], [sd * r * 0.18, -r * 0.5]], U.shade(col.body, 0.3));
    eyes(x, 0, -r * 0.18, r * 0.24, r * 0.15, col.eye);
    x.fillStyle = '#1a0e14'; x.beginPath(); x.ellipse(0, r * 0.12, r * 0.18, r * 0.08 + r * 0.03 * Math.max(0, -lift), 0, 0, U.TAU); x.fill();
    poly(x, [[-r * 0.12, r * 0.1], [-r * 0.07, r * 0.28], [-r * 0.03, r * 0.1]], '#fff'); poly(x, [[r * 0.12, r * 0.1], [r * 0.07, r * 0.28], [r * 0.03, r * 0.1]], '#fff');
    x.restore();
  },
  ghoul(x: Ctx, r: number, col: EnemyColors, t: number) {
    const ph = t * U.TAU, s = Math.sin(ph), bob = -r * 0.06 * (1 - Math.cos(ph * 2)) / 2, skinD = U.shade(col.body, -0.3), rag = '#3b342c';
    for (const sd of [-1, 1]) { const lift = r * 0.2 * Math.max(0, -sd * s), hip: Pt = [sd * r * 0.32, r * 0.5 + bob], ft: Pt = [sd * r * 0.45 - sd * r * 0.05 * s, r * 1.02 - lift]; seg(x, [hip, [sd * r * 0.42, r * 0.78 - lift * 0.5], ft], r * 0.3, OL); seg(x, [hip, [sd * r * 0.42, r * 0.78 - lift * 0.5], ft], r * 0.22, skinD); x.fillStyle = U.shade(col.body, -0.42); x.beginPath(); x.ellipse(ft[0] + sd * r * 0.05, ft[1], r * 0.18, r * 0.08, 0, 0, U.TAU); x.fill(); }
    x.save(); x.translate(0, bob); x.rotate(s * 0.06);
    // far arm behind
    const arm = (sd: number, sw: number) => {
      const sh: Pt = [sd * r * 0.62, -r * 0.18], hand: Pt = [sd * (r * 1.2 + r * 0.08 * sw), r * 0.5 - r * 0.28 * sw], el: Pt = [sd * r * 1.05, r * 0.08 - r * 0.12 * sw];
      seg(x, [sh, el, hand], r * 0.3, OL); seg(x, [sh, el, hand], r * 0.22, U.shade(col.body, -0.12));
      x.strokeStyle = '#1a1410'; x.lineWidth = r * 0.06; x.lineCap = 'round';
      for (let k = -1; k <= 1; k++) { x.beginPath(); x.moveTo(hand[0], hand[1]); x.lineTo(hand[0] + sd * r * 0.12 + k * r * 0.08, hand[1] + r * 0.2); x.stroke(); }
      circle(x, hand[0], hand[1], r * 0.13, U.shade(col.body, -0.05));
    };
    arm(-1, s);
    // hunched torso with rags
    x.beginPath(); x.moveTo(-r * 0.7, -r * 0.2); x.quadraticCurveTo(-r * 0.85, r * 0.35, -r * 0.55, r * 0.62); x.lineTo(r * 0.55, r * 0.62); x.quadraticCurveTo(r * 0.85, r * 0.35, r * 0.7, -r * 0.2); x.quadraticCurveTo(0, -r * 0.55, -r * 0.7, -r * 0.2);
    x.fillStyle = shadeR(x, 0, 0, r * 0.9, col.body, 0.15); x.fill(); x.strokeStyle = OL; x.lineWidth = 1.5; x.stroke();
    x.strokeStyle = 'rgba(0,0,0,0.3)'; x.lineWidth = 1; for (let i = 0; i < 3; i++) { x.beginPath(); x.moveTo(-r * 0.4, -r * 0.05 + i * r * 0.12); x.quadraticCurveTo(-r * 0.2, r * 0.02 + i * r * 0.12, -r * 0.05, -r * 0.04 + i * r * 0.12); x.stroke(); }
    const sw2 = Math.sin(ph + 0.8) * r * 0.05;
    poly(x, [[-r * 0.66, r * 0.2], [r * 0.66, r * 0.2], [r * 0.6, r * 0.6], [r * 0.42, r * 0.82 + sw2], [r * 0.25, r * 0.6], [r * 0.05, r * 0.88 - sw2], [-r * 0.15, r * 0.6], [-r * 0.35, r * 0.85 + sw2], [-r * 0.6, r * 0.6]], rag, OL, 1);
    x.fillStyle = 'rgba(255,255,255,0.08)'; x.fillRect(-r * 0.6, r * 0.22, r * 1.2, r * 0.08);
    arm(1, -s);
    // head hangs forward, jaw slack
    const jaw = r * 0.1 * (1 + Math.sin(ph * 2)) / 2, hy = -r * 0.48;
    circle(x, 0, hy, r * 0.5, shadeR(x, 0, hy, r * 0.52, col.body, 0.28), OL, 1.5);
    x.fillStyle = 'rgba(0,0,0,0.35)'; x.beginPath(); x.ellipse(0, hy - r * 0.08, r * 0.38, r * 0.12, 0, 0, U.TAU); x.fill();
    eyes(x, 0, hy - r * 0.08, r * 0.2, r * 0.11, col.eye);
    x.fillStyle = '#1e0a08'; x.beginPath(); x.ellipse(0, hy + r * 0.24, r * 0.17, r * 0.06 + jaw, 0, 0, U.TAU); x.fill();
    x.fillStyle = '#d8d0b0'; for (let i = 0; i < 3; i++) x.fillRect(-r * 0.12 + i * r * 0.09, hy + r * 0.18, r * 0.05, r * 0.06);
    x.strokeStyle = U.shade(col.body, -0.45); x.lineWidth = 1; x.beginPath(); x.moveTo(-r * 0.2, hy - r * 0.46); x.lineTo(-r * 0.28, hy - r * 0.62); x.moveTo(r * 0.05, hy - r * 0.5); x.lineTo(r * 0.1, hy - r * 0.68); x.moveTo(r * 0.22, hy - r * 0.44); x.lineTo(r * 0.34, hy - r * 0.58); x.stroke();
    x.restore();
  },
  skeleton(x: Ctx, r: number, col: EnemyColors, t: number) { skeletonBody(x, r, col, t, false); },
  slime(x: Ctx, r: number, col: EnemyColors, t: number) {
    const ph = t * U.TAU, q = Math.sin(ph), sx = 1 + 0.13 * q, sy = 1 - 0.13 * q, foot = r * 0.62;
    x.save(); x.translate(0, foot); x.scale(sx, sy); x.translate(0, -foot);
    const top = -r * 0.92 - r * 0.06 * Math.sin(ph + 1.2), lean = r * 0.06 * Math.sin(ph + 0.6);
    const path = () => { x.beginPath(); x.moveTo(-r, foot); x.bezierCurveTo(-r * 1.15, -r * 0.2, -r * 0.6 + lean, top, lean, top); x.bezierCurveTo(r * 0.6 + lean, top, r * 1.15, -r * 0.2, r, foot); x.quadraticCurveTo(r * 0.5, foot + r * 0.3, 0, foot + r * 0.28); x.quadraticCurveTo(-r * 0.5, foot + r * 0.3, -r, foot); };
    path(); x.fillStyle = rgrad(x, -r * 0.1, -r * 0.1, r * 1.1, [[0, U.shade(col.body, 0.38)], [0.55, col.body], [1, U.shade(col.body, -0.35)]]); x.fill();
    x.save(); x.clip();
    // rising bubbles and a darker core
    x.fillStyle = U.rgba(U.shade(col.body, -0.25), 0.45); x.beginPath(); x.ellipse(0, r * 0.25, r * 0.5, r * 0.32, 0, 0, U.TAU); x.fill();
    for (let i = 0; i < 4; i++) { const p = (t + i / 4) % 1, bx = r * (-0.45 + i * 0.3) + Math.sin(ph + i * 2) * r * 0.06, byy = foot - p * r * 1.3, a = Math.sin(p * Math.PI) * 0.55; circle(x, bx, byy, r * (0.05 + i % 2 * 0.04), U.rgba(U.shade(col.body, 0.45), a)); }
    x.restore();
    path(); x.strokeStyle = OL; x.lineWidth = 1.5; x.stroke();
    x.strokeStyle = U.rgba(U.shade(col.body, 0.4), 0.7); x.lineWidth = r * 0.06; x.beginPath(); x.moveTo(r * 0.72, -r * 0.1); x.quadraticCurveTo(r * 0.8, r * 0.3, r * 0.6, r * 0.55); x.stroke();
    x.fillStyle = 'rgba(255,255,255,0.55)'; x.beginPath(); x.ellipse(-r * 0.38 + lean * 0.5, -r * 0.5 - q * r * 0.05, r * (0.28 + 0.04 * q), r * 0.15, -0.55, 0, U.TAU); x.fill();
    circle(x, -r * 0.08 + lean, -r * 0.7, r * 0.06, 'rgba(255,255,255,0.8)');
    // drips along the base
    for (let i = 0; i < 3; i++) { const dx = r * (-0.6 + i * 0.6), dl = r * (0.12 + 0.06 * Math.sin(ph + i * 2.1)); x.fillStyle = U.shade(col.body, -0.1); x.beginPath(); x.ellipse(dx, foot + r * 0.2 + dl * 0.5, r * 0.07, dl, 0, 0, U.TAU); x.fill(); }
    eyes(x, lean * 0.6, -r * 0.08, r * 0.3, r * 0.16, col.eye);
    x.strokeStyle = U.shade(col.body, -0.5); x.lineWidth = r * 0.06; x.beginPath(); x.arc(lean * 0.6, r * 0.12, r * 0.18, 0.25, Math.PI - 0.25); x.stroke();
    x.restore();
  },
  imp(x: Ctx, r: number, col: EnemyColors, t: number) {
    const ph = t * U.TAU, lift = Math.sin(ph), by = r * 0.1 * Math.sin(ph + 0.8), dk = U.shade(col.body, -0.3);
    x.save(); x.translate(0, by);
    // wings
    for (const sd of [-1, 1]) {
      const tip: Pt = [sd * r * (1.45 - 0.2 * Math.abs(lift)), -r * 0.75 - r * 0.6 * lift], el: Pt = [sd * r * 0.9, -r * 0.6 - r * 0.3 * lift];
      x.beginPath(); x.moveTo(sd * r * 0.35, -r * 0.3); x.lineTo(el[0], el[1]); x.lineTo(tip[0], tip[1]); x.quadraticCurveTo(sd * r * 1.05, -r * 0.2 - r * 0.2 * lift, sd * r * 0.95, r * 0.05); x.quadraticCurveTo(sd * r * 0.7, -r * 0.05, sd * r * 0.45, r * 0.15); x.closePath();
      x.fillStyle = U.shade(col.body, -0.2); x.fill(); x.strokeStyle = OL; x.lineWidth = 1; x.stroke();
      seg(x, [[sd * r * 0.35, -r * 0.3], el, tip], r * 0.07, U.shade(col.body, -0.42));
    }
    // tail sways
    const ts = Math.sin(ph + 1) * r * 0.22;
    taper(x, [r * 0.3, r * 0.65], [r * 1.0, r * 1.0], [r * 1.25 + ts, r * 0.5], [r * 1.1 + ts, r * 0.05], r * 0.16, r * 0.07, dk);
    poly(x, [[r * 1.1 + ts, -r * 0.18], [r * 1.25 + ts, r * 0.08], [r * 0.95 + ts, r * 0.08]], dk, OL, 1);
    // legs kick
    for (const sd of [-1, 1]) { const k = Math.sin(ph + (sd > 0 ? Math.PI : 0)) * r * 0.08; seg(x, [[sd * r * 0.3, r * 0.6], [sd * r * 0.38, r * 0.92 + k]], r * 0.17, dk); poly(x, [[sd * r * 0.38 - r * 0.1, r * 0.92 + k], [sd * r * 0.38 + r * 0.12, r * 0.92 + k], [sd * r * 0.38, r * 1.05 + k]], U.shade(col.body, -0.45)); }
    // body + belly
    circle(x, 0, r * 0.1, r * 0.78, shadeR(x, 0, r * 0.1, r * 0.8, col.body), OL, 1.5);
    x.fillStyle = U.rgba(U.mix(col.body, '#ffb070', 0.45), 0.6); x.beginPath(); x.ellipse(0, r * 0.4, r * 0.38, r * 0.3, 0, 0, U.TAU); x.fill();
    // horns + ears
    for (const sd of [-1, 1]) {
      x.beginPath(); x.moveTo(sd * r * 0.3, -r * 0.5); x.quadraticCurveTo(sd * r * 0.75, -r * 1.0, sd * r * 0.42, -r * 1.35); x.quadraticCurveTo(sd * r * 0.5, -r * 0.95, sd * r * 0.12, -r * 0.6); x.closePath(); x.fillStyle = vgrad(x, -r * 1.35, -r * 0.5, '#e8d8b8', 0.05, -0.35); x.fill(); x.strokeStyle = OL; x.lineWidth = 1; x.stroke();
      poly(x, [[sd * r * 0.62, -r * 0.2], [sd * r * 1.05, -r * 0.42], [sd * r * 0.7, 0]], col.body, OL, 1);
    }
    // the casting hand with a flickering fireball
    seg(x, [[-r * 0.55, r * 0.2], [-r * 0.85, r * 0.55]], r * 0.17, dk);
    seg(x, [[r * 0.55, -r * 0.05], [r * 0.85, -r * 0.35], [r * 1.0, -r * 0.55]], r * 0.17, dk);
    flame(x, r * 1.05, -r * 0.5, r * 0.26, r * 0.75, t, col.eye, '#ff5a1a', 1);
    circle(x, r * 1.05, -r * 0.62, r * 0.18, rgrad(x, r * 1.05, -r * 0.62, r * 0.18, [[0, '#fff'], [0.5, col.eye], [1, U.rgba(col.eye, 0.4)]]));
    eyes(x, 0, -r * 0.15, r * 0.28, r * 0.14, col.eye);
    x.fillStyle = '#2a0808'; x.beginPath(); x.moveTo(-r * 0.32, r * 0.18); x.quadraticCurveTo(0, r * 0.5, r * 0.32, r * 0.18); x.quadraticCurveTo(0, r * 0.32, -r * 0.32, r * 0.18); x.fill();
    poly(x, [[-r * 0.22, r * 0.23], [-r * 0.15, r * 0.4], [-r * 0.08, r * 0.27]], '#fff'); poly(x, [[r * 0.22, r * 0.23], [r * 0.15, r * 0.4], [r * 0.08, r * 0.27]], '#fff');
    x.restore();
  },
  wraith(x: Ctx, r: number, col: EnemyColors, t: number) {
    const ph = t * U.TAU, by = r * 0.12 * Math.sin(ph), base = col.body.startsWith('#') ? col.body : '#8888aa';
    x.save(); x.translate(0, by);
    // reaching arms (behind the robe)
    for (const sd of [-1, 1]) {
      const sw = Math.sin(ph + (sd > 0 ? 1.2 : 0)) * r * 0.12, hand: Pt = [sd * r * 1.3, r * 0.15 + sw];
      taper(x, [sd * r * 0.55, -r * 0.35], [sd * r * 0.9, -r * 0.3], [sd * r * 1.1, r * 0.05 + sw * 0.5], hand, r * 0.36, r * 0.16, U.rgba(U.shade(base, -0.05), 0.85));
      x.strokeStyle = U.rgba(col.eye, 0.75); x.lineWidth = r * 0.05; x.lineCap = 'round';
      for (let k = -1; k <= 1; k++) { x.beginPath(); x.moveTo(hand[0], hand[1]); x.quadraticCurveTo(hand[0] + sd * r * 0.2, hand[1] + k * r * 0.05, hand[0] + sd * r * 0.22, hand[1] + r * 0.18 + k * r * 0.08); x.stroke(); }
    }
    // the robe and its ragged, waving hem
    const hem: Pt[] = [];
    for (let i = 0; i <= 8; i++) { const k = i / 8, hx = -r * 0.95 + k * r * 1.9 + Math.sin(ph + i * 0.9) * r * 0.06, hy = r * (i % 2 ? 0.62 : 1.05) + Math.sin(ph * 1 + i * 1.3) * r * 0.16; hem.push([hx, hy]); }
    x.beginPath(); x.moveTo(-r * 0.92, -r * 0.2); x.quadraticCurveTo(-r * 1.0, -r * 1.25, 0, -r * 1.28); x.quadraticCurveTo(r * 1.0, -r * 1.25, r * 0.92, -r * 0.2);
    x.quadraticCurveTo(r * 1.02, r * 0.4, hem[8][0], hem[8][1]); for (let i = 7; i >= 0; i--) x.lineTo(hem[i][0], hem[i][1]); x.quadraticCurveTo(-r * 1.02, r * 0.4, -r * 0.92, -r * 0.2); x.closePath();
    const g = x.createLinearGradient(0, -r * 1.2, 0, r * 1.1); g.addColorStop(0, U.shade(base, 0.25)); g.addColorStop(0.55, U.rgba(base, 0.85)); g.addColorStop(1, U.rgba(base, 0.08));
    x.fillStyle = g; x.fill(); x.strokeStyle = U.rgba(col.eye, 0.45); x.lineWidth = 1; x.stroke();
    x.strokeStyle = U.rgba(U.shade(base, -0.35), 0.5); x.lineWidth = r * 0.06;
    for (let i = -1; i <= 1; i++) { x.beginPath(); x.moveTo(i * r * 0.35, -r * 0.2); x.quadraticCurveTo(i * r * 0.42 + Math.sin(ph + i) * r * 0.06, r * 0.3, hem[4 + i * 2][0], hem[4 + i * 2][1] - r * 0.1); x.stroke(); }
    // hood hollow, eyes, ghostly mouth
    x.fillStyle = 'rgba(6,4,16,0.85)'; x.beginPath(); x.ellipse(0, -r * 0.55, r * 0.5, r * 0.45, 0, 0, U.TAU); x.fill();
    x.strokeStyle = U.rgba(U.shade(base, 0.4), 0.8); x.lineWidth = r * 0.08; x.beginPath(); x.ellipse(0, -r * 0.55, r * 0.55, r * 0.5, 0, Math.PI * 0.95, Math.PI * 2.05); x.stroke();
    eyes(x, 0, -r * 0.6, r * 0.22, r * 0.12, col.eye);
    x.fillStyle = U.rgba(col.eye, 0.55 + 0.25 * Math.sin(ph * 2)); x.beginPath(); x.ellipse(0, -r * 0.3, r * 0.08, r * 0.12 + r * 0.03 * Math.sin(ph), 0, 0, U.TAU); x.fill();
    x.restore();
  },
  spider(x: Ctx, r: number, col: EnemyColors, t: number) { spiderBody(x, r, col, t); },
  charger(x: Ctx, r: number, col: EnemyColors, t: number) {
    // Bone Boar, side view facing +x, trotting on diagonal pairs
    const ph = t * U.TAU, bob = -r * 0.05 * (1 - Math.cos(ph * 2)) / 2, dk = U.shade(col.body, -0.35), hoof = '#2a1c14';
    const leg = (lx: number, g: number, far: boolean) => {
      const sw = Math.sin(g), up = Math.max(0, Math.cos(g)), hip: Pt = [lx, r * 0.3 + bob], foot: Pt = [lx + r * 0.24 * sw, r * 0.95 - up * r * 0.18], knee: Pt = [lx + r * 0.12 * sw + r * 0.06, r * 0.65 - up * r * 0.12];
      const c = far ? U.shade(col.body, -0.45) : dk;
      seg(x, [hip, knee, foot], r * 0.3, OL); seg(x, [hip, knee, foot], r * 0.22, c);
      x.fillStyle = hoof; x.fillRect(foot[0] - r * 0.12, foot[1] - r * 0.02, r * 0.24, r * 0.1);
    };
    leg(r * 0.42, ph + Math.PI, true); leg(-r * 0.68, ph, true);
    x.save(); x.translate(0, bob);
    // curly tail
    const tw = Math.sin(ph * 2) * r * 0.08; x.strokeStyle = dk; x.lineWidth = r * 0.08; x.lineCap = 'round'; x.beginPath(); x.moveTo(-r * 1.0, -r * 0.15); x.quadraticCurveTo(-r * 1.3, -r * 0.4 + tw, -r * 1.15, -r * 0.5 + tw); x.quadraticCurveTo(-r * 1.0, -r * 0.45 + tw, -r * 1.12, -r * 0.32 + tw); x.stroke();
    // body
    x.beginPath(); x.moveTo(-r * 1.02, r * 0.0); x.bezierCurveTo(-r * 1.05, -r * 0.6, -r * 0.2, -r * 0.82, r * 0.45, -r * 0.62); x.bezierCurveTo(r * 0.9, -r * 0.5, r * 0.95, r * 0.25, r * 0.6, r * 0.45); x.bezierCurveTo(r * 0.1, r * 0.62, -r * 0.7, r * 0.6, -r * 1.02, r * 0.0); x.closePath();
    x.fillStyle = shadeR(x, -r * 0.1, -r * 0.1, r * 1.05, col.body, 0.2); x.fill(); x.strokeStyle = OL; x.lineWidth = 1.5; x.stroke();
    x.fillStyle = U.rgba(U.shade(col.body, 0.25), 0.45); x.beginPath(); x.ellipse(-r * 0.1, r * 0.35, r * 0.6, r * 0.16, 0, 0, U.TAU); x.fill();
    // bristle mane and exposed bone plates along the back
    x.fillStyle = U.shade(col.body, -0.5);
    for (let i = 0; i < 7; i++) { const k = i / 6, px = -r * 0.75 + k * r * 1.2, py = -r * 0.52 - Math.sin(k * Math.PI) * r * 0.22, wv = Math.sin(ph * 2 + i) * r * 0.03; poly(x, [[px - r * 0.1, py + r * 0.08], [px - r * 0.05 + wv, py - r * 0.22], [px + r * 0.08, py + r * 0.08]], U.shade(col.body, -0.5)); }
    for (let i = 0; i < 3; i++) { const px = -r * 0.55 + i * r * 0.38, py = -r * 0.5 - Math.sin((i + 1) / 4 * Math.PI) * r * 0.12; x.fillStyle = '#e8e0c8'; x.beginPath(); x.ellipse(px, py, r * 0.16, r * 0.07, -0.15, 0, U.TAU); x.fill(); x.strokeStyle = '#3a3020'; x.lineWidth = 1; x.stroke(); }
    // near legs
    x.restore(); leg(r * 0.55, ph, false); leg(-r * 0.55, ph + Math.PI, false); x.save(); x.translate(0, bob);
    // head, snout, tusks
    const nod = Math.sin(ph * 2) * r * 0.03;
    x.beginPath(); x.moveTo(r * 0.45, -r * 0.55); x.quadraticCurveTo(r * 1.05, -r * 0.45 + nod, r * 1.38, r * 0.05 + nod); x.lineTo(r * 1.35, r * 0.32 + nod); x.quadraticCurveTo(r * 0.95, r * 0.45, r * 0.5, r * 0.3); x.closePath();
    x.fillStyle = shadeR(x, r * 0.85, -r * 0.1, r * 0.7, col.body, 0.28); x.fill(); x.strokeStyle = OL; x.lineWidth = 1.5; x.stroke();
    x.beginPath(); x.ellipse(r * 1.38, r * 0.18 + nod, r * 0.1, r * 0.16, 0, 0, U.TAU); x.fillStyle = U.mix(col.body, '#e8a0a0', 0.4); x.fill(); x.strokeStyle = OL; x.lineWidth = 1; x.stroke();
    circle(x, r * 1.38, r * 0.12 + nod, r * 0.03, '#222'); circle(x, r * 1.38, r * 0.24 + nod, r * 0.03, '#222');
    x.beginPath(); x.moveTo(r * 1.12, r * 0.3 + nod); x.quadraticCurveTo(r * 1.4, r * 0.25 + nod, r * 1.35, -r * 0.18 + nod); x.quadraticCurveTo(r * 1.3, r * 0.15 + nod, r * 1.05, r * 0.22 + nod); x.closePath(); x.fillStyle = '#f1ead6'; x.fill(); x.strokeStyle = '#3a3020'; x.lineWidth = 1; x.stroke();
    poly(x, [[r * 0.62, -r * 0.42], [r * 0.6 - nod * 2, -r * 0.82], [r * 0.85, -r * 0.48]], U.shade(col.body, -0.15), OL, 1);
    x.shadowColor = col.eye; x.shadowBlur = r * 0.3; circle(x, r * 0.95, -r * 0.18 + nod, r * 0.08, col.eye); x.shadowBlur = 0; circle(x, r * 0.97, -r * 0.2 + nod, r * 0.03, '#fff');
    x.strokeStyle = 'rgba(0,0,0,0.5)'; x.lineWidth = 1.2; x.beginPath(); x.moveTo(r * 0.82, -r * 0.3 + nod); x.lineTo(r * 1.06, -r * 0.24 + nod); x.stroke();
    x.restore();
  },
  bomber(x: Ctx, r: number, col: EnemyColors, t: number) {
    const ph = t * U.TAU, p = 0.5 + 0.5 * Math.sin(ph * 2), pr = r * (1 + 0.05 * Math.sin(ph * 2)), dk = U.shade(col.body, -0.4);
    for (const sd of [-1, 1]) { const lift = r * 0.15 * Math.max(0, sd * Math.sin(ph)); seg(x, [[sd * r * 0.4, r * 0.7], [sd * r * 0.48, r * 1.02 - lift]], r * 0.2, '#2a2020'); x.fillStyle = '#1a1414'; x.beginPath(); x.ellipse(sd * r * 0.52, r * 1.05 - lift, r * 0.18, r * 0.09, 0, 0, U.TAU); x.fill(); }
    x.save(); x.translate(0, -r * 0.04 * Math.abs(Math.sin(ph)));
    circle(x, 0, 0, pr, rgrad(x, 0, 0, pr, [[0, U.shade(col.body, 0.35)], [0.55, col.body], [1, dk]]), OL, 1.6);
    // glowing cracks breathe
    x.save(); x.beginPath(); x.arc(0, 0, pr, 0, U.TAU); x.clip();
    x.globalAlpha = 0.45 + 0.55 * p; x.strokeStyle = col.eye; x.shadowColor = col.eye; x.shadowBlur = r * 0.5; x.lineWidth = r * 0.07;
    x.beginPath(); x.moveTo(-r * 0.75, -r * 0.2); x.lineTo(-r * 0.45, r * 0.05); x.lineTo(-r * 0.55, r * 0.4); x.moveTo(r * 0.8, -r * 0.3); x.lineTo(r * 0.5, -r * 0.05); x.lineTo(r * 0.62, r * 0.35); x.lineTo(r * 0.4, r * 0.6); x.moveTo(-r * 0.15, r * 0.95); x.lineTo(-r * 0.05, r * 0.65); x.lineTo(r * 0.12, r * 0.55); x.stroke();
    x.shadowBlur = 0; x.globalAlpha = 1; x.restore();
    x.fillStyle = 'rgba(255,255,255,0.3)'; x.beginPath(); x.ellipse(-r * 0.4, -r * 0.45, r * 0.25, r * 0.14, -0.6, 0, U.TAU); x.fill();
    // cap + swaying fuse + flickering spark
    x.fillStyle = vgrad(x, -pr - r * 0.2, -pr + r * 0.1, '#5a5560', 0.2, -0.2); x.fillRect(-r * 0.25, -pr - r * 0.15, r * 0.5, r * 0.25); x.strokeStyle = OL; x.lineWidth = 1; x.strokeRect(-r * 0.25, -pr - r * 0.15, r * 0.5, r * 0.25);
    const fs = Math.sin(ph) * r * 0.1, fx = r * 0.55 + fs, fy = -pr - r * 0.5;
    x.strokeStyle = '#3a2a1a'; x.lineWidth = r * 0.1; x.beginPath(); x.moveTo(0, -pr - r * 0.15); x.quadraticCurveTo(r * 0.1 + fs * 0.5, -pr - r * 0.6, fx, fy); x.stroke();
    const rnd = U.mulberry32(Math.floor(t * 997) + 7), n = 5 + Math.floor(rnd() * 3);
    x.globalCompositeOperation = 'lighter'; x.drawImage(glow(col.eye, r * 0.8), fx - r * 0.8, fy - r * 0.8, r * 1.6, r * 1.6);
    x.strokeStyle = '#fff4c0'; x.lineWidth = r * 0.05; for (let i = 0; i < n; i++) { const a = rnd() * U.TAU, l = r * (0.18 + rnd() * 0.3); x.beginPath(); x.moveTo(fx, fy); x.lineTo(fx + Math.cos(a) * l, fy + Math.sin(a) * l); x.stroke(); }
    x.globalCompositeOperation = 'source-over'; circle(x, fx, fy, r * 0.1, '#fff');
    // angry face with a glowing grin
    x.fillStyle = '#1a0a04'; poly(x, [[-r * 0.5, -r * 0.35], [-r * 0.1, -r * 0.2], [-r * 0.12, -r * 0.1], [-r * 0.5, -r * 0.22]], '#1a0a04'); poly(x, [[r * 0.5, -r * 0.35], [r * 0.1, -r * 0.2], [r * 0.12, -r * 0.1], [r * 0.5, -r * 0.22]], '#1a0a04');
    eyes(x, 0, -r * 0.08, r * 0.3, r * 0.12, col.eye);
    x.fillStyle = U.rgba(col.eye, 0.6 + 0.4 * p); x.shadowColor = col.eye; x.shadowBlur = r * 0.4;
    x.beginPath(); x.moveTo(-r * 0.4, r * 0.25); for (let i = 0; i <= 6; i++) x.lineTo(-r * 0.4 + i * r * 0.133, r * (i % 2 ? 0.48 : 0.3)); x.lineTo(r * 0.4, r * 0.25); x.quadraticCurveTo(0, r * 0.55, -r * 0.4, r * 0.25); x.fill(); x.shadowBlur = 0;
    x.restore();
  },
  brute(x: Ctx, r: number, col: EnemyColors, t: number) { bruteBody(x, r, col, t); },
  shaman(x: Ctx, r: number, col: EnemyColors, t: number) {
    const ph = t * U.TAU, bob = -r * 0.05 * (1 - Math.cos(ph * 2)) / 2, ac = col.accent || '#f8c', sb = Math.sin(ph) * r * 0.08;
    x.save(); x.translate(0, bob);
    // staff (behind the robe on the right) bobs with each step
    x.save(); x.translate(r * 1.0, -r * 0.1 + sb); x.rotate(0.08);
    seg(x, [[0, r * 1.05], [0, -r * 0.9]], r * 0.18, OL); seg(x, [[0, r * 1.05], [0, -r * 0.9]], r * 0.12, '#5a3a1a');
    x.strokeStyle = '#3a2410'; x.lineWidth = 1; for (let i = 0; i < 3; i++) { x.beginPath(); x.moveTo(-r * 0.06, -r * 0.4 + i * r * 0.12); x.lineTo(r * 0.06, -r * 0.36 + i * r * 0.12); x.stroke(); }
    // dangling charms
    for (const k of [-1, 1]) { const sw = Math.sin(ph + k) * r * 0.08; x.strokeStyle = '#c9b07a'; x.lineWidth = 0.8; x.beginPath(); x.moveTo(k * r * 0.12, -r * 0.8); x.lineTo(k * r * 0.18 + sw, -r * 0.45); x.stroke(); circle(x, k * r * 0.18 + sw, -r * 0.42, r * 0.06, k > 0 ? ac : '#e8e0d0'); }
    const gp = 0.75 + 0.25 * Math.sin(ph * 2);
    x.globalAlpha = gp; x.drawImage(glow(col.eye, r * 0.7), -r * 0.7, -r * 1.75, r * 1.4, r * 1.4); x.globalAlpha = 1;
    circle(x, 0, -r * 1.05, r * 0.24, rgrad(x, 0, -r * 1.05, r * 0.24, [[0, '#fff'], [0.45, col.eye], [1, U.shade(col.eye, -0.4)]]), OL, 1);
    for (const k of [-1, 1]) seg(x, [[0, -r * 0.88], [k * r * 0.22, -r * 1.0], [k * r * 0.2, -r * 1.3]], r * 0.06, '#5a3a1a');
    x.restore();
    // robe with swaying hem
    const hs = Math.sin(ph + 0.5) * r * 0.08;
    x.beginPath(); x.moveTo(-r * 0.55, -r * 0.45); x.quadraticCurveTo(-r * 0.95, r * 0.3, -r * 0.85 + hs, r * 1.0); x.lineTo(-r * 0.4 + hs, r * 0.9); x.lineTo(0 + hs, r * 1.02); x.lineTo(r * 0.4 + hs, r * 0.9); x.lineTo(r * 0.85 + hs, r * 1.0); x.quadraticCurveTo(r * 0.95, r * 0.3, r * 0.55, -r * 0.45); x.closePath();
    x.fillStyle = shadeR(x, -r * 0.1, 0, r * 1.1, col.body, 0.18); x.fill(); x.strokeStyle = OL; x.lineWidth = 1.5; x.stroke();
    x.fillStyle = U.rgba(ac, 0.75); x.fillRect(-r * 0.08, -r * 0.2, r * 0.16, r * 1.15);
    x.strokeStyle = 'rgba(0,0,0,0.3)'; x.lineWidth = 1; x.beginPath(); x.moveTo(-r * 0.4, r * 0.1); x.quadraticCurveTo(-r * 0.5, r * 0.5, -r * 0.45 + hs, r * 0.92); x.moveTo(r * 0.38, r * 0.1); x.quadraticCurveTo(r * 0.48, r * 0.5, r * 0.42 + hs, r * 0.92); x.stroke();
    // bone necklace
    for (let i = 0; i < 5; i++) { const a = Math.PI * (0.2 + i * 0.15); x.fillStyle = '#ece4d0'; x.beginPath(); x.ellipse(Math.cos(a) * r * 0.42, -r * 0.3 + Math.sin(a) * r * 0.22, r * 0.05, r * 0.08, a, 0, U.TAU); x.fill(); }
    // arms: one raised in a chant, one gripping the staff
    const ch = Math.sin(ph * 2) * r * 0.06;
    seg(x, [[-r * 0.5, -r * 0.3], [-r * 0.9, -r * 0.2 + ch], [-r * 0.95, -r * 0.6 + ch]], r * 0.22, U.shade(col.body, -0.15));
    circle(x, -r * 0.95, -r * 0.65 + ch, r * 0.1, '#c8b8a0');
    x.globalCompositeOperation = 'lighter'; x.globalAlpha = 0.5 + 0.3 * Math.sin(ph * 2); x.drawImage(glow(col.eye, r * 0.35), -r * 1.3, -r * 1.0 + ch, r * 0.7, r * 0.7); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
    seg(x, [[r * 0.5, -r * 0.3], [r * 0.85, -r * 0.05], [r * 1.0, -r * 0.05 + sb]], r * 0.22, U.shade(col.body, -0.15));
    circle(x, r * 1.0, -r * 0.05 + sb, r * 0.1, '#c8b8a0');
    // feathers sway, then the skull mask
    for (let i = -2; i <= 2; i++) { const a = -Math.PI / 2 + i * 0.32 + Math.sin(ph + i * 0.7) * 0.1, l = r * (0.85 - Math.abs(i) * 0.1), bx = Math.cos(a) * r * 0.32, byy = -r * 0.68 + Math.sin(a) * r * 0.32; x.save(); x.translate(bx, byy); x.rotate(a + Math.PI / 2); x.beginPath(); x.moveTo(0, 0); x.quadraticCurveTo(r * 0.11, -l * 0.5, 0, -l); x.quadraticCurveTo(-r * 0.11, -l * 0.5, 0, 0); x.fillStyle = i % 2 ? ac : U.shade(ac, -0.25); x.fill(); x.strokeStyle = OL; x.lineWidth = 0.8; x.stroke(); x.restore(); }
    circle(x, 0, -r * 0.6, r * 0.42, rgrad(x, 0, -r * 0.6, r * 0.42, [[0, '#fbf8ee'], [0.7, '#d8ceb4'], [1, '#a89c80']]), OL, 1.4);
    x.fillStyle = 'rgba(0,0,0,0.8)'; x.beginPath(); x.ellipse(-r * 0.16, -r * 0.62, r * 0.12, r * 0.1, 0, 0, U.TAU); x.fill(); x.beginPath(); x.ellipse(r * 0.16, -r * 0.62, r * 0.12, r * 0.1, 0, 0, U.TAU); x.fill();
    eyes(x, 0, -r * 0.62, r * 0.16, r * 0.07, col.eye);
    x.fillStyle = '#2a2018'; for (let i = 0; i < 4; i++) x.fillRect(-r * 0.15 + i * r * 0.09, -r * 0.42, r * 0.04, r * 0.1);
    x.strokeStyle = ac; x.lineWidth = r * 0.04; x.beginPath(); x.moveTo(-r * 0.3, -r * 0.8); x.lineTo(-r * 0.15, -r * 0.75); x.moveTo(r * 0.3, -r * 0.8); x.lineTo(r * 0.15, -r * 0.75); x.stroke();
    x.restore();
  },
  golem(x: Ctx, r: number, col: EnemyColors, t: number) {
    const ph = t * U.TAU, s = Math.sin(ph), bob = -r * 0.045 * (1 - Math.cos(ph * 2)) / 2, glw = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(ph * 2));
    const rock = (pts: readonly Pt[], cx: number, cy: number, rr: number, hi = 0.2) => { poly(x, pts, shadeR(x, cx, cy, rr, col.body, hi, -0.42), 'rgba(0,0,0,0.7)', 1.6); x.strokeStyle = 'rgba(255,255,255,0.14)'; x.lineWidth = 1; x.beginPath(); x.moveTo(pts[0][0], pts[0][1]); x.lineTo(pts[1][0], pts[1][1]); x.stroke(); };
    const crack = (pts: readonly Pt[]) => { x.globalAlpha = glw; x.strokeStyle = col.eye; x.shadowColor = col.eye; x.shadowBlur = r * 0.35; x.lineWidth = r * 0.07; x.beginPath(); x.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) x.lineTo(pts[i][0], pts[i][1]); x.stroke(); x.shadowBlur = 0; x.strokeStyle = U.rgba('#ffffff', 0.7); x.lineWidth = r * 0.025; x.stroke(); x.globalAlpha = 1; };
    for (const sd of [-1, 1]) { const lift = r * 0.1 * Math.max(0, sd * s), lx = sd * r * 0.45, ly = r * 0.85 - lift + bob * 0.3; rock([[lx - r * 0.25, ly - r * 0.35], [lx + r * 0.25, ly - r * 0.38], [lx + r * 0.3, ly + r * 0.1], [lx + r * 0.2, ly + r * 0.18], [lx - r * 0.28, ly + r * 0.16]], lx, ly - r * 0.1, r * 0.35, 0.1); }
    x.save(); x.translate(0, bob);
    const arm = (sd: number, sw: number) => {
      const ax = sd * r * 1.12, ay = r * 0.38 - sw * r * 0.16;
      rock([[sd * r * 0.75, -r * 0.62], [sd * r * 1.25, -r * 0.55], [sd * r * 1.3, -r * 0.05], [sd * r * 0.85, r * 0.05]], sd * r * 1.0, -r * 0.4, r * 0.4);
      rock([[ax - r * 0.28, ay - r * 0.3], [ax + r * 0.25, ay - r * 0.35], [ax + r * 0.35, ay + r * 0.15], [ax + r * 0.05, ay + r * 0.38], [ax - r * 0.32, ay + r * 0.2]], ax, ay, r * 0.4, 0.15);
      crack([[ax - r * 0.1, ay - r * 0.2], [ax + r * 0.05, ay], [ax - r * 0.05, ay + r * 0.2]]);
    };
    arm(-1, s);
    x.save(); x.rotate(0.05 * s);
    rock([[-r * 0.85, -r * 0.5], [-r * 0.45, -r * 0.95], [r * 0.55, -r * 0.9], [r * 0.92, -r * 0.3], [r * 0.82, r * 0.6], [r * 0.3, r * 0.82], [-r * 0.65, r * 0.75], [-r * 0.95, r * 0.15]], 0, -r * 0.1, r);
    x.fillStyle = 'rgba(0,0,0,0.18)'; poly(x, [[-r * 0.3, r * 0.3], [r * 0.5, r * 0.15], [r * 0.6, r * 0.6], [-r * 0.2, r * 0.72]], 'rgba(0,0,0,0.16)');
    crack([[-r * 0.35, r * 0.25], [-r * 0.1, -r * 0.05], [r * 0.25, r * 0.05], [r * 0.45, r * 0.5]]); crack([[-r * 0.6, -r * 0.45], [-r * 0.4, -r * 0.15]]); crack([[r * 0.55, -r * 0.6], [r * 0.4, -r * 0.35], [r * 0.6, -r * 0.2]]);
    // glowing core
    x.globalAlpha = glw; x.drawImage(glow(col.eye, r * 0.45), -r * 0.45, -r * 0.35, r * 0.9, r * 0.9); x.globalAlpha = 1;
    circle(x, 0, r * 0.1, r * 0.12, U.rgba('#fff8e0', 0.6 + 0.4 * glw));
    // brow and eyes
    poly(x, [[-r * 0.45, -r * 0.62], [r * 0.45, -r * 0.65], [r * 0.38, -r * 0.48], [-r * 0.4, -r * 0.45]], U.shade(col.body, -0.2), 'rgba(0,0,0,0.6)', 1);
    eyes(x, 0, -r * 0.38, r * 0.22, r * 0.11, col.eye);
    x.restore();
    arm(1, -s);
    x.restore();
  },
  watcher(x: Ctx, r: number, col: EnemyColors, t: number) {
    const ph = t * U.TAU, by = r * 0.1 * Math.sin(ph), dk = U.shade(col.body, -0.3);
    x.save(); x.translate(0, by);
    for (let i = 0; i < 6; i++) {
      const a = 0.35 + i * 0.49, dx = Math.cos(a), dy = Math.sin(a), px = -dy, py = dx, w1 = Math.sin(ph + i * 1.3), w2 = Math.sin(ph + i * 1.3 + 1.4), L = r * (1.05 + (i % 2) * 0.25);
      const p0: Pt = [dx * r * 0.75, dy * r * 0.75], p1: Pt = [dx * r * 1.1 + px * r * 0.3 * w1, dy * r * 1.1 + py * r * 0.3 * w1 + r * 0.15], p2: Pt = [dx * (r * 0.7 + L * 0.6) + px * r * 0.35 * w2, dy * (r * 0.7 + L * 0.6) + py * r * 0.35 * w2 + r * 0.3], p3: Pt = [dx * (r * 0.75 + L) + px * r * 0.25 * w1, dy * (r * 0.75 + L) * 0.85 + r * 0.45 + py * r * 0.2 * w2];
      taper(x, p0, p1, p2, p3, r * 0.26, r * 0.04, OL); taper(x, p0, p1, p2, p3, r * 0.19, r * 0.02, dk);
    }
    circle(x, 0, 0, r, shadeR(x, 0, 0, r, col.body, 0.28), OL, 1.6);
    x.strokeStyle = 'rgba(0,0,0,0.25)'; x.lineWidth = 1; for (let i = 0; i < 3; i++) { x.beginPath(); x.arc(0, 0, r * (0.75 + i * 0.08), Math.PI * 1.1, Math.PI * 1.9); x.stroke(); }
    // eye with drifting pupil
    x.save(); x.beginPath(); x.ellipse(0, r * 0.02, r * 0.66, r * 0.56, 0, 0, U.TAU); x.clip();
    x.fillStyle = rgrad(x, 0, 0, r * 0.7, [[0, '#fffaf0'], [0.7, '#efe4d4'], [1, '#c09a9a']]); x.fillRect(-r, -r, r * 2, r * 2);
    x.strokeStyle = 'rgba(200,40,40,0.45)'; x.lineWidth = 0.8; for (let i = 0; i < 6; i++) { const a = i * 1.05 + 0.3; x.beginPath(); x.moveTo(Math.cos(a) * r * 0.66, Math.sin(a) * r * 0.56); x.quadraticCurveTo(Math.cos(a + 0.2) * r * 0.5, Math.sin(a + 0.2) * r * 0.42, Math.cos(a) * r * 0.42, Math.sin(a) * r * 0.36); x.stroke(); }
    const pxo = r * 0.12 * Math.cos(ph), pyo = r * 0.08 * Math.sin(ph);
    circle(x, pxo, pyo, r * 0.38, rgrad(x, pxo, pyo, r * 0.38, [[0, U.shade(col.eye, 0.45)], [0.7, col.eye], [1, U.shade(col.eye, -0.4)]]));
    x.beginPath(); x.ellipse(pxo, pyo, r * 0.1, r * 0.22, 0, 0, U.TAU); x.fillStyle = '#000'; x.fill();
    circle(x, pxo - r * 0.12, pyo - r * 0.14, r * 0.07, '#fff');
    x.fillStyle = 'rgba(0,0,0,0.3)'; x.fillRect(-r, -r * 0.6, r * 2, r * 0.12);
    x.restore();
    x.strokeStyle = U.shade(col.body, -0.45); x.lineWidth = r * 0.07; x.beginPath(); x.ellipse(0, r * 0.02, r * 0.66, r * 0.56, 0, 0, U.TAU); x.stroke();
    x.restore();
  },
  /* ---- new kinds ---- */
  hoarder(x: Ctx, r: number, col: EnemyColors, t: number) {
    // Gilded Hoarder: a hunched goblin sprinting right with a bulging sack of gold
    const ph = t * U.TAU, bob = -r * 0.1 * Math.abs(Math.sin(ph)), gold = col.accent || '#f5c542', dk = U.shade(col.body, -0.3), cloth = '#4a3424';
    const leg = (g: number, far: boolean) => {
      const sw = Math.sin(g), up = Math.max(0, Math.cos(g)), hip: Pt = [-r * 0.05, r * 0.38 + bob], foot: Pt = [r * 0.6 * sw, r * 1.0 - up * r * 0.35], knee: Pt = [r * 0.3 * sw + r * 0.2 + up * r * 0.12, r * 0.7 - up * r * 0.3];
      seg(x, [hip, knee, foot], r * 0.24, OL); seg(x, [hip, knee, foot], r * 0.17, far ? U.shade(col.body, -0.45) : dk);
      x.fillStyle = far ? '#1a120c' : '#2a1c12'; x.beginPath(); x.ellipse(foot[0] + r * 0.1, foot[1], r * 0.18, r * 0.08, 0, 0, U.TAU); x.fill();
    };
    leg(ph + Math.PI, true);
    x.save(); x.translate(0, bob);
    // the sack over the shoulder, lagging the bounce
    const sl = r * 0.07 * Math.cos(ph * 2 - 0.9), sx = -r * 0.62, sy = -r * 0.55 + sl;
    x.beginPath(); x.moveTo(sx + r * 0.35, sy - r * 0.55); x.bezierCurveTo(sx + r * 1.0, sy - r * 0.2, sx + r * 0.75, sy + r * 0.75, sx, sy + r * 0.72); x.bezierCurveTo(sx - r * 0.85, sy + r * 0.7, sx - r * 0.85, sy - r * 0.35, sx - r * 0.2, sy - r * 0.6); x.closePath();
    x.fillStyle = shadeR(x, sx, sy, r * 0.85, '#a8804c', 0.2); x.fill(); x.strokeStyle = OL; x.lineWidth = 1.4; x.stroke();
    x.strokeStyle = 'rgba(60,40,20,0.5)'; x.lineWidth = 1; x.beginPath(); x.moveTo(sx - r * 0.4, sy - r * 0.1); x.quadraticCurveTo(sx - r * 0.1, sy + r * 0.2, sx - r * 0.3, sy + r * 0.55); x.moveTo(sx + r * 0.2, sy - r * 0.2); x.quadraticCurveTo(sx + r * 0.4, sy + r * 0.1, sx + r * 0.25, sy + r * 0.5); x.stroke();
    // patch
    x.fillStyle = '#7a5a34'; x.fillRect(sx - r * 0.15, sy + r * 0.1, r * 0.3, r * 0.25); x.strokeStyle = '#3a2a14'; x.setLineDash([2, 2]); x.strokeRect(sx - r * 0.15, sy + r * 0.1, r * 0.3, r * 0.25); x.setLineDash([]);
    // coins spilling from the mouth
    for (let i = 0; i < 5; i++) { const cx = sx - r * 0.25 + i * r * 0.14, cy = sy - r * 0.62 + Math.abs(i - 2) * r * 0.06; x.beginPath(); x.ellipse(cx, cy, r * 0.12, r * 0.08, 0.2 * (i - 2), 0, U.TAU); x.fillStyle = rgrad(x, cx, cy, r * 0.12, [[0, '#fff6c0'], [0.5, gold], [1, U.shade(gold, -0.35)]]); x.fill(); x.strokeStyle = '#6a4a10'; x.lineWidth = 0.8; x.stroke(); }
    x.strokeStyle = '#3a2a14'; x.lineWidth = r * 0.08; x.beginPath(); x.moveTo(sx - r * 0.25, sy - r * 0.5); x.lineTo(sx + r * 0.38, sy - r * 0.5); x.stroke();
    // glints
    x.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 3; k++) { const a = Math.max(0, Math.sin(ph + k * 2.1)), gx = sx - r * 0.2 + k * r * 0.22, gy = sy - r * 0.68 + (k % 2) * r * 0.05; if (a > 0.05) { x.globalAlpha = a; x.strokeStyle = '#fffbe0'; x.lineWidth = r * 0.04; x.beginPath(); x.moveTo(gx - r * 0.16, gy); x.lineTo(gx + r * 0.16, gy); x.moveTo(gx, gy - r * 0.16); x.lineTo(gx, gy + r * 0.16); x.stroke(); x.drawImage(glow('#ffe58a', r * 0.2), gx - r * 0.2, gy - r * 0.2, r * 0.4, r * 0.4); } }
    x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
    // hunched body leaning into the run
    x.save(); x.rotate(0.22);
    x.beginPath(); x.ellipse(0, r * 0.05, r * 0.5, r * 0.55, 0, 0, U.TAU); x.fillStyle = shadeR(x, 0, 0, r * 0.6, col.body, 0.2); x.fill(); x.strokeStyle = OL; x.lineWidth = 1.4; x.stroke();
    poly(x, [[-r * 0.48, -r * 0.05], [r * 0.45, -r * 0.1], [r * 0.48, r * 0.4], [r * 0.25, r * 0.55], [r * 0.05, r * 0.42], [-r * 0.15, r * 0.6], [-r * 0.45, r * 0.42]], cloth, OL, 1);
    x.fillStyle = gold; x.fillRect(-r * 0.46, r * 0.18, r * 0.92, r * 0.07);
    x.restore();
    // the arm over the shoulder gripping the sack
    seg(x, [[-r * 0.1, -r * 0.2], [-r * 0.25, -r * 0.55], [-r * 0.45, -r * 0.95 + sl]], r * 0.17, dk); circle(x, -r * 0.45, -r * 0.98 + sl, r * 0.1, col.body);
    // head: big ears, long nose, toothy grin
    const hx = r * 0.42, hy = -r * 0.5;
    poly(x, [[hx - r * 0.2, hy - r * 0.1], [hx - r * 0.85, hy - r * 0.45 + Math.sin(ph * 2) * r * 0.05], [hx - r * 0.25, hy + r * 0.12]], shadeR(x, hx - r * 0.4, hy - r * 0.2, r * 0.5, col.body, 0.1), OL, 1);
    circle(x, hx, hy, r * 0.36, shadeR(x, hx, hy, r * 0.38, col.body, 0.25), OL, 1.3);
    poly(x, [[hx + r * 0.2, hy - r * 0.05], [hx + r * 0.72, hy + r * 0.12], [hx + r * 0.22, hy + r * 0.15]], shadeR(x, hx + r * 0.3, hy, r * 0.4, col.body, 0.2), OL, 1);
    x.fillStyle = '#2a1410'; x.beginPath(); x.moveTo(hx + r * 0.05, hy + r * 0.18); x.quadraticCurveTo(hx + r * 0.25, hy + r * 0.32, hx + r * 0.33, hy + r * 0.18); x.closePath(); x.fill();
    x.fillStyle = '#f4ecd0'; x.fillRect(hx + r * 0.12, hy + r * 0.18, r * 0.05, r * 0.06); x.fillRect(hx + r * 0.22, hy + r * 0.19, r * 0.05, r * 0.06);
    x.fillStyle = '#3a2418'; x.beginPath(); x.arc(hx - r * 0.02, hy - r * 0.12, r * 0.34, Math.PI * 1.05, Math.PI * 1.85); x.lineTo(hx - r * 0.02, hy - r * 0.12); x.fill();
    eyes(x, hx + r * 0.14, hy - r * 0.04, 0, r * 0.08, col.eye);
    // free arm pumps
    const fa = Math.sin(ph) * r * 0.3;
    seg(x, [[r * 0.2, -r * 0.05], [r * 0.32 - fa * 0.3, r * 0.2], [r * 0.4 - fa, r * 0.32]], r * 0.16, dk); circle(x, r * 0.4 - fa, r * 0.34, r * 0.09, col.body);
    x.restore();
    leg(ph, false);
  },
  burrower(x: Ctx, r: number, col: EnemyColors, t: number) {
    // Grave Worm erupting from the ground; the body sways
    const ph = t * U.TAU, gy = r * 0.72, dirt = col.accent || '#5a4030', N = 5;
    // the back half of the dirt rim and the hole
    x.fillStyle = '#120c0a'; x.beginPath(); x.ellipse(0, gy, r * 0.95, r * 0.3, 0, 0, U.TAU); x.fill();
    for (let i = 0; i < 7; i++) { const a = Math.PI + (i / 6) * Math.PI, cx = Math.cos(a) * r * 0.98, cy = gy + Math.sin(a) * r * 0.3; circle(x, cx, cy, r * (0.16 + (i % 2) * 0.05), shadeR(x, cx, cy, r * 0.2, dirt, 0.15), OL, 1); }
    // body segments from the ground up
    const segs: [number, number, number][] = [];
    for (let i = 0; i <= N; i++) { const k = i / N, sw = Math.sin(ph - i * 0.7) * r * 0.32 * Math.pow(k, 1.1); segs.push([sw, U.lerp(gy - r * 0.05, -r * 0.42, k), r * (0.5 - k * 0.06)]); }
    for (let i = 0; i < N; i++) { const [sx, sy, sr] = segs[i]; x.beginPath(); x.ellipse(sx, sy, sr, sr * 0.82, Math.sin(ph - i * 0.7) * 0.15, 0, U.TAU); x.fillStyle = shadeR(x, sx, sy, sr, col.body, 0.2); x.fill(); x.strokeStyle = OL; x.lineWidth = 1.2; x.stroke(); x.strokeStyle = U.rgba(U.shade(col.body, -0.35), 0.8); x.lineWidth = r * 0.05; x.beginPath(); x.ellipse(sx, sy + sr * 0.2, sr * 0.92, sr * 0.55, 0, Math.PI * 0.1, Math.PI * 0.9); x.stroke(); x.fillStyle = 'rgba(255,255,255,0.18)'; x.beginPath(); x.ellipse(sx - sr * 0.4, sy - sr * 0.35, sr * 0.25, sr * 0.12, -0.5, 0, U.TAU); x.fill(); }
    // head with a ring of mandibles around a glowing gullet
    const [hx, hy] = segs[N], hr = r * 0.58, open = 0.8 + 0.2 * Math.sin(ph * 2);
    circle(x, hx, hy, hr, shadeR(x, hx, hy, hr, col.body, 0.25), OL, 1.5);
    for (let i = 0; i < 6; i++) { const a = i / 6 * U.TAU + 0.25, bx = hx + Math.cos(a) * hr * 0.55 * open, byy = hy + Math.sin(a) * hr * 0.5 * open; x.save(); x.translate(bx, byy); x.rotate(a + Math.PI / 2); poly(x, [[-r * 0.09, 0], [0, -r * 0.08], [r * 0.09, 0], [r * 0.02, r * 0.26 * open]], '#efe2c4', OL, 1); x.restore(); }
    x.beginPath(); x.ellipse(hx, hy, hr * 0.45 * open, hr * 0.4 * open, 0, 0, U.TAU); x.fillStyle = rgrad(x, hx, hy, hr * 0.45, [[0, U.rgba(col.eye, 0.95)], [0.4, '#4a0a14'], [1, '#12040a']]); x.fill();
    for (let i = 0; i < 8; i++) { const a = i / 8 * U.TAU; poly(x, [[hx + Math.cos(a) * hr * 0.42 * open, hy + Math.sin(a) * hr * 0.38 * open], [hx + Math.cos(a + 0.2) * hr * 0.3 * open, hy + Math.sin(a + 0.2) * hr * 0.27 * open], [hx + Math.cos(a - 0.2) * hr * 0.42 * open, hy + Math.sin(a - 0.2) * hr * 0.38 * open]], '#f4ecd8'); }
    eyes(x, hx, hy - hr * 0.75, hr * 0.38, r * 0.05, col.eye);
    // the front half of the rim, flying clods
    for (let i = 0; i < 7; i++) { const a = (i / 6) * Math.PI, cx = Math.cos(a) * r * 1.0, cy = gy + Math.sin(a) * r * 0.32; circle(x, cx, cy, r * (0.17 + ((i + 1) % 2) * 0.06), shadeR(x, cx, cy, r * 0.22, dirt, 0.18), OL, 1); }
    for (let k = 0; k < 3; k++) { const p = (t + k / 3) % 1, dir = k === 1 ? -1 : 1, cx = dir * r * (0.5 + p * 0.7), cy = gy - r * 0.2 - Math.sin(p * Math.PI) * r * 0.7; x.globalAlpha = Math.sin(p * Math.PI); circle(x, cx, cy, r * 0.07, U.shade(dirt, 0.1)); x.globalAlpha = 1; }
  },
  bastion(x: Ctx, r: number, col: EnemyColors, t: number) {
    // Bastion Knight facing +x behind a tower shield; marching gait
    const ph = t * U.TAU, bob = -r * 0.05 * (1 - Math.cos(ph * 2)) / 2, steel = col.body, trim = col.accent || '#c9a227', dk = U.shade(steel, -0.3);
    const leg = (g: number, far: boolean) => {
      const sw = Math.sin(g), up = Math.max(0, Math.cos(g)), hip: Pt = [-r * 0.05, r * 0.4 + bob], foot: Pt = [r * 0.3 * sw, r * 1.02 - up * r * 0.16], knee: Pt = [r * 0.15 * sw + r * 0.08, r * 0.72 - up * r * 0.1];
      const c = far ? U.shade(steel, -0.45) : dk;
      seg(x, [hip, knee, foot], r * 0.26, OL); seg(x, [hip, knee, foot], r * 0.2, c);
      circle(x, knee[0], knee[1], r * 0.1, U.shade(c, 0.15), OL, 1);
      x.fillStyle = far ? '#1a1c22' : '#2a2e36'; x.beginPath(); x.moveTo(foot[0] - r * 0.12, foot[1] - r * 0.08); x.lineTo(foot[0] + r * 0.22, foot[1] - r * 0.02); x.lineTo(foot[0] + r * 0.22, foot[1] + r * 0.06); x.lineTo(foot[0] - r * 0.12, foot[1] + r * 0.06); x.closePath(); x.fill();
    };
    leg(ph + Math.PI, true);
    x.save(); x.translate(0, bob);
    // mace arm swinging behind
    const sw = Math.sin(ph) * 0.25;
    x.save(); x.translate(-r * 0.35, -r * 0.2); x.rotate(-0.5 + sw);
    seg(x, [[0, 0], [0, r * 0.55]], r * 0.22, dk);
    x.translate(0, r * 0.6); x.rotate(-1.4);
    seg(x, [[0, 0], [0, -r * 0.75]], r * 0.08, '#4a3a2a');
    circle(x, 0, -r * 0.82, r * 0.17, shadeR(x, 0, -r * 0.82, r * 0.17, '#8a8f98', 0.3), OL, 1);
    for (let i = 0; i < 6; i++) { const a = i / 6 * U.TAU; poly(x, [[Math.cos(a - 0.3) * r * 0.15, -r * 0.82 + Math.sin(a - 0.3) * r * 0.15], [Math.cos(a) * r * 0.27, -r * 0.82 + Math.sin(a) * r * 0.27], [Math.cos(a + 0.3) * r * 0.15, -r * 0.82 + Math.sin(a + 0.3) * r * 0.15]], '#6a6f78'); }
    circle(x, 0, 0, r * 0.12, dk, OL, 1);
    x.restore();
    // torso: breastplate + tabard
    x.beginPath(); x.moveTo(-r * 0.5, -r * 0.45); x.quadraticCurveTo(r * 0.0, -r * 0.62, r * 0.45, -r * 0.42); x.lineTo(r * 0.42, r * 0.3); x.quadraticCurveTo(0, r * 0.5, -r * 0.45, r * 0.3); x.closePath();
    x.fillStyle = shadeR(x, -r * 0.1, -r * 0.2, r * 0.7, steel, 0.3); x.fill(); x.strokeStyle = OL; x.lineWidth = 1.4; x.stroke();
    x.strokeStyle = 'rgba(255,255,255,0.45)'; x.lineWidth = 1; x.beginPath(); x.moveTo(-r * 0.3, -r * 0.42); x.quadraticCurveTo(-r * 0.4, -r * 0.05, -r * 0.3, r * 0.2); x.stroke();
    poly(x, [[-r * 0.3, r * 0.25], [r * 0.3, r * 0.25], [r * 0.34, r * 0.72 + Math.sin(ph + 1) * r * 0.04], [-r * 0.34, r * 0.72 - Math.sin(ph + 1) * r * 0.04]], U.shade(trim, -0.35), OL, 1);
    x.fillStyle = trim; x.fillRect(-r * 0.46, r * 0.18, r * 0.9, r * 0.1);
    // great helm with a glowing visor slit and swaying plume
    const hx = r * 0.05, hy = -r * 0.78, pl = Math.sin(ph - 0.8) * r * 0.08;
    x.beginPath(); x.moveTo(hx - r * 0.05, hy - r * 0.38); x.quadraticCurveTo(hx - r * 0.55 + pl, hy - r * 0.75, hx - r * 0.75 + pl * 1.5, hy - r * 0.25); x.quadraticCurveTo(hx - r * 0.45 + pl, hy - r * 0.45, hx - r * 0.15, hy - r * 0.25); x.closePath(); x.fillStyle = vgrad(x, hy - r * 0.7, hy - r * 0.2, '#b22222', 0.15, -0.25); x.fill(); x.strokeStyle = OL; x.lineWidth = 1; x.stroke();
    x.beginPath(); x.moveTo(hx - r * 0.34, hy + r * 0.32); x.lineTo(hx - r * 0.36, hy - r * 0.15); x.quadraticCurveTo(hx - r * 0.3, hy - r * 0.42, hx + r * 0.05, hy - r * 0.42); x.quadraticCurveTo(hx + r * 0.38, hy - r * 0.4, hx + r * 0.4, hy - r * 0.05); x.lineTo(hx + r * 0.38, hy + r * 0.32); x.closePath();
    x.fillStyle = shadeR(x, hx - r * 0.1, hy - r * 0.15, r * 0.5, steel, 0.35); x.fill(); x.strokeStyle = OL; x.lineWidth = 1.3; x.stroke();
    x.fillStyle = '#0a0a10'; x.fillRect(hx - r * 0.05, hy - r * 0.08, r * 0.44, r * 0.09);
    x.shadowColor = col.eye; x.shadowBlur = r * 0.35; x.fillStyle = col.eye; x.fillRect(hx + r * 0.08, hy - r * 0.065, r * 0.28, r * 0.05); x.shadowBlur = 0;
    x.fillStyle = 'rgba(0,0,0,0.5)'; for (let i = 0; i < 3; i++) circle(x, hx + r * 0.22, hy + r * 0.1 + i * r * 0.07, r * 0.02, 'rgba(0,0,0,0.6)');
    x.strokeStyle = 'rgba(255,255,255,0.6)'; x.lineWidth = 1; x.beginPath(); x.moveTo(hx - r * 0.2, hy - r * 0.32); x.quadraticCurveTo(hx - r * 0.05, hy - r * 0.4, hx + r * 0.15, hy - r * 0.36); x.stroke();
    x.fillStyle = trim; x.fillRect(hx - r * 0.36, hy + r * 0.24, r * 0.74, r * 0.07);
    // pauldron
    x.beginPath(); x.ellipse(-r * 0.32, -r * 0.42, r * 0.28, r * 0.2, -0.3, 0, U.TAU); x.fillStyle = shadeR(x, -r * 0.36, -r * 0.48, r * 0.3, steel, 0.3); x.fill(); x.strokeStyle = OL; x.lineWidth = 1.2; x.stroke();
    x.restore();
    leg(ph, false);
    // tower shield on the +x side
    x.save(); x.translate(r * 0.62, -r * 0.02 + bob + Math.sin(ph * 2) * r * 0.02);
    const W = r * 0.36, H = r * 0.88;
    x.beginPath(); x.moveTo(-W + r * 0.08, -H); x.lineTo(W - r * 0.04, -H + r * 0.06); x.lineTo(W, H * 0.7); x.quadraticCurveTo(W * 0.4, H * 1.05, -W * 0.1 + r * 0.04, H); x.quadraticCurveTo(-W * 0.9, H * 0.75, -W, H * 0.6); x.closePath();
    x.fillStyle = U.shade(steel, -0.45); x.save(); x.translate(-r * 0.08, r * 0.02); x.fill(); x.restore();
    x.fillStyle = vgrad(x, -H, H, U.mix(steel, trim, 0.25), 0.18, -0.3); x.fill(); x.strokeStyle = OL; x.lineWidth = 1.6; x.stroke();
    x.save(); x.clip();
    const sg = x.createLinearGradient(-W, 0, W, 0); sg.addColorStop(0, 'rgba(0,0,0,0.25)'); sg.addColorStop(0.45, 'rgba(255,255,255,0.12)'); sg.addColorStop(0.55, 'rgba(255,255,255,0.0)'); sg.addColorStop(1, 'rgba(0,0,0,0.2)'); x.fillStyle = sg; x.fillRect(-W * 1.2, -H, W * 2.4, H * 2.1);
    x.strokeStyle = 'rgba(255,255,255,0.55)'; x.lineWidth = 1.2; x.beginPath(); x.moveTo(-W * 0.35, -H * 0.85); x.lineTo(-W * 0.3, H * 0.4); x.stroke();
    x.restore();
    x.strokeStyle = trim; x.lineWidth = r * 0.06; x.beginPath(); x.moveTo(-W + r * 0.14, -H + r * 0.1); x.lineTo(W - r * 0.1, -H + r * 0.15); x.lineTo(W - r * 0.06, H * 0.66); x.quadraticCurveTo(W * 0.35, H * 0.95, -W * 0.08 + r * 0.04, H * 0.9); x.quadraticCurveTo(-W * 0.8, H * 0.68, -W + r * 0.06, H * 0.55); x.closePath(); x.stroke();
    // emblem: a cross with a glowing gem
    x.fillStyle = trim; x.fillRect(-r * 0.05, -H * 0.55, r * 0.12, H * 1.05); x.fillRect(-W * 0.6, -H * 0.2, W * 1.3, r * 0.12);
    x.shadowColor = col.eye; x.shadowBlur = r * 0.3; circle(x, r * 0.01, -H * 0.14, r * 0.09, col.eye); x.shadowBlur = 0; circle(x, -r * 0.01, -H * 0.17, r * 0.03, '#fff');
    for (const [rx, ry] of [[-W * 0.7, -H * 0.8], [W * 0.75, -H * 0.75], [W * 0.75, H * 0.5], [-W * 0.7, H * 0.45]]) circle(x, rx, ry, r * 0.04, '#e8e0c0', OL, 0.8);
    x.restore();
  },
  banshee(x: Ctx, r: number, col: EnemyColors, t: number) {
    // Wailing Banshee: streaming hair and gown, arms flung out, screaming
    const ph = t * U.TAU, by = r * 0.14 * Math.sin(ph), pale = U.mix(col.body, '#ffffff', 0.35), hairC = col.accent || U.shade(col.body, 0.2);
    x.save(); x.translate(0, by);
    // scream rings expanding from the mouth
    for (let k = 0; k < 2; k++) { const p = (t + k * 0.5) % 1; x.strokeStyle = U.rgba(col.eye, 0.5 * (1 - p)); x.lineWidth = r * 0.06; x.beginPath(); x.ellipse(0, -r * 0.5, r * (0.35 + p * 1.3), r * (0.2 + p * 0.75), 0, Math.PI * 0.15, Math.PI * 0.85); x.stroke(); }
    // hair streaming up and out behind the head
    for (let i = 0; i < 7; i++) {
      const sd = i < 3 ? -1 : i > 3 ? 1 : 0, k = Math.abs(i - 3), w = Math.sin(ph + i * 0.8), w2 = Math.sin(ph + i * 0.8 + 1.5);
      const p0: Pt = [sd * r * 0.2, -r * 0.85], p3: Pt = [sd * r * (0.55 + k * 0.32) + w * r * 0.12, -r * (1.55 - k * 0.25) + w2 * r * 0.1];
      taper(x, p0, [sd * r * 0.45 + w2 * r * 0.1, -r * 1.25], [p3[0] - sd * r * 0.15, p3[1] + r * 0.25], p3, r * 0.3, r * 0.04, U.rgba(U.shade(hairC, -0.1 - (k % 2) * 0.12), 0.9));
    }
    // gown trailing in tatters
    const hem: Pt[] = [];
    for (let i = 0; i <= 6; i++) { const k = i / 6, hx = -r * 0.75 + k * r * 1.5 + Math.sin(ph + i) * r * 0.08, hy = r * (i % 2 ? 0.75 : 1.08) + Math.sin(ph + i * 1.4) * r * 0.16; hem.push([hx, hy]); }
    x.beginPath(); x.moveTo(-r * 0.32, -r * 0.3); x.quadraticCurveTo(-r * 0.75, r * 0.3, hem[0][0], hem[0][1]); for (let i = 1; i <= 6; i++) x.lineTo(hem[i][0], hem[i][1]); x.quadraticCurveTo(r * 0.75, r * 0.3, r * 0.32, -r * 0.3); x.closePath();
    const g = x.createLinearGradient(0, -r * 0.3, 0, r * 1.1); g.addColorStop(0, U.rgba(pale, 0.95)); g.addColorStop(0.6, U.rgba(col.body, 0.7)); g.addColorStop(1, U.rgba(col.body, 0.05));
    x.fillStyle = g; x.fill(); x.strokeStyle = U.rgba(col.eye, 0.4); x.lineWidth = 1; x.stroke();
    x.strokeStyle = U.rgba(U.shade(col.body, -0.3), 0.45); x.lineWidth = r * 0.05; for (let i = -1; i <= 1; i++) { x.beginPath(); x.moveTo(i * r * 0.15, -r * 0.1); x.quadraticCurveTo(i * r * 0.3, r * 0.4, hem[3 + i * 2][0], hem[3 + i * 2][1] - r * 0.1); x.stroke(); }
    // arms flung out, long fingers
    for (const sd of [-1, 1]) {
      const sw = Math.sin(ph + (sd > 0 ? 0.6 : 0)) * r * 0.12, hand: Pt = [sd * r * 1.3, -r * 0.45 + sw];
      taper(x, [sd * r * 0.28, -r * 0.3], [sd * r * 0.65, -r * 0.35], [sd * r * 0.95, -r * 0.42 + sw * 0.5], hand, r * 0.17, r * 0.1, U.rgba(pale, 0.95));
      x.strokeStyle = U.rgba(pale, 0.95); x.lineWidth = r * 0.05; x.lineCap = 'round'; for (let k = -1; k <= 2; k++) { x.beginPath(); x.moveTo(hand[0], hand[1]); x.lineTo(hand[0] + sd * r * 0.25, hand[1] + k * r * 0.1 - r * 0.05); x.stroke(); }
      x.strokeStyle = U.rgba(col.body, 0.5); x.lineWidth = r * 0.12; x.beginPath(); x.moveTo(sd * r * 0.5, -r * 0.3); x.quadraticCurveTo(sd * r * 0.75, -r * 0.05 + sw, sd * r * 0.9, r * 0.05 + sw); x.stroke();
    }
    // gaunt face, open screaming mouth
    const fy = -r * 0.62, scream = 1 + 0.12 * Math.sin(ph * 2);
    x.beginPath(); x.ellipse(0, fy, r * 0.3, r * 0.38, 0, 0, U.TAU); x.fillStyle = rgrad(x, 0, fy, r * 0.38, [[0, '#ffffff'], [0.6, pale], [1, U.shade(col.body, -0.1)]]); x.fill(); x.strokeStyle = OL; x.lineWidth = 1; x.stroke();
    x.fillStyle = 'rgba(10,6,24,0.85)'; x.beginPath(); x.ellipse(-r * 0.12, fy - r * 0.08, r * 0.09, r * 0.07, 0.3, 0, U.TAU); x.fill(); x.beginPath(); x.ellipse(r * 0.12, fy - r * 0.08, r * 0.09, r * 0.07, -0.3, 0, U.TAU); x.fill();
    eyes(x, 0, fy - r * 0.08, r * 0.12, r * 0.045, col.eye);
    x.fillStyle = '#0a0614'; x.beginPath(); x.ellipse(0, fy + r * 0.18, r * 0.09, r * 0.14 * scream, 0, 0, U.TAU); x.fill();
    // front hair strands framing the face
    for (const sd of [-1, 1]) taper(x, [sd * r * 0.22, fy - r * 0.32], [sd * r * 0.42, fy - r * 0.1], [sd * r * 0.3 + Math.sin(ph + sd) * r * 0.06, fy + r * 0.3], [sd * r * 0.38 + Math.sin(ph + sd + 1) * r * 0.1, fy + r * 0.62], r * 0.13, r * 0.03, U.rgba(hairC, 0.95));
    x.restore();
  },
  totem(x: Ctx, r: number, col: EnemyColors, t: number) {
    // Hex Totem: stacked carved masks; only the glow and rune sparks move
    const ph = t * U.TAU, gp = 0.5 + 0.5 * Math.sin(ph), wood = col.body, ac = col.accent || '#f0abfc';
    const glowLine = (fn: () => void) => { x.save(); x.globalAlpha = 0.45 + 0.55 * gp; x.strokeStyle = col.eye; x.shadowColor = col.eye; x.shadowBlur = r * 0.35; x.lineWidth = r * 0.06; fn(); x.stroke(); x.restore(); };
    // base stones
    for (const [bx, br] of [[-r * 0.45, 0.28], [r * 0.45, 0.3], [0, 0.34]] as const) { x.beginPath(); x.ellipse(bx, r * 1.0, r * br * 1.3, r * br * 0.8, 0, 0, U.TAU); x.fillStyle = shadeR(x, bx, r * 0.95, r * br * 1.3, '#5a5660', 0.15); x.fill(); x.strokeStyle = OL; x.lineWidth = 1; x.stroke(); }
    // pole
    x.fillStyle = vgrad(x, -r * 1.2, r, U.shade(wood, -0.15), 0.05, -0.25); x.fillRect(-r * 0.18, -r * 1.25, r * 0.36, r * 2.2);
    // bottom mask: wide grimacing face
    const mask = (my: number, mw: number, mh: number, fn: () => void) => { x.beginPath(); x.roundRect(-mw, my - mh, mw * 2, mh * 2, r * 0.12); x.fillStyle = shadeR(x, -mw * 0.3, my - mh * 0.3, mw * 1.2, wood, 0.22); x.fill(); x.strokeStyle = OL; x.lineWidth = 1.4; x.stroke(); x.save(); x.beginPath(); x.roundRect(-mw, my - mh, mw * 2, mh * 2, r * 0.12); x.clip(); x.strokeStyle = 'rgba(0,0,0,0.22)'; x.lineWidth = 1; for (let i = 0; i < 4; i++) { x.beginPath(); x.moveTo(-mw, my - mh + i * mh * 0.55 + r * 0.05); x.lineTo(mw, my - mh + i * mh * 0.55 + r * 0.1); x.stroke(); } x.restore(); fn(); };
    mask(r * 0.48, r * 0.55, r * 0.34, () => {
      x.fillStyle = '#1a0e08'; x.fillRect(-r * 0.38, r * 0.55, r * 0.76, r * 0.16); x.fillStyle = '#e8dcc0'; for (let i = 0; i < 5; i++) poly(x, [[-r * 0.36 + i * r * 0.16, r * 0.55], [-r * 0.28 + i * r * 0.16, r * 0.66], [-r * 0.2 + i * r * 0.16, r * 0.55]], '#e8dcc0');
      x.fillStyle = '#120806'; x.beginPath(); x.ellipse(-r * 0.24, r * 0.34, r * 0.12, r * 0.08, 0, 0, U.TAU); x.fill(); x.beginPath(); x.ellipse(r * 0.24, r * 0.34, r * 0.12, r * 0.08, 0, 0, U.TAU); x.fill();
      x.globalAlpha = 0.5 + 0.5 * gp; eyes(x, 0, r * 0.34, r * 0.24, r * 0.06, col.eye); x.globalAlpha = 1;
      for (const sd of [-1, 1]) poly(x, [[sd * r * 0.55, r * 0.3], [sd * r * 0.85, r * 0.15], [sd * r * 0.55, r * 0.55]], U.shade(wood, -0.1), OL, 1);
    });
    // a rune band
    x.fillStyle = U.shade(wood, -0.35); x.fillRect(-r * 0.32, -r * 0.02, r * 0.64, r * 0.14);
    glowLine(() => { x.beginPath(); for (let i = 0; i < 4; i++) { const rx = -r * 0.22 + i * r * 0.15; x.moveTo(rx, r * 0.0); x.lineTo(rx + r * 0.05, r * 0.06); x.lineTo(rx, r * 0.1); } });
    // middle: a skull
    circle(x, 0, -r * 0.35, r * 0.36, rgrad(x, 0, -r * 0.35, r * 0.36, [[0, '#fbf6e8'], [0.7, '#d8ccb0'], [1, '#9a8c70']]), OL, 1.3);
    x.fillStyle = '#d0c4a8'; x.fillRect(-r * 0.2, -r * 0.12, r * 0.4, r * 0.14); x.strokeStyle = OL; x.lineWidth = 1; x.strokeRect(-r * 0.2, -r * 0.12, r * 0.4, r * 0.14);
    x.fillStyle = '#100a0a'; x.beginPath(); x.ellipse(-r * 0.13, -r * 0.38, r * 0.1, r * 0.09, 0, 0, U.TAU); x.fill(); x.beginPath(); x.ellipse(r * 0.13, -r * 0.38, r * 0.1, r * 0.09, 0, 0, U.TAU); x.fill();
    x.globalAlpha = 0.5 + 0.5 * gp; eyes(x, 0, -r * 0.38, r * 0.13, r * 0.05, col.eye); x.globalAlpha = 1;
    // top mask with horns and the crystal eye
    mask(-r * 0.98, r * 0.36, r * 0.26, () => {
      for (const sd of [-1, 1]) { x.beginPath(); x.moveTo(sd * r * 0.3, -r * 1.12); x.quadraticCurveTo(sd * r * 0.75, -r * 1.2, sd * r * 0.7, -r * 1.6); x.quadraticCurveTo(sd * r * 0.55, -r * 1.3, sd * r * 0.2, -r * 1.22); x.closePath(); x.fillStyle = vgrad(x, -r * 1.6, -r * 1.1, '#e8dcc0', 0.05, -0.35); x.fill(); x.strokeStyle = OL; x.lineWidth = 1; x.stroke(); }
      glowLine(() => { x.beginPath(); x.moveTo(-r * 0.22, -r * 0.92); x.lineTo(-r * 0.08, -r * 0.86); x.moveTo(r * 0.22, -r * 0.92); x.lineTo(r * 0.08, -r * 0.86); x.moveTo(0, -r * 0.82); x.lineTo(0, -r * 0.74); });
      x.fillStyle = ac; x.fillRect(-r * 0.36, -r * 0.8, r * 0.72, r * 0.06);
    });
    x.save(); x.globalAlpha = 0.55 + 0.45 * gp; x.globalCompositeOperation = 'lighter'; x.drawImage(glow(col.eye, r * 0.75), -r * 0.75, -r * 1.42 - r * 0.75, r * 1.5, r * 1.5); x.restore();
    poly(x, [[0, -r * 1.72], [r * 0.18, -r * 1.42], [0, -r * 1.2], [-r * 0.18, -r * 1.42]], rgrad(x, 0, -r * 1.45, r * 0.25, [[0, '#fff'], [0.45, col.eye], [1, U.shade(col.eye, -0.35)]]), 'rgba(255,255,255,0.6)', 1);
    circle(x, 0, -r * 1.43, r * 0.05 + r * 0.02 * gp, '#fff');
    // dangling feathers/ribbons (static)
    for (const sd of [-1, 1]) { x.strokeStyle = '#3a2a1a'; x.lineWidth = 0.8; x.beginPath(); x.moveTo(sd * r * 0.55, r * 0.6); x.lineTo(sd * r * 0.62, r * 0.9); x.stroke(); poly(x, [[sd * r * 0.62, r * 0.85], [sd * r * 0.7, r * 1.05], [sd * r * 0.58, r * 1.1], [sd * r * 0.56, r * 0.9]], ac); }
    // floating rune sparks rising in a loop
    x.save(); x.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 4; k++) { const p = (t + k / 4) % 1, a = k * 1.7 + p * U.TAU * 0.5, sx = Math.cos(a) * r * (0.7 + 0.1 * (k % 2)), sy = r * 0.6 - p * r * 2.0; x.globalAlpha = Math.sin(p * Math.PI) * 0.9; x.drawImage(glow(col.eye, r * 0.22), sx - r * 0.22, sy - r * 0.22, r * 0.44, r * 0.44); x.strokeStyle = '#fff'; x.lineWidth = r * 0.035; x.beginPath(); x.moveTo(sx, sy - r * 0.08); x.lineTo(sx, sy + r * 0.08); x.moveTo(sx, sy - r * 0.02); x.lineTo(sx + r * 0.06, sy - r * 0.07); x.stroke(); }
    x.restore();
  },
  cask(x: Ctx, r: number, col: EnemyColors, t: number) {
    // Ember Cask: an iron-banded powder keg with glowing seams that pulse
    const ph = t * U.TAU, gp = 0.5 + 0.5 * Math.sin(ph * 2), wood = col.body, ember = col.eye, hot = col.accent || '#ffd27a';
    x.save(); x.translate(0, r * 0.1); x.rotate(Math.sin(ph) * 0.05);
    const H = r * 0.95, W = r * 0.72, B = r * 0.86;
    const outline = () => { x.beginPath(); x.moveTo(-W, -H); x.quadraticCurveTo(-B * 1.12, 0, -W, H); x.lineTo(W, H); x.quadraticCurveTo(B * 1.12, 0, W, -H); x.closePath(); };
    outline(); x.fillStyle = shadeR(x, -r * 0.2, -r * 0.1, r * 1.1, wood, 0.18); x.fill();
    x.save(); outline(); x.clip();
    // staves with glowing seams between them
    for (let i = -3; i <= 3; i++) { const sx = i * r * 0.26; x.strokeStyle = 'rgba(0,0,0,0.35)'; x.lineWidth = 1.2; x.beginPath(); x.moveTo(sx * 0.85, -H); x.quadraticCurveTo(sx * 1.15, 0, sx * 0.85, H); x.stroke(); }
    x.globalAlpha = 0.35 + 0.65 * gp; x.strokeStyle = ember; x.shadowColor = ember; x.shadowBlur = r * 0.45; x.lineWidth = r * 0.07;
    x.beginPath(); x.moveTo(-r * 0.22, -H * 0.55); x.lineTo(-r * 0.3, -H * 0.1); x.lineTo(-r * 0.2, H * 0.3); x.moveTo(r * 0.3, -H * 0.2); x.lineTo(r * 0.36, H * 0.2); x.lineTo(r * 0.5, H * 0.45); x.moveTo(-r * 0.55, H * 0.25); x.lineTo(-r * 0.62, H * 0.55); x.stroke();
    x.shadowBlur = 0; x.strokeStyle = U.rgba(hot, 0.9); x.lineWidth = r * 0.025; x.stroke(); x.globalAlpha = 1;
    const sg = x.createLinearGradient(-B, 0, B, 0); sg.addColorStop(0, 'rgba(0,0,0,0.3)'); sg.addColorStop(0.35, 'rgba(255,255,255,0.1)'); sg.addColorStop(1, 'rgba(0,0,0,0.35)'); x.fillStyle = sg; x.fillRect(-B * 1.2, -H, B * 2.4, H * 2);
    x.restore();
    outline(); x.strokeStyle = OL; x.lineWidth = 1.5; x.stroke();
    // iron bands with rivets
    for (const by of [-H * 0.7, H * 0.7, 0]) { const bw = by === 0 ? B * 1.1 : U.lerp(B * 1.1, W, 0.62); x.fillStyle = vgrad(x, by - r * 0.09, by + r * 0.09, '#4a4650', 0.25, -0.2); x.fillRect(-bw, by - r * 0.08, bw * 2, r * 0.16); x.strokeStyle = OL; x.lineWidth = 1; x.strokeRect(-bw, by - r * 0.08, bw * 2, r * 0.16); x.strokeStyle = 'rgba(255,255,255,0.45)'; x.lineWidth = 0.8; x.beginPath(); x.moveTo(-bw * 0.7, by - r * 0.05); x.lineTo(bw * 0.2, by - r * 0.05); x.stroke(); for (let k = -1; k <= 1; k++) circle(x, k * bw * 0.6, by, r * 0.03, '#8a8690'); }
    // ember sigil (a flame) branded on the front
    x.save(); x.globalAlpha = 0.55 + 0.45 * gp; x.shadowColor = ember; x.shadowBlur = r * 0.4; x.fillStyle = ember;
    x.beginPath(); x.moveTo(0, H * 0.5); x.quadraticCurveTo(-r * 0.3, H * 0.3, -r * 0.12, -H * 0.05); x.quadraticCurveTo(-r * 0.05, H * 0.12, 0, H * 0.05); x.quadraticCurveTo(r * 0.02, -H * 0.2, r * 0.1, -H * 0.3); x.quadraticCurveTo(r * 0.1, -H * 0.05, r * 0.2, H * 0.1); x.quadraticCurveTo(r * 0.3, H * 0.35, 0, H * 0.5); x.fill();
    x.shadowBlur = 0; x.fillStyle = hot; x.beginPath(); x.ellipse(0, H * 0.32, r * 0.06, r * 0.1, 0, 0, U.TAU); x.fill(); x.restore();
    // lid, bung and a short spitting fuse
    x.beginPath(); x.ellipse(0, -H, W, r * 0.2, 0, 0, U.TAU); x.fillStyle = vgrad(x, -H - r * 0.2, -H + r * 0.2, U.shade(wood, 0.1), 0.1, -0.2); x.fill(); x.strokeStyle = OL; x.lineWidth = 1.2; x.stroke();
    x.strokeStyle = 'rgba(0,0,0,0.3)'; x.lineWidth = 1; x.beginPath(); x.ellipse(0, -H, W * 0.75, r * 0.14, 0, 0, U.TAU); x.stroke();
    const fx = r * 0.28 + Math.sin(ph) * r * 0.05, fy = -H - r * 0.42;
    x.strokeStyle = '#2a1a10'; x.lineWidth = r * 0.07; x.beginPath(); x.moveTo(r * 0.2, -H); x.quadraticCurveTo(r * 0.12, -H - r * 0.25, fx, fy); x.stroke();
    const rnd = U.mulberry32(Math.floor(t * 991) + 3);
    x.globalCompositeOperation = 'lighter'; x.globalAlpha = 0.7 + 0.3 * gp; x.drawImage(glow(ember, r * 0.55), fx - r * 0.55, fy - r * 0.55, r * 1.1, r * 1.1); x.globalAlpha = 1;
    x.strokeStyle = '#fff2c0'; x.lineWidth = r * 0.04; for (let i = 0; i < 5; i++) { const a = rnd() * U.TAU, l = r * (0.12 + rnd() * 0.18); x.beginPath(); x.moveTo(fx, fy); x.lineTo(fx + Math.cos(a) * l, fy + Math.sin(a) * l); x.stroke(); }
    x.globalCompositeOperation = 'source-over';
    // a glowing pair of eyes peering through a crack
    x.fillStyle = '#120804'; x.fillRect(-r * 0.3, -H * 0.38, r * 0.6, r * 0.14);
    eyes(x, 0, -H * 0.38 + r * 0.07, r * 0.15, r * 0.06, ember);
    x.restore();
  },
  /* ---- bosses ---- */
  bone_colossus(x: Ctx, r: number, col: EnemyColors, t: number) {
    const ph = t * U.TAU, pulse = 0.5 + 0.5 * Math.sin(ph * 2), bob = -r * 0.9 * 0.07 * (1 - Math.cos(ph * 2)) / 2;
    // spectral ring behind
    x.save(); x.globalAlpha = 0.5 + 0.4 * pulse; x.strokeStyle = col.eye; x.shadowColor = col.eye; x.shadowBlur = r * 0.4; x.lineWidth = r * 0.05;
    x.beginPath(); x.arc(0, -r * 0.56 + bob, r * (0.74 + 0.03 * pulse), 0, U.TAU); x.stroke(); x.setLineDash([r * 0.1, r * 0.12]); x.lineWidth = r * 0.025; x.beginPath(); x.arc(0, -r * 0.56 + bob, r * 0.86, ph / 3, ph / 3 + U.TAU); x.stroke(); x.setLineDash([]); x.restore();
    skeletonBody(x, r * 0.9, col, t, true);
    // a great bone club in the right hand, crown of bone
    x.save(); x.translate(r * 0.85, r * 0.4 + bob); x.rotate(0.35 + Math.sin(ph) * 0.18);
    seg(x, [[0, r * 0.15], [0, -r * 0.75]], r * 0.16, OL); seg(x, [[0, r * 0.15], [0, -r * 0.75]], r * 0.11, col.body);
    circle(x, -r * 0.07, -r * 0.82, r * 0.14, shadeR(x, -r * 0.07, -r * 0.82, r * 0.14, col.body), OL, 1.5); circle(x, r * 0.08, -r * 0.8, r * 0.13, shadeR(x, r * 0.08, -r * 0.8, r * 0.13, col.body), OL, 1.5);
    x.restore();
    for (let i = -2; i <= 2; i++) poly(x, [[i * r * 0.2 - r * 0.07, -r * 0.92 + bob], [i * r * 0.21, -r * (1.32 - Math.abs(i) * 0.08) + bob], [i * r * 0.2 + r * 0.07, -r * 0.92 + bob]], vgrad(x, -r * 1.3, -r * 0.9, '#f4efe2', 0.05, -0.25), '#333', 1.2);
    x.save(); x.globalAlpha = 0.6 + 0.4 * pulse; x.shadowColor = col.eye; x.shadowBlur = r * 0.2; circle(x, 0, -r * 1.0 + bob, r * 0.05, col.eye); x.restore();
  },
  blood_matriarch(x: Ctx, r: number, col: EnemyColors, t: number) {
    const ph = t * U.TAU, pulse = 0.5 + 0.5 * Math.sin(ph * 2), ac = col.accent || '#ef4444';
    spiderBody(x, r, col, t);
    // pulsing blood sac and gems on the abdomen
    x.save(); x.globalAlpha = 0.5 + 0.5 * pulse; x.shadowColor = ac; x.shadowBlur = r * 0.4;
    for (let i = 0; i < 3; i++) circle(x, -r * 0.3 + i * r * 0.3, r * 0.3 + Math.abs(i - 1) * r * 0.08, r * (0.08 + 0.02 * pulse), col.eye);
    x.restore();
    // crown of thorns on the head
    for (let i = -2; i <= 2; i++) poly(x, [[i * r * 0.11 - r * 0.05, -r * 0.82], [i * r * 0.14, -r * (1.08 - Math.abs(i) * 0.06)], [i * r * 0.11 + r * 0.05, -r * 0.82]], vgrad(x, -r * 1.08, -r * 0.8, ac, 0.25, -0.3), OL, 1);
    // dripping blood
    for (let k = 0; k < 2; k++) { const p = (t + k * 0.5) % 1; x.globalAlpha = 1 - p; x.fillStyle = col.eye; x.beginPath(); x.ellipse((k ? 1 : -1) * r * 0.25, r * 0.95 + p * r * 0.25, r * 0.04, r * 0.07, 0, 0, U.TAU); x.fill(); x.globalAlpha = 1; }
  },
  frost_wyrm(x: Ctx, r: number, col: EnemyColors, t: number) {
    const ph = t * U.TAU, lift = Math.sin(ph), dk = U.shade(col.body, -0.25), hb = r * 0.06 * Math.sin(ph + 0.5);
    // wings beat
    for (const sd of [-1, 1]) {
      const tip: Pt = [sd * r * (1.7 - 0.25 * Math.abs(lift)), -r * 1.1 - r * 0.55 * lift], el: Pt = [sd * r * 0.95, -r * 0.85 - r * 0.35 * lift], root: Pt = [sd * r * 0.3, -r * 0.4];
      x.beginPath(); x.moveTo(root[0], root[1]); x.lineTo(el[0], el[1]); x.lineTo(tip[0], tip[1]);
      x.quadraticCurveTo(sd * r * 1.45, -r * 0.6 - r * 0.3 * lift, sd * r * 1.35, -r * 0.2 - r * 0.15 * lift); x.quadraticCurveTo(sd * r * 1.05, -r * 0.4, sd * r * 0.95, -r * 0.05); x.quadraticCurveTo(sd * r * 0.65, -r * 0.3, root[0], r * 0.0); x.closePath();
      const g = x.createLinearGradient(0, tip[1], 0, 0); g.addColorStop(0, U.rgba(col.eye, 0.75)); g.addColorStop(1, U.rgba(col.body, 0.55)); x.fillStyle = g; x.fill(); x.strokeStyle = U.rgba(col.eye, 0.9); x.lineWidth = 1.2; x.stroke();
      x.strokeStyle = U.shade(col.body, -0.35); x.lineWidth = r * 0.05; x.beginPath(); x.moveTo(root[0], root[1]); x.lineTo(el[0], el[1]); x.lineTo(tip[0], tip[1]); x.moveTo(el[0], el[1]); x.lineTo(sd * r * 1.35, -r * 0.2 - r * 0.15 * lift); x.moveTo(el[0], el[1]); x.lineTo(sd * r * 0.95, -r * 0.05); x.stroke();
    }
    // undulating serpentine coil
    const pts: Pt[] = []; for (let i = 0; i <= 14; i++) { const k = i / 14; pts.push([-r * 1.3 + k * r * 2.5, r * 0.5 + Math.sin(ph - k * 5.5) * r * 0.22 * (0.4 + k * 0.6) - Math.sin(k * Math.PI) * r * 0.25]); }
    for (let i = 0; i < 14; i++) { const k = i / 14, w = r * (0.18 + Math.sin(k * Math.PI) * 0.3); seg(x, [pts[i], pts[i + 1]], w + 3, OL); }
    for (let i = 0; i < 14; i++) { const k = i / 14, w = r * (0.18 + Math.sin(k * Math.PI) * 0.3); seg(x, [pts[i], pts[i + 1]], w, k < 0.5 ? dk : col.body); }
    for (let i = 1; i < 14; i += 2) { const k = i / 14, w = r * (0.18 + Math.sin(k * Math.PI) * 0.3); x.fillStyle = U.rgba('#e8f6ff', 0.55); x.beginPath(); x.ellipse(pts[i][0], pts[i][1] + w * 0.22, w * 0.3, w * 0.16, 0, 0, U.TAU); x.fill(); poly(x, [[pts[i][0] - w * 0.15, pts[i][1] - w * 0.4], [pts[i][0], pts[i][1] - w * 0.8], [pts[i][0] + w * 0.15, pts[i][1] - w * 0.4]], '#d8f0ff'); }
    // neck + head
    x.save(); x.translate(0, hb);
    seg(x, [[0, r * 0.3], [0, -r * 0.5]], r * 0.44, OL); seg(x, [[0, r * 0.3], [0, -r * 0.5]], r * 0.36, col.body);
    poly(x, [[-r * 0.58, -r * 0.5], [-r * 0.3, -r * 1.05], [0, -r * 1.25], [r * 0.3, -r * 1.05], [r * 0.58, -r * 0.5], [r * 0.38, r * 0.05], [0, r * 0.18], [-r * 0.38, r * 0.05]], rgrad(x, 0, -r * 0.6, r * 0.8, [[0, U.shade(col.body, 0.35)], [0.6, col.body], [1, U.shade(col.body, -0.3)]]), OL, 2);
    x.fillStyle = 'rgba(255,255,255,0.2)'; poly(x, [[-r * 0.3, -r * 1.0], [0, -r * 1.18], [r * 0.08, -r * 0.7], [-r * 0.2, -r * 0.6]], 'rgba(255,255,255,0.18)');
    for (const sd of [-1, 1]) { x.beginPath(); x.moveTo(sd * r * 0.25, -r * 0.95); x.quadraticCurveTo(sd * r * 0.55, -r * 1.3, sd * r * 0.62, -r * 1.65); x.quadraticCurveTo(sd * r * 0.42, -r * 1.3, sd * r * 0.12, -r * 1.05); x.closePath(); x.fillStyle = vgrad(x, -r * 1.65, -r * 0.95, '#eaf6ff', 0.05, -0.2); x.fill(); x.strokeStyle = OL; x.lineWidth = 1.2; x.stroke(); }
    eyes(x, 0, -r * 0.62, r * 0.22, r * 0.11, col.eye);
    x.fillStyle = '#081420'; x.fillRect(-r * 0.22, -r * 0.18, r * 0.44, r * 0.08); for (let i = 0; i < 5; i++) poly(x, [[-r * 0.2 + i * r * 0.1, -r * 0.18], [-r * 0.16 + i * r * 0.1, -r * 0.08], [-r * 0.12 + i * r * 0.1, -r * 0.18]], '#f0f8ff');
    // frost breath mist
    x.globalCompositeOperation = 'lighter'; for (let k = 0; k < 3; k++) { const p = (t + k / 3) % 1; x.globalAlpha = 0.35 * Math.sin(p * Math.PI); x.drawImage(glow(col.eye, r * 0.3), -r * 0.3 + Math.sin(k * 2) * r * 0.2, r * 0.0 + p * r * 0.5 - r * 0.3, r * 0.6, r * 0.6); } x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
    x.restore();
  },
  void_leviathan(x: Ctx, r: number, col: EnemyColors, t: number) {
    const ph = t * U.TAU, dk = U.shade(col.body, -0.2);
    for (let i = 0; i < 8; i++) {
      const a = i * (U.TAU / 8) + 0.2, dx = Math.cos(a), dy = Math.sin(a), px = -dy, py = dx, w1 = Math.sin(ph + i * 0.8), w2 = Math.sin(ph + i * 0.8 + 1.6), L = r * (1.0 + (i % 2) * 0.25);
      const p0: Pt = [dx * r * 0.7, dy * r * 0.7], p1: Pt = [dx * r * 1.05 + px * r * 0.3 * w1, dy * r * 1.05 + py * r * 0.3 * w1], p2: Pt = [dx * (r * 0.7 + L * 0.7) + px * r * 0.35 * w2, dy * (r * 0.7 + L * 0.7) + py * r * 0.35 * w2], p3: Pt = [dx * (r * 0.62 + L) + px * r * 0.25 * w1, dy * (r * 0.62 + L) + py * r * 0.25 * w1];
      taper(x, p0, p1, p2, p3, r * 0.28, r * 0.03, OL, 12); taper(x, p0, p1, p2, p3, r * 0.21, r * 0.015, dk, 12);
      for (let k = 1; k <= 3; k++) { const q = k / 4.5, u = 1 - q, qx = u * u * u * p0[0] + 3 * u * u * q * p1[0] + 3 * u * q * q * p2[0] + q * q * q * p3[0], qy = u * u * u * p0[1] + 3 * u * u * q * p1[1] + 3 * u * q * q * p2[1] + q * q * q * p3[1]; circle(x, qx, qy, r * 0.045 * (1.2 - q), U.rgba(col.eye, 0.8)); }
    }
    circle(x, 0, 0, r, rgrad(x, 0, 0, r, [[0, U.shade(col.body, 0.3)], [0.7, col.body], [1, U.shade(col.body, -0.5)]]), 'rgba(0,0,0,0.7)', 2);
    // pulsing rings
    x.save(); x.strokeStyle = col.eye; x.shadowColor = col.eye; x.shadowBlur = r * 0.35;
    for (let i = 0; i < 3; i++) { const p = 0.5 + 0.5 * Math.sin(ph * 2 - i * 1.2); x.globalAlpha = 0.35 + 0.65 * p; x.lineWidth = r * (0.03 + 0.03 * p); x.beginPath(); x.arc(0, 0, r * (0.3 + i * 0.22) * (1 + 0.04 * p), 0, U.TAU); x.stroke(); }
    x.restore();
    // orbiting runes
    for (let i = 0; i < 6; i++) { const a = ph / 6 * 1 + i * U.TAU / 6, rx = Math.cos(a) * r * 0.85, ry = Math.sin(a) * r * 0.85; x.save(); x.translate(rx, ry); x.rotate(a); x.strokeStyle = U.rgba(col.eye, 0.85); x.lineWidth = r * 0.025; x.beginPath(); x.moveTo(-r * 0.05, 0); x.lineTo(r * 0.05, 0); x.moveTo(0, -r * 0.05); x.lineTo(r * 0.03, r * 0.05); x.stroke(); x.restore(); }
    // the void eye
    circle(x, 0, 0, r * 0.3, '#000'); circle(x, 0, 0, r * (0.13 + 0.03 * Math.sin(ph * 2)), rgrad(x, 0, 0, r * 0.16, [[0, '#fff'], [0.4, col.eye], [1, U.shade(col.eye, -0.4)]]));
    for (let i = 0; i < 4; i++) { const a = 0.7 + i * 1.5, open = Math.max(0.15, Math.sin(ph + i * 1.6)); x.fillStyle = col.eye; x.beginPath(); x.ellipse(Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62, r * 0.1, r * 0.1 * open, a, 0, U.TAU); x.fill(); }
  },
  infernal_titan(x: Ctx, r: number, col: EnemyColors, t: number) {
    const ph = t * U.TAU, ac = col.accent || '#ff6a00', pulse = 0.5 + 0.5 * Math.sin(ph * 2), bob = -r * 0.05 * (1 - Math.cos(ph * 2)) / 2;
    bruteBody(x, r, col, t);
    x.save(); x.translate(0, bob);
    // horns with flickering flames
    for (const sd of [-1, 1]) { x.beginPath(); x.moveTo(sd * r * 0.3, -r * 0.85); x.quadraticCurveTo(sd * r * 0.85, -r * 1.1, sd * r * 0.62, -r * 1.55); x.quadraticCurveTo(sd * r * 0.6, -r * 1.15, sd * r * 0.15, -r * 0.9); x.closePath(); x.fillStyle = vgrad(x, -r * 1.55, -r * 0.85, '#2a1a14', 0.15, -0.1); x.fill(); x.strokeStyle = OL; x.lineWidth = 1.5; x.stroke(); flame(x, sd * r * 0.62, -r * 1.48, r * 0.12, r * 0.45, t, '#fff0a0', ac, sd > 0 ? 2 : 0); }
    // molten cracks
    x.save(); x.globalAlpha = 0.55 + 0.45 * pulse; x.strokeStyle = ac; x.lineWidth = r * 0.08; x.lineCap = 'round'; x.shadowColor = ac; x.shadowBlur = r * 0.4;
    x.beginPath(); x.moveTo(-r * 0.5, r * 0.2); x.lineTo(-r * 0.2, -r * 0.1); x.lineTo(r * 0.2, r * 0.3); x.lineTo(r * 0.5, 0); x.moveTo(-r * 0.1, r * 0.55); x.lineTo(r * 0.05, r * 0.3); x.moveTo(-r * 0.6, -r * 0.3); x.lineTo(-r * 0.75, 0); x.stroke();
    x.shadowBlur = 0; x.strokeStyle = '#fff2b0'; x.lineWidth = r * 0.025; x.stroke(); x.restore();
    // molten fists glow
    for (const sd of [-1, 1]) { const sw = sd < 0 ? Math.sin(ph) : -Math.sin(ph), fx = sd * (r * 1.12 + r * 0.06 * sw), fy = r * 0.7 - r * 0.2 * sw; x.save(); x.globalCompositeOperation = 'lighter'; x.globalAlpha = 0.5 + 0.4 * pulse; x.drawImage(glow(ac, r * 0.4), fx - r * 0.4, fy - r * 0.4, r * 0.8, r * 0.8); x.restore(); }
    x.restore();
  },
};
function normFrame(frame: number, n: number): number { const f = Math.floor(frame) % n; return f < 0 ? f + n : f; }
/** An enemy sprite. `frame` (0..ENEMY_FRAMES-1) is the phase of its looping locomotion cycle; frame 0 is a neutral pose. */
function enemy(type: string, r: number, col: EnemyColors, tier = 0, frame = 0): Sprite {
  const f = normFrame(frame, ENEMY_FRAMES);
  const key = 'en|' + type + '|' + r + '|' + col.body + '|' + col.eye + '|' + (col.accent || '') + '|' + tier + '|' + f;
  const hit = cached<Sprite>(key); if (hit) return hit;
  const R = Math.ceil(r * 2.2 + 6);
  const [c0, x] = mkRes(R * 2, R * 2);
  x.translate(R, R);
  x.lineJoin = 'round';
  (ENEMY_DRAW[type] || ENEMY_DRAW.ghoul)(x, r, col, f / ENEMY_FRAMES);
  if (tier >= 3) {
    // elite marker: dashed rune ring
    x.strokeStyle = U.rgba(col.eye, 0.7); x.lineWidth = 2; x.setLineDash([4, 4]);
    x.beginPath(); x.arc(0, 0, r * 1.5 + 4, 0, U.TAU); x.stroke(); x.setLineDash([]);
  } else if (tier === 2) {
    // veteran marker: small glowing horns/spikes
    x.fillStyle = col.eye; x.shadowColor = col.eye; x.shadowBlur = 6;
    for (let i = 0; i < 3; i++) { const a = -Math.PI / 2 + (i - 1) * 0.5; circle(x, Math.cos(a) * (r * 1.25), Math.sin(a) * (r * 1.25) - r * 0.2, r * 0.12, col.eye); }
    x.shadowBlur = 0;
  }
  const sp = withOrigin(outlined(c0, Math.max(2, Math.round(r / 9))), R, R, RES);
  cache.set(key, sp);
  return sp;
}
/** The dirt mound a Grave Worm pushes up while it travels underground (ENEMY_FRAMES frames of churning dirt). */
function burrowMound(r: number, frame = 0): Sprite {
  const f = normFrame(frame, ENEMY_FRAMES), t = f / ENEMY_FRAMES, ph = t * U.TAU;
  const key = 'mound|' + r + '|' + f;
  const hit = cached<Sprite>(key); if (hit) return hit;
  const R = Math.ceil(r * 2.2 + 6);
  const [c0, x] = mkRes(R * 2, R * 2);
  x.translate(R, R); x.lineJoin = 'round';
  const dirt = '#5a4030', gy = r * 0.55, hump = 1 + 0.06 * Math.sin(ph * 2);
  // cracked earth around the mound
  x.strokeStyle = 'rgba(20,12,8,0.75)'; x.lineWidth = r * 0.05; x.lineCap = 'round';
  for (let i = 0; i < 7; i++) { const a = i / 7 * U.TAU + 0.3, l = r * (1.0 + (i % 3) * 0.18); x.beginPath(); x.moveTo(Math.cos(a) * r * 0.7, gy + Math.sin(a) * r * 0.28); x.lineTo(Math.cos(a + 0.12) * l, gy + Math.sin(a + 0.12) * l * 0.4); x.lineTo(Math.cos(a - 0.05) * l * 1.2, gy + Math.sin(a - 0.05) * l * 0.48); x.stroke(); }
  x.fillStyle = 'rgba(20,12,8,0.45)'; x.beginPath(); x.ellipse(0, gy, r * 1.05, r * 0.4, 0, 0, U.TAU); x.fill();
  // the mound itself
  x.beginPath(); x.moveTo(-r * 0.95, gy); x.bezierCurveTo(-r * 0.8, gy - r * 0.75 * hump, r * 0.8, gy - r * 0.75 * hump, r * 0.95, gy); x.quadraticCurveTo(0, gy + r * 0.32, -r * 0.95, gy); x.closePath();
  x.fillStyle = shadeR(x, -r * 0.2, gy - r * 0.4, r * 1.0, dirt, 0.2, -0.3); x.fill(); x.strokeStyle = OL; x.lineWidth = 1.4; x.stroke();
  x.strokeStyle = 'rgba(15,8,4,0.6)'; x.lineWidth = r * 0.05;
  x.beginPath(); x.moveTo(-r * 0.1, gy - r * 0.5 * hump); x.lineTo(r * 0.05, gy - r * 0.25); x.lineTo(-r * 0.12, gy - r * 0.05); x.moveTo(r * 0.05, gy - r * 0.25); x.lineTo(r * 0.35, gy - r * 0.18); x.stroke();
  // pebbles and clods jiggle; a few pop up
  const rnd = U.mulberry32(r * 13 + 5);
  for (let i = 0; i < 9; i++) { const a = rnd() * Math.PI, d = rnd() * 0.75, px = Math.cos(a) * r * 0.85 * d * 1.2, py = gy - Math.sin(a) * r * 0.55 * (1 - d * 0.5) * hump, j = Math.sin(ph * 2 + i * 1.9) * r * 0.04; circle(x, px, py + j, r * (0.05 + rnd() * 0.07), shadeR(x, px, py, r * 0.1, rnd() < 0.4 ? '#6a6460' : U.shade(dirt, 0.12), 0.2), 'rgba(0,0,0,0.5)', 0.8); }
  for (let k = 0; k < 3; k++) { const p = (t + k / 3) % 1, dir = (k - 1) * 0.6, cx = dir * r * (0.2 + p * 0.6), cy = gy - r * 0.55 - Math.sin(p * Math.PI) * r * 0.5; x.globalAlpha = Math.sin(p * Math.PI); circle(x, cx, cy, r * 0.06, U.shade(dirt, 0.1)); x.globalAlpha = 1; }
  // dust puff
  x.globalAlpha = 0.25 + 0.1 * Math.sin(ph * 2); x.drawImage(glow('#8a7a68', r * 0.9), -r * 0.9, gy - r * 1.2, r * 1.8, r * 1.8); x.globalAlpha = 1;
  const sp = withOrigin(outlined(c0, Math.max(2, Math.round(r / 12)), 'rgba(8,5,12,0.6)'), R, R, RES);
  cache.set(key, sp);
  return sp;
}
/* white silhouette of a sprite for hit flash */
function flash(src: Sprite): Sprite {
  const hit = flashCache.get(src);
  if (hit) return hit;
  const c = mk(src.width, src.height), x = ctx2d(c);
  x.drawImage(src, 0, 0);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  const sp = withOrigin(c, src.ox, src.oy);
  sp.res = src.res;
  flashCache.set(src, sp);
  return sp;
}
function tint(src: Sprite, color: string): Sprite {
  let byColor = tintCache.get(src);
  if (!byColor) tintCache.set(src, (byColor = new Map()));
  const hit = byColor.get(color);
  if (hit) return hit;
  const c = mk(src.width, src.height), x = ctx2d(c);
  x.drawImage(src, 0, 0);
  x.globalCompositeOperation = 'source-atop';
  x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
  const sp = withOrigin(c, src.ox, src.oy);
  sp.res = src.res;
  byColor.set(color, sp);
  return sp;
}

/* ---------- pickups ---------- */
function gem(color: string, r: number): Sprite {
  const key = 'gem|' + color + '|' + r;
  const hit = cached<Sprite>(key); if (hit) return hit;
  const R = r * 2.4, [c, x] = mkRes(R * 2, R * 2);
  x.globalAlpha = 0.7; x.drawImage(glow(color, R * RES), 0, 0, R * 2, R * 2); x.globalAlpha = 1;
  x.translate(R, R); x.lineJoin = 'round';
  const T: Pt = [0, -r * 1.3], Rr: Pt = [r * 0.92, -r * 0.28], B: Pt = [0, r * 1.3], L: Pt = [-r * 0.92, -r * 0.28], tl: Pt = [-r * 0.42, -r * 0.42], tr: Pt = [r * 0.42, -r * 0.42], m: Pt = [0, -r * 0.2];
  poly(x, [T, Rr, B, L], U.shade(color, -0.45), 'rgba(0,0,0,0.55)', 1.6);
  poly(x, [L, tl, m], U.shade(color, 0.28)); poly(x, [tl, T, tr, m], U.shade(color, 0.45)); poly(x, [tr, Rr, m], U.shade(color, 0.05));
  poly(x, [L, m, B], U.shade(color, -0.05)); poly(x, [m, Rr, B], U.shade(color, -0.3));
  x.strokeStyle = 'rgba(255,255,255,0.35)'; x.lineWidth = 0.6; x.beginPath(); x.moveTo(L[0], L[1]); x.lineTo(m[0], m[1]); x.lineTo(Rr[0], Rr[1]); x.moveTo(m[0], m[1]); x.lineTo(B[0], B[1]); x.moveTo(tl[0], tl[1]); x.lineTo(m[0], m[1]); x.lineTo(tr[0], tr[1]); x.stroke();
  poly(x, [T, Rr, B, L], null, 'rgba(255,255,255,0.75)', 0.8);
  // bright highlight and a sparkle
  poly(x, [[-r * 0.1, -r * 1.05], [-r * 0.32, -r * 0.5], [-r * 0.62, -r * 0.32]], 'rgba(255,255,255,0.9)');
  x.globalCompositeOperation = 'lighter'; x.strokeStyle = '#fff'; x.lineWidth = Math.max(0.6, r * 0.08); x.lineCap = 'round';
  const sx = -r * 0.45, sy = -r * 0.7; x.beginPath(); x.moveTo(sx - r * 0.45, sy); x.lineTo(sx + r * 0.45, sy); x.moveTo(sx, sy - r * 0.45); x.lineTo(sx, sy + r * 0.45); x.stroke();
  x.drawImage(glow('#ffffff', r * 0.4), sx - r * 0.4, sy - r * 0.4, r * 0.8, r * 0.8); x.globalCompositeOperation = 'source-over';
  const sp = withOrigin(c, R, R, RES); cache.set(key, sp); return sp;
}
/** One of 6 frames of a spinning gold coin (width oscillates, the milled edge shows as it turns). */
function coinFrame(r = 6, frame = 0): Sprite {
  const f = normFrame(frame, 6);
  const key = 'coin|' + r + '|' + f; const hit = cached<Sprite>(key); if (hit) return hit;
  const R = r * 2.2, [c, x] = mkRes(R * 2, R * 2);
  x.globalAlpha = 0.6; x.drawImage(glow('#ffcc44', R * RES), 0, 0, R * 2, R * 2); x.globalAlpha = 1;
  x.translate(R, R);
  const ph = f / 6 * U.TAU, cw = Math.cos(ph), w = r * Math.max(0.16, Math.abs(cw)), ed = r * 0.24 * Math.sin(ph);
  // edge (the coin's thickness) seen as it turns
  if (Math.abs(ed) > 0.05) { x.fillStyle = '#8a5a12'; x.beginPath(); x.ellipse(ed, 0, w, r, 0, 0, U.TAU); x.fill(); x.fillRect(Math.min(0, ed), -r, Math.abs(ed), r * 2); x.strokeStyle = 'rgba(255,220,120,0.6)'; x.lineWidth = 0.5; for (let i = -4; i <= 4; i++) { x.beginPath(); x.moveTo(Math.min(0, ed), i * r * 0.22); x.lineTo(Math.max(0, ed), i * r * 0.22); x.stroke(); } }
  x.beginPath(); x.ellipse(0, 0, w, r, 0, 0, U.TAU); x.fillStyle = rgrad(x, 0, 0, r, [[0, '#fff3b0'], [0.5, '#f5c542'], [1, '#a5741a']]); x.fill(); x.strokeStyle = '#6a4a10'; x.lineWidth = 1.1; x.stroke();
  x.beginPath(); x.ellipse(0, 0, w * 0.74, r * 0.74, 0, 0, U.TAU); x.strokeStyle = 'rgba(120,80,16,0.7)'; x.lineWidth = 0.8; x.stroke();
  if (Math.abs(cw) > 0.35) { x.save(); x.scale(w / r, 1); x.fillStyle = '#a5741a'; x.font = `bold ${r * 1.15}px serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('$', 0, r * 0.08); x.restore(); }
  // a shine that sweeps across with the spin
  x.save(); x.beginPath(); x.ellipse(0, 0, w, r, 0, 0, U.TAU); x.clip();
  x.fillStyle = 'rgba(255,255,255,0.55)'; x.beginPath(); x.ellipse(-w * 0.35 + Math.sin(ph) * w * 0.3, -r * 0.4, w * 0.3, r * 0.22, -0.5, 0, U.TAU); x.fill(); x.restore();
  const sp = withOrigin(c, R, R, RES); cache.set(key, sp); return sp;
}
function coin(r = 6): Sprite { return coinFrame(r, 0); }
/** The chest body (and closed lid), shared by the closed and open chests. */
function chestBody(x: Ctx, b: boolean, open: boolean): void {
  const wood = b ? '#5a1a3a' : '#6b3a1a', woodL = b ? '#8a2a5a' : '#8a5a2a', trim = b ? '#ff44aa' : '#ffd700', iron = '#2a1a0a';
  if (open) {
    // lid flipped back, its dark interior facing us
    x.beginPath(); x.moveTo(-14, -4); x.lineTo(-15.5, -18); x.quadraticCurveTo(0, -24, 15.5, -18); x.lineTo(14, -4); x.closePath();
    x.fillStyle = vgrad(x, -24, -4, U.shade(woodL, -0.15), 0.05, -0.35); x.fill(); x.strokeStyle = iron; x.lineWidth = 1.5; x.stroke();
    x.fillStyle = 'rgba(0,0,0,0.45)'; x.beginPath(); x.moveTo(-12, -5); x.lineTo(-13, -16); x.quadraticCurveTo(0, -21, 13, -16); x.lineTo(12, -5); x.closePath(); x.fill();
    x.fillStyle = trim; x.beginPath(); x.moveTo(-15.5, -18); x.quadraticCurveTo(0, -24, 15.5, -18); x.lineTo(15.3, -16.5); x.quadraticCurveTo(0, -22.4, -15.3, -16.5); x.closePath(); x.fill();
  }
  // body
  x.fillStyle = vgrad(x, -4, 12, woodL, 0.05, -0.3); x.fillRect(-14, -4, 28, 16);
  x.strokeStyle = 'rgba(0,0,0,0.35)'; x.lineWidth = 0.8; for (const py of [1, 6]) { x.beginPath(); x.moveTo(-14, py); x.lineTo(14, py); x.stroke(); }
  x.fillStyle = U.rgba(wood, 0.6); x.fillRect(-14, 9, 28, 3);
  x.strokeStyle = iron; x.lineWidth = 1.5; x.strokeRect(-14, -4, 28, 16);
  for (const bx of [-10, 10]) { x.fillStyle = vgrad(x, -4, 12, trim, 0.2, -0.35); x.fillRect(bx - 1.6, -4, 3.2, 16); circle(x, bx, -1, 0.7, '#fff8'); circle(x, bx, 9, 0.7, '#fff8'); }
  if (open) {
    // interior heaped with treasure
    x.fillStyle = '#1a0e08'; x.beginPath(); x.ellipse(0, -4, 13.5, 3.2, 0, 0, U.TAU); x.fill();
    const rnd = U.mulberry32(b ? 9 : 4);
    for (let i = 0; i < 14; i++) { const px = (rnd() - 0.5) * 22, py = -4.5 - rnd() * 3.5 + Math.abs(px) * 0.12; x.beginPath(); x.ellipse(px, py, 2.2, 1.4, (rnd() - 0.5) * 0.6, 0, U.TAU); x.fillStyle = rgrad(x, px, py, 2.2, [[0, '#fff6c0'], [0.5, '#f5c542'], [1, '#a5741a']]); x.fill(); x.strokeStyle = '#6a4a10'; x.lineWidth = 0.5; x.stroke(); }
    for (let i = 0; i < 3; i++) { const px = -6 + i * 6, py = -7.5 + (i % 2); poly(x, [[px, py - 2.2], [px + 1.6, py], [px, py + 2], [px - 1.6, py]], [b ? '#ff6ac8' : '#7ad7ff', '#ff4d6d', '#9dff5c'][i], 'rgba(255,255,255,0.7)', 0.5); }
  } else {
    // domed lid
    x.beginPath(); x.moveTo(-14, -4); x.quadraticCurveTo(-14, -16, 0, -17); x.quadraticCurveTo(14, -16, 14, -4); x.closePath();
    x.fillStyle = vgrad(x, -17, -4, woodL, 0.2, -0.15); x.fill(); x.strokeStyle = iron; x.lineWidth = 1.5; x.stroke();
    x.strokeStyle = 'rgba(0,0,0,0.3)'; x.lineWidth = 0.8; x.beginPath(); x.moveTo(-13, -9); x.quadraticCurveTo(0, -12.5, 13, -9); x.stroke();
    for (const bx of [-10, 10]) { x.fillStyle = vgrad(x, -16, -4, trim, 0.25, -0.3); x.beginPath(); x.moveTo(bx - 1.6, -4); x.lineTo(bx - 1.6, -13.5 + Math.abs(bx) * 0.1); x.lineTo(bx + 1.6, -14 + Math.abs(bx) * 0.1); x.lineTo(bx + 1.6, -4); x.closePath(); x.fill(); }
    x.strokeStyle = 'rgba(255,255,255,0.45)'; x.lineWidth = 1; x.beginPath(); x.moveTo(-11, -10); x.quadraticCurveTo(-6, -15, 2, -15.5); x.stroke();
    x.fillStyle = vgrad(x, -6, -2, trim, 0.25, -0.25); x.fillRect(-14, -5.5, 28, 3);
    // lock plate
    x.fillStyle = vgrad(x, -6, 5, trim, 0.3, -0.25); x.beginPath(); x.roundRect(-3.5, -5, 7, 9, 1.5); x.fill(); x.strokeStyle = iron; x.lineWidth = 1; x.stroke();
    circle(x, 0, -1.4, 1.3, '#1a1008'); x.fillStyle = '#1a1008'; x.fillRect(-0.5, -1.2, 1, 3);
    circle(x, -2, -3.6, 0.6, 'rgba(255,255,255,0.8)');
  }
}
function pickup(kind: string): Sprite {
  const key = 'pk|' + kind; const hit = cached<Sprite>(key); if (hit) return hit;
  const R = 26, [c, x] = mkRes(R * 2, R * 2);
  x.translate(R, R);
  const glowCol = { food: '#ff6b6b', magnet: '#4fd1ff', bomb: '#ffb347', clock: '#b28dff', chest: '#ffd700', material: '#a0e0ff', ember: '#ff8a3c', brazier: '#ff9a3c', bosschest: '#ff44aa' }[kind] || '#fff';
  x.globalAlpha = 0.7; x.drawImage(glow(glowCol, R * RES), -R, -R, R * 2, R * 2); x.globalAlpha = 1;
  x.lineJoin = 'round';
  if (kind === 'food') {
    x.fillStyle = '#e8d8c0'; x.beginPath(); x.ellipse(-8, 6, 5, 3.5, 0.8, 0, U.TAU); x.fill(); x.beginPath(); x.ellipse(-9, -3, 3.5, 5, 0.8, 0, U.TAU); x.fill();
    circle(x, 3, 0, 10, rgrad(x, 3, 0, 10, [[0, '#e9755e'], [1, '#8a2f1e']]), '#4a1a10', 1.5);
    x.fillStyle = '#f0a58a'; x.beginPath(); x.ellipse(1, -3, 5, 2.5, -0.5, 0, U.TAU); x.fill();
  } else if (kind === 'magnet') {
    x.strokeStyle = '#d33'; x.lineWidth = 6; x.beginPath(); x.arc(0, 0, 9, Math.PI, 0); x.stroke(); x.beginPath(); x.moveTo(-9, 0); x.lineTo(-9, 9); x.moveTo(9, 0); x.lineTo(9, 9); x.stroke();
    x.strokeStyle = '#eee'; x.lineWidth = 6; x.beginPath(); x.moveTo(-9, 5); x.lineTo(-9, 10); x.moveTo(9, 5); x.lineTo(9, 10); x.stroke();
  } else if (kind === 'bomb') {
    circle(x, 0, 3, 10, rgrad(x, 0, 3, 10, [[0, '#666'], [1, '#111']]), '#000'); x.strokeStyle = '#a86'; x.lineWidth = 2; x.beginPath(); x.moveTo(3, -6); x.quadraticCurveTo(8, -12, 12, -10); x.stroke();
    x.shadowColor = '#ffb347'; x.shadowBlur = 10; circle(x, 12, -10, 3, '#ffe08a'); x.shadowBlur = 0;
  } else if (kind === 'clock') {
    circle(x, 0, 0, 11, rgrad(x, 0, 0, 11, [[0, '#f4ecff'], [1, '#9c7ad6']]), '#4a2a80', 2);
    x.strokeStyle = '#2a1a50'; x.lineWidth = 2; x.beginPath(); x.moveTo(0, 0); x.lineTo(0, -7); x.moveTo(0, 0); x.lineTo(5, 3); x.stroke();
  } else if (kind === 'chest' || kind === 'bosschest') {
    chestBody(x, kind === 'bosschest', false);
  } else if (kind === 'material') {
    poly(x, [[0, -12], [8, -4], [5, 9], [-5, 9], [-8, -4]], rgrad(x, 0, 0, 12, [[0, '#fff'], [0.4, '#a0e0ff'], [1, '#3b7fb8']]), '#fff8', 1);
  } else if (kind === 'ember') {
    x.shadowColor = '#ff8a3c'; x.shadowBlur = 12; poly(x, [[0, -12], [5, -3], [9, 6], [0, 11], [-9, 6], [-5, -3]], rgrad(x, 0, 0, 12, [[0, '#fff5d0'], [0.4, '#ff9a3c'], [1, '#b0300a']]), '#ffd0a0', 1); x.shadowBlur = 0;
  } else if (kind === 'brazier') {
    x.fillStyle = '#3a3a44'; x.fillRect(-10, 2, 20, 12); x.fillStyle = '#55555f'; x.fillRect(-13, 0, 26, 4);
    x.shadowColor = '#ff9a3c'; x.shadowBlur = 14; poly(x, [[-7, 2], [-4, -8], [0, -3], [3, -14], [6, -4], [8, 2]], rgrad(x, 0, -4, 10, [[0, '#fff2b0'], [0.5, '#ff9a3c'], [1, '#c0300a']])); x.shadowBlur = 0;
  }
  const sp = withOrigin(c, R, R, RES); cache.set(key, sp); return sp;
}
/** An opened chest with light and gold spilling out; same size and pivot as `pickup('chest' | 'bosschest')`. */
function chestOpen(boss = false): Sprite {
  const key = 'chestopen|' + (boss ? 1 : 0); const hit = cached<Sprite>(key); if (hit) return hit;
  const R = 26, [c, x] = mkRes(R * 2, R * 2);
  x.translate(R, R); x.lineJoin = 'round';
  const lc = boss ? '#ff6ac8' : '#ffd84a';
  x.globalAlpha = 0.85; x.drawImage(glow(lc, R * RES), -R, -R, R * 2, R * 2); x.globalAlpha = 1;
  chestBody(x, boss, true);
  // light rays fanning up out of the chest
  x.save(); x.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 7; i++) { const a = -Math.PI / 2 + (i - 3) * 0.24, l = 20 + (i % 2) * 5, g = x.createLinearGradient(0, -5, Math.cos(a) * l, -5 + Math.sin(a) * l); g.addColorStop(0, U.rgba(lc, 0.75)); g.addColorStop(1, U.rgba(lc, 0)); x.fillStyle = g; x.beginPath(); x.moveTo(-2 + (i - 3) * 1.5, -5); x.lineTo(Math.cos(a - 0.07) * l, -5 + Math.sin(a - 0.07) * l); x.lineTo(Math.cos(a + 0.07) * l, -5 + Math.sin(a + 0.07) * l); x.lineTo(2 + (i - 3) * 1.5, -5); x.closePath(); x.fill(); }
  x.drawImage(glow('#ffffff', 10), -10, -15, 20, 20);
  x.strokeStyle = '#fff'; x.lineWidth = 0.8; x.lineCap = 'round';
  for (const [sx, sy, s] of [[-9, -16, 2.2], [8, -19, 1.8], [2, -23, 1.4], [-3, -12, 1.2]] as const) { x.beginPath(); x.moveTo(sx - s, sy); x.lineTo(sx + s, sy); x.moveTo(sx, sy - s); x.lineTo(sx, sy + s); x.stroke(); }
  x.restore();
  const sp = withOrigin(c, R, R, RES); cache.set(key, sp); return sp;
}

/* ---------- props ---------- */
/** Distinct bakes per prop kind: seeds are folded onto this many variants so atlas use stays bounded. */
const PROP_VARIANTS = 6;
/** Props that emit light: colour, vertical offset of the light source from the pivot (negative = above) and radius (world units). */
export const PROP_LIGHTS: Record<string, { color: string; dy: number; r: number }> = {
  crystal: { color: '#7ad7ff', dy: -16, r: 90 },
  mushroom: { color: '#9dff5c', dy: -12, r: 70 },
  pillar: { color: '#ff4d6d', dy: -42, r: 80 },
  candelabra: { color: '#ffb347', dy: -68, r: 130 },
  toxicshroom: { color: '#9dff5c', dy: -24, r: 110 },
  obelisk: { color: '#c084fc', dy: -58, r: 120 },
  floatrock: { color: '#c084fc', dy: -26, r: 95 },
};
/** PROP_LIGHTS with the stage's crystal colour applied to the props that glow in it (crystal, mushroom, pillar gem, obelisk, ...). */
function propLight(kind: string, pal?: PropPalette): { color: string; dy: number; r: number } | undefined {
  const l = PROP_LIGHTS[kind];
  if (!l || !pal?.crystal || kind === 'candelabra') return l;
  return { ...l, color: pal.crystal };
}
const PROP_TALL: Record<string, true> = { tree: true, deadtree: true, frozentree: true, obelisk: true, candelabra: true, pillar: true, icespike: true, floatrock: true };
const PROP_LOW: Record<string, true> = { bones: true, roots: true };
/** A soft irregular blob path (decals, moss, snow caps). */
function blob(x: Ctx, rnd: () => number, cx: number, cy: number, rx: number, ry: number, n = 9, jit = 0.28): void {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) { const a = i / n * U.TAU, k = 1 - jit + rnd() * jit * 2; pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]); }
  x.beginPath(); x.moveTo((pts[0][0] + pts[n - 1][0]) / 2, (pts[0][1] + pts[n - 1][1]) / 2);
  for (let i = 0; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; x.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2); }
  x.closePath();
}
/** A tapered branch from (x0,y0) at angle a (0 = up), recursing into smaller branches. */
function branch(x: Ctx, rnd: () => number, x0: number, y0: number, a: number, len: number, w: number, depth: number, col: string, tips: Pt[]): void {
  const bend = (rnd() - 0.5) * 0.5, x1 = x0 + Math.sin(a) * len, y1 = y0 - Math.cos(a) * len, mx = x0 + Math.sin(a + bend) * len * 0.5, my = y0 - Math.cos(a + bend) * len * 0.5;
  taper(x, [x0, y0], [mx, my], [mx * 0.5 + x1 * 0.5, my * 0.5 + y1 * 0.5], [x1, y1], w, w * 0.62, col, 6);
  if (depth <= 0 || len < 6) { tips.push([x1, y1]); return; }
  const n = 2 + (rnd() < 0.35 ? 1 : 0);
  for (let i = 0; i < n; i++) branch(x, rnd, x1, y1, a + (i - (n - 1) / 2) * (0.55 + rnd() * 0.35) + (rnd() - 0.5) * 0.3, len * (0.62 + rnd() * 0.18), w * 0.62, depth - 1, col, tips);
}
function prop(kind: string, seed: number, pal: PropPalette): Sprite {
  const v = ((Math.floor(seed) % PROP_VARIANTS) + PROP_VARIANTS) % PROP_VARIANTS;
  const key = 'prop|' + kind + '|' + v + '|' + (pal.id || '') + '|' + (pal.crystal || '');
  const hit = cached<Sprite>(key); if (hit) return hit;
  const rnd = U.mulberry32(v * 7919 + kind.length * 131 + 13);
  const W = 96, H = PROP_TALL[kind] ? 124 : PROP_LOW[kind] ? 56 : 76, OY = H - 12;
  const [c0, x] = mkRes(W, H); x.translate(W / 2, OY);
  x.lineJoin = 'round'; x.lineCap = 'round';
  const dark = pal.propDark || '#22202a', light = pal.propLight || '#5a5668', cry = pal.crystal || '#7ad7ff', st = pal.id || '';
  const snow = st === 'frost', moss = st === 'blight', ink = 'rgba(0,0,0,0.6)';
  const stone = U.mix(light, '#8a8478', 0.25), stoneD = U.mix(dark, '#2a2622', 0.3), wood = st === 'ashen' ? '#2a2220' : st === 'frost' ? '#3a3440' : '#4a3424';
  /** Emissive passes drawn after the outline so glows don't get a dark halo. */
  const post: ((x: Ctx) => void)[] = [];
  let shadow = 20;
  const cap = (fn: () => void) => { if (snow) { x.save(); fn(); x.fillStyle = '#eef7ff'; x.fill(); x.strokeStyle = 'rgba(120,160,200,0.6)'; x.lineWidth = 0.8; x.stroke(); x.restore(); } else if (moss) { x.save(); fn(); x.fillStyle = 'rgba(96,140,60,0.85)'; x.fill(); x.restore(); } };
  const rockShape = (cx: number, rx: number, ry: number) => {
    const n = 8 + Math.floor(rnd() * 3), pts: Pt[] = [];
    for (let i = 0; i < n; i++) { const a = Math.PI + i / (n - 1) * Math.PI, k = 0.78 + rnd() * 0.3; pts.push([cx + Math.cos(a) * rx * k, Math.min(1.5, -ry * 0.15 + Math.sin(a) * ry * k)]); }
    pts.push([cx + rx * 0.9, 2], [cx - rx * 0.9, 2]);
    poly(x, pts, rgrad(x, cx - rx * 0.2, -ry * 0.7, rx * 1.2, [[0, U.shade(stone, 0.12)], [0.6, stone], [1, stoneD]]), ink, 1.5);
    // lit facet + shaded side
    const top = pts.slice(1, Math.ceil(n / 2));
    poly(x, [[cx - rx * 0.1, -ry * 0.3], ...top.map((p) => [p[0] * 0.92 + cx * 0.08, p[1] * 0.85] as Pt)], 'rgba(255,255,255,0.10)');
    poly(x, [[cx + rx * 0.2, 2], [cx + rx * 0.15, -ry * 0.45], pts[n - 2], pts[n - 1], [cx + rx * 0.9, 2]], 'rgba(0,0,0,0.22)');
    x.strokeStyle = 'rgba(0,0,0,0.4)'; x.lineWidth = 1; x.beginPath(); x.moveTo(cx - rx * 0.2, -ry * 0.9); x.lineTo(cx - rx * 0.05, -ry * 0.5); x.lineTo(cx - rx * 0.25, -ry * 0.2); x.stroke();
    cap(() => { x.beginPath(); x.moveTo(pts[1][0], pts[1][1] + 2); for (let i = 1; i < n - 1; i++) x.lineTo(pts[i][0], pts[i][1] - 0.5); x.lineTo(pts[n - 2][0], pts[n - 2][1] + 2); for (let i = n - 2; i >= 1; i--) x.lineTo(pts[i][0] * 0.9 + cx * 0.1, pts[i][1] + ry * (0.18 + (i % 2) * 0.12)); x.closePath(); });
    return pts;
  };
  if (kind === 'rock') {
    const rx = 15 + rnd() * 7, ry = 14 + rnd() * 8; shadow = rx * 1.3;
    if (rnd() < 0.6) rockShape(-rx * 0.95, rx * 0.45, ry * 0.45);
    rockShape(0, rx, ry);
    if (st === 'void') post.push((p) => { for (let i = 0; i < 3; i++) { const gx = (rnd() - 0.5) * rx, gy = -rnd() * ry * 0.8; p.globalCompositeOperation = 'lighter'; p.drawImage(glow(cry, 5), gx - 5, gy - 5, 10, 10); } });
  } else if (kind === 'tree') {
    const lean = (rnd() - 0.5) * 0.3, tips: Pt[] = [], bark = moss ? '#3a2e22' : wood;
    for (const sd of [-1, 1]) taper(x, [0, -4], [sd * 6, -1], [sd * 10, 1], [sd * (13 + rnd() * 4), 2], 4, 1, bark, 5);
    branch(x, rnd, 0, 1, lean, 26 + rnd() * 8, 8, 3, bark, tips);
    x.strokeStyle = 'rgba(255,255,255,0.08)'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(-2, -2); x.lineTo(-2 + lean * 10, -22); x.stroke();
    if (moss) for (const [tx, ty] of tips) { blob(x, rnd, tx, ty, 9 + rnd() * 5, 7 + rnd() * 3); x.fillStyle = rgrad(x, tx, ty, 12, [[0, '#5c7a3a'], [1, '#22361c']]); x.fill(); x.strokeStyle = ink; x.lineWidth = 1; x.stroke(); }
    else if (snow) { x.strokeStyle = '#eef7ff'; x.lineWidth = 1.6; for (const [tx, ty] of tips) { x.beginPath(); x.moveTo(tx - 3, ty + 1); x.lineTo(tx + 1, ty - 0.5); x.stroke(); } }
    else if (st === 'void' || st === 'cathedral') { for (const [tx, ty] of tips) if (rnd() < 0.4) poly(x, [[tx, ty], [tx - 1.5, ty + 2], [tx + 1.5, ty + 2]], U.shade(dark, 0.1)); }
    shadow = 22;
  } else if (kind === 'deadtree') {
    // big gnarled burnt tree
    const tips: Pt[] = [], bark = '#1c1614';
    for (let i = 0; i < 4; i++) { const sd = i % 2 ? 1 : -1; taper(x, [sd * 3, -6], [sd * 10, -3], [sd * 16, 0], [sd * (18 + rnd() * 8), 3], 6, 1.2, bark, 6); }
    x.beginPath(); x.moveTo(-9, 2); x.bezierCurveTo(-6, -20, -11, -36, -4, -54); x.lineTo(5, -56); x.bezierCurveTo(9, -38, 5, -20, 10, 2); x.closePath(); x.fillStyle = vgrad(x, -56, 2, '#3a2c26', 0.0, -0.2); x.fill(); x.strokeStyle = ink; x.lineWidth = 1.4; x.stroke();
    x.strokeStyle = 'rgba(0,0,0,0.45)'; x.lineWidth = 1; for (let i = 0; i < 4; i++) { x.beginPath(); x.moveTo(-5 + i * 3, 0); x.bezierCurveTo(-4 + i * 3, -14, -7 + i * 3, -30, -2 + i * 2.5, -48); x.stroke(); }
    x.fillStyle = '#0e0a08'; x.beginPath(); x.ellipse(1, -24, 2.5, 5, 0.1, 0, U.TAU); x.fill();
    branch(x, rnd, 0, -52, -0.5 - rnd() * 0.3, 20 + rnd() * 6, 6, 2, bark, tips);
    branch(x, rnd, 1, -54, 0.45 + rnd() * 0.3, 22 + rnd() * 6, 6, 2, bark, tips);
    branch(x, rnd, -3, -34, -1.1, 14, 4, 1, bark, tips);
    x.strokeStyle = 'rgba(255,170,120,0.18)'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(-6, -4); x.bezierCurveTo(-4, -20, -8, -34, -3, -50); x.stroke();
    if (st === 'ashen' || st === 'cathedral') post.push((p) => { p.globalCompositeOperation = 'lighter'; for (let i = 0; i < 6; i++) { const ex = (rnd() - 0.5) * 12, ey = -6 - rnd() * 46; p.fillStyle = 'rgba(255,140,60,0.9)'; p.fillRect(ex, ey, 1.2, 1.2); p.drawImage(glow('#ff8a3c', 4), ex - 4, ey - 4, 8, 8); } });
    if (snow) { x.strokeStyle = '#eef7ff'; x.lineWidth = 1.6; for (const [tx, ty] of tips) { x.beginPath(); x.moveTo(tx - 3, ty + 1); x.lineTo(tx + 1, ty - 0.5); x.stroke(); } }
    shadow = 26;
  } else if (kind === 'frozentree') {
    // snow-laden pine
    x.fillStyle = '#3a2a22'; x.fillRect(-3, -14, 6, 16);
    const tiers = 4, top = -92 - rnd() * 8;
    for (let i = 0; i < tiers; i++) {
      const k = i / (tiers - 1), y0 = U.lerp(top + 14, -12, k), w = U.lerp(10, 26, k), hgt = U.lerp(28, 34, k), yT = y0 - hgt;
      x.beginPath(); x.moveTo(0, yT); x.quadraticCurveTo(w * 0.4, yT + hgt * 0.5, w, y0); x.lineTo(w * 0.5, y0 - 3); x.lineTo(0, y0 + 1); x.lineTo(-w * 0.5, y0 - 3); x.lineTo(-w, y0); x.quadraticCurveTo(-w * 0.4, yT + hgt * 0.5, 0, yT); x.closePath();
      x.fillStyle = vgrad(x, yT, y0, '#1f4a4a', 0.08, -0.12); x.fill(); x.strokeStyle = ink; x.lineWidth = 1.2; x.stroke();
      x.beginPath(); x.moveTo(0, yT + 1); x.quadraticCurveTo(w * 0.3, yT + hgt * 0.4, w * 0.82, y0 - 2); x.quadraticCurveTo(w * 0.35, y0 - hgt * 0.3, 0, y0 - hgt * 0.45); x.quadraticCurveTo(-w * 0.35, y0 - hgt * 0.3, -w * 0.82, y0 - 2); x.quadraticCurveTo(-w * 0.3, yT + hgt * 0.4, 0, yT + 1); x.closePath();
      x.fillStyle = vgrad(x, yT, y0, '#f0f8ff', 0.0, -0.12); x.fill();
      x.fillStyle = 'rgba(140,200,240,0.35)'; x.beginPath(); x.moveTo(0, yT + 2); x.quadraticCurveTo(w * 0.3, yT + hgt * 0.4, w * 0.8, y0 - 2); x.lineTo(w * 0.3, y0 - hgt * 0.35); x.closePath(); x.fill();
    }
    shadow = 24;
  } else if (kind === 'grave') {
    const lean = (rnd() - 0.5) * 0.16, type = v % 3;
    x.fillStyle = U.mix(dark, '#3a2a1e', 0.4); blob(x, rnd, 0, 4, 16, 5); x.fill();
    x.save(); x.rotate(lean);
    const face = vgrad(x, -34, 2, stone, 0.12, -0.25);
    if (type === 0) { x.beginPath(); x.moveTo(-10, 2); x.lineTo(-10, -20); x.arc(0, -20, 10, Math.PI, 0); x.lineTo(10, 2); x.closePath(); }
    else if (type === 1) { x.beginPath(); x.moveTo(-3.5, 2); x.lineTo(-3.5, -18); x.lineTo(-11, -18); x.lineTo(-11, -25); x.lineTo(-3.5, -25); x.lineTo(-3.5, -36); x.lineTo(3.5, -36); x.lineTo(3.5, -25); x.lineTo(11, -25); x.lineTo(11, -18); x.lineTo(3.5, -18); x.lineTo(3.5, 2); x.closePath(); }
    else { x.beginPath(); x.moveTo(-11, 2); x.lineTo(-10, -22); x.lineTo(-6, -28); x.lineTo(6, -28); x.lineTo(10, -22); x.lineTo(11, 2); x.closePath(); }
    x.fillStyle = face; x.fill(); x.strokeStyle = ink; x.lineWidth = 1.5; x.stroke();
    x.save(); x.clip();
    x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(4, -40, 10, 44); x.fillStyle = 'rgba(255,255,255,0.1)'; x.fillRect(-12, -40, 4, 44);
    x.strokeStyle = 'rgba(0,0,0,0.45)'; x.lineWidth = 0.9; x.beginPath(); x.moveTo(6, -24); x.lineTo(2, -16); x.lineTo(5, -10); x.lineTo(1, -2); x.stroke();
    cap(() => { x.beginPath(); x.moveTo(-13, -22); x.quadraticCurveTo(0, -36, 13, -22); x.lineTo(13, -18); x.quadraticCurveTo(0, -27 + rnd() * 3, -13, -18); x.closePath(); });
    x.restore();
    if (type !== 1) { x.fillStyle = 'rgba(0,0,0,0.5)'; x.fillRect(-1, -22, 2, 11); x.fillRect(-4.5, -19, 9, 2); x.fillStyle = 'rgba(0,0,0,0.35)'; for (let i = 0; i < 2; i++) x.fillRect(-6, -7 + i * 3, 12, 1); }
    x.restore();
    if (moss) { x.fillStyle = 'rgba(90,130,60,0.7)'; blob(x, rnd, -7, 0, 5, 3); x.fill(); }
    shadow = 16;
  } else if (kind === 'crystal') {
    const n = 3 + (v % 3);
    rockShape(0, 15, 6);
    const shards: [number, number, number, number][] = [];
    for (let i = 0; i < n; i++) shards.push([(i - (n - 1) / 2) * 7 + (rnd() - 0.5) * 3, 18 + rnd() * 16 + (i === Math.floor(n / 2) ? 12 : 0), 3.5 + rnd() * 2.5, (i - (n - 1) / 2) * 0.22 + (rnd() - 0.5) * 0.15]);
    shards.sort((a, b) => a[1] - b[1]);
    for (const [sx, h, w, a] of shards) {
      x.save(); x.translate(sx, -2); x.rotate(a);
      poly(x, [[-w, 0], [-w, -h * 0.75], [0, -h], [w, -h * 0.75], [w, 0]], U.shade(cry, -0.25), 'rgba(255,255,255,0.5)', 1);
      poly(x, [[-w, 0], [-w, -h * 0.75], [0, -h], [0, 0]], U.shade(cry, 0.18));
      poly(x, [[-w * 0.6, -h * 0.1], [-w * 0.6, -h * 0.7], [-w * 0.1, -h * 0.9], [-w * 0.1, -h * 0.15]], 'rgba(255,255,255,0.35)');
      x.strokeStyle = 'rgba(255,255,255,0.9)'; x.lineWidth = 0.8; x.beginPath(); x.moveTo(0, -h); x.lineTo(0, -h * 0.1); x.stroke();
      x.restore();
    }
    post.push((p) => { p.globalCompositeOperation = 'lighter'; p.globalAlpha = 0.55; p.drawImage(glow(cry, 26), -26, -44, 52, 52); p.globalAlpha = 1; for (let i = 0; i < 3; i++) { const sx = (rnd() - 0.5) * 22, sy = -10 - rnd() * 30; p.strokeStyle = '#fff'; p.lineWidth = 0.7; p.beginPath(); p.moveTo(sx - 2.5, sy); p.lineTo(sx + 2.5, sy); p.moveTo(sx, sy - 2.5); p.lineTo(sx, sy + 2.5); p.stroke(); } });
    shadow = 18;
  } else if (kind === 'icespike') {
    const n = 4 + (v % 3), ice = '#a8e4ff';
    x.fillStyle = 'rgba(220,240,255,0.8)'; blob(x, rnd, 0, 1, 22, 5); x.fill();
    const sp: [number, number, number, number][] = [];
    for (let i = 0; i < n; i++) sp.push([(i - (n - 1) / 2) * 8 + (rnd() - 0.5) * 4, 22 + rnd() * 30 + (Math.abs(i - (n - 1) / 2) < 1 ? 22 : 0), 4 + rnd() * 3, (i - (n - 1) / 2) * 0.16 + (rnd() - 0.5) * 0.2]);
    sp.sort((a, b) => a[1] - b[1]);
    for (const [sx, h, w, a] of sp) {
      x.save(); x.translate(sx, 1); x.rotate(a);
      poly(x, [[-w, 0], [-w * 0.3, -h], [w, 0]], U.rgba('#6ab8e0', 0.92), 'rgba(255,255,255,0.75)', 1);
      poly(x, [[-w, 0], [-w * 0.3, -h], [-w * 0.1, 0]], U.rgba('#e8f8ff', 0.85));
      poly(x, [[w * 0.2, 0], [-w * 0.25, -h * 0.85], [w * 0.6, 0]], U.rgba(ice, 0.4));
      x.strokeStyle = 'rgba(255,255,255,0.9)'; x.lineWidth = 0.7; x.beginPath(); x.moveTo(-w * 0.55, -h * 0.25); x.lineTo(-w * 0.32, -h * 0.85); x.stroke();
      x.restore();
    }
    shadow = 22;
  } else if (kind === 'bones') {
    x.fillStyle = 'rgba(0,0,0,0.2)'; blob(x, rnd, 0, 2, 22, 6); x.fill();
    const bone = '#d8d0c0';
    for (let i = 0; i < 4; i++) { const a = rnd() * Math.PI, l = 6 + rnd() * 7, ox = (rnd() - 0.5) * 30, oy = (rnd() - 0.5) * 6; seg(x, [[ox - Math.cos(a) * l, oy - Math.sin(a) * l * 0.4], [ox + Math.cos(a) * l, oy + Math.sin(a) * l * 0.4]], 3.4, ink); seg(x, [[ox - Math.cos(a) * l, oy - Math.sin(a) * l * 0.4], [ox + Math.cos(a) * l, oy + Math.sin(a) * l * 0.4]], 2.4, bone); for (const e of [-1, 1]) circle(x, ox + e * Math.cos(a) * l, oy + e * Math.sin(a) * l * 0.4, 1.7, bone); }
    if (v % 2 === 0) { // ribcage
      for (let i = 0; i < 4; i++) { x.strokeStyle = ink; x.lineWidth = 3; x.beginPath(); x.arc(-8 + i * 4, 0, 7 - i * 0.6, Math.PI * 1.05, Math.PI * 1.95); x.stroke(); x.strokeStyle = bone; x.lineWidth = 2; x.stroke(); }
      seg(x, [[-12, 0], [6, 0]], 2.6, U.shade(bone, -0.1));
    }
    const sx = 8 + (rnd() - 0.5) * 6, sy = -3;
    circle(x, sx, sy, 6, rgrad(x, sx, sy, 6, [[0, '#f8f4ea'], [1, '#a89c88']]), ink, 1); x.fillStyle = '#d0c8b4'; x.fillRect(sx - 3.5, sy + 3, 7, 3.5);
    circle(x, sx - 2.2, sy - 0.5, 1.6, '#1a1414'); circle(x, sx + 2.2, sy - 0.5, 1.6, '#1a1414'); poly(x, [[sx, sy + 1.2], [sx - 0.8, sy + 2.6], [sx + 0.8, sy + 2.6]], '#1a1414');
    if (snow) { x.fillStyle = 'rgba(240,248,255,0.85)'; blob(x, rnd, sx - 1, sy - 4.5, 4.5, 1.6); x.fill(); }
    shadow = 0;
  } else if (kind === 'pillar') {
    const h = 58 + rnd() * 10, w = 8;
    x.fillStyle = vgrad(x, -4, 4, stoneD, 0.1, -0.2); x.fillRect(-13, -6, 26, 8); x.strokeStyle = ink; x.lineWidth = 1.2; x.strokeRect(-13, -6, 26, 8);
    const g = x.createLinearGradient(-w, 0, w, 0); g.addColorStop(0, U.shade(stone, -0.18)); g.addColorStop(0.35, U.shade(stone, 0.15)); g.addColorStop(1, U.shade(stone, -0.35));
    x.fillStyle = g; x.fillRect(-w, -h, w * 2, h - 6); x.strokeRect(-w, -h, w * 2, h - 6);
    x.strokeStyle = 'rgba(0,0,0,0.25)'; x.lineWidth = 1; for (let i = -1; i <= 1; i++) { x.beginPath(); x.moveTo(i * 4.5, -h + 2); x.lineTo(i * 4.5, -8); x.stroke(); }
    x.strokeStyle = 'rgba(0,0,0,0.45)'; x.beginPath(); x.moveTo(5, -h + 14); x.lineTo(2, -h + 22); x.lineTo(5, -h + 28); x.stroke();
    x.fillStyle = vgrad(x, -h - 8, -h, stoneD, 0.2, -0.15); x.fillRect(-12, -h - 7, 24, 7); x.strokeStyle = ink; x.strokeRect(-12, -h - 7, 24, 7);
    x.fillStyle = 'rgba(255,255,255,0.15)'; x.fillRect(-12, -h - 7, 24, 1.5);
    cap(() => { x.beginPath(); x.moveTo(-13, -h - 6); x.quadraticCurveTo(0, -h - 12, 13, -h - 6); x.lineTo(12, -h - 4); x.lineTo(-12, -h - 4); x.closePath(); });
    // glowing rune gem set in the shaft
    x.fillStyle = '#100810'; x.beginPath(); x.roundRect(-3, -h * 0.68, 6, 14, 2); x.fill();
    post.push((p) => { p.globalCompositeOperation = 'lighter'; p.globalAlpha = 0.7; p.drawImage(glow(cry, 14), -14, -h * 0.68 + 7 - 14, 28, 28); p.globalAlpha = 1; p.globalCompositeOperation = 'source-over'; poly(p, [[0, -h * 0.68 + 1], [2.2, -h * 0.68 + 7], [0, -h * 0.68 + 13], [-2.2, -h * 0.68 + 7]], rgrad(p, 0, -h * 0.68 + 7, 6, [[0, '#fff'], [0.5, cry], [1, U.shade(cry, -0.3)]])); });
    shadow = 16;
  } else if (kind === 'brokenpillar') {
    // a standing stump of a column and a fallen drum beside it
    const h = 20 + rnd() * 12, w = 8, fx = (v % 2 ? -1 : 1) * 16;
    x.save(); x.translate(fx, 0);
    x.beginPath(); x.ellipse(0, -5, 11, 6.5, 0, 0, U.TAU); x.fillStyle = vgrad(x, -11, 1, stone, 0.05, -0.3); x.fill(); x.strokeStyle = ink; x.lineWidth = 1.2; x.stroke();
    x.beginPath(); x.ellipse(-9, -5, 3, 6.5, 0, 0, U.TAU); x.fillStyle = rgrad(x, -9, -5, 6, [[0, U.shade(stone, 0.2)], [1, stoneD]]); x.fill(); x.stroke();
    x.strokeStyle = 'rgba(0,0,0,0.25)'; x.beginPath(); x.moveTo(-6, -9); x.lineTo(9, -9); x.moveTo(-6, -1); x.lineTo(9, -1); x.stroke();
    x.restore();
    x.fillStyle = vgrad(x, -4, 4, stoneD, 0.1, -0.2); x.fillRect(-12, -5, 24, 7); x.strokeStyle = ink; x.lineWidth = 1.2; x.strokeRect(-12, -5, 24, 7);
    const g = x.createLinearGradient(-w, 0, w, 0); g.addColorStop(0, U.shade(stone, -0.18)); g.addColorStop(0.35, U.shade(stone, 0.15)); g.addColorStop(1, U.shade(stone, -0.35));
    x.beginPath(); x.moveTo(-w, -5); x.lineTo(-w, -h); x.lineTo(-w * 0.4, -h - 5); x.lineTo(0, -h + 1); x.lineTo(w * 0.5, -h - 7); x.lineTo(w, -h - 2); x.lineTo(w, -5); x.closePath(); x.fillStyle = g; x.fill(); x.stroke();
    x.strokeStyle = 'rgba(0,0,0,0.25)'; x.lineWidth = 1; for (let i = -1; i <= 1; i++) { x.beginPath(); x.moveTo(i * 4.5, -h + 3); x.lineTo(i * 4.5, -6); x.stroke(); }
    cap(() => { x.beginPath(); x.moveTo(-w, -h); x.lineTo(-w * 0.4, -h - 5); x.lineTo(0, -h + 1); x.lineTo(w * 0.5, -h - 7); x.lineTo(w, -h - 2); x.lineTo(w, -h + 1); x.lineTo(-w, -h + 3); x.closePath(); });
    for (let i = 0; i < 5; i++) { const rx = (rnd() - 0.5) * 34, ry = (rnd() - 0.3) * 5; poly(x, [[rx - 2.5, ry + 1], [rx - 1.5, ry - 2.5], [rx + 2, ry - 2], [rx + 3, ry + 1]], U.shade(stone, -0.1 + rnd() * 0.2), ink, 0.8); }
    shadow = 22;
  } else if (kind === 'ruin') {
    // a broken wall segment of mortared blocks
    const cols = 5, bw = 11, bh = 7, w0 = -cols * bw / 2, hts: number[] = [];
    for (let i = 0; i < cols; i++) hts.push(2 + Math.floor(rnd() * 4) + (i === 1 || i === 2 ? 2 : 0));
    for (let i = 0; i < cols; i++) for (let j = 0; j < hts[i]; j++) {
      const off = j % 2 ? bw / 2 : 0, bx = w0 + i * bw + off - (j % 2 && i === cols - 1 ? bw / 2 : 0), by = -(j + 1) * bh, ww = j % 2 && (i === cols - 1) ? bw / 2 : bw;
      if (j % 2 && i === 0) { x.fillStyle = vgrad(x, by, by + bh, stone, 0.05, -0.2); x.fillRect(w0, by, bw / 2, bh); x.strokeStyle = ink; x.lineWidth = 1; x.strokeRect(w0, by, bw / 2, bh); }
      const tone = U.shade(stone, (rnd() - 0.5) * 0.14);
      x.fillStyle = vgrad(x, by, by + bh, tone, 0.08, -0.18); x.fillRect(bx, by, ww, bh); x.strokeStyle = ink; x.lineWidth = 1; x.strokeRect(bx, by, ww, bh);
      x.fillStyle = 'rgba(255,255,255,0.1)'; x.fillRect(bx + 0.5, by + 0.5, ww - 1, 1.2);
      if (j === hts[i] - 1) cap(() => { x.beginPath(); x.moveTo(bx - 0.5, by + 2); x.quadraticCurveTo(bx + ww / 2, by - 2.5, bx + ww + 0.5, by + 2); x.lineTo(bx + ww, by + 1); x.lineTo(bx, by + 1); x.closePath(); });
    }
    for (let i = 0; i < 4; i++) { const rx = (rnd() - 0.5) * 60, ry = 1 + rnd() * 3; x.save(); x.translate(rx, ry); x.rotate((rnd() - 0.5) * 0.8); x.fillStyle = vgrad(x, -3, 3, stone, 0.05, -0.2); x.fillRect(-4, -3, 8, 5); x.strokeStyle = ink; x.lineWidth = 0.9; x.strokeRect(-4, -3, 8, 5); x.restore(); }
    if (moss) { x.fillStyle = 'rgba(90,130,60,0.75)'; for (let i = 0; i < 3; i++) { blob(x, rnd, w0 + rnd() * cols * bw, -rnd() * 14, 5, 3); x.fill(); } }
    shadow = 32;
  } else if (kind === 'mushroom') {
    const n = 2 + (v % 2);
    for (let i = 0; i < n; i++) {
      const mx = (i - (n - 1) / 2) * 11 + (rnd() - 0.5) * 3, mh = 10 + rnd() * 9 + (i === 0 ? 4 : 0), cw = 7 + rnd() * 4;
      x.fillStyle = vgrad(x, -mh, 0, '#e4dccb', 0.05, -0.25); x.beginPath(); x.moveTo(mx - 2.2, 0); x.quadraticCurveTo(mx - 1.5, -mh * 0.5, mx - 1.6, -mh); x.lineTo(mx + 1.6, -mh); x.quadraticCurveTo(mx + 1.5, -mh * 0.5, mx + 2.2, 0); x.closePath(); x.fill(); x.strokeStyle = ink; x.lineWidth = 1; x.stroke();
      x.beginPath(); x.ellipse(mx, -mh, cw, cw * 0.62, 0, Math.PI, 0); x.quadraticCurveTo(mx, -mh + cw * 0.3, mx - cw, -mh); x.fillStyle = rgrad(x, mx - cw * 0.3, -mh - cw * 0.4, cw * 1.1, [[0, U.shade(cry, 0.35)], [0.6, cry], [1, U.shade(cry, -0.35)]]); x.fill(); x.stroke();
      for (let k = 0; k < 3; k++) circle(x, mx - cw * 0.5 + k * cw * 0.45, -mh - cw * (0.25 + (k % 2) * 0.15), 0.9 + rnd() * 0.6, 'rgba(255,255,255,0.75)');
      post.push((p) => { p.globalCompositeOperation = 'lighter'; p.globalAlpha = 0.5; p.drawImage(glow(cry, cw * 1.8), mx - cw * 1.8, -mh - cw * 0.3 - cw * 1.8, cw * 3.6, cw * 3.6); p.globalAlpha = 1; });
    }
    shadow = 14;
  } else if (kind === 'toxicshroom') {
    // a cluster of large glowing toxic mushrooms
    const n = 3 + (v % 2);
    const ms: [number, number, number][] = [];
    for (let i = 0; i < n; i++) ms.push([(i - (n - 1) / 2) * 13 + (rnd() - 0.5) * 5, 14 + rnd() * 18 + (i === Math.floor(n / 2) ? 14 : 0), 9 + rnd() * 6]);
    ms.sort((a, b) => b[1] - a[1]);
    for (const [mx, mh, cw] of ms) {
      x.fillStyle = vgrad(x, -mh, 0, '#c8d4b0', 0.05, -0.3); x.beginPath(); x.moveTo(mx - 3.5, 0); x.quadraticCurveTo(mx - 1.5, -mh * 0.5, mx - 2.4, -mh); x.lineTo(mx + 2.4, -mh); x.quadraticCurveTo(mx + 1.5, -mh * 0.5, mx + 3.5, 0); x.closePath(); x.fill(); x.strokeStyle = ink; x.lineWidth = 1.1; x.stroke();
      x.strokeStyle = 'rgba(0,0,0,0.25)'; x.lineWidth = 0.8; x.beginPath(); x.moveTo(mx - 3, -mh * 0.45); x.quadraticCurveTo(mx, -mh * 0.4, mx + 3, -mh * 0.48); x.stroke();
      x.beginPath(); x.moveTo(mx - cw, -mh + 1); x.bezierCurveTo(mx - cw, -mh - cw * 0.95, mx + cw, -mh - cw * 0.95, mx + cw, -mh + 1); x.quadraticCurveTo(mx, -mh - cw * 0.2, mx - cw, -mh + 1); x.closePath();
      x.fillStyle = rgrad(x, mx - cw * 0.3, -mh - cw * 0.5, cw * 1.2, [[0, U.shade('#5a2a6a', 0.25)], [0.6, '#4a1e5a'], [1, '#22102a']]); x.fill(); x.stroke();
      x.fillStyle = 'rgba(0,0,0,0.35)'; x.beginPath(); x.moveTo(mx - cw * 0.9, -mh + 0.5); x.quadraticCurveTo(mx, -mh - cw * 0.3, mx + cw * 0.9, -mh + 0.5); x.quadraticCurveTo(mx, -mh + cw * 0.05, mx - cw * 0.9, -mh + 0.5); x.fill();
      const spots: Pt[] = []; for (let k = 0; k < 5; k++) { const a = Math.PI * (1.15 + k * 0.17), rr = cw * (0.5 + rnd() * 0.25); spots.push([mx + Math.cos(a) * rr, -mh - cw * 0.12 + Math.sin(a) * rr * 0.75]); }
      post.push((p) => { p.globalCompositeOperation = 'lighter'; p.globalAlpha = 0.45; p.drawImage(glow(cry, cw * 2), mx - cw * 2, -mh - cw * 0.4 - cw * 2, cw * 4, cw * 4); p.globalAlpha = 1; p.globalCompositeOperation = 'source-over'; for (const [sx, sy] of spots) circle(p, sx, sy, 1.2 + cw * 0.06, rgrad(p, sx, sy, 2.4, [[0, '#ffffff'], [0.5, cry], [1, U.shade(cry, -0.2)]])); });
    }
    post.push((p) => { p.globalCompositeOperation = 'lighter'; for (let i = 0; i < 6; i++) { const sx = (rnd() - 0.5) * 50, sy = -10 - rnd() * 50; p.globalAlpha = 0.5 + rnd() * 0.5; p.drawImage(glow(cry, 3), sx - 3, sy - 3, 6, 6); } p.globalAlpha = 1; });
    shadow = 26;
  } else if (kind === 'stump') {
    for (const sd of [-1, 1]) taper(x, [sd * 8, -3], [sd * 13, -1], [sd * 16, 1], [sd * (19 + rnd() * 3), 3], 5, 1.2, U.shade(wood, -0.05), 5);
    x.beginPath(); x.moveTo(-12, -2); x.lineTo(-11, -14); x.lineTo(11, -14); x.lineTo(12, -2); x.quadraticCurveTo(0, 3, -12, -2); x.closePath();
    const bg = x.createLinearGradient(-12, 0, 12, 0); bg.addColorStop(0, U.shade(wood, -0.1)); bg.addColorStop(0.35, U.shade(wood, 0.12)); bg.addColorStop(1, U.shade(wood, -0.3)); x.fillStyle = bg; x.fill(); x.strokeStyle = ink; x.lineWidth = 1.3; x.stroke();
    x.strokeStyle = 'rgba(0,0,0,0.35)'; x.lineWidth = 1; for (let i = -2; i <= 2; i++) { x.beginPath(); x.moveTo(i * 4.5, -13); x.quadraticCurveTo(i * 4.5 + 1, -8, i * 4.8, -1); x.stroke(); }
    x.beginPath(); x.ellipse(0, -14, 11, 4.5, 0, 0, U.TAU); x.fillStyle = rgrad(x, -2, -15, 11, [[0, '#c8a070'], [0.7, '#9a7448'], [1, '#6a4a2a']]); x.fill(); x.strokeStyle = ink; x.stroke();
    x.strokeStyle = 'rgba(80,50,20,0.55)'; x.lineWidth = 0.7; for (let i = 1; i < 4; i++) { x.beginPath(); x.ellipse(0.5, -14, i * 2.6, i * 1.05, 0, 0, U.TAU); x.stroke(); }
    x.strokeStyle = 'rgba(0,0,0,0.5)'; x.lineWidth = 0.8; x.beginPath(); x.moveTo(0, -14); x.lineTo(7, -16); x.stroke();
    cap(() => { x.beginPath(); x.ellipse(-1, -14.8, 9.5, 3.4, 0, 0, U.TAU); });
    if (moss && v % 2) { x.fillStyle = '#e4dccb'; x.fillRect(6, -22, 1.6, 7); x.beginPath(); x.ellipse(6.8, -22, 4, 2.4, 0, Math.PI, 0); x.fillStyle = cry; x.fill(); }
    shadow = 18;
  } else if (kind === 'roots') {
    // gnarled roots arching out of the ground
    const rootC = U.mix(wood, '#2a1e14', 0.3), n = 3 + (v % 2);
    x.fillStyle = 'rgba(0,0,0,0.25)'; blob(x, rnd, 0, 1, 30, 6); x.fill();
    for (let i = 0; i < n; i++) {
      const x0 = -26 + rnd() * 18 + i * 8, x1 = x0 + 14 + rnd() * 18, hh = 8 + rnd() * 12, w = 4 + rnd() * 2.5;
      taper(x, [x0, 2], [x0 + 2, -hh], [x1 - 3, -hh * 0.9], [x1, 2], w + 2, w * 0.6 + 2, ink, 10); taper(x, [x0, 2], [x0 + 2, -hh], [x1 - 3, -hh * 0.9], [x1, 2], w, w * 0.6, rootC, 10);
      x.strokeStyle = 'rgba(255,255,255,0.12)'; x.lineWidth = 1; x.beginPath(); x.moveTo(x0 + 1, -2); x.bezierCurveTo(x0 + 2.5, -hh - 1, x1 - 3, -hh * 0.95, x1 - 1, -2); x.stroke();
      x.fillStyle = '#120c08'; x.beginPath(); x.ellipse(x0, 2, w * 0.8, 1.6, 0, 0, U.TAU); x.fill(); x.beginPath(); x.ellipse(x1, 2, w * 0.6, 1.4, 0, 0, U.TAU); x.fill();
    }
    if (moss) { x.fillStyle = 'rgba(96,140,60,0.8)'; for (let i = 0; i < 3; i++) { blob(x, rnd, -18 + rnd() * 36, -4 - rnd() * 6, 4, 2); x.fill(); } }
    if (snow) { x.fillStyle = 'rgba(240,248,255,0.9)'; for (let i = 0; i < 3; i++) { blob(x, rnd, -18 + rnd() * 36, -6 - rnd() * 6, 4, 1.5); x.fill(); } }
    shadow = 0;
  } else if (kind === 'candelabra') {
    // a standing iron candelabra with lit candles
    const iron = '#2a2630', ironL = '#5a5460', H2 = 58 + rnd() * 6;
    for (const sd of [-1, 0, 1]) seg(x, [[0, -10], [sd * 9, 2]], 2.6, iron);
    x.beginPath(); x.ellipse(0, -10, 4, 2, 0, 0, U.TAU); x.fillStyle = ironL; x.fill();
    seg(x, [[0, -10], [0, -H2]], 3, iron); seg(x, [[-0.8, -12], [-0.8, -H2 + 2]], 0.9, ironL);
    for (let i = 0; i < 3; i++) circle(x, 0, -18 - i * 14, 2.2, ironL, ink, 0.8);
    const cands: Pt[] = [[0, -H2 - 2]];
    for (const sd of [-1, 1]) { x.strokeStyle = iron; x.lineWidth = 2.4; x.beginPath(); x.moveTo(0, -H2 + 12); x.quadraticCurveTo(sd * 15, -H2 + 14, sd * 15, -H2 + 2); x.stroke(); cands.push([sd * 15, -H2 + 1]); if (v % 2) { x.beginPath(); x.moveTo(0, -H2 + 22); x.quadraticCurveTo(sd * 9, -H2 + 23, sd * 8, -H2 + 13); x.stroke(); cands.push([sd * 8, -H2 + 12]); } }
    for (const [cx, cy] of cands) {
      x.fillStyle = ironL; x.beginPath(); x.ellipse(cx, cy, 3.6, 1.4, 0, 0, U.TAU); x.fill();
      const ch = 6 + rnd() * 5; x.fillStyle = vgrad(x, cy - ch, cy, '#f4ead0', 0.05, -0.2); x.fillRect(cx - 1.8, cy - ch, 3.6, ch); x.strokeStyle = ink; x.lineWidth = 0.7; x.strokeRect(cx - 1.8, cy - ch, 3.6, ch);
      x.fillStyle = '#f8f0dc'; x.beginPath(); x.ellipse(cx + 1.6, cy - ch + 2.5, 0.8, 1.8, 0, 0, U.TAU); x.fill();
      post.push((p) => { p.globalCompositeOperation = 'lighter'; p.drawImage(glow('#ffb347', 9), cx - 9, cy - ch - 4 - 9, 18, 18); p.globalCompositeOperation = 'source-over'; p.beginPath(); p.moveTo(cx, cy - ch - 6.5); p.quadraticCurveTo(cx + 2.2, cy - ch - 2, cx, cy - ch); p.quadraticCurveTo(cx - 2.2, cy - ch - 2, cx, cy - ch - 6.5); p.fillStyle = '#ffcf6a'; p.fill(); p.beginPath(); p.ellipse(cx, cy - ch - 1.8, 0.8, 1.6, 0, 0, U.TAU); p.fillStyle = '#fffbe8'; p.fill(); });
    }
    shadow = 12;
  } else if (kind === 'pew') {
    // a broken church bench
    const pw = 52, wd = U.mix('#4a2a1e', dark, 0.3), wdL = U.shade(wd, 0.12), brk = v % 2 ? 1 : -1;
    for (const lx of [-pw / 2 + 4, pw / 2 - 4]) { x.fillStyle = U.shade(wd, -0.15); x.fillRect(lx - 2, -12, 4, 13); x.strokeStyle = ink; x.lineWidth = 1; x.strokeRect(lx - 2, -12, 4, 13); }
    x.save(); x.translate(0, 0); x.rotate(brk * 0.06);
    // backrest (behind)
    x.beginPath(); x.moveTo(-pw / 2, -14); x.lineTo(-pw / 2, -30); x.lineTo(brk > 0 ? pw / 2 - 12 : pw / 2, -30); x.lineTo(brk > 0 ? pw / 2 - 6 : pw / 2, brk > 0 ? -24 : -30); x.lineTo(brk > 0 ? pw / 2 - 10 : pw / 2, -20); x.lineTo(pw / 2, -14); x.closePath();
    x.fillStyle = vgrad(x, -30, -14, wd, 0.1, -0.2); x.fill(); x.strokeStyle = ink; x.lineWidth = 1.2; x.stroke();
    x.strokeStyle = 'rgba(0,0,0,0.3)'; x.lineWidth = 0.8; for (let i = 1; i < 3; i++) { x.beginPath(); x.moveTo(-pw / 2, -30 + i * 5.3); x.lineTo(pw / 2 - (brk > 0 ? 10 : 0), -30 + i * 5.3); x.stroke(); }
    x.fillStyle = wdL; x.fillRect(-pw / 2 - 1, -32, pw * 0.55, 2.4);
    // seat
    x.beginPath(); x.moveTo(-pw / 2 - 1, -14); x.lineTo(pw / 2 + 1, -14); x.lineTo(pw / 2 - 1, -9); x.lineTo(-pw / 2 + 1, -9); x.closePath(); x.fillStyle = vgrad(x, -14, -9, wdL, 0.15, -0.15); x.fill(); x.strokeStyle = ink; x.lineWidth = 1.1; x.stroke();
    x.fillStyle = 'rgba(255,255,255,0.12)'; x.fillRect(-pw / 2, -13.6, pw, 1);
    // end panels
    for (const ex of [-pw / 2 - 1, pw / 2 - 2]) { x.fillStyle = vgrad(x, -34, 0, U.shade(wd, -0.08), 0.12, -0.2); x.beginPath(); x.moveTo(ex, 1); x.lineTo(ex, -30); x.quadraticCurveTo(ex + 1.5, -35, ex + 3, -30); x.lineTo(ex + 3, 1); x.closePath(); x.fill(); x.strokeStyle = ink; x.lineWidth = 1; x.stroke(); }
    x.restore();
    for (let i = 0; i < 4; i++) { const sx = brk * (pw / 2 + 2 + rnd() * 10), sy = rnd() * 3; x.save(); x.translate(sx, sy); x.rotate((rnd() - 0.5) * 1.5); x.fillStyle = wdL; x.fillRect(-4, -0.8, 8, 1.6); x.restore(); }
    cap(() => { x.beginPath(); x.moveTo(-pw / 2, -14.5); x.lineTo(pw / 2 * 0.6, -14.5); x.lineTo(pw / 2 * 0.6, -12.5); x.lineTo(-pw / 2, -12.5); x.closePath(); });
    shadow = 30;
  } else if (kind === 'obelisk') {
    // a void obelisk with glowing runes
    const h = 86 + rnd() * 10, rc = cry;
    x.fillStyle = vgrad(x, -8, 2, stoneD, 0.1, -0.2); x.beginPath(); x.moveTo(-17, 2); x.lineTo(-14, -7); x.lineTo(14, -7); x.lineTo(17, 2); x.closePath(); x.fill(); x.strokeStyle = ink; x.lineWidth = 1.2; x.stroke();
    x.beginPath(); x.moveTo(-10, -7); x.lineTo(-7, -h + 10); x.lineTo(0, -h); x.lineTo(7, -h + 10); x.lineTo(10, -7); x.closePath();
    const og = x.createLinearGradient(-10, 0, 10, 0); og.addColorStop(0, U.shade(dark, 0.06)); og.addColorStop(0.45, U.shade(dark, 0.18)); og.addColorStop(0.5, U.shade(dark, -0.02)); og.addColorStop(1, U.shade(dark, -0.12)); x.fillStyle = og; x.fill(); x.stroke();
    x.strokeStyle = 'rgba(255,255,255,0.15)'; x.lineWidth = 1; x.beginPath(); x.moveTo(-0.5, -h + 1); x.lineTo(-0.5, -8); x.stroke();
    const runes: Pt[] = []; for (let i = 0; i < 6; i++) runes.push([(i % 2 ? 3 : -4), -16 - i * ((h - 30) / 6)]);
    post.push((p) => {
      p.globalCompositeOperation = 'lighter'; p.globalAlpha = 0.4; p.drawImage(glow(rc, 24), -24, -h * 0.55 - 24, 48, 48); p.globalAlpha = 1;
      p.strokeStyle = rc; p.lineWidth = 1.3; p.lineCap = 'round'; p.shadowColor = rc; p.shadowBlur = 5;
      for (const [rx, ry] of runes) { p.beginPath(); p.moveTo(rx - 1.8, ry - 2.5); p.lineTo(rx + 1.8, ry - 2.5); p.moveTo(rx, ry - 2.5); p.lineTo(rx, ry + 2.5); p.moveTo(rx - 1.5, ry + 1); p.lineTo(rx + 1.5, ry - 0.5); p.stroke(); }
      p.shadowBlur = 0; p.globalCompositeOperation = 'source-over';
      poly(p, [[0, -h - 14], [3, -h - 9], [0, -h - 4], [-3, -h - 9]], rgrad(p, 0, -h - 9, 5, [[0, '#fff'], [0.5, rc], [1, U.shade(rc, -0.3)]]));
      p.globalCompositeOperation = 'lighter'; p.drawImage(glow(rc, 9), -9, -h - 18, 18, 18);
    });
    shadow = 18;
  } else if (kind === 'floatrock') {
    // a rock shard floating above a pool of light
    const fy = -30 - rnd() * 8, rw = 14 + rnd() * 5;
    post.push((p) => { p.globalCompositeOperation = 'lighter'; p.globalAlpha = 0.7; p.save(); p.scale(1, 0.4); p.drawImage(glow(cry, 22), -22, -22, 44, 44); p.restore(); p.globalAlpha = 0.35; p.drawImage(glow(cry, 18), -18, fy + 6 - 18, 36, 36); p.globalAlpha = 1; });
    const pts: Pt[] = [[-rw, fy - 4], [-rw * 0.55, fy - 13], [rw * 0.3, fy - 15], [rw, fy - 6], [rw * 0.6, fy + 4], [rw * 0.1, fy + 16], [-rw * 0.4, fy + 6]];
    poly(x, pts, rgrad(x, -4, fy - 8, rw * 1.3, [[0, U.shade(light, 0.1)], [0.6, light], [1, dark]]), ink, 1.4);
    poly(x, [pts[0], pts[1], pts[2], [rw * 0.1, fy - 4]], 'rgba(255,255,255,0.14)');
    poly(x, [[rw * 0.1, fy - 4], pts[3], pts[4], pts[5]], 'rgba(0,0,0,0.25)');
    x.strokeStyle = U.rgba(cry, 0.9); x.lineWidth = 1.2; x.beginPath(); x.moveTo(-rw * 0.6, fy - 6); x.lineTo(-rw * 0.1, fy - 2); x.lineTo(rw * 0.3, fy + 6); x.moveTo(-rw * 0.1, fy - 2); x.lineTo(rw * 0.4, fy - 9); x.stroke();
    for (let i = 0; i < 3; i++) { const a = rnd() * U.TAU, d = rw + 6 + rnd() * 6, sx = Math.cos(a) * d, sy = fy + Math.sin(a) * d * 0.4; poly(x, [[sx - 2.5, sy], [sx, sy - 3.5], [sx + 2.5, sy], [sx, sy + 3]], U.shade(light, -0.05), ink, 0.8); }
    post.push((p) => { p.globalCompositeOperation = 'lighter'; p.globalAlpha = 0.8; p.drawImage(glow(cry, 6), -rw * 0.1 - 6, fy - 2 - 6, 12, 12); p.globalAlpha = 1; });
    shadow = 14;
  }
  // outline, then a soft contact shadow underneath and the emissive passes on top
  const out = outlined(c0, 2, 'rgba(0,0,0,0.45)'), o = ctx2d(out);
  o.save(); o.scale(RES, RES); o.translate(W / 2, OY);
  if (shadow > 0) { o.globalCompositeOperation = 'destination-over'; const g = o.createRadialGradient(0, 0, 1, 0, 0, shadow); g.addColorStop(0, 'rgba(0,0,0,0.42)'); g.addColorStop(1, 'rgba(0,0,0,0)'); o.fillStyle = g; o.save(); o.scale(1, 0.32); o.beginPath(); o.arc(0, 2, shadow, 0, U.TAU); o.fill(); o.restore(); o.globalCompositeOperation = 'source-over'; }
  for (const fn of post) { o.save(); fn(o); o.restore(); }
  o.restore();
  const sp = withOrigin(out, W / 2, OY, RES); cache.set(key, sp); return sp;
}

/* ---------- shrines ---------- */
const SHRINE_GLYPH: Record<string, string> = { blood: 'drop', fortune: 'chest', trial: 'spiral', haste: 'boot', life: 'heart', curse: 'skull' };
/** A stone shrine: stepped plinth, obelisk and the kind's glyph glowing on its face. Pivot at the base. */
function shrine(kind: string, color: string): Sprite {
  const key = 'shrine|' + kind + '|' + color;
  const hit = cached<Sprite>(key); if (hit) return hit;
  const W = 96, H = 120, [c0, x] = mkRes(W, H);
  x.translate(W / 2, H - 16);
  x.lineJoin = 'round';
  // plinth
  x.fillStyle = '#26222e'; x.beginPath(); x.ellipse(0, 4, 40, 13, 0, 0, U.TAU); x.fill();
  x.fillStyle = '#3a3546'; x.beginPath(); x.ellipse(0, 0, 36, 11, 0, 0, U.TAU); x.fill();
  x.fillStyle = '#4a4458'; x.beginPath(); x.ellipse(0, -5, 26, 8, 0, 0, U.TAU); x.fill();
  // obelisk
  const g = x.createLinearGradient(-14, 0, 14, 0); g.addColorStop(0, '#2b2734'); g.addColorStop(0.45, '#5b546a'); g.addColorStop(1, '#221f2a');
  poly(x, [[-14, -6], [-10, -70], [0, -82], [10, -70], [14, -6]], g, 'rgba(0,0,0,0.7)', 1.5);
  // runes etched down the stone
  x.strokeStyle = U.rgba(color, 0.55); x.lineWidth = 1.2; x.shadowColor = color; x.shadowBlur = 6;
  for (let i = 0; i < 3; i++) { const y = -18 - i * 9; x.beginPath(); x.moveTo(-5, y); x.lineTo(0, y - 4); x.lineTo(5, y); x.stroke(); }
  x.shadowBlur = 0;
  // the glyph, set into the obelisk's face
  x.save(); x.translate(0, -56); x.scale(0.42, 0.42);
  x.globalAlpha = 0.8; x.drawImage(glow(color, 40), -40, -40); x.globalAlpha = 1;
  (GLYPH[SHRINE_GLYPH[kind] || 'star'] || GLYPH.star)(x, color);
  x.restore();
  const sp = withOrigin(outlined(c0, 2), W / 2, H - 16, RES);
  cache.set(key, sp);
  return sp;
}

/* ---------- ground ---------- */
/**
 * A seamless, low-contrast ground texture with no landmarks: multi-scale soft blotches on jittered grids
 * (even coverage, nothing clumps into a shape you can spot repeating), fine grain and evenly spread micro-cracks,
 * plus per-stage flavour. Landmarks (rune circles, lava cracks, puddles...) come from `groundDetail` decals.
 */
function groundTile(pal: GroundPalette, size = 512): HTMLCanvasElement {
  const key = 'ground|' + pal.id + '|' + size + '|' + (pal.tiles || 0);
  const hit = cached<HTMLCanvasElement>(key); if (hit) return hit;
  const c = mk(size, size), x = ctx2d(c);
  const rnd = U.mulberry32((pal.seed || 1) * 31 + 7), id = pal.id;
  x.fillStyle = pal.ground; x.fillRect(0, 0, size, size);
  /** Call fn at every wrapped copy of (px, py) that overlaps the tile. */
  const wrap = (px: number, py: number, rad: number, fn: (qx: number, qy: number) => void) => {
    for (let ox = -size; ox <= size; ox += size) for (let oy = -size; oy <= size; oy += size) { const qx = px + ox, qy = py + oy; if (qx + rad > 0 && qx - rad < size && qy + rad > 0 && qy - rad < size) fn(qx, qy); }
  };
  const soft = (px: number, py: number, rad: number, color: string, a: number, sy = 1) => wrap(px, py, rad, (qx, qy) => { const g = x.createRadialGradient(qx, qy, 0, qx, qy, rad); g.addColorStop(0, U.rgba(color, a)); g.addColorStop(0.6, U.rgba(color, a * 0.45)); g.addColorStop(1, U.rgba(color, 0)); x.fillStyle = g; x.save(); x.translate(qx, qy); x.scale(1, sy); x.translate(-qx, -qy); x.fillRect(qx - rad, qy - rad, rad * 2, rad * 2); x.restore(); });
  /** Jittered-grid scatter: one sample per cell, so coverage is even. */
  const scatter = (cell: number, fn: (px: number, py: number) => void) => { const n = Math.max(1, Math.round(size / cell)), cs = size / n; for (let gy = 0; gy < n; gy++) for (let gx = 0; gx < n; gx++) fn((gx + rnd()) * cs, (gy + rnd()) * cs); };
  const tones: Record<string, [string, string][]> = {
    ashen: [[pal.groundDark, '#6a605a'], ['#120c0c', '#7a706a']],
    frost: [[pal.groundDark, '#88aecb'], ['#1a3048', '#b4cfe6']],
    cathedral: [[pal.groundDark, pal.groundLight], ['#140608', '#7a4048']],
    blight: [[pal.groundDark, '#4a6a3a'], ['#0a120a', '#5a7a32']],
    void: [[pal.groundDark, pal.groundLight], ['#06030e', '#5a40a0']],
  };
  const [[d1, l1], [d2, l2]] = tones[id] || [[pal.groundDark, pal.groundLight], [pal.groundDark, pal.groundLight]];
  // flagstones first (cathedral / void), so the noise below ages them
  if (pal.tiles) {
    const n = Math.max(2, Math.round(size / pal.tiles)), ts = size / n, rows = n % 2 ? n + 1 : n, th = size / rows;
    for (let ty = 0; ty < rows; ty++) for (let tx = 0; tx < n; tx++) {
      const off = (ty % 2) * ts / 2, px = tx * ts + off, py = ty * th, tone = (rnd() - 0.5) * 2;
      const fill = tone > 0 ? U.rgba(pal.groundLight, 0.05 + tone * 0.12) : U.rgba(pal.groundDark, 0.08 - tone * 0.22);
      const crack = rnd() < 0.3, c1 = rnd(), c2 = rnd() - 0.5, c3 = rnd() - 0.5, chip = rnd() < 0.25, cx0 = rnd() < 0.5 ? 3 : ts - 9, cy0 = rnd() < 0.5 ? 3 : th - 8;
      for (const qx of px + ts > size ? [px, px - size] : [px]) {
        x.fillStyle = fill; x.fillRect(qx + 1.5, py + 1.5, ts - 3, th - 3);
        x.fillStyle = U.rgba(pal.groundLight, 0.1); x.fillRect(qx + 2, py + 2, ts - 4, 1.2); x.fillRect(qx + 2, py + 2, 1.2, th - 4);
        x.fillStyle = U.rgba(pal.groundDark, 0.28); x.fillRect(qx + 2, py + th - 3.2, ts - 4, 1.2); x.fillRect(qx + ts - 3.2, py + 2, 1.2, th - 4);
        if (crack) { x.strokeStyle = U.rgba(pal.groundDark, 0.35); x.lineWidth = 0.8; x.beginPath(); const sx = qx + 4 + c1 * (ts - 8), sy = py + 3; x.moveTo(sx, sy); x.lineTo(sx + c2 * ts * 0.4, sy + th * 0.4); x.lineTo(sx + c3 * ts * 0.5, py + th - 3); x.stroke(); }
        if (chip) { x.fillStyle = U.rgba(pal.groundDark, 0.35); const cx = qx + cx0, cy = py + cy0; x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + 6, cy + 1); x.lineTo(cx + 2, cy + 5); x.closePath(); x.fill(); }
      }
    }
    // grout lines (low alpha so the grid doesn't scream)
    x.strokeStyle = U.rgba(pal.groundDark, 0.42); x.lineWidth = 2;
    for (let ty = 0; ty < rows; ty++) { x.beginPath(); x.moveTo(0, ty * th); x.lineTo(size, ty * th); x.stroke(); const off = (ty % 2) * ts / 2; for (let tx = 0; tx <= n; tx++) { const gx = (tx * ts + off) % size; x.beginPath(); x.moveTo(gx, ty * th); x.lineTo(gx, ty * th + th); x.stroke(); } }
  }
  // multi-scale soft blotches
  const scales: [number, number, number, number][] = [[128, 90, 150, 0.2], [64, 40, 70, 0.17], [32, 16, 30, 0.14], [16, 6, 12, 0.11]];
  const am = id === 'frost' ? 0.7 : 1;
  for (const [cell, r0, r1, a] of scales) scatter(cell, (px, py) => { const k = rnd(), dark = k < 0.5, deep = rnd() < 0.3; soft(px, py, r0 + rnd() * (r1 - r0), dark ? (deep ? d2 : d1) : (deep ? l2 : l1), am * a * (0.45 + rnd() * 0.55), 0.75 + rnd() * 0.5); });
  // per-stage flavour
  if (id === 'ashen') {
    scatter(48, (px, py) => { if (rnd() < 0.5) soft(px, py, 10 + rnd() * 16, '#0a0606', 0.22); });
    for (let i = 0; i < 900; i++) { const px = rnd() * size, py = rnd() * size; x.fillStyle = U.rgba(rnd() < 0.7 ? '#9a928c' : '#c8c0b8', 0.12 + rnd() * 0.15); x.fillRect(px, py, 1 + rnd() * 1.5, 1); }
    for (let i = 0; i < 50; i++) { const px = rnd() * size, py = rnd() * size; x.fillStyle = U.rgba('#ff8a3c', 0.18 + rnd() * 0.2); x.fillRect(px, py, 1, 1); }
  } else if (id === 'frost') {
    scatter(40, (px, py) => soft(px, py, 12 + rnd() * 20, rnd() < 0.6 ? '#e8f4ff' : '#5aa8d8', 0.06, 0.4 + rnd() * 0.3));
    for (let i = 0; i < 260; i++) { const px = rnd() * size, py = rnd() * size; x.fillStyle = U.rgba('#ffffff', 0.25 + rnd() * 0.45); x.fillRect(px, py, 1, 1); }
  } else if (id === 'blight') {
    scatter(36, (px, py) => { if (rnd() < 0.55) soft(px, py, 8 + rnd() * 16, rnd() < 0.5 ? '#5f8a3a' : '#2e4a24', 0.2); else soft(px, py, 5 + rnd() * 8, '#060a06', 0.28); });
    x.lineWidth = 0.9; x.lineCap = 'round';
    for (let i = 0; i < 420; i++) { const px = rnd() * size, py = rnd() * size, l = 2 + rnd() * 3.5, a = -Math.PI / 2 + (rnd() - 0.5) * 0.9; x.strokeStyle = U.rgba(rnd() < 0.5 ? '#6a9a44' : '#3e5e2c', 0.3 + rnd() * 0.25); wrap(px, py, 6, (qx, qy) => { x.beginPath(); x.moveTo(qx, qy); x.lineTo(qx + Math.cos(a) * l, qy + Math.sin(a) * l); x.stroke(); }); }
  } else if (id === 'void') {
    // crystalline facets and star specks
    scatter(44, (px, py) => wrap(px, py, 16, (qx, qy) => { const n = 3 + Math.floor(rnd() * 2), r = 6 + rnd() * 9, a0 = rnd() * U.TAU; x.beginPath(); for (let i = 0; i < n; i++) { const a = a0 + i / n * U.TAU, rr = r * (0.6 + rnd() * 0.5); x.lineTo(qx + Math.cos(a) * rr, qy + Math.sin(a) * rr); } x.closePath(); x.fillStyle = U.rgba(pal.groundLight, 0.05 + rnd() * 0.05); x.fill(); x.strokeStyle = U.rgba('#b89cff', 0.08 + rnd() * 0.06); x.lineWidth = 0.8; x.stroke(); }));
    for (let i = 0; i < 220; i++) { const px = rnd() * size, py = rnd() * size, b = rnd(); x.fillStyle = U.rgba(b < 0.8 ? '#cbb8ff' : '#ffffff', 0.18 + b * 0.5); x.fillRect(px, py, b > 0.93 ? 2 : 1, b > 0.93 ? 2 : 1); }
  } else if (id === 'cathedral') {
    scatter(80, (px, py) => { if (rnd() < 0.35) soft(px, py, 14 + rnd() * 22, '#5a0a14', 0.16); });
  }
  // fine grain
  for (let i = 0; i < 5200; i++) { const px = rnd() * size, py = rnd() * size; x.fillStyle = rnd() < 0.55 ? U.rgba(pal.groundDark, 0.14 + rnd() * 0.1) : U.rgba(pal.groundLight, 0.06 + rnd() * 0.08); x.fillRect(px, py, 1 + Math.floor(rnd() * 2), 1 + Math.floor(rnd() * 2)); }
  // subtle micro-cracks, evenly distributed
  x.lineCap = 'round'; x.lineJoin = 'round';
  scatter(id === 'frost' ? 60 : 44, (px, py) => {
    if (rnd() < 0.25) return;
    const segs = 2 + Math.floor(rnd() * 3), a0 = rnd() * U.TAU, pts: Pt[] = [[px, py]]; let qa = a0, qx = px, qy = py;
    for (let s = 0; s < segs; s++) { qa += (rnd() - 0.5) * 1.3; qx += Math.cos(qa) * (3 + rnd() * 6); qy += Math.sin(qa) * (3 + rnd() * 6); pts.push([qx, qy]); }
    const a = 0.16 + rnd() * 0.14;
    wrap(px, py, 30, (wx, wy) => { const dx = wx - px, dy = wy - py; x.strokeStyle = U.rgba(pal.groundDark, a); x.lineWidth = 0.9; x.beginPath(); x.moveTo(pts[0][0] + dx, pts[0][1] + dy); for (let i = 1; i < pts.length; i++) x.lineTo(pts[i][0] + dx, pts[i][1] + dy); x.stroke(); x.strokeStyle = U.rgba(pal.groundLight, a * 0.4); x.lineWidth = 0.6; x.beginPath(); x.moveTo(pts[0][0] + dx + 0.7, pts[0][1] + dy + 0.7); for (let i = 1; i < pts.length; i++) x.lineTo(pts[i][0] + dx + 0.7, pts[i][1] + dy + 0.7); x.stroke(); });
  });
  cache.set(key, c); return c;
}
/** The palette fields a ground decal reads (a StagePalette works). */
export type DetailPalette = Pick<StagePalette, 'ground' | 'groundDark' | 'groundLight'> & { id?: string; rune?: string; crystal?: string };
/** Which decal kinds suit each stage: `decals` blend into the ground, `glow` are emissive (they look best lit/pulsing). */
export const GROUND_DETAILS: Record<string, { decals: string[]; glow: string[] }> = {
  ashen: { decals: ['cracks', 'ash', 'pebbles', 'bloodpool', 'roots', 'runestone', 'grass'], glow: ['lavacrack', 'runecircle'] },
  frost: { decals: ['snow', 'ice', 'pebbles', 'cracks', 'runestone', 'grass'], glow: ['runecircle'] },
  cathedral: { decals: ['bloodpool', 'cracks', 'pebbles', 'puddle', 'runestone', 'ash'], glow: ['runecircle'] },
  blight: { decals: ['moss', 'puddle', 'grass', 'roots', 'pebbles', 'cracks'], glow: ['toxic', 'runecircle'] },
  void: { decals: ['cracks', 'pebbles', 'runestone', 'ash'], glow: ['voidcrack', 'runecircle'] },
};
const DETAIL_SIZE: Record<string, [number, number]> = { cracks: [76, 52], pebbles: [48, 32], moss: [68, 46], puddle: [70, 44], grass: [30, 26], runestone: [48, 36], runecircle: [192, 192], lavacrack: [100, 60], ice: [88, 58], voidcrack: [100, 60], bloodpool: [70, 46], ash: [80, 50], roots: [80, 50], snow: [84, 52], toxic: [70, 46] };
/** A ground decal (pivot at its centre, semi-transparent) for the renderer to scatter per world chunk. */
function groundDetail(kind: string, seed: number, pal: DetailPalette): Sprite {
  const v = ((Math.floor(seed) % PROP_VARIANTS) + PROP_VARIANTS) % PROP_VARIANTS;
  const key = 'gd|' + kind + '|' + v + '|' + (pal.id || '') + '|' + pal.ground + '|' + (pal.rune || '');
  const hit = cached<Sprite>(key); if (hit) return hit;
  const [W, H] = DETAIL_SIZE[kind] || [64, 44], rnd = U.mulberry32(v * 4271 + kind.length * 97 + 5);
  const [c, x] = mkRes(W, H); x.translate(W / 2, H / 2); x.lineCap = 'round'; x.lineJoin = 'round';
  const gd = pal.groundDark, gl = pal.groundLight, rw = W / 2 - 4, rh = H / 2 - 4, id = pal.id || '';
  /** A wandering crack from the centre outward; returns its points. */
  const crackPath = (x0: number, y0: number, a: number, len: number, segs: number): Pt[] => { const pts: Pt[] = [[x0, y0]]; let qx = x0, qy = y0, qa = a; for (let i = 0; i < segs; i++) { qa += (rnd() - 0.5) * 0.9; qx = U.clamp(qx + Math.cos(qa) * len / segs, -rw * 0.8, rw * 0.8); qy = U.clamp(qy + Math.sin(qa) * len / segs * 0.7, -rh * 0.62, rh * 0.62); if (Math.abs(qy) > rh * 0.6) qa = -qa; pts.push([qx, qy]); } return pts; };
  const strokePts = (pts: readonly Pt[], w: number, color: string) => { x.strokeStyle = color; x.lineWidth = w; x.beginPath(); x.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) x.lineTo(pts[i][0], pts[i][1]); x.stroke(); };
  const fissure = (core: string, hot: string, edge: string) => {
    const a = rnd() * 0.6 - 0.3, main = crackPath(-rw * 0.78, (rnd() - 0.5) * rh * 0.4, a, rw * 1.6, 7), side: Pt[][] = [];
    for (let i = 0; i < 3; i++) { const p = main[1 + Math.floor(rnd() * 5)]; side.push(crackPath(p[0], p[1], a + (rnd() < 0.5 ? -1 : 1) * (0.8 + rnd() * 0.6), rw * 0.5, 3)); }
    x.fillStyle = U.rgba(edge, 0.55); for (const p of main) { blob(x, rnd, p[0], p[1], 7, 5); x.fill(); }
    for (const pts of [main, ...side]) strokePts(pts, pts === main ? 5 : 3, U.rgba(edge, 0.9));
    x.save(); x.globalCompositeOperation = 'lighter';
    for (const p of main) x.drawImage(glow(core, 10), p[0] - 10, p[1] - 10, 20, 20);
    for (const pts of [main, ...side]) { strokePts(pts, pts === main ? 3 : 1.8, core); strokePts(pts, pts === main ? 1.2 : 0.7, hot); }
    x.restore();
  };
  if (kind === 'cracks') {
    const n = 3 + (v % 3);
    for (let i = 0; i < n; i++) { const pts = crackPath(0, 0, i / n * U.TAU + rnd() * 0.5, rw * (0.6 + rnd() * 0.45), 4 + Math.floor(rnd() * 3)); strokePts(pts, 1.8, U.rgba(gd, 0.75)); x.save(); x.translate(0.8, 0.8); strokePts(pts, 0.7, U.rgba(gl, 0.3)); x.restore(); if (rnd() < 0.6) { const p = pts[2]; strokePts(crackPath(p[0], p[1], rnd() * U.TAU, rw * 0.3, 2), 1, U.rgba(gd, 0.6)); } }
    x.fillStyle = U.rgba(gd, 0.4); blob(x, rnd, 0, 0, 5, 3.5); x.fill();
  } else if (kind === 'pebbles') {
    const n = 5 + (v % 4), stone = U.mix(gl, '#8a8478', 0.35);
    for (let i = 0; i < n; i++) { const px = (rnd() - 0.5) * rw * 1.7, py = (rnd() - 0.5) * rh * 1.5, r = 1.6 + rnd() * 3.2; x.fillStyle = 'rgba(0,0,0,0.3)'; x.beginPath(); x.ellipse(px + 0.8, py + r * 0.5, r * 1.1, r * 0.55, 0, 0, U.TAU); x.fill(); x.beginPath(); x.ellipse(px, py, r * 1.15, r * 0.85, rnd() * 3, 0, U.TAU); x.fillStyle = rgrad(x, px, py, r * 1.2, [[0, U.shade(stone, 0.2 + rnd() * 0.1)], [1, U.shade(stone, -0.3)]]); x.fill(); x.strokeStyle = 'rgba(0,0,0,0.4)'; x.lineWidth = 0.6; x.stroke(); }
  } else if (kind === 'moss') {
    for (let i = 0; i < 7; i++) { const px = (rnd() - 0.5) * rw * 1.3, py = (rnd() - 0.5) * rh * 1.1, r = 6 + rnd() * 9; blob(x, rnd, px, py, r, r * 0.7); x.fillStyle = U.rgba(rnd() < 0.5 ? '#4c7a34' : '#3a5e2a', 0.35 + rnd() * 0.2); x.fill(); }
    for (let i = 0; i < 40; i++) { const px = (rnd() - 0.5) * rw * 1.6, py = (rnd() - 0.5) * rh * 1.4; x.fillStyle = U.rgba(rnd() < 0.5 ? '#8ac05a' : '#2a4020', 0.5); x.fillRect(px, py, 1.2, 1.2); }
  } else if (kind === 'puddle') {
    x.fillStyle = U.rgba(gd, 0.5); blob(x, rnd, 0, 0, rw, rh, 11, 0.2); x.fill();
    blob(x, rnd, 0, 0, rw * 0.82, rh * 0.75, 10, 0.18); const g = x.createLinearGradient(0, -rh, 0, rh); g.addColorStop(0, 'rgba(60,70,90,0.75)'); g.addColorStop(1, 'rgba(12,14,22,0.85)'); x.fillStyle = g; x.fill();
    x.strokeStyle = 'rgba(200,220,255,0.35)'; x.lineWidth = 1.4; x.beginPath(); x.moveTo(-rw * 0.45, -rh * 0.3); x.quadraticCurveTo(-rw * 0.1, -rh * 0.5, rw * 0.3, -rh * 0.35); x.stroke();
    x.strokeStyle = 'rgba(200,220,255,0.18)'; x.lineWidth = 0.8; x.beginPath(); x.ellipse(rw * 0.15, rh * 0.15, rw * 0.2, rh * 0.15, 0, 0, U.TAU); x.stroke();
  } else if (kind === 'grass') {
    const gc = id === 'blight' ? ['#5f8a3a', '#3e6a2a', '#8ab85a'] : id === 'frost' ? ['#7a9aa8', '#a8c8d4', '#dceef6'] : id === 'ashen' ? ['#6a5a40', '#4a3e2c', '#8a7a5a'] : ['#5a6a3a', '#3a4a2a', '#7a8a4a'];
    x.fillStyle = 'rgba(0,0,0,0.25)'; x.beginPath(); x.ellipse(0, rh * 0.6, rw * 0.7, 2.5, 0, 0, U.TAU); x.fill();
    for (let i = 0; i < 14; i++) { const bx = (rnd() - 0.5) * rw * 1.2, l = rh * (0.9 + rnd() * 0.9), a = (bx / rw) * 0.7 + (rnd() - 0.5) * 0.5; taper(x, [bx, rh * 0.6], [bx + Math.sin(a) * l * 0.3, rh * 0.6 - l * 0.5], [bx + Math.sin(a) * l * 0.7, rh * 0.6 - l * 0.85], [bx + Math.sin(a) * l, rh * 0.6 - l], 1.6, 0.3, gc[i % 3], 5); }
  } else if (kind === 'runestone') {
    const stone = U.mix(gl, '#7a7468', 0.4), pts: Pt[] = [];
    for (let i = 0; i < 7; i++) { const a = i / 7 * U.TAU, k = 0.8 + rnd() * 0.2; pts.push([Math.cos(a) * rw * k, Math.sin(a) * rh * k]); }
    x.save(); x.translate(1, 2); poly(x, pts, 'rgba(0,0,0,0.35)'); x.restore();
    poly(x, pts, rgrad(x, -rw * 0.2, -rh * 0.3, rw, [[0, U.shade(stone, 0.12)], [1, U.shade(stone, -0.25)]]), 'rgba(0,0,0,0.5)', 1);
    poly(x, pts.map(([px, py]) => [px * 0.86, py * 0.82 - 1] as Pt), null, 'rgba(255,255,255,0.12)', 0.8);
    const rc = pal.rune || gl; x.strokeStyle = U.rgba(rc, 0.55); x.lineWidth = 1.2; x.shadowColor = rc; x.shadowBlur = 3;
    x.beginPath(); x.moveTo(0, -rh * 0.55); x.lineTo(0, rh * 0.55); x.moveTo(0, -rh * 0.2); x.lineTo(rw * 0.35, -rh * 0.45); x.moveTo(0, rh * 0.05); x.lineTo(-rw * 0.35, rh * 0.35); x.moveTo(-rw * 0.4, -rh * 0.3); x.lineTo(-rw * 0.2, -rh * 0.1); x.stroke(); x.shadowBlur = 0;
    x.fillStyle = 'rgba(80,110,60,0.35)'; blob(x, rnd, rw * 0.5, rh * 0.3, 5, 3); x.fill();
  } else if (kind === 'runecircle') {
    const rc = pal.rune || gl, R = 90;
    x.strokeStyle = U.rgba(rc, 0.34); x.fillStyle = U.rgba(rc, 0.34); x.shadowColor = rc; x.shadowBlur = 4;
    x.lineWidth = 2.2; x.beginPath(); x.arc(0, 0, R, 0, U.TAU); x.stroke();
    x.lineWidth = 1.2; x.beginPath(); x.arc(0, 0, R - 7, 0, U.TAU); x.stroke(); x.beginPath(); x.arc(0, 0, R * 0.62, 0, U.TAU); x.stroke();
    x.lineWidth = 1.6; x.beginPath(); x.arc(0, 0, R * 0.56, 0, U.TAU); x.stroke();
    // runes between the outer rings
    x.lineWidth = 1.3; const nr = 16 + (v % 3) * 2;
    for (let i = 0; i < nr; i++) { const a = i / nr * U.TAU, cx = Math.cos(a) * (R - 14), cy = Math.sin(a) * (R - 14); x.save(); x.translate(cx, cy); x.rotate(a + Math.PI / 2); const k = Math.floor(rnd() * 4); x.beginPath(); if (k === 0) { x.moveTo(0, -4); x.lineTo(0, 4); x.moveTo(0, -1); x.lineTo(3, -4); } else if (k === 1) { x.moveTo(-3, -4); x.lineTo(0, 4); x.lineTo(3, -4); } else if (k === 2) { x.moveTo(-3, 0); x.lineTo(3, 0); x.moveTo(0, -4); x.lineTo(0, 4); x.moveTo(-2, 3); x.lineTo(2, 3); } else { x.arc(0, 0, 3, 0, U.TAU); x.moveTo(0, -4); x.lineTo(0, 4); } x.stroke(); x.restore(); }
    // star / sigil
    const pts = v % 2 ? 6 : 5, step = 2; x.lineWidth = 1.4; x.beginPath();
    for (let i = 0; i <= pts; i++) { const a = -Math.PI / 2 + (i * step % pts) / pts * U.TAU; const px = Math.cos(a) * R * 0.56, py = Math.sin(a) * R * 0.56; if (i === 0) x.moveTo(px, py); else x.lineTo(px, py); }
    if (pts === 6) { x.closePath(); x.stroke(); x.beginPath(); for (let i = 0; i <= 3; i++) { const a = -Math.PI / 2 + Math.PI / 3 + (i * 2 % 6) / 6 * U.TAU; const px = Math.cos(a) * R * 0.56, py = Math.sin(a) * R * 0.56; if (i === 0) x.moveTo(px, py); else x.lineTo(px, py); } }
    x.stroke();
    for (let i = 0; i < pts; i++) { const a = -Math.PI / 2 + i / pts * U.TAU; x.beginPath(); x.arc(Math.cos(a) * R * 0.56, Math.sin(a) * R * 0.56, 4, 0, U.TAU); x.stroke(); }
    x.beginPath(); x.arc(0, 0, R * 0.18, 0, U.TAU); x.stroke(); circle(x, 0, 0, 3, U.rgba(rc, 0.5));
    x.shadowBlur = 0;
  } else if (kind === 'lavacrack') {
    fissure('#ff7a1c', '#fff2a0', '#1a0a04');
  } else if (kind === 'voidcrack') {
    fissure('#b45cff', '#f4e0ff', '#06020c');
    x.save(); x.globalCompositeOperation = 'lighter'; for (let i = 0; i < 8; i++) { const px = (rnd() - 0.5) * rw * 1.8, py = (rnd() - 0.5) * rh * 1.4; x.fillStyle = 'rgba(230,200,255,0.9)'; x.fillRect(px, py, 1.2, 1.2); } x.restore();
  } else if (kind === 'ice') {
    blob(x, rnd, 0, 0, rw, rh, 8, 0.22); const g = x.createLinearGradient(-rw, -rh, rw, rh); g.addColorStop(0, 'rgba(210,240,255,0.6)'); g.addColorStop(0.5, 'rgba(130,190,230,0.45)'); g.addColorStop(1, 'rgba(70,120,170,0.5)'); x.fillStyle = g; x.fill(); x.strokeStyle = 'rgba(230,248,255,0.55)'; x.lineWidth = 1; x.stroke();
    x.save(); blob(x, rnd, 0, 0, rw, rh, 8, 0.0); x.clip();
    x.fillStyle = 'rgba(255,255,255,0.45)'; x.beginPath(); x.moveTo(-rw * 0.7, -rh * 0.1); x.lineTo(-rw * 0.45, -rh * 0.6); x.lineTo(-rw * 0.3, -rh * 0.6); x.lineTo(-rw * 0.55, -rh * 0.1); x.closePath(); x.fill();
    x.fillStyle = 'rgba(255,255,255,0.25)'; x.beginPath(); x.moveTo(-rw * 0.2, rh * 0.3); x.lineTo(rw * 0.05, -rh * 0.3); x.lineTo(rw * 0.12, -rh * 0.3); x.lineTo(-rw * 0.12, rh * 0.3); x.closePath(); x.fill();
    x.restore();
    for (let i = 0; i < 3; i++) strokePts(crackPath((rnd() - 0.5) * rw, (rnd() - 0.5) * rh, rnd() * U.TAU, rw * 0.6, 3), 0.7, 'rgba(255,255,255,0.6)');
  } else if (kind === 'bloodpool') {
    blob(x, rnd, 0, 0, rw * 0.85, rh * 0.8, 10, 0.25); x.fillStyle = 'rgba(70,6,12,0.55)'; x.fill();
    blob(x, rnd, rw * 0.05, 0, rw * 0.55, rh * 0.5, 9, 0.2); x.fillStyle = 'rgba(40,2,6,0.55)'; x.fill();
    x.fillStyle = 'rgba(255,160,160,0.15)'; x.beginPath(); x.ellipse(-rw * 0.2, -rh * 0.2, rw * 0.2, rh * 0.08, -0.3, 0, U.TAU); x.fill();
    for (let i = 0; i < 9; i++) { const a = rnd() * U.TAU, d = 0.85 + rnd() * 0.25; circle(x, Math.cos(a) * rw * d, Math.sin(a) * rh * d, 0.8 + rnd() * 1.8, 'rgba(70,6,12,0.55)'); }
  } else if (kind === 'ash') {
    for (let i = 0; i < 8; i++) { const px = (rnd() - 0.5) * rw * 1.3, py = (rnd() - 0.5) * rh * 1.0, r = 7 + rnd() * 10; blob(x, rnd, px, py, r, r * 0.6); x.fillStyle = U.rgba(rnd() < 0.6 ? '#8a8682' : '#b0aca6', 0.18 + rnd() * 0.12); x.fill(); }
    for (let i = 0; i < 30; i++) { const px = (rnd() - 0.5) * rw * 1.6, py = (rnd() - 0.5) * rh * 1.3; x.fillStyle = U.rgba(rnd() < 0.6 ? '#141010' : '#d8d4ce', 0.5); x.fillRect(px, py, 1 + rnd(), 1); }
  } else if (kind === 'roots') {
    const rc = U.mix('#3a2a1c', gd, 0.3);
    for (let i = 0; i < 4; i++) { const a = rnd() * U.TAU, l = rw * (0.6 + rnd() * 0.4), ex = Math.cos(a) * l, ey = Math.sin(a) * l * 0.6, mx = ex * 0.5 + (rnd() - 0.5) * 14, my = ey * 0.5 + (rnd() - 0.5) * 8; taper(x, [0, 0], [mx, my], [ex * 0.8, ey * 0.8], [ex, ey], 5, 0.8, 'rgba(0,0,0,0.4)', 8); taper(x, [0, 0], [mx, my], [ex * 0.8, ey * 0.8], [ex, ey], 3.6, 0.5, U.rgba(rc, 0.85), 8); taper(x, [-0.6, -0.8], [mx - 0.6, my - 0.8], [ex * 0.8 - 0.5, ey * 0.8 - 0.6], [ex, ey], 1, 0.2, 'rgba(255,255,255,0.12)', 8); }
    x.fillStyle = U.rgba(rc, 0.9); blob(x, rnd, 0, 0, 6, 4); x.fill();
  } else if (kind === 'snow') {
    for (let i = 0; i < 6; i++) { const px = (rnd() - 0.5) * rw * 1.2, py = (rnd() - 0.5) * rh * 0.9, r = 9 + rnd() * 11; blob(x, rnd, px, py + 1.5, r, r * 0.55); x.fillStyle = 'rgba(80,130,180,0.18)'; x.fill(); blob(x, rnd, px, py, r, r * 0.55); x.fillStyle = 'rgba(236,246,255,' + (0.45 + rnd() * 0.2).toFixed(2) + ')'; x.fill(); }
    for (let i = 0; i < 14; i++) { const px = (rnd() - 0.5) * rw * 1.5, py = (rnd() - 0.5) * rh * 1.2; x.fillStyle = 'rgba(255,255,255,0.9)'; x.fillRect(px, py, 1, 1); }
  } else if (kind === 'toxic') {
    const tc = pal.crystal || '#9dff5c';
    x.fillStyle = 'rgba(10,20,6,0.5)'; blob(x, rnd, 0, 0, rw, rh, 10, 0.22); x.fill();
    blob(x, rnd, 0, 0, rw * 0.8, rh * 0.75, 10, 0.2); x.fillStyle = rgrad(x, 0, 0, rw * 0.9, [[0, U.rgba(U.shade(tc, 0.3), 0.9)], [0.6, U.rgba(tc, 0.7)], [1, U.rgba(U.shade(tc, -0.4), 0.6)]]); x.fill();
    x.save(); x.globalCompositeOperation = 'lighter'; x.globalAlpha = 0.5; x.drawImage(glow(tc, rw), -rw, -rw, rw * 2, rw * 2); x.restore();
    for (let i = 0; i < 6; i++) { const px = (rnd() - 0.5) * rw * 1.1, py = (rnd() - 0.5) * rh * 0.9, r = 1.2 + rnd() * 2.2; circle(x, px, py, r, null, 'rgba(240,255,200,0.75)', 0.7); circle(x, px - r * 0.3, py - r * 0.3, r * 0.3, 'rgba(255,255,255,0.8)'); }
  }
  const sp = withOrigin(c, W / 2, H / 2, RES); cache.set(key, sp); return sp;
}

/* ---------- icons (for UI) ---------- */
const GLYPH: Record<string, (x: Ctx, c: string) => void> = {
  sword(x: Ctx, _c: string) { poly(x, [[0, -22], [5, -4], [5, 6], [-5, 6], [-5, -4]], '#e8ecf4', '#223'); x.fillStyle = '#c9a227'; x.fillRect(-11, 5, 22, 4); x.fillStyle = '#5a3a1a'; x.fillRect(-2.5, 8, 5, 12); circle(x, 0, 21, 3, '#c9a227'); },
  dagger(x: Ctx, _c: string) { x.save(); x.rotate(-0.6); poly(x, [[0, -20], [4, -2], [-4, -2]], '#e8ecf4', '#223'); x.fillStyle = '#c9a227'; x.fillRect(-7, -2, 14, 3); x.fillStyle = '#333'; x.fillRect(-2, 1, 4, 10); x.restore(); x.save(); x.rotate(0.6); poly(x, [[0, -20], [4, -2], [-4, -2]], '#e8ecf4', '#223'); x.fillStyle = '#c9a227'; x.fillRect(-7, -2, 14, 3); x.fillStyle = '#333'; x.fillRect(-2, 1, 4, 10); x.restore(); },
  axe(x: Ctx, _c: string) { x.fillStyle = '#6b4a2a'; x.save(); x.rotate(0.5); x.fillRect(-2.5, -6, 5, 28); x.restore(); x.save(); x.rotate(0.5); poly(x, [[-2, -18], [-16, -10], [-16, 4], [-2, 8]], '#dfe6ee', '#223'); x.restore(); },
  bow(x: Ctx, _c: string) { x.strokeStyle = '#8a5a2a'; x.lineWidth = 3.5; x.beginPath(); x.arc(-6, 0, 18, -1.25, 1.25); x.stroke(); x.strokeStyle = '#eee'; x.lineWidth = 1.2; x.beginPath(); x.moveTo(-0.5, -17); x.lineTo(-0.5, 17); x.stroke(); x.strokeStyle = '#dfe6ee'; x.lineWidth = 2; x.beginPath(); x.moveTo(-14, 0); x.lineTo(14, 0); x.stroke(); poly(x, [[18, 0], [11, -4], [11, 4]], '#dfe6ee'); },
  bolt(x: Ctx, _c: string) { poly(x, [[4, -22], [-10, 2], [-1, 2], [-5, 22], [11, -4], [2, -4]], '#fff1a8', '#a07000'); },
  flame(x: Ctx, _c: string) { x.shadowColor = '#ff8a3c'; x.shadowBlur = 8; x.beginPath(); x.moveTo(0, 20); x.quadraticCurveTo(-18, 10, -10, -6); x.quadraticCurveTo(-6, 0, -3, -4); x.quadraticCurveTo(-2, -16, 4, -22); x.quadraticCurveTo(4, -10, 10, -6); x.quadraticCurveTo(18, 8, 0, 20); const g = x.createLinearGradient(0, 20, 0, -22); g.addColorStop(0, '#ff3a1a'); g.addColorStop(0.5, '#ff9a2c'); g.addColorStop(1, '#fff2a0'); x.fillStyle = g; x.fill(); x.shadowBlur = 0; x.beginPath(); x.moveTo(0, 14); x.quadraticCurveTo(-7, 6, -2, -2); x.quadraticCurveTo(2, 4, 3, -4); x.quadraticCurveTo(8, 6, 0, 14); x.fillStyle = '#fff6c0'; x.fill(); },
  snowflake(x: Ctx, _c: string) { x.strokeStyle = '#dff6ff'; x.lineWidth = 3; x.lineCap = 'round'; for (let i = 0; i < 3; i++) { x.save(); x.rotate(i * Math.PI / 3); x.beginPath(); x.moveTo(0, -20); x.lineTo(0, 20); x.moveTo(0, -12); x.lineTo(-5, -17); x.moveTo(0, -12); x.lineTo(5, -17); x.moveTo(0, 12); x.lineTo(-5, 17); x.moveTo(0, 12); x.lineTo(5, 17); x.stroke(); x.restore(); } },
  orb(x: Ctx, c: string) { circle(x, 0, 0, 16, rgrad(x, 0, 0, 16, [[0, '#fff'], [0.4, c], [1, U.shade(c, -0.5)]]), 'rgba(255,255,255,0.3)'); },
  ring(x: Ctx, c: string) { x.strokeStyle = c; x.lineWidth = 6; x.beginPath(); x.arc(0, 0, 15, 0, U.TAU); x.stroke(); x.strokeStyle = '#fff'; x.lineWidth = 1.5; x.beginPath(); x.arc(0, 0, 15, 0, U.TAU); x.stroke(); for (let i = 0; i < 3; i++) circle(x, Math.cos(i * 2.1) * 15, Math.sin(i * 2.1) * 15, 4, '#fff'); },
  skull(x: Ctx, _c: string) { circle(x, 0, -4, 15, rgrad(x, 0, -4, 15, [[0, '#fff'], [1, '#bdb5a8']]), '#333'); x.fillStyle = '#e8e0d0'; x.fillRect(-9, 6, 18, 10); x.fillStyle = '#222'; circle(x, -6, -5, 4.5, '#222'); circle(x, 6, -5, 4.5, '#222'); poly(x, [[0, 0], [-3, 5], [3, 5]], '#222'); for (let i = 0; i < 4; i++) x.fillRect(-7 + i * 4, 9, 2, 6); },
  shield(x: Ctx, c: string) { x.beginPath(); x.moveTo(0, -20); x.lineTo(17, -13); x.quadraticCurveTo(17, 10, 0, 21); x.quadraticCurveTo(-17, 10, -17, -13); x.closePath(); x.fillStyle = rgrad(x, 0, 0, 20, [[0, U.shade(c, 0.3)], [1, U.shade(c, -0.3)]]); x.fill(); x.strokeStyle = '#fff8'; x.lineWidth = 2; x.stroke(); x.strokeStyle = '#fff'; x.lineWidth = 2.5; x.beginPath(); x.moveTo(0, -12); x.lineTo(0, 12); x.moveTo(-9, -3); x.lineTo(9, -3); x.stroke(); },
  heart(x: Ctx, c: string) { x.beginPath(); x.moveTo(0, 18); x.bezierCurveTo(-24, 0, -14, -20, 0, -8); x.bezierCurveTo(14, -20, 24, 0, 0, 18); x.fillStyle = rgrad(x, 0, 0, 18, [[0, U.shade(c, 0.3)], [1, U.shade(c, -0.3)]]); x.fill(); x.strokeStyle = '#fff6'; x.lineWidth = 1.5; x.stroke(); },
  boot(x: Ctx, c: string) { poly(x, [[-10, -20], [4, -20], [4, 4], [16, 8], [16, 16], [-10, 16]], rgrad(x, 0, 0, 20, [[0, U.shade(c, 0.3)], [1, U.shade(c, -0.3)]]), '#fff6'); x.fillStyle = '#fff8'; x.fillRect(-10, -4, 14, 3); x.fillRect(-10, 2, 14, 3); },
  gem(x: Ctx, c: string) { poly(x, [[0, -20], [16, -6], [10, 18], [-10, 18], [-16, -6]], rgrad(x, 0, 0, 20, [[0, '#fff'], [0.4, c], [1, U.shade(c, -0.4)]]), '#fff8'); x.strokeStyle = '#fff6'; x.lineWidth = 1; x.beginPath(); x.moveTo(-16, -6); x.lineTo(16, -6); x.moveTo(0, -20); x.lineTo(-6, -6); x.lineTo(-10, 18); x.moveTo(0, -20); x.lineTo(6, -6); x.lineTo(10, 18); x.stroke(); },
  clock(x: Ctx, c: string) { circle(x, 0, 0, 18, rgrad(x, 0, 0, 18, [[0, '#fff'], [1, c]]), '#333', 2.5); x.strokeStyle = '#222'; x.lineWidth = 2.5; x.lineCap = 'round'; x.beginPath(); x.moveTo(0, 0); x.lineTo(0, -11); x.moveTo(0, 0); x.lineTo(7, 4); x.stroke(); for (let i = 0; i < 12; i++) { x.beginPath(); x.moveTo(Math.cos(i * Math.PI / 6) * 14, Math.sin(i * Math.PI / 6) * 14); x.lineTo(Math.cos(i * Math.PI / 6) * 16, Math.sin(i * Math.PI / 6) * 16); x.stroke(); } },
  star(x: Ctx, c: string) { x.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 8 : 20, a = -Math.PI / 2 + i * Math.PI / 5; x.lineTo(Math.cos(a) * r, Math.sin(a) * r); } x.closePath(); x.fillStyle = rgrad(x, 0, 0, 20, [[0, '#fff'], [0.5, c], [1, U.shade(c, -0.3)]]); x.fill(); x.strokeStyle = '#fff8'; x.lineWidth = 1.5; x.stroke(); },
  eye(x: Ctx, c: string) { x.beginPath(); x.moveTo(-20, 0); x.quadraticCurveTo(0, -18, 20, 0); x.quadraticCurveTo(0, 18, -20, 0); x.fillStyle = '#f4f0e8'; x.fill(); x.strokeStyle = '#333'; x.lineWidth = 2; x.stroke(); circle(x, 0, 0, 8, rgrad(x, 0, 0, 8, [[0, U.shade(c, 0.4)], [1, U.shade(c, -0.3)]])); circle(x, 0, 0, 3.5, '#000'); circle(x, -2.5, -2.5, 1.5, '#fff'); },
  arrow(x: Ctx, c: string) { x.strokeStyle = '#c9b07a'; x.lineWidth = 3; x.beginPath(); x.moveTo(-16, 16); x.lineTo(12, -12); x.stroke(); poly(x, [[18, -18], [4, -14], [14, -4]], c || '#dfe6ee', '#223'); poly(x, [[-16, 16], [-10, 8], [-8, 10]], '#eee'); poly(x, [[-16, 16], [-8, 10], [-10, 16]], '#eee'); },
  drop(x: Ctx, c: string) { x.beginPath(); x.moveTo(0, -20); x.quadraticCurveTo(16, 4, 0, 18); x.quadraticCurveTo(-16, 4, 0, -20); x.fillStyle = rgrad(x, 0, 2, 18, [[0, U.shade(c, 0.4)], [1, U.shade(c, -0.3)]]); x.fill(); x.strokeStyle = '#fff6'; x.lineWidth = 1.5; x.stroke(); circle(x, -5, 2, 3, '#fff8'); },
  moon(x: Ctx, c: string) { x.beginPath(); x.arc(0, 0, 18, 0, U.TAU); x.fillStyle = c; x.fill(); x.beginPath(); x.arc(7, -4, 15, 0, U.TAU); x.fillStyle = 'rgba(0,0,0,0.75)'; x.fill(); },
  sun(x: Ctx, c: string) { x.strokeStyle = c; x.lineWidth = 3; x.lineCap = 'round'; for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; x.beginPath(); x.moveTo(Math.cos(a) * 13, Math.sin(a) * 13); x.lineTo(Math.cos(a) * 21, Math.sin(a) * 21); x.stroke(); } circle(x, 0, 0, 10, rgrad(x, 0, 0, 10, [[0, '#fff'], [1, c]])); },
  spiral(x: Ctx, c: string) { x.strokeStyle = c; x.lineWidth = 4; x.lineCap = 'round'; x.beginPath(); for (let i = 0; i < 60; i++) { const a = i * 0.25, r = i * 0.33; x.lineTo(Math.cos(a) * r, Math.sin(a) * r); } x.stroke(); },
  hammer(x: Ctx, c: string) { x.fillStyle = '#6b4a2a'; x.save(); x.rotate(0.6); x.fillRect(-3, -4, 6, 26); x.fillStyle = c || '#9aa2ad'; x.fillRect(-14, -16, 28, 14); x.strokeStyle = '#223'; x.strokeRect(-14, -16, 28, 14); x.restore(); },
  feather(x: Ctx, c: string) { x.save(); x.rotate(-0.6); x.beginPath(); x.moveTo(0, -22); x.quadraticCurveTo(14, -6, 0, 20); x.quadraticCurveTo(-14, -6, 0, -22); x.fillStyle = rgrad(x, 0, 0, 20, [[0, '#fff'], [1, c]]); x.fill(); x.strokeStyle = '#fff8'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(0, -20); x.lineTo(0, 22); x.stroke(); x.restore(); },
  crown(x: Ctx, c: string) { poly(x, [[-18, 12], [-18, -8], [-8, 0], [0, -16], [8, 0], [18, -8], [18, 12]], rgrad(x, 0, 0, 20, [[0, U.shade(c, 0.4)], [1, U.shade(c, -0.3)]]), '#fff6'); circle(x, -8, 6, 2.5, '#f44'); circle(x, 0, 6, 2.5, '#4af'); circle(x, 8, 6, 2.5, '#4f4'); },
  clover(x: Ctx, c: string) { for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; circle(x, Math.cos(a) * 9, Math.sin(a) * 9 - 2, 8, rgrad(x, Math.cos(a) * 9, Math.sin(a) * 9 - 2, 8, [[0, U.shade(c, 0.3)], [1, U.shade(c, -0.3)]])); } x.strokeStyle = U.shade(c, -0.4); x.lineWidth = 2.5; x.beginPath(); x.moveTo(0, 4); x.quadraticCurveTo(4, 14, 8, 20); x.stroke(); },
  magnet(x: Ctx, c: string) { x.strokeStyle = c || '#d33'; x.lineWidth = 8; x.beginPath(); x.arc(0, -2, 12, Math.PI, 0); x.stroke(); x.beginPath(); x.moveTo(-12, -2); x.lineTo(-12, 12); x.moveTo(12, -2); x.lineTo(12, 12); x.stroke(); x.strokeStyle = '#eee'; x.beginPath(); x.moveTo(-12, 6); x.lineTo(-12, 13); x.moveTo(12, 6); x.lineTo(12, 13); x.stroke(); },
  hourglass(x: Ctx, c: string) { poly(x, [[-12, -18], [12, -18], [2, 0], [12, 18], [-12, 18], [-2, 0]], 'rgba(255,255,255,0.15)', '#fff8', 2); poly(x, [[-8, -15], [8, -15], [0, -2]], c); poly(x, [[-9, 16], [9, 16], [0, 8]], c); x.fillStyle = '#8a6a3a'; x.fillRect(-14, -21, 28, 4); x.fillRect(-14, 17, 28, 4); },
  fang(x: Ctx, c: string) { poly(x, [[-14, -14], [-4, 16], [2, -6]], '#f4f0e8', '#333'); poly(x, [[14, -14], [4, 18], [-2, -6]], '#f4f0e8', '#333'); circle(x, -6, 12, 3, c); circle(x, 4, 14, 3, c); },
  mirror(x: Ctx, c: string) { x.beginPath(); x.ellipse(0, -2, 13, 17, 0, 0, U.TAU); x.fillStyle = rgrad(x, 0, -2, 16, [[0, '#fff'], [0.6, c], [1, U.shade(c, -0.4)]]); x.fill(); x.strokeStyle = '#c9a227'; x.lineWidth = 3; x.stroke(); x.fillStyle = '#c9a227'; x.fillRect(-2, 15, 4, 8); },
  turret(x: Ctx, c: string) { x.fillStyle = '#556'; x.fillRect(-14, 6, 28, 8); poly(x, [[-16, 14], [16, 14], [12, 20], [-12, 20]], '#334'); circle(x, 0, 0, 10, rgrad(x, 0, 0, 10, [[0, '#99a'], [1, '#445']]), '#223'); x.fillStyle = c; x.fillRect(4, -3, 18, 6); x.fillStyle = '#fff'; circle(x, 0, 0, 3, '#fff'); },
  wing(x: Ctx, c: string) { x.beginPath(); x.moveTo(-18, 6); x.quadraticCurveTo(-10, -22, 18, -14); x.quadraticCurveTo(6, -8, 12, 0); x.quadraticCurveTo(0, -2, 4, 8); x.quadraticCurveTo(-8, 4, -18, 6); x.fillStyle = rgrad(x, 0, -6, 20, [[0, '#fff'], [1, c]]); x.fill(); x.strokeStyle = '#fff8'; x.lineWidth = 1.5; x.stroke(); },
  fist(x: Ctx, c: string) { x.beginPath(); x.roundRect(-14, -8, 28, 24, 6); x.fillStyle = rgrad(x, 0, 4, 20, [[0, U.shade(c, 0.3)], [1, U.shade(c, -0.3)]]); x.fill(); x.strokeStyle = '#333'; x.lineWidth = 1.5; x.stroke(); for (let i = 0; i < 4; i++) { x.beginPath(); x.roundRect(-13 + i * 7, -14, 6, 10, 3); x.fill(); x.stroke(); } },
  scythe(x: Ctx, c: string) { x.strokeStyle = '#3a2a3a'; x.lineWidth = 3.5; x.beginPath(); x.moveTo(6, 22); x.lineTo(-2, -16); x.stroke(); x.strokeStyle = c; x.lineWidth = 5; x.beginPath(); x.arc(4, -6, 14, -2.6, -0.4); x.stroke(); x.strokeStyle = '#fff'; x.lineWidth = 1.5; x.beginPath(); x.arc(4, -6, 15.5, -2.6, -0.4); x.stroke(); },
  leaf(x: Ctx, c: string) { x.beginPath(); x.moveTo(0, -20); x.quadraticCurveTo(20, -6, 0, 20); x.quadraticCurveTo(-20, -6, 0, -20); x.fillStyle = rgrad(x, 0, 0, 20, [[0, U.shade(c, 0.4)], [1, U.shade(c, -0.3)]]); x.fill(); x.strokeStyle = '#fff6'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(0, -18); x.lineTo(0, 18); x.stroke(); },
  book(x: Ctx, c: string) { x.fillStyle = U.shade(c, -0.2); x.fillRect(-16, -18, 32, 36); x.fillStyle = c; x.fillRect(-13, -18, 29, 36); x.fillStyle = '#c9a227'; x.fillRect(-13, -12, 29, 2); x.fillRect(-13, 10, 29, 2); GLYPH.star(x, '#fff2a0'); },
  cross(x: Ctx, c: string) { x.fillStyle = rgrad(x, 0, 0, 20, [[0, '#fff'], [1, c]]); x.fillRect(-5, -20, 10, 40); x.fillRect(-16, -6, 32, 12); x.strokeStyle = '#fff8'; x.lineWidth = 1.5; x.strokeRect(-5, -20, 10, 40); },
  mine(x: Ctx, c: string) { circle(x, 0, 0, 14, rgrad(x, 0, 0, 14, [[0, '#777'], [1, '#222']]), '#000'); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; x.strokeStyle = '#999'; x.lineWidth = 3; x.beginPath(); x.moveTo(Math.cos(a) * 12, Math.sin(a) * 12); x.lineTo(Math.cos(a) * 19, Math.sin(a) * 19); x.stroke(); } x.shadowColor = c; x.shadowBlur = 10; circle(x, 0, 0, 5, c); x.shadowBlur = 0; },
  beam(x: Ctx, c: string) { x.shadowColor = c; x.shadowBlur = 10; x.strokeStyle = c; x.lineWidth = 6; x.lineCap = 'round'; x.beginPath(); x.moveTo(-18, 18); x.lineTo(18, -18); x.stroke(); x.strokeStyle = '#fff'; x.lineWidth = 2; x.stroke(); x.shadowBlur = 0; circle(x, -18, 18, 5, '#fff'); },
  whip(x: Ctx, c: string) { x.strokeStyle = c; x.lineWidth = 4; x.lineCap = 'round'; x.beginPath(); x.moveTo(-18, 16); x.quadraticCurveTo(-10, -20, 4, -6); x.quadraticCurveTo(14, 4, 20, -14); x.stroke(); x.fillStyle = '#5a3a1a'; x.save(); x.translate(-18, 16); x.rotate(-0.8); x.fillRect(-3, -2, 6, 12); x.restore(); },
  wave(x: Ctx, c: string) { x.strokeStyle = c; x.lineWidth = 4; x.lineCap = 'round'; for (let j = -1; j <= 1; j++) { x.beginPath(); x.moveTo(-18, j * 10); x.quadraticCurveTo(-9, j * 10 - 10, 0, j * 10); x.quadraticCurveTo(9, j * 10 + 10, 18, j * 10); x.stroke(); } },
  tornado(x: Ctx, c: string) { x.strokeStyle = c; x.lineWidth = 3.5; x.lineCap = 'round'; for (let i = 0; i < 6; i++) { const w = 18 - i * 2.6, y = -18 + i * 7; x.beginPath(); x.ellipse(0 + (i % 2 ? 2 : -2), y, w, 3, 0, 0, U.TAU); x.stroke(); } },
  meteor(x: Ctx, c: string) { x.shadowColor = c; x.shadowBlur = 8; x.strokeStyle = c; x.lineWidth = 8; x.lineCap = 'round'; x.beginPath(); x.moveTo(16, -16); x.lineTo(-4, 4); x.stroke(); x.shadowBlur = 0; circle(x, -6, 6, 11, rgrad(x, -6, 6, 11, [[0, '#fff'], [0.5, c], [1, '#4a2a1a']]), '#000'); },
  shard(x: Ctx, c: string) { for (let i = 0; i < 3; i++) { x.save(); x.rotate(i * 2.1); poly(x, [[0, -20], [6, -4], [0, 4], [-6, -4]], rgrad(x, 0, -8, 12, [[0, '#fff'], [1, c]]), '#fff8'); x.restore(); } },
  coin(x: Ctx, _c: string) { circle(x, 0, 0, 17, rgrad(x, 0, 0, 17, [[0, '#fff3b0'], [0.5, '#f5c542'], [1, '#a5741a']]), '#6a4a10', 2); x.fillStyle = '#a5741a'; x.font = 'bold 22px serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('$', 0, 1); },
  cog(x: Ctx, c: string) { x.beginPath(); for (let i = 0; i < 16; i++) { const r = i % 2 ? 13 : 19, a = i * Math.PI / 8; x.lineTo(Math.cos(a) * r, Math.sin(a) * r); } x.closePath(); x.fillStyle = rgrad(x, 0, 0, 19, [[0, U.shade(c, 0.3)], [1, U.shade(c, -0.3)]]); x.fill(); x.strokeStyle = '#223'; x.lineWidth = 1.5; x.stroke(); circle(x, 0, 0, 6, '#111'); },
  hawk(x: Ctx, c: string) { x.beginPath(); x.moveTo(0, 6); x.quadraticCurveTo(-14, -14, -24, -4); x.quadraticCurveTo(-10, -4, -2, 2); x.quadraticCurveTo(10, -4, 24, -4); x.quadraticCurveTo(14, -14, 0, 6); x.fillStyle = rgrad(x, 0, -4, 24, [[0, U.shade(c, 0.3)], [1, U.shade(c, -0.3)]]); x.fill(); circle(x, 0, -1, 5, c, '#223'); circle(x, 2, -2, 1.5, '#fff'); poly(x, [[4, 0], [10, 1], [4, 3]], '#f5c542'); },
  ghost(x: Ctx, c: string) { x.beginPath(); x.moveTo(-14, 16); x.lineTo(-14, -2); x.arc(0, -2, 14, Math.PI, 0); x.lineTo(14, 16); x.lineTo(9, 10); x.lineTo(4, 16); x.lineTo(0, 10); x.lineTo(-4, 16); x.lineTo(-9, 10); x.closePath(); x.fillStyle = rgrad(x, 0, 0, 16, [[0, '#fff'], [1, c]]); x.fill(); circle(x, -5, -4, 3, '#223'); circle(x, 5, -4, 3, '#223'); },
  blackhole(x: Ctx, c: string) { circle(x, 0, 0, 18, rgrad(x, 0, 0, 18, [[0, '#000'], [0.5, '#000'], [0.75, c], [1, 'rgba(0,0,0,0)']])); x.strokeStyle = '#fff8'; x.lineWidth = 1.5; x.beginPath(); x.ellipse(0, 0, 21, 7, -0.5, 0, U.TAU); x.stroke(); },
  halo(x: Ctx, c: string) { x.strokeStyle = c; x.lineWidth = 5; x.beginPath(); x.ellipse(0, -8, 18, 6, 0, 0, U.TAU); x.stroke(); x.strokeStyle = '#fff'; x.lineWidth = 1.5; x.stroke(); GLYPH.wing(x, c); },
  anvil(x: Ctx, c: string) { poly(x, [[-20, -8], [20, -8], [20, -2], [8, 2], [8, 10], [14, 14], [14, 18], [-14, 18], [-14, 14], [-8, 10], [-8, 2], [-20, -2]], rgrad(x, 0, 4, 20, [[0, '#889'], [1, '#334']]), '#112'); x.shadowColor = c; x.shadowBlur = 8; x.fillStyle = c; x.fillRect(-16, -11, 32, 3); x.shadowBlur = 0; },
  chest(x: Ctx, c: string) { x.fillStyle = '#6b3a1a'; x.fillRect(-18, -4, 36, 20); x.strokeStyle = '#2a1a0a'; x.lineWidth = 1.5; x.strokeRect(-18, -4, 36, 20); x.fillStyle = '#8a5a2a'; x.beginPath(); x.moveTo(-18, -4); x.quadraticCurveTo(0, -22, 18, -4); x.closePath(); x.fill(); x.stroke(); x.fillStyle = c; x.fillRect(-18, -5, 36, 3); x.fillRect(-4, -4, 8, 10); circle(x, 0, 1, 2, '#222'); },
  lock(x: Ctx, c: string) { x.strokeStyle = c; x.lineWidth = 5; x.beginPath(); x.arc(0, -6, 10, Math.PI, 0); x.stroke(); x.beginPath(); x.roundRect(-15, -6, 30, 24, 4); x.fillStyle = c; x.fill(); circle(x, 0, 5, 3.5, '#222'); x.fillStyle = '#222'; x.fillRect(-1.5, 5, 3, 7); },
  rune(x: Ctx, c: string) { x.strokeStyle = c; x.lineWidth = 3.5; x.lineCap = 'round'; x.shadowColor = c; x.shadowBlur = 8; x.beginPath(); x.moveTo(0, -20); x.lineTo(0, 20); x.moveTo(0, -12); x.lineTo(12, -2); x.moveTo(0, 0); x.lineTo(-12, 10); x.moveTo(-10, -14); x.lineTo(10, 16); x.stroke(); x.shadowBlur = 0; },
  minion(x: Ctx, c: string) { GLYPH.skull(x, c); x.strokeStyle = c; x.lineWidth = 2; x.shadowColor = c; x.shadowBlur = 8; x.beginPath(); x.arc(0, 0, 21, 0, U.TAU); x.stroke(); x.shadowBlur = 0; },
  hand(x: Ctx, c: string) { x.beginPath(); x.roundRect(-10, -4, 20, 22, 5); x.fillStyle = c; x.fill(); for (let i = 0; i < 4; i++) { x.beginPath(); x.roundRect(-11 + i * 6, -22 + Math.abs(i - 1.5) * 3, 5, 22, 2.5); x.fill(); } x.beginPath(); x.roundRect(-18, -2, 8, 14, 3); x.fill(); x.strokeStyle = '#223'; x.lineWidth = 1; x.stroke(); },
  lightningball(x: Ctx, c: string) { circle(x, 0, 0, 12, rgrad(x, 0, 0, 12, [[0, '#fff'], [0.5, c], [1, U.shade(c, -0.4)]])); x.strokeStyle = '#fff'; x.lineWidth = 2; x.shadowColor = c; x.shadowBlur = 8; for (let i = 0; i < 5; i++) { const a = i * 1.26; x.beginPath(); x.moveTo(Math.cos(a) * 12, Math.sin(a) * 12); x.lineTo(Math.cos(a + 0.3) * 18, Math.sin(a + 0.3) * 18); x.lineTo(Math.cos(a) * 22, Math.sin(a) * 22); x.stroke(); } x.shadowBlur = 0; },
  laser(x: Ctx, c: string) { GLYPH.beam(x, c); circle(x, 0, -14, 4, '#fff'); },
  hex(x: Ctx, c: string) { x.beginPath(); for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; x.lineTo(Math.cos(a) * 18, Math.sin(a) * 18); } x.closePath(); x.fillStyle = rgrad(x, 0, 0, 18, [[0, U.shade(c, 0.3)], [1, U.shade(c, -0.4)]]); x.fill(); x.strokeStyle = '#fff8'; x.lineWidth = 2; x.stroke(); circle(x, 0, 0, 6, '#fff'); },
  bat(x: Ctx, c: string) { x.save(); x.scale(1.2, 1.2); ENEMY_DRAW.bat(x, 8, { body: c, eye: '#fff' }, 0); x.restore(); },
};
function icon(specIn?: IconArt | null, size = 64): HTMLCanvasElement {
  const spec: IconArt = specIn || { g: 'star', c: '#fff' };
  const key = 'icon|' + spec.g + '|' + spec.c + '|' + (spec.bg || '') + '|' + size;
  const hit = cached<HTMLCanvasElement>(key); if (hit) return hit;
  const c = mk(size, size), x = ctx2d(c);
  const s = size / 64;
  x.scale(s, s);
  // background: dark rounded square with color gradient rim
  const bg = spec.bg || spec.c;
  const g = x.createLinearGradient(0, 0, 64, 64); g.addColorStop(0, U.shade(bg, -0.55)); g.addColorStop(1, U.shade(bg, -0.85));
  x.beginPath(); x.roundRect(2, 2, 60, 60, 12); x.fillStyle = g; x.fill();
  x.strokeStyle = U.rgba(bg, 0.7); x.lineWidth = 2; x.stroke();
  x.globalAlpha = 0.35; x.drawImage(glow(bg, 30), 2, 2); x.globalAlpha = 1;
  x.translate(32, 32);
  x.lineJoin = 'round';
  (GLYPH[spec.g] || GLYPH.star)(x, spec.c);
  cache.set(key, c);
  return c;
}
function iconURL(spec: IconArt, size = 64): string {
  const key = 'iconurl|' + JSON.stringify(spec) + '|' + size;
  const hit = cached<string>(key); if (hit) return hit;
  const url = icon(spec, size).toDataURL();
  cache.set(key, url); return url;
}
function portraitURL(def: CharacterArt, size = 144): string {
  const key = 'portrait|' + def.id + '|' + size;
  const hit = cached<string>(key); if (hit) return hit;
  const c = mk(size, size), x = ctx2d(c);
  const g = x.createRadialGradient(size / 2, size * 0.55, 4, size / 2, size / 2, size * 0.7);
  g.addColorStop(0, U.shade(def.colors.accent, -0.3)); g.addColorStop(1, '#0a0a12');
  x.fillStyle = g; x.fillRect(0, 0, size, size);
  x.drawImage(character(def, Math.round(size * 0.8)), size * 0.1, size * 0.08);
  const url = c.toDataURL();
  cache.set(key, url); return url;
}

const S = {
  cache, mk, helpers,
  glow, light, orb, bolt, character, hero, heroCast, enemy, burrowMound, flash, tint,
  gem, coin, coinFrame, pickup, chestOpen, prop, propLight, shrine, groundTile, groundDetail, icon, iconURL, portraitURL,
  ENEMY_FRAMES, HERO_FRAMES, PROP_LIGHTS, GROUND_DETAILS,
};
export const Sprites = S;
export { enemy, hero, heroCast, burrowMound, coinFrame, chestOpen, groundDetail, propLight };
