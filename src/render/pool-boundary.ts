/** Exposed angular spans of a pool's rim. Matching pools share one footprint instead of a web of internal rings. */
export interface PoolCircle {
  x: number;
  y: number;
  r: number;
  color: string;
  kind: string;
  age?: number;
  dur?: number;
}

const TAU = Math.PI * 2;

export function exposedPoolArcs(index: number, pools: readonly PoolCircle[]): number[] {
  const p = pools[index]!;
  const covered: [number, number][] = [];
  // Keep the angular union merged as it grows. Interior pools usually disappear after a few
  // neighbours, avoiding a full scan/sort for every rim in a large fire trail.
  const cover = (start: number, end: number): void => {
    let i = 0;
    while (i < covered.length && covered[i]![1] < start) i++;
    const first = i;
    while (i < covered.length && covered[i]![0] <= end) {
      start = Math.min(start, covered[i]![0]);
      end = Math.max(end, covered[i]![1]);
      i++;
    }
    covered.splice(first, i - first, [start, end]);
  };
  for (let j = 0; j < pools.length; j++) {
    const other = pools[j]!;
    if (j === index || other.kind !== p.kind || other.color !== p.color) continue;
    if (other.age != null && (other.age < 0.06 || (other.dur != null && other.dur - other.age < 0.1))) continue;
    const dx = other.x - p.x,
      dy = other.y - p.y;
    if (dx * dx + dy * dy >= (p.r + other.r) * (p.r + other.r)) continue;
    const d = Math.hypot(dx, dy);
    // Coincident rims need one owner, otherwise both disappear (or get drawn twice).
    if (d < 1e-6 && Math.abs(p.r - other.r) < 1e-6) {
      if (j < index) return [];
      continue;
    }
    if (d + p.r <= other.r) return [];
    if (d >= p.r + other.r || d + other.r <= p.r) continue;
    const angle = (Math.atan2(dy, dx) + TAU) % TAU;
    const half = Math.acos(Math.max(-1, Math.min(1, (p.r * p.r + d * d - other.r * other.r) / (2 * p.r * d))));
    const start = angle - half,
      end = angle + half;
    if (start < 0) {
      cover(0, end);
      cover(start + TAU, TAU);
    } else if (end > TAU) {
      cover(start, TAU);
      cover(0, end - TAU);
    } else cover(start, end);
    if (covered.length === 1 && covered[0]![0] === 0 && covered[0]![1] === TAU) return [];
  }
  const exposed: number[] = [];
  let cursor = 0;
  for (const [start, end] of covered) {
    if (start > cursor + 1e-6) exposed.push(cursor, start);
    cursor = Math.max(cursor, end);
  }
  if (cursor < TAU - 1e-6) exposed.push(cursor, TAU);
  return exposed;
}
