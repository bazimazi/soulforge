import type { StageDef } from '../game/types';
import { Sprites as S } from '../render/sprites';

const previews = new Map<string, string>();
/** Biome postcards made from the actual terrain and scenery rather than empty palette swatches. */
export function stagePreview(stage: StageDef): string {
  const existing = previews.get(stage.id);
  if (existing) return existing;
  const canvas = document.createElement('canvas');
  canvas.width = 480;
  canvas.height = 170;
  const x = canvas.getContext('2d')!;
  x.drawImage(S.groundTile(stage.pal), 0, 0, canvas.width, canvas.height);
  const kinds = stage.props.filter((p) => !['bones', 'roots', 'pew'].includes(p));
  for (let i = 0; i < 7; i++) {
    const sprite = S.prop(kinds[i % kinds.length] ?? 'obelisk', stage.seed + i * 17, stage.pal);
    const scale = 0.55 + (i % 3) * 0.15;
    const px = 32 + i * 68,
      py = 78 + (i % 3) * 35;
    x.save();
    x.translate(px, py);
    x.scale(scale, scale);
    const res = sprite.res ?? 1;
    x.drawImage(sprite, -sprite.ox / res, -sprite.oy / res, sprite.width / res, sprite.height / res);
    x.restore();
  }
  const shade = x.createLinearGradient(0, 0, 0, canvas.height);
  shade.addColorStop(0, stage.pal.sky + '33');
  shade.addColorStop(1, '#08090ddd');
  x.fillStyle = shade;
  x.fillRect(0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL();
  previews.set(stage.id, url);
  return url;
}
