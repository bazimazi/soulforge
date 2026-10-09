/**
 * WebGL2 batched renderer.
 *
 * Every primitive — sprites, glyphs, glows, lights, circles, rings, arcs, sectors, lines, rects —
 * is one instance of a unit quad drawn by a single "uber-shader" that switches on a per-instance
 * shape id: sprites sample the atlas, shapes are evaluated analytically (signed distances with
 * derivative-based anti-aliasing). A frame is recorded into one interleaved instance buffer plus a
 * small command list, uploaded once, and replayed as a few instanced draw calls; a new batch only
 * starts when the blend mode, view transform or render target changes, or when a ninth texture page is needed:
 * each batch binds up to {@link MAX_UNITS} atlas pages at once and every sprite instance names the unit it samples
 * (encoded as a non-positive shape id), so sprites interleaved across pages in the y-sorted pass still batch.
 *
 * Colours are premultiplied end-to-end (textures uploaded premultiplied, shader outputs premultiplied).
 *
 * Post-processing: when a {@link PostFX} is set for the frame, the 'screen' target is an offscreen
 * scene framebuffer instead of the canvas. After replay, `end()` runs a bloom chain — soft-knee bright
 * pass at half resolution, dual-filter (Kawase) downsamples to 1/32, tent upsamples blended back up —
 * and one final pass to the canvas that adds the bloom and applies exposure, contrast, saturation, tint
 * wash, chromatic aberration and film grain. Without a PostFX the frame renders straight to the canvas.
 */
import { TextureAtlas } from './atlas';
import { MAX_WAVES, parseColor, type Backend, type BlendMode, type ImageOpts, type Img, type PostFX, type RenderStats } from './backend';
import { bakeFont, GLYPH_BASE, type GlyphFont } from './glyphs';

/* Shape ids — keep in sync with the fragment shader. */
const enum Shape {
  Sprite = 0,
  Circle = 1,
  Radial = 2,
  Glow = 3,
  Light = 4,
  Ring = 5,
  Sector = 6,
  Arc = 7,
  Rect = 8,
  Line = 9,
  Pattern = 10,
}

/** Texture pages one batch can sample (each sprite instance picks its unit). */
const MAX_UNITS = 8;

/** Floats per instance: 6 × vec4 (posSize, xform, uv, color, color2, params). */
const STRIDE = 24;
const BYTES = STRIDE * 4;

const VS = `#version 300 es
layout(location=0) in vec2 a_corner;
layout(location=1) in vec4 i_posSize;   // centre xy, half-extents zw
layout(location=2) in vec4 i_xform;     // rotation, anchor xy, shape
layout(location=3) in vec4 i_uv;
layout(location=4) in vec4 i_color;
layout(location=5) in vec4 i_color2;
layout(location=6) in vec4 i_params;
uniform vec3 u_view0;
uniform vec3 u_view1;
uniform vec2 u_res;
out vec2 v_local;
out vec2 v_uv;
out vec2 v_world;
flat out int v_shape;
out vec4 v_color;
out vec4 v_color2;
out vec4 v_params;
void main() {
  vec2 local = i_xform.yz + a_corner * i_posSize.zw;
  // sprites may shear about their pivot (cast shadows); params.w is unused by every other shape
  if (i_xform.w < 0.5) local.x += local.y * i_params.w;
  float c = cos(i_xform.x), s = sin(i_xform.x);
  vec2 w = i_posSize.xy + vec2(c * local.x - s * local.y, s * local.x + c * local.y);
  vec2 scr = vec2(dot(u_view0, vec3(w, 1.0)), dot(u_view1, vec3(w, 1.0)));
  vec2 clip = scr / u_res * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_local = a_corner;
  v_uv = mix(i_uv.xy, i_uv.zw, a_corner * 0.5 + 0.5);
  v_world = w;
  v_shape = int(floor(i_xform.w + 0.5));
  v_color = i_color;
  v_color2 = i_color2;
  v_params = i_params;
}`;

