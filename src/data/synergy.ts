/* SOULFORGE — run synergies: weapon resonance (shared tags), elemental reactions (status combos), kill streaks */
import type { IconSpec, StatBag } from '../game/types';

/* ---------- resonance: owning several weapons that share a tag ---------- */
export interface ResonanceTier { n: number; stats?: StatBag; flag?: string; desc: string }
export interface ResonanceDef { tag: string; name: string; color: string; icon: IconSpec; tiers: ResonanceTier[] }
/** Active resonance for the HUD / cards: `tier` = number of tiers reached (0 = none yet). */
export interface ResonanceState { def: ResonanceDef; count: number; tier: number }

export const RESONANCES: ResonanceDef[] = [
  { tag: 'fire', name: 'Pyre', color: '#ff7a3c', icon: { g: 'flame', c: '#ff7a3c' }, tiers: [{ n: 2, stats: { burnDmg: 0.3 }, desc: 'Burn damage +30%.' }, { n: 3, flag: 'res_fire', desc: 'Burning enemies explode when they die.' }] },
  { tag: 'ice', name: 'Rime', color: '#bae6fd', icon: { g: 'snowflake', c: '#bae6fd' }, tiers: [{ n: 2, stats: { slowPower: 0.3, duration: 0.1 }, desc: 'Slow +30%, Duration +10%.' }, { n: 3, flag: 'res_ice', desc: 'Chilled and frozen enemies take +20% damage.' }] },
  { tag: 'lightning', name: 'Tempest', color: '#fde047', icon: { g: 'bolt', c: '#fde047' }, tiers: [{ n: 2, stats: { cooldown: 0.08 }, desc: 'Cooldown -8%.' }, { n: 3, flag: 'res_storm', desc: 'Hitting a shocked enemy arcs lightning to a neighbour (once per second each).' }] },
  { tag: 'holy', name: 'Sanctum', color: '#fde68a', icon: { g: 'sun', c: '#fde68a' }, tiers: [{ n: 2, stats: { maxHpPct: 0.1, healing: 0.2 }, desc: 'Max Health +10%, Healing +20%.' }, { n: 3, flag: 'res_holy', desc: 'Once per run, a killing blow leaves you standing at half health.' }] },
  { tag: 'magic', name: 'Arcana', color: '#8ab4ff', icon: { g: 'orb', c: '#8ab4ff' }, tiers: [{ n: 2, stats: { area: 0.1, projSpeed: 0.15 }, desc: 'Area +10%, Projectile Speed +15%.' }, { n: 3, stats: { amount: 1 }, desc: '+1 Amount.' }] },
  { tag: 'physical', name: 'Steel', color: '#e2e8f0', icon: { g: 'sword', c: '#e2e8f0' }, tiers: [{ n: 2, stats: { crit: 0.05, critDmg: 0.25 }, desc: 'Crit chance +5%, Crit damage +25%.' }, { n: 3, flag: 'res_steel', desc: 'Critical hits make enemies bleed.' }] },
  { tag: 'shadow', name: 'Umbra', color: '#c084fc', icon: { g: 'ghost', c: '#c084fc' }, tiers: [{ n: 2, stats: { crit: 0.05, lifesteal: 0.008 }, desc: 'Crit chance +5%, Lifesteal +0.8%.' }, { n: 3, flag: 'res_umbra', desc: 'Kills have a 4% chance to raise a hunting shade.' }] },
  { tag: 'poison', name: 'Blight', color: '#a3e635', icon: { g: 'leaf', c: '#a3e635' }, tiers: [{ n: 2, stats: { duration: 0.15, area: 0.1 }, desc: 'Duration +15%, Area +10%.' }, { n: 3, flag: 'res_blight', desc: 'Poison deals +40% damage and withers enemies (they hit 30% softer).' }] },
  { tag: 'summon', name: 'Legion', color: '#86efac', icon: { g: 'minion', c: '#86efac' }, tiers: [{ n: 2, stats: { minionDmg: 0.3 }, desc: 'Minion damage +30%.' }, { n: 3, stats: { minionDmg: 0.4, duration: 0.15 }, desc: 'Minion damage +40% more, Duration +15%.' }] },
];
export const RESONANCE_BY_TAG: Record<string, ResonanceDef> = {}; RESONANCES.forEach((r) => (RESONANCE_BY_TAG[r.tag] = r));

/** Tier reached with `count` weapons sharing the tag. */
export const resonanceTier = (def: ResonanceDef, count: number): number => def.tiers.filter((t) => count >= t.n).length;

/* ---------- elemental reactions: a second element meeting the first ---------- */
export type ReactionId = 'thermal' | 'overload' | 'superconduct';
export interface ReactionDef { id: ReactionId; name: string; color: string; recipe: string; desc: string }
export const REACTION_DEFS: Record<ReactionId, ReactionDef> = {
  thermal: { id: 'thermal', name: 'THERMAL SHOCK', color: '#e0f2fe', recipe: 'Burn + Chill', desc: 'Fire meets frost: a violent burst of damage that also cracks the ice.' },
  overload: { id: 'overload', name: 'OVERLOAD', color: '#fb923c', recipe: 'Burn + Shock', desc: 'The charge ignites: an explosion that hurts everything nearby.' },
  superconduct: { id: 'superconduct', name: 'SUPERCONDUCT', color: '#a5f3fc', recipe: 'Chill + Shock', desc: 'The target turns Brittle and takes +30% damage from everything for 4 seconds.' },
};
/** Seconds an enemy must wait between reactions (statuses re-apply constantly; this keeps reactions punchy, not spammy). */
export const REACTION_CD = 0.8;
/** Damage multiplier for Brittle (superconducted) enemies. */
export const BRITTLE_MUL = 1.3;

/* ---------- kill streaks: kills in quick succession build a combo; tiers grant bonuses ---------- */
export interface ComboTier { n: number; name: string; color: string }
export const COMBO_TIERS: ComboTier[] = [
  { n: 25, name: 'Frenzy', color: '#fde68a' },
  { n: 75, name: 'Rampage', color: '#fbbf24' },
  { n: 200, name: 'Massacre', color: '#fb923c' },
  { n: 500, name: 'Carnage', color: '#f87171' },
  { n: 1200, name: 'Apocalypse', color: '#e879f9' },
];
/** Seconds without a kill before the streak ends. */
export const COMBO_WINDOW = 2.5;
/** Per streak tier: Might and Growth bonus. */
export const COMBO_MIGHT = 0.03;
export const COMBO_GROWTH = 0.05;
export const comboTier = (n: number): number => { let t = 0; for (const c of COMBO_TIERS) if (n >= c.n) t++; return t; };
