/* SOULFORGE — save data, meta progression math, forge/talent/codex transactions */
import { LocalStore, type KeyValueStore } from '../core/storage';
import { CHARACTERS, CHAR_BY_ID, FLAG_STATS } from '../data/characters';
import { BESTIARY_STAT, BESTIARY_TIERS, BOSS_STAT, BOSS_TIERS, MILESTONES, PARAGON, charXpFor } from '../data/codex';
import { DAILY_BONUS, DAILY_REROLLS, applyRun, dayNumber, genDaily, genReplacement, genWeekly, weekNumber, type Contract, type ContractContext } from '../data/contracts';
import { AFFIX, ANVIL, ANVIL_TIER_REQ, CATALYSTS, RARITY_BY_ID, SET_BY_ID, SIGILS, SLOT_BY_ID, UNIQUE_BY_ID, anvilCost, craftCost, craftItem, forgeLevelPerks, forgeXpFor, itemStats, metaRng, reforgeCost, salvageValue, setCounts, upgradeCost } from '../data/forge';
import type { AnvilDef, Cost, Item, Reward, SigilDef, TransmuteRecipe } from '../data/forge';
import { OMENS, STAGES } from '../data/passives';
import { ASCENSIONS, ASCENSION_PER_RANK, ASCENSION_STAR_POINTS, MASTERY_DMG_PER_LEVEL, MASTERY_MAX, MAX_ASCENSION, TORMENT_CLEAR, TORMENT_FIRST, TORMENT_MAX, masteryXpFor, masteryXpFromDamage, soulRankPoints, soulXpFor, type AscensionDef, type AscensionFeat } from '../data/progression';
import { ART_BY_ID, ART_MAX_LEVEL, SOUL_ARTS, artUpgradeCost } from '../data/soularts';
import { STARWEB_RESPEC_GOLD, STAR_BY_ID, starConnected, starReachable } from '../data/starweb';
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
export const SAVE_VERSION = 4;
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
  /** v4: Champion Ascension rank (0–10). */
  ascension: number;
  /** v4: highest Torment tier at which this champion survived 15:00. */
  bestTorment: number;
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
  /** v4 */
  apotheoses: number;
  contracts: number;
  bestTorment: number;
  artUses: number;
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
  /** Brightness/density of spell visuals, 0.25–1 (presentation only). */
  fxIntensity: number;
}

export interface ForgeProgress {
  xp: number;
  level: number;
}

/** v4: a level track (Soul Rank, Weapon Mastery): `xp` is progress into the current `level`. */
export interface XpTrack {
  xp: number;
  level: number;
}

/** v4: Night Contracts. */
export interface ContractsSave {
  /** UTC day / week the current contracts were rolled for. */
  day: number;
  week: number;
  list: Contract[];
  weekly: Contract | null;
  /** Rerolls left today. */
  rerolls: number;
  /** Rerolls made (salts the replacement roll). */
  salt: number;
  /** Today's all-three bonus claimed. */
  bonus: boolean;
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
  /** v4: account level (all champions feed it). `level` is the Soul Rank. */
  soul: XpTrack;
  /** v4: lit Starweb stars. */
  starweb: Record<string, boolean>;
  /** v4: weapon id → Weapon Mastery. */
  masteries: Record<string, XpTrack>;
  /** v4: Soul Art id → level (0 / missing = locked) and the one equipped ('' = none). */
  arts: Record<string, number>;
  art: string;
  /** v4: stage id → highest Torment tier survived for 15:00 there. */
  torment: { best: Record<string, number> };
  lastTorment: number;
  contracts: ContractsSave;
}

export interface UnlockEvent {
  type: 'char' | 'stage' | 'milestone' | 'chapter' | 'story' | 'art' | 'torment';
  id: string;
  idx?: number;
  text: string;
}

export type CraftResult = { item: Item; err?: undefined } | { err: string; item?: undefined };

/** What a finished run did to the long-term tracks (shown on the game-over screen). */
export interface RunRecord {
  levelUps: number;
  unlocks: UnlockEvent[];
  /** Soul XP gained and Soul Ranks gained. */
  soulXp: number;
  soulUps: number;
  /** Weapon id → Mastery levels gained this run. */
  masteryUps: Record<string, number>;
  /** Contracts this run completed. */
  contractsDone: Contract[];
  /** New Torment tier unlocked on the run's stage (0 = none). */
  tormentUnlocked: number;
}

