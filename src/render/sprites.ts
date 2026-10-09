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
/**
 * A champion, drawn in a 72-unit box (feet at y≈66). `size` is the canvas size in pixels; `step`
 * picks a walk-cycle pose (0 standing, 1/2 alternate strides).
 */
function character(def: CharacterArt, size = 72, step = 0): HTMLCanvasElement {
  const key = 'char|' + def.id + '|' + size + '|' + step;
  const hit = cached<HTMLCanvasElement>(key); if (hit) return hit;
  const c = mk(size, size), x = ctx2d(c);
  const col = def.colors, s = size / 72;
  x.save(); x.scale(s, s);
  const cx = 36, base = 62;
  // aura glow
  x.globalAlpha = 0.5; x.drawImage(glow(col.accent, 30), cx - 30, 36 - 30); x.globalAlpha = 1;
  // boots (stride offsets for the walk cycle) and arms behind the cloak
  const lf = step === 1 ? -2.5 : step === 2 ? 1.5 : 0, rf = step === 2 ? -2.5 : step === 1 ? 1.5 : 0;
  x.fillStyle = U.shade(col.secondary, -0.45);
  x.beginPath(); x.ellipse(cx - 7, base + 2 + lf, 5, 3.4, 0, 0, U.TAU); x.fill();
  x.beginPath(); x.ellipse(cx + 7, base + 2 + rf, 5, 3.4, 0, 0, U.TAU); x.fill();
  x.strokeStyle = U.shade(col.primary, -0.25); x.lineWidth = 5; x.lineCap = 'round';
  x.beginPath(); x.moveTo(cx - 12, 29); x.lineTo(cx - 17, 41 + rf * 0.6); x.moveTo(cx + 12, 29); x.lineTo(cx + 17, 41 + lf * 0.6); x.stroke();
  circle(x, cx - 17, 42 + rf * 0.6, 2.6, col.skin || '#e9c9a8'); circle(x, cx + 17, 42 + lf * 0.6, 2.6, col.skin || '#e9c9a8');
  // cloak/body
  const bodyG = x.createLinearGradient(0, 24, 0, base);
  bodyG.addColorStop(0, U.shade(col.primary, 0.15)); bodyG.addColorStop(1, U.shade(col.primary, -0.35));
  x.beginPath(); x.moveTo(cx - 10, 26); x.quadraticCurveTo(cx - 20, 44, cx - 18, base);
  x.lineTo(cx + 18, base); x.quadraticCurveTo(cx + 20, 44, cx + 10, 26); x.closePath();
  x.fillStyle = bodyG; x.fill(); x.strokeStyle = 'rgba(0,0,0,0.5)'; x.lineWidth = 1.5; x.stroke();
  // cloth folds and a rim of accent light down the right edge
  x.strokeStyle = 'rgba(0,0,0,0.22)'; x.lineWidth = 1.2;
  x.beginPath(); x.moveTo(cx - 6, 48); x.quadraticCurveTo(cx - 8, 56, cx - 9, base); x.moveTo(cx + 5, 48); x.quadraticCurveTo(cx + 7, 56, cx + 8, base); x.stroke();
  x.strokeStyle = U.rgba(col.accent, 0.55); x.lineWidth = 1.4;
  x.beginPath(); x.moveTo(cx + 10, 27); x.quadraticCurveTo(cx + 19.5, 44, cx + 17.5, base - 1); x.stroke();
  // belt / trim
  x.fillStyle = col.secondary; x.fillRect(cx - 14, 42, 28, 4);
  x.fillStyle = col.accent; x.fillRect(cx - 3, 41, 6, 6);
  // chest emblem
  x.shadowColor = col.accent; x.shadowBlur = 8; circle(x, cx, 34, 3.5, col.accent); x.shadowBlur = 0;
  // shoulders
  circle(x, cx - 12, 28, 5, U.shade(col.secondary, -0.1), 'rgba(0,0,0,0.5)');
  circle(x, cx + 12, 28, 5, U.shade(col.secondary, -0.1), 'rgba(0,0,0,0.5)');
  // head
  circle(x, cx, 19, 9, rgrad(x, cx, 19, 9, [[0, U.shade(col.skin || '#e9c9a8', 0.1)], [1, U.shade(col.skin || '#e9c9a8', -0.25)]]), 'rgba(0,0,0,0.5)');
  // hood / helm / hair
  const hd = def.head || 'hood';
  if (hd === 'hood') {
    x.beginPath(); x.moveTo(cx - 11, 22); x.quadraticCurveTo(cx - 12, 6, cx, 6); x.quadraticCurveTo(cx + 12, 6, cx + 11, 22);
    x.quadraticCurveTo(cx + 8, 16, cx, 15); x.quadraticCurveTo(cx - 8, 16, cx - 11, 22); x.closePath();
    x.fillStyle = U.shade(col.primary, -0.1); x.fill(); x.stroke();
  } else if (hd === 'helm') {
    x.beginPath(); x.arc(cx, 18, 10.5, Math.PI, 0); x.lineTo(cx + 10.5, 22); x.lineTo(cx - 10.5, 22); x.closePath();
    x.fillStyle = col.secondary; x.fill(); x.stroke();
    x.fillStyle = col.accent; x.fillRect(cx - 1.5, 7, 3, 12);
  } else if (hd === 'hair') {
    x.beginPath(); x.moveTo(cx - 10, 20); x.quadraticCurveTo(cx - 11, 7, cx, 8); x.quadraticCurveTo(cx + 11, 7, cx + 10, 20);
    x.quadraticCurveTo(cx + 6, 12, cx, 13); x.quadraticCurveTo(cx - 6, 12, cx - 10, 20); x.closePath();
    x.fillStyle = col.hair || col.secondary; x.fill(); x.stroke();
    if (def.longHair) { x.beginPath(); x.moveTo(cx - 10, 18); x.quadraticCurveTo(cx - 15, 32, cx - 10, 40); x.lineTo(cx - 6, 24); x.closePath(); x.fill(); x.beginPath(); x.moveTo(cx + 10, 18); x.quadraticCurveTo(cx + 15, 32, cx + 10, 40); x.lineTo(cx + 6, 24); x.closePath(); x.fill(); }
  } else if (hd === 'crown') {
    x.beginPath(); x.moveTo(cx - 10, 20); x.quadraticCurveTo(cx - 11, 7, cx, 8); x.quadraticCurveTo(cx + 11, 7, cx + 10, 20); x.quadraticCurveTo(cx, 13, cx - 10, 20); x.closePath();
    x.fillStyle = col.hair || col.secondary; x.fill(); x.stroke();
    poly(x, [[cx - 9, 11], [cx - 6, 4], [cx - 3, 9], [cx, 2], [cx + 3, 9], [cx + 6, 4], [cx + 9, 11]], col.accent, 'rgba(0,0,0,0.5)');
  } else if (hd === 'goggles') {
    x.beginPath(); x.arc(cx, 18, 10, Math.PI, 0); x.closePath(); x.fillStyle = col.secondary; x.fill(); x.stroke();
    circle(x, cx - 4.5, 15, 3.5, col.accent, '#222', 1.2); circle(x, cx + 4.5, 15, 3.5, col.accent, '#222', 1.2);
  } else if (hd === 'horns') {
    x.beginPath(); x.moveTo(cx - 10, 20); x.quadraticCurveTo(cx - 11, 7, cx, 8); x.quadraticCurveTo(cx + 11, 7, cx + 10, 20); x.quadraticCurveTo(cx, 13, cx - 10, 20); x.closePath();
    x.fillStyle = col.hair || col.secondary; x.fill(); x.stroke();
    x.strokeStyle = col.accent; x.lineWidth = 2.5; x.beginPath(); x.moveTo(cx - 8, 12); x.quadraticCurveTo(cx - 14, 6, cx - 12, 0); x.stroke();
    x.beginPath(); x.moveTo(cx + 8, 12); x.quadraticCurveTo(cx + 14, 6, cx + 12, 0); x.stroke();
  } else if (hd === 'bald') {
    x.fillStyle = col.accent; x.fillRect(cx - 9, 16, 18, 1.5);
  }
  // eyes
  x.fillStyle = col.eye || '#fff';
  x.shadowColor = col.eye || '#fff'; x.shadowBlur = 6;
  x.fillRect(cx - 5, 18, 3, 2); x.fillRect(cx + 2, 18, 3, 2);
  x.shadowBlur = 0;
  // weapon / accessory
  x.strokeStyle = 'rgba(0,0,0,0.5)'; x.lineWidth = 1.5;
  const wp = def.weaponArt || 'sword';
  x.shadowColor = col.accent; x.shadowBlur = 6;
  if (wp === 'sword') {
    x.save(); x.translate(cx + 16, 46); x.rotate(-0.5);
    x.fillStyle = '#d8dde6'; poly(x, [[0, -28], [3, -4], [-3, -4]], '#d8dde6', '#333'); x.fillStyle = col.accent; x.fillRect(-6, -4, 12, 3); x.fillStyle = '#5a3a1a'; x.fillRect(-1.5, -1, 3, 9);
    x.fillStyle = col.accent; x.globalAlpha = 0.6; poly(x, [[0, -28], [1.5, -4], [-1.5, -4]], col.accent); x.globalAlpha = 1; x.restore();
  } else if (wp === 'staff') {
    x.fillStyle = '#6b4a2a'; x.fillRect(cx + 16, 12, 3, 46);
    circle(x, cx + 17.5, 10, 5, rgrad(x, cx + 17.5, 10, 5, [[0, '#fff'], [0.4, col.accent], [1, U.shade(col.accent, -0.4)]]));
  } else if (wp === 'bow') {
    x.strokeStyle = '#8a5a2a'; x.lineWidth = 2.5; x.beginPath(); x.arc(cx + 22, 38, 18, -1.3, 1.3); x.stroke();
    x.strokeStyle = '#ddd'; x.lineWidth = 1; x.beginPath(); x.moveTo(cx + 26.8, 21); x.lineTo(cx + 26.8, 55); x.stroke();
  } else if (wp === 'daggers') {
    [[-20, 0.6], [20, -0.6]].forEach(([dx, rot]) => { x.save(); x.translate(cx + dx, 44); x.rotate(rot); poly(x, [[0, -14], [2.5, 0], [-2.5, 0]], '#ccd', '#222'); x.fillStyle = col.accent; x.fillRect(-3, 0, 6, 2); x.restore(); });
  } else if (wp === 'halo') {
    x.strokeStyle = col.accent; x.lineWidth = 2.5; x.beginPath(); x.ellipse(cx, 6, 12, 3.5, 0, 0, U.TAU); x.stroke();
    x.strokeStyle = '#fff'; x.lineWidth = 1; x.beginPath(); x.ellipse(cx, 6, 12, 3.5, 0, 0, U.TAU); x.stroke();
  } else if (wp === 'hammer') {
    x.fillStyle = '#6b4a2a'; x.fillRect(cx + 17, 20, 3.5, 40);
    x.fillStyle = '#8a929e'; x.fillRect(cx + 11, 14, 16, 12); x.fillStyle = col.accent; x.fillRect(cx + 11, 19, 16, 2);
  } else if (wp === 'scythe') {
    x.fillStyle = '#3a2a3a'; x.save(); x.translate(cx + 18, 40); x.rotate(0.15); x.fillRect(-1.5, -30, 3, 56); x.restore();
    x.strokeStyle = col.accent; x.lineWidth = 3.5; x.beginPath(); x.arc(cx + 6, 12, 16, -0.2, 1.4); x.stroke();
  } else if (wp === 'orb') {
    circle(x, cx - 20, 40, 6, rgrad(x, cx - 20, 40, 6, [[0, '#fff'], [0.4, col.accent], [1, U.shade(col.accent, -0.5)]]));
    circle(x, cx + 20, 40, 6, rgrad(x, cx + 20, 40, 6, [[0, '#fff'], [0.4, col.accent], [1, U.shade(col.accent, -0.5)]]));
  } else if (wp === 'wrench') {
    x.fillStyle = '#9aa2ad'; x.fillRect(cx + 15, 30, 4, 26); circle(x, cx + 17, 28, 6, '#9aa2ad', '#333'); x.fillStyle = col.primary; x.fillRect(cx + 14, 24, 6, 5);
    // backpack
    x.fillStyle = col.secondary; x.fillRect(cx - 24, 28, 10, 20); x.fillStyle = col.accent; x.fillRect(cx - 22, 31, 6, 3);
  } else if (wp === 'fists') {
    circle(x, cx - 19, 42, 5, col.accent, '#333'); circle(x, cx + 19, 42, 5, col.accent, '#333');
    x.strokeStyle = col.accent; x.lineWidth = 2; x.beginPath(); x.moveTo(cx - 12, 54); x.quadraticCurveTo(cx - 30, 58, cx - 34, 46); x.stroke();
  } else if (wp === 'ice') {
    x.fillStyle = '#6b4a8a'; x.fillRect(cx + 16, 14, 3, 44);
    poly(x, [[cx + 17.5, 0], [cx + 23, 12], [cx + 17.5, 18], [cx + 12, 12]], rgrad(x, cx + 17.5, 10, 8, [[0, '#fff'], [1, col.accent]]), '#fff8');
  }
  x.shadowBlur = 0;
  x.restore();
  const out = outlined(c, Math.max(1, Math.round(1.2 * s)));
  cache.set(key, out);
  return out;
}
/** In-world champion sprite: supersampled, pivot at the feet, with a walk-cycle `step`. */
function hero(def: CharacterArt, step = 0): Sprite {
  const key = 'hero|' + def.id + '|' + step;
  const hit = cached<Sprite>(key); if (hit) return hit;
  const sp = withOrigin(character(def, 72 * RES, step), 36, 62, RES);
  cache.set(key, sp);
  return sp;
}

