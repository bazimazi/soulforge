/**
 * World renderer: camera, ground, entities, lighting, effects and post-processing.
 *
 * Draws the simulation state through a {@link Backend} (WebGL2 when available, Canvas2D otherwise).
 * Entity positions are interpolated between the last two fixed simulation steps (`alpha`), so motion
 * is smooth at any display refresh rate. Nothing here mutates gameplay state.
 */
import { U } from '../core/util';
import { MAT_BY_ID, STAGES } from '../data/passives';
import type { Game } from '../game/game';
import type { Enemy, StageDef } from '../game/types';
import type { FX } from './fx';
import type { Backend, Img } from './gfx/backend';
import { Canvas2DBackend } from './gfx/canvas2d';
import { WebGL2Backend } from './gfx/webgl2';
import { Sprites as S } from './sprites';

const TAU = Math.PI * 2;
const MAX_LIGHTS = 360;
const GEM_COLOR = { blue: '#60a5fa', green: '#4ade80', red: '#f87171', purple: '#c084fc' } as const;

export type BackendPreference = 'auto' | 'webgl2' | 'canvas2d';

interface PropInst {
  x: number;
  y: number;
  sprite: Img;
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

export class Renderer {
  readonly backend: Backend;
  readonly fx: FX;
  quality = 1;
  W = 1;
  H = 1;
  dpr = 1;
  zoom = 1;
  cam = { x: 0, y: 0 };
  private stage: StageDef = STAGES[0]!;
  private chunkCache = new Map<string, PropInst[]>();
  private ground: HTMLCanvasElement | null = null;
  private menuT = 0;
  private dt = 0;
  /** Flat light list: x, y, r, alpha. */
  private lights: number[] = [];
  private visible: Enemy[] = [];
  private spike: Img | null = null;
  private hawk: Img | null = null;
  private arrow: Img | null = null;

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

  setStage(stage: StageDef): void {
    this.stage = stage;
    this.chunkCache.clear();
    this.ground = null;
  }

  worldToScreen(x: number, y: number): [number, number] {
    return [(x - this.cam.x) * this.zoom + this.W / 2, (y - this.cam.y) * this.zoom + this.H / 2];
  }

  private light(x: number, y: number, r: number, a: number): void {
    if (this.lights.length < MAX_LIGHTS * 4) this.lights.push(x, y, r, a);
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
    const k = 1 - Math.exp(-10 * frameDt);
    this.cam.x += (ppx - this.cam.x) * k;
    this.cam.y += (ppy - this.cam.y) * k;
    g.viewW = this.W / this.zoom / 2;
    g.viewH = this.H / this.zoom / 2;
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
    this.light(ppx, ppy, 460, 1);
    this.light(ppx, ppy, 900, 0.35);
    const vw = g.viewW + 80,
      vh = g.viewH + 80;
    const x0 = this.cam.x - vw,
      y0 = this.cam.y - vh,
      x1 = this.cam.x + vw,
      y1 = this.cam.y + vh;
    this.drawGround(x0, y0, x1, y1);
    this.drawProps(x0, y0, x1, y1);
    this.drawFog(g, x0, y0, x1, y1);
    this.drawZones(g);
    this.drawMines(g);
    this.drawTelegraphs();
    this.drawCorpses();
    this.drawPickups(g, a, x0, y0, x1, y1);
    this.drawShadows(g, a, x0, y0, x1, y1, ppx, ppy);
    this.drawEnemies(g, a, x0, y0, x1, y1);
    this.drawAllies(g, a);
    this.drawPlayer(g, ppx, ppy);
    this.drawEnemyProjectiles(g, a);
    this.drawProjectiles(g, a);
    this.drawLighting(g);
    B.setView(z, 0, 0, z, tx, ty);
    this.drawAdditive(g, a, ppx, ppy);
    this.drawTexts();
    this.drawPlayerBars(g, ppx, ppy);
    B.setView(1, 0, 0, 1, 0, 0);
    this.drawPost(g);
    this.drawIndicators(g, a);
    B.end();
  }

