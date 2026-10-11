/* SOULFORGE — long-term progression tables: Soul Rank, Champion Ascension, Weapon Mastery, Torment.
 * Pure data and curves; the transactions live in meta/save.ts and the run-side effects in game/game.ts.
 * See docs/DESIGN.md › "Fourth round — the long night ahead" for the intent behind each curve. */
import type { DifficultyMods, IconSpec, StatBag } from '../game/types';
import type { Cost } from './forge';

/* ------------------------------------------------------------------ */
/* Soul Rank — the account level                                      */
/* ------------------------------------------------------------------ */

/**
 * Soul XP needed to go from rank `R` to `R + 1`. Every run's character XP also feeds the account,
 * so all twelve champions push one shared rank. Early ranks take a run or two; rank 50 is a long
 * campaign (~2.2M Soul XP in total).
 */
export const soulXpFor = (R: number): number => Math.round(2500 * Math.pow(R, 0.9));
/** Starweb points granted by Soul Rank alone (Ascension ranks add more: see `ASCENSION_STAR_POINTS`). */
export const soulRankPoints = (rank: number): number => Math.max(0, rank - 1);

/* ------------------------------------------------------------------ */
/* Champion Ascension — ten ranks per champion                        */
/* ------------------------------------------------------------------ */

export type AscensionFeat =
  | { kind: 'time'; v: number }
  | { kind: 'bosses'; v: number }
  | { kind: 'level'; v: number }
  | { kind: 'kills'; v: number }
  /** Survive 15:00 at Torment `v` or higher with this champion. */
  | { kind: 'torment'; v: number };

export interface AscensionDef {
  rank: number;
  /** Roman numeral shown on portraits and cards. */
  numeral: string;
  /** Character level required. */
  level: number;
  feat: AscensionFeat;
  cost: Cost;
  /** The headline reward (on top of the per-rank Might/Health and the Starweb point). */
  desc: string;
  stats?: StatBag;
  flag?: string;
}

/** Every rank, on top of its own reward: */
export const ASCENSION_PER_RANK: StatBag = { might: 0.03, maxHpPct: 0.04 };
/** Starweb points each Ascension rank grants the whole account. */
export const ASCENSION_STAR_POINTS = 1;
/** Ability Rank a champion starts every run with from Ascension V. */
export const ASCENDED_ABILITY_RANK = 2;

export const ASCENSIONS: AscensionDef[] = [
  { rank: 1, numeral: 'I', level: 10, feat: { kind: 'time', v: 600 }, cost: { star: 1 }, desc: 'Unlocks the Mastery tier of every talent branch.' },
  { rank: 2, numeral: 'II', level: 20, feat: { kind: 'bosses', v: 5 }, cost: { star: 2, crystal: 5 }, desc: 'Signature weapon damage +15%.', stats: { sigDmg: 0.15 } },
  { rank: 3, numeral: 'III', level: 30, feat: { kind: 'time', v: 1200 }, cost: { star: 3, crystal: 8 }, desc: 'Unlocks the Apex of every talent branch.' },
  { rank: 4, numeral: 'IV', level: 40, feat: { kind: 'level', v: 100 }, cost: { star: 4, crystal: 10 }, desc: 'Ability cooldown -12%.', stats: { activeCd: 0.12 } },
  { rank: 5, numeral: 'V', level: 55, feat: { kind: 'time', v: 1800 }, cost: { star: 6, crystal: 12 }, desc: 'Begin every run at Ability Rank II.', flag: 'asc_rank' },
  { rank: 6, numeral: 'VI', level: 70, feat: { kind: 'torment', v: 3 }, cost: { star: 8, eclipse: 5 }, desc: '+1 Revival.', stats: { revival: 1 } },
  { rank: 7, numeral: 'VII', level: 85, feat: { kind: 'kills', v: 100000 }, cost: { star: 10, eclipse: 10 }, desc: '+1 Reroll and +1 Banish every run.', stats: { rerolls: 1, banishes: 1 } },
  { rank: 8, numeral: 'VIII', level: 100, feat: { kind: 'torment', v: 6 }, cost: { star: 12, eclipse: 20 }, desc: 'The signature weapon can reach Apotheosis without Weapon Mastery. Experience +10%.', flag: 'asc_sigapex', stats: { growth: 0.1 } },
  { rank: 9, numeral: 'IX', level: 120, feat: { kind: 'bosses', v: 100 }, cost: { star: 15, eclipse: 35 }, desc: '+1 Amount.', stats: { amount: 1 } },
  { rank: 10, numeral: 'X', level: 150, feat: { kind: 'torment', v: 10 }, cost: { star: 20, eclipse: 60 }, desc: 'Transcendence: Might +20%, Max Health +20%, and your champion burns with dawnlight.', stats: { might: 0.2, maxHpPct: 0.2 }, flag: 'asc_transcend' },
];
export const MAX_ASCENSION = ASCENSIONS.length;
/** Talent tiers unlocked by Ascension: Mastery (tier V) at rank I, Apex (tier VI) at rank III. */
export const MASTERY_TIER_ASC = 1;
export const APEX_TIER_ASC = 3;

export const featText = (f: AscensionFeat): string => {
  switch (f.kind) {
    case 'time': return `Survive ${Math.floor(f.v / 60)}:00 with this champion`;
    case 'bosses': return `Defeat ${f.v} Heralds with this champion`;
    case 'level': return `Reach level ${f.v} in a run with this champion`;
    case 'kills': return `Slay ${f.v.toLocaleString('en-US')} enemies with this champion`;
    case 'torment': return `Survive 15:00 at Torment ${f.v} with this champion`;
  }
};

