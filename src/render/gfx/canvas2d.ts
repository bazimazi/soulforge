/**
 * Canvas2D implementation of {@link Backend} — the fallback when WebGL2 is unavailable
 * (very old browsers, blocklisted GPUs, `?renderer=canvas`). Same visuals, lower throughput.
 */
import { U } from '../../core/util';
import { Sprites } from '../sprites';
import { parseColor, type Backend, type BlendMode, type ImageOpts, type Img, type RenderStats } from './backend';

const TAU = Math.PI * 2;

function css(color: string, alpha: number): string {
  const c = parseColor(color);
  return `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${c[3] * alpha})`;
}

export class Canvas2DBackend implements Backend {
  readonly kind = 'canvas2d' as const;
  width = 1;
  height = 1;
  readonly stats: RenderStats = { drawCalls: 0, instances: 0 };
  private ctx: CanvasRenderingContext2D;
  private lightCanvas = document.createElement('canvas');
  private lctx = this.lightCanvas.getContext('2d')!;
  private view: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];
  private inLights = false;
  private lightScale = 0.25;
  private patterns = new WeakMap<HTMLCanvasElement, CanvasPattern>();

  constructor(canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.ctx.imageSmoothingEnabled = true;
  }

  begin(clear: string): void {
    this.stats.instances = 0;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = clear;
    ctx.fillRect(0, 0, this.width, this.height);
  }
  end(): void {
    this.stats.drawCalls = this.stats.instances;
  }

  setView(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.view = [a, b, c, d, e, f];
    if (!this.inLights) this.ctx.setTransform(a, b, c, d, e, f);
  }
  setBlend(mode: BlendMode): void {
    this.ctx.globalCompositeOperation = mode === 'add' ? 'lighter' : 'source-over';
  }

  image(img: Img, x: number, y: number, o: ImageOpts = {}): void {
    const alpha = o.alpha ?? 1;
    if (alpha <= 0) return;
    this.stats.instances++;
    const ctx = this.ctx;
    let sx = o.sx ?? 1,
      sy = o.sy ?? sx;
    if (o.w != null) sx *= o.w / img.width;
    if (o.h != null) sy *= o.h / img.height;
    const ox = o.ox ?? img.ox ?? img.width / 2,
      oy = o.oy ?? img.oy ?? img.height / 2;
    let src: HTMLCanvasElement = img;
    if (o.flash && o.flash > 0.5) src = Sprites.flash(img as never);
    else if (o.tint && (o.tintA ?? 1) > 0) src = Sprites.tint(img as never, U.withAlpha(o.tint, (o.tintA ?? 1) * parseColor(o.tint)[3]));
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    if (o.rot) ctx.rotate(o.rot);
    ctx.scale(sx, sy);
    ctx.drawImage(src, -ox, -oy);
    ctx.restore();
  }

  glow(x: number, y: number, r: number, color: string, alpha: number): void {
    if (alpha <= 0 || r <= 0) return;
    this.stats.instances++;
    const ctx = this.ctx;
    ctx.globalAlpha = alpha * parseColor(color)[3];
    ctx.drawImage(Sprites.glow(color, 16), x - r, y - r, r * 2, r * 2);
    ctx.globalAlpha = 1;
  }
  glowRGB(x: number, y: number, r: number, cr: number, cg: number, cb: number, alpha: number): void {
    this.glow(x, y, r, `rgb(${cr},${cg},${cb})`, alpha);
  }
  squareRGB(x: number, y: number, size: number, cr: number, cg: number, cb: number, alpha: number): void {
    this.stats.instances++;
    this.ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha})`;
    this.ctx.fillRect(x - size / 2, y - size / 2, size, size);
  }
  circle(x: number, y: number, r: number, color: string, alpha: number): void {
    this.ellipse(x, y, r, r, 0, color, alpha);
  }
  ellipse(x: number, y: number, rx: number, ry: number, rot: number, color: string, alpha: number): void {
    this.stats.instances++;
    const ctx = this.ctx;
    ctx.fillStyle = css(color, alpha);
    ctx.beginPath();
    ctx.ellipse(x, y, Math.abs(rx), Math.abs(ry), rot, 0, TAU);
    ctx.fill();
  }
  radial(x: number, y: number, r: number, c0: string, a0: number, c1: string, a1: number, mid: number, inner = 0): void {
    if (r <= 0) return;
    this.stats.instances++;
    const ctx = this.ctx;
    const g = ctx.createRadialGradient(x, y, r * inner, x, y, r);
    g.addColorStop(0, css(c0, a0));
    g.addColorStop(U.clamp(mid, 0, 1), css(c1, a1));
    g.addColorStop(1, css(c1, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }
  ring(x: number, y: number, rx: number, ry: number, rot: number, width: number, color: string, alpha: number, soft = 0): void {
    this.stats.instances++;
    const ctx = this.ctx;
    ctx.strokeStyle = css(color, soft > 0 ? alpha * 0.8 : alpha);
    ctx.lineWidth = soft > 0 ? width * 0.6 : width;
    ctx.beginPath();
    ctx.ellipse(x, y, Math.abs(rx), Math.abs(ry), rot, 0, TAU);
    ctx.stroke();
  }
  sector(x: number, y: number, r: number, angle: number, halfArc: number, color: string, alpha: number): void {
    this.stats.instances++;
    const ctx = this.ctx;
    ctx.fillStyle = css(color, alpha);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, r, angle - halfArc, angle + halfArc);
    ctx.closePath();
    ctx.fill();
  }
  arc(x: number, y: number, r: number, angle: number, halfArc: number, width: number, color: string, alpha: number): void {
    this.stats.instances++;
    const ctx = this.ctx;
    ctx.strokeStyle = css(color, alpha);
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(x, y, r, angle - halfArc, angle + halfArc);
    ctx.stroke();
  }
  line(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    width: number,
    color: string,
    alpha: number,
    soft = 0,
    c2?: string,
    a2?: number,
  ): void {
    this.stats.instances++;
    const ctx = this.ctx;
    if (c2 || a2 != null) {
      const g = ctx.createLinearGradient(x1, y1, x2, y2);
      g.addColorStop(0, css(color, alpha));
      g.addColorStop(1, css(c2 ?? color, a2 ?? alpha));
      ctx.strokeStyle = g;
    } else ctx.strokeStyle = css(color, soft > 0 ? alpha * 0.6 : alpha);
    ctx.lineWidth = soft > 0 ? width * 0.6 : width;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  rect(x: number, y: number, w: number, h: number, color: string, alpha: number): void {
    this.stats.instances++;
    this.ctx.fillStyle = css(color, alpha);
    this.ctx.fillRect(x, y, w, h);
  }
  text(str: string, x: number, y: number, size: number, color: string, alpha: number, heavy = false): void {
    if (alpha <= 0) return;
    this.stats.instances++;
    const ctx = this.ctx;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${heavy ? 900 : 'bold'} ${size}px "Rajdhani", "Segoe UI", sans-serif`;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = size * 0.19;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(str, x, y);
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
    ctx.globalAlpha = 1;
  }
  pattern(tile: HTMLCanvasElement, x0: number, y0: number, x1: number, y1: number): void {
    let p = this.patterns.get(tile);
    if (!p) {
      p = this.ctx.createPattern(tile, 'repeat')!;
      this.patterns.set(tile, p);
    }
    this.stats.instances++;
    this.ctx.fillStyle = p;
    this.ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  }

  beginLights(ambient: string, scale: number): void {
    this.lightScale = scale;
    const L = this.lightCanvas,
      w = Math.ceil(this.width * scale),
      h = Math.ceil(this.height * scale);
    if (L.width !== w || L.height !== h) {
      L.width = w;
      L.height = h;
    }
    const l = this.lctx;
    l.setTransform(1, 0, 0, 1, 0, 0);
    l.globalCompositeOperation = 'source-over';
    l.globalAlpha = 1;
    l.clearRect(0, 0, w, h);
    l.fillStyle = ambient;
    l.fillRect(0, 0, w, h);
    l.globalCompositeOperation = 'destination-out';
    const [a, b, c, d, e, f] = this.view,
      s = scale;
    l.setTransform(a * s, b * s, c * s, d * s, e * s, f * s);
    this.inLights = true;
  }
  light(x: number, y: number, r: number, alpha: number): void {
    const l = this.lctx;
    l.globalAlpha = U.clamp(alpha, 0, 1);
    l.drawImage(Sprites.light(64), x - r, y - r, r * 2, r * 2);
  }
  endLights(): void {
    this.lctx.globalAlpha = 1;
    this.inLights = false;
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.lightCanvas, 0, 0, this.width, this.height);
    ctx.restore();
    this.stats.instances++;
    void this.lightScale;
  }
}
