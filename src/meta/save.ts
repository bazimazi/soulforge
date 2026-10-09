/* SOULFORGE — save data, meta progression math, forge/talent/codex transactions */
import { LocalStore, type KeyValueStore } from '../core/storage';
import { CHARACTERS, CHAR_BY_ID, FLAG_STATS } from '../data/characters';
import { BESTIARY_STAT, BESTIARY_TIERS, BOSS_STAT, BOSS_TIERS, MILESTONES, PARAGON, charXpFor } from '../data/codex';
import { AFFIX, ANVIL, ANVIL_TIER_REQ, CATALYSTS, RARITY_BY_ID, SIGILS, SLOT_BY_ID, UNIQUE_BY_ID, anvilCost, craftCost, craftItem, forgeLevelPerks, forgeXpFor, itemStats, metaRng, reforgeCost, salvageValue, upgradeCost } from '../data/forge';
import type { AnvilDef, Cost, Item, Reward, SigilDef, TransmuteRecipe } from '../data/forge';
import { STAGES } from '../data/passives';
import { CHRONICLE, type ChronicleChapter } from '../data/story';
import { WEAPONS } from '../data/weapons';
import type { Flags, Materials, MetaBonuses, RunSummary, StatBag, TalentNode } from '../game/types';

/* ------------------------------------------------------------------ */
/* Save shape                                                         */
/* ------------------------------------------------------------------ */

/** Storage key. Kept at "_v1" for compatibility; the schema version lives in `SaveData.v`. */
export const SAVE_KEY = 'soulforge_save_v1';
/** Last unreadable save, or the save that an import replaced. */
export const BACKUP_KEY = 'soulforge_save_backup';
export const SAVE_VERSION = 3;
/** Coalescing window for `Save.save()`. */
export const SAVE_DEBOUNCE_MS = 250;

export interface CharSave {
  unlocked: boolean;
  xp: number;
  level: number;
  /** Talent node id → rank. */
  talents: Record<string, number>;
  /** Paragon id → rank. */
  paragon: Record<string, number>;
  runs: number;
  kills: number;
  bosses: number;
  bestTime: number;
  bestLevel: number;
  /** Codex chapter index → claimed. */
  chapters: Record<number, boolean>;
}

export interface WeaponCodexEntry {
  found?: boolean;
  maxed?: boolean;
  evolved?: boolean;
  /** Best damage dealt in a single run. */
  dmg?: number;
}

export interface CodexSave {
  /** Enemy type → lifetime kills. */
  enemies: Record<string, number>;
  /** Boss id → lifetime kills (0 = encountered). */
  bosses: Record<string, number>;
  weapons: Record<string, WeaponCodexEntry>;
  claimed: Record<string, boolean>;
  uniques: Record<string, boolean>;
  /** v3: boons taken and elemental reactions triggered at least once. */
  boons: Record<string, boolean>;
  reactions: Record<string, boolean>;
}

export interface LifetimeStats {
  runs: number;
  kills: number;
  bossKills: number;
  bestTime: number;
  bestLevel: number;
  evolves: number;
  goldEarned: number;
  legendaries: number;
  /** Highest Heat at which 10 minutes were survived. */
  bestHeat10: number;
  totalTime: number;
  elites: number;
  /** v3 */
  bestCombo: number;
  reactions: number;
  shrines: number;
}

export interface StageProgress {
  unlocked: string[];
  /** Stage id → best survival time (s). */
  best: Record<string, number>;
}

export interface Settings {
  sfx: number;
  music: number;
  shake: number;
  dmgNumbers: boolean;
  fps: boolean;
  quality: number;
  /** v2: tone down screen shake/flashes. */
  reducedMotion: boolean;
  /** v3: bloom & colour grading. */
  postfx: boolean;
  /** Live damage meter open in the HUD (toggled with T). */
  dmgMeter: boolean;
}

export interface ForgeProgress {
  xp: number;
  level: number;
}

export interface SaveData {
  v: number;
  gold: number;
  embers: number;
  mats: Materials;
  chars: Record<string, CharSave>;
  /** Anvil id → rank. */
  anvil: Record<string, number>;
  forge: ForgeProgress;
  items: Item[];
  /** Slot id → item uid. */
  equipped: Record<string, string>;
  sigils: Record<string, boolean>;
  codex: CodexSave;
  stats: LifetimeStats;
  stages: StageProgress;
  /** Omen id → rank. */
  omens: Record<string, number>;
  lastChar: string;
  lastStage: string;
  settings: Settings;
  seen: Record<string, boolean>;
  notices: string[];
  /** v3: narrative progress — prologue shown, chronicle chapters read. */
  story: { prologue: boolean; read: Record<string, boolean> };
}

