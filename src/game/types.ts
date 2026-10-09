/**
 * Shared gameplay types — the contract between the simulation (`Game`), content (`data/*`),
 * meta progression (`meta/*`) and presentation (`render/*`, `ui/*`).
 *
 * Design note on "bags": characters, weapons and uniques each invent their own mechanics
 * (Kael's `cdAshen`, Vesper's `blood`, Lyra's `stormT`, …). Rather than force every new mechanic
 * through a central type, those per-content runtime fields live on explicitly-marked open records
 * (`Player`, `Weapon`, `Ally`, `EnemyStatus` and `Flags` carry index signatures). Everything the
 * engine itself reads or writes is typed precisely.
 */
import type { Game } from './game';

/* ------------------------------------------------------------------ */
/* Stats                                                              */
/* ------------------------------------------------------------------ */

export interface PlayerStats {
  maxHp: number;
  regen: number;
  armor: number;
  speed: number;
  might: number;
  area: number;
  projSpeed: number;
  duration: number;
  amount: number;
  cooldown: number;
  luck: number;
  growth: number;
  greed: number;
  magnet: number;
  revival: number;
  crit: number;
  critDmg: number;
  dodge: number;
  lifesteal: number;
  curse: number;
  rerolls: number;
  skips: number;
  banishes: number;
  activeCd: number;
  thorns: number;
  healing: number;
  eliteDmg: number;
  burnDmg: number;
  shieldPower: number;
  minionDmg: number;
  xpBonus: number;
  matFind: number;
  startLevel: number;
  pierce: number;
  knockback: number;
  chestLuck: number;
  slowPower: number;
  execute: number;
  sigDmg: number;
  /** Elemental reaction damage bonus (see data/synergy.ts). */
  reactDmg: number;
}
export type StatKey = keyof PlayerStats;
/** Additive stat deltas, e.g. `{ might: 0.08 }`. May include derived keys like `maxHpPct`. */
export type StatBag = Record<string, number>;
/** Boolean mechanic switches granted by talents, chapters, uniques and sigils. */
export type Flags = Record<string, boolean | undefined>;

export interface IconSpec {
  g: string;
  c: string;
}

/* ------------------------------------------------------------------ */
/* Weapons & passives                                                 */
/* ------------------------------------------------------------------ */

export interface WeaponStats {
  dmg: number;
  cd: number;
  amount: number;
  speed: number;
  pierce: number;
  area: number;
  duration: number;
  knock: number;
  crit: number;
  tick: number;
  burn: number;
  slow: number;
  minions: number;
  turrets: number;
  rate: number;
  chains: number;
  pull: number;
  heal: number;
  range: number;
  /** Weapon-specific extras (bounces, beams, …) from base/levels/evolution. */
  [extra: string]: number;
}

export type WeaponLevelDelta = Record<string, number | string | undefined> & { flag?: string };

export interface WeaponEvolution {
  with: string;
  name: string;
  icon: IconSpec;
  desc: string;
  /** Numeric deltas/multipliers (`fooMul`), or boolean switches copied as-is. */
  stats?: Record<string, number | boolean>;
}

export interface WeaponDef {
  id: string;
  name: string;
  icon: IconSpec;
  desc: string;
  tags?: string[];
  /** Signature weapon: only this character can roll it. */
  char?: string;
  base: Partial<WeaponStats>;
  levels: WeaponLevelDelta[];
  evo?: WeaponEvolution;
  /** Max level; filled in by `registerWeapon` (defaults to 8). */
  max: number;
  /** Continuous weapons get `update` every step instead of cooldown-driven `fire`. */
  continuous?: boolean;
  noMark?: boolean;
  fire?(g: Game, w: Weapon, s: WeaponStats): void;
  update?(g: Game, w: Weapon, s: WeaponStats, dt: number): void;
  /** Adjust computed stats (talent/keystone interactions). */
  mod?(g: Game, w: Weapon, s: WeaponStats, p: Player): void;
}
export type WeaponDefInput = Omit<WeaponDef, 'max'> & { max?: number };

