import type { CharacterDef } from '../game/types';
import { HERO_ACTION_FRAMES, type HeroAction } from '../render/hero-animation';
import { Sprites as S } from '../render/sprites';

/** The actual world animation on a small stage, with no independent loop or gameplay mutation. */
export class ChampionPreview {
  action: HeroAction = 'idle';
  private clock = 0;
  private tick = 0;
  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly char: CharacterDef,
  ) {}

  update(dt: number, reduced: boolean): void {
    this.clock += reduced ? 0 : dt;
    this.tick += dt;
    if (this.tick < 1 / 24 && this.clock > 0) return;
    this.tick = 0;
    const x = this.canvas.getContext('2d')!,
      w = this.canvas.width,
      h = this.canvas.height;
    x.clearRect(0, 0, w, h);
    const c = this.char.colors.accent,
      cx = w / 2,
      floor = h * 0.79;
    const bg = x.createRadialGradient(cx, h * 0.52, 0, cx, h * 0.52, w * 0.58);
    bg.addColorStop(0, c + '25');
    bg.addColorStop(0.7, c + '08');
    bg.addColorStop(1, '#06070a00');
    x.fillStyle = bg;
    x.fillRect(0, 0, w, h);
    x.save();
    x.translate(cx, floor);
    x.scale(1, 0.3);
    x.strokeStyle = c;
    x.globalAlpha = 0.3;
    x.lineWidth = 2;
    for (const radius of [w * 0.24, w * 0.3, w * 0.34]) {
      x.beginPath();
      x.arc(0, 0, radius, 0, Math.PI * 2);
      x.stroke();
    }
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + this.clock * 0.05;
      x.beginPath();
      x.moveTo(Math.cos(a) * w * 0.29, Math.sin(a) * w * 0.29);
      x.lineTo(Math.cos(a) * w * 0.31, Math.sin(a) * w * 0.31);
      x.stroke();
    }
    x.restore();
    const period = this.action === 'idle' ? 4.8 : this.action === 'run' ? 0.8 : 1.8;
    const phase = (this.clock % period) / period;
    const action = this.action !== 'idle' && this.action !== 'run' && phase > 0.5 ? 'idle' : this.action;
    const frame = reduced
      ? 0
      : Math.floor((action === 'idle' || action === 'run' ? phase : phase * 2) * HERO_ACTION_FRAMES[action]) % HERO_ACTION_FRAMES[action];
    const hero = S.heroAnimated(this.char, action, frame, false, -1, 4);
    const scale = w / 150;
    x.save();
    x.translate(cx, floor);
    x.scale(scale, scale * 1.08);
    x.drawImage(hero, -hero.ox / 4, -hero.oy / 4, hero.width / 4, hero.height / 4);
    x.restore();
    x.fillStyle = c;
    for (let i = 0; i < 15; i++) {
      const py = h * 0.82 - ((this.clock * 18 + i * 31) % (h * 0.65));
      x.globalAlpha = 0.15 + 0.3 * Math.sin(i * 3.1) ** 2;
      x.beginPath();
      x.arc(cx + Math.sin(i * 7.3 + this.clock * 0.1) * w * 0.3, py, i % 3 === 0 ? 2 : 1, 0, Math.PI * 2);
      x.fill();
    }
    x.globalAlpha = 1;
  }
}
