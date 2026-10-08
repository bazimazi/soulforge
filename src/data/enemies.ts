/* SOULFORGE — enemy roster, bosses, spawn schedule, difficulty scaling */
import type { BossDef, Difficulty, DifficultyMods, EnemyDef, ScriptedEvent } from '../game/types';

export interface SpawnRow {
  at: number;
  types: Record<string, number>;
}
export type TimedEvent = ScriptedEvent & { at: number };

export const ENEMIES: Record<string, EnemyDef> = {
  bat: { name: 'Dusk Bat', hp: 7, speed: 118, dmg: 6, xp: 1, r: 10, mass: 0.5, col: { body: '#4c3b6e', eye: '#f0abfc' }, move: 'flutter', lore: 'Small, fast, and never alone. They are the night’s first greeting.' },
  ghoul: { name: 'Ghoul', hp: 16, speed: 72, dmg: 9, xp: 1, r: 14, mass: 1, col: { body: '#5f7a4a', eye: '#fef08a' }, lore: 'What is left of the villagers. They remember hunger and nothing else.' },
  skeleton: { name: 'Bone Walker', hp: 26, speed: 82, dmg: 11, xp: 2, r: 14, mass: 1, col: { body: '#d6cfc0', eye: '#7dd3fc' }, lore: 'Old soldiers who never received their discharge. They march because they were told to.' },
  slime: { name: 'Blight Slime', hp: 34, speed: 58, dmg: 10, xp: 2, r: 17, mass: 1.5, col: { body: '#65a30d', eye: '#fef9c3' }, split: { type: 'slimelet', n: 3 }, lore: 'It splits when struck. Each piece is just as hungry.' },
  slimelet: { name: 'Slimelet', hp: 9, speed: 96, dmg: 5, xp: 1, r: 9, mass: 0.5, col: { body: '#84cc16', eye: '#fef9c3' }, noSpawn: true, lore: 'A fragment of blight. Annoying in the way a wasp is annoying.' },
  imp: { name: 'Cinder Imp', hp: 28, speed: 78, dmg: 8, xp: 3, r: 13, mass: 0.8, col: { body: '#b91c1c', eye: '#fde047' }, ranged: { cd: 3.2, speed: 205, dmg: 12, range: 400, keep: 260 }, lore: 'Cowardly casters that keep their distance and throw fire from it.' },
  wraith: { name: 'Wraith', hp: 38, speed: 108, dmg: 13, xp: 3, r: 15, mass: 0.7, col: { body: '#6366f1', eye: '#e0e7ff' }, move: 'wave', lore: 'Grief given shape. It drifts, and where it drifts the air goes cold.' },
  spider: { name: 'Crypt Spider', hp: 22, speed: 152, dmg: 9, xp: 2, r: 12, mass: 0.8, col: { body: '#3f3f46', eye: '#f87171', accent: '#ef4444' }, lore: 'Fast. Too fast. Do not let them close.' },
  charger: { name: 'Bone Boar', hp: 70, speed: 68, dmg: 20, xp: 4, r: 18, mass: 3, col: { body: '#7c5a3a', eye: '#fbbf24' }, charge: { cd: 3.6, speed: 460, dur: 0.6, windup: 0.5 }, lore: 'It lowers its head. Then it is somewhere else, and so are your ribs.' },
  bomber: { name: 'Ash Bomber', hp: 32, speed: 100, dmg: 30, xp: 3, r: 13, mass: 0.8, col: { body: '#f97316', eye: '#fef3c7' }, explode: { r: 80 }, lore: 'A walking ember with a grudge. Keep it at arm’s length — several arms.' },
  brute: { name: 'Grave Brute', hp: 200, speed: 60, dmg: 24, xp: 8, r: 26, mass: 5, col: { body: '#4b5563', eye: '#f87171' }, lore: 'Three corpses stitched into one purpose. It does not stop when pushed.' },
  shaman: { name: 'Bone Shaman', hp: 90, speed: 64, dmg: 10, xp: 6, r: 16, mass: 1, col: { body: '#5b21b6', eye: '#a3e635', accent: '#f0abfc' }, heal: { cd: 3.5, r: 170, pct: 0.15 }, lore: 'It chants, and the dead around it knit back together. Kill it first.' },
  watcher: { name: 'Watcher', hp: 60, speed: 84, dmg: 10, xp: 5, r: 15, mass: 0.8, col: { body: '#831843', eye: '#22d3ee' }, ring: { cd: 4.5, n: 8, speed: 180, dmg: 12, range: 420, keep: 300 }, move: 'flutter', lore: 'An eye without a body, weeping bolts of light in every direction.' },
  golem: { name: 'Ash Golem', hp: 700, speed: 44, dmg: 38, xp: 22, r: 34, mass: 12, col: { body: '#57534e', eye: '#fb923c' }, lore: 'The night made it from the rubble of a city. It remembers the shape of streets.' },
};

