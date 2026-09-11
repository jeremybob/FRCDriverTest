import type { Attempt, Profile, Session, TestId } from "../types";
import { aggregate } from "../scoring";

export const TEST_LABELS: Record<TestId, string> = {
  T01: "Distance docking",
  T02: "Orientation control",
  T03: "Speed control",
  T04: "Precision maneuvering",
  T05: "Braking judgment",
  T06: "Cue and recovery",
};
export const METRIC_UNITS: Record<string, string> = {
  centerError: "m",
  headingError: "deg",
  time: "s",
  wrongWayTime: "s",
  pathRms: "m",
  gateOffsetRms: "m",
  stopError: "m",
  overshoot: "m",
  cueLatency: "s",
  wrongBranches: "count",
  minorContacts: "count",
  majorContacts: "count",
  boundaryDepartures: "count",
  peakSpeed: "m/s",
  routeLength: "m",
  farCenterError: "m",
  nearCenterError: "m",
  orientation180Delay: "s",
  stationaryStartTime: "s",
  oppositeLegDelay: "s",
  centerErrors: "m",
  headingErrors: "deg",
  middleCenterError: "m",
  nearHeadingError: "deg",
  middleHeadingError: "deg",
  farHeadingError: "deg",
  gateOffsets: "m",
  signedStopErrors: "m",
  entrySpeeds: "m/s",
  cueLatencies: "s",
  progress: "segments",
};
export interface ReportDriver {
  id: string;
  name: string;
  notes: string;
  assessment: ReturnType<typeof aggregate>;
  attempts: Attempt[];
  strengths: string[];
  invalidations: string[];
}
export interface ReportModel {
  schemaVersion: 1;
  sessionId: string;
  sessionLabel: string;
  createdAt: string;
  suite: Session["suite"];
  profile: Profile;
  drivers: ReportDriver[];
  disclaimer: string;
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}
/** A pure snapshot shared by screen preview, print and PDF; physics never runs here. */
export function buildReportModel(
  session: Session,
  driverIds?: string[],
): ReportModel {
  const selected = driverIds ? new Set(driverIds) : null;
  const drivers = session.drivers
    .filter((d) => !selected || selected.has(d.id))
    .map((driver) => {
      const attempts = session.results
        .filter((a) => a.driverId === driver.id)
        .map(({ replay: _, ...a }) => a);
      const assessment = aggregate(
        attempts,
        session.suite,
        session.profile.hash,
      );
      const strengths = assessment.skills
        .filter((s) => s.score !== null)
        .sort((a, b) => b.score! - a.score!)
        .slice(0, 2)
        .map((s) => `${s.name}: ${formatScore(s.score)} / 100`);
      return {
        ...driver,
        assessment,
        attempts,
        strengths,
        invalidations: attempts
          .filter((a) => a.status === "invalid")
          .map((a) => `${a.testId}, trial ${a.scheduledTrial}: ${a.cause}`),
      };
    });
  return freeze(
    structuredClone({
      schemaVersion: 1,
      sessionId: session.id,
      sessionLabel: session.label,
      createdAt: session.createdAt,
      suite: session.suite,
      profile: session.profile,
      drivers,
      disclaimer:
        "Development rubrics and uncalibrated robot presets: provisional criteria, not validated norms. This screen-based simulator is one part of a coach’s evaluation; it does not measure clinical depth perception or medical reaction time.",
    } satisfies ReportModel),
  );
}
export function formatScore(score: number | null): string {
  return score === null ? "Missing" : score.toFixed(1);
}
export function formatMetric(value: number | number[], unit = ""): string {
  return `${Array.isArray(value) ? value.map((v) => (Number.isInteger(v) ? String(v) : v.toFixed(4))).join(", ") : Number.isInteger(value) ? String(value) : value.toFixed(4)}${unit ? " " + unit : ""}`;
}
export function profileLines(p: Profile): string[] {
  return [
    `Profile ${p.id} / ${p.hash}; ${p.qualification || "Provisional: station and rubrics not yet qualified"}`,
    `Robot: ${p.robot.name} (${p.robot.id} ${p.robot.version}), ${p.robot.kind}; uncalibrated preset`,
    `Versions: physics ${p.physicsVersion}; course ${p.courseVersion}; rubric ${p.rubricVersion}; build ${p.buildId}`,
    `Control: ${p.inputClass}, ${p.controlFrame}-relative${p.input.tank ? ", tank" : ""}; bindings ${p.bindingHash}`,
    `Device: ${p.deviceDescription || "Not declared"}; transport ${p.input.transport || "Not declared"}; calibration ${p.input.calibrated ? "completed" : "not completed"}`,
    `Camera: ${p.camera}; graphics: ${p.graphicsTier}; render ${p.renderResolution.join(" x ")}; display ${p.display.width} x ${p.display.height} @ ${p.display.pixelRatio}x`,
    `Display context: ${p.display.description || "Not declared"}`,
    `Assistance: precision ${p.assistance.precision ? "on" : "off"}, brake ${p.assistance.brake ? "on" : "off"}, speed limit ${p.assistance.speedLimit}; difficulty ${p.difficulty}`,
    `Schedule: ${p.scheduleId}; seeds ${p.seedSet.join(", ")}; familiarization ${p.familiarizationSeconds} s`,
    `Accommodation: ${p.accommodation || "None declared"}`,
  ];
}
export function attemptLines(a: Attempt): string[] {
  return [
    `${a.testId} ${TEST_LABELS[a.testId]} | scheduled trial ${a.scheduledTrial} | ${a.status.toUpperCase()} | ${formatScore(a.score.score)} / 100`,
    `Attempt ${a.id}; started ${a.startedAt}; ${a.durationTicks} physics ticks; wall duration ${a.wallDuration.toFixed(3)} s`,
    ...(a.cause ? [`Outcome reason: ${a.cause}`] : []),
    `Score: base ${formatScore(a.score.base)} - penalty ${a.score.penalty.toFixed(1)} = ${formatScore(a.score.score)}; ${a.score.explanation}`,
    ...Object.entries(a.metrics).map(
      ([key, value]) => `${key}: ${formatMetric(value, METRIC_UNITS[key])}`,
    ),
    ...a.score.components.map(
      (c) =>
        `${c.label}: ${formatMetric(c.value, c.unit)}; anchors ${c.good}/${c.weak}; normalized ${c.normalized.toFixed(4)}; weight ${c.weight}; contribution ${c.contribution.toFixed(4)}`,
    ),
    `Performance: frame p95 ${a.performance.frameP95.toFixed(2)} ms; physics p95 ${a.performance.physicsP95.toFixed(2)} ms; max frame ${a.performance.maxFrame.toFixed(2)} ms; ${a.performance.frames} frames${a.performance.drawCalls !== undefined ? "; " + a.performance.drawCalls + " draw calls" : ""}${a.performance.triangles !== undefined ? "; " + a.performance.triangles + " triangles" : ""}${a.performance.heapMB !== undefined ? "; heap " + a.performance.heapMB.toFixed(2) + " MB" : ""}`,
    ...a.events.map(
      (e) =>
        `Event tick ${e.tick}: ${e.type}${e.source ? " [" + e.source + "]" : ""}${e.value !== undefined ? " value " + e.value : ""}${e.x !== undefined ? " x " + e.x : ""}${e.y !== undefined ? " y " + e.y : ""}${e.message ? " - " + e.message : ""}`,
    ),
    ...profileLines(a.profile),
  ];
}
