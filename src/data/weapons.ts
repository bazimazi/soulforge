/* SOULFORGE — general weapon pool (available to every character) + weapon helpers */
import { U } from '../core/util';
import { rand } from '../core/rng';
import type { Game } from '../game/game';
import type { Enemy, Player, Projectile, Weapon, WeaponDef, WeaponDefInput, WeaponLevelDelta, WeaponStats } from '../game/types';

export const WEAPONS: Record<string, WeaponDef> = {};
export const registerWeapon = (def: WeaponDefInput): WeaponDef => { def.max = def.max || 8; WEAPONS[def.id] = def as WeaponDef; return def as WeaponDef; };

/* helpers shared by all weapon behaviors */
export const WH = {
  /* angle toward nearest enemy within range, else facing direction */
  aim(g: Game, p: Player, range = 520, filter?: (e: Enemy) => boolean): number {
    const e = g.nearestEnemy(p.x, p.y, range, filter);
    if (e) return Math.atan2(e.y - p.y, e.x - p.x);
    return Math.atan2(p.face.y, p.face.x);
  },
  facing(p: Player): number { return Math.atan2(p.face.y, p.face.x); },
  spread(n: number, center: number, arc: number): number[] {
    const out: number[] = [];
    if (n === 1) return [center];
    for (let i = 0; i < n; i++) out.push(center - arc / 2 + (arc * i) / (n - 1));
    return out;
  },
  /* n distinct nearest targets */
  targets(g: Game, p: Player, n: number, range = 560): Enemy[] {
    const list = g.enemiesInRadius(p.x, p.y, range);
    list.sort((a, b) => U.dist2(p.x, p.y, a.x, a.y) - U.dist2(p.x, p.y, b.x, b.y));
    return list.slice(0, n);
  },
  describe(delta: WeaponLevelDelta): string {
    const parts: (string | number)[] = [];
    const N: Record<string, string> = { dmg: 'Damage', cd: 'Cooldown', amount: 'Amount', speed: 'Speed', pierce: 'Pierce', area: 'Area', duration: 'Duration', knock: 'Knockback', chains: 'Chains', crit: 'Crit', tick: 'Tick rate', range: 'Range', minions: 'Max minions', burn: 'Burn', pull: 'Pull', turrets: 'Max turrets', slow: 'Slow', heal: 'Heal', bounces: 'Bounces', rate: 'Fire rate' };
    for (const k in delta) {
      const v = delta[k] as number;
      if (k === 'cd') parts.push('Cooldown ' + (v < 0 ? '' : '+') + Math.round(v * 100) + '%');
      else if (k === 'area' || k === 'speed' || k === 'knock' || k === 'burn' || k === 'pull' || k === 'slow' || k === 'rate' || k === 'range') parts.push((N[k] || k) + ' +' + Math.round(v * 100) + '%');
      else if (k === 'duration') parts.push('Duration +' + v + 's');
      else if (k === 'dmg') parts.push('Damage +' + v);
      else if (k === 'crit') parts.push('Crit +' + Math.round(v * 100) + '%');
      else if (k === 'tick') parts.push('Hits ' + Math.round(-v * 100) + '% faster');
      else if (k === 'flag') parts.push(v);
      else parts.push((N[k] || k) + ' +' + v);
    }
    return parts.join(', ');
  },
};
const H = WH;

/* ================= GENERAL WEAPONS ================= */

registerWeapon({
  id: 'arcane_missile', name: 'Arcane Missile', icon: { g: 'orb', c: '#8ab4ff' }, tags: ['magic'],
  desc: 'Fires homing bolts at the nearest enemies.',
  base: { dmg: 12, cd: 1.3, amount: 1, speed: 460, pierce: 1, area: 1, duration: 2.2 },
  levels: [{ amount: 1 }, { dmg: 6 }, { cd: -0.1 }, { amount: 1 }, { dmg: 8, pierce: 1 }, { amount: 1 }, { dmg: 12, cd: -0.1 }],
  evo: { with: 'crown', name: 'Astral Barrage', icon: { g: 'star', c: '#8ab4ff' }, desc: 'Bolts split into shards on impact and fire 3 more at once.', stats: { amount: 3, dmgMul: 1.4 } },
  fire(g, w, s) {
    const p = g.player;
    const tg = H.targets(g, p, s.amount, 620);
    for (let i = 0; i < s.amount; i++) {
      const t = tg[i % Math.max(1, tg.length)];
      const a = t ? Math.atan2(t.y - p.y, t.x - p.x) + (Math.floor(i / Math.max(1, tg.length))) * 0.5 : H.facing(p) + (i - s.amount / 2) * 0.35;
      g.after(i * 0.07, () => g.spawnProj({
        x: p.x, y: p.y, angle: a, speed: s.speed, r: 7, dmg: s.dmg, pierce: s.pierce, life: s.duration, weapon: w,
        sprite: { kind: 'bolt', color: '#8ab4ff', len: 22, wid: 5 }, homing: 5, trail: '#8ab4ff', knock: 0.4 * s.knock,
        onHit: w.evolved ? (g2: Game, pr: Projectile, e: Enemy) => { for (let k = 0; k < 3; k++) g2.spawnProj({ x: e.x, y: e.y, angle: rand() * U.TAU, speed: 360, r: 4, dmg: s.dmg * 0.4, pierce: 1, life: 0.5, weapon: w, sprite: { kind: 'orb', color: '#c7d9ff', size: 4 }, noOnHit: true }); } : null,
      }));
    }
    g.sfx('shoot');
  },
});