/** A weapon instance owned by the player. Weapons may keep their own runtime state. */
export interface Weapon {
  id: string;
  def: WeaponDef;
  level: number;
  evolved: boolean;
  timer: number;
  s: WeaponStats | null;
  dmgDealt: number;
  [state: string]: any;
}

/** Anything that can be credited with damage: a weapon instance, an ability, an ally… */
export interface DamageSource {
  id?: string;
  def?: WeaponDef | null;
  dmgDealt?: number;
  noMark?: boolean;
  ability?: boolean;
  /** Damage reflected by thorns (doesn't trigger lifesteal/on-death explosions). */
  thorns?: boolean;
  noBlood?: boolean;
}

export interface PassiveDef {
  id: string;
  name: string;
  icon: IconSpec;
  max: number;
  per: StatBag;
  desc: string;
}
export interface PassiveInstance {
  id: string;
  def: PassiveDef;
  level: number;
}

/* ------------------------------------------------------------------ */
/* Characters                                                         */
/* ------------------------------------------------------------------ */

export interface CharacterHooks {
  init?(g: Game, p: Player): void;
  update?(g: Game, p: Player, dt: number): void;
  /** Mutate `info.mult` / `info.critBonus` before damage is applied. */
  onDamage?(g: Game, p: Player, e: Enemy, info: DamageInfo): void;
  onHit?(g: Game, p: Player, e: Enemy, info: DamageInfo): void;
  onKill?(g: Game, p: Player, e: Enemy): void;
  /** Return the (possibly reduced) damage the player takes. */
  onHurt?(g: Game, p: Player, dmg: number, src: unknown): number;
  onDodge?(g: Game, p: Player, src: unknown): void;
  /** Return true to cancel death. */
  onFatal?(g: Game, p: Player): boolean | void;
  onCast?(g: Game, p: Player, w: Weapon): void;
  onAllySpawn?(g: Game, p: Player, a: Ally): void;
}

export interface TalentNode {
  id: string;
  name: string;
  max: number;
  per?: StatBag;
  flag?: string;
  desc: string;
  keystone?: boolean;
  tier: number;
  branch: string;
}
export interface TalentBranch {
  id: string;
  name: string;
  color: string;
  nodes: TalentNode[];
}

export type ChapterReqType = 'runs' | 'time' | 'kills' | 'bosses';
export interface Chapter {
  title: string;
  lore: string;
  req: { type: ChapterReqType; v: number };
  reward: { stats?: StatBag; flag?: string; desc?: string };
}

export type UnlockType = 'start' | 'time' | 'kills' | 'boss' | 'level' | 'evolve' | 'charlevel';

export interface CharacterDef {
  id: string;
  name: string;
  title: string;
  unlock: { type: UnlockType; v?: number; text?: string };
  colors: { primary: string; secondary: string; accent: string; skin: string; eye: string; [k: string]: string };
  head: string;
  weaponArt: string;
  lore: string;
  stats: Partial<PlayerStats>;
  signature: string;
  trait: { name: string; desc: string };
  active: { name: string; icon: IconSpec; cd: number; desc: string; use(g: Game, p: Player): void };
  resource?: { name: string; color: string; max: number };
  /** Portrait/sprite variant. */
  longHair?: boolean;
  hooks?: CharacterHooks;
  talents: TalentBranch[];
  codex: Chapter[];
}

/* ------------------------------------------------------------------ */
/* Player                                                             */
/* ------------------------------------------------------------------ */

export interface Vec2 {
  x: number;
  y: number;
}

export interface Player {
  x: number;
  y: number;
  /** Position at the previous simulation step (render interpolation). */
  px: number;
  py: number;
  r: number;
  char: CharacterDef;
  level: number;
  xp: number;
  xpNext: number;
  hp: number;
  shield: number;
  stats: PlayerStats;
  /** Per-step dynamic stat bonuses written by character hooks (e.g. Kael's missing-health Might). */
  dyn: StatBag;
  f: Flags;
  res: number;
  resMax: number;
  weapons: Weapon[];
  passives: PassiveInstance[];
  weaponMastery: Record<string, number>;
  face: Vec2;
  move: Vec2;
  movedDist: number;
  invulnT: number;
  hurtFlash: number;
  activeCdT: number;
  activeCharges: number;
  activeMax: number;
  critAllT: number;
  rerolls: number;
  skips: number;
  banishes: number;
  revivals: number;
  kills: number;
  slots: { w: number; p: number };
  walkT: number;
  dashT: number;
  dashDx: number;
  dashDy: number;
  dashSpeed: number;
  dashOnStep: ((x: number, y: number) => void) | null;
  dashStepDist: number;
  dashAcc: number;
  auraColor: string | null;
  /** Character-specific runtime state (resources, cooldowns, toggles). */
  [state: string]: any;
}