  /* ------------------------------ world layers ------------------------------ */

  private drawGround(x0: number, y0: number, x1: number, y1: number): void {
    this.ground ??= S.groundTile(this.stage.pal);
    this.backend.pattern(this.ground, x0, y0, x1, y1);
  }

  private chunkProps(cx: number, cy: number): PropInst[] {
    const key = cx + ',' + cy;
    let list = this.chunkCache.get(key);
    if (list) return list;
    list = [];
    const seed = this.stage.pal.seed;
    const n = Math.floor(U.hash2(cx, cy, seed) * 4);
    for (let i = 0; i < n; i++) {
      const h1 = U.hash2(cx * 7 + i, cy * 13 + i, seed + 1),
        h2 = U.hash2(cx * 3 - i, cy * 5 + i * 2, seed + 2),
        h3 = U.hash2(cx + i * 11, cy - i * 17, seed + 3);
      const kind = this.stage.props[Math.floor(h3 * this.stage.props.length)]!;
      list.push({ x: cx * 320 + h1 * 320, y: cy * 320 + h2 * 320, sprite: S.prop(kind, Math.floor(h1 * 9999) + i, this.stage.pal) });
    }
    if (cx === 0 && cy === 0) list = []; // keep the spawn point clear
    this.chunkCache.set(key, list);
    return list;
  }

  private drawProps(x0: number, y0: number, x1: number, y1: number): void {
    const B = this.backend;
    for (let cy = Math.floor(y0 / 320); cy <= Math.floor(y1 / 320); cy++)
      for (let cx = Math.floor(x0 / 320); cx <= Math.floor(x1 / 320); cx++)
        for (const pr of this.chunkProps(cx, cy)) {
          B.ellipse(pr.x, pr.y + 8, 22, 9, 0, '#000', 0.35);
          B.image(pr.sprite, pr.x, pr.y);
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
      this.backend.glow(x0 + fx * w, y0 + fy * h, 180 + U.hash2(i, 3, 7) * 200, pal.fog, 0.16);
    }
    if (this.dt > 0 && Math.random() < 0.5)
      this.fx.ambient(
        x0 + Math.random() * w,
        y0 + Math.random() * h,
        U.lerp(-8, 8, Math.random()),
        U.lerp(-22, -8, Math.random()),
        3,
        U.lerp(1.5, 3, Math.random()),
        pal.ember,
      );
  }

