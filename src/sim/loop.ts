/** Render-rate-independent 120 Hz clock. Large gaps interrupt instead of dropping assessment time. */
export class FixedLoop {
  private accumulator = 0;
  private last: number | null = null;
  readonly dt = 1 / 120;
  constructor(
    private step: (dt: number) => void,
    private interrupt: (reason: string) => void,
  ) {}
  advance(nowMilliseconds: number): number {
    if (this.last === null) {
      this.last = nowMilliseconds;
      return 0;
    }
    const elapsed = (nowMilliseconds - this.last) / 1000;
    this.last = nowMilliseconds;
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > 0.25) {
      this.accumulator = 0;
      this.interrupt("Frame stall exceeded 250 ms");
      return 0;
    }
    this.accumulator += elapsed;
    if (this.accumulator > this.dt * 8 + 1e-10) {
      this.accumulator = 0;
      this.interrupt("Physics backlog exceeded eight ticks");
      return 0;
    }
    while (this.accumulator + 1e-10 >= this.dt) {
      this.step(this.dt);
      this.accumulator -= this.dt;
    }
    return Math.max(0, this.accumulator / this.dt);
  }
  reset() {
    this.last = null;
    this.accumulator = 0;
  }
}
