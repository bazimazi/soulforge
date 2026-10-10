/**
 * World renderer: camera, ground, entities, lighting, effects and post-processing.
 *
 * Draws the simulation state through a {@link Backend} (WebGL2 when available, Canvas2D otherwise).
 * Entity positions are interpolated between the last two fixed simulation steps (`alpha`), so motion
 * is smooth at any display refresh rate. Nothing here mutates gameplay state.
 *
 * Frame layout: ground → ground details → decals → zones/telegraphs → cast shadows → corpses → pickups →
 * one y-sorted pass of props, enemies, allies and the champion → debris → projectiles → light map →
 * additive glows/trails/particles → numbers and bars → screen-space overlays → post (bloom, grading,
 * shockwaves).
 */
import { U } from '../core/util';
import { AFFIX_BY_ID } from '../data/enemies';
import { MAT_BY_ID, STAGES } from '../data/passives';
import { SHRINE_DEFS, TRIAL_TIME } from '../data/shrines';
import type { Game } from '../game/game';
import type { Ally, Enemy, Projectile, StageDef, Weapon } from '../game/types';
import { PF, type FX } from './fx';
import { MAX_WAVES, type Backend, type Img, type PostFX } from './gfx/backend';
import { Canvas2DBackend } from './gfx/canvas2d';
import { WebGL2Backend } from './gfx/webgl2';
import { CHUNK, propLayout } from './layout';
import { ENEMY_FRAMES, GROUND_DETAILS, HERO_FRAMES, PROP_LIGHTS, Sprites as S } from './sprites';

const TAU = Math.PI * 2;
const MAX_LIGHTS = 420;
const GEM_COLOR = { blue: '#60a5fa', green: '#4ade80', red: '#f87171', purple: '#c084fc' } as const;
/** Cast shadows lean up and to the right, as if the moon hung low behind the camera's left shoulder. */
const SHADOW_SKEW = -0.75;
const SHADOW_SQUASH = 0.36;
/** Enemies that float: they get a soft blob shadow below them instead of a cast silhouette. */
const FLIERS = new Set(['bat', 'wraith', 'watcher', 'banshee', 'void_leviathan']);
/** Locomotion cycles per radian of `Enemy.anim` (which advances 6 rad/s). */
const ANIM_RATE: Record<string, number> = {
  bat: 0.85,
  spider: 0.6,
  hoarder: 0.6,
  slimelet: 0.45,
  imp: 0.4,
  golem: 0.2,
  brute: 0.24,
  charger: 0.42,
  totem: 0.18,
  cask: 0.15,
};
/** Emissive ground details and the colour of the light they cast. */
const GLOW_DETAIL: Record<string, string> = { lavacrack: '#ff7a2a', voidcrack: '#c084fc', toxic: '#9dff5c' };

/** Per-stage weather: ambient motes' drift velocity (px/s), size, lifetime and how many spawn per frame. */
interface Weather {
  vx: [number, number];
  vy: [number, number];
  size: [number, number];
  life: number;
  rate: number;
  color?: string;
}
const WEATHER: Record<string, Weather> = {
  ashen: { vx: [-8, 8], vy: [-22, -8], size: [1.5, 3], life: 3, rate: 0.5 },
  frost: { vx: [18, 40], vy: [40, 70], size: [1.5, 3.2], life: 4, rate: 1.4, color: '#e8f6ff' },
  cathedral: { vx: [-10, 10], vy: [10, 26], size: [1.8, 3], life: 4, rate: 0.7 },
  blight: { vx: [-6, 6], vy: [-14, -4], size: [2, 4], life: 4.5, rate: 0.6 },
  void: { vx: [-24, 24], vy: [-24, 24], size: [1.5, 3.5], life: 3, rate: 0.9 },
};
/** Per-stage colour grading: split-tone colours, the champion's lantern colour, how deep the night is. */
interface Grade {
  shadows: string;
  highlights: string;
  amount: number;
  lantern: string;
  /** Multiplies the stage's ambient darkness (lights matter more in a darker night). */
  dark: number;
}
const GRADES: Record<string, Grade> = {
  ashen: { shadows: '#4a1f5a', highlights: '#ffd2a0', amount: 0.32, lantern: '#ffe2bd', dark: 1.5 },
  frost: { shadows: '#123a6a', highlights: '#e4f5ff', amount: 0.32, lantern: '#dff1ff', dark: 1.5 },
  cathedral: { shadows: '#4a0a24', highlights: '#ffcfb8', amount: 0.34, lantern: '#ffd9c4', dark: 1.5 },
  blight: { shadows: '#0d3a22', highlights: '#eaffc8', amount: 0.3, lantern: '#efffd6', dark: 1.5 },
  void: { shadows: '#2e1258', highlights: '#f2dcff', amount: 0.36, lantern: '#eadcff', dark: 1.5 },
};

export type BackendPreference = 'auto' | 'webgl2' | 'canvas2d';

interface PropInst {
  x: number;
  y: number;
  sprite: Img;
  kind: string;
  /** Half width and height above the pivot in world units (occlusion fade). */
  hw: number;
  h: number;
}
interface DetailInst {
  x: number;
  y: number;
  sprite: Img;
  rot: number;
  s: number;
  a: number;
  /** Emissive details glow and cast light in this colour. */
  glow: string | null;
  /** Ritual circles pulse. */
  rune: boolean;
  phase: number;
}
interface Chunk {
  props: PropInst[];
  details: DetailInst[];
}
/** One entry of the y-sorted entity pass. */
const enum DK {
  Enemy,
  Prop,
  Ally,
  Player,
}
interface Drawable {
  y: number;
  k: DK;
  ref: Enemy | PropInst | Ally | null;
  x: number;
}

/** Small vector sprites that are simpler to rasterise once than to compose from primitives. */
function makeSprite(w: number, h: number, ox: number, oy: number, draw: (x: CanvasRenderingContext2D) => void): Img {
  const c = document.createElement('canvas') as Img;
  c.width = w;
  c.height = h;
  c.ox = ox;
  c.oy = oy;
  const x = c.getContext('2d')!;
  x.translate(ox, oy);
  draw(x);
  return c;
}

const easeOut = (k: number) => 1 - (1 - k) * (1 - k);
/** Brightness falloff for big effects: past `ref` world units an effect dims, so a late-game blast never whites out the field. */
const sizeFade = (r: number, ref = 90) => (r > ref ? Math.sqrt(ref / r) : 1);
/** Additive effects stack: dim each one as the live count passes `n`. */
const crowdFade = (count: number, n: number) => (count > n ? Math.sqrt(n / count) : 1);
/** Light radius for an effect of gameplay radius `r`: grows sub-linearly so huge areas don't light the whole screen. */
const softR = (r: number) => (r > 80 ? 80 + (r - 80) * 0.55 : r);

export class Renderer {
  readonly backend: Backend;
  readonly fx: FX;
  quality = 1;
  /** Bloom & colour grading (WebGL2 only; Settings → Post-processing). */
  postEnabled = true;
  private post: PostFX = {
    bloom: 0.8,
    threshold: 0.6,
    aberration: 0,
    saturation: 1.08,
    contrast: 1.06,
    exposure: 1,
    tint: '#000',
    tintA: 0,
    grain: 0.035,
    time: 0,
    shadows: '#000',
    shadowsA: 0,
    highlights: '#fff',
    highlightsA: 0,
    waves: new Float32Array(MAX_WAVES * 4),
    waveCount: 0,
  };
  W = 1;
  H = 1;
  dpr = 1;
  zoom = 1;
  cam = { x: 0, y: 0 };
  private stage: StageDef = STAGES[0]!;
  private chunkCache = new Map<string, Chunk>();
  private ground: HTMLCanvasElement | null = null;
  private menuT = 0;
  private dt = 0;
  /** Real seconds since the run started rendering (animation clock that keeps running in slow motion). */
  private clock = 0;
  /** Flat light list: x, y, r, alpha; colours in a parallel array (null = the stage lantern colour). */
  private lights: number[] = [];
  private lightCols: (string | null)[] = [];
  private dl: Drawable[] = [];
  private dlPool: Drawable[] = [];
  private spike: Img | null = null;
  private hawk: Img | null = null;
  private arrow: Img | null = null;
  private star: Img | null = null;
  private camSnap = false;
  /** Camera look-ahead offset (leads the player's movement). */
  private lead = { x: 0, y: 0 };
  /** Recent dash positions for afterimages: x, y, age triples. */
  private trail: number[] = [];
  private trailT = 0;
  private dustT = 0;
  private lastLevel = 0;
  private pillarT = 0;
  /** Extra camera zoom-out while a Herald is on the field (eases in and out). */
  private frame = 1;
  /** Bite lunges: each enemy's last seen contact cooldown, and when its current lunge started (renderer clock). */
  private lastContact = new WeakMap<Enemy, number>();
  private lungeAt = new WeakMap<Enemy, number>();
  /** Champion facing, springing between −1 and 1 so turning reads as a quick pivot instead of a mirror snap. */
  private faceS = 1;
  /** Seconds left of the cast pose (the signature weapon just fired). */
  private castT = 0;
  private lastTimer = new WeakMap<Weapon, number>();
  private labels = new WeakMap<Enemy, string>();
  /** Recent positions of each projectile (ring buffer of x, y pairs + head index + count) for ribbon trails. */
  private ribbons = new WeakMap<Projectile, Float32Array>();
  /** World-space name tags, drawn after lighting so they stay readable in the dark. */
  private tags: { text: string; x: number; y: number; color: string; a: number }[] = [];
  /** Gem glints and magnet streaks collected while drawing pickups, drawn in the additive pass. */
  private glints: number[] = [];
  /** Magnet streaks: x, y, dx, dy quadruples with a parallel colour list. */
  private streaks: number[] = [];
  private streakCols: string[] = [];
  /**
   * Enemy sprites by colour set → numeric key (radius, tier, frame). The sprite factory keys its cache by
   * string; building thousands of those keys per frame (bodies + shadows) fed the garbage collector.
   */
  private enemySprites = new WeakMap<object, Map<number, Img>>();
  private grade: Grade = GRADES.ashen!;
  /** Chests seen last frame, and chests that were just opened (lid up, spilling light) with their age. */
  private chestsSeen = new Map<object, { x: number; y: number; boss: boolean }>();
  private chestsNow = new Map<object, { x: number; y: number; boss: boolean }>();
  private opened: { x: number; y: number; boss: boolean; t: number }[] = [];

  constructor(
    private canvas: HTMLCanvasElement,
    fx: FX,
    pref: BackendPreference = 'auto',
  ) {
    this.fx = fx;
    this.backend = (pref !== 'canvas2d' && WebGL2Backend.create(canvas)) || new Canvas2DBackend(canvas);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const q = this.quality || 1;
    // The GPU path can afford full Retina resolution; the Canvas2D fallback is capped lower.
    const maxDpr = this.backend.kind === 'webgl2' ? 2 : 1.5;
    this.dpr = Math.min(window.devicePixelRatio || 1, maxDpr) * q;
    const cw = window.innerWidth,
      ch = window.innerHeight;
    this.W = Math.max(1, Math.floor(cw * this.dpr));
    this.H = Math.max(1, Math.floor(ch * this.dpr));
    this.canvas.width = this.W;
    this.canvas.height = this.H;
    this.canvas.style.width = cw + 'px';
    this.canvas.style.height = ch + 'px';
    // Field of view depends on CSS size only, so every device sees the same amount of world.
    this.zoom = U.clamp(Math.min(cw / 1500, ch / 850) * 1.05, 0.5, 1.8) * this.dpr;
    this.backend.resize(this.W, this.H);
  }

  /** Jump the camera to the player on the next frame instead of easing there (new run). */
  snapCamera(): void {
    this.camSnap = true;
    // a new run: forget the last run's chests so they don't "open" as they vanish
    this.chestsSeen.clear();
    this.opened.length = 0;
  }

  setStage(stage: StageDef): void {
    this.stage = stage;
    this.chunkCache.clear();
    this.ground = null;
    this.grade = GRADES[stage.pal.id] ?? GRADES.ashen!;
  }

  worldToScreen(x: number, y: number): [number, number] {
    return [(x - this.cam.x) * this.zoom + this.W / 2, (y - this.cam.y) * this.zoom + this.H / 2];
  }

  private light(x: number, y: number, r: number, a: number, color: string | null = null): void {
    if (this.lightCols.length >= MAX_LIGHTS) return;
    this.lights.push(x, y, r, a);
    this.lightCols.push(color);
  }

