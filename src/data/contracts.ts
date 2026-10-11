/* SOULFORGE — Night Contracts: three daily bounties and one weekly Grand Contract.
 *
 * Contracts are rolled from the calendar (UTC day / week number) with their own seeded RNG, so a
 * day's contracts are the same however often the game is opened, and the roll never touches the
 * simulation's randomness. Targets grow with Soul Rank. Progress comes from run summaries: some
 * contracts add up across runs (kills, reactions…), others ask for one run (survive, streak…).
 */
import { Rng } from '../core/rng';
import type { RunSummary } from '../game/types';
import { ENEMIES } from './enemies';
import type { Reward } from './forge';
import { STAGE_BY_ID } from './passives';

export type ContractKind = 'kills' | 'enemy' | 'bosses' | 'elites' | 'reactions' | 'shrines' | 'evolves' | 'gold' | 'charTime' | 'stageTime' | 'combo' | 'level' | 'torment';
export interface Contract {
  id: string;
  kind: ContractKind;
  /** Enemy type, champion id, stage id, or the Torment tier (as text). */
  ref?: string;
  target: number;
  progress: number;
  claimed: boolean;
  reward: Reward;
}
/** What the generator may draw on: who and where the player can actually play. */
export interface ContractContext {
  rank: number;
  chars: string[];
  stages: string[];
  /** Highest Torment tier unlocked anywhere (0 = none). */
  torment: number;
  /** Champion display names (for text). */
  charNames?: Record<string, string>;
}

export const DAY_MS = 86400000;
export const dayNumber = (ms: number): number => Math.floor(ms / DAY_MS);
/** Weeks start on Monday (UTC). 1970-01-01 was a Thursday, so shift by three days. */
export const weekNumber = (ms: number): number => Math.floor((dayNumber(ms) + 3) / 7);
/** Bonus for claiming all three daily contracts. */
export const DAILY_BONUS: Reward = { embers: 15, star: 1 };
/** Free rerolls of one daily contract per day. */
export const DAILY_REROLLS = 1;

/** Enemy types a contract can name (all appear by the mid-game). */
const HUNT: [string, number][] = [['skeleton', 300], ['imp', 150], ['wraith', 200], ['spider', 200], ['charger', 80], ['bomber', 100], ['brute', 60], ['banshee', 50], ['bastion', 40], ['burrower', 60]];

const round = (v: number, step: number): number => Math.max(step, Math.round(v / step) * step);
const scale = (rank: number): number => 1 + Math.min(4, rank / 12);

