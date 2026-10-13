import { afterEach, describe, expect, it, vi } from 'vitest';
import { InputManager } from '../src/core/input';

function dispatch(target: EventTarget, type: string, fields: Record<string, unknown> = {}) {
  const e = Object.assign(new Event(type, { cancelable: true }), fields);
  target.dispatchEvent(e);
  return e;
}

afterEach(() => vi.unstubAllGlobals());

describe('input across focus and device changes', () => {
  it('drops held movement and pending actions when focus is lost', () => {
    const target = new EventTarget();
    const input = new InputManager(target as unknown as Window);
    dispatch(target, 'keydown', { code: 'KeyD', repeat: false });
    input.pressActive();
    input.pressDash();
    input.pressArt();
    expect(input.moveX()).toBe(1);
    dispatch(target, 'blur');
    expect(input.moveX()).toBe(0);
    expect([input.consumeActive(), input.consumeDash(), input.consumeArt()]).toEqual([false, false, false]);
  });

  it('preserves the movement finger during simultaneous ability taps and extra touches', () => {
    vi.stubGlobal('window', { innerWidth: 1000 });
    const target = new EventTarget(),
      canvas = new EventTarget();
    const input = new InputManager(target as unknown as Window, canvas as unknown as HTMLElement);
    const touch = (identifier: number, clientX: number, clientY = 100) => ({ identifier, clientX, clientY });
    const start = dispatch(canvas, 'touchstart', { changedTouches: [touch(1, 100), touch(2, 900)] });
    expect(start.defaultPrevented).toBe(true);
    expect(input.consumeActive()).toBe(true);
    dispatch(canvas, 'touchmove', { changedTouches: [touch(1, 150)] });
    expect(input.moveX()).toBe(1);
    dispatch(canvas, 'touchstart', { changedTouches: [touch(3, 300)] });
    dispatch(canvas, 'touchmove', { changedTouches: [touch(3, 250)] });
    dispatch(canvas, 'touchend', { changedTouches: [touch(2, 900), touch(3, 250)] });
    expect(input.moveX()).toBe(1);
    dispatch(canvas, 'touchcancel', { changedTouches: [touch(1, 150)] });
    expect(input.moveX()).toBe(0);
  });

  it('recognizes a new gamepad press after disconnect and uses a radial dead zone', () => {
    const target = new EventTarget();
    const buttons = Array.from({ length: 10 }, () => ({ pressed: false }));
    const pad = { connected: true, buttons, axes: [0.1, 0.1] };
    let pads: (typeof pad)[] = [pad];
    vi.stubGlobal('navigator', { getGamepads: () => pads });
    const input = new InputManager(target as unknown as Window);
    expect(input.moveX()).toBe(0);
    pad.axes = [1, 1];
    expect(Math.hypot(input.moveX(), input.moveY())).toBeCloseTo(1);
    buttons[0]!.pressed = true;
    input.poll();
    expect(input.consumeDash()).toBe(true);
    input.poll();
    expect(input.consumeDash()).toBe(false);
    pads = [];
    input.poll();
    pads = [pad];
    input.poll();
    expect(input.consumeDash()).toBe(true);
  });
});
