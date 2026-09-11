import type {
  Attempt,
  Command,
  CourseDefinition,
  PerformanceRecord,
  Profile,
  ReplaySample,
  RunnerFeedback,
  SimSnapshot,
} from "../types";
import { PhysicsWorld } from "../sim/world";
import { InputManager } from "../input";
import type { InputDiagnostics } from "../input";
import { Venue } from "../render/venue";
import { TestRunner } from "../tests/runner";
import { scoreAttempt } from "../scoring";
import { freezeProfile } from "./profile";
import { FREE_OBSTACLES } from "../../content/courses/free";
import { rotate, wrapAngle } from "../sim/coordinates";
export type RunMode = "free" | "practice" | "scored";
export type EngineState =
  | "loading"
  | "ready"
  | "countdown"
  | "running"
  | "paused"
  | "review";
export interface EngineHud {
  state: EngineState;
  snapshot: SimSnapshot;
  feedback: RunnerFeedback | null;
  diagnostics: InputDiagnostics;
  command: Command;
  performance: PerformanceRecord;
  countdown: number;
  ready: boolean;
  canStart: boolean;
  reason: string;
  freeSeconds: number;
  renderResolution: [number, number];
}
const percentile = (a: number[], p = 0.95) =>
  a.length
    ? [...a].sort((x, y) => x - y)[
        Math.min(a.length - 1, Math.floor(a.length * p))
      ]
    : 0;
