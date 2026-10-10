/**
 * SOULFORGE — core simulation.
 *
 * Headless and deterministic: the simulation never touches the DOM, audio or UI. It advances in
 * fixed steps (see core/loop.ts), draws all randomness from the seeded `simRng`, reads input
 * through an `InputSource`, and reports everything observable through `events` (GameEvents).
 * The same class runs in the browser and in Node-based simulation tests.
 */
import { Emitter } from '../core/events';
import { rand, simRng } from '../core/rng';
import { SpatialHash } from '../core/spatial-hash';
import { U } from '../core/util';
import { CHAR_BASE, CHAR_BY_ID } from '../data/characters';
import { BOONS, BOON_BY_ID } from '../data/boons';
import { AFFIX_BY_ID, BLOOD_MOON, BOSSES, BOSS_ORDER, CASK, ELITE_AFFIXES, ENEMIES, EVENTS, HOARDER, LATE_SPECIALS, METEOR_SHOWER, SPAWN_TABLE, TOTEM, difficulty, xpForLevel } from '../data/enemies';
import { MAT_BY_ID, OMEN_BY_ID, PASSIVES, PASSIVE_BY_ID, STAGE_BY_ID, heatBonus } from '../data/passives';
import { SHRINE_CHANNEL, SHRINE_DEFS, SHRINE_KINDS, SHRINE_RADIUS, TRIAL_TIME } from '../data/shrines';
import { BRITTLE_MUL, COMBO_GROWTH, COMBO_MIGHT, COMBO_TIERS, COMBO_WINDOW, REACTION_CD, REACTION_DEFS, RESONANCES, comboTier, resonanceTier, type ReactionId, type ResonanceState } from '../data/synergy';
import { WEAPONS, WH, weaponStats } from '../data/weapons';
import type { FX } from '../render/fx';
import type {
  StatusSpec, Ally, BoonDef, BossAttack, Hazard, MaterialId, Shrine, StoryBeatId, PassiveDef, UpgradeOption, WeaponDef, CharacterDef, ChestReward, DamageInfo, DamageSource, Difficulty, DifficultyMods, Enemy, GameEvents, GameState, InputSource,
  LevelOption, Materials, MetaBonuses, Mine, PassiveInstance, Pickup, PickupSpec, Player, PlayerStats, Projectile, ProjectileSpec,
  RunSummary, ScriptedEvent, StageDef, StatBag, Weapon, Zone,
} from './types';

const TAU = U.TAU;

export interface RunConfig {
  charId: string;
  stageId: string;
  omens?: Record<string, number>;
  /** Permanent bonuses from the meta layer (talents, forge, codex…). */
  meta: MetaBonuses;
  /** RNG seed; the same seed + inputs replays the same run. Random if omitted. */
  seed?: number;
  /** Show first-run hints. */
  tutorial?: boolean;
}

interface Timer {
  t: number;
  fn: () => void;
}
export interface EnemyProjectile {
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  r: number;
  dmg: number;
  life: number;
  color: string;
  dead: boolean;
}
interface SpawnOpts {
  tier?: number;
  elite?: boolean;
  rush?: { x: number; y: number };
  life?: number;
  hpMul?: number;
}
/** Options shared by area-damage helpers (explode, nova, arcSlash, lineDamage). */
export interface AreaHitOpts {
  knock?: number;
  quiet?: boolean;
  crit?: number;
  burn?: number;
  burnDur?: number;
  noBurn?: boolean;
  status?: StatusSpec;
  color?: string;
  small?: boolean;
  thin?: boolean;
  exclude?: Enemy;
}
export interface NovaOpts extends AreaHitOpts {
  speed?: number;
  onHit?: ((e: Enemy) => void) | null;
  shatter?: boolean;
  shake?: number;
}
export interface LightningOpts {
  color?: string;
  status?: StatusSpec;
  chain?: number;
}
export interface ChainOpts {
  decay?: number;
  range?: number;
  color?: string;
  skipFirst?: boolean;
  extra?: number;
}
export type ZoneSpec = Pick<Zone, 'x' | 'y'> & Partial<Zone>;
export type MineSpec = Pick<Mine, 'x' | 'y' | 'r' | 'dmg' | 'life' | 'color'> & Partial<Mine>;
export type AllySpec = Pick<Ally, 'kind'> & Partial<Ally>;

interface ChestRequest {
  boss: boolean;
}

/** Remove dead entries in place (order-preserving, allocation-free). */
function compact<T extends { dead: boolean }>(arr: T[]): void {
  let w = 0;
  for (let i = 0; i < arr.length; i++) {
    const it = arr[i]!;
    if (!it.dead) arr[w++] = it;
  }
  arr.length = w;
}

/** Seconds between a bomber arming next to the player and its detonation. */
const BOMBER_FUSE = 0.5;
/** Boss 'sweep': windup, beam duration, total rotation, damage tick, beam size. */
const SWEEP = { windup: 0.9, dur: 1.6, arc: (130 * Math.PI) / 180, tick: 0.25, len: 520, wid: 44 };
/** Boss 'rings': rings, delay between them, missing projectiles per ring (the lane). */
const RINGS = { n: 3, every: 0.45, gap: 3, speed: 185 };
/** Loot pop: initial speed range and exponential decay rate (1/s) of a dropped pickup's burst. */
const POP_MIN = 60, POP_MAX = 160, POP_DECAY = 6;
/** Magnet pull on loot: base speed, acceleration while pulled (px/s²), speed cap, and the pickup radius around the player. */
const PULL = { speed: 380, accel: 900, max: 2400, reach: 12 };
/** Hex Totem aura (data/enemies.ts). */
const HEX = ENEMIES.totem!.aura!;

/** Damage-meter key of a damage source: character-kit damage (active, trait, talents) pools under `skill`. */
function dmgKey(w: DamageSource): string { return w.ability ? 'skill' : w.id || 'x'; }

/** Signed smallest difference between two angles, in (-π, π]. */
function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}

/** Universal evasive dash (every character): distance, duration, cooldown and invulnerability window, in px / s. */
export const DASH = { dist: 150, time: 0.15, cd: 1.5, invuln: 0.3 };

const NO_INPUT: InputSource = { moveX: () => 0, moveY: () => 0, consumeActive: () => false, consumeDash: () => false };

export class Game {
  readonly events = new Emitter<GameEvents>();
  state: GameState = 'idle';
  paused = false;
  input: InputSource;
  readonly fx: FX;

  // run configuration
  char!: CharacterDef;
  stage!: StageDef;
  omens: Record<string, number> = {};
  meta!: MetaBonuses;
  mods!: DifficultyMods;
  heat = 0;
  seed = 0;

  // clock
  time = 0;
  frame = 0;
  dt = 1 / 60;

  // world
  player!: Player;
  enemies: Enemy[] = [];
  projs: Projectile[] = [];
  eprojs: EnemyProjectile[] = [];
  zones: Zone[] = [];
  mines: Mine[] = [];
  allies: Ally[] = [];
  pickups: Pickup[] = [];
  private timers: Timer[] = [];
  private dueTimers: Timer[] = [];
  readonly grid = new SpatialHash<Enemy>(72);
  /** Scratch buffers for allocation-free hot-loop queries (never shared between nested queries). */
  private projHits: Enemy[] = [];
  private sepHits: Enemy[] = [];
  /** Half-extents of the visible world area (set by the renderer each frame). */
  viewW = 700;
  viewH = 420;

  // run progress
  kills = 0;
  bossKills = 0;
  elites = 0;
  evolves = 0;
  gold = 0;
  embers = 0;
  mats: Materials = { iron: 0, dust: 0, crystal: 0, star: 0 };
  enemyKills: Record<string, number> = {};
  bossKillsBy: Record<string, number> = {};
  /** Damage dealt per source: weapon id, `skill` (the character's active, trait & talents) or a synthetic id (`burn`, `boon`…). */
  dmgByWeapon: Record<string, number> = {};
  /** Kills per source, keyed like {@link dmgByWeapon}. */
  killsBySource: Record<string, number> = {};
  boss: Enemy | null = null;
  levelQueue = 0;
  chestQueue: ChestRequest[] = [];
  banished = new Set<string>();
  eclipse = false;
  runMight = 0;
  lastHitBy = '';

  // spawner state
  private spawnAcc = 0;
  private eliteT = 0;
  private eventIdx = 0;
  private lateEventT = 0;
  private lateCycle = 0;
  private brazierT = 30;
  private spawnTable = SPAWN_TABLE[0]!;
  private _diff: Difficulty | null = null;
  private _diffT = -1;

  // meta-effect timers
  private gemCombo = 0;
  private gemComboT = 0;
  private uStormT = 4;
  private uAegisT = 20;
  private uStarT = 8;
  private pulseT = 60;
  private tlT = 300;
  /** True while a hit on the player is being resolved (see hitPlayer). */
  private hurting = false;

  // run systems: hazards, shrines, boons, streaks, reactions, resonance
  hazards: Hazard[] = [];
  shrines: Shrine[] = [];
  /** Timed run buffs (shrines); their stats fold into recalc(). */
  buffs: { id: string; t: number; max: number; stats: StatBag }[] = [];
  boonQueue = 0;
  combo = 0;
  comboT = 0;
  bestCombo = 0;
  /** Current kill-streak tier (0 = none). */
  comboTier = 0;
  reactions = 0;
  shrinesUsed = 0;
  /** Weapon resonances (tag synergies), refreshed by recalc(). */
  resonance: ResonanceState[] = [];
  /** Active Soul Well trial. */
  trial: { t: number; x: number; y: number } | null = null;
  private shrineT = 40;
  private curseBonus = 0;
  private harvestMight = 0;
  /** Warlord's Banner: Might per boss slain (kept apart from `runMight`, which Soulreaver caps). */
  private bannerMight = 0;
  private lowHpAt = 0;
  private secondAt = 0;
  private eyeT = 6;
  private stormT = 3;
  private holySaved = false;
  /** Phoenix Feather has been spent this run (the HUD greys its icon out). */
  phoenixUsed = false;
  /** Blood Moon: seconds remaining (0 = inactive). Enemies move faster and drop more XP. */
  bloodMoon = 0;
  /** Meteor shower: seconds remaining (0 = inactive). */
  meteorShower = 0;
  private meteorT = 0;
  /** Sim times of the next Ember Cask cluster, Gilded Hoarder and Hex Totem. */
  private caskAt = 0;
  private hoarderAt = 0;
  private totemAt = 0;
  /** Scratch list of live Hex Totems (rebuilt each step). */
  private hexers: Enemy[] = [];
  private reacted = new Set<string>();
  private storyOnce = new Set<string>();

  constructor(fx: FX, input: InputSource = NO_INPUT) {
    this.fx = fx;
    this.input = input;
  }

  /* ==================== RUN SETUP ==================== */
  start(cfg: RunConfig): void {
    const char = CHAR_BY_ID[cfg.charId]!;
    const stage = STAGE_BY_ID[cfg.stageId]!;
    this.seed = cfg.seed ?? (rand() * 2 ** 32) >>> 0;
    simRng.reseed(this.seed);
    U.resetUid();
    this.char = char; this.stage = stage; this.omens = cfg.omens || {};
    this.meta = cfg.meta;
    // difficulty modifiers
    const mods: DifficultyMods = { enemyHp: stage.diff, enemyDmg: 0.75 + stage.diff * 0.25, enemySpeed: 1, spawn: 0.85 + stage.diff * 0.15, elite: 1, healing: 1, bossHp: 1, bossRate: 1, playerHp: 1, timeScale: 1 };
    let heat = 0;
    for (const id in this.omens) { const o = OMEN_BY_ID[id], r = this.omens[id]!; if (o && r > 0) { o.apply(mods, r); heat += r; } }
    if (this.meta.flags.moreElites) mods.elite *= 1.25;
    this.mods = mods; this.heat = heat;
    this.time = 0; this.frame = 0; this.dt = 1 / 60;
    this.enemies = []; this.projs = []; this.eprojs = []; this.zones = []; this.mines = []; this.allies = []; this.pickups = []; this.timers = [];
    this.grid.clear();
    this.kills = 0; this.bossKills = 0; this.elites = 0; this.evolves = 0; this.gold = 0; this.embers = 0; this.mats = { iron: 0, dust: 0, crystal: 0, star: 0 };
    this.enemyKills = {}; this.bossKillsBy = {}; this.dmgByWeapon = {}; this.killsBySource = {};
    this.spawnAcc = 0; this.eliteT = 75 / mods.elite; this.eventIdx = 0; this.lateEventT = 0; this.lateCycle = 0; this.brazierT = 30;
    this.gemCombo = 0; this.gemComboT = 0; this.uStormT = 4; this.uAegisT = 20; this.uStarT = 8; this.pulseT = 60; this.tlT = 300;
    this.boss = null; this.levelQueue = 0; this.chestQueue = []; this.banished = new Set();
    this.spawnTable = SPAWN_TABLE[0]!; this._diff = null; this._diffT = -1;
    this.eclipse = false;
    this.runMight = 0;
    this.hazards = []; this.shrines = []; this.buffs = []; this.boonQueue = 0; this.combo = 0; this.comboT = 0; this.bestCombo = 0; this.comboTier = 0;
    this.reactions = 0; this.shrinesUsed = 0; this.resonance = []; this.trial = null; this.shrineT = 40; this.curseBonus = 0; this.harvestMight = 0; this.bannerMight = 0;
    this.lowHpAt = 0; this.secondAt = 0; this.eyeT = 6; this.stormT = 3; this.holySaved = false; this.phoenixUsed = false; this.reacted = new Set(); this.storyOnce = new Set();
    this.bloodMoon = 0; this.meteorShower = 0; this.meteorT = 0; this.totemAt = 0; this.hexers = [];
    this.caskAt = U.rand(CASK.every[0], CASK.every[1]); this.hoarderAt = U.rand(HOARDER.first[0], HOARDER.first[1]);
    this.createPlayer();
    this.state = 'play'; this.paused = false;
    this.fx.clear();
    this.events.emit('runStart', stage);
    this.story('runStart', stage.id);
    if (cfg.tutorial) this.after(2.5, () => this.notice('Collect gems to level up · SPACE to dash · E for ' + char.active.name, '#cbd5e1', 4));
    if (this.meta.flags.startShield) this.addShield(this.player.stats.maxHp * 0.5);
    for (let i = 0; i < this.player.stats.startLevel; i++) this.gainLevel(true);
  }

  private createPlayer(): void {
    const ch = this.char;
    const p: Player = this.player = {
      x: 0, y: 0, px: 0, py: 0, r: 14, char: ch, level: 1, xp: 0, xpNext: xpForLevel(1), hp: 0, shield: 0,
      stats: null as unknown as PlayerStats, dyn: {}, f: Object.assign({}, this.meta.flags), res: 0, resMax: 1, weapons: [], passives: [], weaponMastery: this.meta.weaponMastery,
      face: { x: 1, y: 0 }, move: { x: 0, y: 0 }, movedDist: 0, invulnT: 0, hurtFlash: 0, activeCdT: 0, activeCharges: 1, activeMax: 1, critAllT: 0,
      rerolls: 0, skips: 0, banishes: 0, revivals: 0, kills: 0, boons: [] as string[], slowT: 0, slots: { w: 6 + (this.meta.flags.weaponSlot ? 1 : 0), p: 6 + (this.meta.flags.passiveSlot ? 1 : 0) },
      walkT: 0, dashT: 0, dashDx: 0, dashDy: 0, dashSpeed: 0, dashOnStep: null, dashStepDist: 30, dashAcc: 0, dashCdT: 0, auraColor: null,
    };
    this.recalc();
    p.hp = p.stats.maxHp;
    p.rerolls = p.stats.rerolls; p.skips = p.stats.skips; p.banishes = p.stats.banishes; p.revivals = p.stats.revival;
    p.activeMax = 1 + (p.f.dash_charges ? 1 : 0); p.activeCharges = p.activeMax;
    this.addWeapon(ch.signature);
    if (ch.hooks && ch.hooks.init) ch.hooks.init(this, p);
    this.recalc();
    p.hp = p.stats.maxHp;
  }

  recalc(): void {
    const p = this.player, ch = this.char;
    const base: PlayerStats = Object.assign({}, CHAR_BASE, ch.stats);
    const add: StatBag = {};
    const acc = (o: StatBag, m = 1) => { for (const k in o) add[k] = (add[k] || 0) + o[k]! * m; };
    acc(this.meta.stats);
    p.passives.forEach((ps) => acc(ps.def.per, ps.level));
    acc(p.dyn);
    if (this.runMight) add.might = (add.might || 0) + this.runMight;
    this.accRunStats(acc);
    const s = {} as PlayerStats;
    const g = (k: string) => add[k] || 0;
    s.maxHp = Math.round((base.maxHp + g('maxHp')) * (1 + g('maxHpPct')) * this.mods.playerHp);
    s.speed = base.speed * (1 + g('speed'));
    for (const k of ['might', 'area', 'projSpeed', 'duration', 'luck', 'growth', 'greed', 'healing', 'curse', 'shieldPower'] as const) s[k] = base[k] + g(k);
    s.cooldown = base.cooldown * Math.max(0.25, 1 - g('cooldown'));
    s.activeCd = base.activeCd * Math.max(0.3, 1 - g('activeCd'));
    s.magnet = base.magnet * (1 + g('magnet'));
    for (const k of ['armor', 'regen', 'amount', 'revival', 'rerolls', 'skips', 'banishes', 'pierce', 'startLevel', 'crit', 'critDmg', 'dodge', 'lifesteal', 'thorns', 'eliteDmg', 'burnDmg', 'minionDmg', 'xpBonus', 'matFind', 'knockback', 'chestLuck', 'slowPower', 'execute', 'sigDmg', 'reactDmg'] as const) s[k] = base[k] + g(k);
    s.dodge = Math.min(0.75, s.dodge);
    // luck above the base sharpens crits as well as drops (+1% crit per +10% luck)
    s.crit += Math.max(0, s.luck - 1) * 0.1;
    // multiplicative per-run modifiers set by hooks (additive `dyn` can't express "double X" without feeding back into itself)
    if (p.lifestealMul) s.lifesteal *= p.lifestealMul;
    if (p.noRegen) s.regen = 0;
    s.healing *= this.mods.healing;
    const old = p.stats;
    p.stats = s;
    if (old && s.maxHp > old.maxHp) p.hp += s.maxHp - old.maxHp;
    if (p.hp > s.maxHp) p.hp = s.maxHp;
    // cache weapon stats
    p.weapons.forEach((w) => { const ws = (w.s = weaponStats(w, p)); if (w.def.mod) w.def.mod(this, w, ws, p); });
  }

  /** Fold run-only bonuses (resonance, boons, shrine buffs, kill streak, curses) into a recalc. */
  private accRunStats(acc: (o: StatBag, m?: number) => void): void {
    const p = this.player, f = p.f;
    // resonance: count weapons per tag
    const counts: Record<string, number> = {};
    for (const w of p.weapons) for (const t of w.def.tags || []) counts[t] = (counts[t] || 0) + 1;
    this.resonance = [];
    for (const def of RESONANCES) {
      const n = counts[def.tag] || 0, tier = resonanceTier(def, n);
      if (n) this.resonance.push({ def, count: n, tier });
      def.tiers.forEach((t, i) => { const on = i < tier; if (t.stats && on) acc(t.stats); if (t.flag) f[t.flag] = on; });
    }
    for (const id of p.boons) { const b = BOON_BY_ID[id]; if (b && b.stats) acc(b.stats); }
    for (const b of this.buffs) acc(b.stats);
    const ct = this.comboTier * (f.b_frenzy ? 2 : 1);
    if (ct) acc({ might: COMBO_MIGHT * ct, growth: COMBO_GROWTH * ct });
    if (this.curseBonus) acc({ curse: this.curseBonus });
    if (this.harvestMight) acc({ might: this.harvestMight });
    if (this.bannerMight) acc({ might: this.bannerMight });
  }

