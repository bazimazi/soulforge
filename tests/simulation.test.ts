/**
 * Headless simulation tests: the real game runs in Node (no DOM, no renderer) with scripted input.
 * They exercise every character's weapons, hooks and actives over minutes of simulated time and
 * verify that a run is fully reproducible from its seed.
 */
import { describe, expect, it } from 'vitest';
import { BOON_BY_ID } from '../src/data/boons';
import { CHARACTERS } from '../src/data/characters';
import { STAGES } from '../src/data/passives';
import { Game } from '../src/game/game';
import type { InputSource, MetaBonuses } from '../src/game/types';
import { FX } from '../src/render/fx';
import { WEAPONS, weaponStats } from '../src/data/weapons';

const STEP = 1 / 60;
const noMeta = (): MetaBonuses => ({ stats: {}, flags: {}, weaponMastery: {} });

/** Drifts slowly in a circle (enemies keep up)  and fires the ability every ~4 s — deterministic, frame-based. */
function scriptedInput(): InputSource & { frame: number } {
  return {
    frame: 0,
    moveX() {
      return 0.35 * Math.cos(this.frame / 180);
    },
    moveY() {
      return 0.35 * Math.sin(this.frame / 180);
    },
    consumeActive() {
      return this.frame % 240 === 0;
    },
  };
}

interface RunResult {
  game: Game;
  errors: unknown[];
  events: Record<string, number>;
}

/** Run a game for `seconds`, auto-picking level-up cards and closing chests like a player would. */
function run(charId: string, seconds: number, seed: number, opts: { stage?: string; immortal?: boolean } = {}): RunResult {
  const input = scriptedInput();
  const game = new Game(new FX(), input);
  const errors: unknown[] = [];
  const events: Record<string, number> = {};
  for (const ev of ['levelUp', 'chest', 'gameOver', 'sfx', 'notice', 'discover'] as const)
    game.events.on(ev, () => void (events[ev] = (events[ev] ?? 0) + 1));
  game.start({ charId, stageId: opts.stage ?? 'ashen', meta: noMeta(), seed });
  const orig = console.error;
  console.error = (e: unknown) => errors.push(e); // timer callbacks report errors via console.error
  try {
    for (let i = 0; i < seconds * 60; i++) {
      input.frame = i;
      if (opts.immortal) {
        game.player.hp = game.player.stats.maxHp;
        game.player.invulnT = 1;
      }
      if (game.state === 'levelup') {
        const opt = game.genOptions()[0];
        if (opt) game.pickOption(opt);
      }
      if (game.state === 'chest') game.closeChest();
      if (game.state === 'boon') game.pickBoon(game.boonOptions()[0] ?? null);
      if (game.state === 'over') break;
      game.update(STEP);
    }
  } finally {
    console.error = orig;
  }
  return { game, errors, events };
}

/** A compact fingerprint of the full world state. */
function fingerprint(g: Game): string {
  const p = g.player;
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return JSON.stringify({
    t: r(g.time),
    kills: g.kills,
    gold: g.gold,
    lvl: p.level,
    hp: r(p.hp),
    xy: [r(p.x), r(p.y)],
    w: p.weapons.map((w) => [w.id, w.level, r(w.dmgDealt)]),
    e: g.enemies.length,
    ehp: r(g.enemies.reduce((s, e) => s + e.hp, 0)),
    proj: g.projs.length,
    pick: g.pickups.length,
  });
}

