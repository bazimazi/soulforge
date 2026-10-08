/* SOULFORGE — core simulation */
'use strict';
(function () {
  const U = SF.U;
  const TAU = U.TAU;

  class Game {
    constructor(renderer) {
      this.R = renderer; this.fx = renderer.fx;
      this.state = 'idle';
      this.tmp = [];
    }

    /* ==================== RUN SETUP ==================== */
    start(charId, stageId, omens) {
      const char = SF.CHAR_BY_ID[charId];
      const stage = SF.STAGE_BY_ID[stageId];
      this.char = char; this.stage = stage; this.omens = omens || {};
      this.meta = SF.Save.computeMeta(charId);
      this.settings = SF.Save.data.settings;
      // difficulty modifiers
      const mods = { enemyHp: stage.diff, enemyDmg: 0.75 + stage.diff * 0.25, enemySpeed: 1, spawn: 0.85 + stage.diff * 0.15, elite: 1, healing: 1, bossHp: 1, bossRate: 1, playerHp: 1, timeScale: 1 };
      let heat = 0;
      for (const id in this.omens) { const o = SF.OMEN_BY_ID[id], r = this.omens[id]; if (o && r > 0) { o.apply(mods, r); heat += r; } }
      if (this.meta.flags.moreElites) mods.elite *= 1.25;
      this.mods = mods; this.heat = heat;
      this.time = 0; this.frame = 0; this.dt = 0;
      this.enemies = []; this.projs = []; this.eprojs = []; this.zones = []; this.mines = []; this.allies = []; this.pickups = []; this.timers = [];
      this.grid = new U.Grid(72);
      this.kills = 0; this.bossKills = 0; this.elites = 0; this.evolves = 0; this.gold = 0; this.embers = 0; this.mats = { iron: 0, dust: 0, crystal: 0, star: 0 };
      this.enemyKills = {}; this.bossKillsBy = {}; this.dmgByWeapon = {};
      this.spawnAcc = 0; this.eliteT = 75 / mods.elite; this.eventIdx = 0; this.lateEventT = 0; this.brazierT = 30; this.foodT = 45;
      this.boss = null; this.levelQueue = 0; this.chestQueue = []; this.banished = new Set();
      this.spawnTable = SF.SPAWN_TABLE[0];
      this.eclipse = false;
      this.runMight = 0;
      this.viewW = 700; this.viewH = 420;
      this.createPlayer();
      this.state = 'play'; this.paused = false;
      this.R.setStage(stage);
      this.fx.clear();
      this.notice('The night begins. Survive.', '#fde68a');
      if (SF.Save.data.stats.runs < 3) this.after(2.5, () => this.notice('Collect gems to level up · SPACE for ' + char.active.name, '#cbd5e1', 4));
      if (this.meta.flags.startShield) this.addShield(this.player.stats.maxHp * 0.5);
      for (let i = 0; i < this.player.stats.startLevel; i++) this.gainLevel(true);
    }

    createPlayer() {
      const ch = this.char;
      const p = this.player = {
        x: 0, y: 0, r: 14, char: ch, level: 1, xp: 0, xpNext: SF.xpForLevel(1), hp: 0, shield: 0,
        stats: null, dyn: {}, f: Object.assign({}, this.meta.flags), res: 0, resMax: 1, weapons: [], passives: [], weaponMastery: this.meta.weaponMastery,
        face: { x: 1, y: 0 }, move: { x: 0, y: 0 }, movedDist: 0, invulnT: 0, hurtFlash: 0, activeCdT: 0, activeCharges: 1, activeMax: 1, critAllT: 0,
        rerolls: 0, skips: 0, banishes: 0, revivals: 0, kills: 0, slots: { w: 6 + (this.meta.flags.weaponSlot ? 1 : 0), p: 6 + (this.meta.flags.passiveSlot ? 1 : 0) },
        anim: 0, walkT: 0, dashT: 0, auraColor: null, sprite: SF.Sprites.character(ch, 72), bob: 0,
      };
      this.recalc();
      p.hp = p.stats.maxHp;
      p.rerolls = p.stats.rerolls; p.skips = p.stats.skips; p.banishes = p.stats.banishes; p.revivals = p.stats.revival;
      p.activeMax = 1 + (p.f.dash_charges ? 1 : 0); p.activeCharges = p.activeMax;
      this.addWeapon(ch.signature);
      if (ch.hooks && ch.hooks.init) ch.hooks.init(this, p);
      this.recalc();
      p.hp = p.stats.maxHp;
    }

    recalc() {
      const p = this.player, ch = this.char;
      const base = Object.assign({}, SF.CHAR_BASE, ch.stats);
      const add = {};
      const acc = (o, m = 1) => { for (const k in o) add[k] = (add[k] || 0) + o[k] * m; };
      acc(this.meta.stats);
      p.passives.forEach((ps) => acc(ps.def.per, ps.level));
      acc(p.dyn);
      if (this.runMight) add.might = (add.might || 0) + this.runMight;
      const s = {};
      const g = (k) => add[k] || 0;
      s.maxHp = Math.round((base.maxHp + g('maxHp')) * (1 + g('maxHpPct')) * this.mods.playerHp);
      s.speed = base.speed * (1 + g('speed'));
      for (const k of ['might', 'area', 'projSpeed', 'duration', 'luck', 'growth', 'greed', 'healing', 'curse', 'shieldPower']) s[k] = base[k] + g(k);
      s.cooldown = base.cooldown * Math.max(0.25, 1 - g('cooldown'));
      s.activeCd = base.activeCd * Math.max(0.3, 1 - g('activeCd'));
      s.magnet = base.magnet * (1 + g('magnet'));
      for (const k of ['armor', 'regen', 'amount', 'revival', 'rerolls', 'skips', 'banishes', 'pierce', 'startLevel', 'crit', 'critDmg', 'dodge', 'lifesteal', 'thorns', 'eliteDmg', 'burnDmg', 'minionDmg', 'xpBonus', 'matFind', 'knockback', 'chestLuck', 'slowPower', 'execute', 'sigDmg']) s[k] = base[k] + g(k);
      s.dodge = Math.min(0.75, s.dodge);
      if (p.noRegen) s.regen = 0;
      s.healing *= this.mods.healing;
      const old = p.stats;
      p.stats = s;
      if (old && s.maxHp > old.maxHp) p.hp += s.maxHp - old.maxHp;
      if (p.hp > s.maxHp) p.hp = s.maxHp;
      // cache weapon stats
      p.weapons.forEach((w) => { w.s = SF.weaponStats(w, p); if (w.def.mod) w.def.mod(this, w, w.s, p); });
      this.enemyMult = null;
    }

    addWeapon(id) {
      const p = this.player, def = SF.WEAPONS[id];
      const w = { id, def, level: 1, evolved: false, timer: 0.3, s: null, dmgDealt: 0 };
      p.weapons.push(w); this.recalc();
      this.codexWeapon(id);
      return w;
    }
    addPassive(id) { const def = SF.PASSIVE_BY_ID[id]; const ps = { id, def, level: 1 }; this.player.passives.push(ps); this.recalc(); return ps; }
    codexWeapon(id) { const c = SF.Save.data.codex.weapons; if (!c[id]) c[id] = {}; c[id].found = true; }

    /* ==================== MAIN UPDATE ==================== */
    update(dt) {
      if (this.state !== 'play' || this.paused) return;
      dt = Math.min(dt, 1 / 30);
      this.dt = dt; this.time += dt; this.frame++;
      const p = this.player;
      // timers
      for (let i = this.timers.length - 1; i >= 0; i--) { const t = this.timers[i]; t.t -= dt; if (t.t <= 0) { this.timers.splice(i, 1); try { t.fn(); } catch (e) { console.error(e); } } }
      this.updatePlayer(dt);
      this.updateWeapons(dt);
      this.rebuildGrid();
      this.updateSpawns(dt);
      this.updateEnemies(dt);
      this.updateProjectiles(dt);
      this.updateEnemyProjectiles(dt);
      this.updateZones(dt);
      this.updateMines(dt);
      this.updateAllies(dt);
      this.updatePickups(dt);
      this.updateMetaEffects(dt);
      if (this.frame % 12 === 0) this.recalc();
      if (!this.eclipse && this.time >= 1800) { this.eclipse = true; this.notice('THE ECLIPSE — the horde grows without end', '#c084fc', 5); this.fx.flash('#c084fc', 0.7); this.sfx('boss'); }
      // modal triggers
      if (this.levelQueue > 0) { this.state = 'levelup'; SF.UI.showLevelUp(this.genOptions()); }
      else if (this.chestQueue.length) { const c = this.chestQueue.shift(); this.state = 'chest'; this.openChest(c); }
    }

    /* ==================== PLAYER ==================== */
    updatePlayer(dt) {
      const p = this.player, st = p.stats, inp = SF.Input;
      let mx = inp.axisX(), my = inp.axisY();
      const l = Math.hypot(mx, my); if (l > 1) { mx /= l; my /= l; }
      p.move.x = mx; p.move.y = my;
      if (l > 0.01) { p.face.x = mx / (l || 1); p.face.y = my / (l || 1); p.walkT += dt * 9; }
      let spd = st.speed;
      if (p.f.adrenaline && p.hp < st.maxHp * 0.3) spd *= 1.2;
      if (p.dashT > 0) {
        p.dashT -= dt;
        const step = p.dashSpeed * dt;
        p.x += p.dashDx * step; p.y += p.dashDy * step;
        p.dashAcc += step;
        if (p.dashOnStep && p.dashAcc >= p.dashStepDist) { p.dashAcc = 0; p.dashOnStep(p.x, p.y); }
        this.fx.burst(p.x, p.y, p.char.colors.accent, 2, { speed: 40, life: 0.3, size: 3 });
      } else {
        p.x += mx * spd * dt; p.y += my * spd * dt;
        p.movedDist += l * spd * dt;
      }
      p.invulnT -= dt; p.hurtFlash -= dt; p.critAllT -= dt;
      for (const k of ['cdAshen', 'cdUnbroken', 'cdVeil']) if (p[k] > 0) p[k] -= dt;
      // regen
      if (st.regen > 0 && p.hp < st.maxHp) this.heal(st.regen * dt, true, true);
      // active ability cooldown
      if (p.activeCharges < p.activeMax) { p.activeCdT -= dt; if (p.activeCdT <= 0) { p.activeCharges++; p.activeCdT = p.activeCharges < p.activeMax ? p.char.active.cd * st.activeCd : 0; } }
      if (inp.active() && p.activeCharges > 0) this.useActive();
      // character hooks
      const h = p.char.hooks;
      if (h && h.update) h.update(this, p, dt);
      // contact damage is handled in enemy update
    }
    useActive() {
      const p = this.player;
      p.activeCharges--;
      if (p.activeCdT <= 0) p.activeCdT = p.char.active.cd * p.stats.activeCd;
      p.char.active.use(this, p);
      this.fx.ring(p.x, p.y, 40, p.char.colors.accent, { thin: true });
    }
    dash(dx, dy, dist, t, opts = {}) { const p = this.player; p.dashT = t; p.dashDx = dx; p.dashDy = dy; p.dashSpeed = dist / t; p.dashOnStep = opts.onStep || null; p.dashStepDist = opts.stepDist || 30; p.dashAcc = 0; }
    blink(dx, dy, dist) { const p = this.player; this.fx.burst(p.x, p.y, p.char.colors.accent, 16, { speed: 120, life: 0.4 }); p.x += dx * dist; p.y += dy * dist; this.fx.burst(p.x, p.y, p.char.colors.accent, 16, { speed: 120, life: 0.4 }); }
    setInvuln(t) { this.player.invulnT = Math.max(this.player.invulnT, t); }
    heal(amt, quiet, silent) {
      const p = this.player; if (amt <= 0) return;
      amt *= p.stats.healing;
      const before = p.hp;
      p.hp = Math.min(p.stats.maxHp, p.hp + amt);
      const over = amt - (p.hp - before);
      if (over > 0) {
        if (p.overhealToShield) this.addShield(over);
        else if (p.overhealToBlood) p.blood = Math.min(p.bloodCap || p.stats.maxHp * 0.5, (p.blood || 0) + over);
      }
      if (!quiet) { this.fx.text(p.x, p.y - 30, '+' + Math.round(amt), '#86efac'); this.sfx('heal'); }
      if (!silent && p.hp - before > 0.5) this.fx.burst(p.x, p.y, '#86efac', 3, { speed: 30, life: 0.5, size: 3, up: true });
    }
    addShield(amt) { const p = this.player; const cap = p.stats.maxHp * (p.shieldCap || 0.5) * p.stats.shieldPower; p.shield = Math.min(cap, p.shield + amt); }
    hitPlayer(dmg, src) {
      const p = this.player;
      if (p.invulnT > 0 || p.hp <= 0) return;
      if (Math.random() < p.stats.dodge) { this.fx.text(p.x, p.y - 30, 'DODGE', '#94a3b8'); const h = p.char.hooks; if (h && h.onDodge) h.onDodge(this, p, src); return; }
      dmg = Math.max(1, dmg - p.stats.armor) * (p.dyn.dmgTaken || 1);
      const h = p.char.hooks;
      if (h && h.onHurt) dmg = h.onHurt(this, p, dmg, src);
      if (p.shield > 0) { const a = Math.min(p.shield, dmg); p.shield -= a; dmg -= a; this.fx.burst(p.x, p.y, '#7dd3fc', 4, { speed: 60, life: 0.3 }); }
      if (dmg <= 0) return;
      if (p.blood > 0) { const a = Math.min(p.blood, dmg * 0.5); p.blood -= a; dmg -= a; }
      p.hp -= dmg; p.hurtFlash = 0.15; p.invulnT = Math.max(p.invulnT, 0.12);
      this.lastHitBy = src && src.def ? src.def.name : src && src.color ? 'projectile' : 'unknown';
      this.fx.shake(Math.min(8, 2 + dmg * 0.08)); this.fx.text(p.x, p.y - 30, '-' + Math.round(dmg), '#f87171', true); this.sfx('hurt');
      if (p.hp <= 0) this.playerDown();
    }
    playerDown() {
      const p = this.player, h = p.char.hooks;
      if (h && h.onFatal && h.onFatal(this, p)) return;
      if (p.revivals > 0) {
        p.revivals--; p.hp = p.f.fullRevive ? p.stats.maxHp : p.stats.maxHp * 0.5; this.setInvuln(3);
        if (p.f.fullRevive) this.eachEnemyIn(p.x, p.y, 320, (e) => { if (!e.boss) this.damageEnemy(e, e.hp + 1, { quiet: true, weapon: null }); else this.damageEnemy(e, e.maxHp * 0.1, { quiet: true, weapon: null }); });
        this.fx.flash('#fde68a', 0.8); this.fx.ring(p.x, p.y, 320, '#fde68a'); this.fx.text(p.x, p.y - 40, 'REVIVED', '#fde68a'); this.sfx('revive');
        this.notice('You rise again. ' + p.revivals + ' revival' + (p.revivals === 1 ? '' : 's') + ' left.', '#fde68a');
        return;
      }
      p.hp = 0; this.state = 'over'; this.sfx('death'); this.fx.flash('#7f1d1d', 1.0); this.fx.shake(20);
      setTimeout(() => SF.UI.showGameOver(this.summary()), 900);
    }

    /* ==================== WEAPONS ==================== */
    updateWeapons(dt) {
      const p = this.player;
      for (const w of p.weapons) {
        const s = w.s || (w.s = SF.weaponStats(w, p));
        if (w.def.continuous) { w.def.update(this, w, s, dt); continue; }
        w.timer -= dt;
        if (w.timer <= 0) {
          w.def.fire(this, w, s);
          w.timer += Math.max(0.12, s.cd);
          if (w.timer < 0) w.timer = 0.05;
          const h = p.char.hooks; if (h && h.onCast) h.onCast(this, p, w);
        }
      }
    }
    after(t, fn) { if (t <= 0) { fn(); return; } this.timers.push({ t, fn }); }

    /* ---- helpers exposed to weapon behaviors ---- */
    rebuildGrid() { this.grid.clear(); for (const e of this.enemies) if (!e.dead) this.grid.insert(e); }
    nearestEnemy(x, y, r, filter) { return this.grid.nearest(x, y, r, (e) => !e.dead && (!filter || filter(e))); }
    eachEnemyIn(x, y, r, fn) { this.grid.each(x, y, r + 64, (e) => { if (e.dead) return; const rr = r + e.r; if ((e.x - x) * (e.x - x) + (e.y - y) * (e.y - y) <= rr * rr) fn(e); }); }
    enemiesInRadius(x, y, r) { const out = []; this.eachEnemyIn(x, y, r, (e) => out.push(e)); return out; }
    randomEnemyNear(x, y, r) { const list = this.enemiesInRadius(x, y, r); return list.length ? list[Math.floor(Math.random() * list.length)] : null; }
    alliesOf(kind) { return this.allies.filter((a) => a.kind === kind && !a.dead); }
    pullEnemies(x, y, r, strength) { const dt = this.dt; this.eachEnemyIn(x, y, r, (e) => { if (e.boss) return; const dx = x - e.x, dy = y - e.y, d = Math.hypot(dx, dy) || 1; const f = strength * dt / Math.max(1, e.mass * 0.5); e.x += dx / d * f; e.y += dy / d * f; }); }
    destroyEnemyProjectiles(x, y, r) { for (const pr of this.eprojs) if (!pr.dead && U.dist2(pr.x, pr.y, x, y) < (r + pr.r) * (r + pr.r)) { pr.dead = true; this.fx.burst(pr.x, pr.y, '#c084fc', 3, { speed: 50, life: 0.3, size: 2 }); } }

    spawnProj(o) {
      const pr = {
        uid: U.uid(), x: o.x, y: o.y, angle: o.angle || 0, speed: o.speed || 0, r: o.r || 6, dmg: o.dmg || 0, pierce: o.pierce == null ? 0 : o.pierce, life: o.life || 2, age: 0,
        weapon: o.weapon, sprite: o.sprite, hits: null, hitCd: o.hitCd || 0, homing: o.homing || 0, bounce: !!o.bounce, boomerang: o.boomerang || null, onHit: o.onHit || null, onExpire: o.onExpire || null, onBounce: o.onBounce || null,
        knock: o.knock == null ? 0.6 : o.knock, trail: o.trail || null, spin: o.spin || 0, rot: 0, orbit: o.orbit || null, field: o.field || null, zap: o.zap || null, statuses: o.statuses || null, crit: o.crit || 0,
        dead: false, ricochet: o.ricochet || 0, light: o.light || 0, noOnHit: !!o.noOnHit, tickT: 0, hitCount: 0, trailT: 0, split: false,
      };
      pr.vx = Math.cos(pr.angle) * pr.speed; pr.vy = Math.sin(pr.angle) * pr.speed;
      if (pr.pierce !== -1 || !pr.hitCd) pr.hits = new Set();
      this.projs.push(pr);
      return pr;
    }
    spawnZone(o) { const z = Object.assign({ age: 0, tickT: 0, dead: false, dur: 2, tick: 0.3, dmg: 0, r: 50, color: '#fff', kind: 'generic' }, o); this.zones.push(z); return z; }
    spawnMine(o) { const m = Object.assign({ age: 0, dead: false, armT: 0.4, pulse: Math.random() * TAU }, o); this.mines.push(m); return m; }
    spawnAlly(o) {
      const a = Object.assign({ x: 0, y: 0, r: 12, life: 10, age: 0, dead: false, speed: 160, atkT: 0, attackCd: 0.8, attackR: 34, angle: Math.random() * TAU, walk: 0, target: null, fireT: 0, dmgDealt: 0 }, o);
      this.allies.push(a);
      const h = this.player.char.hooks; if (h && h.onAllySpawn) h.onAllySpawn(this, this.player, a);
      this.fx.burst(a.x, a.y, a.color || '#fff', 10, { speed: 80, life: 0.5 });
      return a;
    }
    explode(x, y, r, dmg, w, o = {}) {
      this.eachEnemyIn(x, y, r, (e) => {
        if (o.exclude === e) return;
        this.damageEnemy(e, dmg, { weapon: w, kx: e.x - x, ky: e.y - y, knock: o.knock == null ? 1 : o.knock, quiet: !!o.quiet, crit: o.crit || 0 });
        if (o.burn && !o.noBurn) this.applyStatus(e, 'burn', { dur: o.burnDur || 3, dps: dmg * o.burn });
        if (o.status) this.applyStatus(e, o.status.type, o.status);
      });
      this.fx.explosion(x, y, r, o.color || '#ff7043', o.small);
      if (!o.small) { this.fx.shake(Math.min(6, r * 0.05)); this.sfx('explode'); }
    }
    nova(x, y, r, dmg, w, o = {}) {
      // expanding ring: hits enemies as the ring passes them
      const speed = o.speed || 600;
      const n = { x, y, r: 0, maxR: r, speed, dmg, w, o, hit: new Set(), dead: false, age: 0 };
      this.fx.nova(n, o.color || '#fff', o.thin);
      const step = () => {
        if (this.state === 'over') return;
        const dt = this.dt || 0.016;
        const prev = n.r; n.r = Math.min(n.maxR, n.r + speed * dt);
        this.grid.each(x, y, n.r + 64, (e) => {
          if (e.dead || n.hit.has(e)) return;
          const d = Math.hypot(e.x - x, e.y - y);
          if (d - e.r <= n.r && d + e.r >= prev - 20) {
            n.hit.add(e);
            this.damageEnemy(e, dmg, { weapon: w, kx: e.x - x, ky: e.y - y, knock: o.knock == null ? 1 : o.knock, quiet: !!o.quiet, crit: o.crit || 0 });
            if (o.status) this.applyStatus(e, o.status.type, o.status);
            if (o.burn) this.applyStatus(e, 'burn', { dur: 3, dps: dmg * o.burn });
            if (o.onHit) o.onHit(e);
            if (o.shatter && e.st.freeze && e.hp <= 0) { /* handled by frost kill */ }
          }
        });
        if (n.r < n.maxR) this.after(0.016, step); else n.dead = true;
      };
      step();
      if (o.shake) this.fx.shake(o.shake);
    }
    lightning(x, y, r, dmg, w, o = {}) {
      this.fx.lightning(x, y, o.color || '#fde047');
      this.explode(x, y, r, dmg, w, { color: o.color || '#fde047', small: true, quiet: false, knock: 0.3, status: o.status });
      this.sfx('zap');
      if (o.chain) { const list = this.enemiesInRadius(x, y, 160).filter((e) => U.dist2(e.x, e.y, x, y) > r * r); U.shuffle(list).slice(0, o.chain).forEach((e, i) => this.after(0.08 * (i + 1), () => { this.fx.beam(x, y, e.x, e.y, '#fde047', 3, 0.15); this.explode(e.x, e.y, r * 0.7, dmg * 0.6, w, { color: '#fde047', small: true, knock: 0.3 }); })); }
    }
    chainLightning(sx, sy, target, chains, dmg, w, o = {}) {
      const hit = new Set(); let cur = target, px = sx, py = sy, d = dmg, n = 0;
      const decay = o.decay || 0.85, range = o.range || 170;
      const step = () => {
        if (!cur || cur.dead) return;
        this.fx.beam(px, py, cur.x, cur.y, o.color || '#7dd3fc', 3, 0.18);
        if (!(o.skipFirst && n === 0)) this.damageEnemy(cur, d, { weapon: w, knock: 0.2, kx: cur.x - px, ky: cur.y - py });
        if (o.extra && Math.random() < o.extra) this.lightning(cur.x, cur.y, 34, d * 0.5, w, {});
        hit.add(cur); px = cur.x; py = cur.y; d *= decay; n++;
        if (n > chains) return;
        cur = this.grid.nearest(px, py, range, (e) => !e.dead && !hit.has(e));
        if (cur) this.after(0.05, step);
      };
      step();
    }
    lineDamage(x, y, angle, len, width, dmg, w, o = {}) {
      const dx = Math.cos(angle), dy = Math.sin(angle);
      this.fx.line(x, y, angle, len, width, o.color || '#fff');
      this.eachEnemyIn(x + dx * len / 2, y + dy * len / 2, len / 2 + width, (e) => {
        const ex = e.x - x, ey = e.y - y; const t = ex * dx + ey * dy; if (t < -e.r || t > len + e.r) return;
        const px = dx * t, py = dy * t; if ((ex - px) * (ex - px) + (ey - py) * (ey - py) > (width / 2 + e.r) * (width / 2 + e.r)) return;
        this.damageEnemy(e, dmg, { weapon: w, kx: dx, ky: dy, knock: o.knock == null ? 0.8 : o.knock, crit: o.crit || 0 });
        if (o.status) this.applyStatus(e, o.status.type, o.status);
      });
    }
    arcSlash(x, y, angle, r, halfArc, dmg, w, o = {}) {
      this.fx.arc(x, y, angle, r, halfArc, o.color || '#fff', o.thin);
      this.eachEnemyIn(x, y, r, (e) => {
        const a = Math.atan2(e.y - y, e.x - x); let da = a - angle; while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU;
        if (Math.abs(da) > halfArc + e.r / Math.max(30, r)) return;
        this.damageEnemy(e, dmg, { weapon: w, kx: e.x - x, ky: e.y - y, knock: o.knock == null ? 1 : o.knock, crit: o.crit || 0 });
        if (o.burn) this.applyStatus(e, 'burn', { dur: o.burnDur || 3, dps: dmg * o.burn });
        if (o.status) this.applyStatus(e, o.status.type, o.status);
      });
    }
    lob(x, y, tx, ty, t, color, cb) { this.fx.lob(x, y, tx, ty, t, color); this.after(t, cb); }
    meteor(x, y, delay, cb) { this.fx.meteor(x, y, delay); this.after(delay, () => { this.fx.shake(5); cb(); }); }
    rain(x, y, r, count, dur, dmg, w, color) {
      for (let i = 0; i < count; i++) {
        const a = Math.random() * TAU, d = Math.sqrt(Math.random()) * r;
        const tx = x + Math.cos(a) * d, ty = y + Math.sin(a) * d;
        this.after((i / count) * dur, () => { this.fx.arrowFall(tx, ty, color, 0.25); this.after(0.25, () => this.explode(tx, ty, 34, dmg, w, { color, small: true, quiet: true, knock: 0.3 })); });
      }
    }

    /* ==================== DAMAGE ==================== */
    damageEnemy(e, dmg, info = {}) {
      if (e.dead || e.hp <= 0) return 0;
      const p = this.player;
      info.mult = 1; info.critBonus = info.crit || 0;
      const w = info.weapon;
      const h = p.char.hooks;
      if (h && h.onDamage && !info.execute) h.onDamage(this, p, e, info);
      let crit = false;
      if (!info.execute) {
        const cc = p.stats.crit + info.critBonus + (p.critAllT > 0 ? 1 : 0);
        crit = Math.random() < cc;
        if (crit) dmg *= p.stats.critDmg;
        dmg *= info.mult;
        if (e.elite || e.boss) dmg *= 1 + p.stats.eliteDmg;
        if (e.weakT > 0) { /* enemy weakened: it deals less, not takes more */ }
        if (e.st.hunted && !info.mult) { /* handled by hook */ }
      }
      dmg = Math.max(0, dmg);
      e.hp -= dmg; e.hitFlash = 0.08;
      if (info.knock && !e.boss && e.mass < 30) { const [kx, ky] = U.norm(info.kx == null ? e.x - p.x : info.kx, info.ky == null ? e.y - p.y : info.ky); const f = (info.knock * 180 * (1 + p.stats.knockback)) / Math.max(0.5, e.mass); e.vx += kx * f; e.vy += ky * f; }
      if (w) { const key = w.id || 'x'; this.dmgByWeapon[key] = (this.dmgByWeapon[key] || 0) + dmg; if (w.dmgDealt != null) w.dmgDealt += dmg; }
      if (!info.quiet || crit) this.fx.dmgNumber(e.x, e.y - e.r, dmg, crit, e.boss);
      if (crit && !info.quiet) this.sfx('crit'); else if (!info.quiet) this.sfx('hit');
      // lifesteal
      if (p.stats.lifesteal > 0 && dmg > 0 && !info.thorns) this.heal(Math.min(dmg * p.stats.lifesteal, p.stats.maxHp * 0.05), true, true);
      // uniques on hit
      if (p.f.u_ignite && Math.random() < 0.1) this.applyStatus(e, 'burn', { dur: 2, dps: dmg * 0.5 });
      if (p.f.u_frost && Math.random() < 0.05) this.applyStatus(e, 'freeze', { dur: 1 });
      info.dmg = dmg; info.crit = crit;
      if (h && h.onHit && !info.execute && !(w && w.noMark)) h.onHit(this, p, e, info);
      if (e.hp <= 0) this.killEnemy(e, info);
      return dmg;
    }
    applyStatus(e, type, o) {
      if (e.dead) return;
      const st = e.st;
      if (type === 'burn') {
        const cur = st.burn, base = Math.min(o.dps, e.maxHp * 2), dps = base * (1 + this.player.stats.burnDmg);
        if (!cur) st.burn = { t: o.dur, base, dps, tick: 0.5 };
        else { cur.t = Math.max(cur.t, o.dur); if (base > cur.base) { cur.base = base; cur.dps = dps; } }
      }
      else if (type === 'bleed') { const cur = st.bleed, dps = Math.min(o.dps, e.maxHp * 2); st.bleed = { t: o.dur, dps: Math.max(dps, cur ? cur.dps : 0), tick: cur ? cur.tick : 0.5 }; }
      else if (type === 'chill') {
        if (e.boss && o.power > 0.7) o.power = 0.7;
        const cur = st.chill; st.chill = { t: Math.max(o.dur, cur ? cur.t : 0), p: Math.max(o.power, cur ? cur.p : 0) };
        if (o.stackFreeze && !o.noStack && !e.boss) { st.chillN = (st.chillN || 0) + 1; if (st.chillN >= o.stackFreeze) { st.chillN = 0; this.applyStatus(e, 'freeze', { dur: 1.5 }); } }
      }
      else if (type === 'freeze') { if (e.boss) { this.applyStatus(e, 'chill', { dur: o.dur, power: 0.6 }); return; } const d = o.dur * (o.noMul ? 1 : (this.player.freezeMul || 1)); if (!st.freeze) this.fx.burst(e.x, e.y, '#bae6fd', 6, { speed: 50, life: 0.4 }); st.freeze = Math.max(st.freeze || 0, d); }
      else if (type === 'stun') { if (e.boss) return; st.stun = Math.max(st.stun || 0, o.dur); }
    }
    killEnemy(e, info) {
      if (e.dead) return;
      e.dead = true;
      const p = this.player;
      this.kills++; p.kills++;
      this.enemyKills[e.type] = (this.enemyKills[e.type] || 0) + 1;
      this.fx.death(e);
      this.sfx('kill');
      // drops
      this.dropLoot(e);
      if (e.def.split && !e.noSplit) { for (let i = 0; i < e.def.split.n; i++) { const a = Math.random() * TAU; const c = this.spawnEnemy(e.def.split.type, e.x + Math.cos(a) * 14, e.y + Math.sin(a) * 14, { tier: e.tier }); c.vx = Math.cos(a) * 160; c.vy = Math.sin(a) * 160; } }
      if (e.def.explode && !info.thorns) { const r = e.def.explode.r; if (U.dist(e.x, e.y, p.x, p.y) < r + p.r) this.hitPlayer(e.dmg * 1.2, e); this.fx.explosion(e.x, e.y, r, '#f97316'); }
      if (e.boss) this.onBossKilled(e);
      if (e.elite) { this.elites++; }
      const h = p.char.hooks; if (h && h.onKill) h.onKill(this, p, e);
      if (p.f.u_soulreaver) this.runMight = Math.min(0.4, this.runMight + 0.0003);
      if (p.f.u_bloodstone) this.heal(0.5, true, true);
      if (p.f.u_void && Math.random() < 0.06) this.spawnProj({ x: e.x, y: e.y, angle: Math.random() * TAU, speed: 280, r: 5, dmg: (12 + p.level) * p.stats.might, pierce: 0, life: 2, weapon: { id: 'unique', def: null }, homing: 6, sprite: { kind: 'orb', color: '#e879f9', size: 4 }, trail: '#e879f9' });
    }
    dropLoot(e) {
      const p = this.player, d = this.diff;
      const xp = e.xp;
      const gemKind = xp >= 100 ? 'purple' : xp >= 25 ? 'red' : xp >= 6 ? 'green' : 'blue';
      this.spawnPickup({ kind: 'gem', x: e.x + U.rand(-6, 6), y: e.y + U.rand(-6, 6), value: xp, gem: gemKind });
      const goldChance = 0.05 + (e.elite ? 1 : 0) + (e.boss ? 1 : 0);
      if (Math.random() < goldChance * Math.min(2, p.stats.luck)) this.spawnPickup({ kind: 'gold', x: e.x + U.rand(-10, 10), y: e.y + U.rand(-10, 10), value: Math.round((e.elite ? 25 : e.boss ? 200 : U.randi(1, 4)) * d.gold) });
      if (!e.boss && !e.elite && Math.random() < 0.004 * (p.f.moreFood ? 2 : 1) * p.stats.luck) this.spawnPickup({ kind: 'food', x: e.x, y: e.y });
      if (e.elite) {
        this.spawnPickup({ kind: 'chest', x: e.x, y: e.y });
        const n = U.randi(2, 4) + Math.floor(p.stats.matFind * 3);
        for (let i = 0; i < n; i++) this.spawnPickup({ kind: 'mat', mat: Math.random() < 0.2 * this.stage.tier ? 'dust' : 'iron', x: e.x + U.rand(-24, 24), y: e.y + U.rand(-24, 24) });
        if (Math.random() < 0.35) this.spawnPickup({ kind: 'ember', x: e.x + U.rand(-20, 20), y: e.y + U.rand(-20, 20), value: 1 });
      }
      if (e.boss) {
        this.spawnPickup({ kind: 'bosschest', x: e.x, y: e.y });
        const tier = this.stage.tier;
        const drops = [['dust', U.randi(3, 6)], ['crystal', U.randi(1, 2) + Math.floor(tier / 2)], ['star', Math.random() < 0.25 + tier * 0.15 ? 1 : 0]];
        drops.forEach(([m, n]) => { for (let i = 0; i < Math.round(n * (1 + p.stats.matFind)); i++) this.spawnPickup({ kind: 'mat', mat: m, x: e.x + U.rand(-40, 40), y: e.y + U.rand(-40, 40) }); });
        const emb = 3 + e.bossTier * 2 + Math.floor(this.heat * 0.5);
        for (let i = 0; i < emb; i++) this.spawnPickup({ kind: 'ember', x: e.x + U.rand(-50, 50), y: e.y + U.rand(-50, 50), value: 1 });
      }
    }
    onBossKilled(e) {
      this.bossKills++; this.bossKillsBy[e.bossId] = (this.bossKillsBy[e.bossId] || 0) + 1;
      if (this.boss === e) this.boss = null;
      if (this.player.f.u_banner) this.runMight += 0.08;
      this.fx.flash('#fff', 0.6); this.fx.shake(18); this.sfx('boss');
      this.notice(e.def.name + ' has fallen!', '#fde68a', 4);
    }

    /* ==================== ENEMIES ==================== */
    get diff() { if (!this._diff || this._diffT !== Math.floor(this.time)) { this._diff = SF.difficulty(this.time, this.mods); this._diffT = Math.floor(this.time); } return this._diff; }
    spawnEnemy(type, x, y, o = {}) {
      const def = SF.ENEMIES[type], d = this.diff, curse = this.player.stats.curse;
      const tier = o.tier != null ? o.tier : d.tier;
      const tierMul = 1 + tier * 0.15;
      const e = {
        id: U.uid(), type, def, x, y, r: def.r, hp: 0, maxHp: 0, speed: def.speed * d.speed * U.rand(0.9, 1.1), dmg: def.dmg * d.dmg, xp: def.xp * d.xp * (0.8 + curse * 0.2), mass: def.mass || 1,
        vx: 0, vy: 0, st: {}, hitFlash: 0, icd: {}, elite: !!o.elite, boss: false, tier, dead: false, contactCd: Math.random() * 0.3, anim: Math.random() * TAU, wave: Math.random() * TAU,
        rush: o.rush || null, life: o.life || 0, atkT: U.rand(0.5, 2), chargeState: null, healT: 2, weakT: 0, weak: 1, spawnT: 0.4, sprite: null, flip: 1,
      };
      e.maxHp = e.hp = def.hp * d.hp * tierMul * (0.85 + curse * 0.15) * (o.hpMul || 1);
      if (e.elite) { e.maxHp = e.hp = e.maxHp * 9; e.r = def.r * 1.45; e.dmg *= 1.5; e.xp *= 12; e.mass *= 3; e.speed *= 0.92; }
      e.sprite = SF.Sprites.enemy(type, e.r, def.col, e.elite ? 3 : tier);
      this.enemies.push(e);
      return e;
    }
    spawnBoss(bossId, tierUp = 0) {
      const def = SF.BOSSES[bossId], d = this.diff;
      const a = Math.random() * TAU, p = this.player;
      const dist = Math.hypot(this.viewW, this.viewH) + 120;
      const e = {
        id: U.uid(), type: bossId, bossId, def, x: p.x + Math.cos(a) * dist, y: p.y + Math.sin(a) * dist, r: def.r, speed: def.speed * (1 + tierUp * 0.05), dmg: def.dmg * d.dmg, xp: def.xp * d.xp, mass: def.mass,
        vx: 0, vy: 0, st: {}, hitFlash: 0, icd: {}, elite: false, boss: true, tier: 3, dead: false, contactCd: 0, anim: 0, wave: 0, atkT: 3, attackIdx: 0, attack: null, bossTier: tierUp, spawnT: 1.2, sprite: null, flip: 1, weakT: 0, weak: 1, healT: 0,
      };
      e.maxHp = e.hp = def.hp * Math.max(1, d.hp * 0.55) * (1 + tierUp * 0.6) * this.mods.bossHp * (0.85 + p.stats.curse * 0.15);
      e.sprite = SF.Sprites.enemy(bossId, e.r, def.col, 0);
      this.enemies.push(e); this.boss = e;
      this.notice(def.name + ' approaches!', '#f87171', 4); this.sfx('boss'); this.fx.shake(12);
      SF.Save.data.codex.bosses[bossId] = SF.Save.data.codex.bosses[bossId] || 0;
      return e;
    }
    spawnPos(pad = 80) {
      const p = this.player, a = Math.random() * TAU;
      const rx = this.viewW + pad + Math.random() * 120, ry = this.viewH + pad + Math.random() * 120;
      // pick a point on the rectangle ring outside the view
      const cx = Math.cos(a), cy = Math.sin(a);
      const t = Math.min(rx / Math.abs(cx || 1e-6), ry / Math.abs(cy || 1e-6));
      return [p.x + cx * t, p.y + cy * t];
    }
    updateSpawns(dt) {
      const d = this.diff, p = this.player, m = d.minute;
      // spawn table
      for (const row of SF.SPAWN_TABLE) if (m >= row.at) this.spawnTable = row;
      const count = this.enemies.length;
      const want = d.count * (0.85 + p.stats.curse * 0.15);
      if (count < want) {
        this.spawnAcc += dt * Math.min(4 + m * 0.6, 2 + (want - count) * 0.12);
        while (this.spawnAcc >= 1 && this.enemies.length < want + 10) {
          this.spawnAcc -= 1;
          const types = this.spawnTable.types; const keys = Object.keys(types);
          const type = U.weightedPick(keys, (k) => types[k]);
          const [x, y] = this.spawnPos();
          this.spawnEnemy(type, x, y);
        }
      }
      // elites
      this.eliteT -= dt;
      if (this.eliteT <= 0 && this.time > 50) {
        this.eliteT = (75 - Math.min(25, m)) / this.mods.elite;
        const keys = Object.keys(this.spawnTable.types).filter((k) => !SF.ENEMIES[k].noSpawn);
        const [x, y] = this.spawnPos(40);
        const e = this.spawnEnemy(U.pick(keys), x, y, { elite: true });
        this.notice('An elite ' + e.def.name + ' hunts you', '#c084fc', 3);
      }
      // scripted events
      while (this.eventIdx < SF.EVENTS.length && this.time >= SF.EVENTS[this.eventIdx].at) { this.runEvent(SF.EVENTS[this.eventIdx]); this.eventIdx++; }
      if (this.time >= 1500) {
        this.lateEventT -= dt;
        if (this.lateEventT <= 0) {
          this.lateCycle = (this.lateCycle || 0) + 1;
          this.lateEventT = 90;
          if (this.lateCycle % 3 === 0) { const idx = Math.floor(this.lateCycle / 3); this.runEvent({ type: 'boss', boss: SF.BOSS_ORDER[idx % 5], tierUp: 1 + Math.floor(idx / 5) + Math.floor((this.time - 1500) / 600) }); }
          else if (this.lateCycle % 3 === 1) this.runEvent({ type: 'swarm', enemy: U.pick(['bat', 'spider', 'bomber', 'wraith']), n: 60 + Math.floor(m * 2) });
          else this.runEvent({ type: 'ring', enemy: U.pick(['brute', 'golem', 'skeleton', 'charger']), n: 30 + Math.floor(m) });
        }
      }
      // braziers & food
      this.brazierT -= dt; if (this.brazierT <= 0) { this.brazierT = 40; const [x, y] = this.spawnPos(-40); this.spawnPickup({ kind: 'brazier', x, y, hp: 3 }); }
      // recycle far enemies
      const maxD2 = Math.pow(Math.hypot(this.viewW, this.viewH) * 1.9, 2);
      for (const e of this.enemies) { if (e.boss || e.rush || e.dead) continue; if (U.dist2(e.x, e.y, p.x, p.y) > maxD2) { const [x, y] = this.spawnPos(); e.x = x; e.y = y; } }
    }
    runEvent(ev) {
      const p = this.player;
      if (ev.type === 'boss') { this.spawnBoss(ev.boss, ev.tierUp || 0); return; }
      if (ev.type === 'swarm') {
        const a = Math.random() * TAU, dir = a + Math.PI; const dist = Math.hypot(this.viewW, this.viewH) + 80;
        const cx = p.x + Math.cos(a) * dist, cy = p.y + Math.sin(a) * dist, px = -Math.sin(a), py = Math.cos(a);
        for (let i = 0; i < ev.n; i++) { const off = (i - ev.n / 2) * 26 + U.rand(-10, 10), back = Math.random() * 200; const e = this.spawnEnemy(ev.enemy, cx + px * off + Math.cos(a) * back, cy + py * off + Math.sin(a) * back, { rush: { x: Math.cos(dir), y: Math.sin(dir) }, life: 16 }); e.speed *= 1.6; }
        this.notice('A swarm rushes in!', '#f0abfc', 3); return;
      }
      if (ev.type === 'ring') {
        const dist = Math.hypot(this.viewW, this.viewH) + 60;
        for (let i = 0; i < ev.n; i++) { const a = (i / ev.n) * TAU; this.spawnEnemy(ev.enemy, p.x + Math.cos(a) * dist, p.y + Math.sin(a) * dist, { hpMul: 1.2 }); }
        this.notice('You are surrounded!', '#f87171', 3);
      }
    }
    updateEnemies(dt) {
      const p = this.player, d = this.diff;
      const px = p.x, py = p.y;
      for (let i = this.enemies.length - 1; i >= 0; i--) {
        const e = this.enemies[i];
        if (e.dead) { this.enemies.splice(i, 1); continue; }
        e.anim += dt * 6; e.hitFlash -= dt; e.spawnT -= dt; e.contactCd -= dt; e.weakT -= dt;
        if (e.life) { e.life -= dt; if (e.life <= 0) { e.dead = true; this.enemies.splice(i, 1); continue; } }
        // statuses
        const st = e.st;
        let spdMul = 1, frozen = false;
        if (st.burn) { st.burn.t -= dt; st.burn.tick -= dt; if (st.burn.tick <= 0) { st.burn.tick = 0.5; this.damageEnemy(e, st.burn.dps * 0.5, { weapon: { id: 'burn' }, quiet: true, noKnock: true }); this.fx.burst(e.x, e.y - e.r * 0.5, '#ff7043', 1, { speed: 30, life: 0.5, up: true, size: 3 }); } if (st.burn.t <= 0) delete st.burn; if (e.dead) continue; }
        if (st.bleed) { st.bleed.t -= dt; st.bleed.tick -= dt; if (st.bleed.tick <= 0) { st.bleed.tick = 0.5; this.damageEnemy(e, st.bleed.dps * 0.5, { weapon: { id: 'bleed' }, quiet: true }); } if (st.bleed.t <= 0) delete st.bleed; if (e.dead) continue; }
        if (st.chill) { st.chill.t -= dt; spdMul *= 1 - st.chill.p; if (st.chill.t <= 0) delete st.chill; }
        if (st.freeze) { st.freeze -= dt; frozen = true; if (st.freeze <= 0) delete st.freeze; }
        if (st.stun) { st.stun -= dt; frozen = true; if (st.stun <= 0) delete st.stun; }
        // movement
        const dx = px - e.x, dy = py - e.y, dist = Math.hypot(dx, dy) || 1;
        const nx = dx / dist, ny = dy / dist;
        let mvx = 0, mvy = 0;
        if (!frozen) {
          if (e.boss) { this.bossAI(e, dt, nx, ny, dist); mvx = e.mvx || 0; mvy = e.mvy || 0; }
          else if (e.rush) { mvx = e.rush.x; mvy = e.rush.y; }
          else if (e.chargeState) {
            const c = e.chargeState; c.t -= dt;
            if (c.phase === 'windup') { if (c.t <= 0) { c.phase = 'go'; c.t = e.def.charge.dur; c.dx = nx; c.dy = ny; } }
            else { mvx = c.dx * (e.def.charge.speed / (e.speed * spdMul || 1)); mvy = c.dy * (e.def.charge.speed / (e.speed * spdMul || 1)); if (c.t <= 0) { e.chargeState = null; e.atkT = e.def.charge.cd; } }
          }
          else {
            const def = e.def;
            if (def.ranged || def.ring) {
              const R = def.ranged || def.ring;
              if (dist > R.keep) { mvx = nx; mvy = ny; } else if (dist < R.keep * 0.6) { mvx = -nx * 0.6; mvy = -ny * 0.6; }
              e.atkT -= dt;
              if (e.atkT <= 0 && dist < R.range) {
                e.atkT = R.cd * U.rand(0.85, 1.15);
                if (def.ranged) this.spawnEnemyProj(e.x, e.y, Math.atan2(dy, dx), R.speed, R.dmg * d.dmg, def.col.eye);
                else for (let k = 0; k < R.n; k++) this.spawnEnemyProj(e.x, e.y, (k / R.n) * TAU + e.anim, R.speed, R.dmg * d.dmg, def.col.eye);
              }
            } else {
              mvx = nx; mvy = ny;
              if (def.move === 'wave') { const s = Math.sin(e.anim * 0.7 + e.wave) * 0.8; mvx += -ny * s; mvy += nx * s; }
              else if (def.move === 'flutter') { const s = Math.sin(e.anim * 1.3 + e.wave) * 0.6; mvx += -ny * s; mvy += nx * s; }
              if (def.charge) { e.atkT -= dt; if (e.atkT <= 0 && dist < 320 && dist > 60) { e.chargeState = { phase: 'windup', t: def.charge.windup }; this.fx.telegraphLine(e, px, py, def.charge.windup); } }
              if (def.heal) { e.healT -= dt; if (e.healT <= 0) { e.healT = def.heal.cd; let n = 0; this.eachEnemyIn(e.x, e.y, def.heal.r, (o) => { if (o !== e && o.hp < o.maxHp) { o.hp = Math.min(o.maxHp, o.hp + o.maxHp * def.heal.pct); n++; } }); if (n) this.fx.ring(e.x, e.y, def.heal.r, '#a3e635', { thin: true }); } }
            }
          }
          if (e.chargeState && e.chargeState.phase === 'windup') { mvx = 0; mvy = 0; }
        }
        const spd = e.speed * spdMul * (e.spawnT > 0 ? 0.5 : 1);
        e.x += mvx * spd * dt + e.vx * dt; e.y += mvy * spd * dt + e.vy * dt;
        e.vx *= Math.pow(0.02, dt); e.vy *= Math.pow(0.02, dt);
        if (mvx !== 0) e.flip = mvx < 0 ? -1 : 1;
        // contact damage
        if (e.contactCd <= 0 && !frozen) {
          const rr = e.r + p.r;
          if (dx * dx + dy * dy < rr * rr) { e.contactCd = e.boss ? 0.7 : 0.55; this.hitPlayer(e.dmg * (e.chargeState && e.chargeState.phase === 'go' ? 1.6 : 1) * (e.weakT > 0 ? e.weak : 1), e); }
        }
        // bomber
        if (e.def.explode && dist < e.r + p.r + 26 && e.spawnT <= 0) { this.damageEnemy(e, e.hp + 1, { quiet: true, weapon: null }); }
      }
      // separation
      const sep = this.frame % 2 === 0;
      if (sep) {
        for (const e of this.enemies) {
          if (e.dead || e.boss) continue;
          this.grid.each(e.x, e.y, e.r + 30, (o) => {
            if (o === e || o.dead || o.id < e.id) return;
            const dx = o.x - e.x, dy = o.y - e.y; const rr = (e.r + o.r) * 0.9; const d2 = dx * dx + dy * dy;
            if (d2 < rr * rr && d2 > 0.01) { const d = Math.sqrt(d2), push = (rr - d) * 0.5; const ux = dx / d, uy = dy / d; const me = e.mass, mo = o.mass, tot = me + mo; e.x -= ux * push * (mo / tot) * 2; e.y -= uy * push * (mo / tot) * 2; if (!o.boss) { o.x += ux * push * (me / tot) * 2; o.y += uy * push * (me / tot) * 2; } }
          });
        }
      }
    }
    spawnEnemyProj(x, y, angle, speed, dmg, color) { this.eprojs.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, r: 6, dmg, life: 4, color: color || '#f87171', dead: false }); }
    bossAI(e, dt, nx, ny, dist) {
      const p = this.player, def = e.def;
      e.mvx = 0; e.mvy = 0;
      if (e.attack) {
        const a = e.attack; a.t -= dt;
        if (a.type === 'charge') { if (a.phase === 'windup') { if (a.t <= 0) { a.phase = 'go'; a.t = 0.75; a.dx = nx; a.dy = ny; } } else { e.mvx = a.dx * 6.5; e.mvy = a.dy * 6.5; if (a.t <= 0) e.attack = null; } }
        else if (a.type === 'dash') { if (a.t <= 0) { a.n--; if (a.n <= 0) e.attack = null; else { a.t = 0.45; a.dx = nx; a.dy = ny; } } else { e.mvx = (a.dx || nx) * 5; e.mvy = (a.dy || ny) * 5; } }
        else if (a.type === 'spiral') { a.tick -= dt; if (a.tick <= 0) { a.tick = 0.09; a.ang += 0.42; for (let k = 0; k < 2; k++) this.spawnEnemyProj(e.x, e.y, a.ang + k * Math.PI, 190, e.dmg * 0.55, def.col.eye); } if (a.t <= 0) e.attack = null; }
        else if (a.type === 'volley') { a.tick -= dt; if (a.tick <= 0) { a.tick = 0.5; a.n--; const base = Math.atan2(p.y - e.y, p.x - e.x); for (let k = -2; k <= 2; k++) this.spawnEnemyProj(e.x, e.y, base + k * 0.18, 260, e.dmg * 0.6, def.col.eye); if (a.n <= 0) e.attack = null; } }
        else if (a.type === 'slam') { if (a.t <= 0) { const inside = U.dist(p.x, p.y, a.x, a.y) < 150 + p.r; if (inside) this.hitPlayer(e.dmg * 1.8, e); this.fx.explosion(a.x, a.y, 150, def.col.eye); this.fx.shake(10); this.sfx('explode'); e.attack = null; } }
        else if (a.type === 'pull') { const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy) || 1; if (d > 80) { p.x += dx / d * 190 * dt; p.y += dy / d * 190 * dt; } if (a.t <= 0) e.attack = null; }
        else if (a.type === 'summon') { if (a.t <= 0) { const type = def.summon || 'skeleton'; for (let k = 0; k < 6 + e.bossTier * 2; k++) { const an = k / 6 * TAU; this.spawnEnemy(type, e.x + Math.cos(an) * (e.r + 30), e.y + Math.sin(an) * (e.r + 30)); } this.fx.ring(e.x, e.y, e.r + 40, def.col.eye); e.attack = null; } }
        else if (a.type === 'ring') { if (a.t <= 0) { const n = 16 + e.bossTier * 4; for (let k = 0; k < n; k++) this.spawnEnemyProj(e.x, e.y, (k / n) * TAU + a.off, 210, e.dmg * 0.6, def.col.eye); e.attack = null; } }
        return;
      }
      e.mvx = nx; e.mvy = ny;
      e.atkT -= dt * this.mods.bossRate;
      if (e.atkT <= 0) {
        e.atkT = 3.4 - Math.min(1.4, e.bossTier * 0.3);
        const type = def.attacks[e.attackIdx % def.attacks.length]; e.attackIdx++;
        if (type === 'charge') { e.attack = { type, phase: 'windup', t: 0.8 }; this.fx.telegraphLine(e, p.x, p.y, 0.8); }
        else if (type === 'dash') e.attack = { type, t: 0.45, n: 3, dx: nx, dy: ny };
        else if (type === 'spiral') e.attack = { type, t: 2.6, tick: 0, ang: Math.random() * TAU };
        else if (type === 'volley') e.attack = { type, t: 2, tick: 0, n: 3 + e.bossTier };
        else if (type === 'slam') { e.attack = { type, t: 1.1, x: p.x, y: p.y }; this.fx.telegraphCircle(p.x, p.y, 150, 1.1, def.col.eye); }
        else if (type === 'pull') { e.attack = { type, t: 1.6 }; this.fx.ring(e.x, e.y, 400, def.col.eye, { thin: true }); }
        else if (type === 'summon') e.attack = { type, t: 0.7 };
        else if (type === 'ring') e.attack = { type, t: 0.6, off: Math.random() };
      }
    }

    /* ==================== PROJECTILES ==================== */
    updateProjectiles(dt) {
      const p = this.player;
      const bx0 = p.x - this.viewW, bx1 = p.x + this.viewW, by0 = p.y - this.viewH, by1 = p.y + this.viewH;
      for (let i = this.projs.length - 1; i >= 0; i--) {
        const pr = this.projs[i];
        if (pr.dead) { this.projs.splice(i, 1); continue; }
        pr.age += dt; pr.life -= dt;
        if (pr.orbit) {
          const o = pr.orbit; o.angle += o.speed * dt; pr.x = p.x + Math.cos(o.angle) * o.radius; pr.y = p.y + Math.sin(o.angle) * o.radius; pr.angle = o.angle + Math.PI / 2;
        } else {
          if (pr.boomerang) {
            const b = pr.boomerang;
            if (pr.age > b.t) {
              const dx = p.x - pr.x, dy = p.y - pr.y, d = Math.hypot(dx, dy) || 1;
              if (b.spiral && pr.age < b.t * 2) { const tang = Math.atan2(dy, dx) + 1.1; pr.vx = Math.cos(tang) * pr.speed; pr.vy = Math.sin(tang) * pr.speed; }
              else { pr.vx = dx / d * pr.speed * 1.3; pr.vy = dy / d * pr.speed * 1.3; }
              if (d < 20 && pr.age > b.t + 0.3) pr.dead = true;
            }
          } else if (pr.homing) {
            const t = pr.target && !pr.target.dead ? pr.target : (pr.target = this.nearestEnemy(pr.x, pr.y, 360));
            if (t) { const want = Math.atan2(t.y - pr.y, t.x - pr.x); let da = want - pr.angle; while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU; pr.angle += U.clamp(da, -pr.homing * dt, pr.homing * dt); pr.vx = Math.cos(pr.angle) * pr.speed; pr.vy = Math.sin(pr.angle) * pr.speed; }
          }
          pr.x += pr.vx * dt; pr.y += pr.vy * dt;
          if (pr.bounce) {
            let b = false;
            if (pr.x < bx0) { pr.x = bx0; pr.vx = Math.abs(pr.vx); b = true; } else if (pr.x > bx1) { pr.x = bx1; pr.vx = -Math.abs(pr.vx); b = true; }
            if (pr.y < by0) { pr.y = by0; pr.vy = Math.abs(pr.vy); b = true; } else if (pr.y > by1) { pr.y = by1; pr.vy = -Math.abs(pr.vy); b = true; }
            if (b) { pr.angle = Math.atan2(pr.vy, pr.vx); if (pr.hits) pr.hits.clear(); if (pr.onBounce) pr.onBounce(this, pr); }
          }
        }
        if (pr.spin) pr.rot += pr.spin * dt;
        if (pr.trail) { pr.trailT -= dt; if (pr.trailT <= 0) { pr.trailT = 0.03; this.fx.trail(pr.x, pr.y, pr.trail, pr.r * 0.5); } }
        // field (void orb / tornado)
        if (pr.field) {
          const f = pr.field; pr.tickT -= dt;
          this.pullEnemies(pr.x, pr.y, f.r, f.pull);
          if (pr.tickT <= 0) { pr.tickT = f.tick; this.eachEnemyIn(pr.x, pr.y, f.r, (e) => this.damageEnemy(e, f.dmg, { weapon: pr.weapon, quiet: true })); }
        }
        if (pr.zap) { pr.tickT -= dt; if (pr.tickT <= 0) { pr.tickT = pr.zap.cd; const list = this.enemiesInRadius(pr.x, pr.y, pr.zap.r); U.shuffle(list).slice(0, 3).forEach((e) => { this.fx.beam(pr.x, pr.y, e.x, e.y, '#7dd3fc', 2, 0.12); this.damageEnemy(e, pr.zap.dmg, { weapon: pr.weapon, knock: 0.2 }); }); } }
        // collision with enemies
        if (pr.dmg > 0 || pr.statuses) {
          const self = this;
          this.grid.each(pr.x, pr.y, pr.r + 64, (e) => {
            if (e.dead || pr.dead) return;
            const rr = pr.r + e.r; const ddx = e.x - pr.x, ddy = e.y - pr.y;
            if (ddx * ddx + ddy * ddy > rr * rr) return;
            if (pr.hits && pr.hits.has(e.id)) return;
            if (pr.hitCd) { const k = pr.uid; if ((e.icd[k] || 0) > self.time) return; e.icd[k] = self.time + pr.hitCd; }
            if (pr.hits) pr.hits.add(e.id);
            self.damageEnemy(e, pr.dmg, { weapon: pr.weapon, kx: pr.vx || ddx, ky: pr.vy || ddy, knock: pr.knock, crit: pr.crit });
            if (pr.statuses) for (const s of pr.statuses) self.applyStatus(e, s.type, s);
            if (pr.onHit && !pr.noOnHit) pr.onHit(self, pr, e);
            pr.hitCount++;
            if (pr.pierce !== -1 && pr.hitCount > pr.pierce) {
              if (pr.ricochet > 0) { pr.ricochet--; const t = self.nearestEnemy(pr.x, pr.y, 300, (o) => o !== e && !pr.hits.has(o.id)); if (t) { pr.angle = Math.atan2(t.y - pr.y, t.x - pr.x); pr.vx = Math.cos(pr.angle) * pr.speed; pr.vy = Math.sin(pr.angle) * pr.speed; pr.hitCount = 0; return; } }
              pr.dead = true; return false;
            }
          });
        }
        if (pr.life <= 0 && !pr.dead) { pr.dead = true; if (pr.onExpire) pr.onExpire(this, pr); }
      }
    }
    updateEnemyProjectiles(dt) {
      const p = this.player;
      for (let i = this.eprojs.length - 1; i >= 0; i--) {
        const pr = this.eprojs[i];
        pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.life -= dt;
        if (pr.dead || pr.life <= 0) { this.eprojs.splice(i, 1); continue; }
        const rr = pr.r + p.r; if (U.dist2(pr.x, pr.y, p.x, p.y) < rr * rr) { this.hitPlayer(pr.dmg, pr); pr.dead = true; this.eprojs.splice(i, 1); }
      }
    }
    updateZones(dt) {
      const p = this.player;
      for (let i = this.zones.length - 1; i >= 0; i--) {
        const z = this.zones[i]; z.age += dt; z.tickT -= dt;
        if (z.follow === 'nearest') { const t = z.target && !z.target.dead ? z.target : (z.target = this.nearestEnemy(z.x, z.y, 700)); if (t) { const dx = t.x - z.x, dy = t.y - z.y, d = Math.hypot(dx, dy) || 1; const s = Math.min(d, z.followSpeed * dt); z.x += dx / d * s; z.y += dy / d * s; } }
        if (z.pull) this.pullEnemies(z.x, z.y, z.r * 1.4, z.pull);
        if (z.tickT <= 0) {
          z.tickT = z.tick;
          if (z.dmg > 0) this.eachEnemyIn(z.x, z.y, z.r, (e) => { this.damageEnemy(e, z.dmg, { weapon: z.weapon, quiet: true, knock: 0 }); if (z.burn) this.applyStatus(e, 'burn', { dur: 2, dps: z.dmg * z.burn / z.tick }); if (z.status) this.applyStatus(e, z.status.type, z.status); });
          if ((z.heal || z.healPct) && U.dist(z.x, z.y, p.x, p.y) < z.r + p.r) this.heal((z.heal || 0) + (z.healPct || 0) * p.stats.maxHp, true);
        }
        if (z.age >= z.dur) { if (z.onEnd) z.onEnd(z); this.zones.splice(i, 1); }
      }
    }
    updateMines(dt) {
      for (let i = this.mines.length - 1; i >= 0; i--) {
        const m = this.mines[i]; m.age += dt; m.armT -= dt;
        if (m.age >= m.life) { this.mines.splice(i, 1); continue; }
        if (m.armT > 0) continue;
        const e = this.nearestEnemy(m.x, m.y, m.r * 0.45);
        if (e) {
          this.explode(m.x, m.y, m.r, m.dmg, m.weapon, { color: m.color });
          if (m.cluster) for (let k = 0; k < m.cluster; k++) { const a = Math.random() * TAU, d = U.rand(30, 70); this.spawnMine({ x: m.x + Math.cos(a) * d, y: m.y + Math.sin(a) * d, r: m.r * 0.7, dmg: m.dmg * 0.5, life: 4, weapon: m.weapon, color: m.color, cluster: 0, armT: 0.3 }); }
          this.mines.splice(i, 1);
        }
      }
    }
    updateAllies(dt) {
      const p = this.player;
      for (let i = this.allies.length - 1; i >= 0; i--) {
        const a = this.allies[i]; a.age += dt; a.atkT -= dt; a.fireT -= dt; a.walk += dt * 8;
        if (a.dead || a.age >= a.life) {
          if (a.explode) this.explode(a.x, a.y, a.explode.r, (typeof a.dmg === 'function' ? a.dmg() : a.dmg) * a.explode.mult, a.weapon || { id: 'ally' }, { color: a.color });
          this.fx.burst(a.x, a.y, a.color, 8, { speed: 60, life: 0.4 });
          this.allies.splice(i, 1); continue;
        }
        const dmg = () => (typeof a.dmg === 'function' ? a.dmg() : a.dmg);
        const wref = a.weapon || { id: 'ally_' + a.kind };
        if (a.kind === 'skeleton' || a.kind === 'clone') {
          const t = a.target && !a.target.dead && U.dist2(a.target.x, a.target.y, p.x, p.y) < 520 * 520 ? a.target : (a.target = this.nearestEnemy(a.x, a.y, 420) || this.nearestEnemy(p.x, p.y, 520));
          if (a.kind === 'clone') {
            if (a.fireT <= 0 && t) { a.fireT = 0.5; for (let k = -1; k <= 1; k++) this.spawnProj({ x: a.x, y: a.y, angle: Math.atan2(t.y - a.y, t.x - a.x) + k * 0.2, speed: 600, r: 5, dmg: dmg(), pierce: 1, life: 0.8, weapon: wref, sprite: { kind: 'dagger', color: '#c084fc', len: 18, wid: 3 } }); }
            continue;
          }
          let tx = p.x, ty = p.y, want = 60;
          if (t) { tx = t.x; ty = t.y; want = t.r + a.attackR * 0.6; }
          const dx = tx - a.x, dy = ty - a.y, d = Math.hypot(dx, dy) || 1;
          if (d > want) { a.x += dx / d * a.speed * dt; a.y += dy / d * a.speed * dt; a.flip = dx < 0 ? -1 : 1; }
          else if (t && a.atkT <= 0) { a.atkT = a.attackCd; this.eachEnemyIn(a.x, a.y, a.attackR + 10, (e) => this.damageEnemy(e, dmg(), { weapon: wref, kx: e.x - a.x, ky: e.y - a.y, knock: 0.5, crit: a.crit || 0 })); this.fx.arc(a.x, a.y, Math.atan2(dy, dx), a.attackR + 10, 0.9, a.color, true); }
          if (U.dist2(a.x, a.y, p.x, p.y) > 700 * 700) { a.x = p.x + U.rand(-40, 40); a.y = p.y + U.rand(-40, 40); }
        } else if (a.kind === 'hawk' || a.kind === 'bat') {
          const orbitR = a.kind === 'hawk' ? 70 : 50;
          if (a.dive) {
            const t = a.dive; a.diveT -= dt;
            if (t.dead || a.diveT <= 0) { a.dive = null; } else { const dx = t.x - a.x, dy = t.y - a.y, d = Math.hypot(dx, dy) || 1; a.x += dx / d * 520 * dt; a.y += dy / d * 520 * dt; a.flip = dx < 0 ? -1 : 1; if (d < t.r + 10) { this.damageEnemy(t, dmg(), { weapon: wref, knock: 0.4 }); if (a.bleed) this.applyStatus(t, 'bleed', { dur: 2, dps: dmg() * 0.3 }); if (a.heal) this.heal(a.heal, true, true); a.dive = null; a.atkT = a.kind === 'hawk' ? 1.1 : 1.4; } }
          } else {
            a.angle += dt * 2.2; const tx = p.x + Math.cos(a.angle + (a.orbitOff || 0)) * orbitR, ty = p.y + Math.sin(a.angle + (a.orbitOff || 0)) * orbitR * 0.6 - 20;
            a.x += (tx - a.x) * Math.min(1, dt * 8); a.y += (ty - a.y) * Math.min(1, dt * 8); a.flip = Math.cos(a.angle) < 0 ? -1 : 1;
            if (a.atkT <= 0) { const t = this.nearestEnemy(p.x, p.y, 260); if (t) { a.dive = t; a.diveT = 1.2; } }
          }
        } else if (a.kind === 'turret') {
          if (a.fireT <= 0) {
            const rate = p.overdriveT > 0 ? 0.5 : 1;
            a.fireT = a.fireCd * rate;
            const t = this.nearestEnemy(a.x, a.y, a.range);
            if (t) { const ang = Math.atan2(t.y - a.y, t.x - a.x); a.aim = ang; if (a.rocket) this.spawnProj({ x: a.x, y: a.y, angle: ang, speed: a.projSpeed * 0.8, r: 7, dmg: dmg() * 1.5, pierce: 0, life: 1.6, weapon: wref, sprite: { kind: 'bolt', color: '#f43f5e', len: 18, wid: 5 }, trail: '#f43f5e', onHit: (g2, pr, e) => g2.explode(pr.x, pr.y, a.rocket.r, dmg() * 1.2, wref, { color: '#f43f5e', small: true, exclude: e }) }); else this.spawnProj({ x: a.x, y: a.y, angle: ang, speed: a.projSpeed, r: 5, dmg: dmg(), pierce: 1, life: 1.2, weapon: wref, sprite: { kind: 'bolt', color: '#fb923c', len: 16, wid: 4 } }); this.sfx('shoot'); }
          }
        } else if (a.kind === 'drone') {
          a.angle += dt * 1.6; const tx = p.x + Math.cos(a.angle + a.orbitOff) * 60, ty = p.y + Math.sin(a.angle + a.orbitOff) * 40 - 30;
          a.x += (tx - a.x) * Math.min(1, dt * 6); a.y += (ty - a.y) * Math.min(1, dt * 6);
          if (a.fireT <= 0) { a.fireT = a.fireCd; const t = this.nearestEnemy(a.x, a.y, a.range); if (t) this.spawnProj({ x: a.x, y: a.y, angle: Math.atan2(t.y - a.y, t.x - a.x), speed: 520, r: 4, dmg: dmg(), pierce: 0, life: 0.9, weapon: wref, sprite: { kind: 'bolt', color: '#fb923c', len: 12, wid: 3 } }); }
        } else if (a.kind === 'wraith') {
          if (!a.target || a.target.dead || a.retarget <= 0) { a.target = this.randomEnemyNear(p.x, p.y, 480); a.retarget = 1.2; }
          a.retarget = (a.retarget || 1.2) - dt;
          if (a.target) { const dx = a.target.x - a.x, dy = a.target.y - a.y, d = Math.hypot(dx, dy) || 1; a.x += dx / d * a.speed * dt; a.y += dy / d * a.speed * dt; a.flip = dx < 0 ? -1 : 1; }
          if (a.atkT <= 0) { a.atkT = 0.3; this.eachEnemyIn(a.x, a.y, 26, (e) => this.damageEnemy(e, dmg() * 0.4, { weapon: wref, knock: 0.3, quiet: true })); }
          this.fx.trail(a.x, a.y, a.color, 6);
        }
      }
    }

    /* ==================== PICKUPS ==================== */
    spawnPickup(o) {
      if (o.kind === 'gem' && this.pickups.length > 700) { // merge into farthest big gem
        let far = null, fd = 0; for (const k of this.pickups) if (k.kind === 'gem') { const d = U.dist2(k.x, k.y, o.x, o.y); if (d > fd) { fd = d; far = k; } }
        if (far) { far.value += o.value; far.gem = far.value >= 100 ? 'purple' : far.value >= 25 ? 'red' : far.value >= 6 ? 'green' : 'blue'; return far; }
      }
      const k = Object.assign({ age: 0, vx: 0, vy: 0, pull: false, dead: false, bob: Math.random() * TAU }, o);
      this.pickups.push(k); return k;
    }
    updatePickups(dt) {
      const p = this.player, mr = p.stats.magnet;
      for (let i = this.pickups.length - 1; i >= 0; i--) {
        const k = this.pickups[i]; k.age += dt;
        const dx = p.x - k.x, dy = p.y - k.y, d2 = dx * dx + dy * dy;
        const pr = k.kind === 'gem' || k.kind === 'gold' || k.kind === 'mat' || k.kind === 'ember' ? mr : 40;
        if (k.kind === 'brazier') {
          // breakable: player's projectiles / touching damages it
          if (d2 < (p.r + 22) * (p.r + 22)) { k.hp -= dt * 6; }
          for (const pj of this.projs) { if (!pj.dead && U.dist2(pj.x, pj.y, k.x, k.y) < (pj.r + 22) * (pj.r + 22)) { k.hp -= 1; pj.hitBrazier = true; break; } }
          if (k.hp <= 0) { this.pickups.splice(i, 1); this.fx.burst(k.x, k.y, '#ff9a3c', 20, { speed: 120, life: 0.6 }); this.sfx('explode'); const r = Math.random(); if (r < 0.35) this.spawnPickup({ kind: 'food', x: k.x, y: k.y }); else if (r < 0.5) this.spawnPickup({ kind: 'magnet', x: k.x, y: k.y }); else if (r < 0.62) this.spawnPickup({ kind: 'bomb', x: k.x, y: k.y }); else if (r < 0.72) this.spawnPickup({ kind: 'clock', x: k.x, y: k.y }); else for (let g = 0; g < 8; g++) this.spawnPickup({ kind: 'gold', x: k.x + U.rand(-20, 20), y: k.y + U.rand(-20, 20), value: Math.round(U.randi(3, 8) * this.diff.gold) }); }
          continue;
        }
        if (k.pull || d2 < pr * pr) {
          k.pull = true;
          const d = Math.sqrt(d2) || 1; const spd = 380 + k.age * 400 + Math.max(0, mr - d) * 2;
          k.x += dx / d * spd * dt; k.y += dy / d * spd * dt;
        }
        if (d2 < (p.r + 12) * (p.r + 12) || (k.pull && d2 < 400)) { this.collect(k); this.pickups.splice(i, 1); }
      }
    }
    collect(k) {
      const p = this.player;
      if (k.kind === 'gem') { this.gainXp(k.value); this.sfx('gem', Math.min(24, Math.floor((this.gemCombo = (this.gemCombo || 0) + 1) / 4))); this.gemComboT = 0.5; }
      else if (k.kind === 'gold') { const v = Math.round(k.value * p.stats.greed); this.gold += v; this.sfx('gold'); this.fx.text(p.x, p.y - 26, '+' + v + ' gold', '#f5c542'); if (p.f.u_goldheal) this.heal(1, true, true); }
      else if (k.kind === 'food') { this.heal(p.stats.maxHp * (p.f.moreFood ? 0.4 : 0.28)); }
      else if (k.kind === 'magnet') { for (const o of this.pickups) if (o.kind === 'gem' || o.kind === 'gold' || o.kind === 'mat' || o.kind === 'ember') o.pull = true; this.fx.ring(p.x, p.y, 600, '#4fd1ff'); this.sfx('pickup'); }
      else if (k.kind === 'bomb') { const list = this.enemiesInRadius(p.x, p.y, 900); list.forEach((e) => this.damageEnemy(e, e.boss ? e.maxHp * 0.1 : e.hp + 1, { quiet: true, weapon: null })); this.fx.flash('#fff', 0.8); this.fx.shake(14); this.sfx('explode'); }
      else if (k.kind === 'clock') { for (const e of this.enemies) this.applyStatus(e, e.boss ? 'chill' : 'freeze', { dur: 5, power: 0.7, noMul: true }); this.fx.flash('#b28dff', 0.5); this.sfx('freeze'); }
      else if (k.kind === 'chest') { this.chestQueue.push({ boss: false }); }
      else if (k.kind === 'bosschest') { this.chestQueue.push({ boss: true }); }
      else if (k.kind === 'mat') { this.mats[k.mat]++; this.fx.text(p.x, p.y - 26, '+1 ' + SF.MAT_BY_ID[k.mat].name, SF.MAT_BY_ID[k.mat].color); this.sfx('pickup'); }
      else if (k.kind === 'ember') { this.embers += k.value; this.fx.text(p.x, p.y - 26, '+' + k.value + ' Soul Ember', '#ff8a3c'); this.sfx('pickup'); }
    }
    gainXp(v) {
      const p = this.player; p.xp += v * p.stats.growth;
      while (p.xp >= p.xpNext) { p.xp -= p.xpNext; this.gainLevel(); }
    }
    gainLevel(silent) { const p = this.player; p.level++; p.xpNext = SF.xpForLevel(p.level); this.levelQueue++; if (!silent) { this.fx.ring(p.x, p.y, 60, '#fde68a'); } }

    /* ==================== META EFFECTS (uniques, sigils) ==================== */
    updateMetaEffects(dt) {
      const p = this.player, f = p.f;
      this.gemComboT = (this.gemComboT || 0) - dt; if (this.gemComboT <= 0) this.gemCombo = 0;
      if (f.u_storm) { this.uStormT = (this.uStormT || 4) - dt; if (this.uStormT <= 0) { this.uStormT = 4; SF.WH.targets(this, p, 3, 300).forEach((e) => { this.fx.beam(p.x, p.y - 20, e.x, e.y, '#fde047', 2, 0.15); this.damageEnemy(e, (20 + p.level * 2) * p.stats.might, { weapon: { id: 'unique' }, knock: 0.3 }); }); } }
      if (f.u_aegis) { this.uAegisT = (this.uAegisT || 20) - dt; if (this.uAegisT <= 0) { this.uAegisT = 20; this.addShield(p.stats.maxHp * 0.12); } }
      if (f.u_starfall) { this.uStarT = (this.uStarT || 8) - dt; if (this.uStarT <= 0) { this.uStarT = 8; const e = this.randomEnemyNear(p.x, p.y, 420); if (e) { const x = e.x, y = e.y; this.meteor(x, y, 0.7, () => this.explode(x, y, 80, (60 + p.level * 6) * p.stats.might, { id: 'unique' }, { color: '#fde68a' })); } } }
      if (f.magnetPulse) { this.pulseT = (this.pulseT || 60) - dt; if (this.pulseT <= 0) { this.pulseT = 60; for (const o of this.pickups) if (o.kind === 'gem') o.pull = true; this.fx.ring(p.x, p.y, 500, '#4fd1ff', { thin: true }); } }
      if (f.timedLevels) { this.tlT = (this.tlT || 300) - dt; if (this.tlT <= 0) { this.tlT = 300; this.gainLevel(); this.notice('Sigil of the Timeless: free level!', '#fbbf24'); } }
    }

    /* ==================== LEVEL UP / CHESTS ==================== */
    genOptions() {
      const p = this.player, pool = [];
      const wOwned = p.weapons.map((w) => w.id), pOwned = p.passives.map((x) => x.id);
      for (const w of p.weapons) if (w.level < w.def.max && !this.banished.has(w.id)) pool.push({ type: 'weapon', id: w.id, def: w.def, level: w.level + 1, weight: w.id === p.char.signature ? 4 : 3 });
      if (p.weapons.length < p.slots.w) for (const id in SF.WEAPONS) { const d = SF.WEAPONS[id]; if (d.char && d.char !== p.char.id) continue; if (wOwned.includes(id) || this.banished.has(id)) continue; pool.push({ type: 'weapon', id, def: d, level: 1, isNew: true, weight: 1 }); }
      for (const ps of p.passives) if (ps.level < ps.def.max && !this.banished.has(ps.id)) pool.push({ type: 'passive', id: ps.id, def: ps.def, level: ps.level + 1, weight: 2.5 });
      if (p.passives.length < p.slots.p) for (const d of SF.PASSIVES) { if (pOwned.includes(d.id) || this.banished.has(d.id)) continue; let w = 1; for (const wp of p.weapons) if (wp.def.evo && wp.def.evo.with === d.id && !wp.evolved) w = 2; pool.push({ type: 'passive', id: d.id, def: d, level: 1, isNew: true, weight: w }); }
      let n = 3;
      if (p.f.extraChoice || Math.random() < Math.min(0.6, (p.stats.luck - 1) * 0.5)) n = 4;
      const out = [];
      while (out.length < n && pool.length) { const pick = U.weightedPick(pool, (o) => o.weight); pool.splice(pool.indexOf(pick), 1); out.push(pick); }
      if (!out.length) { out.push({ type: 'gold', value: Math.round((80 + this.diff.minute * 25) * p.stats.greed) }); out.push({ type: 'heal', value: 0.3 }); }
      // empowered chance from luck
      for (const o of out) if (o.type !== 'gold' && o.type !== 'heal' && !o.isNew && Math.random() < 0.04 * p.stats.luck) { const cur = o.type === 'weapon' ? p.weapons.find((w) => w.id === o.id) : p.passives.find((x) => x.id === o.id); if (cur && cur.level + 2 <= cur.def.max) { o.empowered = true; o.level = cur.level + 2; } }
      return out;
    }
    pickOption(o) {
      const p = this.player;
      if (o.type === 'weapon') { const w = p.weapons.find((x) => x.id === o.id); if (w) w.level = o.level; else this.addWeapon(o.id); }
      else if (o.type === 'passive') { const ps = p.passives.find((x) => x.id === o.id); if (ps) ps.level = o.level; else this.addPassive(o.id); }
      else if (o.type === 'gold') { this.gold += o.value; }
      else if (o.type === 'heal') { this.heal(p.stats.maxHp * o.value, true); }
      this.recalc();
      this.levelQueue--; this.sfx('levelup');
      if (this.levelQueue <= 0) { this.levelQueue = 0; this.state = 'play'; }
      else { this.state = 'levelup'; SF.UI.showLevelUp(this.genOptions()); }
    }
    reroll() { const p = this.player; if (p.rerolls <= 0) return null; p.rerolls--; return this.genOptions(); }
    skip() { const p = this.player; if (p.skips <= 0) return false; p.skips--; this.levelQueue--; if (this.levelQueue <= 0) { this.levelQueue = 0; this.state = 'play'; } else { this.state = 'levelup'; SF.UI.showLevelUp(this.genOptions()); } return true; }
    banish(o) { const p = this.player; if (p.banishes <= 0) return null; p.banishes--; this.banished.add(o.id); return this.genOptions(); }
    evolvable() { const p = this.player; return p.weapons.filter((w) => w.def.evo && !w.evolved && w.level >= w.def.max && p.passives.some((ps) => ps.id === w.def.evo.with)); }
    openChest(c) {
      const p = this.player, rewards = [];
      const ev = this.evolvable();
      if (ev.length) {
        const w = ev[0]; w.evolved = true; this.evolves++;
        rewards.push({ type: 'evolve', def: w.def, name: w.def.evo.name, icon: w.def.evo.icon, desc: w.def.evo.desc });
        this.fx.flash('#fff', 0.9); this.sfx('evolve');
      } else {
        let n = 1;
        const r = Math.random(), luck = p.stats.chestLuck + (p.stats.luck - 1) * 0.5;
        if (c.boss) n = 5; else if (r < 0.06 + luck * 0.15) n = 5; else if (r < 0.28 + luck * 0.4) n = 3;
        for (let i = 0; i < n; i++) {
          const ups = [];
          for (const w of p.weapons) if (w.level < w.def.max) ups.push({ type: 'weapon', obj: w, def: w.def });
          for (const ps of p.passives) if (ps.level < ps.def.max) ups.push({ type: 'passive', obj: ps, def: ps.def });
          if (!ups.length) { const g = Math.round((30 + this.diff.minute * 8) * p.stats.greed); this.gold += g; rewards.push({ type: 'gold', value: g }); continue; }
          const u = U.pick(ups); u.obj.level++; rewards.push({ type: u.type, def: u.def, level: u.obj.level });
        }
        this.sfx('chest');
      }
      const gold = Math.round((40 + this.diff.minute * 15) * (c.boss ? 4 : 1) * p.stats.greed); this.gold += gold; rewards.push({ type: 'gold', value: gold });
      const matN = (c.boss ? 3 : 1) + Math.floor(p.stats.matFind * 2);
      for (let i = 0; i < matN; i++) { const m = c.boss ? U.pick(['dust', 'crystal', 'dust']) : (Math.random() < 0.25 ? 'dust' : 'iron'); this.mats[m]++; rewards.push({ type: 'mat', mat: m }); }
      this.recalc();
      SF.UI.showChest(rewards, c.boss);
    }
    closeChest() { if (this.state === 'chest') this.state = 'play'; }

    /* ==================== END OF RUN ==================== */
    summary() {
      const p = this.player, stage = this.stage, heatB = SF.heatBonus(this.heat);
      const timeBonus = Math.round(this.time * 1.2 + this.kills * 0.08);
      const gold = Math.round((this.gold + timeBonus) * stage.reward * heatB);
      const embers = Math.round(this.embers * (p.f.emberBonus ? 1.5 : 1) * (1 + this.heat * 0.05));
      const charXp = Math.round((this.time * 2 + this.kills * 0.5 + p.level * 12 + this.bossKills * 150 + this.elites * 20) * (1 + p.stats.xpBonus) * Math.sqrt(stage.reward) * heatB);
      const mats = { iron: Math.round(this.mats.iron * heatB), dust: Math.round(this.mats.dust * heatB), crystal: this.mats.crystal, star: this.mats.star };
      return {
        charId: p.char.id, stageId: stage.id, time: this.time, kills: this.kills, level: p.level, bossKills: this.bossKills, elites: this.elites, evolves: this.evolves, heat: this.heat,
        gold, embers, charXp, mats, enemyKills: this.enemyKills, bossKillsBy: this.bossKillsBy, dmgByWeapon: this.dmgByWeapon,
        weapons: p.weapons.map((w) => ({ id: w.id, level: w.level, evolved: w.evolved, dmg: w.dmgDealt })), passives: p.passives.map((x) => ({ id: x.id, level: x.level })), eclipse: this.eclipse,
      };
    }
    quit() { this.state = 'over'; }
    notice(text, color, dur) { SF.UI.notice(text, color, dur); }
    sfx(n, p) { SF.Audio.play(n, p); }
  }

  SF.Game = Game;
})();
