import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import {
  buildReportModel,
  generatePdf,
  reportHtml,
  wrapText,
  PAGE_DIMENSIONS,
  formatScore,
} from "../src/reports";
import { createSession, profileHash } from "../src/session";
import { ROBOTS } from "../content/robots";
import { defaultInputSettings } from "../src/input";
import type { Profile, Attempt } from "../src/types";
import { scoreAttempt } from "../src/scoring";
function fixtureProfile(): Profile {
  const profile: Profile = {
    id: "standard-v1",
    hash: "fixture",
    robot: structuredClone(ROBOTS[0]),
    physicsVersion: "1.0",
    buildId: "1.0",
    courseVersion: "core-v1",
    rubricVersion: "rubric-v1",
    inputClass: "keyboard",
    controlFrame: "field",
    input: structuredClone(defaultInputSettings),
    bindingHash: "keys-1",
    assistance: { precision: true, brake: true, speedLimit: 1 },
    camera: "station",
    graphicsTier: "standard",
    renderResolution: [1280, 720],
    display: {
      width: 1280,
      height: 720,
      pixelRatio: 1,
      description: "Test display",
    },
    difficulty: "standard",
    seedSet: [1],
    scheduleId: "screening-v1",
    accommodation: "",
    deviceDescription: "Keyboard",
    qualification: "Provisional",
    familiarizationSeconds: 60,
  };
  profile.bindingHash = profileHash(profile.input);
  profile.hash = profileHash(profile);
  return profile;
}
function fixtureAttempt(profile = fixtureProfile()): Attempt {
  return {
    id: "attempt-1",
    driverId: "driver-1",
    testId: "T01",
    scheduledTrial: 1,
    status: "dnf",
    cause: "Timeout",
    startedAt: new Date().toISOString(),
    durationTicks: 7200,
    wallDuration: 60,
    metrics: {
      time: 60,
      minorContacts: 0,
      majorContacts: 0,
      boundaryDepartures: 0,
    },
    events: [],
    performance: { frameP95: 16, physicsP95: 1, maxFrame: 18, frames: 3600 },
    score: {
      score: 0,
      base: 0,
      penalty: 0,
      components: [],
      explanation: "DNF zero",
    },
    profile,
  };
}
function fixtureSession() {
  const s = createSession(fixtureProfile());
  s.drivers = [
    { id: "driver-1", name: "Zoë Παπαδοπούλου", notes: "Coach notes" },
  ];
  s.activeDriverId = "driver-1";
  return s;
}

const font = new Uint8Array(readFileSync("public/fonts/DejaVuSans.ttf"));
describe("shared report model and exports", () => {
  it("shows provisional missing evidence without inventing zeros or index", () => {
    const m = buildReportModel(fixtureSession());
    expect(m.drivers[0].assessment.skills.every((s) => s.score === null)).toBe(
      true,
    );
    expect(m.drivers[0].assessment.coreIndex).toBeNull();
    expect(reportHtml(m)).toContain("INCOMPLETE");
    expect(reportHtml(m)).not.toContain("Core index:");
  });
  it("uses frozen results for HTML, metric units, outcome reasons and exact worked example", () => {
    const s = fixtureSession();
    const metrics = {
      centerError: 0.07,
      headingError: 4,
      time: 36,
      minorContacts: 1,
      majorContacts: 0,
      boundaryDepartures: 0,
    };
    s.results = [
      {
        ...fixtureAttempt(s.profile),
        status: "completed",
        cause: "",
        metrics,
        score: scoreAttempt("T01", "completed", metrics),
      },
    ];
    const m = buildReportModel(s),
      h = reportHtml(m);
    expect(formatScore(m.drivers[0].assessment.skills[0].score)).toBe("53.2");
    expect(h).toContain("53.2");
    expect(h).toContain("0.0700 m");
    expect(h).toContain("penalty 4.0");
    s.results[0].score.score = 99;
    expect(m.drivers[0].attempts[0].score.score).toBeCloseTo(53.1666667);
    expect(Object.isFrozen(m.drivers[0].attempts[0])).toBe(true);
  });
  it("escapes user text and retains Unicode in HTML", () => {
    const s = fixtureSession();
    s.drivers[0].notes = '<script>alert("test")</script> Àlvaro Δ';
    const html = reportHtml(buildReportModel(s));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Àlvaro Δ");
  });
  it("wraps long unbroken text without lost characters", () => {
    const text = "ZoëΔ".repeat(500);
    const lines = wrapText(text, 30, (s) => s.length);
    expect(lines.every((s) => s.length <= 30)).toBe(true);
    expect(lines.join("")).toBe(text);
  });
  it("generates locally embedded Letter and A4 PDFs with batch summary and long-note pagination", async () => {
    const s = fixtureSession();
    s.drivers[0].name = "Zoë Παπαδοπούλου ".repeat(12);
    s.drivers[0].notes = "Long Unicode coach notes: Élodie Ω. ".repeat(270);
    s.drivers.push({
      id: "driver-2",
      name: "Second driver",
      notes: "Another summary page.",
    });
    const metrics = {
      centerError: 0.07,
      headingError: 4,
      time: 36,
      minorContacts: 1,
      majorContacts: 0,
      boundaryDepartures: 0,
    };
    s.results = [
      {
        ...fixtureAttempt(s.profile),
        status: "completed",
        metrics,
        score: scoreAttempt("T01", "completed", metrics),
      },
    ];
    const m = buildReportModel(s);
    for (const size of ["letter", "a4"] as const) {
      const bytes = await generatePdf(m, size, font);
      const pdf = await PDFDocument.load(bytes);
      expect(pdf.getPageCount()).toBeGreaterThanOrEqual(5);
      expect(pdf.getPage(0).getSize().width).toBeCloseTo(
        PAGE_DIMENSIONS[size][0],
      );
      expect(bytes.length).toBeGreaterThan(15000);
      if (process.env.REPORT_QA) {
        mkdirSync("tmp/pdfs", { recursive: true });
        writeFileSync(`tmp/pdfs/report-${size}.pdf`, bytes);
      }
    }
  }, 30000);
});
