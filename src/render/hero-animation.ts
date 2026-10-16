import type { Player } from '../game/types';

export type HeroAction = 'idle' | 'run' | 'attack' | 'cast' | 'dash' | 'hurt';
export const HERO_ACTION_FRAMES: Record<HeroAction, number> = { idle: 8, run: 12, attack: 8, cast: 8, dash: 4, hurt: 4 };
export interface HeroPose {
  lx: number;
  ll: number;
  rx: number;
  rl: number;
  aL: number;
  aR: number;
  bob: number;
  hem: number;
  hair: number;
  ph: number;
  cast: boolean;
  lean: number;
  reach: number;
  blink: boolean;
}

/** Poses animate joints and overlapping cloth rather than scaling the entire painted body. */
export function actionPose(action: HeroAction, frame: number, gait = -1): HeroPose {
  const n = HERO_ACTION_FRAMES[action];
  const k = Math.max(0, Math.min(n - 1, Math.floor(frame))) / n;
  const ph = k * Math.PI * 2,
    s = Math.sin(ph),
    c = Math.cos(ph);
  const pose: HeroPose = {
    lx: 0,
    ll: 0,
    rx: 0,
    rl: 0,
    aL: 0,
    aR: 0,
    bob: 0,
    hem: 0,
    hair: 0,
    ph,
    cast: false,
    lean: 0,
    reach: 0,
    blink: false,
  };
  if (action === 'idle') {
    pose.bob = s * 0.5;
    pose.aL = s * 0.12;
    pose.aR = -s * 0.1;
    pose.hem = Math.sin(ph - 0.8) * 1.2;
    pose.hair = Math.sin(ph - 1.3) * 0.9;
    pose.blink = frame === 6;
  } else if (action === 'run') {
    pose.lx = s * 5.2;
    pose.rx = -s * 5.2;
    pose.ll = Math.max(0, c) * 4.6;
    pose.rl = Math.max(0, -c) * 4.6;
    pose.aL = -s * 1.15;
    pose.aR = s * 1.15;
    pose.bob = -Math.abs(c) * 1.3;
    pose.hem = Math.sin(ph - 0.9) * -3;
    pose.hair = Math.sin(ph - 1.4) * -2.6;
    pose.lean = s * 0.035;
  } else if (action === 'dash') {
    pose.lx = -6;
    pose.rx = 7;
    pose.ll = 2;
    pose.rl = 4;
    pose.aL = -1;
    pose.aR = 0.5;
    pose.bob = 4;
    pose.hem = -6;
    pose.hair = -4;
    pose.lean = 0.2;
  } else if (action === 'hurt') {
    pose.lx = -3;
    pose.rx = 3;
    pose.bob = 2 * (1 - k);
    pose.aL = -0.6;
    pose.aR = -0.6;
    pose.lean = -0.16 * (1 - k);
    pose.hair = 2 * (1 - k);
  } else {
    // Anticipation → extension → recovery. Casters lift longer; melee recoils into its next stride.
    const t = frame / (n - 1),
      strength = Math.sin(Math.PI * t);
    pose.cast = true;
    pose.reach = strength;
    pose.lx = -3.5 * strength;
    pose.rx = 4 * strength;
    pose.aL = -0.6 * strength;
    pose.aR = strength;
    pose.bob = -strength;
    pose.lean = t < 0.28 ? -0.1 * strength : 0.16 * strength;
    pose.hem = -3.5 * Math.sin(Math.PI * Math.max(0, t - 0.15));
    pose.hair = pose.hem * 0.6;
    if (action === 'cast') {
      pose.bob -= 0.8 * strength;
      pose.aL = -strength;
    }
  }
  if (gait >= 0 && (action === 'attack' || action === 'cast')) {
    const stride = actionPose('run', gait * 3);
    pose.lx = stride.lx;
    pose.ll = stride.ll;
    pose.rx = stride.rx;
    pose.rl = stride.rl;
    pose.bob += stride.bob * 0.5;
    pose.hem += stride.hem * 0.5;
    pose.hair += stride.hair * 0.5;
  }
  return pose;
}

/** Selection is based on sim timestamps, so pause, slow motion and frame rate cannot alter combat. */
export function heroAnimation(
  p: Player,
  time: number,
  clock: number,
  reduced = false,
): { action: HeroAction; frame: number; back: boolean; gait: number } {
  let action: HeroAction = 'idle',
    phase = (clock % 4.8) / 4.8;
  if (Math.hypot(p.move.x, p.move.y) > 0.05) {
    action = 'run';
    phase = (((p.walkT / (Math.PI * 2)) % 1) + 1) % 1;
  }
  if (time - p.attackAt >= 0 && time - p.attackAt < 0.42) {
    action = 'attack';
    phase = (time - p.attackAt) / 0.42;
  }
  if (time - p.castAt >= 0 && time - p.castAt < 0.62) {
    action = 'cast';
    phase = (time - p.castAt) / 0.62;
  }
  if (p.dashT > 0) {
    action = 'dash';
    phase = Math.min(0.99, 1 - p.dashT / 0.15);
  }
  if (p.hurtFlash > 0 && !p.dashT) {
    action = 'hurt';
    phase = 1 - Math.min(1, p.hurtFlash / 0.2);
  }
  if (reduced && action === 'idle') phase = 0;
  return {
    action,
    frame: Math.min(HERO_ACTION_FRAMES[action] - 1, Math.max(0, Math.floor(phase * HERO_ACTION_FRAMES[action]))),
    back: p.face.y < -0.45,
    gait:
      Math.hypot(p.move.x, p.move.y) > 0.05 && (action === 'attack' || action === 'cast')
        ? Math.floor(((((p.walkT / (Math.PI * 2)) % 1) + 1) % 1) * 4)
        : -1,
  };
}
