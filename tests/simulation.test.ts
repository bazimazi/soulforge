/**
 * Headless simulation tests: the real game runs in Node (no DOM, no renderer) with scripted input.
 * They exercise every character's weapons, hooks and actives over minutes of simulated time and
 * verify that a run is fully reproducible from its seed.
 */
import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/data/characters';
import { STAGES } from '../src/data/passives';
import { Game } from '../src/game/game';
import type { InputSource, MetaBonuses } from '../src/game/types';
import { FX } from '../src/render/fx';

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
        game.update(STEP);
      }
      expect(game.eclipse).toBe(true);
      expect(game.enemies.length).toBeLessThan(700);
      expect(game.pickups.length).toBeLessThan(1000);
    }
  });
});
