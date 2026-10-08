/* SOULFORGE — DOM user interface: menus, HUD, modals */
'use strict';
(function () {
  const U = SF.U, S = SF.Sprites;
  const $ = (id) => document.getElementById(id);
  const ic = (spec, cls = '') => `<img class="icon ${cls}" src="${S.iconURL(spec)}" alt="">`;
  const esc = U.esc;

  const UI = {
    game: null, R: null, selChar: 'kael', selStage: 'ashen', forgeTab: 'anvil', codexTab: 'chronicles', selItem: null, craftSlot: 'charm', craftCat: 'none', banishMode: false, hudEls: null, screenName: null,

    init(game, renderer) {
      this.game = game; this.R = renderer;
      this.selChar = SF.Save.data.lastChar || 'kael'; this.selStage = SF.Save.data.lastStage || 'ashen';
      this.buildHud();
      this.showTitle();
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          if ($('modal').classList.contains('hidden')) { if (this.game.state === 'play') this.showPause(); }
          else if (this.game.state === 'paused') this.closePause();
        }
      });
    },

    /* ---------- basic helpers ---------- */
    screen(name, html) {
      const root = $('screens'); root.innerHTML = '';
      const d = document.createElement('div'); d.className = 'screen'; d.id = name; d.innerHTML = html; root.appendChild(d);
      this.screenName = name;
      return d;
    },
    modal(html, cls = '') { const m = $('modal'); m.innerHTML = `<div class="panel modal-box ${cls}">${html}</div>`; m.classList.remove('hidden'); return m; },
    closeModal() { $('modal').classList.add('hidden'); $('modal').innerHTML = ''; },
    currencyBar() {
      const d = SF.Save.data;
      return `<div class="currency"><span title="Gold">${ic({ g: 'coin', c: '#f5c542' }, 'sm')} ${U.fmt(d.gold)}</span><span title="Soul Embers">${ic({ g: 'ember', c: '#ff8a3c' }, 'sm')} ${d.embers}</span>` +
        SF.MATERIALS.map((m) => `<span title="${m.name}">${ic(m.icon, 'sm')} ${d.mats[m.id]}</span>`).join('') + '</div>';
    },
    head(title, backFn, extra = '') {
      return `<div class="screen-head"><div class="row"><button class="btn small" id="backBtn">◀ Back</button><h2>${title}</h2></div><div class="row">${extra}${this.currencyBar()}</div></div>`;
    },
    bindBack(fn) { const b = $('backBtn'); if (b) b.onclick = () => { SF.Audio.play('uiback'); fn(); }; },
    toast(text) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = text; document.body.appendChild(t); setTimeout(() => t.remove(), 2200); },
    notice(text, color, dur) {
      const n = document.createElement('div'); n.className = 'notice'; n.textContent = text; n.style.color = color || '#fff'; n.style.animationDuration = `0.4s, 0.6s`; n.style.animationDelay = `0s, ${(dur || 2.5) - 0.6}s`;
      $('notices').appendChild(n); setTimeout(() => n.remove(), (dur || 2.5) * 1000);
    },

    /* ============ TITLE ============ */
    showTitle() {
      this.game.state = 'idle'; $('hud').classList.add('hidden'); this.closeModal();
      const d = SF.Save.data;
      const s = this.screen('title', `
        <div class="title-stats panel" style="padding:8px 14px">${this.currencyBar()}</div>
        <div class="logo"><h1>SOULFORGE</h1><div class="sub">Endless Night</div></div>
        <div class="menu">
          <button class="btn primary" id="playBtn">Play</button>
          <button class="btn" id="talentsBtn">Talents</button>
          <button class="btn" id="forgeBtn">Forge</button>
          <button class="btn" id="codexBtn">Codex</button>
          <button class="btn" id="settingsBtn">Settings</button>
        </div>
        <div class="title-foot">Best: ${U.fmtTime(d.stats.bestTime)} · Kills: ${U.fmt(d.stats.kills)} · Runs: ${d.stats.runs} &nbsp;|&nbsp; <span class="kbd">WASD</span> move · <span class="kbd">SPACE</span> ability · <span class="kbd">ESC</span> pause</div>`);
      $('playBtn').onclick = () => { SF.Audio.play('ui'); this.showChars(); };
      $('talentsBtn').onclick = () => { SF.Audio.play('ui'); this.showTalents(); };
      $('forgeBtn').onclick = () => { SF.Audio.play('ui'); this.showForge(); };
      $('codexBtn').onclick = () => { SF.Audio.play('ui'); this.showCodex(); };
      $('settingsBtn').onclick = () => { SF.Audio.play('ui'); this.showSettings(); };
      const nu = SF.Save.checkUnlocks(); if (nu.length) { SF.Save.save(); nu.forEach((n, i) => setTimeout(() => this.notice(n.text, '#4ade80', 4), i * 600)); }
    },

    /* ============ CHARACTER SELECT ============ */
    showChars() {
      const d = SF.Save.data;
      this.screen('chars', this.head('Choose your Champion', null) + `<div class="screen-body layout-2"><div class="char-grid" id="charGrid"></div><div class="panel" style="padding:16px" id="charDetail"></div></div>`);
      this.bindBack(() => this.showTitle());
      const grid = $('charGrid');
      grid.innerHTML = SF.CHARACTERS.map((c) => {
        const cd = SF.Save.charData(c.id);
        return `<div class="char-card ${cd.unlocked ? '' : 'locked'} ${c.id === this.selChar ? 'sel' : ''}" data-id="${c.id}">
          <img src="${S.portraitURL(c)}"><div class="lvl">Lv ${cd.level}</div><div class="nm">${c.name}</div><div class="tt">${c.title}</div>
          ${cd.unlocked ? '' : `<div class="lock">${ic({ g: 'lock', c: '#999' }, 'sm')}<div>${c.unlock.text || 'Locked'}</div></div>`}</div>`;
      }).join('');
      grid.querySelectorAll('.char-card').forEach((el) => el.onclick = () => { this.selChar = el.dataset.id; SF.Audio.play('ui'); grid.querySelectorAll('.char-card').forEach((x) => x.classList.toggle('sel', x.dataset.id === this.selChar)); this.renderCharDetail(); });
      this.renderCharDetail();
    },
    renderCharDetail() {
      const c = SF.CHAR_BY_ID[this.selChar], cd = SF.Save.charData(c.id), meta = SF.Save.computeMeta(c.id);
      const sig = SF.WEAPONS[c.signature];
      const base = Object.assign({}, SF.CHAR_BASE, c.stats);
      const show = [['maxHp', Math.round(base.maxHp + (meta.stats.maxHp || 0))], ['armor', (base.armor + (meta.stats.armor || 0)).toFixed(1)], ['speed', Math.round(base.speed * (1 + (meta.stats.speed || 0)))], ['might', U.pct(base.might + (meta.stats.might || 0))], ['area', U.pct(base.area + (meta.stats.area || 0))], ['cooldown', U.pct(base.cooldown * (1 - (meta.stats.cooldown || 0)))], ['crit', U.pct(base.crit + (meta.stats.crit || 0))], ['dodge', U.pct(base.dodge + (meta.stats.dodge || 0))], ['luck', U.pct(base.luck + (meta.stats.luck || 0))], ['growth', U.pct(base.growth + (meta.stats.growth || 0))]];
      const chapters = c.codex.map((ch, i) => cd.chapters[i] ? `<span class="tag" style="background:#3b2a5a;color:#e9d5ff">${ch.title}</span>` : '').join(' ');
      const xpNeed = SF.charXpFor(cd.level);
      $('charDetail').innerHTML = `
        <div class="char-detail"><div><img class="big-portrait" src="${S.portraitURL(c, 260)}"><h2 style="margin:8px 0 0;color:var(--gold)">${c.name}</h2><div class="muted">${c.title}</div>
          <div style="margin:8px 0 4px;font-size:13px" class="muted">Level ${cd.level} · ${U.fmt(cd.xp)} / ${U.fmt(xpNeed)} XP · ${SF.Save.talentPointsFree(c.id)} talent pts free</div><div class="bar"><i style="width:${(cd.xp / xpNeed * 100).toFixed(1)}%"></i></div>
          <p style="font-style:italic;color:#b9b5c8;font-size:14px">${c.lore}</p><div>${chapters}</div></div>
        <div class="col">
          <div class="stat-grid">${show.map(([k, v]) => `<div><span class="muted">${SF.statName(k)}</span><b>${v}</b></div>`).join('')}</div>
          <div class="kit">${ic(sig.icon)}<div><h4>${sig.name} <span class="muted" style="font-weight:400;font-size:12px">— signature weapon</span></h4><p>${sig.desc}</p><p class="muted" style="font-size:12px">Evolves with ${SF.PASSIVE_BY_ID[sig.evo.with].name} → <b>${sig.evo.name}</b></p></div></div>
          <div class="kit">${ic({ g: 'star', c: c.colors.accent })}<div><h4>${c.trait.name} <span class="muted" style="font-weight:400;font-size:12px">— trait</span></h4><p>${c.trait.desc}</p></div></div>
          <div class="kit">${ic(c.active.icon)}<div><h4>${c.active.name} <span class="muted" style="font-weight:400;font-size:12px">— active · ${c.active.cd}s · SPACE</span></h4><p>${c.active.desc}</p></div></div>
        </div></div>
        <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" id="toTalents">Talents</button><button class="btn primary" id="toSetup" ${cd.unlocked ? '' : 'disabled'}>Continue ▶</button></div>`;
      $('toTalents').onclick = () => { SF.Audio.play('ui'); this.showTalents(c.id, () => this.showChars()); };
      $('toSetup').onclick = () => { SF.Audio.play('ui'); SF.Save.data.lastChar = c.id; SF.Save.save(); this.showSetup(); };
    },

    /* ============ STAGE + OMENS ============ */
    showSetup() {
      const d = SF.Save.data;
      if (!d.stages.unlocked.includes(this.selStage)) this.selStage = 'ashen';
      const omensUnlocked = d.stats.bossKills >= 1;
      this.screen('setup', this.head('Choose the Night', null) + `<div class="screen-body layout-2"><div><h3 class="gold">Stage</h3><div class="stage-list" id="stageList"></div>
        <h3 class="gold" style="margin-top:20px">Omens <span class="muted" style="font-size:13px;font-weight:400">— optional pacts that raise the Heat. Each Heat: +8% gold, XP and materials.</span></h3>
        ${omensUnlocked ? '<div class="col" id="omenList"></div>' : '<div class="muted panel" style="padding:12px">Defeat your first boss to unlock Omens.</div>'}</div>
        <div class="panel" style="padding:16px;position:sticky;top:10px" id="setupSide"></div></div>`);
      this.bindBack(() => this.showChars());
      const renderStages = () => {
        $('stageList').innerHTML = SF.STAGES.map((s) => { const un = d.stages.unlocked.includes(s.id); return `<div class="stage-card ${un ? '' : 'locked'} ${s.id === this.selStage ? 'sel' : ''}" data-id="${s.id}"><div class="swatch" style="background:linear-gradient(135deg,${s.pal.groundLight},${s.pal.ground} 60%,${s.pal.groundDark})"></div><h3>${s.name}</h3><div class="tip">${s.desc}</div><div class="row" style="margin-top:6px;font-size:13px"><span class="bad">Difficulty ×${s.diff}</span><span class="gold">Reward ×${s.reward}</span></div><div class="tip">Best: ${U.fmtTime(d.stages.best[s.id] || 0)}${un ? '' : ` · Unlock: survive ${U.fmtTime(s.unlock.time)} in ${SF.STAGE_BY_ID[s.unlock.stage].name}`}</div></div>`; }).join('');
        $('stageList').querySelectorAll('.stage-card').forEach((el) => el.onclick = () => { if (!d.stages.unlocked.includes(el.dataset.id)) return; this.selStage = el.dataset.id; SF.Audio.play('ui'); renderStages(); renderSide(); });
      };
      const renderOmens = () => {
        if (!omensUnlocked) return;
        $('omenList').innerHTML = SF.OMENS.map((o) => { const r = d.omens[o.id] || 0; return `<div class="omen">${ic(o.icon, 'sm')}<div class="grow"><b>${o.name}</b> <span class="muted">${o.desc}</span></div><div class="rk"><button data-id="${o.id}" data-d="-1">−</button><b style="min-width:36px;text-align:center">${r} / ${o.max}</b><button data-id="${o.id}" data-d="1">+</button></div></div>`; }).join('');
        $('omenList').querySelectorAll('button').forEach((b) => b.onclick = () => { const o = SF.OMEN_BY_ID[b.dataset.id]; d.omens[o.id] = U.clamp((d.omens[o.id] || 0) + +b.dataset.d, 0, o.max); SF.Audio.play('ui'); SF.Save.save(); renderOmens(); renderSide(); });
      };
      const renderSide = () => {
        const c = SF.CHAR_BY_ID[this.selChar], st = SF.STAGE_BY_ID[this.selStage];
        let heat = 0; for (const id in d.omens) heat += d.omens[id] || 0;
        $('setupSide').innerHTML = `<div class="row"><img src="${S.portraitURL(c, 96)}" style="width:72px;height:72px;border-radius:8px"><div><h3 style="margin:0;color:var(--gold)">${c.name}</h3><div class="muted">${c.title}</div></div></div>
          <div style="margin:12px 0"><b>${st.name}</b><div class="tip">${st.desc}</div></div>
          <div class="heat">HEAT ${heat}</div><div class="tip">Rewards ×${SF.heatBonus(heat).toFixed(2)} · Stage ×${st.reward}</div>
          <button class="btn primary" id="beginBtn" style="width:100%;margin-top:16px;font-size:20px">Begin the Night</button>`;
        $('beginBtn').onclick = () => { SF.Audio.play('buy'); d.lastStage = this.selStage; SF.Save.save(); this.startRun(); };
      };
      renderStages(); renderOmens(); renderSide();
    },
    startRun() {
      const d = SF.Save.data;
      const omens = {}; for (const id in d.omens) if (d.omens[id] > 0) omens[id] = d.omens[id];
      $('screens').innerHTML = ''; this.screenName = null;
      $('hud').classList.remove('hidden');
      SF.Audio.resume(); if (d.settings.music > 0) SF.Audio.startMusic();
      this.game.start(this.selChar, this.selStage, omens);
      this.buildSlots();
    },

    /* ============ TALENTS ============ */
    showTalents(charId, back) {
      if (charId) this.selChar = charId;
      this.screen('talents', this.head('Talents', null, '<button class="btn small" id="respecBtn">Respec (free)</button>') + `<div class="screen-body talent-layout"><div class="char-list panel" style="padding:8px" id="tCharList"></div><div id="tTree"></div></div>`);
      this.bindBack(back || (() => this.showTitle()));
      $('respecBtn').onclick = () => { if (confirm('Reset all talent points for this character?')) { SF.Save.respec(this.selChar); SF.Audio.play('ui'); this.renderTalents(); } };
      const list = $('tCharList');
      const renderList = () => { list.innerHTML = SF.CHARACTERS.map((c) => { const cd = SF.Save.charData(c.id); return `<div class="ci ${c.id === this.selChar ? 'sel' : ''} ${cd.unlocked ? '' : 'muted'}" data-id="${c.id}"><img src="${S.portraitURL(c, 48)}"><div><b>${c.name}</b><div class="tip">Lv ${cd.level} · ${SF.Save.talentPointsFree(c.id)} pts</div></div></div>`; }).join(''); list.querySelectorAll('.ci').forEach((el) => el.onclick = () => { this.selChar = el.dataset.id; SF.Audio.play('ui'); renderList(); this.renderTalents(); }); };
      renderList(); this.renderTalents();
    },
    renderTalents() {
      const c = SF.CHAR_BY_ID[this.selChar], cd = SF.Save.charData(c.id), free = SF.Save.talentPointsFree(c.id);
      const branches = c.talents.map((b) => {
        const pts = SF.Save.branchPoints(c.id, b.id);
        return `<div class="branch"><h3 style="color:${b.color}">${b.name} <span class="muted" style="font-size:12px">${pts} pts</span></h3>${b.nodes.map((n) => {
          const r = cd.talents[n.id] || 0, avail = SF.Save.nodeAvailable(c.id, n), maxed = r >= n.max;
          return `<div class="tier-lbl">${n.keystone ? 'Keystone · needs 16 pts' : 'Tier ' + (n.tier + 1) + (n.tier ? ' · needs ' + n.tier * 4 + ' pts' : '')}</div><div class="node ${avail ? '' : 'locked'} ${maxed ? 'maxed' : ''} ${n.keystone ? 'keystone' : ''}" data-id="${n.id}"><div class="grow"><div class="nm">${n.name}</div><div class="ds">${n.desc}</div></div><div class="rank">${r}/${n.max}</div></div>`;
        }).join('')}</div>`;
      }).join('');
      const paragon = `<div class="panel" style="padding:14px;margin-top:16px"><h3 style="margin:0 0 4px;color:#c084fc">Paragon <span class="muted" style="font-size:13px;font-weight:400">— endless ranks, spend points here at any time</span></h3><div class="paragon">${SF.PARAGON.map((p) => `<div class="node" data-p="${p.id}">${ic(p.icon, 'sm')}<div class="grow"><div class="nm">${p.name}</div><div class="ds">${SF.statFmt(p.stat, p.per)} per rank</div></div><div class="rank">${cd.paragon[p.id] || 0}</div></div>`).join('')}</div></div>`;
      $('tTree').innerHTML = `<div class="row" style="margin-bottom:10px"><h3 style="margin:0;color:var(--gold)">${c.name}</h3><span class="muted">Level ${cd.level}</span><span class="tag" style="background:${free > 0 ? 'var(--gold)' : '#333'};color:${free > 0 ? '#000' : '#999'}">${free} points available</span><span class="tip grow">Each character level grants 1 point. Tiers unlock with points spent in that branch.</span></div><div class="branches">${branches}</div>${paragon}`;
      $('tTree').querySelectorAll('.node[data-id]').forEach((el) => el.onclick = () => { const node = c.talents.flatMap((b) => b.nodes).find((n) => n.id === el.dataset.id); const err = SF.Save.buyTalent(c.id, node); if (err) this.toast(err); else SF.Audio.play('buy'); this.renderTalents(); const li = document.querySelector('#tCharList .ci.sel .tip'); if (li) li.textContent = `Lv ${cd.level} · ${SF.Save.talentPointsFree(c.id)} pts`; });
      $('tTree').querySelectorAll('.node[data-p]').forEach((el) => el.onclick = () => { const err = SF.Save.buyParagon(c.id, el.dataset.p); if (err) this.toast(err); else SF.Audio.play('buy'); this.renderTalents(); });
    },

    /* ============ FORGE ============ */
    showForge(tab) {
      if (tab) this.forgeTab = tab;
      const d = SF.Save.data, f = d.forge, need = SF.forgeXpFor(f.level);
      this.screen('forge', this.head('The Forge', null) + `<div class="screen-body"><div class="row" style="margin-bottom:10px"><b class="gold">Forge Level ${f.level}</b><div class="bar grow" style="max-width:300px"><i style="width:${(f.xp / need * 100).toFixed(1)}%"></i></div><span class="tip">${U.fmt(f.xp)} / ${U.fmt(need)} · gold spent here levels the Forge: better rarities, stronger affixes, new features</span></div>
        <div class="tabs">${[['anvil', 'Anvil'], ['armory', 'Armory'], ['transmute', 'Transmute'], ['sigils', 'Sigils']].map(([id, n]) => `<button class="${this.forgeTab === id ? 'on' : ''}" data-t="${id}">${n}</button>`).join('')}</div><div id="forgeBody"></div></div>`);
      this.bindBack(() => this.showTitle());
      document.querySelectorAll('.tabs button').forEach((b) => b.onclick = () => { SF.Audio.play('ui'); this.showForge(b.dataset.t); });
      this['forge_' + this.forgeTab]();
    },
    refreshCurrency() { document.querySelectorAll('.currency').forEach((el) => el.outerHTML = this.currencyBar()); },
    forge_anvil() {
      const d = SF.Save.data, total = SF.Save.anvilTotal();
      const tiers = [[1, 'Foundation'], [2, 'Refinement'], [3, 'Mastercraft'], [4, 'Mastery — endless']];
      $('forgeBody').innerHTML = tiers.map(([t, name]) => { const req = SF.ANVIL_TIER_REQ[t], locked = total < req; return `<h3 class="gold" style="margin:14px 0 8px">${name} <span class="muted" style="font-size:13px;font-weight:400">${locked ? `— unlocks at ${req} total ranks (you have ${total})` : ''}</span></h3><div class="anvil-grid">${SF.ANVIL.filter((a) => a.tier === t).map((a) => { const r = d.anvil[a.id] || 0, cost = SF.anvilCost(a, r), maxed = r >= a.max; return `<div class="upg ${locked ? 'locked' : ''}">${ic(a.icon)}<div class="grow"><div class="nm">${a.name} <span class="muted">${a.max >= 999 ? r : r + '/' + a.max}</span></div><div class="ds">${SF.statName(a.stat)} ${SF.statFmt(a.stat, a.per)} per rank · total ${SF.statFmt(a.stat, a.per * r)}</div>${a.max < 999 ? `<div class="pips">${Array.from({ length: a.max }, (_, i) => `<i class="${i < r ? 'on' : ''}"></i>`).join('')}</div>` : ''}</div><button class="btn small ${maxed ? '' : 'primary'}" data-id="${a.id}" ${maxed || locked || d.gold < cost ? 'disabled' : ''}>${maxed ? 'MAX' : U.fmt(cost)}</button></div>`; }).join('')}</div>`; }).join('');
      $('forgeBody').querySelectorAll('button[data-id]').forEach((b) => b.onclick = () => { const err = SF.Save.buyAnvil(SF.ANVIL_BY_ID[b.dataset.id]); if (err) this.toast(err); else SF.Audio.play('forge'); this.refreshCurrency(); this.forge_anvil(); });
    },
    forge_armory() {
      const d = SF.Save.data, L = d.forge.level, perks = SF.forgeLevelPerks(L), cost = SF.craftCost(L);
      const cats = SF.CATALYSTS.filter((c) => !c.req || perks[c.req]);
      $('forgeBody').innerHTML = `<div class="forge-layout">
        <div class="col"><h3 class="gold" style="margin:0">Equipped</h3><div class="slots" id="eqSlots"></div>
          <h3 class="gold" style="margin:10px 0 0">Craft</h3><div class="panel" style="padding:10px" class="col">
            <label class="tip">Slot</label><select id="craftSlot" style="width:100%">${SF.SLOTS.map((s) => `<option value="${s.id}" ${s.id === this.craftSlot ? 'selected' : ''}>${s.name}</option>`).join('')}</select>
            <label class="tip" style="margin-top:6px;display:block">Catalyst</label><select id="craftCat" style="width:100%">${cats.map((c) => `<option value="${c.id}" ${c.id === this.craftCat ? 'selected' : ''}>${c.name}${c.desc ? ' — ' + c.desc : ''}</option>`).join('')}</select>
            <div class="tip" style="margin:8px 0" id="craftCost"></div><button class="btn primary" id="craftBtn" style="width:100%">Craft</button>
            <div class="tip" style="margin-top:8px">Rarity odds improve with Forge level. Epic from L4, Legendary from L6, Mythic from L10. Legendary+ items carry a unique power.</div></div></div>
        <div><h3 class="gold" style="margin:0 0 8px">Inventory <span class="muted" style="font-size:13px;font-weight:400">${d.items.length}/60</span></h3><div class="inv" id="inv"></div></div>
        <div class="panel" style="padding:12px;position:sticky;top:10px" id="itemDetail"><div class="muted">Select an item.</div></div></div>`;
      const renderCost = () => { const cat = SF.CATALYSTS.find((c) => c.id === this.craftCat); $('craftCost').innerHTML = `Cost: <b class="gold">${cost.gold} gold</b>, ${cost.iron} Iron` + Object.keys(cat.cost).map((m) => `, ${cat.cost[m]} ${SF.MAT_BY_ID[m].name}`).join(''); };
      $('craftSlot').onchange = (e) => { this.craftSlot = e.target.value; };
      $('craftCat').onchange = (e) => { this.craftCat = e.target.value; renderCost(); };
      $('craftBtn').onclick = () => { const r = SF.Save.craft(this.craftSlot, this.craftCat); if (r.err) { this.toast(r.err); return; } SF.Audio.play('forge'); this.selItem = r.item.uid; this.refreshCurrency(); this.forge_armory(); const rar = SF.RARITY_BY_ID[r.item.rarity]; if (rar.index >= 3) { this.notice(`Forged: ${r.item.name} (${rar.name})`, rar.color, 3); SF.Audio.play('evolve'); } else this.toast(`Forged: ${r.item.name} (${rar.name})`); };
      renderCost();
      const renderSlots = () => { $('eqSlots').innerHTML = SF.SLOTS.map((s) => { const it = d.items.find((x) => x.uid === d.equipped[s.id]); return `<div class="slot ${it && it.uid === this.selItem ? 'sel' : ''}" data-uid="${it ? it.uid : ''}">${ic(s.icon, 'sm')}<div><div class="tip">${s.name}</div>${it ? `<div class="r-${it.rarity}"><b>${it.name}</b> +${it.level}</div>` : '<div class="muted">— empty —</div>'}</div></div>`; }).join(''); $('eqSlots').querySelectorAll('.slot').forEach((el) => el.onclick = () => { if (el.dataset.uid) { this.selItem = el.dataset.uid; renderInv(); renderSlots(); renderDetail(); } }); };
      const renderInv = () => { const items = d.items.slice().sort((a, b) => SF.RARITY_BY_ID[b.rarity].index - SF.RARITY_BY_ID[a.rarity].index || b.level - a.level); $('inv').innerHTML = items.map((it) => { const eq = d.equipped[it.slot] === it.uid; return `<div class="item r-${it.rarity} ${it.uid === this.selItem ? 'sel' : ''}" data-uid="${it.uid}"><div class="row">${ic(SF.SLOT_BY_ID[it.slot].icon, 'sm')}<div><div class="nm">${it.name}</div><div class="rar">${SF.RARITY_BY_ID[it.rarity].name} +${it.level}</div></div></div>${eq ? '<div class="eq">EQUIPPED</div>' : ''}</div>`; }).join('') || '<div class="muted">No items yet. Craft one!</div>'; $('inv').querySelectorAll('.item').forEach((el) => el.onclick = () => { this.selItem = el.dataset.uid; SF.Audio.play('ui'); renderInv(); renderSlots(); renderDetail(); }); };
      const renderDetail = () => {
        const it = d.items.find((x) => x.uid === this.selItem); const box = $('itemDetail');
        if (!it) { box.innerHTML = '<div class="muted">Select an item.</div>'; return; }
        const r = SF.RARITY_BY_ID[it.rarity], eq = d.equipped[it.slot] === it.uid, up = SF.upgradeCost(it), maxed = it.level >= r.maxUp, u = it.unique ? SF.UNIQUE_BY_ID[it.unique] : null, sv = SF.salvageValue(it);
        box.innerHTML = `<h3 class="r-${it.rarity}" style="margin:0">${it.name}</h3><div class="tip">${r.name} ${SF.SLOT_BY_ID[it.slot].name} · +${it.level}/${r.maxUp} · item level ${it.ilvl}</div>
          <div style="margin:10px 0">${it.affixes.map((a, i) => `<div class="affix"><span>${SF.statName(a.stat)}</span><span><b class="good">${SF.statFmt(a.stat, SF.itemAffixValue(it, a))}</b> ${perks.reforge ? `<button class="btn small ghost" data-rf="${i}" title="Reforge this affix (${SF.reforgeCost().gold}g, 4 Dust, 1 Crystal)">⟳</button>` : ''}</span></div>`).join('')}
          ${u ? `<div class="affix" style="border-color:rgba(251,146,60,0.4)"><span class="r-legendary">★ ${u.name}</span></div><div class="tip" style="color:#fdba74">${u.desc}</div>` : ''}</div>
          <div class="col"><button class="btn ${eq ? '' : 'primary'}" id="eqBtn">${eq ? 'Unequip' : 'Equip'}</button>
          <button class="btn" id="upBtn" ${maxed ? 'disabled' : ''}>${maxed ? 'Max upgrade' : `Upgrade (+8% affixes) — ${up.gold}g` + Object.keys(up.mats).map((m) => `, ${up.mats[m]} ${SF.MAT_BY_ID[m].name}`).join('')}</button>
          <button class="btn danger" id="salvBtn">Salvage → ${Object.keys(sv).filter((k) => sv[k]).map((k) => sv[k] + ' ' + (k === 'gold' ? 'gold' : SF.MAT_BY_ID[k].name)).join(', ')}</button></div>`;
        $('eqBtn').onclick = () => { if (eq) SF.Save.unequip(it.slot); else SF.Save.equip(it.uid); SF.Audio.play('buy'); renderInv(); renderSlots(); renderDetail(); };
        $('upBtn').onclick = () => { const err = SF.Save.upgradeItem(it.uid); if (err) this.toast(err); else SF.Audio.play('forge'); this.refreshCurrency(); renderInv(); renderSlots(); renderDetail(); };
        $('salvBtn').onclick = () => { if (!confirm('Salvage ' + it.name + '?')) return; SF.Save.salvage(it.uid); this.selItem = null; SF.Audio.play('explode'); this.refreshCurrency(); renderInv(); renderSlots(); renderDetail(); };
        box.querySelectorAll('button[data-rf]').forEach((b) => b.onclick = () => { const err = SF.Save.reforge(it.uid, +b.dataset.rf); if (err) this.toast(err); else SF.Audio.play('forge'); this.refreshCurrency(); renderDetail(); });
      };
      renderSlots(); renderInv(); renderDetail();
    },
    forge_transmute() {
      const perks = SF.forgeLevelPerks(SF.Save.data.forge.level);
      if (!perks.transmute) { $('forgeBody').innerHTML = '<div class="panel" style="padding:20px" class="muted">Transmutation unlocks at Forge level 2. Spend gold in the Forge to level it.</div>'; return; }
      const fmtCost = (c) => Object.keys(c).map((k) => c[k] + ' ' + (k === 'gold' ? 'gold' : SF.MAT_BY_ID[k].name)).join(', ');
      $('forgeBody').innerHTML = SF.TRANSMUTE.map((r) => `<div class="recipe"><div class="grow"><b>${r.name}</b><div class="tip">${fmtCost(r.from)} → <span class="good">${fmtCost(r.to)}</span></div></div><button class="btn small" data-id="${r.id}" data-n="1">×1</button><button class="btn small" data-id="${r.id}" data-n="10">×10</button></div>`).join('');
      $('forgeBody').querySelectorAll('button').forEach((b) => b.onclick = () => { const r = SF.TRANSMUTE.find((x) => x.id === b.dataset.id); const err = SF.Save.transmute(r, +b.dataset.n); if (err) this.toast(err); else SF.Audio.play('forge'); this.refreshCurrency(); });
    },
    forge_sigils() {
      const d = SF.Save.data;
      $('forgeBody').innerHTML = `<div class="tip" style="margin-bottom:10px">Sigils are permanent run modifiers bought with <b style="color:#ff8a3c">Soul Embers</b> (dropped by bosses and elites).</div><div class="sigil-grid">${SF.SIGILS.map((s) => { const own = !!d.sigils[s.id]; return `<div class="sigil ${own ? 'owned' : ''}">${ic(s.icon)}<div class="grow"><b>${s.name}</b><div class="tip">${s.desc}</div></div><button class="btn small ${own ? '' : 'primary'}" data-id="${s.id}" ${own || d.embers < s.cost ? 'disabled' : ''}>${own ? 'OWNED' : s.cost + ' ✦'}</button></div>`; }).join('')}</div>`;
      $('forgeBody').querySelectorAll('button[data-id]').forEach((b) => b.onclick = () => { const err = SF.Save.buySigil(SF.SIGIL_BY_ID[b.dataset.id]); if (err) this.toast(err); else SF.Audio.play('buy'); this.refreshCurrency(); this.forge_sigils(); });
    },

    /* ============ CODEX ============ */
    showCodex(tab) {
      if (tab) this.codexTab = tab;
      this.screen('codex', this.head('Codex', null) + `<div class="screen-body"><div class="tabs">${[['chronicles', 'Chronicles'], ['bestiary', 'Bestiary'], ['armory', 'Armory'], ['relics', 'Relics'], ['milestones', 'Milestones']].map(([id, n]) => `<button class="${this.codexTab === id ? 'on' : ''}" data-t="${id}">${n}</button>`).join('')}</div><div id="codexBody"></div></div>`);
      this.bindBack(() => this.showTitle());
      document.querySelectorAll('.tabs button').forEach((b) => b.onclick = () => { SF.Audio.play('ui'); this.showCodex(b.dataset.t); });
      this['codex_' + this.codexTab]();
    },
    claimBtn(key, reward, ok, label = 'Claim') {
      const claimed = SF.Save.data.codex.claimed[key];
      const rw = Object.keys(reward).map((k) => reward[k] + ' ' + (k === 'gold' ? 'gold' : k === 'embers' ? 'embers' : SF.MAT_BY_ID[k].name)).join(', ');
      return claimed ? `<span class="tag" style="background:#1f3a2a;color:#4ade80">Claimed</span>` : `<button class="btn small primary" data-claim="${key}" ${ok ? '' : 'disabled'}>${label}: ${rw}</button>`;
    },
    bindClaims(refresh) { $('codexBody').querySelectorAll('button[data-claim]').forEach((b) => b.onclick = () => { const [key, reward] = this._claims[b.dataset.claim]; if (SF.Save.claim(key, reward)) { SF.Audio.play('buy'); this.refreshCurrency(); refresh(); } }); },
    codex_chronicles() {
      const d = SF.Save.data; this._claims = {};
      const c = SF.CHAR_BY_ID[this.selChar], cd = SF.Save.charData(c.id);
      const reqText = (r) => r.type === 'runs' ? `Complete ${r.v} run` : r.type === 'time' ? `Survive ${U.fmtTime(r.v)}` : r.type === 'kills' ? `Kill ${U.fmt(r.v)} enemies` : `Defeat ${r.v} bosses`;
      const prog = (r) => r.type === 'runs' ? cd.runs : r.type === 'time' ? cd.bestTime : r.type === 'kills' ? cd.kills : cd.bosses;
      $('codexBody').innerHTML = `<div class="talent-layout"><div class="char-list panel" style="padding:8px">${SF.CHARACTERS.map((x) => `<div class="ci ${x.id === this.selChar ? 'sel' : ''}" data-id="${x.id}"><img src="${S.portraitURL(x, 48)}"><div><b>${x.name}</b><div class="tip">${Object.keys(SF.Save.charData(x.id).chapters).length}/5 chapters</div></div></div>`).join('')}</div>
        <div><h3 class="gold" style="margin:0 0 4px">${c.name}, ${c.title}</h3><p class="tip" style="margin:0 0 12px">Chapters unlock as you play this character. Each chapter grants a permanent reward — awakenings expand the character's kit.</p>
        ${c.codex.map((ch, i) => { const done = !!cd.chapters[i], met = SF.Save.chapterMet(c.id, i); const rw = ch.reward; const rwText = [rw.desc ? `<span style="color:#e9d5ff">${rw.desc}</span>` : '', rw.stats ? Object.keys(rw.stats).map((k) => SF.statName(k) + ' ' + SF.statFmt(k, rw.stats[k])).join(', ') : ''].filter(Boolean).join(' · '); return `<div class="chapter ${done ? 'done' : met ? '' : 'locked'}"><div class="num">${['I', 'II', 'III', 'IV', 'V'][i]}</div><div class="grow"><b>${ch.title}</b><div class="lore" style="font-style:italic;color:#b9b5c8;font-size:13px">${done || met ? ch.lore : '???'}</div><div class="tip">Requirement: ${reqText(ch.req)} (${ch.req.type === 'time' ? U.fmtTime(prog(ch.req)) : U.fmt(prog(ch.req))})</div><div style="font-size:14px;margin-top:4px">Reward: ${rwText}</div></div><div>${done ? '<span class="tag" style="background:#1f3a2a;color:#4ade80">Unlocked</span>' : `<button class="btn small primary" data-ch="${i}" ${met ? '' : 'disabled'}>Unlock</button>`}</div></div>`; }).join('')}</div></div>`;
      $('codexBody').querySelectorAll('.ci').forEach((el) => el.onclick = () => { this.selChar = el.dataset.id; SF.Audio.play('ui'); this.codex_chronicles(); });
      $('codexBody').querySelectorAll('button[data-ch]').forEach((b) => b.onclick = () => { if (SF.Save.claimChapter(c.id, +b.dataset.ch)) { SF.Audio.play('evolve'); this.notice('Chapter unlocked: ' + c.codex[+b.dataset.ch].title, '#e9d5ff', 3); this.codex_chronicles(); } });
    },
    codex_bestiary() {
      const d = SF.Save.data; this._claims = {};
      const ent = (id, def, kills, tiers, rewards, statText, isBoss) => { const seen = kills > 0 || d.codex[isBoss ? 'bosses' : 'enemies'][id] != null; return `<div class="entry ${seen ? '' : 'locked'}"><div class="row"><img src="${S.enemy(id, 18, def.col, 0).toDataURL()}" style="width:56px;height:56px;border-radius:8px;background:#0006"><div><h4>${seen ? def.name : '???'}</h4><div class="tip">${U.fmt(kills)} kills</div></div></div><div class="lore">${seen ? def.lore : 'Not yet encountered.'}</div><div class="tip">${statText} per tier</div><div class="col" style="gap:4px;margin-top:6px">${tiers.map((t, i) => { const key = (isBoss ? 'boss_' : 'be_') + id + '_' + i; this._claims[key] = [key, rewards[i]]; return `<div class="row" style="font-size:13px"><span class="grow">Tier ${i + 1}: ${U.fmt(t)} kills</span>${this.claimBtn(key, rewards[i], kills >= t)}</div>`; }).join('')}</div></div>`; };
      $('codexBody').innerHTML = `<p class="tip">Every bestiary tier grants a permanent global bonus. Bosses grant max health.</p><div class="codex-grid">${Object.keys(SF.ENEMIES).filter((k) => !SF.ENEMIES[k].noSpawn).map((id) => ent(id, SF.ENEMIES[id], d.codex.enemies[id] || 0, SF.BESTIARY_TIERS, SF.BESTIARY_REWARD, '+1% Might', false)).join('')}</div><h3 class="gold">Bosses</h3><div class="codex-grid">${SF.BOSS_ORDER.map((id) => ent(id, SF.BOSSES[id], d.codex.bosses[id] || 0, SF.BOSS_TIERS, SF.BOSS_REWARD, '+2% Max Health', true)).join('')}</div>`;
      this.bindClaims(() => this.codex_bestiary());
    },
    codex_armory() {
      const d = SF.Save.data; this._claims = {};
      const ws = Object.values(SF.WEAPONS);
      $('codexBody').innerHTML = `<p class="tip">Discover, master (max level) and evolve each weapon. Mastered weapons deal +5% damage, evolved +10% more — permanently.</p><div class="codex-grid">${ws.map((w) => { const e = d.codex.weapons[w.id] || {}; const seen = !!e.found; return `<div class="entry ${seen ? '' : 'locked'}"><div class="row">${ic(w.icon)}<div><h4>${seen ? w.name : '???'}</h4><div class="tip">${w.char ? 'Signature: ' + SF.CHAR_BY_ID[w.char].name : 'General weapon'}${e.dmg ? ' · best ' + U.fmt(e.dmg) + ' dmg' : ''}</div></div></div><div class="lore">${seen ? w.desc : 'Undiscovered.'}</div>${seen ? `<div class="tip">Evolves with ${SF.PASSIVE_BY_ID[w.evo.with].name} → <b>${w.evo.name}</b>: ${w.evo.desc}</div>` : ''}<div class="col" style="gap:4px;margin-top:6px">${SF.ARMORY_STAGES.map((st) => { const key = 'ar_' + w.id + '_' + st.id; this._claims[key] = [key, st.reward]; return `<div class="row" style="font-size:13px"><span class="grow">${st.name}</span>${this.claimBtn(key, st.reward, !!e[st.id])}</div>`; }).join('')}</div></div>`; }).join('')}</div>`;
      this.bindClaims(() => this.codex_armory());
    },
    codex_relics() {
      const d = SF.Save.data;
      $('codexBody').innerHTML = `<p class="tip">Unique powers found on Legendary and Mythic gear crafted at the Forge.</p><div class="codex-grid">${SF.UNIQUES.map((u) => { const seen = !!d.codex.uniques[u.id]; return `<div class="entry ${seen ? '' : 'locked'}"><h4>${seen ? u.name : '???'}</h4><div class="lore">${seen ? u.desc : 'Not yet forged.'}</div></div>`; }).join('')}</div>`;
    },
    codex_milestones() {
      const d = SF.Save.data; this._claims = {};
      $('codexBody').innerHTML = `<div class="codex-grid">${SF.MILESTONES.map((m) => { let ok = false; try { ok = m.check(d); } catch (e) { } const key = 'ms_' + m.id; this._claims[key] = [key, m.reward]; return `<div class="entry ${ok || d.codex.claimed[key] ? '' : 'locked'}"><h4>${m.name}</h4><div class="lore">${m.desc}</div>${this.claimBtn(key, m.reward, ok)}</div>`; }).join('')}</div>`;
      this.bindClaims(() => this.codex_milestones());
    },

    /* ============ SETTINGS ============ */
    showSettings() {
      const s = SF.Save.data.settings;
      this.screen('settings', this.head('Settings', null) + `<div class="screen-body" style="max-width:700px"><div class="panel" style="padding:10px 16px">
        <div class="setting"><span>Sound effects</span><input type="range" min="0" max="1" step="0.05" value="${s.sfx}" id="sfxR"></div>
        <div class="setting"><span>Music</span><input type="range" min="0" max="1" step="0.05" value="${s.music}" id="musR"></div>
        <div class="setting"><span>Screen shake</span><input type="checkbox" ${s.shake ? 'checked' : ''} id="shakeC"></div>
        <div class="setting"><span>Damage numbers</span><input type="checkbox" ${s.dmgNumbers ? 'checked' : ''} id="dmgC"></div>
        <div class="setting"><span>Show FPS</span><input type="checkbox" ${s.fps ? 'checked' : ''} id="fpsC"></div>
        <div class="setting"><span>Render quality</span><select id="qualS"><option value="0.6" ${s.quality === 0.6 ? 'selected' : ''}>Low</option><option value="0.8" ${s.quality === 0.8 ? 'selected' : ''}>Medium</option><option value="1" ${s.quality === 1 ? 'selected' : ''}>High</option></select></div>
        <div class="setting"><span>Save data</span><div class="row"><button class="btn small" id="expBtn">Export</button><button class="btn small" id="impBtn">Import</button><button class="btn small danger" id="resetBtn">Reset</button></div></div>
        <textarea id="saveTxt" placeholder="Export writes your save code here. Paste a code and press Import to restore."></textarea></div></div>`);
      this.bindBack(() => this.showTitle());
      $('sfxR').oninput = (e) => { s.sfx = +e.target.value; SF.Audio.setSfx(s.sfx); SF.Save.save(); };
      $('sfxR').onchange = () => SF.Audio.play('ui');
      $('musR').oninput = (e) => { s.music = +e.target.value; SF.Audio.setMusic(s.music); SF.Save.save(); };
      $('shakeC').onchange = (e) => { s.shake = e.target.checked ? 1 : 0; this.R.fx.shakeMul = s.shake; SF.Save.save(); };
      $('dmgC').onchange = (e) => { s.dmgNumbers = e.target.checked; this.R.fx.dmgEnabled = s.dmgNumbers; SF.Save.save(); };
      $('fpsC').onchange = (e) => { s.fps = e.target.checked; $('fps').classList.toggle('hidden', !s.fps); SF.Save.save(); };
      $('qualS').onchange = (e) => { s.quality = +e.target.value; this.R.quality = s.quality; this.R.resize(); SF.Save.save(); };
      $('expBtn').onclick = () => { $('saveTxt').value = SF.Save.export(); this.toast('Save code exported. Copy it somewhere safe.'); };
      $('impBtn').onclick = () => { if (SF.Save.import($('saveTxt').value.trim())) { this.toast('Save imported.'); this.showTitle(); } else this.toast('Invalid save code.'); };
      $('resetBtn').onclick = () => { if (confirm('Erase ALL progress? This cannot be undone.')) { SF.Save.reset(); this.showTitle(); } };
    },

    /* ============ HUD ============ */
    buildHud() {
      $('hud').innerHTML = `<div class="top"><div id="xpbar"><i></i><span id="xpTxt"></span></div><div class="toprow"><div class="col" style="gap:2px"><div class="hud-stat">${ic({ g: 'skull', c: '#f87171' }, 'sm')}<span id="killsTxt">0</span></div><div class="hud-stat">${ic({ g: 'coin', c: '#f5c542' }, 'sm')}<span id="goldTxt">0</span></div></div><div id="timer">00:00</div><div class="col" style="gap:2px;align-items:flex-end"><div class="hud-stat" id="heatTxt"></div><div class="hud-stat" id="stageTxt"></div></div></div></div>
        <div id="bossbar" class="hidden"><div class="nm" id="bossNm"></div><div class="bar"><i id="bossHp"></i></div></div>
        <div class="bottom-left"><div id="hpbar"><i></i><s></s><b id="hpTxt"></b></div><div id="resbar" class="hidden"><i></i></div><div id="reslabel"></div><div id="slots"></div></div>
        <div id="active"><div class="ab" id="abBtn"><img id="abImg" alt=""><div class="cd" id="abCd"></div><div class="charges hidden" id="abCh"></div></div><div class="lbl" id="abLbl"></div></div>
        <div class="bottom-right" id="hudHint"><span class="kbd">SPACE</span> ability · <span class="kbd">ESC</span> pause</div>`;
      this.hudEls = { xp: $('xpbar').firstElementChild, xpTxt: $('xpTxt'), kills: $('killsTxt'), gold: $('goldTxt'), timer: $('timer'), heat: $('heatTxt'), stage: $('stageTxt'), bossbar: $('bossbar'), bossNm: $('bossNm'), bossHp: $('bossHp'), hp: $('hpbar').firstElementChild, hpS: $('hpbar').querySelector('s'), hpTxt: $('hpTxt'), resbar: $('resbar'), res: $('resbar').firstElementChild, reslabel: $('reslabel'), slots: $('slots'), abImg: $('abImg'), abCd: $('abCd'), abBtn: $('abBtn'), abCh: $('abCh'), abLbl: $('abLbl') };
      $('abBtn').onclick = () => { SF.Input.tapActive = true; };
    },
    buildSlots() {
      const g = this.game, p = g.player, E = this.hudEls;
      E.abImg.src = S.iconURL(p.char.active.icon); E.abLbl.textContent = p.char.active.name;
      E.heat.innerHTML = g.heat ? `<span style="color:#fb923c">HEAT ${g.heat}</span>` : ''; E.stage.innerHTML = `<span class="muted" style="font-size:14px">${g.stage.name}</span>`;
      if (p.char.resource) { E.resbar.classList.remove('hidden'); E.res.style.background = p.char.resource.color; E.res.style.boxShadow = '0 0 8px ' + p.char.resource.color; } else { E.resbar.classList.add('hidden'); E.reslabel.textContent = ''; }
      this.slotSig = '';
    },
    updateHud(g) {
      const p = g.player, E = this.hudEls; if (!p) return;
      E.xp.style.width = Math.min(100, p.xp / p.xpNext * 100).toFixed(1) + '%'; E.xpTxt.textContent = 'LV ' + p.level;
      E.kills.textContent = U.fmt(g.kills); E.gold.textContent = U.fmt(g.gold);
      E.timer.textContent = U.fmtTime(g.time); E.timer.classList.toggle('eclipse', g.eclipse);
      const hpk = Math.max(0, p.hp / p.stats.maxHp);
      E.hp.style.width = (hpk * 100).toFixed(1) + '%'; E.hp.classList.toggle('low', hpk < 0.3); E.hpTxt.textContent = Math.ceil(p.hp) + ' / ' + p.stats.maxHp;
      E.hpS.style.width = (Math.min(1, p.shield / p.stats.maxHp) * 100).toFixed(1) + '%';
      if (p.char.resource) { E.res.style.width = (Math.min(1, p.res / (p.resMax || 1)) * 100).toFixed(1) + '%'; E.reslabel.textContent = p.char.resource.name + (p.resMax > 1 ? ' ' + Math.floor(p.res) + '/' + p.resMax : ' ' + Math.round(p.res * 100) + '%'); }
      // boss
      if (g.boss && !g.boss.dead) { E.bossbar.classList.remove('hidden'); E.bossNm.textContent = g.boss.def.name + (g.boss.bossTier ? ' · Tier ' + (g.boss.bossTier + 1) : ''); E.bossHp.style.width = (Math.max(0, g.boss.hp / g.boss.maxHp) * 100).toFixed(1) + '%'; } else E.bossbar.classList.add('hidden');
      // active
      const ready = p.activeCharges > 0; E.abBtn.classList.toggle('ready', ready);
      const cd = p.char.active.cd * p.stats.activeCd; E.abCd.style.transform = 'scaleY(' + (p.activeCharges >= p.activeMax ? 0 : Math.max(0, p.activeCdT / cd)).toFixed(3) + ')';
      if (p.activeMax > 1) { E.abCh.classList.remove('hidden'); E.abCh.textContent = p.activeCharges; } else E.abCh.classList.add('hidden');
      // slots
      const sig = p.weapons.map((w) => w.id + w.level + (w.evolved ? 'e' : '')).join() + '|' + p.passives.map((x) => x.id + x.level).join();
      if (sig !== this.slotSig) {
        this.slotSig = sig;
        E.slots.innerHTML = p.weapons.map((w) => `<div class="s ${w.evolved ? 'evo' : w.level >= w.def.max ? 'max' : ''}" title="${w.evolved ? w.def.evo.name : w.def.name} Lv${w.level}"><img src="${S.iconURL(w.evolved ? w.def.evo.icon : w.def.icon)}"><b>${w.evolved ? '★' : w.level}</b></div>`).join('') + '<div class="sep"></div>' + p.passives.map((x) => `<div class="s ${x.level >= x.def.max ? 'max' : ''}" title="${x.def.name} Lv${x.level}"><img src="${S.iconURL(x.def.icon)}"><b>${x.level}</b></div>`).join('');
      }
    },

    /* ============ LEVEL UP ============ */
    showLevelUp(options) {
      const g = this.game, p = g.player;
      this.banishMode = false;
      const render = (opts) => {
        const cards = opts.map((o, i) => {
          if (o.type === 'gold') return `<div class="card" data-i="${i}"><div class="head">${ic({ g: 'coin', c: '#f5c542' })}<div class="nm">Gold Pouch</div></div><div class="desc">+${o.value} gold. Everything is maxed — the Forge awaits.</div></div>`;
          if (o.type === 'heal') return `<div class="card" data-i="${i}"><div class="head">${ic({ g: 'heart', c: '#ff5c7a' })}<div class="nm">Second Wind</div></div><div class="desc">Heal 30% of your max health.</div></div>`;
          const d = o.def, cur = o.type === 'weapon' ? p.weapons.find((w) => w.id === o.id) : p.passives.find((x) => x.id === o.id);
          const next = o.type === 'weapon' ? (o.isNew ? d.desc : (o.empowered ? SF.WH.describe(d.levels[o.level - 3] || {}) + ' & ' : '') + SF.WH.describe(d.levels[o.level - 2] || {})) : d.desc;
          const evoHint = o.type === 'weapon' && d.evo ? `<div class="tip">Evolves with ${SF.PASSIVE_BY_ID[d.evo.with].name}${p.passives.some((x) => x.id === d.evo.with) ? ' ✓' : ''}</div>` : o.type === 'passive' ? (() => { const ws = p.weapons.filter((w) => w.def.evo && w.def.evo.with === o.id && !w.evolved); return ws.length ? `<div class="tip" style="color:#c084fc">Evolves ${ws.map((w) => w.def.name).join(', ')}</div>` : ''; })() : '';
          return `<div class="card ${o.empowered ? 'emp' : ''} ${this.banishMode ? 'banish-mode' : ''}" data-i="${i}"><div class="hot">${i + 1}</div><div class="head">${ic(o.type === 'weapon' && cur && cur.evolved ? d.evo.icon : d.icon)}<div><div class="kind">${o.type === 'weapon' ? (d.char ? 'Signature weapon' : 'Weapon') : 'Passive'}</div><div class="nm">${cur && cur.evolved ? d.evo.name : d.name}</div></div></div>
            <div class="row" style="gap:6px">${o.isNew ? '<span class="tag new">New</span>' : `<div class="pips">${Array.from({ length: d.max }, (_, k) => `<i class="${k < (cur ? cur.level : 0) ? 'on' : k < o.level ? 'next' : ''}"></i>`).join('')}</div><span class="tip">Lv ${o.level}</span>`}${o.empowered ? '<span class="tag emp">Empowered +2</span>' : ''}</div>
            <div class="desc">${o.isNew ? d.desc : ''}</div><div class="next">${o.isNew ? '' : '▲ ' + next}</div>${evoHint}</div>`;
        }).join('');
        this.modal(`<h2>Level ${p.level}</h2><div class="sub">${this.banishMode ? '<span class="bad">Choose an option to BANISH for this run</span>' : 'Choose an upgrade · press 1-4'}</div><div class="cards">${cards}</div>
          <div class="lvl-actions"><button class="btn small" id="rerollBtn" ${p.rerolls > 0 ? '' : 'disabled'}>Reroll (${p.rerolls})</button><button class="btn small" id="skipBtn" ${p.skips > 0 ? '' : 'disabled'}>Skip (${p.skips})</button><button class="btn small ${this.banishMode ? 'danger' : ''}" id="banishBtn" ${p.banishes > 0 ? '' : 'disabled'}>Banish (${p.banishes})</button></div>`);
        document.querySelectorAll('.card').forEach((el) => el.onclick = () => {
          const o = opts[+el.dataset.i];
          if (this.banishMode) { const n = g.banish(o); this.banishMode = false; if (n) render(n); return; }
          document.removeEventListener('keydown', this._lvlKeys);
          this.closeModal(); g.pickOption(o); this.slotSig = '';
        });
        $('rerollBtn').onclick = () => { const n = g.reroll(); if (n) { SF.Audio.play('ui'); render(n); } };
        $('skipBtn').onclick = () => { if (p.skips > 0) { SF.Audio.play('ui'); document.removeEventListener('keydown', this._lvlKeys); this.closeModal(); g.skip(); } };
        $('banishBtn').onclick = () => { this.banishMode = !this.banishMode; render(opts); };
        this._lvlKeys = (e) => { const i = parseInt(e.key) - 1; if (i >= 0 && i < opts.length) { document.removeEventListener('keydown', this._lvlKeys); const c = document.querySelector(`.card[data-i="${i}"]`); if (c) c.click(); } };
        document.removeEventListener('keydown', this._lvlKeysPrev || (() => { })); this._lvlKeysPrev = this._lvlKeys;
        document.addEventListener('keydown', this._lvlKeys);
      };
      render(options);
    },

    /* ============ CHEST ============ */
    showChest(rewards, boss) {
      const g = this.game;
      const html = rewards.map((r) => {
        if (r.type === 'evolve') return `<div class="reward evo">${ic(r.icon, 'lg')}<div><span class="tag evo">Evolution</span><div class="cinzel" style="font-size:20px;color:#e9d5ff;margin:4px 0">${r.name}</div><div class="tip" style="color:#d8d0e8">${r.desc}</div></div></div>`;
        if (r.type === 'gold') return `<div class="reward">${ic({ g: 'coin', c: '#f5c542' })}<div><b class="gold">+${r.value} gold</b></div></div>`;
        if (r.type === 'mat') return `<div class="reward">${ic(SF.MAT_BY_ID[r.mat].icon)}<div><b style="color:${SF.MAT_BY_ID[r.mat].color}">+1 ${SF.MAT_BY_ID[r.mat].name}</b></div></div>`;
        return `<div class="reward">${ic(r.def.icon)}<div><b>${r.def.name}</b><div class="tip">Level ${r.level}${r.level >= r.def.max ? ' · MAX' : ''}</div></div></div>`;
      }).join('');
      this.modal(`<h2>${boss ? 'Boss Trove' : 'Treasure Chest'}</h2><div class="sub">${rewards.some((r) => r.type === 'evolve') ? 'A weapon has transcended its form.' : boss ? 'Five treasures.' : 'The night rewards the brave.'}</div><div class="rewards">${html}</div><div class="lvl-actions"><button class="btn primary" id="chestOk">Continue</button></div>`);
      const ok = () => { document.removeEventListener('keydown', kh); this.closeModal(); g.closeChest(); this.slotSig = ''; };
      $('chestOk').onclick = ok;
      const kh = (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); ok(); } }; document.addEventListener('keydown', kh);
    },

    /* ============ PAUSE ============ */
    showPause() {
      const g = this.game, p = g.player; if (g.state !== 'play') return;
      g.state = 'paused';
      const st = p.stats;
      const rows = [['maxHp', st.maxHp], ['regen', st.regen.toFixed(2) + '/s'], ['armor', st.armor.toFixed(1)], ['speed', Math.round(st.speed)], ['might', U.pct(st.might)], ['area', U.pct(st.area)], ['projSpeed', U.pct(st.projSpeed)], ['duration', U.pct(st.duration)], ['amount', '+' + st.amount], ['cooldown', U.pct(st.cooldown)], ['crit', U.pct(st.crit)], ['critDmg', U.pct(st.critDmg)], ['dodge', U.pct(st.dodge)], ['lifesteal', U.pct(st.lifesteal, 1)], ['luck', U.pct(st.luck)], ['growth', U.pct(st.growth)], ['greed', U.pct(st.greed)], ['magnet', Math.round(st.magnet)], ['curse', U.pct(st.curse)], ['revival', p.revivals]];
      this.modal(`<h2>Paused</h2><div class="sub">${p.char.name} · ${g.stage.name} · ${U.fmtTime(g.time)} · Heat ${g.heat}</div><div class="pause-grid"><div><h3 class="gold" style="margin:0 0 6px">Stats</h3><div class="stat-grid">${rows.map(([k, v]) => `<div><span class="muted">${SF.statName(k)}</span><b>${v}</b></div>`).join('')}</div></div>
        <div><h3 class="gold" style="margin:0 0 6px">Arsenal</h3><div class="pause-items">${p.weapons.map((w) => `<div class="it"><img src="${S.iconURL(w.evolved ? w.def.evo.icon : w.def.icon)}"><span>${w.evolved ? w.def.evo.name : w.def.name} <b>Lv${w.level}</b><br><span class="tip">${U.fmt(w.dmgDealt)} dmg</span></span></div>`).join('')}</div><h3 class="gold" style="margin:10px 0 6px">Passives</h3><div class="pause-items">${p.passives.map((x) => `<div class="it"><img src="${S.iconURL(x.def.icon)}"><span>${x.def.name} <b>Lv${x.level}</b></span></div>`).join('') || '<span class="muted">None yet</span>'}</div>
        <h3 class="gold" style="margin:10px 0 6px">${p.char.trait.name}</h3><div class="tip">${p.char.trait.desc}</div></div></div>
        <div class="lvl-actions"><button class="btn primary" id="resumeBtn">Resume</button><button class="btn danger" id="quitBtn">Abandon Run</button></div>`);
      $('resumeBtn').onclick = () => this.closePause();
      $('quitBtn').onclick = () => { if (confirm('Abandon this run? Rewards are still collected.')) { this.closeModal(); g.state = 'over'; this.showGameOver(g.summary(), true); } };
    },
    closePause() { this.closeModal(); if (this.game.state === 'paused') this.game.state = 'play'; },

    /* ============ GAME OVER ============ */
    showGameOver(sum, abandoned) {
      const g = this.game; SF.Audio.stopMusic();
      const res = SF.Save.recordRun(sum);
      const cd = SF.Save.charData(sum.charId), c = SF.CHAR_BY_ID[sum.charId];
      const dmgRows = Object.entries(sum.dmgByWeapon).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, v]) => { const w = SF.WEAPONS[id]; const nm = w ? w.name : id === 'burn' ? 'Burning' : id === 'bleed' ? 'Bleeding' : id === 'unique' ? 'Relic powers' : id.replace('ally_', 'Ally: '); return `<tr><td>${nm}</td><td>${U.fmt(v)}</td></tr>`; }).join('');
      const mats = Object.keys(sum.mats).filter((k) => sum.mats[k]).map((k) => `<span style="color:${SF.MAT_BY_ID[k].color}">+${sum.mats[k]} ${SF.MAT_BY_ID[k].name}</span>`).join(' · ');
      this.modal(`<h2>${abandoned ? 'Run Abandoned' : sum.eclipse ? 'Consumed by the Eclipse' : 'You Have Fallen'}</h2><div class="sub">${c.name} survived ${U.fmtTime(sum.time)} in ${SF.STAGE_BY_ID[sum.stageId].name}${sum.heat ? ' at Heat ' + sum.heat : ''}</div>
        <div class="summary"><div class="st"><b>${U.fmtTime(sum.time)}</b><span>Survived</span></div><div class="st"><b>${sum.level}</b><span>Level</span></div><div class="st"><b>${U.fmt(sum.kills)}</b><span>Kills</span></div><div class="st"><b>${sum.bossKills}</b><span>Bosses</span></div><div class="st"><b>${sum.evolves}</b><span>Evolutions</span></div></div>
        <div class="rewards"><div class="reward">${ic({ g: 'coin', c: '#f5c542' })}<div><b class="gold">+${U.fmt(sum.gold)} gold</b></div></div><div class="reward">${ic({ g: 'ember', c: '#ff8a3c' })}<div><b style="color:#ff8a3c">+${sum.embers} Soul Embers</b></div></div><div class="reward">${ic({ g: 'book', c: '#c4b5fd' })}<div><b style="color:#c4b5fd">+${U.fmt(sum.charXp)} character XP</b><div class="tip">${c.name} is now level ${cd.level}${res.levelUps ? ` (+${res.levelUps} — new talent points!)` : ''}</div></div></div>${mats ? `<div class="reward">${ic({ g: 'shard', c: '#fde68a' })}<div>${mats}</div></div>` : ''}</div>
        ${res.unlocks.length ? `<div class="unlock-list">${res.unlocks.map((u) => `<div>✦ ${u.text}</div>`).join('')}</div>` : ''}
        <div class="pause-grid"><div><h3 class="gold" style="margin:0 0 6px">Damage dealt</h3><table class="dmg-table">${dmgRows}</table></div><div><h3 class="gold" style="margin:0 0 6px">Final build</h3><div class="pause-items">${sum.weapons.map((w) => { const d = SF.WEAPONS[w.id]; return `<div class="it"><img src="${S.iconURL(w.evolved ? d.evo.icon : d.icon)}"><span>${w.evolved ? d.evo.name : d.name} <b>Lv${w.level}</b></span></div>`; }).join('')}${sum.passives.map((x) => { const d = SF.PASSIVE_BY_ID[x.id]; return `<div class="it"><img src="${S.iconURL(d.icon)}"><span>${d.name} <b>Lv${x.level}</b></span></div>`; }).join('')}</div></div></div>
        <div class="lvl-actions"><button class="btn" id="goMenu">Main Menu</button><button class="btn" id="goTalents">Talents</button><button class="btn" id="goForge">Forge</button><button class="btn primary" id="goAgain">Play Again</button></div>`);
      $('goMenu').onclick = () => this.showTitle();
      $('goTalents').onclick = () => { this.game.state = 'idle'; $('hud').classList.add('hidden'); this.closeModal(); this.showTalents(sum.charId); };
      $('goForge').onclick = () => { this.game.state = 'idle'; $('hud').classList.add('hidden'); this.closeModal(); this.showForge(); };
      $('goAgain').onclick = () => { this.closeModal(); this.startRun(); };
    },
  };

  SF.UI = UI;
})();