export interface UnlockEvent {
  type: 'char' | 'stage' | 'milestone' | 'chapter' | 'story';
  id: string;
  idx?: number;
  text: string;
}

export type CraftResult = { item: Item; err?: undefined } | { err: string; item?: undefined };

export function defaults(): SaveData {
  return {
    v: SAVE_VERSION, gold: 0, embers: 0, mats: { iron: 0, dust: 0, crystal: 0, star: 0 },
    chars: {}, anvil: {}, forge: { xp: 0, level: 1 }, items: [], equipped: {}, sigils: {},
    codex: { enemies: {}, bosses: {}, weapons: {}, claimed: {}, uniques: {}, boons: {}, reactions: {} },
    stats: { runs: 0, kills: 0, bossKills: 0, bestTime: 0, bestLevel: 0, evolves: 0, goldEarned: 0, legendaries: 0, bestHeat10: 0, totalTime: 0, elites: 0, bestCombo: 0, reactions: 0, shrines: 0 },
    stages: { unlocked: ['ashen'], best: {} },
    omens: {}, lastChar: 'kael', lastStage: 'ashen',
    settings: { sfx: 0.6, music: 0.35, shake: 1, dmgNumbers: true, fps: false, quality: 1, reducedMotion: false, postfx: true, dmgMeter: true },
    seen: {}, notices: [],
    story: { prologue: false, read: {} },
  };
}

/* ------------------------------------------------------------------ */
/* Merging & migrations                                               */
/* ------------------------------------------------------------------ */

type RawObject = Record<string, unknown>;

function isPlainObject(v: unknown): v is RawObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Overlay `over` onto `base` (which supplies defaults and the expected shape).
 * Plain objects merge recursively; arrays and primitives from `over` replace the base value only
 * when they have the same kind, so a corrupt field falls back to its default instead of
 * poisoning the save. Keys absent from `base` (dynamic records like `chars`) are copied as-is.
 */
export function deepMerge<T>(base: T, over: unknown): T {
  if (Array.isArray(base)) return (Array.isArray(over) ? over : base) as T;
  if (!isPlainObject(base)) {
    if (over === undefined) return base;
    if (base !== null && (typeof over !== typeof base || over === null || Array.isArray(over))) return base;
    return over as T;
  }
  const out: RawObject = { ...base };
  if (!isPlainObject(over)) return out as T;
  for (const k of Object.keys(over)) {
    if (k === '__proto__') continue;
    out[k] = k in base ? deepMerge(base[k], over[k]) : over[k];
  }
  return out as T;
}

/** One step per schema version: `MIGRATIONS[n]` upgrades a v`n` save to v`n+1`. */
const MIGRATIONS: Record<number, (d: RawObject) => RawObject> = {
  // v1 → v2: settings gained `reducedMotion`.
  1: (d) => {
    const settings = isPlainObject(d.settings) ? { ...d.settings } : {};
    if (typeof settings.reducedMotion !== 'boolean') settings.reducedMotion = false;
    return { ...d, settings, v: 2 };
  },
  // v2 → v3: codex.boons/reactions, stats.bestCombo/reactions/shrines and `story` — all filled from
  // defaults by the merge. A save that already played counts as having seen the prologue.
  2: (d) => {
    const story = isPlainObject(d.story) ? d.story : { prologue: isPlainObject(d.stats) && Number(d.stats.runs) > 0, read: {} };
    return { ...d, story, v: 3 };
  },
};

/** Version a raw save claims to be (saves from before versioning count as v1). */
function rawVersion(raw: RawObject): number {
  return typeof raw.v === 'number' && Number.isFinite(raw.v) && raw.v >= 1 ? Math.floor(raw.v) : 1;
}

/**
 * Bring any parsed save up to {@link SAVE_VERSION} and fill missing fields from defaults.
 * Returns null when `raw` is not a save object at all. Never throws.
 */
