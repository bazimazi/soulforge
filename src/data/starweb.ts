/* SOULFORGE — the Starweb: an account-wide constellation of passive nodes.
 *
 * Six constellations radiate from the Origin. A node can only be lit next to one already lit, so
 * every point is also a step along a path: the cheap road to a keystone runs through stats you may
 * not want, and the bridges between constellations let a build cut across. Points come from Soul
 * Rank and Champion Ascension (data/progression.ts); the whole web costs 84.
 *
 * Keystones change a rule and carry a price; notables add a mechanic; minor stars are small stats.
 * Mechanic flags are read by the simulation (`player.f`) — see game/game.ts.
 */
import type { IconSpec, StatBag } from '../game/types';
import { statFmt, statName } from './passives';

export type StarKind = 'origin' | 'minor' | 'notable' | 'keystone' | 'bridge';
export interface StarNode {
  id: string;
  name: string;
  kind: StarKind;
  /** Constellation index (0–5); bridges belong to the lower of the two they join. */
  sector: number;
  /** Layout position in web units (origin at 0,0; the rim sits near radius 6.5). */
  x: number;
  y: number;
  stats?: StatBag;
  flag?: string;
  desc: string;
  /** Neighbour ids (filled in symmetrically at load). */
  links: string[];
}
export interface Constellation { id: string; name: string; color: string; icon: IconSpec; theme: string }

export const CONSTELLATIONS: Constellation[] = [
  { id: 'smith', name: 'The Smith', color: '#ff7043', icon: { g: 'hammer', c: '#ff7043' }, theme: 'Might, crits and the killing blow' },
  { id: 'bulwark', name: 'The Bulwark', color: '#9fb2c8', icon: { g: 'shield', c: '#9fb2c8' }, theme: 'Health, armour and shields' },
  { id: 'wanderer', name: 'The Wanderer', color: '#6ee7b7', icon: { g: 'boot', c: '#6ee7b7' }, theme: 'Speed, reach and the dash' },
  { id: 'oracle', name: 'The Oracle', color: '#facc15', icon: { g: 'clover', c: '#facc15' }, theme: 'Luck, growth and fortune' },
  { id: 'tempest', name: 'The Tempest', color: '#7dd3fc', icon: { g: 'bolt', c: '#7dd3fc' }, theme: 'Elements, area and cooldowns' },
  { id: 'hollow', name: 'The Hollow Moon', color: '#c084fc', icon: { g: 'moon', c: '#c084fc' }, theme: 'Shades, curses and stolen life' },
];

/** Respec cost per lit star (gold). */
export const STARWEB_RESPEC_GOLD = 150;

interface Spec { id: string; name: string; kind: StarKind; r: number; da: number; stats?: StatBag; flag?: string; desc?: string; to: string[] }
/** Per-constellation node specs: polar position (`r`, degrees `da` off the constellation's axis) and links inward. */
type SectorSpec = Spec[];

const m = (id: string, name: string, r: number, da: number, stats: StatBag, to: string[]): Spec => ({ id, name, kind: 'minor', r, da, stats, to });
const n = (id: string, name: string, r: number, da: number, desc: string, to: string[], flag?: string, stats?: StatBag): Spec => ({ id, name, kind: 'notable', r, da, desc, to, flag, stats });
const k = (id: string, name: string, r: number, desc: string, to: string[], flag: string, stats?: StatBag): Spec => ({ id, name, kind: 'keystone', r, da: 0, desc, to, flag, stats });

