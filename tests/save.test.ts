import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStore } from '../src/core/storage';
import type { RunSummary } from '../src/game/types';
import { BACKUP_KEY, SAVE_KEY, SAVE_VERSION, Save, defaults, migrate } from '../src/meta/save';

let store: MemoryStore;

function v1Save(): Record<string, unknown> {
  const d: any = defaults();
  d.v = 1;
  delete d.settings.reducedMotion; // field introduced in v2
  delete d.story; // introduced in v3
  d.stats.runs = 3;
  d.gold = 1234;
  d.embers = 7;
  d.chars = {
    kael: {
      unlocked: true,
      xp: 10,
      level: 5,
      talents: { k1: 2 },
      paragon: {},
      runs: 3,
      kills: 100,
      bosses: 0,
      bestTime: 120,
      bestLevel: 12,
      chapters: {},
    },
  };
  return d;
}

function run(over: Partial<RunSummary> = {}): RunSummary {
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
    mats: { iron: 3, dust: 1, crystal: 0, star: 0 },
    enemyKills: { bat: 30, ghoul: 20 },
    bossKillsBy: {},
    dmgByWeapon: {},
    weapons: [],
    passives: [],
    eclipse: false,
    killedBy: 'Ghoul',
    bestCombo: 40,
    reactions: 3,
    boons: [],
    shrines: 1,
    ...over,
  };
}