export function defaults(): SaveData {
  return {
    v: SAVE_VERSION, gold: 0, embers: 0, mats: { iron: 0, dust: 0, crystal: 0, star: 0, eclipse: 0 },
    chars: {}, anvil: {}, forge: { xp: 0, level: 1 }, items: [], equipped: {}, sigils: {},
    codex: { enemies: {}, bosses: {}, weapons: {}, claimed: {}, uniques: {}, boons: {}, reactions: {} },
    stats: { runs: 0, kills: 0, bossKills: 0, bestTime: 0, bestLevel: 0, evolves: 0, goldEarned: 0, legendaries: 0, bestHeat10: 0, totalTime: 0, elites: 0, bestCombo: 0, reactions: 0, shrines: 0, apotheoses: 0, contracts: 0, bestTorment: 0, artUses: 0 },
    stages: { unlocked: ['ashen'], best: {} },
    omens: {}, lastChar: 'kael', lastStage: 'ashen',
    settings: { sfx: 0.6, music: 0.35, shake: 1, dmgNumbers: true, fps: false, quality: 1, reducedMotion: false, postfx: true, dmgMeter: true, fxIntensity: 1 },
    seen: {}, notices: [],
    story: { prologue: false, read: {} },
    soul: { xp: 0, level: 1 },
    starweb: {},
    masteries: {},
    arts: {},
    art: '',
    torment: { best: {} },
    lastTorment: 0,
    contracts: { day: -1, week: -1, list: [], weekly: null, rerolls: 0, salt: 0, bonus: false },
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
    if (typeof base === 'number' && !Number.isFinite(over)) return base;
    return over as T;
  }
  const out: RawObject = { ...base };
  if (!isPlainObject(over)) return out as T;
  for (const k of Object.keys(over)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
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
  // v3 → v4: the long-term tracks. Veterans keep their history: Soul XP starts at everything their
  // champions have ever earned, and each weapon's Mastery at twice the XP of its best run. Ranks and
  // levels are settled from the XP on load (Save.normalize).
  3: (d) => {
    let xp = 0;
    if (isPlainObject(d.chars)) for (const c of Object.values(d.chars)) {
      if (!isPlainObject(c)) continue;
      const L = Math.min(1000, Math.max(1, Math.floor(Number(c.level) || 1)));
      for (let i = 1; i < L; i++) xp += charXpFor(i);
      xp += Math.max(0, Number(c.xp) || 0);
    }
    const masteries: Record<string, XpTrack> = {};
    const weapons = isPlainObject(d.codex) && isPlainObject(d.codex.weapons) ? d.codex.weapons : {};
    for (const [id, w] of Object.entries(weapons)) if (isPlainObject(w) && Number(w.dmg) > 0) masteries[id] = { xp: masteryXpFromDamage(Number(w.dmg)) * 2, level: 0 };
    return { ...d, soul: { xp, level: 1 }, masteries, v: 4 };
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

const MAT_KEYS = ['iron', 'dust', 'crystal', 'star', 'eclipse'] as const;

const nonnegative = (v: unknown, fallback = 0): number => typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : fallback;
function numericRecord(v: unknown): Record<string, number> {
  if (!isPlainObject(v)) return {};
  return Object.fromEntries(Object.entries(v).filter(([id, n]) => id !== '__proto__' && id !== 'constructor' && id !== 'prototype' && typeof n === 'number' && Number.isFinite(n) && n >= 0)) as Record<string, number>;
}
function booleanRecord(v: unknown): Record<string, boolean> {
  if (!isPlainObject(v)) return {};
  return Object.fromEntries(Object.entries(v).filter(([id, on]) => id !== '__proto__' && id !== 'constructor' && id !== 'prototype' && on === true)) as Record<string, boolean>;
}

/** Preserve usable gear while excluding malformed records that would break the Forge or a run. */
function normalizeItems(v: unknown): Item[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>(), out: Item[] = [];
  for (const it of v) {
    if (!isPlainObject(it) || typeof it.uid !== 'string' || !it.uid || seen.has(it.uid) || typeof it.slot !== 'string' || !Object.hasOwn(SLOT_BY_ID, it.slot) || typeof it.rarity !== 'string' || !Object.hasOwn(RARITY_BY_ID, it.rarity) || !Array.isArray(it.affixes)) continue;
    seen.add(it.uid);
    out.push({
      uid: it.uid, slot: it.slot, rarity: it.rarity,
      name: typeof it.name === 'string' ? it.name : SLOT_BY_ID[it.slot]!.name,
      level: Math.min(RARITY_BY_ID[it.rarity]!.maxUp, Math.floor(nonnegative(it.level))),
      ilvl: Math.max(1, Math.floor(nonnegative(it.ilvl, 1))), spent: nonnegative(it.spent),
      affixes: it.affixes.filter((a): a is { stat: string; base: number } => isPlainObject(a) && typeof a.stat === 'string' && Object.hasOwn(AFFIX, a.stat) && typeof a.base === 'number' && Number.isFinite(a.base) && a.base >= 0),
      ...(typeof it.unique === 'string' && Object.hasOwn(UNIQUE_BY_ID, it.unique) ? { unique: it.unique } : {}),
      ...(typeof it.set === 'string' && Object.hasOwn(SET_BY_ID, it.set) ? { set: it.set } : {}),
    });
  }
  return out;
}

function isTrack(v: unknown): v is XpTrack {
  return isPlainObject(v) && typeof v.xp === 'number' && Number.isFinite(v.xp) && typeof v.level === 'number' && Number.isFinite(v.level);
}
/** Roll surplus XP into levels (`need(L)` = XP from L to L + 1), up to `cap`. */
function settle(t: XpTrack, need: (L: number) => number, cap: number, minLevel = 1): number {
  let ups = 0;
  t.level = Math.max(minLevel, Math.floor(t.level));
  if (cap !== Infinity) t.level = Math.min(t.level, cap);
  t.xp = Math.max(0, t.xp);
  while (t.level < cap && t.xp >= need(t.level)) { t.xp -= need(t.level); t.level++; ups++; }
  if (t.level >= cap) t.xp = 0;
  return ups;
}
function isContract(v: unknown): v is Contract {
  return isPlainObject(v) && typeof v.id === 'string' && typeof v.kind === 'string' && ['kills', 'enemy', 'bosses', 'elites', 'reactions', 'shrines', 'evolves', 'gold', 'charTime', 'stageTime', 'combo', 'level', 'torment'].includes(v.kind)
    && typeof v.target === 'number' && Number.isFinite(v.target) && v.target > 0 && typeof v.progress === 'number' && Number.isFinite(v.progress) && v.progress >= 0
    && typeof v.claimed === 'boolean' && isPlainObject(v.reward) && Object.entries(v.reward).every(([k, n]) => ['gold', 'embers', ...MAT_KEYS].includes(k) && typeof n === 'number' && Number.isFinite(n) && n >= 0)
    && (v.ref === undefined || typeof v.ref === 'string');
}

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
    const before = JSON.stringify(this.data);
    this.normalize();
    if (raw != null && d && before !== JSON.stringify(this.data)) store.set(BACKUP_KEY, raw);
    return this.data;
  },
  /** Ensure every character has a record and the starters are unlocked; settle XP tracks; drop malformed entries. */
  normalize(): void {
    const d = this.data;
    d.gold = nonnegative(d.gold); d.embers = nonnegative(d.embers);
    for (const m of MAT_KEYS) d.mats[m] = nonnegative(d.mats[m]);
    d.items = normalizeItems(d.items);
    for (const slot in d.equipped) if (!d.items.some((it) => it.uid === d.equipped[slot] && it.slot === slot)) delete d.equipped[slot];
    d.anvil = numericRecord(d.anvil); d.omens = numericRecord(d.omens);
    for (const a of ANVIL) if (d.anvil[a.id] != null) d.anvil[a.id] = Math.min(a.max, Math.floor(d.anvil[a.id]!));
    for (const o of OMENS) if (d.omens[o.id] != null) d.omens[o.id] = Math.min(o.max, Math.floor(d.omens[o.id]!));
    d.sigils = booleanRecord(d.sigils);
    d.stages.unlocked = ['ashen', ...new Set(d.stages.unlocked.filter((id) => id !== 'ashen' && STAGES.some((s) => s.id === id)))];
    d.stages.best = numericRecord(d.stages.best); d.torment.best = numericRecord(d.torment.best);
    d.lastTorment = Math.min(TORMENT_MAX, Math.floor(nonnegative(d.lastTorment)));
    d.codex.enemies = numericRecord(d.codex.enemies); d.codex.bosses = numericRecord(d.codex.bosses);
    for (const id in d.codex.weapons) {
      const entry = d.codex.weapons[id];
      if (!isPlainObject(entry)) { delete d.codex.weapons[id]; continue; }
      d.codex.weapons[id] = { found: entry.found === true, maxed: entry.maxed === true, evolved: entry.evolved === true, dmg: nonnegative(entry.dmg) };
    }
    d.forge.level = Math.max(1, Math.floor(nonnegative(d.forge.level, 1))); d.forge.xp = nonnegative(d.forge.xp);
    const s = d.settings;
    s.sfx = Math.min(1, nonnegative(s.sfx)); s.music = Math.min(1, nonnegative(s.music)); s.shake = Math.min(1, nonnegative(s.shake));
    s.quality = [0.6, 0.8, 1].includes(s.quality) ? s.quality : 1;
    s.fxIntensity = Math.max(0.1, Math.min(1, nonnegative(s.fxIntensity, 1)));
    CHARACTERS.forEach((c) => this.charData(c.id));
    d.chars.kael!.unlocked = d.chars.lyra!.unlocked = d.chars.talon!.unlocked = true;
    if (!isTrack(d.soul)) d.soul = { xp: 0, level: 1 };
    settle(d.soul, soulXpFor, Infinity);
    for (const id in d.masteries) { const m = d.masteries[id]; if (!isTrack(m) || !Object.hasOwn(WEAPONS, id)) { delete d.masteries[id]; continue; } settle(m, masteryXpFor, MASTERY_MAX, 0); }
    for (const id in d.starweb) if (!Object.hasOwn(STAR_BY_ID, id) || id === 'origin' || d.starweb[id] !== true) delete d.starweb[id];
    for (const id in d.arts) { if (!Object.hasOwn(ART_BY_ID, id) || !Number.isFinite(d.arts[id])) delete d.arts[id]; else d.arts[id] = Math.min(ART_MAX_LEVEL, Math.floor(nonnegative(d.arts[id]))); }
    if (d.art && !(d.arts[d.art]! >= 1)) d.art = '';
    const cs = d.contracts;
    cs.list = Array.isArray(cs.list) ? cs.list.filter(isContract) : [];
    if (cs.weekly != null && !isContract(cs.weekly)) cs.weekly = null;
    if (cs.list.length !== 3) cs.day = -1;
    if (!Object.hasOwn(CHAR_BY_ID, d.lastChar) || !this.charUnlocked(d.lastChar)) d.lastChar = 'kael';
    if (!d.stages.unlocked.includes(d.lastStage)) d.lastStage = 'ashen';
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
    try { const saved = store.set(SAVE_KEY, JSON.stringify(this.data)); dirty = !saved; return saved; } catch { return false; }
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
    if (!isPlainObject(parsed) || !isPlainObject(parsed.chars) || rawVersion(parsed) > SAVE_VERSION) return false;
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
    const c = isPlainObject(this.data.chars[id]) ? this.data.chars[id]! : (this.data.chars[id] = {} as CharSave);
    c.unlocked = c.unlocked === true;
    c.xp = nonnegative(c.xp); c.level = Math.max(1, Math.floor(nonnegative(c.level, 1))); c.talents = numericRecord(c.talents); c.paragon = numericRecord(c.paragon);
    c.runs = nonnegative(c.runs); c.kills = nonnegative(c.kills); c.bosses = nonnegative(c.bosses); c.bestTime = nonnegative(c.bestTime); c.bestLevel = nonnegative(c.bestLevel); c.chapters = booleanRecord(c.chapters);
    c.ascension = Math.min(MAX_ASCENSION, Math.max(0, Math.floor(Number(c.ascension) || 0))); c.bestTorment = c.bestTorment || 0;
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
  /** Points a node needs in its branch. */
  nodeReq(node: TalentNode): number { return node.req ?? node.tier * 4; },
  nodeAvailable(id: string, node: TalentNode): boolean { return this.branchPoints(id, node.branch) >= this.nodeReq(node) && this.charData(id).ascension >= (node.asc ?? 0); },
  buyTalent(id: string, node: TalentNode): string | null {
    const c = this.charData(id);
    if (this.talentPointsFree(id) <= 0) return 'No talent points.';
    if (c.ascension < (node.asc ?? 0)) return 'Requires Ascension ' + ASCENSIONS[(node.asc ?? 1) - 1]!.numeral + '.';
    if (!this.nodeAvailable(id, node)) return 'Requires ' + this.nodeReq(node) + ' points in this branch.';
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
    // free Soul Arts arrive with Soul Rank; the others announce themselves once they can be bought
    SOUL_ARTS.forEach((a) => {
      if ((d.arts[a.id] || 0) >= 1 || this.soulRank() < a.rank) return;
      const free = !Object.keys(a.cost).length;
      if (free) { d.arts[a.id] = 1; if (!d.art) d.art = a.id; }
      if (!d.seen['art_' + a.id]) { d.seen['art_' + a.id] = true; out.push({ type: 'art', id: a.id, text: free ? 'Soul Art awakened: ' + a.name + ' (R in a run)' : 'Soul Art available: ' + a.name }); }
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
    // talents (an Apex makes every rank in its branch count 50% more)
    ch.talents.forEach((b) => {
      const apex = b.nodes.some((n) => n.apex && (c.talents[n.id] || 0) > 0) ? 1.5 : 1;
      b.nodes.forEach((n) => { const r = c.talents[n.id] || 0; if (!r) return; if (n.per) addAll(n.per, r * apex); if (n.flag) { flags[n.flag] = true; if (FLAG_STATS[n.flag]) addAll(FLAG_STATS[n.flag]!); } });
    });
    PARAGON.forEach((p) => { const r = c.paragon[p.id] || 0; if (r) add(p.stat, p.per * r); });
    // codex chapters
    ch.codex.forEach((chap, i) => { if (!c.chapters[i]) return; const rw = chap.reward; if (rw.stats) addAll(rw.stats); if (rw.flag) { flags[rw.flag] = true; if (FLAG_STATS[rw.flag]) addAll(FLAG_STATS[rw.flag]!); } });
    // equipment, and the sets its pieces belong to
    const worn: Item[] = [];
    for (const slot in d.equipped) { const it = d.items.find((x) => x.uid === d.equipped[slot]); if (!it) continue; worn.push(it); addAll(itemStats(it)); if (it.unique) { const u = UNIQUE_BY_ID[it.unique]; if (u && u.flag) flags[u.flag] = true; } }
    const sets = setCounts(worn);
    for (const id in sets) for (const b of SET_BY_ID[id]!.bonuses) if (sets[id]! >= b.n) { if (b.stats) addAll(b.stats); if (b.flag) flags[b.flag] = true; }
    // the Starweb (account-wide)
    for (const id in d.starweb) { const s = STAR_BY_ID[id]; if (!s || !d.starweb[id]) continue; if (s.stats) addAll(s.stats); if (s.flag) flags[s.flag] = true; }
    // Champion Ascension
    for (const a of ASCENSIONS) { if (a.rank > c.ascension) break; addAll(ASCENSION_PER_RANK); if (a.stats) addAll(a.stats); if (a.flag) flags[a.flag] = true; }
    // sigils
    SIGILS.forEach((s) => { if (!d.sigils[s.id]) return; if (s.stats) addAll(s.stats); if (s.flag) flags[s.flag] = true; });
    // bestiary / boss codex bonuses
    for (const id in d.codex.enemies) { const t = this.bestiaryTier(id); if (t) addAll(BESTIARY_STAT, t); }
    for (const id in d.codex.bosses) { const t = this.bossTier(id); if (t) addAll(BOSS_STAT, t); }
    // armory stages and Weapon Mastery levels
    const weaponLevels: Record<string, number> = {};
    for (const wid in d.codex.weapons) { const w = d.codex.weapons[wid]!; let m = 0; if (w.maxed) m += 0.05; if (w.evolved) m += 0.1; if (m) weaponMastery[wid] = m; }
    for (const wid in d.masteries) { const L = d.masteries[wid]!.level; if (L > 0) { weaponLevels[wid] = L; weaponMastery[wid] = (weaponMastery[wid] || 0) + L * MASTERY_DMG_PER_LEVEL; } }
    return { stats, flags, weaponMastery, weaponLevels, ascension: c.ascension };
  },
  /* ---------- Soul Rank & the Starweb ---------- */
  soulRank(): number { return this.data.soul.level; },
  addSoulXp(xp: number): number { const s = this.data.soul; s.xp += Math.max(0, xp); return settle(s, soulXpFor, Infinity); },
  /** Total Starweb points: Soul Rank plus every Ascension rank across the roster. */
  starPoints(): number { let asc = 0; for (const id in this.data.chars) asc += this.charData(id).ascension; return soulRankPoints(this.soulRank()) + asc * ASCENSION_STAR_POINTS; },
  starsLit(): number { let n = 0; for (const id in this.data.starweb) if (this.data.starweb[id]) n++; return n; },
  starPointsFree(): number { return this.starPoints() - this.starsLit(); },
  lightStar(id: string): string | null {
    const d = this.data, s = STAR_BY_ID[id];
    if (!s || s.kind === 'origin') return 'Unknown star.';
    if (d.starweb[id]) return 'Already lit.';
    if (this.starPointsFree() <= 0) return 'No Starweb points. Raise your Soul Rank or ascend a champion.';
    if (!starReachable(id, d.starweb)) return 'Light a neighbouring star first.';
    d.starweb[id] = true; this.save(); return null;
  },
  /** Unlight one star (free) if nothing else depends on it. */
  unlightStar(id: string): string | null {
    const d = this.data;
    if (!d.starweb[id]) return 'Not lit.';
    const keep = starConnected(d.starweb, id);
    for (const k in d.starweb) if (d.starweb[k] && k !== id && !keep.has(k)) return 'Other lit stars depend on this one.';
    delete d.starweb[id]; this.save(); return null;
  },
  starRespecCost(): number { return this.starsLit() * STARWEB_RESPEC_GOLD; },
  respecStarweb(): string | null {
    const cost = this.starRespecCost();
    if (!cost) return 'Nothing to reset.';
    if (this.data.gold < cost) return 'Not enough gold.';
    this.pay({ gold: cost }); this.data.starweb = {}; this.save(); return null;
  },
  /* ---------- Champion Ascension ---------- */
  featMet(charId: string, f: AscensionFeat): boolean {
    const c = this.charData(charId);
    switch (f.kind) {
      case 'time': return c.bestTime >= f.v;
      case 'bosses': return c.bosses >= f.v;
      case 'level': return c.bestLevel >= f.v;
      case 'kills': return c.kills >= f.v;
      case 'torment': return c.bestTorment >= f.v;
    }
  },
  featProgress(charId: string, f: AscensionFeat): number {
    const c = this.charData(charId);
    return f.kind === 'time' ? c.bestTime : f.kind === 'bosses' ? c.bosses : f.kind === 'level' ? c.bestLevel : f.kind === 'kills' ? c.kills : c.bestTorment;
  },
  nextAscension(charId: string): AscensionDef | null { return ASCENSIONS[this.charData(charId).ascension] ?? null; },
  /** Why `charId` can't ascend yet (empty when it can). */
  ascendBlockers(charId: string): string[] {
    const c = this.charData(charId), a = this.nextAscension(charId), out: string[] = [];
    if (!a) return ['Fully ascended.'];
    if (!c.unlocked) out.push('Champion locked.');
    if (c.level < a.level) out.push('Reach character level ' + a.level + '.');
    if (!this.featMet(charId, a.feat)) out.push('Feat not yet achieved.');
    if (!this.canAfford(a.cost)) out.push('Not enough resources.');
    return out;
  },
  ascend(charId: string): string | null {
    const a = this.nextAscension(charId), why = this.ascendBlockers(charId);
    if (!a || why.length) return why[0] ?? 'Cannot ascend.';
    this.pay(a.cost); this.charData(charId).ascension = a.rank; this.save(); return null;
  },
  /* ---------- Weapon Mastery ---------- */
  mastery(wid: string): XpTrack { return this.data.masteries[wid] ?? { xp: 0, level: 0 }; },
  masteryLevel(wid: string): number { return this.data.masteries[wid]?.level ?? 0; },
  /** Add Mastery XP to a weapon; returns levels gained. */
  addMasteryXp(wid: string, xp: number): number {
    if (!WEAPONS[wid] || xp <= 0) return 0;
    const m = this.data.masteries[wid] ??= { xp: 0, level: 0 };
    if (m.level >= MASTERY_MAX) return 0;
    m.xp += xp;
    let ups = 0;
    while (m.level < MASTERY_MAX && m.xp >= masteryXpFor(m.level)) { m.xp -= masteryXpFor(m.level); m.level++; ups++; }
    if (m.level >= MASTERY_MAX) m.xp = 0;
    return ups;
  },
  /* ---------- Soul Arts ---------- */
  artLevel(id: string): number { return this.data.arts[id] || 0; },
  buyArt(id: string): string | null {
    const a = ART_BY_ID[id]; if (!a) return 'Unknown art.';
    if (this.artLevel(id) >= 1) return 'Already known.';
    if (this.soulRank() < a.rank) return 'Requires Soul Rank ' + a.rank + '.';
    if (!this.canAfford(a.cost)) return 'Not enough resources.';
    this.pay(a.cost); this.data.arts[id] = 1; if (!this.data.art) this.data.art = id; this.save(); return null;
  },
  upgradeArt(id: string): string | null {
    const L = this.artLevel(id);
    if (L < 1) return 'Not yet learned.';
    if (L >= ART_MAX_LEVEL) return 'Mastered.';
    const cost = artUpgradeCost(L); if (!this.canAfford(cost)) return 'Not enough resources.';
    this.pay(cost); this.data.arts[id] = L + 1; this.save(); return null;
  },
  equipArt(id: string): void { if (id === '' || this.artLevel(id) >= 1) { this.data.art = id; this.save(); } },
  /** The art to bring into a run (null when none is equipped). */
  runArt(): { id: string; level: number } | null { const id = this.data.art; return id && this.artLevel(id) >= 1 ? { id, level: this.artLevel(id) } : null; },
  /* ---------- Torment ---------- */
  /** Highest Torment tier playable on a stage (0 = only Normal). */
  tormentMax(stageId: string): number {
    const d = this.data;
    if ((d.stages.best[stageId] || 0) < TORMENT_FIRST) return 0;
    return Math.min(TORMENT_MAX, 1 + (d.torment.best[stageId] || 0));
  },
  /** Highest Torment tier playable anywhere. */
  tormentAnywhere(): number { let t = 0; for (const s of STAGES) t = Math.max(t, this.tormentMax(s.id)); return t; },
  /* ---------- Night Contracts ---------- */
  /** Wall clock for contracts (tests replace it). */
  now: (): number => Date.now(),
  contractContext(): ContractContext {
    const d = this.data, charNames: Record<string, string> = {};
    CHARACTERS.forEach((c) => (charNames[c.id] = c.name));
    return { rank: this.soulRank(), chars: CHARACTERS.filter((c) => this.charData(c.id).unlocked).map((c) => c.id), stages: d.stages.unlocked.slice(), torment: this.tormentAnywhere(), charNames };
  },
  /** Roll today's / this week's contracts if the calendar moved on. Returns true if anything changed. */
  refreshContracts(): boolean {
    const cs = this.data.contracts, t = this.now(), day = dayNumber(t), week = weekNumber(t);
    let changed = false;
    if (cs.day !== day) { cs.day = day; cs.list = genDaily(day, this.contractContext()); cs.rerolls = DAILY_REROLLS; cs.bonus = false; cs.salt = 0; changed = true; }
    if (cs.week !== week || !cs.weekly) { cs.week = week; cs.weekly = genWeekly(week, this.contractContext()); changed = true; }
    if (changed) this.save();
    return changed;
  },
  findContract(id: string): Contract | null { const cs = this.data.contracts; return cs.list.find((c) => c.id === id) ?? (cs.weekly && cs.weekly.id === id ? cs.weekly : null); },
  claimContract(id: string): string | null {
    const c = this.findContract(id);
    if (!c) return 'No such contract.';
    if (c.claimed) return 'Already claimed.';
    if (c.progress < c.target) return 'Not complete.';
    c.claimed = true; this.grant(c.reward); this.data.stats.contracts++; this.save(); return null;
  },
  dailyBonusReady(): boolean { const cs = this.data.contracts; return !cs.bonus && cs.list.length > 0 && cs.list.every((c) => c.claimed); },
  claimDailyBonus(): string | null { if (!this.dailyBonusReady()) return 'Claim all three contracts first.'; this.data.contracts.bonus = true; this.grant(DAILY_BONUS); this.save(); return null; },
  rerollContract(id: string): string | null {
    const cs = this.data.contracts, i = cs.list.findIndex((c) => c.id === id);
    if (i < 0) return 'Only daily contracts can be rerolled.';
    if (cs.rerolls <= 0) return 'No rerolls left today.';
    if (cs.list[i]!.claimed) return 'Already claimed.';
    const next = genReplacement(cs.day, this.contractContext(), ++cs.salt, cs.list.map((c) => c.kind));
    if (!next) return 'Nothing else to offer today.';
    cs.list[i] = next; cs.rerolls--; this.save(); return null;
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
    if (!Object.hasOwn(SLOT_BY_ID, slotId)) return { err: 'Unknown equipment slot.' };
    const cat = CATALYSTS.find((c) => c.id === catalystId) || CATALYSTS[0]!;
    if (cat.req && !forgeLevelPerks(L)[cat.req]) return { err: 'This catalyst is not unlocked yet.' };
    const full: Cost = Object.assign({}, cost, cat.cost);
    if (!this.canAfford(full)) return { err: 'Not enough resources.' };
    if (d.items.length >= 60) return { err: 'Inventory full (60). Salvage something.' };
    this.pay(full);
    const luck = 0;
    const item = craftItem(slotId, L, { minRarity: cat.minRarity, luck, set: cat.set });
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
    if (!Number.isInteger(affixIdx) || !it.affixes[affixIdx]) return 'No such affix.';
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
    if (!Number.isSafeInteger(times) || times < 1) return 'Invalid quantity.';
    if (!forgeLevelPerks(this.data.forge.level).transmute) return 'Requires Forge level 2.';
    if (!this.canAfford(rec.from)) return 'Not enough materials.';
    for (let i = 0; i < times && this.canAfford(rec.from); i++) { this.pay(rec.from); this.grant(rec.to); }
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
      case 'soul': return this.soulRank() >= u.v;
      case 'ascension': return Object.keys(d.chars).some((id) => this.charData(id).ascension >= u.v);
      case 'torment': return d.stats.bestTorment >= u.v;
    }
  },
  /* ---------- run results ---------- */
  recordRun(r: RunSummary): RunRecord {
    const d = this.data, c = this.charData(r.charId);
    const tormentBefore = this.tormentMax(r.stageId);
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
    d.stats.apotheoses += r.apotheoses || 0;
    d.stats.artUses += r.artUses || 0;
    if ((r.torment || 0) > 0 && r.time >= TORMENT_CLEAR) {
      d.torment.best[r.stageId] = Math.max(d.torment.best[r.stageId] || 0, r.torment);
      c.bestTorment = Math.max(c.bestTorment, r.torment); d.stats.bestTorment = Math.max(d.stats.bestTorment, r.torment);
    }
    for (const b of r.boons || []) d.codex.boons[b] = true;
    if (r.time >= 600) d.stats.bestHeat10 = Math.max(d.stats.bestHeat10, r.heat);
    d.stages.best[r.stageId] = Math.max(d.stages.best[r.stageId] || 0, r.time);
    this.grant({ gold: r.gold, embers: r.embers, iron: r.mats.iron, dust: r.mats.dust, crystal: r.mats.crystal, star: r.mats.star, eclipse: r.mats.eclipse || 0 });
    for (const id in r.enemyKills) d.codex.enemies[id] = (d.codex.enemies[id] || 0) + r.enemyKills[id]!;
    for (const id in r.bossKillsBy) d.codex.bosses[id] = (d.codex.bosses[id] || 0) + r.bossKillsBy[id]!;
    r.weapons.forEach((w) => { const e = d.codex.weapons[w.id] || (d.codex.weapons[w.id] = {}); const def = WEAPONS[w.id]; e.found = true; if (def && w.level >= def.max) e.maxed = true; if (w.evolved) e.evolved = true; e.dmg = Math.max(e.dmg || 0, w.dmg || 0); });
    const ups = this.addCharXp(r.charId, r.charXp);
    // long-term tracks
    const soulUps = this.addSoulXp(r.charXp);
    const masteryUps: Record<string, number> = {};
    for (const w of r.weapons) { const n = this.addMasteryXp(w.id, masteryXpFromDamage(w.dmg || 0)); if (n) masteryUps[w.id] = n; }
    this.refreshContracts();
    const contractsDone: Contract[] = [];
    for (const k of [...d.contracts.list, ...(d.contracts.weekly ? [d.contracts.weekly] : [])]) if (applyRun(k, r)) contractsDone.push(k);
    const tormentAfter = this.tormentMax(r.stageId);
    const unlocks = this.checkUnlocks();
    if (tormentAfter > tormentBefore) unlocks.push({ type: 'torment', id: r.stageId, text: 'Torment ' + tormentAfter + ' unlocked in ' + (STAGES.find((s) => s.id === r.stageId)?.name ?? r.stageId) });
    this.save();
    this.flush();
    return { levelUps: ups, unlocks, soulXp: Math.max(0, r.charXp), soulUps, masteryUps, contractsDone, tormentUnlocked: tormentAfter > tormentBefore ? tormentAfter : 0 };
  },
};

/* Never lose the last few hundred ms of changes when the tab is hidden or closed. */
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('pagehide', () => Save.flush());
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') Save.flush(); });

export { Save };
