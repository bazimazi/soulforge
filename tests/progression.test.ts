/**
 * Fourth round — the long-term progression layer: Soul Rank and the Starweb, Champion Ascension,
 * expanded talents, Weapon Mastery, Soul Arts, Torment, Night Contracts and gear sets (meta), and
 * Overdrive, Apotheosis, Ability Ranks, Overflow, keystones and the new boons (in the run).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { BOONS } from '../src/data/boons';
import { CHAR_BY_ID } from '../src/data/characters';
import { charXpFor } from '../src/data/codex';
import { applyRun, dayNumber, genDaily, genWeekly, type ContractContext } from '../src/data/contracts';
import type { Item } from '../src/data/forge';
import { ASCENSIONS, OVERDRIVE_BASE, masteryXpFor, soulXpFor } from '../src/data/progression';
import { STARWEB, STARWEB_SIZE, STAR_BY_ID } from '../src/data/starweb';
import { WEAPONS, weaponStats } from '../src/data/weapons';
import { MemoryStore } from '../src/core/storage';
import { Game } from '../src/game/game';
import type { MetaBonuses, RunSummary } from '../src/game/types';
import { SAVE_KEY, Save, defaults } from '../src/meta/save';
import { FX } from '../src/render/fx';

const STEP = 1 / 60;
const steps = (g: Game, n: number) => {
  for (let i = 0; i < n; i++) g.update(STEP);
};
const meta = (over: Partial<MetaBonuses> = {}): MetaBonuses => ({ stats: {}, flags: {}, weaponMastery: {}, ...over });
/** An empty arena with only what the test adds (same shape as tests/simulation.test.ts). */
function arena(charId = 'kael', m: MetaBonuses = meta(), opts: { torment?: number; art?: { id: string; level: number } } = {}): Game {
  const g = new Game(new FX());
  g.start({ charId, stageId: 'ashen', meta: m, seed: 7, ...opts });
  g.levelQueue = 0;
  g.state = 'play';
  g.enemies.length = 0;
  g.player.weapons.length = 0;
  g.player.invulnT = 1e9;
  return g;
}
function summary(over: Partial<RunSummary> = {}): RunSummary {
  return {
    charId: 'kael',
    stageId: 'ashen',
    seed: 1,
    time: 60,
    kills: 50,
    level: 8,
    bossKills: 0,
    elites: 1,
    evolves: 0,
    heat: 0,
    gold: 100,
    embers: 2,
    charXp: 10,
    mats: { iron: 0, dust: 0, crystal: 0, star: 0, eclipse: 0 },
    enemyKills: {},
    bossKillsBy: {},
    dmgByWeapon: {},
    killsBySource: {},
    weapons: [],
    passives: [],
    eclipse: false,
    killedBy: '',
    bestCombo: 0,
    reactions: 0,
    boons: [],
    shrines: 0,
    torment: 0,
    apotheoses: 0,
    abilityRank: 0,
    art: null,
    artUses: 0,
    ...over,
  };
}

let store: MemoryStore;
beforeEach(() => {
  store = new MemoryStore();
  Save.useStore(store);
  Save.now = () => Date.UTC(2026, 9, 10, 12);
});

/* ================================================================== */
/* Meta                                                               */
/* ================================================================== */

