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
  used: number;
  active: boolean;
  /** current shelf */
  x: number;
  y: number;
  rowH: number;
}

const PAD = 2;
const MAX_PAGES = 8;

export class TextureAtlas {
  private pages: Page[] = [];
  private regions = new WeakMap<HTMLCanvasElement, { region: AtlasRegion; page: Page }>();
  private frame = 0;
  /** Bumped whenever the atlas is reset; consumers holding regions must re-query. */
  generation = 0;

  constructor(
    private gl: WebGL2RenderingContext,
    readonly size = Math.min(2048, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number),
  ) {}

  get pageCount(): number {
    return this.pages.length;
  }

  /** Evict cold pages only between frames. Recorded batches still own every texture used this frame. */
  beginFrame(): void {
    this.frame++;
    for (let i = 0; i < this.pages.length && this.pages.length > MAX_PAGES;) {
      const page = this.pages[i]!;
      if (page.used < this.frame - 1) {
        page.active = false;
        this.gl.deleteTexture(page.tex);
        this.pages.splice(i, 1);
      } else i++;
    }
  }

  region(img: HTMLCanvasElement): AtlasRegion {
    const cached = this.regions.get(img);
    if (cached?.page.active) {
      cached.page.used = this.frame;
      return cached.region;
    }
    const packed = this.pack(img);
    this.regions.set(img, packed);
    return packed.region;
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
    const page = { tex, x: 0, y: 0, rowH: 0, used: this.frame, active: true };
    this.pages.push(page);
    return page;
  }

  private pack(img: HTMLCanvasElement): { region: AtlasRegion; page: Page } {
    // Area bonuses can grow a spell beyond a page. Resample its texture, preserving the original
    // canvas dimensions/pivot used by image() for world geometry in both rendering backends.
    const scale = Math.min(1, (this.size - PAD * 2) / Math.max(img.width, img.height));
    let source = img;
    if (scale < 1) {
      source = document.createElement('canvas');
      source.width = Math.max(1, Math.floor(img.width * scale));
      source.height = Math.max(1, Math.floor(img.height * scale));
      source.getContext('2d')!.drawImage(img, 0, 0, source.width, source.height);
    }
    const w = source.width + PAD * 2,
      h = source.height + PAD * 2;
    let page = this.pages[this.pages.length - 1];
    if (page && page.x + w > this.size) {
      page.x = 0;
      page.y += page.rowH;
      page.rowH = 0;
    }
    if (!page || page.y + h > this.size) {
      page = this.newPage();
    }
    const x = page.x + PAD,
      y = page.y + PAD;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, page.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, gl.RGBA, gl.UNSIGNED_BYTE, source);
    page.used = this.frame;
    page.x += w;
    page.rowH = Math.max(page.rowH, h);
    const s = this.size;
    return { page, region: { tex: page.tex, u0: x / s, v0: y / s, u1: (x + source.width) / s, v1: (y + source.height) / s } };
  }

  /** Drop every page on context loss; sprites re-upload lazily. */
  reset(lost = false): void {
    for (const p of this.pages) {
      p.active = false;
      if (!lost) this.gl.deleteTexture(p.tex);
    }
    this.pages = [];
    this.regions = new WeakMap();
    this.generation++;
  }
}