registerWeapon({
  id: 'cyclone_axe', name: 'Cyclone Axe', icon: { g: 'axe', c: '#dfe6ee' }, tags: ['physical'],
  desc: 'Hurls spinning axes that return to you, cutting through everything twice.',
  base: { dmg: 18, cd: 1.6, amount: 1, speed: 420, pierce: -1, area: 1, duration: 0.75, knock: 1 },
  levels: [{ dmg: 8 }, { amount: 1 }, { area: 0.2 }, { dmg: 10 }, { cd: -0.12 }, { amount: 1 }, { dmg: 16, area: 0.2 }],
  evo: { with: 'plate', name: 'Death Spiral', icon: { g: 'spiral', c: '#dfe6ee' }, desc: 'Axes grow massive, spiral around you before returning and crit often.', stats: { dmgMul: 1.5, areaMul: 1.4, crit: 0.2, amount: 1 } },
  fire(g, w, s) {
    const p = g.player;
    const base = H.aim(g, p, 400);
    const angs = H.spread(s.amount, base, 0.5 * (s.amount - 1));
    angs.forEach((a, i) => g.after(i * 0.1, () => g.spawnProj({
      x: p.x, y: p.y, angle: a, speed: s.speed, r: 16 * s.area, dmg: s.dmg, pierce: -1, hitCd: 0.45, life: s.duration * 2 + 0.6, weapon: w, crit: s.crit,
      sprite: { kind: 'axe', color: '#dfe6ee', len: 34 * s.area, wid: 7 * s.area }, spin: 14, knock: s.knock, boomerang: { t: s.duration, spiral: w.evolved }, trail: w.evolved ? '#dfe6ee' : null,
    })));
    g.sfx('slash');
  },
});

registerWeapon({
  id: 'holy_font', name: 'Holy Font', icon: { g: 'drop', c: '#7dd3fc' }, tags: ['holy'],
  desc: 'Lobs flasks of blessed water that leave burning pools of light.',
  base: { dmg: 6, cd: 2.6, amount: 1, area: 1, duration: 3.2, tick: 0.3 },
  levels: [{ area: 0.2 }, { dmg: 3 }, { amount: 1 }, { duration: 0.3 }, { dmg: 4, area: 0.2 }, { amount: 1 }, { dmg: 6, cd: -0.15 }],
  evo: { with: 'hourglass', name: 'Sanctified Deluge', icon: { g: 'wave', c: '#7dd3fc' }, desc: 'Pools become vast, last far longer and heal you while you stand in them.', stats: { areaMul: 1.6, durationMul: 1.6, dmgMul: 1.3, amount: 1 } },
  fire(g, w, s) {
    const p = g.player;
    for (let i = 0; i < s.amount; i++) {
      const e = g.randomEnemyNear(p.x, p.y, 380);
      const tx = e ? e.x + U.rand(-30, 30) : p.x + U.rand(-220, 220), ty = e ? e.y + U.rand(-30, 30) : p.y + U.rand(-220, 220);
      g.after(i * 0.15, () => g.lob(p.x, p.y, tx, ty, 0.55, '#7dd3fc', () => {
        g.spawnZone({ x: tx, y: ty, r: 62 * s.area, dur: s.duration, dmg: s.dmg, tick: s.tick, weapon: w, color: '#7dd3fc', kind: 'holy', heal: w.evolved ? 2 : 0 });
      }));
    }
  },
});

registerWeapon({
  id: 'plague_aura', name: 'Plague Aura', icon: { g: 'ring', c: '#a3e635' }, tags: ['poison'],
  desc: 'A toxic cloud surrounds you, withering everything that touches it.',
  base: { dmg: 5, cd: 0, amount: 1, area: 1, tick: 0.5, knock: 0.3 },
  levels: [{ area: 0.15 }, { dmg: 2 }, { area: 0.15 }, { tick: -0.08 }, { dmg: 3 }, { area: 0.2 }, { dmg: 5, tick: -0.08 }],
  evo: { with: 'vitality', name: 'Plague Heart', icon: { g: 'heart', c: '#a3e635' }, desc: 'The cloud doubles in size, drains life from enemies and weakens their attacks.', stats: { areaMul: 1.6, dmgMul: 1.5 } },
  continuous: true,
  update(g, w, s, dt) {
    const p = g.player;
    w.tick = (w.tick || 0) - dt;
    w.radius = 85 * s.area;
    if (w.tick <= 0) {
      w.tick = s.tick;
      let hits = 0;
      g.eachEnemyIn(p.x, p.y, w.radius, (e) => {
        g.damageEnemy(e, s.dmg, { weapon: w, kx: e.x - p.x, ky: e.y - p.y, knock: s.knock, quiet: true });
        if (w.evolved) { e.weak = 0.7; e.weakT = 1; }
        hits++;
      });
      if (w.evolved && hits) g.heal(Math.min(hits, 6) * 0.5, true);
    }
  },
});

