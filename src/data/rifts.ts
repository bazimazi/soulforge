import type { IconSpec, StatBag } from '../game/types';

export type RiftKind = 'ward' | 'hunt' | 'relay';
export const RIFT_DEFS = {
  ward: { name: 'The Last Light', subtitle: 'Hold the sanctuary', desc: 'Stay inside the circle for 18 seconds. Progress drains slowly outside it.', color: '#5eead4', duration: 55 },
  hunt: { name: 'Marked for Death', subtitle: 'Hunt the oathbreakers', desc: 'Defeat three marked elites before the rift closes. Follow their diamond markers.', color: '#fb7185', duration: 65 },
  relay: { name: 'A Trail of Embers', subtitle: 'Rekindle the beacons', desc: 'Visit three beacons. Stand in each small circle to kindle it while the horde closes in.', color: '#fbbf24', duration: 70 },
} as const;

export interface RiftRelic {
  id: string;
  name: string;
  icon: IconSpec;
  desc: string;
  flavor: string;
  stats?: StatBag;
}

export const RIFT_RELICS: readonly RiftRelic[] = [
  { id: 'rift_stride', name: 'Thunderstep', icon: { g: 'boot', c: '#7dd3fc' }, desc: 'Every dash releases a damaging shockwave at your departure point. +8% movement speed.', flavor: 'The storm remembers where you stood.', stats: { speed: 0.08 } },
  { id: 'rift_feast', name: 'Heart of the Hunt', icon: { g: 'heart', c: '#fb7185' }, desc: 'Every 20 kills restores 4% maximum health. +10% damage to elites.', flavor: 'A heartbeat stolen from the dark.', stats: { eliteDmg: 0.1 } },
  { id: 'rift_flow', name: 'Hourglass Fang', icon: { g: 'clock', c: '#c4b5fd' }, desc: 'Kills recharge your dash by 0.04 seconds. +8% ability cooldown reduction.', flavor: 'Time bends around a sharpened will.', stats: { activeCd: 0.08 } },
  { id: 'rift_lens', name: 'Astral Lens', icon: { g: 'star', c: '#fde68a' }, desc: '+15% area and +20% pickup range for the rest of this night.', flavor: 'Even the smallest light reaches further.', stats: { area: 0.15, magnet: 0.2 } },
  { id: 'rift_oath', name: 'The Unbroken Oath', icon: { g: 'shield', c: '#5eead4' }, desc: '+20 maximum health and +1 armor. Immediately restore 20% health.', flavor: 'Someone once promised you a dawn.', stats: { maxHp: 20, armor: 1 } },
  { id: 'rift_bargain', name: 'Cinder Crown', icon: { g: 'ember', c: '#fb923c' }, desc: '+25% Might and +15% Growth, but -15 maximum health.', flavor: 'Power always leaves an ember in the wound.', stats: { might: 0.25, growth: 0.15, maxHp: -15 } },
];
