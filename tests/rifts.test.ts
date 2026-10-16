import { describe, expect, it } from 'vitest';
import { RIFT_RELICS, type RiftKind } from '../src/data/rifts';
import { Game } from '../src/game/game';
import { RIFT_CHANNEL, WARD_TIME } from '../src/game/rifts';
import { FX } from '../src/render/fx';
import { actionPose, HERO_ACTION_FRAMES, heroAnimation } from '../src/render/hero-animation';

function game() {
  const g = new Game(new FX());
  g.start({ charId: 'kael', stageId: 'ashen', seed: 123, meta: { stats: {}, flags: {}, weaponMastery: {} } });
  return g;
}
function enter(g: Game, kind: RiftKind) {
  const r = g.rifts.spawn(kind);
  g.player.x = r.x;
  g.player.y = r.y;
  g.rifts.update(RIFT_CHANNEL + 0.01);
  expect(r.phase).toBe('active');
  return r;
}
function seal(g: Game) {
  const r = enter(g, 'ward');
  g.rifts.update(WARD_TIME);
  expect(r.phase).toBe('complete');
  return r;
}
function grant(g: Game, id: string) {
  g.rifts.offers = [RIFT_RELICS.find((r) => r.id === id)!];
  g.state = 'relic';
  expect(g.rifts.pick(id)).toBe(true);
}

describe('optional rift expeditions', () => {
  it('appears early without starting until the player deliberately stops in its core', () => {
    const g = game();
    g.time = 21;
    g.rifts.update(0.1);
    expect(g.rifts.current).toBeNull();
    g.time = 22;
    g.rifts.update(0.1);
    const r = g.rifts.current!;
    g.rifts.update(3);
    expect(r.phase).toBe('available');
    g.player.x = r.x;
    g.player.y = r.y;
    g.player.move.x = 1;
    g.rifts.update(2);
    expect(r.phase).toBe('available');
    g.player.move.x = 0;
    g.rifts.update(0.6);
    g.player.x += 60;
    g.rifts.update(1);
    expect(r.channel).toBe(0);
    g.player.x = r.x;
    g.rifts.update(1.3);
    expect(r.phase).toBe('active');
  });

  it('requires accumulated time inside the ward, awards once, and offers distinct relics', () => {
    const g = game(),
      r = enter(g, 'ward');
    g.rifts.update(5);
    expect(r.progress).toBe(5);
    g.player.x += 200;
    g.rifts.update(2);
    expect(r.progress).toBeCloseTo(4.3);
    g.player.x = r.x;
    g.rifts.update(14);
    expect(g.rifts.completed).toBe(1);
    expect(g.gold).toBe(50);
    expect(g.embers).toBe(1);
    expect(g.mats.iron).toBe(3);
    expect(new Set(g.rifts.offers.map((x) => x.id)).size).toBe(3);
    g.rifts.update(1);
    expect(g.gold).toBe(50);
  });

  it('counts only the three marked elites for a hunt', () => {
    const g = game(),
      r = enter(g, 'hunt');
    expect(r.targets).toHaveLength(3);
    expect(r.targets.every((e) => e.elite && e.riftTarget)).toBe(true);
    const unrelated = g.spawnEnemy('skeleton', 1000, 1000);
    g.killEnemy(unrelated, {});
    g.rifts.update(0.1);
    expect(r.progress).toBe(0);
    g.killEnemy(r.targets[0]!, {});
    g.rifts.update(0.1);
    expect(r.progress).toBe(1);
    for (const e of r.targets.slice(1)) g.killEnemy(e, {});
    g.rifts.update(0.1);
    expect(r.phase).toBe('complete');
    expect(r.targets.every((e) => !e.riftTarget)).toBe(true);
  });

  it('requires travelling to and channelling all three relay beacons', () => {
    const g = game(),
      r = enter(g, 'relay');
    expect(r.beacons).toHaveLength(3);
    g.rifts.update(3);
    expect(r.progress).toBe(0);
    const first = r.beacons[0]!;
    g.player.x = first.x;
    g.player.y = first.y;
    g.rifts.update(0.6);
    g.player.x += 80;
    g.rifts.update(1);
    expect(first.channel).toBe(0);
    for (const b of r.beacons) {
      g.player.x = b.x;
      g.player.y = b.y;
      g.rifts.update(1.3);
    }
    expect(r.phase).toBe('complete');
    expect(g.rifts.completed).toBe(1);
  });

  it('expires safely without paying for incomplete objectives', () => {
    const g = game(),
      r = enter(g, 'hunt');
    g.rifts.update(66);
    expect(r.phase).toBe('failed');
    expect(g.rifts.offers).toEqual([]);
    expect(g.rifts.completed).toBe(0);
    expect(g.gold).toBe(0);
    expect(r.targets.every((e) => !e.riftTarget)).toBe(true);
  });

  it('freezes an encounter while paused and never rewards a dead champion', () => {
    const g = game(),
      r = enter(g, 'ward'),
      remaining = r.remaining;
    g.state = 'paused';
    g.update(1);
    expect(r.remaining).toBe(remaining);
    g.state = 'over';
    r.progress = WARD_TIME - 0.1;
    g.update(1);
    expect(g.rifts.completed).toBe(0);
    expect(g.rifts.offers).toEqual([]);
  });

  it('validates the actual reward offer and makes the claim a single transaction', () => {
    const g = game();
    seal(g);
    const offered = g.rifts.offers[0]!;
    expect(g.rifts.pick(offered.id)).toBe(false);
    g.state = 'relic';
    expect(g.rifts.pick('not-a-relic')).toBe(false);
    expect(g.rifts.pick(offered.id)).toBe(true);
    expect(g.rifts.pick(offered.id)).toBe(false);
    expect(g.rifts.relics).toEqual([offered.id]);
    expect(g.state).toBe('play');
    const summary = g.summary();
    g.rifts.relics.push('fixture');
    expect(summary.relics).toEqual([offered.id]);
  });

  it('excludes owned relics from subsequent offers and clears run-only power on restart', () => {
    const g = game();
    grant(g, 'rift_lens');
    expect(g.player.stats.area).toBeCloseTo(1.15);
    seal(g);
    expect(g.rifts.offers.some((r) => r.id === 'rift_lens')).toBe(false);
    g.start({ charId: 'kael', stageId: 'ashen', seed: 123, meta: { stats: {}, flags: {}, weaponMastery: {} } });
    expect(g.rifts.relics).toEqual([]);
    expect(g.rifts.stats).toEqual({});
    expect(g.player.stats.area).toBe(1);
  });

  it('applies healing, kill-based dash recharge, and a dash shockwave through combat hooks', () => {
    const g = game();
    grant(g, 'rift_feast');
    grant(g, 'rift_flow');
    grant(g, 'rift_stride');
    const p = g.player;
    p.hp = p.stats.maxHp / 2;
    p.dashCharges = 0;
    p.dashCdT = 1.5;
    for (let i = 0; i < 20; i++) g.killEnemy(g.spawnEnemy('skeleton', 5000, 5000), {});
    expect(p.hp).toBeCloseTo(p.stats.maxHp * 0.54);
    expect(p.dashCdT).toBeCloseTo(0.7);
    p.dashCharges = 1;
    const count = g.fx.novas.length;
    expect(g.evade()).toBe(true);
    expect(g.fx.novas.length).toBe(count + 1);
    g.state = 'paused';
    expect(g.evade()).toBe(false);
    expect(g.fx.novas.length).toBe(count + 1);
  });

  it('is deterministic with the same seed, including placements and relic offers', () => {
    const first = game();
    const a = seal(first);
    const result = [a.x, a.y, first.rifts.offers.map((r) => r.id)];
    const second = game();
    const b = seal(second);
    expect([b.x, b.y, second.rifts.offers.map((r) => r.id)]).toEqual(result);
  });
});

