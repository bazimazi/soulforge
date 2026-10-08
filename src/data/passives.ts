/* SOULFORGE — passive items, stages (biomes), omens (difficulty pacts), pickups */
import type { IconSpec, MaterialId, OmenDef, PassiveDef, StageDef, StagePalette } from '../game/types';

export interface StatInfo {
  name: string;
  fmt: (v: number) => string;
  pct?: boolean;
}
export interface MaterialDef {
  id: MaterialId;
  name: string;
  color: string;
  icon: IconSpec;
  tier: number;
}
/** Stage literal as authored: palettes may carry extra (currently unused) hints such as `tiles`. */
type StageInput = StageDef & { pal: StagePalette & { tiles?: number } };

export const STAT_INFO: Record<string, StatInfo> = {
  maxHp: { name: 'Max Health', fmt: (v) => '+' + Math.round(v), pct: false },
  regen: { name: 'Regeneration', fmt: (v) => '+' + v.toFixed(2) + '/s' },
  armor: { name: 'Armor', fmt: (v) => '+' + v.toFixed(1) },
  speed: { name: 'Move Speed', fmt: (v) => '+' + Math.round(v * 100) + '%' },
  might: { name: 'Might', fmt: (v) => '+' + Math.round(v * 100) + '%' },
  area: { name: 'Area', fmt: (v) => '+' + Math.round(v * 100) + '%' },
  projSpeed: { name: 'Projectile Speed', fmt: (v) => '+' + Math.round(v * 100) + '%' },
  duration: { name: 'Duration', fmt: (v) => '+' + Math.round(v * 100) + '%' },
  amount: { name: 'Amount', fmt: (v) => '+' + Math.round(v) },
  cooldown: { name: 'Cooldown', fmt: (v) => '-' + Math.round(v * 100) + '%' },
  luck: { name: 'Luck', fmt: (v) => '+' + Math.round(v * 100) + '%' },
  growth: { name: 'Growth (XP)', fmt: (v) => '+' + Math.round(v * 100) + '%' },
  greed: { name: 'Greed (Gold)', fmt: (v) => '+' + Math.round(v * 100) + '%' },
  magnet: { name: 'Magnet', fmt: (v) => '+' + Math.round(v * 100) + '%' },
  revival: { name: 'Revival', fmt: (v) => '+' + Math.round(v) },
  crit: { name: 'Crit Chance', fmt: (v) => '+' + Math.round(v * 100) + '%' },
  critDmg: { name: 'Crit Damage', fmt: (v) => '+' + Math.round(v * 100) + '%' },
  dodge: { name: 'Dodge', fmt: (v) => '+' + Math.round(v * 100) + '%' },
  lifesteal: { name: 'Lifesteal', fmt: (v) => '+' + (v * 100).toFixed(1) + '%' },
  curse: { name: 'Curse', fmt: (v) => '+' + Math.round(v * 100) + '%' },
  rerolls: { name: 'Rerolls', fmt: (v) => '+' + Math.round(v) },
  skips: { name: 'Skips', fmt: (v) => '+' + Math.round(v) },
  banishes: { name: 'Banishes', fmt: (v) => '+' + Math.round(v) },
  activeCd: { name: 'Ability Cooldown', fmt: (v) => '-' + Math.round(v * 100) + '%' },
  thorns: { name: 'Thorns', fmt: (v) => '+' + Math.round(v * 100) + '%' },
  healing: { name: 'Healing Power', fmt: (v) => '+' + Math.round(v * 100) + '%' },
  eliteDmg: { name: 'Elite & Boss Damage', fmt: (v) => '+' + Math.round(v * 100) + '%' },
  burnDmg: { name: 'Burn Damage', fmt: (v) => '+' + Math.round(v * 100) + '%' },
  shieldPower: { name: 'Shield Power', fmt: (v) => '+' + Math.round(v * 100) + '%' },
  minionDmg: { name: 'Minion Damage', fmt: (v) => '+' + Math.round(v * 100) + '%' },
  xpBonus: { name: 'Character XP', fmt: (v) => '+' + Math.round(v * 100) + '%' },
  matFind: { name: 'Material Find', fmt: (v) => '+' + Math.round(v * 100) + '%' },
  startLevel: { name: 'Starting Level', fmt: (v) => '+' + Math.round(v) },
  pierce: { name: 'Pierce', fmt: (v) => '+' + Math.round(v) },
  knockback: { name: 'Knockback', fmt: (v) => '+' + Math.round(v * 100) + '%' },
  chestLuck: { name: 'Chest Bounty', fmt: (v) => '+' + Math.round(v * 100) + '%' },
  slowPower: { name: 'Slow Power', fmt: (v) => '+' + Math.round(v * 100) + '%' },
  execute: { name: 'Execute Threshold', fmt: (v) => '+' + Math.round(v * 100) + '%' },
};
const P = (v: number): string => { const a = Math.abs(v * 100); return (a > 0 && a < 1 ? (v * 100).toFixed(1) : Math.round(v * 100)) + '%'; };
for (const k in STAT_INFO) { const f = STAT_INFO[k]!.fmt; STAT_INFO[k]!.fmt = (v: number) => { const out = f(v); return /^[+-]\d+%$/.test(out) ? out[0] + P(Math.abs(v)) : out; }; }
export const statName = (k: string): string => (STAT_INFO[k] ? STAT_INFO[k].name : k);
export const statFmt = (k: string, v: number): string => (STAT_INFO[k] ? STAT_INFO[k].fmt(v) : String(v));