  addWeapon(id: string): Weapon {
    const p = this.player, def = WEAPONS[id]!;
    const w: Weapon = { id, def, level: 1, evolved: false, timer: 0.3, s: null, dmgDealt: 0 };
    p.weapons.push(w); this.recalc();
    this.events.emit('discover', 'weapon', id);
    return w;
  }
  addPassive(id: string): PassiveInstance { const def = PASSIVE_BY_ID[id]!; const ps = { id, def, level: 1 }; this.player.passives.push(ps); this.recalc(); return ps; }

  /* ==================== MAIN UPDATE ==================== */
  /** Advance the simulation by one fixed step. */
  update(dt: number): void {
    if (this.state !== 'play' || this.paused) return;
    this.dt = dt; this.time += dt; this.frame++;
    this.snapshotPositions();
    this.runTimers(dt);
    this.updatePlayer(dt);
    this.updateWeapons(dt);
    this.rebuildGrid();
    this.updateSpawns(dt);
    this.updateEnemies(dt);
    this.updateProjectiles(dt);
    this.updateEnemyProjectiles(dt);
    this.updateZones(dt);
    this.updateMines(dt);
    this.updateAllies(dt);
    this.updatePickups(dt);
    this.updateHazards(dt);
    this.updateShrines(dt);
    this.updateMetaEffects(dt);
    if (this.frame % 12 === 0) this.recalc();
    if (!this.eclipse && this.time >= 1800) { this.eclipse = true; this.notice('THE ECLIPSE — the horde grows without end', '#c084fc', 5); this.fx.flash('#c084fc', 0.7); this.fx.timeWarp(0.3, 1.2); this.sfx('boss'); this.story('eclipse'); }
    // modal triggers (a hook may already have ended the run this step)
    if (this.state !== 'play') return;
    if (this.levelQueue > 0) { this.state = 'levelup'; this.events.emit('levelUp', this.genOptions()); }
    else if (this.chestQueue.length) { const c = this.chestQueue.shift()!; this.state = 'chest'; this.openChest(c); }
    else if (this.boonQueue > 0) { this.boonQueue--; const opts = this.boonOptions(); if (opts.length) { this.state = 'boon'; this.events.emit('boon', opts); } }
  }

  /** Record pre-step positions so the renderer can interpolate between steps. */
  private snapshotPositions(): void {
    const p = this.player; p.px = p.x; p.py = p.y;
    for (const e of this.enemies) { e.px = e.x; e.py = e.y; }
    for (const pr of this.projs) { pr.px = pr.x; pr.py = pr.y; }
    for (const pr of this.eprojs) { pr.px = pr.x; pr.py = pr.y; }
    for (const a of this.allies) { a.px = a.x; a.py = a.y; }
    for (const k of this.pickups) { k.px = k.x; k.py = k.y; }
  }

  private runTimers(dt: number): void {
    const T = this.timers, due = this.dueTimers;
    let w = 0;
    for (let i = 0; i < T.length; i++) { const t = T[i]!; t.t -= dt; if (t.t <= 0) due.push(t); else T[w++] = t; }
    T.length = w;
    // Callbacks may schedule new timers; those run from the next step on.
    for (let i = 0; i < due.length; i++) { try { due[i]!.fn(); } catch (e) { console.error(e); } }
    due.length = 0;
  }

  /* ==================== PLAYER ==================== */
  private updatePlayer(dt: number): void {
    const p = this.player, st = p.stats, inp = this.input;
    let mx = inp.moveX(), my = inp.moveY();
    const l = Math.hypot(mx, my); if (l > 1) { mx /= l; my /= l; }
    p.move.x = mx; p.move.y = my;
    if (l > 0.01) { p.face.x = mx / (l || 1); p.face.y = my / (l || 1); p.walkT += dt * 9; }
    let spd = st.speed;
    if (p.f.adrenaline && p.hp < st.maxHp * 0.3) spd *= 1.2;
    if (p.slowT > 0) { p.slowT -= dt; spd *= 0.6; }
    if (p.dashT > 0) {
      p.dashT -= dt;
      const step = p.dashSpeed * dt;
      p.x += p.dashDx * step; p.y += p.dashDy * step;
      p.dashAcc += step;
      if (p.dashOnStep && p.dashAcc >= p.dashStepDist) { p.dashAcc = 0; p.dashOnStep(p.x, p.y); }
      this.fx.burst(p.x, p.y, p.char.colors.accent, 2, { speed: 40, life: 0.3, size: 3 });
    } else {
      p.x += mx * spd * dt; p.y += my * spd * dt;
      p.movedDist += l * spd * dt;
    }
    p.invulnT -= dt; p.hurtFlash -= dt; p.critAllT -= dt;
    for (const k of ['cdAshen', 'cdUnbroken', 'cdVeil']) if (p[k] > 0) p[k] -= dt;
    // regen
    if (st.regen > 0 && p.hp < st.maxHp) this.heal(st.regen * dt, true, true);
    // active ability cooldown
    if (p.activeCharges < p.activeMax) { p.activeCdT -= dt; if (p.activeCdT <= 0) { p.activeCharges++; p.activeCdT = p.activeCharges < p.activeMax ? p.char.active.cd * st.activeCd : 0; } }
    if (inp.consumeActive() && p.activeCharges > 0) this.useActive();
    // evasive dash
    if (p.dashCdT > 0) p.dashCdT -= dt;
    if (inp.consumeDash()) this.evade();
    // character hooks
    const h = p.char.hooks;
    if (h && h.update) h.update(this, p, dt);
    // contact damage is handled in enemy update
  }
  useActive(): void {
    const p = this.player;
    p.activeCharges--;
    if (p.activeCdT <= 0) p.activeCdT = p.char.active.cd * p.stats.activeCd;
    p.char.active.use(this, p);
    this.fx.ring(p.x, p.y, 40, p.char.colors.accent, { thin: true });
  }
  /** The universal dash: a short invulnerable burst along the move direction (or facing when idle). */
  evade(): boolean {
    const p = this.player;
    // an ability dash (Inferno Dash, …) in flight keeps its own path
    if (p.dashCdT > 0 || p.dashT > 0) return false;
    const l = Math.hypot(p.move.x, p.move.y);
    const dx = l > 0.01 ? p.move.x / l : p.face.x, dy = l > 0.01 ? p.move.y / l : p.face.y;
    p.dashCdT = DASH.cd;
    this.dash(dx, dy, DASH.dist, DASH.time);
    this.setInvuln(DASH.invuln);
    this.fx.burst(p.x, p.y, p.char.colors.accent, 10, { speed: 140, life: 0.3 });
    this.sfx('dash');
    return true;
  }
  dash(dx: number, dy: number, dist: number, t: number, opts: { onStep?: (x: number, y: number) => void; stepDist?: number } = {}): void { const p = this.player; p.dashT = t; p.dashDx = dx; p.dashDy = dy; p.dashSpeed = dist / t; p.dashOnStep = opts.onStep || null; p.dashStepDist = opts.stepDist || 30; p.dashAcc = 0; }
  blink(dx: number, dy: number, dist: number): void { const p = this.player; this.fx.burst(p.x, p.y, p.char.colors.accent, 16, { speed: 120, life: 0.4 }); p.x += dx * dist; p.y += dy * dist; this.fx.burst(p.x, p.y, p.char.colors.accent, 16, { speed: 120, life: 0.4 }); }
  setInvuln(t: number): void { this.player.invulnT = Math.max(this.player.invulnT, t); }
  heal(amt: number, quiet?: boolean, silent?: boolean): void {
    const p = this.player; if (amt <= 0) return;
    amt *= p.stats.healing;
    const before = p.hp;
    p.hp = Math.min(p.stats.maxHp, p.hp + amt);
    const over = amt - (p.hp - before);
    if (over > 0) {
      if (p.overhealToShield) this.addShield(over);
      else if (p.overhealToBlood) p.blood = Math.min(p.bloodCap || p.stats.maxHp * 0.5, (p.blood || 0) + over);
    }
    if (!quiet) { this.fx.text(p.x, p.y - 30, '+' + Math.round(amt), '#86efac'); this.sfx('heal'); }
    if (!silent && p.hp - before > 0.5) this.fx.burst(p.x, p.y, '#86efac', 3, { speed: 30, life: 0.5, size: 3, up: true });
  }
  /** Add shield, capped at a share of max health (the character's cap, or `capFrac` if larger). */
  addShield(amt: number, capFrac = 0): void { const p = this.player; const cap = p.stats.maxHp * Math.max(capFrac, p.shieldCap || 0.5) * p.stats.shieldPower; p.shield = Math.min(cap, p.shield + amt); }
  hitPlayer(dmg: number, src?: { def?: { name: string }; color?: string } | null): void {
    const p = this.player;
    // A hook reacting to this hit (thorns, retaliation novas…) can kill a bomber whose blast would
    // re-enter here before this hit has applied its i-frames; one hit at a time.
    if (p.invulnT > 0 || p.hp <= 0 || this.hurting) return;
    this.hurting = true;
    try { this.applyPlayerHit(dmg, src); } finally { this.hurting = false; }
  }
  private applyPlayerHit(dmg: number, src?: { def?: { name: string }; color?: string } | null): void {
    const p = this.player;
    if (rand() < p.stats.dodge) { this.fx.text(p.x, p.y - 30, 'DODGE', '#94a3b8'); const h = p.char.hooks; if (h && h.onDodge) h.onDodge(this, p, src); return; }
    dmg = Math.max(1, dmg - p.stats.armor) * (p.dyn.dmgTaken || 1);
    const h = p.char.hooks;
    if (h && h.onHurt) dmg = h.onHurt(this, p, dmg, src);
    // thorns (Retaliation): whoever strikes you takes a share back; Grom adds a multiple of his Armor
    const foe = src as Enemy | null | undefined;
    if (foe && foe.hp != null && !foe.dead && (p.stats.thorns > 0 || p.thornsArmor)) this.damageEnemy(foe, dmg * p.stats.thorns + p.stats.armor * (p.thornsArmor || 0), { weapon: { id: 'thorns', thorns: true }, quiet: true, thorns: true });
    if (p.shield > 0) { const a = Math.min(p.shield, dmg); p.shield -= a; dmg -= a; this.fx.burst(p.x, p.y, '#7dd3fc', 4, { speed: 60, life: 0.3 }); }
    if (dmg <= 0) return;
    if (p.blood > 0) { const a = Math.min(p.blood, dmg * 0.5); p.blood -= a; dmg -= a; }
    p.hp -= dmg; p.hurtFlash = 0.15; p.invulnT = Math.max(p.invulnT, 0.12);
    this.lastHitBy = src && src.def ? src.def.name : src && src.color ? 'a bolt in the dark' : 'the night';
    this.fx.shake(Math.min(8, 2 + dmg * 0.08)); this.fx.text(p.x, p.y - 30, '-' + Math.round(dmg), '#f87171', true); this.sfx('hurt');
    const sx = (src as { x?: number } | null | undefined)?.x, sy = (src as { y?: number } | null | undefined)?.y;
    this.fx.hurt(sx == null || sy == null ? null : Math.atan2(sy - p.y, sx - p.x), Math.min(1, dmg / (p.stats.maxHp * 0.15)));
    if (this.combo > 0) this.combo = Math.floor(this.combo * 0.75);
    if (p.hp <= 0) { this.playerDown(); return; }
    const low = p.hp < p.stats.maxHp * 0.3;
    if (low && p.f.b_second && this.secondAt <= this.time) { this.secondAt = this.time + 60; this.addShield(p.stats.maxHp * 0.6, 0.6); this.setInvuln(2); this.fx.ring(p.x, p.y, 120, '#86efac'); this.fx.text(p.x, p.y - 44, 'SECOND WIND', '#86efac'); this.sfx('heal'); }
    if (low && this.lowHpAt <= this.time) { this.lowHpAt = this.time + 90; this.story('lowHp'); }
  }
  private playerDown(): void {
    const p = this.player, h = p.char.hooks;
    if (h && h.onFatal && h.onFatal(this, p)) return;
    if (p.f.res_holy && !this.holySaved) {
      this.holySaved = true; p.hp = p.stats.maxHp * 0.5; this.setInvuln(2.5);
      this.fx.flash('#fde68a', 0.6); this.fx.ring(p.x, p.y, 200, '#fde68a'); this.fx.text(p.x, p.y - 40, 'SANCTUM', '#fde68a'); this.sfx('revive'); this.fx.timeWarp(0.25, 0.8);
      return;
    }
    if (p.f.b_phoenix && !this.phoenixUsed) {
      // the rebirth has to clear real space at any point of the night: the flames consume the
      // horde around you outright, scorch bosses and leave them burning
      this.phoenixUsed = true; p.hp = p.stats.maxHp; this.setInvuln(3);
      const src = { id: 'boon' }, burn = (40 + p.level * 6) * p.stats.might;
      this.annihilate(p.x, p.y, 340, 0.15, src);
      this.eachEnemyIn(p.x, p.y, 340, (e) => this.applyStatus(e, 'burn', { dur: 5, dps: burn }));
      this.fx.explosion(p.x, p.y, 340, '#ff7a3c'); this.fx.ring(p.x, p.y, 340, '#ffb347'); this.fx.shake(14);
      this.fx.flash('#ff7a3c', 0.8); this.fx.text(p.x, p.y - 40, 'REBORN IN FIRE', '#ff9a3c'); this.sfx('revive'); this.fx.timeWarp(0.2, 1);
      this.notice('Phoenix Feather: you rise from the ashes. The feather is spent.', '#ff9a3c', 4);
      this.story('revive');
      return;
    }
    if (p.revivals > 0) {
      p.revivals--; p.hp = p.f.fullRevive ? p.stats.maxHp : p.stats.maxHp * 0.5; this.setInvuln(3);
      if (p.f.fullRevive || p.f.b_angel) this.annihilate(p.x, p.y, 320, 0.1, null);
      this.fx.flash('#fde68a', 0.8); this.fx.ring(p.x, p.y, 320, '#fde68a'); this.fx.text(p.x, p.y - 40, 'REVIVED', '#fde68a'); this.sfx('revive'); this.fx.timeWarp(0.2, 1);
      this.notice('You rise again. ' + p.revivals + ' revival' + (p.revivals === 1 ? '' : 's') + ' left.', '#fde68a');
      this.story('revive');
      return;
    }
    p.hp = 0; this.state = 'over'; this.sfx('death'); this.fx.flash('#7f1d1d', 1.0); this.fx.shake(20); this.fx.timeWarp(0.15, 1.5);
    this.story('death');
    this.events.emit('gameOver', this.summary());
  }
  /** Destroy every non-boss enemy around (x, y), barrier and all; bosses lose `bossPct` of their max health. */
  private annihilate(x: number, y: number, r: number, bossPct: number, w: DamageSource | null): void {
    this.eachEnemyIn(x, y, r, (e) => {
      if (e.object) return;
      if (e.boss) this.damageEnemy(e, e.maxHp * bossPct, { quiet: true, weapon: w });
      else this.damageEnemy(e, e.hp + (e.barrier ?? 0) + 1, { quiet: true, weapon: w, noBlast: true, execute: true });
    });
  }

  /* ==================== WEAPONS ==================== */
  private updateWeapons(dt: number): void {
    const p = this.player;
    for (const w of p.weapons) {
      const s = w.s || (w.s = weaponStats(w, p));
      if (w.def.continuous) { w.def.update!(this, w, s, dt); continue; }
      w.timer -= dt;
      if (w.timer <= 0) {
        w.def.fire!(this, w, s);
        w.timer += Math.max(0.12, s.cd);
        if (w.timer < 0) w.timer = 0.05;
        const h = p.char.hooks; if (h && h.onCast) h.onCast(this, p, w);
      }
    }
  }
  /** Run `fn` after `t` seconds of simulation time. */
  after(t: number, fn: () => void): void { if (t <= 0) { fn(); return; } this.timers.push({ t, fn }); }

  /* ---- helpers exposed to weapon behaviors ---- */
  /** Buried Grave Worms stay out of the grid: nothing can target or hit them until they surface. */
  private rebuildGrid(): void { this.grid.clear(); for (const e of this.enemies) if (!e.dead && !e.buried) this.grid.insert(e); }
  /** Nearest live enemy — never a map object (casks are only ever hit incidentally). */
  nearestEnemy(x: number, y: number, r: number, filter?: (e: Enemy) => boolean): Enemy | null { return this.grid.nearest(x, y, r, (e) => !e.dead && !e.object && (!filter || filter(e))); }
  /** Visit every live enemy whose body overlaps circle (x, y, r). Includes map objects: area damage breaks casks. */
  eachEnemyIn(x: number, y: number, r: number, fn: (e: Enemy) => void): void { this.grid.each(x, y, r + 64, (e) => { if (e.dead) return; const rr = r + e.r; if ((e.x - x) * (e.x - x) + (e.y - y) * (e.y - y) <= rr * rr) fn(e); }); }
  /** Live enemies overlapping the circle, for targeting: map objects are excluded. */
  enemiesInRadius(x: number, y: number, r: number): Enemy[] { const out: Enemy[] = []; this.eachEnemyIn(x, y, r, (e) => { if (!e.object) out.push(e); }); return out; }
  randomEnemyNear(x: number, y: number, r: number): Enemy | null { const list = this.enemiesInRadius(x, y, r); return list.length ? list[Math.floor(rand() * list.length)] : null; }
  alliesOf(kind: string): Ally[] { return this.allies.filter((a) => a.kind === kind && !a.dead); }
  pullEnemies(x: number, y: number, r: number, strength: number): void { const dt = this.dt; this.eachEnemyIn(x, y, r, (e) => { if (e.boss || e.immobile) return; const dx = x - e.x, dy = y - e.y, d = Math.hypot(dx, dy) || 1; const f = strength * dt / Math.max(1, e.mass * 0.5); e.x += dx / d * f; e.y += dy / d * f; }); }
  destroyEnemyProjectiles(x: number, y: number, r: number): void { for (const pr of this.eprojs) if (!pr.dead && U.dist2(pr.x, pr.y, x, y) < (r + pr.r) * (r + pr.r)) { pr.dead = true; this.fx.burst(pr.x, pr.y, '#c084fc', 3, { speed: 50, life: 0.3, size: 2 }); } }

