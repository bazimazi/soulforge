/**
 * Runtime texture atlas for procedurally generated sprite canvases.
 *
 * Sprites are packed on first use into 2048² pages with a shelf packer and uploaded with
 * `texSubImage2D`, then drawn from the page with UVs — so thousands of differently-shaped sprites
 * batch into a handful of draw calls. Regions are keyed by canvas identity (WeakMap): sprite canvases
 * are immutable once generated and cached by the sprite factory.
 */
export interface AtlasRegion {
  tex: WebGLTexture;
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

interface Page {
  tex: WebGLTexture;
  /** current shelf */
  x: number;
  y: number;
  rowH: number;
}

const PAD = 2;
const MAX_PAGES = 8;

export class TextureAtlas {
  private pages: Page[] = [];
  private regions = new WeakMap<HTMLCanvasElement, AtlasRegion>();
  /** Bumped whenever the atlas is reset; consumers holding regions must re-query. */
  generation = 0;

  constructor(
    private gl: WebGL2RenderingContext,
    readonly size = Math.min(2048, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number),
  ) {}

  get pageCount(): number {
    return this.pages.length;
  }

  region(img: HTMLCanvasElement): AtlasRegion {
    let r = this.regions.get(img);
    if (r) return r;
    r = this.pack(img);
    this.regions.set(img, r);
    return r;
  }

  private newPage(): Page {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, this.size, this.size);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // texStorage contents are undefined until written: clear to transparent so padding never bleeds.
    const zero = new Uint8Array(this.size * this.size * 4);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.size, this.size, gl.RGBA, gl.UNSIGNED_BYTE, zero);
    const page = { tex, x: 0, y: 0, rowH: 0 };
    this.pages.push(page);
    return page;
  }

  private pack(img: HTMLCanvasElement): AtlasRegion {
    const w = img.width + PAD * 2,
      h = img.height + PAD * 2;
    if (w > this.size || h > this.size) throw new Error(`Sprite ${img.width}x${img.height} exceeds atlas page size ${this.size}`);
    let page = this.pages[this.pages.length - 1];
    if (page && page.x + w > this.size) {
      page.x = 0;
      page.y += page.rowH;
      page.rowH = 0;
    }
    if (!page || page.y + h > this.size) {
      if (this.pages.length >= MAX_PAGES) this.reset();
      page = this.newPage();
    }
    const x = page.x + PAD,
      y = page.y + PAD;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, page.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, gl.RGBA, gl.UNSIGNED_BYTE, img);
    page.x += w;
    page.rowH = Math.max(page.rowH, h);
    const s = this.size;
    return { tex: page.tex, u0: x / s, v0: y / s, u1: (x + img.width) / s, v1: (y + img.height) / s };
  }

  /** Drop every page (on overflow or context loss); sprites re-upload lazily. */
  reset(lost = false): void {
    if (!lost) for (const p of this.pages) this.gl.deleteTexture(p.tex);
    this.pages = [];
    this.regions = new WeakMap();
    this.generation++;
  }
}