export const BOSSES: Record<string, BossDef> = {
  bone_colossus: { name: 'Bone Colossus', hp: 3200, speed: 72, dmg: 32, xp: 200, r: 48, mass: 40, col: { body: '#e7e0d0', eye: '#7dd3fc' }, attacks: ['charge', 'ring', 'summon'], lore: 'A king’s skeleton wearing his army’s bones as armor.' },
  blood_matriarch: { name: 'Blood Matriarch', hp: 7000, speed: 90, dmg: 36, xp: 400, r: 46, mass: 40, col: { body: '#450a0a', eye: '#f87171', accent: '#ef4444' }, attacks: ['spiral', 'summon', 'dash'], summon: 'spider', lore: 'Mother of every spider in the crypt. She is very protective.' },
  frost_wyrm: { name: 'Frost Wyrm', hp: 13000, speed: 80, dmg: 42, xp: 700, r: 52, mass: 50, col: { body: '#0e7490', eye: '#bae6fd' }, attacks: ['volley', 'slam', 'ring', 'dash'], lore: 'It breathes winter. Where it lands, nothing thaws.' },
  void_leviathan: { name: 'Void Leviathan', hp: 24000, speed: 64, dmg: 48, xp: 1200, r: 58, mass: 60, col: { body: '#3b0764', eye: '#e879f9' }, attacks: ['spiral', 'pull', 'ring', 'summon'], summon: 'wraith', lore: 'A piece of the rift, made flesh so it could hunt.' },
  infernal_titan: { name: 'Infernal Titan', hp: 40000, speed: 70, dmg: 56, xp: 2000, r: 62, mass: 80, col: { body: '#7f1d1d', eye: '#fde047', accent: '#ff6a00' }, attacks: ['slam', 'charge', 'volley', 'summon'], summon: 'bomber', lore: 'The night’s general. It burns because it wants to.' },
};
export const BOSS_ORDER: string[] = ['bone_colossus', 'blood_matriarch', 'frost_wyrm', 'void_leviathan', 'infernal_titan'];

/* which enemy types are present at a given minute, with spawn weights */
export const SPAWN_TABLE: SpawnRow[] = [
  { at: 0, types: { bat: 5, ghoul: 4 } },
  { at: 1, types: { bat: 4, ghoul: 5, skeleton: 3 } },
  { at: 2, types: { bat: 3, ghoul: 4, skeleton: 4, slime: 2 } },
  { at: 3.5, types: { bat: 3, ghoul: 3, skeleton: 4, slime: 3, imp: 1.5 } },
  { at: 5, types: { ghoul: 3, skeleton: 4, slime: 3, imp: 2, wraith: 3 } },
  { at: 6.5, types: { ghoul: 2, skeleton: 4, slime: 3, imp: 2, wraith: 3, spider: 3, charger: 1 } },
  { at: 8.5, types: { skeleton: 3, slime: 2, imp: 2, wraith: 3, spider: 4, charger: 2, bomber: 2 } },
  { at: 11, types: { skeleton: 3, imp: 2, wraith: 3, spider: 3, charger: 2, bomber: 2, brute: 2, watcher: 1 } },
  { at: 13.5, types: { skeleton: 2, imp: 2, wraith: 3, spider: 3, charger: 2, bomber: 2, brute: 3, shaman: 2, watcher: 1.5 } },
  { at: 16, types: { imp: 2, wraith: 3, spider: 3, charger: 3, bomber: 3, brute: 3, shaman: 2, watcher: 1.5, golem: 1 } },
  { at: 20, types: { bat: 2, wraith: 3, spider: 4, charger: 3, bomber: 3, brute: 4, shaman: 3, watcher: 3, golem: 2 } },
  { at: 25, types: { wraith: 3, spider: 4, charger: 4, bomber: 4, brute: 4, shaman: 3, watcher: 3, golem: 3, slime: 2 } },
  { at: 30, types: { spider: 4, charger: 4, bomber: 4, brute: 5, shaman: 4, watcher: 4, golem: 4, wraith: 3 } },
];

/* scripted events */
export const EVENTS: TimedEvent[] = [
  { at: 90, type: 'swarm', enemy: 'bat', n: 40 },
  { at: 225, type: 'ring', enemy: 'ghoul', n: 32 },
  { at: 300, type: 'boss', boss: 'bone_colossus' },
  { at: 390, type: 'swarm', enemy: 'spider', n: 40 },
  { at: 480, type: 'ring', enemy: 'skeleton', n: 60 },
  { at: 600, type: 'boss', boss: 'blood_matriarch' },
  { at: 690, type: 'swarm', enemy: 'bat', n: 80 },
  { at: 780, type: 'ring', enemy: 'wraith', n: 50 },
  { at: 900, type: 'boss', boss: 'frost_wyrm' },
  { at: 990, type: 'swarm', enemy: 'bomber', n: 30 },
  { at: 1080, type: 'ring', enemy: 'brute', n: 30 },
  { at: 1200, type: 'boss', boss: 'void_leviathan' },
  { at: 1290, type: 'swarm', enemy: 'spider', n: 90 },
  { at: 1380, type: 'ring', enemy: 'golem', n: 16 },
  { at: 1500, type: 'boss', boss: 'infernal_titan' },
];

/* Difficulty curves — deliberately steep; meta-progression is what lets you push deeper */
export const difficulty = function (tSec: number, mods: DifficultyMods): Difficulty {
  const m = (tSec / 60) * (mods.timeScale || 1);
  const late = m > 30 ? Math.pow(1.12, m - 30) : 1;
  return {
    hp: (1 + 0.28 * m + 0.034 * m * m) * late * mods.enemyHp,
    dmg: (1 + 0.055 * m + 0.0022 * m * m) * (m > 30 ? Math.pow(1.06, m - 30) : 1) * mods.enemyDmg,
    speed: (1 + Math.min(0.32, m * 0.011)) * mods.enemySpeed,
    count: Math.min(520, (20 + m * 12) * (m > 30 ? 1.2 : 1)) * mods.spawn,
    xp: 1 + m * 0.06,
    gold: 1 + m * 0.05,
    tier: m < 12 ? 0 : m < 24 ? 1 : m < 36 ? 2 : 3,
    minute: m,
  };
};

export const xpForLevel = (L: number): number => Math.floor(6 + (L - 1) * 9 + Math.pow(L, 1.85) * 0.55);