/** One constellation: X1 → X2a/X2b → X3 → X4a/X4b (+ X4c/X4d) → X5 (+ X5a/X5b) → X6. */
function sector(p: string, nodes: { s1: [string, StatBag]; s2a: [string, StatBag]; s2b: [string, StatBag]; n3: [string, string, string?, StatBag?]; s4a: [string, StatBag]; s4b: [string, StatBag]; s4c: [string, StatBag]; s4d: [string, StatBag]; n5: [string, string, string?, StatBag?]; s5a: [string, StatBag]; s5b: [string, StatBag]; k6: [string, string, string, StatBag?] }): SectorSpec {
  const o = nodes;
  return [
    m(p + '1', o.s1[0], 1.25, 0, o.s1[1], ['origin']),
    m(p + '2a', o.s2a[0], 2.2, -13, o.s2a[1], [p + '1']),
    m(p + '2b', o.s2b[0], 2.2, 13, o.s2b[1], [p + '1']),
    n(p + '3', o.n3[0], 3.15, 0, o.n3[1], [p + '2a', p + '2b'], o.n3[2], o.n3[3]),
    m(p + '4a', o.s4a[0], 4.05, -9, o.s4a[1], [p + '3']),
    m(p + '4b', o.s4b[0], 4.05, 9, o.s4b[1], [p + '3']),
    m(p + '4c', o.s4c[0], 4.35, -21, o.s4c[1], [p + '4a']),
    m(p + '4d', o.s4d[0], 4.35, 21, o.s4d[1], [p + '4b']),
    n(p + '5', o.n5[0], 5.05, 0, o.n5[1], [p + '4a', p + '4b'], o.n5[2], o.n5[3]),
    m(p + '5a', o.s5a[0], 5.75, -12, o.s5a[1], [p + '5']),
    m(p + '5b', o.s5b[0], 5.75, 12, o.s5b[1], [p + '5']),
    k(p + '6', o.k6[0], 6.45, o.k6[1], [p + '5'], o.k6[2], o.k6[3]),
  ];
}

