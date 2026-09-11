import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronRight,
  CirclePause,
  Crosshair,
  Gamepad2,
  Gauge,
  Keyboard,
  Play,
  RotateCcw,
  Settings2,
} from "lucide-react";
import type { Attempt, CourseDefinition, Profile } from "../types";
import { LabEngine } from "./engine";
import type { EngineHud, RunMode } from "./engine";
import { Badge } from "./components";
import { freezeProfile } from "./profile";
import { profileLockReason } from "../session/workflow";
interface Props {
  profile: Profile;
  locked: boolean;
  course: CourseDefinition | null;
  mode: RunMode;
  driverId: string;
  driverName: string;
  trial: number;
  onExit: (seconds: number) => void;
  onStart: (p: Profile) => void;
  onResult: (a: Attempt) => void;
}
export function GameView({
  profile,
  locked,
  course,
  mode,
  driverId,
  driverName,
  trial,
  onExit,
  onStart,
  onResult,
}: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<LabEngine | null>(null);
  const latest = useRef({ onResult, onStart, onExit });
  latest.current = { onResult, onStart, onExit };
  const [hud, setHud] = useState<EngineHud | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Attempt | null>(null);
  const [overlay, setOverlay] = useState(true);
  const [trail, setTrail] = useState(false);
  const [camera, setCamera] = useState<Profile["camera"]>(
    mode === "scored" ? "station" : profile.camera,
  );
  const [frame, setFrame] = useState(profile.controlFrame);
  useEffect(() => {
    let cancelled = false;
    LabEngine.create(canvas.current!, profile, course, mode, setHud, (a) => {
      setResult(a);
      latest.current.onResult(a);
    })
      .then((e) => {
        if (cancelled) e.dispose();
        else engine.current = e;
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
      engine.current?.dispose();
      engine.current = null;
    };
  }, []);
  const start = () => {
    try {
      const p = freezeProfile({
        ...profile,
        camera: mode === "scored" ? "station" : camera,
        controlFrame: frame,
        renderResolution: hud?.renderResolution ?? profile.renderResolution,
        display: {
          ...profile.display,
          width: innerWidth,
          height: innerHeight,
          pixelRatio: devicePixelRatio,
        },
        deviceDescription: hud?.diagnostics.name ?? profile.deviceDescription,
      });
      const mismatch = profileLockReason(
        profile,
        p,
        mode === "scored" && locked,
      );
      if (mismatch) throw new Error(mismatch);
      engine.current?.prepareProfile(p);
      engine.current?.start(driverId, trial);
      if (mode === "scored") latest.current.onStart(p);
      setResult(null);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const exit = () => {
    if (hud?.state === "running" || hud?.state === "countdown")
      engine.current?.abort();
    latest.current.onExit(hud?.freeSeconds ?? 0);
  };
  const time = course
    ? Math.max(0, course.timeLimit - (hud?.feedback?.elapsed ?? 0))
    : (hud?.freeSeconds ?? 0);
  return (
    <div className="game-shell">
      <header className="game-header">
        <button
          className="icon-button"
          onClick={exit}
          aria-label="Exit driving"
        >
          <ArrowLeft />
        </button>
        <div>
          <p className="eyebrow">
            {mode === "free"
              ? "OPEN PRACTICE"
              : mode === "practice"
                ? "GUIDED PRACTICE"
                : `ASSESSMENT / TRIAL ${trial}`}
          </p>
          <h2>{course?.name ?? "Free drive"}</h2>
        </div>
        <div className="game-profile">
          <span>{profile.robot.name}</span>
          <Badge>{frame} relative</Badge>
          <Badge tone={mode === "scored" ? "warning" : "green"}>
            {mode === "scored" ? "Settings locked" : "Unscored"}
          </Badge>
        </div>
        <div className="device-mini">
          {profile.input.device === "keyboard" ? (
            <Keyboard size={18} />
          ) : (
            <Gamepad2 size={18} />
          )}
          <span>
            {hud?.diagnostics.connected ? "Connected" : "Disconnected"}
          </span>
        </div>
      </header>
      <div className="viewport-wrap">
        <div className="game-viewport">
          <canvas ref={canvas} aria-label="Interactive 3D driving arena" />
          <div className="cue-banner" hidden />
          {hud?.state === "running" && (
            <>
              <div className="hud-left">
                <span className="live-dot" />
                {driverName}
                <span className="hud-divider" />
                {course
                  ? `${Math.min((hud.feedback?.checkpoint ?? 0) + 1, hud.feedback?.total ?? 1)} / ${hud.feedback?.total ?? 1}`
                  : "PRACTICE VENUE"}
              </div>
              <div className="hud-right">
                <Gauge size={15} />
                <b>{hud.snapshot.speed.toFixed(1)}</b>
                <small>m/s</small>
                <span className="hud-divider" />
                <b>
                  {Math.floor(time / 60)}:
                  {Math.floor(time % 60)
                    .toString()
                    .padStart(2, "0")}
                </b>
              </div>
              {course && (
                <div className="hud-instruction">
                  <span>{hud.feedback?.instruction}</span>
                  {(hud.feedback?.dwell ?? 0) > 0 && (
                    <progress
                      value={hud.feedback?.dwell}
                      max={hud.feedback?.target?.dwell ?? 1}
                    />
                  )}
                </div>
              )}
              {overlay && hud?.state === "running" && (
                <div className="controller-overlay">
                  <div className="mini-stick">
                    <span
                      style={{
                        transform: `translate(${-hud.command.y * 21}px,${-hud.command.x * 21}px)`,
                      }}
                    />
                  </div>
                  <div className="control-readout">
                    <span>
                      TURN <b>{hud.command.turn.toFixed(2)}</b>
                    </span>
                    <span>
                      {hud.command.brake
                        ? "BRAKE / X-LOCK"
                        : hud.command.precision
                          ? "PRECISION"
                          : "DRIVE"}
                    </span>
                  </div>
                </div>
              )}
            </>
          )}
          {(!hud || hud.state === "ready") && (
            <div className="game-scrim">
              <section className="start-card">
                <p className="eyebrow">
                  {mode === "scored" ? "RECORDED ATTEMPT" : "YOUR NEXT REP"}
                </p>
                <h2>{course?.name ?? "Get a feel for the field."}</h2>
                <p>
                  {course?.description ??
                    "Explore the practice venue. Try smooth acceleration, release to coast, then compare a deliberate brake."}
                </p>
                {course && (
                  <ol>
                    {course.instructions.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ol>
                )}
                <div className="key-guide">
                  <span>
                    <kbd>W</kbd>
                    <kbd>A</kbd>
                    <kbd>S</kbd>
                    <kbd>D</kbd>{" "}
                    {profile.robot.kind === "differential"
                      ? "Drive / steer"
                      : "Translate"}
                  </span>
                  <span>
                    <kbd>Q</kbd>
                    <kbd>E</kbd> Rotate
                  </span>
                  <span>
                    <kbd>Space</kbd> Brake
                  </span>
                  <span>
                    <kbd>Shift</kbd> Precision
                  </span>
                </div>
                <p className="micro">
                  {profile.input.tank
                    ? "Tank: W/S left side · Up/Down right side. "
                    : ""}
                  Bindings follow your saved setup.{" "}
                  {mode === "scored"
                    ? "Pause or abort counts as DNF. Technical interruptions invalidate the attempt."
                    : "Escape pauses. Camera and aids are available."}
                </p>
                {error && <div className="inline-error">{error}</div>}
                <div className="preflight">
                  <span className={`status-dot ${hud?.ready ? "" : "amber"}`} />
                  {!hud
                    ? "Loading physics and warming shaders…"
                    : !hud.canStart
                      ? hud.reason
                      : hud.ready
                        ? "Frame pacing check passed"
                        : mode === "scored"
                          ? `Checking station · ${hud.performance.frameP95.toFixed(1)} ms p95 · ${hud.performance.frames} frames`
                          : "Ready for practice · assessment preflight runs in the background"}
                </div>
                <button
                  className="primary full"
                  disabled={
                    !hud ||
                    !hud.canStart ||
                    (mode === "scored" && !hud.ready) ||
                    !hud.diagnostics.connected
                  }
                  onClick={start}
                >
                  <Play size={18} fill="currentColor" />
                  {mode === "scored"
                    ? "Start recorded attempt"
                    : mode === "practice"
                      ? "Start practice"
                      : "Enter the field"}
                </button>
                {mode === "scored" && !hud?.ready && (
                  <p className="micro">
                    At least 150 measured frames, p95 ≤20 ms, physics ≤4 ms,
                    connected input, and a 1280 × 720 or larger window are
                    required. If the check fails, lower the graphics tier in
                    Setup and check again.
                  </p>
                )}
              </section>
            </div>
          )}
          {hud?.state === "countdown" && (
            <div className="countdown">
              <span>CONTROLS LOCKED</span>
              <b>{hud.countdown}</b>
              <p>Find the first target. Release the controls.</p>
            </div>
          )}
          {hud?.state === "paused" && (
            <div className="game-scrim">
              <section className="pause-card">
                <CirclePause size={32} />
                <h2>Take a breath.</h2>
                <p>{hud.reason}</p>
                <button
                  className="primary full"
                  onClick={() => engine.current?.resume()}
                >
                  <Play size={17} /> Resume practice
                </button>
                <button
                  className="secondary full"
                  onClick={() => engine.current?.reset()}
                >
                  <RotateCcw size={16} /> Reset to start
                </button>
              </section>
            </div>
          )}
          {result && (
            <div className="game-scrim">
              <section className="start-card result-card">
                <Badge tone={result.status === "invalid" ? "warning" : "green"}>
                  {result.status === "practice"
                    ? result.practiceCompleted
                      ? "Practice complete"
                      : "Practice ended"
                    : result.status === "dnf"
                      ? "Did not finish"
                      : result.status === "invalid"
                        ? "Technical invalidation"
                        : "Attempt complete"}
                </Badge>
                <h2>
                  {result.status === "completed"
                    ? "A rep worth reviewing."
                    : result.status === "invalid"
                      ? "Let’s resolve the interruption."
                      : result.status === "dnf"
                        ? "Keep this rep. Learn from it."
                        : "Ready for another rep?"}
                </h2>
                <div className="result-number">
                  {result.score.score === null
                    ? "—"
                    : result.score.score.toFixed(1)}
                  <span>
                    {result.score.score === null
                      ? "Unscored"
                      : "/ 100 · provisional"}
                  </span>
                </div>
                <p>{result.cause || result.score.explanation}</p>
                <div className="mini-metrics">
                  <span>
                    <b>
                      {Number(
                        result.metrics.time ?? result.durationTicks / 120,
                      ).toFixed(1)}{" "}
                      s
                    </b>
                    Elapsed
                  </span>
                  <span>
                    <b>
                      {Number(result.metrics.minorContacts ?? 0) +
                        Number(result.metrics.majorContacts ?? 0)}
                    </b>
                    Contacts
                  </span>
                  <span>
                    <b>{result.score.penalty.toFixed(0)}</b>Penalty points
                  </span>
                </div>
                <div className="button-row">
                  <button className="primary" onClick={exit}>
                    Review & continue <ChevronRight size={18} />
                  </button>
                  {mode === "practice" && (
                    <button
                      className="secondary"
                      onClick={() => {
                        engine.current?.reset();
                        setResult(null);
                      }}
                    >
                      Practice again
                    </button>
                  )}
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
      <footer className="game-footer">
        <div className="button-row">
          <button
            className="secondary compact"
            onClick={() => engine.current?.interrupt("Paused by driver")}
            disabled={hud?.state !== "running"}
          >
            <CirclePause size={16} />
            {mode === "scored" ? "Abort (DNF)" : "Pause"}
          </button>
          {mode !== "scored" && (
            <>
              <label className="inline-select">
                Camera
                <select
                  aria-label="Practice camera"
                  value={camera}
                  onChange={(e) => {
                    const c = e.target.value as Profile["camera"];
                    setCamera(c);
                    engine.current?.camera(c);
                  }}
                >
                  <option value="station">Driver station</option>
                  <option value="orbit">Orbit</option>
                  <option value="chase">Chase</option>
                  <option value="overhead">Overhead</option>
                </select>
              </label>
              {camera === "orbit" && (
                <button
                  className="icon-button"
                  aria-label="Rotate orbit camera"
                  onClick={() => engine.current?.orbit(0.4)}
                >
                  <RotateCcw size={16} />
                </button>
              )}
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={trail}
                  onChange={(e) => {
                    setTrail(e.target.checked);
                    engine.current?.setTrail(e.target.checked);
                  }}
                />{" "}
                Trail
              </label>
              {mode === "free" && frame === "field" && (
                <button
                  className="secondary compact"
                  onClick={() => engine.current?.zeroHeading()}
                >
                  Zero heading
                </button>
              )}
              {mode === "free" && profile.robot.kind !== "differential" && (
                <button
                  className="secondary compact"
                  onClick={() => {
                    const f = frame === "field" ? "robot" : "field";
                    setFrame(f);
                    engine.current?.setFrame(f);
                  }}
                >
                  <Crosshair size={15} />
                  {frame}
                </button>
              )}
            </>
          )}
          <button
            className={`icon-button ${overlay ? "active" : ""}`}
            aria-label="Toggle input overlay"
            onClick={() => setOverlay(!overlay)}
          >
            <Settings2 size={18} />
          </button>
        </div>
        <div className="performance-mini">
          <span className={`status-dot ${hud?.ready ? "" : "amber"}`} />
          <b>{hud?.performance.frameP95.toFixed(1) ?? "—"} ms</b> frame p95
          <span>·</span>
          {profile.graphicsTier}
          <span>·</span>120 Hz physics
        </div>
      </footer>
    </div>
  );
}
