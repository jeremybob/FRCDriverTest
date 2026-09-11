import { describe, it, expect } from "vitest";
import { ROBOTS } from "../content/robots";
import { PhysicsWorld } from "../src/sim/world";
import { clamp, wrapAngle } from "../src/sim/coordinates";
import { createCourse, TEST_CATALOG } from "../src/tests/courses";
import { TestRunner } from "../src/tests/runner";
import type {
  Command,
  CourseDefinition,
  Pose,
  RobotPreset,
  SimSnapshot,
  TestId,
} from "../src/types";

interface Waypoint extends Pose {
  tolerance: number;
  speed: number;
  gate?: string;
}
const offset = (p: Pose, d: number): Pose => ({
  x: p.x + Math.cos(p.yaw) * d,
  y: p.y + Math.sin(p.yaw) * d,
  yaw: p.yaw,
});
/** Deterministic closed-loop fixture; controls actuators only, never chassis velocity or position. */
function waypoints(course: CourseDefinition, segment: number): Waypoint[] {
  const s = course.segments[segment],
    gates = [...(s.gate ? [s.gate] : []), ...(s.gates ?? [])];
  const result: Waypoint[] = [];
  for (let i = 0; i < gates.length; i++) {
    const g = gates[i];
    if (course.id === "T03" && i === 5)
      result.push(
        { x: 13.4, y: 2, yaw: 0, tolerance: 0.16, speed: 2.2 },
        { x: 13.4, y: 6, yaw: Math.PI / 2, tolerance: 0.16, speed: 2.2 },
      );
    if (course.id === "T03" && course.profileId.includes("differential")) {
      const previous = i === 0 ? (s.start ?? course.start) : gates[i - 1];
      const heading =
        i === 5 ? Math.PI : Math.atan2(g.y - previous.y, g.x - previous.x);
      result.push({
        ...offset({ ...g, yaw: heading }, 0.7),
        yaw: g.yaw,
        tolerance: 0.25,
        speed: 1.05,
        gate: g.id,
      });
      continue;
    }
    if (course.id === "T06" && i === 1)
      result.push({ x: 9, y: 4, yaw: 0, tolerance: 0.08, speed: 2 });
    result.push({ ...offset(g, -1.05), tolerance: 0.08, speed: 2.2 });
    result.push({ ...offset(g, 0.9), tolerance: 0.12, speed: 1.3, gate: g.id });
  }
  result.push({ ...s.target, tolerance: 0.035, speed: 2.2 });
  return result;
}
function drive(
  snapshot: SimSnapshot,
  target: Waypoint,
  p: RobotPreset,
  timestamp: number,
): Command {
  const dx = target.x - snapshot.x,
    dy = target.y - snapshot.y,
    distance = Math.hypot(dx, dy);
  let x = 0,
    y = 0,
    turn = 0;
  if (p.kind === "differential") {
    let heading = distance > 0.04 ? Math.atan2(dy, dx) : target.yaw,
      error = wrapAngle(heading - snapshot.yaw),
      direction = 1;
    if (Math.abs(error) > Math.PI / 2 && distance < 0.7 && distance > 0.04) {
      direction = -1;
      heading = wrapAngle(heading + Math.PI);
      error = wrapAngle(heading - snapshot.yaw);
    }
    const velocity = Math.min(
      target.speed,
      Math.sqrt(Math.max(0, distance - 0.015) * 4),
      distance * 3,
    );
    x =
      ((direction * velocity) / p.maxSpeed) * Math.max(0, Math.cos(error)) ** 4;
    turn = clamp((error * 5) / p.maxTurnRate - snapshot.omega * 0.12, -1, 1);
    if (distance <= 0.04) x = 0;
  } else {
    const velocity = Math.min(
      target.speed,
      distance * 3,
      Math.sqrt(distance * 5),
    );
    x = distance ? ((dx / distance) * velocity) / p.maxSpeed : 0;
    y = distance ? ((dy / distance) * velocity) / p.maxSpeed : 0;
    turn = clamp(
      (wrapAngle(target.yaw - snapshot.yaw) * 3.5) / p.maxTurnRate -
        snapshot.omega * 0.12,
      -1,
      1,
    );
  }
  return {
    x,
    y,
    turn,
    brake:
      distance < 0.025 && Math.abs(wrapAngle(target.yaw - snapshot.yaw)) < 0.02,
    precision: false,
    timestamp,
    deviceSlot: -1,
  };
}