const zero = (): Command => ({
  x: 0,
  y: 0,
  turn: 0,
  brake: false,
  precision: false,
  timestamp: performance.now(),
  deviceSlot: -1,
});
export class LabEngine {
  private world!: PhysicsWorld;
  private venue!: Venue;
  private input!: InputManager;
  private runner: TestRunner | null = null;
  private state: EngineState = "loading";
  private mode: RunMode;
  private raf = 0;
  private disposed = false;
  private last = 0;
  private accumulator = 0;
  private countdownEnd = 0;
  private startWall = 0;
  private lastHud = 0;
  private stationFrames: number[] = [];
  private stationPhysics: number[] = [];
  private preflightFrames = 0;
  private stationMaxFrame = 0;
  private trialFrames: number[] = [];
  private trialPhysics: number[] = [];
  private trialMaxFrame = 0;
  private trialStarted = false;
  private reason = "Warming the venue";
  private warm = false;
  private freeSeconds = 0;
  private profile: Profile;
  private command = zero();
  private replay: ReplaySample[] = [];
  /** Exact tick commands are retained for the active attempt; review uses sampled poses. */
  private commands: { tick: number; command: Command }[] = [];
  private attemptIdentity: {
    driverId: string;
    scheduledTrial: number;
    startedAt: string;
  } | null = null;
  private previousSnapshot: SimSnapshot | null = null;
  private headingOffset = 0;
  private trail = false;
  private cueShown: string | null = null;
  private cuePending = false;
  private resizeHandler = () => {
    if (this.state === "running" || this.state === "countdown") {
      if (this.mode === "scored")
        this.interrupt("Display resized during a scored attempt");
    }
    if (this.mode !== "scored" || this.state !== "running") {
      this.venue.resize();
      this.preflightFrames = 0;
      this.stationFrames = [];
      this.stationMaxFrame = 0;
    }
  };
  private contextLost = (e: Event) => {
    e.preventDefault();
    this.interrupt("Graphics context lost");
  };
  private constructor(
    private canvas: HTMLCanvasElement,
    profile: Profile,
    private course: CourseDefinition | null,
    mode: RunMode,
    private onHud: (hud: EngineHud) => void,
    private onResult: (attempt: Attempt) => void,
  ) {
    this.profile = structuredClone(profile);
    this.mode = mode;
  }
  static async create(
    canvas: HTMLCanvasElement,
    profile: Profile,
    course: CourseDefinition | null,
    mode: RunMode,
    onHud: (hud: EngineHud) => void,
    onResult: (attempt: Attempt) => void,
  ) {
    const e = new LabEngine(canvas, profile, course, mode, onHud, onResult);
    try {
      await e.init();
      return e;
    } catch (error) {
      e.dispose();
      throw error;
    }
  }
  private async init() {
    this.world = await PhysicsWorld.create(
      this.profile.robot,
      this.course?.obstacles ?? FREE_OBSTACLES,
    );
    this.world.reset(this.course?.start ?? { x: 2, y: 4, yaw: 0 });
    this.venue = new Venue(
      this.canvas,
      this.profile.robot,
      this.profile.graphicsTier,
    );
    this.venue.setCourse(this.course);
    this.venue.setCamera(
      this.mode === "scored" ? "station" : this.profile.camera,
    );
    this.input = new InputManager(
      this.profile.input,
      this.profile.robot.kind,
      (r) => this.interrupt(r),
    );
    window.addEventListener("resize", this.resizeHandler);
    this.canvas.addEventListener("webglcontextlost", this.contextLost);
    this.venue.update(this.world.snapshot(), null);
    await this.venue.warm();
    if (this.disposed) return;
    this.benchmarkPhysics();
    this.warm = true;
    this.state = "ready";
    this.reason = "Warming rendered frames before controls unlock";
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }
  /** Measure actual warmed force/collision work, then restore the exact course start. */
  private benchmarkPhysics() {
    const start = this.course?.start ?? { x: 2, y: 4, yaw: 0 };
    try {
      for (let pair = 0; pair < 180; pair++) {
        if (pair % 12 === 0) this.world.reset(start);
        const command = {
          ...zero(),
          x: 0.65,
          y:
            this.profile.robot.kind === "differential"
              ? 0
              : pair % 24 < 12
                ? 0.35
                : -0.35,
          turn: pair % 24 < 12 ? 0.25 : -0.25,
        };
        const before = performance.now();
        this.world.step(command, this.profile.controlFrame);
        this.world.step(command, this.profile.controlFrame);
        const work = performance.now() - before;
        if (pair >= 30) this.stationPhysics.push(work);
      }
    } finally {
      this.world.reset(start);
    }
  }
  private resetTrialMetrics() {
    this.trialFrames = [];
    this.trialPhysics = [];
    this.trialMaxFrame = 0;
    this.trialStarted = true;
  }
  private renderedWarm() {
    return (
      this.warm &&
      this.stationFrames.length >= 60 &&
      this.stationPhysics.length >= 150
    );
  }
  private stats(): PerformanceRecord {
    const v = this.venue.stats(),
      memory = (
        performance as Performance & { memory?: { usedJSHeapSize: number } }
      ).memory;
    const trial =
      this.trialStarted &&
      (this.state === "running" ||
        this.state === "paused" ||
        this.state === "review");
    const frames = trial ? this.trialFrames : this.stationFrames,
      physics = trial ? this.trialPhysics : this.stationPhysics;
    return {
      frameP95: percentile(frames),
      physicsP95: percentile(physics),
      maxFrame: trial ? this.trialMaxFrame : this.stationMaxFrame,
      frames: frames.length,
      drawCalls: v.drawCalls,
      triangles: v.triangles,
      ...(memory ? { heapMB: memory.usedJSHeapSize / 1048576 } : {}),
    };
  }
  private frame = (now: number) => {
    if (this.disposed) return;
    const interval = now - this.last;
    this.last = now;
    // The prior frame has presented this DOM cue. Acknowledge BEFORE sampling a new response.
    const cueEl =
      this.canvas.parentElement?.querySelector<HTMLElement>(".cue-banner");
    if (
      this.cuePending &&
      this.runner?.feedback().cue === this.cueShown &&
      cueEl &&
      !cueEl.hidden &&
      cueEl.getClientRects().length > 0 &&
      document.visibilityState === "visible"
    ) {
      this.runner.markCuePresented(now);
      this.cuePending = false;
    }
    this.command = this.input.sample(
      Math.max(0, Math.min(interval / 1000, 0.05)),
    );
    if (
      this.warm &&
      interval > 0 &&
      Number.isFinite(interval) &&
      document.visibilityState === "visible"
    ) {
      this.preflightFrames++;
      if (this.preflightFrames > 30) {
        this.stationFrames.push(interval);
        if (this.stationFrames.length > 600) this.stationFrames.shift();
        this.stationMaxFrame = Math.max(this.stationMaxFrame, interval);
      }
    }
    if (this.state === "ready")
      this.reason = this.renderedWarm()
        ? "Release controls, then begin"
        : `Warming rendered frames (${Math.min(60, this.stationFrames.length)} / 60)`;
    let simulationInterval = interval;
    if (this.state === "countdown" && now >= this.countdownEnd) {
      this.state = "running";
      this.startWall = now;
      this.accumulator = 0;
      this.resetTrialMetrics();
      this.runner?.start();
      simulationInterval = 0;
    }
    if (this.state === "running") {
      if (simulationInterval > 0) {
        this.trialFrames.push(simulationInterval);
        this.trialMaxFrame = Math.max(this.trialMaxFrame, simulationInterval);
      }
      let interruption = "";
      if (
        !Number.isFinite(simulationInterval) ||
        simulationInterval < 0 ||
        simulationInterval > 250
      )
        interruption = "Frame stall exceeded 250 ms";
      else if (this.accumulator + simulationInterval / 1000 > 8 / 120 + 1e-9)
        interruption = "Physics backlog exceeded eight ticks";
      if (interruption) {
        if (this.mode === "free") {
          this.accumulator = 0;
          this.reason = `${interruption}; free drive resumed without advancing the skipped interval.`;
        } else this.interrupt(interruption);
      } else {
        this.accumulator += simulationInterval / 1000;
        let ticks = 0;
        let finished = false;
        const workStart = performance.now();
        while (
          this.accumulator + 1e-10 >= 1 / 120 &&
          this.state === "running" &&
          ticks < 8
        ) {
          this.tick();
          this.accumulator = Math.max(0, this.accumulator - 1 / 120);
          ticks++;
          const state = this.runner?.feedback().state;
          if (state && ["completed", "dnf", "invalid"].includes(state)) {
            finished = true;
            break;
          }
        }
        if (ticks > 0)
          this.trialPhysics.push(((performance.now() - workStart) * 2) / ticks);
        if (finished) this.complete();
      }
      if (
        this.mode === "scored" &&
        this.state === "running" &&
        this.trialFrames.length >= 240 &&
        percentile(this.trialFrames.slice(-240)) > 20
      )
        this.interrupt(
          "Persistent frame pacing exceeded 20 ms p95; requalify the station",
        );
    }
    const snap = this.world.snapshot(),
      feedback = this.runner?.feedback() ?? null,
      cue = feedback?.cue ?? null;
    if (cue !== this.cueShown) {
      this.cueShown = cue;
      this.cuePending = !!cue;
      if (cueEl) {
        cueEl.textContent = cue
          ? `GO ${cue === "LEFT" ? "← LEFT" : "RIGHT →"}`
          : "";
        cueEl.hidden = !cue;
      }
    }
    const prev = this.previousSnapshot;
    const alpha = Math.max(0, Math.min(1, this.accumulator * 120));
    const visual =
      this.state === "running" && prev
        ? {
            ...snap,
            x: prev.x + (snap.x - prev.x) * alpha,
            y: prev.y + (snap.y - prev.y) * alpha,
            yaw: prev.yaw + wrapAngle(snap.yaw - prev.yaw) * alpha,
          }
        : snap;
    this.venue.update(visual, feedback, this.mode !== "scored" && this.trail);
    this.venue.render(now);
    if (now - this.lastHud > 80) {
      this.lastHud = now;
      const perf = this.stats();
      this.onHud({
        state: this.state,
        snapshot: snap,
        feedback,
        diagnostics: this.input.diagnostics(),
        command: this.command,
        performance: perf,
        countdown: Math.max(0, Math.ceil((this.countdownEnd - now) / 1000)),
        ready: this.qualified(),
        canStart: this.renderedWarm() && this.input.diagnostics().connected,
        reason: this.reason,
        freeSeconds: this.freeSeconds,
        renderResolution: this.venue.stats().resolution,
      });
    }
    this.raf = requestAnimationFrame(this.frame);
  };
  private tick() {
    const c = { ...this.command };
    c.x *= this.profile.assistance.speedLimit;
    c.y *= this.profile.assistance.speedLimit;
    c.turn *= this.profile.assistance.speedLimit;
    if (!this.profile.assistance.brake) c.brake = false;
    if (!this.profile.assistance.precision) c.precision = false;
    if (this.profile.controlFrame === "field" && this.headingOffset) {
      const turned = rotate(c.x, c.y, this.headingOffset);
      c.x = turned.x;
      c.y = turned.y;
    }
    this.previousSnapshot = this.world.snapshot();
    const snap = this.world.step(c, this.profile.controlFrame);
    this.runner?.step(snap, c, 1 / 120);
    if (this.mode === "free") this.freeSeconds += 1 / 120;
    else {
      this.commands.push({ tick: this.commands.length + 1, command: { ...c } });
      if (this.commands.length % 4 === 0)
        this.replay.push({
          x: snap.x,
          y: snap.y,
          yaw: snap.yaw,
          tick: this.commands.length,
          xInput: c.x,
          yInput: c.y,
          turnInput: c.turn,
          checkpoint: this.runner?.feedback().checkpoint ?? 0,
        });
    }
    const reset = this.runner?.consumeReset();
    if (reset) {
      this.world.reset(reset);
      this.previousSnapshot = null;
      this.input.clear();
      this.command = zero();
    }
  }
  qualified() {
    return (
      this.renderedWarm() &&
      this.stationFrames.length >= 150 &&
      percentile(this.stationFrames) <= 20 &&
      percentile(this.stationPhysics) <= 4 &&
      window.innerWidth >= 1280 &&
      window.innerHeight >= 720 &&
      this.input.diagnostics().connected
    );
  }
  start(driverId: string, scheduledTrial = 1) {
    if (!["ready", "review"].includes(this.state)) return;
    if (!this.renderedWarm())
      throw new Error(
        "Wait for the venue to finish warming rendered frames before starting.",
      );
    if (!this.input.diagnostics().connected)
      throw new Error("Connect the selected input device before starting.");
    if (!this.input.neutral())
      throw new Error("Release all controls before starting.");
    if (this.mode === "scored" && !this.qualified())
      throw new Error(
        "Run the station check at 1280 × 720 or larger with frame p95 at or below 20 ms.",
      );
    this.world.reset(this.course?.start ?? { x: 2, y: 4, yaw: 0 });
    this.previousSnapshot = null;
    this.runner = this.course
      ? new TestRunner(this.course, this.profile.robot)
      : null;
    this.replay = [];
    this.commands = [];
    this.attemptIdentity = {
      driverId,
      scheduledTrial,
      startedAt: new Date().toISOString(),
    };
    this.state = this.mode === "free" ? "running" : "countdown";
    this.countdownEnd = performance.now() + 3000;
    this.startWall = performance.now();
    this.accumulator = 0;
    this.input.clear();
    this.reason = "";
    this.trialStarted = false;
    this.cueShown = null;
    this.cuePending = false;
    this.last = performance.now();
    const cueEl =
      this.canvas.parentElement?.querySelector<HTMLElement>(".cue-banner");
    if (cueEl) {
      cueEl.hidden = true;
      cueEl.textContent = "";
    }
    if (this.mode === "free") {
      this.resetTrialMetrics();
      this.runner?.start();
    }
  }
  interrupt(reason: string) {
    this.input?.clear();
    this.command = zero();
    this.accumulator = 0;
    this.reason = reason;
    if (this.state !== "running" && this.state !== "countdown") return;
    if (this.mode === "scored") {
      if (reason === "Paused by driver")
        this.runner?.finish("dnf", "Student pause / abort");
      else this.runner?.invalidate(reason);
      this.complete();
    } else this.state = "paused";
  }
  abort() {
    if (this.mode === "free") {
      this.interrupt("Paused by driver");
      return;
    }
    this.runner?.finish("dnf", "Student abort");
    this.complete();
  }
  reset() {
    if (
      (this.state === "running" || this.state === "countdown") &&
      this.mode === "scored"
    ) {
      this.runner?.finish("dnf", "Student reset");
      this.complete();
      return;
    }
    this.world.reset(this.course?.start ?? { x: 2, y: 4, yaw: 0 });
    this.runner = null;
    this.trialStarted = false;
    this.state = "ready";
    this.reason = "Reset. Ready to begin.";
    this.input.clear();
  }
  resume() {
    if (
      this.state === "paused" &&
      this.mode !== "scored" &&
      this.input.neutral()
    ) {
      this.state = "running";
      this.last = performance.now();
      this.accumulator = 0;
      this.reason = "";
    }
  }
  prepareProfile(profile: Profile) {
    if (this.state === "ready" || this.state === "review")
      this.profile = structuredClone(profile);
  }
  camera(mode: Profile["camera"]) {
    if (this.mode !== "scored") {
      this.venue.setCamera(mode);
      this.profile.camera = mode;
    }
  }
  orbit(delta: number) {
    if (this.mode !== "scored") this.venue.setOrbit(delta);
  }
  zeroHeading() {
    if (this.mode === "free") {
      this.headingOffset = this.world.snapshot().yaw;
      this.reason =
        "Field control heading zeroed at the current robot orientation.";
    }
  }
  setTrail(trail: boolean) {
    this.trail = trail;
  }
  setFrame(frame: Profile["controlFrame"]) {
    if (this.mode !== "scored") this.profile.controlFrame = frame;
  }
  private complete() {
    if (this.state === "review") return;
    const r = this.runner?.result();
    if (!r || !this.course || !this.attemptIdentity) return;
    this.state = "review";
    this.input.clear();
    let status = this.mode === "practice" ? "practice" : r.status;
    let score = scoreAttempt(this.course.id, status, r.metrics);
    let cause = r.cause;
    if (status === "completed" && score.score === null) {
      status = "invalid";
      cause = "Required scoring metrics were missing; technical invalidation.";
      score = scoreAttempt(this.course.id, status, r.metrics);
    }
    const attempt: Attempt = {
      id: crypto.randomUUID(),
      driverId: this.attemptIdentity.driverId,
      testId: this.course.id,
      scheduledTrial: this.attemptIdentity.scheduledTrial,
      status,
      cause,
      startedAt: this.attemptIdentity.startedAt,
      durationTicks: r.durationTicks,
      wallDuration: Math.max(0, (performance.now() - this.startWall) / 1000),
      metrics: r.metrics,
      events: r.events,
      performance: this.stats(),
      score,
      profile: freezeProfile(this.profile),
      practiceCompleted: this.mode === "practice" && r.status === "completed",
      replay: [...this.replay],
    };
    this.onResult(attempt);
  }
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.resizeHandler);
    this.canvas.removeEventListener("webglcontextlost", this.contextLost);
    this.input?.dispose();
    this.venue?.dispose();
    this.world?.dispose();
  }
}