registerWeapon({
  id: 'guardian_blades', name: 'Guardian Blades', icon: { g: 'sword', c: '#c4b5fd' }, tags: ['physical'],
  desc: 'Spectral blades orbit you for a time, then must be re-summoned.',
  base: { dmg: 14, cd: 3.5, amount: 2, speed: 1, area: 1, duration: 3, knock: 0.8 },
  levels: [{ amount: 1 }, { dmg: 6, speed: 0.2 }, { duration: 0.6 }, { amount: 1 }, { area: 0.25, dmg: 8 }, { duration: 0.6, speed: 0.2 }, { amount: 1, dmg: 12 }],
  evo: { with: 'velocity', name: 'Blade Tempest', icon: { g: 'tornado', c: '#c4b5fd' }, desc: 'The blades never fade, spin twice as fast and throw sparks on hit.', stats: { permanent: true, speedMul: 1.8, dmgMul: 1.4, amount: 1 } },
  fire(g, w, s) {
    const p = g.player;
    // Evolved blades never fade: on each cycle just re-sync them with the current stats, and only
    // re-summon the ring when the blade count changed (e.g. a new Twin Mirror level).
    const live: Projectile[] = (w.blades || []).filter((b: Projectile) => !b.dead);
    if (w.evolved && live.length === s.amount && live.every((b) => b.life > 1e8)) {
      for (const b of live) { b.dmg = s.dmg; b.r = 13 * s.area; b.knock = s.knock; b.orbit!.radius = 95 * s.area; b.orbit!.speed = 3.2 * s.speed; b.sprite = { kind: 'dagger', color: '#c4b5fd', len: 30 * s.area, wid: 6 * s.area }; }
      w.blades = live;
      return;
    }
    if (w.evolved) for (const b of live) b.dead = true;
    w.blades = [];
    for (let i = 0; i < s.amount; i++) {
      w.blades.push(g.spawnProj({
        x: p.x, y: p.y, r: 13 * s.area, dmg: s.dmg, pierce: -1, hitCd: 0.5, life: w.evolved ? 1e9 : s.duration, weapon: w, knock: s.knock,
        sprite: { kind: 'dagger', color: '#c4b5fd', len: 30 * s.area, wid: 6 * s.area }, orbit: { angle: (i / s.amount) * U.TAU, radius: 95 * s.area, speed: 3.2 * s.speed },
        onHit: w.evolved ? (g2: Game, pr: Projectile, e: Enemy) => { if (rand() < 0.25) g2.spawnProj({ x: e.x, y: e.y, angle: rand() * U.TAU, speed: 300, r: 4, dmg: pr.dmg * 0.3, pierce: 1, life: 0.4, weapon: w, sprite: { kind: 'orb', color: '#e9d5ff', size: 3 }, noOnHit: true }); } : null,
      }));
    }
    g.sfx('summon');
  },
});

registerWeapon({
  id: 'thunder_strike', name: 'Thunder Strike', icon: { g: 'bolt', c: '#fde047' }, tags: ['lightning'],
  desc: 'Lightning falls on random enemies near you.',
  base: { dmg: 24, cd: 2.2, amount: 1, area: 1 },
  levels: [{ amount: 1 }, { dmg: 10 }, { area: 0.2 }, { amount: 1 }, { dmg: 14, cd: -0.15 }, { area: 0.2 }, { amount: 2, dmg: 18 }],
  evo: { with: 'clover', name: 'Wrath of Heaven', icon: { g: 'lightningball', c: '#fde047' }, desc: 'Twice as many bolts, each arcing to nearby enemies.', stats: { amountMul: 2, dmgMul: 1.3 } },
  fire(g, w, s) {
    const p = g.player;
    for (let i = 0; i < s.amount; i++) {
      g.after(i * 0.12, () => {
        const e = g.randomEnemyNear(p.x, p.y, 520);
        if (!e) return;
        g.lightning(e.x, e.y, 46 * s.area, s.dmg, w, { chain: w.evolved ? 2 : 0 });
      });
    }
  },
});