/* ------------------------------------------------------------------ */
/* Enemies                                                            */
/* ------------------------------------------------------------------ */

export interface EnemyColors {
  body: string;
  eye: string;
  accent?: string;
}

export interface EnemyDef {
  name: string;
  hp: number;
  speed: number;
  dmg: number;
  xp: number;
  r: number;
  mass?: number;
  col: EnemyColors;
  lore: string;
  move?: 'wave' | 'flutter';
  noSpawn?: boolean;
  split?: { type: string; n: number };
  ranged?: { cd: number; speed: number; dmg: number; range: number; keep: number };
  ring?: { cd: number; n: number; speed: number; dmg: number; range: number; keep: number };
  charge?: { cd: number; speed: number; dur: number; windup: number };
  heal?: { cd: number; r: number; pct: number };
  explode?: { r: number };
}

export type BossAttackType = 'charge' | 'dash' | 'spiral' | 'volley' | 'slam' | 'pull' | 'summon' | 'ring' | 'barrage' | 'cross' | 'hazard';
export interface BossDef extends EnemyDef {
  mass: number;
  attacks: BossAttackType[];
  /** Extra attacks added to the rotation when the boss enrages at half health. */
  phase2: BossAttackType[];
  summon?: string;
  /** Hazard pools this boss leaves behind ('hazard' attack, phase two). */
  hazard?: { color: string; status?: StatusSpec['type'] };
}

export interface Burn {
  t: number;
  base: number;
  dps: number;
  tick: number;
}
export interface EnemyStatus {
  burn?: Burn;
  bleed?: { t: number; dps: number; tick: number };
  chill?: { t: number; p: number };
  chillN?: number;
  freeze?: number;
  stun?: number;
  /** Lightning hits leave enemies shocked for a few seconds (reaction ingredient). */
  shock?: number;
  /** Superconduct: seconds of taking extra damage from every source. */
  brittle?: number;
  /** Sim time before this enemy can react again (reactions consume statuses; this stops chains). */
  reactAt?: number;
  /** Character-applied marks (hunted, death marks, void stacks…). */
  [mark: string]: any;
}

export interface BossAttack {
  type: BossAttackType;
  t: number;
  phase?: 'windup' | 'go';
  dx?: number;
  dy?: number;
  n?: number;
  tick?: number;
  ang?: number;
  x?: number;
  y?: number;
  off?: number;
  /** barrage: impact points, detonated one by one. */
  pts?: number[];
}

export interface Enemy {
  id: number;
  type: string;
  def: EnemyDef & Partial<BossDef>;
  x: number;
  y: number;
  px: number;
  py: number;
  r: number;
  hp: number;
  maxHp: number;
  speed: number;
  dmg: number;
  xp: number;
  mass: number;
  vx: number;
  vy: number;
  st: EnemyStatus;
  hitFlash: number;
  /** Per-projectile hit cooldowns: projectile uid → sim time when it may hit again. */
  icd: Record<number, number>;
  elite: boolean;
  boss: boolean;
  tier: number;
  dead: boolean;
  contactCd: number;
  anim: number;
  wave: number;
  rush: Vec2 | null;
  life: number;
  atkT: number;
  chargeState: { phase: 'windup' | 'go'; t: number; dx?: number; dy?: number } | null;
  healT: number;
  weakT: number;
  weak: number;
  spawnT: number;
  flip: number;
  noSplit?: boolean;
  /** Bombers: seconds left on an armed fuse (they stop and flash, then detonate). */
  fuse?: number;
  /** Elite affix ids (data/enemies.ts ELITE_AFFIXES), strongest first. */
  affixes?: string[];
  /** Warded elites: damage-absorbing barrier that regenerates when left alone. */
  barrier?: number;
  barrierMax?: number;
  /** Sim time after which a Warded barrier starts regrowing. */
  barrierAt?: number;
  /** Affix ability timer (summons, blinks, rings, molten trail). */
  affT?: number;
  /** Bosses: 1, or 2 once enraged at half health. */
  phase?: number;
  // bosses
  bossId?: string;
  bossTier: number;
  attackIdx: number;
  attack: BossAttack | null;
  mvx: number;
  mvy: number;
}