/* ------------------------------------------------------------------ */
/* Weapon Mastery — 25 levels per weapon, account-wide                */
/* ------------------------------------------------------------------ */

export const MASTERY_MAX = 25;
/** Mastery XP to go from level `L` to `L + 1`. */
export const masteryXpFor = (L: number): number => Math.round(250 * Math.pow(L + 1, 1.6));
/** Mastery XP earned from a run's damage with one weapon (damage grows quadratically, so it is square-rooted). */
export const masteryXpFromDamage = (dmg: number): number => Math.round(Math.sqrt(Math.max(0, dmg)) * 2.5);
/** Permanent damage per Mastery level. */
export const MASTERY_DMG_PER_LEVEL = 0.02;

export interface MasteryPerk { level: number; name: string; desc: string }
export const MASTERY_PERKS: MasteryPerk[] = [
  { level: 5, name: 'Honed', desc: 'Cooldown -5%.' },
  { level: 10, name: 'Attuned', desc: 'Unlocks Apotheosis: an evolved weapon at Overdrive III transcends again.' },
  { level: 15, name: 'Perfected', desc: 'Area +10%.' },
  { level: 20, name: 'Legendary', desc: 'Overdrive cap +2.' },
  { level: 25, name: 'Mythic', desc: '+1 Amount.' },
];
/** Weapon Mastery level needed for Apotheosis (Ascension VIII waives it for the signature weapon). */
export const APOTHEOSIS_MASTERY = 10;

/* ------------------------------------------------------------------ */
/* Overdrive & Apotheosis (run-side tuning)                           */
/* ------------------------------------------------------------------ */

/** Overdrive levels an evolved weapon can gain past its max (before mastery, uniques and boons). */
export const OVERDRIVE_BASE = 5;
/** Overdrive level an evolved weapon needs before its next chest can bring Apotheosis. */
export const APOTHEOSIS_OVERDRIVE = 3;
export const OVERDRIVE_NAMES = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
/** What one Overdrive level does, by level (1-based). Damage +15% every level. */
export const overdriveDesc = (od: number): string =>
  'Damage +15%' + (od % 2 === 0 ? ', Cooldown -6%' : '') + (od === 3 ? ', Area +15%' : '') + (od === 5 ? ', +1 Amount' : '');
/** Apotheosis: damage multiplier, echo damage share and delay, and the elemental imbue chance. */
export const APOTHEOSIS = { dmgMul: 1.35, echo: 0.5, echoDelay: 0.22, continuousMul: 1.45, imbue: 0.2 };
/** The imbue an Apotheosis weapon adds to its hits, by its first tag that has one. */
export const APOTHEOSIS_IMBUE: Record<string, string> = {
  fire: 'hits ignite', ice: 'hits chill', lightning: 'hits shock and arc', holy: 'hits smite elites and heal you', physical: 'hits bleed',
  shadow: 'hits drain life', poison: 'hits wither', magic: 'hits split into motes', summon: 'hits raise shades', earth: 'hits stagger', wind: 'hits knock enemies back', blood: 'hits bleed', void: 'hits pull enemies together',
};

/* ------------------------------------------------------------------ */
/* Ability Ranks (level-up cards)                                     */
/* ------------------------------------------------------------------ */

export const ABILITY_RANK_MAX = 5;
/** Per rank: ability power (+20% Might while it is cast) and cooldown (-8%). */
export const ABILITY_RANK_POWER = 0.2;
export const ABILITY_RANK_CD = 0.08;

/** Overflow: passives past their max (Starweb › Overflowing Satchel). Each extra level is worth 60% of a normal one. */
export const OVERFLOW_LEVELS = 3;
export const OVERFLOW_VALUE = 0.6;

/* ------------------------------------------------------------------ */
/* Torment — endless difficulty tiers per stage                       */
/* ------------------------------------------------------------------ */

export const TORMENT_MAX = 20;
/** Survive this long at Torment T on a stage to unlock T + 1 there (T0 → T1 needs `TORMENT_FIRST`). */
export const TORMENT_CLEAR = 900;
export const TORMENT_FIRST = 1200;
export const tormentName = (t: number): string => (t <= 0 ? 'Normal' : 'Torment ' + t);

/** Apply Torment tier `t` to the run's difficulty modifiers. */
export function applyTorment(m: DifficultyMods, t: number): void {
  if (t <= 0) return;
  m.enemyHp *= 1 + 0.5 * t + 0.06 * t * t;
  m.enemyDmg *= 1 + 0.15 * t;
  m.spawn *= 1 + 0.03 * t;
  m.elite *= 1 + 0.04 * t;
  m.bossHp *= 1 + 0.25 * t;
}
/** Reward multiplier (gold, character XP, materials) at Torment `t`. */
export const tormentReward = (t: number): number => 1 + 0.4 * Math.max(0, t);
/** Elites gain an extra affix from this Torment on. */
export const TORMENT_EXTRA_AFFIX = 4;
/** Eclipse Shard drops: chance per elite, shards per Herald. */
export const eclipseEliteChance = (t: number): number => Math.min(0.6, 0.04 * t);
export const eclipseBossShards = (t: number): number => (t > 0 ? 1 + Math.floor(t / 2) : 0);

export interface TormentInfo { icon: IconSpec; color: string }
export const TORMENT_INFO: TormentInfo = { icon: { g: 'moon', c: '#f43f5e' }, color: '#f43f5e' };
