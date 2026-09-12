import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Clock3,
  FileText,
  Gamepad2,
  Gauge,
  House,
  Keyboard,
  LayoutGrid,
  Monitor,
  Plus,
  Settings2,
  ShieldCheck,
  Target,
  Trash2,
  Users,
  X,
} from "lucide-react";
import type { Attempt, Profile, Session, TestId } from "../types";
import {
  createSession,
  clearSession,
  exportSession,
  recoverSession,
  saveSession,
  validateSession,
} from "../session";
import { aggregate } from "../scoring";
import {
  assessmentReadiness,
  exposureKey,
  hasExposureOverride,
  nextScheduledSlot,
  practiceEvidence,
  replacementState,
  scoredSlotCount,
} from "../session/workflow";
import { ROBOTS } from "../../content/robots";
import { createCourse, TEST_CATALOG } from "../tests/courses";
import { Badge, Brand, PageTitle, RobotPreview, TestIcon } from "./components";
import { defaultProfile, freezeProfile } from "./profile";
import { Setup } from "./Setup";
import { Reports, downloadFile } from "./Reports";
import { GameView } from "./GameView";
import { Benchmark } from "./Benchmark";
import { applyOfflineUpdate, rollbackOfflineBuild } from "../offline";
import type { RunMode } from "./engine";
import "./style.css";
type Page =
  | "home"
  | "robots"
  | "practice"
  | "assessment"
  | "setup"
  | "session"
  | "reports"
  | "guide";