describe('simulation', () => {
  it.each(CHARACTERS.map((c) => c.id))('%s survives 3 simulated minutes without errors', (id) => {
    const { game, errors, events } = run(id, 180, 1234, { immortal: true });
    expect(errors).toEqual([]);
    expect(game.time).toBeGreaterThan(179);
    expect(game.kills).toBeGreaterThan(40);
    expect(game.player.level).toBeGreaterThan(3);
    expect(events.levelUp).toBeGreaterThan(0);
    for (const e of game.enemies) {
      expect(Number.isFinite(e.x) && Number.isFinite(e.y) && !Number.isNaN(e.hp)).toBe(true);
    }
  });

  it('is deterministic: same seed + inputs ⇒ identical world', () => {
    const a = run('lyra', 90, 99, { immortal: true });
    const b = run('lyra', 90, 99, { immortal: true });
    expect(fingerprint(a.game)).toBe(fingerprint(b.game));
    const c = run('lyra', 90, 100, { immortal: true });
    expect(fingerprint(c.game)).not.toBe(fingerprint(a.game));
  });

  it('a mortal run ends with a well-formed summary', () => {
    let summary: Parameters<Parameters<Game['events']['on']>[1]>[0] | undefined;
    const input = scriptedInput();
    const game = new Game(new FX(), input);
    game.events.on('gameOver', (s) => (summary = s as never));
    game.start({ charId: 'kael', stageId: 'void', meta: noMeta(), seed: 5, omens: { fury: 5, vigor: 5 } });
    for (let i = 0; i < 60 * 60 * 15 && game.state !== 'over'; i++) {
      input.frame = i;
      if (game.state === 'levelup') game.pickOption(game.genOptions()[0]!);
      if (game.state === 'chest') game.closeChest();
      if (game.state === 'boon') game.pickBoon(game.boonOptions()[0] ?? null);
      game.update(STEP);
    }
    expect(game.state).toBe('over');
    const s = summary as unknown as { seed: number; heat: number; gold: number; charXp: number; stageId: string };
    expect(s.seed).toBe(5);
    expect(s.heat).toBe(10);
    expect(s.stageId).toBe('void');
    expect(s.gold).toBeGreaterThan(0);
    expect(s.charXp).toBeGreaterThan(0);
  });

  it('late game (bosses, eclipse) stays stable and bounded on every stage', () => {
    for (const stage of STAGES) {
      const input = scriptedInput();
      const game = new Game(new FX(), input);
      game.start({ charId: 'nyx', stageId: stage.id, meta: noMeta(), seed: 77 });
      // jump into the late game, then simulate
      (game as unknown as { time: number }).time = 1790;
      for (let i = 0; i < 60 * 30; i++) {
        input.frame = i;
        game.player.hp = game.player.stats.maxHp;
        game.player.invulnT = 1;
        if (game.state === 'levelup') game.pickOption(game.genOptions()[0]!);
        if (game.state === 'chest') game.closeChest();
        if (game.state === 'boon') game.pickBoon(game.boonOptions()[0] ?? null);
        game.update(STEP);
      }
      expect(game.eclipse).toBe(true);
      expect(game.enemies.length).toBeLessThan(700);
      expect(game.pickups.length).toBeLessThan(1000);
    }
  });
});

/** A started run with an empty field and no weapons, ready for hand-placed scenarios. */
function arena(charId: string, flags: Record<string, boolean> = {}, input?: InputSource): Game {
  const g = new Game(new FX(), input);
  g.start({ charId, stageId: 'ashen', meta: { stats: {}, flags, weaponMastery: {} }, seed: 3 });
  g.levelQueue = 0;
  g.state = 'play';
  g.enemies.length = 0;
  g.player.weapons.length = 0;
  return g;
}
const steps = (g: Game, n: number) => {
  for (let i = 0; i < n; i++) g.update(STEP);
};

describe('gameplay rules', () => {
  it('shamans heal the horde but never bosses', () => {
    const g = arena('kael');
    g.player.invulnT = 1e9;
    const boss = g.spawnBoss('frost_wyrm');
    Object.assign(boss, { x: 500, y: 0, atkT: 99, hp: boss.maxHp / 2 });
    const ghoul = g.spawnEnemy('ghoul', 520, 30);
    ghoul.hp = 1;
    Object.assign(g.spawnEnemy('shaman', 540, 0), { healT: 0 });
    steps(g, 2);
    expect(boss.hp).toBeCloseTo(boss.maxHp / 2);
    expect(ghoul.hp).toBeGreaterThan(1);
  });

  it("Vesper's Immortal Night doubles lifesteal once instead of compounding", () => {
    const g = arena('vesper', { immortal_night: true });
    g.player.invulnT = 1e9;
    const base = g.player.stats.lifesteal;
    for (let s = 0; s < 5; s++) {
      g.player.hp = 10;
      steps(g, 60);
    }
    expect(g.player.stats.lifesteal).toBeCloseTo(base * 2);
  });

  it('weapon speed upgrades scale velocity-based weapons too', () => {
    const g = arena('kael');
    const w = g.addWeapon('prism_shard');
    const at = (lvl: number) => ((w.level = lvl), weaponStats(w, g.player).speed);
    expect(at(8)).toBeCloseTo(at(1) * 1.3);
  });

  it('a bomber killed by thorns or a bomb pickup does not detonate on the player', () => {
    const g = arena('grom');
    Object.assign(g.spawnEnemy('bomber', 20, 0), { spawnT: 99, hp: 1, contactCd: 0 });
    const hp0 = g.player.hp;
    steps(g, 1);
    const contact = hp0 - g.player.hp;
    expect(contact).toBeGreaterThan(0);
    expect(contact).toBeLessThan(30); // the contact hit only, no blast on top

    const h = arena('kael');
    const bombers = [0, 1, 2].map((i) => Object.assign(h.spawnEnemy('bomber', 40 + i * 10, 0), { spawnT: 99, contactCd: 99 }));
    h.spawnPickup({ kind: 'bomb', x: 0, y: 0 });
    const hp1 = h.player.hp;
    steps(h, 1);
    expect(h.player.hp).toBe(hp1);
    expect(bombers.every((b) => b.dead)).toBe(true);
  });

  it('an armed bomber can be escaped by walking away', () => {
    let mx = 0;
    const g = arena('grom', {}, { moveX: () => mx, moveY: () => 0, consumeActive: () => false });
    const b = Object.assign(g.spawnEnemy('bomber', -120, 0), { spawnT: 0 });
    const hp0 = g.player.hp;
    for (let i = 0; i < 180; i++) {
      steps(g, 1);
      if (b.fuse != null) mx = 1;
    }
    expect(b.dead).toBe(true);
    expect(g.player.hp).toBe(hp0);
  });

  it('the boss bar falls back to another living boss', () => {
    const g = arena('kael');
    const first = g.spawnBoss('bone_colossus');
    const second = g.spawnBoss('blood_matriarch');
    g.damageEnemy(second, second.hp + 1);
    expect(g.boss).toBe(first);
  });

  it('evolved Guardian Blades pick up later Amount bonuses', () => {
    const g = arena('kael');
    const w = g.addWeapon('guardian_blades');
    w.level = 8;
    w.evolved = true;
    g.recalc();
    w.timer = 0;
    steps(g, 2);
    const count = () => g.projs.filter((p) => p.weapon === w).length;
    const before = count();
    g.addPassive('mirror');
    steps(g, 600);
    expect(count()).toBe(before + 1);
  });
});

