import { describe, expect, it, vi } from 'vitest';
import { CHARACTERS } from '../src/data/characters';
import { BOONS } from '../src/data/boons';
import { BOSSES } from '../src/data/enemies';
import { PASSIVE_BY_ID, PASSIVES, STAGES, OMENS } from '../src/data/passives';
import { SOUL_ARTS } from '../src/data/soularts';
import { WEAPONS } from '../src/data/weapons';
import { Game } from '../src/game/game';
import { FX } from '../src/render/fx';

const step = 1 / 60;

describe('content integrity', () => {
  it('all signatures, evolutions, stages and talent identifiers resolve', () => {
    expect(new Set(CHARACTERS.map((c) => c.id)).size).toBe(CHARACTERS.length);
    for (const c of CHARACTERS) {
      expect(WEAPONS[c.signature]?.char).toBe(c.id);
      const nodes = c.talents.flatMap((b) => b.nodes);
      expect(new Set(nodes.map((n) => n.id)).size).toBe(nodes.length);
    }
    for (const w of Object.values(WEAPONS)) {
      expect(w.levels.length).toBe(w.max - 1);
      if (w.evo) expect(PASSIVE_BY_ID[w.evo.with]).toBeDefined();
      expect(w.continuous ? w.update : w.fire).toBeTypeOf('function');
    }
    for (const s of STAGES) if (s.unlock) expect(STAGES.some((x) => x.id === s.unlock!.stage)).toBe(true);
    expect(new Set(PASSIVES.map((p) => p.id)).size).toBe(PASSIVES.length);
  });
});

describe.each(['base', 'evolved', 'apotheosis'] as const)('every weapon: %s', (form) => {
  it.each(Object.values(WEAPONS))('$id deals damage and keeps finite state', (def) => {
    const fx = new FX(),
      g = new Game(fx);
    g.start({ charId: def.char || 'kael', stageId: 'ashen', seed: 41, meta: { stats: {}, flags: {}, weaponMastery: {} } });
    const p = g.player;
    p.weapons = [];
    const w = g.addWeapon(def.id);
    w.level = form === 'base' ? 1 : def.max + (form === 'apotheosis' ? 3 : 0);
    w.evolved = form !== 'base';
    w.apex = form === 'apotheosis';
    p.invulnT = 999;
    g.recalc();
    for (let i = 0; i < 20; i++) {
      const angle = (i * Math.PI) / 10;
      const e = g.spawnEnemy('brute', Math.cos(angle) * 90, Math.sin(angle) * 90);
      e.hp = e.maxHp = 1e7;
      e.speed = 0;
    }
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      for (let i = 0; i < 900; i++) {
        if (g.state === 'levelup') g.pickOption({ type: 'gold', value: 0 });
        g.update(step);
        fx.update(step);
      }
      expect(errors).not.toHaveBeenCalled();
      expect(w.dmgDealt).toBeGreaterThan(0);
      for (const value of Object.values(w.s!)) if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
      for (const e of g.enemies) expect([e.x, e.y, e.hp].every(Number.isFinite)).toBe(true);
      expect(g.projs.length).toBeLessThan(3000);
    } finally {
      errors.mockRestore();
    }
  });
});