interface Template { kind: ContractKind; w: number; ok?: (c: ContractContext) => boolean; make(rng: Rng, c: ContractContext, s: number, weekly: boolean): Omit<Contract, 'id' | 'progress' | 'claimed'> }
const TEMPLATES: Template[] = [
  { kind: 'kills', w: 3, make: (_r, _c, s, wk) => ({ kind: 'kills', target: round(2500 * s * (wk ? 9 : 1), 100), reward: wk ? { star: 3, eclipse: 1, embers: 40 } : { embers: 8, gold: Math.round(600 * s) } }) },
  { kind: 'enemy', w: 3, make: (r, _c, s, wk) => { const [id, n] = r.pick(HUNT); return { kind: 'enemy', ref: id, target: round(n * s * (wk ? 8 : 1), 10), reward: wk ? { star: 2, eclipse: 1, embers: 30 } : { embers: 6, dust: 4 } }; } },
  { kind: 'bosses', w: 2, make: (_r, _c, s, wk) => ({ kind: 'bosses', target: Math.ceil(2 * s) * (wk ? 6 : 1), reward: wk ? { star: 3, eclipse: 2, embers: 40 } : { embers: 10, crystal: 2 } }) },
  { kind: 'elites', w: 2, make: (_r, _c, s, wk) => ({ kind: 'elites', target: round(15 * s * (wk ? 8 : 1), 5), reward: wk ? { star: 2, crystal: 10, embers: 30 } : { embers: 8, iron: 20 } }) },
  { kind: 'reactions', w: 2, make: (_r, _c, s, wk) => ({ kind: 'reactions', target: round(120 * s * (wk ? 8 : 1), 10), reward: wk ? { star: 2, eclipse: 1, embers: 30 } : { embers: 6, dust: 6 } }) },
  { kind: 'shrines', w: 1.5, make: (_r, _c, _s, wk) => ({ kind: 'shrines', target: wk ? 40 : 6, reward: wk ? { star: 2, embers: 30 } : { embers: 6, gold: 500 } }) },
  { kind: 'evolves', w: 1.5, make: (_r, _c, _s, wk) => ({ kind: 'evolves', target: wk ? 20 : 3, reward: wk ? { star: 3, embers: 30 } : { embers: 8, crystal: 1 } }) },
  { kind: 'gold', w: 1.5, make: (_r, _c, s, wk) => ({ kind: 'gold', target: round(1500 * s * (wk ? 8 : 1), 100), reward: wk ? { star: 2, embers: 30 } : { embers: 5, iron: 30 } }) },
  { kind: 'charTime', w: 2, ok: (c) => c.chars.length > 0, make: (r, c, _s, wk) => ({ kind: 'charTime', ref: r.pick(c.chars), target: wk ? 1500 : 600, reward: wk ? { star: 3, eclipse: 1, embers: 40 } : { embers: 10, star: 1 } }) },
  { kind: 'stageTime', w: 2, ok: (c) => c.stages.length > 0, make: (r, c, _s, wk) => ({ kind: 'stageTime', ref: r.pick(c.stages), target: wk ? 1500 : 720, reward: wk ? { star: 3, eclipse: 1, embers: 40 } : { embers: 10, crystal: 2 } }) },
  { kind: 'combo', w: 1.5, make: (_r, _c, s, wk) => ({ kind: 'combo', target: round(150 * s * (wk ? 3 : 1), 25), reward: wk ? { star: 2, embers: 30 } : { embers: 6, dust: 4 } }) },
  { kind: 'level', w: 1.5, make: (_r, _c, s, wk) => ({ kind: 'level', target: Math.min(150, 40 + Math.ceil(s) * 10 + (wk ? 40 : 0)), reward: wk ? { star: 2, embers: 30 } : { embers: 6, iron: 15 } }) },
  { kind: 'torment', w: 1.5, ok: (c) => c.torment > 0, make: (r, c, _s, wk) => ({ kind: 'torment', ref: String(wk ? c.torment : r.int(1, c.torment)), target: 1, reward: wk ? { eclipse: 4, star: 3, embers: 40 } : { eclipse: 1, embers: 10 } }) },
];

function draw(rng: Rng, ctx: ContractContext, n: number, weekly: boolean, prefix: string, avoid: ContractKind[] = []): Contract[] {
  const pool = TEMPLATES.filter((t) => (!t.ok || t.ok(ctx)) && !avoid.includes(t.kind));
  const out: Contract[] = [], s = scale(ctx.rank);
  while (out.length < n && pool.length) {
    let tot = 0; for (const t of pool) tot += t.w;
    let x = rng.next() * tot, i = 0;
    for (; i < pool.length - 1; i++) { x -= pool[i]!.w; if (x <= 0) break; }
    const t = pool.splice(i, 1)[0]!;
    out.push({ id: prefix + out.length, progress: 0, claimed: false, ...t.make(rng, ctx, s, weekly) });
  }
  return out;
}