  /**
   * @param g     the game, or null on the title screen
   * @param alpha interpolation factor between the previous and current simulation step
   * @param frameDt real seconds since the last frame (drives visual-only effects)
   */
  render(g: Game | null, alpha: number, frameDt: number): void {
    const st = g?.state ?? 'idle';
    const animate = st === 'play' || st === 'idle' || st === 'over';
    this.dt = animate ? frameDt : 0;
    this.clock += this.dt;
    if (g && st !== 'idle') {
      this.fx.soulX = g.player.x;
      this.fx.soulY = g.player.y;
    }
    this.fx.update(this.dt);
    const B = this.backend;
    if (!g || st === 'idle') {
      this.renderMenu(this.dt);
      return;
    }
    // positions only move while playing; freeze interpolation otherwise
    const a = st === 'play' ? alpha : 1;
    const p = g.player;
    const ppx = p.px + (p.x - p.px) * a,
      ppy = p.py + (p.y - p.py) * a;
    // lead the camera a little in the direction of travel, so you see more of what you walk into
    const lk = 1 - Math.exp(-3 * this.dt);
    this.lead.x += (p.move.x * 70 - this.lead.x) * lk;
    this.lead.y += (p.move.y * 50 - this.lead.y) * lk;
    const k = this.camSnap ? 1 : 1 - Math.exp(-10 * frameDt);
    if (this.camSnap) this.lead.x = this.lead.y = 0;
    this.camSnap = false;
    this.cam.x += (ppx + this.lead.x - this.cam.x) * k;
    this.cam.y += (ppy + this.lead.y - this.cam.y) * k;
    // frame boss fights a little wider, so the arena and its telegraphs fit on screen
    const wantFrame = g.boss && !g.boss.dead ? 0.88 : 1;
    this.frame += (wantFrame - this.frame) * (1 - Math.exp(-1.5 * frameDt));
    const baseZoom = this.zoom,
      viewZoom = baseZoom * this.frame;
    this.zoom = viewZoom * (1 + this.fx.zoom);
    // the simulation spawns just outside what's visible
    g.viewW = this.W / viewZoom / 2;
    g.viewH = this.H / viewZoom / 2;
    let sx = 0,
      sy = 0;
    if (this.fx.shakeAmt > 0) {
      sx = (Math.random() - 0.5) * this.fx.shakeAmt * this.dpr;
      sy = (Math.random() - 0.5) * this.fx.shakeAmt * this.dpr;
    }
    B.begin(this.stage.pal.sky);
    const z = this.zoom,
      tx = this.W / 2 - this.cam.x * z + sx,
      ty = this.H / 2 - this.cam.y * z + sy;
    B.setView(z, 0, 0, z, tx, ty);
    this.lights.length = 0;
    this.lightCols.length = 0;
    this.light(ppx, ppy - 10, 360, 1);
    this.light(ppx, ppy, 980, 0.42);
    const vw = g.viewW / (1 + Math.min(0, this.fx.zoom)) + 90,
      vh = g.viewH / (1 + Math.min(0, this.fx.zoom)) + 90;
    const x0 = this.cam.x - vw,
      y0 = this.cam.y - vh,
      x1 = this.cam.x + vw,
      y1 = this.cam.y + vh;
    this.drawGround(x0, y0, x1, y1);
    this.drawDetails(g.time, x0, y0, x1, y1);
    this.drawDecals(x0, y0, x1, y1);
    this.drawCloudShadows(g.time, x0, y0, x1, y1);
    this.drawShrines(g, x0, y0, x1, y1);
    this.drawZones(g);
    this.drawHazards(g);
    this.drawMines(g);
    this.drawTelegraphs();
    this.drawEnemyTelegraphs(g, a);
    this.collect(g, a, x0, y0, x1, y1, ppx, ppy);
    this.drawShadows(g, a, ppx, ppy);
    this.drawCorpses();
    this.drawPickups(g, a, x0, y0, x1, y1);
    this.drawSorted(g, a, ppx, ppy);
    this.drawGroundParticles();
    this.drawEnemyProjectiles(g, a);
    this.drawProjectiles(g, a);
    this.drawFog(g, x0, y0, x1, y1);
    this.drawLighting(g);
    B.setView(z, 0, 0, z, tx, ty);
    this.drawAdditive(g, a, ppx, ppy);
    this.drawTexts();
    this.drawPlayerBars(g, ppx, ppy);
    B.setView(1, 0, 0, 1, 0, 0);
    this.drawPost(g);
    this.drawIndicators(g, a);
    B.setPost(this.postEnabled ? this.gradeFrame(g) : null);
    B.end();
    this.zoom = baseZoom;
  }

  /* ------------------------------ world layers ------------------------------ */

  private drawGround(x0: number, y0: number, x1: number, y1: number): void {
    this.ground ??= S.groundTile(this.stage.pal);
    this.backend.pattern(this.ground, x0, y0, x1, y1);
  }

  /** Props and ground details of one 320-unit world chunk, generated once from a hash of its coordinates. */
  private chunk(cx: number, cy: number): Chunk {
    const key = cx + ',' + cy;
    let c = this.chunkCache.get(key);
    if (c) return c;
    const pal = this.stage.pal,
      seed = pal.seed;
    const props: PropInst[] = [],
      details: DetailInst[] = [];
    const h = (i: number, j: number) => U.hash2(cx * 31 + i * 7, cy * 17 + j * 13, seed + i * 3 + j);
    for (const { x, y, kind, variant } of propLayout(cx, cy, this.stage)) {
      const sprite = S.prop(kind, variant, pal);
      const res = sprite.res ?? 1;
      props.push({ x, y, sprite, kind, hw: sprite.width / res / 2, h: (sprite.oy ?? sprite.height) / res });
    }
    const gd = GROUND_DETAILS[pal.id];
    if (gd) {
      const nd = 2 + Math.floor(h(1, 1) * 4);
      for (let i = 0; i < nd && gd.decals.length; i++) {
        const kind = gd.decals[Math.floor(h(2, i) * gd.decals.length)]!;
        if (kind === 'runecircle') continue;
        details.push({
          x: cx * CHUNK + h(3, i) * CHUNK,
          y: cy * CHUNK + h(4, i) * CHUNK,
          sprite: S.groundDetail(kind, Math.floor(h(5, i) * 997), pal),
          rot: kind === 'runecircle' ? 0 : h(6, i) * TAU,
          s: 0.75 + h(7, i) * 0.6,
          a: 0.55 + h(8, i) * 0.4,
          glow: null,
          rune: kind === 'runecircle',
          phase: h(10, i) * TAU,
        });
      }
      // a ritual circle is a landmark: rare, faint, slowly breathing
      if (h(19, 0) < 0.06)
        details.push({
          x: cx * CHUNK + CHUNK * (0.25 + h(20, 0) * 0.5),
          y: cy * CHUNK + CHUNK * (0.25 + h(21, 0) * 0.5),
          sprite: S.groundDetail('runecircle', Math.floor(h(22, 0) * 997), pal),
          rot: 0,
          s: 0.9 + h(23, 0) * 0.4,
          a: 0.3 + h(24, 0) * 0.15,
          glow: null,
          rune: true,
          phase: h(25, 0) * TAU,
        });
      const glows = gd.glow.filter((k) => k !== 'runecircle');
      if (glows.length && h(11, 0) < 0.3) {
        const kind = glows[Math.floor(h(12, 0) * glows.length)]!;
        details.push({
          x: cx * CHUNK + h(13, 0) * CHUNK,
          y: cy * CHUNK + h(14, 0) * CHUNK,
          sprite: S.groundDetail(kind, Math.floor(h(15, 0) * 997), pal),
          rot: h(16, 0) * TAU,
          s: 0.8 + h(17, 0) * 0.5,
          a: 1,
          glow: GLOW_DETAIL[kind] ?? pal.rune ?? pal.ember,
          rune: false,
          phase: h(18, 0) * TAU,
        });
      }
    }
    c = { props, details };
    this.chunkCache.set(key, c);
    if (this.chunkCache.size > 900) this.chunkCache.delete(this.chunkCache.keys().next().value!);
    return c;
  }

  private drawDetails(t: number, x0: number, y0: number, x1: number, y1: number): void {
    const B = this.backend,
      rune = this.stage.pal.rune ?? this.stage.pal.ember;
    for (let cy = Math.floor((y0 - 100) / CHUNK); cy <= Math.floor((y1 + 100) / CHUNK); cy++)
      for (let cx = Math.floor((x0 - 100) / CHUNK); cx <= Math.floor((x1 + 100) / CHUNK); cx++)
        for (const d of this.chunk(cx, cy).details) {
          if (d.rune) {
            // a ritual circle that slowly breathes, its glyph turning
            const pulse = 0.5 + 0.5 * Math.sin(t * 0.9 + d.phase);
            B.image(d.sprite, d.x, d.y, { sx: d.s, sy: d.s * 0.92, rot: t * 0.05 + d.phase, alpha: d.a * (0.45 + pulse * 0.4) });
            this.light(d.x, d.y, 120 * d.s, 0.08 + pulse * 0.12, rune);
          } else if (d.glow) {
            const pulse = 0.7 + 0.3 * Math.sin(t * 1.7 + d.phase);
            B.image(d.sprite, d.x, d.y, { sx: d.s, rot: d.rot, alpha: 0.85 + pulse * 0.15 });
            this.light(d.x, d.y, 150 * d.s, 0.55 * pulse, d.glow);
          } else B.image(d.sprite, d.x, d.y, { sx: d.s, rot: d.rot, alpha: d.a });
        }
  }

  /** Huge, faint cloud shadows sliding across the ground: the world breathes even when nothing moves. */
  private drawCloudShadows(t: number, x0: number, y0: number, x1: number, y1: number): void {
    const w = x1 - x0,
      h = y1 - y0;
    for (let i = 0; i < 4; i++) {
      const fx = ((U.hash2(i, 5, 3) * 2 + t * (0.006 + i * 0.002)) % 2) - 0.5,
        fy = ((U.hash2(i, 6, 3) * 2 + t * 0.003) % 2) - 0.5;
      this.backend.radial(x0 + fx * w, y0 + fy * h, 380 + U.hash2(i, 7, 3) * 300, '#000', 0.16, '#000', 0.08, 0.6);
    }
  }

  private drawFog(g: Game, x0: number, y0: number, x1: number, y1: number): void {
    const t = g.time,
      pal = this.stage.pal,
      w = x1 - x0,
      h = y1 - y0;
    for (let i = 0; i < 9; i++) {
      const fx = ((U.hash2(i, 1, 7) * 1.7 + t * (0.015 + i * 0.004)) % 1.7) - 0.35;
      const fy = ((U.hash2(i, 2, 7) * 1.7 + Math.sin(t * 0.1 + i) * 0.05) % 1.7) - 0.35;
      this.backend.glow(x0 + fx * w, y0 + fy * h, 180 + U.hash2(i, 3, 7) * 200, pal.fog, 0.14);
    }
    const wx = WEATHER[pal.id] ?? WEATHER.ashen!;
    if (this.dt > 0) {
      let n = wx.rate * this.dt * 60;
      while (n > 0) {
        if (Math.random() < n)
          this.fx.ambient(
            x0 + Math.random() * w,
            y0 + Math.random() * h,
            U.lerp(wx.vx[0], wx.vx[1], Math.random()),
            U.lerp(wx.vy[0], wx.vy[1], Math.random()),
            wx.life,
            U.lerp(wx.size[0], wx.size[1], Math.random()),
            wx.color ?? pal.ember,
          );
        n -= 1;
      }
    }
  }

  /** Scorch marks and splats: soft ground stains under everything else. */
  private drawDecals(x0: number, y0: number, x1: number, y1: number): void {
    const B = this.backend;
    for (const d of this.fx.decals) {
      if (d.x < x0 - d.r || d.x > x1 + d.r || d.y < y0 - d.r || d.y > y1 + d.r) continue;
      const k = Math.min(1, d.life / (d.max * 0.4));
      if (d.kind === 'scorch') {
        B.radial(d.x, d.y, d.r, '#000', 0.5 * k, '#120a06', 0.35 * k, 0.6);
        // embers cool from orange to nothing at the scorch's heart
        const heat = Math.max(0, 1 - (d.max - d.life) / 1.5);
        if (heat > 0) B.radial(d.x, d.y, d.r * 0.6, '#ff8a3c', 0.35 * heat, '#ff3a10', 0.12 * heat, 0.5);
        B.ring(d.x, d.y, d.r * 0.7, d.r * 0.55, d.rot, d.r * 0.25, d.color, 0.1 * k, 2);
      } else {
        B.ellipse(d.x, d.y, d.r, d.r * 0.55, d.rot, '#000', 0.28 * k);
        B.ellipse(d.x + Math.cos(d.rot) * d.r * 0.3, d.y, d.r * 0.55, d.r * 0.35, d.rot + 1, d.color, 0.25 * k);
      }
    }
  }

  private drawShrines(g: Game, x0: number, y0: number, x1: number, y1: number): void {
    const B = this.backend,
      t = g.time;
    for (const s of g.shrines) {
      if (s.x < x0 - 80 || s.x > x1 + 80 || s.y < y0 - 140 || s.y > y1 + 80) continue;
      const def = SHRINE_DEFS[s.kind],
        fade = s.used ? Math.max(0, 1 - (t - s.usedAt) / 3) : Math.min(1, s.age * 2),
        pulse = 0.75 + Math.sin(t * 3 + s.id) * 0.25;
      B.ellipse(s.x, s.y + 4, 44, 14, 0, '#000', 0.45 * fade);
      B.radial(s.x, s.y, s.r * 1.4, def.color, 0.18 * pulse * fade, def.color, 0.08 * fade, 0.6);
      B.ring(s.x, s.y, s.r, s.r * 0.42, 0, 2, def.color, 0.55 * pulse * fade);
      // channelling: runes orbit faster and closer as the charge fills
      if (s.charge > 0 && !s.used) {
        B.arc(s.x, s.y - 2, s.r * 0.75, -Math.PI / 2 + s.charge * Math.PI, s.charge * Math.PI, 5, def.color, 0.95);
        for (let i = 0; i < 5; i++) {
          const an = t * (2 + s.charge * 6) + (i / 5) * TAU,
            rr = s.r * (1.1 - s.charge * 0.5);
          B.circle(s.x + Math.cos(an) * rr, s.y + Math.sin(an) * rr * 0.42 - 20 * s.charge, 3, def.color, 0.9);
        }
      }
      B.image(S.shrine(s.kind, def.color), s.x, s.y + 4, { alpha: s.used ? fade * 0.5 : fade });
      if (!s.used && this.dt > 0 && Math.random() < 0.25)
        this.fx.ambient(s.x + U.lerp(-14, 14, Math.random()), s.y - 40, U.lerp(-6, 6, Math.random()), -26, 1.4, 2.5, def.color);
      this.light(s.x, s.y - 30, 170, (0.7 + s.charge * 0.6) * fade, def.color);
    }
    if (g.trial) {
      const tr = g.trial,
        k = tr.t / TRIAL_TIME;
      B.ring(tr.x, tr.y, 220, 220, 0, 3, '#c084fc', 0.35);
      B.arc(tr.x, tr.y, 228, -Math.PI / 2 + k * Math.PI, k * Math.PI, 6, '#e9d5ff', 0.8);
      this.light(tr.x, tr.y, 260, 0.3, '#c084fc');
    }
  }