  private drawZones(g: Game): void {
    const B = this.backend,
      t = g.time;
    for (const z of g.zones) {
      const fade = Math.max(0, Math.min(1, z.age * 4, (z.dur - z.age) * 2));
      if (z.kind === 'blackhole') {
        B.radial(z.x, z.y, z.r, '#000', fade, '#0a0019', 0.95 * fade, 0.55);
        B.ring(z.x, z.y, z.r * 0.85, z.r * 0.85, 0, z.r * 0.25, z.color, 0.5 * fade, 1.5);
        B.ring(z.x, z.y, z.r * 1.05, z.r * 0.35, t * 2, 2, z.color, 0.8 * fade);
        this.light(z.x, z.y, z.r * 1.5, 0.5);
      } else if (z.kind === 'laser') {
        B.radial(z.x, z.y, z.r, '#fff', 0.9 * fade, z.color, 0.7 * fade, 0.4);
        this.light(z.x, z.y, z.r * 3, 1);
      } else {
        const pulse = 0.85 + Math.sin(t * 6 + z.x) * 0.15;
        B.radial(z.x, z.y, z.r, z.color, 0.45 * pulse * fade, z.color, 0.25 * fade, 0.7);
        const rr = z.r * (0.95 + Math.sin(t * 4) * 0.03);
        B.ring(z.x, z.y, rr, rr, 0, 1.5, z.color, 0.5 * pulse * fade);
        if (z.kind === 'fire' && this.dt > 0 && Math.random() < 0.5)
          this.fx.burst(z.x + U.lerp(-z.r, z.r, Math.random()) * 0.8, z.y + U.lerp(-z.r, z.r, Math.random()) * 0.8, '#ff9a3c', 1, {
            speed: 20,
            life: 0.5,
            up: true,
            size: 3,
          });
        this.light(z.x, z.y, z.r * 1.8, 0.5);
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
    }
  }

  private drawTelegraphs(): void {
    const B = this.backend;
    for (const t of this.fx.tele) {
      const k = t.t / t.max;
      if (t.type === 'circle') {
        const c = t.color || '#f87171';
        B.circle(t.x, t.y, t.r, c, 0.18);
        B.ring(t.x, t.y, t.r * k, t.r * k, 0, 2, c, 0.7);
        B.ring(t.x, t.y, t.r, t.r, 0, 2, c, 0.7);
      } else if (!t.e.dead) {
        const e = t.e,
          ang = Math.atan2(t.py - e.y, t.px - e.x),
          len = 520,
          dx = Math.cos(ang),
          dy = Math.sin(ang);
        B.line(e.x, e.y, e.x + dx * len, e.y + dy * len, e.r * 2, '#f87171', 0.16);
        B.line(e.x, e.y, e.x + dx * len * k, e.y + dy * len * k, e.r * 2, '#f87171', 0.45);
      }
    }
  }

  private drawCorpses(): void {
    for (const c of this.fx.corpses) {
      const k = c.life / c.max;
      this.backend.image(S.enemy(c.type, c.r, c.col, c.tier), c.x, c.y, { sx: c.flip, sy: 0.4 + 0.6 * k, alpha: k * 0.5 });
    }
  }

  private drawPickups(g: Game, a: number, x0: number, y0: number, x1: number, y1: number): void {
    const B = this.backend,
      t = g.time;
    let lights = 0;
    for (const k of g.pickups) {
      const x = k.px + (k.x - k.px) * a,
        y = k.py + (k.y - k.py) * a;
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      const bob = Math.sin(t * 4 + k.bob) * 2;
      if (k.kind === 'gem') {
        const gem = k.gem ?? 'blue';
        B.image(S.gem(GEM_COLOR[gem], gem === 'purple' ? 8 : gem === 'red' ? 7 : 6), x, y + bob);
      } else if (k.kind === 'gold') B.image(S.coin(6), x, y + bob);
      else if (k.kind === 'mat') B.image(S.pickup('material'), x, y + bob, { tint: MAT_BY_ID[k.mat ?? 'iron']!.color, tintA: 0.45 });
      else {
        B.image(S.pickup(k.kind), x, y + (k.kind === 'brazier' ? 0 : bob));
        if (k.kind === 'brazier' || k.kind === 'chest' || k.kind === 'bosschest') {
          if (lights++ < 20) this.light(x, y, 120, 0.8);
          if (k.kind === 'brazier' && this.dt > 0 && Math.random() < 0.3)
            this.fx.burst(x + U.lerp(-4, 4, Math.random()), y - 8, '#ff9a3c', 1, { speed: 20, life: 0.7, up: true, size: 3 });
        }
      }
    }
  }

  private drawShadows(g: Game, a: number, x0: number, y0: number, x1: number, y1: number, ppx: number, ppy: number): void {
    const B = this.backend;
    for (const e of g.enemies) {
      const x = e.px + (e.x - e.px) * a,
        y = e.py + (e.y - e.py) * a;
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      B.ellipse(x, y + e.r * 0.8, e.r, e.r * 0.4, 0, '#000', 0.35);
    }
    for (const al of g.allies) B.ellipse(al.px + (al.x - al.px) * a, al.py + (al.y - al.py) * a + 12, 10, 4, 0, '#000', 0.35);
    B.ellipse(ppx, ppy + 24, 14, 5, 0, '#000', 0.35);
  }

  private drawEnemies(g: Game, a: number, x0: number, y0: number, x1: number, y1: number): void {
    const B = this.backend,
      t = g.time,
      tint = this.stage.enemyTint;
    // y-sort visible enemies so overlapping sprites stack front-to-back correctly
    const vis = this.visible;
    vis.length = 0;
    for (const e of g.enemies) {
      if (e.dead) continue;
      const x = e.px + (e.x - e.px) * a,
        y = e.py + (e.y - e.py) * a;
      if (x < x0 - 60 || x > x1 + 60 || y < y0 - 60 || y > y1 + 60) continue;
      vis.push(e);
    }
    vis.sort((p, q) => p.y - q.y);
    for (const e of vis) {
      const ex = e.px + (e.x - e.px) * a,
        ey = e.py + (e.y - e.py) * a;
      const sp = S.enemy(e.type, e.r, e.def.col, e.boss ? 0 : e.elite ? 3 : e.tier);
      const frozen = (e.st.freeze ?? 0) > 0;
      const bobY = frozen ? 0 : Math.abs(Math.sin(e.anim)) * (e.boss ? 3 : 2);
      const sq = frozen ? 0 : Math.sin(e.anim * 2) * 0.05;
      const fade = e.spawnT > 0 ? Math.max(0.2, 1 - e.spawnT * 2) : 1;
      if (e.elite || e.boss) B.glow(ex, ey - bobY, e.r * 2, e.def.col.eye, 0.6 * fade);
      let tc: string | undefined,
        ta = 1;
      if (e.hitFlash <= 0) {
        if (frozen) tc = 'rgba(160,220,255,0.55)';
        else if (e.st.chill) tc = 'rgba(120,180,255,0.3)';
        else if (e.st.burn) tc = Math.sin(t * 20) > 0 ? 'rgba(255,120,40,0.3)' : 'rgba(255,120,40,0.15)';
        else if (tint) tc = tint;
      } else ta = 0;
      B.image(sp, ex, ey - bobY, { sx: e.flip * (1 + sq), sy: 1 - sq, alpha: fade, flash: e.hitFlash > 0 ? 1 : 0, tint: tc, tintA: ta });
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
      }
      if (e.elite) this.light(ex, ey, 110, 0.5);
      else if (e.boss) this.light(ex, ey, 200, 0.8);
      else if (this.lights.length < 300 * 4) this.light(ex, ey, e.r * 2.2 + 16, 0.28);
    }
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

  private drawAllies(g: Game, a: number): void {
    const B = this.backend,
      t = g.time;
    for (const al of g.allies) {
      const x = al.px + (al.x - al.px) * a,
        y = al.py + (al.y - al.py) * a;
      const fade = Math.max(0, Math.min(1, (al.life - al.age) * 2, al.age * 3));
      const c = al.color,
        flip = al.flip || 1;
      B.glow(x, y + 4, 18, c, fade);
      if (al.kind === 'skeleton')
        B.image(S.enemy('skeleton', 12, { body: '#d6cfc0', eye: c }, 0), x, y - Math.abs(Math.sin(al.walk)) * 2, { sx: flip, alpha: fade });
      else if (al.kind === 'wraith') B.image(S.enemy('wraith', 13, { body: '#86efac', eye: '#fff' }, 0), x, y, { sx: flip, alpha: fade });
      else if (al.kind === 'hawk') {
        B.image(this.hawkSprite(), x, y, { sx: flip, rot: Math.sin(t * 12) * 0.15, alpha: fade, tint: c });
        B.circle(x, y, 4, '#5a3a1a', fade);
        B.circle(x + 5 * flip, y + 1, 2, '#f5c542', fade);
      } else if (al.kind === 'bat')
        B.image(S.enemy('bat', 8, { body: '#7f1d1d', eye: '#fca5a5' }, 0), x, y, { sx: flip, rot: Math.sin(t * 14) * 0.2, alpha: fade });
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
        B.line(x - 11, y - 4, x + 11, y - 4, 2, '#99a', fade);
        B.circle(x, y, 3, c, fade);
      } else if (al.kind === 'clone') {
        B.image(S.character(g.player.char, 72) as Img, x, y, { ox: 36, oy: 62, sx: flip, alpha: fade * 0.6, tint: c, tintA: 0.7 });
      }
      this.light(x, y, 70, 0.4);
    }
  }

