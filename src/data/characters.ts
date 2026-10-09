/* SOULFORGE — characters: signature weapons, traits, actives, talent trees, codex chapters */
import { U } from '../core/util';
import { rand } from '../core/rng';
import type { Game } from '../game/game';
import type { Chapter, CharacterDef, Enemy, PlayerStats, Projectile, StatBag, TalentBranch, TalentNode, Vec2 } from '../game/types';
import { WEAPONS, WH, registerWeapon, weaponStats } from './weapons';

const H = WH, W = registerWeapon;

export const CHAR_BASE: PlayerStats = {
  maxHp: 100, regen: 0, armor: 0, speed: 165, might: 1, area: 1, projSpeed: 1, duration: 1, amount: 0, cooldown: 1, luck: 1, growth: 1, greed: 1, magnet: 80,
  revival: 0, crit: 0.05, critDmg: 1.5, dodge: 0, lifesteal: 0, curse: 1, rerolls: 0, skips: 0, banishes: 0, activeCd: 1, thorns: 0, healing: 1, eliteDmg: 0, burnDmg: 0,
  shieldPower: 1, minionDmg: 0, xpBonus: 0, matFind: 0, startLevel: 0, pierce: 0, knockback: 0, chestLuck: 0, slowPower: 0, execute: 0, sigDmg: 0, reactDmg: 0,
};

/* talent tree builders */
type NodeSpec = Omit<TalentNode, 'tier' | 'branch'>;
const node = (id: string, name: string, max: number, per: StatBag, desc: string): NodeSpec => ({ id, name, max, per, desc });
const key = (id: string, name: string, desc: string): NodeSpec => ({ id, name, max: 1, flag: id, desc, keystone: true });
const branch = (id: string, name: string, color: string, nodes: NodeSpec[]): TalentBranch => ({ id, name, color, nodes: nodes.map((n, i) => Object.assign(n, { tier: i, branch: id })) });
/* codex chapter requirement builders */
const CH = (title: string, lore: string, req: Chapter['req'], reward: Chapter['reward']): Chapter => ({ title, lore, req, reward });

/** Content-local extras not (yet) in the shared contract: `longHair` is read by the sprite baker. */
/** Ad-hoc damage-source markers checked by character hooks (Grom's thorns, Vesper's blood spray). */

const CHARS: CharacterDef[] = [];

/* =====================================================================
   1. KAEL — THE EMBER KNIGHT
   ===================================================================== */
W({
  id: 'flame_cleave', name: 'Flame Cleave', icon: { g: 'sword', c: '#ff7a3c' }, tags: ['fire', 'physical'], char: 'kael',
  desc: 'A burning arc in front of you. Everything it touches keeps burning.',
  base: { dmg: 24, cd: 1.35, amount: 1, area: 1, burn: 0.35, knock: 1.3, duration: 3 },
  levels: [{ dmg: 10 }, { area: 0.2 }, { burn: 0.25 }, { amount: 1, flag: 'Also swings behind you' }, { dmg: 14, area: 0.2 }, { cd: -0.15 }, { dmg: 20, burn: 0.3 }],
  evo: { with: 'power', name: 'Phoenix Edge', icon: { g: 'flame', c: '#ffb347' }, desc: 'A full 360° inferno sweep that leaves a ring of fire in its wake.', stats: { dmgMul: 1.5, areaMul: 1.3, burn: 0.5 } },
  mod(g, w, s, p) { if (p.f.twin_blades) { s.amount += 1; s.cd *= 0.85; } },
  fire(g, w, s) {
    const p = g.player;
    const base = H.aim(g, p, 150);
    for (let i = 0; i < s.amount; i++) {
      g.after(i * 0.16, () => {
        const a = base + i * Math.PI;
        const r = 118 * s.area;
        if (w.evolved) {
          g.arcSlash(p.x, p.y, a, r, Math.PI, s.dmg, w, { knock: s.knock, burn: s.burn, burnDur: s.duration, color: '#ffb347', crit: s.crit });
          g.spawnZone({ x: p.x, y: p.y, r: r * 0.9, dur: 1.6, dmg: s.dmg * 0.25, tick: 0.3, weapon: w, color: '#ff7a3c', kind: 'fire', burn: s.burn * 0.5 });
        } else {
          g.arcSlash(p.x, p.y, a, r, 1.25, s.dmg, w, { knock: s.knock, burn: s.burn, burnDur: s.duration, color: '#ff7a3c', crit: s.crit });
        }
        g.sfx('slash');
      });
    }
  },
});
CHARS.push({
  id: 'kael', name: 'Kael', title: 'The Ember Knight', unlock: { type: 'start' },
  colors: { primary: '#8a2a1a', secondary: '#c9a227', accent: '#ff7a3c', skin: '#e9c9a8', eye: '#ffd27a' }, head: 'helm', weaponArt: 'sword',
  lore: 'Once a paladin of the Dawn, Kael walked into the burning of his city and came out carrying the fire. It has not left him since.',
  stats: { maxHp: 135, armor: 2, speed: 155, might: 1.1 },
  signature: 'flame_cleave',
  trait: { name: 'Kindled Heart', desc: 'Gain +1% Might for every 2% health missing (up to +50%). Burning enemies take 15% more damage from all sources.' },
  active: { name: 'Inferno Dash', icon: { g: 'flame', c: '#ff7a3c' }, cd: 8, desc: 'Dash forward, invulnerable, leaving a trail of fire (damage scales with level).',
    use(g, p) {
      const [dx, dy] = U.norm(p.move.x || p.face.x, p.move.y || p.face.y);
      g.setInvuln(0.45);
      const dmg = (10 + p.level * 1.3) * p.stats.might;
      g.dash(dx, dy, 240, 0.28, { onStep: (x, y) => g.spawnZone({ x, y, r: 42, dur: 2.5, dmg, tick: 0.3, weapon: { def: WEAPONS.flame_cleave, id: 'flame_cleave', ability: true }, color: '#ff7a3c', kind: 'fire', burn: 0.4 }), stepDist: 34 });
      g.sfx('dash');
    } },
  hooks: {
    init(g, p) { p.f.kindled = true; },
    update(g, p) {
      const missing = 1 - p.hp / p.stats.maxHp;
      p.dyn.might = Math.min(0.5, missing * 0.5) + (p.f.sunforged ? 0.1 : 0);
      if (p.f.sunforged) { p.auraColor = '#ff7a3c'; }
    },
    onDamage(g, p, e, info) { if (e.st.burn) info.mult! *= 1.15; },
    onKill(g, p, e) {
      if (p.f.wildfire && e.st.burn) { const dps = e.st.burn.base; g.eachEnemyIn(e.x, e.y, 90, (o) => { if (o !== e) g.applyStatus(o, 'burn', { dur: 3, dps }); }); }
    },
    onHurt(g, p, dmg) {
      if (p.f.ashen_mantle && (p.cdAshen || 0) <= 0) { p.cdAshen = 3; g.nova(p.x, p.y, 130, (20 + p.level * 2) * p.stats.might, { def: WEAPONS.flame_cleave, id: 'flame_cleave', ability: true }, { color: '#ff7a3c', speed: 600, burn: 0.4 }); }
      return dmg;
    },
    onFatal(g, p) {
      if (p.f.unbroken && (p.cdUnbroken || 0) <= 0) { p.cdUnbroken = 90; g.setInvuln(3); p.hp = p.stats.maxHp * 0.3; g.fx.flash('#ff7a3c', 0.5); g.fx.text(p.x, p.y - 40, 'UNBROKEN', '#ff7a3c'); g.sfx('revive'); return true; }
      return false;
    },
  },
  talents: [
    branch('inferno', 'Inferno', '#ff7a3c', [
      node('k_burn', 'Searing Touch', 5, { burnDmg: 0.1 }, 'Burn damage +10% per rank.'),
      node('k_cleave', 'Warpath', 5, { sigDmg: 0.06 }, 'Flame Cleave damage +6% per rank.'),
      node('k_might', 'Emberheart', 5, { might: 0.03 }, 'Might +3% per rank.'),
      node('k_area', 'Wide Arc', 3, { area: 0.05 }, 'Area +5% per rank.'),
      key('wildfire', 'Wildfire', 'Burning enemies spread their fire to nearby enemies when they die.'),
    ]),
    branch('bulwark', 'Bulwark', '#c9a227', [
      node('k_hp', 'Iron Constitution', 5, { maxHp: 12 }, 'Max Health +12 per rank.'),
      node('k_armor', 'Plated Skin', 5, { armor: 0.6 }, 'Armor +0.6 per rank.'),
      node('k_regen', 'Smouldering', 5, { regen: 0.25 }, 'Regen +0.25/s per rank.'),
      node('k_heal', 'Warm Blood', 3, { healing: 0.1 }, 'Healing +10% per rank.'),
      key('unbroken', 'Unbroken', 'Once every 90 seconds, fatal damage instead leaves you at 30% HP and invulnerable for 3s.'),
    ]),
    branch('warlord', 'Warlord', '#ffd27a', [
      node('k_cd', 'Fury', 5, { cooldown: 0.03 }, 'Cooldown -3% per rank.'),
      node('k_crit', 'Executioner', 5, { crit: 0.03 }, 'Crit chance +3% per rank.'),
      node('k_knock', 'Shieldbash', 3, { knockback: 0.15 }, 'Knockback +15% per rank.'),
      node('k_elite', 'Giant Slayer', 3, { eliteDmg: 0.1 }, 'Damage to elites & bosses +10% per rank.'),
      key('twin_blades', 'Twin Blades', 'Flame Cleave gains an extra swing and swings 15% faster.'),
    ]),
  ],
  codex: [
    CH('The Ember Oath', 'He swore to guard the Dawn. The Dawn died. The oath did not.', { type: 'runs', v: 1 }, { stats: { might: 0.05 } }),
    CH('Ashen Mantle', 'The fire that took his home now answers to his pain.', { type: 'time', v: 600 }, { flag: 'ashen_mantle', desc: 'Awakening: taking damage releases a fire nova (3s cooldown).' }),
    CH('The Burning Road', 'A thousand corpses light the way. He walks it without looking back.', { type: 'kills', v: 5000 }, { stats: { maxHp: 20, armor: 1 } }),
    CH('Heart of the Phoenix', 'Death has tried to claim him twice. It will need to try harder.', { type: 'bosses', v: 5 }, { flag: 'dash_charges', desc: 'Awakening: Inferno Dash gains a second charge.' }),
    CH('Sunforged', 'Now he is the fire, and the night is very afraid.', { type: 'time', v: 1500 }, { flag: 'sunforged', stats: { might: 0.15, maxHp: 30 }, desc: 'Ascension: +15% Might, +30 HP, and a permanent +10% Might blazing aura.' }),
  ],
});

/* =====================================================================
   2. LYRA — THE STORMCALLER
   ===================================================================== */
