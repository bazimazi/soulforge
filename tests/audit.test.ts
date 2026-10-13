import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalStore, MemoryStore } from '../src/core/storage';
import { TRANSMUTE } from '../src/data/forge';
import { BOONS } from '../src/data/boons';
import { masteryXpFor } from '../src/data/progression';
import { Game, DASH } from '../src/game/game';
import type { InputSource } from '../src/game/types';
import { Save, SAVE_KEY, BACKUP_KEY, defaults } from '../src/meta/save';
import { FX } from '../src/render/fx';

const step = 1 / 60;
function arena(input?: InputSource): Game {
  const g = new Game(new FX(), input);
  g.start({ charId: 'kael', stageId: 'ashen', seed: 12, meta: { stats: {}, flags: {}, weaponMastery: {} } });
  return g;
}

describe('review regressions: movement and combat', () => {
  it('fast projectiles hit the first crossed enemy and explode at impact', () => {
    const g = arena();
    g.player.weapons = [];
    const far = g.spawnEnemy('ghoul', 85, 0),
      near = g.spawnEnemy('ghoul', 45, 0);
    far.speed = near.speed = 0;
    far.hp = far.maxHp = near.hp = near.maxHp = 1000;
    let impact = -1;
    g.spawnProj({
      x: 0,
      y: 0,
      angle: 0,
      speed: 7200,
      r: 4,
      dmg: 10,
      pierce: 0,
      life: 1,
      weapon: { id: 'test' },
      crit: -10,
      onHit: (_g, pr) => {
        impact = pr.x;
      },
    });
    g.update(step);
    expect(near.hp).toBeLessThan(1000);
    expect(far.hp).toBe(1000);
    expect(impact).toBeGreaterThan(0);
    expect(impact).toBeLessThan(45);
  });

  it('fast enemy bolts cannot pass straight through a stationary player', () => {
    const g = arena();
    g.player.stats.dodge = 0;
    g.spawnEnemyProj(-60, 0, 0, 7200, 10);
    g.update(step);
    expect(g.player.hp).toBeLessThan(g.player.stats.maxHp);
  });

  it('swept hits preserve piercing, ricochets, and nearby misses', () => {
    for (const ricochet of [0, 1]) {
      const g = arena();
      g.player.weapons = [];
      const near = g.spawnEnemy('ghoul', 45, 0),
        far = g.spawnEnemy('ghoul', 85, 0),
        miss = g.spawnEnemy('ghoul', 65, 45);
      for (const e of [near, far, miss]) {
        e.speed = 0;
        e.hp = e.maxHp = 1000;
      }
      g.spawnProj({
        x: 0,
        y: 0,
        angle: 0,
        speed: 7200,
        r: 4,
        dmg: 10,
        pierce: ricochet ? 0 : 1,
        ricochet,
        life: 1,
        weapon: { id: 'test' },
        crit: -10,
      });
      g.update(step);
      expect(near.hp).toBeLessThan(1000);
      if (ricochet) {
        expect(far.hp).toBe(1000);
        g.update(step);
      }
      expect(far.hp).toBeLessThan(1000);
      expect(miss.hp).toBe(1000);
    }
  });

  it('does not interpolate teleports across the arena', () => {
    const g = arena();
    g.blink(1, 0, 150);
    expect(g.player.px).toBe(g.player.x);
    const e = g.spawnEnemy('ghoul', 1e6, 1e6);
    g.update(step);
    expect(Math.hypot(e.x - e.px, e.y - e.py)).toBeLessThan(10);
  });
  it('applies knockback and burn bonuses once at the point of impact', () => {
    const measure = (bonus: number) => {
      const g = arena();
      const w = g.addWeapon('fireball');
      g.player.dyn.knockback = bonus - g.player.stats.knockback;
      g.player.dyn.burnDmg = bonus - g.player.stats.burnDmg;
      g.recalc();
      const e = g.spawnEnemy('brute', 100, 0);
      g.damageEnemy(e, 1, { weapon: w, knock: w.s!.knock, crit: -10 });
      g.applyStatus(e, 'burn', { dur: 3, dps: w.s!.dmg * w.s!.burn });
      return [e.vx, e.st.burn!.dps];
    };
    const base = measure(0),
      boosted = measure(0.5);
    expect(boosted[0]! / base[0]!).toBeCloseTo(1.5);
    expect(boosted[1]! / base[1]!).toBeCloseTo(1.5);
  });

  it('burns the direct target of an unevolved fireball', () => {
    const g = arena();
    g.player.weapons = [];
    g.addWeapon('fireball');
    const e = g.spawnEnemy('brute', 80, 0);
    e.hp = e.maxHp = 10000;
    e.speed = 0;
    for (let i = 0; i < 30; i++) g.update(step);
    expect(e.st.burn?.dps).toBeGreaterThan(0);
  });

  it('caps chill so strong slows cannot reverse enemy movement', () => {
    const g = arena();
    const e = g.spawnEnemy('brute', 100, 0);
    g.applyStatus(e, 'chill', { dur: 3, power: 1.6 });
    expect(e.st.chill!.p).toBe(1);
  });

  it('diagonal movement keeps a unit facing vector and credits only distance travelled', () => {
    const g = arena({ moveX: () => 1, moveY: () => 1, consumeActive: () => false, consumeDash: () => false });
    g.update(step);
    const p = g.player;
    expect(Math.hypot(p.face.x, p.face.y)).toBeCloseTo(1);
    expect(p.movedDist).toBeCloseTo(Math.hypot(p.x, p.y));
  });

  it('a dash travels exactly its declared distance, including its partial final step', () => {
    const g = arena();
    g.evade();
    for (let i = 0; i < 30; i++) g.update(step);
    expect(Math.hypot(g.player.x, g.player.y)).toBeCloseTo(DASH.dist);
  });

  it('taking damage immediately removes streak bonuses below their threshold', () => {
    const g = arena();
    const might = g.player.stats.might;
    for (let i = 0; i < 25; i++) g.killEnemy(g.spawnEnemy('ghoul', 500, 500), {});
    expect(g.comboTier).toBe(1);
    g.player.stats.dodge = 0;
    g.hitPlayer(10);
    expect(g.combo).toBe(18);
    expect(g.comboTier).toBe(0);
    expect(g.player.stats.might).toBeCloseTo(might);
  });

  it('a new run clears the previous cause of death', () => {
    const g = arena();
    g.lastHitBy = 'old enemy';
    g.start({ charId: 'kael', stageId: 'ashen', seed: 12, meta: { stats: {}, flags: {}, weaponMastery: {} } });
    expect(g.summary().killedBy).toBe('');
  });

  it('does not heal a dead champion or collect pickups after a lethal projectile', () => {
    const g = arena();
    g.player.stats.dodge = 0;
    g.spawnEnemyProj(g.player.x, g.player.y, 0, 0, 10000);
    g.spawnPickup({ kind: 'food', x: 0, y: 0 });
    g.update(step);
    expect(g.state).toBe('over');
    expect(g.player.hp).toBe(0);
    g.heal(1000);
    expect(g.player.hp).toBe(0);
    expect(g.pickups.some((p) => p.kind === 'food' && !p.dead)).toBe(true);
  });

  it('keeps legendary boons obtainable after every ordinary boon has been taken', () => {
    const g = arena();
    g.eclipse = true;
    g.player.boons = BOONS.filter((b) => b.rarity !== 'legendary').map((b) => b.id);
    const options = g.boonOptions();
    expect(options.length).toBeGreaterThan(0);
    expect(options.every((b) => b.rarity === 'legendary')).toBe(true);
  });

  it('records Soul Art damage separately from the champion ability', () => {
    const g = arena();
    g.damageEnemy(g.spawnEnemy('brute', 200, 0), 10, { weapon: { id: 'art', ability: true }, crit: -10 });
    expect(g.dmgByWeapon.art).toBe(10);
    expect(g.dmgByWeapon.skill).toBeUndefined();
  });

  it.each(['lyra', 'morrow', 'vesper', 'zephyr'])('%s sustained ability benefits from Ability Rank', (id) => {
    const hit = (rank: number) => {
      const g = arena();
      g.start({ charId: id, stageId: 'ashen', seed: 25, meta: { stats: { crit: -10 }, flags: {}, weaponMastery: {} } });
      g.player.weapons = [];
      g.player.abilityRank = rank;
      const foe = g.spawnEnemy('brute', 50, 0);
      foe.hp = foe.maxHp = 1e8;
      foe.speed = 0;
      g.grid.insert(foe);
      g.useActive();
      for (let i = 0; i < 10; i++) g.update(step);
      return g.dmgByWeapon.skill ?? 0;
    };
    const base = hit(0);
    expect(base).toBeGreaterThan(0);
    expect(hit(5)).toBeCloseTo(base * 2);
  });
});

