/**
 * Minimap and full map. The world is endless, so both views are centred on the player: the minimap is
 * a short-range radar in the HUD corner, the full map (M / gamepad Back / tap the minimap) a wide view
 * of the ground explored this run with the trail walked so far. Both mark the scenery's structures
 * (pillars, obelisks, ruins…), map objects and pickups (drawn with their in-world sprites). Key points
 * of interest outside a view are pinned to its rim as arrows so they can always be found.
 *
 * Presentation-only: it reads the simulation and never writes to it.
 */
import { U } from '../core/util';
import { SHRINE_DEFS } from '../data/shrines';
import type { Game } from '../game/game';
import type { StageDef } from '../game/types';
import { CHUNK, propLayout, type PropSpot } from '../render/layout';
import { Sprites as S, propLight } from '../render/sprites';

/** World units per explored cell (fog-of-war granularity); one scenery chunk, so a cell's props are known. */
const CELL = CHUNK;
/** World distance around the player that counts as seen (a bit more than half a screen). */
const SIGHT = 760;
/** World radius shown by the minimap. */
const MINI_R = 1300;
/** World radius across half the full map's shorter side: zooms out to fit the explored ground, within these bounds. */
const FULL_MIN = 2000;
const FULL_MAX = 12000;
/** The trail gets a new point after this much travel; past TRAIL_MAX points it is thinned by half. */
const TRAIL_STEP = 90;
const TRAIL_MAX = 3000;

type PoiKind = 'boss' | 'hoarder' | 'totem' | 'shrine' | 'cask' | 'item';
interface Poi {
  x: number;
  y: number;
  kind: PoiKind;
  /** Marker colour; for items, the rim-arrow colour. */
  color: string;
  /** Items: the pickup sprite drawn as the marker, and its size relative to a full one. */
  sprite?: string;
  scale?: number;
  /** Pinned to the rim as an arrow when outside the view. */
  arrow: boolean;
}

/** Marker colours, also used by the full map's legend. */
const POI_COLOR = {
  boss: '#ef4444',
  hoarder: '#f5c542',
  totem: '#a78bfa',
  cask: '#d97706',
};
/** Pickups worth a marker: sprite, rim-arrow colour (only the rare ones get arrows) and marker scale. */
const ITEMS: Record<string, { sprite: string; arrow?: string; scale: number }> = {
  chest: { sprite: 'chest', arrow: '#fde68a', scale: 1 },
  bosschest: { sprite: 'bosschest', arrow: '#ff44aa', scale: 1.1 },
  magnet: { sprite: 'magnet', arrow: '#4fd1ff', scale: 1 },
  bomb: { sprite: 'bomb', arrow: '#ffb347', scale: 1 },
  clock: { sprite: 'clock', arrow: '#b28dff', scale: 1 },
  food: { sprite: 'food', scale: 0.9 },
  brazier: { sprite: 'brazier', scale: 0.9 },
  mat: { sprite: 'material', scale: 0.6 },
  ember: { sprite: 'ember', scale: 0.6 },
};
/** Scenery drawn as structures; the rest is faint terrain, and ground clutter is left off. */
const STRUCTURES = new Set(['pillar', 'brokenpillar', 'obelisk', 'ruin', 'candelabra', 'crystal', 'icespike', 'floatrock', 'grave']);
const CLUTTER = new Set(['bones', 'roots', 'pew']);

/** Legend entries: a colour swatch (dot or tower) or a pickup sprite. */
const LEGEND: [string, string, 'dot' | 'tower' | 'sprite'][] = [
  ['You', '#ffffff', 'dot'],
  ['Enemy', '#f87171', 'dot'],
  ['Elite', '#fb923c', 'dot'],
  ['Boss', POI_COLOR.boss, 'dot'],
  ['Shrine', '#5eead4', 'dot'],
  ['Hoarder', POI_COLOR.hoarder, 'dot'],
  ['Hex Totem', POI_COLOR.totem, 'dot'],
  ['Ember Cask', POI_COLOR.cask, 'dot'],
  ['Structure', '#d6d3d1', 'tower'],
  ['Chest', 'chest', 'sprite'],
  ['Magnet', 'magnet', 'sprite'],
  ['Bomb', 'bomb', 'sprite'],
  ['Clock', 'clock', 'sprite'],
  ['Food', 'food', 'sprite'],
  ['Brazier', 'brazier', 'sprite'],
  ['Loot', 'ember', 'sprite'],
];
const legendHtml = (): string =>
  LEGEND.map(([n, c, t]) =>
    t === 'sprite'
      ? `<span><img src="${S.pickup(c).toDataURL()}" alt="">${n}</span>`
      : `<span><i class="${t}" style="background:${c}"></i>${n}</span>`,
  ).join('');