W({
  id: 'chain_lightning', name: 'Chain Lightning', icon: { g: 'bolt', c: '#7dd3fc' }, tags: ['lightning'], char: 'lyra',
  desc: 'A bolt that leaps between enemies, losing a little power with every jump.',
  base: { dmg: 17, cd: 1.1, amount: 1, chains: 3, range: 1, area: 1 },
  levels: [{ chains: 1 }, { dmg: 7 }, { amount: 1 }, { chains: 2 }, { dmg: 10, cd: -0.12 }, { chains: 2 }, { amount: 1, dmg: 14 }],
  evo: { with: 'clockwork', name: 'Storm Lord', icon: { g: 'lightningball', c: '#7dd3fc' }, desc: 'Chains almost endlessly and every hit may call down an extra strike.', stats: { chains: 8, dmgMul: 1.35 } },
  fire(g, w, s) {
    const p = g.player;
    const tg = H.targets(g, p, s.amount, 360 * s.range);
    if (!tg.length) return;
    tg.forEach((t, i) => g.after(i * 0.08, () => g.chainLightning(p.x, p.y, t, s.chains, s.dmg, w, { decay: 0.88, range: 180 * s.range * s.area, extra: w.evolved ? 0.2 : 0 })));
    g.sfx('zap');
  },
});
CHARS.push({
  id: 'lyra', name: 'Lyra', title: 'The Stormcaller', unlock: { type: 'start' },
  colors: { primary: '#1e3a8a', secondary: '#38bdf8', accent: '#7dd3fc', skin: '#f1d9c4', hair: '#e0f2fe', eye: '#bae6fd' }, head: 'hair', longHair: true, weaponArt: 'staff',
  lore: 'The sky spoke to her when she was a child on the cliffs. It has never stopped, and now she answers back.',
  stats: { maxHp: 85, speed: 170, cooldown: 0.92, area: 1.05 },
  signature: 'chain_lightning',
  resource: { name: 'Static', color: '#7dd3fc', max: 1 },
  trait: { name: 'Static Charge', desc: 'Moving builds Static. At full charge you release a Thunderclap nova. Lightning damage has +10% crit chance.' },
  active: { name: 'Thunderstorm', icon: { g: 'bolt', c: '#7dd3fc' }, cd: 14, desc: 'For 5 seconds, lightning hammers random enemies around you three times a second.',
    use(g, p) {
      const dur = p.f.skyfall ? 7.5 : 5, rate = p.f.skyfall ? 0.16 : 0.33;
      p.stormT = dur; p.stormRate = rate; p.stormTick = 0;
      g.sfx('thunder');
    } },
  hooks: {
    init(g, p) { p.res = 0; p.resMax = 1; },
    update(g, p, dt) {
      const thr = p.f.overcharge ? 450 : 900;
      p.res += p.movedDist / thr; p.movedDist = 0;
      if (p.res >= 1) {
        p.res = 0;
        const dmg = (18 + p.level * 2.2) * p.stats.might;
        const w = { def: WEAPONS.chain_lightning, id: 'chain_lightning', ability: true };
        g.nova(p.x, p.y, 175 * p.stats.area, dmg, w, { color: '#7dd3fc', speed: 700, onHit: p.f.overcharge ? (e) => g.chainLightning(e.x, e.y, e, 2, dmg * 0.5, w, { decay: 0.8, range: 150, skipFirst: true }) : undefined });
        g.sfx('thunder');
      }
      if (p.stormT > 0) {
        p.stormT -= dt; p.stormTick -= dt;
        if (p.stormTick <= 0) {
          p.stormTick = p.stormRate;
          const e = g.randomEnemyNear(p.x, p.y, 420);
          if (e) g.lightning(e.x, e.y, 52, (20 + p.level * 3) * p.stats.might, { def: WEAPONS.chain_lightning, id: 'chain_lightning', ability: true }, {});
        }
        if (p.f.eye_storm) { p.dyn.speed = 0.5; p.dyn.dmgTaken = 0.7; }
      } else { p.dyn.speed = 0; p.dyn.dmgTaken = 1; }
      if (p.f.ball_lightning) { /* handled in onCast */ }
      if (p.f.stormborn) p.auraColor = '#7dd3fc';
    },
    onDamage(g, p, e, info) { if (info.weapon && info.weapon.def && info.weapon.def.tags && info.weapon.def.tags.includes('lightning')) info.critBonus! += 0.1; },
    onCast(g, p, w) {
      if (p.f.ball_lightning && w.id === 'chain_lightning') {
        p.castN = (p.castN || 0) + 1;
        if (p.castN % 3 === 0) {
          const a = H.aim(g, p, 400);
          g.spawnProj({ x: p.x, y: p.y, angle: a, speed: 90, r: 14, dmg: 0, pierce: -1, hitCd: 9, life: 4, weapon: w, sprite: { kind: 'orb', color: '#7dd3fc', size: 12 }, light: 90, zap: { cd: 0.35, r: 95, dmg: (12 + p.level * 1.5) * p.stats.might } });
        }
      }
    },
    onHurt(g, p, dmg, src) {
      if (p.f.tempest_veil && (p.cdVeil || 0) <= 0) { p.cdVeil = 1.5; const w = { def: WEAPONS.chain_lightning, id: 'chain_lightning', ability: true }; const t = src && (src as Enemy).st ? (src as Enemy) : g.nearestEnemy(p.x, p.y, 160); if (t) g.chainLightning(p.x, p.y, t, 3, (40 + p.level * 4) * p.stats.might, w, { decay: 0.8, range: 150 }); }
      return dmg;
    },
  },
  talents: [
    branch('tempest', 'Tempest', '#7dd3fc', [
      node('l_dmg', 'High Voltage', 5, { sigDmg: 0.06 }, 'Chain Lightning damage +6% per rank.'),
      node('l_cd', 'Quickening', 5, { cooldown: 0.03 }, 'Cooldown -3% per rank.'),
      node('l_area', 'Long Arc', 5, { area: 0.04 }, 'Area (and chain range) +4% per rank.'),
      node('l_crit', 'Fulminate', 3, { critDmg: 0.1 }, 'Crit damage +10% per rank.'),
      key('overcharge', 'Overcharge', 'Static charges twice as fast and Thunderclap chains to nearby enemies.'),
    ]),
    branch('skyward', 'Skyward', '#bae6fd', [
      node('l_speed', 'Wind at her Back', 5, { speed: 0.03 }, 'Move speed +3% per rank.'),
      node('l_dodge', 'Flicker', 5, { dodge: 0.02 }, 'Dodge +2% per rank.'),
      node('l_active', 'Storm Focus', 5, { activeCd: 0.05 }, 'Ability cooldown -5% per rank.'),
      node('l_hp', 'Weathered', 3, { maxHp: 12 }, 'Max Health +12 per rank.'),
      key('eye_storm', 'Eye of the Storm', 'During Thunderstorm you move 50% faster and take 30% less damage.'),
    ]),
    branch('arcane', 'Arcane', '#c4b5fd', [
      node('l_might', 'Conduit', 5, { might: 0.03 }, 'Might +3% per rank.'),
      node('l_luck', 'Fortune Bolt', 5, { luck: 0.05 }, 'Luck +5% per rank.'),
      node('l_growth', 'Insight', 5, { growth: 0.04 }, 'Growth +4% per rank.'),
      node('l_amount', 'Fork', 1, { amount: 1 }, '+1 Amount.'),
      key('ball_lightning', 'Ball Lightning', 'Every third Chain Lightning cast releases a slow orb that zaps everything near it.'),
    ]),
  ],
  codex: [
    CH('The Cliffs', 'She was nine when the lightning first struck her. She was not hurt. She was chosen.', { type: 'runs', v: 1 }, { stats: { cooldown: 0.04 } }),
    CH('Tempest Veil', 'The sky wraps around her like a cloak, and it bites.', { type: 'time', v: 600 }, { flag: 'tempest_veil', desc: 'Awakening: taking damage strikes the attacker with chain lightning (1.5s cooldown).' }),
    CH('Thunderheart', 'Every storm she calls leaves her a little less human, a little more weather.', { type: 'kills', v: 5000 }, { stats: { might: 0.08, area: 0.05 } }),
    CH('Skyfall', 'She no longer asks the sky. She commands it.', { type: 'bosses', v: 5 }, { flag: 'skyfall', desc: 'Awakening: Thunderstorm lasts 50% longer and strikes twice as fast.' }),
    CH('Stormborn', 'The Stormcaller is gone. Only the Storm remains.', { type: 'time', v: 1500 }, { flag: 'stormborn', stats: { might: 0.15, cooldown: 0.06 }, desc: 'Ascension: +15% Might, -6% cooldown, and a crackling storm aura.' }),
  ],
});

/* =====================================================================
   3. TALON — THE BEAST HUNTER
   ===================================================================== */
W({
  id: 'hunters_volley', name: "Hunter's Volley", icon: { g: 'arrow', c: '#a3e635' }, tags: ['physical'], char: 'talon',
  desc: 'Fires piercing arrows at the nearest enemy.',
  base: { dmg: 14, cd: 1.0, amount: 2, speed: 540, pierce: 2, duration: 1.6, area: 1, crit: 0.05 },
  levels: [{ dmg: 6 }, { amount: 1 }, { pierce: 1 }, { dmg: 8, cd: -0.1 }, { amount: 1 }, { pierce: 2, dmg: 8 }, { amount: 1, dmg: 14 }],
  evo: { with: 'velocity', name: 'Storm of Arrows', icon: { g: 'arrow', c: '#fde047' }, desc: 'Arrows split into three on their first hit.', stats: { dmgMul: 1.35, amount: 1 } },
  mod(g, w, s, p) { if (p.f.ricochet) s.ricochet = 1; },
  fire(g, w, s) {
    const p = g.player;
    const base = H.aim(g, p, 640);
    const angs = H.spread(s.amount, base, 0.12 * (s.amount - 1));
    angs.forEach((a) => g.spawnProj({
      x: p.x, y: p.y, angle: a, speed: s.speed, r: 6, dmg: s.dmg, pierce: s.pierce, life: s.duration, weapon: w, crit: s.crit, ricochet: s.ricochet || 0,
      sprite: { kind: 'arrow', color: '#a3e635', len: 26, wid: 4 }, trail: null,
      onHit: w.evolved ? (g2: Game, pr: Projectile) => { if (pr.split) return; pr.split = true; for (let k = -1; k <= 1; k += 2) g2.spawnProj({ x: pr.x, y: pr.y, angle: pr.angle + k * 0.45, speed: s.speed, r: 5, dmg: s.dmg * 0.5, pierce: 1, life: 0.6, weapon: w, sprite: { kind: 'arrow', color: '#fde047', len: 20, wid: 3 }, noOnHit: true }); } : null,
    }));
    g.sfx('shoot');
  },
});
CHARS.push({
  id: 'talon', name: 'Talon', title: 'The Beast Hunter', unlock: { type: 'start' },
  colors: { primary: '#365314', secondary: '#78350f', accent: '#a3e635', skin: '#d9b48f', hair: '#3f2a14', eye: '#d9f99d' }, head: 'hood', weaponArt: 'bow',
  lore: 'He hunted the things that hunted villages. Then the night came and every village became a hunting ground.',
  stats: { maxHp: 100, speed: 175, projSpeed: 1.2, luck: 1.1, crit: 0.1 },
  signature: 'hunters_volley',
  trait: { name: 'Apex Predator', desc: 'A hawk companion dives at enemies. Every 5s you Mark the strongest enemy nearby: marked enemies take +40% damage.' },
  active: { name: 'Arrow Rain', icon: { g: 'arrow', c: '#fde047' }, cd: 10, desc: 'A volley of 40 arrows rains on the nearest cluster of enemies.',
    use(g, p) {
      const e = g.randomEnemyNear(p.x, p.y, 380);
      const tx = e ? e.x : p.x + p.face.x * 200, ty = e ? e.y : p.y + p.face.y * 200;
      const dmg = (12 + p.level * 2) * p.stats.might;
      g.rain(tx, ty, 170 * p.stats.area, 40, 1.3, dmg, { def: WEAPONS.hunters_volley, id: 'hunters_volley', ability: true }, '#fde047');
      g.sfx('shoot');
    } },
  hooks: {
    init(g, p) { p.markT = 0; },
    update(g, p, dt) {
      const want = 1 + (p.f.pack_leader ? 1 : 0);
      const hawks = g.alliesOf('hawk');
      if (hawks.length < want) g.spawnAlly({ kind: 'hawk', x: p.x, y: p.y, dmg: () => (8 + p.level * 1.6) * p.stats.might * (1 + p.stats.minionDmg), life: 1e9, sprite: 'hawk', color: '#a3e635', bleed: !!p.f.eagle_eye });
      p.markT -= dt;
      if (p.markT <= 0) {
        p.markT = 5;
        let best = null as Enemy | null; g.eachEnemyIn(p.x, p.y, 420, (e) => { if (!e.object && (!best || e.maxHp > best.maxHp)) best = e; });
        if (best) { best.st.hunted = true; g.fx.text(best.x, best.y - best.r - 10, 'MARKED', '#fde047'); }
      }
      if (p.f.alpha) p.auraColor = '#a3e635';
    },
    onDamage(g, p, e, info) { if (e.st.hunted) { info.mult! *= 1.4; if (p.f.deadeye) info.critBonus! += 1; } },
    onKill(g, p, e) {
      if (p.f.wild_hunt && e.st.hunted) { for (let i = 0; i < 8; i++) g.spawnProj({ x: e.x, y: e.y, angle: i * U.TAU / 8, speed: 500, r: 5, dmg: (14 + p.level * 2) * p.stats.might, pierce: 2, life: 0.8, weapon: { def: WEAPONS.hunters_volley, id: 'hunters_volley', ability: true }, sprite: { kind: 'arrow', color: '#fde047', len: 22, wid: 3 } }); }
    },
  },
  talents: [
    branch('marksman', 'Marksman', '#a3e635', [
      node('t_dmg', 'Steady Hand', 5, { sigDmg: 0.06 }, "Hunter's Volley damage +6% per rank."),
      node('t_crit', 'Sharp Eye', 5, { crit: 0.03 }, 'Crit chance +3% per rank.'),
      node('t_pspeed', 'Heavy Draw', 5, { projSpeed: 0.05 }, 'Projectile speed +5% per rank.'),
      node('t_pierce', 'Bodkin Points', 2, { pierce: 1 }, '+1 Pierce to all projectiles per rank.'),
      key('ricochet', 'Ricochet', 'When an arrow runs out of pierce it bounces to another enemy.'),
    ]),
    branch('wild', 'Wild', '#4ade80', [
      node('t_minion', 'Bond', 5, { minionDmg: 0.1 }, 'Companion damage +10% per rank.'),
      node('t_speed', 'Long Stride', 5, { speed: 0.03 }, 'Move speed +3% per rank.'),
      node('t_luck', "Hunter's Luck", 5, { luck: 0.05 }, 'Luck +5% per rank.'),
      node('t_magnet', 'Keen Senses', 3, { magnet: 0.15 }, 'Magnet +15% per rank.'),
      key('pack_leader', 'Pack Leader', 'A second hawk joins the hunt.'),
    ]),
    branch('predator', 'Predator', '#fde047', [
      node('t_elite', 'Big Game', 5, { eliteDmg: 0.08 }, 'Elite & boss damage +8% per rank.'),
      node('t_critdmg', 'Vital Strike', 5, { critDmg: 0.08 }, 'Crit damage +8% per rank.'),
      node('t_cd', 'Rapid Fire', 5, { cooldown: 0.03 }, 'Cooldown -3% per rank.'),
      node('t_hp', 'Thick Hide', 3, { maxHp: 15 }, 'Max Health +15 per rank.'),
      key('deadeye', 'Deadeye', 'Attacks against Marked enemies always crit.'),
    ]),
  ],
  codex: [
    CH('First Blood', 'The first wolf he killed was bigger than he was. He was seven.', { type: 'runs', v: 1 }, { stats: { crit: 0.04 } }),
    CH('The Wild Hunt', 'His prey learned to fear the arrows that come after the arrows.', { type: 'time', v: 600 }, { flag: 'wild_hunt', desc: 'Awakening: killing a Marked enemy releases 8 arrows in every direction.' }),
    CH('Trophies', 'He stopped counting at a thousand. The hawk did not.', { type: 'kills', v: 5000 }, { stats: { might: 0.06, luck: 0.1 } }),
    CH('Eagle Eye', 'He sees the seam in every hide, the gap in every shell.', { type: 'bosses', v: 5 }, { flag: 'eagle_eye', stats: { critDmg: 0.3 }, desc: 'Awakening: +30% crit damage and the hawk makes enemies bleed.' }),
    CH('Alpha', 'The night has many predators. Only one of them is at the top.', { type: 'time', v: 1500 }, { flag: 'alpha', stats: { might: 0.12, minionDmg: 0.3, speed: 0.05 }, desc: 'Ascension: +12% Might, +30% companion damage, +5% speed and a feral aura.' }),
  ],
});