  private drawHazards(g: Game): void {
    const B = this.backend,
      t = g.time;
    for (const h of g.hazards) {
      const age = h.max - h.life,
        armed = age >= h.arm,
        k = Math.min(1, age / Math.max(0.01, h.arm), h.life * 1.5);
      const wob = 1 + Math.sin(t * 5 + h.x) * 0.04;
      B.radial(h.x, h.y, h.r * wob, h.color, (armed ? 0.5 : 0.18) * k, h.color, (armed ? 0.25 : 0.1) * k, 0.65);
      B.ring(h.x, h.y, h.r * wob, h.r * wob, 0, armed ? 2 : 1.5, h.color, (armed ? 0.7 : 0.4 + Math.sin(t * 20) * 0.2) * k);
      if (armed && this.dt > 0 && Math.random() < 0.15)
        this.fx.burst(h.x + U.lerp(-h.r, h.r, Math.random()) * 0.7, h.y + U.lerp(-h.r, h.r, Math.random()) * 0.5, h.color, 1, {
          speed: 20,
          life: 0.6,
          up: true,
          size: 3,
        });
      if (armed) this.light(h.x, h.y, h.r * 1.8, 0.45 * k, h.color);
    }
  }

  private drawZones(g: Game): void {
    const B = this.backend,
      t = g.time;
    // late game stacks many pools at once (Sanctified Deluge, fire trails, spore clouds): each dims as they pile up
    const crowd = crowdFade(g.zones.length, 5) * this.fx.intensity;
    for (const z of g.zones) {
      const life = Math.max(0, Math.min(1, z.age * 4, (z.dur - z.age) * 2)),
        fade = life * crowd * sizeFade(z.r, 110);
      if (z.kind === 'blackhole') {
        B.radial(z.x, z.y, z.r, '#000', life, '#0a0019', 0.95 * life, 0.55);
        B.ring(z.x, z.y, z.r * 0.85, z.r * 0.85, 0, z.r * 0.25, z.color, 0.4 * fade, 1.5);
        B.ring(z.x, z.y, z.r * 1.05, z.r * 0.35, t * 2, 2, z.color, 0.8 * life);
        // matter spiralling in
        if (this.dt > 0 && Math.random() < 0.6) {
          const an = Math.random() * TAU;
          this.fx.trail(z.x + Math.cos(an) * z.r * 1.3, z.y + Math.sin(an) * z.r * 1.3, z.color, 3);
        }
        this.light(z.x, z.y, softR(z.r) * 1.4, 0.45 * life * this.fx.intensity, z.color);
      } else if (z.kind === 'laser') {
        const I = this.fx.intensity;
        B.radial(z.x, z.y, z.r, '#fff', 0.75 * life * I, z.color, 0.55 * life * I, 0.4);
        this.light(z.x, z.y, z.r * 2, 0.75 * I, z.color);
      } else {
        const pulse = 0.85 + Math.sin(t * 6 + z.x) * 0.15;
        B.radial(z.x, z.y, z.r, z.color, 0.28 * pulse * fade, z.color, 0.16 * fade, 0.7);
        const rr = z.r * (0.95 + Math.sin(t * 4) * 0.03);
        // the rim stays crisp so the pool's reach is always readable, however faint its fill
        B.ring(z.x, z.y, rr, rr, 0, 1.5, z.color, 0.45 * pulse * life);
        if (z.kind === 'fire' && this.dt > 0 && Math.random() < 0.6 * crowd)
          this.fx.burst(z.x + U.lerp(-z.r, z.r, Math.random()) * 0.8, z.y + U.lerp(-z.r, z.r, Math.random()) * 0.8, '#ff9a3c', 1, {
            speed: 20,
            life: 0.5,
            up: true,
            size: 3,
          });
        this.light(z.x, z.y, softR(z.r) * 1.3, 0.4 * fade, z.color);
      }
    }
  }

  private drawMines(g: Game): void {
    const B = this.backend;
    for (const m of g.mines) {
      const pulse = 0.5 + Math.sin(g.time * 6 + m.pulse) * 0.5;
      B.glow(m.x, m.y, 14, m.color, 1);
      B.circle(m.x, m.y, 7, '#223', 1);
      B.circle(m.x, m.y, 3.5, m.color, 0.5 + pulse * 0.5);
      if (m.armT <= 0) B.ring(m.x, m.y, m.r * 0.45, m.r * 0.45, 0, 1, m.color, 0.15 + pulse * 0.15);
      this.light(m.x, m.y, 50, 0.4 + pulse * 0.3, m.color);
    }
  }

  private drawTelegraphs(): void {
    const B = this.backend,
      t = this.clock;
    for (const tg of this.fx.tele) {
      const k = tg.t / tg.max,
        urgent = 0.5 + 0.5 * Math.sin(t * (10 + k * 30));
      if (tg.type === 'circle') {
        const c = tg.color || '#f87171';
        // the danger fills inward-out; the rim beats faster as impact nears
        B.circle(tg.x, tg.y, tg.r, c, 0.1 + k * 0.08);
        B.radial(tg.x, tg.y, tg.r * easeOut(k), c, 0.05, c, 0.3, 0.85);
        B.ring(tg.x, tg.y, tg.r, tg.r, 0, 2.5, c, 0.55 + urgent * 0.35 * k);
        B.ring(tg.x, tg.y, tg.r * 0.55, tg.r * 0.55, 0, 1, c, 0.25);
        this.light(tg.x, tg.y, tg.r * 1.4, 0.25 + k * 0.35, c);
      } else if (!tg.e.dead) {
        const e = tg.e,
          ang = Math.atan2(tg.py - e.y, tg.px - e.x),
          len = 520,
          dx = Math.cos(ang),
          dy = Math.sin(ang);
        B.line(e.x, e.y, e.x + dx * len, e.y + dy * len, e.r * 2, '#f87171', 0.12);
        B.line(e.x, e.y, e.x + dx * len * easeOut(k), e.y + dy * len * easeOut(k), e.r * 2, '#f87171', 0.35);
        // chevrons racing along the charge lane
        for (let i = 0; i < 5; i++) {
          const f = (i / 5 + t * 1.6) % 1,
            cx = e.x + dx * len * f,
            cy = e.y + dy * len * f;
          B.arc(cx - dx * 10, cy - dy * 10, e.r * 0.9, ang, 0.9, 3, '#fecaca', 0.55 * (1 - f) * (0.4 + k));
        }
      }
    }
  }

  /** Build the y-sorted draw list of everything that stands on the ground. */
  private collect(g: Game, a: number, x0: number, y0: number, x1: number, y1: number, ppx: number, ppy: number): void {
    const dl = this.dl,
      pool = this.dlPool;
    let n = 0;
    const push = (y: number, k: DK, ref: Drawable['ref'], x: number) => {
      const d = pool[n] ?? (pool[n] = { y: 0, k: DK.Prop, ref: null, x: 0 });
      d.y = y;
      d.k = k;
      d.ref = ref;
      d.x = x;
      dl[n++] = d;
    };
    for (let cy = Math.floor(y0 / CHUNK); cy <= Math.floor((y1 + 120) / CHUNK); cy++)
      for (let cx = Math.floor(x0 / CHUNK); cx <= Math.floor(x1 / CHUNK); cx++)
        for (const pr of this.chunk(cx, cy).props) {
          if (pr.x < x0 - pr.hw || pr.x > x1 + pr.hw || pr.y < y0 || pr.y - pr.h > y1) continue;
          push(pr.y, DK.Prop, pr, pr.x);
        }
    for (const e of g.enemies) {
      if (e.dead) continue;
      const x = e.px + (e.x - e.px) * a,
        y = e.py + (e.y - e.py) * a;
      if (x < x0 - 60 || x > x1 + 60 || y < y0 - 60 || y > y1 + 60) continue;
      push(y + e.r * 0.8, DK.Enemy, e, x);
    }
    for (const al of g.allies) push(al.py + (al.y - al.py) * a + 12, DK.Ally, al, 0);
    push(ppy + 22, DK.Player, null, ppx);
    dl.length = n;
    dl.sort((p, q) => p.y - q.y);
  }

  /**
   * Cast shadows: every standing thing's silhouette, squashed onto the ground and sheared away from the
   * light, plus a small contact shadow at its feet. Fliers get a soft blob far below them.
   */
  private drawShadows(g: Game, a: number, ppx: number, ppy: number): void {
    const B = this.backend,
      // in a very dense horde small fodder keeps only its contact shadow; low quality keeps no silhouettes
      dense = this.dl.length > 520 || this.quality < 0.7,
      cast = this.quality >= 0.5;
    for (const d of this.dl) {
      if (d.k === DK.Prop) {
        const pr = d.ref as PropInst;
        // props bake their own contact shadow; add the cast one
        if (cast) B.image(pr.sprite, pr.x, pr.y, { sy: SHADOW_SQUASH, skew: SHADOW_SKEW, tint: '#000', tintA: 1, alpha: 0.32 });
      } else if (d.k === DK.Enemy) {
        const e = d.ref as Enemy;
        const ey = e.py + (e.y - e.py) * a;
        if (e.buried) continue; // the dirt mound is its own shadow
        if (FLIERS.has(e.type)) {
          B.ellipse(d.x, ey + e.r * 1.4, e.r * 0.9, e.r * 0.32, 0, '#000', 0.28);
          continue;
        }
        const sp = this.enemySprite(e),
          res = sp.res ?? 1,
          fy = e.r * 0.8;
        B.ellipse(d.x, ey + fy, e.r * 0.75, e.r * 0.25, 0, '#000', 0.3);
        if (cast && e.spawnT <= 0 && (!dense || e.r >= 16))
          B.image(sp, d.x, ey + fy, {
            sx: this.facing(e),
            sy: SHADOW_SQUASH,
            oy: (sp.oy ?? sp.height / 2) + fy * res,
            skew: SHADOW_SKEW,
            tint: '#000',
            tintA: 1,
            alpha: 0.26,
          });
      } else if (d.k === DK.Ally) {
        const al = d.ref as Ally;
        B.ellipse(al.px + (al.x - al.px) * a, al.py + (al.y - al.py) * a + 12, 10, 4, 0, '#000', 0.35);
      }
    }
    const hero = S.hero(g.player.char, 0);
    B.ellipse(ppx, ppy + 22, 15, 5, 0, '#000', 0.4);
    B.image(hero, ppx, ppy + 22, {
      sx: 1.15 * this.faceS,
      sy: 1.15 * SHADOW_SQUASH,
      skew: SHADOW_SKEW,
      tint: '#000',
      tintA: 1,
      alpha: 0.3,
    });
  }

  /** Which way an enemy sprite faces: Bastion Knights turn their shield (drawn on +x) towards the champion. */
  private facing(e: Enemy): number {
    return e.face != null ? (Math.cos(e.face) < 0 ? -1 : 1) : e.flip;
  }

  /** A Grave Worm tunnelling: a churning mound of earth that trails dirt, quaking before it erupts. */
  private drawMound(e: Enemy, x: number, y: number): void {
    const B = this.backend,
      b = e.burrow,
      erupt = b && b.phase === 'erupt' ? 1 - b.t / Math.max(0.01, b.max) : 0;
    const quake = erupt > 0 ? (Math.random() - 0.5) * 4 * erupt : 0;
    const frame = Math.floor((((e.anim * 0.5) % 1) * ENEMY_FRAMES + ENEMY_FRAMES) % ENEMY_FRAMES);
    B.image(S.burrowMound(e.r, frame), x + quake, y + e.r * 0.4, { sx: 1 + erupt * 0.35, sy: 1 + erupt * 0.25 });
    if (this.dt > 0 && Math.random() < 0.35 + erupt) this.fx.debris(x, y + e.r * 0.4, '#4a3a30', 1, 70 + erupt * 160, 2.5 + erupt * 2, 0.7);
    if (erupt > 0) this.light(x, y, 90, 0.4 * erupt, e.def.col.eye);
  }

