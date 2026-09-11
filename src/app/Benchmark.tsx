import { useEffect, useRef, useState } from "react";
import type { Command, GraphicsTier, Profile } from "../types";
import { PhysicsWorld } from "../sim/world";
import { Venue } from "../render/venue";
import { createCourse } from "../tests/courses";
import { clamp, wrapAngle } from "../sim/coordinates";

export interface BenchmarkMetrics {
  tier: GraphicsTier;
  frames: number[];
  physics: number[];
  cpu: number[];
  drawCalls: number;
  triangles: number;
  resolution: [number, number];
  viewport: [number, number];
}
export interface BenchmarkEvaluation {
  passed: boolean;
  failures: string[];
  frameP95: number;
  physicsP95: number;
  cpuP95: number;
  maxFrame: number;
}
export const BENCHMARK_TIERS: GraphicsTier[] = [
  "high",
  "standard",
  "performance",
];
const p95 = (values: number[]) =>
  values.length
    ? [...values].sort((a, b) => a - b)[
        Math.min(values.length - 1, Math.ceil(values.length * 0.95) - 1)
      ]
    : Infinity;
export function evaluateBenchmark(m: BenchmarkMetrics): BenchmarkEvaluation {
  const frameP95 = p95(m.frames),
    physicsP95 = p95(m.physics),
    cpuP95 = p95(m.cpu),
    maxFrame = Math.max(0, ...m.frames),
    failures: string[] = [];
  if (m.frames.length < 180 || m.physics.length < 180 || m.cpu.length < 180)
    failures.push("Fewer than 180 measured frames");
  if (
    [...m.frames, ...m.physics, ...m.cpu].some(
      (v) => !Number.isFinite(v) || v < 0,
    )
  )
    failures.push("Invalid timing samples");
  if (frameP95 > 20)
    failures.push(`Frame interval p95 ${frameP95.toFixed(1)} ms exceeds 20 ms`);
  if (physicsP95 > 4)
    failures.push(
      `Two-tick physics p95 ${physicsP95.toFixed(2)} ms exceeds 4 ms`,
    );
  if (cpuP95 > 13.3)
    failures.push(
      `Frame CPU work p95 ${cpuP95.toFixed(2)} ms exceeds 13.3 ms headroom limit`,
    );
  if (maxFrame > 250)
    failures.push(`Longest frame ${maxFrame.toFixed(1)} ms exceeds 250 ms`);
  if (m.viewport[0] < 1280 || m.viewport[1] < 720)
    failures.push(
      `Browser window ${m.viewport.join(" × ")} is below 1280 × 720`,
    );
  return {
    passed: failures.length === 0,
    failures,
    frameP95,
    physicsP95,
    cpuP95,
    maxFrame,
  };
}
/** Highest passing tested tier; input order cannot accidentally select a lower tier. */
export function selectHighestTier(
  results: BenchmarkMetrics[],
): GraphicsTier | null {
  return (
    BENCHMARK_TIERS.find((tier) =>
      results.some((m) => m.tier === tier && evaluateBenchmark(m).passed),
    ) ?? null
  );
}
export interface BenchmarkProps {
  profile: Profile;
  onComplete: (tier: GraphicsTier, report: string, passed: boolean) => void;
  onClose: () => void;
}
interface Progress {
  tier: GraphicsTier;
  phase: string;
  sample: number;
  detail: string;
}
const number = (n: number, digits = 1) =>
  Number.isFinite(n) ? n.toFixed(digits) : "unavailable";
function summarize(m: BenchmarkMetrics) {
  const e = evaluateBenchmark(m);
  return `${m.tier.toUpperCase()} ${e.passed ? "PASS" : "FAIL"} — ${m.frames.length} measured frames after 30 warm-up frames; frame p95 ${number(e.frameP95)} ms; physics p95 ${number(e.physicsP95, 2)} ms / two ticks; frame CPU work p95 ${number(e.cpuP95, 2)} ms; longest frame ${number(e.maxFrame)} ms; ${m.drawCalls} draw calls; ${m.triangles.toLocaleString()} triangles; internal output ${m.resolution.join("×")}; browser ${m.viewport.join("×")}.${e.failures.length ? ` Unmet: ${e.failures.join("; ")}.` : ""}${m.tier === "standard" && m.drawCalls > 200 ? " Draw-call tuning advisory: Standard exceeds the 200-call target." : ""}`;
}

