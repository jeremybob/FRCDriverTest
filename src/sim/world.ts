import RAPIER from "@dimforge/rapier3d-compat";
import type {
  Command,
  ControlFrame,
  CourseDefinition,
  Pose,
  RobotPreset,
  SimSnapshot,
  WheelState,
} from "../types";
import { makeWheels, traction, wheelTargets } from "../drivetrains";
import { clamp, fieldToRobot, rotate } from "./coordinates";
import { validatePreset } from "../../content/robots";

type Obstacles = CourseDefinition["obstacles"];
let initialization: Promise<void> | undefined;
export const PHYSICS_VERSION = "rapier-0.19.3-force-1.0.0";
export class PhysicsWorld {
  private world: RAPIER.World;
  private body: RAPIER.RigidBody;
  private collider: RAPIER.Collider;
  private events = new RAPIER.EventQueue(true);
  private obstacleColliders: RAPIER.Collider[] = [];
  private labels = new Map<number, string>();
  private activeContacts = new Map<
    string,
    { id: string; speed: number; active: boolean; x: number; y: number }
  >();
  private wheels: WheelState[];
  private tick = 0;
  private disposed = false;
  private obstacles: Obstacles = [];
  static async create(preset: RobotPreset, obstacles: Obstacles = []) {
    validatePreset(preset);
    initialization ??= RAPIER.init();
    await initialization;
    return new PhysicsWorld(preset, obstacles);
  }
  private constructor(
    readonly preset: RobotPreset,
    obstacles: Obstacles,
  ) {
    this.world = new RAPIER.World({ x: 0, y: 0, z: -9.81 });
    this.world.timestep = 1 / 120;
    this.world.integrationParameters.maxCcdSubsteps = 4;
    this.body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(2, 4, 0.23)
        .setCcdEnabled(true)
        .setCanSleep(false),
    );
    // Flat-floor support approximation: no suspension, pitching, ramps or tipping.
    this.body.setEnabledTranslations(true, true, false, true);
    this.body.setEnabledRotations(false, false, true, true);
    this.collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(preset.length / 2, preset.width / 2, 0.18)
        .setMass(preset.mass)
        .setFriction(0.35)
        .setRestitution(0.08)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.body,
    );
    this.wheels = makeWheels(preset);
    const floor = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(8, 4, 0.05)
        .setTranslation(8, 4, -0.05)
        .setFriction(0),
    );
    this.labels.set(floor.handle, "floor");
    for (const [id, x, y, l, w] of [
      ["wall-west", -0.1, 4, 0.2, 8.4],
      ["wall-east", 16.1, 4, 0.2, 8.4],
      ["wall-south", 8, -0.1, 16, 0.2],
      ["wall-north", 8, 8.1, 16, 0.2],
    ] as [string, number, number, number, number][]) {
      const c = this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(l / 2, w / 2, 0.5)
          .setTranslation(x, y, 0.5)
          .setFriction(0.35)
          .setRestitution(0.08),
      );
      this.labels.set(c.handle, id);
    }
    this.setObstacles(obstacles);
  }
  setObstacles(obstacles: Obstacles) {
    const ids = new Set<string>();
    for (const o of obstacles) {
      if (
        ids.has(o.id) ||
        ![o.x, o.y, o.width, o.length, o.yaw].every(Number.isFinite) ||
        o.width <= 0 ||
        o.length <= 0
      )
        throw new Error("Invalid obstacle geometry");
      ids.add(o.id);
    }
    for (const c of this.obstacleColliders) {
      this.labels.delete(c.handle);
      this.world.removeCollider(c, true);
    }
    this.obstacles = obstacles.map((o) => ({ ...o }));
    this.obstacleColliders = [];
    this.activeContacts.clear();
    for (const o of obstacles) {
      const c = this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(o.length / 2, o.width / 2, 0.45)
          .setTranslation(o.x, o.y, 0.45)
          .setRotation({
            x: 0,
            y: 0,
            z: Math.sin(o.yaw / 2),
            w: Math.cos(o.yaw / 2),
          })
          .setFriction(0.4)
          .setRestitution(0.06),
      );
      this.obstacleColliders.push(c);
      this.labels.set(c.handle, o.id);
    }
  }
  reset(pose: Pose) {
    if (![pose.x, pose.y, pose.yaw].every(Number.isFinite))
      throw new Error("Invalid start pose");
    const corners = footprint(pose, this.preset.length, this.preset.width);
    if (
      corners.some((c) => c.x < 0 || c.x > 16 || c.y < 0 || c.y > 8) ||
      this.obstacles.some((o) =>
        overlap(corners, footprint(o, o.length, o.width)),
      )
    )
      throw new Error("Start pose overlaps a wall or obstacle");
    this.body.setTranslation({ x: pose.x, y: pose.y, z: 0.23 }, true);
    this.body.setRotation(
      { x: 0, y: 0, z: Math.sin(pose.yaw / 2), w: Math.cos(pose.yaw / 2) },
      true,
    );
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.resetForces(true);
    this.body.resetTorques(true);
    this.wheels = makeWheels(this.preset);
    this.tick = 0;
    this.activeContacts.clear();
    this.events.clear();
  }
  step(command: Command, frame: ControlFrame, dt = 1 / 120): SimSnapshot {
    if (this.disposed) throw new Error("Physics world disposed");
    if (!Number.isFinite(dt) || Math.abs(dt - 1 / 120) > 1e-9)
      throw new Error("Physics requires fixed 120 Hz ticks");
    if (![command.x, command.y, command.turn].every(Number.isFinite))
      throw new Error("Nonfinite input");
    const p = this.preset,
      before = this.snapshot(),
      precision = command.precision ? 0.35 : 1;
    let x = clamp(command.x, -1, 1),
      y = p.kind === "differential" ? 0 : clamp(command.y, -1, 1);
    const magnitude = Math.max(1, Math.hypot(x, y));
    x /= magnitude;
    y /= magnitude;
    if (frame === "field" && p.kind !== "differential")
      ({ x, y } = fieldToRobot(x, y, before.yaw));
    const turn = clamp(command.turn, -1, 1),
      neutral = Math.abs(x) + Math.abs(y) + Math.abs(turn) < 1e-5;
    const targets = wheelTargets(
      p,
      this.wheels,
      command.brake ? 0 : x * p.maxSpeed * precision,
      command.brake ? 0 : y * p.maxSpeed * precision,
      command.brake ? 0 : turn * p.maxTurnRate * precision,
      command.brake,
      dt,
    );
    this.body.resetForces(true);
    this.body.resetTorques(true);
    for (let i = 0; i < this.wheels.length; i++) {
      const w = this.wheels[i],
        target = targets[i],
        offset = rotate(w.x, w.y, before.yaw),
        angle = before.yaw + target.forceAngle;
      const c = Math.cos(angle),
        s = Math.sin(angle),
        pointVx = before.vx - before.omega * offset.y,
        pointVy = before.vy + before.omega * offset.x;
      const rolling = pointVx * c + pointVy * s,
        lateral = -pointVx * s + pointVy * c;
      let longitudinal = clamp(
        (target.speed - rolling) * p.mass * target.load * 12,
        -p.maxForce * target.load,
        p.maxForce * target.load,
      );
      if (neutral && !command.brake)
        longitudinal = -rolling * p.mass * target.load * p.coastDrag;
      const lateralGain =
        p.kind === "differential" ? 5 : p.kind === "mecanum" ? 0.5 : 15;
      const forces = traction(
        longitudinal,
        -lateral * p.mass * target.load * lateralGain,
        p.mass * 9.81 * target.load,
        p.muLong,
        p.muLat,
      );
      this.body.addForceAtPoint(
        {
          x: forces.long * c - forces.lat * s,
          y: forces.long * s + forces.lat * c,
          z: 0,
        },
        { x: before.x + offset.x, y: before.y + offset.y, z: 0.23 },
        true,
      );
      w.speed = p.kind === "mecanum" ? rolling * Math.SQRT2 : rolling;
      w.rotation += (w.speed / p.wheelRadius) * dt;
    }
    this.world.timestep = dt;
    this.world.step(this.events);
    this.tick++;
    // Emit one persistent contact per collider episode; retain impact speed for penalty classification.
    this.events.drainCollisionEvents((a, b, started) => {
      if (a !== this.collider.handle && b !== this.collider.handle) return;
      const other = a === this.collider.handle ? b : a,
        id = this.labels.get(other);
      if (!id || id === "floor") return;
      if (started)
        this.activeContacts.set(id, {
          id,
          speed: 0,
          active: true,
          x: before.x,
          y: before.y,
        });
      else this.activeContacts.delete(id);
    });
    this.world.contactPairsWith(this.collider, (other) => {
      const id = this.labels.get(other.handle),
        contact = id ? this.activeContacts.get(id) : undefined;
      if (!contact) return;
      this.world.contactPair(this.collider, other, (manifold, flipped) => {
        const normal = manifold.normal(),
          direction = flipped ? -1 : 1;
        for (let j = 0; j < manifold.numSolverContacts(); j++) {
          const point = manifold.solverContactPoint(j),
            dx = point.x - before.x,
            dy = point.y - before.y;
          const closing =
            (before.vx - before.omega * dy) * normal.x * direction +
            (before.vy + before.omega * dx) * normal.y * direction;
          if (closing > contact.speed) {
            contact.speed = closing;
            contact.x = point.x;
            contact.y = point.y;
          }
        }
      });
    });
    return this.snapshot();
  }
  snapshot(): SimSnapshot {
    const pos = this.body.translation(),
      q = this.body.rotation(),
      v = this.body.linvel(),
      omega = this.body.angvel().z;
    return {
      tick: this.tick,
      x: pos.x,
      y: pos.y,
      yaw: Math.atan2(
        2 * (q.w * q.z + q.x * q.y),
        1 - 2 * (q.y * q.y + q.z * q.z),
      ),
      vx: v.x,
      vy: v.y,
      omega,
      speed: Math.hypot(v.x, v.y),
      wheels: this.wheels.map((w) => ({ ...w })),
      contacts: [...this.activeContacts.values()].map((c) => ({ ...c })),
    };
  }
  dispose() {
    if (!this.disposed) {
      this.events.free();
      this.world.free();
      this.disposed = true;
    }
  }
}

function footprint(p: Pose, length: number, width: number) {
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([sx, sy]) => {
    const v = rotate((sx * length) / 2, (sy * width) / 2, p.yaw);
    return { x: p.x + v.x, y: p.y + v.y };
  });
}
function overlap(a: { x: number; y: number }[], b: { x: number; y: number }[]) {
  for (const polygon of [a, b])
    for (let i = 0; i < 4; i++) {
      const next = polygon[(i + 1) % 4],
        point = polygon[i],
        axis = { x: next.y - point.y, y: point.x - next.x };
      const pa = a.map((p) => p.x * axis.x + p.y * axis.y),
        pb = b.map((p) => p.x * axis.x + p.y * axis.y);
      if (
        Math.max(...pa) <= Math.min(...pb) + 1e-7 ||
        Math.max(...pb) <= Math.min(...pa) + 1e-7
      )
        return false;
    }
  return true;
}
