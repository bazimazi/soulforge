/**
 * Keyboard, gamepad and touch input, exposed to the simulation as an {@link InputSource}.
 *
 * - Movement merges WASD/arrows, the left stick (with radial dead-zone) and a virtual touch stick.
 * - The dash and the active ability are edge-triggered: one press = one activation, polled once per
 *   sim step, so a press is never lost between steps nor repeated across several of them.
 */
import type { InputSource } from '../game/types';
import { U } from './util';

const DEADZONE = 0.2;
const DASH_KEYS = new Set(['Space', 'ShiftLeft', 'ShiftRight']);
const ACTIVE_KEYS = new Set(['KeyE', 'KeyQ']);
/** Standard-mapping buttons that dash: A, LB, LT. */
const DASH_BUTTONS = [0, 4, 6];
/** Standard-mapping buttons that trigger the ability: X, RB, RT. */
const ACTIVE_BUTTONS = [2, 5, 7];
/** Standard-mapping Start button. */
const START_BUTTON = 9;
/** Standard-mapping Back/Select button. */
const MAP_BUTTON = 8;

export class InputManager implements InputSource {
  private keys = new Set<string>();
  private activeQueued = false;
  private dashQueued = false;
  private padActiveHeld = false;
  private padDashHeld = false;
  private padStartHeld = false;
  private padMapHeld = false;
  private touch: { id: number; sx: number; sy: number; dx: number; dy: number } | null = null;

  /** Called on P / Start. */
  onPauseKey: (() => void) | null = null;
  /** Called on M / Back. */
  onMapKey: (() => void) | null = null;
  /** Called on T (damage meter). */
  onMeterKey: (() => void) | null = null;
  /** Called when the window loses focus. */
  onBlur: (() => void) | null = null;

  constructor(target: Window = window, canvas?: HTMLElement | null) {
    target.addEventListener('keydown', (e) => {
      if (isTyping(e.target)) return;
      if (!e.repeat && ACTIVE_KEYS.has(e.code)) this.activeQueued = true;
      if (!e.repeat && DASH_KEYS.has(e.code)) this.dashQueued = true;
      this.keys.add(e.code);
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (e.code === 'KeyP' && !e.repeat) this.onPauseKey?.();
      if (e.code === 'KeyM' && !e.repeat) this.onMapKey?.();
      if (e.code === 'KeyT' && !e.repeat) this.onMeterKey?.();
    });
    target.addEventListener('keyup', (e) => this.keys.delete(e.code));
    target.addEventListener('blur', () => {
      this.keys.clear();
      this.touch = null;
      this.onBlur?.();
    });
    if (canvas) this.bindTouch(canvas);
  }

  private bindTouch(canvas: HTMLElement): void {
    const opts = { passive: false } as const;
    canvas.addEventListener(
      'touchstart',
      (e) => {
        const t = e.changedTouches[0]!;
        // right side of the screen taps the ability, left side is a floating stick
        if (t.clientX > window.innerWidth * 0.6) {
          this.activeQueued = true;
          return;
        }
        this.touch = { id: t.identifier, sx: t.clientX, sy: t.clientY, dx: 0, dy: 0 };
        e.preventDefault();
      },
      opts,
    );
    canvas.addEventListener(
      'touchmove',
      (e) => {
        const tc = this.touch;
        if (!tc) return;
        for (const t of Array.from(e.changedTouches)) {
          if (t.identifier !== tc.id) continue;
          tc.dx = U.clamp((t.clientX - tc.sx) / 50, -1, 1);
          tc.dy = U.clamp((t.clientY - tc.sy) / 50, -1, 1);
        }
        e.preventDefault();
      },
      opts,
    );
    const end = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) if (this.touch && t.identifier === this.touch.id) this.touch = null;
    };
    canvas.addEventListener('touchend', end, opts);
    canvas.addEventListener('touchcancel', end, opts);
  }

  private pad(): Gamepad | null {
    try {
      for (const g of navigator.getGamepads?.() ?? []) if (g && g.connected) return g;
    } catch {}
    return null;
  }

  /** Poll gamepad buttons once per frame for edge detection (call before simulation steps). */
  poll(): void {
    const gp = this.pad();
    if (!gp) return;
    const act = ACTIVE_BUTTONS.some((i) => gp.buttons[i]?.pressed);
    if (act && !this.padActiveHeld) this.activeQueued = true;
    this.padActiveHeld = act;
    const dash = DASH_BUTTONS.some((i) => gp.buttons[i]?.pressed);
    if (dash && !this.padDashHeld) this.dashQueued = true;
    this.padDashHeld = dash;
    const start = !!gp.buttons[START_BUTTON]?.pressed;
    if (start && !this.padStartHeld) this.onPauseKey?.();
    this.padStartHeld = start;
    const map = !!gp.buttons[MAP_BUTTON]?.pressed;
    if (map && !this.padMapHeld) this.onMapKey?.();
    this.padMapHeld = map;
  }

  private stick(): [number, number] | null {
    const gp = this.pad();
    if (!gp) return null;
    const x = gp.axes[0] ?? 0,
      y = gp.axes[1] ?? 0;
    const m = Math.hypot(x, y);
    if (m < DEADZONE) return null;
    // rescale so motion starts smoothly at the dead-zone edge
    const k = Math.min(1, (m - DEADZONE) / (1 - DEADZONE)) / m;
    return [x * k, y * k];
  }

  moveX(): number {
    if (this.touch) return this.touch.dx;
    const s = this.stick();
    if (s) return s[0];
    return (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);
  }

  moveY(): number {
    if (this.touch) return this.touch.dy;
    const s = this.stick();
    if (s) return s[1];
    return (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0) - (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0);
  }

  consumeActive(): boolean {
    const v = this.activeQueued;
    this.activeQueued = false;
    return v;
  }

  consumeDash(): boolean {
    const v = this.dashQueued;
    this.dashQueued = false;
    return v;
  }

  /** Queue an ability activation (on-screen button). */
  pressActive(): void {
    this.activeQueued = true;
  }

  /** Queue a dash (on-screen button). */
  pressDash(): void {
    this.dashQueued = true;
  }

  /** Drop queued presses (e.g. when closing a menu with Space). */
  flush(): void {
    this.activeQueued = false;
    this.dashQueued = false;
  }
}

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}