const SECTORS: SectorSpec[] = [
  sector('S', {
    s1: ['Ember of Wrath', { might: 0.03 }],
    s2a: ['Keen Eye', { crit: 0.02 }], s2b: ['Heavy Hand', { critDmg: 0.08 }],
    n3: ['Tempered Fury', 'Might +5%, damage to elites and Heralds +10%.', undefined, { might: 0.05, eliteDmg: 0.1 }],
    s4a: ['Forgefire', { might: 0.03 }], s4b: ['Signature Edge', { sigDmg: 0.08 }], s4c: ['Cruel Blow', { critDmg: 0.1 }], s4d: ['Giantbane', { eliteDmg: 0.08 }],
    n5: ['Bloodletter', 'Critical hits make enemies bleed. Crit chance +3%.', 'sw_bleed', { crit: 0.03 }],
    s5a: ['Molten Core', { might: 0.04 }], s5b: ['Hawk Sight', { crit: 0.03 }],
    k6: ['Avatar of Ruin', 'Overkill: the damage a killing blow had left over strikes the nearest enemy within 160px. Max Health -10%.', 'ks_ruin', { maxHpPct: -0.1 }],
  }),
  sector('B', {
    s1: ['Stout Heart', { maxHp: 10 }],
    s2a: ['Riveted', { armor: 0.5 }], s2b: ['Slow Pulse', { regen: 0.2 }],
    n3: ['Iron Hide', 'Max Health +8%, Armor +1.', undefined, { maxHpPct: 0.08, armor: 1 }],
    s4a: ['Broad Back', { maxHp: 15 }], s4b: ['Mending Light', { healing: 0.08 }], s4c: ['Warded', { shieldPower: 0.1 }], s4d: ['Spiked Pauldron', { thorns: 0.2 }],
    n5: ['Living Fortress', 'After 4s without taking damage, regain a shield of 2% of max health every second.', 'sw_fortress'],
    s5a: ['Plated', { armor: 1 }], s5b: ['Giant\'s Blood', { maxHpPct: 0.05 }],
    k6: ['Unbreakable Will', 'Every point of Armor also reduces damage taken by 1.5% (up to 45%). Move speed -8%.', 'ks_will', { speed: -0.08 }],
  }),
  sector('W', {
    s1: ['Light Step', { speed: 0.03 }],
    s2a: ['Lodestar', { magnet: 0.15 }], s2b: ['Sidestep', { dodge: 0.015 }],
    n3: ['Fleetfoot', 'Dash cooldown -25%.', 'sw_fleet'],
    s4a: ['Long Stride', { speed: 0.03 }], s4b: ['Lingering', { duration: 0.05 }], s4c: ['Swift Arrows', { projSpeed: 0.08 }], s4d: ['Shadowed', { dodge: 0.02 }],
    n5: ['Battle Trance', 'For 3s after you dash, Might +20%.', 'sw_trance'],
    s5a: ['Far Reach', { magnet: 0.25 }], s5b: ['Windborne', { speed: 0.04 }],
    k6: ['Phantom Step', 'Your dash gains a second charge and leaves an afterimage that explodes. Ability cooldown +15%.', 'ks_phantom', { activeCd: -0.15 }],
  }),
  sector('O', {
    s1: ['Quick Study', { growth: 0.04 }],
    s2a: ['Fortunate', { luck: 0.05 }], s2b: ['Gilded Palm', { greed: 0.08 }],
    n3: ['Overflowing Satchel', 'Passives can rise three levels past their maximum (Overflow; each extra level is worth 60%).', 'sw_overflow'],
    s4a: ['Prodigy', { growth: 0.05 }], s4b: ['Second Thoughts', { rerolls: 1 }], s4c: ['Treasure Sense', { chestLuck: 0.1 }], s4d: ['Prospector', { matFind: 0.1 }],
    n5: ['Fated', 'Level-up cards are Empowered three times as often. +1 Banish.', 'sw_fated', { banishes: 1 }],
    s5a: ['Charmed', { luck: 0.06 }], s5b: ['Veteran\'s Lore', { xpBonus: 0.1 }],
    k6: ['Gambler\'s Oath', 'Chests always hold at least three treasures and one level-up card in four is Empowered — but you have no Rerolls, Skips or Banishes.', 'ks_gamble'],
  }),
  sector('T', {
    s1: ['Widening Gyre', { area: 0.03 }],
    s2a: ['Volatile', { reactDmg: 0.15 }], s2b: ['Kindling', { burnDmg: 0.1 }],
    n3: ['Static Field', 'Every 5s, every enemy within 220px is Shocked.', 'sw_static'],
    s4a: ['Quickened', { cooldown: 0.02 }], s4b: ['Hoarfrost', { slowPower: 0.1 }], s4c: ['Vast', { area: 0.04 }], s4d: ['Unstable', { reactDmg: 0.2 }],
    n5: ['Catalyst', 'Reactions recharge 30% faster and deal +25% damage.', 'sw_catalyst', { reactDmg: 0.25 }],
    s5a: ['Rapid Casting', { cooldown: 0.02 }], s5b: ['Enduring Spells', { duration: 0.06 }],
    k6: ['Primordial Conduit', 'Weapon hits have a 12% chance to apply a random element. Reactions deal +50% damage. Crit damage -20%.', 'ks_conduit', { reactDmg: 0.5, critDmg: -0.2 }],
  }),
  sector('H', {
    s1: ['Grave Whisper', { minionDmg: 0.08 }],
    s2a: ['Leech', { lifesteal: 0.003 }], s2b: ['Ill Omen', { curse: 0.05 }],
    n3: ['Gravecaller', 'Kills have a 3% chance to raise a hunting shade.', 'sw_shades'],
    s4a: ['Bone Choir', { minionDmg: 0.1 }], s4b: ['Culling Edge', { cull: 0.02 }], s4c: ['Thirst', { lifesteal: 0.004 }], s4d: ['Darker Night', { curse: 0.06 }],
    n5: ['Soul Siphon', 'Slaying an elite or Herald heals 5% of your max health. Minion damage +10%.', 'sw_siphon', { minionDmg: 0.1 }],
    s5a: ['Reaper\'s Due', { cull: 0.02 }], s5b: ['Legion', { minionDmg: 0.12 }],
    k6: ['Lord of the Hollow', 'Shades rise from 8% of kills (up to 14) and burst as they fade. Minion damage +40%. Max Health -15%.', 'ks_hollow', { minionDmg: 0.4, maxHpPct: -0.15 }],
  }),
];

/** Bridges between constellation `i` and `i + 1`: an inner one (joins the two `3` notables) and an outer notable (joins the `5`s). */
const BRIDGES: { inner: [string, StatBag]; outer: [string, string, string?, StatBag?] }[] = [
  { inner: ['Warden\'s Edge', { might: 0.02, armor: 0.5 }], outer: ['Juggernaut', 'Might +1% per point of Armor (up to +20%).', 'sw_jugg'] },
  { inner: ['Steadfast Stride', { maxHp: 8, speed: 0.02 }], outer: ['Second Breath', 'Dashing heals 2% of your max health.', 'sw_breath'] },
  { inner: ['Pathfinder', { magnet: 0.1, growth: 0.03 }], outer: ['Treasure Hunter', 'Every chest also yields a Soul Ember. Gold +10%.', 'sw_hunter', { greed: 0.1 }] },
  { inner: ['Omen-Reader', { luck: 0.04, reactDmg: 0.1 }], outer: ['Arcane Insight', '+1 Reroll. Experience +10%.', undefined, { rerolls: 1, growth: 0.1 }] },
  { inner: ['Storm-Shade', { area: 0.03, minionDmg: 0.06 }], outer: ['Eclipse Tide', 'During a Blood Moon and after the Eclipse, Might +25%.', 'sw_tide'] },
  { inner: ['Red Hunger', { lifesteal: 0.003, might: 0.02 }], outer: ['Executioner', 'Cull +4%: non-boss enemies struck below 4% health die. Elite damage +8%.', undefined, { cull: 0.04, eliteDmg: 0.08 }] },
];