/* ------------------------------------------------------------------ */
/* Projectiles, zones, mines, allies, pickups                         */
/* ------------------------------------------------------------------ */

export type SpriteSpec =
  | { kind: 'orb'; color: string; size?: number }
  | { kind: 'void' | 'wave' | 'tornado'; color: string; size: number }
  | { kind: 'spike'; color?: string }
  | { kind: 'bolt' | 'arrow' | 'dagger' | 'shard' | 'axe' | string; color: string; len?: number; wid?: number; size?: number };

export interface StatusSpec {
  type: 'burn' | 'bleed' | 'chill' | 'freeze' | 'stun' | 'shock';
  dur?: number;
  dps?: number;
  power?: number;
  stackFreeze?: number;
  noStack?: boolean;
  noMul?: boolean;
}

export interface Projectile {
  uid: number;
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  angle: number;
  speed: number;
  r: number;
  dmg: number;
  /** Extra enemies it may pass through; -1 = infinite. */
  pierce: number;
  life: number;
  age: number;
  weapon: DamageSource | undefined;
  sprite: SpriteSpec | undefined;
  hits: Set<number> | null;
  hitCd: number;
  homing: number;
  target?: Enemy | null;
  bounce: boolean;
  boomerang: { t: number; spiral?: boolean } | null;
  onHit: ((g: Game, pr: Projectile, e: Enemy) => void) | null;
  onExpire: ((g: Game, pr: Projectile) => void) | null;
  onBounce: ((g: Game, pr: Projectile) => void) | null;
  knock: number;
  trail: string | null;
  spin: number;
  rot: number;
  orbit: { angle: number; speed: number; radius: number } | null;
  field: { r: number; pull: number; tick: number; dmg: number } | null;
  zap: { r: number; cd: number; dmg: number } | null;
  statuses: StatusSpec[] | null;
  crit: number;
  dead: boolean;
  ricochet: number;
  light: number;
  noOnHit: boolean;
  tickT: number;
  hitCount: number;
  trailT: number;
  split: boolean;
  hitBrazier?: boolean;
  [state: string]: any;
}
/** Options for `Game.spawnProj` (mapped type keeps named fields despite Projectile's index signature). */
export type ProjectileSpec = {
  [K in keyof Projectile as K extends 'uid' | 'hits' | 'vx' | 'vy' | 'age' | 'px' | 'py' ? never : K]?: Projectile[K];
} & { x: number; y: number };

export interface Zone {
  x: number;
  y: number;
  r: number;
  age: number;
  dur: number;
  tick: number;
  tickT: number;
  dmg: number;
  color: string;
  kind: string;
  dead: boolean;
  weapon?: DamageSource;
  burn?: number;
  status?: StatusSpec;
  heal?: number;
  healPct?: number;
  pull?: number;
  follow?: 'nearest';
  followSpeed?: number;
  target?: Enemy | null;
  onEnd?: ((z: Zone) => void) | null;
  [state: string]: any;
}

export interface Mine {
  x: number;
  y: number;
  r: number;
  dmg: number;
  life: number;
  age: number;
  armT: number;
  dead: boolean;
  pulse: number;
  color: string;
  weapon?: DamageSource;
  cluster?: number;
}

/** Enemy-owned ground hazard (molten trails, boss pools): hurts the player while they stand in it. */
export interface Hazard {
  x: number;
  y: number;
  r: number;
  dmg: number;
  life: number;
  max: number;
  /** Seconds before the pool becomes harmful (it fades in as a warning). */
  arm: number;
  color: string;
  status?: StatusSpec['type'];
  tickT: number;
  dead: boolean;
}