beforeEach(() => {
  store = new MemoryStore();
  Save.useStore(store);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('Save.load', () => {
  it('loads defaults from an empty store', () => {
    const d = Save.load();
    expect(d.v).toBe(SAVE_VERSION);
    expect(d.gold).toBe(0);
    expect(d.stages.unlocked).toEqual(['ashen']);
    expect(d.settings.reducedMotion).toBe(false);
    expect(Save.charUnlocked('kael')).toBe(true);
    expect(Save.charUnlocked('seraphine')).toBe(false);
    expect(store.get(BACKUP_KEY)).toBeNull();
  });

  it('migrates a v1 save and preserves progress', () => {
    store.set(SAVE_KEY, JSON.stringify(v1Save()));
    const d = Save.load();
    expect(d.v).toBe(SAVE_VERSION);
    expect(d.gold).toBe(1234);
    expect(d.embers).toBe(7);
    expect(d.chars.kael!.level).toBe(5);
    expect(d.chars.kael!.talents).toEqual({ k1: 2 });
    expect(d.settings.reducedMotion).toBe(false);
    expect(d.settings.sfx).toBe(0.6);
    expect(d.chars.lyra!.unlocked).toBe(true); // missing chars are filled in
    // v3: a veteran save skips the prologue and gains the new codex/stat fields
    expect(d.story.prologue).toBe(true);
    expect(d.codex.boons).toEqual({});
    expect(d.stats.bestCombo).toBe(0);
  });

  it('records v3 run stats (combo, reactions, boons)', () => {
    Save.load();
    Save.recordRun(run({ bestCombo: 140, reactions: 9, boons: ['b_chain'], shrines: 2 }));
    Save.recordRun(run({ bestCombo: 60, reactions: 1 }));
    expect(Save.data.stats.bestCombo).toBe(140);
    expect(Save.data.stats.reactions).toBe(10);
    expect(Save.data.stats.shrines).toBe(3);
    expect(Save.data.codex.boons.b_chain).toBe(true);
  });

  it('treats an unversioned save as v1', () => {
    const raw = v1Save();
    delete raw.v;
    expect(migrate(raw)?.gold).toBe(1234);
  });

  it('falls back to defaults on corrupt JSON and keeps a backup', () => {
    store.set(SAVE_KEY, '{"gold": 12, oops');
    const d = Save.load();
    expect(d.gold).toBe(0);
    expect(store.get(BACKUP_KEY)).toBe('{"gold": 12, oops');
  });

  it('falls back to defaults when the save is not an object', () => {
    store.set(SAVE_KEY, '42');
    expect(Save.load().gold).toBe(0);
    expect(store.get(BACKUP_KEY)).toBe('42');
  });

  it('ignores corrupt fields with the wrong type', () => {
    const raw: any = v1Save();
    raw.gold = 'lots';
    raw.stats = null;
    raw.stages = { unlocked: 'ashen', best: {} };
    const d = migrate(raw)!;
    expect(d.gold).toBe(0);
    expect(d.stats.runs).toBe(0);
    expect(d.stages.unlocked).toEqual(['ashen']);
  });
});

describe('export / import', () => {
  it('round-trips the save', () => {
    Save.load();
    Save.data.gold = 999;
    Save.data.lastChar = 'lyra';
    Save.data.items.push({
      uid: 'x1',
      slot: 'ring',
      rarity: 'rare',
      level: 2,
      affixes: [{ stat: 'luck', base: 0.05 }],
      ilvl: 3,
      name: 'Ring of Ünïcode ✦',
      spent: 10,
    });
    const str = Save.export();

    const other = new MemoryStore();
    Save.useStore(other);
    Save.load();
    expect(Save.data.gold).toBe(0);
    expect(Save.import(str)).toBe(true);
    expect(Save.data.gold).toBe(999);
    expect(Save.data.lastChar).toBe('lyra');
    expect(Save.data.items[0]!.name).toBe('Ring of Ünïcode ✦');
    // persisted immediately, previous save backed up
    expect(JSON.parse(other.get(SAVE_KEY)!).gold).toBe(999);
    expect(JSON.parse(other.get(BACKUP_KEY)!).gold).toBe(0);
  });

  it('rejects garbage without touching the save', () => {
    Save.load();
    Save.data.gold = 5;
    expect(Save.import('not base64 at all!!')).toBe(false);
    expect(Save.import(btoa('{"gold": 1}'))).toBe(false); // no chars
    expect(Save.data.gold).toBe(5);
  });
});

describe('recordRun', () => {
  it('applies currency, kills and best time, and persists immediately', () => {
    Save.load();
    const res = Save.recordRun(run());
    const d = Save.data;
    expect(d.gold).toBe(100);
    expect(d.embers).toBe(2);
    expect(d.mats.iron).toBe(3);
    expect(d.stats.kills).toBe(50);
    expect(d.stats.bestTime).toBe(60);
    expect(d.codex.enemies.bat).toBe(30);
    expect(d.chars.kael!.runs).toBe(1);
    expect(res.unlocks.some((u) => u.type === 'milestone' && u.id === 'first_run')).toBe(true);
    expect(JSON.parse(store.get(SAVE_KEY)!).gold).toBe(100);
  });

  it('unlocks Seraphine after surviving 300s', () => {
    Save.load();
    expect(Save.recordRun(run({ time: 299 })).unlocks.some((u) => u.id === 'seraphine')).toBe(false);
    const res = Save.recordRun(run({ time: 300 }));
    expect(res.unlocks).toContainEqual(expect.objectContaining({ type: 'char', id: 'seraphine' }));
    expect(Save.charUnlocked('seraphine')).toBe(true);
    expect(Save.data.stats.bestTime).toBe(300);
  });
});

describe('discover', () => {
  it('records weapons and bosses without writing', () => {
    Save.load();
    Save.discover('weapon', 'w_test');
    Save.discover('boss', 'bone_colossus');
    expect(Save.data.codex.weapons.w_test).toEqual({ found: true });
    expect(Save.data.codex.bosses.bone_colossus).toBe(0);
    Save.data.codex.bosses.bone_colossus = 3;
    Save.discover('boss', 'bone_colossus');
    expect(Save.data.codex.bosses.bone_colossus).toBe(3);
    expect(store.get(SAVE_KEY)).toBeNull();
  });
});

describe('debounced save', () => {
  it('coalesces rapid calls into one write', () => {
    vi.useFakeTimers();
    Save.load();
    const spy = vi.spyOn(store, 'set');
    for (let i = 0; i < 20; i++) {
      Save.data.settings.sfx = i / 20;
      Save.save();
    }
    expect(spy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(store.get(SAVE_KEY)!).settings.sfx).toBe(19 / 20);
  });

  it('flush writes pending changes immediately and only once', () => {
    vi.useFakeTimers();
    Save.load();
    const spy = vi.spyOn(store, 'set');
    Save.data.gold = 77;
    Save.save();
    Save.flush();
    expect(spy).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    Save.flush();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(store.get(SAVE_KEY)!).gold).toBe(77);
  });
});