const cellKey = (cx: number, cy: number): number => (cx + 32768) * 65536 + (cy + 32768);

export class MapView {
  private readonly mini: HTMLCanvasElement;
  private readonly miniCtx: CanvasRenderingContext2D;
  private readonly overlay: HTMLElement;
  private readonly full: HTMLCanvasElement;
  private readonly fullCtx: CanvasRenderingContext2D;
  private miniPx = 0;
  private fullW = 0;
  private fullH = 0;
  private open = false;
  private shown = false;
  private readonly explored = new Set<number>();
  /** Explored cells as a flat [cx, cy, cx, cy, …] list for drawing. */
  private readonly cells: number[] = [];
  private lastCell = NaN;
  /** Bounding box of the explored cells, in cell coordinates. */
  private box = { x0: 0, y0: 0, x1: 0, y1: 0 };
  /** Current full-map radius (eases toward the fitted one). */
  private fullR = FULL_MIN;
  /** Player path as a flat [x, y, x, y, …] list. */
  private readonly trail: number[] = [];
  private readonly pois: Poi[] = [];
  /** Scenery per cell (a pure function of the stage), filled lazily. */
  private readonly props = new Map<number, PropSpot[]>();
  private propStage: StageDef | null = null;

  constructor(miniHost: HTMLElement, overlayHost: HTMLElement) {
    this.mini = document.createElement('canvas');
    this.mini.id = 'minimap';
    this.mini.setAttribute('role', 'button');
    this.mini.setAttribute('aria-label', 'Open map (M)');
    this.mini.title = 'Map (M)';
    this.miniCtx = this.mini.getContext('2d')!;
    miniHost.appendChild(this.mini);

    this.overlay = document.createElement('div');
    this.overlay.id = 'mapview';
    this.overlay.className = 'hidden';
    this.overlay.innerHTML =
      `<div class="map-head"><span class="map-title">Map</span><span class="muted"><span class="kbd">M</span> close</span></div>` +
      `<canvas></canvas><div class="map-legend">${legendHtml()}</div>`;
    this.full = this.overlay.querySelector('canvas')!;
    this.fullCtx = this.full.getContext('2d')!;
    overlayHost.appendChild(this.overlay);

    this.mini.addEventListener('click', () => this.toggle());
    this.overlay.addEventListener('click', () => this.setOpen(false));
    window.addEventListener('resize', () => this.measure());
    this.measure();
  }

  /** Forget the previous run's exploration. */
  reset(): void {
    this.explored.clear();
    this.cells.length = 0;
    this.trail.length = 0;
    this.lastCell = NaN;
    this.box = { x0: 0, y0: 0, x1: 0, y1: 0 };
    this.miniPx = 0; // re-measure once the HUD is laid out
    this.setOpen(false);
  }

  toggle(): void {
    this.setOpen(!this.open);
  }

  private setOpen(v: boolean): void {
    if (v && !this.open) this.fullR = 0; // snap the zoom on open
    this.open = v;
    this.mini.setAttribute('aria-label', v ? 'Close map (M)' : 'Open map (M)');
  }

  /** Size the canvases' backing stores to their CSS boxes (on resize only, never per frame). */
  private measure(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.miniPx = Math.round((this.mini.clientWidth || 150) * dpr);
    this.mini.width = this.mini.height = this.miniPx;
    this.fullW = Math.round(Math.min(window.innerWidth * 0.86, 1100) * dpr);
    this.fullH = Math.round(Math.min(window.innerHeight * 0.72, 760) * dpr);
    this.full.width = this.fullW;
    this.full.height = this.fullH;
  }