registerWeapon({
  id: 'chain_whip', name: 'Chain Whip', icon: { g: 'whip', c: '#f59e0b' }, tags: ['physical'],
  desc: 'Lashes horizontally in front of you, then behind. Strikes many at once.',
  base: { dmg: 16, cd: 1.35, amount: 1, area: 1, knock: 1.2 },
  levels: [{ dmg: 8 }, { amount: 1 }, { area: 0.2 }, { dmg: 10 }, { cd: -0.15 }, { area: 0.2, dmg: 10 }, { amount: 1, dmg: 16 }],
  evo: { with: 'moss', name: 'Crimson Lash', icon: { g: 'whip', c: '#ef4444' }, desc: 'Each strike steals life and crits far more often. Much larger reach.', stats: { dmgMul: 1.5, areaMul: 1.5, crit: 0.25 } },
  fire(g, w, s) {
    const p = g.player;
    w.side = (w.side || 0) + 1;
    const dir = p.face.x >= 0 ? 1 : -1;
    for (let i = 0; i < s.amount; i++) {
      const sd = i % 2 === 0 ? dir : -dir;
      g.after(i * 0.12, () => {
        const len = 190 * s.area, hgt = 60 * s.area;
        const cx = p.x + sd * len / 2, cy = p.y - 10;
        let hits = 0;
        g.eachEnemyIn(cx, cy, Math.max(len, hgt) / 2 + 20, (e) => {
          if (Math.abs(e.x - cx) < len / 2 + e.r && Math.abs(e.y - cy) < hgt / 2 + e.r) {
            g.damageEnemy(e, s.dmg, { weapon: w, kx: sd, ky: 0, knock: s.knock, crit: s.crit });
            hits++;
          }
        });
        if (w.evolved && hits) g.heal(Math.min(hits, 8) * 1, true);
        g.fx.whip(p.x, cy, sd, len, hgt, w.evolved ? '#ef4444' : '#f59e0b');
        g.sfx('slash');
      });
    }
  },
});

registerWeapon({
  id: 'fireball', name: 'Fireball', icon: { g: 'flame', c: '#ff7043' }, tags: ['fire'],
  desc: 'Hurls an exploding fireball at the nearest enemy. Burns.',
  base: { dmg: 20, cd: 1.8, amount: 1, speed: 380, pierce: 0, area: 1, burn: 0.4, duration: 2.5 },
  levels: [{ area: 0.2 }, { dmg: 10 }, { amount: 1 }, { burn: 0.3 }, { dmg: 14, area: 0.2 }, { cd: -0.15 }, { amount: 1, dmg: 20 }],
  evo: { with: 'crystal', name: 'Meteor Storm', icon: { g: 'meteor', c: '#ff7043' }, desc: 'Meteors crash from the sky onto random enemies with devastating explosions.', stats: { dmgMul: 1.6, areaMul: 1.5, amount: 1 } },
  fire(g, w, s) {
    const p = g.player;
    for (let i = 0; i < s.amount; i++) {
      g.after(i * 0.15, () => {
        if (w.evolved) {
          const e = g.randomEnemyNear(p.x, p.y, 480);
          const tx = e ? e.x : p.x + U.rand(-200, 200), ty = e ? e.y : p.y + U.rand(-200, 200);
          g.meteor(tx, ty, 0.8, () => g.explode(tx, ty, 95 * s.area, s.dmg, w, { burn: s.burn, burnDur: 3, color: '#ff7043' }));
        } else {
          const a = H.aim(g, p, 480) + (i - (s.amount - 1) / 2) * 0.25;
          g.spawnProj({
            x: p.x, y: p.y, angle: a, speed: s.speed, r: 9, dmg: s.dmg, pierce: 0, life: s.duration, weapon: w,
            sprite: { kind: 'orb', color: '#ff7043', size: 8 }, trail: '#ff7043', light: 60,
            onHit: (g2: Game, pr: Projectile, e: Enemy) => g2.explode(pr.x, pr.y, 62 * s.area, s.dmg, w, { burn: s.burn, burnDur: 3, color: '#ff7043', exclude: e }),
            onExpire: (g2: Game, pr: Projectile) => g2.explode(pr.x, pr.y, 62 * s.area, s.dmg, w, { burn: s.burn, burnDur: 3, color: '#ff7043' }),
          });
        }
      });
    }
    g.sfx('fire');
  },
});

registerWeapon({
  id: 'frost_nova', name: 'Frost Nova', icon: { g: 'snowflake', c: '#bae6fd' }, tags: ['ice'],
  desc: 'A ring of frost bursts from you, chilling everything it touches.',
  base: { dmg: 14, cd: 2.4, amount: 1, area: 1, slow: 0.35, duration: 2 },
  levels: [{ area: 0.2 }, { dmg: 8 }, { slow: 0.1 }, { area: 0.2, dmg: 8 }, { cd: -0.15 }, { duration: 0.6 }, { amount: 1, dmg: 14 }],
  evo: { with: 'clockwork', name: 'Glacial Cataclysm', icon: { g: 'shard', c: '#bae6fd' }, desc: 'The nova freezes solid. Frozen enemies shatter, damaging their neighbours.', stats: { dmgMul: 1.4, areaMul: 1.3, freeze: true } },
  fire(g, w, s) {
    const p = g.player;
    for (let i = 0; i < s.amount; i++) {
      g.after(i * 0.35, () => g.nova(p.x, p.y, 160 * s.area, s.dmg, w, { color: '#bae6fd', speed: 520, status: w.evolved ? { type: 'freeze', dur: s.duration * 0.7 } : { type: 'chill', dur: s.duration, power: s.slow }, shatter: w.evolved }));
    }
    g.sfx('freeze');
  },
});

