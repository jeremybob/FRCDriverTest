import { beforeEach, describe, it, expect, vi } from "vitest";
import type {
  Profile,
  Pose,
  RunnerFeedback,
  AttemptStatus,
} from "../src/types";
const m = vi.hoisted(() => ({
  now: 0,
  raf: null as ((now: number) => void) | null,
  steps: 0,
  resets: [] as Pose[],
  order: [] as string[],
  cue: null as string | null,
  runnerState: "ready" as RunnerFeedback["state"],
  status: "dnf" as AttemptStatus,
  cause: "",
  clockCost: 0.04,
  canvasCue: { hidden: true, textContent: "", getClientRects: () => [{}] },
  rendered: 0,
}));
vi.mock("../src/sim/world", () => ({
  PhysicsWorld: class {
    static async create() {
      return new this();
    }
    reset(p: Pose) {
      m.resets.push({ ...p });
    }
    step() {
      m.steps++;
      m.now += m.clockCost;
      return this.snapshot();
    }
    snapshot() {
      return {
        ...(m.resets.at(-1) ?? { x: 2, y: 4, yaw: 0 }),
        tick: m.steps,
        vx: 0,
        vy: 0,
        speed: 0,
        omega: 0,
        contacts: [],
        wheels: [],
      };
    }
    dispose() {}
  },
}));
vi.mock("../src/render/venue", () => ({
  Venue: class {
    setCourse() {}
    setCamera() {}
    setOrbit() {}
    update() {}
    async warm() {}
    render() {
      m.rendered++;
    }
    resize() {}
    stats() {
      return { drawCalls: 1, triangles: 10, resolution: [1280, 720] };
    }
    dispose() {}
  },
}));
vi.mock("../src/input", () => ({
  InputManager: class {
    sample() {
      m.order.push("sample");
      return {
        x: 0,
        y: 0,
        turn: 0,
        brake: false,
        precision: false,
        timestamp: m.now,
        deviceSlot: -1,
      };
    }
    clear() {}
    neutral() {
      return true;
    }
    diagnostics() {
      return { connected: true, neutral: true };
    }
    dispose() {}
  },
}));
vi.mock("../src/tests/runner", () => ({
  TestRunner: class {
    start() {
      m.runnerState = "running";
    }
    step() {
      m.order.push("step");
    }
    feedback() {
      return {
        state: m.runnerState,
        checkpoint: 0,
        total: 1,
        elapsed: 0,
        dwell: 0,
        instruction: "fixture",
        cue: m.cue,
        target: null,
        gate: null,
        metrics: {},
      };
    }
    consumeReset() {
      return null;
    }
    markCuePresented() {
      m.order.push("presented");
    }
    invalidate(reason: string) {
      m.runnerState = "invalid";
      m.status = "invalid";
      m.cause = reason;
    }
    finish(status: AttemptStatus, reason: string) {
      m.runnerState = status === "practice" ? "completed" : status;
      m.status = status;
      m.cause = reason;
    }
    result() {
      return {
        status: m.status,
        cause: m.cause,
        metrics: {},
        events: [],
        durationTicks: 0,
      };
    }
  },
}));
vi.mock("../src/app/profile", () => ({
  freezeProfile: (p: Profile) => structuredClone(p),
}));
import { LabEngine } from "../src/app/engine";
import type { EngineHud, RunMode } from "../src/app/engine";
import { createCourse } from "../src/tests/courses";
import { ROBOTS } from "../content/robots";
const p = {
  robot: ROBOTS[0],
  controlFrame: "field",
  graphicsTier: "standard",
  camera: "station",
  input: {},
  assistance: { speedLimit: 1, precision: true, brake: true },
} as Profile;
function advance(ms = 1000 / 60) {
  m.now += ms;
  m.raf?.(m.now);
}
function warm(frames = 180) {
  for (let i = 0; i < frames; i++) advance();
}
async function create(mode: RunMode) {
  let hud: EngineHud | null = null;
  const results: unknown[] = [];
  const canvas = {
    parentElement: { querySelector: () => m.canvasCue },
    addEventListener() {},
    removeEventListener() {},
  } as unknown as HTMLCanvasElement;
  const engine = await LabEngine.create(
    canvas,
    p,
    mode === "free" ? null : createCourse("T01", ROBOTS[0], "field"),
    mode,
    (h) => (hud = h),
    (a) => results.push(a),
  );
  return { engine, results, hud: () => hud! };
}
beforeEach(() => {
  m.now = 0;
  m.raf = null;
  m.steps = 0;
  m.resets = [];
  m.order = [];
  m.cue = null;
  m.runnerState = "ready";
  m.status = "dnf";
  m.cause = "";
  m.clockCost = 0.04;
  m.canvasCue.hidden = true;
  m.canvasCue.textContent = "";
  m.rendered = 0;
  vi.stubGlobal("window", {
    innerWidth: 1280,
    innerHeight: 720,
    addEventListener() {},
    removeEventListener() {},
  });
  vi.stubGlobal("document", { visibilityState: "visible" });
  vi.stubGlobal("performance", { now: () => m.now });
  vi.stubGlobal("requestAnimationFrame", (cb: (now: number) => void) => {
    m.raf = cb;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});
describe("engine timing and measured qualification", () => {
  it("benchmarks actual warmed physics and restores start, then gates every mode on rendered warmup", async () => {
    const f = await create("free");
    expect(m.steps).toBe(360);
    expect(m.resets.at(-1)).toEqual({ x: 2, y: 4, yaw: 0 });
    expect(() => f.engine.start("driver")).toThrow("warming");
    warm(89);
    expect(() => f.engine.start("driver")).toThrow("warming");
    advance();
    expect(() => f.engine.start("driver")).not.toThrow();
    f.engine.dispose();
  });
  it("cannot qualify with empty physics measurements and reports the measured workload", async () => {
    const f = await create("scored");
    expect(f.engine.qualified()).toBe(false);
    warm();
    expect(f.engine.qualified()).toBe(true);
    expect(f.hud().performance.physicsP95).toBeCloseTo(0.08);
    expect(f.hud().canStart).toBe(true);
    f.engine.dispose();
  });
  it("starts countdown simulation with zero preceding-frame credit and keeps trial-only statistics", async () => {
    const f = await create("scored");
    warm();
    f.engine.start("driver");
    const before = m.steps;
    advance(3000);
    expect(m.steps).toBe(before);
    expect(f.hud().performance.frames).toBe(0);
    advance();
    expect(m.steps - before).toBe(2);
    f.engine.abort();
    const result = f.results[0] as {
      performance: { frames: number; maxFrame: number; physicsP95: number };
    };
    expect(result.performance.frames).toBe(1);
    expect(result.performance.maxFrame).toBeCloseTo(1000 / 60);
    expect(result.performance.physicsP95).toBeCloseTo(0.08);
    f.engine.dispose();
  });
  it("acknowledges a rendered cue before sampling post-presentation input", async () => {
    const f = await create("scored");
    warm();
    f.engine.start("driver");
    advance(3000);
    m.cue = "LEFT";
    advance();
    expect(m.canvasCue.hidden).toBe(false);
    m.order = [];
    advance();
    expect(m.order[0]).toBe("presented");
    expect(m.order.indexOf("presented")).toBeLessThan(
      m.order.indexOf("sample"),
    );
    f.engine.dispose();
  });
  it("never acknowledges a hidden cue", async () => {
    const f = await create("scored");
    warm();
    f.engine.start("driver");
    advance(3000);
    m.cue = "LEFT";
    advance();
    m.canvasCue.hidden = true;
    m.order = [];
    advance();
    expect(m.order).not.toContain("presented");
    f.engine.dispose();
  });
  it("invalidates scored backlog without dropping time, but free drive recovers without advancing skipped interval", async () => {
    const scored = await create("scored");
    warm();
    scored.engine.start("a");
    advance(3000);
    const before = m.steps;
    advance(100);
    expect(m.steps).toBe(before);
    expect((scored.results[0] as { status: string }).status).toBe("invalid");
    scored.engine.dispose();
    const free = await create("free");
    warm();
    free.engine.start("a");
    const prior = m.steps;
    advance(300);
    expect(m.steps).toBe(prior);
    expect(free.results).toHaveLength(0);
    expect(free.hud().state).toBe("running");
    expect(free.hud().reason).toContain("skipped interval");
    advance();
    expect(m.steps - prior).toBeLessThanOrEqual(2);
    free.engine.dispose();
  });
  it("pauses guided practice on backlog and caps simulation catch-up to eight ticks", async () => {
    const f = await create("practice");
    warm();
    f.engine.start("a");
    advance(3000);
    const before = m.steps;
    advance((8 * 1000) / 120);
    expect(m.steps - before).toBeLessThanOrEqual(8);
    advance(100);
    expect(f.hud().state).toBe("paused");
    f.engine.dispose();
  });
  it("evaluates persistent pacing from the running trial instead of warmed setup frames", async () => {
    const f = await create("scored");
    warm(600);
    f.engine.start("a");
    advance(3000);
    for (let i = 0; i < 239; i++) advance(25);
    expect(f.results).toHaveLength(0);
    advance(25);
    expect((f.results[0] as { cause: string }).cause).toContain(
      "Persistent frame pacing",
    );
    f.engine.dispose();
  });
});