/** The three daily contracts for UTC day `day` (`salt` rerolls one slot). */
export function genDaily(day: number, ctx: ContractContext, salt = 0): Contract[] {
  return draw(new Rng((day * 2654435761 + salt * 97) >>> 0), ctx, 3, false, 'd' + day + '_' + salt + '_');
}
/** A single replacement contract for a reroll (never repeats the kinds already offered). */
export function genReplacement(day: number, ctx: ContractContext, salt: number, avoid: ContractKind[]): Contract | null {
  return draw(new Rng((day * 2654435761 + salt * 7919 + 13) >>> 0), ctx, 1, false, 'r' + day + '_' + salt + '_', avoid)[0] ?? null;
}
/** The weekly Grand Contract for week `week`. */
export function genWeekly(week: number, ctx: ContractContext): Contract {
  return draw(new Rng((week * 40503 + 11) >>> 0), ctx, 1, true, 'w' + week + '_')[0]!;
}

/** Fold one finished run into a contract's progress. Returns true if it just completed. */
export function applyRun(c: Contract, r: RunSummary): boolean {
  if (c.claimed) return false;
  const before = c.progress >= c.target;
  switch (c.kind) {
    case 'kills': c.progress += r.kills; break;
    case 'enemy': c.progress += r.enemyKills[c.ref!] || 0; break;
    case 'bosses': c.progress += r.bossKills; break;
    case 'elites': c.progress += r.elites; break;
    case 'reactions': c.progress += r.reactions; break;
    case 'shrines': c.progress += r.shrines; break;
    case 'evolves': c.progress += r.evolves; break;
    case 'gold': c.progress += r.gold; break;
    case 'charTime': if (r.charId === c.ref) c.progress = Math.max(c.progress, Math.floor(r.time)); break;
    case 'stageTime': if (r.stageId === c.ref) c.progress = Math.max(c.progress, Math.floor(r.time)); break;
    case 'combo': c.progress = Math.max(c.progress, r.bestCombo); break;
    case 'level': c.progress = Math.max(c.progress, r.level); break;
    case 'torment': if ((r.torment || 0) >= Number(c.ref) && r.time >= 900) c.progress = 1; break;
  }
  c.progress = Math.min(c.progress, c.target);
  return !before && c.progress >= c.target;
}

const mmss = (s: number): string => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
const n = (v: number): string => v.toLocaleString('en-US');

export function contractText(c: Contract, ctx?: Pick<ContractContext, 'charNames'>): string {
  switch (c.kind) {
    case 'kills': return `Slay ${n(c.target)} enemies`;
    case 'enemy': return `Slay ${n(c.target)} ${(ENEMIES[c.ref!]?.name ?? c.ref) + (c.target === 1 ? '' : 's')}`;
    case 'bosses': return `Defeat ${c.target} Herald${c.target === 1 ? '' : 's'}`;
    case 'elites': return `Slay ${n(c.target)} elites`;
    case 'reactions': return `Trigger ${n(c.target)} elemental reactions`;
    case 'shrines': return `Channel ${c.target} shrines`;
    case 'evolves': return `Evolve ${c.target} weapons`;
    case 'gold': return `Bring home ${n(c.target)} gold`;
    case 'charTime': return `Survive ${mmss(c.target)} with ${ctx?.charNames?.[c.ref!] ?? c.ref}`;
    case 'stageTime': return `Survive ${mmss(c.target)} in ${STAGE_BY_ID[c.ref!]?.name ?? c.ref}`;
    case 'combo': return `Reach a kill streak of ${n(c.target)}`;
    case 'level': return `Reach level ${c.target} in a single run`;
    case 'torment': return `Survive 15:00 at Torment ${c.ref} or higher`;
  }
}
/** Progress as display text ("1,240 / 2,500", "7:12 / 10:00", "done"). */
export function contractProgressText(c: Contract): string {
  if (c.kind === 'torment') return c.progress >= 1 ? 'done' : 'not yet';
  if (c.kind === 'charTime' || c.kind === 'stageTime') return mmss(c.progress) + ' / ' + mmss(c.target);
  return n(Math.floor(c.progress)) + ' / ' + n(c.target);
}