/* =====================================================================
   4. SERAPHINE — THE DAWN ORACLE
   ===================================================================== */
W({
  id: 'sacred_halo', name: 'Sacred Halo', icon: { g: 'ring', c: '#fde68a' }, tags: ['holy'], char: 'seraphine',
  desc: 'Orbs of light orbit you forever, striking everything they pass.',
  base: { dmg: 12, cd: 0, amount: 3, area: 1, speed: 1, knock: 1 },
  levels: [{ dmg: 5 }, { amount: 1 }, { area: 0.2, speed: 0.15 }, { dmg: 7 }, { amount: 1 }, { area: 0.2, speed: 0.15 }, { amount: 1, dmg: 12 }],
  evo: { with: 'moss', name: 'Solar Crown', icon: { g: 'sun', c: '#fde68a' }, desc: 'The orbs burn, and pulse with healing light every few seconds.', stats: { dmgMul: 1.5, areaMul: 1.25, amount: 1 } },
  mod(g, w, s, p) { if (p.f.seraph_wings) s.amount += 2; },
  continuous: true,
  update(g, w, s, dt) {
    const p = g.player;
    w.orbs = (w.orbs || []).filter((o: Projectile) => !o.dead);
    if (w.orbs.length === s.amount && w.lastEvo === w.evolved) { w.orbs.forEach((o: Projectile) => { o.dmg = s.dmg; o.r = 13 * s.area; o.orbit!.radius = 98 * s.area; o.orbit!.speed = 2.6 * s.speed; o.knock = s.knock; }); }
    else {
      w.orbs.forEach((o: Projectile) => (o.dead = true));
      w.orbs = [];
      for (let i = 0; i < s.amount; i++) {
        w.orbs.push(g.spawnProj({
          x: p.x, y: p.y, r: 13 * s.area, dmg: s.dmg, pierce: -1, hitCd: 0.55, life: 1e9, weapon: w, knock: s.knock, light: 50,
          sprite: { kind: 'orb', color: w.evolved ? '#fbbf24' : '#fde68a', size: 9 * s.area }, orbit: { angle: (i / s.amount) * U.TAU, radius: 98 * s.area, speed: 2.6 * s.speed },
          onHit: w.evolved ? (g2: Game, pr: Projectile, e: Enemy) => g2.applyStatus(e, 'burn', { dur: 2.5, dps: s.dmg * 0.5 }) : null,
        }));
      }
      w.lastEvo = w.evolved;
    }
    if (w.evolved) { w.pulse = (w.pulse || 0) - dt; if (w.pulse <= 0) { w.pulse = 3; g.heal(p.stats.maxHp * 0.03, true); g.fx.ring(p.x, p.y, 98 * s.area, '#fde68a'); } }
  },
});
CHARS.push({
  id: 'seraphine', name: 'Seraphine', title: 'The Dawn Oracle', unlock: { type: 'time', v: 300, text: 'Survive 5 minutes in any run' },
  colors: { primary: '#f8fafc', secondary: '#c9a227', accent: '#fde68a', skin: '#f3e2d0', hair: '#fef3c7', eye: '#fff7d6' }, head: 'hair', longHair: true, weaponArt: 'halo',
  lore: 'The last priestess of a sun that no longer rises. She carries its light in her hands so it is not forgotten.',
  stats: { maxHp: 110, regen: 0.6, speed: 160, duration: 1.1, area: 1.05, healing: 1.5 },
  signature: 'sacred_halo',
  trait: { name: 'Blessed Light', desc: 'Healing is 50% stronger. Overhealing becomes a Shield (up to 30% max HP) that absorbs damage.' },
  active: { name: 'Divine Judgment', icon: { g: 'sun', c: '#fde68a' }, cd: 18, desc: 'A vast holy nova scours the screen and heals you for 20% of your max health.',
    use(g, p) {
      const mult = p.f.martyr ? 1.5 : 1;
      const w = { def: WEAPONS.sacred_halo, id: 'sacred_halo', ability: true };
      g.nova(p.x, p.y, 480, (60 + p.level * 8) * p.stats.might * mult, w, { color: '#fde68a', speed: 900, knock: 2 });
      g.heal(p.stats.maxHp * 0.2);
      if (p.f.sanctuary) g.spawnZone({ x: p.x, y: p.y, r: 150, dur: 5, dmg: 0, tick: 0.5, weapon: w, color: '#fde68a', kind: 'holy', healPct: 0.025 });
      g.fx.flash('#fde68a', 0.5); g.sfx('nova');
    } },
  hooks: {
    init(g, p) { p.shieldCap = 0.3; p.overhealToShield = true; },
    update(g, p, dt) {
      if (p.f.radiance && p.shield > 0) { p.radT = (p.radT || 0) - dt; if (p.radT <= 0) { p.radT = 0.5; g.eachEnemyIn(p.x, p.y, 115 * p.stats.area, (e) => g.damageEnemy(e, (5 + p.level * 0.6) * p.stats.might, { weapon: { def: WEAPONS.sacred_halo, id: 'sacred_halo', ability: true }, quiet: true })); } }
      if (p.f.dawnbreak) { p.dawnT = (p.dawnT || 30) - dt; if (p.dawnT <= 0) { p.dawnT = 30; g.nova(p.x, p.y, 260, (30 + p.level * 4) * p.stats.might, { def: WEAPONS.sacred_halo, id: 'sacred_halo', ability: true }, { color: '#fde68a', speed: 800 }); g.heal(p.stats.maxHp * 0.08); } }
      if (p.f.avatar) p.auraColor = '#fde68a';
    },
  },
  talents: [
    branch('light', 'Light', '#fde68a', [
      node('s_dmg', 'Radiant Orbs', 5, { sigDmg: 0.06 }, 'Sacred Halo damage +6% per rank.'),
      node('s_area', 'Wide Halo', 5, { area: 0.04 }, 'Area +4% per rank.'),
      node('s_might', 'Righteous', 5, { might: 0.03 }, 'Might +3% per rank.'),
      node('s_active', 'Devotion', 3, { activeCd: 0.08 }, 'Ability cooldown -8% per rank.'),
      key('martyr', 'Martyr', 'Divine Judgment deals 50% more damage and its cooldown is reduced by 40%.'),
    ]),
    branch('grace', 'Grace', '#fef3c7', [
      node('s_heal', 'Benediction', 5, { healing: 0.1 }, 'Healing +10% per rank.'),
      node('s_regen', 'Serenity', 5, { regen: 0.3 }, 'Regen +0.3/s per rank.'),
      node('s_hp', 'Vessel', 5, { maxHp: 12 }, 'Max Health +12 per rank.'),
      node('s_shield', 'Aegis', 3, { shieldPower: 0.15 }, 'Shield capacity +15% per rank.'),
      key('radiance', 'Radiance', 'While shielded, you burn nearby enemies with holy light.'),
    ]),
    branch('ascendant', 'Ascendant', '#c9a227', [
      node('s_speed', 'Light Step', 5, { speed: 0.03 }, 'Move speed +3% per rank.'),
      node('s_dur', 'Eternal', 5, { duration: 0.05 }, 'Duration +5% per rank.'),
      node('s_luck', 'Providence', 5, { luck: 0.05 }, 'Luck +5% per rank.'),
      node('s_rev', 'Second Dawn', 1, { revival: 1 }, '+1 Revival.'),
      key('seraph_wings', "Seraph's Wings", 'Sacred Halo gains two more orbs. Move speed +15%.'),
    ]),
  ],
  codex: [
    CH('The Last Vigil', 'When the sun set for the last time, only one candle in the temple stayed lit.', { type: 'runs', v: 1 }, { stats: { regen: 0.3 } }),
    CH('Sanctuary', 'Where she stands, the night cannot follow.', { type: 'time', v: 600 }, { flag: 'sanctuary', desc: 'Awakening: Divine Judgment leaves a sanctuary that heals 2.5% HP every half second for 5s.' }),
    CH('Hymn of Ashes', 'She sings for the dead. They are the only ones still listening.', { type: 'kills', v: 5000 }, { stats: { maxHp: 25, healing: 0.2 } }),
    CH('Dawnbreak', 'Every thirty heartbeats, a piece of the old sun returns.', { type: 'bosses', v: 5 }, { flag: 'dawnbreak', desc: 'Awakening: every 30 seconds a lesser Judgment erupts from you automatically.' }),
    CH('Avatar of Dawn', 'The sun did not die. It was only waiting for someone to carry it.', { type: 'time', v: 1500 }, { flag: 'avatar', stats: { might: 0.15, healing: 0.25 }, desc: 'Ascension: +15% Might, +25% healing and a golden aura.' }),
  ],
});

/* =====================================================================
   5. VEX — THE SHADOW BLADE
   ===================================================================== */
