import type { Gate, Pose, RobotPreset, Target } from "../types";
export interface Point {
  x: number;
  y: number;
}
export const angleError = (a: number, b: number) =>
  (Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) * 180) / Math.PI;
export function corners(
  p: Pose,
  robot: Pick<RobotPreset, "length" | "width">,
): Point[] {
  return [-1, 1].flatMap((x) =>
    [-1, 1].map((y) => ({
      x:
        p.x +
        (Math.cos(p.yaw) * x * robot.length) / 2 -
        (Math.sin(p.yaw) * y * robot.width) / 2,
      y:
        p.y +
        (Math.sin(p.yaw) * x * robot.length) / 2 +
        (Math.cos(p.yaw) * y * robot.width) / 2,
    })),
  );
}
export function local(p: Point, origin: Pose): Point {
  const x = p.x - origin.x,
    y = p.y - origin.y;
  return {
    x: x * Math.cos(origin.yaw) + y * Math.sin(origin.yaw),
    y: -x * Math.sin(origin.yaw) + y * Math.cos(origin.yaw),
  };
}
export function insidePolygon(p: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (
      Math.abs((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) < 1e-8 &&
      p.x >= Math.min(a.x, b.x) - 1e-8 &&
      p.x <= Math.max(a.x, b.x) + 1e-8 &&
      p.y >= Math.min(a.y, b.y) - 1e-8 &&
      p.y <= Math.max(a.y, b.y) + 1e-8
    )
      return true;
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}
export function contained(p: Pose, robot: RobotPreset, t: Target): boolean {
  return corners(p, robot).every((c) => {
    const q = local(c, t);
    return (
      Math.abs(q.x) <= t.length / 2 + 1e-8 &&
      Math.abs(q.y) <= t.width / 2 + 1e-8
    );
  });
}
export function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    den = dx * dx + dy * dy,
    t = den
      ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / den))
      : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
/** Each bumper corner must cross the plane forward inside the opening; misses latch until a full retreat. */
export class GateTracker {
  private crossed = new Set<number>();
  private missed = false;
  reset() {
    this.crossed.clear();
    this.missed = false;
  }
  step(
    previous: Pose,
    current: Pose,
    robot: RobotPreset,
    gate: Gate,
  ): { passed: boolean; offset: number; fraction: number } {
    const a = corners(previous, robot).map((p) => local(p, gate)),
      b = corners(current, robot).map((p) => local(p, gate));
    if (b.every((p) => p.x < 0)) {
      this.reset();
      return { passed: false, offset: 0, fraction: 0 };
    }
    for (let i = 0; i < 4; i++) {
      if (a[i].x <= 0 && b[i].x > 0) {
        const t = -a[i].x / (b[i].x - a[i].x),
          y = a[i].y + (b[i].y - a[i].y) * t;
        if (Math.abs(y) > gate.width / 2 + 1e-8) this.missed = true;
        this.crossed.add(i);
      } else if (a[i].x > 0 && b[i].x <= 0) this.crossed.delete(i);
    }
    const p = local(previous, gate),
      q = local(current, gate),
      fraction = q.x === p.x ? 1 : Math.max(0, Math.min(1, -p.x / (q.x - p.x)));
    return {
      passed:
        !this.missed && this.crossed.size === 4 && b.every((p) => p.x > 0),
      offset: p.y + (q.y - p.y) * fraction,
      fraction,
    };
  }
}
