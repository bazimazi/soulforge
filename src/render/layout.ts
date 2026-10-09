/**
 * Procedural scenery placement, shared by the renderer (which bakes a sprite for each prop) and the
 * map (which marks the structures). Pure: the same chunk of the same stage always yields the same props.
 */
import { U } from '../core/util';
import type { StageDef } from '../game/types';

/** World units per scenery chunk. */
export const CHUNK = 320;

export interface PropSpot {
  x: number;
  y: number;
  kind: string;
  /** Sprite variant seed. */
  variant: number;
}

/** Props of one chunk, from a hash of its coordinates and the stage seed. The spawn chunk is kept clear. */
export function propLayout(cx: number, cy: number, stage: Pick<StageDef, 'pal' | 'props'>): PropSpot[] {
  const out: PropSpot[] = [];
  if (cx === 0 && cy === 0) return out;
  const seed = stage.pal.seed;
  const n = Math.floor(U.hash2(cx * 31, cy * 17, seed) * 4);
  for (let i = 0; i < n; i++) {
    const h1 = U.hash2(cx * 7 + i, cy * 13 + i, seed + 1),
      h2 = U.hash2(cx * 3 - i, cy * 5 + i * 2, seed + 2),
      h3 = U.hash2(cx + i * 11, cy - i * 17, seed + 3);
    out.push({
      x: cx * CHUNK + h1 * CHUNK,
      y: cy * CHUNK + h2 * CHUNK,
      kind: stage.props[Math.floor(h3 * stage.props.length)]!,
      variant: Math.floor(h1 * 9999) + i,
    });
  }
  return out;
}