W({
  id: 'shadow_fan', name: 'Shadow Fan', icon: { g: 'dagger', c: '#c084fc' }, tags: ['physical', 'shadow'], char: 'vex',
  desc: 'A fan of daggers hurled at the nearest enemy (or where you move). Fast and lethal on crits.',
  base: { dmg: 11, cd: 0.72, amount: 3, speed: 640, pierce: 1, duration: 0.85, crit: 0.1, area: 1 },
  levels: [{ dmg: 5 }, { amount: 1 }, { crit: 0.05 }, { dmg: 6, pierce: 1 }, { amount: 1 }, { cd: -0.12 }, { amount: 2, dmg: 10 }],
  evo: { with: 'edge', name: 'Thousand Cuts', icon: { g: 'dagger', c: '#e879f9' }, desc: 'Twice the daggers, and they return to you like boomerangs.', stats: { amountMul: 2, dmgMul: 1.3 } },
  fire(g, w, s) {
    const p = g.player;
    const near = g.nearestEnemy(p.x, p.y, 320);
    const base = near ? Math.atan2(near.y - p.y, near.x - p.x) : (p.move.x || p.move.y) ? Math.atan2(p.move.y, p.move.x) : H.facing(p);
    const angs = H.spread(s.amount, base, Math.min(1.4, 0.2 * (s.amount - 1)));
    angs.forEach((a) => g.spawnProj({
      x: p.x, y: p.y, angle: a, speed: s.speed, r: 6, dmg: s.dmg, pierce: w.evolved ? -1 : s.pierce, hitCd: w.evolved ? 0.5 : 0, life: w.evolved ? s.duration * 2.2 : s.duration, weapon: w, crit: s.crit,
      sprite: { kind: 'dagger', color: '#c084fc', len: 22, wid: 4 }, trail: '#c084fc', boomerang: w.evolved ? { t: s.duration } : null,
    }));
    g.sfx('slash');
  },
});
CHARS.push({
  id: 'vex', name: 'Vex', title: 'The Shadow Blade', unlock: { type: 'kills', v: 2000, text: 'Kill 2,000 enemies in total' },
  colors: { primary: '#2e1065', secondary: '#4c1d95', accent: '#c084fc', skin: '#e2c9b8', hair: '#1e1b4b', eye: '#e879f9' }, head: 'hood', weaponArt: 'daggers',
  lore: 'Nobody hired Vex to kill the night. She just took it personally.',
  stats: { maxHp: 75, speed: 185, crit: 0.25, critDmg: 2.0, dodge: 0.05 },
  signature: 'shadow_fan',
  trait: { name: 'Killing Intent', desc: 'Critical hits make enemies bleed. Killing an elite or boss resets Shadowstep.' },
  active: { name: 'Shadowstep', icon: { g: 'ghost', c: '#c084fc' }, cd: 6, desc: 'Blink forward, striking everything in your path for heavy damage. Invulnerable for 1.2s; all hits crit for 2s.',
    use(g, p) {
      const [dx, dy] = U.norm(p.move.x || p.face.x, p.move.y || p.face.y);
      const dmg = (30 + p.level * 4) * p.stats.might * 3;
      const w = { def: WEAPONS.shadow_fan, id: 'shadow_fan', ability: true };
      const sx = p.x, sy = p.y;
      g.lineDamage(sx, sy, Math.atan2(dy, dx), 260, 70, dmg, w, { color: '#c084fc', crit: 0.5 });
      g.blink(dx, dy, 260);
      g.setInvuln(1.2); p.critAllT = 2;
      if (p.f.phantom_blades) g.spawnAlly({ kind: 'clone', x: sx, y: sy, life: 4, dmg: () => (10 + p.level * 1.5) * p.stats.might, sprite: 'clone', color: '#c084fc' });
      g.sfx('dash');
    } },
  hooks: {
    onHit(g, p, e, info) {
      if (info.crit) {
        g.applyStatus(e, 'bleed', { dur: 3, dps: info.dmg! * 0.12 });
        if (p.f.death_mark) { p.critN = (p.critN || 0) + 1; if (p.critN % 10 === 0) { e.st.deathMark = true; } }
        if (p.f.lethality && !e.boss && e.hp > 0 && e.hp < e.maxHp * (0.1 + p.stats.execute)) { g.damageEnemy(e, e.hp + 1, { weapon: info.weapon, quiet: true, execute: true }); }
      }
    },
    onKill(g, p, e) {
      if (e.elite || e.boss) { p.activeCdT = 0; g.fx.text(p.x, p.y - 40, 'RESET', '#c084fc'); }
      if (e.st.deathMark) g.explode(e.x, e.y, 95, (50 + p.level * 5) * p.stats.might, { def: WEAPONS.shadow_fan, id: 'shadow_fan', ability: true }, { color: '#c084fc' });
    },
    onDodge(g, p) {
      if (p.f.nightfall) for (let i = 0; i < 8; i++) g.spawnProj({ x: p.x, y: p.y, angle: i * U.TAU / 8, speed: 520, r: 5, dmg: (10 + p.level * 1.5) * p.stats.might, pierce: 1, life: 0.6, weapon: { def: WEAPONS.shadow_fan, id: 'shadow_fan', ability: true }, sprite: { kind: 'dagger', color: '#c084fc', len: 18, wid: 3 } });
    },
    update(g, p) { if (p.f.night_incarnate) p.auraColor = '#c084fc'; },
  },
  talents: [
    branch('assassin', 'Assassin', '#c084fc', [
      node('v_crit', 'Precision', 5, { crit: 0.03 }, 'Crit chance +3% per rank.'),
      node('v_critdmg', 'Vital Points', 5, { critDmg: 0.1 }, 'Crit damage +10% per rank.'),
      node('v_dmg', 'Envenomed', 5, { sigDmg: 0.06 }, 'Shadow Fan damage +6% per rank.'),
      node('v_exec', 'Finisher', 3, { execute: 0.03 }, 'Execute threshold +3% per rank (with Lethality).'),
      key('lethality', 'Lethality', 'Crit chance +15%. Critical hits instantly kill non-boss enemies below 10% health.'),
    ]),
    branch('shadow', 'Shadow', '#7c3aed', [
      node('v_dodge', 'Blur', 5, { dodge: 0.02 }, 'Dodge +2% per rank.'),
      node('v_speed', 'Fleet', 5, { speed: 0.03 }, 'Move speed +3% per rank.'),
      node('v_active', 'Umbral Focus', 5, { activeCd: 0.05 }, 'Ability cooldown -5% per rank.'),
      node('v_hp', 'Survivor', 3, { maxHp: 10 }, 'Max Health +10 per rank.'),
      key('nightfall', 'Nightfall', 'Dodge +10%. Dodging an attack releases a ring of daggers.'),
    ]),
    branch('phantom', 'Phantom', '#e879f9', [
      node('v_cd', 'Quick Hands', 5, { cooldown: 0.03 }, 'Cooldown -3% per rank.'),
      node('v_pspeed', 'Flick', 5, { projSpeed: 0.05 }, 'Projectile speed +5% per rank.'),
      node('v_luck', 'Thief', 5, { greed: 0.06, luck: 0.03 }, 'Greed +6% and luck +3% per rank.'),
      node('v_amount', 'Extra Blade', 1, { amount: 1 }, '+1 Amount.'),
      key('phantom_blades', 'Phantom Blades', 'Shadowstep leaves a shadow clone that throws daggers for 4 seconds.'),
    ]),
  ],
  codex: [
    CH('Contract', 'The client was the night itself. It paid in nothing. She took the job anyway.', { type: 'runs', v: 1 }, { stats: { crit: 0.05 } }),
    CH('Death Mark', 'Every tenth cut carries a promise.', { type: 'time', v: 600 }, { flag: 'death_mark', desc: 'Awakening: every 10th critical hit Death Marks the enemy — it explodes on death.' }),
    CH('Ten Thousand Cuts', 'She stopped keeping a ledger. The blades remember.', { type: 'kills', v: 5000 }, { stats: { critDmg: 0.2, speed: 0.04 } }),
    CH('Umbral Dance', 'Two steps through the dark are better than one.', { type: 'bosses', v: 5 }, { flag: 'dash_charges', desc: 'Awakening: Shadowstep gains a second charge.' }),
    CH('Night Incarnate', 'The night hired an assassin. It should have read the contract.', { type: 'time', v: 1500 }, { flag: 'night_incarnate', stats: { might: 0.12, crit: 0.1, dodge: 0.05 }, desc: 'Ascension: +12% Might, +10% crit, +5% dodge and a violet aura.' }),
  ],
});

/* =====================================================================
   6. MORROW — THE GRAVE WARDEN
   ===================================================================== */
W({
  id: 'raise_dead', name: 'Raise Dead', icon: { g: 'minion', c: '#86efac' }, tags: ['shadow', 'summon'], char: 'morrow',
  desc: 'Raises skeletal warriors that hunt your enemies. Kills may raise more.',
  base: { dmg: 16, cd: 3.5, amount: 1, minions: 3, duration: 22, speed: 1, area: 1 },
  levels: [{ minions: 1 }, { dmg: 6 }, { duration: 6 }, { minions: 1, amount: 1 }, { dmg: 9, speed: 0.2 }, { minions: 1 }, { minions: 2, dmg: 12 }],
  evo: { with: 'skull', name: 'Legion of Bone', icon: { g: 'skull', c: '#86efac' }, desc: 'Twice the minions, and they explode violently when they fall.', stats: { minionsMul: 2, dmgMul: 1.3 } },
  fire(g, w, s) {
    const p = g.player;
    const alive = g.alliesOf('skeleton').length;
    const n = Math.min(s.amount, s.minions - alive);
    for (let i = 0; i < n; i++) {
      const a = rand() * U.TAU;
      g.spawnAlly({ kind: 'skeleton', x: p.x + Math.cos(a) * 40, y: p.y + Math.sin(a) * 40, dmg: () => weaponStats(w, p).dmg * (1 + p.stats.minionDmg), life: s.duration, speed: 175 * s.speed, attackCd: 0.6, sprite: 'skeleton', color: '#86efac', attackR: 36 * (p.f.grave_tide ? p.stats.area : 1), crit: p.f.grave_tide ? p.stats.crit : 0, weapon: w, explode: w.evolved ? { r: 75, mult: 2.5 } : null });
    }
    if (n > 0) g.sfx('summon');
  },
});
CHARS.push({
  id: 'morrow', name: 'Morrow', title: 'The Grave Warden', unlock: { type: 'boss', v: 1, text: 'Defeat a boss' },
  colors: { primary: '#14532d', secondary: '#1f2937', accent: '#86efac', skin: '#b8c4b0', hair: '#111', eye: '#bbf7d0' }, head: 'hood', weaponArt: 'scythe',
  lore: 'He buried the dead for forty years. When they started getting up, he decided they might as well be useful.',
  stats: { maxHp: 95, speed: 150, duration: 1.15, might: 0.95, curse: 1.05 },
  signature: 'raise_dead',
  resource: { name: 'Souls', color: '#86efac', max: 100 },
  trait: { name: 'Soul Harvest', desc: 'Every kill grants a Soul (max 100). Each Soul gives +0.4% Might. Souls fade when you stop killing.' },
  active: { name: 'Army of the Night', icon: { g: 'ghost', c: '#86efac' }, cd: 20, desc: 'Summon 8 wraiths for 8 seconds that tear through the horde.',
    use(g, p) {
      for (let i = 0; i < 8; i++) { const a = i * U.TAU / 8; g.spawnAlly({ kind: 'wraith', x: p.x + Math.cos(a) * 50, y: p.y + Math.sin(a) * 50, dmg: () => (20 + p.level * 3) * p.stats.might * (1 + p.stats.minionDmg), life: 8, speed: 380, sprite: 'wraith', color: '#86efac', weapon: { id: 'skill', ability: true } }); }
      g.sfx('summon'); g.fx.flash('#86efac', 0.3);
    } },
  hooks: {
    init(g, p) { p.res = 0; p.resMax = 100; p.lastKillT = 0; },
    update(g, p, dt) {
      p.resMax = p.f.lichdom ? 200 : 100;
      if (g.time - p.lastKillT > 3) p.res = Math.max(0, p.res - dt * 0.5);
      p.dyn.might = p.res * 0.004 + (p.f.deathless ? 0.1 : 0);
      p.dyn.regen = p.f.lichdom ? p.res * 0.02 : 0;
      p.dyn.armor = p.f.bone_armor ? g.alliesOf('skeleton').length : 0;
      if (p.f.soul_nova && p.res >= 100) { p.res -= 50; g.nova(p.x, p.y, 230, (100 + p.level * 4) * p.stats.might, { def: WEAPONS.raise_dead, id: 'raise_dead', ability: true }, { color: '#86efac', speed: 700 }); g.sfx('nova'); }
      if (p.f.deathless) p.auraColor = '#86efac';
    },
    onKill(g, p, e) {
      p.res = Math.min(p.resMax, p.res + 1); p.lastKillT = g.time;
      const w = p.weapons.find((x) => x.id === 'raise_dead');
      if (w && rand() < 0.1) { const s = weaponStats(w, p); if (g.alliesOf('skeleton').length < s.minions) g.spawnAlly({ kind: 'skeleton', x: e.x, y: e.y, dmg: () => weaponStats(w, p).dmg * (1 + p.stats.minionDmg), life: s.duration, speed: 175 * s.speed, attackCd: 0.6, sprite: 'skeleton', color: '#86efac', attackR: 36, weapon: w, explode: w.evolved ? { r: 75, mult: 2.5 } : null }); }
      if (p.f.corpse_explosion) { const near = g.alliesOf('skeleton').some((a) => U.dist2(a.x, a.y, e.x, e.y) < 120 * 120); if (near) g.explode(e.x, e.y, 80, Math.max(15, e.maxHp * 0.1), { def: WEAPONS.raise_dead, id: 'raise_dead', ability: true }, { color: '#86efac', quiet: true }); }
    },
  },
  talents: [
    branch('necro', 'Necromancy', '#86efac', [
      node('m_minion', 'Grave Strength', 5, { minionDmg: 0.1 }, 'Minion damage +10% per rank.'),
      node('m_dur', 'Lingering', 5, { duration: 0.06 }, 'Duration +6% per rank.'),
      node('m_dmg', 'Reaping', 5, { sigDmg: 0.06 }, 'Raise Dead damage +6% per rank.'),
      node('m_cd', 'Quick Rites', 3, { cooldown: 0.04 }, 'Cooldown -4% per rank.'),
      key('corpse_explosion', 'Corpse Explosion', 'Enemies that die near your minions explode for 10% of their max health.'),
    ]),
    branch('bone', 'Bone', '#d1d5db', [
      node('m_hp', 'Grave Dirt', 5, { maxHp: 12 }, 'Max Health +12 per rank.'),
      node('m_armor', 'Ossified', 5, { armor: 0.5 }, 'Armor +0.5 per rank.'),
      node('m_curse', 'Grim Harvest', 5, { curse: 0.05, growth: 0.03 }, 'Curse +5% and growth +3% per rank.'),
      node('m_regen', 'Cold Comfort', 3, { regen: 0.25 }, 'Regen +0.25/s per rank.'),
      key('bone_armor', 'Bone Armor', 'Each living skeleton grants +1 Armor.'),
    ]),
    branch('soul', 'Soul', '#a7f3d0', [
      node('m_might', 'Soul Tithe', 5, { might: 0.03 }, 'Might +3% per rank.'),
      node('m_magnet', 'Beckoning', 5, { magnet: 0.1 }, 'Magnet +10% per rank.'),
      node('m_luck', 'Grave Goods', 5, { greed: 0.06 }, 'Greed +6% per rank.'),
      node('m_rev', 'Not Yet', 1, { revival: 1 }, '+1 Revival.'),
      key('lichdom', 'Lichdom', 'Souls cap at 200 and each Soul grants +0.02 HP/s regeneration.'),
    ]),
  ],
  codex: [
    CH('The Warden', 'Forty years of graves. He knew every name.', { type: 'runs', v: 1 }, { stats: { minionDmg: 0.1 } }),
    CH('Grave Tide', 'His legion learned to fight the way he does: precisely, and without mercy.', { type: 'time', v: 600 }, { flag: 'grave_tide', desc: 'Awakening: skeletons inherit your Area and Crit chance.' }),
    CH('Cemetery Gates', 'The dead do not rest. Neither does he.', { type: 'kills', v: 5000 }, { stats: { maxHp: 20, duration: 0.1 } }),
    CH('Soul Nova', 'When the harvest is full, it must be spent.', { type: 'bosses', v: 5 }, { flag: 'soul_nova', desc: 'Awakening: at 100 Souls, release a devastating soul nova (consumes 50 Souls).' }),
    CH('Deathless', 'They will bury him one day. He will not stay buried.', { type: 'time', v: 1500 }, { flag: 'deathless', stats: { might: 0.1, minionDmg: 0.3, maxHp: 25 }, desc: 'Ascension: +10% Might, +30% minion damage, +25 HP, and a spectral aura.' }),
  ],
});