export function migrate(raw: unknown): SaveData | null {
  if (!isPlainObject(raw)) return null;
  try {
    let d = raw;
    for (let v = rawVersion(raw); v < SAVE_VERSION; v++) {
      const step = MIGRATIONS[v];
      if (step) d = step(d);
    }
    const merged = deepMerge(defaults(), d);
    merged.v = SAVE_VERSION;
    return merged;
  } catch {
    return null;
  }
}

function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function decodeBase64(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/* ------------------------------------------------------------------ */
/* Persistence                                                        */
/* ------------------------------------------------------------------ */

const MAT_KEYS = ['iron', 'dust', 'crystal', 'star'] as const;

let store: KeyValueStore = new LocalStore();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let dirty = false;

function cancelPending(): void {
  if (flushTimer != null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}

const Save = {
  data: defaults(),

  /** Swap the persistence backend (tests, alternative storage). Drops any pending write. */
  useStore(s: KeyValueStore): void {
    cancelPending();
    dirty = false;
    store = s;
  },
  load(): SaveData {
    cancelPending();
    dirty = false;
    const raw = store.get(SAVE_KEY);
    let d: SaveData | null = null;
    if (raw != null) {
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { parsed = null; }
      d = migrate(parsed);
      // keep anything we could not read (or that came from a newer build) so it is never lost
      if (!d || (isPlainObject(parsed) && rawVersion(parsed) > SAVE_VERSION)) store.set(BACKUP_KEY, raw);
    }
    this.data = d ?? defaults();
    this.normalize();
    return this.data;
  },
  /** Ensure every character has a record and the starters are unlocked. */
  normalize(): void {
    CHARACTERS.forEach((c) => this.charData(c.id));
    this.data.chars.kael!.unlocked = this.data.chars.lyra!.unlocked = this.data.chars.talon!.unlocked = true;
  },
  /** Request a write. Rapid calls coalesce into one write ~{@link SAVE_DEBOUNCE_MS} later. */
  save(): void {
    dirty = true;
    if (flushTimer != null) return;
    if (typeof setTimeout === 'function') flushTimer = setTimeout(() => { flushTimer = null; Save.flush(); }, SAVE_DEBOUNCE_MS);
    else this.flush();
  },
  /** Write any pending changes now. Returns false if the data could only be kept in memory. */
  flush(): boolean {
    cancelPending();
    if (!dirty) return true;
    dirty = false;
    try { return store.set(SAVE_KEY, JSON.stringify(this.data)); } catch { return false; }
  },
  reset(): void {
    cancelPending();
    dirty = false;
    store.remove(SAVE_KEY);
    this.load();
    this.save();
    this.flush();
  },
  export(): string { return encodeBase64(JSON.stringify(this.data)); },
  /** Replace the save with an exported string (base64, or raw JSON). The current save is backed up first. */
  import(str: string): boolean {
    let parsed: unknown;
    try {
      const s = str.trim();
      parsed = JSON.parse(s.startsWith('{') ? s : decodeBase64(s));
    } catch {
      return false;
    }
    if (!isPlainObject(parsed) || !isPlainObject(parsed.chars)) return false;
    const d = migrate(parsed);
    if (!d) return false;
    try { store.set(BACKUP_KEY, JSON.stringify(this.data)); } catch { /* ignore */ }
    this.data = d;
    this.normalize();
    this.save();
    this.flush();
    return true;
  },
  charData(id: string): CharSave {
    const c = this.data.chars[id] || (this.data.chars[id] = {} as CharSave);
    if (c.unlocked == null) c.unlocked = false;
    c.xp = c.xp || 0; c.level = c.level || 1; c.talents = c.talents || {}; c.paragon = c.paragon || {};
    c.runs = c.runs || 0; c.kills = c.kills || 0; c.bosses = c.bosses || 0; c.bestTime = c.bestTime || 0; c.bestLevel = c.bestLevel || 0; c.chapters = c.chapters || {};
    return c;
  },
  /* ---------- character xp / talents ---------- */
  addCharXp(id: string, xp: number): number {
    const c = this.charData(id); c.xp += xp; let ups = 0;
    while (c.xp >= charXpFor(c.level)) { c.xp -= charXpFor(c.level); c.level++; ups++; }
    return ups;
  },
  talentPointsUsed(id: string): number { const c = this.charData(id); let n = 0; for (const k in c.talents) n += c.talents[k]!; for (const k in c.paragon) n += c.paragon[k]!; return n; },
  talentPointsFree(id: string): number { const c = this.charData(id); return c.level - 1 - this.talentPointsUsed(id); },
  branchPoints(id: string, branchId: string): number { const c = this.charData(id); const def = CHAR_BY_ID[id]!; let n = 0; def.talents.forEach((b) => { if (b.id === branchId) b.nodes.forEach((nd) => (n += c.talents[nd.id] || 0)); }); return n; },
  nodeAvailable(id: string, node: TalentNode): boolean { const pts = this.branchPoints(id, node.branch); return pts >= node.tier * 4; },
  buyTalent(id: string, node: TalentNode): string | null {
    const c = this.charData(id);
    if (this.talentPointsFree(id) <= 0) return 'No talent points.';
    if (!this.nodeAvailable(id, node)) return 'Requires ' + node.tier * 4 + ' points in this branch.';
    if ((c.talents[node.id] || 0) >= node.max) return 'Maxed.';
    c.talents[node.id] = (c.talents[node.id] || 0) + 1; this.save(); return null;
  },
  buyParagon(id: string, pid: string): string | null { const c = this.charData(id); if (this.talentPointsFree(id) <= 0) return 'No talent points.'; c.paragon[pid] = (c.paragon[pid] || 0) + 1; this.save(); return null; },
  respec(id: string): void { const c = this.charData(id); c.talents = {}; c.paragon = {}; this.save(); },
  allTalentsMaxed(id: string): boolean { const def = CHAR_BY_ID[id]!; const c = this.charData(id); return def.talents.every((b) => b.nodes.every((n) => (c.talents[n.id] || 0) >= n.max)); },
  /* ---------- unlock checks ---------- */
  charUnlocked(id: string): boolean { return !!this.charData(id).unlocked; },
  checkUnlocks(): UnlockEvent[] {
    const d = this.data, out: UnlockEvent[] = [];
    CHARACTERS.forEach((ch) => {
      const c = this.charData(ch.id); if (c.unlocked) return;
      const u = ch.unlock, v = u.v ?? Infinity; let ok = false; // a missing threshold never unlocks
      if (u.type === 'start') ok = true;
      else if (u.type === 'time') ok = d.stats.bestTime >= v;
      else if (u.type === 'kills') ok = d.stats.kills >= v;
      else if (u.type === 'boss') ok = d.stats.bossKills >= v;
      else if (u.type === 'level') ok = d.stats.bestLevel >= v;
      else if (u.type === 'evolve') ok = d.stats.evolves >= v;
      else if (u.type === 'charlevel') ok = Object.values(d.chars).some((x) => x.level >= v);
      if (ok) { c.unlocked = true; out.push({ type: 'char', id: ch.id, text: 'New character: ' + ch.name + ', ' + ch.title }); }
    });
    STAGES.forEach((s) => {
      if (d.stages.unlocked.includes(s.id)) return;
      if (s.unlock && (d.stages.best[s.unlock.stage] || 0) >= s.unlock.time) { d.stages.unlocked.push(s.id); out.push({ type: 'stage', id: s.id, text: 'New stage: ' + s.name }); }
    });
    MILESTONES.forEach((m) => {
      if (d.codex.claimed['ms_' + m.id]) return;
      try { if (m.check(d) && !d.seen['ms_' + m.id]) { d.seen['ms_' + m.id] = true; out.push({ type: 'milestone', id: m.id, text: 'Milestone: ' + m.name }); } } catch { /* malformed save field */ }
    });
    CHARACTERS.forEach((ch) => {
      const c = this.charData(ch.id);
      ch.codex.forEach((chap, i) => {
        if (c.chapters[i]) return;
        if (this.chapterMet(ch.id, i) && !d.seen['ch_' + ch.id + i]) { d.seen['ch_' + ch.id + i] = true; out.push({ type: 'chapter', id: ch.id, idx: i, text: ch.name + ' — chapter unlocked: ' + chap.title }); }
      });
    });
    CHRONICLE.forEach((ch) => {
      if (this.chronicleUnlocked(ch) && !d.seen['lore_' + ch.id]) { d.seen['lore_' + ch.id] = true; out.push({ type: 'story', id: ch.id, text: 'The Long Night — a new chapter: ' + ch.title }); }
    });
    return out;
  },
  chapterMet(charId: string, i: number): boolean {
    const c = this.charData(charId), req = CHAR_BY_ID[charId]!.codex[i]!.req;
    if (req.type === 'runs') return c.runs >= req.v;
    if (req.type === 'time') return c.bestTime >= req.v;
    if (req.type === 'kills') return c.kills >= req.v;
    if (req.type === 'bosses') return c.bosses >= req.v;
    return false;
  },
  claimChapter(charId: string, i: number): boolean { const c = this.charData(charId); if (c.chapters[i] || !this.chapterMet(charId, i)) return false; c.chapters[i] = true; this.save(); return true; },
  /* ---------- meta stat aggregation ---------- */
  computeMeta(charId: string): MetaBonuses {
    const d = this.data, ch = CHAR_BY_ID[charId]!, c = this.charData(charId);
    const stats: StatBag = {}, flags: Flags = {}, weaponMastery: Record<string, number> = {};
    const add = (k: string, v: number): void => { stats[k] = (stats[k] || 0) + v; };
    const addAll = (o: StatBag, m = 1): void => { for (const k in o) add(k, o[k]! * m); };
    // anvil
    ANVIL.forEach((a) => { const r = d.anvil[a.id] || 0; if (r) add(a.stat, a.per * r); });
    // talents
    ch.talents.forEach((b) => b.nodes.forEach((n) => { const r = c.talents[n.id] || 0; if (!r) return; if (n.per) addAll(n.per, r); if (n.flag) { flags[n.flag] = true; if (FLAG_STATS[n.flag]) addAll(FLAG_STATS[n.flag]!); } }));
    PARAGON.forEach((p) => { const r = c.paragon[p.id] || 0; if (r) add(p.stat, p.per * r); });
    // codex chapters
    ch.codex.forEach((chap, i) => { if (!c.chapters[i]) return; const rw = chap.reward; if (rw.stats) addAll(rw.stats); if (rw.flag) { flags[rw.flag] = true; if (FLAG_STATS[rw.flag]) addAll(FLAG_STATS[rw.flag]!); } });
    // equipment
    for (const slot in d.equipped) { const it = d.items.find((x) => x.uid === d.equipped[slot]); if (!it) continue; addAll(itemStats(it)); if (it.unique) { const u = UNIQUE_BY_ID[it.unique]; if (u && u.flag) flags[u.flag] = true; } }
    // sigils
    SIGILS.forEach((s) => { if (!d.sigils[s.id]) return; if (s.stats) addAll(s.stats); if (s.flag) flags[s.flag] = true; });
    // bestiary / boss codex bonuses
    for (const id in d.codex.enemies) { const t = this.bestiaryTier(id); if (t) addAll(BESTIARY_STAT, t); }
    for (const id in d.codex.bosses) { const t = this.bossTier(id); if (t) addAll(BOSS_STAT, t); }
    // armory mastery
    for (const wid in d.codex.weapons) { const w = d.codex.weapons[wid]!; let m = 0; if (w.maxed) m += 0.05; if (w.evolved) m += 0.1; if (m) weaponMastery[wid] = m; }
    return { stats, flags, weaponMastery };
  },
  bestiaryTier(id: string): number { const k = this.data.codex.enemies[id] || 0; let t = 0; BESTIARY_TIERS.forEach((v) => { if (k >= v) t++; }); return t; },
  bossTier(id: string): number { const k = this.data.codex.bosses[id] || 0; let t = 0; BOSS_TIERS.forEach((v) => { if (k >= v) t++; }); return t; },
  /* ---------- currencies ---------- */
  canAfford(cost: Cost): boolean { const d = this.data; if (cost.gold && d.gold < cost.gold) return false; if (cost.embers && d.embers < cost.embers) return false; for (const m of MAT_KEYS) { const need = cost[m] || (cost.mats && cost.mats[m]) || 0; if (d.mats[m] < need) return false; } return true; },
  pay(cost: Cost): void { const d = this.data; if (cost.gold) { d.gold -= cost.gold; this.addForgeXp(cost.gold); } if (cost.embers) d.embers -= cost.embers; for (const m of MAT_KEYS) { const need = cost[m] || (cost.mats && cost.mats[m]) || 0; d.mats[m] -= need; } },
  grant(rw: Reward): void { const d = this.data; if (rw.gold) { d.gold += rw.gold; d.stats.goldEarned += rw.gold; } if (rw.embers) d.embers += rw.embers; for (const m of MAT_KEYS) if (rw[m]) d.mats[m] += rw[m]; },
  addForgeXp(xp: number): number { const f = this.data.forge; f.xp += xp; let ups = 0; while (f.xp >= forgeXpFor(f.level)) { f.xp -= forgeXpFor(f.level); f.level++; ups++; } return ups; },
  /* ---------- forge transactions ---------- */
  anvilTotal(): number { let n = 0; for (const k in this.data.anvil) n += this.data.anvil[k]!; return n; },
  buyAnvil(a: AnvilDef): string | null {
    const d = this.data, r = d.anvil[a.id] || 0;
    if (r >= a.max) return 'Maxed.';
    if (this.anvilTotal() < ANVIL_TIER_REQ[a.tier]!) return 'Locked.';
    const cost = anvilCost(a, r);
    if (d.gold < cost) return 'Not enough gold.';
    this.pay({ gold: cost }); d.anvil[a.id] = r + 1; this.save(); return null;
  },
  craft(slotId: string, catalystId: string): CraftResult {
    const d = this.data, L = d.forge.level, cost = craftCost(L);
    const cat = CATALYSTS.find((c) => c.id === catalystId) || CATALYSTS[0]!;
    const full: Cost = Object.assign({}, cost, cat.cost);
    if (!this.canAfford(full)) return { err: 'Not enough resources.' };
    if (d.items.length >= 60) return { err: 'Inventory full (60). Salvage something.' };
    this.pay(full);
    const luck = 0;
    const item = craftItem(slotId, L, { minRarity: cat.minRarity, luck });
    item.spent = cost.gold;
    d.items.push(item);
    if (RARITY_BY_ID[item.rarity]!.index >= 4) d.stats.legendaries++;
    if (item.unique) d.codex.uniques[item.unique] = true;
    this.save();
    return { item };
  },
  upgradeItem(uid: string): string | null {
    const d = this.data, it = d.items.find((x) => x.uid === uid); if (!it) return 'No item.';
    const r = RARITY_BY_ID[it.rarity]!; if (it.level >= r.maxUp) return 'Max upgrade level.';
    const cost = upgradeCost(it); if (!this.canAfford(cost)) return 'Not enough resources.';
    this.pay(cost); it.level++; it.spent += cost.gold; this.save(); return null;
  },
  salvage(uid: string): Reward | null {
    const d = this.data, i = d.items.findIndex((x) => x.uid === uid); if (i < 0) return null;
    const it = d.items[i]!; const v = salvageValue(it);
    for (const slot in d.equipped) if (d.equipped[slot] === uid) delete d.equipped[slot];
    d.items.splice(i, 1); this.grant(v); this.save(); return v;
  },
  reforge(uid: string, affixIdx: number): string | null {
    const d = this.data, it = d.items.find((x) => x.uid === uid); if (!it) return 'No item.';
    if (!forgeLevelPerks(d.forge.level).reforge) return 'Requires Forge level 3.';
    const cost = reforgeCost(); if (!this.canAfford(cost)) return 'Not enough resources.';
    const slot = SLOT_BY_ID[it.slot]!; const used = it.affixes.map((a) => a.stat);
    const pool = slot.affixes.filter((s) => !used.includes(s) || s === it.affixes[affixIdx]!.stat);
    const stat = metaRng.pick(pool), rng = AFFIX[stat]!, r = RARITY_BY_ID[it.rarity]!;
    this.pay(cost); it.spent += cost.gold;
    it.affixes[affixIdx] = { stat, base: metaRng.range(rng[0], rng[1]) * forgeLevelPerks(it.ilvl).valueMult * r.mult * 1.1 };
    this.save(); return null;
  },
  equip(uid: string): void { const d = this.data, it = d.items.find((x) => x.uid === uid); if (!it) return; d.equipped[it.slot] = uid; this.save(); },
  unequip(slot: string): void { delete this.data.equipped[slot]; this.save(); },
  transmute(rec: TransmuteRecipe, times = 1): string | null {
    for (let i = 0; i < times; i++) { if (!this.canAfford(rec.from)) return i === 0 ? 'Not enough materials.' : null; this.pay(rec.from); this.grant(rec.to); }
    this.save(); return null;
  },
  buySigil(s: SigilDef): string | null { const d = this.data; if (d.sigils[s.id]) return 'Owned.'; if (d.embers < s.cost) return 'Not enough Soul Embers.'; d.embers -= s.cost; d.sigils[s.id] = true; this.save(); return null; },
  /* ---------- codex ---------- */
  claim(key: string, reward: Reward): boolean { const d = this.data; if (d.codex.claimed[key]) return false; d.codex.claimed[key] = true; this.grant(reward); this.save(); return true; },
  /**
   * Record a first encounter reported by the simulation's `discover` event. Can fire mid-run, so it
   * does not write; the next `recordRun` (or any other save) persists it.
   */
  discover(kind: 'weapon' | 'boss' | 'boon' | 'reaction', id: string): void {
    const cx = this.data.codex;
    if (kind === 'weapon') (cx.weapons[id] ??= {}).found = true;
    else if (kind === 'boss') cx.bosses[id] = cx.bosses[id] || 0;
    else if (kind === 'boon') cx.boons[id] = true;
    else cx.reactions[id] = true;
  },
  /* ---------- the main story ---------- */
  /** Has the player's progress revealed this chapter of The Long Night? */
  chronicleUnlocked(ch: ChronicleChapter): boolean {
    const d = this.data, u = ch.unlock;
    switch (u.kind) {
      case 'runs': return d.stats.runs >= u.v;
      case 'bossKill': return (d.codex.bosses[u.ref] || 0) >= 1;
      case 'bosses': return d.stats.bossKills >= u.v;
      case 'stage': return d.stages.unlocked.includes(u.ref);
      case 'time': return d.stats.bestTime >= u.v;
      case 'stageTime': return (d.stages.best[u.ref] || 0) >= u.v;
      case 'forge': return d.forge.level >= u.v;
      case 'chars': return Object.values(d.chars).filter((c) => c.unlocked).length >= u.v;
    }
  },
  /* ---------- run results ---------- */
  recordRun(r: RunSummary): { levelUps: number; unlocks: UnlockEvent[] } {
    const d = this.data, c = this.charData(r.charId);
    d.stats.runs++; c.runs++;
    d.stats.kills += r.kills; c.kills += r.kills;
    d.stats.bossKills += r.bossKills; c.bosses += r.bossKills;
    d.stats.elites += r.elites || 0;
    d.stats.totalTime += r.time;
    d.stats.bestTime = Math.max(d.stats.bestTime, r.time); c.bestTime = Math.max(c.bestTime, r.time);
    d.stats.bestLevel = Math.max(d.stats.bestLevel, r.level); c.bestLevel = Math.max(c.bestLevel, r.level);
    d.stats.evolves += r.evolves;
    d.stats.bestCombo = Math.max(d.stats.bestCombo, r.bestCombo || 0);
    d.stats.reactions += r.reactions || 0;
    d.stats.shrines += r.shrines || 0;
    for (const b of r.boons || []) d.codex.boons[b] = true;
    if (r.time >= 600) d.stats.bestHeat10 = Math.max(d.stats.bestHeat10, r.heat);
    d.stages.best[r.stageId] = Math.max(d.stages.best[r.stageId] || 0, r.time);
    this.grant({ gold: r.gold, embers: r.embers, iron: r.mats.iron, dust: r.mats.dust, crystal: r.mats.crystal, star: r.mats.star });
    for (const id in r.enemyKills) d.codex.enemies[id] = (d.codex.enemies[id] || 0) + r.enemyKills[id]!;
    for (const id in r.bossKillsBy) d.codex.bosses[id] = (d.codex.bosses[id] || 0) + r.bossKillsBy[id]!;
    r.weapons.forEach((w) => { const e = d.codex.weapons[w.id] || (d.codex.weapons[w.id] = {}); const def = WEAPONS[w.id]; e.found = true; if (def && w.level >= def.max) e.maxed = true; if (w.evolved) e.evolved = true; e.dmg = Math.max(e.dmg || 0, w.dmg || 0); });
    const ups = this.addCharXp(r.charId, r.charXp);
    const unlocks = this.checkUnlocks();
    this.save();
    this.flush();
    return { levelUps: ups, unlocks };
  },
};

/* Never lose the last few hundred ms of changes when the tab is hidden or closed. */
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('pagehide', () => Save.flush());
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') Save.flush(); });

export { Save };