describe('run systems', () => {
  it('elements react: thermal shock, overload and superconduct', () => {
    const g = arena('kael');
    const a = Object.assign(g.spawnEnemy('brute', 300, 0), { spawnT: 99 });
    const hp0 = a.hp;
    g.applyStatus(a, 'burn', { dur: 3, dps: 1 });
    g.applyStatus(a, 'chill', { dur: 3, power: 0.3 });
    expect(g.reactions).toBe(1);
    expect(a.hp).toBeLessThan(hp0);
    expect(a.st.chill).toBeUndefined(); // thermal shock cracks the ice

    const b = Object.assign(g.spawnEnemy('brute', -300, 0), { spawnT: 99 });
    g.applyStatus(b, 'chill', { dur: 3, power: 0.3 });
    g.applyStatus(b, 'shock', { dur: 3 });
    expect(b.st.brittle).toBeGreaterThan(0);
    const before = b.hp;
    g.damageEnemy(b, 100, { weapon: { id: 'test' }, crit: -10 });
    expect(before - b.hp).toBeCloseTo(130);

    // reactions have a per-enemy cooldown: re-applying immediately does nothing
    g.applyStatus(b, 'burn', { dur: 3, dps: 1 });
    expect(g.reactions).toBe(2);
  });

  it('lightning-tagged weapon hits shock their target', () => {
    const g = arena('lyra');
    const w = g.addWeapon('thunder_strike');
    const e = Object.assign(g.spawnEnemy('brute', 200, 0), { spawnT: 99 });
    g.damageEnemy(e, 1, { weapon: w });
    expect(e.st.shock).toBeGreaterThan(0);
  });

  it('weapons sharing a tag resonate', () => {
    const g = arena('kael');
    g.addWeapon('flame_cleave');
    g.addWeapon('fireball');
    expect(g.resonance.find((r) => r.def.tag === 'fire')?.tier).toBe(1);
    const burn = g.player.stats.burnDmg;
    g.addWeapon('sunbeam');
    expect(g.resonance.find((r) => r.def.tag === 'fire')?.tier).toBe(2);
    expect(g.player.f.res_fire).toBe(true);
    expect(g.player.stats.burnDmg).toBeCloseTo(burn);
  });

  it('bosses enrage at half health and their chest offers boons', () => {
    const g = arena('kael');
    g.player.invulnT = 1e9;
    const beats: string[] = [];
    g.events.on('story', (b) => beats.push(b));
    const boss = g.spawnBoss('frost_wyrm');
    Object.assign(boss, { x: 400, y: 0, spawnT: 0 });
    g.damageEnemy(boss, boss.maxHp * 0.55, { weapon: { id: 'test' }, crit: -10 });
    steps(g, 2);
    expect(boss.phase).toBe(2);
    expect(beats).toContain('bossPhase');

    let offered = 0;
    g.events.on('boon', (o) => (offered = o.length));
    g.damageEnemy(boss, boss.hp + 1);
    g.chestQueue.push({ boss: true });
    steps(g, 1);
    expect(g.state).toBe('chest');
    g.closeChest();
    steps(g, 1);
    expect(g.state).toBe('boon');
    expect(offered).toBe(3);
    const glass = g.boonOptions().length ? { ...g.boonOptions()[0]!, id: 'b_glass', stats: { might: 0.5, maxHpPct: -0.35 } } : null;
    const might = g.player.stats.might;
    g.pickBoon(glass);
    expect(g.state).toBe('play');
    expect(g.player.stats.might).toBeCloseTo(might + 0.5);
  });

  it('shrines channel while you stand inside, then fire once', () => {
    const g = arena('kael');
    g.player.invulnT = 1e9;
    g.player.hp = 20;
    g.shrines.push({ id: 1, kind: 'life', x: 0, y: 0, r: 56, charge: 0, used: false, age: 0, usedAt: 0, dead: false });
    steps(g, 60);
    expect(g.shrines[0]!.used).toBe(false);
    steps(g, 60);
    expect(g.shrinesUsed).toBe(1);
    expect(g.player.hp).toBeGreaterThan(20);
    expect(g.player.shield).toBeGreaterThan(0);
  });

  it('kill streaks build tiers that grant might, and lapse', () => {
    const g = arena('kael');
    const might = g.player.stats.might;
    for (let i = 0; i < 30; i++) g.damageEnemy(g.spawnEnemy('bat', 400, i * 10), 1e6, { weapon: { id: 'test' } });
    expect(g.comboTier).toBe(1);
    expect(g.player.stats.might).toBeGreaterThan(might);
    steps(g, 60 * 3);
    expect(g.combo).toBe(0);
    expect(g.comboTier).toBe(0);
    expect(g.bestCombo).toBe(30);
  });

  it('elites roll affixes; a warded barrier soaks damage first', () => {
    const g = arena('kael');
    (g as unknown as { time: number }).time = 60 * 15;
    const e = g.spawnEnemy('brute', 400, 0, { elite: true });
    expect(e.affixes!.length).toBe(2);
    expect(g.enemyName(e)).toContain('Grave Brute');
    e.barrierMax = e.barrier = 500;
    const hp0 = e.hp;
    g.damageEnemy(e, 300, { weapon: { id: 'test' }, crit: -10 });
    expect(e.hp).toBe(hp0);
    expect(e.barrier).toBeCloseTo(200);
  });

  it('hazards hurt the player only after they arm', () => {
    const g = arena('kael');
    const hp0 = g.player.hp;
    g.spawnHazard({ x: 0, y: 0, r: 60, dmg: 10, life: 5, color: '#f00', arm: 0.5 });
    steps(g, 20);
    expect(g.player.hp).toBe(hp0);
    steps(g, 30);
    expect(g.player.hp).toBeLessThan(hp0);
  });

  it('Vitality Core raises max health by 12% per level', () => {
    const g = arena('kael');
    const base = g.player.stats.maxHp;
    g.addPassive('vitality').level = 5;
    g.recalc();
    expect(g.player.stats.maxHp).toBe(Math.round(base * 1.6));
    expect(g.player.hp).toBe(g.player.stats.maxHp); // the extra health arrives filled
  });

  it('Four-Leaf Clover luck also sharpens crits', () => {
    const g = arena('kael');
    const base = g.player.stats.crit;
    g.addPassive('clover').level = 5;
    g.recalc();
    expect(g.player.stats.crit).toBeCloseTo(base + 0.05);
  });

  it('Phoenix Feather turns one death into a rebirth that clears the horde', () => {
    const g = arena('kael');
    g.state = 'boon';
    g.pickBoon(BOON_BY_ID.b_phoenix!);
    const horde = [0, 1, 2, 3].map((i) => Object.assign(g.spawnEnemy('brute', 60 + i * 40, 0), { hp: 1e6, maxHp: 1e6, speed: 0 }));
    const boss = Object.assign(g.spawnBoss('frost_wyrm'), { x: 220, y: 0, atkT: 99 });
    const bossHp = boss.hp;
    g.player.invulnT = 1;
    steps(g, 1);
    g.player.invulnT = 0;
    g.hitPlayer(1e9, null);
    expect(g.state).toBe('play');
    expect(g.phoenixUsed).toBe(true);
    expect(g.player.hp).toBe(g.player.stats.maxHp);
    expect(horde.every((e) => e.dead)).toBe(true);
    expect(boss.hp).toBeLessThanOrEqual(bossHp * 0.85);
    expect(boss.st.burn).toBeDefined();
    g.player.invulnT = 0;
    g.hitPlayer(1e9, null);
    expect(g.state).toBe('over'); // the feather burns only once
  });

  it('thorns hurt attackers for every hero, and Grom adds twice his Armor once', () => {
    const struck = (charId: string, thorns: number) => {
      const g = arena(charId);
      g.meta.stats.thorns = thorns;
      g.recalc();
      const foe = Object.assign(g.spawnEnemy('ghoul', 20, 0), { hp: 1e6, maxHp: 1e6, spawnT: 99, contactCd: 0 });
      const hp0 = g.player.hp;
      steps(g, 1);
      return { g, taken: hp0 - g.player.hp, reflected: foe.maxHp - foe.hp };
    };
    expect(struck('kael', 0).reflected).toBe(0);
    const k = struck('kael', 0.5);
    expect(k.taken).toBeGreaterThan(0);
    expect(k.reflected).toBeGreaterThanOrEqual(k.taken * 0.5 - 1e-6);
    const gr = struck('grom', 0);
    const st = gr.g.player.stats, want = gr.taken * st.thorns + st.armor * 2;
    expect(gr.reflected).toBeGreaterThanOrEqual(want - 1e-6);
    expect(gr.reflected).toBeLessThanOrEqual(want * st.critDmg + 1e-6); // reflected once, not twice
  });

  it('Glacial Cataclysm: frozen enemies shatter on death and hurt their neighbours', () => {
    const g = arena('kael');
    g.player.invulnT = 1e9;
    const w = g.addWeapon('frost_nova');
    w.level = w.def.max;
    w.evolved = true;
    g.recalc();
    const victim = Object.assign(g.spawnEnemy('ghoul', 90, 0), { hp: 1e6, maxHp: 1e6, speed: 0 });
    for (let i = 0; i < 240 && !(victim.st.freeze && victim.st.shatter); i++) steps(g, 1);
    expect(victim.st.shatter).toBeDefined();
    g.player.weapons.length = 0;
    const neighbour = Object.assign(g.spawnEnemy('ghoul', victim.x + 30, victim.y), { hp: 1e6, maxHp: 1e6, speed: 0 });
    steps(g, 1);
    victim.st.freeze = 2;
    g.damageEnemy(victim, victim.hp + 1, { weapon: null });
    steps(g, 10);
    expect(neighbour.hp).toBeLessThan(neighbour.maxHp);
  });

  it('Second Wind grants its full 60% shield, past the usual shield cap', () => {
    const g = arena('seraphine'); // her shields normally cap at 30% max health
    g.state = 'boon';
    g.pickBoon(BOON_BY_ID.b_second!);
    g.hitPlayer(g.player.hp - g.player.stats.maxHp * 0.2, null);
    expect(g.player.shield).toBeCloseTo(g.player.stats.maxHp * 0.6 * g.player.stats.shieldPower);
  });

  it("Warlord's Banner might is not clipped by Soulreaver's cap", () => {
    const g = arena('kael', { u_banner: true, u_soulreaver: true });
    g.player.invulnT = 1e9;
    g.runMight = 0.4; // Soulreaver already maxed
    g.recalc();
    const before = g.player.stats.might;
    const boss = g.spawnBoss('frost_wyrm');
    g.damageEnemy(boss, boss.hp + 1, { weapon: null });
    g.damageEnemy(g.spawnEnemy('ghoul', 300, 0), 1e6, { weapon: null }); // a later kill re-applies Soulreaver's cap
    g.recalc();
    expect(g.player.stats.might).toBeCloseTo(before + 0.08);
  });

  it.each(
    Object.values(WEAPONS)
      .filter((w) => !w.char)
      .map((w) => w.id),
  )('%s works at max level, base and evolved', (id) => {
    for (const evolved of [false, true]) {
      const g = arena('kael');
      g.player.invulnT = 1e9;
      const w = g.addWeapon(id);
      w.level = w.def.max;
      w.evolved = evolved;
      g.recalc();
      const errors: unknown[] = [];
      const orig = console.error;
      console.error = (e: unknown) => errors.push(e);
      try {
        for (let i = 0; i < 60 * 12; i++) {
          if (i % 30 === 0) for (let k = 0; k < 6; k++) g.spawnEnemy('ghoul', Math.cos(k + i) * 260, Math.sin(k + i) * 260);
          g.player.hp = g.player.stats.maxHp;
          g.update(STEP);
          if (g.state !== 'play') g.state = 'play';
        }
      } finally {
        console.error = orig;
      }
      expect(errors).toEqual([]);
      expect(w.dmgDealt).toBeGreaterThan(0);
    }
  });
});
