/* SOULFORGE — Soul Arts: a second active skill, chosen before the run (R / gamepad Y).
 *
 * Every champion can carry one. Arts are unlocked with Soul Rank and Soul Embers and upgraded to
 * level 5 between runs (each level: +15% power, -5% cooldown). They are deliberately big, slow
 * moments — a long cooldown that changes the next ten seconds — so they never compete with the
 * champion's own ability, which is the fast, character-defining button.
 */
import { U } from '../core/util';
import { rand } from '../core/rng';
import type { Game } from '../game/game';
import type { DamageSource, Enemy, IconSpec, Player } from '../game/types';
import type { Cost } from './forge';

export interface SoulArtDef {
  id: string;
  name: string;
  icon: IconSpec;
  color: string;
  /** Base cooldown (s) at level 1. */
  cd: number;
  desc: string;
  /** Soul Rank needed before it can be bought. */
  rank: number;
  /** Price to unlock (free arts cost nothing). */
  cost: Cost;
  /** `power` = 1 + 0.15 per level above 1 (see `artPower`). */
  use(g: Game, p: Player, power: number): void;
}

export const ART_MAX_LEVEL = 5;
export const artPower = (level: number): number => 1 + 0.15 * (Math.max(1, level) - 1);
export const artCooldown = (def: SoulArtDef, level: number): number => def.cd * (1 - 0.05 * (Math.max(1, level) - 1));
/** Upgrade price from `level` to `level + 1`. */
export const artUpgradeCost = (level: number): Cost => ({ embers: [60, 120, 200, 320][level - 1] ?? 320, star: [0, 1, 2, 4][level - 1] ?? 4 });

const SRC: DamageSource = { id: 'art', ability: true };
/** Damage that keeps pace with the night: level-scaled base times Might, times the art's power. */
const artDmg = (p: Player, base: number, perLevel: number, power: number): number => (base + p.level * perLevel) * p.stats.might * power;

/** The live enemy around which the most others are packed (sampled; at most once per cast). */
function densest(g: Game, x: number, y: number, r: number): Enemy | null {
  const list = g.enemiesInRadius(x, y, r);
  if (!list.length) return null;
  let best = list[0]!, bestN = -1;
  const step = Math.max(1, Math.floor(list.length / 60));
  for (let i = 0; i < list.length; i += step) {
    const e = list[i]!;
    let n = 0;
    for (let j = 0; j < list.length; j += step) { const o = list[j]!; if (U.dist2(e.x, e.y, o.x, o.y) < 120 * 120) n++; }
    if (n > bestN) { bestN = n; best = e; }
  }
  return best;
}