  private drawPlayer(g: Game, x: number, y: number): void {
    const B = this.backend,
      p = g.player,
      t = g.time;
    const moving = p.move.x || p.move.y;
    const bob = moving ? Math.abs(Math.sin(p.walkT)) * 3 : Math.sin(t * 2) * 1;
    const flip = p.face.x < 0 ? -1 : 1;
    if (p.frostAuraR) {
      B.circle(x, y, p.frostAuraR, 'rgb(186,230,253)', 0.06);
      B.ring(x, y, p.frostAuraR, p.frostAuraR, 0, 1.5, 'rgb(186,230,253)', 0.35);
    }
    if (p.auraColor) {
      B.glow(x, y - bob + 10, 60, p.auraColor, 0.55 + Math.sin(t * 5) * 0.15);
      if (this.dt > 0 && Math.random() < 0.4)
        this.fx.burst(x + U.lerp(-16, 16, Math.random()), y + 20, p.auraColor, 1, { speed: 15, life: 0.8, up: true, size: 3 });
    }
    const alpha = p.invulnT > 0.15 ? 0.5 + Math.sin(t * 30) * 0.3 : 1;
    const s = 1.15,
      sxs = moving ? 1 + Math.sin(p.walkT * 2) * 0.03 : 1;
    B.image(S.character(p.char, 72) as Img, x, y - bob, {
      ox: 36,
      oy: 62,
      sx: flip * s * sxs,
      sy: s,
      alpha,
      flash: p.hurtFlash > 0 ? 1 : 0,
    });
    if (p.shield > 0) {
      const r = 30 + Math.sin(t * 4) * 2;
      B.circle(x, y - 10, r, 'rgb(125,211,252)', 0.08);
      B.ring(x, y - 10, r, r, 0, 2, 'rgb(125,211,252)', 0.7);
    }
    if (p.blood > 0) B.ring(x, y - 10, 28, 28, 0, 2, '#ef4444', 0.3 + 0.5 * (p.blood / (p.bloodCap || 1)));
    if (p.cycloneT > 0)
      for (let i = 0; i < 3; i++) B.ring(x, y - 10 - i * 12, 40 + i * 14, 12 + i * 4, t * 8 + i, 3, 'rgb(94,234,212)', 0.6);
    if (p.stormT > 0) B.ring(x, y, 420, 420, 0, 2, 'rgb(125,211,252)', 0.5);
  }

