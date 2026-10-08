/**
 * Fixed-timestep game loop with render interpolation ("Fix Your Timestep").
 *
 * - The simulation always advances in exact `step` increments (default 1/60 s), independent of
 *   the display refresh rate — gameplay is identical at 30, 60, 144 or 240 Hz, and deterministic.
 * - Rendering happens once per animation frame with `alpha` ∈ [0, 1): how far the real clock is
 *   between the last two simulation states, so the renderer can interpolate positions smoothly.
 * - Long stalls (tab switch, GC, debugger) are clamped to `maxFrame` to avoid a "spiral of death".
 */
export interface LoopCallbacks {
  /** Advance the simulation by exactly `dt` seconds. */
  update(dt: number): void;
  /** Draw. `alpha` is the interpolation factor, `frameDt` the real elapsed time (seconds). */
  render(alpha: number, frameDt: number): void;
}

export interface LoopStats {
  fps: number;
  /** Average milliseconds per frame spent in update() / render() over the last sample window. */
  updateMs: number;
  renderMs: number;
  /** Simulation steps run in the last frame. */
  steps: number;
}

export class FixedLoop {
  readonly step: number;
  private readonly maxFrame: number;
  private acc = 0;
  private last = 0;
  private raf = 0;
  private running = false;
  readonly stats: LoopStats = { fps: 0, updateMs: 0, renderMs: 0, steps: 0 };
  private sample = { frames: 0, time: 0, update: 0, render: 0 };

  constructor(
    private readonly cb: LoopCallbacks,
    { step = 1 / 60, maxFrame = 0.25 }: { step?: number; maxFrame?: number } = {},
  ) {
    this.step = step;
    this.maxFrame = maxFrame;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.acc = 0;
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** Drop accumulated time (call after a pause so the sim doesn't fast-forward). */
  resetClock(): void {
    this.last = performance.now();
    this.acc = 0;
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    let frameDt = (now - this.last) / 1000;
    this.last = now;
    if (frameDt > this.maxFrame) frameDt = this.maxFrame;
    if (frameDt < 0) frameDt = 0;

    const t0 = performance.now();
    this.acc += frameDt;
    let steps = 0;
    while (this.acc >= this.step) {
      this.cb.update(this.step);
      this.acc -= this.step;
      steps++;
    }
    const t1 = performance.now();
    this.cb.render(this.acc / this.step, frameDt);
    const t2 = performance.now();

    const s = this.sample;
    s.frames++;
    s.time += frameDt;
    s.update += t1 - t0;
    s.render += t2 - t1;
    this.stats.steps = steps;
    if (s.time >= 0.5) {
      this.stats.fps = s.frames / s.time;
      this.stats.updateMs = s.update / s.frames;
      this.stats.renderMs = s.render / s.frames;
      s.frames = s.time = s.update = s.render = 0;
    }
  };
}