const FS = `#version 300 es
precision highp float;
uniform sampler2D u_t0;
uniform sampler2D u_t1;
uniform sampler2D u_t2;
uniform sampler2D u_t3;
uniform sampler2D u_t4;
uniform sampler2D u_t5;
uniform sampler2D u_t6;
uniform sampler2D u_t7;
in vec2 v_local;
in vec2 v_uv;
in vec2 v_world;
flat in int v_shape;
in vec4 v_color;
in vec4 v_color2;
in vec4 v_params;
out vec4 o;

float aa(float d, float w) { return clamp(0.5 - d / w, 0.0, 1.0); }
float wrapAngle(float a) { return a - 6.28318530718 * floor((a + 3.14159265359) / 6.28318530718); }
float boxAA(vec2 p) {
  vec2 fw = max(fwidth(p), vec2(1e-5));
  return clamp(0.5 - (abs(p.x) - 1.0) / fw.x, 0.0, 1.0) * clamp(0.5 - (abs(p.y) - 1.0) / fw.y, 0.0, 1.0);
}
// ES 3.0 can't index sampler arrays dynamically: pick the unit with a branch tree (atlas pages have no mips,
// so sampling inside non-uniform control flow is safe)
vec4 atlas(int u, vec2 uv) {
  if (u < 4) {
    if (u < 2) return u == 0 ? texture(u_t0, uv) : texture(u_t1, uv);
    return u == 2 ? texture(u_t2, uv) : texture(u_t3, uv);
  }
  if (u < 6) return u == 4 ? texture(u_t4, uv) : texture(u_t5, uv);
  return u == 6 ? texture(u_t6, uv) : texture(u_t7, uv);
}
float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}

void main() {
  vec2 p = v_local;
  if (v_shape <= 0) {                      // sprite / glyph from texture unit −shape (premultiplied texel)
    vec4 t = atlas(-v_shape, v_uv);
    vec3 col;
    if (v_params.y > 0.0) {                // dissolve: noise below the threshold burns away, the rim glows in color2
      vec2 q = p * 3.2 + v_params.z;
      float n = vnoise(q) * 0.62 + vnoise(q * 2.7 + 11.0) * 0.38;
      float d = v_params.y * 1.08 - 0.04;
      if (n < d || t.a < 0.01) discard;
      float rim = 1.0 - smoothstep(0.0, 0.09, n - d);
      col = mix(t.rgb * (1.0 - v_params.y * 0.45), v_color2.rgb * t.a * 1.6, rim);
    } else {
      col = mix(t.rgb, v_color2.rgb * t.a, v_color2.a);
    }
    col = mix(col, vec3(t.a), v_params.x);
    o = vec4(col * v_color.rgb, t.a) * v_color.a;
    return;
  }
  if (v_shape == 10) {                     // repeating ground tile in view space, de-tiled
    vec2 uv = v_world / v_params.xy;
    vec4 ta = texture(u_t0, uv);
    vec4 tb = texture(u_t0, uv.yx * 0.83 + vec2(0.31, 0.57));
    float n = vnoise(v_world / 640.0) * 0.65 + vnoise(v_world / 210.0) * 0.35;
    vec4 tc = mix(ta, tb, smoothstep(0.32, 0.68, n));
    float m = 0.84 + 0.3 * vnoise(v_world / 1400.0 + 7.0);
    o = vec4(tc.rgb * m, tc.a) * v_color.a;
    return;
  }
  float r = length(p);
  float fw = max(fwidth(r), 1e-5);
  vec3 rgb = v_color.rgb;
  float a = v_color.a;
  if (v_shape == 1) {                      // filled circle / ellipse
    a *= aa(r - 1.0, fw);
  } else if (v_shape == 2) {               // radial gradient c0 -> c1 (mid) -> transparent
    if (r >= 1.0) discard;
    float mid = max(v_params.x, 1e-3);
    float rr = max(0.0, (r - v_params.y) / max(1.0 - v_params.y, 1e-3));
    vec4 g = rr < mid ? mix(v_color, v_color2, rr / mid) : mix(v_color2, vec4(v_color2.rgb, 0.0), (rr - mid) / max(1.0 - mid, 1e-3));
    rgb = g.rgb; a = g.a;
  } else if (v_shape == 3) {               // soft glow (matches the sprite factory's glow stops)
    a *= r < 0.3 ? mix(1.0, 0.55, r / 0.3) : r < 0.65 ? mix(0.55, 0.15, (r - 0.3) / 0.35) : r < 1.0 ? mix(0.15, 0.0, (r - 0.65) / 0.35) : 0.0;
  } else if (v_shape == 4) {               // light falloff
    a *= r < 0.35 ? mix(1.0, 0.7, r / 0.35) : r < 0.7 ? mix(0.7, 0.2, (r - 0.35) / 0.35) : r < 1.0 ? mix(0.2, 0.0, (r - 0.7) / 0.3) : 0.0;
  } else if (v_shape == 5) {               // ring (stroke), optional soft glow profile
    float th = v_params.x, rc = 1.0 - th * 0.5;
    if (v_params.y > 0.0) a *= pow(clamp(1.0 - abs(r - rc) / (th * 0.5), 0.0, 1.0), v_params.y);
    else a *= aa(abs(r - rc) - th * 0.5, fw);
  } else if (v_shape == 6 || v_shape == 7) { // sector fill / arc stroke centred on params.x, ±params.y
    float da = abs(wrapAngle(atan(p.y, p.x) - v_params.x));
    float dAng = (da - v_params.y) * r;
    float dRad = v_shape == 6 ? r - 1.0 : abs(r - (1.0 - v_params.z * 0.5)) - v_params.z * 0.5;
    a *= aa(max(dRad, dAng), fw);
  } else if (v_shape == 8) {               // rect
    a *= boxAA(p);
  } else if (v_shape == 9) {               // line: gradient along x, hard or soft profile across y
    vec4 g = mix(v_color, v_color2, p.x * 0.5 + 0.5);
    rgb = g.rgb; a = g.a;
    if (v_params.x > 0.0) a *= pow(clamp(1.0 - abs(p.y), 0.0, 1.0), v_params.x);
    else a *= boxAA(p);
  }
  o = vec4(rgb * a, a);
}`;

const COMPOSITE_VS = `#version 300 es
layout(location=0) in vec2 a_corner;
out vec2 v_uv;
void main() { v_uv = a_corner * 0.5 + 0.5; gl_Position = vec4(a_corner, 0.0, 1.0); }`;

/**
 * Light map composite, two passes over the scene: pass 0 multiplies by min(L, 1) (darkness and colour), pass 1
 * (blend dst·(1 + src)) adds the over-bright part where lights overlap, so hot spots glow instead of clipping.
 * The map stores L · encoding (RGBA8 targets store half the light to leave room above 1).
 */
const LIGHT_FS = `#version 300 es
precision mediump float;
uniform sampler2D u_tex;
uniform vec3 u_light;   // 1 / encoding scale, pass (0|1), over-bright gain
in vec2 v_uv;
out vec4 o;
void main() {
  vec3 L = texture(u_tex, v_uv).rgb * u_light.x;
  if (u_light.y < 0.5) o = vec4(min(L, vec3(1.0)), 1.0);
  else {
    // over-bright part, compressed (Reinhard) so a thousand overlapping lights glow instead of whiting out
    vec3 over = max(L - 1.0, vec3(0.0));
    o = vec4(over / (1.0 + over * 1.6) * u_light.z, 0.0);
  }
}`;

/*
 * Post-processing passes (all share COMPOSITE_VS). The scene buffer is cleared opaque and blended with
 * premultiplied colours, so its rgb already is the final premultiplied-over-opaque colour: the passes
 * work on rgb directly and never un-premultiply.
 */

/** Bright pass: 4 bilinear taps (a 4×4 box, which tames sub-pixel sparkle) then a soft-knee threshold. */
const BRIGHT_FS = `#version 300 es
precision mediump float;
uniform sampler2D u_tex;
uniform vec2 u_texel;   // 1 / source size
uniform vec3 u_curve;   // threshold, knee, 0.25 / knee
in vec2 v_uv;
out vec4 o;
void main() {
  vec4 d = u_texel.xyxy * vec4(-1.0, -1.0, 1.0, 1.0);
  vec3 c = (texture(u_tex, v_uv + d.xy).rgb + texture(u_tex, v_uv + d.zy).rgb
          + texture(u_tex, v_uv + d.xw).rgb + texture(u_tex, v_uv + d.zw).rgb) * 0.25;
  float br = max(c.r, max(c.g, c.b));
  float soft = clamp(br - u_curve.x + u_curve.y, 0.0, 2.0 * u_curve.y);
  soft = soft * soft * u_curve.z;
  o = vec4(c * max(soft, br - u_curve.x) / max(br, 1e-4), 1.0);
}`;