export const SOUL_ARTS: SoulArtDef[] = [
  {
    id: 'sunfall', name: 'Sunfall', icon: { g: 'sun', c: '#fde68a' }, color: '#fde68a', cd: 24, rank: 2, cost: {},
    desc: 'A pillar of dawnlight crashes onto the thickest knot of enemies near you: heavy damage in a wide circle (a fifth of their health on top) and a one-second stun.',
    use(g, p, power) {
      const t = densest(g, p.x, p.y, 460);
      const x = t ? t.x : p.x + p.face.x * 160, y = t ? t.y : p.y + p.face.y * 160;
      const r = 150 * p.stats.area, dmg = artDmg(p, 90, 13, power);
      g.fx.telegraphCircle(x, y, r, 0.55, '#fde68a');
      g.meteor(x, y, 0.55, () => {
        g.eachEnemyIn(x, y, r, (e) => { g.damageEnemy(e, dmg + (e.boss ? 0 : e.maxHp * 0.2 * power), { weapon: SRC, kx: e.x - x, ky: e.y - y, knock: 1.2 }); g.applyStatus(e, 'stun', { dur: 1 }); });
        g.fx.explosion(x, y, r, '#fde68a'); g.fx.ring(x, y, r * 1.3, '#fff7d6'); g.fx.shockwave(x, y, r * 1.6, 18); g.fx.flash('#fde68a', 0.25); g.fx.shake(8); g.sfx('explode');
      });
      g.sfx('evolve');
    },
  },
  {
    id: 'soulstorm', name: 'Soulstorm', icon: { g: 'ghost', c: '#c084fc' }, color: '#c084fc', cd: 16, rank: 3, cost: { embers: 80 },
    desc: 'Release a storm of hungry souls (twelve, and two more per level) that seek out the nearest enemies.',
    use(g, p, power) {
      const n = Math.round(12 + (power - 1) / 0.15 * 2), dmg = artDmg(p, 22, 3.2, power);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * U.TAU;
        g.after(i * 0.03, () => g.spawnProj({ x: p.x, y: p.y, angle: a, speed: 340, r: 7, dmg, pierce: 1, life: 2.6, weapon: SRC, homing: 7, sprite: { kind: 'orb', color: '#e9d5ff', size: 6 }, trail: '#c084fc', knock: 0.3, light: 1 }));
      }
      g.fx.ring(p.x, p.y, 90, '#c084fc'); g.sfx('shoot');
    },
  },
  {
    id: 'dawnward', name: 'Dawnward', icon: { g: 'shield', c: '#fde68a' }, color: '#fde68a', cd: 32, rank: 4, cost: { embers: 100 },
    desc: 'A dome of dawnlight: a shield worth 40% of your health, two seconds of invulnerability, and a blast that hurls the horde away.',
    use(g, p, power) {
      g.addShield(p.stats.maxHp * 0.4 * power, 0.4 * power); g.setInvuln(2);
      g.nova(p.x, p.y, 220 * p.stats.area, artDmg(p, 30, 4, power), SRC, { color: '#fde68a', knock: 3, speed: 700 });
      g.destroyEnemyProjectiles(p.x, p.y, 260);
      g.fx.ring(p.x, p.y, 120, '#fff7d6'); g.fx.flash('#fde68a', 0.2); g.sfx('revive');
    },
  },
  {
    id: 'chrono', name: 'Chronoshift', icon: { g: 'hourglass', c: '#b28dff' }, color: '#b28dff', cd: 45, rank: 5, cost: { embers: 120 },
    desc: 'Stop time around you: every enemy within 600px freezes for 2.5 seconds (longer with each level). Heralds are only slowed.',
    use(g, p, power) {
      const dur = 2.5 + (power - 1) * 2;
      g.eachEnemyIn(p.x, p.y, 600, (e) => g.applyStatus(e, e.boss ? 'chill' : 'freeze', { dur, power: 0.7, noMul: true }));
      g.fx.flash('#b28dff', 0.45); g.fx.ring(p.x, p.y, 600, '#b28dff', { thin: true }); g.fx.timeWarp(0.4, 0.3); g.sfx('freeze');
    },
  },
  {
    id: 'feast', name: 'Feast of Souls', icon: { g: 'drop', c: '#86efac' }, color: '#86efac', cd: 50, rank: 6, cost: { embers: 140 },
    desc: 'Every gem, coin, ember and material on the field flies to you, and you heal 25% of your health (more with each level).',
    use(g, p, power) {
      for (const k of g.pickups) if (k.kind === 'gem' || k.kind === 'gold' || k.kind === 'mat' || k.kind === 'ember') k.pull = true;
      g.heal(p.stats.maxHp * 0.25 * power);
      g.fx.ring(p.x, p.y, 700, '#86efac', { thin: true }); g.fx.souls(p.x, p.y, '#86efac', 24); g.sfx('heal');
    },
  },
  {
    id: 'gravity', name: 'Gravity Collapse', icon: { g: 'blackhole', c: '#a78bfa' }, color: '#a78bfa', cd: 28, rank: 8, cost: { embers: 160 },
    desc: 'Tear open a singularity ahead of you. It drags the horde in for 1.5 seconds, then implodes.',
    use(g, p, power) {
      const x = p.x + p.face.x * 170, y = p.y + p.face.y * 170, r = 170 * p.stats.area, dmg = artDmg(p, 70, 10, power);
      g.spawnZone({ x, y, r, dur: 1.5, dmg: dmg * 0.08, tick: 0.25, pull: 420, color: '#a78bfa', kind: 'blackhole', weapon: SRC,
        onEnd: () => {
          g.eachEnemyIn(x, y, r * 0.8, (e) => g.damageEnemy(e, dmg + (e.boss ? 0 : e.maxHp * 0.12 * power), { weapon: SRC, kx: e.x - x, ky: e.y - y, knock: 1.5 }));
          g.fx.explosion(x, y, r * 0.8, '#a78bfa'); g.fx.shockwave(x, y, r * 1.4, 16); g.fx.shake(7); g.sfx('explode');
        } });
      g.sfx('zap');
    },
  },
  {
    id: 'covenant', name: 'Ember Covenant', icon: { g: 'flame', c: '#ff7a3c' }, color: '#ff7a3c', cd: 40, rank: 10, cost: { embers: 180, star: 1 },
    desc: 'For 8 seconds, Might +30% (more with each level) and every hit sets its target ablaze.',
    use(g, p, power) {
      g.addBuff('covenant', 8, { might: 0.3 * power });
      p.covenantUntil = g.time + 8;
      g.fx.ring(p.x, p.y, 140, '#ff7a3c'); g.fx.burst(p.x, p.y, '#ff9a3c', 30, { speed: 200, life: 0.7, up: true }); g.sfx('fire');
    },
  },
  {
    id: 'thunderhead', name: 'Thunderhead', icon: { g: 'lightningball', c: '#fde047' }, color: '#fde047', cd: 30, rank: 12, cost: { embers: 200, star: 2 },
    desc: 'A storm cloud follows you for 8 seconds, striking two enemies every 0.4 seconds and leaving them shocked.',
    use(g, p, power) {
      const dmg = artDmg(p, 26, 3.6, power);
      for (let i = 0; i < 20; i++) g.after(0.4 * i, () => {
        if (g.state === 'over') return;
        const list = g.enemiesInRadius(p.x, p.y, 380);
        for (let k = 0; k < 2 && list.length; k++) { const e = list.splice(Math.floor(rand() * list.length), 1)[0]!; g.lightning(e.x, e.y, 46, dmg, SRC, { status: { type: 'shock', dur: 3 } }); }
      });
      g.fx.ring(p.x, p.y, 380, '#fde047', { thin: true }); g.sfx('zap');
    },
  },
];
export const ART_BY_ID: Record<string, SoulArtDef> = {}; SOUL_ARTS.forEach((a) => (ART_BY_ID[a.id] = a));