  private drawEnemyProjectiles(g: Game, a: number): void {
    for (const pr of g.eprojs) this.backend.image(S.orb(pr.color, 5) as Img, pr.px + (pr.x - pr.px) * a, pr.py + (pr.y - pr.py) * a);
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
      if (sp.kind === 'orb') B.image(S.orb(color, sp.size || 6) as Img, x, y);
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
      if (pr.light) this.light(x, y, pr.light, 0.8);
      else if (this.lights.length < 260 * 4) this.light(x, y, 45, 0.5);
    }
  }

  private drawLighting(g: Game): void {
    const B = this.backend,
      L = this.lights,
      eclipse = g.eclipse ? 0.85 : 1;
    B.beginLights(this.stage.pal.ambient, 0.25);
    for (let i = 0; i < L.length; i += 4) B.light(L[i]!, L[i + 1]!, L[i + 2]!, L[i + 3]! * eclipse);
    for (const ex of this.fx.explosions) B.light(ex.x, ex.y, ex.r * 2.5, ex.life / ex.max);
    B.endLights();
  }

  /* ------------------------------ additive FX ------------------------------ */

  private drawParticles(): void {
    const B = this.backend,
      P = this.fx.parts;
    for (let i = 0; i < P.count; i++) {
      const f = P.flags[i]!,
        k = f & 2 ? Math.sin((P.life[i]! / P.max[i]!) * Math.PI) * 0.8 : P.life[i]! / P.max[i]!;
      if (f & 1) B.glowRGB(P.x[i]!, P.y[i]!, P.size[i]!, P.r[i]!, P.g[i]!, P.b[i]!, k);
      else B.squareRGB(P.x[i]!, P.y[i]!, P.size[i]!, P.r[i]!, P.g[i]!, P.b[i]!, k);
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

  private drawAdditive(g: Game, a: number, ppx: number, ppy: number): void {
    const B = this.backend,
      fx = this.fx,
      t = g.time;
    B.setBlend('add');
    this.drawParticles();
    for (const pr of g.projs) {
      const sp = pr.sprite;
      if (!sp || sp.kind === 'void') continue;
      const r = (pr.r || 6) * 1.6 + 4;
      B.glow(pr.px + (pr.x - pr.px) * a, pr.py + (pr.y - pr.py) * a, r, sp.color ?? '#fff', 0.5);
    }
    for (const pr of g.eprojs) B.glow(pr.px + (pr.x - pr.px) * a, pr.py + (pr.y - pr.py) * a, 12, pr.color, 0.6);
    for (const r of fx.rings) {
      const k = r.life / r.max,
        rad = r.r * (r.thin ? 1 : 0.5 + (1 - k) * 0.5);
      B.ring(r.x, r.y, rad, rad, 0, r.thin ? 2 : 4 + (1 - k) * 6, r.color, k * 0.9);
    }
    for (const nv of fx.novas) {
      const n = nv.n,
        k = 1 - n.r / n.maxR,
        w = nv.thin ? 3 : 10 + k * 8;
      B.ring(n.x, n.y, n.r, n.r, 0, w * 3, nv.color, 0.4, 1.5);
      B.ring(n.x, n.y, n.r, n.r, 0, w, nv.color, 0.85);
      B.circle(n.x, n.y, n.r, nv.color, 0.15 * k);
    }
    for (const ex of fx.explosions) {
      const k = ex.life / ex.max;
      B.glow(ex.x, ex.y, ex.r * (1.2 - k * 0.6), ex.color, k * 0.9);
      const rr = ex.r * (1 - k * 0.7);
      B.ring(ex.x, ex.y, rr, rr, 0, 3, '#fff', k);
    }
    const pts: number[] = [];
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
      this.glowPath(pts, b.w * (0.5 + k), b.color, k, k * 0.8);
    }
    for (const bo of fx.bolts) {
      const k = bo.life / bo.max;
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
      this.glowPath(pts, 4 * k + 1, bo.color, k, k);
      B.glow(bo.x, bo.y, 40, bo.color, k * 0.7);
    }
    for (const ln of fx.lines) {
      const k = ln.life / ln.max,
        ca = Math.cos(ln.angle),
        sa = Math.sin(ln.angle),
        L = ln.len * Math.min(1, (1 - k) * 3 + 0.2);
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
    for (const ar of fx.arcs) {
      const k = ar.life / ar.max,
        r = ar.r * (ar.thin ? 1 : 0.7 + (1 - k) * 0.3);
      B.sector(ar.x, ar.y, r, ar.angle, ar.halfArc, ar.color, (ar.thin ? 0.35 : 0.5) * k);
      B.arc(ar.x, ar.y, r, ar.angle, ar.halfArc, 3, '#fff', k);
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
      this.glowPath(pts, 6, w.color, k, 0);
    }
    for (const lb of fx.lobs) {
      const k = lb.t / lb.max,
        x = U.lerp(lb.x, lb.tx, k),
        y = U.lerp(lb.y, lb.ty, k) - Math.sin(k * Math.PI) * 90;
      B.image(S.orb(lb.color, 6) as Img, x, y);
    }
    for (const m of fx.meteors) {
      const k = m.t / m.max,
        y = m.y - (1 - k) * 600;
      if (m.small) B.image(S.bolt(m.color || '#fde047', 18, 3, 'arrow') as Img, m.x, y, { rot: Math.PI / 2 });
      else {
        B.image(S.orb('#ff7043', 14) as Img, m.x + (1 - k) * 120, y);
        if (this.dt > 0) fx.trail(m.x + (1 - k) * 120, y, '#ff9a3c', 8);
      }
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
          B.line(ppx, ppy, x2, y2, 40, '#fbbf24', 0.35, 1.5, '#fbbf24', 0);
          B.line(ppx, ppy, x2, y2, 14, w.evolved ? '#fb923c' : '#fbbf24', 0.8, 0, '#fbbf24', 0);
          B.line(ppx, ppy, x2, y2, 4, '#fff', 0.8, 0, '#fff', 0.2);
          this.light(x2, y2, 80, 0.5);
        }
      }
      if (w.id === 'plague_aura' && w.radius) {
        const r = w.radius;
        B.radial(ppx, ppy, r, w.evolved ? '#84cc16' : '#a3e635', 0.02, '#a3e635', 0.18, 0.8, 0.3);
        const rr = r * (0.98 + Math.sin(t * 3) * 0.02);
        B.ring(ppx, ppy, rr, rr, 0, 2, 'rgb(163,230,53)', 0.35);
      }
    }
    if (p.feastT > 0) B.ring(ppx, ppy, 245, 245, 0, 3, 'rgb(239,68,68)', 0.5);
    B.setBlend('normal');
  }