  /** Track exploration and redraw. Called once per rendered frame while a run exists. */
  update(g: Game): void {
    const p = g.player;
    if (!p) return;
    this.explore(p.x, p.y);
    this.collectPois(g);
    if (!this.miniPx) this.measure();
    this.drawMini(g);
    const show = this.open && g.state === 'play';
    if (show !== this.shown) {
      this.shown = show;
      this.overlay.classList.toggle('hidden', !show);
    }
    if (show) this.drawFull(g);
  }

  private explore(x: number, y: number): void {
    const t = this.trail,
      n = t.length;
    if (!n || Math.hypot(x - t[n - 2]!, y - t[n - 1]!) >= TRAIL_STEP) {
      t.push(x, y);
      if (t.length > TRAIL_MAX * 2) {
        let w = 0;
        for (let i = 0; i < t.length; i += 4) {
          t[w++] = t[i]!;
          t[w++] = t[i + 1]!;
        }
        t.length = w;
      }
    }
    const cx = Math.floor(x / CELL),
      cy = Math.floor(y / CELL),
      k = cellKey(cx, cy);
    if (k === this.lastCell) return;
    this.lastCell = k;
    const reach = Math.ceil(SIGHT / CELL);
    for (let j = -reach; j <= reach; j++)
      for (let i = -reach; i <= reach; i++) {
        // a cell counts as seen when its centre is within sight
        const ox = (cx + i + 0.5) * CELL - x,
          oy = (cy + j + 0.5) * CELL - y;
        if (ox * ox + oy * oy > SIGHT * SIGHT) continue;
        const key = cellKey(cx + i, cy + j);
        if (this.explored.has(key)) continue;
        this.explored.add(key);
        this.cells.push(cx + i, cy + j);
        const b = this.box;
        if (this.cells.length === 2) {
          b.x0 = b.x1 = cx + i;
          b.y0 = b.y1 = cy + j;
        } else {
          b.x0 = Math.min(b.x0, cx + i);
          b.x1 = Math.max(b.x1, cx + i);
          b.y0 = Math.min(b.y0, cy + j);
          b.y1 = Math.max(b.y1, cy + j);
        }
      }
  }

  private collectPois(g: Game): void {
    const out = this.pois;
    out.length = 0;
    // common loot first, so power-ups and then the big markers draw over it
    for (const k of g.pickups) {
      const it = ITEMS[k.kind];
      if (k.dead || !it || it.arrow) continue;
      out.push({ x: k.x, y: k.y, kind: 'item', color: '', sprite: it.sprite, scale: it.scale, arrow: false });
    }
    for (const k of g.pickups) {
      const it = ITEMS[k.kind];
      if (k.dead || !it?.arrow) continue;
      out.push({ x: k.x, y: k.y, kind: 'item', color: it.arrow, sprite: it.sprite, scale: it.scale, arrow: true });
    }
    for (const e of g.enemies) {
      if (e.dead) continue;
      if (e.object) out.push({ x: e.x, y: e.y, kind: 'cask', color: POI_COLOR.cask, arrow: false });
      else if (e.boss) out.push({ x: e.x, y: e.y, kind: 'boss', color: POI_COLOR.boss, arrow: true });
      else if (e.type === 'hoarder') out.push({ x: e.x, y: e.y, kind: 'hoarder', color: POI_COLOR.hoarder, arrow: true });
      else if (e.type === 'totem') out.push({ x: e.x, y: e.y, kind: 'totem', color: POI_COLOR.totem, arrow: true });
    }
    for (const s of g.shrines)
      if (!s.used && !s.dead) out.push({ x: s.x, y: s.y, kind: 'shrine', color: SHRINE_DEFS[s.kind].color, arrow: true });
  }

  private propsAt(g: Game, cx: number, cy: number): PropSpot[] {
    if (this.propStage !== g.stage) {
      this.props.clear();
      this.propStage = g.stage;
    }
    const key = cellKey(cx, cy);
    let list = this.props.get(key);
    if (!list) {
      list = propLayout(cx, cy, g.stage).filter((s) => !CLUTTER.has(s.kind));
      this.props.set(key, list);
    }
    return list;
  }

