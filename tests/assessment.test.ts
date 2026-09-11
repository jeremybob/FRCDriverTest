import { describe, it, expect } from "vitest";
import { ROBOTS } from "../content/robots";
import {
  createCourse,
  TEST_CATALOG,
  validateCourse,
} from "../src/tests/courses";
import { TestRunner } from "../src/tests/runner";
import { corners, GateTracker, contained } from "../src/tests/geometry";
import {
  ContactEpisodes,
  BoundaryEpisodes,
  PathMetrics,
} from "../src/metrics/reducers";
import type {
  AttemptEvent,
  Command,
  Gate,
  Pose,
  SimSnapshot,
  TestId,
} from "../src/types";
const robot = ROBOTS[0],
  dt = 1 / 120;
const cmd = (timestamp = 0, values: Partial<Command> = {}): Command => ({
  x: 0,
  y: 0,
  turn: 0,
  brake: false,
  precision: false,
  timestamp,
  deviceSlot: -1,
  ...values,
});
function fixture(id: TestId) {
  const course = createCourse(id, robot, "field"),
    runner = new TestRunner(course, robot);
  let timestamp = 1000;
  let current: Pose = course.start;
  const step = (p: Pose = current, speed = 0, input: Partial<Command> = {}) => {
    current = p;
    timestamp += dt * 1000;
    runner.step(
      {
        ...p,
        tick: 0,
        vx: Math.cos(p.yaw) * speed,
        vy: Math.sin(p.yaw) * speed,
        omega: 0,
        speed,
        contacts: [],
        wheels: [],
      } as SimSnapshot,
      cmd(timestamp, input),
    );
  };
  const cross = (g: Gate, speed = 1) => {
    step(
      { x: g.x - Math.cos(g.yaw), y: g.y - Math.sin(g.yaw), yaw: g.yaw },
      speed,
    );
    step(
      { x: g.x + Math.cos(g.yaw), y: g.y + Math.sin(g.yaw), yaw: g.yaw },
      speed,
    );
  };
  runner.start();
  step();
  return { course, runner, step, cross, time: () => timestamp };
}
describe("published core definitions", () => {
  it.each(ROBOTS)(
    "validates all tests for $kind and distinct control-frame profiles",
    (p) => {
      for (const t of TEST_CATALOG) {
        const a = createCourse(t.id, p, "robot");
        expect(() => validateCourse(a, p)).not.toThrow();
        expect(a.profileId).not.toBe(createCourse(t.id, p, "field").profileId);
        expect(a.segments.length).toBeGreaterThan(0);
      }
    },
  );
  it("rejects impossible geometry and duplicate checkpoints", () => {
    const c = createCourse("T04", robot, "field");
    c.segments[0].gates![1].id = c.segments[0].gates![0].id;
    expect(() => validateCourse(c, robot)).toThrow("Duplicate");
  });
});
describe("test runner scenario fixtures", () => {
  it.each(["T01", "T02", "T03", "T04", "T05", "T06"] as TestId[])(
    "%s completes only prescribed gates and continuous dwells",
    (id) => {
      const f = fixture(id);
      for (const s of f.course.segments) {
        if (s.gate) f.cross(s.gate, s.entrySpeed ? sum(s.entrySpeed) / 2 : 1);
        if (id === "T06") {
          for (let i = 0; i < 180; i++) f.step();
          expect(f.runner.feedback().cue).toBe(s.cue!.toUpperCase());
          f.runner.markCuePresented(f.time());
          for (let i = 0; i < 19; i++)
            f.step(undefined, 0, { y: s.cue === "left" ? 1 : -1 });
        }
        for (const g of s.gates ?? []) f.cross(g);
        const stop =
          id === "T05"
            ? { ...s.target, x: s.target.x - robot.length / 2 }
            : s.target;
        for (let i = 0; i < Math.ceil(s.target.dwell / dt) + 1; i++)
          f.step(stop);
        const reset = f.runner.consumeReset();
        if (reset) f.step(reset);
      }
      const result = f.runner.result();
      expect(result.status).toBe("completed");
      expect(
        result.events.filter((e) => e.type === "segment-complete"),
      ).toHaveLength(f.course.segments.length);
      expect(result.metrics.time).toBeGreaterThan(0);
      if (id === "T05") expect(result.metrics.stopError).toBeCloseTo(0);
      if (id === "T06") expect(result.metrics.cueLatencies).toHaveLength(3);
    },
  );
  it("resets dwell on a brief speed excursion and measures the final quarter second", () => {
    const f = fixture("T01"),
      target = f.course.segments[0].target;
    for (let i = 0; i < 80; i++) f.step(target);
    expect(f.runner.feedback().checkpoint).toBe(0);
    f.step(target, 0.16);
    expect(f.runner.feedback().dwell).toBe(0);
    for (let i = 0; i < 60; i++) f.step({ ...target, x: target.x + 0.1 });
    for (let i = 0; i < 30; i++) f.step(target);
    expect(f.runner.feedback().checkpoint).toBe(1);
    expect(f.runner.result().metrics.centerError).toBeCloseTo(0);
  });
  it("rejects low-speed T05 entry and records negative early stopping error", () => {
    const f = fixture("T05"),
      s = f.course.segments[0];
    f.cross(s.gate!, 0.2);
    for (let i = 0; i < 100; i++) f.step(s.target);
    expect(f.runner.feedback().checkpoint).toBe(0);
    f.cross(s.gate!, sum(s.entrySpeed!) / 2);
    const early = { ...s.target, x: s.target.x - robot.length / 2 - 0.5 };
    for (let i = 0; i < 90; i++) f.step(early);
    expect(
      (f.runner.result().metrics.signedStopErrors as number[])[0],
    ).toBeCloseTo(-0.5);
    expect(f.runner.result().metrics.overshoot).toBe(0);
  });
  it("does not time an unrendered cue or accept preheld cue input", () => {
    const f = fixture("T06"),
      s = f.course.segments[0],
      input = { y: s.cue === "left" ? 1 : -1 };
    f.cross(s.gate!);
    for (let i = 0; i < 200; i++) f.step(undefined, 0, input);
    expect(f.runner.result().metrics.cueLatency).toBeUndefined();
    f.runner.markCuePresented(f.time());
    for (let i = 0; i < 100; i++) f.step(undefined, 0, input);
    expect(f.runner.result().metrics.cueLatency).toBeUndefined();
    f.step();
    for (let i = 0; i < 19; i++) f.step(undefined, 0, input);
    expect(f.runner.result().metrics.cueLatency).toBeGreaterThan(0.8);
  });
  it("counts a wrong T06 branch but permits correction", () => {
    const f = fixture("T06"),
      s = f.course.segments[0];
    f.cross(s.gate!);
    for (let i = 0; i < 180; i++) f.step();
    f.runner.markCuePresented(f.time());
    const g = s.gates![0];
    f.cross({ ...g, y: 8 - g.y, yaw: -g.yaw });
    expect(f.runner.result().metrics.wrongBranches).toBe(1);
    expect(f.runner.feedback().checkpoint).toBe(0);
    for (let i = 0; i < 19; i++)
      f.step(undefined, 0, { y: s.cue === "left" ? 1 : -1 });
    f.cross(g);
    for (let i = 0; i < 60; i++) f.step(s.target);
    expect(f.runner.feedback().checkpoint).toBe(1);
  });
  it("records wrong-way translation only during the first second of T02", () => {
    const f = fixture("T02"),
      p = f.course.start;
    for (let i = 0; i < 240; i++) f.step({ ...p, yaw: Math.PI }, 0.2);
    expect(f.runner.result().metrics.wrongWayTime).toBeCloseTo(1 - dt);
    expect(f.runner.result().metrics.pathRms).toBeUndefined();
  });
  it("does not advance a skipped or reverse slalom gate", () => {
    const f = fixture("T03"),
      g = f.course.segments[0].gates![1];
    f.cross(g);
    expect(f.runner.feedback().gate?.id).toBe("out-0");
  });
  it("freezes on prescribed reset; timeout and manual abort are DNF; technical interruption invalid", () => {
    const f = fixture("T01");
    for (let i = 0; i < 90; i++) f.step(f.course.segments[0].target);
    const time = f.runner.feedback().elapsed;
    for (let i = 0; i < 120; i++) f.step();
    expect(f.runner.feedback().elapsed).toBe(time);
    const a = fixture("T01");
    for (let i = 0; i < 7200; i++) a.step();
    expect(a.runner.result().status).toBe("dnf");
    const b = fixture("T03");
    b.runner.finish("dnf", "Student reset");
    expect(b.runner.result().cause).toBe("Student reset");
    const c = fixture("T02");
    c.runner.invalidate("Focus lost");
    const ticks = c.runner.result().durationTicks;
    c.step();
    expect(c.runner.result().status).toBe("invalid");
    expect(c.runner.result().durationTicks).toBe(ticks);
  });
  it("fails an initial overlap as setup invalid rather than scoring a collision", () => {
    const c = createCourse("T01", robot, "field"),
      r = new TestRunner(c, robot);
    r.start();
    r.step(
      {
        ...c.start,
        tick: 0,
        vx: 0,
        vy: 0,
        omega: 0,
        speed: 0,
        wheels: [],
        contacts: [{ id: "post", active: true, speed: 0, x: 2, y: 2 }],
      },
      cmd(),
    );
    expect(r.result().status).toBe("invalid");
    expect(r.result().metrics.minorContacts).toBe(0);
  });
});
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
describe("swept geometry and distance/episode reducers", () => {
  it("requires all corners through the opening, catches swept misses, rejects reverse passes", () => {
    const g = { id: "gate", x: 5, y: 4, yaw: 0, width: robot.width + 0.2 },
      r = new GateTracker();
    expect(
      r.step({ x: 4, y: 4, yaw: 0 }, { x: 6, y: 4, yaw: 0 }, robot, g).passed,
    ).toBe(true);
    r.reset();
    expect(
      r.step({ x: 4, y: 4.2, yaw: 0 }, { x: 6, y: 4.2, yaw: 0 }, robot, g)
        .passed,
    ).toBe(false);
    r.reset();
    expect(
      r.step({ x: 6, y: 4, yaw: 0 }, { x: 4, y: 4, yaw: 0 }, robot, g).passed,
    ).toBe(false);
    const t = {
      x: 5,
      y: 4,
      yaw: 0,
      width: robot.width,
      length: robot.length,
      dwell: 0.75,
      speed: 0.15,
    };
    expect(contained(t, robot, t)).toBe(true);
    expect(contained({ ...t, yaw: 0.3 }, robot, t)).toBe(false);
    expect(corners(t, robot)).toHaveLength(4);
  });
  it("sustained contact is one episode, escalation uses maximum speed, .30 s separation rearms", () => {
    const c = new ContactEpisodes(),
      events: AttemptEvent[] = [],
      hit = (speed: number) => [
        { id: "post", speed, active: true, x: 0, y: 0 },
      ];
    for (let i = 0; i < 200; i++) c.step(hit(0.2), dt, i, events);
    expect(c.minor).toBe(1);
    c.step(hit(1.1), dt, 201, events);
    expect(c.minor).toBe(0);
    expect(c.major).toBe(1);
    for (let i = 0; i < 35; i++) c.step([], dt, 202 + i, events);
    c.step(hit(0.2), dt, 240, events);
    expect(c.minor).toBe(0);
    for (let i = 0; i < 36; i++) c.step([], dt, 250 + i, events);
    c.step(hit(0.2), dt, 300, events);
    expect(c.minor).toBe(1);
  });
  it("marked-boundary episodes use full bumper and do not double-penalize wall penetration", () => {
    const b = new BoundaryEpisodes(),
      e: AttemptEvent[] = [],
      polygon = [
        { x: 1, y: 1 },
        { x: 15, y: 1 },
        { x: 15, y: 7 },
        { x: 1, y: 7 },
      ];
    b.step({ x: 1, y: 4, yaw: 0 }, robot, polygon, dt, 1, e, true);
    expect(b.count).toBe(0);
    b.step({ x: 1, y: 4, yaw: 0 }, robot, polygon, dt, 2, e);
    expect(b.count).toBe(1);
    for (let i = 0; i < 40; i++)
      b.step({ x: 4, y: 4, yaw: 0 }, robot, polygon, dt, 3 + i, e);
    b.step({ x: 1, y: 4, yaw: 0 }, robot, polygon, dt, 50, e);
    expect(b.count).toBe(2);
  });
  it("samples each .05 m, ignores stationary time, and uses only the active route stage", () => {
    const m = new PathMetrics(),
      a = { x: 0, y: 1, yaw: 0 },
      b = { x: 1, y: 1, yaw: 0 },
      ra = { x: 0, y: 0, yaw: 0 },
      rb = { x: 1, y: 0, yaw: 0 };
    m.step(a, b, ra, rb);
    expect(m.count).toBe(20);
    expect(m.rms).toBeCloseTo(1);
    for (let i = 0; i < 100; i++) m.step(b, b, ra, rb);
    expect(m.count).toBe(20);
    expect(m.rms).toBeCloseTo(1);
  });
});
