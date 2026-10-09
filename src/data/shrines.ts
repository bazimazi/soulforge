/* SOULFORGE — map shrines: channel by standing inside; each offers a different bargain */
import type { IconSpec, ShrineKind } from '../game/types';

export interface ShrineDef { kind: ShrineKind; name: string; color: string; icon: IconSpec; weight: number; desc: string }

export const SHRINE_DEFS: Record<ShrineKind, ShrineDef> = {
  blood: { kind: 'blood', name: 'Altar of Blood', color: '#ef4444', icon: { g: 'drop', c: '#ef4444' }, weight: 3, desc: 'Pay a quarter of your health: one of your weapons gains a level.' },
  fortune: { kind: 'fortune', name: 'Shrine of Fortune', color: '#f5c542', icon: { g: 'chest', c: '#f5c542' }, weight: 2, desc: 'A treasure chest and a shower of gold.' },
  trial: { kind: 'trial', name: 'Soul Well', color: '#c084fc', icon: { g: 'spiral', c: '#c084fc' }, weight: 2, desc: 'Survive 25 seconds of a gathering surge for a chest, embers and dust.' },
  haste: { kind: 'haste', name: 'Shrine of Quickening', color: '#5eead4', icon: { g: 'boot', c: '#5eead4' }, weight: 2, desc: 'For 30s: move speed +25%, cooldowns -20%.' },
  life: { kind: 'life', name: 'Font of Life', color: '#4ade80', icon: { g: 'heart', c: '#4ade80' }, weight: 2, desc: 'Heal half your health and gain a shield.' },
  curse: { kind: 'curse', name: 'Cursed Idol', color: '#a78bfa', icon: { g: 'skull', c: '#a78bfa' }, weight: 1.5, desc: 'Curse +20% for the rest of the run (more enemies, more reward). Gain a level now.' },
};
export const SHRINE_KINDS = Object.keys(SHRINE_DEFS) as ShrineKind[];
/** Seconds of standing inside a shrine to activate it. */
export const SHRINE_CHANNEL = 1.6;
export const SHRINE_RADIUS = 56;
export const TRIAL_TIME = 25;