registerWeapon({
  id: 'prism_shard', name: 'Prism Shard', icon: { g: 'shard', c: '#f0abfc' }, tags: ['magic'],
  desc: 'Shards of light bounce off the edges of your vision, piercing endlessly.',
  base: { dmg: 11, cd: 2.4, amount: 1, speed: 380, area: 1, duration: 3.2 },
  levels: [{ amount: 1 }, { dmg: 5, speed: 0.15 }, { duration: 0.6 }, { amount: 1 }, { dmg: 8 }, { duration: 0.6, speed: 0.15 }, { amount: 1, dmg: 12 }],
  evo: { with: 'mirror', name: 'Prismatic Storm', icon: { g: 'star', c: '#f0abfc' }, desc: 'Every bounce releases a burst of sparks. Shards last far longer.', stats: { dmgMul: 1.3, durationMul: 1.5, amount: 1 } },
  fire(g, w, s) {
    const p = g.player;
    for (let i = 0; i < s.amount; i++) {
      const a = rand() * U.TAU;
      g.spawnProj({
        x: p.x, y: p.y, angle: a, speed: s.speed, r: 9 * s.area, dmg: s.dmg, pierce: -1, hitCd: 0.4, life: s.duration, weapon: w, bounce: true, spin: 6,
        sprite: { kind: 'shard', color: '#f0abfc', len: 26 * s.area, wid: 7 * s.area }, trail: '#f0abfc',
        onBounce: w.evolved ? (g2: Game, pr: Projectile) => { for (let k = 0; k < 4; k++) g2.spawnProj({ x: pr.x, y: pr.y, angle: rand() * U.TAU, speed: 320, r: 4, dmg: s.dmg * 0.35, pierce: 1, life: 0.5, weapon: w, sprite: { kind: 'orb', color: '#fbcfe8', size: 3 } }); } : null,
      });
    }
    g.sfx('shoot');
  },
});

registerWeapon({
  id: 'sunbeam', name: 'Sunbeam', icon: { g: 'beam', c: '#fbbf24' }, tags: ['holy', 'fire'],
  desc: 'A searing beam sweeps around you, scorching everything in its path.',
  base: { dmg: 8, cd: 0, amount: 1, area: 1, speed: 1, tick: 0.2 },
  levels: [{ area: 0.2 }, { dmg: 4 }, { speed: 0.3 }, { dmg: 5, area: 0.2 }, { tick: -0.05 }, { area: 0.25 }, { amount: 1, dmg: 8 }],
  evo: { with: 'edge', name: 'Solar Lance', icon: { g: 'laser', c: '#fbbf24' }, desc: 'Two beams, twice as long, that ignite everything they touch.', stats: { amount: 1, areaMul: 1.7, dmgMul: 1.4 } },
  continuous: true,
  update(g, w, s, dt) {
    const p = g.player;
    w.angle = (w.angle || 0) + dt * 1.4 * s.speed;
    w.tick = (w.tick || 0) - dt;
    w.len = 230 * s.area;
    w.beams = s.amount;
    if (w.tick <= 0) {
      w.tick = s.tick;
      for (let b = 0; b < s.amount; b++) {
        const a = w.angle + (b / s.amount) * U.TAU;
        const dx = Math.cos(a), dy = Math.sin(a);
        g.eachEnemyIn(p.x + dx * w.len / 2, p.y + dy * w.len / 2, w.len / 2 + 30, (e) => {
          const ex = e.x - p.x, ey = e.y - p.y;
          const t = U.clamp(ex * dx + ey * dy, 0, w.len);
          const px = dx * t, py = dy * t;
          if ((ex - px) * (ex - px) + (ey - py) * (ey - py) < (e.r + 10) * (e.r + 10)) {
            g.damageEnemy(e, s.dmg, { weapon: w, quiet: true, kx: dx, ky: dy, knock: 0.2 });
            if (w.evolved) g.applyStatus(e, 'burn', { dur: 2, dps: s.dmg * 0.8 });
          }
        });
      }
    }
  },
});

registerWeapon({
  id: 'spirit_mines', name: 'Spirit Mines', icon: { g: 'mine', c: '#22d3ee' }, tags: ['magic'],
  desc: 'Drops spectral mines in your wake that detonate when enemies draw near.',
  base: { dmg: 30, cd: 1.5, amount: 1, area: 1, duration: 12 },
  levels: [{ dmg: 12 }, { area: 0.2 }, { amount: 1 }, { dmg: 15 }, { cd: -0.15 }, { area: 0.25 }, { amount: 1, dmg: 24 }],
  evo: { with: 'magnet', name: 'Cluster Charges', icon: { g: 'hex', c: '#22d3ee' }, desc: 'Each detonation scatters four more charges.', stats: { dmgMul: 1.4, areaMul: 1.2, amount: 1 } },
  fire(g, w, s) {
    const p = g.player;
    for (let i = 0; i < s.amount; i++) {
      const a = rand() * U.TAU, d = i === 0 ? 0 : U.rand(20, 60);
      g.spawnMine({ x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d, r: 78 * s.area, dmg: s.dmg, life: s.duration, weapon: w, color: '#22d3ee', cluster: w.evolved ? 4 : 0 });
    }
  },
});

/* ---- weapons added with the resonance system: they fill out the thinner elements ---- */