  /**
   * Ground-level warnings that live on enemies: banshee scream cones, Herald sweep lines, totem auras and the
   * cracking earth over an erupting Grave Worm.
   */
  private drawEnemyTelegraphs(g: Game, a: number): void {
    const B = this.backend,
      t = this.clock;
    for (const e of g.enemies) {
      if (e.dead) continue;
      const ex = e.px + (e.x - e.px) * a,
        ey = e.py + (e.y - e.py) * a;
      const sc = e.scream;
      if (sc) {
        // the cone fills from the banshee outwards; its edge sharpens as the wail builds
        const k = 1 - sc.t / Math.max(0.01, sc.max),
          urgent = 0.5 + 0.5 * Math.sin(t * (14 + k * 30));
        B.sector(ex, ey, sc.range, sc.ang, sc.arc / 2, '#c4b5fd', 0.05 + k * 0.06);
        B.sector(ex, ey, sc.range * easeOut(k), sc.ang, sc.arc / 2, '#a78bfa', 0.15);
        B.arc(ex, ey, sc.range, sc.ang, sc.arc / 2, 3, '#ede9fe', 0.4 + urgent * 0.5 * k);
        B.line(ex, ey, ex + Math.cos(sc.ang - sc.arc / 2) * sc.range, ey + Math.sin(sc.ang - sc.arc / 2) * sc.range, 1.5, '#ddd6fe', 0.5);
        B.line(ex, ey, ex + Math.cos(sc.ang + sc.arc / 2) * sc.range, ey + Math.sin(sc.ang + sc.arc / 2) * sc.range, 1.5, '#ddd6fe', 0.5);
        this.light(ex + Math.cos(sc.ang) * sc.range * 0.5, ey + Math.sin(sc.ang) * sc.range * 0.5, sc.range * 0.7, 0.35 * k, '#a78bfa');
      }
      if (e.auraR) {
        const pulse = 0.5 + 0.5 * Math.sin(t * 2.5 + e.id),
          wave = (t * 0.5) % 1,
          wr = e.auraR * (0.3 + wave * 0.7);
        B.radial(ex, ey, e.auraR, '#7e22ce', 0.02, '#a21caf', 0.12 + pulse * 0.05, 0.85);
        B.ring(ex, ey, e.auraR, e.auraR * 0.92, 0, 2, '#e879f9', 0.35 + pulse * 0.25);
        B.ring(ex, ey, wr, wr * 0.92, 0, 1.5, '#f0abfc', 0.4 * (1 - wave));
        this.light(ex, ey, e.auraR * 1.2, 0.35 + pulse * 0.15, '#c026d3');
      }
      const at = e.attack;
      if (at && at.type === 'sweep' && at.phase === 'windup' && at.len && at.wid && at.ang != null) {
        const k = 1 - (at.t ?? 0) / Math.max(0.01, at.max ?? 0.9),
          ca = Math.cos(at.ang),
          sa = Math.sin(at.ang),
          c = e.def.col.eye;
        B.line(ex, ey, ex + ca * at.len, ey + sa * at.len, at.wid, c, 0.12 + k * 0.12);
        B.line(ex, ey, ex + ca * at.len * easeOut(k), ey + sa * at.len * easeOut(k), at.wid * 0.3, c, 0.5);
        // where it will swing: a faint arc at the beam's reach
        if (at.dir) B.arc(ex, ey, at.len, at.ang + at.dir * 1.13, 1.13, 2, c, 0.25 + k * 0.3);
      }
      const bw = e.burrow;
      if (bw && bw.phase === 'erupt' && e.def.burrow) {
        const k = 1 - bw.t / Math.max(0.01, bw.max),
          R = e.def.burrow.r;
        for (let i = 0; i < 6; i++) {
          const an = (i / 6) * TAU + e.id,
            len = R * (0.3 + k * 0.7) * (0.7 + U.hash2(i, e.id, 9) * 0.3);
          B.line(ex, ey, ex + Math.cos(an) * len, ey + Math.sin(an) * len * 0.7, 2.5, '#1a1210', 0.7);
        }
      }
    }
  }

  /** Cached `S.enemy` lookup without string keys (colour sets are shared per enemy definition). */
  private spriteOf(type: string, r: number, col: Enemy['def']['col'], tier: number, frame: number): Img {
    let m = this.enemySprites.get(col);
    if (!m) this.enemySprites.set(col, (m = new Map()));
    const key = r * 4096 + tier * 64 + frame;
    let sp = m.get(key);
    if (!sp) m.set(key, (sp = S.enemy(type, r, col, tier, frame)));
    return sp;
  }

  /** Enemy sprite for the current locomotion frame. */
  private enemySprite(e: Enemy): Img {
    const tier = e.boss ? 0 : e.elite ? 3 : e.tier;
    if (ENEMY_FRAMES <= 1) return this.spriteOf(e.type, e.r, e.def.col, tier, 0);
    const frozen = (e.st.freeze ?? 0) > 0 || (e.st.stun ?? 0) > 0;
    const rate = ANIM_RATE[e.type] ?? (e.boss ? 0.2 : 0.34);
    const ph = frozen ? (e.id * 0.618) % 1 : (e.anim * rate + e.id * 0.618) % 1;
    return this.spriteOf(e.type, e.r, e.def.col, tier, Math.floor(ph * ENEMY_FRAMES) % ENEMY_FRAMES);
  }

  /** The fallen topple, then burn away into embers of their eye colour. */
  private drawCorpses(): void {
    const B = this.backend;
    for (const c of this.fx.corpses) {
      const age = c.max - c.life,
        fallK = easeOut(Math.min(1, age / 0.18)),
        dis = Math.max(0, (age - (c.boss ? 0.4 : 0.12)) / (c.max - (c.boss ? 0.4 : 0.12)));
      B.image(this.spriteOf(c.type, c.r, c.col, c.tier, 0), c.x, c.y + c.r * 0.25 * fallK, {
        sx: c.flip,
        sy: 1 - 0.18 * fallK,
        rot: c.fall * 0.5 * fallK,
        dissolve: Math.max(0.001, dis),
        edge: c.col.eye,
        seed: c.seed,
        alpha: 0.95,
      });
      if (dis > 0 && dis < 0.9 && this.dt > 0 && Math.random() < (c.boss ? 1 : 0.3))
        this.fx.ambient(
          c.x + U.lerp(-c.r, c.r, Math.random()) * 0.7,
          c.y - c.r * 0.3,
          U.lerp(-10, 10, Math.random()),
          -40,
          0.8,
          2.5,
          c.col.eye,
        );
      if (c.boss || c.r > 20) this.light(c.x, c.y, c.r * 3, 0.5 * (1 - dis), c.col.eye);
    }
  }

  private drawPickups(g: Game, a: number, x0: number, y0: number, x1: number, y1: number): void {
    const B = this.backend,
      t = g.time,
      clock = this.clock;
    let lights = 0;
    // chests that vanished since last frame were opened: leave the open chest behind for a moment
    const now = this.chestsNow;
    now.clear();
    for (const k of g.pickups)
      if (!k.dead && (k.kind === 'chest' || k.kind === 'bosschest')) now.set(k, { x: k.x, y: k.y, boss: k.kind === 'bosschest' });
    for (const [k, c] of this.chestsSeen)
      if (!now.has(k) && g.state !== 'over') {
        this.opened.push({ ...c, t: 0 });
        this.fx.burst(c.x, c.y - 6, c.boss ? '#ff6ac1' : '#ffd700', 24, { speed: 160, life: 0.8, up: true, size: 4 });
        this.fx.debris(c.x, c.y, '#f5c542', 12, 160, 3.5, 1.4, 0, 0, 8);
        this.fx.shockwave(c.x, c.y, 160, 10, 0.4);
      }
    this.chestsNow = this.chestsSeen;
    this.chestsSeen = now;
    let w = 0;
    for (const o of this.opened) {
      o.t += this.dt;
      if (o.t > 1.6) continue;
      this.opened[w++] = o;
      const fade = Math.min(1, (1.6 - o.t) * 2);
      B.image(S.chestOpen(o.boss), o.x, o.y, { alpha: fade });
      B.setBlend('add');
      B.line(o.x, o.y - 4, o.x, o.y - 140, 30 * fade, o.boss ? '#ff6ac1' : '#ffd27a', 0.35 * fade, 1.5, o.boss ? '#ff6ac1' : '#ffd27a', 0);
      B.setBlend('normal');
      this.light(o.x, o.y - 10, 200, fade, o.boss ? '#ff6ac1' : '#ffd27a');
    }
    this.opened.length = w;
    this.glints.length = 0;
    this.streaks.length = 0;
    this.streakCols.length = 0;
    for (const k of g.pickups) {
      const x = k.px + (k.x - k.px) * a,
        y = k.py + (k.y - k.py) * a;
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      // fresh drops hop out of the body before settling
      const hop = k.age < 0.45 ? Math.sin((k.age / 0.45) * Math.PI) * 16 * (1 - k.age) : 0;
      const bob = Math.sin(t * 4 + k.bob) * 2 + hop;
      if (k.kind !== 'brazier') B.ellipse(x, y + 7, 6, 2.2, 0, '#000', 0.3);
      if (k.pull) {
        const dx = k.x - k.px,
          dy = k.y - k.py;
        if (dx * dx + dy * dy > 4 && this.streakCols.length < 300) {
          this.streaks.push(x, y - bob, dx, dy);
          this.streakCols.push(k.kind === 'gold' ? '#f5c542' : GEM_COLOR[k.gem ?? 'blue']);
        }
      }
      if (k.kind === 'gem') {
        const gem = k.gem ?? 'blue';
        B.image(S.gem(GEM_COLOR[gem], gem === 'purple' ? 8 : gem === 'red' ? 7 : 6), x, y - bob);
        if ((clock * 0.6 + k.bob) % 2.4 < 0.25 && this.glints.length < 240)
          this.glints.push(x + 2, y - bob - 5, ((clock * 0.6 + k.bob) % 2.4) / 0.25);
        if (gem !== 'blue' && lights < 60 && ++lights) this.light(x, y, 40, 0.35, GEM_COLOR[gem]);
      } else if (k.kind === 'gold') B.image(S.coinFrame(6, Math.floor(clock * 10 + k.bob * 3) % 6), x, y - bob);
      else if (k.kind === 'mat') B.image(S.pickup('material'), x, y - bob, { tint: MAT_BY_ID[k.mat ?? 'iron']!.color, tintA: 0.45 });
      else {
        B.image(S.pickup(k.kind), x, y - (k.kind === 'brazier' ? 0 : bob));
        if (k.kind === 'brazier' || k.kind === 'chest' || k.kind === 'bosschest' || k.kind === 'ember') {
          if (lights++ < 30) {
            const flick = k.kind === 'brazier' ? 0.85 + Math.sin(clock * 17 + k.bob) * 0.1 + Math.sin(clock * 29) * 0.05 : 1;
            this.light(
              x,
              y - 8,
              k.kind === 'brazier' ? 170 : 120,
              0.85 * flick,
              k.kind === 'bosschest' ? '#ff6ac1' : k.kind === 'chest' ? '#ffd27a' : '#ff9a3c',
            );
          }
          if (k.kind === 'brazier' && this.dt > 0 && Math.random() < 0.35)
            this.fx.burst(x + U.lerp(-4, 4, Math.random()), y - 8, '#ff9a3c', 1, { speed: 20, life: 0.7, up: true, size: 3 });
          if ((k.kind === 'chest' || k.kind === 'bosschest') && this.dt > 0 && Math.random() < 0.2)
            this.fx.ambient(x + U.lerp(-12, 12, Math.random()), y - 6, 0, -30, 0.9, 2, k.kind === 'chest' ? '#ffd700' : '#ff44aa');
        }
      }
    }
  }

  /** The y-sorted pass: props, enemies, allies and the champion, back to front. */
  private drawSorted(g: Game, a: number, ppx: number, ppy: number): void {
    for (const d of this.dl) {
      if (d.k === DK.Enemy) this.drawEnemy(g, d.ref as Enemy, a);
      else if (d.k === DK.Prop) this.drawProp(d.ref as PropInst, ppx, ppy, g.time);
      else if (d.k === DK.Ally) this.drawAlly(g, d.ref as Ally, a);
      else this.drawPlayer(g, ppx, ppy);
    }
  }

  private drawProp(pr: PropInst, ppx: number, ppy: number, t: number): void {
    // tall props turn translucent while the champion is behind them
    const behind = ppy < pr.y - 4 && ppy > pr.y - pr.h - 20 && Math.abs(ppx - pr.x) < pr.hw * 0.8;
    this.backend.image(pr.sprite, pr.x, pr.y, { alpha: behind ? 0.45 : 1 });
    const L = PROP_LIGHTS[pr.kind];
    if (L) this.light(pr.x, pr.y + L.dy, L.r, 0.6 + Math.sin(t * 2.3 + pr.x) * 0.08, L.color);
  }