describe('champion animation', () => {
  it('uses simulation time for attacks and gives dash and hurt their own poses', () => {
    const p = game().player;
    p.attackAt = 10;
    expect(heroAnimation(p, 10.1, 0).action).toBe('attack');
    expect(heroAnimation(p, 10.1, 20)).toEqual(heroAnimation(p, 10.1, 0));
    p.castAt = 10;
    expect(heroAnimation(p, 10.1, 0).action).toBe('cast');
    p.dashT = 0.1;
    expect(heroAnimation(p, 10.1, 0).action).toBe('dash');
    p.dashT = 0;
    p.hurtFlash = 0.15;
    expect(heroAnimation(p, 10.1, 0).action).toBe('hurt');
  });

  it('scales the gait with distance instead of time, including analog input', () => {
    const g = game();
    g.input = { moveX: () => 0.25, moveY: () => 0, consumeActive: () => false, consumeDash: () => false };
    g.update(1 / 60);
    const first = g.player.walkT;
    g.input.moveX = () => 1;
    g.update(1 / 60);
    expect(g.player.walkT - first).toBeCloseTo(first * 4);
  });

  it('has bounded joint positions, a distinct northern silhouette, and a still reduced-motion idle', () => {
    const p = game().player;
    p.face.y = -1;
    expect(heroAnimation(p, 0, 3).back).toBe(true);
    expect(heroAnimation(p, 0, 3, true).frame).toBe(0);
    for (const action of Object.keys(HERO_ACTION_FRAMES) as (keyof typeof HERO_ACTION_FRAMES)[]) {
      for (let frame = 0; frame < HERO_ACTION_FRAMES[action]; frame++) {
        const pose = actionPose(action, frame);
        for (const value of Object.values(pose))
          if (typeof value === 'number') expect(Number.isFinite(value) && Math.abs(value) < 10).toBe(true);
      }
    }
    expect(actionPose('attack', 0).reach).toBe(0);
    expect(actionPose('attack', 4).reach).toBeGreaterThan(0.9);
    expect(actionPose('attack', 7).reach).toBeCloseTo(0);
    const walkingAttack = actionPose('attack', 4, 1),
      running = actionPose('run', 3);
    expect(walkingAttack.lx).toBe(running.lx);
    expect(walkingAttack.rx).toBe(running.rx);
    expect(walkingAttack.reach).toBeGreaterThan(0.9);
  });
});
