/**
 * Immediate-mode 2D drawing interface implemented by the WebGL2 renderer (primary) and a Canvas2D
 * fallback. The world renderer (`render/renderer.ts`) only ever talks to this interface.
 *
 * Coordinates are in the current *view space*: `setView` installs a 2D affine transform
 * (world → device pixels), exactly like `CanvasRenderingContext2D.setTransform`.
 * Colours are CSS strings ('#rgb', '#rrggbb', 'rgb()', 'rgba()') plus a separate alpha multiplier,
 * so hot paths never build colour strings.
 */

/** A drawable bitmap; procedural sprites carry their origin (pivot) in `ox`/`oy` pixels. */
export type Img = HTMLCanvasElement & { ox?: number; oy?: number };

export type BlendMode = 'normal' | 'add';

export interface ImageOpts {
  /** Uniform/axis scale (negative x mirrors). Default 1. */
  sx?: number;
  sy?: number;
  rot?: number;
  alpha?: number;
  /** Pivot in image pixels; defaults to the sprite's `ox/oy`, else its centre. */
  ox?: number;
  oy?: number;
  /** Draw at an explicit size (pixels in view space) instead of the bitmap size. */
  w?: number;
  h?: number;
  /** Colour overlay painted over the sprite's opaque pixels (like `source-atop`). */
  tint?: string;
  tintA?: number;
  /** 0..1 — blend the sprite towards a white silhouette (hit flash). */
  flash?: number;
}

export interface RenderStats {
  drawCalls: number;
  instances: number;
}

export interface Backend {
  readonly kind: 'webgl2' | 'canvas2d';
  readonly width: number;
  readonly height: number;
  readonly stats: RenderStats;

  resize(width: number, height: number): void;
  begin(clear: string): void;
  end(): void;

  setView(a: number, b: number, c: number, d: number, e: number, f: number): void;
  setBlend(mode: BlendMode): void;

  image(img: Img, x: number, y: number, o?: ImageOpts): void;
  /** Soft radial glow (bright core, smooth falloff) of radius r. */
  glow(x: number, y: number, r: number, color: string, alpha: number): void;
  /** Same as glow, with a numeric 0..255 colour (particle hot path). */
  glowRGB(x: number, y: number, r: number, cr: number, cg: number, cb: number, alpha: number): void;
  /** Solid square of side `size` (particle debris). */
  squareRGB(x: number, y: number, size: number, cr: number, cg: number, cb: number, alpha: number): void;
  circle(x: number, y: number, r: number, color: string, alpha: number): void;
  ellipse(x: number, y: number, rx: number, ry: number, rot: number, color: string, alpha: number): void;
  /**
   * Radial gradient: `c0` at the centre → `c1` at `mid` (0..1) → transparent at r.
   * With `inner` (0..1) the gradient starts at that fraction of r (solid `c0` inside).
   */
  radial(x: number, y: number, r: number, c0: string, a0: number, c1: string, a1: number, mid: number, inner?: number): void;
  /** Stroked circle/ellipse; `soft` > 0 gives a glowing falloff instead of a hard edge. */
  ring(x: number, y: number, rx: number, ry: number, rot: number, width: number, color: string, alpha: number, soft?: number): void;
  /** Filled circular sector centred on `angle` spanning ±halfArc. */
  sector(x: number, y: number, r: number, angle: number, halfArc: number, color: string, alpha: number): void;
  /** Stroked arc centred on `angle` spanning ±halfArc. */
  arc(x: number, y: number, r: number, angle: number, halfArc: number, width: number, color: string, alpha: number): void;
  /** Line segment; optional gradient towards c2/a2 at the end; `soft` > 0 for a glow profile. */
  line(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    width: number,
    color: string,
    alpha: number,
    soft?: number,
    c2?: string,
    a2?: number,
  ): void;
  rect(x: number, y: number, w: number, h: number, color: string, alpha: number): void;
  /** Centered text (damage numbers, labels) with a dark outline. */
  text(str: string, x: number, y: number, size: number, color: string, alpha: number, heavy?: boolean): void;
  /** Fill the rectangle with a repeating tile anchored at the view-space origin. */
  pattern(tile: HTMLCanvasElement, x0: number, y0: number, x1: number, y1: number): void;

  /**
   * Light map: an `ambient` darkness layer at `scale` resolution in which lights punch holes.
   * Between begin/end only `light()` may be called; `endLights` composites it over the scene.
   */
  beginLights(ambient: string, scale: number): void;
  light(x: number, y: number, r: number, alpha: number): void;
  endLights(): void;
}

/* ------------------------------------------------------------------ */
/* Colour parsing (memoised)                                          */
/* ------------------------------------------------------------------ */

/** [r, g, b, a] with rgb in 0..1, straight (not premultiplied) alpha. */
export type RGBA = readonly [number, number, number, number];
const colorCache = new Map<string, RGBA>();

export function parseColor(css: string): RGBA {
  let c = colorCache.get(css);
  if (c) return c;
  if (css[0] === '#') {
    let h = css.slice(1);
    if (h.length === 3 || h.length === 4)
      h = h
        .split('')
        .map((ch) => ch + ch)
        .join('');
    const n = parseInt(h.slice(0, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    c = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, a];
  } else {
    const m = css.match(/[\d.]+/g);
    c = m ? [+m[0]! / 255, +m[1]! / 255, +m[2]! / 255, m[3] != null ? +m[3] : 1] : [1, 1, 1, 1];
  }
  colorCache.set(css, c);
  return c;
}