  private drawEnemy(g: Game, e: Enemy, a: number): void {
    const B = this.backend,
      t = g.time,
      tint = this.stage.enemyTint;
    let ex = e.px + (e.x - e.px) * a,
      ey = e.py + (e.y - e.py) * a;
    if (e.buried) {
      this.drawMound(e, ex, ey);
      return;
    }
    const sp = this.enemySprite(e);
    const flip = this.facing(e);
    const frozen = (e.st.freeze ?? 0) > 0;
    // bite: the contact cooldown just reset next to the champion → lunge at them
    const pdx = g.player.x - e.x,
      pdy = g.player.y - e.y,
      pd2 = pdx * pdx + pdy * pdy,
      reach = e.r + 60;
    if (pd2 < reach * reach) {
      const last = this.lastContact.get(e);
      this.lastContact.set(e, e.contactCd);
      if (last != null && e.contactCd > last + 0.2) this.lungeAt.set(e, this.clock);
      const since = this.clock - (this.lungeAt.get(e) ?? -1);
      if (since < 0.16) {
        const k = Math.sin((since / 0.16) * Math.PI),
          d = Math.sqrt(pd2) || 1,
          reachK = Math.min(10, e.r * 0.5);
        ex += (pdx / d) * k * reachK;
        ey += (pdy / d) * k * reachK;
      }
    }
    // lean into the stride; knockback stretches the body along the shove
    const mvx = e.x - e.px,
      lean = frozen ? 0 : U.clamp(mvx * 0.05, -0.14, 0.14),
      shove = Math.min(0.25, Math.hypot(e.vx, e.vy) / 900);
    const flier = FLIERS.has(e.type);
    const bobY = frozen ? 0 : flier ? Math.sin(e.anim * 0.8 + e.id) * 3 + 4 : Math.abs(Math.sin(e.anim)) * (e.boss ? 2 : 1);
    const sq = frozen ? 0 : Math.sin(e.anim * 2) * 0.03;
    const fade = e.spawnT > 0 ? Math.max(0.2, 1 - e.spawnT * 2) : 1;
    // summoned out of the ground: a rune circle opens and the body rises out of it
    const rise = e.spawnT > 0 ? Math.min(1, Math.max(0, 1 - e.spawnT / (e.boss ? 1.2 : 0.4))) : 1;
    if (e.boss && rise < 1) {
      // a Herald is summoned: a column of its colour pours out of the sky into the rune
      B.setBlend('add');
      B.line(ex, ey + e.r * 0.6, ex, ey - 600, e.r * 2.2 * (1 - rise * 0.6), e.def.col.eye, 0.35 * (1 - rise), 1.5, e.def.col.eye, 0);
      B.line(ex, ey + e.r * 0.6, ex, ey - 500, e.r * 0.5, '#fff', 0.5 * (1 - rise), 0, '#fff', 0);
      B.setBlend('normal');
      if (this.dt > 0 && Math.random() < 0.8) this.fx.debris(ex, ey + e.r * 0.6, '#2a2228', 2, 200, 4, 1.2);
    }
    if (rise < 1) {
      const rr = e.r * (1.1 + (1 - rise) * 0.5);
      B.ellipse(ex, ey + e.r * 0.6, rr, rr * 0.38, 0, '#000', 0.55 * (1 - rise * 0.6));
      B.ring(ex, ey + e.r * 0.6, rr, rr * 0.38, 0, 1.5, e.def.col.eye, 0.8 * (1 - rise));
      if (this.dt > 0 && Math.random() < 0.3) this.fx.debris(ex, ey + e.r * 0.6, '#3a3036', 1, 60, 2.5, 0.6);
      this.light(ex, ey, e.r * 3, 0.5 * (1 - rise), e.def.col.eye);
    }
    const aff = e.affixes;
    if (aff && aff.length) {
      const ac = AFFIX_BY_ID[aff[0]!]!.color;
      B.radial(ex, ey + e.r * 0.5, e.r * 1.9, ac, 0.3, ac, 0.12, 0.5);
      for (let i = 0; i < aff.length; i++) {
        const c2 = AFFIX_BY_ID[aff[i]!]!.color,
          an = t * (1.5 + i * 0.4) + i * 2.1;
        B.arc(ex, ey, e.r * 1.35 + i * 4, an, 0.7, 2, c2, 0.85);
      }
      if (e.barrier && e.barrierMax) B.ring(ex, ey, e.r * 1.25, e.r * 1.25, 0, 3, '#7dd3fc', 0.25 + 0.6 * (e.barrier / e.barrierMax));
    }
    if (e.boss && e.phase === 2) {
      const pulse = 0.6 + Math.sin(t * 8) * 0.25;
      B.radial(ex, ey, e.r * 2.6, e.def.col.eye, 0.35 * pulse, '#7f1d1d', 0.2 * pulse, 0.5);
    }
    let tc: string | undefined,
      ta = 1;
    const hitK = e.hitFlash > 0 ? e.hitFlash / 0.08 : 0;
    if (hitK <= 0.35) {
      if (frozen) tc = 'rgba(160,220,255,0.55)';
      else if (e.hexed) tc = Math.sin(t * 6 + e.id) > 0 ? 'rgba(217,70,239,0.42)' : 'rgba(168,85,247,0.28)';
      else if (e.st.brittle) tc = Math.sin(t * 12) > 0 ? 'rgba(190,240,255,0.5)' : 'rgba(140,210,255,0.3)';
      else if (aff && e.hp < e.maxHp * 0.5 && aff.includes('frenzied'))
        tc = Math.sin(t * 16) > 0 ? 'rgba(255,40,40,0.45)' : 'rgba(255,40,40,0.2)';
      else if (e.st.chill) tc = 'rgba(120,180,255,0.3)';
      else if (e.st.burn) tc = Math.sin(t * 20) > 0 ? 'rgba(255,120,40,0.3)' : 'rgba(255,120,40,0.15)';
      else if (tint) tc = tint;
    } else ta = 0;
    // hits squish the body and wash it pale for a heartbeat — never a solid white blob
    const punch = 1 + hitK * (e.boss ? 0.04 : 0.12);
    B.image(sp, ex, ey - bobY + (1 - rise) * e.r * 0.8, {
      sx: flip * (1 + sq + shove) * (0.6 + rise * 0.4) * punch,
      sy: (1 - sq - shove * 0.6) * rise * (2 - punch),
      rot: frozen ? 0 : lean + Math.sin(e.anim * 0.5 + e.id) * 0.03,
      alpha: fade,
      flash: hitK * hitK * (e.boss || e.elite ? 0.3 : 0.42),
      tint: tc,
      tintA: ta,
    });
    if (e.face != null) {
      // the Bastion's shield: a ward arc on the facing side, flaring white when it turns a blow
      const blocked = e.blockAt != null && t - e.blockAt < 0.15;
      B.arc(ex, ey, e.r * 1.3, e.face, 1.05, blocked ? 5 : 2.5, blocked ? '#ffffff' : '#93c5fd', blocked ? 0.95 : 0.35);
      if (blocked) this.light(ex + Math.cos(e.face) * e.r, ey + Math.sin(e.face) * e.r, 90, 0.8, '#bfdbfe');
    }
    if (e.escapeT !== undefined) {
      // the Hoarder trails glittering coin-dust, lights its own way and wears its escape timer
      if (this.dt > 0 && Math.random() < 0.6)
        this.fx.ambient(ex + U.lerp(-8, 8, Math.random()), ey - e.r * 0.5, U.lerp(-15, 15, Math.random()), -20, 0.8, 2.5, '#fde047');
      this.light(ex, ey, 140, 0.8, '#fbbf24');
      if (e.def.flee) {
        const k = Math.max(0, e.escapeT / e.def.flee.escape);
        B.arc(ex, ey + e.r * 0.9, e.r * 1.1, -Math.PI / 2 + k * Math.PI, k * Math.PI, 2.5, k < 0.3 ? '#f87171' : '#fde047', 0.8);
      }
    }
    if (e.object) this.light(ex, ey - e.r * 0.4, 90, 0.5 + Math.sin(t * 5 + e.id) * 0.2, '#ff8a3c');
    if (e.st.burn && this.dt > 0 && Math.random() < 0.25)
      this.fx.ambient(ex + U.lerp(-e.r, e.r, Math.random()) * 0.6, ey - e.r * 0.4, 0, -40, 0.5, 3, '#ff8a3c');
    if (e.st.shock && (Math.floor(t * 12 + e.id) & 3) === 0) {
      const an = (U.hash2(e.id, Math.floor(t * 12), 3) - 0.5) * TAU;
      B.line(
        ex + Math.cos(an) * e.r * 0.3,
        ey + Math.sin(an) * e.r * 0.3,
        ex + Math.cos(an) * e.r * 1.2,
        ey + Math.sin(an) * e.r * 1.2 - 4,
        1.5,
        '#fde047',
        0.9,
      );
    }
    if (e.st.stun)
      for (let i = 0; i < 3; i++) {
        const an = t * 6 + i * 2.1;
        B.circle(ex + Math.cos(an) * 12, ey - e.r - 8 + Math.sin(an) * 4, 2, '#fde047', 1);
      }
    if (e.st.hunted) {
      B.arc(ex, ey, e.r + 6, t * 3 + 0.6, 0.6, 2, '#fde047', 1);
      B.arc(ex, ey, e.r + 6, t * 3 + Math.PI + 0.6, 0.6, 2, '#fde047', 1);
    }
    if (e.st.marks > 0) for (let i = 0; i < e.st.marks; i++) B.circle(ex - (e.st.marks - 1) * 3 + i * 6, ey - e.r - 6, 2, '#e879f9', 1);
    if (e.st.deathMark) {
      B.line(ex - 6, ey - e.r - 14, ex + 6, ey - e.r - 4, 2, '#c084fc', 1);
      B.line(ex + 6, ey - e.r - 14, ex - 6, ey - e.r - 4, 2, '#c084fc', 1);
    }
    if ((e.elite || e.boss) && e.hp < e.maxHp) {
      const w = e.r * 2.4;
      B.rect(ex - w / 2, ey - e.r - 12, w, 4, '#000', 0.6);
      B.rect(ex - w / 2, ey - e.r - 12, w * Math.max(0, e.hp / e.maxHp), 4, e.boss ? '#f87171' : '#c084fc', 1);
      if (e.barrier && e.barrierMax) B.rect(ex - w / 2, ey - e.r - 15, w * (e.barrier / e.barrierMax), 2, '#7dd3fc', 1);
    }
    if (e.elite && aff) {
      let label = this.labels.get(e);
      if (!label) this.labels.set(e, (label = g.enemyName(e)));
      this.tags.push({ text: label, x: ex, y: ey - e.r - 24, color: AFFIX_BY_ID[aff[0]!]!.color, a: fade });
    }
    if (e.elite) this.light(ex, ey, 130, 0.65, aff ? AFFIX_BY_ID[aff[0]!]!.color : e.def.col.eye);
    else if (e.boss) this.light(ex, ey, 260, e.phase === 2 ? 1 : 0.8, e.def.col.eye);
    else if (this.lightCols.length < 300) this.light(ex, ey - e.r * 0.3, e.r * 2 + 14, 0.2, e.def.col.eye);
  }

  private hawkSprite(): Img {
    return (this.hawk ??= makeSprite(48, 24, 24, 12, (x) => {
      x.fillStyle = '#fff';
      x.beginPath();
      x.moveTo(0, 4);
      x.quadraticCurveTo(-12, -10, -22, -2);
      x.quadraticCurveTo(-8, -2, 0, 2);
      x.quadraticCurveTo(8, -2, 22, -2);
      x.quadraticCurveTo(12, -10, 0, 4);
      x.fill();
    }));
  }

  private drawAlly(g: Game, al: Ally, a: number): void {
    const B = this.backend,
      t = g.time;
    const x = al.px + (al.x - al.px) * a,
      y = al.py + (al.y - al.py) * a;
    const fade = Math.max(0, Math.min(1, (al.life - al.age) * 2, al.age * 3));
    const c = al.color,
      flip = al.flip || 1;
    B.glow(x, y + 4, 18, c, fade * 0.7);
    const fr = (k: number) => (ENEMY_FRAMES > 1 ? Math.floor((((al.walk * k) / TAU) % 1) * ENEMY_FRAMES + ENEMY_FRAMES) % ENEMY_FRAMES : 0);
    if (al.kind === 'skeleton')
      B.image(S.enemy('skeleton', 12, { body: '#d6cfc0', eye: c }, 0, fr(0.5)), x, y - Math.abs(Math.sin(al.walk)) * 1.5, {
        sx: flip,
        alpha: fade,
      });
    else if (al.kind === 'wraith')
      B.image(S.enemy('wraith', 13, { body: '#86efac', eye: '#fff' }, 0, fr(0.4)), x, y, { sx: flip, alpha: fade });
    else if (al.kind === 'hawk') {
      B.image(this.hawkSprite(), x, y, { sx: flip, sy: 0.6 + Math.abs(Math.sin(t * 14)) * 0.5, alpha: fade, tint: c });
      B.circle(x, y, 4, '#5a3a1a', fade);
      B.circle(x + 5 * flip, y + 1, 2, '#f5c542', fade);
    } else if (al.kind === 'bat')
      B.image(S.enemy('bat', 8, { body: '#7f1d1d', eye: '#fca5a5' }, 0, fr(1.2)), x, y, {
        sx: flip,
        rot: Math.sin(t * 14) * 0.15,
        alpha: fade,
      });
    else if (al.kind === 'turret') {
      B.rect(x - 12, y + 10, 24, 6, '#334', fade);
      B.rect(x - 12, y + 2, 24, 8, '#556', fade);
      const aim = al.aim || 0;
      B.line(x + Math.cos(aim) * 2, y + Math.sin(aim) * 2, x + Math.cos(aim) * 20, y + Math.sin(aim) * 20, 6, c, fade);
      B.circle(x, y, 9, '#99a', fade);
      B.circle(x, y, 3.5, c, fade);
      const w = 28,
        k = 1 - al.age / al.life;
      B.rect(x - w / 2, y - 20, w, 3, '#000', 0.5 * fade);
      B.rect(x - w / 2, y - 20, w * k, 3, c, fade);
    } else if (al.kind === 'drone') {
      B.circle(x, y, 7, '#556', fade);
      const spin = t * 40;
      B.line(x - 11 * Math.cos(spin), y - 4, x + 11 * Math.cos(spin), y - 4, 2, '#99a', fade);
      B.circle(x, y, 3, c, fade);
    } else if (al.kind === 'clone') {
      B.image(S.hero(g.player.char, 0), x, y, { sx: flip, alpha: fade * 0.6, tint: c, tintA: 0.7 });
    }
    this.light(x, y, 80, 0.45, c);
  }