  /**
   * Scenery of one cell: terrain as faint dots, structures as small towers capped in their glow colour.
   * (ox, oy) maps world to screen: screen = o + world * k.
   */
  private drawCellProps(
    x: CanvasRenderingContext2D,
    g: Game,
    cellX: number,
    cellY: number,
    ox: number,
    oy: number,
    k: number,
    u: number,
  ): void {
    const list = this.propsAt(g, cellX, cellY);
    if (!list.length) return;
    const pal = g.stage.pal;
    for (const s of list) {
      const sx = ox + s.x * k,
        sy = oy + s.y * k;
      if (!STRUCTURES.has(s.kind)) {
        x.fillStyle = U.rgba(pal.propLight, 0.4);
        x.fillRect(sx - u, sy - u, 2 * u, 2 * u);
        continue;
      }
      x.fillStyle = 'rgba(0,0,0,0.6)';
      x.fillRect(sx - 2.2 * u, sy - 5.2 * u, 4.4 * u, 7.4 * u);
      x.fillStyle = U.rgba(U.shade(pal.propLight, 0.18), 0.9);
      x.fillRect(sx - 1.6 * u, sy - 4.6 * u, 3.2 * u, 6.2 * u);
      const glow = propLight(s.kind, pal)?.color;
      if (glow) {
        x.fillStyle = glow;
        x.fillRect(sx - 1.6 * u, sy - 4.6 * u, 3.2 * u, 2 * u);
      }
    }
  }

  /* ------------------------------ drawing ------------------------------ */

  private drawMini(g: Game): void {
    const x = this.miniCtx,
      Sz = this.miniPx,
      c = Sz / 2,
      k = c / MINI_R,
      p = g.player,
      pal = g.stage.pal;
    x.clearRect(0, 0, Sz, Sz);
    x.save();
    x.beginPath();
    x.arc(c, c, c - 1, 0, U.TAU);
    x.clip();
    x.fillStyle = U.rgba(pal.groundDark, 0.82);
    x.fillRect(0, 0, Sz, Sz);
    // range rings
    x.strokeStyle = 'rgba(255,255,255,0.08)';
    x.lineWidth = 1;
    x.beginPath();
    x.arc(c, c, c * 0.5, 0, U.TAU);
    x.stroke();
    const u = Sz / 150;
    for (let cy = Math.floor((p.y - MINI_R) / CELL); cy <= Math.floor((p.y + MINI_R) / CELL); cy++)
      for (let cx = Math.floor((p.x - MINI_R) / CELL); cx <= Math.floor((p.x + MINI_R) / CELL); cx++)
        this.drawCellProps(x, g, cx, cy, c - p.x * k, c - p.y * k, k, u);
    this.drawEnemies(x, g, c, c, k, MINI_R, MINI_R, Math.max(1.5, Sz / 110));
    for (const o of this.pois) this.drawPoi(x, o, c + (o.x - p.x) * k, c + (o.y - p.y) * k, c, c, c - Sz * 0.07, u);
    this.drawPlayer(x, c, c, p.face.x, p.face.y, u);
    x.restore();
    x.strokeStyle = U.rgba(pal.rune, 0.55);
    x.lineWidth = Math.max(1, Sz / 120);
    x.beginPath();
    x.arc(c, c, c - x.lineWidth / 2, 0, U.TAU);
    x.stroke();
  }