registerWeapon({
  id: 'ball_lightning', name: 'Ball Lightning', icon: { g: 'lightningball', c: '#7dd3fc' }, tags: ['lightning', 'magic'],
  desc: 'A slow, crackling sphere drifts toward the horde, zapping everything around it.',
  base: { dmg: 9, cd: 2.8, amount: 1, speed: 110, area: 1, duration: 4 },
  levels: [{ dmg: 4 }, { area: 0.2 }, { amount: 1 }, { duration: 1 }, { dmg: 6 }, { area: 0.2, cd: -0.12 }, { amount: 1, dmg: 8 }],
  evo: { with: 'boots', name: 'Storm Sphere', icon: { g: 'lightningball', c: '#e0f2fe' }, desc: 'Spheres swell, zap twice as often and ricochet off the edges of the world.', stats: { dmgMul: 1.4, areaMul: 1.35, durationMul: 1.4 } },
  fire(g, w, s) {
    const p = g.player;
    for (let i = 0; i < s.amount; i++) {
      const a = H.aim(g, p, 520) + (i - (s.amount - 1) / 2) * 0.6;
      g.after(i * 0.2, () => g.spawnProj({
        x: p.x, y: p.y, angle: a, speed: s.speed, r: 14 * s.area, dmg: s.dmg * 0.5, pierce: -1, hitCd: 0.5, life: s.duration, weapon: w, knock: 0.2,
        sprite: { kind: 'orb', color: '#7dd3fc', size: 10 * s.area }, light: 110, trail: '#bae6fd', bounce: !!w.evolved,
        zap: { r: 130 * s.area, cd: w.evolved ? 0.22 : 0.45, dmg: s.dmg },
      }));
    }
    g.sfx('zap');
  },
});

registerWeapon({
  id: 'frost_lance', name: 'Frost Lance', icon: { g: 'shard', c: '#bae6fd' }, tags: ['ice', 'physical'],
  desc: 'Hurls lances of ice that pierce through a line of enemies and chill them.',
  base: { dmg: 16, cd: 1.5, amount: 1, speed: 560, pierce: 2, area: 1, slow: 0.3, duration: 2 },
  levels: [{ dmg: 7 }, { pierce: 1 }, { amount: 1 }, { slow: 0.1, dmg: 6 }, { cd: -0.12 }, { pierce: 2, area: 0.2 }, { amount: 1, dmg: 14 }],
  evo: { with: 'power', name: 'Glacial Impaler', icon: { g: 'snowflake', c: '#e0f2fe' }, desc: 'Lances freeze what they pierce and burst into a halo of ice shards when they melt.', stats: { dmgMul: 1.5, pierce: 3 } },
  fire(g, w, s) {
    const p = g.player;
    const tg = H.targets(g, p, s.amount, 600);
    for (let i = 0; i < s.amount; i++) {
      const t = tg[i % Math.max(1, tg.length)];
      const a = (t ? Math.atan2(t.y - p.y, t.x - p.x) : H.facing(p)) + (tg.length > i ? 0 : (i - (s.amount - 1) / 2) * 0.2);
      g.after(i * 0.09, () => g.spawnProj({
        x: p.x, y: p.y, angle: a, speed: s.speed, r: 8 * s.area, dmg: s.dmg, pierce: s.pierce, life: 1.4, weapon: w, knock: 0.5,
        sprite: { kind: 'shard', color: '#bae6fd', len: 34 * s.area, wid: 6 * s.area }, trail: '#e0f2fe',
        statuses: [w.evolved ? { type: 'chill', dur: s.duration, power: s.slow, stackFreeze: 2 } : { type: 'chill', dur: s.duration, power: s.slow }],
        onExpire: w.evolved ? (g2: Game, pr: Projectile) => { for (let k = 0; k < 6; k++) g2.spawnProj({ x: pr.x, y: pr.y, angle: (k / 6) * U.TAU, speed: 320, r: 5, dmg: s.dmg * 0.4, pierce: 1, life: 0.45, weapon: w, sprite: { kind: 'shard', color: '#e0f2fe', len: 14, wid: 3 }, statuses: [{ type: 'chill', dur: 1.5, power: s.slow }] }); } : null,
      }));
    }
    g.sfx('freeze');
  },
});

registerWeapon({
  id: 'reaper_crescent', name: "Reaper's Crescent", icon: { g: 'scythe', c: '#c084fc' }, tags: ['shadow', 'physical'],
  desc: 'A spectral scythe spirals out around you and returns, reaping what it passes.',
  base: { dmg: 22, cd: 2.2, amount: 1, speed: 360, pierce: -1, area: 1, duration: 0.9, knock: 0.8, crit: 0.1 },
  levels: [{ dmg: 9 }, { area: 0.2 }, { crit: 0.08 }, { amount: 1 }, { dmg: 12, cd: -0.1 }, { area: 0.25 }, { amount: 1, dmg: 18 }],
  evo: { with: 'fang', name: 'Harvest Moon', icon: { g: 'moon', c: '#e9d5ff' }, desc: 'Twin crescent moons that drink the life of everything they cut.', stats: { dmgMul: 1.4, areaMul: 1.3, amount: 1, crit: 0.1 } },
  fire(g, w, s) {
    const p = g.player;
    const base = H.aim(g, p, 420);
    for (let i = 0; i < s.amount; i++) {
      const a = base + (i / s.amount) * U.TAU;
      g.after(i * 0.12, () => g.spawnProj({
        x: p.x, y: p.y, angle: a, speed: s.speed, r: 20 * s.area, dmg: s.dmg, pierce: -1, hitCd: 0.5, life: s.duration * 2 + 0.7, weapon: w, crit: s.crit, knock: s.knock,
        sprite: { kind: 'axe', color: w.evolved ? '#e9d5ff' : '#c084fc', len: 40 * s.area, wid: 8 * s.area }, spin: -12, trail: '#a855f7', boomerang: { t: s.duration, spiral: true }, light: 70,
        onHit: w.evolved ? (g2: Game) => g2.heal(0.6, true, true) : null,
      }));
    }
    g.sfx('slash');
  },
});