describe('save v4: migration keeps veterans’ history', () => {
  it('turns past character XP into Soul Rank and best weapon damage into Mastery', () => {
    const d: any = defaults();
    d.v = 3;
    delete d.soul;
    delete d.masteries;
    delete d.starweb;
    delete d.contracts;
    d.chars = {
      kael: {
        unlocked: true,
        xp: 50,
        level: 10,
        talents: {},
        paragon: {},
        runs: 30,
        kills: 9000,
        bosses: 4,
        bestTime: 900,
        bestLevel: 70,
        chapters: {},
      },
    };
    d.codex.weapons = { fireball: { found: true, dmg: 4_000_000 } };
    store.set(SAVE_KEY, JSON.stringify(d));
    Save.load();
    let total = 50;
    for (let L = 1; L < 10; L++) total += charXpFor(L);
    let spent = 0;
    for (let R = 1; R < Save.soulRank(); R++) spent += soulXpFor(R);
    expect(Save.soulRank()).toBeGreaterThan(1);
    expect(spent + Save.data.soul.xp).toBe(total);
    expect(Save.masteryLevel('fireball')).toBeGreaterThanOrEqual(5);
    expect(Save.data.chars.kael!.ascension).toBe(0);
    expect(Save.data.mats.eclipse).toBe(0);
  });

  it('drops malformed v4 entries instead of trusting them', () => {
    const d: any = defaults();
    d.starweb = { S1: true, bogus: true, B1: 'yes' };
    d.masteries = { fireball: { xp: 'x', level: 2 }, nope: { xp: 1, level: 1 } };
    d.arts = { sunfall: 2, fake: 3 };
    d.art = 'fake';
    d.contracts = { day: 1, week: 1, list: [{ id: 'a' }, null], weekly: 5, rerolls: 1, salt: 0, bonus: false };
    store.set(SAVE_KEY, JSON.stringify(d));
    Save.load();
    expect(Save.data.starweb).toEqual({ S1: true });
    expect(Object.keys(Save.data.masteries)).toEqual([]);
    expect(Save.data.arts).toEqual({ sunfall: 2 });
    expect(Save.data.art).toBe('');
    expect(Save.data.contracts.list).toEqual([]);
    expect(Save.data.contracts.weekly).toBeNull();
  });
});

describe('Soul Rank and the Starweb', () => {
  it('runs feed one shared Soul Rank, which grants Starweb points', () => {
    Save.load();
    const res = Save.recordRun(summary({ charXp: soulXpFor(1) + soulXpFor(2) + 5 }));
    expect(res.soulUps).toBe(2);
    expect(Save.soulRank()).toBe(3);
    expect(Save.starPoints()).toBe(2);
  });

  it('stars light only next to lit stars, and only with free points', () => {
    Save.load();
    expect(Save.lightStar('S1')).toMatch(/No Starweb points/);
    Save.data.soul.level = 4; // 3 points
    expect(Save.lightStar('S3')).toMatch(/neighbouring/);
    expect(Save.lightStar('S1')).toBeNull();
    expect(Save.lightStar('S2a')).toBeNull();
    expect(Save.lightStar('S3')).toBeNull();
    expect(Save.starPointsFree()).toBe(0);
    // S1 holds the rest of the path up
    expect(Save.unlightStar('S1')).toMatch(/depend/);
    expect(Save.unlightStar('S3')).toBeNull();
  });

  it('every star is reachable from the origin and the web is symmetric', () => {
    const seen = new Set(['origin']),
      stack = ['origin'];
    while (stack.length)
      for (const l of STAR_BY_ID[stack.pop()!]!.links)
        if (!seen.has(l)) {
          seen.add(l);
          stack.push(l);
        }
    expect(seen.size).toBe(STARWEB.length);
    expect(STARWEB_SIZE).toBe(84);
    for (const n of STARWEB) for (const l of n.links) expect(STAR_BY_ID[l]!.links).toContain(n.id);
    expect(STARWEB.filter((n) => n.kind === 'keystone')).toHaveLength(6);
  });

  it('lit stars feed computeMeta, and a respec costs gold', () => {
    Save.load();
    Save.data.soul.level = 20;
    for (const id of ['S1', 'S2a', 'S2b', 'S3', 'S4a', 'S4b', 'S5', 'S5a', 'S6']) expect(Save.lightStar(id)).toBeNull();
    const m = Save.computeMeta('kael');
    expect(m.flags.sw_bleed).toBe(true);
    expect(m.flags.ks_ruin).toBe(true);
    expect(m.stats.might).toBeCloseTo(0.03 + 0.05 + 0.03 + 0.04);
    expect(Save.respecStarweb()).toMatch(/gold/);
    Save.data.gold = Save.starRespecCost();
    expect(Save.respecStarweb()).toBeNull();
    expect(Save.starsLit()).toBe(0);
    expect(Save.data.gold).toBe(0);
  });
});