  private drawFull(g: Game): void {
    const x = this.fullCtx,
      W = this.fullW,
      H = this.fullH,
      cx = W / 2,
      cy = H / 2,
      p = g.player,
      pal = g.stage.pal;
    const b = this.box,
      fit = Math.max(p.x - b.x0 * CELL, (b.x1 + 1) * CELL - p.x, p.y - b.y0 * CELL, (b.y1 + 1) * CELL - p.y) * 1.1,
      want = U.clamp(fit, FULL_MIN, FULL_MAX);
    this.fullR = this.fullR ? this.fullR + (want - this.fullR) * 0.12 : want;
    const k = Math.min(W, H) / 2 / this.fullR,
      rx = cx / k,
      ry = cy / k,
      u = Math.min(W, H) / 400;
    x.clearRect(0, 0, W, H);
    x.fillStyle = U.rgba(pal.groundDark, 0.9);
    x.fillRect(0, 0, W, H);
    // explored ground
    x.fillStyle = U.rgba(pal.ground, 0.85);
    const cs = CELL * k + 0.6; // overlap a hair so neighbouring cells don't show seams
    for (let i = 0; i < this.cells.length; i += 2) {
      const sx = cx + (this.cells[i]! * CELL - p.x) * k,
        sy = cy + (this.cells[i + 1]! * CELL - p.y) * k;
      if (sx > W || sy > H || sx + cs < 0 || sy + cs < 0) continue;
      x.fillRect(sx, sy, cs, cs);
    }
    // grid every 1000 world units, anchored to the world origin
    x.strokeStyle = 'rgba(255,255,255,0.05)';
    x.lineWidth = 1;
    x.beginPath();
    for (let gx = Math.ceil((p.x - rx) / 1000) * 1000; gx < p.x + rx; gx += 1000) {
      const sx = Math.round(cx + (gx - p.x) * k) + 0.5;
      x.moveTo(sx, 0);
      x.lineTo(sx, H);
    }
    for (let gy = Math.ceil((p.y - ry) / 1000) * 1000; gy < p.y + ry; gy += 1000) {
      const sy = Math.round(cy + (gy - p.y) * k) + 0.5;
      x.moveTo(0, sy);
      x.lineTo(W, sy);
    }
    x.stroke();
    // scenery, only where explored; markers shrink as the map zooms out
    const su = U.clamp((u * FULL_MIN * 1.5) / this.fullR, 0.55 * u, u);
    for (let i = 0; i < this.cells.length; i += 2) {
      const ccx = this.cells[i]!,
        ccy = this.cells[i + 1]!,
        sx = cx + (ccx * CELL - p.x) * k,
        sy = cy + (ccy * CELL - p.y) * k;
      if (sx > W || sy > H || sx + cs < 0 || sy + cs < 0) continue;
      this.drawCellProps(x, g, ccx, ccy, cx - p.x * k, cy - p.y * k, k, su);
    }
    // starting point
    const ox = cx - p.x * k,
      oy = cy - p.y * k;
    if (ox > 0 && oy > 0 && ox < W && oy < H) {
      x.strokeStyle = U.rgba(pal.rune, 0.7);
      x.lineWidth = 1.5 * u;
      x.beginPath();
      x.arc(ox, oy, 5 * u, 0, U.TAU);
      x.stroke();
    }
    // trail
    const t = this.trail;
    if (t.length >= 4) {
      x.strokeStyle = U.rgba(pal.rune, 0.45);
      x.lineWidth = 1.5 * u;
      x.lineJoin = 'round';
      x.beginPath();
      x.moveTo(cx + (t[0]! - p.x) * k, cy + (t[1]! - p.y) * k);
      for (let i = 2; i < t.length; i += 2) x.lineTo(cx + (t[i]! - p.x) * k, cy + (t[i + 1]! - p.y) * k);
      x.lineTo(cx, cy);
      x.stroke();
    }
    this.drawEnemies(x, g, cx, cy, k, rx, ry, Math.max(1.5, u * 1.2));
    for (const o of this.pois)
      this.drawPoi(x, o, cx + (o.x - p.x) * k, cy + (o.y - p.y) * k, cx, cy, Math.min(cx, cy) - 14 * u, u * 1.6, W, H);
    this.drawPlayer(x, cx, cy, p.face.x, p.face.y, u * 1.8);
  }

  /** Enemies as dots (elites larger); bosses, totems and the Hoarder are drawn as points of interest. */
  private drawEnemies(x: CanvasRenderingContext2D, g: Game, cx: number, cy: number, k: number, rx: number, ry: number, d: number): void {
    const p = g.player;
    x.fillStyle = 'rgba(248,113,113,0.85)';
    for (const e of g.enemies) {
      if (e.dead || e.buried || e.boss || e.elite || e.object || e.noContact) continue;
      const ox = e.x - p.x,
        oy = e.y - p.y;
      if (ox < -rx || ox > rx || oy < -ry || oy > ry) continue;
      x.fillRect(cx + ox * k - d / 2, cy + oy * k - d / 2, d, d);
    }
    x.fillStyle = '#fb923c';
    for (const e of g.enemies) {
      if (e.dead || e.buried || e.boss || !e.elite) continue;
      const ox = e.x - p.x,
        oy = e.y - p.y;
      if (ox < -rx || ox > rx || oy < -ry || oy > ry) continue;
      x.beginPath();
      x.arc(cx + ox * k, cy + oy * k, d * 1.3, 0, U.TAU);
      x.fill();
    }
  }