  spawnProj(o: ProjectileSpec): Projectile {
    const pr: Projectile = {
      uid: U.uid(), x: o.x, y: o.y, px: o.x, py: o.y, vx: 0, vy: 0, angle: o.angle || 0, speed: o.speed || 0, r: o.r || 6, dmg: o.dmg || 0, pierce: o.pierce == null ? 0 : o.pierce, life: o.life || 2, age: 0,
      weapon: o.weapon, sprite: o.sprite, hits: null, hitCd: o.hitCd || 0, homing: o.homing || 0, bounce: !!o.bounce, boomerang: o.boomerang || null, onHit: o.onHit || null, onExpire: o.onExpire || null, onBounce: o.onBounce || null,
      knock: o.knock == null ? 0.6 : o.knock, trail: o.trail || null, spin: o.spin || 0, rot: 0, orbit: o.orbit || null, field: o.field || null, zap: o.zap || null, statuses: o.statuses || null, crit: o.crit || 0,
      dead: false, ricochet: o.ricochet || 0, light: o.light || 0, noOnHit: !!o.noOnHit, tickT: 0, hitCount: 0, trailT: 0, split: false,
    };
    pr.vx = Math.cos(pr.angle) * pr.speed; pr.vy = Math.sin(pr.angle) * pr.speed;
    if (pr.pierce !== -1 || !pr.hitCd) pr.hits = new Set();
    this.projs.push(pr);
    return pr;
  }
  spawnZone(o: ZoneSpec): Zone { const z: Zone = Object.assign({ age: 0, tickT: 0, dead: false, dur: 2, tick: 0.3, dmg: 0, r: 50, color: '#fff', kind: 'generic' }, o); this.zones.push(z); return z; }
  spawnMine(o: MineSpec): Mine { const m: Mine = Object.assign({ age: 0, dead: false, armT: 0.4, pulse: rand() * TAU }, o); this.mines.push(m); return m; }
  spawnAlly(o: AllySpec): Ally {
    const a: Ally = Object.assign({ x: 0, y: 0, px: o.x ?? 0, py: o.y ?? 0, color: '#fff', dmg: 0, r: 12, life: 10, age: 0, dead: false, speed: 160, atkT: 0, attackCd: 0.8, attackR: 34, angle: rand() * TAU, walk: 0, target: null, fireT: 0, dmgDealt: 0 }, o);
    this.allies.push(a);
    const h = this.player.char.hooks; if (h && h.onAllySpawn) h.onAllySpawn(this, this.player, a);
    this.fx.burst(a.x, a.y, a.color || '#fff', 10, { speed: 80, life: 0.5 });
    return a;
  }
  explode(x: number, y: number, r: number, dmg: number, w: DamageSource | null | undefined, o: AreaHitOpts = {}): void {
    this.eachEnemyIn(x, y, r, (e) => {
      if (o.exclude === e) return;
      this.damageEnemy(e, dmg, { weapon: w, kx: e.x - x, ky: e.y - y, knock: o.knock == null ? 1 : o.knock, quiet: !!o.quiet, crit: o.crit || 0 });
      if (o.burn && !o.noBurn) this.applyStatus(e, 'burn', { dur: o.burnDur || 3, dps: dmg * o.burn });
      if (o.status) this.applyStatus(e, o.status.type, o.status);
    });
    this.fx.explosion(x, y, r, o.color || '#ff7043', o.small);
    if (!o.small) { this.fx.shake(Math.min(3.5, r * 0.03)); this.sfx('explode'); }
  }
  /** Expanding ring that damages enemies as it passes them. */
  nova(x: number, y: number, r: number, dmg: number, w: DamageSource | null | undefined, o: NovaOpts = {}): void {
    // expanding ring: hits enemies as the ring passes them
    const speed = o.speed || 600;
    const n = { x, y, r: 0, maxR: r, dead: false, hit: new Set<Enemy>() };
    this.fx.nova(n, o.color || '#fff', o.thin);
    const step = () => {
      if (this.state === 'over') return;
      const dt = this.dt || 0.016;
      const prev = n.r; n.r = Math.min(n.maxR, n.r + speed * dt);
      this.grid.each(x, y, n.r + 64, (e) => {
        if (e.dead || n.hit.has(e)) return;
        const d = Math.hypot(e.x - x, e.y - y);
        if (d - e.r <= n.r && d + e.r >= prev - 20) {
          n.hit.add(e);
          // shattering novas mark what they touch: a frozen, marked enemy bursts on death (see killEnemy)
          if (o.shatter) e.st.shatter = { dmg: dmg * 0.6, w };
          this.damageEnemy(e, dmg, { weapon: w, kx: e.x - x, ky: e.y - y, knock: o.knock == null ? 1 : o.knock, quiet: !!o.quiet, crit: o.crit || 0 });
          if (e.object) return; // a cask struck by the ring breaks; it is not a "hit" for on-hit effects
          if (o.status) this.applyStatus(e, o.status.type, o.status);
          if (o.burn) this.applyStatus(e, 'burn', { dur: 3, dps: dmg * o.burn });
          if (o.onHit) o.onHit(e);
        }
      });
      if (n.r < n.maxR) this.after(0.016, step); else n.dead = true;
    };
    step();
    if (o.shake) this.fx.shake(o.shake);
  }
  lightning(x: number, y: number, r: number, dmg: number, w: DamageSource | null | undefined, o: LightningOpts = {}): void {
    this.fx.lightning(x, y, o.color || '#fde047');
    this.explode(x, y, r, dmg, w, { color: o.color || '#fde047', small: true, quiet: false, knock: 0.3, status: o.status });
    this.sfx('zap');
    if (o.chain) { const list = this.enemiesInRadius(x, y, 160).filter((e) => U.dist2(e.x, e.y, x, y) > r * r); U.shuffle(list).slice(0, o.chain).forEach((e, i) => this.after(0.08 * (i + 1), () => { this.fx.beam(x, y, e.x, e.y, '#fde047', 3, 0.15); this.explode(e.x, e.y, r * 0.7, dmg * 0.6, w, { color: '#fde047', small: true, knock: 0.3 }); })); }
  }
  chainLightning(sx: number, sy: number, target: Enemy | null, chains: number, dmg: number, w: DamageSource | null | undefined, o: ChainOpts = {}): void {
    const hit = new Set<Enemy>(); let cur = target, px = sx, py = sy, d = dmg, n = 0;
    const decay = o.decay || 0.85, range = o.range || 170;
    const step = () => {
      if (!cur || cur.dead) return;
      this.fx.beam(px, py, cur.x, cur.y, o.color || '#7dd3fc', 3, 0.18);
      if (!(o.skipFirst && n === 0)) this.damageEnemy(cur, d, { weapon: w, knock: 0.2, kx: cur.x - px, ky: cur.y - py });
      if (o.extra && rand() < o.extra) this.lightning(cur.x, cur.y, 34, d * 0.5, w, {});
      hit.add(cur); px = cur.x; py = cur.y; d *= decay; n++;
      if (n > chains) return;
      cur = this.grid.nearest(px, py, range, (e) => !e.dead && !e.object && !hit.has(e));
      if (cur) this.after(0.05, step);
    };
    step();
  }
  lineDamage(x: number, y: number, angle: number, len: number, width: number, dmg: number, w: DamageSource | null | undefined, o: AreaHitOpts = {}): void {
    const dx = Math.cos(angle), dy = Math.sin(angle);
    this.fx.line(x, y, angle, len, width, o.color || '#fff');
    this.eachEnemyIn(x + dx * len / 2, y + dy * len / 2, len / 2 + width, (e) => {
      const ex = e.x - x, ey = e.y - y; const t = ex * dx + ey * dy; if (t < -e.r || t > len + e.r) return;
      const px = dx * t, py = dy * t; if ((ex - px) * (ex - px) + (ey - py) * (ey - py) > (width / 2 + e.r) * (width / 2 + e.r)) return;
      this.damageEnemy(e, dmg, { weapon: w, kx: dx, ky: dy, knock: o.knock == null ? 0.8 : o.knock, crit: o.crit || 0 });
      if (o.status) this.applyStatus(e, o.status.type, o.status);
    });
  }
  arcSlash(x: number, y: number, angle: number, r: number, halfArc: number, dmg: number, w: DamageSource | null | undefined, o: AreaHitOpts = {}): void {
    this.fx.arc(x, y, angle, r, halfArc, o.color || '#fff', o.thin);
    this.eachEnemyIn(x, y, r, (e) => {
      const a = Math.atan2(e.y - y, e.x - x); let da = a - angle; while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU;
      if (Math.abs(da) > halfArc + e.r / Math.max(30, r)) return;
      this.damageEnemy(e, dmg, { weapon: w, kx: e.x - x, ky: e.y - y, knock: o.knock == null ? 1 : o.knock, crit: o.crit || 0 });
      if (o.burn) this.applyStatus(e, 'burn', { dur: o.burnDur || 3, dps: dmg * o.burn });
      if (o.status) this.applyStatus(e, o.status.type, o.status);
    });
  }
  lob(x: number, y: number, tx: number, ty: number, t: number, color: string, cb: () => void): void { this.fx.lob(x, y, tx, ty, t, color); this.after(t, cb); }
  meteor(x: number, y: number, delay: number, cb: () => void): void { this.fx.meteor(x, y, delay); this.after(delay, () => { this.fx.shake(2.5); cb(); }); }
  rain(x: number, y: number, r: number, count: number, dur: number, dmg: number, w: DamageSource | null | undefined, color: string): void {
    for (let i = 0; i < count; i++) {
      const a = rand() * TAU, d = Math.sqrt(rand()) * r;
      const tx = x + Math.cos(a) * d, ty = y + Math.sin(a) * d;
      this.after((i / count) * dur, () => { this.fx.arrowFall(tx, ty, color, 0.25); this.after(0.25, () => this.explode(tx, ty, 34, dmg, w, { color, small: true, quiet: true, knock: 0.3 })); });
    }
  }

