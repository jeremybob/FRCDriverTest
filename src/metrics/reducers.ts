import type {
  AttemptEvent,
  ContactSample,
  MetricValues,
  Pose,
  RobotPreset,
} from "../types";
import {
  corners,
  insidePolygon,
  pointSegmentDistance,
} from "../tests/geometry";
export class ContactEpisodes {
  private episodes = new Map<string, { speed: number; separation: number }>();
  minor = 0;
  major = 0;
  step(
    samples: ContactSample[],
    dt: number,
    tick: number,
    events: AttemptEvent[],
  ): void {
    const active = new Map(
      samples
        .filter((s) => s.active && !/floor|support/i.test(s.id))
        .map((s) => [s.id, s]),
    );
    for (const [id, s] of active) {
      let e = this.episodes.get(id);
      if (!e) {
        e = { speed: Math.max(0, s.speed), separation: 0 };
        this.episodes.set(id, e);
        if (e.speed >= 1) this.major++;
        else this.minor++;
        events.push({
          tick,
          type: "contact-start",
          source: id,
          value: e.speed,
          x: s.x,
          y: s.y,
        });
      } else {
        if (e.speed < 1 && s.speed >= 1) {
          this.minor--;
          this.major++;
          events.push({
            tick,
            type: "contact-major",
            source: id,
            value: s.speed,
            x: s.x,
            y: s.y,
          });
        }
        e.speed = Math.max(e.speed, s.speed);
        e.separation = 0;
      }
    }
    for (const [id, e] of this.episodes)
      if (!active.has(id)) {
        e.separation += dt;
        if (e.separation >= 0.3 - 1e-9) {
          events.push({
            tick,
            type: "contact-end",
            source: id,
            value: e.speed,
          });
          this.episodes.delete(id);
        }
      }
  }
}
export class BoundaryEpisodes {
  count = 0;
  private active = false;
  private insideTime = 0;
  step(
    pose: Pose,
    robot: RobotPreset,
    polygon: { x: number; y: number }[],
    dt: number,
    tick: number,
    events: AttemptEvent[],
    wallContact = false,
  ): void {
    const outside = corners(pose, robot).some(
      (p) => !insidePolygon(p, polygon),
    );
    if (outside) {
      this.insideTime = 0;
      if (!wallContact && !this.active) {
        this.count++;
        this.active = true;
        events.push({ tick, type: "corridor-departure", x: pose.x, y: pose.y });
      }
    } else if (!outside && this.active) {
      this.insideTime += dt;
      if (this.insideTime >= 0.3 - 1e-9) {
        this.active = false;
        events.push({ tick, type: "corridor-return" });
      }
    }
  }
}
/** Fixed traveled-distance samples do not let waiting dilute RMS. Route pair is selected by checkpoint progress. */
export class PathMetrics {
  length = 0;
  private remainder = 0;
  private sumSquares = 0;
  count = 0;
  step(
    a: Pose,
    b: Pose,
    routeA: Pose,
    routeB: Pose,
    stageRoute: Pose[] = [routeA, routeB],
  ): void {
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d < 1e-12) return;
    this.length += d;
    let next = 0.05 - this.remainder;
    while (next <= d + 1e-9) {
      const t = Math.min(1, next / d),
        p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
        e = Math.min(
          ...stageRoute
            .slice(1)
            .map((end, i) => pointSegmentDistance(p, stageRoute[i], end)),
        );
      this.sumSquares += e * e;
      this.count++;
      next += 0.05;
    }
    this.remainder = Math.max(0, d - (next - 0.05));
    if (this.remainder < 1e-9) this.remainder = 0;
  }
  get rms() {
    return this.count ? Math.sqrt(this.sumSquares / this.count) : null;
  }
}
export const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN;
export function setFinite(
  metrics: MetricValues,
  key: string,
  value: number,
): void {
  if (Number.isFinite(value)) metrics[key] = value;
}