export async function driveCourse(p: RobotPreset, id: TestId) {
  const course = createCourse(id, p, "field", 101),
    world = await PhysicsWorld.create(p, course.obstacles),
    runner = new TestRunner(course, p);
  world.reset(course.start);
  runner.start();
  let segment = 0,
    waypoint = 0,
    points = waypoints(course, 0),
    cuePresented = false,
    snapshot = world.snapshot(),
    lastGate: string | null = null;
  try {
    for (
      let tick = 0;
      tick < course.timeLimit * 120 + 5 &&
      runner.feedback().state === "running";
      tick++
    ) {
      const feedback = runner.feedback(),
        time = (tick * 1000) / 120;
      if (feedback.cue && !cuePresented) {
        runner.markCuePresented(time);
        cuePresented = true;
      }
      let target = points[Math.min(waypoint, points.length - 1)];
      if (id === "T05") {
        const s = course.segments[segment];
        target = {
          ...s.target,
          x: s.target.x - p.length / 2,
          tolerance: 0.02,
          speed: p.maxSpeed * 0.73,
        };
      }
      let c = drive(snapshot, target, p, time);
      if (id === "T06" && waypoint >= 2 && !cuePresented)
        c = { ...c, x: 0, y: 0, turn: 0, brake: true };
      snapshot = world.step(c, "field");
      runner.step(snapshot, c, 1 / 120);
      const gateNow = runner.feedback().gate?.id ?? null;
      if (id !== "T05") {
        const reached =
          Math.hypot(target.x - snapshot.x, target.y - snapshot.y) <
          target.tolerance;
        const continuous = id === "T03" && p.kind === "differential";
        const aligned =
          continuous || Math.abs(wrapAngle(target.yaw - snapshot.yaw)) < 0.08;
        if (
          waypoint < points.length - 1 &&
          ((continuous &&
            target.gate &&
            feedback.gate?.id === target.gate &&
            gateNow !== target.gate) ||
            (reached && aligned && snapshot.speed < (continuous ? 1 : 0.4)))
        )
          waypoint++;
      }
      lastGate = gateNow;
      const reset = runner.consumeReset();
      if (reset) {
        world.reset(reset);
        snapshot = world.snapshot();
        segment++;
        waypoint = 0;
        points = waypoints(course, segment);
        cuePresented = false;
      }
    }
    return {
      result: runner.result(),
      snapshot,
      waypoint,
      target: points[Math.min(waypoint, points.length - 1)],
      gate: lastGate,
    };
  } finally {
    world.dispose();
  }
}

describe("physical core-course feasibility (actuator commands, no synthetic poses)", () => {
  for (const p of ROBOTS)
    for (const { id } of TEST_CATALOG)
      it(`${p.kind} completes ${id}`, async () => {
        const run = await driveCourse(p, id);
        if (process.env.FEASIBILITY_REPORT)
          console.log(
            JSON.stringify({
              drive: p.kind,
              test: id,
              status: run.result.status,
              seconds: Number(Number(run.result.metrics.time).toFixed(3)),
              minor: run.result.metrics.minorContacts,
              major: run.result.metrics.majorContacts,
              boundaries: run.result.metrics.boundaryDepartures,
              entrySpeeds: run.result.metrics.entrySpeeds,
              stopErrors: run.result.metrics.signedStopErrors,
            }),
          );
        expect(
          run.result.status,
          JSON.stringify({
            cause: run.result.cause,
            metrics: run.result.metrics,
            waypoint: run.waypoint,
            gate: run.gate,
            target: run.target,
            snapshot: run.snapshot,
          }),
        ).toBe("completed");
        expect(Number(run.result.metrics.majorContacts)).toBe(0);
        expect(Number(run.result.metrics.minorContacts)).toBe(0);
        expect(Number(run.result.metrics.boundaryDepartures)).toBe(0);
        if (id === "T05") {
          expect(run.result.metrics.entrySpeeds as number[]).toHaveLength(3);
          expect(
            (run.result.metrics.entrySpeeds as number[]).every(
              (v) => v >= p.maxSpeed * 0.65 && v <= p.maxSpeed * 0.8,
            ),
          ).toBe(true);
          expect(
            (run.result.metrics.signedStopErrors as number[]).every(
              (v) => Math.abs(v) < 0.05,
            ),
          ).toBe(true);
        }
      });
});