describe('endgame systems', () => {
  it.each(CHARACTERS)('$id handles a complete talent tree, omens, Torment XX, and boons', (char) => {
    const flags: Record<string, boolean> = {},
      stats: Record<string, number> = {};
    for (const b of char.talents)
      for (const n of b.nodes) {
        if (n.flag) flags[n.flag] = true;
        for (const [key, value] of Object.entries(n.per ?? {})) stats[key] = (stats[key] ?? 0) + value * n.max;
      }
    const fx = new FX(),
      g = new Game(fx);
    g.start({
      charId: char.id,
      stageId: STAGES[CHARACTERS.indexOf(char) % STAGES.length]!.id,
      torment: 20,
      omens: Object.fromEntries(OMENS.map((o) => [o.id, o.max])),
      seed: 99,
      meta: { stats, flags, weaponMastery: {} },
      art: { id: 'thunderhead', level: 5 },
    });
    g.time = 1801;
    g.levelQueue = 0;
    for (const b of BOONS) g.pickBoon(b);
    const boss = g.spawnBoss(Object.keys(BOSSES)[0]!, 3);
    boss.hp = boss.maxHp * 0.4;
    for (let i = 0; i < 600; i++) {
      g.player.invulnT = 5;
      if (g.state === 'levelup') g.pickOption(g.genOptions()[0]!);
      if (g.state === 'chest') g.closeChest();
      if (g.state === 'boon') g.pickBoon(g.boonOptions()[0] ?? null);
      g.update(step);
      fx.update(step);
    }
    expect(g.eclipse).toBe(true);
    for (const value of Object.values(g.player.stats)) expect(Number.isFinite(value)).toBe(true);
    expect(Object.values(g.summary().mats).every((n) => Number.isFinite(n) && n >= 0)).toBe(true);
  });

  it.each(SOUL_ARTS)('$name casts at maximum rank and goes on cooldown', (art) => {
    const g = new Game(new FX());
    g.start({
      charId: 'kael',
      stageId: 'ashen',
      seed: 7,
      meta: { stats: {}, flags: {}, weaponMastery: {} },
      art: { id: art.id, level: 5 },
    });
    const e = g.spawnEnemy('brute', 150, 0);
    g.grid.insert(e);
    expect(g.useArt()).toBe(true);
    expect(g.artCdT).toBeGreaterThan(0);
    expect(g.useArt()).toBe(false);
    for (let i = 0; i < 600; i++) {
      g.player.invulnT = 5;
      if (g.state === 'levelup') g.pickOption(g.genOptions()[0]!);
      g.update(step);
    }
    expect(g.artUses).toBe(1);
  });
});

describe('spell clarity preserves combat', () => {
  it.each(Object.values(WEAPONS))('$id apotheosis deals identical damage at minimum and maximum effects', (def) => {
    const simulate = (intensity: number) => {
      const fx = new FX();
      fx.intensity = intensity;
      const g = new Game(fx);
      g.start({ charId: def.char || 'kael', stageId: 'ashen', seed: 73, meta: { stats: {}, flags: {}, weaponMastery: {} } });
      g.player.weapons = [];
      const w = g.addWeapon(def.id);
      w.level = def.max + 3;
      w.evolved = true;
      w.apex = true;
      g.player.invulnT = 999;
      g.recalc();
      for (let i = 0; i < 12; i++) {
        const angle = (i * Math.PI) / 6;
        const e = g.spawnEnemy('brute', Math.cos(angle) * 90, Math.sin(angle) * 90);
        e.hp = e.maxHp = 1e7;
        e.speed = 0;
      }
      for (let i = 0; i < 600; i++) {
        g.update(step);
        fx.update(step);
      }
      return {
        damage: w.dmgDealt,
        kills: g.kills,
        hp: g.player.hp,
        enemies: g.enemies.map((e) => [e.x, e.y, e.hp]),
        projectiles: g.projs.map((p) => [p.x, p.y, p.r]),
      };
    };
    expect(simulate(0.1)).toEqual(simulate(1));
  });

  it('bounds burst particles even for a single enormous detonation', () => {
    const high = new FX(),
      low = new FX();
    low.intensity = 0.1;
    for (const fx of [high, low]) {
      fx.burst(0, 0, '#fff', 100000);
      fx.sparks(0, 0, 0, 1, '#fff', 100000);
      fx.debris(0, 0, '#fff', 100000);
      expect(fx.parts.count).toBeLessThanOrEqual(1800);
      fx.telegraphCircle(0, 0, 240, 2, '#f87171');
    }
    expect(low.parts.count).toBeLessThan(high.parts.count);
    expect(low.tele).toEqual(high.tele);
  });
});