/* =====================================================================
   7. ISOLDE — THE FROST QUEEN
   ===================================================================== */
W({
  id: 'glacial_shards', name: 'Glacial Shards', icon: { g: 'snowflake', c: '#bae6fd' }, tags: ['ice'], char: 'isolde',
  desc: 'Shards of ice that chill on hit. Three chills freeze an enemy solid.',
  base: { dmg: 15, cd: 1.05, amount: 3, speed: 500, pierce: 2, slow: 0.4, duration: 2, area: 1 },
  levels: [{ dmg: 5 }, { amount: 1 }, { slow: 0.1, pierce: 1 }, { dmg: 7 }, { amount: 1 }, { cd: -0.12, duration: 0.5 }, { amount: 1, dmg: 12 }],
  evo: { with: 'crystal', name: "Winter's Wrath", icon: { g: 'shard', c: '#e0f2fe' }, desc: 'Shards burst into frost novas on impact.', stats: { dmgMul: 1.35, areaMul: 1.2 } },
  fire(g, w, s) {
    const p = g.player;
    const base = H.aim(g, p, 520);
    const angs = H.spread(s.amount, base, 0.14 * (s.amount - 1));
    angs.forEach((a) => g.spawnProj({
      x: p.x, y: p.y, angle: a, speed: s.speed, r: 7 * s.area, dmg: s.dmg, pierce: s.pierce, life: 1.5, weapon: w, statuses: [{ type: 'chill', dur: s.duration, power: s.slow, stackFreeze: 3 }],
      sprite: { kind: 'shard', color: '#bae6fd', len: 22 * s.area, wid: 6 * s.area }, trail: '#bae6fd',
      onHit: w.evolved ? (g2: Game, pr: Projectile) => g2.nova(pr.x, pr.y, 60 * s.area, s.dmg * 0.5, w, { color: '#e0f2fe', speed: 500, status: { type: 'chill', dur: s.duration, power: s.slow, stackFreeze: 3 }, quiet: true }) : null,
    }));
    g.sfx('shoot');
  },
});
CHARS.push({
  id: 'isolde', name: 'Isolde', title: 'The Frost Queen', unlock: { type: 'level', v: 30, text: 'Reach level 30 in a single run' },
  colors: { primary: '#0c4a6e', secondary: '#e0f2fe', accent: '#bae6fd', skin: '#eef6fb', hair: '#f0f9ff', eye: '#7dd3fc' }, head: 'crown', longHair: true, weaponArt: 'ice',
  lore: 'Her kingdom froze in a single night and never thawed. She ruled it anyway, and rules it still.',
  stats: { maxHp: 95, speed: 158, area: 1.1, duration: 1.05 },
  signature: 'glacial_shards',
  trait: { name: 'Permafrost', desc: 'A chilling aura slows nearby enemies by 25%. Frozen enemies take +50% damage and shatter when killed, damaging their neighbours.' },
  active: { name: 'Absolute Zero', icon: { g: 'snowflake', c: '#e0f2fe' }, cd: 22, desc: 'Freeze every enemy on screen solid for 3 seconds (bosses are heavily slowed).',
    use(g, p) {
      const dur = 3 * (p.f.eternal_winter ? 2 : 1);
      g.eachEnemyIn(p.x, p.y, 560, (e) => { if (e.boss) g.applyStatus(e, 'chill', { dur, power: 0.7 }); else g.applyStatus(e, 'freeze', { dur, noMul: true }); });
      if (p.f.ice_barrier) g.addShield(p.stats.maxHp * 0.3);
      g.fx.flash('#bae6fd', 0.6); g.fx.ring(p.x, p.y, 560, '#e0f2fe'); g.sfx('freeze');
    } },
  hooks: {
    init(g, p) { if (p.f.eternal_winter) p.freezeMul = 2; },
    update(g, p, dt) {
      if (p.f.eternal_winter) p.freezeMul = 2;
      p.auraT = (p.auraT || 0) - dt;
      if (p.auraT <= 0) {
        p.auraT = 0.25;
        const r = 125 * p.stats.area * (p.f.glacier ? 1.5 : 1);
        p.frostAuraR = r;
        g.eachEnemyIn(p.x, p.y, r, (e) => {
          g.applyStatus(e, 'chill', { dur: 0.5, power: 0.25 + (p.stats.slowPower || 0), noStack: true });
          if (p.f.glacier) g.damageEnemy(e, (4 + p.level * 0.6) * p.stats.might * 0.5, { weapon: { def: WEAPONS.glacial_shards, id: 'glacial_shards', ability: true }, quiet: true });
        });
      }
      if (p.f.hailstorm && (p.move.x || p.move.y)) { p.hailT = (p.hailT || 0) - dt; if (p.hailT <= 0) { p.hailT = 0.25; g.spawnProj({ x: p.x - p.move.x * 20, y: p.y - p.move.y * 20, angle: 0, speed: 0, r: 22, dmg: (8 + p.level * 1.2) * p.stats.might, pierce: -1, hitCd: 1, life: 1.2, weapon: { def: WEAPONS.glacial_shards, id: 'glacial_shards', ability: true }, sprite: { kind: 'spike', color: '#bae6fd', size: 14 }, statuses: [{ type: 'chill', dur: 1.5, power: 0.4, stackFreeze: 3 }] }); } }
      if (p.f.frostbite) { p.fbT = (p.fbT || 0) - dt; if (p.fbT <= 0) { p.fbT = 0.5; g.eachEnemyIn(p.x, p.y, 600, (e) => { if (e.st.freeze) g.damageEnemy(e, (8 + p.level) * p.stats.might * 0.5, { weapon: { def: WEAPONS.glacial_shards, id: 'glacial_shards', ability: true }, quiet: true }); }); } }
      if (p.f.winter_eternal) p.auraColor = '#bae6fd';
    },
    onDamage(g, p, e, info) { if (e.st.freeze) info.mult! *= 1.5; },
    onKill(g, p, e) { if (e.st.freeze) { g.explode(e.x, e.y, 70, Math.max(10, e.maxHp * 0.2), { def: WEAPONS.glacial_shards, id: 'glacial_shards', ability: true }, { color: '#e0f2fe', quiet: true, noBurn: true }); } },
  },
  talents: [
    branch('winter', 'Winter', '#bae6fd', [
      node('i_dmg', 'Frostbitten', 5, { sigDmg: 0.06 }, 'Glacial Shards damage +6% per rank.'),
      node('i_slow', 'Deep Chill', 5, { slowPower: 0.05 }, 'Slow power +5% per rank.'),
      node('i_area', 'Wide Winter', 5, { area: 0.04 }, 'Area +4% per rank.'),
      node('i_dur', 'Lasting Cold', 3, { duration: 0.08 }, 'Duration +8% per rank.'),
      key('frostbite', 'Frostbite', 'Frozen enemies take continuous cold damage.'),
    ]),
    branch('throne', 'Throne', '#e0f2fe', [
      node('i_hp', 'Ice Blood', 5, { maxHp: 12 }, 'Max Health +12 per rank.'),
      node('i_armor', 'Rime Plate', 5, { armor: 0.5 }, 'Armor +0.5 per rank.'),
      node('i_active', 'Cold Focus', 5, { activeCd: 0.05 }, 'Ability cooldown -5% per rank.'),
      node('i_shield', 'Glacial Aegis', 3, { shieldPower: 0.15 }, 'Shield power +15% per rank.'),
      key('ice_barrier', 'Ice Barrier', 'Absolute Zero grants a shield worth 30% of your max health.'),
    ]),
    branch('aura', 'Permafrost', '#7dd3fc', [
      node('i_might', 'Bitter Cold', 5, { might: 0.03 }, 'Might +3% per rank.'),
      node('i_cd', 'Flurry', 5, { cooldown: 0.03 }, 'Cooldown -3% per rank.'),
      node('i_pspeed', 'Sleet', 5, { projSpeed: 0.05 }, 'Projectile speed +5% per rank.'),
      node('i_amount', 'Extra Shard', 1, { amount: 1 }, '+1 Amount.'),
      key('glacier', 'Glacier', 'Your Permafrost aura is 50% larger and deals cold damage.'),
    ]),
  ],
  codex: [
    CH('The Long Night', 'The frost came in the evening. By morning, no one in the kingdom was warm.', { type: 'runs', v: 1 }, { stats: { area: 0.05 } }),
    CH('Hailstorm', 'Where she walks, the ground remembers winter.', { type: 'time', v: 600 }, { flag: 'hailstorm', desc: 'Awakening: while moving, you leave ice spikes behind you.' }),
    CH('Frozen Court', 'Her subjects still bow. They will never stop.', { type: 'kills', v: 5000 }, { stats: { maxHp: 20, slowPower: 0.1 } }),
    CH('Eternal Winter', 'What she freezes stays frozen.', { type: 'bosses', v: 5 }, { flag: 'eternal_winter', desc: 'Awakening: all freeze durations are doubled.' }),
    CH('Winter Eternal', 'The night is cold. She is colder.', { type: 'time', v: 1500 }, { flag: 'winter_eternal', stats: { might: 0.15, area: 0.1 }, desc: 'Ascension: +15% Might, +10% Area and a crystalline aura.' }),
  ],
});

/* =====================================================================
   8. GROM — THE IRON BULWARK
   ===================================================================== */
