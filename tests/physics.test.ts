import { describe, it, expect } from "vitest";
import { ROBOTS } from "../content/robots";
import { PhysicsWorld } from "../src/sim/world";
import { fromRender, toRender, fieldToRobot } from "../src/sim/coordinates";
import { makeWheels, traction, wheelTargets } from "../src/drivetrains";
import { FixedLoop } from "../src/sim/loop";
import type { Command, RobotPreset } from "../src/types";
const command = (values: Partial<Command> = {}): Command => ({
  x: 0,
  y: 0,
  turn: 0,
  brake: false,
  precision: false,
  timestamp: 0,
  deviceSlot: -1,
  ...values,
});
async function run(p: RobotPreset, c: Command, ticks: number) {
  const world = await PhysicsWorld.create(p);
  world.reset({ x: 3, y: 4, yaw: 0 });
  for (let i = 0; i < ticks; i++) world.step(c, "robot");
  return world;
}
describe("robotics frame and kinematics", () => {
  it("maps every basis vector and positive yaw consistently", () => {
    expect(toRender(1, 0, 0)).toEqual({ x: 1, y: 0, z: -0 });
    expect(toRender(0, 1, 0)).toEqual({ x: 0, y: 0, z: -1 });
    expect(toRender(0, 0, 1)).toEqual({ x: 0, y: 1, z: -0 });
    expect(fromRender(1, 2, 3)).toEqual({ x: 1, y: -3, z: 2 });
    expect(fieldToRobot(1, 0, Math.PI / 2).y).toBeCloseTo(-1);
  });
  it("limits coupled traction, holds neutral angles, and rate limits steering", () => {
    const f = traction(1000, 1000, 100, 1, 0.5);
    expect(Math.hypot(f.long / 100, f.lat / 50)).toBeCloseTo(1);
    expect(traction(1, 1, 0, 1, 1)).toEqual({ long: 0, lat: 0 });
    const p = ROBOTS[0],
      w = makeWheels(p);
    wheelTargets(p, w, 0, 4, 0, false, 1 / 120);
    expect(w[0].angle).toBeCloseTo(p.steeringRate / 120);
    const angle = w[0].targetAngle;
    wheelTargets(p, w, 0, 0, 0, false, 1 / 120);
    expect(w[0].targetAngle).toBe(angle);
    expect(
      wheelTargets(p, w, 4, 4, 5, false, 1 / 120).every(
        (t) => Math.abs(t.speed) <= p.maxSpeed,
      ),
    ).toBe(true);
  });
});
describe("force-based flat-floor world", () => {
  it.each(ROBOTS)(
    "$kind accelerates with inertia and stays under its speed envelope",
    async (p) => {
      const w = await run(p, command({ x: 1 }), 1);
      expect(w.snapshot().speed).toBeGreaterThan(0);
      expect(w.snapshot().speed).toBeLessThan(0.2);
      for (let i = 0; i < 150; i++) w.step(command({ x: 1 }), "robot");
      expect(w.snapshot().vx).toBeGreaterThan(2);
      expect(w.snapshot().speed).toBeLessThanOrEqual(p.maxSpeed + 0.05);
      expect(Math.abs(w.snapshot().y - 4)).toBeLessThan(0.03);
      w.dispose();
    },
  );
  it("coasts farther than explicit braking", async () => {
    const coast = await run(ROBOTS[0], command({ x: 1 }), 90),
      brake = await run(ROBOTS[0], command({ x: 1 }), 90);
    for (let i = 0; i < 60; i++) {
      coast.step(command(), "robot");
      brake.step(command({ brake: true }), "robot");
    }
    expect(coast.snapshot().x - brake.snapshot().x).toBeGreaterThan(0.5);
    expect(brake.snapshot().speed).toBeLessThan(coast.snapshot().speed * 0.35);
    coast.dispose();
    brake.dispose();
  });
  it("differential cannot strafe, mecanum can, and swerve steering has a transient", async () => {
    const diff = await run(ROBOTS[1], command({ y: 1 }), 80),
      mecanum = await run(ROBOTS[2], command({ y: 1 }), 80),
      swerve = await run(ROBOTS[0], command({ y: 1 }), 1);
    expect(diff.snapshot().speed).toBeLessThan(0.001);
    expect(mecanum.snapshot().y).toBeGreaterThan(4.5);
    expect(mecanum.snapshot().wheels.every((w) => w.angle === 0)).toBe(true);
    expect(swerve.snapshot().wheels[0].angle).toBeCloseTo(
      ROBOTS[0].steeringRate / 120,
    );
    diff.dispose();
    mecanum.dispose();
    swerve.dispose();
  });
  it.each(ROBOTS)(
    "$kind pivots with correct positive yaw and no drift",
    async (p) => {
      const w = await run(p, command({ turn: 1 }), 120);
      expect(w.snapshot().omega).toBeGreaterThan(0.4);
      expect(Math.hypot(w.snapshot().x - 3, w.snapshot().y - 4)).toBeLessThan(
        0.05,
      );
      w.dispose();
    },
  );
  it("field-forward movement remains field-forward at 90 degrees", async () => {
    const w = await PhysicsWorld.create(ROBOTS[0]);
    w.reset({ x: 4, y: 4, yaw: Math.PI / 2 });
    for (let i = 0; i < 100; i++) w.step(command({ x: 1 }), "field");
    expect(w.snapshot().x).toBeGreaterThan(4.8);
    expect(Math.abs(w.snapshot().y - 4)).toBeLessThan(0.18);
    w.dispose();
  });
  it("CCD blocks thin barriers and contact episodes preserve impact severity", async () => {
    const w = await PhysicsWorld.create(ROBOTS[0], [
      { id: "thin", x: 7, y: 4, width: 6, length: 0.04, yaw: 0 },
    ]);
    w.reset({ x: 3, y: 4, yaw: 0 });
    let impact = 0;
    for (let i = 0; i < 360; i++) {
      const s = w.step(command({ x: 1 }), "robot");
      impact = Math.max(impact, ...s.contacts.map((c) => c.speed));
      expect(s.x).toBeLessThan(6.57);
    }
    expect(impact).toBeGreaterThan(3);
    expect(w.snapshot().contacts.some((c) => c.id === "thin")).toBe(true);
    w.dispose();
  });
  it("has the same trajectory at 30, 60, and 120 Hz rendering", async () => {
    const results = [];
    for (const fps of [30, 60, 120]) {
      const w = await PhysicsWorld.create(ROBOTS[0]);
      w.reset({ x: 3, y: 4, yaw: 0 });
      const loop = new FixedLoop(
        () => w.step(command({ x: 0.5, turn: 0.1 }), "robot"),
        () => {
          throw Error("stall");
        },
      );
      for (let frame = 0; frame <= fps * 2; frame++)
        loop.advance((frame * 1000) / fps);
      results.push(w.snapshot());
      w.dispose();
    }
    expect(results.map((r) => r.tick)).toEqual([240, 240, 240]);
    expect(results[0].x).toBeCloseTo(results[2].x, 5);
    expect(results[1].yaw).toBeCloseTo(results[2].yaw, 5);
  });
  it("rejects nonfixed physics time and interrupts large frame gaps", async () => {
    const w = await PhysicsWorld.create(ROBOTS[0]);
    expect(() => w.step(command(), "robot", 0.1)).toThrow("120");
    w.dispose();
    let interrupted = false,
      ticks = 0;
    const loop = new FixedLoop(
      () => ticks++,
      () => {
        interrupted = true;
      },
    );
    loop.advance(0);
    loop.advance(500);
    expect(interrupted).toBe(true);
    expect(ticks).toBe(0);
  });
  it("rejects impossible starts including rotated bumper overlap", async () => {
    const w = await PhysicsWorld.create(ROBOTS[0], [
      { id: "block", x: 5, y: 4, width: 1, length: 1, yaw: Math.PI / 4 },
    ]);
    expect(() => w.reset({ x: 0.3, y: 4, yaw: Math.PI / 4 })).toThrow(
      "overlaps",
    );
    expect(() => w.reset({ x: 5.7, y: 4, yaw: 0 })).toThrow("overlaps");
    expect(() => w.reset({ x: 3, y: 4, yaw: 0 })).not.toThrow();
    w.dispose();
  });
  it("rejects a nine-tick catch-up without silently advancing trial time", () => {
    let ticks = 0,
      reason = "";
    const loop = new FixedLoop(
      () => ticks++,
      (r) => {
        reason = r;
      },
    );
    loop.advance(0);
    loop.advance(75);
    expect(ticks).toBe(0);
    expect(reason).toContain("eight");
  });
  it("classifies glancing contact by normal closing speed rather than total speed", async () => {
    const w = await PhysicsWorld.create(ROBOTS[0], [
      { id: "glance", x: 8, y: 5, width: 0.04, length: 14, yaw: 0 },
    ]);
    w.reset({ x: 2, y: 4, yaw: 0 });
    let contactSpeed = -1,
      travelSpeed = 0;
    for (let i = 0; i < 320; i++) {
      const s = w.step(command({ x: 0.95, y: 0.13 }), "robot");
      const contact = s.contacts.find((c) => c.id === "glance");
      if (contact) {
        contactSpeed = contact.speed;
        travelSpeed = s.speed;
        break;
      }
    }
    expect(contactSpeed).toBeGreaterThan(0);
    expect(contactSpeed).toBeLessThan(1);
    expect(travelSpeed).toBeGreaterThan(2);
    w.dispose();
  });
});