/** Dual-filter downsample: centre ×4 plus four diagonal bilinear taps (a 4×4 footprint) / 8. */
const DOWN_FS = `#version 300 es
precision mediump float;
uniform sampler2D u_tex;
uniform vec2 u_texel;   // 1 / source size
in vec2 v_uv;
out vec4 o;
void main() {
  vec2 h = u_texel;
  vec3 c = texture(u_tex, v_uv).rgb * 4.0
         + texture(u_tex, v_uv - h).rgb + texture(u_tex, v_uv + h).rgb
         + texture(u_tex, v_uv + vec2(h.x, -h.y)).rgb + texture(u_tex, v_uv - vec2(h.x, -h.y)).rgb;
  o = vec4(c * 0.125, 1.0);
}`;

/** Dual-filter upsample: an 8-tap tent around the destination pixel. */
const UP_FS = `#version 300 es
precision mediump float;
uniform sampler2D u_tex;
uniform vec2 u_texel;   // 1 / source (smaller level) size
in vec2 v_uv;
out vec4 o;
void main() {
  vec2 h = u_texel;
  vec3 c = texture(u_tex, v_uv + vec2(-2.0 * h.x, 0.0)).rgb + texture(u_tex, v_uv + vec2(2.0 * h.x, 0.0)).rgb
         + texture(u_tex, v_uv + vec2(0.0, -2.0 * h.y)).rgb + texture(u_tex, v_uv + vec2(0.0, 2.0 * h.y)).rgb
         + (texture(u_tex, v_uv + h).rgb + texture(u_tex, v_uv - h).rgb
          + texture(u_tex, v_uv + vec2(h.x, -h.y)).rgb + texture(u_tex, v_uv - vec2(h.x, -h.y)).rgb) * 2.0;
  o = vec4(c / 12.0, 1.0);
}`;

