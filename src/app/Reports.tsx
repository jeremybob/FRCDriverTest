import { useEffect, useMemo, useState } from "react";
import { Download, Play, Printer, Users } from "lucide-react";
import type { Attempt, Session } from "../types";
import { buildReportModel, generatePdf, printReport } from "../reports";
import { formatMetric, METRIC_UNITS, profileLines } from "../reports/model";
import { Badge, Empty, PageTitle, TestIcon } from "./components";
export function downloadFile(data: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function Replay({ attempt }: { attempt: Attempt }) {
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const samples = attempt.replay ?? [];
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(
      () =>
        setPosition((p) => {
          if (p >= samples.length - 1) {
            setPlaying(false);
            return p;
          }
          return p + 1;
        }),
      1000 / 30,
    );
    return () => clearInterval(timer);
  }, [playing, samples.length]);
  if (!samples.length)
    return (
      <p className="micro">
        Replay is available in the current session only. Raw metrics and results
        survive reload.
      </p>
    );
  const current = samples[Math.min(position, samples.length - 1)];
  return (
    <div className="replay">
      <svg
        viewBox="0 0 640 320"
        role="img"
        aria-label="Recorded overhead driving path"
      >
        <rect
          x="1"
          y="1"
          width="638"
          height="318"
          rx="4"
          fill="#263d40"
          stroke="#718781"
        />
        <path
          d={samples
            .map(
              (s, i) =>
                `${i && s.checkpoint === samples[i - 1].checkpoint ? "L" : "M"}${s.x * 40},${320 - s.y * 40}`,
            )
            .join(" ")}
          fill="none"
          stroke="#b8e78a"
          strokeWidth="2"
        />
        <g
          transform={`translate(${current.x * 40},${320 - current.y * 40}) rotate(${(-current.yaw * 180) / Math.PI})`}
        >
          <rect x="-17" y="-17" width="34" height="34" rx="4" fill="#e9f0df" />
          <path
            d="m5 -8 9 8-9 8"
            stroke="#274b48"
            strokeWidth="3"
            fill="none"
          />
        </g>
      </svg>
      <button
        className="secondary compact"
        onClick={() => {
          if (position >= samples.length - 1) setPosition(0);
          setPlaying(!playing);
        }}
      >
        <Play size={13} />
        {playing ? "Pause replay" : "Play replay"}
      </button>
      <label>
        Replay position · {(current.tick / 120).toFixed(2)} s
        <input
          aria-label="Replay position"
          type="range"
          min="0"
          max={samples.length - 1}
          value={position}
          onChange={(e) => setPosition(+e.target.value)}
        />
      </label>
      <div className="micro">
        Recorded input: forward {current.xInput.toFixed(2)} · left{" "}
        {current.yInput.toFixed(2)} · turn {current.turnInput.toFixed(2)} ·
        checkpoint {current.checkpoint + 1}
      </div>
    </div>
  );
}
export function AttemptDetails({ attempt }: { attempt: Attempt }) {
  return (
    <details className="attempt-detail">
      <summary>
        <span>
          <b>{attempt.testId}</b> Trial {attempt.scheduledTrial}{" "}
          <Badge tone={attempt.status === "invalid" ? "warning" : ""}>
            {attempt.status}
          </Badge>
        </span>
        <strong>{attempt.score.score?.toFixed(1) ?? "—"}</strong>
      </summary>
      <div className="attempt-content">
        <p>{attempt.cause || attempt.score.explanation}</p>
        <p className="micro">
          {new Date(attempt.startedAt).toLocaleString()} · Profile{" "}
          {attempt.profile.hash} · {attempt.durationTicks} ticks ·{" "}
          {attempt.wallDuration.toFixed(2)} s wall time
        </p>
        <div className="metrics-table">
          {Object.entries(attempt.metrics).map(([key, value]) => (
            <div key={key}>
              <span>{key.replace(/([A-Z])/g, " $1")}</span>
              <b>{formatMetric(value, METRIC_UNITS[key])}</b>
            </div>
          ))}
        </div>
        {attempt.score.components.length > 0 && (
          <>
            <h4>How the score was calculated</h4>
            <table>
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>Good / weak</th>
                  <th>Normalized</th>
                  <th>Weight</th>
                  <th>Points</th>
                </tr>
              </thead>
              <tbody>
                {attempt.score.components.map((c) => (
                  <tr key={c.metric}>
                    <td>{c.label}</td>
                    <td>
                      {c.good} / {c.weak} {c.unit}
                    </td>
                    <td>{c.normalized.toFixed(2)}</td>
                    <td>{Math.round(c.weight * 100)}%</td>
                    <td>{c.contribution.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              <b>{attempt.score.base?.toFixed(2)}</b> base −{" "}
              <b>{attempt.score.penalty.toFixed(2)}</b> penalty ={" "}
              <b>{attempt.score.score?.toFixed(2)}</b> / 100
            </p>
          </>
        )}
        <Replay attempt={attempt} />
        <details>
          <summary>Events & performance</summary>
          <p className="micro">
            Frame p95 {attempt.performance.frameP95.toFixed(2)} ms · Physics p95{" "}
            {attempt.performance.physicsP95.toFixed(2)} ms · Max frame{" "}
            {attempt.performance.maxFrame.toFixed(1)} ms
          </p>
          <ul className="event-list">
            {attempt.events.map((e, i) => (
              <li key={i}>
                Tick {e.tick}: {e.type} {e.source} {e.message}
                {e.value !== undefined ? ` (${e.value.toFixed(3)})` : ""}
              </li>
            ))}
          </ul>
        </details>
      </div>
    </details>
  );
}
export function Reports({
  session,
  onNotes,
  notice,
}: {
  session: Session;
  onNotes: (id: string, notes: string) => void;
  notice: (s: string) => void;
}) {
  const [selected, setSelected] = useState(session.activeDriverId);
  const [pageSize, setPageSize] = useState<"letter" | "a4">("letter");
  const [busy, setBusy] = useState(false);
  const report = useMemo(() => buildReportModel(session), [session]);
  const driver =
    report.drivers.find((d) => d.id === selected) ?? report.drivers[0];
  const pdf = async (batch = false) => {
    setBusy(true);
    try {
      const model = buildReportModel(session, batch ? undefined : [driver!.id]);
      const data = await generatePdf(model, pageSize);
      downloadFile(
        new Uint8Array(data).buffer,
        batch ? "driver-lab-session.pdf" : "driver-lab-report.pdf",
        "application/pdf",
      );
      notice("PDF generated locally and downloaded.");
    } catch (e) {
      notice(`PDF export failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageTitle
        eyebrow="RESULTS & REFLECTION"
        title="Every rep tells a story."
        description="Review the evidence, choose a next drill, and take the report with you."
        action={
          <button
            className="secondary"
            disabled={busy || !driver}
            onClick={() => pdf(true)}
          >
            <Users size={17} /> Batch PDF
          </button>
        }
      />
      <div className="report-toolbar">
        <label>
          Driver
          <select
            value={driver?.id ?? ""}
            onChange={(e) => setSelected(e.target.value)}
          >
            {session.drivers.map((d) => (
              <option value={d.id} key={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Paper
          <select
            value={pageSize}
            onChange={(e) => setPageSize(e.target.value as "letter" | "a4")}
          >
            <option value="letter">US Letter</option>
            <option value="a4">A4</option>
          </select>
        </label>
        <span className="spacer" />
        <button
          className="secondary"
          disabled={!driver || busy}
          onClick={() => {
            try {
              printReport(buildReportModel(session, [driver!.id]), pageSize);
            } catch (e) {
              notice((e as Error).message);
            }
          }}
        >
          <Printer size={16} /> Print
        </button>
        <button
          className="primary"
          disabled={!driver || busy}
          onClick={() => pdf()}
        >
          <Download size={17} />
          {busy ? "Preparing PDF…" : "Download PDF"}
        </button>
      </div>
      {driver ? (
        <>
          <article className="report-paper">
            <div className="report-heading">
              <div>
                <p className="eyebrow">FRC DRIVER LAB / DRIVER REPORT</p>
                <h2>{driver.name}</h2>
                <p>
                  {session.label} ·{" "}
                  {new Date(session.createdAt).toLocaleDateString()}
                </p>
              </div>
              <div>
                <Badge tone="warning">Provisional {session.suite}</Badge>
                <p className="micro">
                  {driver.assessment.eligible ? "Complete" : "Incomplete"} ·{" "}
                  {session.profile.hash}
                </p>
              </div>
            </div>
            <p className="report-context">
              {session.profile.robot.name} / {session.profile.controlFrame}{" "}
              relative / {session.profile.inputClass} /{" "}
              {session.profile.graphicsTier} graphics
            </p>
            <div className="score-list">
              {driver.assessment.skills.map((skill) => (
                <div className="skill-row" key={skill.testId}>
                  <TestIcon id={skill.testId} />
                  <div>
                    <strong>{skill.name}</strong>
                    <small>
                      {skill.trials.length
                        ? `${skill.completed} completed · trials ${skill.trials.map((n) => n.toFixed(1)).join(" / ")} · ${skill.contacts} contacts`
                        : "Not attempted"}
                    </small>
                  </div>
                  <div className="score-track">
                    <span style={{ width: `${skill.score ?? 0}%` }} />
                  </div>
                  <b>{skill.score?.toFixed(1) ?? "—"}</b>
                </div>
              ))}
            </div>
            <div className="aggregate-row">
              <div>
                <small>Core index</small>
                <strong>
                  {driver.assessment.coreIndex?.toFixed(1) ?? "—"}
                </strong>
              </div>
              <div>
                <small>Repeatability</small>
                <strong>
                  {driver.assessment.consistency?.toFixed(1) ?? "—"}
                </strong>
              </div>
              <p>
                {driver.assessment.reason}{" "}
                {session.suite === "full"
                  ? "Repeatability describes score consistency, not proficiency."
                  : ""}
              </p>
            </div>
            <div className="report-columns">
              <section>
                <h3>Next practice priorities</h3>
                {driver.assessment.recommendations.map((s, i) => (
                  <p className="drill-advice" key={s}>
                    <span>0{i + 1}</span>
                    {s}
                  </p>
                ))}
              </section>
              <section>
                <h3>Coach observations</h3>
                <textarea
                  aria-label="Coach notes"
                  rows={5}
                  maxLength={10000}
                  value={driver.notes}
                  placeholder="Add concrete observations about control, judgment, or communication…"
                  onChange={(e) => onNotes(driver.id, e.target.value)}
                />
              </section>
            </div>
            <p className="report-disclaimer">{report.disclaimer}</p>
          </article>
          <section className="panel attempts-panel">
            <h2>
              Attempt history{" "}
              <span className="count">{driver.attempts.length}</span>
            </h2>
            <p className="subtext">
              All outcomes are retained. Practice and technical invalidations
              are excluded from scores.
            </p>
            {driver.attempts.length ? (
              driver.attempts.map((a) => (
                <AttemptDetails
                  attempt={{
                    ...a,
                    replay: session.results.find((result) => result.id === a.id)
                      ?.replay,
                  }}
                  key={a.id}
                />
              ))
            ) : (
              <Empty>Your first attempt will appear here.</Empty>
            )}
          </section>
          <details className="panel">
            <summary>Comparison profile & versions</summary>
            {profileLines(session.profile).map((line) => (
              <p className="micro" key={line}>
                {line}
              </p>
            ))}
          </details>
        </>
      ) : (
        <Empty>Add a driver to create a report.</Empty>
      )}
    </>
  );
}
