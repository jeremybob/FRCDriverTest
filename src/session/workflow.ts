import type { Attempt, Profile, Session, Suite, TestId } from "../types";
import { profileHash } from "./index";

export const SCHEDULE_ID = "balanced-v1";
export const ASSESSMENT_SCHEDULE: readonly (readonly TestId[])[] = [
  ["T01", "T02", "T03", "T04", "T05", "T06"],
  ["T03", "T04", "T05", "T06", "T01", "T02"],
  ["T05", "T06", "T01", "T02", "T03", "T04"],
];
export interface ScheduledSlot {
  testId: TestId;
  trial: number;
}
export function scheduledSlots(suite: Suite): ScheduledSlot[] {
  return ASSESSMENT_SCHEDULE.slice(0, suite === "full" ? 3 : 1).flatMap(
    (order, i) => order.map((testId) => ({ testId, trial: i + 1 })),
  );
}
const matching = (s: Session, driverId: string) =>
  s.results.filter(
    (a) => a.driverId === driverId && a.profile.hash === s.profile.hash,
  );
const isScored = (a: Attempt) => a.status === "completed" || a.status === "dnf";
export function nextScheduledSlot(
  s: Session,
  driverId = s.activeDriverId,
): ScheduledSlot | null {
  return (
    scheduledSlots(s.suite).find(
      (slot) =>
        !matching(s, driverId).some(
          (a) =>
            isScored(a) &&
            a.testId === slot.testId &&
            a.scheduledTrial === slot.trial,
        ),
    ) ?? null
  );
}
export function scoredSlotCount(
  s: Session,
  driverId = s.activeDriverId,
): number {
  return scheduledSlots(s.suite).filter((slot) =>
    matching(s, driverId).some(
      (a) =>
        isScored(a) &&
        a.testId === slot.testId &&
        a.scheduledTrial === slot.trial,
    ),
  ).length;
}
export function replacementState(
  s: Session,
  driverId = s.activeDriverId,
): { blocked: boolean; reason: string; invalidCounts: Record<string, number> } {
  const invalidCounts: Record<string, number> = {};
  for (const a of matching(s, driverId).filter((a) => a.status === "invalid")) {
    const key = `${a.testId}:${a.scheduledTrial}`;
    invalidCounts[key] = (invalidCounts[key] ?? 0) + 1;
  }
  const failed = Object.entries(invalidCounts).find(([, count]) => count >= 2);
  return {
    blocked: !!failed,
    reason: failed
      ? `${failed[0]} has repeated technical invalidations. Resolve the station issue and begin a new comparison session.`
      : "",
    invalidCounts,
  };
}
/** Practice knowledge transfers across final display metadata capture, but not changed robot/input/physics/assistance. */
export function practiceProfileKey(p: Profile): string {
  return profileHash({
    robot: p.robot,
    physicsVersion: p.physicsVersion,
    courseVersion: p.courseVersion,
    inputClass: p.inputClass,
    controlFrame: p.controlFrame,
    input: p.input,
    assistance: p.assistance,
    difficulty: p.difficulty,
    seedSet: p.seedSet,
  });
}
export function exposureKey(
  driverId: string,
  p: Profile,
  kind: "free" | TestId,
): string {
  return `${driverId}:${practiceProfileKey(p)}:${kind}`;
}
export function hasExposureOverride(p: Profile): boolean {
  return /^exposure override:\s*\S/i.test(p.accommodation);
}
export function practiceEvidence(
  s: Session,
  testId: TestId,
  driverId = s.activeDriverId,
): { count: number; ready: boolean; reason: string } {
  const key = practiceProfileKey(s.profile);
  const attempts = s.results.filter(
    (a) =>
      a.driverId === driverId &&
      a.testId === testId &&
      a.status === "practice" &&
      a.durationTicks > 0 &&
      practiceProfileKey(a.profile) === key,
  );
  const full = attempts.filter(
    (a) =>
      a.practiceCompleted ||
      a.durationTicks >= (testId === "T03" || testId === "T05" ? 45 : 60) * 120,
  );
  const count = attempts.length,
    ready = count === 1 && full.length === 1;
  return {
    count,
    ready,
    reason: ready
      ? "One matched unscored exposure recorded."
      : count > 1
        ? "Additional practice exposure requires a named exposure-override comparison profile."
        : count === 1
          ? "Finish the practice course or its full time limit before assessment."
          : "Complete one matched unscored practice exposure for this test first.",
  };
}
export interface Readiness {
  allowed: boolean;
  reason: string;
  freeSeconds: number;
  practiceCount: number;
  practiceReady: boolean;
  override: boolean;
}
export function assessmentReadiness(
  s: Session,
  slot: ScheduledSlot,
  driverId = s.activeDriverId,
  now = Date.now(),
): Readiness {
  const evidence = practiceEvidence(s, slot.testId, driverId),
    override = hasExposureOverride(s.profile),
    raw = s.practiceExposure[exposureKey(driverId, s.profile, "free")],
    freeSeconds = Number.isFinite(raw) && raw >= 0 ? raw : 0;
  const result = (reason: string): Readiness => ({
    allowed: !reason,
    reason,
    freeSeconds,
    practiceCount: evidence.count,
    practiceReady: evidence.ready,
    override,
  });
  if (!s.drivers.some((d) => d.id === driverId))
    return result("Add or select a driver first.");
  if (
    !Number.isFinite(Date.parse(s.expiresAt)) ||
    now >= Date.parse(s.expiresAt)
  )
    return result("Session expired. Export results and begin a new session.");
  if (s.profile.scheduleId !== SCHEDULE_ID)
    return result(
      "Unknown assessment schedule. Use the published balanced-v1 protocol.",
    );
  if (s.profile.seedSet.length < (s.suite === "full" ? 3 : 1))
    return result(
      "The comparison profile is missing published seeds for its scheduled trials.",
    );
  if (s.activeAttempt)
    return result(
      "An attempt is already active; finish or invalidate it before starting another.",
    );
  const replacement = replacementState(s, driverId);
  if (replacement.blocked) return result(replacement.reason);
  const next = nextScheduledSlot(s, driverId);
  if (!next) return result("This driver has completed the scheduled suite.");
  if (next.testId !== slot.testId || next.trial !== slot.trial)
    return result(
      `Follow the published schedule: ${next.testId}, trial ${next.trial} is next.`,
    );
  if (s.profile.input.device === "gamepad" && !s.profile.input.calibrated)
    return result("Calibrate the selected controller before assessment.");
  if (!override && freeSeconds < 180)
    return result(
      "Complete three minutes of free drive under the current robot and input settings.",
    );
  if (!override && !evidence.ready) return result(evidence.reason);
  return result("");
}
export function profileLockReason(
  expected: Profile,
  candidate: Profile,
  locked: boolean,
): string | null {
  return locked && candidate.hash !== expected.hash
    ? "The station no longer matches the locked comparison profile. Restore the recorded display, device, and settings, or begin a new session."
    : null;
}
