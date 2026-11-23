/**
 * Fixed-timestep game loop with render interpolation.
 *
 * requestAnimationFrame drives rendering; simulation steps are taken in fixed increments from an
 * accumulator so physics is frame-rate independent and deterministic. `render(alpha)` receives the
 * fraction of the next step that has elapsed for interpolating visual transforms.
 */
export class GameLoop {
  private rafId: number | null = null;
  private last = 0;
  private accumulator = 0;
  private running = false;
  paused = false;
  /** Smoothed frames per second (diagnostics). */
  fps = 60;
  /** Simulation steps executed in the last frame. */
  lastSteps = 0;

  constructor(
    private readonly fixedDt: number,
    private readonly update: (dt: number) => void,
    private readonly render: (alpha: number, frameDt: number) => void,
    private readonly maxStepsPerFrame = 5,
    private readonly now: () => number = () => performance.now(),
    private readonly raf: (cb: FrameRequestCallback) => number = (cb) => requestAnimationFrame(cb),
    private readonly caf: (id: number) => void = (id) => cancelAnimationFrame(id),
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = this.now();
    this.accumulator = 0;
    this.rafId = this.raf(this.frame);
  }

  stop(): void {
    this.running = false;
    if (this.rafId !== null) this.caf(this.rafId);
    this.rafId = null;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Resets timing (e.g. after the tab was hidden) so no burst of catch-up steps occurs. */
  resync(): void {
    this.last = this.now();
    this.accumulator = 0;
  }

  /** Advances one frame manually (used by tests). */
  tick(nowMs: number): void {
    let frameDt = (nowMs - this.last) / 1000;
    this.last = nowMs;
    if (!Number.isFinite(frameDt) || frameDt < 0) frameDt = 0;
    // Clamp long frames (tab switch, debugger) to avoid the spiral of death.
    frameDt = Math.min(frameDt, 0.25);
    if (frameDt > 0) this.fps += (1 / frameDt - this.fps) * 0.05;
    let steps = 0;
    if (!this.paused) {
      this.accumulator += frameDt;
      while (this.accumulator >= this.fixedDt && steps < this.maxStepsPerFrame) {
        this.update(this.fixedDt);
        this.accumulator -= this.fixedDt;
        steps++;
      }
      if (steps === this.maxStepsPerFrame) this.accumulator = Math.min(this.accumulator, this.fixedDt);
    } else {
      this.accumulator = 0;
    }
    this.lastSteps = steps;
    this.render(this.paused ? 1 : this.accumulator / this.fixedDt, frameDt);
  }

  private readonly frame = (t: number): void => {
    if (!this.running) return;
    this.tick(t);
    if (this.running) this.rafId = this.raf(this.frame);
  };
}