const PREFIX = ['S', 'B', 'W', 'O', 'T', 'H'];
const DEG = Math.PI / 180;
/** Axis angle of constellation `i` (top first, clockwise). */
export const sectorAngle = (i: number): number => (-90 + i * 60) * DEG;

export const STARWEB: StarNode[] = [];
export const STAR_BY_ID: Record<string, StarNode> = {};

function build(): void {
  const add = (node: StarNode): void => { STARWEB.push(node); STAR_BY_ID[node.id] = node; };
  const fmtStats = (st?: StatBag): string => (st ? Object.keys(st).map((key) => statName(key) + ' ' + statFmt(key, st[key]!)).join(', ') : '');
  add({ id: 'origin', name: 'The Origin', kind: 'origin', sector: -1, x: 0, y: 0, desc: 'The first light. Always lit.', links: [] });
  const pending: [string, string][] = [];
  SECTORS.forEach((specs, i) => {
    const axis = sectorAngle(i);
    for (const sp of specs) {
      const a = axis + sp.da * DEG;
      add({ id: sp.id, name: sp.name, kind: sp.kind, sector: i, x: Math.cos(a) * sp.r, y: Math.sin(a) * sp.r, stats: sp.stats, flag: sp.flag, desc: sp.desc ?? fmtStats(sp.stats), links: [] });
      for (const t of sp.to) pending.push([sp.id, t]);
    }
  });
  BRIDGES.forEach((b, i) => {
    const j = (i + 1) % 6, a = sectorAngle(i) + 30 * DEG;
    const inner = 'X' + PREFIX[i] + PREFIX[j], outer = 'Y' + PREFIX[i] + PREFIX[j];
    add({ id: inner, name: b.inner[0], kind: 'bridge', sector: i, x: Math.cos(a) * 3.45, y: Math.sin(a) * 3.45, stats: b.inner[1], desc: fmtStats(b.inner[1]), links: [] });
    add({ id: outer, name: b.outer[0], kind: 'notable', sector: i, x: Math.cos(a) * 5.5, y: Math.sin(a) * 5.5, flag: b.outer[2], stats: b.outer[3], desc: b.outer[1], links: [] });
    pending.push([inner, PREFIX[i] + '3'], [inner, PREFIX[j] + '3'], [outer, PREFIX[i] + '5'], [outer, PREFIX[j] + '5']);
  });
  for (const [a, b] of pending) {
    const A = STAR_BY_ID[a], B = STAR_BY_ID[b];
    if (!A || !B) throw new Error('Starweb: bad link ' + a + ' → ' + b);
    if (!A.links.includes(b)) A.links.push(b);
    if (!B.links.includes(a)) B.links.push(a);
  }
}
build();

/** Total points needed to light the whole web (the origin is free). */
export const STARWEB_SIZE = STARWEB.length - 1;

/** Can `id` be lit given the lit set? (It must touch a lit star.) */
export function starReachable(id: string, lit: Record<string, boolean>): boolean {
  const node = STAR_BY_ID[id];
  if (!node || node.kind === 'origin') return false;
  return node.links.some((l) => l === 'origin' || lit[l]);
}

/**
 * Stars that stay connected to the origin when `without` is unlit. Used to refuse unlighting a star
 * other lit stars depend on.
 */
export function starConnected(lit: Record<string, boolean>, without?: string): Set<string> {
  const seen = new Set<string>(['origin']), stack = ['origin'];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const l of STAR_BY_ID[cur]!.links) if (l !== without && lit[l] && !seen.has(l)) { seen.add(l); stack.push(l); }
  }
  return seen;
}