/** Final pass to the canvas: aberration, bloom, grading, tint wash, grain. Writes alpha 1 (opaque canvas). */
const FINAL_FS = `#version 300 es
precision highp float;
uniform sampler2D u_tex;    // scene
uniform sampler2D u_bloom;
uniform vec2 u_res;         // canvas size in device pixels
uniform float u_bloomAmt;
uniform float u_aberration; // device pixels of R/B split at the middle of a screen edge
uniform vec3 u_grade;       // exposure, contrast, saturation
uniform vec4 u_tint;        // rgb, amount
uniform vec2 u_grain;       // amount, per-frame seed
uniform vec4 u_shadows;     // split toning: rgb, amount
uniform vec4 u_highlights;
uniform vec4 u_waves[${MAX_WAVES}]; // centre xy (GL pixels, y up), radius, strength (pixels)
uniform int u_waveN;
in vec2 v_uv;
out vec4 o;
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
void main() {
  vec3 col;
  vec2 uv = v_uv;
  float ringLight = 0.0;
  // shockwaves: a derivative-of-gaussian displacement profile reads as a refracting lens ring
  for (int i = 0; i < ${MAX_WAVES}; i++) {
    if (i >= u_waveN) break;
    vec4 w = u_waves[i];
    vec2 d = uv * u_res - w.xy;
    float dist = max(length(d), 1e-3);
    float k = (dist - w.z) / max(14.0, w.z * 0.16);
    float g = exp(-k * k);
    uv -= d / dist * k * g * w.w / u_res;
    ringLight += g * w.w;
  }
  if (u_aberration > 0.0) {
    // radial split growing quadratically from the centre: |off| = u_aberration px at an edge midpoint
    vec2 d = uv - 0.5;
    vec2 off = d * length(d) * 4.0 * u_aberration / u_res;
    col = vec3(texture(u_tex, uv - off).r, texture(u_tex, uv).g, texture(u_tex, uv + off).b);
  } else {
    col = texture(u_tex, uv).rgb;
  }
  col += texture(u_bloom, uv).rgb * u_bloomAmt;
  col += ringLight * 0.0025;
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col += u_shadows.rgb * u_shadows.a * 0.14 * (1.0 - smoothstep(0.0, 0.6, lum));
  vec3 hi = u_highlights.rgb / max(1e-3, max(u_highlights.r, max(u_highlights.g, u_highlights.b)));
  col *= mix(vec3(1.0), hi, u_highlights.a * smoothstep(0.35, 1.0, lum));
  col *= u_grade.x;
  col = (col - 0.5) * u_grade.y + 0.5;
  col = mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, u_grade.z);
  col = mix(col, u_tint.rgb, u_tint.a);
  col += (hash(gl_FragCoord.xy + u_grain.y) - 0.5) * u_grain.x;
  o = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

/** Bloom chain depth: levels at 1/2 … 1/32 of the canvas. */
const BLOOM_LEVELS = 5;
/**
 * Upsampling lerps each smaller level into the next larger one by this weight (rather than adding), so the
 * chain stays a weighted average that cannot clip in RGBA8; larger = wider, softer halo.
 */
const BLOOM_SPREAD = 0.65;
/** Brings the averaged chain back to a useful brightness so `bloom: 1` reads as a clear glow. */
const BLOOM_GAIN = 3;

type Target = 'screen' | 'light';
/** An offscreen colour target: a texture with its framebuffer. */
interface RenderTarget {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  w: number;
  h: number;
}
interface Batch {
  kind: 'draw';
  start: number;
  count: number;
  blend: BlendMode | 'light';
  /** Textures bound to units 0..n-1 for this batch. */
  texs: WebGLTexture[];
  view: number;
  target: Target;
}
type Command = Batch | { kind: 'clear'; target: Target; r: number; g: number; b: number; a: number } | { kind: 'composite' };

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const mk = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost())
      throw new Error('Shader compile failed: ' + gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error('Program link failed: ' + gl.getProgramInfoLog(p));
  return p;
}

function uniforms<K extends string>(gl: WebGL2RenderingContext, p: WebGLProgram, names: readonly K[]): Record<K, WebGLUniformLocation> {
  const u = {} as Record<K, WebGLUniformLocation>;
  for (const n of names) u[n] = gl.getUniformLocation(p, n)!;
  return u;
}

/** Linear-filtered, edge-clamped texture of `format` with a framebuffer; returns with nothing bound. */
function createTarget(gl: WebGL2RenderingContext, w: number, h: number, format: number): RenderTarget {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, format, w, h);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, w, h };
}

function deleteTarget(gl: WebGL2RenderingContext, t: RenderTarget): void {
  gl.deleteTexture(t.tex);
  gl.deleteFramebuffer(t.fbo);
}

function isComplete(gl: WebGL2RenderingContext, t: RenderTarget): boolean {
  gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return ok;
}

/** True when a PostFX would leave the image unchanged, so the frame can skip the scene buffer entirely. */
function isNeutral(p: PostFX): boolean {
  return (
    p.bloom <= 0 &&
    p.aberration <= 0 &&
    p.saturation === 1 &&
    p.contrast === 1 &&
    p.exposure === 1 &&
    p.tintA <= 0 &&
    p.grain <= 0 &&
    p.shadowsA <= 0 &&
    p.highlightsA <= 0 &&
    p.waveCount <= 0
  );
}

export class WebGL2Backend implements Backend {
  readonly kind = 'webgl2' as const;
  width = 1;
  height = 1;
  readonly stats: RenderStats = { drawCalls: 0, instances: 0 };

  private gl: WebGL2RenderingContext;
  private prog!: WebGLProgram;
  private vao!: WebGLVertexArrayObject;
  private compVao!: WebGLVertexArrayObject;
  private quad!: WebGLBuffer;
  private inst!: WebGLBuffer;
  private atlas!: TextureAtlas;
  private u!: { view0: WebGLUniformLocation; view1: WebGLUniformLocation; res: WebGLUniformLocation };
  private lightRT: RenderTarget | null = null;
  // post-processing
  private brightProg!: WebGLProgram;
  private downProg!: WebGLProgram;
  private upProg!: WebGLProgram;
  private finalProg!: WebGLProgram;
  private uBright!: Record<'u_texel' | 'u_curve', WebGLUniformLocation>;
  private uDown!: Record<'u_texel', WebGLUniformLocation>;
  private uUp!: Record<'u_texel', WebGLUniformLocation>;
  private uFinal!: Record<
    'u_res' | 'u_bloomAmt' | 'u_aberration' | 'u_grade' | 'u_tint' | 'u_grain' | 'u_shadows' | 'u_highlights' | 'u_waves' | 'u_waveN',
    WebGLUniformLocation
  >;
  private lightProg!: WebGLProgram;
  private uLight!: WebGLUniformLocation;
  /** RGBA16F light map when renderable (lights can sum past 1), else RGBA8 storing half the light. */
  private lightFormat = 0;
  private lightEnc = 1;
  /** Ambient darkness of the light pass being recorded: lights are scaled by it (an alpha-1 light cancels it). */
  private lightDark = 0.5;
  private waveBuf = new Float32Array(MAX_WAVES * 4);
  /** RGBA16F when the GPU can render to it (smoother dim bloom), else RGBA8. */
  private bloomFormat = 0;
  private sceneRT: RenderTarget | null = null;
  private bloomRTs: RenderTarget[] = [];
  /** Framebuffer behind the 'screen' target for the frame being replayed (null = the canvas). */
  private screenFbo: WebGLFramebuffer | null = null;
  private post: PostFX | null = null;
  private patterns = new WeakMap<HTMLCanvasElement, WebGLTexture>();
  private fonts: { normal: GlyphFont; heavy: GlyphFont } | null = null;
  private lost = false;

  // frame recording
  private data = new Float32Array(16384 * STRIDE);
  private n = 0;
  private cmds: Command[] = [];
  private views: number[] = [];
  private viewIdx = -1;
  private blend: BlendMode | 'light' = 'normal';
  private target: Target = 'screen';
  private batch: Batch | null = null;
  /** Texture unit the last `slot()` assigned. */
  private unit = 0;
  /** Texture bound to each unit while replaying (cache, reset per frame). */
  private bound: (WebGLTexture | null)[] = new Array<WebGLTexture | null>(MAX_UNITS).fill(null);
  private lightScale = 0.25;

  /** Try to create a WebGL2 backend; returns null if unsupported. */
  static create(canvas: HTMLCanvasElement): WebGL2Backend | null {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false, // shapes are analytically anti-aliased in the shader
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
      desynchronized: true,
    });
    if (!gl) return null;
    try {
      return new WebGL2Backend(canvas, gl);
    } catch (e) {
      console.warn('WebGL2 init failed, falling back to Canvas2D:', e);
      return null;
    }
  }

  private constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.init();
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
      this.atlas.reset(true);
      this.patterns = new WeakMap();
      this.lightRT = this.sceneRT = this.screenFbo = null;
      this.bloomRTs = [];
      this.fonts = null;
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.init();
      this.lost = false;
    });
  }

  private init(): void {
    const gl = this.gl;
    this.prog = compile(gl, VS, FS);
    this.lightProg = compile(gl, COMPOSITE_VS, LIGHT_FS);
    this.uLight = gl.getUniformLocation(this.lightProg, 'u_light')!;
    this.brightProg = compile(gl, COMPOSITE_VS, BRIGHT_FS);
    this.downProg = compile(gl, COMPOSITE_VS, DOWN_FS);
    this.upProg = compile(gl, COMPOSITE_VS, UP_FS);
    this.finalProg = compile(gl, COMPOSITE_VS, FINAL_FS);
    this.uBright = uniforms(gl, this.brightProg, ['u_texel', 'u_curve']);
    this.uDown = uniforms(gl, this.downProg, ['u_texel']);
    this.uUp = uniforms(gl, this.upProg, ['u_texel']);
    this.uFinal = uniforms(gl, this.finalProg, [
      'u_res',
      'u_bloomAmt',
      'u_aberration',
      'u_grade',
      'u_tint',
      'u_grain',
      'u_shadows',
      'u_highlights',
      'u_waves',
      'u_waveN',
    ]);
    // samplers default to unit 0; only the final pass reads a second texture
    gl.useProgram(this.finalProg);
    gl.uniform1i(gl.getUniformLocation(this.finalProg, 'u_bloom'), 1);
    gl.useProgram(null);
    this.bloomFormat = gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float') ? gl.RGBA16F : gl.RGBA8;
    this.lightFormat = this.bloomFormat;
    this.lightEnc = this.lightFormat === gl.RGBA8 ? 0.5 : 1;
    this.u = {
      view0: gl.getUniformLocation(this.prog, 'u_view0')!,
      view1: gl.getUniformLocation(this.prog, 'u_view1')!,
      res: gl.getUniformLocation(this.prog, 'u_res')!,
    };
    gl.useProgram(this.prog);
    for (let i = 0; i < MAX_UNITS; i++) gl.uniform1i(gl.getUniformLocation(this.prog, 'u_t' + i), i);
    gl.useProgram(null);
    this.quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.inst = gl.createBuffer()!;

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    for (let i = 1; i <= 6; i++) {
      gl.enableVertexAttribArray(i);
      gl.vertexAttribDivisor(i, 1);
    }
    this.compVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.compVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    this.atlas = new TextureAtlas(gl);
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    // offscreen targets compare their size with width/height when bound and reallocate lazily
  }

  /* ---------------------------- frame recording ---------------------------- */

  begin(clear: string): void {
    this.n = 0;
    this.cmds.length = 0;
    this.views.length = 0;
    this.viewIdx = -1;
    this.batch = null;
    this.blend = 'normal';
    this.target = 'screen';
    this.post = null;
    this.setView(1, 0, 0, 1, 0, 0);
    const c = parseColor(clear);
    this.cmds.push({ kind: 'clear', target: 'screen', r: c[0], g: c[1], b: c[2], a: 1 });
  }

  setView(a: number, b: number, c: number, d: number, e: number, f: number): void {
    const v = this.views,
      i = this.viewIdx * 6;
    if (i >= 0 && v[i] === a && v[i + 1] === b && v[i + 2] === c && v[i + 3] === d && v[i + 4] === e && v[i + 5] === f) return;
    this.viewIdx = v.length / 6;
    v.push(a, b, c, d, e, f);
    this.batch = null;
  }

  setPost(p: PostFX | null): void {
    this.post = p;
  }

  setBlend(mode: BlendMode): void {
    if (this.target === 'light' || this.blend === mode) return;
    this.blend = mode;
    this.batch = null;
  }

  /**
   * Reserve one instance slot and return its float offset (opens a new batch if state changed). A textured
   * instance joins the batch's units (a new batch only when all MAX_UNITS are taken); `this.unit` is its unit.
   */
  private slot(tex: WebGLTexture | null): number {
    let b = this.batch,
      u = 0;
    if (b && tex) {
      u = b.texs.indexOf(tex);
      if (u < 0) {
        if (b.texs.length < MAX_UNITS) {
          u = b.texs.length;
          b.texs.push(tex);
        } else b = null;
      }
    }
    if (!b) {
      b = this.batch = {
        kind: 'draw',
        start: this.n,
        count: 0,
        blend: this.blend,
        texs: tex ? [tex] : [],
        view: this.viewIdx,
        target: this.target,
      };
      this.cmds.push(b);
      u = 0;
    }
    this.unit = u;
    if ((this.n + 1) * STRIDE > this.data.length) {
      const bigger = new Float32Array(this.data.length * 2);
      bigger.set(this.data);
      this.data = bigger;
    }
    b.count++;
    return this.n++ * STRIDE;
  }

  private shape(
    shape: Shape,
    x: number,
    y: number,
    hw: number,
    hh: number,
    rot: number,
    r: number,
    g: number,
    bl: number,
    a: number,
    r2: number,
    g2: number,
    b2: number,
    a2: number,
    p0: number,
    p1: number,
    p2: number,
  ): void {
    if (a <= 0 && a2 <= 0) return;
    const o = this.slot(null),
      d = this.data;
    d[o] = x;
    d[o + 1] = y;
    d[o + 2] = hw;
    d[o + 3] = hh;
    d[o + 4] = rot;
    d[o + 5] = 0;
    d[o + 6] = 0;
    d[o + 7] = shape;
    d[o + 8] = 0;
    d[o + 9] = 0;
    d[o + 10] = 1;
    d[o + 11] = 1;
    d[o + 12] = r;
    d[o + 13] = g;
    d[o + 14] = bl;
    d[o + 15] = a;
    d[o + 16] = r2;
    d[o + 17] = g2;
    d[o + 18] = b2;
    d[o + 19] = a2;
    d[o + 20] = p0;
    d[o + 21] = p1;
    d[o + 22] = p2;
    d[o + 23] = 0;
  }

  /* -------------------------------- primitives ------------------------------- */

  image(img: Img, x: number, y: number, o: ImageOpts = {}): void {
    const alpha = o.alpha ?? 1;
    if (alpha <= 0 || this.lost) return;
    const reg = this.atlas.region(img);
    const iw = img.width,
      ih = img.height,
      res = img.res ?? 1;
    let sx = o.sx ?? 1,
      sy = o.sy ?? sx;
    // Explicit w/h are view-space sizes and win; otherwise the canvas holds `res` pixels per unit.
    // The pivot stays in canvas pixels: it is scaled by sx/sy below together with the extents.
    sx *= o.w != null ? o.w / iw : 1 / res;
    sy *= o.h != null ? o.h / ih : 1 / res;
    const ox = o.ox ?? img.ox ?? iw / 2,
      oy = o.oy ?? img.oy ?? ih / 2;
    const off = this.slot(reg.tex),
      d = this.data;
    d[off] = x;
    d[off + 1] = y;
    d[off + 2] = (iw / 2) * sx;
    d[off + 3] = (ih / 2) * sy;
    d[off + 4] = o.rot ?? 0;
    d[off + 5] = (iw / 2 - ox) * sx;
    d[off + 6] = (ih / 2 - oy) * sy;
    d[off + 7] = Shape.Sprite - this.unit;
    d[off + 8] = reg.u0;
    d[off + 9] = reg.v0;
    d[off + 10] = reg.u1;
    d[off + 11] = reg.v1;
    d[off + 12] = 1;
    d[off + 13] = 1;
    d[off + 14] = 1;
    d[off + 15] = alpha;
    const dis = o.dissolve ?? 0;
    if (dis > 0) {
      // the dissolve rim colour rides in the tint slot (a dissolving sprite is never tinted)
      const t = parseColor(o.edge ?? '#fff');
      d[off + 16] = t[0];
      d[off + 17] = t[1];
      d[off + 18] = t[2];
      d[off + 19] = 1;
    } else if (o.tint) {
      const t = parseColor(o.tint);
      d[off + 16] = t[0];
      d[off + 17] = t[1];
      d[off + 18] = t[2];
      d[off + 19] = (o.tintA ?? 1) * t[3];
    } else {
      d[off + 16] = 0;
      d[off + 17] = 0;
      d[off + 18] = 0;
      d[off + 19] = 0;
    }
    d[off + 20] = o.flash ?? 0;
    d[off + 21] = dis > 0 ? Math.min(1, dis) : 0;
    d[off + 22] = o.seed ?? 0;
    d[off + 23] = o.skew ?? 0;
  }

  glow(x: number, y: number, r: number, color: string, alpha: number): void {
    const c = parseColor(color);
    this.shape(Shape.Glow, x, y, r, r, 0, c[0], c[1], c[2], c[3] * alpha, 0, 0, 0, 0, 0, 0, 0);
  }
  glowRGB(x: number, y: number, r: number, cr: number, cg: number, cb: number, alpha: number): void {
    this.shape(Shape.Glow, x, y, r, r, 0, cr / 255, cg / 255, cb / 255, alpha, 0, 0, 0, 0, 0, 0, 0);
  }
  squareRGB(x: number, y: number, size: number, cr: number, cg: number, cb: number, alpha: number, rot = 0): void {
    const h = size / 2;
    this.shape(Shape.Rect, x, y, h, h, rot, cr / 255, cg / 255, cb / 255, alpha, 0, 0, 0, 0, 0, 0, 0);
  }
  lineRGB(x1: number, y1: number, x2: number, y2: number, width: number, cr: number, cg: number, cb: number, alpha: number): void {
    const dx = x2 - x1,
      dy = y2 - y1,
      len = Math.hypot(dx, dy);
    if (len < 1e-3) return;
    const r = cr / 255,
      g = cg / 255,
      b = cb / 255;
    // gradient runs from the tail (x1, transparent) to the head (x2, alpha)
    this.shape(Shape.Line, (x1 + x2) / 2, (y1 + y2) / 2, len / 2, width / 2, Math.atan2(dy, dx), r, g, b, 0, r, g, b, alpha, 1, 0, 0);
  }
  circle(x: number, y: number, r: number, color: string, alpha: number): void {
    const c = parseColor(color);
    this.shape(Shape.Circle, x, y, r, r, 0, c[0], c[1], c[2], c[3] * alpha, 0, 0, 0, 0, 0, 0, 0);
  }
  ellipse(x: number, y: number, rx: number, ry: number, rot: number, color: string, alpha: number): void {
    const c = parseColor(color);
    this.shape(Shape.Circle, x, y, rx, ry, rot, c[0], c[1], c[2], c[3] * alpha, 0, 0, 0, 0, 0, 0, 0);
  }
  radial(x: number, y: number, r: number, c0: string, a0: number, c1: string, a1: number, mid: number, inner = 0): void {
    const p = parseColor(c0),
      q = parseColor(c1);
    this.shape(Shape.Radial, x, y, r, r, 0, p[0], p[1], p[2], p[3] * a0, q[0], q[1], q[2], q[3] * a1, mid, inner, 0);
  }
  ring(x: number, y: number, rx: number, ry: number, rot: number, width: number, color: string, alpha: number, soft = 0): void {
    const c = parseColor(color),
      hw = width / 2,
      ox = rx + hw,
      oy = ry + hw;
    this.shape(Shape.Ring, x, y, ox, oy, rot, c[0], c[1], c[2], c[3] * alpha, 0, 0, 0, 0, width / ((ox + oy) / 2), soft, 0);
  }
  sector(x: number, y: number, r: number, angle: number, halfArc: number, color: string, alpha: number): void {
    const c = parseColor(color);
    this.shape(Shape.Sector, x, y, r, r, 0, c[0], c[1], c[2], c[3] * alpha, 0, 0, 0, 0, angle, halfArc, 0);
  }
  arc(x: number, y: number, r: number, angle: number, halfArc: number, width: number, color: string, alpha: number): void {
    const c = parseColor(color),
      R = r + width / 2;
    this.shape(Shape.Arc, x, y, R, R, 0, c[0], c[1], c[2], c[3] * alpha, 0, 0, 0, 0, angle, halfArc, width / R);
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
    const dx = x2 - x1,
      dy = y2 - y1,
      len = Math.hypot(dx, dy);
    if (len < 1e-3) return;
    const c = parseColor(color),
      q = c2 ? parseColor(c2) : c,
      qa = (a2 ?? alpha) * q[3];
    this.shape(
      Shape.Line,
      (x1 + x2) / 2,
      (y1 + y2) / 2,
      len / 2,
      width / 2,
      Math.atan2(dy, dx),
      c[0],
      c[1],
      c[2],
      c[3] * alpha,
      q[0],
      q[1],
      q[2],
      qa,
      soft,
      0,
      0,
    );
  }
  rect(x: number, y: number, w: number, h: number, color: string, alpha: number): void {
    const c = parseColor(color);
    this.shape(Shape.Rect, x + w / 2, y + h / 2, w / 2, h / 2, 0, c[0], c[1], c[2], c[3] * alpha, 0, 0, 0, 0, 0, 0, 0);
  }

  text(str: string, x: number, y: number, size: number, color: string, alpha: number, heavy = false): void {
    if (alpha <= 0 || this.lost) return;
    const fonts = (this.fonts ??= this.bakeFonts());
    const font = heavy ? fonts.heavy : fonts.normal;
    const reg = this.atlas.region(font.canvas);
    const k = size / GLYPH_BASE,
      cw = font.canvas.width,
      ch = font.canvas.height;
    const du = (reg.u1 - reg.u0) / cw,
      dv = (reg.v1 - reg.v0) / ch;
    let width = 0;
    for (let i = 0; i < str.length; i++) width += font.glyphs[str.charCodeAt(i)]?.adv ?? 0;
    let pen = x - (width * k) / 2;
    const c = parseColor(color),
      d = this.data;
    for (let i = 0; i < str.length; i++) {
      const g = font.glyphs[str.charCodeAt(i)];
      if (!g) continue;
      const off = this.slot(reg.tex);
      const hw = (g.w / 2) * k,
        hh = (g.h / 2) * k;
      d[off] = pen + (g.w / 2 - font.pad) * k;
      d[off + 1] = y;
      d[off + 2] = hw;
      d[off + 3] = hh;
      d[off + 4] = 0;
      d[off + 5] = 0;
      d[off + 6] = 0;
      d[off + 7] = Shape.Sprite - this.unit;
      d[off + 8] = reg.u0 + g.x * du;
      d[off + 9] = reg.v0 + g.y * dv;
      d[off + 10] = reg.u0 + (g.x + g.w) * du;
      d[off + 11] = reg.v0 + (g.y + g.h) * dv;
      d[off + 12] = c[0];
      d[off + 13] = c[1];
      d[off + 14] = c[2];
      d[off + 15] = c[3] * alpha;
      d[off + 16] = 0;
      d[off + 17] = 0;
      d[off + 18] = 0;
      d[off + 19] = 0;
      d[off + 20] = 0;
      d[off + 21] = 0;
      d[off + 22] = 0;
      d[off + 23] = 0;
      pen += g.adv * k;
    }
  }

  private bakeFonts(): { normal: GlyphFont; heavy: GlyphFont } {
    const fonts = { normal: bakeFont('bold'), heavy: bakeFont('900') };
    // Web fonts may still be loading: re-bake once they're ready so text uses the real face.
    if (typeof document !== 'undefined' && document.fonts && document.fonts.status !== 'loaded') {
      document.fonts.ready
        .then(() => {
          this.fonts = null;
        })
        .catch(() => {});
    }
    return fonts;
  }

  pattern(tile: HTMLCanvasElement, x0: number, y0: number, x1: number, y1: number): void {
    if (this.lost) return;
    let tex = this.patterns.get(tile);
    if (!tex) {
      const gl = this.gl;
      tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, tile);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      this.patterns.set(tile, tex);
    }
    this.batch = null; // patterns always get their own texture binding
    const off = this.slot(tex),
      d = this.data;
    d[off] = (x0 + x1) / 2;
    d[off + 1] = (y0 + y1) / 2;
    d[off + 2] = (x1 - x0) / 2;
    d[off + 3] = (y1 - y0) / 2;
    d[off + 4] = 0;
    d[off + 5] = 0;
    d[off + 6] = 0;
    d[off + 7] = Shape.Pattern;
    d[off + 8] = 0;
    d[off + 9] = 0;
    d[off + 10] = 1;
    d[off + 11] = 1;
    d[off + 12] = 1;
    d[off + 13] = 1;
    d[off + 14] = 1;
    d[off + 15] = 1;
    d[off + 16] = 0;
    d[off + 17] = 0;
    d[off + 18] = 0;
    d[off + 19] = 0;
    d[off + 20] = tile.width;
    d[off + 21] = tile.height;
    d[off + 22] = 0;
    d[off + 23] = 0;
    this.batch = null;
  }

  beginLights(ambient: string, scale: number): void {
    this.lightScale = scale;
    const c = parseColor(ambient),
      a = c[3],
      k = this.lightEnc;
    this.lightDark = a;
    // unlit ground: (1 − darkness) of the scene shows, tinted by the darkness colour
    this.cmds.push({
      kind: 'clear',
      target: 'light',
      r: (1 - a + a * c[0]) * k,
      g: (1 - a + a * c[1]) * k,
      b: (1 - a + a * c[2]) * k,
      a: 1,
    });
    this.target = 'light';
    this.blend = 'light';
    this.batch = null;
  }
  light(x: number, y: number, r: number, alpha: number, color?: string): void {
    const k = this.lightDark * this.lightEnc;
    if (color) {
      const c = parseColor(color);
      this.shape(Shape.Light, x, y, r, r, 0, c[0] * k, c[1] * k, c[2] * k, alpha * c[3], 0, 0, 0, 0, 0, 0, 0);
    } else this.shape(Shape.Light, x, y, r, r, 0, k, k, k, alpha, 0, 0, 0, 0, 0, 0, 0);
  }
  endLights(): void {
    this.cmds.push({ kind: 'composite' });
    this.target = 'screen';
    this.blend = 'normal';
    this.batch = null;
  }

  /* --------------------------------- submit --------------------------------- */

  private ensureLightTarget(): RenderTarget {
    const w = Math.max(1, Math.ceil(this.width * this.lightScale)),
      h = Math.max(1, Math.ceil(this.height * this.lightScale));
    const t = this.lightRT;
    if (t && t.w === w && t.h === h) return t;
    const gl = this.gl;
    if (t) deleteTarget(gl, t);
    let rt = createTarget(gl, w, h, this.lightFormat);
    if (this.lightFormat !== gl.RGBA8 && !isComplete(gl, rt)) {
      // float colour buffers were promised but aren't renderable: store half the light in RGBA8
      deleteTarget(gl, rt);
      this.lightFormat = gl.RGBA8;
      this.lightEnc = 0.5;
      rt = createTarget(gl, w, h, gl.RGBA8);
    }
    return (this.lightRT = rt);
  }

  /**
   * Scene buffer (canvas size, RGBA8) plus the bloom chain (1/2 … 1/32, half float when renderable);
   * reallocated only when the canvas size changed.
   */
  private ensurePostTargets(): RenderTarget {
    const gl = this.gl,
      w = this.width,
      h = this.height;
    const scene = this.sceneRT;
    if (scene && scene.w === w && scene.h === h) return scene;
    if (scene) deleteTarget(gl, scene);
    for (const t of this.bloomRTs) deleteTarget(gl, t);
    this.bloomRTs = [];
    for (let i = 1; i <= BLOOM_LEVELS; i++) {
      const t = createTarget(gl, Math.max(1, w >> i), Math.max(1, h >> i), this.bloomFormat);
      if (i === 1 && this.bloomFormat !== gl.RGBA8 && !isComplete(gl, t)) {
        // the extension promised a renderable float format but the driver disagrees: use RGBA8 from now on
        deleteTarget(gl, t);
        this.bloomFormat = gl.RGBA8;
        i--;
        continue;
      }
      this.bloomRTs.push(t);
    }
    return (this.sceneRT = createTarget(gl, w, h, gl.RGBA8));
  }

  /** Switch render target. Unbinds textures: the light map must never be sampled while it's the target. */
  private bindTarget(t: Target): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, null);
    if (t === 'light') {
      const l = this.ensureLightTarget();
      gl.bindFramebuffer(gl.FRAMEBUFFER, l.fbo);
      gl.viewport(0, 0, l.w, l.h);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.screenFbo);
      gl.viewport(0, 0, this.width, this.height);
    }
  }

  private applyBlend(b: BlendMode | 'light'): void {
    const gl = this.gl;
    if (b === 'add' || b === 'light') gl.blendFunc(gl.ONE, gl.ONE);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  end(): void {
    const gl = this.gl;
    this.stats.drawCalls = 0;
    this.stats.instances = this.n;
    if (this.lost || gl.isContextLost()) return;
    const post = this.post && !isNeutral(this.post) ? this.post : null;
    this.screenFbo = post ? this.ensurePostTargets().fbo : null;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.subarray(0, this.n * STRIDE), gl.STREAM_DRAW);
    gl.useProgram(this.prog);
    gl.uniform2f(this.u.res, this.width, this.height);
    gl.activeTexture(gl.TEXTURE0);
    // never leave the light map bound while it may be the render target (feedback loop)
    gl.bindTexture(gl.TEXTURE_2D, null);
    const bound = this.bound;
    bound.fill(null);
    let curTarget: Target | null = null,
      curView = -1,
      curBlend: string | null = null;
    for (const c of this.cmds) {
      if (c.kind === 'clear') {
        this.bindTarget(c.target);
        curTarget = c.target;
        bound[0] = null; // bindTarget unbinds unit 0
        gl.clearColor(c.r, c.g, c.b, c.a);
        gl.clear(gl.COLOR_BUFFER_BIT);
        continue;
      }
      if (c.kind === 'composite') {
        this.bindTarget('screen');
        curTarget = 'screen';
        gl.useProgram(this.lightProg);
        gl.bindVertexArray(this.compVao);
        gl.bindTexture(gl.TEXTURE_2D, this.lightRT?.tex ?? null);
        // pass 0: scene × min(L, 1)   pass 1: scene × (1 + over-bright part)
        gl.blendFunc(gl.DST_COLOR, gl.ZERO);
        gl.uniform3f(this.uLight, 1 / this.lightEnc, 0, 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.blendFunc(gl.DST_COLOR, gl.ONE);
        gl.uniform3f(this.uLight, 1 / this.lightEnc, 1, 0.75);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindTexture(gl.TEXTURE_2D, null);
        this.stats.drawCalls += 2;
        gl.useProgram(this.prog);
        bound[0] = null;
        curBlend = null;
        continue;
      }
      if (!c.count) continue;
      if (c.target !== curTarget) {
        this.bindTarget(c.target);
        curTarget = c.target;
        bound[0] = null;
      }
      if (c.view !== curView) {
        const v = this.views,
          i = c.view * 6;
        // view = [a b c d e f] → x' = a x + c y + e ; y' = b x + d y + f
        gl.uniform3f(this.u.view0, v[i]!, v[i + 2]!, v[i + 4]!);
        gl.uniform3f(this.u.view1, v[i + 1]!, v[i + 3]!, v[i + 5]!);
        curView = c.view;
      }
      if (c.texs.length) {
        let switched = false;
        for (let i = 0; i < c.texs.length; i++)
          if (bound[i] !== c.texs[i]) {
            gl.activeTexture(gl.TEXTURE0 + i);
            gl.bindTexture(gl.TEXTURE_2D, c.texs[i]!);
            bound[i] = c.texs[i]!;
            switched = true;
          }
        if (switched) gl.activeTexture(gl.TEXTURE0);
      }
      if (c.blend !== curBlend) {
        this.applyBlend(c.blend);
        curBlend = c.blend;
      }
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
      const base = c.start * BYTES;
      for (let i = 0; i < 6; i++) gl.vertexAttribPointer(i + 1, 4, gl.FLOAT, false, BYTES, base + i * 16);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, c.count);
      this.stats.drawCalls++;
    }
    if (post) this.postProcess(post);
    gl.bindVertexArray(null);
  }

  /* ------------------------------ post-processing ----------------------------- */

  /** Full-screen pass of the current program from `src` into `dst`; `texel` (a `u_texel`) gets 1 / src size. */
  private blit(src: RenderTarget, dst: RenderTarget, texel: WebGLUniformLocation): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    gl.viewport(0, 0, dst.w, dst.h);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.uniform2f(texel, 1 / src.w, 1 / src.h);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.stats.drawCalls++;
  }

  /** Bloom chain from the scene buffer, then the final graded composite onto the canvas. */
  private postProcess(p: PostFX): void {
    const gl = this.gl,
      scene = this.sceneRT!,
      rts = this.bloomRTs,
      bloom = p.bloom > 0;
    gl.bindVertexArray(this.compVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.disable(gl.BLEND);
    if (bloom) {
      const t = Math.max(0, p.threshold),
        knee = Math.max(t * 0.5, 1e-3);
      gl.useProgram(this.brightProg);
      gl.uniform3f(this.uBright.u_curve, t, knee, 0.25 / knee);
      this.blit(scene, rts[0]!, this.uBright.u_texel);
      gl.useProgram(this.downProg);
      for (let i = 1; i < rts.length; i++) this.blit(rts[i - 1]!, rts[i]!, this.uDown.u_texel);
      // walk back up, lerping each blurred smaller level into the larger one: dst = s·up + (1 − s)·dst
      gl.enable(gl.BLEND);
      gl.blendColor(0, 0, 0, BLOOM_SPREAD);
      gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
      gl.useProgram(this.upProg);
      for (let i = rts.length - 1; i > 0; i--) this.blit(rts[i]!, rts[i - 1]!, this.uUp.u_texel);
      gl.disable(gl.BLEND);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.finalProg);
    const u = this.uFinal,
      tint = parseColor(p.tint);
    gl.uniform2f(u.u_res, this.width, this.height);
    gl.uniform1f(u.u_bloomAmt, bloom ? p.bloom * BLOOM_GAIN : 0);
    gl.uniform1f(u.u_aberration, Math.max(0, p.aberration));
    gl.uniform3f(u.u_grade, p.exposure, p.contrast, p.saturation);
    gl.uniform4f(u.u_tint, tint[0], tint[1], tint[2], Math.min(1, Math.max(0, p.tintA * tint[3])));
    // grain re-rolls at 24 Hz; the seed wraps so the hash input stays small and precise
    gl.uniform2f(u.u_grain, Math.max(0, p.grain), (Math.floor(p.time * 24) % 64) * 17);
    const sh = parseColor(p.shadows),
      hi = parseColor(p.highlights);
    gl.uniform4f(u.u_shadows, sh[0], sh[1], sh[2], Math.max(0, p.shadowsA));
    gl.uniform4f(u.u_highlights, hi[0], hi[1], hi[2], Math.max(0, p.highlightsA));
    const n = Math.min(MAX_WAVES, p.waveCount),
      wb = this.waveBuf;
    for (let i = 0; i < n; i++) {
      // device pixels (y down) → GL pixels (y up)
      wb[i * 4] = p.waves[i * 4]!;
      wb[i * 4 + 1] = this.height - p.waves[i * 4 + 1]!;
      wb[i * 4 + 2] = p.waves[i * 4 + 2]!;
      wb[i * 4 + 3] = p.waves[i * 4 + 3]!;
    }
    gl.uniform4fv(u.u_waves, wb);
    gl.uniform1i(u.u_waveN, n);
    // without bloom the sampler still needs a complete texture: the scene, weighted by 0
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, bloom ? rts[0]!.tex : scene.tex);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, scene.tex);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.stats.drawCalls++;
    // leave no post texture bound: next frame renders into them
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.BLEND);
  }
}