describe('Champion Ascension and the deeper talent trees', () => {
  it('needs level, the feat and the price; each rank adds stats and a Starweb point', () => {
    Save.load();
    const c = Save.charData('kael');
    expect(Save.ascendBlockers('kael').length).toBeGreaterThan(0);
    c.level = 10;
    c.bestTime = 600;
    expect(Save.ascend('kael')).toMatch(/resources/);
    Save.data.mats.star = 1;
    expect(Save.ascend('kael')).toBeNull();
    expect(c.ascension).toBe(1);
    expect(Save.data.mats.star).toBe(0);
    expect(Save.starPoints()).toBe(1); // Soul Rank 1 grants none; Ascension I grants one
    const m = Save.computeMeta('kael');
    expect(m.stats.might).toBeCloseTo(0.03);
    expect(m.ascension).toBe(1);
  });

  it('Mastery opens at Ascension I, the Apex at III, and the Apex strengthens its branch', () => {
    Save.load();
    const kael = CHAR_BY_ID.kael!,
      b = kael.talents[0]!;
    const mastery = b.nodes.find((n) => n.tier === 5)!,
      apex = b.nodes.find((n) => n.apex)!;
    expect(mastery.asc).toBe(1);
    expect(apex.asc).toBe(3);
    const c = Save.charData('kael');
    c.level = 200;
    for (const n of b.nodes) if (!n.apex && n.tier < 5) c.talents[n.id] = n.max;
    expect(Save.nodeAvailable('kael', mastery)).toBe(false);
    expect(Save.buyTalent('kael', mastery)).toMatch(/Ascension I/);
    c.ascension = 1;
    for (let i = 0; i < mastery.max; i++) expect(Save.buyTalent('kael', mastery)).toBeNull();
    expect(Save.buyTalent('kael', apex)).toMatch(/Ascension III/);
    const before = Save.computeMeta('kael').stats.burnDmg!;
    c.ascension = 3;
    expect(Save.buyTalent('kael', apex)).toBeNull();
    // ascension adds no burn damage, so the whole change is the Apex's 50%
    expect(Save.computeMeta('kael').stats.burnDmg!).toBeCloseTo(before * 1.5);
  });

  it('every branch of every champion has a reachable Apex', () => {
    for (const ch of Object.values(CHAR_BY_ID))
      for (const b of ch.talents) {
        const apex = b.nodes.find((n) => n.apex)!;
        const before = b.nodes.filter((n) => !n.apex).reduce((a, n) => a + n.max, 0);
        expect(apex.req!).toBeLessThanOrEqual(before);
      }
  });

  it('feats include Torment clears recorded per champion', () => {
    Save.load();
    const feat = ASCENSIONS[5]!.feat;
    expect(feat.kind).toBe('torment');
    expect(Save.featMet('kael', feat)).toBe(false);
    Save.data.stages.best.ashen = 1300;
    Save.recordRun(summary({ torment: 3, time: 950 }));
    expect(Save.featMet('kael', feat)).toBe(true);
  });
});

describe('Weapon Mastery', () => {
  it('runs level the weapons that dealt damage, and levels feed computeMeta', () => {
    Save.load();
    const dmg = ((masteryXpFor(0) + masteryXpFor(1)) / 2.5) ** 2 + 10;
    const res = Save.recordRun(summary({ weapons: [{ id: 'fireball', level: 8, evolved: false, dmg }] }));
    expect(res.masteryUps.fireball).toBe(2);
    const m = Save.computeMeta('kael');
    expect(m.weaponLevels!.fireball).toBe(2);
    expect(m.weaponMastery.fireball).toBeCloseTo(0.04 + 0.05); // two levels + the armory "maxed" stage
  });
});

describe('Torment', () => {
  it('opens after 20:00 on a stage and deepens one tier per 15:00 clear', () => {
    Save.load();
    expect(Save.tormentMax('ashen')).toBe(0);
    Save.recordRun(summary({ time: 1200 }));
    expect(Save.tormentMax('ashen')).toBe(1);
    const res = Save.recordRun(summary({ time: 900, torment: 1 }));
    expect(res.tormentUnlocked).toBe(2);
    expect(res.unlocks.some((u) => u.type === 'torment')).toBe(true);
    expect(Save.data.stats.bestTorment).toBe(1);
    expect(Save.charData('kael').bestTorment).toBe(1);
    Save.recordRun(summary({ time: 899, torment: 2 }));
    expect(Save.tormentMax('ashen')).toBe(2);
  });
});