export type ShrineKind = 'blood' | 'fortune' | 'trial' | 'haste' | 'life' | 'curse';
/** A map shrine: stand inside it to channel; when the charge fills, its effect fires. */
export interface Shrine {
  id: number;
  kind: ShrineKind;
  x: number;
  y: number;
  r: number;
  /** Channel progress 0..1. */
  charge: number;
  used: boolean;
  /** Seconds since spawn / since use (fade-out). */
  age: number;
  usedAt: number;
  dead: boolean;
}

export interface Ally {
  kind: string;
  x: number;
  y: number;
  px: number;
  py: number;
  r: number;
  life: number;
  age: number;
  dead: boolean;
  speed: number;
  atkT: number;
  attackCd: number;
  attackR: number;
  angle: number;
  walk: number;
  target: Enemy | null;
  fireT: number;
  dmgDealt: number;
  color: string;
  dmg: number | (() => number);
  weapon?: DamageSource;
  flip?: number;
  [state: string]: any;
}

export type PickupKind = 'gem' | 'gold' | 'food' | 'magnet' | 'bomb' | 'clock' | 'chest' | 'bosschest' | 'mat' | 'ember' | 'brazier';
export type GemTier = 'blue' | 'green' | 'red' | 'purple';
export type MaterialId = 'iron' | 'dust' | 'crystal' | 'star';

export interface Pickup {
  kind: PickupKind;
  x: number;
  y: number;
  px: number;
  py: number;
  age: number;
  vx: number;
  vy: number;
  pull: boolean;
  dead: boolean;
  bob: number;
  value?: number;
  gem?: GemTier;
  mat?: MaterialId;
  hp?: number;
}
export type PickupSpec = Pick<Pickup, 'kind' | 'x' | 'y'> & Partial<Pickup>;

/* ------------------------------------------------------------------ */
/* Damage                                                             */
/* ------------------------------------------------------------------ */

export interface DamageInfo {
  weapon?: DamageSource | null;
  /** Knockback direction (defaults to away from the player). */
  kx?: number;
  ky?: number;
  knock?: number;
  quiet?: boolean;
  noKnock?: boolean;
  /** Bonus crit chance from the source. */
  crit?: number | boolean;
  execute?: boolean;
  /** Damage reflected by thorns (no lifesteal, no bomber blast). */
  thorns?: boolean;
  /** A bomber killed by this hit does not detonate (screen-clearing pickups). */
  noBlast?: boolean;
  // filled in by damageEnemy
  mult?: number;
  critBonus?: number;
  dmg?: number;
  [extra: string]: any;
}

/* ------------------------------------------------------------------ */
/* World / run configuration                                          */
/* ------------------------------------------------------------------ */

export interface StagePalette {
  id: string;
  seed: number;
  ground: string;
  groundDark: string;
  groundLight: string;
  rune: string;
  propDark: string;
  propLight: string;
  crystal: string;
  ambient: string;
  fog: string;
  ember: string;
  sky: string;
  tint?: string;
}
export interface StageDef {
  id: string;
  name: string;
  seed: number;
  tier: number;
  diff: number;
  reward: number;
  desc: string;
  unlock: { stage: string; time: number } | null;
  pal: StagePalette;
  props: string[];
  enemyTint: string | null;
}

export interface DifficultyMods {
  enemyHp: number;
  enemyDmg: number;
  enemySpeed: number;
  spawn: number;
  elite: number;
  healing: number;
  bossHp: number;
  bossRate: number;
  playerHp: number;
  timeScale: number;
}
export interface OmenDef {
  id: string;
  name: string;
  icon: IconSpec;
  max: number;
  desc: string;
  apply(m: DifficultyMods, rank: number): void;
}
export interface Difficulty {
  hp: number;
  dmg: number;
  speed: number;
  count: number;
  xp: number;
  gold: number;
  tier: number;
  minute: number;
}

export type ScriptedEvent =
  | { at?: number; type: 'boss'; boss: string; tierUp?: number }
  | { at?: number; type: 'swarm'; enemy: string; n: number }
  | { at?: number; type: 'ring'; enemy: string; n: number };

