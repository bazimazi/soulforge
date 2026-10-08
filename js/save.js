/* SOULFORGE — save data, meta progression math, forge/talent/codex transactions */
'use strict';
(function () {
  const U = SF.U;
  const KEY = 'soulforge_save_v1';

  function defaults() {
    return {
      v: 1, gold: 0, embers: 0, mats: { iron: 0, dust: 0, crystal: 0, star: 0 },
      chars: {}, anvil: {}, forge: { xp: 0, level: 1 }, items: [], equipped: {}, sigils: {},
      codex: { enemies: {}, bosses: {}, weapons: {}, claimed: {}, uniques: {} },
      stats: { runs: 0, kills: 0, bossKills: 0, bestTime: 0, bestLevel: 0, evolves: 0, goldEarned: 0, legendaries: 0, bestHeat10: 0, totalTime: 0, elites: 0 },
      stages: { unlocked: ['ashen'], best: {} },
      omens: {}, lastChar: 'kael', lastStage: 'ashen',
      settings: { sfx: 0.6, music: 0.35, shake: 1, dmgNumbers: true, fps: false, quality: 1 },
      seen: {}, notices: [],
    };
  }

  const Save = {
    data: null,
    load() {
      let d = null;
      try { d = JSON.parse(localStorage.getItem(KEY)); } catch (e) { d = null; }
      const def = defaults();
      this.data = d ? deepMerge(def, d) : def;
      SF.CHARACTERS.forEach((c) => this.charData(c.id));
      this.data.chars.kael.unlocked = this.data.chars.lyra.unlocked = this.data.chars.talon.unlocked = true;
      return this.data;
    },
    save() { try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (e) { /* ignore */ } },
    reset() { localStorage.removeItem(KEY); this.load(); },
    export() { return btoa(unescape(encodeURIComponent(JSON.stringify(this.data)))); },
    import(str) { try { const d = JSON.parse(decodeURIComponent(escape(atob(str)))); if (d && d.chars) { this.data = deepMerge(defaults(), d); this.save(); return true; } } catch (e) { } return false; },
    charData(id) {
      const c = this.data.chars[id] || (this.data.chars[id] = {});
      if (c.unlocked == null) c.unlocked = false;
      c.xp = c.xp || 0; c.level = c.level || 1; c.talents = c.talents || {}; c.paragon = c.paragon || {};
      c.runs = c.runs || 0; c.kills = c.kills || 0; c.bosses = c.bosses || 0; c.bestTime = c.bestTime || 0; c.bestLevel = c.bestLevel || 0; c.chapters = c.chapters || {};
      return c;
    },
    /* ---------- character xp / talents ---------- */
    addCharXp(id, xp) {
      const c = this.charData(id); c.xp += xp; let ups = 0;
      while (c.xp >= SF.charXpFor(c.level)) { c.xp -= SF.charXpFor(c.level); c.level++; ups++; }
      return ups;
    },
    talentPointsUsed(id) { const c = this.charData(id); let n = 0; for (const k in c.talents) n += c.talents[k]; for (const k in c.paragon) n += c.paragon[k]; return n; },
    talentPointsFree(id) { const c = this.charData(id); return c.level - 1 - this.talentPointsUsed(id); },
    branchPoints(id, branchId) { const c = this.charData(id); const def = SF.CHAR_BY_ID[id]; let n = 0; def.talents.forEach((b) => { if (b.id === branchId) b.nodes.forEach((nd) => (n += c.talents[nd.id] || 0)); }); return n; },
    nodeAvailable(id, node) { const pts = this.branchPoints(id, node.branch); return pts >= node.tier * 4; },
    buyTalent(id, node) {
      const c = this.charData(id);
      if (this.talentPointsFree(id) <= 0) return 'No talent points.';
      if (!this.nodeAvailable(id, node)) return 'Requires ' + node.tier * 4 + ' points in this branch.';
      if ((c.talents[node.id] || 0) >= node.max) return 'Maxed.';
      c.talents[node.id] = (c.talents[node.id] || 0) + 1; this.save(); return null;
    },
    buyParagon(id, pid) { const c = this.charData(id); if (this.talentPointsFree(id) <= 0) return 'No talent points.'; c.paragon[pid] = (c.paragon[pid] || 0) + 1; this.save(); return null; },
    respec(id) { const c = this.charData(id); c.talents = {}; c.paragon = {}; this.save(); },
    allTalentsMaxed(id) { const def = SF.CHAR_BY_ID[id]; const c = this.charData(id); return def.talents.every((b) => b.nodes.every((n) => (c.talents[n.id] || 0) >= n.max)); },
    /* ---------- unlock checks ---------- */
    charUnlocked(id) { return !!this.charData(id).unlocked; },
    checkUnlocks() {
      const d = this.data, out = [];
      SF.CHARACTERS.forEach((ch) => {
        const c = this.charData(ch.id); if (c.unlocked) return;
        const u = ch.unlock; let ok = false;
        if (u.type === 'start') ok = true;
        else if (u.type === 'time') ok = d.stats.bestTime >= u.v;
        else if (u.type === 'kills') ok = d.stats.kills >= u.v;
        else if (u.type === 'boss') ok = d.stats.bossKills >= u.v;
        else if (u.type === 'level') ok = d.stats.bestLevel >= u.v;
        else if (u.type === 'evolve') ok = d.stats.evolves >= u.v;
        else if (u.type === 'charlevel') ok = Object.values(d.chars).some((x) => x.level >= u.v);
        if (ok) { c.unlocked = true; out.push({ type: 'char', id: ch.id, text: 'New character: ' + ch.name + ', ' + ch.title }); }
      });
      SF.STAGES.forEach((s) => {
        if (d.stages.unlocked.includes(s.id)) return;
        if (s.unlock && (d.stages.best[s.unlock.stage] || 0) >= s.unlock.time) { d.stages.unlocked.push(s.id); out.push({ type: 'stage', id: s.id, text: 'New stage: ' + s.name }); }
      });
      SF.MILESTONES.forEach((m) => {
        if (d.codex.claimed['ms_' + m.id]) return;
        try { if (m.check(d) && !d.seen['ms_' + m.id]) { d.seen['ms_' + m.id] = true; out.push({ type: 'milestone', id: m.id, text: 'Milestone: ' + m.name }); } } catch (e) { }
      });
      SF.CHARACTERS.forEach((ch) => {
        const c = this.charData(ch.id);
        ch.codex.forEach((chap, i) => {
          if (c.chapters[i]) return;
          if (this.chapterMet(ch.id, i) && !d.seen['ch_' + ch.id + i]) { d.seen['ch_' + ch.id + i] = true; out.push({ type: 'chapter', id: ch.id, idx: i, text: ch.name + ' — chapter unlocked: ' + chap.title }); }
        });
      });
      return out;
    },
    chapterMet(charId, i) {
      const c = this.charData(charId), req = SF.CHAR_BY_ID[charId].codex[i].req;
      if (req.type === 'runs') return c.runs >= req.v;
      if (req.type === 'time') return c.bestTime >= req.v;
      if (req.type === 'kills') return c.kills >= req.v;
      if (req.type === 'bosses') return c.bosses >= req.v;
      return false;
    },
    claimChapter(charId, i) { const c = this.charData(charId); if (c.chapters[i] || !this.chapterMet(charId, i)) return false; c.chapters[i] = true; this.save(); return true; },
    /* ---------- meta stat aggregation ---------- */
    computeMeta(charId) {
      const d = this.data, ch = SF.CHAR_BY_ID[charId], c = this.charData(charId);
      const stats = {}, flags = {}, weaponMastery = {};
      const add = (k, v) => { stats[k] = (stats[k] || 0) + v; };
      const addAll = (o, m = 1) => { for (const k in o) add(k, o[k] * m); };
      // anvil
      SF.ANVIL.forEach((a) => { const r = d.anvil[a.id] || 0; if (r) add(a.stat, a.per * r); });
      // talents
      ch.talents.forEach((b) => b.nodes.forEach((n) => { const r = c.talents[n.id] || 0; if (!r) return; if (n.per) addAll(n.per, r); if (n.flag) { flags[n.flag] = true; if (SF.FLAG_STATS[n.flag]) addAll(SF.FLAG_STATS[n.flag]); } }));
      SF.PARAGON.forEach((p) => { const r = c.paragon[p.id] || 0; if (r) add(p.stat, p.per * r); });
      // codex chapters
      ch.codex.forEach((chap, i) => { if (!c.chapters[i]) return; const rw = chap.reward; if (rw.stats) addAll(rw.stats); if (rw.flag) { flags[rw.flag] = true; if (SF.FLAG_STATS[rw.flag]) addAll(SF.FLAG_STATS[rw.flag]); } });
      // equipment
      for (const slot in d.equipped) { const it = d.items.find((x) => x.uid === d.equipped[slot]); if (!it) continue; addAll(SF.itemStats(it)); if (it.unique) { const u = SF.UNIQUE_BY_ID[it.unique]; if (u && u.flag) flags[u.flag] = true; } }
      // sigils
      SF.SIGILS.forEach((s) => { if (!d.sigils[s.id]) return; if (s.stats) addAll(s.stats); if (s.flag) flags[s.flag] = true; });
      // bestiary / boss codex bonuses
      for (const id in d.codex.enemies) { const t = this.bestiaryTier(id); if (t) addAll(SF.BESTIARY_STAT, t); }
      for (const id in d.codex.bosses) { const t = this.bossTier(id); if (t) addAll(SF.BOSS_STAT, t); }
      // armory mastery
      for (const wid in d.codex.weapons) { const w = d.codex.weapons[wid]; let m = 0; if (w.maxed) m += 0.05; if (w.evolved) m += 0.1; if (m) weaponMastery[wid] = m; }
      return { stats, flags, weaponMastery };
    },
    bestiaryTier(id) { const k = this.data.codex.enemies[id] || 0; let t = 0; SF.BESTIARY_TIERS.forEach((v) => { if (k >= v) t++; }); return t; },
    bossTier(id) { const k = this.data.codex.bosses[id] || 0; let t = 0; SF.BOSS_TIERS.forEach((v) => { if (k >= v) t++; }); return t; },
    /* ---------- currencies ---------- */
    canAfford(cost) { const d = this.data; if (cost.gold && d.gold < cost.gold) return false; if (cost.embers && d.embers < cost.embers) return false; for (const m of ['iron', 'dust', 'crystal', 'star']) { const need = cost[m] || (cost.mats && cost.mats[m]) || 0; if (d.mats[m] < need) return false; } return true; },
    pay(cost) { const d = this.data; if (cost.gold) { d.gold -= cost.gold; this.addForgeXp(cost.gold); } if (cost.embers) d.embers -= cost.embers; for (const m of ['iron', 'dust', 'crystal', 'star']) { const need = cost[m] || (cost.mats && cost.mats[m]) || 0; d.mats[m] -= need; } },
    grant(rw) { const d = this.data; if (rw.gold) { d.gold += rw.gold; d.stats.goldEarned += rw.gold; } if (rw.embers) d.embers += rw.embers; for (const m of ['iron', 'dust', 'crystal', 'star']) if (rw[m]) d.mats[m] += rw[m]; },
    addForgeXp(xp) { const f = this.data.forge; f.xp += xp; let ups = 0; while (f.xp >= SF.forgeXpFor(f.level)) { f.xp -= SF.forgeXpFor(f.level); f.level++; ups++; } return ups; },
    /* ---------- forge transactions ---------- */
    anvilTotal() { let n = 0; for (const k in this.data.anvil) n += this.data.anvil[k]; return n; },
    buyAnvil(a) {
      const d = this.data, r = d.anvil[a.id] || 0;
      if (r >= a.max) return 'Maxed.';
      if (this.anvilTotal() < SF.ANVIL_TIER_REQ[a.tier]) return 'Locked.';
      const cost = SF.anvilCost(a, r);
      if (d.gold < cost) return 'Not enough gold.';
      this.pay({ gold: cost }); d.anvil[a.id] = r + 1; this.save(); return null;
    },
    craft(slotId, catalystId) {
      const d = this.data, L = d.forge.level, cost = SF.craftCost(L);
      const cat = SF.CATALYSTS.find((c) => c.id === catalystId) || SF.CATALYSTS[0];
      const full = Object.assign({}, cost, cat.cost);
      if (!this.canAfford(full)) return { err: 'Not enough resources.' };
      if (d.items.length >= 60) return { err: 'Inventory full (60). Salvage something.' };
      this.pay(full);
      const luck = 0;
      const item = SF.craftItem(slotId, L, { minRarity: cat.minRarity, luck });
      item.spent = cost.gold;
      d.items.push(item);
      if (SF.RARITY_BY_ID[item.rarity].index >= 4) d.stats.legendaries++;
      if (item.unique) d.codex.uniques[item.unique] = true;
      this.save();
      return { item };
    },
    upgradeItem(uid) {
      const d = this.data, it = d.items.find((x) => x.uid === uid); if (!it) return 'No item.';
      const r = SF.RARITY_BY_ID[it.rarity]; if (it.level >= r.maxUp) return 'Max upgrade level.';
      const cost = SF.upgradeCost(it); if (!this.canAfford(cost)) return 'Not enough resources.';
      this.pay(cost); it.level++; it.spent += cost.gold; this.save(); return null;
    },
    salvage(uid) {
      const d = this.data, i = d.items.findIndex((x) => x.uid === uid); if (i < 0) return null;
      const it = d.items[i]; const v = SF.salvageValue(it);
      for (const slot in d.equipped) if (d.equipped[slot] === uid) delete d.equipped[slot];
      d.items.splice(i, 1); this.grant(v); this.save(); return v;
    },
    reforge(uid, affixIdx) {
      const d = this.data, it = d.items.find((x) => x.uid === uid); if (!it) return 'No item.';
      if (!SF.forgeLevelPerks(d.forge.level).reforge) return 'Requires Forge level 3.';
      const cost = SF.reforgeCost(); if (!this.canAfford(cost)) return 'Not enough resources.';
      const slot = SF.SLOT_BY_ID[it.slot]; const used = it.affixes.map((a) => a.stat);
      const pool = slot.affixes.filter((s) => !used.includes(s) || s === it.affixes[affixIdx].stat);
      const stat = U.pick(pool), rng = SF.AFFIX[stat], r = SF.RARITY_BY_ID[it.rarity];
      this.pay(cost); it.spent += cost.gold;
      it.affixes[affixIdx] = { stat, base: U.rand(rng[0], rng[1]) * SF.forgeLevelPerks(it.ilvl).valueMult * r.mult * 1.1 };
      this.save(); return null;
    },
    equip(uid) { const d = this.data, it = d.items.find((x) => x.uid === uid); if (!it) return; d.equipped[it.slot] = uid; this.save(); },
    unequip(slot) { delete this.data.equipped[slot]; this.save(); },
    transmute(rec, times = 1) {
      const d = this.data;
      for (let i = 0; i < times; i++) { if (!this.canAfford(rec.from)) return i === 0 ? 'Not enough materials.' : null; this.pay(rec.from); this.grant(rec.to); }
      this.save(); return null;
    },
    buySigil(s) { const d = this.data; if (d.sigils[s.id]) return 'Owned.'; if (d.embers < s.cost) return 'Not enough Soul Embers.'; d.embers -= s.cost; d.sigils[s.id] = true; this.save(); return null; },
    /* ---------- codex claims ---------- */
    claim(key, reward) { const d = this.data; if (d.codex.claimed[key]) return false; d.codex.claimed[key] = true; this.grant(reward); this.save(); return true; },
    /* ---------- run results ---------- */
    recordRun(r) {
      const d = this.data, c = this.charData(r.charId);
      d.stats.runs++; c.runs++;
      d.stats.kills += r.kills; c.kills += r.kills;
      d.stats.bossKills += r.bossKills; c.bosses += r.bossKills;
      d.stats.elites += r.elites || 0;
      d.stats.totalTime += r.time;
      d.stats.bestTime = Math.max(d.stats.bestTime, r.time); c.bestTime = Math.max(c.bestTime, r.time);
      d.stats.bestLevel = Math.max(d.stats.bestLevel, r.level); c.bestLevel = Math.max(c.bestLevel, r.level);
      d.stats.evolves += r.evolves;
      if (r.time >= 600) d.stats.bestHeat10 = Math.max(d.stats.bestHeat10, r.heat);
      d.stages.best[r.stageId] = Math.max(d.stages.best[r.stageId] || 0, r.time);
      this.grant({ gold: r.gold, embers: r.embers, iron: r.mats.iron, dust: r.mats.dust, crystal: r.mats.crystal, star: r.mats.star });
      for (const id in r.enemyKills) d.codex.enemies[id] = (d.codex.enemies[id] || 0) + r.enemyKills[id];
      for (const id in r.bossKillsBy) d.codex.bosses[id] = (d.codex.bosses[id] || 0) + r.bossKillsBy[id];
      r.weapons.forEach((w) => { const e = d.codex.weapons[w.id] || (d.codex.weapons[w.id] = {}); e.found = true; if (w.level >= SF.WEAPONS[w.id].max) e.maxed = true; if (w.evolved) e.evolved = true; e.dmg = Math.max(e.dmg || 0, w.dmg || 0); });
      const ups = this.addCharXp(r.charId, r.charXp);
      const unlocks = this.checkUnlocks();
      this.save();
      return { levelUps: ups, unlocks };
    },
  };

  function deepMerge(base, over) {
    if (Array.isArray(base)) return Array.isArray(over) ? over : base;
    if (typeof base !== 'object' || base === null) return over === undefined ? base : over;
    const out = Object.assign({}, base);
    for (const k in over) { out[k] = (k in base && typeof base[k] === 'object' && base[k] !== null && !Array.isArray(base[k])) ? deepMerge(base[k], over[k]) : over[k]; }
    return out;
  }

  SF.Save = Save;
})();