describe('Soul Arts', () => {
  it('the first art awakens with Soul Rank 2 and is equipped; others are bought and upgraded', () => {
    Save.load();
    expect(Save.runArt()).toBeNull();
    Save.data.soul.level = 2;
    const ev = Save.checkUnlocks();
    expect(ev.some((u) => u.type === 'art' && u.id === 'sunfall')).toBe(true);
    expect(Save.runArt()).toEqual({ id: 'sunfall', level: 1 });
    expect(Save.buyArt('soulstorm')).toMatch(/Soul Rank 3/);
    Save.data.soul.level = 3;
    Save.data.embers = 80;
    expect(Save.buyArt('soulstorm')).toBeNull();
    expect(Save.data.embers).toBe(0);
    expect(Save.upgradeArt('sunfall')).toMatch(/resources/);
    Save.data.embers = 60;
    expect(Save.upgradeArt('sunfall')).toBeNull();
    expect(Save.artLevel('sunfall')).toBe(2);
  });
});

describe('Night Contracts', () => {
  const ctx: ContractContext = { rank: 5, chars: ['kael', 'lyra'], stages: ['ashen'], torment: 0 };
  it('a day’s contracts are fixed by the calendar', () => {
    const day = dayNumber(Date.UTC(2026, 9, 10));
    expect(genDaily(day, ctx)).toEqual(genDaily(day, ctx));
    expect(genDaily(day, ctx)).toHaveLength(3);
    expect(new Set(genDaily(day, ctx).map((c) => c.kind)).size).toBe(3);
    expect(genDaily(day, ctx).map((c) => c.id)).not.toEqual(genDaily(day + 1, ctx).map((c) => c.id));
    expect(genWeekly(10, ctx)).toEqual(genWeekly(10, ctx));
  });

  it('progress comes from runs; claims pay out; all three earn the Keeper’s Cache', () => {
    Save.load();
    Save.refreshContracts();
    const cs = Save.data.contracts;
    expect(cs.list).toHaveLength(3);
    expect(cs.weekly).not.toBeNull();
    for (const c of cs.list) c.progress = c.target; // completed by earlier runs
    const id = cs.list[0]!.id;
    const embers = Save.data.embers;
    expect(Save.claimContract(id)).toBeNull();
    expect(Save.claimContract(id)).toMatch(/Already/);
    expect(Save.data.embers).toBeGreaterThanOrEqual(embers);
    expect(Save.claimDailyBonus()).toMatch(/all three/);
    for (const c of cs.list.slice(1)) expect(Save.claimContract(c.id)).toBeNull();
    expect(Save.claimDailyBonus()).toBeNull();
    expect(Save.data.stats.contracts).toBe(3);
  });

  it('a new day rolls new contracts and resets the reroll', () => {
    Save.load();
    Save.refreshContracts();
    const first = Save.data.contracts.list.map((c) => c.id);
    expect(Save.rerollContract(first[0]!)).toBeNull();
    expect(Save.rerollContract(first[1]!)).toMatch(/No rerolls/);
    const kinds = Save.data.contracts.list.map((c) => c.kind);
    expect(new Set(kinds).size).toBe(3);
    Save.now = () => Date.UTC(2026, 9, 11, 12);
    expect(Save.refreshContracts()).toBe(true);
    expect(Save.data.contracts.rerolls).toBe(1);
    expect(Save.data.contracts.list.map((c) => c.id)).not.toEqual(first);
  });

  it('applyRun counts cumulative and single-run contracts differently', () => {
    const k = { id: 'k', kind: 'kills' as const, target: 100, progress: 0, claimed: false, reward: { embers: 1 } };
    expect(applyRun(k, summary({ kills: 60 }))).toBe(false);
    expect(applyRun(k, summary({ kills: 60 }))).toBe(true);
    expect(k.progress).toBe(100);
    const t = { id: 't', kind: 'charTime' as const, ref: 'lyra', target: 600, progress: 0, claimed: false, reward: {} };
    applyRun(t, summary({ charId: 'kael', time: 900 }));
    expect(t.progress).toBe(0);
    applyRun(t, summary({ charId: 'lyra', time: 400 }));
    applyRun(t, summary({ charId: 'lyra', time: 300 }));
    expect(t.progress).toBe(400);
  });
});

