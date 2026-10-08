/**
 * Bitmap font for GPU text (damage numbers, pickups, labels).
 *
 * Glyphs are baked once into a canvas: white fill with a black outline. The shader multiplies by
 * the text colour, so the fill takes the colour while the outline stays black — one quad per glyph,
 * any colour, no per-string rasterisation.
 */
const FIRST = 32;
const LAST = 126;
/** Bake resolution; drawn sizes (14–22 px × DPR) scale down from this for crisp edges. */
export const GLYPH_BASE = 48;
const FAMILY = '"Rajdhani", "Segoe UI", sans-serif';

export interface Glyph {
  /** Pixel rect inside the font canvas. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Horizontal advance in base pixels. */
  adv: number;
}

export interface GlyphFont {
  canvas: HTMLCanvasElement;
  /** Index by char code; `undefined` for unsupported characters. */
  glyphs: (Glyph | undefined)[];
  /** Height of a glyph cell in base pixels (all cells share it). */
  cellH: number;
  /** Outline width in base pixels (glyph cells are padded by this much). */
  pad: number;
}

export function bakeFont(weight: 'bold' | '900'): GlyphFont {
  const stroke = Math.round(GLYPH_BASE * 0.19);
  const pad = Math.ceil(stroke / 2) + 2;
  const cellH = Math.ceil(GLYPH_BASE * 1.25) + pad * 2;
  const font = `${weight} ${GLYPH_BASE}px ${FAMILY}`;
  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = font;
  const widths: number[] = [];
  for (let c = FIRST; c <= LAST; c++) widths[c] = Math.ceil(measure.measureText(String.fromCharCode(c)).width);

  // shelf-pack into a fixed-width sheet
  const sheetW = 1024;
  const glyphs: (Glyph | undefined)[] = [];
  let x = 0,
    y = 0;
  for (let c = FIRST; c <= LAST; c++) {
    const w = widths[c]! + pad * 2;
    if (x + w > sheetW) {
      x = 0;
      y += cellH;
    }
    glyphs[c] = { x, y, w, h: cellH, adv: widths[c]! };
    x += w;
  }
  const canvas = document.createElement('canvas');
  canvas.width = sheetW;
  canvas.height = y + cellH;
  const ctx = canvas.getContext('2d')!;
  ctx.font = font;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = stroke;
  ctx.strokeStyle = '#000';
  ctx.fillStyle = '#fff';
  for (let c = FIRST; c <= LAST; c++) {
    const g = glyphs[c]!;
    const ch = String.fromCharCode(c);
    ctx.strokeText(ch, g.x + pad, g.y + cellH / 2);
    ctx.fillText(ch, g.x + pad, g.y + cellH / 2);
  }
  return { canvas, glyphs, cellH, pad };
}