describe('review regressions: progression and persistence', () => {
  beforeEach(() => {
    Save.useStore(new MemoryStore());
    Save.load();
  });

  it('does not award mastery level one on reload before its XP has been earned', () => {
    Save.addMasteryXp('fireball', masteryXpFor(0) - 1);
    Save.save();
    Save.flush();
    Save.load();
    expect(Save.mastery('fireball')).toEqual({ level: 0, xp: masteryXpFor(0) - 1 });
    Save.addMasteryXp('fireball', 1);
    expect(Save.mastery('fireball')).toEqual({ level: 1, xp: 0 });
  });

  it('saves the completed part of a bulk transmutation when materials run out', () => {
    Save.data.forge.level = 2;
    Save.data.mats.iron = 25;
    expect(Save.transmute(TRANSMUTE[0]!, 10)).toBeNull();
    Save.flush();
    Save.load();
    expect(Save.data.mats.iron).toBe(5);
    expect(Save.data.mats.dust).toBe(2);
  });

  it('retries a failed durable save on the next flush', () => {
    const store = new MemoryStore();
    Save.useStore(store);
    Save.load();
    const write = vi.spyOn(store, 'set').mockReturnValueOnce(false);
    Save.data.gold = 77;
    Save.save();
    expect(Save.flush()).toBe(false);
    expect(Save.flush()).toBe(true);
    expect(write).toHaveBeenCalledTimes(2);
    expect(JSON.parse(store.get(SAVE_KEY)!).gold).toBe(77);
  });

  it('keeps the latest session data readable after a quota failure', () => {
    let value = 'old';
    vi.stubGlobal('localStorage', {
      getItem: () => value,
      setItem: (_key: string, next: string) => {
        if (next === 'new') throw new Error('quota');
        value = next;
      },
      removeItem: () => {
        value = '';
      },
    });
    try {
      const store = new LocalStore();
      expect(store.set('save', 'new')).toBe(false);
      expect(store.get('save')).toBe('new');
      expect(store.set('save', 'newer')).toBe(true);
      expect(store.get('save')).toBe('newer');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('recovers malformed nested records without discarding valid progress', () => {
    const d = defaults();
    const raw = {
      ...d,
      gold: 12345,
      chars: { kael: 42, lyra: { level: 12, xp: 200, talents: null } },
      items: [null, { uid: 'bad', slot: 'invalid' }],
      equipped: { ring: 'bad' },
      codex: { weapons: { fireball: null } },
      arts: { sunfall: 1000 },
      settings: { quality: -1, music: 8 },
    };
    expect(() => Save.import(JSON.stringify(raw))).not.toThrow();
    expect(Save.data.gold).toBe(12345);
    expect(Save.charData('lyra').level).toBe(12);
    expect(Save.charData('lyra').xp).toBe(200);
    expect(Save.charUnlocked('kael')).toBe(true);
    expect(Save.data.items).toEqual([]);
    expect(Save.data.equipped).toEqual({});
    expect(Save.data.settings.quality).toBe(1);
    expect(Save.data.settings.music).toBe(1);
    expect(Save.artLevel('sunfall')).toBe(5);
    expect(() => Save.computeMeta('kael')).not.toThrow();
  });

  it('does not spend resources on a locked catalyst or an invalid gear slot', () => {
    Save.data.gold = 5000;
    Save.data.mats = { iron: 500, dust: 500, crystal: 500, star: 500, eclipse: 500 };
    expect(Save.craft('ring', 'star').err).toBeTruthy();
    expect(Save.craft('missing', 'none').err).toBeTruthy();
    expect(Save.data.gold).toBe(5000);
    expect(Save.data.items).toEqual([]);
  });

  it('keeps a recoverable copy when malformed saved records need repair', () => {
    const store = new MemoryStore();
    const raw = JSON.stringify({ ...defaults(), gold: 456, items: [null] });
    store.set(SAVE_KEY, raw);
    Save.useStore(store);
    Save.load();
    expect(Save.data.gold).toBe(456);
    expect(store.get(BACKUP_KEY)).toBe(raw);
    expect(Save.import(JSON.stringify({ ...defaults(), v: 999 }))).toBe(false);
    expect(Save.data.gold).toBe(456);
  });

  it('regenerates malformed contracts before rendering their rewards', () => {
    const d = defaults();
    d.contracts.day = Math.floor(Date.now() / 86400000);
    const raw = {
      ...d,
      contracts: {
        ...d.contracts,
        list: [null, { id: 'bad', kind: 'kills', target: 2, progress: 0, claimed: false, reward: { nonsense: 4 } }],
      },
    };
    expect(Save.import(JSON.stringify(raw))).toBe(true);
    Save.refreshContracts();
    expect(Save.data.contracts.list).toHaveLength(3);
    expect(Save.data.contracts.list.every((c) => c.id !== 'bad')).toBe(true);
  });

  it('keeps deleted local data deleted in-session when storage denies removal', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => 'old',
      removeItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });
    try {
      const store = new LocalStore();
      store.remove('save');
      expect(store.get('save')).toBeNull();
      store.set('save', 'replacement');
      expect(store.get('save')).toBe('replacement');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