describe('gear sets', () => {
  it('equipped pieces of one set awaken its bonuses in computeMeta', () => {
    Save.load();
    const piece = (slot: string, i: number): Item => ({
      uid: 'set' + i,
      slot,
      rarity: 'epic',
      level: 0,
      affixes: [],
      ilvl: 7,
      name: 'x',
      spent: 0,
      set: 'emberwrought',
    });
    ['charm', 'helm', 'armor', 'amulet'].forEach((s, i) => {
      Save.data.items.push(piece(s, i));
      Save.equip('set' + i);
    });
    const m = Save.computeMeta('kael');
    expect(m.stats.burnDmg).toBeCloseTo(0.25);
    expect(m.flags.res_fire).toBe(true);
    expect(m.flags.set_ember).toBeFalsy();
  });
});

/* ================================================================== */
/* In the run                                                         */
/* ================================================================== */

describe('Overdrive and Apotheosis', () => {
  it('evolved weapons keep levelling past their max; each Overdrive level adds 15% damage', () => {
    const g = arena();
    const w = g.addWeapon('fireball');
    w.level = w.def.max;
    expect(g.weaponCap(w)).toBe(w.def.max);
    w.evolved = true;
    expect(g.weaponCap(w)).toBe(w.def.max + OVERDRIVE_BASE);
    g.recalc();
    const base = weaponStats(w, g.player).dmg;
    w.level = w.def.max + 1;
    expect(weaponStats(w, g.player).dmg).toBeCloseTo(base * 1.15);
    g.player.passives.length = 0;
    const opts = Array.from({ length: 30 }, () => g.genOptions()).flat();
    expect(opts.some((o) => o.type === 'weapon' && o.id === 'fireball' && o.level === w.def.max + 2)).toBe(true);
  });

  it('an evolved weapon at Overdrive III transcends at the next chest once it is Attuned', () => {
    for (const mastery of [0, 10]) {
      const g = arena('kael', meta({ weaponLevels: { fireball: mastery } }));
      const w = g.addWeapon('fireball');
      w.evolved = true;
      w.level = w.def.max + 3;
      g.chestQueue.push({ boss: false });
      let chest: any[] = [];
      g.events.on('chest', (r) => (chest = r));
      steps(g, 1);
      expect(w.apex ?? false).toBe(mastery >= 10);
      expect(chest.some((r) => r.type === 'apotheosis')).toBe(mastery >= 10);
      expect(g.summary().apotheoses).toBe(mastery >= 10 ? 1 : 0);
    }
  });

  it('an Exalted weapon echoes each cast at half damage', () => {
    const g = arena();
    const w = g.addWeapon('fireball');
    w.evolved = true;
    w.level = w.def.max + 3;
    w.apex = true;
    w.timer = 0;
    const casts: number[] = [],
      fire = w.def.fire!;
    w.def = {
      ...w.def,
      fire: (g2, w2, s) => {
        casts.push(s.dmg);
        fire(g2, w2, s);
      },
    };
    g.recalc();
    steps(g, 2 + Math.ceil(0.25 / STEP));
    expect(casts).toHaveLength(2);
    expect(casts[1]).toBeCloseTo(casts[0]! * 0.5);
  });
});