registerWeapon({
  id: 'venom_spores', name: 'Venom Spores', icon: { g: 'leaf', c: '#a3e635' }, tags: ['poison'],
  desc: 'Lobs swollen spore pods that burst into lingering clouds of poison.',
  base: { dmg: 5, cd: 2.4, amount: 1, area: 1, duration: 4, tick: 0.4 },
  levels: [{ amount: 1 }, { dmg: 2 }, { area: 0.2 }, { duration: 1 }, { dmg: 3, amount: 1 }, { tick: -0.08 }, { dmg: 5, area: 0.25 }],
  evo: { with: 'skull', name: 'Blight Bloom', icon: { g: 'clover', c: '#84cc16' }, desc: 'The clouds come alive: they creep after the nearest enemy and never stop spreading.', stats: { dmgMul: 1.5, areaMul: 1.3, durationMul: 1.5 } },
  fire(g, w, s) {
    const p = g.player;
    for (let i = 0; i < s.amount; i++) {
      const e = g.randomEnemyNear(p.x, p.y, 420);
      const tx = e ? e.x : p.x + U.rand(-200, 200), ty = e ? e.y : p.y + U.rand(-200, 200);
      g.after(i * 0.18, () => g.lob(p.x, p.y, tx, ty, 0.5, '#a3e635', () => {
        g.spawnZone({ x: tx, y: ty, r: 58 * s.area, dur: s.duration, dmg: s.dmg, tick: s.tick, weapon: w, color: '#a3e635', kind: 'poison', follow: w.evolved ? 'nearest' : undefined, followSpeed: 70 });
        g.fx.burst(tx, ty, '#a3e635', 10, { speed: 90, life: 0.5 });
      }));
    }
  },
});

registerWeapon({
  id: 'radiant_judgment', name: 'Radiant Judgment', icon: { g: 'sun', c: '#fde68a' }, tags: ['holy', 'lightning'],
  desc: 'Marks enemies with a sigil of light, then smites them with a pillar from the dead sun.',
  base: { dmg: 30, cd: 2.6, amount: 2, area: 1 },
  levels: [{ dmg: 10 }, { amount: 1 }, { area: 0.2 }, { dmg: 14 }, { amount: 1, cd: -0.1 }, { area: 0.2, dmg: 12 }, { amount: 2 }],
  evo: { with: 'idol', name: 'Final Judgment', icon: { g: 'halo', c: '#fff7d6' }, desc: 'Each pillar sears a cross of light and mends your wounds.', stats: { dmgMul: 1.5, areaMul: 1.3, amount: 2 } },
  fire(g, w, s) {
    const p = g.player;
    const tg = H.targets(g, p, s.amount * 3, 520);
    for (let i = 0; i < s.amount; i++) {
      const t = tg.length ? tg[Math.floor(rand() * tg.length)]! : null;
      const x = t ? t.x : p.x + U.rand(-180, 180), y = t ? t.y : p.y + U.rand(-180, 180), r = 52 * s.area;
      g.fx.telegraphCircle(x, y, r, 0.45, '#fde68a');
      g.after(0.45 + i * 0.06, () => {
        g.lightning(x, y, r, s.dmg, w, { color: '#fde68a' });
        if (w.evolved) { g.lineDamage(x - r * 1.6, y, 0, r * 3.2, 18, s.dmg * 0.5, w, { color: '#fff7d6' }); g.lineDamage(x, y - r * 1.6, Math.PI / 2, r * 3.2, 18, s.dmg * 0.5, w, { color: '#fff7d6' }); g.heal(1, true, true); }
      });
    }
  },
});