  /**
   * One point of interest at (sx, sy). Inside `rim` (a circle around cx, cy; or the W×H rectangle when
   * given) it is drawn as its marker; outside, as an arrow on the edge pointing toward it.
   */
  private drawPoi(
    x: CanvasRenderingContext2D,
    o: Poi,
    sx: number,
    sy: number,
    cx: number,
    cy: number,
    rim: number,
    u: number,
    W?: number,
    H?: number,
  ): void {
    const dx = sx - cx,
      dy = sy - cy,
      dist = Math.hypot(dx, dy);
    const inside = W != null && H != null ? sx > 10 * u && sy > 10 * u && sx < W - 10 * u && sy < H - 10 * u : dist <= rim;
    if (!inside) {
      if (!o.arrow) return; // loot and map objects only matter in view
      let ex = cx,
        ey = cy;
      if (W != null && H != null) {
        const m = 10 * u,
          s = Math.min((W / 2 - m) / Math.abs(dx || 1e-6), (H / 2 - m) / Math.abs(dy || 1e-6));
        ex += dx * s;
        ey += dy * s;
      } else {
        ex += (dx / dist) * rim;
        ey += (dy / dist) * rim;
      }
      const a = Math.atan2(dy, dx),
        r = (o.kind === 'boss' ? 6 : 4.5) * u;
      x.save();
      x.translate(ex, ey);
      x.rotate(a);
      x.fillStyle = o.color;
      x.strokeStyle = 'rgba(0,0,0,0.7)';
      x.lineWidth = u;
      x.beginPath();
      x.moveTo(r, 0);
      x.lineTo(-r * 0.8, r * 0.75);
      x.lineTo(-r * 0.8, -r * 0.75);
      x.closePath();
      x.fill();
      x.stroke();
      x.restore();
      return;
    }
    if (o.sprite) {
      const size = 13 * u * (o.scale ?? 1);
      x.drawImage(S.pickup(o.sprite), sx - size / 2, sy - size / 2, size, size);
      return;
    }
    x.fillStyle = o.color;
    x.strokeStyle = 'rgba(0,0,0,0.75)';
    x.lineWidth = u;
    x.beginPath();
    switch (o.kind) {
      case 'boss': {
        const r = 6 * u * (1 + 0.12 * Math.sin(performance.now() / 160));
        x.arc(sx, sy, r, 0, U.TAU);
        x.fill();
        x.stroke();
        x.strokeStyle = U.rgba(o.color, 0.5);
        x.beginPath();
        x.arc(sx, sy, r * 1.7, 0, U.TAU);
        x.stroke();
        return;
      }
      case 'cask':
        x.rect(sx - 2.5 * u, sy - 3 * u, 5 * u, 6 * u);
        break;
      case 'shrine':
        x.moveTo(sx, sy - 5 * u);
        x.lineTo(sx + 4 * u, sy);
        x.lineTo(sx, sy + 5 * u);
        x.lineTo(sx - 4 * u, sy);
        x.closePath();
        break;
      case 'hoarder':
        x.arc(sx, sy, 4.5 * u, 0, U.TAU);
        break;
      case 'totem':
        x.rect(sx - 2 * u, sy - 5 * u, 4 * u, 10 * u);
        break;
      case 'item':
        break;
    }
    x.fill();
    x.stroke();
  }

  private drawPlayer(x: CanvasRenderingContext2D, sx: number, sy: number, fx: number, fy: number, u: number): void {
    x.save();
    x.translate(sx, sy);
    x.rotate(Math.atan2(fy, fx));
    x.fillStyle = '#fff';
    x.strokeStyle = 'rgba(0,0,0,0.8)';
    x.lineWidth = u;
    x.beginPath();
    x.moveTo(6 * u, 0);
    x.lineTo(-4 * u, 4 * u);
    x.lineTo(-2 * u, 0);
    x.lineTo(-4 * u, -4 * u);
    x.closePath();
    x.fill();
    x.stroke();
    x.restore();
  }
}
