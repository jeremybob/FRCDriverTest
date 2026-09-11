import { describe, expect, it } from "vitest";
import { evaluateBenchmark, selectHighestTier } from "../src/app/Benchmark";
import type { BenchmarkMetrics } from "../src/app/Benchmark";
const metrics = (patch: Partial<BenchmarkMetrics> = {}): BenchmarkMetrics => ({
  tier: "standard",
  frames: Array(180).fill(16.67),
  physics: Array(180).fill(1),
  cpu: Array(180).fill(5),
  drawCalls: 150,
  triangles: 250000,
  resolution: [1280, 720],
  viewport: [1440, 900],
  ...patch,
});
describe("graphics preflight selection", () => {
  it("selects the highest passing measured tier regardless of array order", () => {
    expect(
      selectHighestTier([
        metrics({ tier: "performance" }),
        metrics({ tier: "high" }),
        metrics(),
      ]),
    ).toBe("high");
  });
  it("requires complete sampling and rejects slow frames, physics and lost headroom independently", () => {
    expect(evaluateBenchmark(metrics()).passed).toBe(true);
    expect(
      evaluateBenchmark(metrics({ frames: Array(179).fill(16) })).passed,
    ).toBe(false);
    expect(
      evaluateBenchmark(metrics({ frames: Array(180).fill(21) })).failures.join(
        " ",
      ),
    ).toContain("Frame interval");
    expect(
      evaluateBenchmark(
        metrics({ physics: Array(180).fill(4.1) }),
      ).failures.join(" "),
    ).toContain("Two-tick");
    expect(
      evaluateBenchmark(metrics({ cpu: Array(180).fill(13.4) })).failures.join(
        " ",
      ),
    ).toContain("headroom");
  });
  it("rejects a 250ms stall even when p95 passes and requires a supported desktop window", () => {
    expect(
      evaluateBenchmark(metrics({ frames: [...Array(179).fill(16), 251] }))
        .passed,
    ).toBe(false);
    expect(
      evaluateBenchmark(metrics({ viewport: [1024, 768] })).failures.join(" "),
    ).toContain("1280 × 720");
  });
  it("does not promote tuning guides into performance qualification and fails closed on invalid data", () => {
    expect(evaluateBenchmark(metrics({ drawCalls: 210 })).passed).toBe(true);
    expect(
      evaluateBenchmark(metrics({ physics: [...Array(179).fill(1), NaN] }))
        .passed,
    ).toBe(false);
    expect(
      selectHighestTier([
        metrics({ tier: "high", cpu: Array(180).fill(20) }),
        metrics({ tier: "standard", frames: Array(180).fill(22) }),
      ]),
    ).toBeNull();
  });
});
