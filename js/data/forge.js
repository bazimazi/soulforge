/* SOULFORGE — forge: anvil power-ups, equipment (affixes, rarities, uniques), transmutation, sigils */
'use strict';
(function () {
  const U = SF.U;

  /* ---------- ANVIL: permanent stat ranks ---------- */
  const A = (id, name, icon, stat, per, max, cost, tier, growth) => ({ id, name, icon, stat, per, max, cost, tier, growth: growth || 1.35 });
  SF.ANVIL = [
    // Tier 1
    A('a_might', 'Might', { g: 'gem', c: '#ff7043' }, 'might', 0.02, 10, 120, 1),
    A('a_hp', 'Vitality', { g: 'heart', c: '#ff5c7a' }, 'maxHp', 6, 10, 100, 1),
    A('a_armor', 'Armor', { g: 'shield', c: '#9fb2c8' }, 'armor', 0.5, 5, 260, 1),
    A('a_speed', 'Swiftness', { g: 'boot', c: '#6ee7b7' }, 'speed', 0.02, 5, 160, 1),
    A('a_regen', 'Regeneration', { g: 'leaf', c: '#86efac' }, 'regen', 0.15, 5, 200, 1),
    A('a_magnet', 'Magnetism', { g: 'magnet', c: '#f87171' }, 'magnet', 0.1, 5, 110, 1),
    A('a_growth', 'Growth', { g: 'crown', c: '#facc15' }, 'growth', 0.03, 10, 160, 1),
    A('a_greed', 'Greed', { g: 'coin', c: '#f5c542' }, 'greed', 0.03, 10, 130, 1),
    A('a_luck', 'Luck', { g: 'clover', c: '#4ade80' }, 'luck', 0.05, 5, 280, 1),
    A('a_cd', 'Haste', { g: 'clock', c: '#f472b6' }, 'cooldown', 0.02, 5, 320, 1),
    // Tier 2
    A('a_area', 'Reach', { g: 'hex', c: '#7dd3fc' }, 'area', 0.03, 5, 380, 2),
    A('a_dur', 'Persistence', { g: 'hourglass', c: '#fbbf24' }, 'duration', 0.04, 5, 320, 2),
    A('a_pspeed', 'Velocity', { g: 'rune', c: '#c4b5fd' }, 'projSpeed', 0.05, 5, 260, 2),
    A('a_crit', 'Precision', { g: 'dagger', c: '#e2e8f0' }, 'crit', 0.01, 10, 320, 2),
    A('a_critdmg', 'Brutality', { g: 'sword', c: '#fca5a5' }, 'critDmg', 0.03, 10, 320, 2),
    A('a_reroll', 'Rerolls', { g: 'mirror', c: '#a5f3fc' }, 'rerolls', 1, 5, 520, 2),
    A('a_skip', 'Skips', { g: 'wing', c: '#94a3b8' }, 'skips', 1, 3, 420, 2),
    A('a_banish', 'Banishes', { g: 'lock', c: '#f87171' }, 'banishes', 1, 3, 640, 2),
    A('a_dodge', 'Evasion', { g: 'ghost', c: '#94a3b8' }, 'dodge', 0.01, 5, 480, 2),
    A('a_ls', 'Vampirism', { g: 'fang', c: '#dc2626' }, 'lifesteal', 0.002, 5, 520, 2),
    A('a_heal', 'Mending', { g: 'cross', c: '#86efac' }, 'healing', 0.05, 5, 360, 2),
    // Tier 3
    A('a_amount', 'Multiplicity', { g: 'mirror', c: '#f0abfc' }, 'amount', 1, 1, 25000, 3),
    A('a_rev', 'Revival', { g: 'star', c: '#fde68a' }, 'revival', 1, 2, 6000, 3, 2.5),
    A('a_curse', 'Curse', { g: 'skull', c: '#a78bfa' }, 'curse', 0.05, 5, 640, 3),
    A('a_active', 'Focus', { g: 'eye', c: '#7dd3fc' }, 'activeCd', 0.04, 5, 720, 3),
    A('a_elite', 'Slayer', { g: 'crown', c: '#f87171' }, 'eliteDmg', 0.05, 5, 720, 3),
    A('a_xp', 'Wisdom', { g: 'book', c: '#c4b5fd' }, 'xpBonus', 0.05, 10, 520, 3),
    A('a_mat', 'Prospecting', { g: 'shard', c: '#fde68a' }, 'matFind', 0.1, 5, 640, 3),
    A('a_start', 'Head Start', { g: 'star', c: '#facc15' }, 'startLevel', 1, 3, 3200, 3, 2),
    A('a_chest', 'Bounty', { g: 'chest', c: '#ffd700' }, 'chestLuck', 0.1, 5, 860, 3),
    A('a_knock', 'Impact', { g: 'hammer', c: '#fbbf24' }, 'knockback', 0.1, 5, 420, 3),
    A('a_thorns', 'Retaliation', { g: 'shield', c: '#f97316' }, 'thorns', 0.1, 5, 520, 3),
    A('a_pierce', 'Penetration', { g: 'arrow', c: '#a3e635' }, 'pierce', 1, 1, 18000, 3),
    // Mastery: infinite ranks
    A('a_m_might', 'Mastery: Might', { g: 'gem', c: '#ff7043' }, 'might', 0.01, 999, 2500, 4, 1.12),
    A('a_m_hp', 'Mastery: Vitality', { g: 'heart', c: '#ff5c7a' }, 'maxHp', 3, 999, 2000, 4, 1.12),
    A('a_m_armor', 'Mastery: Armor', { g: 'shield', c: '#9fb2c8' }, 'armor', 0.1, 999, 3000, 4, 1.12),
    A('a_m_growth', 'Mastery: Growth', { g: 'crown', c: '#facc15' }, 'growth', 0.01, 999, 2500, 4, 1.12),
    A('a_m_greed', 'Mastery: Greed', { g: 'coin', c: '#f5c542' }, 'greed', 0.01, 999, 2500, 4, 1.12),
    A('a_m_cd', 'Mastery: Haste', { g: 'clock', c: '#f472b6' }, 'cooldown', 0.005, 999, 4000, 4, 1.12),
  ];
  SF.ANVIL_BY_ID = {}; SF.ANVIL.forEach((a) => (SF.ANVIL_BY_ID[a.id] = a));
  SF.ANVIL_TIER_REQ = { 1: 0, 2: 15, 3: 40, 4: 80 };
  SF.anvilCost = (a, rank) => Math.round(a.cost * Math.pow(a.growth, rank));

  /* ---------- SIGILS: bought with Soul Embers ---------- */
  SF.SIGILS = [
    { id: 'extra_choice', name: 'Sigil of Choice', icon: { g: 'mirror', c: '#a5f3fc' }, cost: 60, desc: 'Level-ups always offer 4 options.', flag: 'extraChoice' },
    { id: 'head_start', name: 'Sigil of Haste', icon: { g: 'star', c: '#facc15' }, cost: 40, desc: 'Start every run 2 levels higher.', stats: { startLevel: 2 } },
    { id: 'treasure', name: 'Sigil of Bounty', icon: { g: 'chest', c: '#ffd700' }, cost: 50, desc: 'Chests have +40% chance to contain an extra upgrade.', stats: { chestLuck: 0.4 } },
    { id: 'second_wind', name: 'Sigil of Return', icon: { g: 'cross', c: '#fde68a' }, cost: 90, desc: '+1 Revival.', stats: { revival: 1 } },
    { id: 'pulse', name: 'Sigil of Pull', icon: { g: 'magnet', c: '#f87171' }, cost: 45, desc: 'Every 60 seconds, every gem on the field flies to you.', flag: 'magnetPulse' },
    { id: 'golden', name: 'Sigil of Gold', icon: { g: 'coin', c: '#f5c542' }, cost: 50, desc: '+25% gold.', stats: { greed: 0.25 } },
    { id: 'siphon', name: 'Sigil of Souls', icon: { g: 'ember', c: '#ff8a3c' }, cost: 70, desc: '+50% Soul Embers from bosses and elites.', flag: 'emberBonus' },
    { id: 'insight', name: 'Sigil of Insight', icon: { g: 'eye', c: '#7dd3fc' }, cost: 40, desc: '+3 Rerolls per run.', stats: { rerolls: 3 } },
    { id: 'wslot', name: 'Sigil of the Arsenal', icon: { g: 'sword', c: '#dfe6ee' }, cost: 220, desc: '+1 weapon slot (7 total).', flag: 'weaponSlot' },
    { id: 'pslot', name: 'Sigil of the Satchel', icon: { g: 'gem', c: '#7dd3fc' }, cost: 220, desc: '+1 passive slot (7 total).', flag: 'passiveSlot' },
    { id: 'critmass', name: 'Sigil of Ruin', icon: { g: 'dagger', c: '#fca5a5' }, cost: 60, desc: '+15% crit damage.', stats: { critDmg: 0.15 } },
    { id: 'elitehunter', name: 'Sigil of the Hunt', icon: { g: 'crown', c: '#f87171' }, cost: 60, desc: '+25% damage to elites and bosses.', stats: { eliteDmg: 0.25 } },
    { id: 'blessed', name: 'Sigil of Dawn', icon: { g: 'shield', c: '#fde68a' }, cost: 35, desc: 'Begin each run with a shield worth 50% of your health.', flag: 'startShield' },
    { id: 'champions', name: 'Sigil of Champions', icon: { g: 'skull', c: '#facc15' }, cost: 80, desc: 'Elites appear 25% more often (more chests!).', flag: 'moreElites' },
    { id: 'adrenaline', name: 'Sigil of Adrenaline', icon: { g: 'boot', c: '#6ee7b7' }, cost: 45, desc: 'Below 30% health you move 20% faster.', flag: 'adrenaline' },
    { id: 'scavenger', name: 'Sigil of Scavenging', icon: { g: 'shard', c: '#fde68a' }, cost: 55, desc: '+30% material find.', stats: { matFind: 0.3 } },
    { id: 'veteran', name: 'Sigil of the Veteran', icon: { g: 'book', c: '#c4b5fd' }, cost: 75, desc: '+25% character experience.', stats: { xpBonus: 0.25 } },
    { id: 'fullrevive', name: 'Sigil of Rebirth', icon: { g: 'sun', c: '#fde68a' }, cost: 90, desc: 'Revivals restore full health and clear nearby enemies.', flag: 'fullRevive' },
    { id: 'emberheart', name: 'Sigil of the Heart', icon: { g: 'heart', c: '#ff5c7a' }, cost: 50, desc: '+10% max health.', stats: { maxHpPct: 0.1 } },
    { id: 'banisher', name: 'Sigil of Banishing', icon: { g: 'lock', c: '#f87171' }, cost: 50, desc: '+2 Banishes per run.', stats: { banishes: 2 } },
    { id: 'timeless', name: 'Sigil of the Timeless', icon: { g: 'hourglass', c: '#fbbf24' }, cost: 120, desc: 'Gain a free level-up every 5 minutes survived.', flag: 'timedLevels' },
    { id: 'glutton', name: 'Sigil of Feasting', icon: { g: 'drop', c: '#ff6b6b' }, cost: 40, desc: 'Food heals 50% more and drops more often.', flag: 'moreFood' },
  ];
  SF.SIGIL_BY_ID = {}; SF.SIGILS.forEach((s) => (SF.SIGIL_BY_ID[s.id] = s));

  /* ---------- EQUIPMENT ---------- */
  SF.SLOTS = [
    { id: 'charm', name: 'Weapon Charm', icon: { g: 'sword', c: '#fca5a5' }, affixes: ['might', 'crit', 'critDmg', 'cooldown', 'sigDmg', 'eliteDmg', 'knockback', 'projSpeed'] },
    { id: 'helm', name: 'Helm', icon: { g: 'crown', c: '#9fb2c8' }, affixes: ['maxHp', 'armor', 'growth', 'luck', 'healing', 'regen', 'dodge'] },
    { id: 'armor', name: 'Armor', icon: { g: 'shield', c: '#9fb2c8' }, affixes: ['maxHp', 'armor', 'regen', 'thorns', 'shieldPower', 'dodge', 'healing'] },
    { id: 'amulet', name: 'Amulet', icon: { g: 'gem', c: '#c4b5fd' }, affixes: ['area', 'duration', 'cooldown', 'might', 'activeCd', 'curse', 'minionDmg'] },
    { id: 'ring', name: 'Ring', icon: { g: 'ring', c: '#f5c542' }, affixes: ['luck', 'greed', 'crit', 'critDmg', 'magnet', 'matFind', 'xpBonus', 'lifesteal'] },
    { id: 'boots', name: 'Boots', icon: { g: 'boot', c: '#6ee7b7' }, affixes: ['speed', 'dodge', 'magnet', 'cooldown', 'luck', 'burnDmg', 'slowPower'] },
  ];
  SF.SLOT_BY_ID = {}; SF.SLOTS.forEach((s) => (SF.SLOT_BY_ID[s.id] = s));
  /* affix ranges at item level 1 */
  SF.AFFIX = {
    might: [0.03, 0.06], crit: [0.02, 0.04], critDmg: [0.05, 0.12], cooldown: [0.02, 0.04], sigDmg: [0.05, 0.1], eliteDmg: [0.05, 0.12], knockback: [0.1, 0.2], projSpeed: [0.05, 0.1],
    maxHp: [6, 14], armor: [0.4, 1.0], growth: [0.03, 0.06], luck: [0.04, 0.08], healing: [0.05, 0.12], regen: [0.15, 0.4], dodge: [0.01, 0.03], thorns: [0.15, 0.35], shieldPower: [0.1, 0.2],
    area: [0.03, 0.06], duration: [0.04, 0.08], activeCd: [0.04, 0.08], curse: [0.04, 0.08], minionDmg: [0.08, 0.16], greed: [0.05, 0.1], magnet: [0.1, 0.2], matFind: [0.1, 0.2], xpBonus: [0.05, 0.1], lifesteal: [0.003, 0.006],
    speed: [0.02, 0.04], burnDmg: [0.1, 0.2], slowPower: [0.05, 0.1],
  };
  SF.RARITIES = [
    { id: 'common', name: 'Common', color: '#cbd5e1', affixes: 1, maxUp: 5, mult: 1, w: 50 },
    { id: 'uncommon', name: 'Uncommon', color: '#4ade80', affixes: 2, maxUp: 10, mult: 1.1, w: 30 },
    { id: 'rare', name: 'Rare', color: '#60a5fa', affixes: 3, maxUp: 15, mult: 1.2, w: 14 },
    { id: 'epic', name: 'Epic', color: '#c084fc', affixes: 4, maxUp: 20, mult: 1.35, w: 5 },
    { id: 'legendary', name: 'Legendary', color: '#fb923c', affixes: 4, maxUp: 25, mult: 1.5, w: 1, unique: true },
    { id: 'mythic', name: 'Mythic', color: '#f43f5e', affixes: 5, maxUp: 30, mult: 1.8, w: 0.3, unique: true },
  ];
  SF.RARITY_BY_ID = {}; SF.RARITIES.forEach((r, i) => { r.index = i; SF.RARITY_BY_ID[r.id] = r; });

  SF.UNIQUES = [
    { id: 'ember_crown', name: 'Ember Crown', desc: 'Hits have a 10% chance to ignite enemies.', flag: 'u_ignite' },
    { id: 'stormheart', name: 'Stormheart', desc: 'Every 4 seconds, lightning strikes the 3 nearest enemies.', flag: 'u_storm' },
    { id: 'void_loop', name: 'Void Loop', desc: 'Kills have a 6% chance to release a homing void mote.', flag: 'u_void' },
    { id: 'aegis_dawn', name: 'Aegis of Dawn', desc: 'Every 20 seconds, gain a shield worth 12% of max health.', flag: 'u_aegis' },
    { id: 'titan_grip', name: 'Titan Grip', desc: '+1 Pierce and +20% knockback.', stats: { pierce: 1, knockback: 0.2 } },
    { id: 'chrono_band', name: 'Chrono Band', desc: 'Ability cooldown -25%.', stats: { activeCd: 0.25 } },
    { id: 'gilded_fang', name: 'Gilded Fang', desc: 'Gold pickups heal 1 HP. +20% Greed.', flag: 'u_goldheal', stats: { greed: 0.2 } },
    { id: 'soulreaver', name: 'Soulreaver', desc: 'Each kill grants +0.03% Might for the rest of the run (max +40%).', flag: 'u_soulreaver' },
    { id: 'phoenix_plume', name: 'Phoenix Plume', desc: '+1 Revival.', stats: { revival: 1 } },
    { id: 'frostbound', name: 'Frostbound', desc: 'Hits have a 5% chance to freeze for 1 second.', flag: 'u_frost' },
    { id: 'warlords_banner', name: "Warlord's Banner", desc: '+8% Might per boss killed this run.', flag: 'u_banner' },
    { id: 'starfall', name: 'Starfall Pendant', desc: 'Every 8 seconds a meteor strikes a random enemy.', flag: 'u_starfall' },
    { id: 'bloodstone', name: 'Bloodstone', desc: '+1.5% lifesteal. Kills heal 0.5 HP.', flag: 'u_bloodstone', stats: { lifesteal: 0.015 } },
    { id: 'sages_eye', name: "Sage's Eye", desc: 'Level-ups offer an extra choice. +10% Growth.', flag: 'extraChoice', stats: { growth: 0.1 } },
    { id: 'heart_of_horde', name: 'Heart of the Horde', desc: '+25% Curse and +15% Might.', stats: { curse: 0.25, might: 0.15 } },
    { id: 'mirror_shard', name: 'Mirror Shard', desc: '+1 Amount.', stats: { amount: 1 } },
  ];
  SF.UNIQUE_BY_ID = {}; SF.UNIQUES.forEach((u) => (SF.UNIQUE_BY_ID[u.id] = u));

  SF.forgeXpFor = (L) => Math.round(400 * Math.pow(L, 1.7));
  SF.forgeLevelPerks = (L) => ({ valueMult: 1 + 0.04 * (L - 1), transmute: L >= 2, reforge: L >= 3, epic: L >= 4, legendary: L >= 6, mythic: L >= 10, catalyst2: L >= 5, catalyst3: L >= 8 });
  SF.craftCost = (L) => ({ gold: Math.round(150 + 70 * L * Math.pow(1.08, L)), iron: 3 + L });
  SF.CATALYSTS = [
    { id: 'none', name: 'No catalyst', cost: {}, minRarity: 0 },
    { id: 'arcane', name: 'Arcane Catalyst', cost: { dust: 6 }, minRarity: 2, req: 'transmute', desc: 'Guarantees at least Rare.' },
    { id: 'void', name: 'Void Catalyst', cost: { crystal: 4 }, minRarity: 3, req: 'catalyst2', desc: 'Guarantees at least Epic.' },
    { id: 'star', name: 'Star Catalyst', cost: { star: 3 }, minRarity: 4, req: 'catalyst3', desc: 'Guarantees at least Legendary.' },
  ];
  SF.rollRarity = function (forgeLevel, minRarity, luck) {
    const perks = SF.forgeLevelPerks(forgeLevel);
    const ws = SF.RARITIES.map((r, i) => {
      let w = r.w;
      if (i === 3 && !perks.epic) w = 0;
      if (i === 4) w = perks.legendary ? 1 + (forgeLevel - 6) * 0.6 : 0;
      if (i === 5) w = perks.mythic ? 0.3 + (forgeLevel - 10) * 0.2 : 0;
      if (i >= 2) w *= 1 + forgeLevel * 0.08 + (luck || 0);
      if (i < minRarity) w = 0;
      return w;
    });
    const total = ws.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < ws.length; i++) { r -= ws[i]; if (r <= 0) return SF.RARITIES[i]; }
    return SF.RARITIES[Math.max(minRarity, 0)];
  };
  const NAMES = {
    charm: ['Fang', 'Talon', 'Edge', 'Sigil', 'Totem', 'Idol'], helm: ['Helm', 'Circlet', 'Hood', 'Crown', 'Visor', 'Mask'], armor: ['Plate', 'Mail', 'Vest', 'Robe', 'Hide', 'Carapace'],
    amulet: ['Amulet', 'Pendant', 'Locket', 'Charm', 'Talisman', 'Eye'], ring: ['Ring', 'Band', 'Loop', 'Signet', 'Coil', 'Seal'], boots: ['Boots', 'Greaves', 'Treads', 'Sandals', 'Striders', 'Sabatons'],
  };
  const PREFIX = ['Ashen', 'Frozen', 'Crimson', 'Void', 'Storm', 'Gilded', 'Grave', 'Ember', 'Hollow', 'Sun', 'Moon', 'Thorn', 'Iron', 'Silver', 'Wyrm', 'Ghost', 'Blood', 'Star'];
  const SUFFIX = ['of Ruin', 'of the Hunt', 'of Night', 'of Dawn', 'of Echoes', 'of Fury', 'of the Deep', 'of Embers', 'of Frost', 'of Souls', 'of Tides', 'of the Titan', 'of Whispers', 'of Glory'];
  SF.craftItem = function (slotId, forgeLevel, opts = {}) {
    const slot = SF.SLOT_BY_ID[slotId];
    const rarity = opts.rarity || SF.rollRarity(forgeLevel, opts.minRarity || 0, opts.luck || 0);
    const perks = SF.forgeLevelPerks(forgeLevel);
    const pool = U.shuffle(slot.affixes.slice());
    const affixes = [];
    for (let i = 0; i < rarity.affixes && i < pool.length; i++) {
      const stat = pool[i], rng = SF.AFFIX[stat];
      affixes.push({ stat, base: U.rand(rng[0], rng[1]) * perks.valueMult * rarity.mult });
    }
    const item = { uid: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), slot: slotId, rarity: rarity.id, level: 0, affixes, ilvl: forgeLevel, name: '', spent: 0 };
    if (rarity.unique) {
      const u = U.pick(SF.UNIQUES);
      item.unique = u.id;
      item.name = u.name;
    } else {
      item.name = (rarity.index >= 1 ? U.pick(PREFIX) + ' ' : '') + U.pick(NAMES[slotId]) + (rarity.index >= 2 ? ' ' + U.pick(SUFFIX) : '');
    }
    return item;
  };
  SF.itemAffixValue = (item, a) => a.base * (1 + 0.08 * item.level);
  SF.itemStats = function (item) {
    const out = {};
    item.affixes.forEach((a) => { out[a.stat] = (out[a.stat] || 0) + SF.itemAffixValue(item, a); });
    if (item.unique) { const u = SF.UNIQUE_BY_ID[item.unique]; if (u && u.stats) for (const k in u.stats) out[k] = (out[k] || 0) + u.stats[k]; }
    return out;
  };
  SF.upgradeCost = function (item) {
    const r = SF.RARITY_BY_ID[item.rarity], L = item.level;
    const gold = Math.round(90 * Math.pow(1.24, L) * (1 + r.index * 0.35));
    const mats = {};
    if (L < 5) mats.iron = (L + 1) * 2;
    else if (L < 12) mats.dust = L - 3;
    else if (L < 20) mats.crystal = L - 10;
    else mats.star = L - 18;
    return { gold, mats };
  };
  SF.salvageValue = function (item) {
    const r = SF.RARITY_BY_ID[item.rarity];
    const table = [{ iron: 3 }, { iron: 6, dust: 1 }, { iron: 10, dust: 3 }, { dust: 6, crystal: 2 }, { crystal: 5, star: 1 }, { crystal: 8, star: 3 }];
    const out = Object.assign({}, table[r.index]);
    out.gold = Math.round(item.spent * 0.5);
    return out;
  };
  SF.reforgeCost = () => ({ gold: 350, mats: { dust: 4, crystal: 1 } });
  SF.TRANSMUTE = [
    { id: 't1', from: { iron: 10 }, to: { dust: 1 }, name: 'Refine Iron → Dust' },
    { id: 't2', from: { dust: 6 }, to: { crystal: 1 }, name: 'Condense Dust → Crystal' },
    { id: 't3', from: { crystal: 5 }, to: { star: 1 }, name: 'Fuse Crystal → Starshard' },
    { id: 't4', from: { star: 1 }, to: { crystal: 3 }, name: 'Shatter Starshard → Crystal' },
    { id: 't5', from: { crystal: 1 }, to: { dust: 4 }, name: 'Dissolve Crystal → Dust' },
    { id: 't6', from: { dust: 1 }, to: { iron: 6 }, name: 'Dissolve Dust → Iron' },
    { id: 't7', from: { gold: 120 }, to: { iron: 5 }, name: 'Buy Iron with Gold' },
  ];
})();