  private drawTexts(): void {
    for (const t of this.fx.texts) {
      const k = Math.min(1, (t.life / t.max) * 2);
      const size = t.crit ? 22 : t.dmg ? 14 : t.small ? 14 : 16;
      this.backend.text(t.text, t.x, t.y, size, t.color, k, !!t.crit);
    }
  }

  private drawPlayerBars(g: Game, px: number, py: number): void {
    const B = this.backend,
      p = g.player,
      w = 40,
      x = px - w / 2,
      y = py + 30;
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
    B.radial(W / 2, H / 2, R, '#000', 0, '#000', 0.5 * (R / (Math.max(W, H) * 0.75)), 0.999, inner);
    const hpk = p.hp / p.stats.maxHp;
    if (hpk < 0.35) {
      const a = ((0.35 - hpk) / 0.35) * (0.35 + Math.sin(g.time * 6) * 0.15);
      B.radial(W / 2, H / 2, R, '#b40000', 0, '#b40000', a, 0.999, (Math.min(W, H) * 0.3) / R);
    }
    if (g.eclipse) B.rect(0, 0, W, H, 'rgb(80,0,120)', 0.07);
    if (this.fx.flashA > 0) B.rect(0, 0, W, H, this.fx.flashCol, this.fx.flashA * 0.7);
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
      ty = U.clamp(y, m, H - m);
    this.backend.glow(tx, ty, 18 * this.dpr, color, 0.6);
    this.backend.image(this.arrowSprite(), tx, ty, { rot: ang, sx: this.dpr, tint: color });
  }

  private drawIndicators(g: Game, a: number): void {
    const W = this.W,
      H = this.H;
    for (const e of g.enemies) {
      if (!(e.boss || e.elite) || e.dead) continue;
      const [sx, sy] = this.worldToScreen(e.px + (e.x - e.px) * a, e.py + (e.y - e.py) * a);
      if (sx > 0 && sx < W && sy > 0 && sy < H) continue;
      this.indicator(sx, sy, e.boss ? '#f87171' : '#c084fc');
    }
    for (const k of g.pickups) {
      if (k.kind !== 'chest' && k.kind !== 'bosschest') continue;
      const [sx, sy] = this.worldToScreen(k.x, k.y);
      if (sx > 0 && sx < W && sy > 0 && sy < H) continue;
      this.indicator(sx, sy, '#ffd700');
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
    this.drawGround(cx - vw, cy - vh, cx + vw, cy + vh);
    this.drawProps(cx - vw, cy - vh, cx + vw, cy + vh);
    if (Math.random() < 0.6 && dt > 0)
      this.fx.burst(cx + U.lerp(-vw, vw, Math.random()), cy + vh, stage.pal.ember, 1, { speed: 20, life: 4, up: true, size: 3 });
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
    B.end();
  }
}
