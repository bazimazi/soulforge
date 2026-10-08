/**
 * Allocation-free spatial hash for broad-phase circle queries over an unbounded world.
 *
 * Rebuilt from scratch every simulation step (O(n) insert, no per-cell arrays): buckets are
 * intrusive singly-linked lists stored in typed arrays (`heads` / `next`). Each entry also records
 * its integer cell so that hash collisions between distinct cells are rejected exactly — a query
 * never visits an entity twice and never returns entities from unrelated cells.
 */

export interface Circle {
  x: number;
  y: number;
  r: number;
}

export class SpatialHash<T extends Circle> {
  readonly cellSize: number;
  private readonly inv: number;
  private readonly mask: number;
  private heads: Int32Array;
  private next: Int32Array;
  private cellX: Int32Array;
  private cellY: Int32Array;
  private items: T[] = [];
  private count = 0;

  /**
   * @param cellSize world units per cell; ~2x the typical entity radius + query radius works well.
   * @param buckets  number of hash buckets (rounded up to a power of two).
   * @param capacity initial entity capacity (grows automatically).
   */
  constructor(cellSize = 64, buckets = 4096, capacity = 2048) {
    this.cellSize = cellSize;
    this.inv = 1 / cellSize;
    let size = 1;
    while (size < buckets) size <<= 1;
    this.mask = size - 1;
    this.heads = new Int32Array(size).fill(-1);
    this.next = new Int32Array(capacity);
    this.cellX = new Int32Array(capacity);
    this.cellY = new Int32Array(capacity);
  }

  get size(): number {
    return this.count;
  }

  private bucket(cx: number, cy: number): number {
    return (Math.imul(cx, 0x8da6b343) ^ Math.imul(cy, 0xd8163841)) & this.mask;
  }

  clear(): void {
    this.heads.fill(-1);
    // Drop references so removed entities can be collected.
    for (let i = 0; i < this.count; i++) (this.items as unknown[])[i] = undefined;
    this.count = 0;
  }

  insert(e: T): void {
    const i = this.count++;
    if (i >= this.next.length) this.grow();
    const cx = Math.floor(e.x * this.inv);
    const cy = Math.floor(e.y * this.inv);
    const h = this.bucket(cx, cy);
    this.items[i] = e;
    this.cellX[i] = cx;
    this.cellY[i] = cy;
    this.next[i] = this.heads[h]!;
    this.heads[h] = i;
  }

  private grow(): void {
    const cap = this.next.length * 2;
    const grow = (a: Int32Array) => {
      const b = new Int32Array(cap);
      b.set(a);
      return b;
    };
    this.next = grow(this.next);
    this.cellX = grow(this.cellX);
    this.cellY = grow(this.cellY);
  }

  /**
   * Visit every entity whose cell touches the square bounding circle (x, y, r).
   * Broad phase only — callers do their own exact test. Return `false` from `fn` to stop early.
   * Re-entrant: `fn` may itself run further queries.
   */
  each(x: number, y: number, r: number, fn: (e: T) => boolean | void): void {
    const inv = this.inv;
    const x0 = Math.floor((x - r) * inv),
      x1 = Math.floor((x + r) * inv);
    const y0 = Math.floor((y - r) * inv),
      y1 = Math.floor((y + r) * inv);
    const { heads, next, cellX, cellY, items } = this;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        for (let i = heads[this.bucket(cx, cy)]!; i !== -1; i = next[i]!) {
          if (cellX[i] !== cx || cellY[i] !== cy) continue;
          if (fn(items[i]!) === false) return;
        }
      }
    }
  }

  /**
   * Collect broad-phase candidates into `out` (cleared first) and return the count.
   * The allocation-free path for hot loops; `out` must not be shared by nested queries.
   */
  candidates(x: number, y: number, r: number, out: T[]): number {
    const inv = this.inv;
    const x0 = Math.floor((x - r) * inv),
      x1 = Math.floor((x + r) * inv);
    const y0 = Math.floor((y - r) * inv),
      y1 = Math.floor((y + r) * inv);
    const { heads, next, cellX, cellY, items } = this;
    let n = 0;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        for (let i = heads[this.bucket(cx, cy)]!; i !== -1; i = next[i]!) {
          if (cellX[i] !== cx || cellY[i] !== cy) continue;
          out[n++] = items[i]!;
        }
      }
    }
    out.length = n;
    return n;
  }

  /** Entities whose circle overlaps circle (x, y, r). */
  query(x: number, y: number, r: number, out: T[] = []): T[] {
    out.length = 0;
    this.each(x, y, r, (e) => {
      const rr = r + e.r,
        dx = e.x - x,
        dy = e.y - y;
      if (dx * dx + dy * dy <= rr * rr) out.push(e);
    });
    return out;
  }

  /** Nearest entity centre within radius `r` (optionally filtered), or null. */
  nearest(x: number, y: number, r: number, filter?: (e: T) => boolean): T | null {
    let best: T | null = null;
    let bd = r * r;
    this.each(x, y, r, (e) => {
      const dx = e.x - x,
        dy = e.y - y,
        d = dx * dx + dy * dy;
      if (d < bd && (!filter || filter(e))) {
        bd = d;
        best = e;
      }
    });
    return best;
  }
}
