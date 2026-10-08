/* SOULFORGE — input, main loop, boot */
'use strict';
(function () {
  const keys = {};
  const Input = {
    tapActive: false, gamepad: null,
    axisX() { let x = 0; if (keys.KeyA || keys.ArrowLeft) x -= 1; if (keys.KeyD || keys.ArrowRight) x += 1; const gp = this.pad(); if (gp && Math.abs(gp.axes[0]) > 0.2) x = gp.axes[0]; return x; },
    axisY() { let y = 0; if (keys.KeyW || keys.ArrowUp) y -= 1; if (keys.KeyS || keys.ArrowDown) y += 1; const gp = this.pad(); if (gp && Math.abs(gp.axes[1]) > 0.2) y = gp.axes[1]; return y; },
    active() { const gp = this.pad(); const pressed = keys.Space || keys.KeyE || keys.ShiftLeft || keys.ShiftRight || this.tapActive || (gp && gp.buttons.some((b, i) => (i === 0 || i === 5 || i === 7) && b && b.pressed)); this.tapActive = false; return pressed; },
    pad() { try { const gps = navigator.getGamepads ? navigator.getGamepads() : []; for (const g of gps) if (g && g.connected) return g; } catch (e) { } return null; },
  };
  window.addEventListener('keydown', (e) => { keys[e.code] = true; if (e.code === 'Space' && document.activeElement.tagName !== 'TEXTAREA' && document.activeElement.tagName !== 'INPUT') e.preventDefault(); if (e.code === 'KeyP' && SF.UI && SF.UI.game) { if (SF.UI.game.state === 'play') SF.UI.showPause(); else if (SF.UI.game.state === 'paused') SF.UI.closePause(); } });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; if (SF.UI && SF.UI.game && SF.UI.game.state === 'play') SF.UI.showPause(); });
  SF.Input = Input;

  /* touch joystick (basic) */
  let touch = null;
  const canvas = document.getElementById('game');
  canvas.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; if (t.clientX > window.innerWidth * 0.6) { Input.tapActive = true; return; } touch = { id: t.identifier, sx: t.clientX, sy: t.clientY, dx: 0, dy: 0 }; e.preventDefault(); }, { passive: false });
  canvas.addEventListener('touchmove', (e) => { if (!touch) return; for (const t of e.changedTouches) if (t.identifier === touch.id) { touch.dx = SF.U.clamp((t.clientX - touch.sx) / 50, -1, 1); touch.dy = SF.U.clamp((t.clientY - touch.sy) / 50, -1, 1); } e.preventDefault(); }, { passive: false });
  canvas.addEventListener('touchend', (e) => { for (const t of e.changedTouches) if (touch && t.identifier === touch.id) touch = null; }, { passive: false });
  const oax = Input.axisX, oay = Input.axisY;
  Input.axisX = function () { return touch ? touch.dx : oax.call(this); };
  Input.axisY = function () { return touch ? touch.dy : oay.call(this); };

  function boot() {
    SF.Save.load();
    const settings = SF.Save.data.settings;
    const R = new SF.Renderer(canvas);
    R.quality = settings.quality || 1; R.resize();
    R.fx.shakeMul = settings.shake; R.fx.dmgEnabled = settings.dmgNumbers;
    const G = new SF.Game(R);
    SF.game = G; SF.renderer = R;
    document.getElementById('fps').classList.toggle('hidden', !settings.fps);
    const initAudio = () => { SF.Audio.init(); SF.Audio.setSfx(settings.sfx); SF.Audio.setMusic(settings.music); SF.Audio.resume(); };
    window.addEventListener('pointerdown', initAudio, { once: true }); window.addEventListener('keydown', initAudio, { once: true });
    SF.UI.init(G, R);
    let last = performance.now(), acc = 0, frames = 0, fpsT = 0;
    const fpsEl = document.getElementById('fps');
    function loop(now) {
      requestAnimationFrame(loop);
      let dt = (now - last) / 1000; last = now;
      if (dt > 0.1) dt = 0.1;
      try {
        if (G.state === 'play') { G.update(dt); SF.UI.updateHud(G); }
        else if (G.state === 'paused' || G.state === 'levelup' || G.state === 'chest') { SF.UI.updateHud(G); }
        R.render(G.state === 'idle' ? null : G, (G.state === 'play' || G.state === 'idle' || G.state === 'over') ? dt : 0);
      } catch (err) { console.error(err); }
      frames++; fpsT += dt; if (fpsT >= 0.5) { fpsEl.textContent = Math.round(frames / fpsT) + ' fps · ' + (G.enemies ? G.enemies.length : 0) + ' enemies · ' + (G.projs ? G.projs.length : 0) + ' proj'; frames = 0; fpsT = 0; }
    }
    requestAnimationFrame(loop);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
