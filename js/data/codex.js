/* SOULFORGE — codex: bestiary, armory, milestones. Codex entries grant permanent rewards when claimed. */
'use strict';
(function () {
  SF.BESTIARY_TIERS = [50, 500, 5000];
  SF.BESTIARY_REWARD = [{ gold: 60 }, { gold: 250 }, { gold: 1200, embers: 5 }];
  SF.BESTIARY_STAT = { might: 0.01 };             // per tier, per enemy type (global)
  SF.BOSS_TIERS = [1, 5, 25];
  SF.BOSS_REWARD = [{ embers: 6 }, { embers: 20, gold: 800 }, { embers: 60, gold: 4000 }];
  SF.BOSS_STAT = { maxHpPct: 0.02 };              // per tier, per boss

  SF.ARMORY_STAGES = [
    { id: 'found', name: 'Discovered', reward: { gold: 40 }, mastery: 0 },
    { id: 'maxed', name: 'Mastered', reward: { gold: 150 }, mastery: 0.05 },
    { id: 'evolved', name: 'Evolved', reward: { embers: 10 }, mastery: 0.1 },
  ];

  SF.MILESTONES = [
    { id: 'first_run', name: 'First Night', desc: 'Complete a run.', check: (s) => s.stats.runs >= 1, reward: { gold: 100 } },
    { id: 'survive_5', name: 'Five Minutes', desc: 'Survive 5 minutes.', check: (s) => s.stats.bestTime >= 300, reward: { gold: 150 } },
    { id: 'survive_10', name: 'Ten Minutes', desc: 'Survive 10 minutes.', check: (s) => s.stats.bestTime >= 600, reward: { gold: 400, embers: 5 } },
    { id: 'survive_15', name: 'Quarter Hour', desc: 'Survive 15 minutes.', check: (s) => s.stats.bestTime >= 900, reward: { gold: 800, embers: 10 } },
    { id: 'survive_20', name: 'Deep Night', desc: 'Survive 20 minutes.', check: (s) => s.stats.bestTime >= 1200, reward: { gold: 1500, embers: 20 } },
    { id: 'survive_30', name: 'Eclipse', desc: 'Survive 30 minutes — into the Eclipse.', check: (s) => s.stats.bestTime >= 1800, reward: { gold: 4000, embers: 40 } },
    { id: 'survive_45', name: 'Beyond', desc: 'Survive 45 minutes.', check: (s) => s.stats.bestTime >= 2700, reward: { gold: 10000, embers: 80 } },
    { id: 'kills_1k', name: 'Thousand Cuts', desc: 'Kill 1,000 enemies.', check: (s) => s.stats.kills >= 1000, reward: { gold: 200 } },
    { id: 'kills_10k', name: 'Reaper', desc: 'Kill 10,000 enemies.', check: (s) => s.stats.kills >= 10000, reward: { gold: 1000, embers: 10 } },
    { id: 'kills_100k', name: 'Extinction', desc: 'Kill 100,000 enemies.', check: (s) => s.stats.kills >= 100000, reward: { gold: 8000, embers: 60 } },
    { id: 'boss_1', name: 'Giant Slayer', desc: 'Defeat a boss.', check: (s) => s.stats.bossKills >= 1, reward: { gold: 300, embers: 5 } },
    { id: 'boss_10', name: 'Boss Hunter', desc: 'Defeat 10 bosses.', check: (s) => s.stats.bossKills >= 10, reward: { gold: 1500, embers: 20 } },
    { id: 'boss_50', name: 'Kingslayer', desc: 'Defeat 50 bosses.', check: (s) => s.stats.bossKills >= 50, reward: { gold: 6000, embers: 60 } },
    { id: 'level_30', name: 'Adept', desc: 'Reach level 30 in a run.', check: (s) => s.stats.bestLevel >= 30, reward: { gold: 300 } },
    { id: 'level_60', name: 'Master', desc: 'Reach level 60 in a run.', check: (s) => s.stats.bestLevel >= 60, reward: { gold: 1200, embers: 10 } },
    { id: 'level_100', name: 'Transcendent', desc: 'Reach level 100 in a run.', check: (s) => s.stats.bestLevel >= 100, reward: { gold: 5000, embers: 40 } },
    { id: 'evolve_1', name: 'Metamorphosis', desc: 'Evolve a weapon.', check: (s) => s.stats.evolves >= 1, reward: { gold: 300, embers: 5 } },
    { id: 'evolve_10', name: 'Arsenal', desc: 'Evolve 10 weapons.', check: (s) => s.stats.evolves >= 10, reward: { gold: 2000, embers: 20 } },
    { id: 'chars_6', name: 'Half the Roster', desc: 'Unlock 6 characters.', check: (s) => Object.values(s.chars).filter((c) => c.unlocked).length >= 6, reward: { gold: 1000, embers: 10 } },
    { id: 'chars_all', name: 'The Full Company', desc: 'Unlock every character.', check: (s) => Object.values(s.chars).filter((c) => c.unlocked).length >= 12, reward: { gold: 5000, embers: 50 } },
    { id: 'forge_5', name: 'Journeyman Smith', desc: 'Reach Forge level 5.', check: (s) => s.forge.level >= 5, reward: { gold: 800, embers: 10 } },
    { id: 'forge_10', name: 'Master Smith', desc: 'Reach Forge level 10.', check: (s) => s.forge.level >= 10, reward: { gold: 4000, embers: 40 } },
    { id: 'heat_5', name: 'Warm', desc: 'Win 10 minutes at Heat 5+.', check: (s) => s.stats.bestHeat10 >= 5, reward: { gold: 1000, embers: 10 } },
    { id: 'heat_12', name: 'Scorching', desc: 'Win 10 minutes at Heat 12+.', check: (s) => s.stats.bestHeat10 >= 12, reward: { gold: 4000, embers: 40 } },
    { id: 'stage_void', name: 'Into the Rift', desc: 'Unlock The Void Rift.', check: (s) => s.stages.unlocked.includes('void'), reward: { gold: 3000, embers: 30 } },
    { id: 'gold_100k', name: 'Hoarder', desc: 'Earn 100,000 gold in total.', check: (s) => s.stats.goldEarned >= 100000, reward: { embers: 20 } },
    { id: 'legendary', name: 'Legend', desc: 'Craft a Legendary item.', check: (s) => s.stats.legendaries >= 1, reward: { gold: 1500, embers: 15 } },
    { id: 'talents_30', name: 'Specialist', desc: 'Spend 30 talent points on one character.', check: (s) => Object.values(s.chars).some((c) => Object.values(c.talents || {}).reduce((a, b) => a + b, 0) >= 30), reward: { gold: 1500, embers: 15 } },
    { id: 'char_50', name: 'Veteran', desc: 'Reach character level 50 with anyone.', check: (s) => Object.values(s.chars).some((c) => c.level >= 50), reward: { gold: 3000, embers: 30 } },
    { id: 'all_weapons', name: 'Collector', desc: 'Discover every general weapon.', check: (s) => Object.values(SF.WEAPONS).filter((w) => !w.char).every((w) => s.codex.weapons[w.id] && s.codex.weapons[w.id].found), reward: { gold: 2000, embers: 20 } },
  ];
  SF.MILESTONE_BY_ID = {}; SF.MILESTONES.forEach((m) => (SF.MILESTONE_BY_ID[m.id] = m));

  SF.charXpFor = (L) => Math.round(100 * Math.pow(L, 1.35));
  SF.PARAGON = [
    { id: 'p_might', name: 'Paragon Might', stat: 'might', per: 0.005, icon: { g: 'gem', c: '#ff7043' } },
    { id: 'p_hp', name: 'Paragon Vitality', stat: 'maxHp', per: 2, icon: { g: 'heart', c: '#ff5c7a' } },
    { id: 'p_armor', name: 'Paragon Armor', stat: 'armor', per: 0.1, icon: { g: 'shield', c: '#9fb2c8' } },
    { id: 'p_cd', name: 'Paragon Haste', stat: 'cooldown', per: 0.003, icon: { g: 'clock', c: '#f472b6' } },
    { id: 'p_area', name: 'Paragon Reach', stat: 'area', per: 0.005, icon: { g: 'hex', c: '#7dd3fc' } },
    { id: 'p_growth', name: 'Paragon Growth', stat: 'growth', per: 0.005, icon: { g: 'crown', c: '#facc15' } },
  ];
})();