/** Aggregated permanent bonuses computed by the meta layer for one character. */
export interface MetaBonuses {
  stats: StatBag;
  flags: Flags;
  weaponMastery: Record<string, number>;
}

export interface Materials {
  iron: number;
  dust: number;
  crystal: number;
  star: number;
}

/* ------------------------------------------------------------------ */
/* Level-up & chest choices                                           */
/* ------------------------------------------------------------------ */

export type LevelOption =
  | { type: 'weapon'; id: string; def: WeaponDef; level: number; weight: number; isNew?: boolean; empowered?: boolean }
  | { type: 'passive'; id: string; def: PassiveDef; level: number; weight: number; isNew?: boolean; empowered?: boolean }
  | { type: 'gold'; value: number; id?: undefined }
  | { type: 'heal'; value: number; id?: undefined };

/** A weapon/passive card (the options that come from the upgrade pool). */
export type UpgradeOption = Extract<LevelOption, { type: 'weapon' | 'passive' }>;

export type ChestReward =
  | { type: 'evolve'; def: WeaponDef; name: string; icon: IconSpec; desc: string }
  | { type: 'weapon'; def: WeaponDef; level: number }
  | { type: 'passive'; def: PassiveDef; level: number }
  | { type: 'gold'; value: number }
  | { type: 'mat'; mat: MaterialId };

export interface RunSummary {
  charId: string;
  stageId: string;
  seed: number;
  time: number;
  kills: number;
  level: number;
  bossKills: number;
  elites: number;
  evolves: number;
  heat: number;
  gold: number;
  embers: number;
  charXp: number;
  mats: Materials;
  enemyKills: Record<string, number>;
  bossKillsBy: Record<string, number>;
  dmgByWeapon: Record<string, number>;
  weapons: { id: string; level: number; evolved: boolean; dmg: number }[];
  passives: { id: string; level: number }[];
  eclipse: boolean;
  /** What landed the killing blow (enemy name, 'projectile', …). */
  killedBy: string;
  bestCombo: number;
  reactions: number;
  boons: string[];
  shrines: number;
}

/* ------------------------------------------------------------------ */
/* Simulation ⇄ host boundary                                         */
/* ------------------------------------------------------------------ */

export type GameState = 'idle' | 'play' | 'paused' | 'levelup' | 'chest' | 'boon' | 'over';

/** Everything the simulation tells the outside world. The sim never touches DOM/UI/audio directly. */
export type GameEvents = {
  sfx: (name: string, param?: number) => void;
  notice: (text: string, color?: string, dur?: number) => void;
  levelUp: (options: LevelOption[]) => void;
  chest: (rewards: ChestReward[], boss: boolean) => void;
  gameOver: (summary: RunSummary) => void;
  runStart: (stage: StageDef) => void;
  /** First encounter of a weapon/boss/boon/reaction this run (feeds the codex). */
  discover: (kind: 'weapon' | 'boss' | 'boon' | 'reaction', id: string) => void;
  /** A boss chest grants a choice of run-long boons. */
  boon: (options: BoonDef[]) => void;
  /** A narrative moment the presentation layer may voice (narrator, character, boss lines). */
  story: (beat: StoryBeatId, ref?: string) => void;
};

export type StoryBeatId =
  | 'runStart'
  | 'bossIntro'
  | 'bossPhase'
  | 'bossDown'
  | 'evolve'
  | 'eclipse'
  | 'lowHp'
  | 'revive'
  | 'shrine'
  | 'combo'
  | 'boon'
  | 'reaction'
  | 'elite'
  | 'death';

/** A run-long modifier chosen after a boss falls (data/boons.ts). */
export interface BoonDef {
  id: string;
  name: string;
  icon: IconSpec;
  desc: string;
  /** Permanent stat deltas while owned. */
  stats?: StatBag;
  /** Mechanic switch read by the simulation (`player.f[flag]`). */
  flag?: string;
  /** One-off effect when picked. */
  onPick?(g: Game, p: Player): void;
}

/** Abstract input the simulation polls once per step (keyboard/gamepad/touch, or a test script). */
export interface InputSource {
  moveX(): number;
  moveY(): number;
  /** True once per press of the active-ability button. */
  consumeActive(): boolean;
}
