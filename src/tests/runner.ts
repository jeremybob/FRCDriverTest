import type {
  AttemptEvent,
  AttemptStatus,
  Command,
  CourseDefinition,
  CourseSegment,
  Gate,
  MetricValues,
  Pose,
  RobotPreset,
  RunnerFeedback,
  SimSnapshot,
} from "../types";
import { angleError, contained, corners, GateTracker, local } from "./geometry";
import {
  BoundaryEpisodes,
  ContactEpisodes,
  mean,
  PathMetrics,
  setFinite,
} from "../metrics/reducers";
import { median } from "../scoring/index";

export class TestRunner {
  private state: RunnerFeedback["state"] = "ready";
  private outcome: AttemptStatus | null = null;
  private cause = "";
  private tick = 0;
  private elapsed = 0;
  private segmentIndex = 0;
  private gateIndex = 0;
  private segmentTime = 0;
  private dwell = 0;
  private previous: SimSnapshot | null = null;
  private reset: Pose | null = null;
  private started = false;
  private gateTracker = new GateTracker();
  private wrongTracker = new GateTracker();
  private contacts = new ContactEpisodes();
  private boundaries = new BoundaryEpisodes();
  private path = new PathMetrics();
  private events: AttemptEvent[] = [];
  private metrics: MetricValues = {
    time: 0,
    minorContacts: 0,
    majorContacts: 0,
    boundaryDepartures: 0,
    wrongWayTime: 0,
    wrongBranches: 0,
    peakSpeed: 0,
    routeLength: 0,
  };
  private dwellSamples: { center: number; heading: number; dt: number }[] = [];
  private centerErrors: number[] = [];
  private headingErrors: number[] = [];
  private gateOffsets: number[] = [];
  private signedStops: number[] = [];
  private entrySpeeds: number[] = [];
  private latencies: number[] = [];
  private entryAccepted = false;
  private approachPassedAt: number | null = null;
  private cueReady = false;
  private cuePresented: number | null = null;
  private responseArmed = false;
  private responseStart: number | null = null;
  private responseHeld = 0;
  private responseComplete = false;
  private lastCommand: Command | null = null;
  private responseWasHeld = false;
  private wrongBranchLatched = false;
  private entryCenterSpeed: number | null = null;
  private gateCenterOffset: number | null = null;
  private stopped = false;
  constructor(
    readonly course: CourseDefinition,
    readonly preset: RobotPreset,
  ) {}
  start(): void {
    if (this.state !== "ready") return;
    this.state = "running";
    this.started = true;
    this.events.push({ tick: 0, type: "start" });
  }
  private get segment(): CourseSegment {
    return this.course.segments[
      Math.min(this.segmentIndex, this.course.segments.length - 1)
    ];
  }
  private gates(): Gate[] {
    const s = this.segment;
    return [...(s.gate ? [s.gate] : []), ...(s.gates ?? [])];
  }
  private correctCommand(c: Command): boolean {
    const sign = this.segment.cue === "left" ? 1 : -1;
    if (this.preset.kind === "differential") return sign * c.turn > 0.2;
    const heading = this.segment.start?.yaw ?? 0;
    const fieldY = this.course.profileId.includes("-field-")
      ? c.y
      : Math.sin(heading) * c.x + Math.cos(heading) * c.y;
    return sign * fieldY > 0.2;
  }
  markCuePresented(timestamp: number): void {
    if (
      this.state !== "running" ||
      !this.cueReady ||
      this.cuePresented !== null ||
      !Number.isFinite(timestamp)
    )
      return;
    this.cuePresented = timestamp;
    this.responseWasHeld =
      this.lastCommand !== null && this.correctCommand(this.lastCommand);
    this.responseArmed = !this.responseWasHeld;
    this.events.push({
      tick: this.tick,
      type: "cue-presented",
      value: timestamp,
      message: this.segment.cue,
    });
  }
  consumeReset(): Pose | null {
    const p = this.reset;
    if (p) {
      this.reset = null;
      this.previous = null;
    }
    return p;
  }
  step(snapshot: SimSnapshot, command: Command, dt = 1 / 120): void {
    if (this.state !== "running" || this.reset) return;
    if (
      !Number.isFinite(dt) ||
      dt <= 0 ||
      dt > 0.05 ||
      ![
        snapshot.x,
        snapshot.y,
        snapshot.yaw,
        snapshot.vx,
        snapshot.vy,
        snapshot.omega,
        snapshot.speed,
        command.timestamp,
        command.x,
        command.y,
        command.turn,
      ].every(Number.isFinite) ||
      snapshot.contacts.some((c) => ![c.x, c.y, c.speed].every(Number.isFinite))
    ) {
      this.invalidate("Nonfinite telemetry or invalid fixed timestep");
      return;
    }
    if (!this.previous) {
      const start = this.segment.start ?? this.course.start;
      if (
        Math.hypot(snapshot.x - start.x, snapshot.y - start.y) > 0.25 ||
        snapshot.contacts.some((c) => c.active && !/floor|support/i.test(c.id))
      ) {
        this.invalidate("Invalid starting geometry or initial overlap");
        return;
      }
      this.previous = { ...snapshot, x: start.x, y: start.y, yaw: start.yaw };
    }
    this.tick++;
    this.elapsed += dt;
    this.segmentTime += dt;
    const prev = this.previous,
      s = this.segment,
      gates = this.gates(),
      g = gates[this.gateIndex];
    const footprint = corners(snapshot, this.preset);
    if (
      footprint.some(
        (p) => p.x < -0.25 || p.x > 16.25 || p.y < -0.25 || p.y > 8.25,
      )
    ) {
      this.finish("dnf", "Exited the arena");
      return;
    }
    this.contacts.step(snapshot.contacts, dt, this.tick, this.events);
    this.boundaries.step(
      snapshot,
      this.preset,
      this.course.corridor,
      dt,
      this.tick,
      this.events,
      snapshot.contacts.some((c) => c.active && /wall/i.test(c.id)),
    );
    this.metrics.peakSpeed = Math.max(
      Number(this.metrics.peakSpeed),
      snapshot.speed,
    );
    const route = s.route,
      lastGate = gates[this.gateIndex - 1],
      nextGate = gates[this.gateIndex];
    const routeIndex = lastGate
      ? Math.max(
          0,
          route.findIndex(
            (p) => Math.hypot(p.x - lastGate.x, p.y - lastGate.y) < 0.001,
          ),
        )
      : 0;
    const routeEnd = nextGate
      ? route.findIndex(
          (p, i) =>
            i > routeIndex &&
            Math.hypot(p.x - nextGate.x, p.y - nextGate.y) < 0.001,
        )
      : route.length - 1;
    const stageRoute = route.slice(
      routeIndex,
      routeEnd > routeIndex ? routeEnd + 1 : routeIndex + 2,
    );
    if (stageRoute.length >= 2)
      this.path.step(prev, snapshot, stageRoute[0], stageRoute[1], stageRoute);
    if (this.course.id === "T02") {
      const initial = s.start ?? this.course.start,
        next = route[1] ?? s.target,
        dx = next.x - initial.x,
        dy = next.y - initial.y;
      const overlap = Math.max(
        0,
        Math.min(this.segmentTime, 1) - Math.max(0, this.segmentTime - dt),
      );
      if (
        overlap > 0 &&
        snapshot.speed > 0.1 &&
        snapshot.vx * dx + snapshot.vy * dy < 0
      )
        this.metrics.wrongWayTime = Number(this.metrics.wrongWayTime) + overlap;
      if (
        angleError(initial.yaw, Math.PI) < 0.01 &&
        !("oppositeLegDelay" in this.metrics) &&
        snapshot.speed > 0.1 &&
        snapshot.vx * dx + snapshot.vy * dy > 0
      )
        this.metrics.oppositeLegDelay = this.segmentTime;
    }
    if (
      g &&
      (this.course.id !== "T06" ||
        this.gateIndex === 0 ||
        this.cuePresented !== null)
    ) {
      const pa = local(prev, g),
        pb = local(snapshot, g);
      if (pa.x <= 0 && pb.x > 0) {
        const t = -pa.x / (pb.x - pa.x);
        this.entryCenterSpeed = prev.speed + (snapshot.speed - prev.speed) * t;
        this.gateCenterOffset = pa.y + (pb.y - pa.y) * t;
      }
      const crossing = this.gateTracker.step(prev, snapshot, this.preset, g);
      if (crossing.passed) {
        const entry = this.entryCenterSpeed ?? snapshot.speed;
        const valid =
          this.course.id !== "T05" ||
          !s.entrySpeed ||
          (entry >= s.entrySpeed[0] && entry <= s.entrySpeed[1]);
        if (valid) {
          this.events.push({
            tick: this.tick,
            type: "gate",
            source: g.id,
            x: snapshot.x,
            y: snapshot.y,
            value: this.gateCenterOffset ?? crossing.offset,
          });
          this.gateOffsets.push(this.gateCenterOffset ?? crossing.offset);
          this.gateIndex++;
          if (this.course.id === "T05") {
            this.entryAccepted = true;
            this.entrySpeeds.push(entry);
          }
          if (this.course.id === "T06" && this.gateIndex === 1)
            this.approachPassedAt = this.elapsed;
          this.gateTracker.reset();
          this.entryCenterSpeed = null;
          this.gateCenterOffset = null;
        } else {
          this.events.push({
            tick: this.tick,
            type: "entry-out-of-band",
            source: g.id,
            value: entry,
          });
          this.gateTracker.reset();
          this.entryCenterSpeed = null;
        }
      }
    }
    if (this.course.id === "T06") {
      if (
        this.approachPassedAt !== null &&
        this.elapsed - this.approachPassedAt >= (s.cueDelay ?? 0)
      )
        this.cueReady = true;
      if (this.cuePresented !== null) {
        const correct = this.correctCommand(command);
        if (!correct) {
          this.responseArmed = true;
          this.responseStart = null;
          this.responseHeld = 0;
        }
        if (
          correct &&
          this.responseArmed &&
          !this.responseComplete &&
          command.timestamp > this.cuePresented
        ) {
          if (this.responseStart === null)
            this.responseStart = command.timestamp;
          this.responseHeld += dt;
          if (this.responseHeld >= 0.15 - 1e-9) {
            const latency = (this.responseStart - this.cuePresented) / 1000;
            this.latencies.push(latency);
            this.responseComplete = true;
            this.events.push({
              tick: this.tick,
              type: "correct-input",
              value: this.responseStart,
              message: `${latency.toFixed(6)} s after cue`,
            });
          }
        }
        if (s.gates?.[0]) {
          const branch = s.gates[0],
            wrong = {
              ...branch,
              id: `wrong-${branch.id}`,
              y: 8 - branch.y,
              yaw: -branch.yaw,
            };
          const cross = this.wrongTracker.step(
            prev,
            snapshot,
            this.preset,
            wrong,
          );
          if (cross.passed && !this.wrongBranchLatched) {
            this.metrics.wrongBranches = Number(this.metrics.wrongBranches) + 1;
            this.wrongBranchLatched = true;
            this.events.push({
              tick: this.tick,
              type: "wrong-branch",
              source: wrong.id,
            });
          }
          if (local(snapshot, wrong).x < -this.preset.length)
            this.wrongBranchLatched = false;
        }
      }
    }
    const prerequisites =
      this.gateIndex >= gates.length &&
      (this.course.id !== "T05" || this.entryAccepted) &&
      (this.course.id !== "T06" || this.responseComplete);
    const center = Math.hypot(snapshot.x - s.target.x, snapshot.y - s.target.y),
      heading = angleError(snapshot.yaw, s.target.yaw);
    const dwellValid =
      prerequisites &&
      snapshot.speed < s.target.speed &&
      (this.course.id === "T05" ||
        contained(snapshot, this.preset, s.target)) &&
      (s.target.centerTolerance === undefined ||
        center <= s.target.centerTolerance) &&
      (s.target.headingTolerance === undefined ||
        heading <= s.target.headingTolerance);
    if (dwellValid) {
      this.dwell += dt;
      this.dwellSamples.push({ center, heading, dt });
      while (
        this.dwellSamples.length > 1 &&
        this.dwellSamples.slice(1).reduce((sum, p) => sum + p.dt, 0) >=
          0.25 - 1e-9
      )
        this.dwellSamples.shift();
    } else {
      if (this.dwell > 0)
        this.events.push({ tick: this.tick, type: "dwell-reset" });
      this.dwell = 0;
      this.dwellSamples = [];
    }
    this.previous = { ...snapshot };
    this.lastCommand = { ...command };
    this.updateMetrics();
    if (this.elapsed > this.course.timeLimit + 1e-8) {
      this.finish("dnf", "Time limit reached with unmet required conditions");
      return;
    }
    if (this.dwell >= s.target.dwell - 1e-9) {
      this.completeSegment(snapshot);
      return;
    }
    if (this.elapsed >= this.course.timeLimit - 1e-9)
      this.finish("dnf", "Time limit reached with unmet required conditions");
  }
  private completeSegment(snapshot: SimSnapshot): void {
    this.centerErrors.push(mean(this.dwellSamples.map((s) => s.center)));
    this.headingErrors.push(mean(this.dwellSamples.map((s) => s.heading)));
    if (this.course.id === "T05") {
      const frontProjection =
        (Math.abs(Math.cos(snapshot.yaw - this.segment.target.yaw)) *
          this.preset.length) /
          2 +
        (Math.abs(Math.sin(snapshot.yaw - this.segment.target.yaw)) *
          this.preset.width) /
          2;
      this.signedStops.push(
        local(snapshot, this.segment.target).x + frontProjection,
      );
    }
    this.events.push({
      tick: this.tick,
      type: "segment-complete",
      value: this.segmentIndex + 1,
    });
    this.segmentIndex++;
    this.updateMetrics();
    if (this.segmentIndex === this.course.segments.length) {
      this.finish("completed", "All required gates and dwells completed");
      return;
    }
    this.reset = { ...(this.segment.start ?? this.course.start) };
    this.events.push({
      tick: this.tick,
      type: "prescribed-reset",
      x: this.reset.x,
      y: this.reset.y,
    });
    this.gateIndex = 0;
    this.segmentTime = 0;
    this.dwell = 0;
    this.dwellSamples = [];
    this.gateTracker.reset();
    this.wrongTracker.reset();
    this.entryAccepted = false;
    this.approachPassedAt = null;
    this.cueReady = false;
    this.cuePresented = null;
    this.responseArmed = false;
    this.responseStart = null;
    this.responseHeld = 0;
    this.responseComplete = false;
    this.lastCommand = null;
    this.wrongBranchLatched = false;
    this.entryCenterSpeed = null;
    this.gateCenterOffset = null;
  }
  private updateMetrics(): void {
    Object.assign(this.metrics, {
      time: this.elapsed,
      minorContacts: this.contacts.minor,
      majorContacts: this.contacts.major,
      boundaryDepartures: this.boundaries.count,
      routeLength: this.path.length,
      progress: this.segmentIndex,
      completedGates: this.events.filter((e) => e.type === "gate").length,
      requiredGates: this.course.segments.reduce(
        (sum, s) => sum + (s.gate ? 1 : 0) + (s.gates?.length ?? 0),
        0,
      ),
    });
    if (this.path.rms !== null) this.metrics.pathRms = this.path.rms;
    if (this.centerErrors.length) {
      this.metrics.centerErrors = [...this.centerErrors];
      this.metrics.headingErrors = [...this.headingErrors];
      setFinite(this.metrics, "centerError", mean(this.centerErrors));
      setFinite(
        this.metrics,
        "headingError",
        this.course.id === "T04"
          ? this.headingErrors.at(-1)!
          : mean(this.headingErrors),
      );
      if (this.course.id === "T01")
        for (let i = 0; i < this.centerErrors.length; i++) {
          this.metrics[`${["near", "middle", "far"][i]}CenterError`] =
            this.centerErrors[i];
          this.metrics[`${["near", "middle", "far"][i]}HeadingError`] =
            this.headingErrors[i];
        }
    }
    if (this.gateOffsets.length) {
      this.metrics.gateOffsets = [...this.gateOffsets];
      setFinite(
        this.metrics,
        "gateOffsetRms",
        Math.sqrt(mean(this.gateOffsets.map((x) => x * x))),
      );
    }
    if (this.signedStops.length) {
      this.metrics.signedStopErrors = [...this.signedStops];
      this.metrics.entrySpeeds = [...this.entrySpeeds];
      this.metrics.stopError = mean(this.signedStops.map(Math.abs));
      this.metrics.overshoot = mean(
        this.signedStops.map((v) => Math.max(0, v)),
      );
    }
    if (this.latencies.length) {
      this.metrics.cueLatencies = [...this.latencies];
      this.metrics.cueLatency = median(this.latencies);
    }
  }
  finish(status: AttemptStatus = "dnf", cause = "Student abort"): void {
    if (this.stopped) return;
    if (
      status === "completed" &&
      this.segmentIndex < this.course.segments.length
    ) {
      status = "dnf";
      cause = "Unmet required conditions";
    }
    this.outcome = status;
    this.state = status === "practice" ? "completed" : status;
    this.cause = cause;
    this.stopped = true;
    this.updateMetrics();
    this.events.push({ tick: this.tick, type: status, message: cause });
  }
  invalidate(cause: string): void {
    this.finish("invalid", cause);
  }
  feedback(): RunnerFeedback {
    return {
      state: this.state,
      checkpoint: this.segmentIndex,
      total: this.course.segments.length,
      elapsed: this.elapsed,
      dwell: this.dwell,
      instruction: this.reset
        ? "Release controls — prescribed reset"
        : this.course.id === "T06" && this.gateIndex > 0 && !this.cueReady
          ? "Continue to the junction and wait for the cue"
          : this.gates()[this.gateIndex]
            ? `Pass ${this.gates()[this.gateIndex].id} in the arrow direction`
            : this.course.id === "T05"
              ? "Stop the front bumper at the target line and hold"
              : "Settle fully inside the target and hold",
      cue:
        this.cueReady && this.state === "running"
          ? (this.segment.cue?.toUpperCase() ?? null)
          : null,
      target: this.segment.target,
      gate: this.gates()[this.gateIndex] ?? null,
      metrics: structuredClone(this.metrics),
    };
  }
  result(): {
    metrics: MetricValues;
    events: AttemptEvent[];
    status: AttemptStatus;
    durationTicks: number;
    cause: string;
  } {
    return {
      metrics: structuredClone(this.metrics),
      events: structuredClone(this.events),
      status: this.outcome ?? (this.started ? "dnf" : "invalid"),
      durationTicks: this.tick,
      cause: this.cause || "Attempt has not finished",
    };
  }
}
