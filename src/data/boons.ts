/* SOULFORGE — boons: run-long modifiers offered (pick one of three) when a boss falls */
import type { BoonDef } from '../game/types';
import { ABILITY_RANK_MAX } from './progression';

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
  // fourth round
  { id: 'b_chalice', name: 'Overflowing Chalice', icon: { g: 'drop', c: '#7dd3fc' }, stats: { healing: 0.25 }, desc: 'Healing +25%, and healing past full health becomes a shield.', onPick: (g, p) => { p.overhealToShield = true; } },
  { id: 'b_cull', name: "Executioner's Pact", icon: { g: 'scythe', c: '#a78bfa' }, stats: { cull: 0.1 }, desc: 'Cull +10%: non-boss enemies struck below 10% health die outright.' },
  { id: 'b_ward', name: 'Warding Sigils', icon: { g: 'rune', c: '#c4b5fd' }, flag: 'b_ward', desc: 'Every 12 seconds a ward forms that absorbs the next hit you would take.' },
  { id: 'b_quicken', name: 'Quickening Pulse', icon: { g: 'clock', c: '#f472b6' }, stats: { activeCd: 0.15 }, desc: 'Ability Rank +1 and ability cooldown -15%.', onPick: (g, p) => { p.abilityRank = Math.min(ABILITY_RANK_MAX, (p.abilityRank || 0) + 1); } },
  // cursed: power with a price
  { id: 'b_hunger', name: 'Hungering Blade', icon: { g: 'sword', c: '#ef4444' }, rarity: 'cursed', flag: 'b_hunger', stats: { might: 0.6 }, desc: 'Might +60%. Every second without a kill drains 1% of your max health.' },
  { id: 'b_bloodprice', name: 'Blood Price', icon: { g: 'drop', c: '#b91c1c' }, rarity: 'cursed', flag: 'b_bloodprice', desc: 'Level-ups offer two more choices, but every pick costs 4% of your current health.' },
  { id: 'b_doom', name: 'Doomsayer', icon: { g: 'skull', c: '#a78bfa' }, rarity: 'cursed', stats: { growth: 0.5, curse: 0.5 }, desc: 'Experience +50%. Curse +50%: more enemies, tougher enemies.' },
  { id: 'b_silence', name: 'Oath of Silence', icon: { g: 'lock', c: '#94a3b8' }, rarity: 'cursed', flag: 'b_silence', stats: { cooldown: 0.25, might: 0.15 }, desc: 'Your ability is sealed for the rest of the night. Weapon cooldowns -25%, Might +15%.' },
  // legendary: only from tiered Heralds, the Eclipse, or Torment
  { id: 'b_dawncrown', name: 'Crown of the Dawn', icon: { g: 'crown', c: '#fde68a' }, rarity: 'legendary', flag: 'b_dawncrown', desc: 'Overdrive cap +2, and evolved weapons deal +25% damage.' },
  { id: 'b_recursion', name: 'Infinite Recursion', icon: { g: 'spiral', c: '#a5f3fc' }, rarity: 'legendary', flag: 'b_recursion', desc: 'Every weapon has a 15% chance to fire twice.' },
  { id: 'b_starborn', name: 'Starborn', icon: { g: 'star', c: '#fde68a' }, rarity: 'legendary', stats: { amount: 1, area: 0.2 }, desc: '+1 Amount and Area +20%.' },
  { id: 'b_mantle', name: "Herald's Mantle", icon: { g: 'halo', c: '#f87171' }, rarity: 'legendary', flag: 'b_mantle', desc: 'Below half health you rage like a Herald: Might +40%, move speed +20%, and you take 15% less damage.' },
];
/** Chance that one of a boss chest's three boons is replaced by a legendary one, when legendaries are allowed. */
export const LEGENDARY_BOON_CHANCE = 0.35;
export const BOON_BY_ID: Record<string, BoonDef> = {}; BOONS.forEach((b) => (BOON_BY_ID[b.id] = b));