W({
  id: 'seismic_slam', name: 'Seismic Slam', icon: { g: 'hammer', c: '#fbbf24' }, tags: ['physical', 'earth'], char: 'grom',
  desc: 'Slam the ground: a shockwave that hurls back and briefly stuns everything nearby.',
  base: { dmg: 36, cd: 2.2, amount: 1, area: 1, knock: 2.2, duration: 0.35 },
  levels: [{ area: 0.2 }, { dmg: 14 }, { knock: 0.3 }, { dmg: 16, area: 0.2 }, { cd: -0.15 }, { duration: 0.2 }, { amount: 1, dmg: 24 }],
  evo: { with: 'plate', name: 'Tectonic Fury', icon: { g: 'hammer', c: '#f97316' }, desc: 'Every slam splits the earth into four fissures.', stats: { dmgMul: 1.4, areaMul: 1.25 } },
  mod(g, w, s, p) { if (p.f.titans_grip) s.area *= 1.3; },
  fire(g, w, s) {
    const p = g.player;
    const doSlam = (mult: number) => {
      const r = 135 * s.area;
      if (p.f.titans_grip) g.pullEnemies(p.x, p.y, r * 1.6, 70);
      g.nova(p.x, p.y, r, s.dmg * mult, w, { color: '#fbbf24', speed: 750, knock: s.knock, status: { type: 'stun', dur: s.duration }, shake: 6 });
      if (w.evolved) for (let i = 0; i < 4; i++) g.after(0.15, () => g.lineDamage(p.x, p.y, i * Math.PI / 2 + Math.PI / 4, 260 * s.area, 46, s.dmg * 0.7 * mult, w, { color: '#f97316', status: { type: 'stun', dur: s.duration } }));
      if (p.f.unstoppable) { p.unstopT = 2; }
      g.sfx('explode');
    };
    for (let i = 0; i < s.amount; i++) g.after(i * 0.4, () => doSlam(1));
    if (p.f.aftershock) g.after(0.5 + (s.amount - 1) * 0.4, () => doSlam(0.5));
  },
});
CHARS.push({
  id: 'grom', name: 'Grom', title: 'The Iron Bulwark', unlock: { type: 'time', v: 900, text: 'Survive 15 minutes in any run' },
  colors: { primary: '#44403c', secondary: '#78716c', accent: '#fbbf24', skin: '#c8a27a', eye: '#fde68a' }, head: 'bald', weaponArt: 'hammer',
  lore: 'The wall held for six days because Grom was standing in front of it. On the seventh he picked up his hammer and went looking for whoever sent the horde.',
  stats: { maxHp: 165, armor: 4, speed: 142, might: 1.05, cooldown: 1.05, thorns: 1 },
  signature: 'seismic_slam',
  trait: { name: 'Juggernaut', desc: 'Enemies that hit you take the damage back, plus twice your Armor. Every point of Armor grants +2% Might.' },
  active: { name: 'Earthshatter', icon: { g: 'hammer', c: '#f97316' }, cd: 12, desc: 'Three fissures tear the ground ahead, stunning enemies for 2 seconds.',
    use(g, p) {
      const base = H.facing(p);
      const dmg = (40 + p.level * 5) * p.stats.might;
      const w = { def: WEAPONS.seismic_slam, id: 'seismic_slam', ability: true };
      [-0.4, 0, 0.4].forEach((o, i) => g.after(i * 0.1, () => g.lineDamage(p.x, p.y, base + o, 330, 56, dmg, w, { color: '#f97316', status: { type: 'stun', dur: 2 }, knock: 1 })));
      g.fx.shake(10); g.sfx('explode');
    } },
  hooks: {
    // Juggernaut: thorns (resolved in Game.hitPlayer) also return twice his Armor
    init(g, p) { p.thornsArmor = 2; },
    update(g, p, dt) {
      p.dyn.might = p.stats.armor * 0.02 + (p.f.mountain ? 0.1 : 0);
      const missing = 1 - p.hp / p.stats.maxHp;
      p.dyn.cooldown = p.f.bloodrage ? Math.min(0.4, missing * 0.5) : 0;
      p.dyn.regen = p.f.mountains_heart ? p.stats.armor * 0.15 : 0;
      p.unstopT = (p.unstopT || 0) - dt;
      p.dyn.dmgTaken = p.unstopT > 0 ? 0.8 : 1;
      if (p.f.mountain) p.auraColor = '#fbbf24';
    },
  },
  talents: [
    branch('iron', 'Iron', '#9ca3af', [
      node('g_armor', 'Iron Skin', 5, { armor: 0.8 }, 'Armor +0.8 per rank.'),
      node('g_hp', 'Bulwark', 5, { maxHp: 15 }, 'Max Health +15 per rank.'),
      node('g_thorns', 'Spiked Plate', 5, { thorns: 0.2 }, 'Thorns +20% per rank.'),
      node('g_regen', 'Stone Blood', 3, { regen: 0.3 }, 'Regen +0.3/s per rank.'),
      key('unstoppable', 'Unstoppable', 'For 2 seconds after each Seismic Slam, you take 20% less damage.'),
    ]),
    branch('quake', 'Quake', '#fbbf24', [
      node('g_dmg', 'Heavy Hand', 5, { sigDmg: 0.06 }, 'Seismic Slam damage +6% per rank.'),
      node('g_area', 'Wide Shock', 5, { area: 0.04 }, 'Area +4% per rank.'),
      node('g_knock', 'Sunder', 5, { knockback: 0.1 }, 'Knockback +10% per rank.'),
      node('g_cd', 'Rhythm', 3, { cooldown: 0.04 }, 'Cooldown -4% per rank.'),
      key('titans_grip', "Titan's Grip", 'Seismic Slam is 30% larger and drags enemies inward before it hits.'),
    ]),
    branch('rage', 'Rage', '#f97316', [
      node('g_might', 'Fury', 5, { might: 0.03 }, 'Might +3% per rank.'),
      node('g_elite', 'Siege Breaker', 5, { eliteDmg: 0.08 }, 'Elite & boss damage +8% per rank.'),
      node('g_crit', 'Crushing Blow', 5, { critDmg: 0.1 }, 'Crit damage +10% per rank.'),
      node('g_speed', 'Charge', 3, { speed: 0.03 }, 'Move speed +3% per rank.'),
      key('bloodrage', 'Bloodrage', 'Missing health reduces your cooldowns by up to 40%.'),
    ]),
  ],
  codex: [
    CH('The Wall', 'Six days. Six nights. The wall never fell, because he never fell.', { type: 'runs', v: 1 }, { stats: { armor: 1 } }),
    CH("Mountain's Heart", 'Stone does not bleed. He is learning.', { type: 'time', v: 600 }, { flag: 'mountains_heart', desc: 'Awakening: regenerate 0.15 HP/s for every point of Armor.' }),
    CH('Siege', 'They sent ten thousand. He sent them back in pieces.', { type: 'kills', v: 5000 }, { stats: { maxHp: 30, thorns: 0.3 } }),
    CH('Aftershock', 'The earth remembers every blow and repeats it.', { type: 'bosses', v: 5 }, { flag: 'aftershock', desc: 'Awakening: every Seismic Slam echoes half a second later at 50% power.' }),
    CH('The Mountain', 'Mountains do not move. This one does, and the night moves out of its way.', { type: 'time', v: 1500 }, { flag: 'mountain', stats: { armor: 2, maxHp: 40 }, desc: 'Ascension: +2 Armor, +40 HP, +10% Might and a stone aura.' }),
  ],
});

/* =====================================================================
   9. NYX — THE VOID WITCH
   ===================================================================== */
W({
  id: 'void_orb', name: 'Void Orb', icon: { g: 'blackhole', c: '#c084fc' }, tags: ['magic', 'void', 'shadow'], char: 'nyx',
  desc: 'A slow orb of nothing that drags enemies in and unmakes them.',
  base: { dmg: 7, cd: 2.3, amount: 1, speed: 110, area: 1, duration: 2.6, pull: 1, tick: 0.25 },
  levels: [{ area: 0.2 }, { dmg: 3 }, { amount: 1 }, { pull: 0.4, duration: 0.5 }, { dmg: 4, area: 0.2 }, { cd: -0.15 }, { amount: 1, dmg: 6 }],
  evo: { with: 'hourglass', name: 'Event Horizon', icon: { g: 'blackhole', c: '#e879f9' }, desc: 'Orbs collapse into a violent implosion when they expire.', stats: { dmgMul: 1.3, areaMul: 1.3, durationMul: 1.2 } },
  fire(g, w, s) {
    const p = g.player;
    for (let i = 0; i < s.amount; i++) {
      const a = H.aim(g, p, 420) + (i - (s.amount - 1) / 2) * 0.5;
      g.after(i * 0.2, () => g.spawnProj({
        x: p.x, y: p.y, angle: a, speed: s.speed, r: 10, dmg: 0, pierce: -1, hitCd: 9, life: s.duration, weapon: w, light: 70,
        sprite: { kind: 'void', color: '#c084fc', size: 16 * s.area }, field: { r: 78 * s.area, tick: s.tick, dmg: s.dmg, pull: 95 * s.pull },
        onExpire: w.evolved ? (g2: Game, pr: Projectile) => g2.explode(pr.x, pr.y, 115 * s.area, s.dmg * 5, w, { color: '#e879f9' }) : null,
      }));
    }
    g.sfx('summon');
  },
});
CHARS.push({
  id: 'nyx', name: 'Nyx', title: 'The Void Witch', unlock: { type: 'boss', v: 3, text: 'Defeat 3 bosses in total' },
  colors: { primary: '#1e1b4b', secondary: '#581c87', accent: '#c084fc', skin: '#d8c8e8', hair: '#0f0a1e', eye: '#e879f9' }, head: 'horns', longHair: true, weaponArt: 'orb',
  lore: 'She looked into the rift that birthed the night, and something looked back. They came to an arrangement.',
  stats: { maxHp: 85, speed: 162, might: 1.1, area: 1.1, duration: 1.1 },
  signature: 'void_orb',
  trait: { name: 'Entropy', desc: 'Every hit applies a Void Mark. At 6 marks the enemy bursts, damaging everything nearby.' },
  active: { name: 'Singularity', icon: { g: 'blackhole', c: '#e879f9' }, cd: 16, desc: 'Open a black hole at the nearest cluster for 4 seconds. It pulls hard and crushes everything inside.',
    use(g, p) {
      const e = g.randomEnemyNear(p.x, p.y, 360);
      const tx = e ? e.x : p.x + p.face.x * 160, ty = e ? e.y : p.y + p.face.y * 160;
      const w = { def: WEAPONS.void_orb, id: 'void_orb', ability: true };
      g.spawnZone({ x: tx, y: ty, r: 165 * p.stats.area, dur: 4, dmg: (15 + p.level * 2.5) * p.stats.might * 0.2, tick: 0.2, weapon: w, color: '#c084fc', kind: 'blackhole', pull: 230, onEnd: p.f.oblivion ? (z) => g.explode(z.x, z.y, 210, (120 + p.level * 12) * p.stats.might, w, { color: '#e879f9' }) : undefined });
      g.sfx('active');
    } },
  hooks: {
    onHit(g, p, e, info) {
      if (info.weapon && info.weapon.thorns) return;
      e.st.marks = (e.st.marks || 0) + 1;
      const need = p.f.abyssal_gaze ? 4 : 6;
      if (e.st.marks >= need) { e.st.marks = 0; g.explode(e.x, e.y, 48 * p.stats.area, (25 + p.level * 4) * p.stats.might, { def: WEAPONS.void_orb, id: 'void_orb', ability: true, noMark: true }, { color: '#e879f9', quiet: true, small: true }); }
    },
    onKill(g, p, e) {
      if (p.f.voidborn && e.st.marks > 0) for (let i = 0; i < 2; i++) g.spawnProj({ x: e.x, y: e.y, angle: rand() * U.TAU, speed: 300, r: 5, dmg: (10 + p.level) * p.stats.might, pierce: 0, life: 2, weapon: { def: WEAPONS.void_orb, id: 'void_orb', ability: true }, homing: 6, sprite: { kind: 'orb', color: '#e879f9', size: 4 }, trail: '#e879f9' });
    },
    update(g, p, dt) {
      if (p.f.null_field) { p.nfT = (p.nfT || 0) - dt; if (p.nfT <= 0) { p.nfT = 0.4; g.destroyEnemyProjectiles(p.x, p.y, 115); } }
      if (p.f.voidmother) p.auraColor = '#c084fc';
    },
  },
  talents: [
    branch('entropy', 'Entropy', '#c084fc', [
      node('n_dmg', 'Unmaking', 5, { sigDmg: 0.06 }, 'Void Orb damage +6% per rank.'),
      node('n_area', 'Wider Void', 5, { area: 0.04 }, 'Area +4% per rank.'),
      node('n_dur', 'Lingering Dark', 5, { duration: 0.05 }, 'Duration +5% per rank.'),
      node('n_might', 'Abyssal Power', 3, { might: 0.04 }, 'Might +4% per rank.'),
      key('abyssal_gaze', 'Abyssal Gaze', 'Void Marks burst at 4 stacks instead of 6.'),
    ]),
    branch('rift', 'Rift', '#e879f9', [
      node('n_active', 'Deep Focus', 5, { activeCd: 0.05 }, 'Ability cooldown -5% per rank.'),
      node('n_speed', 'Drift', 5, { speed: 0.03 }, 'Move speed +3% per rank.'),
      node('n_dodge', 'Phase', 5, { dodge: 0.02 }, 'Dodge +2% per rank.'),
      node('n_hp', 'Hollow', 3, { maxHp: 12 }, 'Max Health +12 per rank.'),
      key('rift_walker', 'Rift Walker', 'Singularity cooldown -35%. Move speed +25%.'),
    ]),
    branch('null', 'Null', '#a78bfa', [
      node('n_cd', 'Quickened Dark', 5, { cooldown: 0.03 }, 'Cooldown -3% per rank.'),
      node('n_curse', 'Beckon the Dark', 5, { curse: 0.05, growth: 0.03 }, 'Curse +5% and Growth +3% per rank.'),
      node('n_luck', 'Strange Fortune', 5, { luck: 0.05 }, 'Luck +5% per rank.'),
      node('n_amount', 'Twin Void', 1, { amount: 1 }, '+1 Amount.'),
      key('null_field', 'Null Field', 'Enemy projectiles near you are erased from existence.'),
    ]),
  ],
  codex: [
    CH('The Rift', 'Something looked back. It was very polite.', { type: 'runs', v: 1 }, { stats: { area: 0.05 } }),
    CH('Voidborn', 'What she kills does not stay dead. It becomes hers.', { type: 'time', v: 600 }, { flag: 'voidborn', desc: 'Awakening: killing a marked enemy releases two homing void motes.' }),
    CH('Entropy', 'Everything ends. She just helps it along.', { type: 'kills', v: 5000 }, { stats: { might: 0.08, duration: 0.1 } }),
    CH('Oblivion', 'When the singularity closes, it takes everything with it.', { type: 'bosses', v: 5 }, { flag: 'oblivion', desc: 'Awakening: Singularity explodes catastrophically when it ends.' }),
    CH('Voidmother', 'The rift no longer needs to look. She is the rift.', { type: 'time', v: 1500 }, { flag: 'voidmother', stats: { might: 0.15, area: 0.1 }, desc: 'Ascension: +15% Might, +10% Area and a void aura.' }),
  ],
});

/* =====================================================================
   10. RIX — THE CLOCKWORK TINKERER
   ===================================================================== */
