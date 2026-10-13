/** First contact along a segment against a circle; Infinity means no contact this step. */
export function segmentCircleHit(x: number, y: number, dx: number, dy: number, cx: number, cy: number, radius: number): number {
  const ox = x - cx,
    oy = y - cy;
  const c = ox * ox + oy * oy - radius * radius;
  if (c <= 0) return 0;
  const a = dx * dx + dy * dy;
  if (a === 0) return Infinity;
  const b = ox * dx + oy * dy;
  if (b >= 0) return Infinity;
  const discriminant = b * b - a * c;
  if (discriminant < 0) return Infinity;
  const t = (-b - Math.sqrt(discriminant)) / a;
  return t >= 0 && t <= 1 ? t : Infinity;
}