  private drawPlayer(g: Game, x: number, y: number): void {
    const B = this.backend,
      p = g.player,
      t = g.time;
    const moving = p.move.x || p.move.y;
    const bob = moving ? Math.abs(Math.sin(p.walkT)) * 2 : Math.sin(this.clock * 2.2) * 1;
    const flip = p.face.x < 0 ? -1 : 1;
    if (this.dt > 0) this.faceS += (flip - this.faceS) * Math.min(1, this.dt * 22);
    const accent = p.char.colors.accent;
    // a faint sigil under the champion's feet: always findable in the thickest horde
    B.radial(x, y + 22, 30, accent, 0.18, accent, 0.08, 0.6);
    B.ring(x, y + 22, 24, 9, 0, 2, accent, 0.7);
    B.arc(x, y + 22, 29, this.clock * 2, 0.55, 2, accent, 0.55);
    B.arc(x, y + 22, 29, this.clock * 2 + Math.PI, 0.55, 2, accent, 0.55);
    // a soft halo of the champion's colour behind the body keeps the silhouette readable in any crowd
    B.glow(x, y - 12, 44, accent, 0.28);
    if (p.frostAuraR) {
      B.circle(x, y, p.frostAuraR, 'rgb(186,230,253)', 0.06);
      B.ring(x, y, p.frostAuraR, p.frostAuraR, 0, 1.5, 'rgb(186,230,253)', 0.35);
    }
    if (p.auraColor) {
      B.glow(x, y - bob + 10, 56, p.auraColor, 0.38 + Math.sin(t * 5) * 0.1);
      if (this.dt > 0 && Math.random() < 0.4)
        this.fx.burst(x + U.lerp(-16, 16, Math.random()), y + 20, p.auraColor, 1, { speed: 15, life: 0.8, up: true, size: 3 });
      this.light(x, y, 150, 0.35, p.auraColor);
    }
    const alpha = p.invulnT > 0.15 ? 0.5 + Math.sin(t * 30) * 0.3 : 1;
    const s = 1.15,
      breath = moving ? 1 : 1 + Math.sin(this.clock * 2.2) * 0.015;
    // walk cycle frame (frame 0 is the standing pose)
    const walkFrames = HERO_FRAMES - 1;
    const frame = moving ? 1 + (Math.floor((p.walkT / TAU) * walkFrames * 0.999) % walkFrames) : 0;
    const lean = p.dashT > 0 ? p.dashDx * 0.25 : p.move.x * 0.08;
    // cast pose: the signature weapon just fired (its timer jumped back up)
    const sig = p.weapons[0];
    if (sig) {
      const last = this.lastTimer.get(sig) ?? sig.timer;
      if (sig.timer > last + 0.05) this.castT = 0.14;
      this.lastTimer.set(sig, sig.timer);
    }
    if (this.dt > 0) this.castT -= this.dt;
    // dash afterimages
    if (this.dt > 0) {
      this.trailT -= this.dt;
      if (p.dashT > 0 && this.trailT <= 0) {
        this.trailT = 0.03;
        this.trail.push(x, y - bob, 0);
      }
      for (let i = 2; i < this.trail.length; i += 3) this.trail[i]! += this.dt;
      while (this.trail.length && this.trail[2]! > 0.3) this.trail.splice(0, 3);
      // footstep dust, in time with the stride
      this.dustT -= this.dt;
      if (moving && p.dashT <= 0 && this.dustT <= 0) {
        this.dustT = 0.22;
        this.fx.burst(x - p.move.x * 8, y + 22, '#9a8f8a', 2, { speed: 24, life: 0.45, size: 4, add: false, up: true });
      }
    }
    const hero = this.castT > 0 ? S.heroCast(p.char) : S.hero(p.char, frame);
    for (let i = 0; i < this.trail.length; i += 3) {
      const k = 1 - this.trail[i + 2]! / 0.3;
      B.image(hero, this.trail[i]!, this.trail[i + 1]!, {
        sx: this.faceS * s,
        sy: s,
        rot: lean,
        alpha: k * 0.45,
        tint: accent,
        tintA: 0.85,
      });
    }
    // level-up: a pillar of light and a ring of runes
    if (p.level !== this.lastLevel) {
      if (this.lastLevel && p.level > this.lastLevel) {
        this.pillarT = 0.8;
        this.fx.shockwave(p.x, p.y, 260, 12, 0.5);
        for (let i = 0; i < 18; i++) {
          const an = (i / 18) * TAU;
          this.fx.ambient(x + Math.cos(an) * 30, y + 10 + Math.sin(an) * 12, Math.cos(an) * 20, -90 - Math.random() * 60, 1, 3, '#fde68a');
        }
      }
      this.lastLevel = p.level;
    }
    if (this.pillarT > 0) {
      this.pillarT -= this.dt;
      const k = Math.max(0, this.pillarT / 0.8);
      B.setBlend('add');
      B.line(x, y + 20, x, y - 420, 46 * k + 6, '#fde68a', 0.35 * k, 1.5, '#fde68a', 0);
      B.line(x, y + 20, x, y - 300, 10 * k + 2, '#fff', 0.7 * k, 0, '#fff', 0);
      B.ring(x, y + 22, 80 * (1 - k) + 20, (80 * (1 - k) + 20) * 0.36, 0, 3, '#fde68a', k);
      B.setBlend('normal');
      this.light(x, y, 320, k * 1.2, '#fde68a');
    }
    // the turn: |faceS| dips towards 0 as the champion pivots
    const turn = Math.max(0.15, Math.abs(this.faceS)) * Math.sign(this.faceS || 1);
    B.image(hero, x, y - bob, {
      sx: turn * s * (2 - breath),
      sy: s * breath,
      rot: lean,
      alpha,
      flash: p.hurtFlash > 0 ? 0.85 : 0,
    });
    if (p.shield > 0) {
      const r = 30 + Math.sin(t * 4) * 2;
      B.circle(x, y - 10, r, 'rgb(125,211,252)', 0.08);
      B.ring(x, y - 10, r, r, 0, 2, 'rgb(125,211,252)', 0.7);
      B.arc(x, y - 10, r, t * 3, 0.6, 3, '#e0f2fe', 0.6);
      this.light(x, y, 120, 0.3, '#7dd3fc');
    }
    if (p.blood > 0) B.ring(x, y - 10, 28, 28, 0, 2, '#ef4444', 0.3 + 0.5 * (p.blood / (p.bloodCap || 1)));
    if (p.cycloneT > 0)
      for (let i = 0; i < 3; i++) B.ring(x, y - 10 - i * 12, 40 + i * 14, 12 + i * 4, t * 8 + i, 3, 'rgb(94,234,212)', 0.6);
    if (p.stormT > 0) B.ring(x, y, 420, 420, 0, 2, 'rgb(125,211,252)', 0.5);
  }

  /** Debris and dust that live on the ground: drawn before the light map so the night darkens them. */
  private drawGroundParticles(): void {
    const B = this.backend,
      P = this.fx.parts;
    for (let i = 0; i < P.count; i++) {
      const f = P.flags[i]!;
      if (f & PF.GLOW) continue;
      const k = P.life[i]! / P.max[i]!;
      if (f & PF.DEBRIS) {
        const z = P.z[i]!,
          a = Math.min(1, k * 3.5);
        B.ellipse(P.x[i]!, P.y[i]! + 1, P.size[i]! * 0.7, P.size[i]! * 0.3, 0, '#000', 0.3 * a * Math.max(0.2, 1 - z / 80));
        B.squareRGB(P.x[i]!, P.y[i]! - z, P.size[i]!, P.r[i]!, P.g[i]!, P.b[i]!, a, P.rot[i]!);
      } else B.glowRGB(P.x[i]!, P.y[i]!, P.size[i]! * 1.6, P.r[i]!, P.g[i]!, P.b[i]!, k * 0.45);
    }
  }

  private drawEnemyProjectiles(g: Game, a: number): void {
    for (const pr of g.eprojs) {
      const x = pr.px + (pr.x - pr.px) * a,
        y = pr.py + (pr.y - pr.py) * a;
      this.backend.image(S.orb(pr.color, 5) as Img, x, y);
      if (this.lightCols.length < 360) this.light(x, y, 60, 0.45, pr.color);
    }
  }

  private spikeSprite(): Img {
    return (this.spike ??= makeSprite(28, 26, 14, 16, (x) => {
      x.fillStyle = '#e0f2fe';
      for (let i = 0; i < 3; i++) {
        x.beginPath();
        x.moveTo(-8 + i * 8, 6);
        x.lineTo(-4 + i * 8, -10 - (i === 1 ? 6 : 0));
        x.lineTo(i * 8, 6);
        x.fill();
      }
    }));
  }

  private drawProjectiles(g: Game, a: number): void {
    const B = this.backend;
    for (const pr of g.projs) {
      const sp = pr.sprite;
      if (!sp) continue;
      const x = pr.px + (pr.x - pr.px) * a,
        y = pr.py + (pr.y - pr.py) * a;
      const color = sp.color ?? '#fff';
      if (sp.kind === 'orb') B.image(S.orb(color, sp.size || 6) as Img, x, y, { sx: 1 + Math.sin(pr.age * 20) * 0.08 });
      else if (sp.kind === 'void') {
        const r = sp.size || 14;
        B.radial(x, y, r * 2, '#000', 1, '#140028', 0.9, 0.5);
        B.ring(x, y, r * 1.6, r * 1.6, 0, r * 0.6, color, 0.5, 1.5);
        B.ring(x, y, r * 1.4, r * 0.5, pr.age * 3, 2, color, 0.9);
      } else if (sp.kind === 'wave') {
        const s = sp.size ?? 10,
          ca = Math.cos(pr.angle),
          sa = Math.sin(pr.angle);
        B.setBlend('add');
        B.arc(x - ca * s, y - sa * s, s * 1.3, pr.angle, 1.1, 10, color, 0.35);
        B.setBlend('normal');
        B.arc(x - ca * s, y - sa * s, s * 1.3, pr.angle, 1.1, 4, color, 0.85);
        B.arc(x - ca * s * 0.7, y - sa * s * 0.7, s, pr.angle, 0.9, 2, '#fff', 1);
      } else if (sp.kind === 'tornado') {
        const s = sp.size ?? 16;
        for (let i = 0; i < 4; i++) {
          const w = s * (0.4 + i * 0.25);
          B.ring(x + Math.sin(pr.rot + i) * 4, y - i * s * 0.35 + s * 0.4, w, w * 0.35, 0, 3, color, 0.8);
        }
      } else if (sp.kind === 'spike') B.image(this.spikeSprite(), x, y);
      else {
        const b = sp as { len?: number; wid?: number };
        B.image(S.bolt(color, b.len || 20, b.wid || 5, sp.kind) as Img, x, y, { rot: pr.angle + pr.rot });
      }
      if (pr.light) this.light(x, y, pr.light, 0.6 * this.fx.intensity, color);
      else if (this.lightCols.length < 300) this.light(x, y, 45, 0.4 * this.fx.intensity, color);
    }
  }

  private drawLighting(g: Game): void {
    const B = this.backend,
      L = this.lights,
      C = this.lightCols,
      eclipse = g.eclipse ? 0.85 : 1,
      lantern = g.bloodMoon > 0 ? '#ffc4b8' : this.grade.lantern;
    const amb = this.stage.pal.ambient,
      m = amb.match(/[\d.]+/g);
    // deepen the stage's night so coloured light has room to matter
    const darkA = m ? Math.min(0.85, +m[3]! * this.grade.dark * (g.eclipse ? 1.15 : 1)) : 0.5;
    B.beginLights(m ? `rgba(${m[0]},${m[1]},${m[2]},${darkA})` : amb, 0.25);
    for (let i = 0, j = 0; i < L.length; i += 4, j++) B.light(L[i]!, L[i + 1]!, L[i + 2]!, L[i + 3]! * eclipse, C[j] ?? lantern);
    const fx = this.fx,
      I = fx.intensity,
      exK = crowdFade(fx.explosions.length, 6) * I,
      flK = crowdFade(fx.flashLights.length, 10) * I,
      nvK = crowdFade(fx.novas.length, 4) * I;
    for (const ex of fx.explosions) B.light(ex.x, ex.y, softR(ex.r) * 2, (ex.life / ex.max) * 0.8 * exK, ex.color);
    for (const f of fx.flashLights) B.light(f.x, f.y, softR(f.r), (f.life / f.max) * flK, f.color);
    for (const nv of fx.novas) B.light(nv.n.x, nv.n.y, softR(nv.n.r) + 30, 0.3 * (1 - nv.n.r / nv.n.maxR) * nvK, nv.color);
    B.endLights();
  }

  /* ------------------------------ additive FX ------------------------------ */

  private drawParticles(): void {
    const B = this.backend,
      P = this.fx.parts;
    for (let i = 0; i < P.count; i++) {
      const f = P.flags[i]!;
      if (!(f & PF.GLOW)) continue;
      const k = f & PF.AMBIENT ? Math.sin((P.life[i]! / P.max[i]!) * Math.PI) * 0.8 : P.life[i]! / P.max[i]!;
      if (f & (PF.STREAK | PF.SOUL)) {
        const x = P.x[i]!,
          y = P.y[i]!,
          s = f & PF.SOUL ? 0.045 : 0.035;
        B.lineRGB(x - P.vx[i]! * s, y - P.vy[i]! * s, x, y, P.size[i]! * (f & PF.SOUL ? 1.4 : 1), P.r[i]!, P.g[i]!, P.b[i]!, k);
        if (f & PF.SOUL) B.glowRGB(x, y, P.size[i]! * 1.8, P.r[i]!, P.g[i]!, P.b[i]!, Math.min(1, k * 1.5));
      } else B.glowRGB(P.x[i]!, P.y[i]!, P.size[i]!, P.r[i]!, P.g[i]!, P.b[i]!, k);
    }
  }

