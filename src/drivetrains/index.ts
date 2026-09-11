import type { RobotPreset, WheelState } from "../types";
import { clamp, wrapAngle } from "../sim/coordinates";

export interface WheelTarget {
  speed: number;
  angle: number;
  forceAngle: number;
  load: number;
}
/** Wheel order FL, FR, RL, RR; differential additionally center-left, center-right. */
export function makeWheels(p: RobotPreset): WheelState[] {
  const positions = [
    [p.wheelbase / 2, p.track / 2],
    [p.wheelbase / 2, -p.track / 2],
    [-p.wheelbase / 2, p.track / 2],
    [-p.wheelbase / 2, -p.track / 2],
  ];
  if (p.kind === "differential")
    positions.push([0, p.track / 2], [0, -p.track / 2]);
  return positions.map(([x, y]) => ({
    x,
    y,
    angle: 0,
    speed: 0,
    rotation: 0,
    targetAngle: 0,
  }));
}

export function wheelTargets(
  p: RobotPreset,
  wheels: WheelState[],
  vx: number,
  vy: number,
  omega: number,
  brake: boolean,
  dt: number,
): WheelTarget[] {
  const targets = wheels.map((w, i) => {
    const x = vx - omega * w.y,
      y = vy + omega * w.x;
    if (p.kind === "swerve") {
      let angle = Math.hypot(x, y) > 0.025 ? Math.atan2(y, x) : w.targetAngle;
      let speed = Math.hypot(x, y);
      if (brake) {
        angle = Math.atan2(w.y, w.x);
        speed = 0;
      }
      if (Math.abs(wrapAngle(angle - w.angle)) > Math.PI / 2) {
        angle = wrapAngle(angle + Math.PI);
        speed = -speed;
      }
      w.targetAngle = angle;
      w.angle = wrapAngle(
        w.angle +
          clamp(
            wrapAngle(angle - w.angle),
            -p.steeringRate * dt,
            p.steeringRate * dt,
          ),
      );
      // Steering alignment attenuates drive while modules turn.
      speed *= Math.cos(wrapAngle(angle - w.angle));
      return { speed, angle, forceAngle: w.angle, load: 0.25 };
    }
    if (p.kind === "differential")
      return { speed: x, angle: 0, forceAngle: 0, load: i < 4 ? 0.125 : 0.25 };
    // X roller arrangement: wheel ground-force axes FL/RR -45°, FR/RL +45°.
    const sign = i === 0 || i === 3 ? -1 : 1;
    return {
      speed: (x + sign * y) / Math.SQRT2,
      angle: 0,
      forceAngle: (sign * Math.PI) / 4,
      load: 0.25,
    };
  });
  const maximum = Math.max(
    p.maxSpeed,
    ...targets.map(
      (t) => Math.abs(t.speed) * (p.kind === "mecanum" ? Math.SQRT2 : 1),
    ),
  );
  for (const t of targets) t.speed *= p.maxSpeed / maximum;
  return targets;
}

/** Clamp coupled longitudinal/lateral forces to an anisotropic traction ellipse. */
export function traction(
  long: number,
  lat: number,
  normal: number,
  muLong: number,
  muLat: number,
) {
  if (normal <= 1e-8) return { long: 0, lat: 0 };
  const ratio = Math.hypot(long / (muLong * normal), lat / (muLat * normal));
  return { long: long / Math.max(1, ratio), lat: lat / Math.max(1, ratio) };
}
