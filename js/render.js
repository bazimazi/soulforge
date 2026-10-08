/* SOULFORGE — renderer: camera, world, lighting, particles & effects */
'use strict';
(function () {
  const U = SF.U, S = SF.Sprites, TAU = U.TAU;

  /* ---------------- FX system ---------------- */
  class FX {
    constructor() { this.clear(); this.shakeAmt = 0; this.flashA = 0; this.flashCol = '#fff'; this.dmgEnabled = true; this.shakeMul = 1; }
    clear() { this.parts = []; this.texts = []; this.rings = []; this.novas = []; this.beams = []; this.lines = []; this.arcs = []; this.lobs = []; this.meteors = []; this.tele = []; this.explosions = []; this.bolts = []; this.whips = []; this.lights = []; this.corpses = []; }
    burst(x, y, color, n, o = {}) {
      if (this.parts.length > 2200) return;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU, sp = (o.speed || 90) * (0.4 + Math.random() * 0.8);
        this.parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (o.up ? 60 : 0), life: (o.life || 0.5) * (0.6 + Math.random() * 0.6), max: 1, size: (o.size || 4) * (0.6 + Math.random() * 0.8), color, add: o.add !== false, grav: o.grav || 0 });
        const p = this.parts[this.parts.length - 1]; p.max = p.life;
      }
    }
    trail(x, y, color, size) { if (this.parts.length > 2200) return; this.parts.push({ x, y, vx: U.rand(-10, 10), vy: U.rand(-10, 10), life: 0.25, max: 0.25, size: size || 4, color, add: true, grav: 0 }); }
    ring(x, y, r, color, o = {}) { this.rings.push({ x, y, r, color, life: o.life || 0.45, max: o.life || 0.45, thin: !!o.thin }); }
    nova(n, color, thin) { this.novas.push({ n, color, thin }); }
    beam(x1, y1, x2, y2, color, w, life) { this.beams.push({ x1, y1, x2, y2, color, w: w || 3, life: life || 0.15, max: life || 0.15, seed: Math.random() * 1000 }); }
    line(x, y, angle, len, width, color) { this.lines.push({ x, y, angle, len, width, color, life: 0.4, max: 0.4 }); this.burst(x + Math.cos(angle) * len / 2, y + Math.sin(angle) * len / 2, color, 8, { speed: 80, life: 0.4 }); }
    arc(x, y, angle, r, halfArc, color, thin) { this.arcs.push({ x, y, angle, r, halfArc, color, life: thin ? 0.16 : 0.28, max: thin ? 0.16 : 0.28, thin }); }
    lob(x, y, tx, ty, t, color) { this.lobs.push({ x, y, tx, ty, t: 0, max: t, color }); }
    meteor(x, y, t) { this.meteors.push({ x, y, t: 0, max: t }); this.tele.push({ type: 'circle', x, y, r: 60, t: 0, max: t, color: '#ff7043' }); }
    arrowFall(x, y, color, t) { this.meteors.push({ x, y, t: 0, max: t, small: true, color }); }
    telegraphLine(e, px, py, t) { this.tele.push({ type: 'line', e, px, py, t: 0, max: t }); }
    telegraphCircle(x, y, r, t, color) { this.tele.push({ type: 'circle', x, y, r, t, max: t, t: 0, color }); }
    explosion(x, y, r, color, small) { this.explosions.push({ x, y, r, color, life: small ? 0.25 : 0.45, max: small ? 0.25 : 0.45 }); this.burst(x, y, color, small ? 6 : Math.min(30, 8 + r * 0.25), { speed: r * 2.2, life: 0.5, size: small ? 3 : 5 }); if (!small) this.burst(x, y, '#fff', 4, { speed: r, life: 0.3, size: 3 }); }
    lightning(x, y, color) { this.bolts.push({ x, y, color: color || '#fde047', life: 0.22, max: 0.22, seed: Math.random() * 100 }); this.burst(x, y, color || '#fde047', 10, { speed: 120, life: 0.35, size: 3 }); }
    whip(x, y, sd, len, hgt, color) { this.whips.push({ x, y, sd, len, hgt, color, life: 0.2, max: 0.2 }); }
    shake(a) { this.shakeAmt = Math.max(this.shakeAmt, a * this.shakeMul); }
    flash(color, a) { this.flashCol = color; this.flashA = Math.max(this.flashA, a); }
    text(x, y, text, color, small) { if (this.texts.length > 160) this.texts.shift(); this.texts.push({ x, y, text, color, life: 1.0, max: 1.0, vy: -40, small }); }
    dmgNumber(x, y, dmg, crit, boss) {
      if (!this.dmgEnabled) return;
      if (this.texts.length > 140 && !crit) return;
      this.texts.push({ x: x + U.rand(-8, 8), y, text: U.fmt(dmg), color: crit ? '#fde047' : '#fff', life: crit ? 0.9 : 0.6, max: crit ? 0.9 : 0.6, vy: crit ? -70 : -45, crit, dmg: true });
    }
    death(e) {
      const col = e.def.col.body;
      this.burst(e.x, e.y, col, e.boss ? 60 : e.elite ? 30 : 8, { speed: e.boss ? 260 : 110, life: 0.6, size: e.boss ? 7 : 4, add: false, grav: 200 });
      this.burst(e.x, e.y, e.def.col.eye, e.boss ? 30 : 4, { speed: 100, life: 0.5, size: 3 });
      if (this.corpses.length < 60) this.corpses.push({ x: e.x, y: e.y, sprite: e.sprite, life: 1.2, max: 1.2, flip: e.flip });
    }
    update(dt) {
      const P = this.parts;
      for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; p.life -= dt; if (p.life <= 0) { P[i] = P[P.length - 1]; P.pop(); continue; } p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.grav * dt; if (!p.ambient) { const dmp = Math.pow(0.1, dt); p.vx *= dmp; p.vy *= dmp; } }
      const dec = (arr) => { for (let i = arr.length - 1; i >= 0; i--) { arr[i].life -= dt; if (arr[i].life <= 0) arr.splice(i, 1); } };
      dec(this.rings); dec(this.beams); dec(this.lines); dec(this.arcs); dec(this.explosions); dec(this.bolts); dec(this.whips); dec(this.corpses);
      for (let i = this.texts.length - 1; i >= 0; i--) { const t = this.texts[i]; t.life -= dt; t.y += t.vy * dt; t.vy *= 0.92; if (t.life <= 0) this.texts.splice(i, 1); }
      for (let i = this.novas.length - 1; i >= 0; i--) if (this.novas[i].n.dead) this.novas.splice(i, 1);
      const inc = (arr) => { for (let i = arr.length - 1; i >= 0; i--) { arr[i].t += dt; if (arr[i].t >= arr[i].max) arr.splice(i, 1); } };
      inc(this.lobs); inc(this.meteors); inc(this.tele);
      this.shakeAmt *= Math.pow(0.02, dt); if (this.shakeAmt < 0.3) this.shakeAmt = 0;
      this.flashA = Math.max(0, this.flashA - dt * 2.2);
    }
  }

  /* ---------------- Renderer ---------------- */
  class Renderer {
    constructor(canvas) {
      this.canvas = canvas; this.ctx = canvas.getContext('2d', { alpha: false });
      this.fx = new FX();
      this.light = document.createElement('canvas'); this.lctx = this.light.getContext('2d');
      this.cam = { x: 0, y: 0 }; this.zoom = 1; this.dpr = 1; this.quality = 1;
      this.stage = SF.STAGES[0]; this.chunkCache = new Map(); this.menuT = 0;
      this.resize();
      window.addEventListener('resize', () => this.resize());
    }
    resize() {
      const q = this.quality || 1;
      this.dpr = Math.min(window.devicePixelRatio || 1, 1.5) * q;
      this.W = Math.floor(window.innerWidth * this.dpr); this.H = Math.floor(window.innerHeight * this.dpr);
      this.canvas.width = this.W; this.canvas.height = this.H;
      this.canvas.style.width = window.innerWidth + 'px'; this.canvas.style.height = window.innerHeight + 'px';
      this.zoom = U.clamp(Math.min(this.W / 1500, this.H / 850) * 1.05, 0.5, 1.8) * this.dpr;
      this.light.width = Math.ceil(this.W / 4); this.light.height = Math.ceil(this.H / 4);
      this.ctx.imageSmoothingEnabled = true;
    }
    setStage(stage) { this.stage = stage; this.chunkCache.clear(); this.groundPattern = null; }
    worldToScreen(x, y) { return [(x - this.cam.x) * this.zoom + this.W / 2, (y - this.cam.y) * this.zoom + this.H / 2]; }

    render(g, dt) {
      const ctx = this.ctx;
      this.dt = dt; this.fx.update(dt);
      if (!g || g.state === 'idle') { this.renderMenu(dt); return; }
      const p = g.player;
      // camera follow
      this.cam.x += (p.x - this.cam.x) * Math.min(1, dt * 10); this.cam.y += (p.y - this.cam.y) * Math.min(1, dt * 10);
      g.viewW = this.W / this.zoom / 2; g.viewH = this.H / this.zoom / 2;
      let sx = 0, sy = 0;
      if (this.fx.shakeAmt > 0) { sx = (Math.random() - 0.5) * this.fx.shakeAmt * this.dpr; sy = (Math.random() - 0.5) * this.fx.shakeAmt * this.dpr; }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = this.stage.pal.sky; ctx.fillRect(0, 0, this.W, this.H);
      ctx.setTransform(this.zoom, 0, 0, this.zoom, this.W / 2 - this.cam.x * this.zoom + sx, this.H / 2 - this.cam.y * this.zoom + sy);
      this.fx.lights.push([p.x, p.y, 460, 1]); this.fx.lights.push([p.x, p.y, 900, 0.35]);
      const vw = g.viewW + 80, vh = g.viewH + 80;
      const x0 = this.cam.x - vw, y0 = this.cam.y - vh, x1 = this.cam.x + vw, y1 = this.cam.y + vh;
      this.drawGround(x0, y0, x1, y1);
      this.drawProps(x0, y0, x1, y1);
      this.drawFog(g, x0, y0, x1, y1);
      this.drawZones(g);
      this.drawMines(g);
      this.drawTelegraphs(g);
      this.drawCorpses();
      this.drawPickups(g, x0, y0, x1, y1);
      this.drawShadows(g, x0, y0, x1, y1);
      this.drawEnemies(g, x0, y0, x1, y1);
      this.drawAllies(g);
      this.drawPlayer(g);
      this.drawEnemyProjectiles(g);
      this.drawProjectiles(g, false);
      // lighting overlay
      this.drawLighting(g, sx, sy);
      ctx.setTransform(this.zoom, 0, 0, this.zoom, this.W / 2 - this.cam.x * this.zoom + sx, this.H / 2 - this.cam.y * this.zoom + sy);
      this.drawAdditive(g);
      this.drawTexts();
      this.drawPlayerBars(g);
      // screen space
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.drawPost(g);
      this.drawIndicators(g);
    }

    /* ---- fog & ambient motes ---- */
    drawFog(g, x0, y0, x1, y1) {
      const ctx = this.ctx, t = g.time, pal = this.stage.pal;
      if (!this.fogSprite || this.fogCol !== pal.fog) { this.fogSprite = S.glow(pal.fog, 160); this.fogCol = pal.fog; }
      const w = x1 - x0, h = y1 - y0;
      ctx.globalAlpha = 0.16;
      for (let i = 0; i < 9; i++) {
        const sx = ((U.hash2(i, 1, 7) * 1.7 + t * (0.015 + i * 0.004)) % 1.7) - 0.35, sy = ((U.hash2(i, 2, 7) * 1.7 + Math.sin(t * 0.1 + i) * 0.05) % 1.7) - 0.35;
        const fx = x0 + sx * w, fy = y0 + sy * h, r = 180 + U.hash2(i, 3, 7) * 200;
        ctx.drawImage(this.fogSprite, fx - r, fy - r, r * 2, r * 2);
      }
      ctx.globalAlpha = 1;
      if (this.dt > 0 && Math.random() < 0.5 && this.fx.parts.length < 1800) this.fx.parts.push({ x: x0 + Math.random() * w, y: y0 + Math.random() * h, vx: U.rand(-8, 8), vy: U.rand(-22, -8), life: 3, max: 3, size: U.rand(1.5, 3), color: pal.ember, add: true, grav: 0, ambient: true });
    }
    /* ---- ground ---- */
    drawGround(x0, y0, x1, y1) {
      const ctx = this.ctx;
      if (!this.groundPattern) this.groundPattern = ctx.createPattern(S.groundTile(this.stage.pal), 'repeat');
      ctx.fillStyle = this.groundPattern; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
    chunkProps(cx, cy) {
      const key = cx + ',' + cy; let list = this.chunkCache.get(key);
      if (list) return list;
      list = [];
      const seed = this.stage.pal.seed;
      const n = Math.floor(U.hash2(cx, cy, seed) * 4);
      for (let i = 0; i < n; i++) {
        const h1 = U.hash2(cx * 7 + i, cy * 13 + i, seed + 1), h2 = U.hash2(cx * 3 - i, cy * 5 + i * 2, seed + 2), h3 = U.hash2(cx + i * 11, cy - i * 17, seed + 3);
        const kind = this.stage.props[Math.floor(h3 * this.stage.props.length)];
        list.push({ x: cx * 320 + h1 * 320, y: cy * 320 + h2 * 320, sprite: S.prop(kind, Math.floor(h1 * 9999) + i, this.stage.pal) });
      }
      // keep origin clear
      if (cx === 0 && cy === 0) list = [];
      this.chunkCache.set(key, list); return list;
    }
    drawProps(x0, y0, x1, y1) {
      const ctx = this.ctx;
      for (let cy = Math.floor(y0 / 320); cy <= Math.floor(y1 / 320); cy++) for (let cx = Math.floor(x0 / 320); cx <= Math.floor(x1 / 320); cx++) {
        for (const pr of this.chunkProps(cx, cy)) { ctx.globalAlpha = 0.35; ctx.fillStyle = '#000'; ctx.beginPath(); ctx.ellipse(pr.x, pr.y + 8, 22, 9, 0, 0, TAU); ctx.fill(); ctx.globalAlpha = 1; ctx.drawImage(pr.sprite, pr.x - pr.sprite.ox, pr.y - pr.sprite.oy); }
      }
    }
    drawZones(g) {
      const ctx = this.ctx, t = g.time;
      for (const z of g.zones) {
        const fade = Math.min(1, z.age * 4, (z.dur - z.age) * 2);
        ctx.globalAlpha = fade;
        if (z.kind === 'blackhole') {
          const gr = ctx.createRadialGradient(z.x, z.y, 0, z.x, z.y, z.r); gr.addColorStop(0, '#000'); gr.addColorStop(0.55, 'rgba(10,0,25,0.95)'); gr.addColorStop(0.85, U.rgba(z.color, 0.5)); gr.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.fill();
          ctx.strokeStyle = U.rgba(z.color, 0.8); ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(z.x, z.y, z.r * 1.05, z.r * 0.35, t * 2, 0, TAU); ctx.stroke();
          this.fx.lights.push([z.x, z.y, z.r * 1.5, 0.5]);
        } else if (z.kind === 'laser') {
          const gr = ctx.createRadialGradient(z.x, z.y, 0, z.x, z.y, z.r); gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.4, U.rgba(z.color, 0.7)); gr.addColorStop(1, U.rgba(z.color, 0));
          ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.fill();
          this.fx.lights.push([z.x, z.y, z.r * 3, 1]);
        } else {
          const pulse = 0.85 + Math.sin(t * 6 + z.x) * 0.15;
          const gr = ctx.createRadialGradient(z.x, z.y, 0, z.x, z.y, z.r); gr.addColorStop(0, U.rgba(z.color, 0.45 * pulse)); gr.addColorStop(0.7, U.rgba(z.color, 0.25)); gr.addColorStop(1, U.rgba(z.color, 0));
          ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.fill();
          ctx.strokeStyle = U.rgba(z.color, 0.5 * pulse); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(z.x, z.y, z.r * (0.95 + Math.sin(t * 4) * 0.03), 0, TAU); ctx.stroke();
          if (z.kind === 'fire' && this.dt > 0 && Math.random() < 0.5) this.fx.burst(z.x + U.rand(-z.r, z.r) * 0.8, z.y + U.rand(-z.r, z.r) * 0.8, '#ff9a3c', 1, { speed: 20, life: 0.5, up: true, size: 3 });
          this.fx.lights.push([z.x, z.y, z.r * 1.8, 0.5]);
        }
      }
      ctx.globalAlpha = 1;
    }
    drawMines(g) {
      const ctx = this.ctx;
      for (const m of g.mines) {
        const pulse = 0.5 + Math.sin(g.time * 6 + m.pulse) * 0.5;
        ctx.drawImage(S.glow(m.color, 14), m.x - 14, m.y - 14);
        ctx.fillStyle = '#223'; ctx.beginPath(); ctx.arc(m.x, m.y, 7, 0, TAU); ctx.fill();
        ctx.fillStyle = m.color; ctx.globalAlpha = 0.5 + pulse * 0.5; ctx.beginPath(); ctx.arc(m.x, m.y, 3.5, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
      }
    }
    drawTelegraphs(g) {
      const ctx = this.ctx;
      for (const t of this.fx.tele) {
        const k = t.t / t.max;
        if (t.type === 'circle') {
          ctx.fillStyle = U.rgba(t.color || '#f87171', 0.18); ctx.beginPath(); ctx.arc(t.x, t.y, t.r, 0, TAU); ctx.fill();
          ctx.strokeStyle = U.rgba(t.color || '#f87171', 0.7); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(t.x, t.y, t.r * k, 0, TAU); ctx.stroke();
          ctx.beginPath(); ctx.arc(t.x, t.y, t.r, 0, TAU); ctx.stroke();
        } else if (t.type === 'line' && t.e && !t.e.dead) {
          const e = t.e; const a = Math.atan2(t.py - e.y, t.px - e.x); const len = 520;
          ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(a);
          ctx.fillStyle = 'rgba(248,113,113,0.16)'; ctx.fillRect(0, -e.r, len, e.r * 2);
          ctx.fillStyle = 'rgba(248,113,113,0.45)'; ctx.fillRect(0, -e.r, len * k, e.r * 2);
          ctx.restore();
        }
      }
    }
    drawCorpses() {
      const ctx = this.ctx;
      for (const c of this.fx.corpses) { ctx.globalAlpha = (c.life / c.max) * 0.5; ctx.save(); ctx.translate(c.x, c.y); ctx.scale(c.flip, 0.4 + 0.6 * (c.life / c.max)); ctx.drawImage(c.sprite, -c.sprite.ox, -c.sprite.oy); ctx.restore(); }
      ctx.globalAlpha = 1;
    }
    drawPickups(g, x0, y0, x1, y1) {
      const ctx = this.ctx, t = g.time;
      const gemCol = { blue: '#60a5fa', green: '#4ade80', red: '#f87171', purple: '#c084fc' };
      let lights = 0;
      for (const k of g.pickups) {
        if (k.x < x0 || k.x > x1 || k.y < y0 || k.y > y1) continue;
        const bob = Math.sin(t * 4 + k.bob) * 2;
        if (k.kind === 'gem') { const r = k.gem === 'purple' ? 8 : k.gem === 'red' ? 7 : 6; const sp = S.gem(gemCol[k.gem], r); ctx.drawImage(sp, k.x - sp.ox, k.y - sp.oy + bob); }
        else if (k.kind === 'gold') { const sp = S.coin(6); ctx.drawImage(sp, k.x - sp.ox, k.y - sp.oy + bob); }
        else if (k.kind === 'mat') { const sp = S.pickup('material'); ctx.save(); ctx.translate(k.x, k.y + bob); const c = SF.MAT_BY_ID[k.mat].color; ctx.drawImage(S.tint(sp, U.rgba(c, 0.45)), -sp.ox, -sp.oy); ctx.restore(); }
        else { const sp = S.pickup(k.kind); ctx.drawImage(sp, k.x - sp.ox, k.y - sp.oy + (k.kind === 'brazier' ? 0 : bob)); if (k.kind === 'brazier' || k.kind === 'chest' || k.kind === 'bosschest') { if (lights++ < 20) this.fx.lights.push([k.x, k.y, 120, 0.8]); if (k.kind === 'brazier' && this.dt > 0 && Math.random() < 0.3) this.fx.burst(k.x + U.rand(-4, 4), k.y - 8, '#ff9a3c', 1, { speed: 20, life: 0.7, up: true, size: 3 }); } }
      }
    }
    drawShadows(g, x0, y0, x1, y1) {
      const ctx = this.ctx; ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      for (const e of g.enemies) { if (e.x < x0 || e.x > x1 || e.y < y0 || e.y > y1) continue; ctx.moveTo(e.x + e.r, e.y + e.r * 0.8); ctx.ellipse(e.x, e.y + e.r * 0.8, e.r, e.r * 0.4, 0, 0, TAU); }
      for (const a of g.allies) { ctx.moveTo(a.x + 10, a.y + 12); ctx.ellipse(a.x, a.y + 12, 10, 4, 0, 0, TAU); }
      const p = g.player; ctx.moveTo(p.x + 14, p.y + 24); ctx.ellipse(p.x, p.y + 24, 14, 5, 0, 0, TAU);
      ctx.fill();
    }
    drawEnemies(g, x0, y0, x1, y1) {
      const ctx = this.ctx, t = g.time;
      const tint = this.stage.enemyTint;
      for (const e of g.enemies) {
        if (e.x < x0 - 60 || e.x > x1 + 60 || e.y < y0 - 60 || e.y > y1 + 60) continue;
        const sp = e.sprite; const frozen = e.st.freeze > 0;
        const bobY = frozen ? 0 : Math.abs(Math.sin(e.anim)) * (e.boss ? 3 : 2);
        const sqx = 1 + (frozen ? 0 : Math.sin(e.anim * 2) * 0.05), sqy = 1 - (frozen ? 0 : Math.sin(e.anim * 2) * 0.05);
        ctx.save(); ctx.translate(e.x, e.y - bobY);
        if (e.spawnT > 0) ctx.globalAlpha = Math.max(0.2, 1 - e.spawnT * 2);
        ctx.scale(e.flip * sqx, sqy);
        if (e.elite || e.boss) { ctx.globalAlpha *= 0.6; ctx.drawImage(S.glow(e.def.col.eye, e.r * 2), -e.r * 2, -e.r * 2); ctx.globalAlpha = e.spawnT > 0 ? Math.max(0.2, 1 - e.spawnT * 2) : 1; }
        if (e.hitFlash > 0) ctx.drawImage(S.flash(sp), -sp.ox, -sp.oy);
        else {
          ctx.drawImage(sp, -sp.ox, -sp.oy);
          if (frozen) ctx.drawImage(S.tint(sp, 'rgba(160,220,255,0.55)'), -sp.ox, -sp.oy);
          else if (e.st.chill) ctx.drawImage(S.tint(sp, 'rgba(120,180,255,0.3)'), -sp.ox, -sp.oy);
          else if (e.st.burn) ctx.drawImage(S.tint(sp, Math.sin(t * 20) > 0 ? 'rgba(255,120,40,0.3)' : 'rgba(255,120,40,0.15)'), -sp.ox, -sp.oy);
          else if (tint) ctx.drawImage(S.tint(sp, tint), -sp.ox, -sp.oy);
        }
        ctx.restore(); ctx.globalAlpha = 1;
        if (e.st.stun) { ctx.fillStyle = '#fde047'; for (let i = 0; i < 3; i++) { const a = t * 6 + i * 2.1; ctx.beginPath(); ctx.arc(e.x + Math.cos(a) * 12, e.y - e.r - 8 + Math.sin(a) * 4, 2, 0, TAU); ctx.fill(); } }
        if (e.st.hunted) { ctx.strokeStyle = '#fde047'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 6, t * 3, t * 3 + 1.2); ctx.stroke(); ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 6, t * 3 + Math.PI, t * 3 + Math.PI + 1.2); ctx.stroke(); }
        if (e.st.marks > 0) { ctx.fillStyle = '#e879f9'; for (let i = 0; i < e.st.marks; i++) { ctx.beginPath(); ctx.arc(e.x - (e.st.marks - 1) * 3 + i * 6, e.y - e.r - 6, 2, 0, TAU); ctx.fill(); } }
        if (e.st.deathMark) { ctx.strokeStyle = '#c084fc'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(e.x - 6, e.y - e.r - 14); ctx.lineTo(e.x + 6, e.y - e.r - 4); ctx.moveTo(e.x + 6, e.y - e.r - 14); ctx.lineTo(e.x - 6, e.y - e.r - 4); ctx.stroke(); }
        if ((e.elite || e.boss) && e.hp < e.maxHp) { const w = e.r * 2.4; ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(e.x - w / 2, e.y - e.r - 12, w, 4); ctx.fillStyle = e.boss ? '#f87171' : '#c084fc'; ctx.fillRect(e.x - w / 2, e.y - e.r - 12, w * Math.max(0, e.hp / e.maxHp), 4); }
        if (e.elite) this.fx.lights.push([e.x, e.y, 110, 0.5]);
        else if (e.boss) this.fx.lights.push([e.x, e.y, 200, 0.8]);
        else if (this.fx.lights.length < 300) this.fx.lights.push([e.x, e.y, e.r * 2.2 + 16, 0.28]);
      }
    }
    drawAllies(g) {
      const ctx = this.ctx, t = g.time;
      for (const a of g.allies) {
        const fade = Math.min(1, (a.life - a.age) * 2, a.age * 3);
        ctx.save(); ctx.translate(a.x, a.y); ctx.globalAlpha = fade; ctx.scale(a.flip || 1, 1);
        const c = a.color;
        ctx.drawImage(S.glow(c, 18), -18, -18 + 4);
        if (a.kind === 'skeleton') { const sp = S.enemy('skeleton', 12, { body: '#d6cfc0', eye: c }, 0); ctx.drawImage(sp, -sp.ox, -sp.oy + Math.abs(Math.sin(a.walk)) * -2); }
        else if (a.kind === 'wraith') { const sp = S.enemy('wraith', 13, { body: '#86efac', eye: '#fff' }, 0); ctx.drawImage(sp, -sp.ox, -sp.oy); }
        else if (a.kind === 'hawk') { ctx.rotate(Math.sin(t * 12) * 0.15); ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(0, 4); ctx.quadraticCurveTo(-12, -10, -22, -2); ctx.quadraticCurveTo(-8, -2, 0, 2); ctx.quadraticCurveTo(8, -2, 22, -2); ctx.quadraticCurveTo(12, -10, 0, 4); ctx.fill(); ctx.fillStyle = '#5a3a1a'; ctx.beginPath(); ctx.arc(0, 0, 4, 0, TAU); ctx.fill(); ctx.fillStyle = '#f5c542'; ctx.beginPath(); ctx.moveTo(4, 0); ctx.lineTo(9, 1); ctx.lineTo(4, 2); ctx.fill(); }
        else if (a.kind === 'bat') { const sp = S.enemy('bat', 8, { body: '#7f1d1d', eye: '#fca5a5' }, 0); ctx.rotate(Math.sin(t * 14) * 0.2); ctx.drawImage(sp, -sp.ox, -sp.oy); }
        else if (a.kind === 'turret') {
          ctx.fillStyle = '#334'; ctx.beginPath(); ctx.moveTo(-14, 10); ctx.lineTo(14, 10); ctx.lineTo(10, 16); ctx.lineTo(-10, 16); ctx.fill();
          ctx.fillStyle = '#556'; ctx.fillRect(-12, 2, 24, 8);
          ctx.save(); ctx.rotate(a.aim || 0); ctx.fillStyle = c; ctx.fillRect(2, -3, 18, 6); ctx.restore();
          ctx.fillStyle = '#99a'; ctx.beginPath(); ctx.arc(0, 0, 9, 0, TAU); ctx.fill(); ctx.fillStyle = c; ctx.beginPath(); ctx.arc(0, 0, 3.5, 0, TAU); ctx.fill();
          const w = 28, k = 1 - a.age / a.life; ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(-w / 2, -20, w, 3); ctx.fillStyle = c; ctx.fillRect(-w / 2, -20, w * k, 3);
        }
        else if (a.kind === 'drone') { ctx.fillStyle = '#556'; ctx.beginPath(); ctx.arc(0, 0, 7, 0, TAU); ctx.fill(); ctx.strokeStyle = '#99a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-11, -4); ctx.lineTo(11, -4); ctx.stroke(); ctx.fillStyle = c; ctx.beginPath(); ctx.arc(0, 0, 3, 0, TAU); ctx.fill(); }
        else if (a.kind === 'clone') { ctx.globalAlpha = fade * 0.6; ctx.drawImage(S.tint(g.player.sprite, U.rgba(c, 0.7)), -36, -62); }
        ctx.restore(); ctx.globalAlpha = 1;
        this.fx.lights.push([a.x, a.y, 70, 0.4]);
      }
    }
    drawPlayer(g) {
      const ctx = this.ctx, p = g.player, t = g.time;
      const moving = p.move.x || p.move.y;
      const bob = moving ? Math.abs(Math.sin(p.walkT)) * 3 : Math.sin(t * 2) * 1;
      const flip = p.face.x < 0 ? -1 : 1;
      ctx.save(); ctx.translate(p.x, p.y - bob);
      if (p.frostAuraR) { ctx.strokeStyle = 'rgba(186,230,253,0.35)'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 8]); ctx.beginPath(); ctx.arc(0, bob, p.frostAuraR, t, t + TAU); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = 'rgba(186,230,253,0.06)'; ctx.fill(); }
      if (p.auraColor) { ctx.globalAlpha = 0.55 + Math.sin(t * 5) * 0.15; ctx.drawImage(S.glow(p.auraColor, 60), -60, -60 + 10); ctx.globalAlpha = 1; if (this.dt > 0 && Math.random() < 0.4) this.fx.burst(p.x + U.rand(-16, 16), p.y + 20, p.auraColor, 1, { speed: 15, life: 0.8, up: true, size: 3 }); }
      if (p.invulnT > 0.15) { ctx.globalAlpha = 0.5 + Math.sin(t * 30) * 0.3; }
      ctx.scale(flip * 1.15 * (moving ? 1 + Math.sin(p.walkT * 2) * 0.03 : 1), 1.15);
      if (p.hurtFlash > 0) ctx.drawImage(S.flash(p.sprite), -36, -62); else ctx.drawImage(p.sprite, -36, -62);
      ctx.restore(); ctx.globalAlpha = 1;
      if (p.shield > 0) { ctx.strokeStyle = 'rgba(125,211,252,0.7)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y - 10, 30 + Math.sin(t * 4) * 2, 0, TAU); ctx.stroke(); ctx.fillStyle = 'rgba(125,211,252,0.08)'; ctx.fill(); }
      if (p.blood > 0) { ctx.strokeStyle = U.rgba('#ef4444', 0.3 + 0.5 * (p.blood / (p.bloodCap || 1))); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y - 10, 28, 0, TAU); ctx.stroke(); }
      if (p.cycloneT > 0) { ctx.strokeStyle = 'rgba(94,234,212,0.6)'; ctx.lineWidth = 3; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.ellipse(p.x, p.y - 10 - i * 12, 40 + i * 14, 12 + i * 4, t * 8 + i, 0, TAU); ctx.stroke(); } }
      if (p.stormT > 0) { ctx.strokeStyle = 'rgba(125,211,252,0.5)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, 420, 0, TAU); ctx.stroke(); }
    }
    drawEnemyProjectiles(g) {
      const ctx = this.ctx;
      for (const pr of g.eprojs) { const sp = S.orb(pr.color, 5); ctx.drawImage(sp, pr.x - sp.width / 2, pr.y - sp.height / 2); }
    }
    drawProjectiles(g) {
      const ctx = this.ctx;
      for (const pr of g.projs) {
        const sp = pr.sprite; if (!sp) continue;
        ctx.save(); ctx.translate(pr.x, pr.y);
        if (sp.kind === 'orb') { const o = S.orb(sp.color, sp.size || 6); ctx.drawImage(o, -o.width / 2, -o.height / 2); }
        else if (sp.kind === 'void') { const r = sp.size || 14; const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2); gr.addColorStop(0, '#000'); gr.addColorStop(0.5, 'rgba(20,0,40,0.9)'); gr.addColorStop(0.8, U.rgba(sp.color, 0.5)); gr.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, r * 2, 0, TAU); ctx.fill(); ctx.strokeStyle = U.rgba(sp.color, 0.9); ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(0, 0, r * 1.4, r * 0.5, pr.age * 3, 0, TAU); ctx.stroke(); }
        else if (sp.kind === 'wave') { ctx.rotate(pr.angle); ctx.strokeStyle = U.rgba(sp.color, 0.85); ctx.lineWidth = 4; ctx.shadowColor = sp.color; ctx.shadowBlur = 10; ctx.beginPath(); ctx.arc(-sp.size, 0, sp.size * 1.3, -1.1, 1.1); ctx.stroke(); ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(-sp.size * 0.7, 0, sp.size, -0.9, 0.9); ctx.stroke(); }
        else if (sp.kind === 'tornado') { ctx.strokeStyle = U.rgba(sp.color, 0.8); ctx.lineWidth = 3; for (let i = 0; i < 4; i++) { const w = sp.size * (0.4 + i * 0.25); ctx.beginPath(); ctx.ellipse(Math.sin(pr.rot + i) * 4, -i * sp.size * 0.35 + sp.size * 0.4, w, w * 0.35, 0, 0, TAU); ctx.stroke(); } }
        else if (sp.kind === 'spike') { ctx.fillStyle = '#e0f2fe'; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(-8 + i * 8, 6); ctx.lineTo(-4 + i * 8, -10 - (i === 1 ? 6 : 0)); ctx.lineTo(i * 8, 6); ctx.fill(); } }
        else { const b = S.bolt(sp.color, sp.len || 20, sp.wid || 5, sp.kind); ctx.rotate(pr.angle + pr.rot); ctx.drawImage(b, -b.ox, -b.oy); }
        ctx.restore();
        if (pr.light) this.fx.lights.push([pr.x, pr.y, pr.light, 0.8]); else if (this.fx.lights.length < 260) this.fx.lights.push([pr.x, pr.y, 45, 0.5]);
      }
    }
    drawLighting(g, sx, sy) {
      const ctx = this.ctx, l = this.lctx, L = this.light;
      const s = 0.25;
      l.setTransform(1, 0, 0, 1, 0, 0);
      l.globalCompositeOperation = 'source-over';
      l.fillStyle = this.stage.pal.ambient; l.fillRect(0, 0, L.width, L.height);
      l.globalCompositeOperation = 'destination-out';
      const z = this.zoom * s;
      l.setTransform(z, 0, 0, z, (this.W / 2 - this.cam.x * this.zoom + sx) * s, (this.H / 2 - this.cam.y * this.zoom + sy) * s);
      const lights = this.fx.lights; const eclipse = g.eclipse ? 0.85 : 1;
      for (let i = 0; i < lights.length && i < 360; i++) { const [x, y, r, a] = lights[i]; l.globalAlpha = a * eclipse; const sp = S.light(64); l.drawImage(sp, x - r, y - r, r * 2, r * 2); }
      for (const ex of this.fx.explosions) { const k = ex.life / ex.max; l.globalAlpha = k; const sp = S.light(64); const r = ex.r * 2.5; l.drawImage(sp, ex.x - r, ex.y - r, r * 2, r * 2); }
      l.globalAlpha = 1;
      lights.length = 0;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(L, 0, 0, this.W, this.H);
    }
    drawAdditive(g) {
      const ctx = this.ctx, fx = this.fx, t = g.time;
      ctx.globalCompositeOperation = 'lighter';
      // particles
      for (const p of fx.parts) { const k = p.ambient ? Math.sin((p.life / p.max) * Math.PI) * 0.8 : p.life / p.max; ctx.globalAlpha = k; if (p.add) { const sp = S.glow(p.color, 8); ctx.drawImage(sp, p.x - p.size, p.y - p.size, p.size * 2, p.size * 2); } else { ctx.fillStyle = p.color; ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size); } }
      ctx.globalAlpha = 1;
      // projectile glows
      for (const pr of g.projs) { const sp = pr.sprite; if (!sp || sp.kind === 'void') continue; const r = (pr.r || 6) * 1.6 + 4; ctx.globalAlpha = 0.5; ctx.drawImage(S.glow(sp.color, 16), pr.x - r, pr.y - r, r * 2, r * 2); }
      for (const pr of g.eprojs) { ctx.globalAlpha = 0.6; ctx.drawImage(S.glow(pr.color, 16), pr.x - 12, pr.y - 12, 24, 24); }
      ctx.globalAlpha = 1;
      // rings
      for (const r of fx.rings) { const k = r.life / r.max; ctx.strokeStyle = U.rgba(r.color, k * 0.9); ctx.lineWidth = r.thin ? 2 : 4 + (1 - k) * 6; ctx.beginPath(); ctx.arc(r.x, r.y, r.r * (r.thin ? 1 : 0.5 + (1 - k) * 0.5), 0, TAU); ctx.stroke(); }
      // novas
      for (const nv of fx.novas) { const n = nv.n; const k = 1 - n.r / n.maxR; ctx.strokeStyle = U.rgba(nv.color, 0.85); ctx.lineWidth = nv.thin ? 3 : 10 + k * 8; ctx.shadowColor = nv.color; ctx.shadowBlur = 20; ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, TAU); ctx.stroke(); ctx.shadowBlur = 0; ctx.globalAlpha = 0.15 * k; ctx.fillStyle = nv.color; ctx.fill(); ctx.globalAlpha = 1; }
      // explosions
      for (const ex of fx.explosions) { const k = ex.life / ex.max; const r = ex.r * (1.2 - k * 0.6); ctx.globalAlpha = k * 0.9; const sp = S.glow(ex.color, 32); ctx.drawImage(sp, ex.x - r, ex.y - r, r * 2, r * 2); ctx.strokeStyle = U.rgba('#ffffff', k); ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(ex.x, ex.y, ex.r * (1 - k * 0.7), 0, TAU); ctx.stroke(); }
      ctx.globalAlpha = 1;
      // beams (lightning-style jagged)
      for (const b of fx.beams) {
        const k = b.life / b.max; ctx.strokeStyle = U.rgba(b.color, k); ctx.lineWidth = b.w * (0.5 + k); ctx.shadowColor = b.color; ctx.shadowBlur = 12;
        ctx.beginPath(); ctx.moveTo(b.x1, b.y1);
        const dx = b.x2 - b.x1, dy = b.y2 - b.y1, n = 6; const nx = -dy, ny = dx; const len = Math.hypot(dx, dy) || 1;
        for (let i = 1; i < n; i++) { const tt = i / n; const off = (U.hash2(i, Math.floor(b.seed * 7), Math.floor(t * 30)) - 0.5) * Math.min(30, len * 0.15); ctx.lineTo(b.x1 + dx * tt + nx / len * off, b.y1 + dy * tt + ny / len * off); }
        ctx.lineTo(b.x2, b.y2); ctx.stroke();
        ctx.strokeStyle = U.rgba('#ffffff', k * 0.8); ctx.lineWidth = 1; ctx.stroke(); ctx.shadowBlur = 0;
      }
      // lightning strikes
      for (const bo of fx.bolts) { const k = bo.life / bo.max; ctx.strokeStyle = U.rgba(bo.color, k); ctx.lineWidth = 4 * k + 1; ctx.shadowColor = bo.color; ctx.shadowBlur = 16; ctx.beginPath(); let x = bo.x + U.rand(-30, 30), y = bo.y - 420; ctx.moveTo(x, y); for (let i = 0; i < 8; i++) { x = bo.x + (U.hash2(i, bo.seed, 1) - 0.5) * 50 * (1 - i / 8); y += 52; ctx.lineTo(x, y); } ctx.lineTo(bo.x, bo.y); ctx.stroke(); ctx.strokeStyle = U.rgba('#ffffff', k); ctx.lineWidth = 1.5; ctx.stroke(); ctx.shadowBlur = 0; ctx.globalAlpha = k * 0.7; ctx.drawImage(S.glow(bo.color, 40), bo.x - 40, bo.y - 40); ctx.globalAlpha = 1; }
      // lines (fissures)
      for (const ln of fx.lines) { const k = ln.life / ln.max; ctx.save(); ctx.translate(ln.x, ln.y); ctx.rotate(ln.angle); ctx.globalAlpha = k; const gr = ctx.createLinearGradient(0, 0, ln.len, 0); gr.addColorStop(0, ln.color); gr.addColorStop(1, U.rgba(ln.color, 0)); ctx.fillStyle = gr; ctx.fillRect(0, -ln.width / 2, ln.len * Math.min(1, (1 - k) * 3 + 0.2), ln.width); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 0); for (let i = 1; i <= 8; i++) ctx.lineTo(ln.len * i / 8, (U.hash2(i, ln.x | 0, ln.y | 0) - 0.5) * ln.width * 0.6); ctx.stroke(); ctx.restore(); }
      // arcs (melee swings)
      for (const a of fx.arcs) { const k = a.life / a.max; ctx.globalAlpha = k; ctx.fillStyle = U.rgba(a.color, a.thin ? 0.35 : 0.5); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.arc(a.x, a.y, a.r * (a.thin ? 1 : 0.7 + (1 - k) * 0.3), a.angle - a.halfArc, a.angle + a.halfArc); ctx.closePath(); ctx.fill(); ctx.strokeStyle = U.rgba('#ffffff', k); ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(a.x, a.y, a.r * (a.thin ? 1 : 0.7 + (1 - k) * 0.3), a.angle - a.halfArc, a.angle + a.halfArc); ctx.stroke(); }
      // whips
      for (const w of fx.whips) { const k = w.life / w.max; ctx.globalAlpha = k; ctx.strokeStyle = w.color; ctx.lineWidth = 6; ctx.shadowColor = w.color; ctx.shadowBlur = 12; ctx.beginPath(); ctx.moveTo(w.x, w.y); ctx.quadraticCurveTo(w.x + w.sd * w.len * 0.5, w.y - w.hgt * 0.7 * (1 - k), w.x + w.sd * w.len, w.y + Math.sin(k * 6) * 6); ctx.stroke(); ctx.shadowBlur = 0; }
      ctx.globalAlpha = 1;
      // lobs
      for (const lb of fx.lobs) { const k = lb.t / lb.max; const x = U.lerp(lb.x, lb.tx, k), y = U.lerp(lb.y, lb.ty, k) - Math.sin(k * Math.PI) * 90; const sp = S.orb(lb.color, 6); ctx.drawImage(sp, x - sp.width / 2, y - sp.height / 2); }
      // meteors / arrows falling
      for (const m of fx.meteors) { const k = m.t / m.max; const y = m.y - (1 - k) * 600; if (m.small) { const sp = S.bolt(m.color || '#fde047', 18, 3, 'arrow'); ctx.save(); ctx.translate(m.x, y); ctx.rotate(Math.PI / 2); ctx.drawImage(sp, -sp.ox, -sp.oy); ctx.restore(); } else { const sp = S.orb('#ff7043', 14); ctx.drawImage(sp, m.x - sp.width / 2 + (1 - k) * 120, y - sp.height / 2); fx.trail(m.x + (1 - k) * 120, y, '#ff9a3c', 8); } }
      // player-specific effects
      const p = g.player;
      for (const w of p.weapons) {
        if (w.id === 'sunbeam' && w.len) { for (let b = 0; b < (w.beams || 1); b++) { const a = w.angle + (b / (w.beams || 1)) * TAU; const x2 = p.x + Math.cos(a) * w.len, y2 = p.y + Math.sin(a) * w.len; const gr = ctx.createLinearGradient(p.x, p.y, x2, y2); gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.3, U.rgba(w.evolved ? '#fb923c' : '#fbbf24', 0.8)); gr.addColorStop(1, U.rgba('#fbbf24', 0)); ctx.strokeStyle = gr; ctx.lineWidth = 14; ctx.lineCap = 'round'; ctx.shadowColor = '#fbbf24'; ctx.shadowBlur = 20; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(x2, y2); ctx.stroke(); ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.stroke(); ctx.shadowBlur = 0; fx.lights.push([x2, y2, 80, 0.5]); } }
        if (w.id === 'plague_aura' && w.radius) { const r = w.radius; const gr = ctx.createRadialGradient(p.x, p.y, r * 0.3, p.x, p.y, r); gr.addColorStop(0, U.rgba(w.evolved ? '#84cc16' : '#a3e635', 0.02)); gr.addColorStop(0.8, U.rgba('#a3e635', 0.18)); gr.addColorStop(1, U.rgba('#a3e635', 0)); ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill(); ctx.strokeStyle = 'rgba(163,230,53,0.35)'; ctx.lineWidth = 2; ctx.setLineDash([8, 10]); ctx.beginPath(); ctx.arc(p.x, p.y, r * (0.98 + Math.sin(t * 3) * 0.02), -t, -t + TAU); ctx.stroke(); ctx.setLineDash([]); }
      }
      if (p.feastT > 0) { ctx.strokeStyle = 'rgba(239,68,68,0.5)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(p.x, p.y, 245, 0, TAU); ctx.stroke(); }
      ctx.globalCompositeOperation = 'source-over';
    }
    drawTexts() {
      const ctx = this.ctx; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const t of this.fx.texts) {
        const k = Math.min(1, t.life / t.max * 2);
        const size = t.crit ? 22 : t.dmg ? 14 : t.small ? 14 : 16;
        ctx.font = (t.crit ? '900 ' : 'bold ') + size + 'px "Rajdhani", "Segoe UI", sans-serif';
        ctx.globalAlpha = k; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.strokeText(t.text, t.x, t.y); ctx.fillStyle = t.color; ctx.fillText(t.text, t.x, t.y);
      }
      ctx.globalAlpha = 1;
    }
    drawPlayerBars(g) {
      const ctx = this.ctx, p = g.player; const w = 40, x = p.x - w / 2, y = p.y + 30;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x - 1, y - 1, w + 2, 6);
      const hpk = Math.max(0, p.hp / p.stats.maxHp);
      ctx.fillStyle = hpk > 0.5 ? '#4ade80' : hpk > 0.25 ? '#fbbf24' : '#f87171'; ctx.fillRect(x, y, w * hpk, 4);
      if (p.shield > 0) { ctx.fillStyle = '#7dd3fc'; ctx.fillRect(x, y - 3, w * Math.min(1, p.shield / p.stats.maxHp), 2); }
    }
    drawPost(g) {
      const ctx = this.ctx, W = this.W, H = this.H, p = g.player;
      // vignette
      const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.5)'); ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
      // low hp pulse
      const hpk = p.hp / p.stats.maxHp;
      if (hpk < 0.35) { const a = (0.35 - hpk) / 0.35 * (0.35 + Math.sin(g.time * 6) * 0.15); const rg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7); rg.addColorStop(0, 'rgba(180,0,0,0)'); rg.addColorStop(1, 'rgba(180,0,0,' + a + ')'); ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H); }
      if (g.eclipse) { ctx.fillStyle = 'rgba(80,0,120,0.07)'; ctx.fillRect(0, 0, W, H); }
      if (this.fx.flashA > 0) { ctx.globalAlpha = this.fx.flashA * 0.7; ctx.fillStyle = this.fx.flashCol; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
    }
    drawIndicators(g) {
      const ctx = this.ctx, W = this.W, H = this.H;
      for (const e of g.enemies) {
        if (!(e.boss || e.elite)) continue;
        const [sx, sy] = this.worldToScreen(e.x, e.y);
        if (sx > 0 && sx < W && sy > 0 && sy < H) continue;
        const cx = W / 2, cy = H / 2; const dx = sx - cx, dy = sy - cy; const a = Math.atan2(dy, dx);
        const m = 30 * this.dpr; const tx = U.clamp(sx, m, W - m), ty = U.clamp(sy, m, H - m);
        ctx.save(); ctx.translate(tx, ty); ctx.rotate(a);
        ctx.fillStyle = e.boss ? '#f87171' : '#c084fc'; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.moveTo(14 * this.dpr, 0); ctx.lineTo(-8 * this.dpr, -9 * this.dpr); ctx.lineTo(-4 * this.dpr, 0); ctx.lineTo(-8 * this.dpr, 9 * this.dpr); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      for (const k of g.pickups) {
        if (k.kind !== 'chest' && k.kind !== 'bosschest') continue;
        const [sx, sy] = this.worldToScreen(k.x, k.y);
        if (sx > 0 && sx < W && sy > 0 && sy < H) continue;
        const cx = W / 2, cy = H / 2; const a = Math.atan2(sy - cy, sx - cx); const m = 30 * this.dpr;
        const tx = U.clamp(sx, m, W - m), ty = U.clamp(sy, m, H - m);
        ctx.save(); ctx.translate(tx, ty); ctx.rotate(a); ctx.fillStyle = '#ffd700'; ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 10; ctx.beginPath(); ctx.moveTo(12 * this.dpr, 0); ctx.lineTo(-6 * this.dpr, -7 * this.dpr); ctx.lineTo(-6 * this.dpr, 7 * this.dpr); ctx.closePath(); ctx.fill(); ctx.restore();
      }
    }

    /* ---- menu background ---- */
    renderMenu(dt) {
      const ctx = this.ctx, W = this.W, H = this.H;
      this.menuT += dt;
      const stage = SF.STAGES[0];
      if (this.stage !== stage) { this.setStage(stage); }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = stage.pal.sky; ctx.fillRect(0, 0, W, H);
      const z = this.zoom * 0.9;
      const cx = Math.sin(this.menuT * 0.05) * 300, cy = this.menuT * 18;
      this.cam.x = cx; this.cam.y = cy;
      ctx.setTransform(z, 0, 0, z, W / 2 - cx * z, H / 2 - cy * z);
      const vw = W / z / 2 + 80, vh = H / z / 2 + 80;
      this.drawGround(cx - vw, cy - vh, cx + vw, cy + vh);
      this.drawProps(cx - vw, cy - vh, cx + vw, cy + vh);
      // embers
      if (Math.random() < 0.6) this.fx.burst(cx + U.rand(-vw, vw), cy + vh, stage.pal.ember, 1, { speed: 20, life: 4, up: true, size: 3 });
      for (const p of this.fx.parts) { p.vy -= 20 * dt; p.vx += Math.sin(this.menuT + p.y * 0.01) * 10 * dt; }
      ctx.globalCompositeOperation = 'lighter';
      for (const p of this.fx.parts) { const k = p.life / p.max; ctx.globalAlpha = k * 0.8; ctx.drawImage(S.glow(p.color, 8), p.x - p.size, p.y - p.size, p.size * 2, p.size * 2); }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.2, W / 2, H / 2, Math.max(W, H) * 0.7);
      vg.addColorStop(0, 'rgba(0,0,0,0.25)'); vg.addColorStop(1, 'rgba(0,0,0,0.85)'); ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    }
  }

  SF.Renderer = Renderer;
})();
