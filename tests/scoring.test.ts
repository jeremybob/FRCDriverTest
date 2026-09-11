import { describe, it, expect } from "vitest";
import { aggregate, normalize, scoreAttempt } from "../src/scoring";
import { TEST_CATALOG } from "../src/tests/courses";
import type { Attempt, MetricValues, TestId } from "../src/types";
const contacts = { minorContacts: 0, majorContacts: 0, boundaryDepartures: 0 };
function row(
  testId: TestId,
  scheduledTrial: number,
  score: number,
  status: Attempt["status"] = "completed",
  hash = "matched",
): Attempt {
  return {
    testId,
    scheduledTrial,
    status,
    profile: { hash },
    metrics: contacts,
    score: { score },
  } as unknown as Attempt;
}
describe("versioned scoring", () => {
  it("reproduces the worked example without intermediate rounding", () => {
    const s = scoreAttempt("T01", "completed", {
      ...contacts,
      centerError: 0.07,
      headingError: 4,
      time: 36,
      minorContacts: 1,
    });
    expect(s.score).toBeCloseTo(53.1666666667);
    expect(s.penalty).toBe(4);
    expect(s.components).toHaveLength(3);
  });
  it("clamps anchors and penalty; never awards missing metrics", () => {
    expect(normalize(-1, 0, 2)).toBe(100);
    expect(normalize(4, 0, 2)).toBe(0);
    expect(() => normalize(NaN, 0, 2)).toThrow();
    expect(
      scoreAttempt("T01", "completed", {
        ...contacts,
        centerError: 0.02,
        headingError: 1,
        time: 20,
        majorContacts: 8,
      }).score,
    ).toBe(60);
    expect(scoreAttempt("T01", "completed", contacts).score).toBeNull();
  });
  it("DNF counts as zero while invalid and practice have no score", () => {
    expect(scoreAttempt("T01", "dnf", {}).score).toBe(0);
    expect(scoreAttempt("T01", "invalid", {}).score).toBeNull();
    expect(scoreAttempt("T01", "practice", {}).score).toBeNull();
  });
  it("every rubric produces a reproducible full-precision component sum", () => {
    const metrics: MetricValues = {
      ...contacts,
      centerError: 0.07,
      headingError: 4,
      time: 36,
      wrongWayTime: 0.5,
      pathRms: 0.3,
      gateOffsetRms: 0.05,
      stopError: 0.2,
      overshoot: 0.1,
      cueLatency: 0.7,
      wrongBranches: 1,
    };
    for (const t of TEST_CATALOG) {
      const s = scoreAttempt(t.id, "completed", metrics);
      expect(s.score).toBeCloseTo(
        s.components.reduce((v, c) => v + c.contribution, 0),
      );
    }
  });
  it("requires three outcomes in all six skills and separates repeatability", () => {
    const rows = TEST_CATALOG.flatMap((t) => [
        row(t.id, 1, 20),
        row(t.id, 2, 40),
        row(t.id, 3, 60),
      ]),
      a = aggregate(rows, "full");
    expect(a.eligible).toBe(true);
    expect(a.coreIndex).toBe(40);
    expect(a.consistency).toBe(20);
    expect(aggregate(rows.slice(1), "full").coreIndex).toBeNull();
    expect(
      aggregate(
        rows.map((r) => ({ ...r, score: { ...r.score, score: 0 } })),
        "full",
      ).consistency,
    ).toBe(100);
  });
  it("screens provisionally, excludes mismatches and does not choose best attempts", () => {
    const rows = TEST_CATALOG.map((t) => row(t.id, 1, 60));
    rows.push(
      row("T01", 1, 100),
      row("T02", 2, 100, "practice"),
      row("T03", 2, 100, "invalid"),
      row("T04", 1, 100, "completed", "other"),
    );
    const a = aggregate(rows, "screening", "matched");
    expect(a.skills[0].score).toBe(60);
    expect(a.coreIndex).toBeNull();
    expect(a.consistency).toBeNull();
    expect(a.preliminary).toBe(true);
    expect(a.excluded).toBe(3);
  });
  it("permits a technical replacement but retains DNF and frozen rubric values", () => {
    const a = aggregate(
      [
        row("T01", 1, 100, "invalid"),
        row("T01", 1, 40),
        row("T01", 2, 100, "dnf"),
        row("T01", 3, 60),
      ],
      "full",
    );
    expect(a.skills[0].trials).toEqual([40, 0, 60]);
    expect(a.skills[0].score).toBe(40);
  });
});