W({
  id: 'sentry_turret', name: 'Sentry Turret', icon: { g: 'turret', c: '#fb923c' }, tags: ['physical', 'summon'], char: 'rix',
  desc: 'Deploys an automated turret that fires at the nearest enemy.',
  base: { dmg: 13, cd: 5.5, amount: 1, turrets: 2, duration: 16, rate: 1, speed: 500, range: 1, area: 1 },
  levels: [{ rate: 0.25 }, { dmg: 5 }, { turrets: 1 }, { duration: 5, dmg: 5 }, { rate: 0.25 }, { turrets: 1, dmg: 6 }, { turrets: 1, dmg: 10, rate: 0.3 }],
  evo: { with: 'mirror', name: 'Arsenal Protocol', icon: { g: 'turret', c: '#f43f5e' }, desc: 'Turrets fire explosive rockets.', stats: { dmgMul: 1.4 } },
  fire(g, w, s) {
    const p = g.player;
    const alive = g.alliesOf('turret').length;
    if (alive >= s.turrets + s.amount - 1) return; // Amount (Twin Mirror…) adds turrets
    const a = rand() * U.TAU;
    g.spawnAlly({
      kind: 'turret', x: p.x + Math.cos(a) * 30, y: p.y + Math.sin(a) * 30, life: s.duration, sprite: 'turret', color: '#fb923c', range: 320 * s.range, weapon: w,
      fireCd: 0.5 / s.rate, dmg: () => weaponStats(w, p).dmg * (1 + p.stats.minionDmg), projSpeed: s.speed, rocket: w.evolved ? { r: 58 * s.area } : null,
      explode: p.f.chain_reaction ? { r: 95, mult: 3 } : null,
    });
    g.sfx('summon');
  },
});
CHARS.push({
  id: 'rix', name: 'Rix', title: 'The Clockwork Tinkerer', unlock: { type: 'evolve', v: 1, text: 'Evolve any weapon' },
  colors: { primary: '#7c2d12', secondary: '#a16207', accent: '#fb923c', skin: '#e9c9a8', hair: '#fdba74', eye: '#fed7aa' }, head: 'goggles', weaponArt: 'wrench',
  lore: 'She built a machine to stop the night. It did not work. So she built forty more and strapped them to her back.',
  stats: { maxHp: 100, speed: 158, cooldown: 0.95, projSpeed: 1.1, luck: 1.05 },
  signature: 'sentry_turret',
  trait: { name: 'Overclock', desc: 'Every weapon and passive you hold reduces cooldowns by 1.5% (up to 18%). Turret deployments shock nearby enemies.' },
  active: { name: 'Orbital Laser', icon: { g: 'laser', c: '#f43f5e' }, cd: 15, desc: 'A beam from the sky tracks the nearest enemy for 3 seconds, incinerating everything beneath it.',
    use(g, p) {
      const w = { def: WEAPONS.sentry_turret, id: 'sentry_turret', ability: true };
      g.spawnZone({ x: p.x, y: p.y, r: 68, dur: 3, dmg: (30 + p.level * 4) * p.stats.might * 0.1, tick: 0.1, weapon: w, color: '#f43f5e', kind: 'laser', follow: 'nearest', followSpeed: 260 });
      if (p.f.overdrive) p.overdriveT = 5;
      g.sfx('active');
    } },
  hooks: {
    update(g, p, dt) {
      const items = p.weapons.length + p.passives.length;
      p.dyn.cooldown = Math.min(0.18, items * 0.015) + (p.f.prime ? 0.08 : 0);
      p.overdriveT = (p.overdriveT || 0) - dt;
      if (p.f.drone_swarm) { const d = g.alliesOf('drone'); for (let i = d.length; i < 2; i++) g.spawnAlly({ kind: 'drone', x: p.x, y: p.y, life: 1e9, sprite: 'drone', color: '#fb923c', dmg: () => (6 + p.level * 0.9) * p.stats.might * (1 + p.stats.minionDmg), fireCd: 0.7, range: 260, orbitOff: i * Math.PI }); }
      if (p.f.prime) p.auraColor = '#fb923c';
    },
    onAllySpawn(g, p, a) { if (a.kind === 'turret') g.nova(a.x, a.y, 90, (10 + p.level * 1.5) * p.stats.might, { def: WEAPONS.sentry_turret, id: 'sentry_turret', ability: true }, { color: '#fb923c', speed: 500, quiet: true, status: { type: 'stun', dur: 0.4 }, onHit: (e) => g.applyStatus(e, 'shock', { dur: 3 }) }); },
  },
  talents: [
    branch('engineer', 'Engineer', '#fb923c', [
      node('r_minion', 'Reinforced', 5, { minionDmg: 0.1 }, 'Turret & drone damage +10% per rank.'),
      node('r_dur', 'Long Battery', 5, { duration: 0.06 }, 'Duration +6% per rank.'),
      node('r_dmg', 'Calibrated', 5, { sigDmg: 0.06 }, 'Sentry Turret damage +6% per rank.'),
      node('r_cd', 'Fast Assembly', 3, { cooldown: 0.04 }, 'Cooldown -4% per rank.'),
      key('chain_reaction', 'Chain Reaction', 'Turrets detonate violently when they expire.'),
    ]),
    branch('salvage', 'Salvage', '#fbbf24', [
      node('r_greed', 'Scrapper', 5, { greed: 0.06 }, 'Greed +6% per rank.'),
      node('r_luck', 'Lucky Bolt', 5, { luck: 0.05 }, 'Luck +5% per rank.'),
      node('r_growth', 'Field Notes', 5, { growth: 0.04 }, 'Growth +4% per rank.'),
      node('r_mat', 'Prospector', 3, { matFind: 0.15 }, 'Material find +15% per rank.'),
      key('scrap_magnet', 'Scrap Magnet', 'Magnet +50%, Growth +10%.'),
    ]),
    branch('mech', 'Mech', '#f43f5e', [
      node('r_hp', 'Plating', 5, { maxHp: 12 }, 'Max Health +12 per rank.'),
      node('r_armor', 'Rivets', 5, { armor: 0.5 }, 'Armor +0.5 per rank.'),
      node('r_active', 'Capacitor', 5, { activeCd: 0.05 }, 'Ability cooldown -5% per rank.'),
      node('r_pspeed', 'Rails', 3, { projSpeed: 0.08 }, 'Projectile speed +8% per rank.'),
      key('mech_suit', 'Mech Suit', 'Max Health +30% and Armor +3.'),
    ]),
  ],
  codex: [
    CH('Prototype', 'The first machine exploded. She took notes.', { type: 'runs', v: 1 }, { stats: { cooldown: 0.03 } }),
    CH('Drone Swarm', 'Two little helpers, forever circling, forever shooting.', { type: 'time', v: 600 }, { flag: 'drone_swarm', desc: 'Awakening: two combat drones orbit you permanently.' }),
    CH('Iteration', 'Version forty-one. Almost there.', { type: 'kills', v: 5000 }, { stats: { minionDmg: 0.2, maxHp: 15 } }),
    CH('Overdrive', 'The laser charges the turrets. The turrets charge her grin.', { type: 'bosses', v: 5 }, { flag: 'overdrive', desc: 'Awakening: after Orbital Laser, turrets fire twice as fast for 5 seconds.' }),
    CH('Prime Engine', 'It works. It finally works.', { type: 'time', v: 1500 }, { flag: 'prime', stats: { might: 0.12, minionDmg: 0.3 }, desc: 'Ascension: +12% Might, +30% turret damage, -8% cooldown and a mechanical aura.' }),
  ],
});

/* =====================================================================
   11. VESPER — THE BLOOD COUNTESS
   ===================================================================== */
W({
  id: 'blood_nova', name: 'Blood Nova', icon: { g: 'drop', c: '#ef4444' }, tags: ['blood', 'physical', 'shadow'], char: 'vesper',
  desc: 'A ring of crimson blades bursts from you. Every enemy struck heals you.',
  base: { dmg: 17, cd: 1.7, amount: 1, area: 1, heal: 0.4, knock: 0.7 },
  levels: [{ area: 0.2 }, { dmg: 8 }, { heal: 0.2 }, { dmg: 10, area: 0.15 }, { cd: -0.15 }, { heal: 0.3 }, { amount: 1, dmg: 16 }],
  evo: { with: 'fang', name: 'Crimson Moon', icon: { g: 'moon', c: '#ef4444' }, desc: 'Enemies struck bleed, and the nova heals twice as much.', stats: { dmgMul: 1.4, areaMul: 1.25, healMul: 2 } },
  mod(g, w, s, p) { if (p.f.bloodbath) s.area *= 1.4; },
  fire(g, w, s) {
    const p = g.player;
    for (let i = 0; i < s.amount; i++) g.after(i * 0.3, () => {
      let hits = 0;
      g.nova(p.x, p.y, 140 * s.area, s.dmg, w, { color: '#ef4444', speed: 650, knock: s.knock, onHit: (e) => { hits++; if (w.evolved) g.applyStatus(e, 'bleed', { dur: 3, dps: s.dmg * 0.1 }); } });
      g.after(0.25, () => { if (hits) g.heal(Math.min(hits, 12) * s.heal, true); });
      g.sfx('slash');
    });
  },
});
CHARS.push({
  id: 'vesper', name: 'Vesper', title: 'The Blood Countess', unlock: { type: 'time', v: 1200, text: 'Survive 20 minutes in any run' },
  colors: { primary: '#450a0a', secondary: '#7f1d1d', accent: '#ef4444', skin: '#f5e6e0', hair: '#1c0a0a', eye: '#fca5a5' }, head: 'hair', longHair: true, weaponArt: 'scythe',
  lore: 'She was old when the night began, and she found it delicious. Now she is older, and hungrier.',
  stats: { maxHp: 120, speed: 162, lifesteal: 0.03, might: 1.05, healing: 1.5 },
  signature: 'blood_nova',
  resource: { name: 'Blood', color: '#ef4444', max: 1 },
  trait: { name: 'Hemomancy', desc: 'No natural regeneration; healing is 50% stronger. Overhealing becomes Blood Charge (up to 50% max HP): +1% Might per 1.25% Blood, draining slowly.' },
  active: { name: 'Crimson Feast', icon: { g: 'fang', c: '#ef4444' }, cd: 15, desc: 'Costs 15% of your current health. For 3 seconds, drain every enemy nearby and heal for half the damage dealt.',
    use(g, p) {
      p.hp = Math.max(1, p.hp - p.hp * 0.15);
      p.feastT = 3; p.feastTick = 0;
      g.sfx('active');
    } },
  hooks: {
    init(g, p) { p.noRegen = true; p.res = 0; p.resMax = 1; p.overhealToBlood = true; },
    update(g, p, dt) {
      const cap = p.stats.maxHp * (p.f.sanguine_queen ? 1.0 : 0.5);
      p.bloodCap = cap;
      p.blood = Math.max(0, Math.min(cap, (p.blood || 0) - dt * cap * 0.01));
      p.res = cap > 0 ? p.blood / cap : 0;
      const bloodFrac = p.blood / Math.max(1, p.stats.maxHp);
      p.dyn.might = bloodFrac * 0.8 + (p.f.eternal_hunger ? 0.1 : 0);
      const low = p.hp < p.stats.maxHp * 0.3;
      p.dyn.dodge = p.f.immortal_night && low ? 0.3 : 0;
      p.lifestealMul = p.f.immortal_night && low ? 2 : 1;
      if (p.feastT > 0) {
        p.feastT -= dt; p.feastTick -= dt;
        if (p.feastTick <= 0) {
          p.feastTick = 0.2;
          let total = 0; const dmg = (10 + p.level * 1.5) * p.stats.might;
          g.eachEnemyIn(p.x, p.y, 245, (e) => { const before = e.object ? 0 : e.hp; g.damageEnemy(e, dmg, { weapon: { def: WEAPONS.blood_nova, id: 'blood_nova', ability: true }, quiet: true }); total += Math.min(before, dmg); g.fx.beam(e.x, e.y, p.x, p.y, '#ef4444', 2, 0.15); });
          if (total > 0) g.heal(Math.min(total * 0.5, p.stats.maxHp * 0.08), true);
        }
      }
      if (p.f.bat_swarm) { const b = g.alliesOf('bat'); for (let i = b.length; i < 3; i++) g.spawnAlly({ kind: 'bat', x: p.x, y: p.y, life: 1e9, sprite: 'bat', color: '#ef4444', dmg: () => (7 + p.level) * p.stats.might * (1 + p.stats.minionDmg), orbitOff: i * U.TAU / 3, heal: 0.5 }); }
      if (p.f.eternal_hunger) p.auraColor = '#ef4444';
    },
    onHit(g, p, e, info) { if (p.f.bloodbath && info.crit && !(info.weapon && info.weapon.noBlood)) g.explode(e.x, e.y, 60, info.dmg! * 0.5, { def: WEAPONS.blood_nova, id: 'blood_nova', ability: true, noBlood: true }, { color: '#ef4444', quiet: true, small: true, exclude: e }); },
    onKill(g, p) { if (p.f.thirst) g.heal(1, true); },
  },
  talents: [
    branch('blood', 'Blood', '#ef4444', [
      node('b_ls', 'Hunger', 5, { lifesteal: 0.005 }, 'Lifesteal +0.5% per rank.'),
      node('b_heal', 'Rich Blood', 5, { healing: 0.1 }, 'Healing +10% per rank.'),
      node('b_dmg', 'Crimson Edge', 5, { sigDmg: 0.06 }, 'Blood Nova damage +6% per rank.'),
      node('b_hp', 'Ancient', 3, { maxHp: 15 }, 'Max Health +15 per rank.'),
      key('thirst', 'Thirst', 'Lifesteal +2%. Every kill heals 1 HP.'),
    ]),
    branch('night', 'Night', '#7f1d1d', [
      node('b_dodge', 'Mist Form', 5, { dodge: 0.02 }, 'Dodge +2% per rank.'),
      node('b_speed', 'Swift Shadow', 5, { speed: 0.03 }, 'Move speed +3% per rank.'),
      node('b_active', 'Feast Focus', 5, { activeCd: 0.05 }, 'Ability cooldown -5% per rank.'),
      node('b_armor', 'Cold Skin', 3, { armor: 0.5 }, 'Armor +0.5 per rank.'),
      key('immortal_night', 'Immortal Night', 'Below 30% health: +30% dodge and double lifesteal.'),
    ]),
    branch('countess', 'Countess', '#fca5a5', [
      node('b_might', 'Noble Blood', 5, { might: 0.03 }, 'Might +3% per rank.'),
      node('b_crit', 'Vein Seeker', 5, { crit: 0.03 }, 'Crit chance +3% per rank.'),
      node('b_area', 'Wide Blades', 5, { area: 0.04 }, 'Area +4% per rank.'),
      node('b_greed', 'Old Money', 3, { greed: 0.08 }, 'Greed +8% per rank.'),
      key('bloodbath', 'Bloodbath', 'Blood Nova is 40% larger. Critical hits burst enemies in a spray of damaging blood.'),
    ]),
  ],
  codex: [
    CH('The Countess', 'Her castle had a thousand rooms. The horde filled them, briefly.', { type: 'runs', v: 1 }, { stats: { lifesteal: 0.01 } }),
    CH('Bat Swarm', 'Her children have small teeth and large appetites.', { type: 'time', v: 600 }, { flag: 'bat_swarm', desc: 'Awakening: three vampire bats orbit you, biting enemies and healing you.' }),
    CH('Red Banquet', 'She dined for a hundred nights and was still not full.', { type: 'kills', v: 5000 }, { stats: { maxHp: 25, healing: 0.2 } }),
    CH('Sanguine Queen', 'The blood remembers who it belongs to.', { type: 'bosses', v: 5 }, { flag: 'sanguine_queen', desc: 'Awakening: Blood Charge capacity is doubled.' }),
    CH('Eternal Hunger', 'The night will end one day. She will still be hungry.', { type: 'time', v: 1500 }, { flag: 'eternal_hunger', stats: { might: 0.12, lifesteal: 0.02 }, desc: 'Ascension: +12% Might, +2% lifesteal, +10% Might aura.' }),
  ],
});

