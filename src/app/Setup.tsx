import { useEffect, useState } from "react";
import {
  Check,
  ChevronDown,
  Gamepad2,
  Keyboard,
  Monitor,
  RotateCcw,
  SlidersHorizontal,
} from "lucide-react";
import type { InputSettings, Profile } from "../types";
import { calibrateAxes, defaultInputSettings, InputManager } from "../input";
import type { InputDiagnostics } from "../input";
import { Badge, PageTitle } from "./components";
interface Props {
  profile: Profile;
  locked: boolean;
  onChange: (p: Profile) => void;
  onCheck: () => void;
  notice: (s: string) => void;
}
export function Setup({ profile, locked, onChange, onCheck, notice }: Props) {
  const [input, setInput] = useState(structuredClone(profile.input));
  const [diag, setDiag] = useState<InputDiagnostics | null>(null);
  const [capture, setCapture] = useState<"neutral" | "travel" | null>(null);
  const [samples, setSamples] = useState<{
    neutral: number[][];
    travel: number[][];
  }>({ neutral: [], travel: [] });
  const [keyBind, setKeyBind] = useState<keyof InputSettings["keys"] | null>(
    null,
  );
  useEffect(() => {
    const manager = new InputManager(input, profile.robot.kind, () => {});
    const t = setInterval(() => {
      manager.sample(0.05);
      const d = manager.diagnostics();
      setDiag(d);
      if (capture && d.connected && d.rawAxes.length)
        setSamples((prev) => ({
          ...prev,
          [capture]: [...prev[capture].slice(-199), d.rawAxes],
        }));
    }, 50);
    return () => {
      clearInterval(t);
      manager.dispose();
    };
  }, [input, profile.robot.kind, capture]);
  const editInput = (patch: Partial<InputSettings>) => {
    const next = { ...input, ...patch };
    setInput(next);
    onChange({ ...profile, input: next });
  };
  useEffect(() => {
    if (!keyBind) return;
    const listener = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (
        Object.entries(input.keys).some(
          ([k, v]) => k !== keyBind && v === e.code,
        )
      ) {
        notice("That key is already mapped. Choose another key.");
        return;
      }
      editInput({ keys: { ...input.keys, [keyBind]: e.code } });
      setKeyBind(null);
    };
    window.addEventListener("keydown", listener, true);
    return () => window.removeEventListener("keydown", listener, true);
  }, [keyBind, input]);
  const finishCalibration = () => {
    try {
      const c = calibrateAxes(samples.neutral, samples.travel);
      const required = [
        input.axes.x,
        input.axes.turn,
        ...(profile.robot.kind === "differential"
          ? input.tank
            ? [input.axes.right]
            : []
          : [input.axes.y]),
      ];
      if (required.some((i) => (c.observedRanges[i] ?? 0) < 0.65))
        throw new Error(
          "Move every mapped drive axis through its full travel before saving.",
        );
      editInput({
        centers: c.centers,
        ranges: c.ranges,
        deadzone: c.deadzone,
        calibrated: true,
      });
      setCapture(null);
      notice("Calibration saved. Verify direction and buttons in free drive.");
    } catch (e) {
      notice((e as Error).message);
    }
  };
  return (
    <>
      <PageTitle
        eyebrow="STATION CONFIGURATION"
        title="Make it feel right."
        description="Set your controls, verify the station, and keep conditions consistent."
        action={
          <Badge tone={locked ? "warning" : "green"}>
            {locked ? "Profile locked" : "Editable profile"}
          </Badge>
        }
      />
      {locked && (
        <div className="notice">
          This session contains scored attempts. End the session to change
          comparison settings. Reports retain each attempt’s original profile.
        </div>
      )}
      <div className="setup-grid">
        <section className="panel">
          <div className="section-heading">
            <h2>
              <Gamepad2 size={20} /> Input & calibration
            </h2>
            <Badge tone={diag?.connected ? "green" : "warning"}>
              {diag?.connected ? "Connected" : "Waiting for device"}
            </Badge>
          </div>
          <fieldset disabled={locked}>
            <div className="segmented">
              <button
                className={input.device === "keyboard" ? "selected" : ""}
                onClick={() =>
                  editInput({ device: "keyboard", calibrated: true })
                }
              >
                <Keyboard size={18} /> Keyboard
              </button>
              <button
                className={input.device === "gamepad" ? "selected" : ""}
                onClick={() =>
                  editInput({ device: "gamepad", calibrated: false })
                }
              >
                <Gamepad2 size={18} /> Gamepad
              </button>
            </div>
            {input.device === "gamepad" && (
              <>
                <p className="subtext">
                  Connect a controller, focus this window, then press a button.
                  Browser detection does not verify USB transport.
                </p>
                <div className="form-row">
                  <label>
                    Device slot
                    <input
                      type="number"
                      min="0"
                      max="7"
                      value={input.gamepadIndex}
                      onChange={(e) =>
                        editInput({
                          gamepadIndex: +e.target.value,
                          calibrated: false,
                        })
                      }
                    />
                  </label>
                  <label>
                    Connection declared
                    <select
                      value={input.transport}
                      onChange={(e) => editInput({ transport: e.target.value })}
                    >
                      <option>Unconfirmed</option>
                      <option>USB (coach confirmed)</option>
                      <option>Bluetooth (coach confirmed)</option>
                    </select>
                  </label>
                </div>
              </>
            )}
            <div className="device-monitor">
              <span className="status-dot" />
              <div>
                <strong>{diag?.name || "Detecting input"}</strong>
                <small>
                  {diag?.mapping || "No controller sample"} ·{" "}
                  {diag?.neutral ? "Controls neutral" : "Input active"}
                </small>
              </div>
            </div>
            <div className="input-visual">
              <div className="stick-well">
                <span
                  style={{
                    left: `${50 + (diag?.rawAxes[input.device === "keyboard" ? 1 : input.axes.y] ?? 0) * 34}%`,
                    top: `${50 + (diag?.rawAxes[input.device === "keyboard" ? 0 : input.axes.x] ?? 0) * 34}%`,
                  }}
                />
                <i />
              </div>
              <div className="axis-list">
                {(diag?.rawAxes ?? []).slice(0, 8).map((v, i) => (
                  <div className="axis" key={i}>
                    <span>Axis {i}</span>
                    <meter min="-1" max="1" value={v} />
                    <code>{v.toFixed(2)}</code>
                  </div>
                ))}
              </div>
            </div>
            {input.device === "gamepad" && (
              <>
                <div className="button-diagnostics">
                  {diag?.rawButtons.map((v, i) => (
                    <span key={i} className={v > 0.2 ? "active" : ""}>
                      B{i}
                    </span>
                  ))}
                </div>
                <div className="calibration-actions">
                  <button
                    className={capture === "neutral" ? "primary" : "secondary"}
                    onClick={() => {
                      setSamples({ neutral: [], travel: [] });
                      setCapture("neutral");
                    }}
                  >
                    1. Capture neutral
                  </button>
                  <button
                    className={capture === "travel" ? "primary" : "secondary"}
                    disabled={!samples.neutral.length}
                    onClick={() => setCapture("travel")}
                  >
                    2. Capture full travel
                  </button>
                  <button
                    className="secondary"
                    disabled={!samples.travel.length}
                    onClick={finishCalibration}
                  >
                    3. Save calibration
                  </button>
                </div>
                <p className="micro">
                  {capture === "neutral"
                    ? "Leave sticks untouched for at least one second."
                    : capture === "travel"
                      ? "Sweep all mapped sticks fully in both directions, then save."
                      : input.calibrated
                        ? "Calibration saved for this mapping."
                        : "Capture neutral drift, then full travel."}{" "}
                  {samples.neutral.length} neutral / {samples.travel.length}{" "}
                  travel samples
                </p>
              </>
            )}
            <div className="form-row">
              <label>
                Deadzone <b>{input.deadzone.toFixed(2)}</b>
                <input
                  type="range"
                  min="0"
                  max="0.35"
                  step="0.01"
                  value={input.deadzone}
                  onChange={(e) => editInput({ deadzone: +e.target.value })}
                />
              </label>
              <label>
                Response exponent <b>{input.exponent.toFixed(1)}</b>
                <input
                  type="range"
                  min="0.5"
                  max="3"
                  step="0.1"
                  value={input.exponent}
                  onChange={(e) => editInput({ exponent: +e.target.value })}
                />
              </label>
            </div>
            {input.device === "keyboard" && (
              <label>
                Keyboard ramp · {input.ramp.toFixed(2)} s
                <input
                  type="range"
                  min="0.05"
                  max="0.6"
                  step="0.01"
                  value={input.ramp}
                  onChange={(e) => editInput({ ramp: +e.target.value })}
                />
              </label>
            )}
            <details>
              <summary>
                Remap controls <ChevronDown size={16} />
              </summary>
              {input.device === "keyboard" ? (
                <div className="key-grid">
                  {Object.entries(input.keys).map(([k, v]) => (
                    <button
                      className="key-binding"
                      key={k}
                      onClick={() =>
                        setKeyBind(k as keyof InputSettings["keys"])
                      }
                    >
                      <span>{k.replace(/([A-Z])/g, " $1")}</span>
                      <kbd>
                        {keyBind === k
                          ? "Press a key…"
                          : v.replace("Key", "").replace("Arrow", "")}
                      </kbd>
                    </button>
                  ))}
                </div>
              ) : (
                <>
                  <div className="binding-grid">
                    {Object.entries(input.axes).map(([k, v]) => (
                      <div key={k}>
                        <label>
                          {k} axis
                          <input
                            type="number"
                            min="0"
                            max="15"
                            value={v}
                            onChange={(e) =>
                              editInput({
                                axes: { ...input.axes, [k]: +e.target.value },
                                calibrated: false,
                              })
                            }
                          />
                        </label>
                        <label className="check-label">
                          <input
                            type="checkbox"
                            checked={
                              input.invert[k as keyof typeof input.invert]
                            }
                            onChange={(e) =>
                              editInput({
                                invert: {
                                  ...input.invert,
                                  [k]: e.target.checked,
                                },
                              })
                            }
                          />{" "}
                          Invert
                        </label>
                      </div>
                    ))}
                  </div>
                  <div className="form-row">
                    {Object.entries(input.buttons).map(([k, v]) => (
                      <label key={k}>
                        {k} button
                        <input
                          type="number"
                          min="0"
                          max="31"
                          value={v}
                          onChange={(e) =>
                            editInput({
                              buttons: {
                                ...input.buttons,
                                [k]: +e.target.value,
                              },
                            })
                          }
                        />
                      </label>
                    ))}
                  </div>
                </>
              )}
              <button
                className="text-button"
                onClick={() => editInput(structuredClone(defaultInputSettings))}
              >
                <RotateCcw size={14} /> Restore default bindings
              </button>
            </details>
          </fieldset>
        </section>
        <div className="stack">
          <section className="panel">
            <h2>
              <SlidersHorizontal size={20} /> Driving profile
            </h2>
            <fieldset disabled={locked}>
              {profile.robot.kind === "differential" ? (
                <label>
                  Control scheme
                  <select
                    value={input.tank ? "tank" : "arcade"}
                    onChange={(e) =>
                      editInput({ tank: e.target.value === "tank" })
                    }
                  >
                    <option value="arcade">Arcade · forward + steering</option>
                    <option value="tank">Tank · independent sides</option>
                  </select>
                </label>
              ) : (
                <label>
                  Control frame
                  <select
                    value={profile.controlFrame}
                    onChange={(e) =>
                      onChange({
                        ...profile,
                        controlFrame: e.target.value as Profile["controlFrame"],
                      })
                    }
                  >
                    <option value="field">Field relative</option>
                    <option value="robot">Robot relative</option>
                  </select>
                </label>
              )}
              <div className="check-row">
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={profile.assistance.precision}
                    onChange={(e) =>
                      onChange({
                        ...profile,
                        assistance: {
                          ...profile.assistance,
                          precision: e.target.checked,
                        },
                      })
                    }
                  />{" "}
                  Precision mode
                </label>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={profile.assistance.brake}
                    onChange={(e) =>
                      onChange({
                        ...profile,
                        assistance: {
                          ...profile.assistance,
                          brake: e.target.checked,
                        },
                      })
                    }
                  />{" "}
                  Brake / X-lock
                </label>
              </div>
              <label>
                Speed limit · {Math.round(profile.assistance.speedLimit * 100)}%
                <input
                  type="range"
                  min="0.8"
                  max="1"
                  step="0.05"
                  value={profile.assistance.speedLimit}
                  onChange={(e) =>
                    onChange({
                      ...profile,
                      assistance: {
                        ...profile.assistance,
                        speedLimit: +e.target.value,
                      },
                    })
                  }
                />
              </label>
              <p className="micro">
                Core profiles retain at least 80% speed so sprint entry bands
                remain reachable.
              </p>
              <label>
                Accommodation / exposure override
                <input
                  maxLength={300}
                  value={
                    profile.accommodation === "None"
                      ? ""
                      : profile.accommodation
                  }
                  onChange={(e) =>
                    onChange({
                      ...profile,
                      accommodation: e.target.value || "None",
                    })
                  }
                  placeholder="None · describe any coach-approved change"
                />
              </label>
              <p className="micro">
                A named accommodation forms a separate comparison group.
                “Exposure override: reason” permits a shortened familiarization.
              </p>
            </fieldset>
          </section>
          <section className="panel">
            <h2>
              <Monitor size={20} /> Display & graphics
            </h2>
            <fieldset disabled={locked}>
              <label>
                Graphics tier
                <select
                  value={profile.graphicsTier}
                  onChange={(e) =>
                    onChange({
                      ...profile,
                      graphicsTier: e.target.value as Profile["graphicsTier"],
                    })
                  }
                >
                  <option value="performance">
                    Performance · lower render resolution
                  </option>
                  <option value="standard">Standard · balanced detail</option>
                  <option value="high">
                    High · sharper resolution & shadows
                  </option>
                </select>
              </label>
              <label>
                Display and viewing context
                <textarea
                  rows={2}
                  maxLength={500}
                  value={profile.display.description}
                  onChange={(e) =>
                    onChange({
                      ...profile,
                      display: {
                        ...profile.display,
                        description: e.target.value,
                      },
                    })
                  }
                />
              </label>
            </fieldset>
            <p className="micro">
              {window.innerWidth} × {window.innerHeight} viewport · Assessment
              camera is fixed at 16:9. Graphics and camera freeze during scored
              attempts.
            </p>
            <button className="secondary full" onClick={onCheck}>
              <Monitor size={16} /> Run station check
            </button>
          </section>
          <div className="quiet-note">
            <Check size={18} />
            <p>
              Everything runs on this computer. No accounts, cloud scores, or
              student data uploads.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