export const PASSIVES: PassiveDef[] = [
  { id: 'vitality', name: 'Vitality Core', icon: { g: 'heart', c: '#ff5c7a' }, max: 5, per: { maxHp: 0.12 }, desc: 'Max Health +12% per level.' },
  { id: 'plate', name: 'Iron Plate', icon: { g: 'shield', c: '#9fb2c8' }, max: 5, per: { armor: 1 }, desc: 'Armor +1 per level (flat damage reduction).' },
  { id: 'boots', name: 'Swift Boots', icon: { g: 'boot', c: '#6ee7b7' }, max: 5, per: { speed: 0.08 }, desc: 'Move Speed +8% per level.' },
  { id: 'power', name: 'Power Gem', icon: { g: 'gem', c: '#ff7043' }, max: 5, per: { might: 0.08 }, desc: 'Might (all damage) +8% per level.' },
  { id: 'crystal', name: 'Expanse Crystal', icon: { g: 'hex', c: '#7dd3fc' }, max: 5, per: { area: 0.08 }, desc: 'Area of effect +8% per level.' },
  { id: 'velocity', name: 'Velocity Rune', icon: { g: 'rune', c: '#c4b5fd' }, max: 5, per: { projSpeed: 0.1 }, desc: 'Projectile speed +10% per level.' },
  { id: 'hourglass', name: 'Hourglass', icon: { g: 'hourglass', c: '#fbbf24' }, max: 5, per: { duration: 0.1 }, desc: 'Effect duration +10% per level.' },
  { id: 'mirror', name: 'Twin Mirror', icon: { g: 'mirror', c: '#a5f3fc' }, max: 2, per: { amount: 1 }, desc: '+1 projectile / effect count per level.' },
  { id: 'clockwork', name: 'Clockwork Heart', icon: { g: 'clock', c: '#f472b6' }, max: 5, per: { cooldown: 0.06 }, desc: 'Weapon cooldowns -6% per level.' },
  { id: 'clover', name: 'Four-Leaf Clover', icon: { g: 'clover', c: '#4ade80' }, max: 5, per: { luck: 0.1 }, desc: 'Luck +10% per level. Better drops, crits and extra choices.' },
  { id: 'crown', name: "Scholar's Crown", icon: { g: 'crown', c: '#facc15' }, max: 5, per: { growth: 0.08 }, desc: 'Experience gain +8% per level.' },
  { id: 'magnet', name: 'Lodestone', icon: { g: 'magnet', c: '#f87171' }, max: 5, per: { magnet: 0.25 }, desc: 'Pickup radius +25% per level.' },
  { id: 'moss', name: 'Regen Moss', icon: { g: 'leaf', c: '#86efac' }, max: 5, per: { regen: 0.3 }, desc: 'Regenerate +0.3 HP/s per level.' },
  { id: 'edge', name: 'Keen Edge', icon: { g: 'dagger', c: '#e2e8f0' }, max: 5, per: { crit: 0.04, critDmg: 0.1 }, desc: 'Crit chance +4% and crit damage +10% per level.' },
  { id: 'fang', name: 'Vampiric Fang', icon: { g: 'fang', c: '#dc2626' }, max: 5, per: { lifesteal: 0.006 }, desc: 'Lifesteal +0.6% of damage dealt per level.' },
  { id: 'cloak', name: 'Phantom Cloak', icon: { g: 'ghost', c: '#94a3b8' }, max: 5, per: { dodge: 0.03 }, desc: 'Dodge chance +3% per level.' },
  { id: 'idol', name: 'Golden Idol', icon: { g: 'coin', c: '#f5c542' }, max: 5, per: { greed: 0.15 }, desc: 'Gold gain +15% per level.' },
  { id: 'skull', name: 'Cursed Skull', icon: { g: 'skull', c: '#a78bfa' }, max: 5, per: { curse: 0.1 }, desc: 'Curse +10% per level: more enemies, more HP, more rewards.' },
];
export const PASSIVE_BY_ID: Record<string, PassiveDef> = {}; PASSIVES.forEach((p) => (PASSIVE_BY_ID[p.id] = p));

