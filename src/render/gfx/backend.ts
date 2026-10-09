/**
 * Immediate-mode 2D drawing interface implemented by the WebGL2 renderer (primary) and a Canvas2D
 * fallback. The world renderer (`render/renderer.ts`) only ever talks to this interface.
 *
 * Coordinates are in the current *view space*: `setView` installs a 2D affine transform
 * (world → device pixels), exactly like `CanvasRenderingContext2D.setTransform`.
 * Colours are CSS strings ('#rgb', '#rrggbb', 'rgb()', 'rgba()') plus a separate alpha multiplier,
 * so hot paths never build colour strings.
 */

/**
 * A drawable bitmap; procedural sprites carry their origin (pivot) in `ox`/`oy` canvas pixels.
 * `res` is the bitmap's pixel density — canvas pixels per view-space unit (default 1). A sprite baked
 * at `res: 2` is supersampled: a 128 px canvas draws 64 units wide, so it stays crisp when zoomed.
 */
export type Img = HTMLCanvasElement & { ox?: number; oy?: number; res?: number };

export type BlendMode = 'normal' | 'add';

export interface ImageOpts {
  /** Uniform/axis scale (negative x mirrors). Default 1. */
  sx?: number;
  sy?: number;
  rot?: number;
  alpha?: number;
  /** Pivot in canvas pixels (independent of `res`); defaults to the sprite's `ox/oy`, else its centre. */
  ox?: number;
  oy?: number;
  /** Draw at an explicit view-space size instead of the bitmap size (canvas size / `res`); wins over `res`. */
  w?: number;
  h?: number;
  /** Colour overlay painted over the sprite's opaque pixels (like `source-atop`). */
  tint?: string;
  tintA?: number;
  /** 0..1 — blend the sprite towards a white silhouette (hit flash). */
  flash?: number;
  /**
   * 0..1 — burn the sprite away through animated noise (deaths). At 1 nothing is left. The dissolving
   * edge glows in `edge` (default white); WebGL2 only, Canvas2D fades the sprite instead.
   */
  dissolve?: number;
  edge?: string;
  /** Per-sprite noise seed for `dissolve`, so neighbouring corpses don't burn identically. */
  seed?: number;
  /** Horizontal shear about the pivot: x += y · skew (cast shadows lying on the ground). */
  skew?: number;
}

/** Most shockwaves the post pass distorts at once. */
export const MAX_WAVES = 8;

export interface RenderStats {
  drawCalls: number;
  instances: number;
}

/**
 * Full-screen post-processing applied at `end()` (WebGL2 only; Canvas2D only approximates the tint wash).
 * A value at identity — bloom 0, aberration 0, saturation/contrast/exposure 1, tintA 0, grain 0 — costs
 * nothing: the frame renders straight to the screen exactly as with `setPost(null)`.
 */
export interface PostFX {
  /** Bloom intensity, 0 = off (typical 0.5–1.2). */
  bloom: number;
  /** Luminance threshold 0..1 above which pixels bloom (use a soft knee). */
  threshold: number;
  /** Chromatic aberration in device pixels at the screen edge (hit feedback pulses), 0 = off. */
  aberration: number;
  /** Colour grading: 1 = unchanged. */
  saturation: number;
  contrast: number;
  /** Overall exposure multiplier, 1 = unchanged. */
  exposure: number;
  /** Colour wash mixed over the final image: CSS colour + amount 0..1 (eclipse purple, low-HP red, stage mood). */
  tint: string;
  tintA: number;
  /** Film grain amount 0..1 (very subtle, e.g. 0.04). */
  grain: number;
  /** Seconds, for animated grain. */
  time: number;
  /**
   * Split toning: shadows pushed towards `shadows`, highlights towards `highlights` (CSS colours), each by
   * its amount 0..1 (stage mood). 0 = off.
   */
  shadows: string;
  shadowsA: number;
  highlights: string;
  highlightsA: number;
  /**
   * Screen-space refraction rings (explosions, boss slams): `waves[i*4..]` = centre x, y and radius in
   * device pixels, strength in device pixels of displacement; `waveCount` entries are live (≤ MAX_WAVES).
   */
  waves: Float32Array;
  waveCount: number;
}

export interface Backend {
  readonly kind: 'webgl2' | 'canvas2d';
  readonly width: number;
  readonly height: number;
  readonly stats: RenderStats;

  resize(width: number, height: number): void;
  begin(clear: string): void;
  end(): void;
  /**
   * Set post-processing for the frame being recorded; null renders straight to the screen (menus, low quality).
   * Call between `begin()` and `end()` (begin resets it to null). The object is read at `end()`, so it may be
   * set after drawing and reused/mutated across frames without allocation.
   */
  setPost(p: PostFX | null): void;

  setView(a: number, b: number, c: number, d: number, e: number, f: number): void;
  setBlend(mode: BlendMode): void;

  image(img: Img, x: number, y: number, o?: ImageOpts): void;
  /** Soft radial glow (bright core, smooth falloff) of radius r. */
  glow(x: number, y: number, r: number, color: string, alpha: number): void;
  /** Same as glow, with a numeric 0..255 colour (particle hot path). */
  glowRGB(x: number, y: number, r: number, cr: number, cg: number, cb: number, alpha: number): void;
  /** Solid square of side `size` (particle debris), optionally rotated. */
  squareRGB(x: number, y: number, size: number, cr: number, cg: number, cb: number, alpha: number, rot?: number): void;
  /** Soft-edged streak with a numeric 0..255 colour: transparent at the tail (x1, y1), `alpha` at the head (particle hot path). */
  lineRGB(x1: number, y1: number, x2: number, y2: number, width: number, cr: number, cg: number, cb: number, alpha: number): void;
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
   * Light map at `scale` resolution. `ambient` is the stage darkness as a CSS colour whose alpha is how dark
   * unlit ground is (e.g. 'rgba(8,4,12,0.42)'). Lights add coloured light on top: a white light of alpha 1
   * fully cancels the darkness; overlapping and coloured lights tint and (WebGL2) over-brighten the scene.
   * Between begin/end only `light()` may be called; `endLights` composites the map over the scene.
   */
  beginLights(ambient: string, scale: number): void;
  /** `color` defaults to white; Canvas2D ignores it. */
  light(x: number, y: number, r: number, alpha: number, color?: string): void;
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
