/**
 * WebGL2 batched renderer.
 *
 * Every primitive — sprites, glyphs, glows, lights, circles, rings, arcs, sectors, lines, rects —
 * is one instance of a unit quad drawn by a single "uber-shader" that switches on a per-instance
 * shape id: sprites sample the atlas, shapes are evaluated analytically (signed distances with
 * derivative-based anti-aliasing). A frame is recorded into one interleaved instance buffer plus a
 * small command list, uploaded once, and replayed as a few instanced draw calls; a new batch only
 * starts when the blend mode, texture page, view transform or render target changes.
 *
 * Colours are premultiplied end-to-end (textures uploaded premultiplied, shader outputs premultiplied).
 */
import { TextureAtlas } from './atlas';
import { parseColor, type Backend, type BlendMode, type ImageOpts, type Img, type RenderStats } from './backend';
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
  float c = cos(i_xform.x), s = sin(i_xform.x);
  vec2 w = i_posSize.xy + vec2(c * local.x - s * local.y, s * local.x + c * local.y);
  vec2 scr = vec2(dot(u_view0, vec3(w, 1.0)), dot(u_view1, vec3(w, 1.0)));
  vec2 clip = scr / u_res * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_local = a_corner;
  v_uv = mix(i_uv.xy, i_uv.zw, a_corner * 0.5 + 0.5);
  v_world = w;
  v_shape = int(i_xform.w + 0.5);
  v_color = i_color;
  v_color2 = i_color2;
  v_params = i_params;
}`;

const FS = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
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

void main() {
  vec2 p = v_local;
  if (v_shape == 0) {                      // sprite / glyph (premultiplied texel)
    vec4 t = texture(u_tex, v_uv);
    vec3 col = mix(t.rgb, v_color2.rgb * t.a, v_color2.a);
    col = mix(col, vec3(t.a), v_params.x);
    o = vec4(col * v_color.rgb, t.a) * v_color.a;
    return;
  }
  if (v_shape == 10) {                     // repeating pattern in view space
    o = texture(u_tex, v_world / v_params.xy) * v_color.a;
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
const COMPOSITE_FS = `#version 300 es
precision mediump float;
uniform sampler2D u_tex;
in vec2 v_uv;
out vec4 o;
void main() { o = texture(u_tex, v_uv); }`;

type Target = 'screen' | 'light';
interface Batch {
  kind: 'draw';
  start: number;
  count: number;
  blend: BlendMode | 'erase';
  tex: WebGLTexture | null;
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

export class WebGL2Backend implements Backend {
  readonly kind = 'webgl2' as const;
  width = 1;
  height = 1;
  readonly stats: RenderStats = { drawCalls: 0, instances: 0 };

  private gl: WebGL2RenderingContext;
  private prog!: WebGLProgram;
  private compProg!: WebGLProgram;
  private vao!: WebGLVertexArrayObject;
  private compVao!: WebGLVertexArrayObject;
  private quad!: WebGLBuffer;
  private inst!: WebGLBuffer;
  private atlas!: TextureAtlas;
  private u!: { view0: WebGLUniformLocation; view1: WebGLUniformLocation; res: WebGLUniformLocation; tex: WebGLUniformLocation };
  private lightFbo: WebGLFramebuffer | null = null;
  private lightTex: WebGLTexture | null = null;
  private lightW = 0;
  private lightH = 0;
  private patterns = new WeakMap<HTMLCanvasElement, WebGLTexture>();
  private fonts: { normal: GlyphFont; heavy: GlyphFont } | null = null;
  private lost = false;

  // frame recording
  private data = new Float32Array(16384 * STRIDE);
  private n = 0;
  private cmds: Command[] = [];
  private views: number[] = [];
  private viewIdx = -1;
  private blend: BlendMode | 'erase' = 'normal';
  private target: Target = 'screen';
  private tex: WebGLTexture | null = null;
  private batch: Batch | null = null;
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
      this.lightFbo = this.lightTex = null;
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
    this.compProg = compile(gl, COMPOSITE_VS, COMPOSITE_FS);
    this.u = {
      view0: gl.getUniformLocation(this.prog, 'u_view0')!,
      view1: gl.getUniformLocation(this.prog, 'u_view1')!,
      res: gl.getUniformLocation(this.prog, 'u_res')!,
      tex: gl.getUniformLocation(this.prog, 'u_tex')!,
    };
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
    this.lightW = 0; // force light map reallocation
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
    this.tex = null;
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

  setBlend(mode: BlendMode): void {
    if (this.target === 'light' || this.blend === mode) return;
    this.blend = mode;
    this.batch = null;
  }

  /** Reserve one instance slot and return its float offset (opens a new batch if state changed). */
  private slot(tex: WebGLTexture | null): number {
    let b = this.batch;
    if (tex && b && b.tex && b.tex !== tex) b = null;
    if (!b) {
      b = this.batch = {
        kind: 'draw',
        start: this.n,
        count: 0,
        blend: this.blend,
        tex: tex ?? this.tex,
        view: this.viewIdx,
        target: this.target,
      };
      this.cmds.push(b);
    } else if (tex && !b.tex) b.tex = tex;
    if (tex) this.tex = tex;
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
      ih = img.height;
    let sx = o.sx ?? 1,
      sy = o.sy ?? sx;
    if (o.w != null) sx *= o.w / iw;
    if (o.h != null) sy *= o.h / ih;
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
    d[off + 7] = Shape.Sprite;
    d[off + 8] = reg.u0;
    d[off + 9] = reg.v0;
    d[off + 10] = reg.u1;
    d[off + 11] = reg.v1;
    d[off + 12] = 1;
    d[off + 13] = 1;
    d[off + 14] = 1;
    d[off + 15] = alpha;
    if (o.tint) {
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
    d[off + 21] = 0;
    d[off + 22] = 0;
    d[off + 23] = 0;
  }

  glow(x: number, y: number, r: number, color: string, alpha: number): void {
    const c = parseColor(color);
    this.shape(Shape.Glow, x, y, r, r, 0, c[0], c[1], c[2], c[3] * alpha, 0, 0, 0, 0, 0, 0, 0);
  }
  glowRGB(x: number, y: number, r: number, cr: number, cg: number, cb: number, alpha: number): void {
    this.shape(Shape.Glow, x, y, r, r, 0, cr / 255, cg / 255, cb / 255, alpha, 0, 0, 0, 0, 0, 0, 0);
  }
  squareRGB(x: number, y: number, size: number, cr: number, cg: number, cb: number, alpha: number): void {
    const h = size / 2;
    this.shape(Shape.Rect, x, y, h, h, 0, cr / 255, cg / 255, cb / 255, alpha, 0, 0, 0, 0, 0, 0, 0);
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
      d[off + 7] = Shape.Sprite;
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
    const c = parseColor(ambient);
    // premultiplied ambient darkness; lights erase it (destination-out)
    this.cmds.push({ kind: 'clear', target: 'light', r: c[0] * c[3], g: c[1] * c[3], b: c[2] * c[3], a: c[3] });
    this.target = 'light';
    this.blend = 'erase';
    this.batch = null;
  }
  light(x: number, y: number, r: number, alpha: number): void {
    this.shape(Shape.Light, x, y, r, r, 0, 1, 1, 1, alpha, 0, 0, 0, 0, 0, 0, 0);
  }
  endLights(): void {
    this.cmds.push({ kind: 'composite' });
    this.target = 'screen';
    this.blend = 'normal';
    this.batch = null;
  }

  /* --------------------------------- submit --------------------------------- */

  private ensureLightTarget(): void {
    const gl = this.gl;
    const w = Math.max(1, Math.ceil(this.width * this.lightScale)),
      h = Math.max(1, Math.ceil(this.height * this.lightScale));
    if (this.lightFbo && w === this.lightW && h === this.lightH) return;
    if (this.lightTex) gl.deleteTexture(this.lightTex);
    if (this.lightFbo) gl.deleteFramebuffer(this.lightFbo);
    this.lightTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.lightTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.lightFbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.lightFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.lightTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.lightW = w;
    this.lightH = h;
  }

  /** Switch render target. Unbinds textures: the light map must never be sampled while it's the target. */
  private bindTarget(t: Target): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, null);
    if (t === 'light') {
      this.ensureLightTarget();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.lightFbo);
      gl.viewport(0, 0, this.lightW, this.lightH);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.width, this.height);
    }
  }

  private applyBlend(b: BlendMode | 'erase'): void {
    const gl = this.gl;
    if (b === 'add') gl.blendFunc(gl.ONE, gl.ONE);
    else if (b === 'erase') gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  end(): void {
    const gl = this.gl;
    this.stats.drawCalls = 0;
    this.stats.instances = this.n;
    if (this.lost || gl.isContextLost()) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.subarray(0, this.n * STRIDE), gl.STREAM_DRAW);
    gl.useProgram(this.prog);
    gl.uniform1i(this.u.tex, 0);
    gl.uniform2f(this.u.res, this.width, this.height);
    gl.activeTexture(gl.TEXTURE0);
    // never leave the light map bound while it may be the render target (feedback loop)
    gl.bindTexture(gl.TEXTURE_2D, null);
    let curTarget: Target | null = null,
      curView = -1,
      curTex: WebGLTexture | null = null,
      curBlend: string | null = null;
    for (const c of this.cmds) {
      if (c.kind === 'clear') {
        this.bindTarget(c.target);
        curTarget = c.target;
        curTex = null;
        gl.clearColor(c.r, c.g, c.b, c.a);
        gl.clear(gl.COLOR_BUFFER_BIT);
        continue;
      }
      if (c.kind === 'composite') {
        this.bindTarget('screen');
        curTarget = 'screen';
        gl.useProgram(this.compProg);
        gl.bindVertexArray(this.compVao);
        gl.bindTexture(gl.TEXTURE_2D, this.lightTex);
        this.applyBlend('normal');
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindTexture(gl.TEXTURE_2D, null);
        this.stats.drawCalls++;
        gl.useProgram(this.prog);
        curTex = null;
        curBlend = 'normal';
        continue;
      }
      if (!c.count) continue;
      if (c.target !== curTarget) {
        this.bindTarget(c.target);
        curTarget = c.target;
        curTex = null;
      }
      if (c.view !== curView) {
        const v = this.views,
          i = c.view * 6;
        // view = [a b c d e f] → x' = a x + c y + e ; y' = b x + d y + f
        gl.uniform3f(this.u.view0, v[i]!, v[i + 2]!, v[i + 4]!);
        gl.uniform3f(this.u.view1, v[i + 1]!, v[i + 3]!, v[i + 5]!);
        curView = c.view;
      }
      if (c.tex && c.tex !== curTex) {
        gl.bindTexture(gl.TEXTURE_2D, c.tex);
        curTex = c.tex;
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
    gl.bindVertexArray(null);
  }
}