/* ---------- stages / biomes ---------- */
export const STAGES: StageInput[] = [
  {
    id: 'ashen', name: 'Ashen Wastes', seed: 11, tier: 1, diff: 1.0, reward: 1.0,
    desc: 'The scorched plains where the night first fell. Embers still drift from the dead earth.',
    unlock: null,
    pal: { id: 'ashen', seed: 11, ground: '#352d2f', groundDark: '#191313', groundLight: '#5a4c47', rune: '#ff9a3c', propDark: '#1a1516', propLight: '#4d4341', crystal: '#ff9a3c', ambient: 'rgba(8,4,12,0.42)', fog: '#3a2a20', ember: '#ff9a3c', sky: '#0d0810' },
    props: ['rock', 'tree', 'bones', 'grave', 'stump'], enemyTint: null,
  },
  {
    id: 'frost', name: 'Frostveil Tundra', seed: 23, tier: 2, diff: 1.4, reward: 1.5,
    desc: 'A frozen expanse under an unblinking moon. The cold gnaws before the dead do.',
    unlock: { stage: 'ashen', time: 600 },
    pal: { id: 'frost', seed: 23, ground: '#2a3a4c', groundDark: '#13202e', groundLight: '#557a99', rune: '#8fe3ff', propDark: '#1a2633', propLight: '#6a8aa6', crystal: '#8fe3ff', ambient: 'rgba(4,10,24,0.42)', fog: '#20304a', ember: '#bfefff', sky: '#070c18' },
    props: ['rock', 'crystal', 'tree', 'pillar', 'bones'], enemyTint: 'rgba(120,200,255,0.25)',
  },
  {
    id: 'cathedral', name: 'Crimson Cathedral', seed: 37, tier: 3, diff: 1.9, reward: 2.1,
    desc: 'Blood-stained flagstones stretch beneath a ruined vault. Something ancient still prays here.',
    unlock: { stage: 'frost', time: 900 },
    pal: { id: 'cathedral', seed: 37, ground: '#3d2027', groundDark: '#1b0d11', groundLight: '#6d3742', rune: '#ff4d6d', propDark: '#1f0e12', propLight: '#6e3a44', crystal: '#ff4d6d', ambient: 'rgba(14,2,8,0.44)', fog: '#4a1a24', ember: '#ff4d6d', sky: '#120508', tiles: 64 },
    props: ['pillar', 'grave', 'bones', 'rock', 'crystal'], enemyTint: 'rgba(255,60,90,0.22)',
  },
  {
    id: 'blight', name: 'Verdant Blight', seed: 51, tier: 4, diff: 2.5, reward: 2.9,
    desc: 'A swamp choking on its own corruption. Spores glow in the dark and things grow wrong.',
    unlock: { stage: 'cathedral', time: 900 },
    pal: { id: 'blight', seed: 51, ground: '#233426', groundDark: '#0f1a12', groundLight: '#4c6a46', rune: '#9dff5c', propDark: '#122016', propLight: '#4a6a42', crystal: '#9dff5c', ambient: 'rgba(2,10,4,0.42)', fog: '#1e3a22', ember: '#9dff5c', sky: '#050d07' },
    props: ['mushroom', 'tree', 'stump', 'rock', 'bones'], enemyTint: 'rgba(120,255,80,0.22)',
  },
  {
    id: 'void', name: 'The Void Rift', seed: 77, tier: 5, diff: 3.3, reward: 4.0,
    desc: 'Where the night was born. Reality frays and the horde is without end.',
    unlock: { stage: 'blight', time: 1200 },
    pal: { id: 'void', seed: 77, ground: '#22183c', groundDark: '#0d081c', groundLight: '#4a3580', rune: '#c084fc', propDark: '#140b28', propLight: '#4a3580', crystal: '#c084fc', ambient: 'rgba(6,0,18,0.46)', fog: '#2a1a4a', ember: '#c084fc', sky: '#080314', tiles: 96 },
    props: ['crystal', 'pillar', 'rock', 'bones', 'grave'], enemyTint: 'rgba(170,90,255,0.25)',
  },
];
export const STAGE_BY_ID: Record<string, StageDef> = {}; STAGES.forEach((s) => (STAGE_BY_ID[s.id] = s));

