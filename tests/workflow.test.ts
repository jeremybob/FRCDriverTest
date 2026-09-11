import { describe, it, expect } from "vitest";
import type { Attempt, Session, Profile, TestId } from "../src/types";
import { ROBOTS } from "../content/robots";
import { defaultInputSettings } from "../src/input";
import { profileHash } from "../src/session";
import {
  assessmentReadiness,
  exposureKey,
  hasExposureOverride,
  nextScheduledSlot,
  practiceEvidence,
  practiceProfileKey,
  profileLockReason,
  replacementState,
  scheduledSlots,
  scoredSlotCount,
} from "../src/session/workflow";
const profile = (): Profile => {
  const p = {
    id: "p",
    hash: "",
    robot: ROBOTS[0],
    physicsVersion: "v1",
    buildId: "build",
    courseVersion: "v1",
    rubricVersion: "v1",
    inputClass: "keyboard",
    controlFrame: "field",
    input: structuredClone(defaultInputSettings),
    bindingHash: "bindings",
    assistance: { precision: true, brake: true, speedLimit: 1 },
    camera: "station",
    graphicsTier: "standard",
    renderResolution: [1280, 720],
    display: {
      width: 1280,
      height: 720,
      pixelRatio: 1,
      description: "fixture",
    },
    difficulty: "core",
    seedSet: [101, 202, 303],
    scheduleId: "balanced-v1",
    accommodation: "None",
    deviceDescription: "keyboard",
    qualification: "Provisional",
    familiarizationSeconds: 180,
  } as Profile;
  p.hash = profileHash(p);
  return p;
};
function session(): Session {
  return {
    schemaVersion: 1,
    id: "s",
    createdAt: "2026-09-11T00:00:00.000Z",
    expiresAt: "2099-09-11T08:00:00.000Z",
    label: "Fixture",
    drivers: [
      { id: "a", name: "A", notes: "" },
      { id: "b", name: "B", notes: "" },
    ],
    activeDriverId: "a",
    profile: profile(),
    results: [],
    suite: "full",
    practiceExposure: {},
  };
}
function attempt(
  s: Session,
  testId: TestId,
  status: Attempt["status"],
  trial = 1,
  values: Partial<Attempt> = {},
): Attempt {
  return {
    id: crypto.randomUUID(),
    driverId: "a",
    testId,
    scheduledTrial: trial,
    status,
    cause: "fixture",
    startedAt: s.createdAt,
    durationTicks: 120,
    wallDuration: 1,
    metrics: {},
    events: [],
    performance: { frameP95: 16, physicsP95: 1, maxFrame: 17, frames: 60 },
    score: {
      score: status === "dnf" ? 0 : status === "completed" ? 50 : null,
      base: null,
      penalty: 0,
      components: [],
      explanation: "",
    },
    profile: structuredClone(s.profile),
    ...values,
  };
}
function readySession() {
  const s = session();
  s.practiceExposure[exposureKey("a", s.profile, "free")] = 180;
  s.results.push(attempt(s, "T01", "practice", 1, { practiceCompleted: true }));
  return s;
}
describe("assessment workflow protocol", () => {
  it("publishes 6 screening / 18 full slots with three rotated six-test rounds", () => {
    expect(scheduledSlots("screening")).toHaveLength(6);
    const full = scheduledSlots("full");
    expect(full).toHaveLength(18);
    expect(full[6]).toEqual({ testId: "T03", trial: 2 });
    expect(full[12]).toEqual({ testId: "T05", trial: 3 });
    for (let trial = 1; trial <= 3; trial++)
      expect(
        new Set(full.filter((s) => s.trial === trial).map((s) => s.testId))
          .size,
      ).toBe(6);
  });
  it("retains DNF, ignores technical attempts and schedules only unoccupied slots", () => {
    const s = session();
    s.results.push(attempt(s, "T01", "invalid"));
    expect(nextScheduledSlot(s)).toEqual({ testId: "T01", trial: 1 });
    s.results.push(attempt(s, "T01", "dnf"));
    expect(nextScheduledSlot(s)).toEqual({ testId: "T02", trial: 1 });
    s.results.push(attempt(s, "T01", "completed"));
    expect(scoredSlotCount(s)).toBe(1);
  });
  it("scopes schedule and repeated technical failures to driver and locked profile", () => {
    const s = session();
    s.results.push(
      attempt(s, "T01", "invalid"),
      attempt(s, "T01", "invalid", 1, { driverId: "b" }),
    );
    expect(replacementState(s).blocked).toBe(false);
    s.results.push(
      attempt(s, "T01", "invalid", 1, {
        profile: { ...s.profile, hash: "other" },
      }),
    );
    expect(replacementState(s).blocked).toBe(false);
    s.results.push(attempt(s, "T01", "invalid"));
    expect(replacementState(s).blocked).toBe(true);
    expect(assessmentReadiness(s, { testId: "T01", trial: 1 }).allowed).toBe(
      false,
    );
  });
  it("checks actual familiarization, one complete practice, and ordered slot at action boundary", () => {
    const s = readySession();
    expect(assessmentReadiness(s, { testId: "T01", trial: 1 }).allowed).toBe(
      true,
    );
    expect(
      assessmentReadiness(s, { testId: "T02", trial: 1 }).reason,
    ).toContain("schedule");
    s.practiceExposure[exposureKey("a", s.profile, "free")] = 179.9;
    expect(assessmentReadiness(s, { testId: "T01", trial: 1 }).allowed).toBe(
      false,
    );
  });
  it("does not credit a click-through abort or extra practice as equal protocol exposure", () => {
    const s = session();
    s.results.push(attempt(s, "T01", "practice"));
    expect(practiceEvidence(s, "T01").ready).toBe(false);
    s.results[0].practiceCompleted = true;
    expect(practiceEvidence(s, "T01").ready).toBe(true);
    s.results.push(
      attempt(s, "T01", "practice", 1, { practiceCompleted: true }),
    );
    expect(practiceEvidence(s, "T01").ready).toBe(false);
    expect(practiceEvidence(s, "T01").reason).toContain("Additional practice");
  });
  it("credits a full-time-limit practice attempt even if the course is not completed", () => {
    const s = session();
    s.results.push(
      attempt(s, "T03", "practice", 1, { durationTicks: 45 * 120 }),
    );
    expect(practiceEvidence(s, "T03").ready).toBe(true);
  });
  it("keeps exposure across display capture but isolates changed robot/control/assistance", () => {
    const s = readySession(),
      key = practiceProfileKey(s.profile);
    s.profile.renderResolution = [1920, 1080];
    s.profile.familiarizationSeconds = 181;
    expect(practiceProfileKey(s.profile)).toBe(key);
    s.profile.robot = ROBOTS[1];
    expect(practiceProfileKey(s.profile)).not.toBe(key);
    expect(practiceEvidence(s, "T01").count).toBe(0);
    expect(
      assessmentReadiness(s, { testId: "T01", trial: 1 }).freeSeconds,
    ).toBe(0);
  });
  it("accepts a named override only for exposure, never for schedule or repeated invalidations", () => {
    const s = session();
    s.profile.accommodation =
      "Exposure override: coach-directed extra practice";
    expect(hasExposureOverride(s.profile)).toBe(true);
    expect(assessmentReadiness(s, { testId: "T01", trial: 1 }).allowed).toBe(
      true,
    );
    expect(assessmentReadiness(s, { testId: "T02", trial: 1 }).allowed).toBe(
      false,
    );
    s.profile.accommodation = "Exposure override:";
    expect(hasExposureOverride(s.profile)).toBe(false);
  });
  it("blocks changed locked profiles and expired or already active sessions", () => {
    const s = readySession();
    expect(
      profileLockReason(s.profile, { ...s.profile, hash: "changed" }, true),
    ).toContain("locked");
    expect(
      profileLockReason(s.profile, { ...s.profile, hash: "changed" }, false),
    ).toBeNull();
    expect(
      assessmentReadiness(
        s,
        { testId: "T01", trial: 1 },
        "a",
        Date.parse(s.expiresAt),
      ).allowed,
    ).toBe(false);
    s.activeAttempt = {
      driverId: "a",
      testId: "T01",
      scheduledTrial: 1,
      startedAt: s.createdAt,
      profile: s.profile,
    };
    expect(
      assessmentReadiness(s, { testId: "T01", trial: 1 }).reason,
    ).toContain("already active");
  });
  it("rejects an imported full profile with missing trial seeds instead of silent fallback", () => {
    const s = readySession();
    s.profile.seedSet = [101];
    expect(
      assessmentReadiness(s, { testId: "T01", trial: 1 }).reason,
    ).toContain("missing published seeds");
  });
});