  /* ==================== DAMAGE ==================== */
  /** Apply damage (crit, multipliers, hooks, lifesteal, death). Returns the damage dealt. */
  damageEnemy(e: Enemy, dmg: number, info: DamageInfo = {}): number {
    if (e.dead || e.hp <= 0) return 0;
    // map objects: any damage breaks them — no hooks, lifesteal, on-hit effects, statuses or credit
    if (e.object) { if (dmg > 0) this.breakCask(e); return 0; }
    const p = this.player;
    info.mult = 1; info.critBonus = +(info.crit || 0);
    const w = info.weapon;
    const h = p.char.hooks;
    if (h && h.onDamage && !info.execute) h.onDamage(this, p, e, info);
    let crit = false;
    const tags = w && w.def ? w.def.tags : undefined, st = e.st, f = p.f;
    if (!info.execute) {
      const cc = p.stats.crit + (info.critBonus ?? 0) + (p.critAllT > 0 ? 1 : 0);
      crit = rand() < cc;
      if (crit) dmg *= p.stats.critDmg;
      dmg *= info.mult ?? 1;
      if (e.elite || e.boss) dmg *= 1 + p.stats.eliteDmg;
      if (st.brittle) dmg *= BRITTLE_MUL;
      if (f.res_ice && (st.chill || st.freeze)) dmg *= 1.2;
      if (f.res_blight && tags && tags.includes('poison')) { dmg *= 1.4; e.weakT = 2; e.weak = 0.7; }
      if (e.hexed) dmg *= HEX.dmgTaken;
      // Bastion Knight: real weapon hits are judged against its shield (ticks, reactions, thorns bypass it)
      if (e.face !== undefined && w && !info.thorns && w.id !== 'burn' && w.id !== 'bleed' && w.id !== 'reaction') dmg *= this.shieldMul(e, info);
    }
    dmg = Math.max(0, dmg);
    if (e.barrier && e.barrier > 0 && dmg > 0) { const a = Math.min(e.barrier, dmg); e.barrier -= a; dmg -= a; e.barrierAt = this.time + 5; if (e.barrier <= 0) { this.fx.ring(e.x, e.y, e.r * 1.8, '#7dd3fc'); this.fx.burst(e.x, e.y, '#7dd3fc', 14, { speed: 160, life: 0.5 }); } }
    e.hp -= dmg; e.hitFlash = 0.08;
    if (e.escapeT !== undefined && dmg > 0) e.st.stagger = e.def.flee!.stagger; // the Hoarder stumbles under its sack when struck
    if (info.knock && !e.boss && e.mass < 30 && !e.immobile) { const [kx, ky] = U.norm(info.kx == null ? e.x - p.x : info.kx, info.ky == null ? e.y - p.y : info.ky); const f = (info.knock * 180 * (1 + p.stats.knockback)) / Math.max(0.5, e.mass); e.vx += kx * f; e.vy += ky * f; }
    if (w) { const key = dmgKey(w); this.dmgByWeapon[key] = (this.dmgByWeapon[key] || 0) + dmg; if (w.dmgDealt != null) w.dmgDealt += dmg; }
    if (!info.quiet || crit) {
      this.fx.dmgNumber(e.x, e.y - e.r, dmg, crit, e.boss);
      this.fx.hit(e.x, e.y - e.r * 0.3, info.kx ?? e.x - p.x, info.ky ?? e.y - p.y, e.def.col.eye, crit);
    }
    if (crit && !info.quiet) this.sfx('crit'); else if (!info.quiet) this.sfx('hit');
    // lifesteal
    if (p.stats.lifesteal > 0 && dmg > 0 && !info.thorns) this.heal(Math.min(dmg * p.stats.lifesteal, p.stats.maxHp * 0.05), true, true);
    // uniques on hit
    if (p.f.u_ignite && rand() < 0.1) this.applyStatus(e, 'burn', { dur: 2, dps: dmg * 0.5 });
    if (p.f.u_frost && rand() < 0.05) this.applyStatus(e, 'freeze', { dur: 1 });
    info.dmg = dmg; info.crit = crit;
    if (h && h.onHit && !info.execute && !(w && w.noMark)) h.onHit(this, p, e, info);
    // elements & run synergies (only real weapon hits: not burns, reactions or other derived damage)
    if (tags && !e.dead && e.hp > 0) {
      if (st.shock && f.res_storm && (st.arcAt ?? 0) <= this.time) { st.arcAt = this.time + 1; const o = this.nearestEnemy(e.x, e.y, 170, (x) => x !== e); if (o) { this.fx.beam(e.x, e.y, o.x, o.y, '#fde047', 2, 0.15); this.damageEnemy(o, dmg * 0.4, { weapon: { id: 'resonance' }, knock: 0.2 }); this.applyStatus(o, 'shock', { dur: 3 }); } }
      if (tags.includes('lightning')) this.applyStatus(e, 'shock', { dur: 3 });
      if (crit && f.res_steel) this.applyStatus(e, 'bleed', { dur: 3, dps: dmg * 0.25 });
      if (f.b_prism && rand() < 0.06) { const r = rand(); if (r < 0.34) this.applyStatus(e, 'burn', { dur: 3, dps: dmg * 0.3 }); else if (r < 0.67) this.applyStatus(e, 'chill', { dur: 2, power: 0.3 }); else this.applyStatus(e, 'shock', { dur: 3 }); }
      if (crit && f.b_volatile && rand() < 0.25) { const x = e.x, y = e.y, d = dmg * 0.35; this.after(0.05, () => this.explode(x, y, 45, d, { id: 'boon' }, { color: '#ffb347', small: true, quiet: true, knock: 0.4 })); }
    }
    if (e.hp <= 0) this.killEnemy(e, info);
    return dmg;
  }
  /** Bastion Knight shield: hits from the front arc are blocked down, hits from behind land harder. */
  private shieldMul(e: Enemy, info: DamageInfo): number {
    const sh = e.def.shield!, p = this.player;
    let kx = info.kx, ky = info.ky;
    if (kx == null || ky == null || (!kx && !ky)) { kx = e.x - p.x; ky = e.y - p.y; }
    if (!kx && !ky) return 1;
    // the push points away from the source, so the blow came from the opposite direction
    const da = Math.abs(angleDiff(Math.atan2(-ky, -kx), e.face ?? 0));
    if (da <= sh.arc) {
      const st = e.st;
      if ((e.blockAt ?? -1) + 0.15 <= this.time) {
        const fx = e.x + Math.cos(e.face ?? 0) * e.r, fy = e.y + Math.sin(e.face ?? 0) * e.r;
        this.fx.burst(fx, fy, '#fde68a', 3, { speed: 140, life: 0.2, size: 2 });
        if ((st.blockTextAt ?? -1) <= this.time) { st.blockTextAt = this.time + 0.6; this.fx.text(fx, e.y - e.r - 12, 'BLOCK', '#cbd5e1', true); }
        e.blockAt = this.time;
      }
      return sh.front;
    }
    return da >= Math.PI - sh.arc ? sh.back : 1;
  }
  applyStatus(e: Enemy, type: StatusSpec['type'], o: Omit<StatusSpec, 'type'> & { type?: string }): void {
    if (e.dead || e.object || e.buried) return;
    const st = e.st, dur = o.dur ?? 0;
    if (type === 'burn') {
      const cur = st.burn, base = Math.min(o.dps ?? 0, e.maxHp * 2), dps = base * (1 + this.player.stats.burnDmg);
      if (!cur) st.burn = { t: dur, base, dps, tick: 0.5 };
      else { cur.t = Math.max(cur.t, dur); if (base > cur.base) { cur.base = base; cur.dps = dps; } }
    }
    else if (type === 'bleed') { const cur = st.bleed, dps = Math.min(o.dps ?? 0, e.maxHp * 2); st.bleed = { t: dur, dps: Math.max(dps, cur ? cur.dps : 0), tick: cur ? cur.tick : 0.5 }; }
    else if (type === 'chill') {
      const power = e.boss ? Math.min(0.7, o.power ?? 0) : o.power ?? 0;
      const cur = st.chill; st.chill = { t: Math.max(dur, cur ? cur.t : 0), p: Math.max(power, cur ? cur.p : 0) };
      if (o.stackFreeze && !o.noStack && !e.boss) { st.chillN = (st.chillN || 0) + 1; if (st.chillN >= o.stackFreeze) { st.chillN = 0; this.applyStatus(e, 'freeze', { dur: 1.5 }); } }
    }
    else if (type === 'freeze') { if (e.boss) { this.applyStatus(e, 'chill', { dur, power: 0.6 }); return; } const d = dur * (o.noMul ? 1 : (this.player.freezeMul || 1)); if (!st.freeze) this.fx.burst(e.x, e.y, '#bae6fd', 6, { speed: 50, life: 0.4 }); st.freeze = Math.max(st.freeze || 0, d); }
    else if (type === 'stun') { if (e.boss) return; st.stun = Math.max(st.stun || 0, dur); }
    else if (type === 'shock') st.shock = Math.max(st.shock || 0, dur || 3);
    if (type === 'burn' || type === 'chill' || type === 'freeze' || type === 'shock') this.checkReaction(e, type);
  }
  /** Two elements on one enemy react: thermal shock (burn+chill), overload (burn+shock), superconduct (chill+shock). */
  private checkReaction(e: Enemy, added: StatusSpec['type']): void {
    const st = e.st;
    if (e.dead || (st.reactAt ?? 0) > this.time) return;
    const cold = !!(st.chill || st.freeze), hot = !!st.burn, shock = !!st.shock;
    const id: ReactionId | null = added === 'burn' ? (cold ? 'thermal' : shock ? 'overload' : null) : added === 'shock' ? (hot ? 'overload' : cold ? 'superconduct' : null) : hot ? 'thermal' : shock ? 'superconduct' : null;
    if (!id) return;
    const p = this.player, f = p.f, def = REACTION_DEFS[id];
    st.reactAt = this.time + REACTION_CD * (f.b_mastery ? 0.5 : 1);
    const R = (10 + p.level * 2.2) * p.stats.might * (1 + p.stats.reactDmg), src = { id: 'reaction' };
    this.reactions++;
    this.fx.callout(e.x, e.y - e.r - 14, def.name, def.color);
    if (id === 'thermal') {
      delete st.chill; delete st.freeze;
      this.fx.burst(e.x, e.y, '#e0f2fe', 14, { speed: 160, life: 0.45 }); this.fx.ring(e.x, e.y, e.r * 2.4, '#bae6fd', { thin: true });
      this.damageEnemy(e, R * 2 + (e.boss ? 0 : e.maxHp * 0.12), { weapon: src, knock: 0.6 });
    } else if (id === 'overload') {
      delete st.shock;
      this.explode(e.x, e.y, 80, R * 1.4, src, { color: '#fb923c', knock: 1.2, quiet: true });
    } else {
      delete st.shock; st.brittle = 4;
      this.fx.burst(e.x, e.y, '#a5f3fc', 10, { speed: 120, life: 0.4 });
      this.damageEnemy(e, R * 0.6, { weapon: src, knock: 0.2 });
    }
    this.sfx('react');
    if (!this.reacted.has(id)) { this.reacted.add(id); this.events.emit('discover', 'reaction', id); this.story('reaction', id); }
  }
  killEnemy(e: Enemy, info: DamageInfo): void {
    if (e.object) { this.breakCask(e); return; }
    if (e.dead) return;
    e.dead = true;
    const p = this.player;
    this.kills++; p.kills++;
    this.enemyKills[e.type] = (this.enemyKills[e.type] || 0) + 1;
    if (info.weapon) { const key = dmgKey(info.weapon); this.killsBySource[key] = (this.killsBySource[key] || 0) + 1; }
    this.fx.death(e);
    this.sfx('kill');
    this.addCombo();
    // drops
    this.dropLoot(e);
    if (e.def.split && !e.noSplit) { for (let i = 0; i < e.def.split.n; i++) { const a = rand() * TAU; const c = this.spawnEnemy(e.def.split.type, e.x + Math.cos(a) * 14, e.y + Math.sin(a) * 14, { tier: e.tier }); c.vx = Math.cos(a) * 160; c.vy = Math.sin(a) * 160; } }
    if (e.def.explode && !info.thorns && !info.noBlast) { const r = e.def.explode.r; if (U.dist(e.x, e.y, p.x, p.y) < r + p.r) this.hitPlayer(e.dmg * 1.2, e); this.fx.explosion(e.x, e.y, r, '#f97316'); }
    if (e.boss) this.onBossKilled(e);
    if (e.def.flee) { this.notice('The Hoarder is caught — its hoard spills out!', '#fde047', 3); this.fx.ring(e.x, e.y, 90, '#fde047'); this.fx.timeWarp(0.35, 0.25); this.fx.zoomPunch(0.05); this.sfx('chest'); }
    if (e.elite) { this.elites++; this.fx.timeWarp(0.35, 0.25); this.fx.zoomPunch(0.04); if (e.affixes && e.affixes.includes('brood')) for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU; this.spawnEnemy(e.type, e.x + Math.cos(a) * 20, e.y + Math.sin(a) * 20, { tier: e.tier, hpMul: 2.5 }).vx = Math.cos(a) * 200; } }
    if ((e.elite || e.boss) && p.f.b_overcharge) { p.activeCharges = p.activeMax; p.activeCdT = 0; }
    const f = p.f;
    const sh = e.st.shatter as { dmg: number; w: DamageSource | null | undefined } | undefined;
    if (sh && e.st.freeze) { const x = e.x, y = e.y; this.after(0.05, () => this.explode(x, y, 70, sh.dmg, sh.w, { color: '#e0f2fe', small: true, quiet: true, knock: 0.4 })); this.fx.burst(x, y, '#e0f2fe', 12, { speed: 170, life: 0.45 }); }
    if (f.res_fire && e.st.burn) { const x = e.x, y = e.y, d = e.st.burn.dps * 1.5 + 8 * p.stats.might; this.after(0.05, () => this.explode(x, y, 60, d, { id: 'resonance' }, { color: '#ff7a3c', small: true, quiet: true, knock: 0.5 })); }
    if (f.b_chain && !e.boss && rand() < 0.12) { const x = e.x, y = e.y, d = Math.min(e.maxHp * 0.3, (20 + p.level * 4) * p.stats.might); this.after(0.08, () => this.explode(x, y, 70, d, { id: 'boon' }, { color: '#fb923c', small: true, quiet: true })); }
    if (f.res_umbra && rand() < 0.04 && this.alliesOf('wraith').length < 8) this.spawnAlly({ kind: 'wraith', x: e.x, y: e.y, color: '#c084fc', life: 8, speed: 240, dmg: () => (14 + p.level * 1.6) * p.stats.might * (1 + p.stats.minionDmg), weapon: { id: 'resonance' } });
    if (f.b_harvest && this.kills % 150 === 0 && this.harvestMight < 0.4) this.harvestMight = Math.min(0.4, this.harvestMight + 0.01);
    const h = p.char.hooks; if (h && h.onKill) h.onKill(this, p, e);
    if (p.f.u_soulreaver) this.runMight = Math.min(0.4, this.runMight + 0.0003);
    if (p.f.u_bloodstone) this.heal(0.5, true, true);
    if (p.f.u_void && rand() < 0.06) this.spawnProj({ x: e.x, y: e.y, angle: rand() * TAU, speed: 280, r: 5, dmg: (12 + p.level) * p.stats.might, pierce: 0, life: 2, weapon: { id: 'unique', def: null }, homing: 6, sprite: { kind: 'orb', color: '#e879f9', size: 4 }, trail: '#e879f9' });
  }
  /** Give a dropped pickup a short outward burst (decays in `updatePickups`) so drops scatter instead of stacking. */
  private pop(o: PickupSpec, min = POP_MIN, max = POP_MAX): PickupSpec { const a = rand() * TAU, s = U.rand(min, max); o.vx = Math.cos(a) * s; o.vy = Math.sin(a) * s; return o; }
  private gemTier(xp: number): Pickup['gem'] { return xp >= 100 ? 'purple' : xp >= 25 ? 'red' : xp >= 6 ? 'green' : 'blue'; }
  private dropLoot(e: Enemy): void {
    const p = this.player, d = this.diff;
    const xp = e.xp * (this.bloodMoon > 0 ? BLOOD_MOON.xp : 1);
    this.spawnPickup(this.pop({ kind: 'gem', x: e.x + U.rand(-6, 6), y: e.y + U.rand(-6, 6), value: xp, gem: this.gemTier(xp) }));
    const goldChance = 0.05 + (e.elite ? 1 : 0) + (e.boss ? 1 : 0);
    if (rand() < goldChance * Math.min(2, p.stats.luck)) this.spawnPickup(this.pop({ kind: 'gold', x: e.x + U.rand(-10, 10), y: e.y + U.rand(-10, 10), value: Math.round((e.elite ? 25 : e.boss ? 200 : U.randi(1, 4)) * d.gold) }));
    if (!e.boss && !e.elite && rand() < 0.004 * (p.f.moreFood ? 2 : 1) * p.stats.luck) this.spawnPickup({ kind: 'food', x: e.x, y: e.y });
    if (e.elite) {
      this.spawnPickup({ kind: 'chest', x: e.x, y: e.y });
      const n = (U.randi(2, 4) + Math.floor(p.stats.matFind * 3) + (e.affixes ? e.affixes.length : 0)) * (p.f.b_hunter ? 2 : 1);
      for (let i = 0; i < n; i++) this.spawnPickup(this.pop({ kind: 'mat', mat: rand() < 0.2 * this.stage.tier ? 'dust' : 'iron', x: e.x + U.rand(-24, 24), y: e.y + U.rand(-24, 24) }));
      if (rand() < 0.35) this.spawnPickup(this.pop({ kind: 'ember', x: e.x + U.rand(-20, 20), y: e.y + U.rand(-20, 20), value: 1 }));
    }
    if (e.boss) {
      this.spawnPickup({ kind: 'bosschest', x: e.x, y: e.y });
      const tier = this.stage.tier;
      const drops: [MaterialId, number][] = [['dust', U.randi(3, 6)], ['crystal', U.randi(1, 2) + Math.floor(tier / 2)], ['star', rand() < 0.25 + tier * 0.15 ? 1 : 0]];
      drops.forEach(([m, n]) => { for (let i = 0; i < Math.round(n * (1 + p.stats.matFind)); i++) this.spawnPickup(this.pop({ kind: 'mat', mat: m, x: e.x + U.rand(-40, 40), y: e.y + U.rand(-40, 40) })); });
      const emb = 3 + e.bossTier * 2 + Math.floor(this.heat * 0.5);
      for (let i = 0; i < emb; i++) this.spawnPickup(this.pop({ kind: 'ember', x: e.x + U.rand(-50, 50), y: e.y + U.rand(-50, 50), value: 1 }));
    }
    // Gilded Hoarder: a fountain of gold, gems and materials around a guaranteed chest
    if (e.def.flee) {
      this.spawnPickup({ kind: 'chest', x: e.x, y: e.y });
      const gold = 14 + Math.floor(Math.max(0, p.stats.luck - 1) * 10);
      for (let i = 0; i < gold; i++) this.spawnPickup(this.pop({ kind: 'gold', x: e.x, y: e.y, value: Math.round(U.randi(4, 9) * d.gold) }, 90, 240));
      const gv = Math.max(3, xp * 0.4);
      for (let i = 0; i < 6; i++) this.spawnPickup(this.pop({ kind: 'gem', x: e.x, y: e.y, value: gv, gem: this.gemTier(gv) }, 90, 220));
      const mats = 3 + U.randi(0, 2) + Math.floor(p.stats.matFind * 3);
      for (let i = 0; i < mats; i++) this.spawnPickup(this.pop({ kind: 'mat', mat: rand() < 0.35 + 0.1 * this.stage.tier ? 'dust' : 'iron', x: e.x, y: e.y }, 90, 220));
      for (let i = 0; i < 2; i++) this.spawnPickup(this.pop({ kind: 'ember', x: e.x, y: e.y, value: 1 }, 90, 200));
    }
  }
  private onBossKilled(e: Enemy): void {
    this.bossKills++; const id = e.bossId ?? e.type; this.bossKillsBy[id] = (this.bossKillsBy[id] || 0) + 1;
    // another boss may still be alive (late-game tiers overlap): keep its health bar up
    if (this.boss === e) this.boss = this.enemies.find((o) => o.boss && !o.dead) ?? null;
    if (this.player.f.u_banner) { this.bannerMight += 0.08; this.recalc(); }
    this.fx.flash('#fff', 0.6); this.fx.shake(18); this.sfx('boss'); this.fx.timeWarp(0.2, 1.4); this.fx.zoomPunch(0.12);
    this.notice(e.def.name + ' has fallen!', '#fde68a', 4);
    this.story('bossDown', id);
  }

  /* ==================== ENEMIES ==================== */
  get diff(): Difficulty { if (!this._diff || this._diffT !== Math.floor(this.time)) { this._diff = difficulty(this.time, this.mods); this._diffT = Math.floor(this.time); } return this._diff; }
  spawnEnemy(type: string, x: number, y: number, o: SpawnOpts = {}): Enemy {
    const def = ENEMIES[type]!, d = this.diff, curse = this.player.stats.curse;
    const tier = o.tier != null ? o.tier : d.tier;
    const tierMul = 1 + tier * 0.15;
    const e: Enemy = {
      id: U.uid(), type, def, x, y, px: x, py: y, r: def.r, hp: 0, maxHp: 0, speed: def.speed * d.speed * U.rand(0.9, 1.1), dmg: def.dmg * d.dmg, xp: def.xp * d.xp * (0.8 + curse * 0.2), mass: def.mass || 1,
      vx: 0, vy: 0, st: {}, hitFlash: 0, icd: {}, elite: !!o.elite, boss: false, tier, dead: false, contactCd: rand() * 0.3, anim: rand() * TAU, wave: rand() * TAU,
      rush: o.rush || null, life: o.life || 0, atkT: U.rand(0.5, 2), chargeState: null, healT: 2, weakT: 0, weak: 1, spawnT: 0.4, flip: 1, bossTier: 0, attackIdx: 0, attack: null, mvx: 0, mvy: 0,
      // third-round state, declared up front so every enemy shares one hidden class (hot loops stay monomorphic)
      object: false, immobile: false, noContact: false, buried: false, hexed: false, burrow: undefined, face: undefined, blockAt: undefined, scream: undefined, screamT: undefined, auraR: undefined, escapeT: undefined,
    };
    e.maxHp = e.hp = def.hp * d.hp * tierMul * (0.85 + curse * 0.15) * (o.hpMul || 1);
    if (e.elite) { e.maxHp = e.hp = e.maxHp * 9; e.r = def.r * 1.45; e.dmg *= 1.5; e.xp *= 12; e.mass *= 3; e.speed *= 0.92; this.rollAffixes(e); }
    if (def.object || def.immobile || def.noContact || def.flee || def.burrow || def.shield || def.scream || def.aura) this.setupSpecial(e);
    this.enemies.push(e);
    return e;
  }
  /** Per-type state for the third-round enemies and map objects (see the Enemy fields in game/types.ts). */
  private setupSpecial(e: Enemy): void {
    const def = e.def, p = this.player;
    if (def.object) { e.object = true; e.maxHp = e.hp = 1; e.xp = 0; e.dmg = 0; e.spawnT = 0; }
    if (def.immobile) { e.immobile = true; e.speed = 0; }
    if (def.noContact) e.noContact = true;
    if (def.flee) { e.speed = CHAR_BASE.speed * def.flee.speedMul; e.escapeT = def.flee.escape; }
    if (def.burrow) { e.buried = true; e.burrow = { phase: 'tunnel', t: 0, max: 0 }; }
    if (def.shield) e.face = Math.atan2(p.y - e.y, p.x - e.x);
    if (def.scream) { e.scream = null; e.screamT = U.rand(2, 4); }
    if (def.aura) e.auraR = def.aura.r;
  }
  /** Elites roll affixes (more as the night deepens) that change how they fight. */
  private rollAffixes(e: Enemy): void {
    const m = this.diff.minute, n = m < 10 ? 1 : m < 22 ? 2 : 3;
    const pool = ELITE_AFFIXES.filter((a) => a.minute <= m && !(a.id === 'brood' && e.def.split));
    const out: string[] = [];
    while (out.length < n && pool.length) { const a = pool.splice(Math.floor(rand() * pool.length), 1)[0]!; out.push(a.id); }
    e.affixes = out; e.affT = U.rand(1, 3);
    for (const id of out) {
      if (id === 'swift') e.speed *= 1.45;
      else if (id === 'colossal') { e.r *= 1.3; e.maxHp = e.hp = e.maxHp * 1.6; e.mass = 40; e.dmg *= 1.2; }
      else if (id === 'warded') { e.barrierMax = e.barrier = e.maxHp * 0.35; e.barrierAt = 0; }
    }
  }
  /** Display name of an enemy with its affixes, e.g. "Molten Swift Grave Brute". */
  enemyName(e: Enemy): string { return (e.affixes || []).map((a) => AFFIX_BY_ID[a]!.name).join(' ') + (e.affixes && e.affixes.length ? ' ' : '') + e.def.name; }
  spawnBoss(bossId: string, tierUp = 0): Enemy {
    const def = BOSSES[bossId]!, d = this.diff;
    const a = rand() * TAU, p = this.player;
    const dist = Math.hypot(this.viewW, this.viewH) + 120;
    const x = p.x + Math.cos(a) * dist, y = p.y + Math.sin(a) * dist;
    const e: Enemy = {
      id: U.uid(), type: bossId, bossId, def, x, y, px: x, py: y, hp: 0, maxHp: 0, rush: null, life: 0, chargeState: null, mvx: 0, mvy: 0, r: def.r, speed: def.speed * (1 + tierUp * 0.05), dmg: def.dmg * d.dmg, xp: def.xp * d.xp, mass: def.mass,
      vx: 0, vy: 0, st: {}, hitFlash: 0, icd: {}, elite: false, boss: true, tier: 3, dead: false, contactCd: 0, anim: 0, wave: 0, atkT: 3, attackIdx: 0, attack: null, bossTier: tierUp, spawnT: 1.2, flip: 1, weakT: 0, weak: 1, healT: 0, phase: 1,
      // third-round state, declared up front so every enemy shares one hidden class (hot loops stay monomorphic)
      object: false, immobile: false, noContact: false, buried: false, hexed: false, burrow: undefined, face: undefined, blockAt: undefined, scream: undefined, screamT: undefined, auraR: undefined, escapeT: undefined,
    };
    e.maxHp = e.hp = def.hp * Math.max(1, d.hp * 0.55) * (1 + tierUp * 0.6) * this.mods.bossHp * (0.85 + p.stats.curse * 0.15);
    this.enemies.push(e); this.boss = e;
    this.sfx('boss'); this.fx.shake(12); this.fx.zoomPunch(-0.08);
    this.events.emit('discover', 'boss', bossId);
    this.story('bossIntro', bossId);
    return e;
  }
  spawnPos(pad = 80): [number, number] {
    const p = this.player, a = rand() * TAU;
    const rx = this.viewW + pad + rand() * 120, ry = this.viewH + pad + rand() * 120;
    // pick a point on the rectangle ring outside the view
    const cx = Math.cos(a), cy = Math.sin(a);
    const t = Math.min(rx / Math.abs(cx || 1e-6), ry / Math.abs(cy || 1e-6));
    return [p.x + cx * t, p.y + cy * t];
  }
  private updateSpawns(dt: number): void {
    const d = this.diff, p = this.player, m = d.minute;
    // spawn table
    for (const row of SPAWN_TABLE) if (m >= row.at) this.spawnTable = row;
    // the horde size ignores map objects (casks)
    let count = 0;
    for (const e of this.enemies) if (!e.object) count++;
    const want = d.count * (0.85 + p.stats.curse * 0.15) * (this.trial ? 1.8 : 1);
    if (count < want) {
      this.spawnAcc += dt * Math.min(4 + m * 0.6, 2 + (want - count) * 0.12);
      while (this.spawnAcc >= 1 && count < want + 10) {
        this.spawnAcc -= 1;
        const types = this.spawnTable.types; const keys = Object.keys(types);
        const type = U.weightedPick(keys, (k) => types[k]);
        const [x, y] = this.spawnPos();
        this.spawnEnemy(type, x, y);
        count++;
      }
    }
    // elites
    this.eliteT -= dt;
    if (this.eliteT <= 0 && this.time > 50) {
      this.eliteT = (75 - Math.min(25, m)) / this.mods.elite;
      const keys = Object.keys(this.spawnTable.types).filter((k) => !ENEMIES[k].noSpawn);
      const [x, y] = this.spawnPos(40);
      const e = this.spawnEnemy(U.pick(keys), x, y, { elite: true });
      this.notice(this.enemyName(e) + ' hunts you', '#c084fc', 3);
      this.story('elite', e.type);
    }
    // scripted events
    while (this.eventIdx < EVENTS.length && this.time >= EVENTS[this.eventIdx].at) { this.runEvent(EVENTS[this.eventIdx]); this.eventIdx++; }
    if (this.time >= 1500) {
      this.lateEventT -= dt;
      if (this.lateEventT <= 0) {
        this.lateCycle = (this.lateCycle || 0) + 1;
        this.lateEventT = 90;
        if (this.lateCycle % 3 === 0) { const idx = Math.floor(this.lateCycle / 3); this.runEvent({ type: 'boss', boss: BOSS_ORDER[idx % 5], tierUp: 1 + Math.floor(idx / 5) + Math.floor((this.time - 1500) / 600) }); }
        else if (this.lateCycle % 3 === 1) this.runEvent({ type: 'swarm', enemy: U.pick(['bat', 'spider', 'bomber', 'wraith']), n: 60 + Math.floor(m * 2) });
        else {
          this.runEvent({ type: 'ring', enemy: U.pick(['brute', 'golem', 'skeleton', 'charger', 'bastion']), n: 30 + Math.floor(m) });
          // the new run events rotate in alongside every ring: meteors → blood moon → hoarder → …
          this.runEvent(LATE_SPECIALS[Math.floor(this.lateCycle / 3) % LATE_SPECIALS.length]!);
        }
      }
    }
    this.updateWorldEvents(dt);
    // braziers & food
    this.brazierT -= dt; if (this.brazierT <= 0) { this.brazierT = 40; const [x, y] = this.spawnPos(-40); this.spawnPickup({ kind: 'brazier', x, y, hp: 3 }); }
    // shrines: a couple of bargains somewhere out in the dark
    this.shrineT -= dt;
    if (this.shrineT <= 0) {
      this.shrineT = U.rand(55, 80);
      if (this.shrines.filter((s) => !s.used).length < 2) {
        const a = rand() * TAU, dd = U.rand(620, 900), kind = U.weightedPick(SHRINE_KINDS, (k) => SHRINE_DEFS[k].weight);
        this.shrines.push({ id: U.uid(), kind, x: p.x + Math.cos(a) * dd, y: p.y + Math.sin(a) * dd, r: SHRINE_RADIUS, charge: 0, used: false, age: 0, usedAt: 0, dead: false });
      }
    }
    // recycle far enemies; map objects and totems left far behind simply crumble, the Hoarder is never recycled
    const view = Math.hypot(this.viewW, this.viewH), maxD2 = Math.pow(view * 1.9, 2), dropD2 = Math.pow(view * 2.1, 2);
    for (const e of this.enemies) {
      if (e.boss || e.rush || e.dead || e.escapeT !== undefined) continue;
      const d2 = U.dist2(e.x, e.y, p.x, p.y);
      if (e.immobile) { if (d2 > dropD2) e.dead = true; continue; }
      if (d2 > maxD2) { const [x, y] = this.spawnPos(); e.x = x; e.y = y; }
    }
  }
  /** Timed map events: Blood Moon and meteor shower clocks, Ember Casks, the Gilded Hoarder, Hex Totems. */
  private updateWorldEvents(dt: number): void {
    if (this.bloodMoon > 0) { this.bloodMoon = Math.max(0, this.bloodMoon - dt); if (this.bloodMoon === 0) this.notice('The Blood Moon sets.', '#fca5a5', 2.5); }
    if (this.meteorShower > 0) {
      this.meteorShower = Math.max(0, this.meteorShower - dt); this.meteorT -= dt;
      while (this.meteorT <= 0 && this.meteorShower > 0) { this.meteorT += METEOR_SHOWER.every; this.dropMeteor(); }
    }
    if (this.time >= this.caskAt) { this.caskAt = this.time + U.rand(CASK.every[0], CASK.every[1]); this.spawnCasks(); }
    if (this.time >= this.hoarderAt) { this.hoarderAt = this.time + U.rand(HOARDER.every[0], HOARDER.every[1]); this.spawnHoarder(); }
    if (this.diff.minute >= TOTEM.minute && this.time >= this.totemAt) { this.totemAt = this.time + U.rand(TOTEM.every[0], TOTEM.every[1]); this.spawnTotem(); }
  }
  /** Unit vector the player is travelling in (or facing, when standing still). */
  private heading(): [number, number] {
    const p = this.player, l = Math.hypot(p.move.x, p.move.y);
    return l > 0.1 ? [p.move.x / l, p.move.y / l] : [p.face.x, p.face.y];
  }
  private countAlive(pred: (e: Enemy) => boolean): number { let n = 0; for (const e of this.enemies) if (!e.dead && pred(e)) n++; return n; }
  /** A cluster of Ember Casks ahead of the player, so a chase naturally runs past them. */
  spawnCasks(): Enemy[] {
    const p = this.player, out: Enemy[] = [], have = this.countAlive((e) => !!e.object);
    const [hx, hy] = this.heading();
    const a = Math.atan2(hy, hx) + U.rand(-0.6, 0.6), d = U.rand(CASK.dist[0], CASK.dist[1]);
    const cx = p.x + Math.cos(a) * d, cy = p.y + Math.sin(a) * d, n = U.randi(CASK.n[0], CASK.n[1]);
    for (let i = 0; i < n && have + i < CASK.max; i++) {
      const b = rand() * TAU, r = i === 0 ? 0 : U.rand(30, 75);
      out.push(this.spawnEnemy('cask', cx + Math.cos(b) * r, cy + Math.sin(b) * r));
    }
    return out;
  }
  /** An Ember Cask breaks: a burning blast that wrecks the horde (never the player) and chain-detonates its neighbours. */
  private breakCask(e: Enemy): void {
    if (e.dead) return;
    e.dead = true; e.hp = 0;
    const x = e.x, y = e.y, p = this.player, d = this.diff;
    const dmg = (60 * d.hp * (1 + d.tier * 0.15) + 5 * p.level) * p.stats.might;
    const src: DamageSource = { id: 'cask' }, c2 = CASK.chain * CASK.chain;
    for (const o of this.enemies) {
      if (!o.object || o.dead || o.st.primed || U.dist2(o.x, o.y, x, y) > c2) continue;
      o.st.primed = true;
      this.after(CASK.chainDelay, () => this.breakCask(o));
    }
    this.envBlast(x, y, CASK.r, dmg, src, CASK.bossCap, 0.15, false);
    this.spawnZone({ x, y, r: CASK.r * 0.6, dur: CASK.fireDur, tick: 0.5, dmg: dmg * 0.05, burn: 0.5, color: '#ff7a3c', kind: 'fire', weapon: src });
    this.fx.burst(x, y, '#fde047', 14, { speed: 260, life: 0.5, size: 4 });
    this.fx.shake(9);
  }
  /**
   * Environmental blast (casks, meteors): damages enemies in the radius — bosses only lose a capped share of
   * their health — and may burn them. Never touches the player. `casks`: also break casks caught in it.
   */
  private envBlast(x: number, y: number, r: number, dmg: number, src: DamageSource, bossCap: number, burn: number, casks: boolean): void {
    this.eachEnemyIn(x, y, r, (o) => {
      if (o.object) { if (casks) this.breakCask(o); return; }
      this.damageEnemy(o, o.boss ? Math.min(dmg, o.maxHp * bossCap) : dmg, { weapon: src, kx: o.x - x, ky: o.y - y, knock: 1.2, quiet: true });
      if (burn && !o.dead) this.applyStatus(o, 'burn', { dur: 3, dps: dmg * burn });
    });
    this.fx.explosion(x, y, r, '#ff7a3c');
    this.sfx('explode');
  }
  /** One meteor of a shower: telegraphed, then it hits the horde hard and the player moderately. */
  private dropMeteor(): void {
    const p = this.player, d = this.diff, a = rand() * TAU, dist = Math.sqrt(rand()) * METEOR_SHOWER.spread, R = METEOR_SHOWER.r;
    const x = p.x + Math.cos(a) * dist, y = p.y + Math.sin(a) * dist;
    const dmg = (45 * d.hp * (1 + d.tier * 0.15) + 5 * p.level) * p.stats.might;
    this.meteor(x, y, METEOR_SHOWER.delay, () => {
      const q = this.player;
      if (U.dist(q.x, q.y, x, y) < R) this.hitPlayer(this.diff.dmg * 16, { def: { name: 'a falling star' } });
      this.envBlast(x, y, R, dmg, { id: 'meteor' }, METEOR_SHOWER.bossCap, 0, true);
    });
  }
  /** The Gilded Hoarder appears just off-screen (at most two at a time). */
  spawnHoarder(): Enemy | null {
    if (this.countAlive((e) => !!e.def.flee) >= HOARDER.max) return null;
    const [x, y] = this.spawnPos(10);
    const e = this.spawnEnemy('hoarder', x, y);
    this.notice('A Gilded Hoarder appears — catch it!', '#fbbf24', 4); this.sfx('gold');
    this.story('hoarder');
    return e;
  }
  private hoarderEscapes(e: Enemy): void {
    e.dead = true;
    this.fx.burst(e.x, e.y, '#fbbf24', 24, { speed: 170, life: 0.6, up: true }); this.fx.ring(e.x, e.y, 60, '#fde047', { thin: true });
    this.notice('The Hoarder escaped with its gold.', '#a8a29e', 3);
  }
  /** A Hex Totem rises 300–500px ahead of the player. */
  spawnTotem(): Enemy | null {
    if (this.countAlive((e) => !!e.def.aura) >= TOTEM.max) return null;
    const p = this.player, [hx, hy] = this.heading();
    const a = Math.atan2(hy, hx) + U.rand(-0.35, 0.35), d = U.rand(TOTEM.dist[0], TOTEM.dist[1]);
    const e = this.spawnEnemy('totem', p.x + Math.cos(a) * d, p.y + Math.sin(a) * d);
    this.fx.ring(e.x, e.y, e.auraR ?? HEX.r, '#a855f7'); this.sfx('summon');
    this.notice('A Hex Totem rises — the horde around it grows bold', '#a855f7', 3);
    return e;
  }
  runEvent(ev: ScriptedEvent): void {
    const p = this.player;
    if (ev.type === 'boss') { this.spawnBoss(ev.boss, ev.tierUp || 0); return; }
    if (ev.type === 'swarm') {
      const a = rand() * TAU, dir = a + Math.PI; const dist = Math.hypot(this.viewW, this.viewH) + 80;
      const cx = p.x + Math.cos(a) * dist, cy = p.y + Math.sin(a) * dist, px = -Math.sin(a), py = Math.cos(a);
      for (let i = 0; i < ev.n; i++) { const off = (i - ev.n / 2) * 26 + U.rand(-10, 10), back = rand() * 200; const e = this.spawnEnemy(ev.enemy, cx + px * off + Math.cos(a) * back, cy + py * off + Math.sin(a) * back, { rush: { x: Math.cos(dir), y: Math.sin(dir) }, life: 16 }); e.speed *= 1.6; }
      this.notice('A swarm rushes in!', '#f0abfc', 3); return;
    }
    if (ev.type === 'ring') {
      const dist = Math.hypot(this.viewW, this.viewH) + 60;
      for (let i = 0; i < ev.n; i++) { const a = (i / ev.n) * TAU; this.spawnEnemy(ev.enemy, p.x + Math.cos(a) * dist, p.y + Math.sin(a) * dist, { hpMul: 1.2 }); }
      this.notice('You are surrounded!', '#f87171', 3);
      return;
    }
    if (ev.type === 'bloodmoon') {
      this.bloodMoon = BLOOD_MOON.dur;
      this.notice('The Blood Moon rises…', '#ef4444', 4); this.fx.flash('#7f1d1d', 0.45); this.sfx('boss');
      this.story('bloodMoon');
      return;
    }
    if (ev.type === 'meteors') {
      this.meteorShower = METEOR_SHOWER.dur; this.meteorT = 0.4;
      this.notice('Stars are falling — mind the sky!', '#fb923c', 3); this.sfx('thunder');
      this.story('meteors');
      return;
    }
    if (ev.type === 'hoarder') this.spawnHoarder();
  }
  private updateEnemies(dt: number): void {
    const p = this.player, d = this.diff;
    const px = p.x, py = p.y;
    // Hex Totems: mark everything inside an aura for this step
    const hexers = this.hexers; hexers.length = 0;
    for (const e of this.enemies) { if (e.hexed) e.hexed = false; if (e.auraR !== undefined && !e.dead) hexers.push(e); }
    for (const t of hexers) this.eachEnemyIn(t.x, t.y, t.auraR!, (o) => { if (!o.boss && !o.object && o.auraR === undefined && o.escapeT === undefined) o.hexed = true; });
    const moon = this.bloodMoon > 0;
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.dead) continue;
      e.anim += dt * 6; e.hitFlash -= dt; e.spawnT -= dt; e.contactCd -= dt; e.weakT -= dt;
      if (e.object) continue; // casks are inert until struck
      if (e.life) { e.life -= dt; if (e.life <= 0) { e.dead = true; continue; } }
      if (e.escapeT != null) { e.escapeT -= dt; if (e.escapeT <= 0) { this.hoarderEscapes(e); continue; } }
      // statuses
      const st = e.st;
      let spdMul = 1, frozen = false;
      if (st.burn) { st.burn.t -= dt; st.burn.tick -= dt; if (st.burn.tick <= 0) { st.burn.tick = 0.5; this.damageEnemy(e, st.burn.dps * 0.5, { weapon: { id: 'burn' }, quiet: true, noKnock: true }); this.fx.burst(e.x, e.y - e.r * 0.5, '#ff7043', 1, { speed: 30, life: 0.5, up: true, size: 3 }); } if (st.burn.t <= 0) delete st.burn; if (e.dead) continue; }
      if (st.bleed) { st.bleed.t -= dt; st.bleed.tick -= dt; if (st.bleed.tick <= 0) { st.bleed.tick = 0.5; this.damageEnemy(e, st.bleed.dps * 0.5, { weapon: { id: 'bleed' }, quiet: true }); } if (st.bleed.t <= 0) delete st.bleed; if (e.dead) continue; }
      if (st.chill) { st.chill.t -= dt; spdMul *= 1 - st.chill.p; if (st.chill.t <= 0) delete st.chill; }
      if (st.freeze) { st.freeze -= dt; frozen = true; if (st.freeze <= 0) delete st.freeze; }
      if (st.stun) { st.stun -= dt; frozen = true; if (st.stun <= 0) delete st.stun; }
      if (st.shock) { st.shock -= dt; if (st.shock <= 0) delete st.shock; }
      if (st.brittle) { st.brittle -= dt; if (st.brittle <= 0) delete st.brittle; }
      // movement
      const dx = px - e.x, dy = py - e.y, dist = Math.hypot(dx, dy) || 1;
      const nx = dx / dist, ny = dy / dist;
      if (p.f.b_dilation && dist < 170 && !e.boss) spdMul *= 0.65;
      if (e.hexed) spdMul *= HEX.speed;
      if (moon && !e.boss && e.escapeT === undefined) spdMul *= BLOOD_MOON.speed;
      if (e.affixes && !frozen && e.spawnT <= 0) spdMul *= this.updateAffixes(e, dt, dist);
      if (e.burrow) this.updateBurrow(e, dt, dist);
      let mvx = 0, mvy = 0;
      if (!frozen) {
        if (e.face !== undefined) { const want = Math.atan2(dy, dx), cur = e.face, turn = e.def.shield!.turn * dt; e.face = cur + U.clamp(angleDiff(want, cur), -turn, turn); }
        if (e.boss) { this.bossAI(e, dt, nx, ny, dist); mvx = e.mvx || 0; mvy = e.mvy || 0; }
        else if (e.rush) { mvx = e.rush.x; mvy = e.rush.y; }
        else if (e.buried) { if (e.burrow!.phase === 'tunnel') { const k = e.def.burrow!.speedMul; mvx = nx * k; mvy = ny * k; } }
        else if (e.escapeT !== undefined) { this.fleeMove(e, nx, ny, dist); mvx = e.mvx; mvy = e.mvy; }
        else if (e.screamT !== undefined) { this.updateBanshee(e, dt, nx, ny, dist); mvx = e.mvx; mvy = e.mvy; }
        else if (e.chargeState) {
          const c = e.chargeState, ch = e.def.charge!; c.t -= dt;
          if (c.phase === 'windup') { if (c.t <= 0) { c.phase = 'go'; c.t = ch.dur; c.dx = nx; c.dy = ny; } }
          else { mvx = c.dx! * (ch.speed / (e.speed * spdMul || 1)); mvy = c.dy! * (ch.speed / (e.speed * spdMul || 1)); if (c.t <= 0) { e.chargeState = null; e.atkT = ch.cd; } }
        }
        else {
          const def = e.def;
          if (def.ranged || def.ring) {
            const R = (def.ranged || def.ring)!;
            if (dist > R.keep) { mvx = nx; mvy = ny; } else if (dist < R.keep * 0.6) { mvx = -nx * 0.6; mvy = -ny * 0.6; }
            e.atkT -= dt;
            if (e.atkT <= 0 && dist < R.range) {
              e.atkT = R.cd * U.rand(0.85, 1.15);
              if (def.ranged) this.spawnEnemyProj(e.x, e.y, Math.atan2(dy, dx), R.speed, R.dmg * d.dmg, def.col.eye);
              else { const n = def.ring!.n; for (let k = 0; k < n; k++) this.spawnEnemyProj(e.x, e.y, (k / n) * TAU + e.anim, R.speed, R.dmg * d.dmg, def.col.eye); }
            }
          } else {
            mvx = nx; mvy = ny;
            if (def.move === 'wave') { const s = Math.sin(e.anim * 0.7 + e.wave) * 0.8; mvx += -ny * s; mvy += nx * s; }
            else if (def.move === 'flutter') { const s = Math.sin(e.anim * 1.3 + e.wave) * 0.6; mvx += -ny * s; mvy += nx * s; }
            if (def.charge) { e.atkT -= dt; if (e.atkT <= 0 && dist < 320 && dist > 60) { e.chargeState = { phase: 'windup', t: def.charge.windup }; this.fx.telegraphLine(e, px, py, def.charge.windup); } }
            const heal = def.heal; if (heal) { e.healT -= dt; if (e.healT <= 0) { e.healT = heal.cd; let n = 0; this.eachEnemyIn(e.x, e.y, heal.r, (o) => { if (o !== e && !o.boss && !o.object && o.hp < o.maxHp) { o.hp = Math.min(o.maxHp, o.hp + o.maxHp * heal.pct); n++; } }); if (n) this.fx.ring(e.x, e.y, heal.r, '#a3e635', { thin: true }); } }
          }
        }
        if (e.chargeState && e.chargeState.phase === 'windup') { mvx = 0; mvy = 0; }
        // bomber: arm when close, hold still while the fuse burns (a fair chance to step out of the blast)
        if (e.def.explode && e.spawnT <= 0) {
          if (e.fuse == null) { if (dist < e.r + p.r + 26) e.fuse = BOMBER_FUSE; }
          else { e.fuse -= dt; mvx = 0; mvy = 0; if (Math.floor(e.fuse * 12) % 2 === 0) e.hitFlash = 0.04; }
        }
      }
      const spd = e.speed * spdMul * (e.spawnT > 0 ? 0.5 : 1);
      e.x += mvx * spd * dt + e.vx * dt; e.y += mvy * spd * dt + e.vy * dt;
      e.vx *= Math.pow(0.02, dt); e.vy *= Math.pow(0.02, dt);
      if (mvx !== 0) e.flip = mvx < 0 ? -1 : 1;
      // contact damage
      if (e.contactCd <= 0 && !frozen && !e.buried && !e.noContact) {
        const rr = e.r + p.r;
        if (dx * dx + dy * dy < rr * rr) {
          e.contactCd = e.boss ? 0.7 : 0.55;
          const hp0 = p.hp, frenzy = e.affixes && e.affixes.includes('frenzied') && e.hp < e.maxHp * 0.5 ? 1.3 : 1;
          this.hitPlayer(e.dmg * frenzy * (e.chargeState && e.chargeState.phase === 'go' ? 1.6 : 1) * (e.weakT > 0 ? e.weak : 1), e);
          if (p.hp < hp0 && e.affixes && e.affixes.includes('vampiric')) { e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.12); this.fx.burst(e.x, e.y, '#f87171', 8, { speed: 60, life: 0.5, up: true }); }
        }
      }
      // self-destruct: not a hit by the player (no lifesteal, crits or on-hit effects)
      if (e.fuse != null && e.fuse <= 0) { e.hp = 0; this.killEnemy(e, { weapon: null }); }
    }
    compact(this.enemies);
    // separation (every other step); immobile things (casks, totems) and bosses hold their ground, buried worms pass underneath
    if (this.frame % 2 === 0) {
      const near = this.sepHits;
      for (const e of this.enemies) {
        if (e.dead || e.boss || e.buried) continue;
        const n = this.grid.candidates(e.x, e.y, e.r + 30, near);
        for (let j = 0; j < n; j++) {
          const o = near[j]!;
          if (o === e || o.dead || o.id < e.id) continue;
          const dx = o.x - e.x, dy = o.y - e.y; const rr = (e.r + o.r) * 0.9; const d2 = dx * dx + dy * dy;
          if (d2 < rr * rr && d2 > 0.01) {
            const eFix = e.immobile, oFix = o.boss || o.immobile;
            if (eFix && oFix) continue;
            const d = Math.sqrt(d2), push = (rr - d) * 0.5; const ux = dx / d, uy = dy / d; const me = e.mass, mo = o.mass, tot = me + mo;
            const fe = eFix ? 0 : o.immobile ? 2 : (mo / tot) * 2, fo = oFix ? 0 : eFix ? 2 : (me / tot) * 2;
            e.x -= ux * push * fe; e.y -= uy * push * fe; o.x += ux * push * fo; o.y += uy * push * fo;
          }
        }
      }
    }
  }
  /**
   * Gilded Hoarder: creeps to the edge of sight, then zig-zags away from the player (writes `mvx/mvy`).
   * The sack is heavy: it stumbles when struck and tires the longer it is chased (down to `winded`).
   */
  private fleeMove(e: Enemy, nx: number, ny: number, dist: number): void {
    const fl = e.def.flee!, s = Math.sin(e.anim * 0.45 + e.wave) * 1.1, st = e.st;
    let mx = 0, my = 0;
    if (dist < fl.range) { mx = -nx; my = -ny; st.chased = (st.chased ?? 0) + this.dt; } else if (dist > fl.range + 90) { mx = nx * 0.45; my = ny * 0.45; }
    mx += -ny * s; my += nx * s;
    const l = Math.hypot(mx, my); if (l > 1) { mx /= l; my /= l; }
    const tire = Math.max(fl.winded, 1 - fl.tire * (st.chased ?? 0));
    mx *= tire; my *= tire;
    if (st.stagger > 0) { st.stagger -= this.dt; mx *= 0.5; my *= 0.5; }
    e.mvx = mx; e.mvy = my;
  }
  /** Grave Worm cycle: tunnel toward the player → telegraphed eruption → fight on the surface → burrow again. */
  private updateBurrow(e: Enemy, dt: number, dist: number): void {
    const b = e.burrow!, def = e.def.burrow!;
    if (b.phase === 'surface') {
      b.t -= dt;
      if (b.t <= 0) { e.buried = true; b.phase = 'tunnel'; b.t = b.max = 0; e.chargeState = null; this.fx.burst(e.x, e.y, e.def.col.body, 10, { speed: 90, life: 0.5, add: false, grav: 200 }); }
    } else if (b.phase === 'tunnel') {
      if (dist < def.trigger && e.spawnT <= 0) { b.phase = 'erupt'; b.t = b.max = def.windup; this.fx.telegraphCircle(e.x, e.y, def.r, def.windup, e.def.col.eye); }
    } else {
      b.t -= dt;
      if (b.t <= 0) this.erupt(e);
    }
  }
  private erupt(e: Enemy): void {
    const def = e.def.burrow!, b = e.burrow!, p = this.player;
    e.buried = false; b.phase = 'surface'; b.t = b.max = def.surface; e.contactCd = Math.max(e.contactCd, 0.4);
    if (U.dist(p.x, p.y, e.x, e.y) < def.r + p.r) this.hitPlayer(e.dmg * 1.6, e);
    // the ground heaves: everything nearby is thrown clear (e itself is not in the grid yet)
    this.eachEnemyIn(e.x, e.y, def.r + 40, (o) => { if (o.boss || o.immobile) return; const [kx, ky] = U.norm(o.x - e.x, o.y - e.y); const f = 420 / Math.max(0.5, o.mass); o.vx += kx * f; o.vy += ky * f; });
    this.fx.explosion(e.x, e.y, def.r, e.def.col.accent ?? e.def.col.body);
    this.fx.burst(e.x, e.y, e.def.col.body, 16, { speed: 200, life: 0.6, add: false, grav: 300 });
    this.fx.shake(4); this.sfx('explode');
  }
  /** Wailing Banshee: hovers at mid-range and winds up a scream cone (writes `mvx/mvy`). */
  private updateBanshee(e: Enemy, dt: number, nx: number, ny: number, dist: number): void {
    const sc = e.def.scream!, p = this.player;
    e.mvx = 0; e.mvy = 0;
    if (e.scream) {
      const s = e.scream; s.t -= dt;
      if (s.t <= 0) { e.scream = null; e.screamT = sc.cd * U.rand(0.9, 1.1); this.screamFire(e, s); }
      return;
    }
    e.screamT = (e.screamT ?? sc.cd) - dt;
    if (e.screamT <= 0 && dist < sc.range * 1.05 && e.spawnT <= 0) {
      e.scream = { t: sc.windup, max: sc.windup, ang: Math.atan2(p.y - e.y, p.x - e.x), arc: sc.arc, range: sc.range };
      this.fx.ring(e.x, e.y, e.r + 18, e.def.col.accent ?? e.def.col.eye, { thin: true, life: sc.windup });
      return;
    }
    let mx = 0, my = 0;
    if (dist > sc.keep + 30) { mx = nx; my = ny; } else if (dist < sc.keep - 60) { mx = -nx * 0.7; my = -ny * 0.7; }
    const s = Math.sin(e.anim * 0.5 + e.wave) * 0.6; mx += -ny * s; my += nx * s;
    e.mvx = mx; e.mvy = my;
  }
  private screamFire(e: Enemy, s: NonNullable<Enemy['scream']>): void {
    const sc = e.def.scream!, p = this.player, col = e.def.col.accent ?? e.def.col.eye;
    this.fx.arc(e.x, e.y, s.ang, s.range, s.arc / 2, col);
    this.fx.burst(e.x + Math.cos(s.ang) * s.range * 0.5, e.y + Math.sin(s.ang) * s.range * 0.5, col, 10, { speed: 160, life: 0.4 });
    this.sfx('nova');
    const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy);
    if (d > s.range + p.r) return;
    const slack = d > 1 ? Math.asin(Math.min(1, p.r / d)) : Math.PI;
    if (Math.abs(angleDiff(Math.atan2(dy, dx), s.ang)) > s.arc / 2 + slack) return;
    const shielded = p.invulnT > 0;
    this.hitPlayer(e.dmg * sc.dmg, e);
    if (!shielded) p.slowT = Math.max(p.slowT, sc.slow);
  }
  /** Per-step elite affix behaviour. Returns a speed multiplier. */
  private updateAffixes(e: Enemy, dt: number, dist: number): number {
    const p = this.player; let spd = 1;
    e.affT = (e.affT ?? 2) - dt;
    const ready = e.affT <= 0;
    for (const id of e.affixes!) {
      if (id === 'frenzied' && e.hp < e.maxHp * 0.5) spd *= 1.5;
      else if (id === 'vampiric') e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.01 * dt);
      else if (id === 'warded' && e.barrierMax && (e.barrier ?? 0) < e.barrierMax && (e.barrierAt ?? 0) <= this.time) e.barrier = Math.min(e.barrierMax, (e.barrier ?? 0) + e.barrierMax * 0.5 * dt);
      else if (id === 'molten' && this.frame % 24 === 0) this.spawnHazard({ x: e.x, y: e.y, r: 30 + e.r * 0.4, dmg: e.dmg * 0.3, life: 3.5, color: '#fb923c', status: 'burn', arm: 0.5 });
      else if (ready && id === 'arcane') { for (let k = 0; k < 8; k++) this.spawnEnemyProj(e.x, e.y, (k / 8) * TAU + e.anim, 170, e.dmg * 0.5, '#c084fc'); }
      else if (ready && id === 'necrotic' && dist < 700) { for (let k = 0; k < 3; k++) { const a = rand() * TAU; this.spawnEnemy(rand() < 0.5 ? 'skeleton' : 'ghoul', e.x + Math.cos(a) * (e.r + 24), e.y + Math.sin(a) * (e.r + 24)); } this.fx.ring(e.x, e.y, e.r + 30, '#86efac', { thin: true }); }
      else if (ready && id === 'phasing' && dist > 140 && dist < 900) {
        const a = rand() * TAU, tx = p.x + Math.cos(a) * 110, ty = p.y + Math.sin(a) * 110;
        this.fx.telegraphCircle(tx, ty, e.r + 8, 0.7, '#e879f9');
        this.after(0.7, () => { if (e.dead) return; this.fx.burst(e.x, e.y, '#e879f9', 14, { speed: 140, life: 0.4 }); e.x = e.px = tx; e.y = e.py = ty; this.fx.burst(tx, ty, '#e879f9', 14, { speed: 140, life: 0.4 }); });
      }
    }
    if (ready) e.affT = 3.5 + rand() * 1.5;
    return spd;
  }
  spawnEnemyProj(x: number, y: number, angle: number, speed: number, dmg: number, color?: string): void { this.eprojs.push({ x, y, px: x, py: y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, r: 6, dmg, life: 4, color: color || '#f87171', dead: false }); }
  private bossAI(e: Enemy, dt: number, nx: number, ny: number, _dist: number): void {
    const p = this.player, def = e.def;
    e.mvx = 0; e.mvy = 0;
    if (e.attack) {
      const a = e.attack as Required<BossAttack>; a.t -= dt;
      if (a.type === 'charge') { if (a.phase === 'windup') { if (a.t <= 0) { a.phase = 'go'; a.t = 0.75; a.dx = nx; a.dy = ny; } } else { e.mvx = a.dx * 6.5; e.mvy = a.dy * 6.5; if (a.t <= 0) e.attack = null; } }
      else if (a.type === 'dash') { if (a.t <= 0) { a.n--; if (a.n <= 0) e.attack = null; else { a.t = 0.45; a.dx = nx; a.dy = ny; } } else { e.mvx = (a.dx || nx) * 5; e.mvy = (a.dy || ny) * 5; } }
      else if (a.type === 'spiral') { a.tick -= dt; if (a.tick <= 0) { a.tick = 0.09; a.ang += 0.42; for (let k = 0; k < 2; k++) this.spawnEnemyProj(e.x, e.y, a.ang + k * Math.PI, 190, e.dmg * 0.55, def.col.eye); } if (a.t <= 0) e.attack = null; }
      else if (a.type === 'volley') { a.tick -= dt; if (a.tick <= 0) { a.tick = 0.5; a.n--; const base = Math.atan2(p.y - e.y, p.x - e.x); for (let k = -2; k <= 2; k++) this.spawnEnemyProj(e.x, e.y, base + k * 0.18, 260, e.dmg * 0.6, def.col.eye); if (a.n <= 0) e.attack = null; } }
      else if (a.type === 'slam') { if (a.t <= 0) { const inside = U.dist(p.x, p.y, a.x, a.y) < 150 + p.r; if (inside) this.hitPlayer(e.dmg * 1.8, e); this.fx.explosion(a.x, a.y, 150, def.col.eye); this.fx.shake(10); this.sfx('explode'); e.attack = null; } }
      else if (a.type === 'pull') { const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy) || 1; if (d > 80) { p.x += dx / d * 190 * dt; p.y += dy / d * 190 * dt; } if (a.t <= 0) e.attack = null; }
      else if (a.type === 'summon') { if (a.t <= 0) { const type = def.summon || 'skeleton'; for (let k = 0; k < 6 + e.bossTier * 2; k++) { const an = k / 6 * TAU; this.spawnEnemy(type, e.x + Math.cos(an) * (e.r + 30), e.y + Math.sin(an) * (e.r + 30)); } this.fx.ring(e.x, e.y, e.r + 40, def.col.eye); e.attack = null; } }
      else if (a.type === 'ring') { if (a.t <= 0) { const n = 16 + e.bossTier * 4; for (let k = 0; k < n; k++) this.spawnEnemyProj(e.x, e.y, (k / n) * TAU + a.off, 210, e.dmg * 0.6, def.col.eye); e.attack = null; } }
      else if (a.type === 'cross') { a.tick -= dt; if (a.tick <= 0) { a.tick = 0.11; a.ang += 0.14 * (a.n || 1); for (let k = 0; k < 4; k++) this.spawnEnemyProj(e.x, e.y, a.ang + k * Math.PI / 2, 200, e.dmg * 0.5, def.col.eye); } if (a.t <= 0) e.attack = null; }
      else if (a.type === 'sweep') this.sweepStep(e, a, dt);
      else if (a.type === 'rings') { a.tick -= dt; if (a.tick <= 0) { a.tick = RINGS.every; this.ringWave(e, a); a.n--; if (a.n <= 0) e.attack = null; } }
      else if (a.t <= 0) e.attack = null; // barrage / hazard resolve through timers
      return;
    }
    if (e.phase !== 2 && e.hp < e.maxHp * 0.5) { this.enrage(e); return; }
    e.mvx = nx; e.mvy = ny;
    e.atkT -= dt * this.mods.bossRate * (e.phase === 2 ? 1.35 : 1);
    if (e.atkT <= 0) {
      e.atkT = 3.4 - Math.min(1.4, e.bossTier * 0.3);
      const attacks = e.phase === 2 ? def.attacks!.concat(def.phase2 || []) : def.attacks!, type = attacks[e.attackIdx % attacks.length]!; e.attackIdx++;
      if (type === 'charge') { e.attack = { type, phase: 'windup', t: 0.8 }; this.fx.telegraphLine(e, p.x, p.y, 0.8); }
      else if (type === 'dash') e.attack = { type, t: 0.45, n: 3, dx: nx, dy: ny };
      else if (type === 'spiral') e.attack = { type, t: 2.6, tick: 0, ang: rand() * TAU };
      else if (type === 'volley') e.attack = { type, t: 2, tick: 0, n: 3 + e.bossTier };
      else if (type === 'slam') { e.attack = { type, t: 1.1, x: p.x, y: p.y }; this.fx.telegraphCircle(p.x, p.y, 150, 1.1, def.col.eye); }
      else if (type === 'pull') { e.attack = { type, t: 1.6 }; this.fx.ring(e.x, e.y, 400, def.col.eye, { thin: true }); }
      else if (type === 'summon') e.attack = { type, t: 0.7 };
      else if (type === 'ring') e.attack = { type, t: 0.6, off: rand() };
      else if (type === 'cross') e.attack = { type, t: 2.6, tick: 0, ang: rand() * TAU, n: e.attackIdx % 2 ? 1 : -1 };
      else if (type === 'barrage') { e.attack = { type, t: 1.4 }; this.barrage(e); }
      else if (type === 'hazard') { e.attack = { type, t: 0.6 }; this.hazardPools(e); }
      else if (type === 'sweep') {
        const ang = Math.atan2(p.y - e.y, p.x - e.x);
        e.attack = { type, phase: 'windup', t: SWEEP.windup, max: SWEEP.windup, ang, dir: e.attackIdx % 2 ? 1 : -1, len: SWEEP.len, wid: SWEEP.wid, tick: 0 };
        this.fx.telegraphLine(e, e.x + Math.cos(ang) * SWEEP.len, e.y + Math.sin(ang) * SWEEP.len, SWEEP.windup);
      }
      else if (type === 'rings') e.attack = { type, t: RINGS.n * RINGS.every + 1, tick: 0.3, n: RINGS.n, off: Math.floor(rand() * 24), ang: rand() * TAU, dir: rand() < 0.5 ? 1 : -1 };
    }
  }
  /**
   * Boss 'sweep': after a telegraphed windup along the locked angle, a beam rotates through SWEEP.arc.
   * The player takes a hit every SWEEP.tick while inside it. State lives on `e.attack` for the renderer.
   */
  private sweepStep(e: Enemy, a: Required<BossAttack>, dt: number): void {
    if (a.phase === 'windup') { if (a.t <= 0) { a.phase = 'go'; a.t = a.max = SWEEP.dur; a.tick = 0; this.sfx('thunder'); this.fx.shake(6); } return; }
    a.ang += (a.dir * SWEEP.arc / SWEEP.dur) * dt;
    a.tick -= dt;
    // the live beam is drawn by the renderer from `e.attack`
    if (a.tick <= 0) {
      const p = this.player, cx = Math.cos(a.ang), cy = Math.sin(a.ang), ex = p.x - e.x, ey = p.y - e.y;
      const along = ex * cx + ey * cy, perp = Math.abs(ex * cy - ey * cx);
      if (along > 0 && along < a.len + p.r && perp < a.wid / 2 + p.r) { this.hitPlayer(e.dmg * 0.6, e); a.tick = SWEEP.tick; }
    }
    if (a.t <= 0) e.attack = null;
  }
  /** Boss 'rings': one ring of bolts with a lane of missing projectiles; the lane rotates between rings. */
  private ringWave(e: Enemy, a: Required<BossAttack>): void {
    const n = 24 + e.bossTier * 4, col = e.def.col.eye, start = ((a.off % n) + n) % n;
    for (let k = 0; k < n; k++) { if ((k - start + n) % n < RINGS.gap) continue; this.spawnEnemyProj(e.x, e.y, (k / n) * TAU + a.ang, RINGS.speed, e.dmg * 0.55, col); }
    a.off = start + Math.round(n / 5) * a.dir;
    this.fx.ring(e.x, e.y, e.r + 24, col, { thin: true });
    this.sfx('shoot');
  }
  /** Half health: the boss enrages — faster, harder, and its second-phase attacks join the rotation. */
  private enrage(e: Enemy): void {
    e.phase = 2; e.speed *= 1.15; e.attack = null; e.atkT = 0.8;
    this.fx.flash(e.def.col.eye, 0.45); this.fx.shake(14); this.fx.ring(e.x, e.y, e.r * 3, e.def.col.eye); this.fx.timeWarp(0.25, 0.7); this.fx.zoomPunch(0.06);
    this.eachEnemyIn(e.x, e.y, 260, (o) => { if (o !== e && !o.boss && !o.immobile) { const [kx, ky] = U.norm(o.x - e.x, o.y - e.y); o.vx += kx * 500; o.vy += ky * 500; } });
    this.notice(e.def.name + ' is enraged!', e.def.col.eye, 3); this.sfx('boss');
    this.story('bossPhase', e.bossId ?? e.type);
  }
  /** Telegraphed impacts raining around the player, detonating one after another. */
  private barrage(e: Enemy): void {
    const p = this.player, n = 5 + e.bossTier * 2 + (e.phase === 2 ? 2 : 0), col = e.def.col.eye, R = 70;
    for (let i = 0; i < n; i++) {
      const a = rand() * TAU, d = i === 0 ? 0 : 60 + rand() * 180;
      const x = p.x + Math.cos(a) * d + p.move.x * 90 * (i ? 0 : 1), y = p.y + Math.sin(a) * d + p.move.y * 90 * (i ? 0 : 1), t = 1 + i * 0.16;
      this.fx.telegraphCircle(x, y, R, t, col);
      this.after(t, () => { const q = this.player; if (U.dist(q.x, q.y, x, y) < R + q.r) this.hitPlayer(e.dmg * 1.1, e); this.fx.explosion(x, y, R, col); this.fx.shake(4); this.sfx('explode'); });
    }
  }
  /** Lingering pools that hurt (and may slow or burn) the player. */
  private hazardPools(e: Enemy): void {
    const p = this.player, hz = e.def.hazard || { color: e.def.col.eye };
    for (let i = 0; i < 6; i++) {
      const a = rand() * TAU, d = i < 2 ? rand() * 90 : 100 + rand() * 220, near = i < 2;
      const x = (near ? p.x : e.x) + Math.cos(a) * d, y = (near ? p.y : e.y) + Math.sin(a) * d;
      this.spawnHazard({ x, y, r: 64, dmg: e.dmg * 0.35, life: 7, color: hz.color, status: hz.status });
    }
  }
  spawnHazard(o: { x: number; y: number; r: number; dmg: number; life: number; color: string; status?: StatusSpec['type']; arm?: number }): Hazard {
    const h: Hazard = { x: o.x, y: o.y, r: o.r, dmg: o.dmg, life: o.life, max: o.life, arm: o.arm ?? 0.8, color: o.color, status: o.status, tickT: 0, dead: false };
    if (this.hazards.length < 120) this.hazards.push(h);
    return h;
  }

  /* ==================== PROJECTILES ==================== */
  private updateProjectiles(dt: number): void {
    const p = this.player;
    const bx0 = p.x - this.viewW, bx1 = p.x + this.viewW, by0 = p.y - this.viewH, by1 = p.y + this.viewH;
    for (let i = this.projs.length - 1; i >= 0; i--) {
      const pr = this.projs[i];
      if (pr.dead) continue;
      pr.age += dt; pr.life -= dt;
      if (pr.orbit) {
        const o = pr.orbit; o.angle += o.speed * dt; pr.x = p.x + Math.cos(o.angle) * o.radius; pr.y = p.y + Math.sin(o.angle) * o.radius; pr.angle = o.angle + Math.PI / 2;
      } else {
        if (pr.boomerang) {
          const b = pr.boomerang;
          if (pr.age > b.t) {
            const dx = p.x - pr.x, dy = p.y - pr.y, d = Math.hypot(dx, dy) || 1;
            if (b.spiral && pr.age < b.t * 2) { const tang = Math.atan2(dy, dx) + 1.1; pr.vx = Math.cos(tang) * pr.speed; pr.vy = Math.sin(tang) * pr.speed; }
            else { pr.vx = dx / d * pr.speed * 1.3; pr.vy = dy / d * pr.speed * 1.3; }
            if (d < 20 && pr.age > b.t + 0.3) pr.dead = true;
          }
        } else if (pr.homing) {
          const t = pr.target && !pr.target.dead ? pr.target : (pr.target = this.nearestEnemy(pr.x, pr.y, 360));
          if (t) { const want = Math.atan2(t.y - pr.y, t.x - pr.x); let da = want - pr.angle; while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU; pr.angle += U.clamp(da, -pr.homing * dt, pr.homing * dt); pr.vx = Math.cos(pr.angle) * pr.speed; pr.vy = Math.sin(pr.angle) * pr.speed; }
        }
        pr.x += pr.vx * dt; pr.y += pr.vy * dt;
        if (pr.bounce) {
          let b = false;
          if (pr.x < bx0) { pr.x = bx0; pr.vx = Math.abs(pr.vx); b = true; } else if (pr.x > bx1) { pr.x = bx1; pr.vx = -Math.abs(pr.vx); b = true; }
          if (pr.y < by0) { pr.y = by0; pr.vy = Math.abs(pr.vy); b = true; } else if (pr.y > by1) { pr.y = by1; pr.vy = -Math.abs(pr.vy); b = true; }
          if (b) { pr.angle = Math.atan2(pr.vy, pr.vx); if (pr.hits) pr.hits.clear(); if (pr.onBounce) pr.onBounce(this, pr); }
        }
      }
      if (pr.spin) pr.rot += pr.spin * dt;
      if (pr.trail) { pr.trailT -= dt; if (pr.trailT <= 0) { pr.trailT = 0.03; this.fx.trail(pr.x, pr.y, pr.trail, pr.r * 0.5); } }
      // field (void orb / tornado)
      if (pr.field) {
        const f = pr.field; pr.tickT -= dt;
        this.pullEnemies(pr.x, pr.y, f.r, f.pull);
        if (pr.tickT <= 0) { pr.tickT = f.tick; this.eachEnemyIn(pr.x, pr.y, f.r, (e) => this.damageEnemy(e, f.dmg, { weapon: pr.weapon, quiet: true })); }
      }
      const zap = pr.zap; if (zap) { pr.tickT -= dt; if (pr.tickT <= 0) { pr.tickT = zap.cd; const list = this.enemiesInRadius(pr.x, pr.y, zap.r); U.shuffle(list).slice(0, 3).forEach((e) => { this.fx.beam(pr.x, pr.y, e.x, e.y, '#7dd3fc', 2, 0.12); this.damageEnemy(e, zap.dmg, { weapon: pr.weapon, knock: 0.2 }); }); } }
      // collision with enemies
      if (pr.dmg > 0 || pr.statuses) {
        const hits = this.projHits, n = this.grid.candidates(pr.x, pr.y, pr.r + 64, hits);
        for (let h = 0; h < n && !pr.dead; h++) {
          const e = hits[h]!;
          if (e.dead) continue;
          const rr = pr.r + e.r, ddx = e.x - pr.x, ddy = e.y - pr.y;
          if (ddx * ddx + ddy * ddy > rr * rr) continue;
          if (pr.hits && pr.hits.has(e.id)) continue;
          if (pr.hitCd) { const k = pr.uid; if ((e.icd[k] || 0) > this.time) continue; e.icd[k] = this.time + pr.hitCd; }
          if (pr.hits) pr.hits.add(e.id);
          this.damageEnemy(e, pr.dmg, { weapon: pr.weapon, kx: pr.vx || ddx, ky: pr.vy || ddy, knock: pr.knock, crit: pr.crit });
          if (!e.object) { // a cask is only ever struck incidentally: no statuses or on-hit effects (heals, splits…)
            if (pr.statuses) for (const st of pr.statuses) this.applyStatus(e, st.type, st);
            if (pr.onHit && !pr.noOnHit) pr.onHit(this, pr, e);
          }
          pr.hitCount++;
          if (pr.pierce !== -1 && pr.hitCount > pr.pierce) {
            if (pr.ricochet > 0) { pr.ricochet--; const t = this.nearestEnemy(pr.x, pr.y, 300, (o) => o !== e && !pr.hits!.has(o.id)); if (t) { pr.angle = Math.atan2(t.y - pr.y, t.x - pr.x); pr.vx = Math.cos(pr.angle) * pr.speed; pr.vy = Math.sin(pr.angle) * pr.speed; pr.hitCount = 0; continue; } }
            pr.dead = true;
          }
        }
      }
      if (pr.life <= 0 && !pr.dead) { pr.dead = true; if (pr.onExpire) pr.onExpire(this, pr); }
    }
    compact(this.projs);
  }
  private updateEnemyProjectiles(dt: number): void {
    const p = this.player;
    for (let i = this.eprojs.length - 1; i >= 0; i--) {
      const pr = this.eprojs[i];
      pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.life -= dt;
      if (pr.dead || pr.life <= 0) { pr.dead = true; continue; }
      const rr = pr.r + p.r; if (U.dist2(pr.x, pr.y, p.x, p.y) < rr * rr) { this.hitPlayer(pr.dmg, pr); pr.dead = true; }
    }
    compact(this.eprojs);
  }
  private updateZones(dt: number): void {
    const p = this.player;
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i]!; if (z.dead) continue; z.age += dt; z.tickT -= dt;
      if (z.follow === 'nearest') { const t = z.target && !z.target.dead ? z.target : (z.target = this.nearestEnemy(z.x, z.y, 700)); if (t) { const dx = t.x - z.x, dy = t.y - z.y, d = Math.hypot(dx, dy) || 1; const s = Math.min(d, (z.followSpeed ?? 0) * dt); z.x += dx / d * s; z.y += dy / d * s; } }
      if (z.pull) this.pullEnemies(z.x, z.y, z.r * 1.4, z.pull);
      if (z.tickT <= 0) {
        z.tickT = z.tick;
        if (z.dmg > 0) this.eachEnemyIn(z.x, z.y, z.r, (e) => { this.damageEnemy(e, z.dmg, { weapon: z.weapon, quiet: true, knock: 0 }); if (z.burn) this.applyStatus(e, 'burn', { dur: 2, dps: z.dmg * z.burn / z.tick }); if (z.status) this.applyStatus(e, z.status.type, z.status); });
        if ((z.heal || z.healPct) && U.dist(z.x, z.y, p.x, p.y) < z.r + p.r) this.heal((z.heal || 0) + (z.healPct || 0) * p.stats.maxHp, true);
      }
      if (z.age >= z.dur) { if (z.onEnd) z.onEnd(z); z.dead = true; }
    }
    compact(this.zones);
  }
  private updateMines(dt: number): void {
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i]!; if (m.dead) continue;
      m.age += dt; m.armT -= dt;
      if (m.age >= m.life) { m.dead = true; continue; }
      if (m.armT > 0) continue;
      const e = this.nearestEnemy(m.x, m.y, m.r * 0.45);
      if (e) {
        this.explode(m.x, m.y, m.r, m.dmg, m.weapon, { color: m.color });
        if (m.cluster) for (let k = 0; k < m.cluster; k++) { const a = rand() * TAU, d = U.rand(30, 70); this.spawnMine({ x: m.x + Math.cos(a) * d, y: m.y + Math.sin(a) * d, r: m.r * 0.7, dmg: m.dmg * 0.5, life: 4, weapon: m.weapon, color: m.color, cluster: 0, armT: 0.3 }); }
        m.dead = true;
      }
    }
    compact(this.mines);
  }
  private updateAllies(dt: number): void {
    const p = this.player;
    for (let i = this.allies.length - 1; i >= 0; i--) {
      const a = this.allies[i]!; if (a.removed) continue; a.age += dt; a.atkT -= dt; a.fireT -= dt; a.walk += dt * 8;
      if (a.dead || a.age >= a.life) {
        if (a.explode) this.explode(a.x, a.y, a.explode.r, (typeof a.dmg === 'function' ? a.dmg() : a.dmg) * a.explode.mult, a.weapon || { id: 'ally' }, { color: a.color });
        this.fx.burst(a.x, a.y, a.color, 8, { speed: 60, life: 0.4 });
        a.removed = true; continue;
      }
      const dmg = () => (typeof a.dmg === 'function' ? a.dmg() : a.dmg);
      const wref = a.weapon || { id: 'ally_' + a.kind };
      if (a.kind === 'skeleton' || a.kind === 'clone') {
        const t = a.target && !a.target.dead && U.dist2(a.target.x, a.target.y, p.x, p.y) < 520 * 520 ? a.target : (a.target = this.nearestEnemy(a.x, a.y, 420) || this.nearestEnemy(p.x, p.y, 520));
        if (a.kind === 'clone') {
          if (a.fireT <= 0 && t) { a.fireT = 0.5; for (let k = -1; k <= 1; k++) this.spawnProj({ x: a.x, y: a.y, angle: Math.atan2(t.y - a.y, t.x - a.x) + k * 0.2, speed: 600, r: 5, dmg: dmg(), pierce: 1, life: 0.8, weapon: wref, sprite: { kind: 'dagger', color: '#c084fc', len: 18, wid: 3 } }); }
          continue;
        }
        let tx = p.x, ty = p.y, want = 60;
        if (t) { tx = t.x; ty = t.y; want = t.r + a.attackR * 0.6; }
        const dx = tx - a.x, dy = ty - a.y, d = Math.hypot(dx, dy) || 1;
        if (d > want) { a.x += dx / d * a.speed * dt; a.y += dy / d * a.speed * dt; a.flip = dx < 0 ? -1 : 1; }
        else if (t && a.atkT <= 0) { a.atkT = a.attackCd; this.eachEnemyIn(a.x, a.y, a.attackR + 10, (e) => this.damageEnemy(e, dmg(), { weapon: wref, kx: e.x - a.x, ky: e.y - a.y, knock: 0.5, crit: a.crit || 0 })); this.fx.arc(a.x, a.y, Math.atan2(dy, dx), a.attackR + 10, 0.9, a.color, true); }
        if (U.dist2(a.x, a.y, p.x, p.y) > 700 * 700) { a.x = p.x + U.rand(-40, 40); a.y = p.y + U.rand(-40, 40); }
      } else if (a.kind === 'hawk' || a.kind === 'bat') {
        const orbitR = a.kind === 'hawk' ? 70 : 50;
        if (a.dive) {
          const t = a.dive; a.diveT -= dt;
          if (t.dead || a.diveT <= 0) { a.dive = null; } else { const dx = t.x - a.x, dy = t.y - a.y, d = Math.hypot(dx, dy) || 1; a.x += dx / d * 520 * dt; a.y += dy / d * 520 * dt; a.flip = dx < 0 ? -1 : 1; if (d < t.r + 10) { this.damageEnemy(t, dmg(), { weapon: wref, knock: 0.4 }); if (a.bleed) this.applyStatus(t, 'bleed', { dur: 2, dps: dmg() * 0.3 }); if (a.heal) this.heal(a.heal, true, true); a.dive = null; a.atkT = a.kind === 'hawk' ? 1.1 : 1.4; } }
        } else {
          a.angle += dt * 2.2; const tx = p.x + Math.cos(a.angle + (a.orbitOff || 0)) * orbitR, ty = p.y + Math.sin(a.angle + (a.orbitOff || 0)) * orbitR * 0.6 - 20;
          a.x += (tx - a.x) * Math.min(1, dt * 8); a.y += (ty - a.y) * Math.min(1, dt * 8); a.flip = Math.cos(a.angle) < 0 ? -1 : 1;
          if (a.atkT <= 0) { const t = this.nearestEnemy(p.x, p.y, 260); if (t) { a.dive = t; a.diveT = 1.2; } }
        }
      } else if (a.kind === 'turret') {
        if (a.fireT <= 0) {
          const rate = p.overdriveT > 0 ? 0.5 : 1;
          a.fireT = a.fireCd * rate;
          const t = this.nearestEnemy(a.x, a.y, a.range);
          if (t) { const ang = Math.atan2(t.y - a.y, t.x - a.x); a.aim = ang; if (a.rocket) this.spawnProj({ x: a.x, y: a.y, angle: ang, speed: a.projSpeed * 0.8, r: 7, dmg: dmg() * 1.5, pierce: 0, life: 1.6, weapon: wref, sprite: { kind: 'bolt', color: '#f43f5e', len: 18, wid: 5 }, trail: '#f43f5e', onHit: (g2, pr, e) => g2.explode(pr.x, pr.y, a.rocket.r, dmg() * 1.2, wref, { color: '#f43f5e', small: true, exclude: e }) }); else this.spawnProj({ x: a.x, y: a.y, angle: ang, speed: a.projSpeed, r: 5, dmg: dmg(), pierce: 1, life: 1.2, weapon: wref, sprite: { kind: 'bolt', color: '#fb923c', len: 16, wid: 4 } }); this.sfx('shoot'); }
        }
      } else if (a.kind === 'drone') {
        a.angle += dt * 1.6; const tx = p.x + Math.cos(a.angle + a.orbitOff) * 60, ty = p.y + Math.sin(a.angle + a.orbitOff) * 40 - 30;
        a.x += (tx - a.x) * Math.min(1, dt * 6); a.y += (ty - a.y) * Math.min(1, dt * 6);
        if (a.fireT <= 0) { a.fireT = a.fireCd; const t = this.nearestEnemy(a.x, a.y, a.range); if (t) this.spawnProj({ x: a.x, y: a.y, angle: Math.atan2(t.y - a.y, t.x - a.x), speed: 520, r: 4, dmg: dmg(), pierce: 0, life: 0.9, weapon: wref, sprite: { kind: 'bolt', color: '#fb923c', len: 12, wid: 3 } }); }
      } else if (a.kind === 'wraith') {
        if (!a.target || a.target.dead || a.retarget <= 0) { a.target = this.randomEnemyNear(p.x, p.y, 480); a.retarget = 1.2; }
        a.retarget = (a.retarget || 1.2) - dt;
        if (a.target) { const dx = a.target.x - a.x, dy = a.target.y - a.y, d = Math.hypot(dx, dy) || 1; a.x += dx / d * a.speed * dt; a.y += dy / d * a.speed * dt; a.flip = dx < 0 ? -1 : 1; }
        if (a.atkT <= 0) { a.atkT = 0.3; this.eachEnemyIn(a.x, a.y, 26, (e) => this.damageEnemy(e, dmg() * 0.4, { weapon: wref, knock: 0.3, quiet: true })); }
        this.fx.trail(a.x, a.y, a.color, 6);
      }
    }
    let w = 0;
    for (const a of this.allies) if (!a.removed) this.allies[w++] = a;
    this.allies.length = w;
  }

  /* ==================== PICKUPS ==================== */
  spawnPickup(o: PickupSpec): Pickup {
    if (o.kind === 'gem' && this.pickups.length > 700) { // merge into farthest big gem
      let far = null as Pickup | null, fd = 0; for (const k of this.pickups) if (k.kind === 'gem' && !k.dead) { const d = U.dist2(k.x, k.y, o.x, o.y); if (d > fd) { fd = d; far = k; } }
      if (far) { far.value = (far.value ?? 0) + (o.value ?? 0); far.gem = far.value >= 100 ? 'purple' : far.value >= 25 ? 'red' : far.value >= 6 ? 'green' : 'blue'; return far; }
    }
    const k: Pickup = Object.assign({ px: o.x, py: o.y, age: 0, vx: 0, vy: 0, pull: false, dead: false, bob: rand() * TAU }, o);
    this.pickups.push(k); return k;
  }
  private updatePickups(dt: number): void {
    const p = this.player, mr = p.stats.magnet, damp = Math.exp(-POP_DECAY * dt);
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const k = this.pickups[i]!; if (k.dead) continue; k.age += dt;
      // loot pop: a short decaying burst outward (the magnet takes over as soon as it grabs the pickup)
      if (k.vx || k.vy) {
        if (k.pull) { k.vx = 0; k.vy = 0; }
        else { k.x += k.vx * dt; k.y += k.vy * dt; k.vx *= damp; k.vy *= damp; if (Math.abs(k.vx) + Math.abs(k.vy) < 3) { k.vx = 0; k.vy = 0; } }
      }
      const dx = p.x - k.x, dy = p.y - k.y, d2 = dx * dx + dy * dy;
      const pr = k.kind === 'gem' || k.kind === 'gold' || k.kind === 'mat' || k.kind === 'ember' ? mr : 40;
      if (k.kind === 'brazier') {
        // breakable: player's projectiles / touching damages it
        k.hp ??= 3;
        if (d2 < (p.r + 22) * (p.r + 22)) { k.hp -= dt * 6; }
        for (const pj of this.projs) { if (!pj.dead && U.dist2(pj.x, pj.y, k.x, k.y) < (pj.r + 22) * (pj.r + 22)) { k.hp -= 1; pj.hitBrazier = true; break; } }
        if (k.hp <= 0) { k.dead = true; this.fx.burst(k.x, k.y, '#ff9a3c', 20, { speed: 120, life: 0.6 }); this.sfx('explode'); const r = rand(); if (r < 0.35) this.spawnPickup({ kind: 'food', x: k.x, y: k.y }); else if (r < 0.5) this.spawnPickup({ kind: 'magnet', x: k.x, y: k.y }); else if (r < 0.62) this.spawnPickup({ kind: 'bomb', x: k.x, y: k.y }); else if (r < 0.72) this.spawnPickup({ kind: 'clock', x: k.x, y: k.y }); else for (let g = 0; g < 8; g++) this.spawnPickup(this.pop({ kind: 'gold', x: k.x + U.rand(-20, 20), y: k.y + U.rand(-20, 20), value: Math.round(U.randi(3, 8) * this.diff.gold) })); }
        continue;
      }
      const reach = p.r + PULL.reach;
      if (k.pull || d2 < pr * pr) {
        if (!k.pull) { k.pull = true; k.pullT = 0; }
        // accelerate from the moment the magnet grabs it (not from the drop: old loot would fly at
        // thousands of px/s), and never step past the player, or it overshoots and orbits forever
        k.pullT = (k.pullT ?? 0) + dt;
        const d = Math.sqrt(d2) || 1, spd = Math.min(PULL.max, PULL.speed + k.pullT * PULL.accel + Math.max(0, mr - d) * 2);
        const step = Math.min(d, spd * dt);
        k.x += dx / d * step; k.y += dy / d * step;
        if (d - step < reach) { k.dead = true; this.collect(k); }
      } else if (d2 < reach * reach) { k.dead = true; this.collect(k); }
    }
    compact(this.pickups);
  }
  private collect(k: Pickup): void {
    const p = this.player, value = k.value ?? 0;
    if (k.kind === 'gem') { this.gainXp(value); this.sfx('gem', Math.min(24, Math.floor((this.gemCombo = (this.gemCombo || 0) + 1) / 4))); this.gemComboT = 0.5; }
    else if (k.kind === 'gold') { const v = Math.round(value * p.stats.greed); this.gold += v; this.sfx('gold'); this.fx.text(p.x, p.y - 26, '+' + v + ' gold', '#f5c542'); if (p.f.u_goldheal) this.heal(1, true, true); }
    else if (k.kind === 'food') { this.heal(p.stats.maxHp * (p.f.moreFood ? 0.42 : 0.28)); }
    else if (k.kind === 'magnet') { for (const o of this.pickups) if (o.kind === 'gem' || o.kind === 'gold' || o.kind === 'mat' || o.kind === 'ember') o.pull = true; this.fx.ring(p.x, p.y, 600, '#4fd1ff'); this.sfx('pickup'); }
    else if (k.kind === 'bomb') { const list = this.enemiesInRadius(p.x, p.y, 900); list.forEach((e) => this.damageEnemy(e, e.boss ? e.maxHp * 0.1 : e.hp + 1, { quiet: true, weapon: null, noBlast: true })); this.fx.flash('#fff', 0.8); this.fx.shake(14); this.sfx('explode'); }
    else if (k.kind === 'clock') { for (const e of this.enemies) this.applyStatus(e, e.boss ? 'chill' : 'freeze', { dur: 5, power: 0.7, noMul: true }); this.fx.flash('#b28dff', 0.5); this.sfx('freeze'); }
    else if (k.kind === 'chest') { this.chestQueue.push({ boss: false }); }
    else if (k.kind === 'bosschest') { this.chestQueue.push({ boss: true }); }
    else if (k.kind === 'mat' && k.mat) { const m = MAT_BY_ID[k.mat]!; this.mats[k.mat]++; this.fx.text(p.x, p.y - 26, '+1 ' + m.name, m.color); this.sfx('pickup'); }
    else if (k.kind === 'ember') { this.embers += value; this.fx.text(p.x, p.y - 26, '+' + value + ' Soul Ember', '#ff8a3c'); this.sfx('pickup'); }
  }
  gainXp(v: number): void {
    const p = this.player; p.xp += v * p.stats.growth;
    while (p.xp >= p.xpNext) { p.xp -= p.xpNext; this.gainLevel(); }
  }
  gainLevel(silent?: boolean): void { const p = this.player; p.level++; p.xpNext = xpForLevel(p.level); this.levelQueue++; if (!silent) { this.fx.ring(p.x, p.y, 60, '#fde68a'); } }

  /* ==================== HAZARDS & SHRINES ==================== */
  private updateHazards(dt: number): void {
    const p = this.player;
    for (const h of this.hazards) {
      if (h.dead) continue;
      h.life -= dt; h.tickT -= dt;
      if (h.life <= 0) { h.dead = true; continue; }
      if (h.max - h.life < h.arm || h.tickT > 0) continue;
      const rr = h.r + p.r * 0.5;
      if (U.dist2(h.x, h.y, p.x, p.y) < rr * rr) { h.tickT = 0.5; this.hitPlayer(h.dmg, { def: { name: 'scorched ground' }, color: h.color }); if (h.status === 'chill') p.slowT = Math.max(p.slowT, 1); }
    }
    compact(this.hazards);
  }
  private updateShrines(dt: number): void {
    const p = this.player;
    for (const s of this.shrines) {
      s.age += dt;
      if (s.used) { if (this.time - s.usedAt > 3) s.dead = true; continue; }
      const d2 = U.dist2(s.x, s.y, p.x, p.y);
      if (d2 > 2600 * 2600) { s.dead = true; continue; }
      const inside = d2 < (s.r + p.r) * (s.r + p.r);
      s.charge = inside ? s.charge + dt / SHRINE_CHANNEL : Math.max(0, s.charge - dt * 0.8);
      if (s.charge >= 1) { s.charge = 1; s.used = true; s.usedAt = this.time; this.activateShrine(s); }
    }
    compact(this.shrines);
    if (this.trial) {
      const t = this.trial; t.t -= dt;
      if (t.t <= 0) {
        this.trial = null;
        this.spawnPickup({ kind: 'chest', x: p.x + 40, y: p.y });
        for (let i = 0; i < 3; i++) this.spawnPickup(this.pop({ kind: 'ember', x: p.x + U.rand(-50, 50), y: p.y + U.rand(-50, 50), value: 1 }));
        for (let i = 0; i < 2; i++) this.spawnPickup(this.pop({ kind: 'mat', mat: 'dust', x: p.x + U.rand(-50, 50), y: p.y + U.rand(-50, 50) }));
        this.notice('The Soul Well is sated. Claim your reward.', '#c084fc', 3); this.sfx('chest'); this.fx.ring(p.x, p.y, 300, '#c084fc');
      }
    }
  }
  private activateShrine(s: Shrine): void {
    const p = this.player, def = SHRINE_DEFS[s.kind];
    this.shrinesUsed++;
    this.fx.ring(s.x, s.y, 160, def.color); this.fx.burst(s.x, s.y, def.color, 30, { speed: 200, life: 0.8, up: true }); this.fx.flash(def.color, 0.25); this.sfx('shrine');
    let msg = def.name;
    if (s.kind === 'blood') {
      p.hp = Math.max(1, p.hp * 0.75); p.hurtFlash = 0.2;
      const ws = p.weapons.filter((w) => w.level < w.def.max), ps = p.passives.filter((x) => x.level < x.def.max);
      if (ws.length) { const w = U.pick(ws); w.level++; msg = def.name + ': ' + w.def.name + ' → Lv ' + w.level; }
      else if (ps.length) { const x = U.pick(ps); x.level++; msg = def.name + ': ' + x.def.name + ' → Lv ' + x.level; }
      else { this.chestQueue.push({ boss: false }); }
      this.recalc();
    } else if (s.kind === 'fortune') {
      this.spawnPickup({ kind: 'chest', x: s.x, y: s.y });
      for (let i = 0; i < 12; i++) this.spawnPickup(this.pop({ kind: 'gold', x: s.x + U.rand(-70, 70), y: s.y + U.rand(-70, 70), value: Math.round(U.randi(4, 10) * this.diff.gold) }));
    } else if (s.kind === 'trial') {
      this.trial = { t: TRIAL_TIME, x: s.x, y: s.y };
      const keys = Object.keys(this.spawnTable.types).filter((k) => !ENEMIES[k]!.noSpawn);
      this.runEvent({ type: 'ring', enemy: U.pick(keys), n: 24 + Math.floor(this.diff.minute) });
      msg = def.name + ' — survive ' + TRIAL_TIME + 's';
    } else if (s.kind === 'haste') {
      this.addBuff('haste', 30, { speed: 0.25, cooldown: 0.2 });
    } else if (s.kind === 'life') {
      this.heal(p.stats.maxHp * 0.5); this.addShield(p.stats.maxHp * 0.3);
    } else if (s.kind === 'curse') {
      this.curseBonus += 0.2; this.gainLevel(); this.recalc();
    }
    this.notice(msg, def.color, 3);
    this.story('shrine', s.kind);
  }
  addBuff(id: string, t: number, stats: StatBag): void {
    const b = this.buffs.find((x) => x.id === id);
    if (b) { b.t = b.max = t; b.stats = stats; } else this.buffs.push({ id, t, max: t, stats });
    this.recalc();
  }

  /* ==================== KILL STREAK ==================== */
  private addCombo(): void {
    const f = this.player.f;
    this.combo++; this.comboT = COMBO_WINDOW + (f.b_frenzy ? 1.5 : 0);
    if (this.combo > this.bestCombo) this.bestCombo = this.combo;
    const t = comboTier(this.combo);
    if (t !== this.comboTier) {
      const up = t > this.comboTier; this.comboTier = t; this.recalc();
      if (up) { this.sfx('combo', t); const ct = COMBO_TIERS[t - 1]!; if (t >= 3 && !this.storyOnce.has('combo' + t)) { this.storyOnce.add('combo' + t); this.story('combo', ct.name); } }
    }
  }

  /* ==================== META EFFECTS (uniques, sigils) ==================== */
  private updateMetaEffects(dt: number): void {
    const p = this.player, f = p.f;
    this.gemComboT = (this.gemComboT || 0) - dt; if (this.gemComboT <= 0) this.gemCombo = 0;
    if (this.combo > 0) { this.comboT -= dt; if (this.comboT <= 0) { this.combo = 0; if (this.comboTier) { this.comboTier = 0; this.recalc(); } } }
    if (this.buffs.length) { let changed = false; for (const b of this.buffs) { b.t -= dt; if (b.t <= 0) changed = true; } if (changed) { this.buffs = this.buffs.filter((b) => b.t > 0); this.recalc(); } }
    if (f.b_eye) { this.eyeT -= dt; if (this.eyeT <= 0) { this.eyeT = 6; let best: Enemy | null = null; this.eachEnemyIn(p.x, p.y, 620, (e) => { if (!e.object && (!best || e.hp > best.hp)) best = e; }); const t = best as Enemy | null; if (t) { const a = Math.atan2(t.y - p.y, t.x - p.x), len = U.dist(p.x, p.y, t.x, t.y) + 60; this.lineDamage(p.x, p.y, a, len, 30, (60 + p.level * 9) * p.stats.might + t.maxHp * (t.boss ? 0.02 : 0.08), { id: 'boon' }, { color: '#c084fc', knock: 0.5 }); this.fx.beam(p.x, p.y - 20, t.x, t.y, '#e879f9', 6, 0.3); this.sfx('zap'); } } }
    if (f.b_storm) { this.stormT -= dt; if (this.stormT <= 0) { this.stormT = 3; WH.targets(this, p, 3, 380).forEach((e) => this.lightning(e.x, e.y, 40, (24 + p.level * 2.5) * p.stats.might, { id: 'boon' }, { status: { type: 'shock', dur: 3 } })); } }
    if (f.u_storm) { this.uStormT = (this.uStormT || 4) - dt; if (this.uStormT <= 0) { this.uStormT = 4; WH.targets(this, p, 3, 300).forEach((e) => { this.fx.beam(p.x, p.y - 20, e.x, e.y, '#fde047', 2, 0.15); this.damageEnemy(e, (20 + p.level * 2) * p.stats.might, { weapon: { id: 'unique' }, knock: 0.3 }); }); } }
    if (f.u_aegis) { this.uAegisT = (this.uAegisT || 20) - dt; if (this.uAegisT <= 0) { this.uAegisT = 20; this.addShield(p.stats.maxHp * 0.12); } }
    if (f.u_starfall) { this.uStarT = (this.uStarT || 8) - dt; if (this.uStarT <= 0) { this.uStarT = 8; const e = this.randomEnemyNear(p.x, p.y, 420); if (e) { const x = e.x, y = e.y; this.meteor(x, y, 0.7, () => this.explode(x, y, 80, (60 + p.level * 6) * p.stats.might, { id: 'unique' }, { color: '#fde68a' })); } } }
    if (f.magnetPulse) { this.pulseT = (this.pulseT || 60) - dt; if (this.pulseT <= 0) { this.pulseT = 60; for (const o of this.pickups) if (o.kind === 'gem') o.pull = true; this.fx.ring(p.x, p.y, 500, '#4fd1ff', { thin: true }); } }
    if (f.timedLevels) { this.tlT = (this.tlT || 300) - dt; if (this.tlT <= 0) { this.tlT = 300; this.gainLevel(); this.notice('Sigil of the Timeless: free level!', '#fbbf24'); } }
  }

  /* ==================== LEVEL UP / CHESTS ==================== */
  genOptions(): LevelOption[] {
    const p = this.player, pool: UpgradeOption[] = [];
    const wOwned = p.weapons.map((w) => w.id), pOwned = p.passives.map((x) => x.id);
    for (const w of p.weapons) if (w.level < w.def.max && !this.banished.has(w.id)) pool.push({ type: 'weapon', id: w.id, def: w.def, level: w.level + 1, weight: w.id === p.char.signature ? 4 : 3 });
    if (p.weapons.length < p.slots.w) for (const id in WEAPONS) { const d = WEAPONS[id]; if (d.char && d.char !== p.char.id) continue; if (wOwned.includes(id) || this.banished.has(id)) continue; pool.push({ type: 'weapon', id, def: d, level: 1, isNew: true, weight: 1 }); }
    for (const ps of p.passives) if (ps.level < ps.def.max && !this.banished.has(ps.id)) pool.push({ type: 'passive', id: ps.id, def: ps.def, level: ps.level + 1, weight: 2.5 });
    if (p.passives.length < p.slots.p) for (const d of PASSIVES) { if (pOwned.includes(d.id) || this.banished.has(d.id)) continue; let w = 1; for (const wp of p.weapons) if (wp.def.evo && wp.def.evo.with === d.id && !wp.evolved) w = 2; pool.push({ type: 'passive', id: d.id, def: d, level: 1, isNew: true, weight: w }); }
    let n = 3;
    if (p.f.extraChoice || rand() < Math.min(0.6, (p.stats.luck - 1) * 0.5)) n = 4;
    const out: LevelOption[] = [];
    while (out.length < n && pool.length) { const pick = U.weightedPick(pool, (o) => o.weight); pool.splice(pool.indexOf(pick), 1); out.push(pick); }
    if (!out.length) { out.push({ type: 'gold', value: Math.round((80 + this.diff.minute * 25) * p.stats.greed) }); out.push({ type: 'heal', value: 0.3 }); }
    // empowered chance from luck
    for (const o of out) if (o.type !== 'gold' && o.type !== 'heal' && !o.isNew && rand() < 0.04 * p.stats.luck) { const cur = o.type === 'weapon' ? p.weapons.find((w) => w.id === o.id) : p.passives.find((x) => x.id === o.id); if (cur && cur.level + 2 <= cur.def.max) { o.empowered = true; o.level = cur.level + 2; } }
    return out;
  }
  pickOption(o: LevelOption): void {
    const p = this.player;
    if (o.type === 'weapon') { const w = p.weapons.find((x) => x.id === o.id); if (w) w.level = o.level; else this.addWeapon(o.id); }
    else if (o.type === 'passive') { const ps = p.passives.find((x) => x.id === o.id); if (ps) ps.level = o.level; else this.addPassive(o.id); }
    else if (o.type === 'gold') { this.gold += o.value; }
    else if (o.type === 'heal') { this.heal(p.stats.maxHp * o.value, true); }
    this.recalc();
    this.levelQueue--; this.sfx('levelup');
    if (this.levelQueue <= 0) { this.levelQueue = 0; this.state = 'play'; }
    else { this.state = 'levelup'; this.events.emit('levelUp', this.genOptions()); }
  }
  reroll(): LevelOption[] | null { const p = this.player; if (p.rerolls <= 0) return null; p.rerolls--; return this.genOptions(); }
  skip(): boolean { const p = this.player; if (p.skips <= 0) return false; p.skips--; this.levelQueue--; if (this.levelQueue <= 0) { this.levelQueue = 0; this.state = 'play'; } else { this.state = 'levelup'; this.events.emit('levelUp', this.genOptions()); } return true; }
  banish(o: LevelOption): LevelOption[] | null { const p = this.player; if (p.banishes <= 0) return null; p.banishes--; if (o.id) this.banished.add(o.id); return this.genOptions(); }
  evolvable(): Weapon[] { const p = this.player; return p.weapons.filter((w) => w.def.evo && !w.evolved && w.level >= w.def.max && p.passives.some((ps) => ps.id === w.def.evo!.with)); }
  private openChest(c: ChestRequest): void {
    const p = this.player, rewards: ChestReward[] = [];
    const ev = this.evolvable();
    if (ev.length) {
      const w = ev[0]!, evo = w.def.evo!; w.evolved = true; this.evolves++;
      rewards.push({ type: 'evolve', def: w.def, name: evo.name, icon: evo.icon, desc: evo.desc });
      this.fx.flash('#fff', 0.9); this.sfx('evolve');
      this.story('evolve', w.id);
    } else {
      let n = 1;
      const r = rand(), luck = p.stats.chestLuck + (p.stats.luck - 1) * 0.5;
      if (c.boss) n = 5; else if (r < 0.06 + luck * 0.15) n = 5; else if (r < 0.28 + luck * 0.4) n = 3;
      for (let i = 0; i < n; i++) {
        const ups: ({ type: 'weapon'; obj: Weapon; def: WeaponDef } | { type: 'passive'; obj: PassiveInstance; def: PassiveDef })[] = [];
        for (const w of p.weapons) if (w.level < w.def.max) ups.push({ type: 'weapon', obj: w, def: w.def });
        for (const ps of p.passives) if (ps.level < ps.def.max) ups.push({ type: 'passive', obj: ps, def: ps.def });
        if (!ups.length) { const g = Math.round((30 + this.diff.minute * 8) * p.stats.greed); this.gold += g; rewards.push({ type: 'gold', value: g }); continue; }
        const u = U.pick(ups); u.obj.level++; rewards.push(u.type === 'weapon' ? { type: 'weapon', def: u.def, level: u.obj.level } : { type: 'passive', def: u.def, level: u.obj.level });
      }
      this.sfx('chest');
    }
    const gold = Math.round((40 + this.diff.minute * 15) * (c.boss ? 4 : 1) * p.stats.greed); this.gold += gold; rewards.push({ type: 'gold', value: gold });
    const matN = (c.boss ? 3 : 1) + Math.floor(p.stats.matFind * 2);
    for (let i = 0; i < matN; i++) { const m: MaterialId = c.boss ? U.pick(['dust', 'crystal', 'dust'] as const) : (rand() < 0.25 ? 'dust' : 'iron'); this.mats[m]++; rewards.push({ type: 'mat', mat: m }); }
    this.recalc();
    if (c.boss) this.boonQueue++;
    this.events.emit('chest', rewards, c.boss);
  }

  /* ==================== BOONS ==================== */
  /** Three boons the player doesn't own yet (deterministic). */
  boonOptions(): BoonDef[] {
    const own = this.player.boons as string[];
    const pool = BOONS.filter((b) => !own.includes(b.id)), out: BoonDef[] = [];
    while (out.length < 3 && pool.length) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]!);
    return out;
  }
  pickBoon(b: BoonDef | null): void {
    const p = this.player;
    if (b) {
      (p.boons as string[]).push(b.id);
      if (b.flag) p.f[b.flag] = true;
      if (b.onPick) b.onPick(this, p);
      this.recalc();
      this.fx.flash('#e9d5ff', 0.4); this.sfx('evolve');
      this.events.emit('discover', 'boon', b.id);
      this.story('boon', b.id);
    }
    if (this.state === 'boon') this.state = 'play';
  }
  closeChest(): void { if (this.state === 'chest') this.state = 'play'; }

  /* ==================== END OF RUN ==================== */
  summary(): RunSummary {
    const p = this.player, stage = this.stage, heatB = heatBonus(this.heat);
    const timeBonus = Math.round(this.time * 1.2 + this.kills * 0.08);
    const gold = Math.round((this.gold + timeBonus) * stage.reward * heatB);
    const embers = Math.round(this.embers * (p.f.emberBonus ? 1.5 : 1) * (1 + this.heat * 0.05));
    const charXp = Math.round((this.time * 2 + this.kills * 0.5 + p.level * 12 + this.bossKills * 150 + this.elites * 20) * (1 + p.stats.xpBonus) * Math.sqrt(stage.reward) * heatB);
    const mats = { iron: Math.round(this.mats.iron * heatB), dust: Math.round(this.mats.dust * heatB), crystal: this.mats.crystal, star: this.mats.star };
    return {
      charId: p.char.id, stageId: stage.id, seed: this.seed, time: this.time, kills: this.kills, level: p.level, bossKills: this.bossKills, elites: this.elites, evolves: this.evolves, heat: this.heat,
      gold, embers, charXp, mats, enemyKills: this.enemyKills, bossKillsBy: this.bossKillsBy, dmgByWeapon: this.dmgByWeapon, killsBySource: this.killsBySource,
      weapons: p.weapons.map((w) => ({ id: w.id, level: w.level, evolved: w.evolved, dmg: w.dmgDealt })), passives: p.passives.map((x) => ({ id: x.id, level: x.level })), eclipse: this.eclipse,
      killedBy: this.lastHitBy, bestCombo: this.bestCombo, reactions: this.reactions, boons: (p.boons as string[]).slice(), shrines: this.shrinesUsed,
    };
  }
  quit(): void { this.state = 'over'; }
  notice(text: string, color?: string, dur?: number): void { this.events.emit('notice', text, color, dur); }
  sfx(n: string, p?: number): void { this.events.emit('sfx', n, p); }
  story(beat: StoryBeatId, ref?: string): void { this.events.emit('story', beat, ref); }
}