/* ---------- enemy sprites ---------- */
const ENEMY_DRAW: Record<string, (x: Ctx, r: number, col: EnemyColors) => void> = {
  bat(x: Ctx, r: number, col: EnemyColors) {
    x.fillStyle = col.body;
    x.beginPath(); x.moveTo(0, 0); x.quadraticCurveTo(-r * 1.2, -r * 1.4, -r * 2.2, -r * 0.2); x.quadraticCurveTo(-r * 1.4, -r * 0.1, -r * 1.3, r * 0.5); x.quadraticCurveTo(-r * 0.6, r * 0.2, 0, r * 0.6);
    x.quadraticCurveTo(r * 0.6, r * 0.2, r * 1.3, r * 0.5); x.quadraticCurveTo(r * 1.4, -r * 0.1, r * 2.2, -r * 0.2); x.quadraticCurveTo(r * 1.2, -r * 1.4, 0, 0); x.fill();
    x.strokeStyle = 'rgba(0,0,0,0.5)'; x.lineWidth = 1; x.stroke();
    circle(x, 0, 0, r * 0.7, rgrad(x, 0, 0, r * 0.7, [[0, U.shade(col.body, 0.2)], [1, U.shade(col.body, -0.3)]]), 'rgba(0,0,0,0.5)');
    poly(x, [[-r * 0.5, -r * 0.5], [-r * 0.3, -r * 1.1], [-r * 0.1, -r * 0.5]], col.body); poly(x, [[r * 0.5, -r * 0.5], [r * 0.3, -r * 1.1], [r * 0.1, -r * 0.5]], col.body);
    eyes(x, 0, -r * 0.1, r * 0.28, r * 0.16, col.eye);
  },
  ghoul(x: Ctx, r: number, col: EnemyColors) {
    circle(x, 0, r * 0.2, r, rgrad(x, 0, r * 0.2, r, [[0, U.shade(col.body, 0.15)], [1, U.shade(col.body, -0.35)]]), 'rgba(0,0,0,0.6)');
    // arms
    x.strokeStyle = U.shade(col.body, -0.2); x.lineWidth = r * 0.35; x.lineCap = 'round';
    x.beginPath(); x.moveTo(-r * 0.7, r * 0.3); x.lineTo(-r * 1.4, r * 0.9); x.moveTo(r * 0.7, r * 0.3); x.lineTo(r * 1.4, r * 0.9); x.stroke();
    circle(x, 0, -r * 0.55, r * 0.6, rgrad(x, 0, -r * 0.55, r * 0.6, [[0, U.shade(col.body, 0.25)], [1, U.shade(col.body, -0.2)]]), 'rgba(0,0,0,0.6)');
    eyes(x, 0, -r * 0.6, r * 0.25, r * 0.14, col.eye);
    x.fillStyle = '#200'; x.fillRect(-r * 0.2, -r * 0.3, r * 0.4, r * 0.12);
  },
  skeleton(x: Ctx, r: number, col: EnemyColors) {
    x.strokeStyle = col.body; x.lineWidth = r * 0.22; x.lineCap = 'round';
    // ribs
    for (let i = 0; i < 3; i++) { x.beginPath(); x.moveTo(-r * 0.6, r * (0.05 + i * 0.3)); x.quadraticCurveTo(0, r * (0.3 + i * 0.3), r * 0.6, r * (0.05 + i * 0.3)); x.stroke(); }
    x.beginPath(); x.moveTo(0, -r * 0.3); x.lineTo(0, r * 1.0); x.stroke();
    x.beginPath(); x.moveTo(-r * 0.6, r * 0.1); x.lineTo(-r * 1.3, r * 0.7); x.moveTo(r * 0.6, r * 0.1); x.lineTo(r * 1.3, -r * 0.4); x.stroke();
    // skull
    circle(x, 0, -r * 0.55, r * 0.6, rgrad(x, 0, -r * 0.55, r * 0.6, [[0, '#fff'], [1, U.shade(col.body, -0.2)]]), 'rgba(0,0,0,0.6)');
    x.fillStyle = col.body; x.fillRect(-r * 0.35, -r * 0.2, r * 0.7, r * 0.3);
    x.fillStyle = '#111'; for (let i = 0; i < 3; i++) x.fillRect(-r * 0.3 + i * r * 0.22, -r * 0.15, r * 0.08, r * 0.2);
    eyes(x, 0, -r * 0.65, r * 0.25, r * 0.15, col.eye);
  },
  slime(x: Ctx, r: number, col: EnemyColors) {
    const g = rgrad(x, 0, 0, r, [[0, U.withAlpha(U.shade(col.body, 0.35), 0.95)], [0.7, col.body], [1, U.shade(col.body, -0.35)]]);
    x.beginPath(); x.moveTo(-r, r * 0.6); x.quadraticCurveTo(-r * 1.1, -r * 0.9, 0, -r * 0.9); x.quadraticCurveTo(r * 1.1, -r * 0.9, r, r * 0.6); x.quadraticCurveTo(0, r * 0.95, -r, r * 0.6);
    x.fillStyle = g; x.fill(); x.strokeStyle = 'rgba(0,0,0,0.5)'; x.lineWidth = 1.5; x.stroke();
    x.fillStyle = 'rgba(255,255,255,0.35)'; x.beginPath(); x.ellipse(-r * 0.35, -r * 0.45, r * 0.3, r * 0.18, -0.5, 0, U.TAU); x.fill();
    eyes(x, 0, -r * 0.05, r * 0.3, r * 0.16, col.eye);
  },
  imp(x: Ctx, r: number, col: EnemyColors) {
    circle(x, 0, r * 0.1, r * 0.85, rgrad(x, 0, r * 0.1, r * 0.85, [[0, U.shade(col.body, 0.2)], [1, U.shade(col.body, -0.35)]]), 'rgba(0,0,0,0.6)');
    x.strokeStyle = U.shade(col.body, -0.3); x.lineWidth = r * 0.2; x.lineCap = 'round';
    x.beginPath(); x.moveTo(-r * 0.4, -r * 0.6); x.quadraticCurveTo(-r * 0.9, -r * 1.4, -r * 0.5, -r * 1.5); x.moveTo(r * 0.4, -r * 0.6); x.quadraticCurveTo(r * 0.9, -r * 1.4, r * 0.5, -r * 1.5); x.stroke();
    x.beginPath(); x.moveTo(r * 0.5, r * 0.6); x.quadraticCurveTo(r * 1.5, r * 0.9, r * 1.4, r * 0.1); x.stroke();
    circle(x, r * 1.1, -r * 0.6, r * 0.32, rgrad(x, r * 1.1, -r * 0.6, r * 0.32, [[0, '#fff'], [0.4, col.eye], [1, U.shade(col.eye, -0.3)]]));
    eyes(x, 0, -r * 0.15, r * 0.3, r * 0.15, col.eye);
    x.fillStyle = '#fff'; poly(x, [[-r * 0.25, r * 0.3], [-r * 0.15, r * 0.55], [-r * 0.05, r * 0.3]], '#fff'); poly(x, [[r * 0.25, r * 0.3], [r * 0.15, r * 0.55], [r * 0.05, r * 0.3]], '#fff');
  },
  wraith(x: Ctx, r: number, col: EnemyColors) {
    x.globalAlpha = 0.85;
    x.beginPath(); x.moveTo(-r * 0.9, -r * 0.2); x.quadraticCurveTo(-r, -r * 1.2, 0, -r * 1.2); x.quadraticCurveTo(r, -r * 1.2, r * 0.9, -r * 0.2);
    x.lineTo(r * 0.9, r * 0.9); x.lineTo(r * 0.5, r * 0.5); x.lineTo(r * 0.15, r * 1.1); x.lineTo(-r * 0.2, r * 0.5); x.lineTo(-r * 0.55, r * 1.0); x.lineTo(-r * 0.9, r * 0.5); x.closePath();
    const g = x.createLinearGradient(0, -r, 0, r); g.addColorStop(0, U.shade(col.body, 0.25)); g.addColorStop(1, U.rgba(col.body.startsWith('#') ? col.body : '#8888aa', 0.1));
    x.fillStyle = g; x.fill(); x.globalAlpha = 1;
    x.strokeStyle = U.rgba(col.eye, 0.5); x.lineWidth = 1; x.stroke();
    eyes(x, 0, -r * 0.5, r * 0.28, r * 0.17, col.eye);
    x.fillStyle = col.eye; x.globalAlpha = 0.7; x.beginPath(); x.ellipse(0, -r * 0.05, r * 0.15, r * 0.25, 0, 0, U.TAU); x.fill(); x.globalAlpha = 1;
  },
  spider(x: Ctx, r: number, col: EnemyColors) {
    x.strokeStyle = U.shade(col.body, -0.2); x.lineWidth = r * 0.16; x.lineCap = 'round';
    for (let s = -1; s <= 1; s += 2) for (let i = 0; i < 4; i++) {
      const a = -0.9 + i * 0.6; x.beginPath(); x.moveTo(0, 0); x.lineTo(s * r * 1.1 * Math.cos(a * 0.6), r * Math.sin(a) * 0.9); x.lineTo(s * r * 1.7, r * Math.sin(a) * 1.3 + r * 0.3); x.stroke();
    }
    circle(x, 0, r * 0.3, r * 0.75, rgrad(x, 0, r * 0.3, r * 0.75, [[0, U.shade(col.body, 0.2)], [1, U.shade(col.body, -0.35)]]), 'rgba(0,0,0,0.6)');
    circle(x, 0, -r * 0.5, r * 0.45, rgrad(x, 0, -r * 0.5, r * 0.45, [[0, U.shade(col.body, 0.25)], [1, U.shade(col.body, -0.3)]]), 'rgba(0,0,0,0.6)');
    x.fillStyle = col.accent || '#f44'; x.beginPath(); x.moveTo(0, r * 0.05); x.lineTo(-r * 0.3, r * 0.5); x.lineTo(0, r * 0.9); x.lineTo(r * 0.3, r * 0.5); x.closePath(); x.fill();
    eyes(x, 0, -r * 0.55, r * 0.18, r * 0.1, col.eye); eyes(x, 0, -r * 0.72, r * 0.3, r * 0.07, col.eye);
  },
  charger(x: Ctx, r: number, col: EnemyColors) {
    x.beginPath(); x.ellipse(0, r * 0.1, r * 1.1, r * 0.8, 0, 0, U.TAU); x.fillStyle = rgrad(x, 0, 0, r, [[0, U.shade(col.body, 0.15)], [1, U.shade(col.body, -0.35)]]); x.fill(); x.strokeStyle = 'rgba(0,0,0,0.6)'; x.lineWidth = 1.5; x.stroke();
    circle(x, 0, -r * 0.55, r * 0.6, rgrad(x, 0, -r * 0.55, r * 0.6, [[0, U.shade(col.body, 0.25)], [1, U.shade(col.body, -0.25)]]), 'rgba(0,0,0,0.6)');
    x.fillStyle = '#e8e0c8'; poly(x, [[-r * 0.45, -r * 0.3], [-r * 0.9, -r * 0.8], [-r * 0.25, -r * 0.5]], '#e8e0c8', '#222'); poly(x, [[r * 0.45, -r * 0.3], [r * 0.9, -r * 0.8], [r * 0.25, -r * 0.5]], '#e8e0c8', '#222');
    x.fillStyle = U.shade(col.body, -0.5); for (let i = -2; i <= 2; i++) x.fillRect(i * r * 0.25 - r * 0.06, -r * 0.5, r * 0.12, r * 0.8);
    eyes(x, 0, -r * 0.6, r * 0.25, r * 0.13, col.eye);
  },
  bomber(x: Ctx, r: number, col: EnemyColors) {
    circle(x, 0, 0, r, rgrad(x, 0, 0, r, [[0, U.shade(col.body, 0.3)], [0.6, col.body], [1, U.shade(col.body, -0.4)]]), 'rgba(0,0,0,0.6)');
    x.strokeStyle = '#333'; x.lineWidth = r * 0.12; x.beginPath(); x.moveTo(0, -r); x.quadraticCurveTo(r * 0.4, -r * 1.5, r * 0.6, -r * 1.3); x.stroke();
    circle(x, r * 0.6, -r * 1.3, r * 0.2, col.eye); x.shadowColor = col.eye; x.shadowBlur = r; circle(x, r * 0.6, -r * 1.3, r * 0.12, '#fff'); x.shadowBlur = 0;
    x.strokeStyle = U.shade(col.body, -0.5); x.lineWidth = 1; for (let i = 0; i < 3; i++) { x.beginPath(); x.moveTo(-r * 0.6 + i * r * 0.4, -r * 0.3); x.lineTo(-r * 0.3 + i * r * 0.4, r * 0.4); x.stroke(); }
    eyes(x, 0, -r * 0.1, r * 0.3, r * 0.14, col.eye);
  },
  brute(x: Ctx, r: number, col: EnemyColors) {
    circle(x, 0, r * 0.15, r, rgrad(x, 0, r * 0.15, r, [[0, U.shade(col.body, 0.15)], [1, U.shade(col.body, -0.4)]]), 'rgba(0,0,0,0.6)');
    circle(x, -r * 0.95, r * 0.1, r * 0.42, rgrad(x, -r * 0.95, r * 0.1, r * 0.42, [[0, U.shade(col.body, 0.2)], [1, U.shade(col.body, -0.3)]]), 'rgba(0,0,0,0.6)');
    circle(x, r * 0.95, r * 0.1, r * 0.42, rgrad(x, r * 0.95, r * 0.1, r * 0.42, [[0, U.shade(col.body, 0.2)], [1, U.shade(col.body, -0.3)]]), 'rgba(0,0,0,0.6)');
    // belt / straps
    x.strokeStyle = '#3a2a1a'; x.lineWidth = r * 0.18; x.beginPath(); x.moveTo(-r * 0.6, -r * 0.5); x.lineTo(r * 0.5, r * 0.8); x.stroke();
    circle(x, 0, -r * 0.55, r * 0.5, rgrad(x, 0, -r * 0.55, r * 0.5, [[0, U.shade(col.body, 0.25)], [1, U.shade(col.body, -0.2)]]), 'rgba(0,0,0,0.6)');
    eyes(x, 0, -r * 0.6, r * 0.2, r * 0.12, col.eye);
    x.fillStyle = '#eee'; poly(x, [[-r * 0.2, -r * 0.3], [-r * 0.12, -r * 0.05], [-r * 0.04, -r * 0.3]], '#eee'); poly(x, [[r * 0.2, -r * 0.3], [r * 0.12, -r * 0.05], [r * 0.04, -r * 0.3]], '#eee');
  },
  shaman(x: Ctx, r: number, col: EnemyColors) {
    x.beginPath(); x.moveTo(-r * 0.8, r); x.quadraticCurveTo(-r * 0.9, -r * 0.5, 0, -r * 0.6); x.quadraticCurveTo(r * 0.9, -r * 0.5, r * 0.8, r); x.closePath();
    x.fillStyle = rgrad(x, 0, 0, r, [[0, U.shade(col.body, 0.15)], [1, U.shade(col.body, -0.35)]]); x.fill(); x.strokeStyle = 'rgba(0,0,0,0.6)'; x.lineWidth = 1.5; x.stroke();
    // skull mask
    circle(x, 0, -r * 0.55, r * 0.5, rgrad(x, 0, -r * 0.55, r * 0.5, [[0, '#f8f4e8'], [1, '#bbb098']]), 'rgba(0,0,0,0.6)');
    // feathers
    x.strokeStyle = col.accent || '#f8c'; x.lineWidth = r * 0.12; for (let i = -1; i <= 1; i++) { x.beginPath(); x.moveTo(i * r * 0.3, -r * 0.9); x.lineTo(i * r * 0.6, -r * 1.6); x.stroke(); }
    // staff
    x.strokeStyle = '#5a3a1a'; x.lineWidth = r * 0.14; x.beginPath(); x.moveTo(r * 0.9, r * 0.9); x.lineTo(r * 1.1, -r * 0.8); x.stroke();
    circle(x, r * 1.12, -r * 0.9, r * 0.22, col.eye); x.shadowColor = col.eye; x.shadowBlur = r * 0.6; circle(x, r * 1.12, -r * 0.9, r * 0.12, '#fff'); x.shadowBlur = 0;
    eyes(x, 0, -r * 0.6, r * 0.2, r * 0.12, col.eye);
  },
  golem(x: Ctx, r: number, col: EnemyColors) {
    x.save(); x.rotate(0.1);
    poly(x, [[-r * 0.9, -r * 0.5], [-r * 0.5, -r], [r * 0.6, -r * 0.95], [r, -r * 0.3], [r * 0.9, r * 0.7], [r * 0.3, r], [-r * 0.7, r * 0.9], [-r, r * 0.2]],
      rgrad(x, 0, 0, r, [[0, U.shade(col.body, 0.2)], [1, U.shade(col.body, -0.4)]]), 'rgba(0,0,0,0.7)', 2);
    x.restore();
    // cracks glowing
    x.strokeStyle = col.eye; x.shadowColor = col.eye; x.shadowBlur = r * 0.4; x.lineWidth = r * 0.08;
    x.beginPath(); x.moveTo(-r * 0.3, r * 0.2); x.lineTo(-r * 0.1, -r * 0.1); x.lineTo(r * 0.3, 0); x.lineTo(r * 0.5, r * 0.5); x.stroke();
    x.beginPath(); x.moveTo(-r * 0.6, -r * 0.5); x.lineTo(-r * 0.4, -r * 0.2); x.stroke();
    x.shadowBlur = 0;
    poly(x, [[-r * 1.2, -r * 0.2], [-r * 0.9, -r * 0.6], [-r * 0.7, r * 0.5], [-r * 1.1, r * 0.6]], U.shade(col.body, -0.15), 'rgba(0,0,0,0.7)');
    poly(x, [[r * 1.2, -r * 0.2], [r * 0.9, -r * 0.6], [r * 0.7, r * 0.5], [r * 1.1, r * 0.6]], U.shade(col.body, -0.15), 'rgba(0,0,0,0.7)');
    eyes(x, 0, -r * 0.5, r * 0.25, r * 0.15, col.eye);
  },
  watcher(x: Ctx, r: number, col: EnemyColors) {
    // floating eye with tentacles
    x.strokeStyle = U.shade(col.body, -0.3); x.lineWidth = r * 0.14; x.lineCap = 'round';
    for (let i = 0; i < 5; i++) { const a = 0.4 + i * 0.55; x.beginPath(); x.moveTo(Math.cos(a) * r * 0.7, Math.sin(a) * r * 0.7); x.quadraticCurveTo(Math.cos(a) * r * 1.3, Math.sin(a) * r * 1.5 + r * 0.2, Math.cos(a + 0.3) * r * 1.6, Math.sin(a) * r * 1.6 + r * 0.4); x.stroke(); }
    circle(x, 0, 0, r, rgrad(x, 0, 0, r, [[0, U.shade(col.body, 0.25)], [1, U.shade(col.body, -0.35)]]), 'rgba(0,0,0,0.6)');
    circle(x, 0, 0, r * 0.62, '#f4f0e6', '#a99'); circle(x, r * 0.05, 0, r * 0.38, rgrad(x, 0, 0, r * 0.38, [[0, U.shade(col.eye, 0.4)], [1, U.shade(col.eye, -0.3)]]));
    circle(x, r * 0.05, 0, r * 0.18, '#000'); circle(x, -r * 0.08, -r * 0.12, r * 0.07, '#fff');
  },
  /* ---- bosses ---- */
  bone_colossus(x: Ctx, r: number, col: EnemyColors) {
    ENEMY_DRAW.skeleton(x, r * 0.95, col);
    x.strokeStyle = col.eye; x.shadowColor = col.eye; x.shadowBlur = r * 0.5; x.lineWidth = r * 0.06;
    x.beginPath(); x.arc(0, -r * 0.55, r * 0.75, 0, U.TAU); x.stroke(); x.shadowBlur = 0;
    // crown of bone
    x.fillStyle = '#eee'; for (let i = -2; i <= 2; i++) poly(x, [[i * r * 0.22 - r * 0.08, -r * 1.05], [i * r * 0.22, -r * 1.5 - Math.abs(i) * -r * 0.1], [i * r * 0.22 + r * 0.08, -r * 1.05]], '#eee', '#333');
  },
  blood_matriarch(x: Ctx, r: number, col: EnemyColors) {
    ENEMY_DRAW.spider(x, r, col);
    if (col.accent) { x.fillStyle = col.accent; x.shadowColor = col.accent; } x.shadowBlur = r * 0.5;
    for (let i = 0; i < 3; i++) circle(x, -r * 0.3 + i * r * 0.3, r * 0.3, r * 0.1, col.eye); x.shadowBlur = 0;
  },
  frost_wyrm(x: Ctx, r: number, col: EnemyColors) {
    // serpentine coil
    x.strokeStyle = U.shade(col.body, -0.2); x.lineWidth = r * 0.5; x.lineCap = 'round';
    x.beginPath(); x.moveTo(-r * 1.2, r * 0.6); x.quadraticCurveTo(-r * 0.6, -r * 0.6, 0, r * 0.2); x.quadraticCurveTo(r * 0.6, r * 0.9, r * 1.1, r * 0.1); x.stroke();
    x.strokeStyle = col.body; x.lineWidth = r * 0.3; x.stroke();
    // wings
    x.fillStyle = U.rgba(col.eye, 0.35); poly(x, [[-r * 0.3, -r * 0.3], [-r * 1.6, -r * 1.3], [-r * 0.9, -r * 0.1]], U.rgba(col.eye, 0.35), U.rgba(col.eye, 0.7)); poly(x, [[r * 0.3, -r * 0.3], [r * 1.6, -r * 1.3], [r * 0.9, -r * 0.1]], U.rgba(col.eye, 0.35), U.rgba(col.eye, 0.7));
    // head
    poly(x, [[-r * 0.6, -r * 0.5], [0, -r * 1.3], [r * 0.6, -r * 0.5], [r * 0.4, r * 0.1], [-r * 0.4, r * 0.1]], rgrad(x, 0, -r * 0.5, r * 0.7, [[0, U.shade(col.body, 0.3)], [1, U.shade(col.body, -0.3)]]), 'rgba(0,0,0,0.6)');
    x.strokeStyle = '#e8f4ff'; x.lineWidth = r * 0.1; x.beginPath(); x.moveTo(-r * 0.3, -r * 0.9); x.lineTo(-r * 0.6, -r * 1.6); x.moveTo(r * 0.3, -r * 0.9); x.lineTo(r * 0.6, -r * 1.6); x.stroke();
    eyes(x, 0, -r * 0.6, r * 0.22, r * 0.13, col.eye);
  },
  void_leviathan(x: Ctx, r: number, col: EnemyColors) {
    for (let i = 0; i < 7; i++) { const a = i * (U.TAU / 7); x.strokeStyle = U.shade(col.body, -0.2); x.lineWidth = r * 0.22; x.lineCap = 'round'; x.beginPath(); x.moveTo(Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6); x.quadraticCurveTo(Math.cos(a + 0.5) * r * 1.3, Math.sin(a + 0.5) * r * 1.3, Math.cos(a + 0.2) * r * 1.7, Math.sin(a + 0.2) * r * 1.7); x.stroke(); }
    circle(x, 0, 0, r, rgrad(x, 0, 0, r, [[0, U.shade(col.body, 0.3)], [0.7, col.body], [1, U.shade(col.body, -0.5)]]), 'rgba(0,0,0,0.7)', 2);
    x.strokeStyle = col.eye; x.shadowColor = col.eye; x.shadowBlur = r * 0.4; x.lineWidth = r * 0.05;
    for (let i = 0; i < 3; i++) { x.beginPath(); x.arc(0, 0, r * (0.3 + i * 0.22), 0, U.TAU); x.stroke(); }
    x.shadowBlur = 0;
    circle(x, 0, 0, r * 0.28, '#000'); circle(x, 0, 0, r * 0.14, col.eye);
    for (let i = 0; i < 4; i++) { const a = 0.7 + i * 1.5; circle(x, Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62, r * 0.1, col.eye); }
  },
  infernal_titan(x: Ctx, r: number, col: EnemyColors) {
    ENEMY_DRAW.brute(x, r, col);
    x.strokeStyle = col.accent || '#ff6a00'; x.lineWidth = r * 0.14; x.lineCap = 'round'; x.shadowColor = col.accent || '#ff6a00'; x.shadowBlur = r * 0.5;
    x.beginPath(); x.moveTo(-r * 0.4, -r * 0.95); x.quadraticCurveTo(-r * 0.9, -r * 1.5, -r * 0.6, -r * 1.9); x.moveTo(r * 0.4, -r * 0.95); x.quadraticCurveTo(r * 0.9, -r * 1.5, r * 0.6, -r * 1.9); x.stroke();
    x.beginPath(); x.moveTo(-r * 0.5, r * 0.2); x.lineTo(-r * 0.2, -r * 0.1); x.lineTo(r * 0.2, r * 0.3); x.lineTo(r * 0.5, 0); x.stroke();
    x.shadowBlur = 0;
  },
};
function enemy(type: string, r: number, col: EnemyColors, tier = 0): Sprite {
  const key = 'en|' + type + '|' + r + '|' + col.body + '|' + col.eye + '|' + tier;
  const hit = cached<Sprite>(key); if (hit) return hit;
  const R = Math.ceil(r * 2.2 + 6);
  const [c0, x] = mkRes(R * 2, R * 2);
  x.translate(R, R);
  x.lineJoin = 'round';
  (ENEMY_DRAW[type] || ENEMY_DRAW.ghoul)(x, r, col);
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
  x.translate(R, R);
  const g = x.createLinearGradient(-r, -r, r, r); g.addColorStop(0, '#fff'); g.addColorStop(0.35, color); g.addColorStop(1, U.shade(color, -0.45));
  poly(x, [[0, -r * 1.3], [r * 0.9, -r * 0.2], [0, r * 1.3], [-r * 0.9, -r * 0.2]], g, 'rgba(255,255,255,0.6)', 1);
  x.fillStyle = 'rgba(255,255,255,0.5)'; poly(x, [[0, -r * 1.1], [r * 0.4, -r * 0.3], [-r * 0.4, -r * 0.3]], 'rgba(255,255,255,0.45)');
  const sp = withOrigin(c, R, R, RES); cache.set(key, sp); return sp;
}
function coin(r = 6): Sprite {
  const key = 'coin|' + r; const hit = cached<Sprite>(key); if (hit) return hit;
  const R = r * 2.2, [c, x] = mkRes(R * 2, R * 2);
  x.globalAlpha = 0.6; x.drawImage(glow('#ffcc44', R * RES), 0, 0, R * 2, R * 2); x.globalAlpha = 1;
  x.translate(R, R);
  circle(x, 0, 0, r, rgrad(x, 0, 0, r, [[0, '#fff3b0'], [0.5, '#f5c542'], [1, '#a5741a']]), '#6a4a10', 1.2);
  x.fillStyle = '#a5741a'; x.font = `bold ${r * 1.3}px serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('$', 0, 1);
  const sp = withOrigin(c, R, R, RES); cache.set(key, sp); return sp;
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
    const b = kind === 'bosschest';
    x.fillStyle = b ? '#5a1a3a' : '#6b3a1a'; x.fillRect(-14, -4, 28, 16); x.strokeStyle = '#2a1a0a'; x.lineWidth = 1.5; x.strokeRect(-14, -4, 28, 16);
    x.fillStyle = b ? '#8a2a5a' : '#8a5a2a'; x.beginPath(); x.moveTo(-14, -4); x.quadraticCurveTo(0, -18, 14, -4); x.closePath(); x.fill(); x.stroke();
    x.fillStyle = b ? '#ff44aa' : '#ffd700'; x.fillRect(-14, -5, 28, 3); x.fillRect(-3, -4, 6, 8); x.fillStyle = '#333'; circle(x, 0, 1, 1.8, '#222');
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

/* ---------- props ---------- */
function prop(kind: string, seed: number, pal: PropPalette): Sprite {
  const key = 'prop|' + kind + '|' + seed + '|' + (pal.id || '');
  const hit = cached<Sprite>(key); if (hit) return hit;
  const rnd = U.mulberry32(seed * 7919 + 13);
  const R = 40, [c0, x] = mkRes(R * 2, R * 2 + 20); x.translate(R, R + 10);
  x.lineJoin = 'round';
  const dark = pal.propDark || '#22202a', light = pal.propLight || '#5a5668';
  if (kind === 'rock') {
    const n = 6 + Math.floor(rnd() * 3), pts: [number, number][] = [];
    for (let i = 0; i < n; i++) { const a = i / n * U.TAU, rr = 12 + rnd() * 10; pts.push([Math.cos(a) * rr * 1.2, Math.sin(a) * rr * 0.8]); }
    poly(x, pts, rgrad(x, 0, -4, 16, [[0, light], [1, dark]]), 'rgba(0,0,0,0.6)', 1.5);
    x.strokeStyle = 'rgba(255,255,255,0.12)'; x.lineWidth = 1; x.beginPath(); x.moveTo(pts[0][0], pts[0][1]); x.lineTo(pts[1][0], pts[1][1]); x.lineTo(pts[2][0], pts[2][1]); x.stroke();
  } else if (kind === 'tree') {
    x.strokeStyle = dark; x.lineWidth = 5; x.lineCap = 'round';
    x.beginPath(); x.moveTo(0, 20); x.lineTo(0, -10); x.stroke();
    x.lineWidth = 3; for (let i = 0; i < 4; i++) { const a = -Math.PI / 2 + (rnd() - 0.5) * 2.2, l = 14 + rnd() * 14; x.beginPath(); x.moveTo(0, -4 - rnd() * 10); x.lineTo(Math.cos(a) * l, -8 + Math.sin(a) * l); x.stroke(); }
  } else if (kind === 'grave') {
    x.fillStyle = light; x.beginPath(); x.moveTo(-9, 18); x.lineTo(-9, -6); x.arc(0, -6, 9, Math.PI, 0); x.lineTo(9, 18); x.closePath(); x.fill(); x.strokeStyle = 'rgba(0,0,0,0.6)'; x.lineWidth = 1.5; x.stroke();
    x.fillStyle = dark; x.fillRect(-1.5, -8, 3, 14); x.fillRect(-6, -4, 12, 3);
  } else if (kind === 'crystal') {
    const col = pal.crystal || '#7ad7ff';
    x.shadowColor = col; x.shadowBlur = 14;
    for (let i = 0; i < 3; i++) { const dx = (i - 1) * 9, h = 18 + rnd() * 14; poly(x, [[dx, 14], [dx - 6, 4], [dx - 1, -h + 10], [dx + 5, 2]], rgrad(x, dx, 0, 14, [[0, '#fff'], [0.4, col], [1, U.shade(col, -0.4)]]), 'rgba(255,255,255,0.4)', 1); }
    x.shadowBlur = 0;
  } else if (kind === 'bones') {
    x.strokeStyle = '#d8d0c0'; x.lineWidth = 3; x.lineCap = 'round';
    for (let i = 0; i < 3; i++) { const a = rnd() * Math.PI, l = 8 + rnd() * 10, ox = (rnd() - 0.5) * 20, oy = (rnd() - 0.5) * 10 + 8; x.beginPath(); x.moveTo(ox - Math.cos(a) * l, oy - Math.sin(a) * l); x.lineTo(ox + Math.cos(a) * l, oy + Math.sin(a) * l); x.stroke(); }
    circle(x, 6, 2, 6, '#e8e0d0', '#555', 1); x.fillStyle = '#333'; circle(x, 4, 1, 1.5, '#222'); circle(x, 8.5, 1, 1.5, '#222');
  } else if (kind === 'pillar') {
    x.fillStyle = light; x.fillRect(-7, -30, 14, 48); x.strokeStyle = 'rgba(0,0,0,0.6)'; x.strokeRect(-7, -30, 14, 48);
    x.fillStyle = dark; x.fillRect(-10, -34, 20, 5); x.fillRect(-10, 16, 20, 5);
    const col = pal.crystal || '#7ad7ff'; x.shadowColor = col; x.shadowBlur = 8; x.fillStyle = col; x.fillRect(-2, -20, 4, 26); x.shadowBlur = 0;
  } else if (kind === 'mushroom') {
    const col = pal.crystal || '#9f7'; x.fillStyle = '#d8d0c0'; x.fillRect(-3, 0, 6, 14);
    x.shadowColor = col; x.shadowBlur = 10; x.beginPath(); x.ellipse(0, 0, 12, 7, 0, Math.PI, 0); x.fillStyle = rgrad(x, 0, -3, 12, [[0, U.shade(col, 0.3)], [1, U.shade(col, -0.3)]]); x.fill(); x.shadowBlur = 0;
    x.fillStyle = 'rgba(255,255,255,0.5)'; circle(x, -4, -3, 1.5, 'rgba(255,255,255,0.6)'); circle(x, 3, -4, 1.2, 'rgba(255,255,255,0.6)');
  } else if (kind === 'stump') {
    x.fillStyle = dark; x.beginPath(); x.ellipse(0, 6, 14, 8, 0, 0, U.TAU); x.fill();
    x.fillStyle = light; x.beginPath(); x.ellipse(0, 0, 14, 8, 0, 0, U.TAU); x.fill(); x.strokeStyle = 'rgba(0,0,0,0.5)'; x.stroke();
    x.strokeStyle = 'rgba(0,0,0,0.35)'; x.lineWidth = 1; for (let i = 1; i < 4; i++) { x.beginPath(); x.ellipse(0, 0, i * 4, i * 2.2, 0, 0, U.TAU); x.stroke(); }
  }
  const sp = withOrigin(outlined(c0, 2, 'rgba(0,0,0,0.45)'), R, R + 10, RES); cache.set(key, sp); return sp;
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

/* ---------- ground tile ---------- */
function groundTile(pal: GroundPalette, size = 512): HTMLCanvasElement {
  const key = 'ground|' + pal.id + '|' + size;
  const hit = cached<HTMLCanvasElement>(key); if (hit) return hit;
  const c = mk(size, size), x = ctx2d(c);
  const rnd = U.mulberry32(pal.seed || 1);
  x.fillStyle = pal.ground; x.fillRect(0, 0, size, size);
  const wrap = (fn: () => void) => { for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) { x.save(); x.translate(ox * size, oy * size); fn(); x.restore(); } };
  // large soft blotches
  for (let i = 0; i < 70; i++) {
    const px = rnd() * size, py = rnd() * size, r = 30 + rnd() * 90, dark = rnd() < 0.55;
    wrap(() => { const g = x.createRadialGradient(px, py, 0, px, py, r); g.addColorStop(0, U.rgba(dark ? pal.groundDark : pal.groundLight, 0.22)); g.addColorStop(1, U.rgba(dark ? pal.groundDark : pal.groundLight, 0)); x.fillStyle = g; x.fillRect(px - r, py - r, r * 2, r * 2); });
  }
  // fine grain
  for (let i = 0; i < 2600; i++) { const px = rnd() * size, py = rnd() * size; x.fillStyle = rnd() < 0.5 ? U.rgba(pal.groundDark, 0.18) : U.rgba(pal.groundLight, 0.12); x.fillRect(px, py, 1 + rnd() * 2, 1 + rnd() * 2); }
  // cracks
  x.strokeStyle = U.rgba(pal.groundDark, 0.7); x.lineWidth = 1.2; x.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    const px = rnd() * size, py = rnd() * size, a = rnd() * U.TAU;
    const segs = 4 + Math.floor(rnd() * 8);
    wrap(() => { x.beginPath(); x.moveTo(px, py); let qx = px, qy = py, qa = a; for (let s = 0; s < segs; s++) { qa += (rnd() - 0.5) * 1.4; qx += Math.cos(qa) * (8 + rnd() * 14); qy += Math.sin(qa) * (8 + rnd() * 14); x.lineTo(qx, qy); } x.stroke(); });
  }
  // cobble / tiles for some palettes
  if (pal.tiles) {
    x.strokeStyle = U.rgba(pal.groundDark, 0.5); x.lineWidth = 2;
    const ts = pal.tiles;
    for (let ty = 0; ty < size; ty += ts) for (let tx = 0; tx < size; tx += ts) {
      const off = (Math.floor(ty / ts) % 2) * ts / 2;
      x.strokeRect(tx + off + 1, ty + 1, ts - 2, ts - 2);
      if (rnd() < 0.25) { x.fillStyle = U.rgba(pal.groundLight, 0.08); x.fillRect(tx + off + 2, ty + 2, ts - 4, ts - 4); }
    }
  }
  // subtle rune circles
  for (let i = 0; i < 4; i++) {
    const px = rnd() * size, py = rnd() * size, r = 24 + rnd() * 40;
    wrap(() => { x.strokeStyle = U.rgba(pal.rune || pal.groundLight, 0.12); x.lineWidth = 1.5; x.beginPath(); x.arc(px, py, r, 0, U.TAU); x.stroke(); x.beginPath(); x.arc(px, py, r * 0.7, 0, U.TAU); x.stroke(); for (let k = 0; k < 6; k++) { const a = k / 6 * U.TAU; x.beginPath(); x.moveTo(px + Math.cos(a) * r * 0.7, py + Math.sin(a) * r * 0.7); x.lineTo(px + Math.cos(a + 2.1) * r * 0.7, py + Math.sin(a + 2.1) * r * 0.7); x.stroke(); } });
  }
  cache.set(key, c); return c;
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
  bat(x: Ctx, c: string) { x.save(); x.scale(1.2, 1.2); ENEMY_DRAW.bat(x, 8, { body: c, eye: '#fff' }); x.restore(); },
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
  glow, light, orb, bolt, character, hero, enemy, flash, tint,
  gem, coin, pickup, prop, shrine, groundTile, icon, iconURL, portraitURL,
};
export const Sprites = S;
