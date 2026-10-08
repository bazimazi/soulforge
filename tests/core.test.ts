import { describe, expect, it, vi } from 'vitest';
import { Emitter } from '../src/core/events';
import { Rng } from '../src/core/rng';
import { SpatialHash } from '../src/core/spatial-hash';
import { U } from '../src/core/util';
import { FX } from '../src/render/fx';

describe('Rng', () => {
  it('is deterministic for a seed and differs across seeds', () => {
    const a = new Rng(42),
      b = new Rng(42),
      c = new Rng(43);
    const sa = Array.from({ length: 100 }, () => a.next());
    expect(Array.from({ length: 100 }, () => b.next())).toEqual(sa);
    expect(Array.from({ length: 100 }, () => c.next())).not.toEqual(sa);
  });

  it('stays in range and is roughly uniform', () => {
    const r = new Rng(7),
      buckets = new Array(10).fill(0);
    for (let i = 0; i < 100_000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      buckets[Math.floor(v * 10)]++;
    }
    for (const n of buckets) expect(Math.abs(n - 10_000)).toBeLessThan(600);
  });

  it('int() is inclusive and state can be saved/restored', () => {
    const r = new Rng(1);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) seen.add(r.int(1, 4));
    expect([...seen].sort()).toEqual([1, 2, 3, 4]);
    const s = r.getState();
    const next = [r.next(), r.next()];
    r.setState(s);
    expect([r.next(), r.next()]).toEqual(next);
  });

  it('weightedPick respects weights', () => {
    const r = new Rng(3);
    let heavy = 0;
    for (let i = 0; i < 10_000; i++) if (r.weightedPick(['a', 'b'], (x) => (x === 'a' ? 9 : 1)) === 'a') heavy++;
    expect(heavy / 10_000).toBeGreaterThan(0.87);
    expect(heavy / 10_000).toBeLessThan(0.93);
  });
});

describe('SpatialHash', () => {
  const brute = (pts: { x: number; y: number; r: number }[], x: number, y: number, r: number) =>
    pts.filter((p) => Math.hypot(p.x - x, p.y - y) <= r + p.r);

  it('query() matches brute force, including negative coordinates and hash collisions', () => {
    const r = new Rng(9);
    // tiny bucket table forces many distinct cells into the same bucket
    const grid = new SpatialHash<{ x: number; y: number; r: number }>(50, 8, 4);
    const pts = Array.from({ length: 800 }, () => ({ x: r.range(-2000, 2000), y: r.range(-2000, 2000), r: r.range(5, 30) }));
    for (const p of pts) grid.insert(p);
    for (let q = 0; q < 50; q++) {
      const x = r.range(-2000, 2000),
        y = r.range(-2000, 2000),
        rad = r.range(10, 300);
      // entity radius may reach beyond its cell: query with the max radius margin, as the game does
      const got = grid.query(x, y, rad + 30).filter((p) => Math.hypot(p.x - x, p.y - y) <= rad + p.r);
      expect(new Set(got)).toEqual(new Set(brute(pts, x, y, rad)));
    }
  });

  it('never visits an entity twice and candidates() agrees with each()', () => {
    const grid = new SpatialHash<{ x: number; y: number; r: number }>(10, 2);
    const pts = Array.from({ length: 200 }, (_, i) => ({ x: (i % 20) * 7, y: Math.floor(i / 20) * 7, r: 1 }));
    pts.forEach((p) => grid.insert(p));
    const seen: object[] = [];
    grid.each(60, 30, 200, (e) => void seen.push(e));
    expect(new Set(seen).size).toBe(seen.length);
    const buf: { x: number; y: number; r: number }[] = [];
    expect(grid.candidates(60, 30, 200, buf)).toBe(seen.length);
  });

  it('nearest() returns the closest entity within range', () => {
    const grid = new SpatialHash<{ x: number; y: number; r: number; id: number }>(64);
    [
      { x: 100, y: 0, r: 1, id: 1 },
      { x: 30, y: 30, r: 1, id: 2 },
      { x: -500, y: 0, r: 1, id: 3 },
    ].forEach((p) => grid.insert(p));
    expect(grid.nearest(0, 0, 200)?.id).toBe(2);
    expect(grid.nearest(0, 0, 200, (e) => e.id !== 2)?.id).toBe(1);
    expect(grid.nearest(0, 0, 20)).toBeNull();
  });

  it('clear() empties the grid and grows past initial capacity', () => {
    const grid = new SpatialHash<{ x: number; y: number; r: number }>(64, 16, 2);
    for (let i = 0; i < 100; i++) grid.insert({ x: i, y: i, r: 1 });
    expect(grid.size).toBe(100);
    grid.clear();
    expect(grid.size).toBe(0);
    expect(grid.query(50, 50, 500)).toEqual([]);
  });
});

describe('Emitter', () => {
  it('delivers positional args, supports off/unsubscribe', () => {
    const em = new Emitter<{ hit: (a: number, b: string) => void }>();
    const fn = vi.fn();
    const off = em.on('hit', fn);
    em.emit('hit', 1, 'x');
    off();
    em.emit('hit', 2, 'y');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(1, 'x');
  });
});

describe('FX particles', () => {
  it('pool spawns, ages and recycles without exceeding capacity', () => {
    const fx = new FX();
    for (let i = 0; i < 500; i++) fx.burst(0, 0, '#ff0000', 20, { life: 0.5 });
    expect(fx.parts.count).toBeLessThanOrEqual(fx.parts.cap);
    expect(fx.parts.r[0]).toBe(255);
    fx.update(1);
    expect(fx.parts.count).toBe(0);
  });

  it('effects expire', () => {
    const fx = new FX();
    fx.ring(0, 0, 10, '#fff');
    fx.text(0, 0, 'hi', '#fff');
    fx.update(2);
    expect(fx.rings.length).toBe(0);
    expect(fx.texts.length).toBe(0);
  });
});

describe('U formatting', () => {
  it('formats numbers and time', () => {
    expect(U.fmt(999)).toBe('999');
    expect(U.fmt(1500)).toBe('1.5K');
    expect(U.fmt(2_500_000)).toBe('2.50M');
    expect(U.fmtTime(125)).toBe('02:05');
    expect(U.esc('<b>"x"</b>')).toBe('&lt;b&gt;&quot;x&quot;&lt;/b&gt;');
  });
});