  /** Polyline with a glow underlay (stands in for Canvas2D shadowBlur). */
  private glowPath(pts: number[], width: number, color: string, alpha: number, core: number): void {
    const B = this.backend;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      B.line(pts[i]!, pts[i + 1]!, pts[i + 2]!, pts[i + 3]!, width * 4, color, alpha * 0.35, 1.5);
      B.line(pts[i]!, pts[i + 1]!, pts[i + 2]!, pts[i + 3]!, width, color, alpha);
      if (core > 0) B.line(pts[i]!, pts[i + 1]!, pts[i + 2]!, pts[i + 3]!, Math.max(1, width * 0.3), '#fff', core);
    }
  }

  /** Tapered ribbons behind moving projectiles, from a short history of interpolated positions. */
  private drawRibbons(g: Game, a: number): void {
    const B = this.backend;
    let budget = 500;
    for (const pr of g.projs) {
      const sp = pr.sprite;
      if (!sp || sp.kind === 'void' || sp.kind === 'tornado' || sp.kind === 'wave' || sp.kind === 'spike' || pr.field) continue;
      const x = pr.px + (pr.x - pr.px) * a,
        y = pr.py + (pr.y - pr.py) * a;
      let rb = this.ribbons.get(pr);
      if (!rb) this.ribbons.set(pr, (rb = new Float32Array(2 + 10 * 2)));
      // [head, count, x0, y0, x1, y1, …]
      const head = rb[0]!,
        cnt = rb[1]!;
      const hx = rb[2 + head * 2]!,
        hy = rb[3 + head * 2]!;
      if (cnt === 0 || (x - hx) * (x - hx) + (y - hy) * (y - hy) > 25) {
        const nh = cnt === 0 ? 0 : (head + 1) % 10;
        rb[2 + nh * 2] = x;
        rb[3 + nh * 2] = y;
        rb[0] = nh;
        rb[1] = Math.min(10, cnt + 1);
      }
      const n = rb[1]!;
      if (n < 2 || budget <= 0) continue;
      const color = sp.color ?? '#fff',
        w = Math.max(2, (pr.r || 5) * 1.1);
      let px = x,
        py = y;
      for (let i = 0; i < n && budget > 0; i++, budget--) {
        const idx = ((rb[0]! - i + 10) % 10) * 2 + 2,
          qx = rb[idx]!,
          qy = rb[idx + 1]!;
        const k = 1 - i / n;
        B.line(px, py, qx, qy, w * k, color, 0.4 * k, 1.5);
        px = qx;
        py = qy;
      }
    }
  }

  private drawAdditive(g: Game, a: number, ppx: number, ppy: number): void {
    const B = this.backend,
      fx = this.fx,
      t = g.time,
      // the player's spell-intensity setting scales every spell visual below (not enemy telegraphs)
      I = fx.intensity;
    B.setBlend('add');
    if (this.quality >= 0.5) this.drawRibbons(g, a);
    this.drawParticles();
    // a late-game volley is dozens of projectiles: their halos dim as the count grows, and big ones stay modest
    const prK = 0.42 * crowdFade(g.projs.length, 40) * I;
    for (const pr of g.projs) {
      const sp = pr.sprite;
      if (!sp || sp.kind === 'void') continue;
      const r = Math.min(40, (pr.r || 6) * 1.4 + 4);
      B.glow(pr.px + (pr.x - pr.px) * a, pr.py + (pr.y - pr.py) * a, r, sp.color ?? '#fff', prK);
    }
    for (const pr of g.eprojs) B.glow(pr.px + (pr.x - pr.px) * a, pr.py + (pr.y - pr.py) * a, 14, pr.color, 0.7);
    // magnetised loot streaks and gem glints
    const SK = this.streaks;
    for (let i = 0, j = 0; i < SK.length; i += 4, j++) {
      const x = SK[i]!,
        y = SK[i + 1]!,
        c = this.streakCols[j]!;
      B.line(x - SK[i + 2]! * 3, y - SK[i + 3]! * 3, x, y, 3, c, 0.5, 1.5, c, 0);
    }
    const G = this.glints,
      star = this.starSprite();
    for (let i = 0; i < G.length; i += 3) {
      const k = Math.sin(G[i + 2]! * Math.PI);
      B.image(star, G[i]!, G[i + 1]!, { sx: 0.4 + k * 0.6, rot: G[i + 2]! * 1.5, alpha: k });
    }
    const rgK = crowdFade(fx.rings.length, 6) * I;
    for (const r of fx.rings) {
      const lt = r.life / r.max,
        k = lt * rgK * sizeFade(r.r, 140),
        rad = r.r * (r.thin ? 1 : 0.5 + easeOut(1 - lt) * 0.5);
      B.ring(r.x, r.y, rad, rad, 0, r.thin ? 2 : 3 + (1 - lt) * 4, r.color, k * 0.8);
      if (!r.thin) B.ring(r.x, r.y, rad, rad, 0, 12, r.color, k * 0.18, 1.5);
    }
    // novas: a crisp travelling edge with a soft halo; the inner wash stays faint so big rings don't flood the screen
    const nvK = crowdFade(fx.novas.length, 4) * I;
    for (const nv of fx.novas) {
      const n = nv.n,
        k = 1 - n.r / n.maxR,
        w = nv.thin ? 3 : 6 + k * 5,
        f = nvK * sizeFade(n.r, 140);
      B.ring(n.x, n.y, n.r, n.r, 0, w * 2, nv.color, 0.28 * f, 1.5);
      B.ring(n.x, n.y, n.r, n.r, 0, w, nv.color, 0.75 * f);
      B.circle(n.x, n.y, n.r, nv.color, 0.07 * k * f);
    }
    // in a dense fight explosions stack additively: dim each one as the count grows so it never whites out,
    // and big blasts dim with their size so a late-game meteor reads as a hit, not a screen flash
    const exK = crowdFade(fx.explosions.length, 6) * I;
    for (const ex of fx.explosions) {
      const e = 1 - ex.life / ex.max,
        k = (ex.life / ex.max) * exK * sizeFade(ex.r);
      // white-hot core → coloured fireball → expanding shock ring
      B.glow(ex.x, ex.y, ex.r * (0.5 + e * 0.5), ex.color, k * 0.55);
      B.glow(ex.x, ex.y, ex.r * (0.3 + e * 0.2), '#fff', k * k * 0.3);
      const rr = ex.r * (0.3 + easeOut(e) * 0.7);
      B.ring(ex.x, ex.y, rr, rr, 0, 2 + k * 3, '#fff', k * 0.45);
      B.ring(ex.x, ex.y, rr, rr, 0, 10, ex.color, k * 0.2, 1.5);
    }
    const pts: number[] = [];
    const bmK = crowdFade(fx.beams.length, 14) * I;
    for (const b of fx.beams) {
      const k = b.life / b.max,
        dx = b.x2 - b.x1,
        dy = b.y2 - b.y1,
        len = Math.hypot(dx, dy) || 1,
        nx = -dy / len,
        ny = dx / len,
        n = 6;
      pts.length = 0;
      pts.push(b.x1, b.y1);
      for (let i = 1; i < n; i++) {
        const tt = i / n,
          off = (U.hash2(i, Math.floor(b.seed * 7), Math.floor(t * 30)) - 0.5) * Math.min(30, len * 0.15);
        pts.push(b.x1 + dx * tt + nx * off, b.y1 + dy * tt + ny * off);
      }
      pts.push(b.x2, b.y2);
      this.glowPath(pts, b.w * (0.5 + k), b.color, k * bmK, k * 0.7 * bmK);
      B.glow(b.x2, b.y2, 14 + b.w * 2.5, b.color, k * 0.55 * bmK);
    }
    const boK = crowdFade(fx.bolts.length, 4) * I;
    for (const bo of fx.bolts) {
      const lt = bo.life / bo.max,
        k = lt * boK;
      pts.length = 0;
      let x = bo.x + (Math.random() - 0.5) * 60,
        y = bo.y - 420;
      pts.push(x, y);
      for (let i = 0; i < 8; i++) {
        x = bo.x + (U.hash2(i, bo.seed, 1) - 0.5) * 50 * (1 - i / 8);
        y += 52;
        pts.push(x, y);
      }
      pts.push(bo.x, bo.y);
      this.glowPath(pts, 3 * lt + 1, bo.color, k, k * 0.8);
      B.glow(bo.x, bo.y, 40, bo.color, k * 0.55);
      B.ring(bo.x, bo.y, 30 * (1.5 - lt), 12 * (1.5 - lt), 0, 2, '#fff', k * 0.8);
    }
    const lnK = crowdFade(fx.lines.length, 6) * I;
    for (const ln of fx.lines) {
      const lt = ln.life / ln.max,
        k = lt * 0.75 * lnK,
        ca = Math.cos(ln.angle),
        sa = Math.sin(ln.angle),
        L = ln.len * Math.min(1, (1 - lt) * 3 + 0.2);
      B.line(ln.x, ln.y, ln.x + ca * L, ln.y + sa * L, ln.width, ln.color, k, 0, ln.color, 0);
      pts.length = 0;
      pts.push(ln.x, ln.y);
      for (let i = 1; i <= 8; i++) {
        const along = (ln.len * i) / 8,
          off = (U.hash2(i, ln.x | 0, ln.y | 0) - 0.5) * ln.width * 0.6;
        pts.push(ln.x + ca * along - sa * off, ln.y + sa * along + ca * off);
      }
      for (let i = 0; i + 3 < pts.length; i += 2) B.line(pts[i]!, pts[i + 1]!, pts[i + 2]!, pts[i + 3]!, 2, '#fff', k);
    }
    const arK = crowdFade(fx.arcs.length, 8) * I;
    for (const ar of fx.arcs) {
      const lt = ar.life / ar.max,
        k = lt * arK,
        r = ar.r * (ar.thin ? 1 : 0.7 + easeOut(1 - lt) * 0.3),
        // wide and long sweeps (a full 360° inferno) keep a faint smear: the blade edge carries the motion
        fill = (ar.thin ? 0.24 : 0.34) * Math.min(1, 1.3 / ar.halfArc) * sizeFade(r, 130);
      // a swept blade: bright leading edge, the sector smearing behind it
      B.sector(ar.x, ar.y, r, ar.angle, ar.halfArc, ar.color, fill * k);
      B.arc(ar.x, ar.y, r, ar.angle, ar.halfArc, 8, ar.color, k * 0.35);
      B.arc(ar.x, ar.y, r, ar.angle, ar.halfArc, 2.5, '#fff', k * 0.9);
    }
    for (const w of fx.whips) {
      const k = w.life / w.max,
        cx = w.x + w.sd * w.len * 0.5,
        cy = w.y - w.hgt * 0.7 * (1 - k),
        ex = w.x + w.sd * w.len,
        ey = w.y + Math.sin(k * 6) * 6;
      pts.length = 0;
      for (let i = 0; i <= 10; i++) {
        const s = i / 10,
          u = 1 - s;
        pts.push(u * u * w.x + 2 * u * s * cx + s * s * ex, u * u * w.y + 2 * u * s * cy + s * s * ey);
      }
      this.glowPath(pts, 6, w.color, k * I, 0.5 * k * I);
    }
    for (const lb of fx.lobs) {
      const k = lb.t / lb.max,
        x = U.lerp(lb.x, lb.tx, k),
        y = U.lerp(lb.y, lb.ty, k) - Math.sin(k * Math.PI) * 90;
      B.image(S.orb(lb.color, 6) as Img, x, y);
      if (this.dt > 0) fx.trail(x, y, lb.color, 4);
    }
    for (const m of fx.meteors) {
      const k = m.t / m.max,
        y = m.y - (1 - k) * 600;
      if (m.small) B.image(S.bolt(m.color || '#fde047', 18, 3, 'arrow') as Img, m.x, y, { rot: Math.PI / 2 });
      else {
        const mx = m.x + (1 - k) * 120;
        B.line(mx + 60, y - 300, mx, y, 22, '#ff7043', 0.35, 1.5, '#ffd08a', 0.8);
        B.image(S.orb('#ff7043', 14) as Img, mx, y);
        if (this.dt > 0) fx.trail(mx, y, '#ff9a3c', 8);
      }
    }
    // Herald sweep beams
    for (const e of g.enemies) {
      const at = e.attack;
      if (!e.boss || e.dead || !at || at.type !== 'sweep' || at.phase !== 'go' || !at.len || !at.wid || at.ang == null) continue;
      const ex = e.px + (e.x - e.px) * a,
        ey = e.py + (e.y - e.py) * a,
        ca = Math.cos(at.ang),
        sa = Math.sin(at.ang),
        x2 = ex + ca * at.len,
        y2 = ey + sa * at.len,
        c = e.def.col.eye,
        flick = 0.85 + Math.sin(t * 40) * 0.15;
      B.line(ex, ey, x2, y2, at.wid * 2.2, c, 0.3 * flick, 1.5);
      B.line(ex, ey, x2, y2, at.wid, c, 0.6 * flick, 1);
      B.line(ex, ey, x2, y2, at.wid * 0.22, '#fff', 0.75, 0, '#fff', 0.35);
      B.glow(x2, y2, at.wid * 1.6, c, 0.9);
      if (this.dt > 0) this.fx.sparks(x2, y2, at.ang + Math.PI, 0.9, c, 2, 300, 0.25);
      for (let i = 1; i <= 4; i++) this.fx.flashLight(ex + ca * at.len * (i / 4), ey + sa * at.len * (i / 4), at.wid * 3, c, 0.05);
    }
    // weapon-specific persistent visuals
    const p = g.player;
    for (const w of p.weapons) {
      if (w.id === 'sunbeam' && w.len) {
        const beams = w.beams || 1;
        for (let b = 0; b < beams; b++) {
          const an = w.angle + (b / beams) * TAU,
            x2 = ppx + Math.cos(an) * w.len,
            y2 = ppy + Math.sin(an) * w.len;
          B.line(ppx, ppy, x2, y2, 22, '#fbbf24', 0.22 * I, 1.5, '#fbbf24', 0);
          B.line(ppx, ppy, x2, y2, 9, w.evolved ? '#fb923c' : '#fbbf24', 0.6 * I, 0, '#fbbf24', 0);
          B.line(ppx, ppy, x2, y2, 3, '#fff', 0.6 * Math.sqrt(I), 0, '#fff', 0.15);
        }
      }
      if (w.id === 'plague_aura' && w.radius) {
        const r = w.radius;
        B.radial(ppx, ppy, r, w.evolved ? '#84cc16' : '#a3e635', 0.02, '#a3e635', 0.11 * sizeFade(r, 140) * I, 0.8, 0.3);
        const rr = r * (0.98 + Math.sin(t * 3) * 0.02);
        B.ring(ppx, ppy, rr, rr, 0, 2, 'rgb(163,230,53)', 0.35);
      }
    }
    if (p.feastT > 0) B.ring(ppx, ppy, 245, 245, 0, 3, 'rgb(239,68,68)', 0.5);
    B.setBlend('normal');
  }

  private starSprite(): Img {
    return (this.star ??= makeSprite(24, 24, 12, 12, (x) => {
      const g = x.createRadialGradient(0, 0, 0, 0, 0, 12);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.2, 'rgba(255,255,255,0.6)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g;
      x.beginPath();
      for (let i = 0; i < 8; i++) {
        const r = i % 2 ? 2 : 12,
          a = (i / 8) * TAU;
        x.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      x.fill();
    }));
  }

  private drawTexts(): void {
    for (const t of this.tags) this.backend.text(t.text, t.x, t.y, 12, t.color, t.a, true);
    this.tags.length = 0;
    for (const t of this.fx.texts) {
      const k = Math.min(1, (t.life / t.max) * 2.5);
      // numbers pop in oversized and settle; merged totals re-pop and grow a little with every hit
      const since = t.pop ?? t.max - t.life,
        pop = 1 + (t.big ? 0.8 : t.crit ? 0.7 : 0.35) * Math.max(0, 1 - since / 0.14),
        grow = 1 + Math.min(0.5, (t.merges ?? 0) * 0.06);
      const size = (t.big ? 18 : t.crit ? 22 : t.dmg ? 14 : t.small ? 14 : 16) * pop * grow;
      this.backend.text(t.text, t.x, t.y, size, t.color, k, !!t.crit || !!t.big);
    }
  }

  private drawPlayerBars(g: Game, px: number, py: number): void {
    const B = this.backend,
      p = g.player,
      w = 40,
      x = px - w / 2,
      y = py + 32;
    B.rect(x - 1, y - 1, w + 2, 6, '#000', 0.6);
    const hpk = Math.max(0, p.hp / p.stats.maxHp);
    B.rect(x, y, w * hpk, 4, hpk > 0.5 ? '#4ade80' : hpk > 0.25 ? '#fbbf24' : '#f87171', 1);
    if (p.shield > 0) B.rect(x, y - 3, w * Math.min(1, p.shield / p.stats.maxHp), 2, '#7dd3fc', 1);
  }

  /* ------------------------------ screen space ------------------------------ */

  private drawPost(g: Game): void {
    const B = this.backend,
      W = this.W,
      H = this.H,
      p = g.player;
    const R = Math.hypot(W, H) / 2 + 2,
      inner = (Math.min(W, H) * 0.35) / R;
    // vignette: transparent until 35% of the short side, darkening to the corners
    B.radial(W / 2, H / 2, R, '#000', 0, '#000', 0.55 * (R / (Math.max(W, H) * 0.75)), 0.999, inner);
    const hpk = p.hp / p.stats.maxHp;
    if (hpk < 0.35) {
      // heartbeat: a double pulse quickening as health drains
      const rate = 5 + (0.35 - hpk) * 14,
        ph = (g.time * rate) % TAU,
        beat = Math.max(0, Math.sin(ph)) ** 6 + 0.6 * Math.max(0, Math.sin(ph - 0.9)) ** 6;
      const a = ((0.35 - hpk) / 0.35) * (0.3 + beat * 0.3);
      B.radial(W / 2, H / 2, R, '#b40000', 0, '#b40000', a, 0.999, (Math.min(W, H) * 0.3) / R);
    }
    // where the last hit came from: a red crescent on that edge of the screen
    if (this.fx.hurtA > 0) {
      const ha = this.fx.hurtA,
        R2 = Math.min(W, H) * 0.46;
      if (this.fx.hurtAng == null) B.ring(W / 2, H / 2, R2, R2, 0, 40 * this.dpr, '#dc2626', ha * 0.25, 2);
      else B.arc(W / 2, H / 2, R2, this.fx.hurtAng, 0.55, 26 * this.dpr, '#ef4444', ha * 0.55);
    }
    if (g.eclipse) B.rect(0, 0, W, H, 'rgb(80,0,120)', 0.07);
    if (this.fx.flashA > 0) B.rect(0, 0, W, H, this.fx.flashCol, this.fx.flashA * 0.7);
  }

  /** Per-frame grading: stage split-tone, hit aberration, low-health red wash, eclipse purple, shockwaves. */
  private gradeFrame(g: Game): PostFX {
    const P = this.post,
      p = g.player,
      gr = this.grade,
      hpk = p.hp / p.stats.maxHp;
    P.time = g.time;
    P.aberration = (this.fx.hurtA * 4 + (g.boss && g.boss.phase === 2 ? 1.2 : 0)) * this.dpr;
    P.bloom = this.quality < 0.7 ? 0.6 : 0.85;
    P.threshold = 0.58;
    if (hpk < 0.3) {
      P.tint = '#7f0000';
      P.tintA = (0.3 - hpk) * 0.7;
    } else if (g.bloodMoon > 0) {
      P.tint = '#6b0012';
      P.tintA = 0.14 * Math.min(1, g.bloodMoon / 2);
    } else if (g.eclipse) {
      P.tint = '#3b0764';
      P.tintA = 0.12;
    } else P.tintA = 0;
    P.saturation = hpk < 0.3 ? 0.85 : 1.1;
    P.contrast = 1.08;
    P.shadows = g.bloodMoon > 0 ? '#7f0018' : gr.shadows;
    P.shadowsA = g.bloodMoon > 0 ? 0.6 : gr.amount;
    P.highlights = gr.highlights;
    P.highlightsA = gr.amount * 0.6;
    this.packWaves(P);
    return P;
  }

  /** Convert live world-space shockwaves into device-pixel rings for the post pass. */
  private packWaves(P: PostFX): void {
    let n = 0;
    for (const w of this.fx.waves) {
      if (n >= MAX_WAVES) break;
      const k = 1 - w.life / w.max;
      const [sx, sy] = this.worldToScreen(w.x, w.y);
      P.waves[n * 4] = sx;
      P.waves[n * 4 + 1] = sy;
      P.waves[n * 4 + 2] = w.maxR * easeOut(k) * this.zoom;
      P.waves[n * 4 + 3] = w.str * Math.pow(1 - k, 1.5) * this.dpr;
      n++;
    }
    P.waveCount = n;
  }

  private arrowSprite(): Img {
    return (this.arrow ??= makeSprite(32, 24, 12, 12, (x) => {
      x.fillStyle = '#fff';
      x.beginPath();
      x.moveTo(14, 0);
      x.lineTo(-8, -9);
      x.lineTo(-4, 0);
      x.lineTo(-8, 9);
      x.closePath();
      x.fill();
    }));
  }

  private indicator(x: number, y: number, color: string): void {
    const W = this.W,
      H = this.H,
      cx = W / 2,
      cy = H / 2,
      m = 30 * this.dpr;
    const ang = Math.atan2(y - cy, x - cx),
      tx = U.clamp(x, m, W - m),
      ty = U.clamp(y, m, H - m),
      pulse = 1 + Math.sin(this.clock * 6) * 0.12;
    this.backend.glow(tx, ty, 18 * this.dpr * pulse, color, 0.6);
    this.backend.image(this.arrowSprite(), tx, ty, { rot: ang, sx: this.dpr * pulse, tint: color });
  }

  private drawIndicators(g: Game, a: number): void {
    const W = this.W,
      H = this.H;
    for (const e of g.enemies) {
      if (!(e.boss || e.elite || e.def.flee || e.auraR) || e.dead) continue;
      const [sx, sy] = this.worldToScreen(e.px + (e.x - e.px) * a, e.py + (e.y - e.py) * a);
      if (sx > 0 && sx < W && sy > 0 && sy < H) continue;
      this.indicator(sx, sy, e.boss ? '#f87171' : e.def.flee ? '#fde047' : e.auraR ? '#e879f9' : '#c084fc');
    }
    for (const k of g.pickups) {
      if (k.kind !== 'chest' && k.kind !== 'bosschest') continue;
      const [sx, sy] = this.worldToScreen(k.x, k.y);
      if (sx > 0 && sx < W && sy > 0 && sy < H) continue;
      this.indicator(sx, sy, '#ffd700');
    }
    for (const s of g.shrines) {
      if (s.used) continue;
      const [sx, sy] = this.worldToScreen(s.x, s.y);
      if (sx > 0 && sx < W && sy > 0 && sy < H) continue;
      this.indicator(sx, sy, SHRINE_DEFS[s.kind].color);
    }
  }

  /* -------------------------------- title menu -------------------------------- */

  private renderMenu(dt: number): void {
    const B = this.backend,
      W = this.W,
      H = this.H,
      stage = STAGES[0]!;
    this.menuT += dt;
    if (this.stage !== stage) this.setStage(stage);
    B.begin(stage.pal.sky);
    const z = this.zoom * 0.9,
      cx = Math.sin(this.menuT * 0.05) * 300,
      cy = this.menuT * 18;
    this.cam.x = cx;
    this.cam.y = cy;
    B.setView(z, 0, 0, z, W / 2 - cx * z, H / 2 - cy * z);
    const vw = W / z / 2 + 80,
      vh = H / z / 2 + 80;
    this.lights.length = 0;
    this.lightCols.length = 0;
    this.drawGround(cx - vw, cy - vh, cx + vw, cy + vh);
    this.drawDetails(this.menuT, cx - vw, cy - vh, cx + vw, cy + vh);
    this.drawCloudShadows(this.menuT, cx - vw, cy - vh, cx + vw, cy + vh);
    for (let gy = Math.floor((cy - vh) / CHUNK); gy <= Math.floor((cy + vh + 120) / CHUNK); gy++)
      for (let gx = Math.floor((cx - vw) / CHUNK); gx <= Math.floor((cx + vw) / CHUNK); gx++)
        for (const pr of this.chunk(gx, gy).props) {
          B.image(pr.sprite, pr.x, pr.y, { sy: SHADOW_SQUASH, skew: SHADOW_SKEW, tint: '#000', tintA: 1, alpha: 0.3 });
          this.drawProp(pr, 1e9, 1e9, this.menuT);
        }
    if (Math.random() < 0.6 && dt > 0)
      this.fx.burst(cx + U.lerp(-vw, vw, Math.random()), cy + vh, stage.pal.ember, 1, { speed: 20, life: 4, up: true, size: 3 });
    // a few drifting lanterns light the title scene
    for (let i = 0; i < 4; i++) {
      const lx = cx + Math.sin(this.menuT * 0.13 + i * 1.7) * vw * 0.7,
        ly = cy + Math.cos(this.menuT * 0.11 + i * 2.3) * vh * 0.6;
      this.light(lx, ly, 380, 0.7, i % 2 ? stage.pal.ember : '#ffe2bd');
    }
    B.beginLights(stage.pal.ambient.replace(/[\d.]+\)$/, '0.6)'), 0.25);
    const L = this.lights;
    for (let i = 0, j = 0; i < L.length; i += 4, j++) B.light(L[i]!, L[i + 1]!, L[i + 2]!, L[i + 3]!, this.lightCols[j] ?? '#ffe2bd');
    B.endLights();
    const P = this.fx.parts;
    for (let i = 0; i < P.count; i++) {
      P.vy[i]! -= 20 * dt;
      P.vx[i]! += Math.sin(this.menuT + P.y[i]! * 0.01) * 10 * dt;
    }
    B.setBlend('add');
    for (let i = 0; i < P.count; i++) B.glowRGB(P.x[i]!, P.y[i]!, P.size[i]!, P.r[i]!, P.g[i]!, P.b[i]!, (P.life[i]! / P.max[i]!) * 0.8);
    B.setBlend('normal');
    B.setView(1, 0, 0, 1, 0, 0);
    const R = Math.hypot(W, H) / 2 + 2;
    B.radial(W / 2, H / 2, R, '#000', 0.25, '#000', 0.85, 0.999, (Math.min(W, H) * 0.2) / R);
    if (this.postEnabled) {
      const P = this.post;
      P.time = this.menuT;
      P.aberration = 0;
      P.tintA = 0;
      P.saturation = 1.08;
      P.bloom = 1;
      P.shadows = this.grade.shadows;
      P.shadowsA = this.grade.amount;
      P.highlights = this.grade.highlights;
      P.highlightsA = this.grade.amount * 0.6;
      P.waveCount = 0;
    }
    B.setPost(this.postEnabled ? this.post : null);
    B.end();
  }
}
