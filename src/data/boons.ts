/* SOULFORGE — boons: run-long modifiers offered (pick one of three) when a boss falls */
import type { BoonDef } from '../game/types';

export const BOONS: BoonDef[] = [
  { id: 'b_chain', name: 'Chain Reaction', icon: { g: 'meteor', c: '#fb923c' }, flag: 'b_chain', desc: 'Slain enemies have a 12% chance to explode, hurting everything around them.' },
  { id: 'b_glass', name: 'Glass Cannon', icon: { g: 'shard', c: '#f0abfc' }, stats: { might: 0.5, maxHpPct: -0.35 }, desc: 'Might +50%. Max Health -35%.' },
  { id: 'b_overcharge', name: 'Overcharge', icon: { g: 'lightningball', c: '#7dd3fc' }, flag: 'b_overcharge', stats: { activeCd: 0.2 }, desc: 'Killing an elite or boss refills your ability. Ability cooldown -20%.' },
  { id: 'b_dilation', name: 'Time Dilation', icon: { g: 'hourglass', c: '#b28dff' }, flag: 'b_dilation', desc: 'Enemies within close range are slowed by 35%.' },
  { id: 'b_harvest', name: 'Soul Harvest', icon: { g: 'scythe', c: '#86efac' }, flag: 'b_harvest', desc: 'Every 150 kills grants +1% Might for the rest of the run (up to +40%).' },
  { id: 'b_mastery', name: 'Elemental Mastery', icon: { g: 'spiral', c: '#a5f3fc' }, flag: 'b_mastery', stats: { reactDmg: 1 }, desc: 'Elemental reactions deal double damage and recharge twice as fast.' },
  { id: 'b_prism', name: 'Prismatic Strikes', icon: { g: 'gem', c: '#f0abfc' }, flag: 'b_prism', desc: 'Weapon hits have a 6% chance to apply a random element: burn, chill or shock.' },
  { id: 'b_angel', name: 'Guardian Angel', icon: { g: 'halo', c: '#fde68a' }, flag: 'b_angel', desc: '+1 Revival. When you rise, holy light annihilates the horde around you.', onPick: (g, p) => { p.revivals++; } },
  { id: 'b_hunter', name: 'Apex Predator', icon: { g: 'eye', c: '#f87171' }, flag: 'b_hunter', stats: { eliteDmg: 0.4 }, desc: 'Damage to elites and bosses +40%. Elites drop twice the materials.' },
  { id: 'b_gravity', name: 'Gravity Well', icon: { g: 'magnet', c: '#4fd1ff' }, stats: { magnet: 1, growth: 0.15 }, desc: 'Pickup radius +100%. Experience +15%.' },
  { id: 'b_bulwark', name: 'Bulwark', icon: { g: 'shield', c: '#9fb2c8' }, stats: { armor: 3, maxHpPct: 0.25, speed: -0.1 }, desc: 'Armor +3, Max Health +25%. Move Speed -10%.' },
  { id: 'b_second', name: 'Second Wind', icon: { g: 'wing', c: '#86efac' }, flag: 'b_second', desc: 'Dropping below 30% health grants a shield of 60% max health and 2s of invulnerability (every 60s).' },
  { id: 'b_midas', name: 'Midas Covenant', icon: { g: 'coin', c: '#f5c542' }, stats: { greed: 0.6, chestLuck: 0.3 }, desc: 'Gold +60%. Chests hold more treasure.' },
  { id: 'b_eye', name: 'Abyssal Gaze', icon: { g: 'eye', c: '#c084fc' }, flag: 'b_eye', desc: 'Every 6s a void eye lances the toughest enemy in sight for heavy damage.' },
  { id: 'b_storm', name: 'Tempest Heart', icon: { g: 'bolt', c: '#fde047' }, flag: 'b_storm', desc: 'Every 3s lightning strikes three nearby enemies, leaving them shocked.' },
  { id: 'b_frenzy', name: 'Bloodlust', icon: { g: 'fang', c: '#ef4444' }, flag: 'b_frenzy', desc: 'Kill-streak bonuses are doubled and streaks last 1.5s longer.' },
  { id: 'b_phoenix', name: 'Phoenix Feather', icon: { g: 'feather', c: '#ff7a3c' }, flag: 'b_phoenix', desc: 'Once, death becomes fire: rise at full health as flames consume the horde around you and scorch bosses.' },
  { id: 'b_volatile', name: 'Volatile Arsenal', icon: { g: 'mine', c: '#ffb347' }, flag: 'b_volatile', desc: 'Critical hits have a 25% chance to detonate, damaging enemies nearby.' },
];
export const BOON_BY_ID: Record<string, BoonDef> = {}; BOONS.forEach((b) => (BOON_BY_ID[b.id] = b));
