import type {
  Attempt,
  AttemptStatus,
  MetricValues,
  ScoreBreakdown,
  Suite,
  TestId,
} from "../types";
import { RUBRICS } from "../../content/rubrics/core-v1";
import { TEST_CATALOG } from "../tests/courses";
export { RUBRIC_VERSION, RUBRICS } from "../../content/rubrics/core-v1";
export const clamp = (x: number, min = 0, max = 100) =>
  Math.max(min, Math.min(max, x));
export const median = (values: number[]) => {
  const a = [...values].sort((a, b) => a - b);
  return a.length
    ? (a[Math.floor((a.length - 1) / 2)] + a[Math.ceil((a.length - 1) / 2)]) / 2
    : NaN;
};
export function normalize(x: number, good: number, weak: number): number {
  if (![x, good, weak].every(Number.isFinite) || weak <= good)
    throw new Error("Invalid metric or anchors");
  return clamp((100 * (weak - x)) / (weak - good));
}
export function scoreAttempt(
  testId: TestId,
  status: AttemptStatus,
  metrics: MetricValues,
): ScoreBreakdown {
  if (status === "invalid" || status === "practice")
    return {
      score: null,
      base: null,
      penalty: 0,
      components: [],
      explanation:
        status === "invalid"
          ? "Technical invalidation; excluded, replacement permitted."
          : "Practice feedback only; excluded from assessment.",
    };
  if (status === "dnf")
    return {
      score: 0,
      base: 0,
      penalty: 0,
      components: [],
      explanation:
        "DNF: zero counts as a scored outcome; no partial-completion bonus.",
    };
  const anchors = RUBRICS[testId];
  if (!anchors) throw new Error("Unknown test");
  const missing = anchors.filter(
    (a) =>
      typeof metrics[a.metric] !== "number" ||
      !Number.isFinite(metrics[a.metric]) ||
      Number(metrics[a.metric]) < 0,
  );
  const contactKeys = ["minorContacts", "majorContacts", "boundaryDepartures"];
  if (
    missing.length ||
    contactKeys.some(
      (k) =>
        typeof metrics[k] !== "number" ||
        !Number.isFinite(metrics[k]) ||
        Number(metrics[k]) < 0,
    )
  )
    return {
      score: null,
      base: null,
      penalty: 0,
      components: [],
      explanation:
        "Incomplete or invalid raw metrics; a score cannot be calculated.",
    };
  const components = anchors.map((a) => {
    const value = Number(metrics[a.metric]),
      normalized = normalize(value, a.good, a.weak);
    return { ...a, value, normalized, contribution: a.weight * normalized };
  });
  const base = components.reduce((s, c) => s + c.contribution, 0),
    penalty = Math.min(
      40,
      4 * Number(metrics.minorContacts) +
        12 * Number(metrics.majorContacts) +
        8 * Number(metrics.boundaryDepartures),
    );
  return {
    score: clamp(base - penalty),
    base,
    penalty,
    components,
    explanation:
      "Provisional criterion score: weighted normalized metrics minus contact and corridor penalties.",
  };
}
export interface SkillResult {
  testId: TestId;
  name: string;
  score: number | null;
  trials: number[];
  min: number | null;
  max: number | null;
  completed: number;
  contacts: number;
  eligible: boolean;
}
export interface AggregateResult {
  skills: SkillResult[];
  eligible: boolean;
  coreIndex: number | null;
  consistency: number | null;
  preliminary: boolean;
  recommendations: string[];
  reason: string;
  excluded: number;
}
const drills: Record<TestId, string> = {
  T01: "Repeat near, middle, and far docking at limited speed; compare final center and heading errors.",
  T02: "Practice robot-relative return shuttles, especially starting at 180 degrees; release and re-plan after wrong-way motion.",
  T03: "Repeat the slalom at a steady lower speed, keeping the entire bumper inside each opening before increasing pace.",
  T04: "Practice straight, offset, and angled gates slowly; align the bumper before entering each opening.",
  T05: "Repeat stopping from the same published entry-speed band and choose a consistent braking landmark.",
  T06: "Repeat cue-and-recover at lower practice speed; wait for the visible cue, then make one deliberate branch command.",
};
export function recommendations(skills: SkillResult[]): string[] {
  const priorities = [...skills]
    .filter((s) => s.score !== null)
    .sort((a, b) => a.score! - b.score!)
    .slice(0, 2)
    .map((s) => drills[s.testId]);
  for (const s of skills.filter((s) => s.score === null)) {
    if (priorities.length >= 2) break;
    priorities.push(`${s.name} — not yet assessed: ${drills[s.testId]}`);
  }
  return priorities;
}
export function aggregate(
  attempts: Attempt[],
  suite: Suite,
  profileHash?: string,
): AggregateResult {
  const hash =
    profileHash ??
    attempts.find((a) => a.status === "completed" || a.status === "dnf")
      ?.profile.hash;
  const compatible = attempts.filter(
      (a) =>
        (a.status === "completed" || a.status === "dnf") &&
        a.profile.hash === hash,
    ),
    required = suite === "full" ? 3 : 1;
  const skills = TEST_CATALOG.map((test) => {
    // Slot order, never best-of: a later replacement is only for an invalid attempt.
    const slots = new Map<number, Attempt>();
    for (const a of compatible
      .filter((a) => a.testId === test.id)
      .sort((a, b) => a.scheduledTrial - b.scheduledTrial))
      if (
        a.scheduledTrial >= 1 &&
        a.scheduledTrial <= required &&
        !slots.has(a.scheduledTrial)
      )
        slots.set(a.scheduledTrial, a);
    const rows = [...slots.values()],
      trials = rows
        .map((a) => (a.status === "dnf" ? 0 : a.score.score))
        .filter(
          (v): v is number =>
            typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100,
        ),
      eligible = trials.length === required;
    return {
      testId: test.id,
      name: test.name,
      score: eligible ? median(trials) : null,
      trials,
      min: trials.length ? Math.min(...trials) : null,
      max: trials.length ? Math.max(...trials) : null,
      completed: rows.filter((a) => a.status === "completed").length,
      contacts: rows.reduce(
        (s, a) =>
          s +
          Number(a.metrics.minorContacts || 0) +
          Number(a.metrics.majorContacts || 0),
        0,
      ),
      eligible,
    };
  });
  const eligible = skills.every((s) => s.eligible),
    full = eligible && suite === "full";
  return {
    skills,
    eligible,
    coreIndex: full ? skills.reduce((s, r) => s + r.score!, 0) / 6 : null,
    consistency: full
      ? clamp(100 - (2 * skills.reduce((s, r) => s + r.max! - r.min!, 0)) / 6)
      : null,
    preliminary: suite === "screening",
    recommendations: recommendations(skills),
    excluded: attempts.length - compatible.length,
    reason: eligible
      ? suite === "full"
        ? "Complete matched-profile full assessment."
        : "Preliminary screening; Core index and repeatability omitted."
      : `Incomplete: ${required} scored outcome${required === 1 ? "" : "s"} per test required in one matching profile.`,
  };
}