registerWeapon({
  id: 'soul_lantern', name: 'Soul Lantern', icon: { g: 'ghost', c: '#86efac' }, tags: ['shadow', 'summon'],
  desc: 'Releases hungry shades that hunt down enemies and pass straight through them.',
  base: { dmg: 14, cd: 3, amount: 1, minions: 2, duration: 6 },
  levels: [{ minions: 1 }, { dmg: 6 }, { duration: 2 }, { minions: 1 }, { dmg: 8, cd: -0.15 }, { minions: 1 }, { dmg: 12, duration: 2 }],
  evo: { with: 'cloak', name: 'Lantern of the Lost', icon: { g: 'ghost', c: '#e9d5ff' }, desc: 'A legion of shades, and each one bursts in soulfire when its time runs out.', stats: { dmgMul: 1.4, minions: 3 } },
  fire(g, w, s) {
    const p = g.player;
    const max = s.minions + s.amount - 1, live = g.allies.filter((a) => a.weapon === w && !a.dead).length;
    const minionMul = 1 + p.stats.minionDmg;
    for (let i = 0; i < Math.min(2 + (w.evolved ? 1 : 0), max - live); i++) {
      const a = rand() * U.TAU;
      g.spawnAlly({ kind: 'wraith', x: p.x + Math.cos(a) * 24, y: p.y + Math.sin(a) * 24, color: w.evolved ? '#e9d5ff' : '#86efac', life: s.duration, speed: 230, dmg: s.dmg * minionMul, weapon: w, explode: w.evolved ? { r: 70, mult: 1.5 } : undefined });
    }
    g.sfx('summon');
  },
});

registerWeapon({
  id: 'cinder_rain', name: 'Cinder Rain', icon: { g: 'meteor', c: '#ff9a3c' }, tags: ['fire'],
  desc: 'Calls a squall of burning cinders down on the horde around you.',
  base: { dmg: 10, cd: 3, amount: 6, area: 1, burn: 0.5, duration: 1.2 },
  levels: [{ amount: 2 }, { dmg: 4 }, { burn: 0.3 }, { amount: 2 }, { dmg: 5, area: 0.2 }, { cd: -0.15 }, { amount: 4, dmg: 6 }],
  evo: { with: 'crown', name: 'Armageddon', icon: { g: 'meteor', c: '#ff3a1a' }, desc: 'The sky itself falls: true meteors, each one leaving a crater of fire.', stats: { dmgMul: 1.6, areaMul: 1.3 } },
  fire(g, w, s) {
    const p = g.player;
    const n = Math.round(s.amount * (w.evolved ? 0.5 : 1));
    for (let i = 0; i < n; i++) {
      const e = g.randomEnemyNear(p.x, p.y, 460);
      const tx = (e ? e.x : p.x) + U.rand(-60, 60), ty = (e ? e.y : p.y) + U.rand(-60, 60);
      g.after((i / n) * s.duration, () => {
        if (w.evolved) g.meteor(tx, ty, 0.7, () => { g.explode(tx, ty, 80 * s.area, s.dmg * 2, w, { burn: s.burn, burnDur: 3, color: '#ff7043' }); g.spawnZone({ x: tx, y: ty, r: 50 * s.area, dur: 2.5, dmg: s.dmg * 0.3, tick: 0.4, weapon: w, color: '#ff7a3c', kind: 'fire', burn: s.burn * 0.5 }); });
        else { g.fx.arrowFall(tx, ty, '#ff9a3c', 0.3); g.after(0.3, () => g.explode(tx, ty, 38 * s.area, s.dmg, w, { burn: s.burn, burnDur: 2.5, color: '#ff9a3c', small: true, quiet: true, knock: 0.3 })); }
      });
    }
    g.sfx('fire');
  },
});

/* Compute effective weapon stats for the player */
export const weaponStats = function (w: Weapon, p: Player): WeaponStats {
  const def = w.def;
  const s: WeaponStats = Object.assign({ dmg: 0, cd: 1, amount: 1, speed: 1, pierce: 0, area: 1, duration: 1, knock: 1, crit: 0, tick: 0.5, burn: 0, slow: 0, minions: 0, turrets: 0, rate: 1, chains: 0, pull: 1, heal: 0, range: 1 }, def.base) as WeaponStats;
  for (let i = 1; i < w.level; i++) {
    const d = def.levels[i - 1]; if (!d) continue;
    for (const k in d) {
      if (k === 'flag') continue;
      if (k === 'cd') s.cd *= 1 + (d[k] as number);
      // speed levels are relative ("+15%"), whether the base is a multiplier (1) or a velocity (380 px/s)
      else if (k === 'speed') s.speed += (d[k] as number) * (def.base.speed ?? 1);
      else s[k] += d[k] as number;
    }
  }
  if (w.evolved && def.evo && def.evo.stats) {
    const es = def.evo.stats;
    for (const k in es) {
      const v = es[k]!;
      if (k.endsWith('Mul')) { const b = k.slice(0, -3); s[b]! *= v as number; }
      else if (typeof v === 'number') s[k]! += v;
      else s[k] = v as unknown as number; // boolean switch (e.g. permanent, freeze), read by the weapon's fire()
    }
  }
  const st = p.stats;
  s.dmg *= st.might * (1 + (p.weaponMastery[def.id] || 0));
  if (p.char.signature === def.id) s.dmg *= 1 + (st.sigDmg || 0);
  s.cd *= st.cooldown;
  s.area *= st.area;
  s.speed *= st.projSpeed;
  s.duration *= st.duration;
  s.amount += st.amount;
  s.knock *= 1 + (st.knockback || 0);
  if (s.pierce >= 0) s.pierce += st.pierce || 0;
  if (def.tags && def.tags.includes('fire')) s.burn *= 1 + (st.burnDmg || 0);
  if (def.tags && def.tags.includes('ice')) s.slow *= 1 + (st.slowPower || 0);
  return s;
};