describe('Ability Ranks, Soul Arts and Overflow', () => {
  it('Ability Rank cards shorten the ability cooldown', () => {
    const g = arena();
    const cd0 = g.activeCooldown();
    g.pickOption({ type: 'ability', id: 'ability', level: 2, weight: 1 });
    expect(g.player.abilityRank).toBe(2);
    expect(g.activeCooldown()).toBeCloseTo(cd0 * (1 - 0.16));
  });

  it('a Soul Art casts once, then cools down', () => {
    const g = arena('lyra', meta(), { art: { id: 'sunfall', level: 3 } });
    const e = g.spawnEnemy('brute', 120, 0);
    e.spawnT = 0;
    const hp0 = e.hp;
    expect(g.useArt()).toBe(true);
    expect(g.useArt()).toBe(false);
    expect(g.artCdT).toBeGreaterThan(0);
    steps(g, 60);
    expect(e.dead || e.hp < hp0).toBe(true);
    expect(g.summary().art).toBe('sunfall');
    expect(g.summary().artUses).toBe(1);
  });

  it('Overflow lets passives climb past their max at 60% value', () => {
    const g = arena('kael', meta({ flags: { sw_overflow: true } }));
    const ps = g.addPassive('power');
    ps.level = 5;
    g.recalc();
    const m5 = g.player.stats.might;
    ps.level = 6;
    g.recalc();
    expect(g.player.stats.might - m5).toBeCloseTo(0.08 * 0.6);
    expect(g.passiveCap(ps)).toBe(8);
    const mirror = g.addPassive('mirror');
    expect(g.passiveCap(mirror)).toBe(mirror.def.max);
  });
});

describe('Torment in the run', () => {
  it('scales the horde, adds an elite affix from Torment IV, and Heralds drop Eclipse Shards', () => {
    const hp = (t: number) => arena('kael', meta(), { torment: t }).spawnEnemy('ghoul', 300, 0).maxHp;
    expect(hp(5)).toBeGreaterThan(hp(0) * 4);
    const g = arena('kael', meta(), { torment: 4 });
    const elite = g.spawnEnemy('ghoul', 300, 0, { elite: true });
    expect(elite.affixes!.length).toBe(2);
    const boss = g.spawnBoss('bone_colossus');
    g.damageEnemy(boss, boss.hp + 1, { weapon: null });
    expect(g.pickups.filter((k) => k.kind === 'mat' && k.mat === 'eclipse').length).toBe(3);
    expect(g.summary().torment).toBe(4);
  });

  it('Torment multiplies the run’s rewards', () => {
    const gold = (t: number) => {
      const g = arena('kael', meta(), { torment: t });
      g.gold = 1000;
      g.time = 100;
      return g.summary().gold;
    };
    expect(gold(5)).toBeCloseTo(gold(0) * 3, -1);
  });
});

