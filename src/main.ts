/**
 * SOULFORGE — composition root.
 *
 * Wires the headless simulation to its hosts: input → game, game events → UI / audio / save,
 * and drives everything with the fixed-timestep loop.
 */
import { audio } from './audio/audio';
import { InputManager } from './core/input';
import { FixedLoop } from './core/loop';
import { Game } from './game/game';
import { Save } from './meta/save';
import { FX } from './render/fx';
import { Renderer, type BackendPreference } from './render/renderer';
import { UI } from './ui/ui';
import './styles/main.css';

function boot(): void {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const fpsEl = document.getElementById('fps')!;
  const params = new URLSearchParams(location.search);

  Save.load();
  const settings = Save.data.settings;

  const fx = new FX();
  fx.shakeMul = settings.reducedMotion ? 0 : settings.shake;
  fx.flashMul = settings.reducedMotion ? 0.25 : 1;
  fx.dmgEnabled = settings.dmgNumbers;
  const pref = (params.get('renderer') as BackendPreference | null) ?? 'auto';
  const renderer = new Renderer(canvas, fx, pref);
  renderer.quality = settings.quality || 1;
  renderer.postEnabled = settings.postfx;
  renderer.resize();
  const input = new InputManager(window, canvas);
  const game = new Game(fx, input);

  // simulation → hosts
  game.events.on('sfx', (name, param) => audio.play(name, param));
  game.events.on('runStart', (stage) => {
    renderer.setStage(stage);
    renderer.snapCamera();
  });
  game.events.on('discover', (kind, id) => Save.discover(kind, id));

  // hosts → simulation
  input.onPauseKey = () => {
    if (game.state === 'play') UI.showPause();
    else if (game.state === 'paused') UI.closePause();
  };
  input.onBlur = () => {
    if (game.state === 'play') UI.showPause();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.state === 'play') UI.showPause();
  });

  const initAudio = () => {
    audio.init();
    audio.setSfx(settings.sfx);
    audio.setMusic(settings.music);
    audio.resume();
  };
  window.addEventListener('pointerdown', initAudio, { once: true });
  window.addEventListener('keydown', initAudio, { once: true });

  UI.init({ game, renderer, input });

  let errorShown = false;
  const loop = new FixedLoop({
    // slow motion / hit-stop requested by the simulation through FX (boss kills, enrage, death)
    timeScale: (realDt) => fx.stepWarp(realDt),
    update(dt) {
      try {
        game.update(dt);
      } catch (err) {
        reportError(err);
      }
    },
    render(alpha, frameDt) {
      try {
        input.poll();
        if (game.state !== 'idle') UI.updateHud(game);
        audio.setIntensity(
          game.state === 'play'
            ? game.boss && !game.boss.dead
              ? game.boss.phase === 2
                ? 1
                : 0.7
              : Math.min(0.5, game.enemies.length / 600)
            : 0,
        );
        renderer.render(game.state === 'idle' ? null : game, alpha, frameDt);
      } catch (err) {
        reportError(err);
      }
      if (!fpsEl.classList.contains('hidden')) drawPerf();
    },
  });

  let perfT = 0;
  function drawPerf(): void {
    const now = performance.now();
    if (now - perfT < 250) return;
    perfT = now;
    const s = loop.stats,
      b = renderer.backend;
    fpsEl.textContent =
      `${s.fps.toFixed(0)} fps · sim ${s.updateMs.toFixed(2)}ms · draw ${s.renderMs.toFixed(2)}ms · ${b.kind} ${b.stats.drawCalls} calls/${b.stats.instances} quads` +
      ` · ${game.enemies.length} enemies · ${game.projs.length} proj · ${fx.parts.count} particles`;
  }

  /** Errors inside a frame are logged once on screen instead of silently killing the loop. */
  function reportError(err: unknown): void {
    console.error(err);
    if (errorShown) return;
    errorShown = true;
    UI.toast('Something went wrong — see the console. The game will keep running.');
  }

  window.__SF = { game, renderer, loop };
  loop.start();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

// Offline support / installability (production builds only).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true })).catch(() => {});
}
