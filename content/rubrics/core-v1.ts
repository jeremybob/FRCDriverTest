import type { TestId } from "../../src/types";

export const RUBRIC_VERSION = "core-1.0.0-provisional";
export interface Anchor {
  metric: string;
  label: string;
  unit: string;
  good: number;
  weak: number;
  weight: number;
}
const a = (
  metric: string,
  label: string,
  unit: string,
  good: number,
  weak: number,
  weight: number,
): Anchor => ({ metric, label, unit, good, weak, weight });
/** Proposed criterion anchors, never cohort percentiles. Full precision until display. */
export const RUBRICS: Record<TestId, Anchor[]> = {
  T01: [
    a("centerError", "Center error", "m", 0.02, 0.12, 0.45),
    a("headingError", "Heading error", "deg", 1, 10, 0.25),
    a("time", "Time", "s", 20, 60, 0.3),
  ],
  T02: [
    a("wrongWayTime", "Wrong-way time", "s", 0, 2, 0.4),
    a("pathRms", "Path RMS", "m", 0.1, 0.8, 0.3),
    a("time", "Time", "s", 20, 60, 0.3),
  ],
  T03: [
    a("time", "Time", "s", 15, 45, 0.45),
    a("pathRms", "Path RMS", "m", 0.1, 0.8, 0.55),
  ],
  T04: [
    a("gateOffsetRms", "Gate offset RMS", "m", 0.01, 0.1, 0.5),
    a("headingError", "Heading error", "deg", 1, 10, 0.25),
    a("time", "Time", "s", 20, 60, 0.25),
  ],
  T05: [
    a("stopError", "Absolute stopping error", "m", 0.05, 0.75, 0.55),
    a("overshoot", "Overshoot", "m", 0, 0.5, 0.25),
    a("time", "Time", "s", 15, 45, 0.2),
  ],
  T06: [
    a("cueLatency", "Cue-to-input latency", "s", 0.3, 1.5, 0.4),
    a("wrongBranches", "Wrong branches", "count", 0, 3, 0.35),
    a("time", "Time", "s", 20, 60, 0.25),
  ],
};