/* =====================================================================
   12. ZEPHYR — THE WIND MONK
   ===================================================================== */
W({
  id: 'tempest_palm', name: 'Tempest Palm', icon: { g: 'fist', c: '#5eead4' }, tags: ['physical', 'wind'], char: 'zephyr',
  desc: 'Rapid palm strikes in a short cone. Every fourth strike unleashes a piercing gale.',
  base: { dmg: 11, cd: 0.4, amount: 1, area: 1, range: 1, knock: 0.9 },
  levels: [{ dmg: 4 }, { range: 0.2 }, { amount: 1 }, { dmg: 5, cd: -0.1 }, { range: 0.2 }, { dmg: 7 }, { amount: 1, dmg: 10 }],
  evo: { with: 'boots', name: 'Hurricane Fist', icon: { g: 'tornado', c: '#5eead4' }, desc: 'Every third strike sends out a tornado that drags enemies with it.', stats: { dmgMul: 1.35, rangeMul: 1.2 } },
  mod(g, w, s, p) { if (p.f.thousand_palms) s.cd *= 0.7; },
  fire(g, w, s) {
    const p = g.player;
    const a = H.aim(g, p, 140 * s.range);
    const r = 98 * s.range * s.area;
    g.arcSlash(p.x, p.y, a, r, 0.8, s.dmg, w, { knock: s.knock, color: '#5eead4', thin: true, crit: s.crit });
    w.n = (w.n || 0) + 1;
    const every = w.evolved ? 3 : 4;
    if (w.n % every === 0) {
      const angs = H.spread(s.amount, a, 0.35 * (s.amount - 1));
      angs.forEach((aa) => {
        if (w.evolved) g.spawnProj({ x: p.x, y: p.y, angle: aa, speed: 200, r: 26 * s.area, dmg: s.dmg * 0.6, pierce: -1, hitCd: 0.3, life: 1.6, weapon: w, sprite: { kind: 'tornado', color: '#5eead4', size: 26 * s.area }, field: { r: 70 * s.area, tick: 0.3, dmg: s.dmg * 0.5, pull: 120 }, spin: 12 });
        else g.spawnProj({ x: p.x, y: p.y, angle: aa, speed: 430, r: 20 * s.area, dmg: s.dmg * 1.5, pierce: -1, hitCd: 0.5, life: 0.9, weapon: w, sprite: { kind: 'wave', color: '#5eead4', size: 22 * s.area }, knock: s.knock });
      });
    }
  },
});
CHARS.push({
  id: 'zephyr', name: 'Zephyr', title: 'The Wind Monk', unlock: { type: 'charlevel', v: 10, text: 'Reach character level 10 with anyone' },
  colors: { primary: '#134e4a', secondary: '#f59e0b', accent: '#5eead4', skin: '#d9a97a', eye: '#ccfbf1' }, head: 'bald', weaponArt: 'fists',
  lore: 'The monastery taught him that the wind cannot be caught. He spent thirty years proving it wrong.',
  stats: { maxHp: 90, speed: 195, dodge: 0.1, cooldown: 0.95 },
  signature: 'tempest_palm',
  resource: { name: 'Flow', color: '#5eead4', max: 50 },
  trait: { name: 'Flow State', desc: 'Moving builds Flow (max 50): +1% Might and +0.4% speed per stack. Flow fades when you stand still. Dodging grants 10 Flow and a counter-gale.' },
  active: { name: 'Cyclone', icon: { g: 'tornado', c: '#5eead4' }, cd: 10, desc: 'Become a whirlwind for 3 seconds: invulnerable, 40% faster, shredding and hurling everything you touch.',
    use(g, p) { p.cycloneT = 3; p.cycTick = 0; g.setInvuln(3.05); g.sfx('active'); } },
  hooks: {
    init(g, p) { p.res = 0; p.resMax = 50; },
    update(g, p, dt) {
      p.resMax = p.f.sky_monk ? 100 : 50;
      const moving = p.move.x || p.move.y;
      if (moving) p.res = Math.min(p.resMax, p.res + dt * 10); else if (!p.f.zen) p.res = Math.max(0, p.res - dt * 4);
      p.dyn.might = p.res * 0.01 + (p.f.wind_incarnate ? 0.1 : 0);
      p.dyn.speed = p.res * 0.004 + (p.cycloneT > 0 ? 0.4 : 0);
      if (p.cycloneT > 0) {
        p.cycloneT -= dt; p.cycTick -= dt;
        const w = { def: WEAPONS.tempest_palm, id: 'tempest_palm', ability: true };
        if (p.f.tornado_kick) g.pullEnemies(p.x, p.y, 200, 140);
        if (p.cycTick <= 0) { p.cycTick = 0.15; g.eachEnemyIn(p.x, p.y, 105, (e) => g.damageEnemy(e, (8 + p.level * 1.2) * p.stats.might, { weapon: w, quiet: true, kx: e.x - p.x, ky: e.y - p.y, knock: 1.5 })); g.fx.ring(p.x, p.y, 100, '#5eead4', { thin: true }); }
        if (p.cycloneT <= 0 && p.f.tornado_kick) g.explode(p.x, p.y, 185, (60 + p.level * 8) * p.stats.might, w, { color: '#5eead4' });
      }
      if (p.f.wind_incarnate) p.auraColor = '#5eead4';
    },
    onDodge(g, p, e: Vec2 | null | undefined) {
      p.res = Math.min(p.resMax, p.res + 10);
      const w = { def: WEAPONS.tempest_palm, id: 'tempest_palm', ability: true };
      const a = e ? Math.atan2(e.y - p.y, e.x - p.x) : H.facing(p);
      if (p.f.windwalker) g.spawnProj({ x: p.x, y: p.y, angle: a, speed: 200, r: 26, dmg: (10 + p.level * 1.5) * p.stats.might, pierce: -1, hitCd: 0.3, life: 1.5, weapon: w, sprite: { kind: 'tornado', color: '#5eead4', size: 26 }, field: { r: 70, tick: 0.3, dmg: (6 + p.level) * p.stats.might, pull: 120 }, spin: 12 });
      else g.spawnProj({ x: p.x, y: p.y, angle: a, speed: 430, r: 20, dmg: (14 + p.level * 2) * p.stats.might, pierce: -1, hitCd: 0.5, life: 0.9, weapon: w, sprite: { kind: 'wave', color: '#5eead4', size: 22 } });
    },
  },
  talents: [
    branch('gale', 'Gale', '#5eead4', [
      node('z_dmg', 'Iron Palm', 5, { sigDmg: 0.06 }, 'Tempest Palm damage +6% per rank.'),
      node('z_cd', 'Rhythm', 5, { cooldown: 0.03 }, 'Cooldown -3% per rank.'),
      node('z_area', 'Wide Stance', 5, { area: 0.04 }, 'Area +4% per rank.'),
      node('z_knock', 'Sweeping Wind', 3, { knockback: 0.15 }, 'Knockback +15% per rank.'),
      key('thousand_palms', 'Thousand Palms', 'Tempest Palm strikes 30% faster.'),
    ]),
    branch('flow', 'Flow', '#99f6e4', [
      node('z_speed', 'Swift Feet', 5, { speed: 0.03 }, 'Move speed +3% per rank.'),
      node('z_dodge', 'Bend like Reed', 5, { dodge: 0.02 }, 'Dodge +2% per rank.'),
      node('z_might', 'Inner Fire', 5, { might: 0.03 }, 'Might +3% per rank.'),
      node('z_hp', 'Breath', 3, { maxHp: 12 }, 'Max Health +12 per rank.'),
      key('zen', 'Zen', 'Flow never decays.'),
    ]),
    branch('storm', 'Storm', '#f59e0b', [
      node('z_crit', 'Pressure Point', 5, { crit: 0.03 }, 'Crit chance +3% per rank.'),
      node('z_active', 'Eye of Calm', 5, { activeCd: 0.05 }, 'Ability cooldown -5% per rank.'),
      node('z_luck', 'Fortune Wind', 5, { luck: 0.05 }, 'Luck +5% per rank.'),
      node('z_regen', 'Meditation', 3, { regen: 0.25 }, 'Regen +0.25/s per rank.'),
      key('windwalker', 'Windwalker', 'Dodge +10%. Your dodge counter becomes a tornado.'),
    ]),
  ],
  codex: [
    CH('The Monastery', 'Thirty years of silence. Then the night came, and he found his voice.', { type: 'runs', v: 1 }, { stats: { dodge: 0.03 } }),
    CH('Tornado Kick', 'The cyclone pulls. Then it lets go, all at once.', { type: 'time', v: 600 }, { flag: 'tornado_kick', desc: 'Awakening: Cyclone drags enemies inward and ends with an explosion.' }),
    CH('Ten Thousand Steps', 'Every step a strike. Every strike a step.', { type: 'kills', v: 5000 }, { stats: { speed: 0.06, might: 0.05 } }),
    CH('Sky Monk', 'He no longer touches the ground unless he wants to.', { type: 'bosses', v: 5 }, { flag: 'sky_monk', desc: 'Awakening: Flow caps at 100 stacks.' }),
    CH('Wind Incarnate', 'You cannot catch the wind. You cannot fight it either.', { type: 'time', v: 1500 }, { flag: 'wind_incarnate', stats: { might: 0.1, speed: 0.08, dodge: 0.05 }, desc: 'Ascension: +10% Might, +8% speed, +5% dodge and a howling aura.' }),
  ],
});

export { CHARS as CHARACTERS };
export const CHAR_BY_ID: Record<string, CharacterDef> = {}; CHARS.forEach((c) => (CHAR_BY_ID[c.id] = c));
/* keystone/awakening flags that add stats when active */
export const FLAG_STATS: Record<string, StatBag> = {
  lethality: { crit: 0.15 }, nightfall: { dodge: 0.1 }, seraph_wings: { speed: 0.15 }, rift_walker: { activeCd: 0.35, speed: 0.25 }, scrap_magnet: { magnet: 0.5, growth: 0.1 },
  mech_suit: { maxHpPct: 0.3, armor: 3 }, thirst: { lifesteal: 0.02 }, windwalker: { dodge: 0.1 }, martyr: { activeCd: 0.4 }, prime: {}, dash_charges: {},
};