describe('keystones, notables and boons', () => {
  it('Cull kills a struck non-boss below the threshold, never a boss', () => {
    const g = arena('kael', meta({ stats: { cull: 0.1 } }));
    const e = g.spawnEnemy('brute', 200, 0);
    e.hp = e.maxHp * 0.12;
    g.damageEnemy(e, e.maxHp * 0.03, { weapon: { id: 'test' }, crit: -10 });
    expect(e.dead).toBe(true);
    const b = g.spawnBoss('bone_colossus');
    b.hp = b.maxHp * 0.05;
    g.damageEnemy(b, 1, { weapon: { id: 'test' }, crit: -10 });
    expect(b.dead).toBe(false);
  });

  it('Avatar of Ruin carries overkill to the nearest enemy, once', () => {
    const g = arena('kael', meta({ flags: { ks_ruin: true } }));
    const a = g.spawnEnemy('ghoul', 200, 0),
      b = g.spawnEnemy('brute', 240, 0);
    a.hp = 10;
    steps(g, 1);
    const hp = b.hp;
    g.damageEnemy(a, 510, { weapon: { id: 'test' }, crit: -10 });
    expect(hp - b.hp).toBeCloseTo(500, 0);
  });

  it('Unbreakable Will turns Armor into damage reduction', () => {
    const hit = (flags: Record<string, boolean>) => {
      const g = arena('grom', meta({ flags }));
      g.player.invulnT = 0;
      g.player.stats.dodge = 0;
      const hp = g.player.hp;
      g.hitPlayer(100, null);
      return hp - g.player.hp;
    };
    expect(hit({ ks_will: true })).toBeLessThan(hit({}));
  });

  it('Phantom Step grants a second dash charge', () => {
    let dash = 0;
    const g = new Game(new FX(), {
      moveX: () => 1,
      moveY: () => 0,
      consumeActive: () => false,
      consumeDash: () => (dash > 0 ? (dash--, true) : false),
    });
    g.start({ charId: 'kael', stageId: 'ashen', meta: meta({ flags: { ks_phantom: true } }), seed: 1 });
    g.levelQueue = 0;
    g.state = 'play';
    expect(g.player.dashCharges).toBe(2);
    dash = 1;
    steps(g, 12);
    dash = 1;
    steps(g, 1);
    expect(g.player.dashCharges).toBe(0);
    expect(g.evade()).toBe(false);
  });

  it("the Gambler's Oath takes rerolls away and makes chests generous", () => {
    const g = arena('kael', meta({ flags: { ks_gamble: true }, stats: { rerolls: 3 } }));
    expect(g.player.rerolls).toBe(0);
    g.addWeapon('fireball');
    let n = 0;
    g.events.on('chest', (r) => (n = r.filter((x) => x.type === 'weapon' || x.type === 'passive').length));
    g.chestQueue.push({ boss: false });
    steps(g, 1);
    expect(n).toBeGreaterThanOrEqual(3);
  });

  it('legendary boons only appear from tiered Heralds, the Eclipse or Torment III; at most one cursed per offer', () => {
    const plain = arena();
    plain.player.boons = [];
    expect(plain.legendaryBoonsAllowed()).toBe(false);
    for (let i = 0; i < 200; i++) {
      const o = plain.boonOptions();
      expect(o.some((b) => b.rarity === 'legendary')).toBe(false);
      expect(o.filter((b) => b.rarity === 'cursed').length).toBeLessThanOrEqual(1);
    }
    const deep = arena('kael', meta(), { torment: 3 });
    expect(deep.legendaryBoonsAllowed()).toBe(true);
    let seen = false;
    for (let i = 0; i < 200 && !seen; i++) seen = deep.boonOptions().some((b) => b.rarity === 'legendary');
    expect(seen).toBe(true);
    expect(BOONS.filter((b) => b.rarity === 'legendary').length).toBe(4);
  });

  it('the Oath of Silence seals the ability and removes Ability Rank cards', () => {
    const g = arena();
    g.pickBoon(BOONS.find((b) => b.id === 'b_silence')!);
    for (let i = 0; i < 40; i++) expect(g.genOptions().some((o) => o.type === 'ability')).toBe(false);
  });
});

describe('new weapons', () => {
  it.each(['ember_chakram', 'glacial_spire', 'wraith_banner', 'judgment_hammer'])('%s evolves with one of the new passives', (id) => {
    const evo = WEAPONS[id]!.evo!;
    expect(['ember_sigil', 'frostbite', 'tome', 'seal']).toContain(evo.with);
  });
});

describe('determinism with the new systems', () => {
  it('Torment, a Soul Art and keystones still replay identically from a seed', () => {
    const play = () => {
      let f = 0;
      const g = new Game(new FX(), {
        moveX: () => Math.cos(f / 90),
        moveY: () => Math.sin(f / 90),
        consumeActive: () => f % 200 === 0,
        consumeDash: () => f % 150 === 75,
        consumeArt: () => f % 300 === 10,
      });
      g.start({
        charId: 'nyx',
        stageId: 'frost',
        meta: meta({ flags: { ks_ruin: true, ks_phantom: true, sw_static: true, sw_overflow: true } }),
        seed: 99,
        torment: 3,
        art: { id: 'thunderhead', level: 2 },
      });
      for (; f < 60 * 90; f++) {
        g.player.hp = g.player.stats.maxHp;
        if (g.state === 'levelup') g.pickOption(g.genOptions()[0]!);
        if (g.state === 'chest') g.closeChest();
        if (g.state === 'boon') g.pickBoon(g.boonOptions()[0] ?? null);
        g.update(STEP);
      }
      return JSON.stringify([
        g.kills,
        g.player.level,
        Math.round(g.player.x),
        g.enemies.length,
        g.artUses,
        g.player.weapons.map((w) => [w.id, w.level]),
      ]);
    };
    expect(play()).toBe(play());
  });
});