/* ---------- omens (difficulty pacts): each rank adds Heat; rewards scale with Heat ---------- */
export const OMENS: OmenDef[] = [
  { id: 'vigor', name: 'Omen of Vigor', icon: { g: 'heart', c: '#ff5c7a' }, max: 5, desc: 'Enemy health +20% per rank.', apply: (m, r) => { m.enemyHp *= 1 + 0.2 * r; } },
  { id: 'fury', name: 'Omen of Fury', icon: { g: 'flame', c: '#ff7043' }, max: 5, desc: 'Enemy damage +20% per rank.', apply: (m, r) => { m.enemyDmg *= 1 + 0.2 * r; } },
  { id: 'haste', name: 'Omen of Haste', icon: { g: 'boot', c: '#6ee7b7' }, max: 3, desc: 'Enemy speed +8% per rank.', apply: (m, r) => { m.enemySpeed *= 1 + 0.08 * r; } },
  { id: 'legion', name: 'Omen of Legions', icon: { g: 'skull', c: '#a78bfa' }, max: 5, desc: 'Enemy count +20% per rank.', apply: (m, r) => { m.spawn *= 1 + 0.2 * r; } },
  { id: 'elite', name: 'Omen of Champions', icon: { g: 'crown', c: '#facc15' }, max: 3, desc: 'Elites appear 30% more often per rank.', apply: (m, r) => { m.elite *= 1 + 0.3 * r; } },
  { id: 'famine', name: 'Omen of Famine', icon: { g: 'drop', c: '#94a3b8' }, max: 3, desc: 'Healing received -25% per rank.', apply: (m, r) => { m.healing *= 1 - 0.25 * r; } },
  { id: 'tyranny', name: 'Omen of Tyranny', icon: { g: 'lock', c: '#f87171' }, max: 3, desc: 'Bosses +50% HP and attack faster per rank.', apply: (m, r) => { m.bossHp *= 1 + 0.5 * r; m.bossRate *= 1 + 0.25 * r; } },
  { id: 'frailty', name: 'Omen of Frailty', icon: { g: 'ghost', c: '#c4b5fd' }, max: 3, desc: 'Your max health -10% per rank.', apply: (m, r) => { m.playerHp *= 1 - 0.1 * r; } },
  { id: 'eclipse', name: 'Omen of Eclipse', icon: { g: 'moon', c: '#c084fc' }, max: 2, desc: 'Difficulty accelerates: time runs 15% faster per rank for scaling.', apply: (m, r) => { m.timeScale *= 1 + 0.15 * r; } },
];
export const OMEN_BY_ID: Record<string, OmenDef> = {}; OMENS.forEach((o) => (OMEN_BY_ID[o.id] = o));
export const heatBonus = (heat: number): number => 1 + heat * 0.08;

export const MATERIALS: MaterialDef[] = [
  { id: 'iron', name: 'Iron Ore', color: '#b8c0cc', icon: { g: 'hex', c: '#b8c0cc' }, tier: 1 },
  { id: 'dust', name: 'Arcane Dust', color: '#a78bfa', icon: { g: 'star', c: '#a78bfa' }, tier: 2 },
  { id: 'crystal', name: 'Void Crystal', color: '#60a5fa', icon: { g: 'gem', c: '#60a5fa' }, tier: 3 },
  { id: 'star', name: 'Starshard', color: '#fde68a', icon: { g: 'shard', c: '#fde68a' }, tier: 4 },
];
export const MAT_BY_ID: Record<string, MaterialDef> = {}; MATERIALS.forEach((m) => (MAT_BY_ID[m.id] = m));
