import { describe, expect, it } from 'vitest';
import { exposedPoolArcs, type PoolCircle } from '../src/render/pool-boundary';

const TAU = Math.PI * 2;
const pool = (x = 0, y = 0, r = 10, kind = 'fire'): PoolCircle => ({ x, y, r, kind, color: '#ff7043' });

describe('combined spell pool boundaries', () => {
  it('keeps isolated, tangent and differently typed pools complete', () => {
    expect(exposedPoolArcs(0, [pool(), pool(20), pool(0, 0, 30, 'holy')])).toEqual([0, TAU]);
  });
  it('removes an internal rim while retaining the containing pool', () => {
    expect(exposedPoolArcs(0, [pool(), pool(0, 0, 20)])).toEqual([]);
    expect(exposedPoolArcs(1, [pool(), pool(0, 0, 20)])).toEqual([0, TAU]);
  });
  it('assigns identical rims to one pool so they neither vanish nor overdraw', () => {
    expect(exposedPoolArcs(0, [pool(), pool()])).toEqual([0, TAU]);
    expect(exposedPoolArcs(1, [pool(), pool()])).toEqual([]);
  });
  it('does not let an invisible newborn or expired pool hide an active rim', () => {
    expect(exposedPoolArcs(0, [pool(), { ...pool(0, 0, 30), age: 0, dur: 3 }])).toEqual([0, TAU]);
    expect(exposedPoolArcs(0, [pool(), { ...pool(0, 0, 30), age: 2.95, dur: 3 }])).toEqual([0, TAU]);
  });
  it('cuts the exact shared arc across the zero-angle seam', () => {
    const arcs = exposedPoolArcs(0, [pool(), pool(10)]);
    expect(arcs).toHaveLength(2);
    expect(arcs[0]).toBeCloseTo(Math.PI / 3);
    expect(arcs[1]).toBeCloseTo(TAU - Math.PI / 3);
  });
  it('merges overlapping covered intervals and exposes a closed cluster outline', () => {
    const pools = [pool(), pool(10), pool(-10), pool(0, 10), pool(0, -10)];
    expect(exposedPoolArcs(0, pools)).toEqual([]);
    for (let i = 1; i < pools.length; i++) {
      const arcs = exposedPoolArcs(i, pools);
      expect(arcs.length).toBeGreaterThan(0);
      for (let j = 0; j < arcs.length; j += 2) expect(arcs[j + 1]).toBeGreaterThan(arcs[j]!);
    }
  });
  it('matches point coverage for irregular overlapping clusters', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const pools = [
        pool(),
        ...Array.from({ length: 15 }, (_, i) => pool(Math.sin(i * 5 + seed) * 18, Math.cos(i * 7 + seed) * 18, 3 + (i % 9))),
      ];
      const arcs = exposedPoolArcs(0, pools);
      for (let i = 0; i < 180; i++) {
        const angle = ((i + 0.37) / 180) * TAU;
        const x = Math.cos(angle) * 10,
          y = Math.sin(angle) * 10;
        const visible = !pools.slice(1).some((p) => (x - p.x) ** 2 + (y - p.y) ** 2 < p.r ** 2);
        const inArc = arcs.some((start, k) => k % 2 === 0 && angle >= start && angle <= arcs[k + 1]!);
        expect(inArc).toBe(visible);
      }
    }
  });
});