function fresh() {
  const s = createSession(defaultProfile());
  const d = { id: crypto.randomUUID(), name: "Driver 01", notes: "" };
  s.drivers = [d];
  s.activeDriverId = d.id;
  s.label = "Afternoon practice";
  return s;
}
export default function App() {
  const [benchmark, setBenchmark] = useState(false);
  const [benchmarkReport, setBenchmarkReport] = useState("");
  const [offlineStatus, setOfflineStatus] = useState("");
  const [ended, setEnded] = useState(false);
  const [initial] = useState(() => recoverSession());
  const [session, setSession] = useState<Session>(
    () => initial.session ?? fresh(),
  );
  const [page, setPage] = useState<Page>("home");
  const [toast, setToast] = useState(initial.notice ?? "");
  const [storageNotice, setStorageNotice] = useState("");
  const [game, setGame] = useState<{
    mode: RunMode;
    testId?: TestId;
    trial: number;
  } | null>(null);
  const [newName, setNewName] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [expired, setExpired] = useState(
    () => Date.now() >= Date.parse(session.expiresAt),
  );
  const [expiryPrompt, setExpiryPrompt] = useState(false);
  const expiryDialog = useRef<HTMLDialogElement>(null);
  const [updateReady, setUpdateReady] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const driver =
    session.drivers.find((d) => d.id === session.activeDriverId) ??
    session.drivers[0];
  const locked = session.results.some((a) => a.status !== "practice");
  const next = nextScheduledSlot(session);
  const outcome = session.results.filter((a) => a.driverId === driver?.id);
  const summary = aggregate(outcome, session.suite, session.profile.hash);
  const scoredCount = scoredSlotCount(session);
  const invalidBlocked = replacementState(session).blocked;
  const exposure =
    session.practiceExposure[
      exposureKey(driver?.id ?? "", session.profile, "free")
    ] ?? 0;
  const exposureOverride = hasExposureOverride(session.profile);
  useEffect(() => {
    document.documentElement.dataset.sessionActive = String(!ended);
    if (ended) return;
    const r = saveSession(session);
    setStorageNotice(r.notice ?? "");
  }, [session, ended]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 6500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    const status = (event: Event) =>
      setOfflineStatus((event as CustomEvent).detail.message);
    window.addEventListener("driver-lab-offline-status", status);
    return () =>
      window.removeEventListener("driver-lab-offline-status", status);
  }, []);
  useEffect(() => {
    const onUpdate = () => setUpdateReady(true);
    window.addEventListener("driver-lab-update", onUpdate);
    return () => window.removeEventListener("driver-lab-update", onUpdate);
  }, []);
  useEffect(() => {
    const checkExpiry = () =>
      setExpired(Date.now() >= Date.parse(session.expiresAt));
    checkExpiry();
    const t = setInterval(checkExpiry, 60000);
    window.addEventListener("focus", checkExpiry);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", checkExpiry);
    };
  }, [session.expiresAt]);
  useEffect(() => {
    const dialog = expiryDialog.current;
    if (!expiryPrompt || !dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, [expiryPrompt]);
  const changeProfile = (p: Profile) => {
    if (locked) {
      setToast(
        "The comparison profile is locked. End this session to change it.",
      );
      return;
    }
    setSession((s) => ({ ...s, profile: freezeProfile(p) }));
  };
  const begin = (mode: RunMode, testId?: TestId, trial = 1) => {
    if (!driver) {
      setPage("session");
      setToast("Add a driver first.");
      return;
    }
    if (Date.now() >= Date.parse(session.expiresAt)) {
      setExpired(true);
      setExpiryPrompt(true);
      return;
    }
    if (mode === "scored") {
      const ready = assessmentReadiness(session, { testId: testId!, trial });
      if (!ready.allowed) {
        setToast(ready.reason);
        return;
      }
    }
    if (mode === "scored" && !locked)
      setSession((s) => ({
        ...s,
        profile: freezeProfile({
          ...s.profile,
          familiarizationSeconds: exposureOverride ? 0 : 180,
        }),
      }));
    setGame({ mode, testId, trial });
  };
  const addResult = (attempt: Attempt) => {
    setSession((s) => {
      if (s.results.some((a) => a.id === attempt.id)) return s;
      const results = [...s.results, attempt];
      const totalReplay = results.reduce(
        (sum, a) => sum + (a.replay?.length ?? 0) * 80,
        0,
      );
      if (totalReplay > 25 * 1024 * 1024) {
        setToast(
          "Replay budget reached. Older paths will be removed; scores and raw metrics remain.",
        );
        let excess = totalReplay - 25 * 1024 * 1024;
        for (const a of results) {
          if (excess <= 0) break;
          if (a.replay) {
            excess -= a.replay.length * 80;
            delete a.replay;
          }
        }
      }
      const { activeAttempt: _, ...base } = s;
      return {
        ...base,
        results,
        practiceExposure:
          attempt.status === "practice"
            ? {
                ...s.practiceExposure,
                [`${attempt.driverId}:${attempt.testId}`]:
                  (s.practiceExposure[
                    `${attempt.driverId}:${attempt.testId}`
                  ] ?? 0) + 1,
              }
            : s.practiceExposure,
      };
    });
  };
  const clear = () => {
    document.documentElement.dataset.sessionActive = "false";
    const r = clearSession();
    setEnded(true);
    setSession(fresh());
    setConfirmClear(false);
    setExpiryPrompt(false);
    setPage("home");
    setToast(r.notice ?? "Session cleared.");
  };
  const upload = async (f: File) => {
    try {
      if (f.size > 2 * 1024 * 1024)
        throw new Error("Session file exceeds 2 MB.");
      let s = validateSession(await f.text());
      if (s.activeAttempt) {
        const recovered = recoverSession({
          getItem: () => JSON.stringify(s),
          setItem: () => {},
          removeItem: () => {},
        });
        if (recovered.session) s = recovered.session;
      }
      if (Date.now() >= Date.parse(s.expiresAt))
        throw new Error(
          "Imported session has expired. Reports remain available from its exported PDF.",
        );
      setSession(s);
      setToast(
        "Session imported. Results keep their recorded comparison profiles.",
      );
    } catch (e) {
      setToast((e as Error).message);
    }
  };
  const nav = [
    { id: "home" as Page, label: "Overview", icon: House },
    { id: "robots" as Page, label: "Robot garage", icon: LayoutGrid },
    { id: "practice" as Page, label: "Practice", icon: Gamepad2 },
    { id: "assessment" as Page, label: "Assessments", icon: ClipboardList },
    { id: "reports" as Page, label: "Driver reports", icon: FileText },
  ];
  if (benchmark)
    return (
      <Benchmark
        profile={session.profile}
        onClose={() => setBenchmark(false)}
        onComplete={(tier, report, passed) => {
          setBenchmark(false);
          setBenchmarkReport(report);
          if (passed && !locked)
            changeProfile({ ...session.profile, graphicsTier: tier });
          setToast(
            passed
              ? `${tier} graphics passed the software preflight. The detailed measurements are in Setup.`
              : "Station preflight did not pass. Review the measurements in Setup.",
          );
        }}
      />
    );
  if (ended)
    return (
      <div className="ended-screen">
        <Brand />
        <div className="panel">
          <ShieldCheck size={36} />
          <h1>Session cleared.</h1>
          <p>
            Roster, results, notes, and tab recovery have been removed. Your
            downloaded files remain on this computer.
          </p>
          <button
            className="primary full"
            onClick={() => {
              setEnded(false);
              setSession(fresh());
            }}
          >
            Start a new session <ArrowRight size={16} />
          </button>
          {updateReady && (
            <button
              className="secondary full"
              onClick={() => void applyOfflineUpdate()}
            >
              Apply downloaded update
            </button>
          )}
          <button
            className="text-button"
            onClick={() =>
              rollbackOfflineBuild().catch((e) => setToast(e.message))
            }
          >
            Restore previous cached build
          </button>
          {toast && <p className="micro">{toast}</p>}
        </div>
      </div>
    );
  if (game) {
    const course = game.testId
      ? createCourse(
          game.testId,
          session.profile.robot,
          session.profile.controlFrame,
          session.profile.seedSet[game.trial - 1] ?? 101,
        )
      : null;
    return (
      <GameView
        profile={session.profile}
        locked={locked}
        course={course}
        mode={game.mode}
        driverId={driver.id}
        driverName={driver.name}
        trial={game.trial}
        onExit={(seconds) => {
          if (game.mode === "free")
            setSession((s) => ({
              ...s,
              practiceExposure: {
                ...s.practiceExposure,
                [exposureKey(driver.id, s.profile, "free")]:
                  (s.practiceExposure[
                    exposureKey(driver.id, s.profile, "free")
                  ] ?? 0) + seconds,
              },
            }));
          setGame(null);
          if (game.mode === "scored") setPage("assessment");
        }}
        onStart={(p) => {
          const frozen = p;
          setSession((s) => ({
            ...s,
            profile: locked ? s.profile : frozen,
            activeAttempt: {
              driverId: driver.id,
              testId: game.testId!,
              scheduledTrial: game.trial,
              startedAt: new Date().toISOString(),
              profile: frozen,
            },
          }));
        }}
        onResult={addResult}
      />
    );
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <div className="side-section-title">DRIVE. LEARN. REPEAT.</div>
        <nav aria-label="Main navigation">
          {nav.map((n) => (
            <button
              key={n.id}
              className={page === n.id ? "active" : ""}
              onClick={() => setPage(n.id)}
            >
              <n.icon size={19} />
              {n.label}
              {page === n.id && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="side-section-title">YOUR STATION</div>
          <nav>
            <button
              className={page === "session" ? "active" : ""}
              onClick={() => setPage("session")}
            >
              <Users size={19} />
              Session roster
              <span className="nav-count">{session.drivers.length}</span>
            </button>
            <button
              className={page === "setup" ? "active" : ""}
              onClick={() => setPage("setup")}
            >
              <Settings2 size={19} />
              Setup & controls
            </button>
            <button
              className={page === "guide" ? "active" : ""}
              onClick={() => setPage("guide")}
            >
              <CircleHelp size={19} />
              Quick guide
            </button>
          </nav>
          <div className="local-card">
            <span className="status-dot" />
            <div>
              <strong>Local session</strong>
              <small>
                {offlineStatus.includes("ready for offline")
                  ? "Offline assets ready"
                  : "Your data stays here"}
              </small>
            </div>
            <ShieldCheck size={20} />
          </div>
          <p className="build-label">
            FIRST RELEASE <span>V 1.0</span>
          </p>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            WORKSPACE <ChevronRight size={13} />
            <strong>{session.label}</strong>
          </div>
          <div className="topbar-right">
            <span className="device-pill">
              {session.profile.input.device === "keyboard" ? (
                <Keyboard size={15} />
              ) : (
                <Gamepad2 size={15} />
              )}
              <span>
                {session.profile.input.device === "keyboard"
                  ? "Keyboard ready"
                  : "Gamepad selected"}
              </span>
            </span>
            <span className="top-divider" />
            <button
              className="driver-switch"
              onClick={() => setPage("session")}
            >
              <span className="avatar">
                {driver?.name.slice(0, 2).toUpperCase() ?? "DR"}
              </span>
              {driver?.name ?? "Add driver"}
              <ChevronRight size={15} />
            </button>
          </div>
        </header>
        <main>
          {expired && (
            <section
              className="notice warning session-expiry"
              role="status"
              aria-label="Session expired"
            >
              <div>
                <strong>This session has expired.</strong>
                <p>
                  Sessions last eight hours. Export any results, then end this
                  session to start driving again.
                </p>
              </div>
              <div className="button-row">
                <button
                  className="secondary"
                  onClick={() => setPage("reports")}
                >
                  Review reports
                </button>
                <button
                  className="primary"
                  onClick={() => setConfirmClear(true)}
                >
                  End expired session
                </button>
              </div>
            </section>
          )}
          {storageNotice && (
            <div className="notice warning">{storageNotice}</div>
          )}
          {updateReady && (
            <div className="notice">
              A new application build is downloaded. End this session before
              applying the update.
              <button
                className="text-button"
                onClick={() => setConfirmClear(true)}
              >
                End session & update
              </button>
            </div>
          )}
          {page === "home" && (
            <>
              <PageTitle
                eyebrow="YOUR TRAINING GROUND"
                title="Good drivers are built."
                description="More control. Better judgment. One deliberate rep at a time."
                action={
                  <div className="date-pill">
                    <span className="status-dot" />
                    VENUE OPEN
                  </div>
                }
              />
              <section className="home-hero">
                <div className="hero-copy">
                  <Badge tone="dark">FREE DRIVE / NO PRESSURE</Badge>
                  <h2>
                    Find your feel.
                    <br />
                    Own the field.
                  </h2>
                  <p>
                    Get behind the controls. Explore your drivetrain, practice
                    the basics, and build confidence before the clock starts.
                  </p>
                  <button className="primary" onClick={() => begin("free")}>
                    <Gamepad2 size={19} /> Enter free drive{" "}
                    <ArrowUpRight size={19} />
                  </button>
                  <div className="hero-meta">
                    <span>16 × 8 m practice venue</span>
                    <span>3 drivetrains</span>
                  </div>
                </div>
                <RobotPreview
                  robot={session.profile.robot}
                  className="hero-robot"
                  interactive
                />
                <div className="hero-robot-label">
                  <span>YOUR CURRENT ROBOT</span>
                  <strong>{session.profile.robot.name}</strong>
                  <button onClick={() => setPage("robots")}>
                    Open garage <ArrowUpRight size={14} />
                  </button>
                </div>
              </section>
              <div className="section-heading below-hero">
                <div>
                  <p className="eyebrow">TRAIN WITH PURPOSE</p>
                  <h2>Choose your next move.</h2>
                </div>
                <button
                  className="text-button"
                  onClick={() => setPage("guide")}
                >
                  How the lab works <ArrowUpRight size={15} />
                </button>
              </div>
              <div className="action-grid">
                <button
                  className="action-card"
                  onClick={() => setPage("practice")}
                >
                  <span className="tile-icon">
                    <Target />
                  </span>
                  <span className="card-index">01</span>
                  <h3>Practice a skill</h3>
                  <p>
                    Six focused drills. Clear targets.
                    <br />
                    Room to try again.
                  </p>
                  <span className="card-link">
                    Explore practice <ArrowRight size={17} />
                  </span>
                </button>
                <button
                  className="action-card"
                  onClick={() => setPage("assessment")}
                >
                  <span className="tile-icon">
                    <ClipboardList />
                  </span>
                  <span className="card-index">02</span>
                  <h3>Run an assessment</h3>
                  <p>
                    A consistent test of control.
                    <br />
                    Evidence you can coach from.
                  </p>
                  <span className="card-link">
                    View assessments <ArrowRight size={17} />
                  </span>
                </button>
                <button
                  className="action-card"
                  onClick={() => setPage("reports")}
                >
                  <span className="tile-icon">
                    <FileText />
                  </span>
                  <span className="card-index">03</span>
                  <h3>Review your driving</h3>
                  <p>
                    See your results. Find a focus.
                    <br />
                    Take your next step.
                  </p>
                  <span className="card-link">
                    Open driver reports <ArrowRight size={17} />
                  </span>
                </button>
              </div>
              <div className="station-strip">
                <Monitor size={22} />
                <div>
                  <strong>A consistent station makes a fair comparison.</strong>
                  <p>
                    Check controls, display, and graphics before a recorded
                    attempt.
                  </p>
                </div>
                <button className="secondary" onClick={() => setPage("setup")}>
                  Check setup <ArrowUpRight size={16} />
                </button>
              </div>
              <p className="provisional-note">
                Generic, uncalibrated robot presets · Provisional scoring
                rubrics · For practice and coach-guided development
              </p>
            </>
          )}
          {page === "robots" && (
            <>
              <PageTitle
                eyebrow="ROBOT GARAGE"
                title="Three ways to find your line."
                description="Choose a drivetrain. Learn what it does well, and what it asks of you."
                action={
                  <Badge tone={locked ? "warning" : "green"}>
                    {locked ? "Session profile locked" : "Choose your platform"}
                  </Badge>
                }
              />
              <div className="robot-grid">
                {ROBOTS.map((robot, i) => (
                  <article
                    className={`robot-card ${robot.id === session.profile.robot.id ? "selected" : ""}`}
                    key={robot.id}
                  >
                    <div className="robot-card-top">
                      <span>PLATFORM / 0{i + 1}</span>
                      {robot.id === session.profile.robot.id && (
                        <Badge tone="green">
                          <Check size={12} /> Selected
                        </Badge>
                      )}
                    </div>
                    <RobotPreview robot={robot} />
                    <div className="robot-card-copy">
                      <p className="eyebrow">
                        {robot.kind === "differential"
                          ? "SIX-WHEEL DIFFERENTIAL"
                          : robot.kind === "mecanum"
                            ? "FOUR-WHEEL MECANUM"
                            : "FOUR-MODULE SWERVE"}
                      </p>
                      <h2>{robot.name}</h2>
                      <p>
                        {robot.kind === "swerve"
                          ? "Independent steering. Translate and rotate together with precise, responsive control."
                          : robot.kind === "differential"
                            ? "Planted traction. Build smooth arcs, intentional pivots, and disciplined approaches."
                            : "Fixed wheels. Use angled rollers to strafe, turn, and move diagonally."}
                      </p>
                      <div className="robot-specs">
                        <span>
                          <strong>{robot.maxSpeed.toFixed(1)}</strong>m/s
                        </span>
                        <span>
                          <strong>{robot.mass}</strong>kg
                        </span>
                        <span>
                          <strong>{robot.width.toFixed(2)}</strong>m wide
                        </span>
                      </div>
                      <button
                        className={
                          robot.id === session.profile.robot.id
                            ? "secondary full"
                            : "primary full"
                        }
                        disabled={locked}
                        onClick={() => {
                          changeProfile({
                            ...session.profile,
                            robot: structuredClone(robot),
                            controlFrame:
                              robot.kind === "differential" ? "robot" : "field",
                          });
                          setToast(`${robot.name} selected.`);
                        }}
                      >
                        {robot.id === session.profile.robot.id
                          ? "Selected robot"
                          : "Select robot"}
                        <ArrowRight size={16} />
                      </button>
                      <p className="micro">
                        Generic, uncalibrated preset · v{robot.version}
                      </p>
                    </div>
                  </article>
                ))}
              </div>
              <div className="station-strip">
                <Gauge size={24} />
                <div>
                  <strong>Physics you can feel. Limits you should know.</strong>
                  <p>
                    Force-based motion models inertia, traction, steering
                    response, coasting, and contact. Real-robot calibration is
                    still required.
                  </p>
                </div>
                <button className="secondary" onClick={() => begin("free")}>
                  Try your robot <ArrowUpRight size={16} />
                </button>
              </div>
            </>
          )}
          {(page === "practice" || page === "assessment") && (
            <>
              <PageTitle
                eyebrow={
                  page === "practice"
                    ? "DELIBERATE PRACTICE"
                    : "CONSISTENT CONDITIONS. USEFUL EVIDENCE."
                }
                title={
                  page === "practice"
                    ? "Small skills. Stronger driving."
                    : "Put your control to the test."
                }
                description={
                  page === "practice"
                    ? "Learn each course with the same targets and room to repeat."
                    : "Record every attempt, review the raw metrics, and compare only matching profiles."
                }
                action={
                  page === "practice" ? (
                    <button className="secondary" onClick={() => begin("free")}>
                      <Gamepad2 size={17} /> Free drive
                    </button>
                  ) : (
                    <Badge tone="warning">Provisional assessment</Badge>
                  )
                }
              />
              {page === "assessment" && (
                <>
                  <div className="assessment-banner">
                    <div>
                      <h2>
                        {driver?.name}{" "}
                        <span className="muted">
                          /{" "}
                          {session.suite === "screening"
                            ? "Screening"
                            : "Full assessment"}
                        </span>
                      </h2>
                      <p>
                        {session.suite === "screening"
                          ? "One trial per skill. Preliminary scores; no Core index or repeatability."
                          : "Three trials per skill. Median scores, Core index, and separate repeatability."}
                      </p>
                      <div className="assessment-progress">
                        <progress
                          max={session.suite === "screening" ? 6 : 18}
                          value={scoredCount}
                        />
                        <span>
                          {scoredCount} /{" "}
                          {session.suite === "screening" ? 6 : 18} recorded
                        </span>
                      </div>
                    </div>
                    <label>
                      Protocol
                      <select
                        disabled={locked}
                        value={session.suite}
                        onChange={(e) =>
                          setSession((s) => ({
                            ...s,
                            suite: e.target.value as Session["suite"],
                          }))
                        }
                      >
                        <option value="screening">
                          Screening · 1 trial / skill
                        </option>
                        <option value="full">Full · 3 trials / skill</option>
                      </select>
                    </label>
                  </div>
                  <div className="protocol-steps">
                    <span>
                      <b>01</b> Familiarize{" "}
                      {exposure >= 180 || exposureOverride ? (
                        <Check size={15} />
                      ) : (
                        <small>{Math.floor(exposure)} / 180 s</small>
                      )}
                    </span>
                    <span>
                      <b>02</b> Practice each skill
                    </span>
                    <span>
                      <b>03</b> Record scheduled trials
                    </span>
                    <span>
                      <b>04</b> Export & rotate
                    </span>
                  </div>
                  {invalidBlocked && (
                    <div className="notice warning">
                      Repeated technical invalidations stopped this driver’s
                      qualified workflow. Export the record, resolve the station
                      issue, and start a new session.
                    </div>
                  )}
                  {scoredCount > 0 && scoredCount % 6 === 0 && next && (
                    <div className="notice">
                      Round complete. Take a planned break before the next
                      six-trial block.
                    </div>
                  )}
                </>
              )}
              <div className="course-grid">
                {TEST_CATALOG.map((test) => {
                  const a = outcome.filter(
                    (a) =>
                      a.testId === test.id &&
                      a.profile.hash === session.profile.hash &&
                      (a.status === "completed" || a.status === "dnf"),
                  );
                  const practiced = practiceEvidence(session, test.id).ready;
                  const isNext = next?.testId === test.id;
                  return (
                    <article
                      className={`course-card ${page === "assessment" && isNext ? "next" : ""}`}
                      key={test.id}
                    >
                      <div className="course-card-head">
                        <span className="tile-icon">
                          <TestIcon id={test.id} />
                        </span>
                        <span className="course-id">{test.id}</span>
                        {page === "assessment" && isNext && (
                          <Badge tone="green">Up next</Badge>
                        )}
                      </div>
                      <h3>{test.name}</h3>
                      <p>{test.description}</p>
                      <div className="course-meta">
                        <span>
                          <Clock3 size={13} />
                          {test.id === "T03" || test.id === "T05"
                            ? "45"
                            : "60"}{" "}
                          s limit
                        </span>
                        <span>{test.skill}</span>
                      </div>
                      {page === "practice" ? (
                        <button
                          className="secondary full"
                          onClick={() => begin("practice", test.id)}
                        >
                          Practice this skill <ArrowUpRight size={16} />
                        </button>
                      ) : (
                        <>
                          <div className="trial-dots">
                            {Array.from(
                              { length: session.suite === "screening" ? 1 : 3 },
                              (_, i) => {
                                const attempt = a.find(
                                  (v) => v.scheduledTrial === i + 1,
                                );
                                return (
                                  <span
                                    key={i}
                                    className={attempt ? "done" : ""}
                                  >
                                    Trial {i + 1}{" "}
                                    <b>
                                      {attempt?.score.score?.toFixed(1) ?? "—"}
                                    </b>
                                  </span>
                                );
                              },
                            )}
                          </div>
                          <div className="button-row">
                            <button
                              className="secondary compact"
                              disabled={practiced && !exposureOverride}
                              onClick={() => begin("practice", test.id)}
                            >
                              {practiced ? (
                                <Check size={14} />
                              ) : (
                                <Gamepad2 size={14} />
                              )}
                              Practice
                            </button>
                            <button
                              className={
                                isNext ? "primary compact" : "secondary compact"
                              }
                              disabled={!isNext || invalidBlocked}
                              onClick={() =>
                                begin("scored", test.id, next?.trial ?? 1)
                              }
                            >
                              Record{" "}
                              {next?.testId === test.id
                                ? `trial ${next.trial}`
                                : ""}
                              <ChevronRight size={14} />
                            </button>
                          </div>
                        </>
                      )}
                    </article>
                  );
                })}
              </div>
              {page === "assessment" && (
                <div className="station-strip">
                  <FileText />
                  <div>
                    <strong>
                      {summary.eligible
                        ? "This driver’s scheduled suite is complete."
                        : "Every attempt stays in the record."}
                    </strong>
                    <p>
                      DNF counts as zero. Technical invalidations are excluded,
                      with one replacement per scheduled trial.
                    </p>
                  </div>
                  <button
                    className="secondary"
                    onClick={() => setPage("reports")}
                  >
                    Review report <ArrowRight size={15} />
                  </button>
                </div>
              )}
            </>
          )}
          {page === "setup" && (
            <>
              <Setup
                profile={session.profile}
                locked={locked}
                onChange={changeProfile}
                onCheck={() => setBenchmark(true)}
                notice={setToast}
              />
              {benchmarkReport && (
                <section className="panel benchmark-report">
                  <h2>Latest station measurement</h2>
                  <pre>{benchmarkReport}</pre>
                  <button
                    className="secondary"
                    onClick={() =>
                      downloadFile(
                        benchmarkReport,
                        "driver-lab-station-check.txt",
                        "text/plain",
                      )
                    }
                  >
                    Download measurements
                  </button>
                </section>
              )}
            </>
          )}
          {page === "session" && (
            <>
              <PageTitle
                eyebrow="COACH WORKSPACE"
                title="One station. Your whole team."
                description="Rotate drivers while keeping the same comparison profile."
                action={
                  <button
                    className="secondary danger"
                    onClick={() => setConfirmClear(true)}
                  >
                    <Trash2 size={17} /> End session & clear
                  </button>
                }
              />
              <div className="session-grid">
                <section className="panel">
                  <h2>
                    Session roster{" "}
                    <span className="count">{session.drivers.length}</span>
                  </h2>
                  <div className="form-row">
                    <label>
                      Session label
                      <input
                        value={session.label}
                        maxLength={300}
                        onChange={(e) =>
                          setSession((s) => ({ ...s, label: e.target.value }))
                        }
                      />
                    </label>
                  </div>
                  <form
                    className="add-driver"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!newName.trim() || session.drivers.length >= 100)
                        return;
                      const d = {
                        id: crypto.randomUUID(),
                        name: newName.trim(),
                        notes: "",
                      };
                      setSession((s) => ({
                        ...s,
                        drivers: [...s.drivers, d],
                        activeDriverId: d.id,
                      }));
                      setNewName("");
                    }}
                  >
                    <input
                      aria-label="New driver name"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      maxLength={300}
                      placeholder="Add driver alias or name"
                    />
                    <button className="primary" type="submit">
                      <Plus size={18} /> Add driver
                    </button>
                  </form>
                  <div className="roster-list">
                    {session.drivers.map((d, i) => (
                      <button
                        key={d.id}
                        className={d.id === driver?.id ? "selected" : ""}
                        onClick={() =>
                          setSession((s) => ({ ...s, activeDriverId: d.id }))
                        }
                      >
                        <span className="avatar">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <div>
                          <strong>{d.name}</strong>
                          <small>
                            {
                              session.results.filter(
                                (a) =>
                                  a.driverId === d.id &&
                                  a.status !== "practice",
                              ).length
                            }{" "}
                            recorded attempts
                          </small>
                        </div>
                        {d.id === driver?.id ? (
                          <Badge tone="green">Active driver</Badge>
                        ) : (
                          <ChevronRight size={17} />
                        )}
                      </button>
                    ))}
                  </div>
                </section>
                <div className="stack">
                  <section className="panel">
                    <h2>
                      <ShieldCheck size={20} /> Session recovery
                    </h2>
                    <p>
                      Roster, settings, notes, and results are saved in this
                      browser tab. Recovery expires eight hours after the
                      session began.
                    </p>
                    <p className="micro">
                      Created {new Date(session.createdAt).toLocaleTimeString()}{" "}
                      · Expires{" "}
                      {new Date(session.expiresAt).toLocaleTimeString()}
                      <br />
                      Replay paths remain in memory only. Downloaded files stay
                      on the computer until deleted.
                    </p>
                    <button
                      className="secondary full"
                      onClick={() => {
                        try {
                          downloadFile(
                            exportSession(session),
                            "driver-lab-session.json",
                            "application/json",
                          );
                        } catch (e) {
                          setToast((e as Error).message);
                        }
                      }}
                    >
                      <ArrowDownToLine size={16} /> Export session JSON
                    </button>
                    <button
                      className="text-button"
                      onClick={() => file.current?.click()}
                    >
                      Import a saved session
                    </button>
                    <input
                      type="file"
                      accept="application/json,.json"
                      hidden
                      ref={file}
                      onChange={(e) => {
                        if (e.target.files?.[0]) upload(e.target.files[0]);
                        e.target.value = "";
                      }}
                    />
                  </section>
                  <section className="panel">
                    <h2>Comparison group</h2>
                    <p>
                      {session.profile.robot.name} ·{" "}
                      {session.profile.controlFrame} relative ·{" "}
                      {session.profile.inputClass}
                    </p>
                    <code className="profile-code">{session.profile.hash}</code>
                    <p className="micro">
                      Camera, graphics, bindings, assistance, versions, and
                      display context form the comparison profile. Different
                      profiles are never combined into a ranking.
                    </p>
                    <button
                      className="secondary full"
                      onClick={() => setPage("reports")}
                    >
                      Export driver reports <ArrowUpRight size={15} />
                    </button>
                  </section>
                </div>
              </div>
            </>
          )}
          {page === "reports" && (
            <Reports
              session={session}
              notice={setToast}
              onNotes={(id, notes) =>
                setSession((s) => ({
                  ...s,
                  drivers: s.drivers.map((d) =>
                    d.id === id ? { ...d, notes } : d,
                  ),
                }))
              }
            />
          )}
          {page === "guide" && (
            <>
              <PageTitle
                eyebrow="COACH & STUDENT QUICK GUIDE"
                title="A better rep starts here."
                description="Keep the setup consistent and the feedback concrete."
              />
              <div className="guide-grid">
                <section className="panel">
                  <h2>For the driver</h2>
                  <ol>
                    <li>
                      Select a robot in the garage. Start with three minutes of
                      free drive.
                    </li>
                    <li>
                      Use W/S to move forward/back, A/D to strafe (or steer
                      differential), and Q/E to rotate. Shift holds precision
                      mode; Space brakes.
                    </li>
                    <li>
                      In field-relative mode, translation follows the field. In
                      robot-relative mode, it follows the robot’s front marker.
                    </li>
                    <li>
                      Practice each skill before recording. Read the opening
                      instructions; the green target is active.
                    </li>
                    <li>
                      Review a raw metric and choose one thing to improve before
                      your next rep.
                    </li>
                  </ol>
                  <button className="primary" onClick={() => begin("free")}>
                    Start free drive <ArrowRight size={16} />
                  </button>
                </section>
                <section className="panel">
                  <h2>For the coach</h2>
                  <ol>
                    <li>
                      Record the physical station and input connection in Setup.
                      Calibrate every mapped controller axis.
                    </li>
                    <li>
                      Run the station check and choose the highest graphics tier
                      with stable frame pacing. Use the same settings across
                      drivers.
                    </li>
                    <li>
                      Choose screening (six trials) or full assessment (18).
                      Follow the published rotated schedule and take breaks
                      between full-suite rounds.
                    </li>
                    <li>
                      Student abort, timeout, or unmet conditions are DNF,
                      scoring zero. Technical invalidations receive one
                      replacement per trial.
                    </li>
                    <li>
                      Review all outcomes, add notes, download the batch PDF,
                      then end and clear the session.
                    </li>
                  </ol>
                </section>
                <section className="panel">
                  <h2>What a score means</h2>
                  <p>
                    Scores use published metric anchors and weights. Completed
                    attempts lose 4 points per minor contact, 12 per major
                    contact, and 8 per corridor departure, capped at 40.
                  </p>
                  <p>
                    Full assessment uses the median of three trials per skill.
                    The Core index requires all six skill scores. Repeatability
                    measures score spread separately.
                  </p>
                  <p>
                    Screening is preliminary. The rubric and robot presets have
                    not been calibrated against real robots or validated with
                    students.
                  </p>
                </section>
                <section className="panel">
                  <h2>Local by design</h2>
                  <p>
                    No account, application backend, or runtime AI. Reports and
                    scoring run locally. Production builds cache application
                    files for offline use after a successful first load.
                  </p>
                  <p>
                    Browser and OS controller support vary. USB compatibility,
                    physical input latency, Windows behavior, and real-robot
                    fidelity require testing on the actual station.
                  </p>
                  <p>
                    Hardware qualification and coach observations are essential
                    parts of the assessment context.
                  </p>
                </section>
              </div>
            </>
          )}
        </main>
        <footer className="app-footer">
          <span>FRC DRIVER LAB</span>
          <span>Purposeful practice. Measurable progress.</span>
          <button onClick={() => setPage("guide")}>
            About this release <ArrowUpRight size={12} />
          </button>
        </footer>
      </div>
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button
            className="icon-button"
            onClick={() => setToast("")}
            aria-label="Dismiss notice"
          >
            <X size={17} />
          </button>
        </div>
      )}
      {expiryPrompt && (
        <dialog
          ref={expiryDialog}
          className="confirm-modal expiry-dialog"
          role="alertdialog"
          aria-labelledby="expiry-title"
          aria-describedby="expiry-description"
          onClose={() => setExpiryPrompt(false)}
        >
          <h2 id="expiry-title">Start a fresh session to drive.</h2>
          <p id="expiry-description">
            This tab’s eight-hour session has expired. Free Drive, practice, and
            assessments need a new session. Your current results and notes are
            still available to export.
          </p>
          <div className="button-row">
            <button
              className="secondary"
              autoFocus
              onClick={() => {
                setExpiryPrompt(false);
                setPage("reports");
              }}
            >
              Review reports
            </button>
            <button
              className="primary"
              onClick={() => {
                setExpiryPrompt(false);
                setConfirmClear(true);
              }}
            >
              End expired session
            </button>
          </div>
        </dialog>
      )}
      {confirmClear && (
        <div className="modal-backdrop">
          <section className="confirm-modal">
            <Trash2 size={28} />
            <h2>End this session?</h2>
            <p>
              This clears the roster, results, notes, and recovery record.
              Download your reports first. Exported files will remain on the
              computer.
            </p>
            <div className="button-row">
              <button
                className="secondary"
                onClick={() => setConfirmClear(false)}
              >
                Keep session
              </button>
              <button
                className="primary"
                onClick={() => {
                  clear();
                  if (updateReady)
                    window.dispatchEvent(new Event("driver-lab-apply-update"));
                }}
              >
                End & clear
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