/** Runs outside the assessment/session engine; results are software preflight evidence only. */
export function Benchmark({ profile, onComplete, onClose }: BenchmarkProps) {
  const host = useRef<HTMLDivElement>(null),
    callbacks = useRef({ onComplete, onClose });
  callbacks.current = { onComplete, onClose };
  const [progress, setProgress] = useState<Progress>({
    tier: "high",
    phase: "Preparing venue",
    sample: 0,
    detail: "Loading the selected robot, course geometry, and shaders.",
  });
  const [history, setHistory] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false,
      raf = 0,
      venue: Venue | undefined,
      world: PhysicsWorld | undefined,
      canvas: HTMLCanvasElement | undefined;
    let intentionalDisposal = false,
      finished = false;
    const results: BenchmarkMetrics[] = [];
    let settleTier: ((value: BenchmarkMetrics | null) => void) | undefined;
    const messages: string[] = [];
    const cleanupTier = () => {
      cancelAnimationFrame(raf);
      intentionalDisposal = true;
      canvas?.removeEventListener("webglcontextlost", contextLost);
      venue?.dispose();
      world?.dispose();
      canvas?.remove();
      venue = undefined;
      world = undefined;
      canvas = undefined;
      intentionalDisposal = false;
    };
    const finish = (tier: GraphicsTier, passed: boolean, extra = "") => {
      if (cancelled || finished) return;
      finished = true;
      cleanupTier();
      const report = [
        `Graphics preflight ${new Date().toISOString()}. Robot ${profile.robot.id}; ${profile.physicsVersion}.`,
        ...messages,
        extra,
        "Warm-up and timings use the same T03 geometry at every tier. The standard workload advances two fixed 1/120-second physics ticks per rendered frame. CPU work includes physics, visual updates and WebGL command submission; frame intervals also capture scheduling and rendering pressure. This short software check does not measure physical controller latency, sustained thermal performance, USB compatibility, or real-robot fidelity.",
      ]
        .filter(Boolean)
        .join("\n");
      callbacks.current.onComplete(tier, report, passed);
    };
    const interrupt = (reason: string) => {
      if (cancelled || finished || intentionalDisposal) return;
      settleTier?.(null);
      finish(
        "performance",
        false,
        `Preflight interrupted: ${reason}. Run again before using the result.`,
      );
    };
    const contextLost = (event: Event) => {
      if (!intentionalDisposal) {
        event.preventDefault();
        interrupt("WebGL context lost");
      }
    };
    const visibility = () => {
      if (document.hidden) interrupt("page became hidden");
    };
    const blur = () => interrupt("window lost focus");
    const resize = () => interrupt("window size changed");
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("blur", blur);
    window.addEventListener("resize", resize);
    async function runTier(
      tier: GraphicsTier,
    ): Promise<BenchmarkMetrics | null> {
      setProgress({
        tier,
        phase: "Warming shaders",
        sample: 0,
        detail: "Compiling materials before measurements begin.",
      });
      canvas = document.createElement("canvas");
      canvas.style.cssText = "width:100%;height:100%;display:block";
      canvas.setAttribute(
        "aria-label",
        `${tier} graphics preflight: automated robot motion on the slalom course`,
      );
      host.current?.append(canvas);
      canvas.addEventListener("webglcontextlost", contextLost);
      const course = createCourse(
        "T03",
        profile.robot,
        profile.controlFrame,
        profile.seedSet[0] ?? 101,
      );
      const createdWorld = await PhysicsWorld.create(
        profile.robot,
        course.obstacles,
      );
      if (cancelled || finished) {
        createdWorld.dispose();
        return null;
      }
      world = createdWorld;
      world.reset(course.start);
      venue = new Venue(canvas, profile.robot, tier);
      venue.setCourse(course);
      venue.setCamera("station");
      // Responsive CSS view, consistent 1920×1080 base workload; retain each tier's pixel multiplier.
      const multiplier =
        tier === "performance"
          ? 1
          : Math.min(window.devicePixelRatio, tier === "high" ? 2 : 1.25);
      venue.renderer.setPixelRatio(multiplier);
      venue.renderer.setSize(1920, 1080, false);
      venue.update(world.snapshot(), {
        state: "running",
        checkpoint: 0,
        total: 1,
        elapsed: 0,
        dwell: 0,
        instruction: "Station preflight",
        cue: null,
        target: course.segments[0].target,
        gate: course.segments[0].gates?.[0] ?? null,
        metrics: {},
      });
      await venue.warm();
      if (cancelled || finished) return null;
      const stats = venue.stats();
      const metrics: BenchmarkMetrics = {
        tier,
        frames: [],
        physics: [],
        cpu: [],
        drawCalls: 0,
        triangles: 0,
        resolution: stats.resolution,
        viewport: [window.innerWidth, window.innerHeight],
      };
      let frame = 0,
        last: number | null = null,
        pathIndex = 1;
      const path = course.segments[0].route;
      return new Promise((resolve) => {
        settleTier = resolve;
        const render = (time: number) => {
          if (cancelled || finished || !world || !venue) {
            resolve(null);
            return;
          }
          if (last === null) {
            last = time;
            raf = requestAnimationFrame(renderSafe);
            return;
          }
          const interval = time - last;
          last = time;
          const cpuStart = performance.now(),
            physicsStart = performance.now();
          for (let tick = 0; tick < 2; tick++) {
            const s = world.snapshot(),
              target = path[Math.min(pathIndex, path.length - 1)],
              dx = target.x - s.x,
              dy = target.y - s.y,
              dist = Math.hypot(dx, dy);
            if (dist < 0.35 && pathIndex < path.length - 1) pathIndex++;
            let x = clamp(dx * 0.55, -0.55, 0.55),
              y = clamp(dy * 0.55, -0.55, 0.55),
              turn = clamp(wrapAngle(target.yaw - s.yaw) * 0.7, -0.5, 0.5);
            if (profile.robot.kind === "differential") {
              const error = wrapAngle(Math.atan2(dy, dx) - s.yaw);
              x =
                Math.min(0.45, dist * 0.45) * Math.max(0, Math.cos(error)) ** 3;
              y = 0;
              turn = clamp(error * 0.9, -0.7, 0.7);
            }
            const command: Command = {
              x,
              y,
              turn,
              brake: false,
              precision: false,
              timestamp: time,
              deviceSlot: -1,
            };
            world.step(command, "field");
          }
          const physicsCost = performance.now() - physicsStart;
          venue.update(world.snapshot(), null);
          venue.render(time);
          const cpuCost = performance.now() - cpuStart,
            statsNow = venue.stats();
          frame++;
          if (frame > 30) {
            metrics.frames.push(interval);
            metrics.physics.push(physicsCost);
            metrics.cpu.push(cpuCost);
            metrics.drawCalls = Math.max(metrics.drawCalls, statsNow.drawCalls);
            metrics.triangles = Math.max(metrics.triangles, statsNow.triangles);
          }
          if (frame % 15 === 0)
            setProgress({
              tier,
              phase:
                frame <= 30
                  ? "Warming motion and shadows"
                  : "Measuring frame pacing",
              sample: metrics.frames.length,
              detail:
                frame <= 30
                  ? `${frame} / 30 warm-up frames`
                  : `${metrics.frames.length} / 180 frames · p95 ${number(p95(metrics.frames))} ms · two-tick physics ${number(p95(metrics.physics), 2)} ms`,
            });
          if (metrics.frames.length >= 180) {
            settleTier = undefined;
            resolve(metrics);
            return;
          }
          raf = requestAnimationFrame(renderSafe);
        };
        const renderSafe = (time: number) => {
          try {
            render(time);
          } catch (error) {
            interrupt(
              `runtime failure: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        };
        raf = requestAnimationFrame(renderSafe);
      });
    }
    void (async () => {
      try {
        for (const tier of BENCHMARK_TIERS) {
          if (cancelled || finished) return;
          const measured = await runTier(tier);
          if (!measured || cancelled || finished) return;
          results.push(measured);
          messages.push(summarize(measured));
          setHistory([...messages]);
          cleanupTier();
          if (evaluateBenchmark(measured).passed) {
            finish(
              tier,
              true,
              `Selected ${tier}, the highest tested passing tier. Settings and output remain fixed during each measured run.`,
            );
            return;
          }
        }
        finish(
          "performance",
          false,
          "No graphics tier passed every preflight limit. Review the unmet criteria above; use practice until the station is corrected and retested.",
        );
      } catch (error) {
        finish(
          "performance",
          false,
          `Preflight could not finish: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    })();
    return () => {
      cancelled = true;
      settleTier?.(null);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("blur", blur);
      window.removeEventListener("resize", resize);
      cleanupTier();
    };
    // Freeze the supplied profile for this run; callback identity changes must not restart measurement.
  }, []);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="benchmark-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "#071519f5",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        padding: 24,
        gap: 14,
      }}
    >
      <div
        style={{
          width: "min(1280px, 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 20,
        }}
      >
        <div>
          <p className="eyebrow" style={{ margin: 0 }}>
            AUTOMATIC GRAPHICS CHECK
          </p>
          <h2 id="benchmark-title" style={{ margin: "5px 0" }}>
            Finding your highest responsive tier.
          </h2>
        </div>
        <button
          className="secondary"
          onClick={() => callbacks.current.onClose()}
          aria-label="Cancel graphics preflight"
        >
          Cancel
        </button>
      </div>
      <div
        style={{
          position: "relative",
          width:
            "min(1280px, calc(100vw - 48px), calc((100vh - 200px) * 16 / 9))",
          aspectRatio: "16 / 9",
          background: "#13282d",
          border: "1px solid #385255",
          borderRadius: 14,
          overflow: "hidden",
        }}
      >
        <div ref={host} style={{ width: "100%", height: "100%" }} />
        <div
          aria-live="polite"
          style={{
            position: "absolute",
            left: 18,
            bottom: 18,
            maxWidth: 430,
            background: "#07191fee",
            border: "1px solid #48635e",
            borderRadius: 10,
            padding: "14px 18px",
          }}
        >
          <strong style={{ textTransform: "capitalize" }}>
            {progress.tier} · {progress.phase}
          </strong>
          <p style={{ fontSize: 13, margin: "6px 0 10px" }}>
            {progress.detail}
          </p>
          <progress
            aria-label="Measured frames"
            value={progress.sample}
            max={180}
            style={{ width: "100%", accentColor: "#a5d7ae" }}
          />
        </div>
      </div>
      <div
        style={{ width: "min(1280px, 100%)", fontSize: 12, color: "#aac0bd" }}
      >
        <p style={{ margin: 0 }}>
          High → Standard → Performance · 1920 × 1080 base output · 30 warm-up +
          180 measured frames · Keep this window focused.
        </p>
        <p style={{ margin: "5px 0 0" }}>
          Frame p95 ≤20 ms · Two-tick physics ≤4 ms · Frame CPU work ≤13.3 ms
          for headroom. This measures software performance, not physical input
          latency.
        </p>
        {history.length > 0 && (
          <details>
            <summary>
              {history.length} tier{history.length > 1 ? "s" : ""} measured
            </summary>
            {history.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </details>
        )}
      </div>
    </div>
  );
}
