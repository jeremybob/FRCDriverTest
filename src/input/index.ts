import type { Command, DriveKind, InputSettings } from "../types";
import { clamp } from "../sim/coordinates";

export const defaultInputSettings: InputSettings = {
  device: "keyboard",
  gamepadIndex: 0,
  deadzone: 0.08,
  exponent: 1.5,
  ramp: 0.22,
  axes: { x: 1, y: 0, turn: 2, right: 3 },
  invert: { x: true, y: true, turn: true, right: true },
  centers: [0, 0, 0, 0],
  ranges: [1, 1, 1, 1],
  buttons: { precision: 4, brake: 5, pause: 9 },
  keys: {
    forward: "KeyW",
    back: "KeyS",
    left: "KeyA",
    right: "KeyD",
    turnLeft: "KeyQ",
    turnRight: "KeyE",
    rightForward: "ArrowUp",
    rightBack: "ArrowDown",
    brake: "Space",
    precision: "ShiftLeft",
    pause: "Escape",
  },
  tank: false,
  calibrated: false,
  transport: "Unconfirmed",
};

export function shapeAxis(
  value: number,
  deadzone: number,
  exponent: number,
): number {
  const magnitude = Math.abs(value),
    dz = clamp(deadzone, 0, 0.5);
  return magnitude <= dz
    ? 0
    : Math.sign(value) *
        Math.pow(
          clamp((magnitude - dz) / (1 - dz), 0, 1),
          clamp(exponent, 0.25, 4),
        );
}
/** Radial deadzone preserves direction and normalizes diagonals. */
export function shapeStick(
  x: number,
  y: number,
  deadzone: number,
  exponent: number,
) {
  const magnitude = Math.hypot(x, y);
  if (magnitude < 1e-8) return { x: 0, y: 0 };
  const shaped = shapeAxis(magnitude, deadzone, exponent);
  return { x: (x / magnitude) * shaped, y: (y / magnitude) * shaped };
}
export function rampValue(
  previous: number,
  target: number,
  dt: number,
  ramp: number,
) {
  return (
    previous +
    clamp(
      target - previous,
      -Math.max(0, dt) / Math.max(0.001, ramp),
      Math.max(0, dt) / Math.max(0.001, ramp),
    )
  );
}
export function calibrateAxes(neutral: number[][], travel: number[][]) {
  if (neutral.length < 1 || travel.length < 1)
    throw new Error("Record neutral and full-travel samples first");
  const count = neutral[0].length;
  if (
    !count ||
    [...neutral, ...travel].some(
      (sample) =>
        sample.length !== count || sample.some((v) => !Number.isFinite(v)),
    )
  )
    throw new Error("Invalid axis samples");
  const centers = Array.from(
    { length: count },
    (_, i) => neutral.reduce((sum, s) => sum + s[i], 0) / neutral.length,
  );
  const ranges = centers.map((center, i) =>
    Math.max(...travel.map((s) => Math.abs(s[i] - center))),
  );
  const noise = Math.max(
    ...neutral.flatMap((s) => s.map((v, i) => Math.abs(v - centers[i]))),
  );
  return {
    centers,
    ranges: ranges.map((r) => Math.max(0.1, r)),
    deadzone: clamp(noise + 0.03, 0.05, 0.3),
    observedRanges: ranges,
  };
}

export interface InputDiagnostics {
  connected: boolean;
  name: string;
  mapping: string;
  rawAxes: number[];
  rawButtons: number[];
  neutral: boolean;
  calibrated: boolean;
  transport: string;
  deviceSlot: number;
  needsNeutral: boolean;
}
const now = () =>
  typeof performance === "undefined" ? Date.now() : performance.now();
const zero = (): Command => ({
  x: 0,
  y: 0,
  turn: 0,
  brake: false,
  precision: false,
  timestamp: now(),
  deviceSlot: -1,
});
export class InputManager {
  private held = new Set<string>();
  private command: Command = zero();
  private settings: InputSettings;
  private connected = false;
  private padId = "";
  private pausedButton = false;
  private needsNeutral = false;
  private info: InputDiagnostics = {
    connected: true,
    name: "Keyboard",
    mapping: "Keyboard",
    rawAxes: [],
    rawButtons: [],
    neutral: true,
    calibrated: false,
    transport: "Local",
    deviceSlot: -1,
    needsNeutral: false,
  };
  constructor(
    settings: InputSettings,
    private kind: DriveKind,
    private onInterrupt: (reason: string) => void,
  ) {
    this.settings = structuredClone(settings);
    if (typeof window !== "undefined") {
      window.addEventListener("keydown", this.keydown);
      window.addEventListener("keyup", this.keyup);
      window.addEventListener("blur", this.blur);
      window.addEventListener("gamepaddisconnected", this.disconnect);
      document.addEventListener("visibilitychange", this.visibility);
    }
  }
  private keydown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('input,select,textarea,[contenteditable="true"]'))
      return;
    if (Object.values(this.settings.keys).includes(event.code))
      event.preventDefault();
    if (event.code === this.settings.keys.pause && !event.repeat) {
      this.stop("Paused by driver");
      return;
    }
    this.held.add(event.code);
  };
  private keyup = (event: KeyboardEvent) => {
    this.held.delete(event.code);
  };
  private blur = () => this.stop("Window lost focus");
  private visibility = () => {
    if (document.hidden) this.stop("Page hidden");
  };
  private disconnect = (event: GamepadEvent) => {
    if (
      this.settings.device === "gamepad" &&
      event.gamepad.index === this.settings.gamepadIndex
    ) {
      this.connected = false;
      this.stop("Controller disconnected");
    }
  };
  private stop(reason: string) {
    this.clear();
    this.onInterrupt(reason);
  }
  setSettings(settings: InputSettings, kind: DriveKind = this.kind) {
    this.settings = structuredClone(settings);
    this.kind = kind;
    this.clear();
    this.connected = false;
  }
  clear() {
    this.held.clear();
    this.command = zero();
    this.needsNeutral = true;
  }
  neutral() {
    return this.info.neutral;
  }
  diagnostics(): InputDiagnostics {
    return {
      ...this.info,
      rawAxes: [...this.info.rawAxes],
      rawButtons: [...this.info.rawButtons],
      needsNeutral: this.needsNeutral,
    };
  }
  sample(dt: number): Command {
    const settings = this.settings;
    let x = 0,
      y = 0,
      turn = 0,
      brake = false,
      precision = false;
    if (settings.device === "keyboard") {
      const k = settings.keys,
        pressed = (code: string) => (this.held.has(code) ? 1 : 0);
      if (this.kind === "differential" && settings.tank) {
        const left = pressed(k.forward) - pressed(k.back),
          right = pressed(k.rightForward) - pressed(k.rightBack);
        x = (left + right) / 2;
        turn = (right - left) / 2;
      } else {
        x = pressed(k.forward) - pressed(k.back);
        if (this.kind === "differential")
          turn = pressed(k.left) - pressed(k.right);
        else {
          y = pressed(k.left) - pressed(k.right);
          turn = pressed(k.turnLeft) - pressed(k.turnRight);
        }
      }
      ({ x, y } = shapeStick(x, y, 0, 1));
      brake = !!pressed(k.brake);
      precision =
        !!pressed(k.precision) ||
        (k.precision === "ShiftLeft" && !!pressed("ShiftRight"));
      this.info = {
        connected: true,
        name: "Keyboard",
        mapping: "Keyboard",
        rawAxes: [x, y, turn],
        rawButtons: [],
        neutral: x === 0 && y === 0 && turn === 0 && !brake && !precision,
        calibrated: true,
        transport: "Local",
        deviceSlot: -1,
        needsNeutral: this.needsNeutral,
      };
    } else {
      let pad: Gamepad | null | undefined;
      try {
        pad =
          typeof navigator !== "undefined"
            ? navigator.getGamepads?.()[settings.gamepadIndex]
            : null;
      } catch {
        pad = null;
      }
      if (!pad?.connected) {
        if (this.connected) this.stop("Controller disconnected");
        this.connected = false;
        this.command = zero();
        this.info = {
          ...this.info,
          connected: false,
          name: "No controller",
          neutral: true,
          rawAxes: [],
          rawButtons: [],
        };
        return { ...this.command };
      }
      if (this.connected && this.padId !== pad.id) {
        this.stop("Active controller changed");
        this.connected = false;
      }
      if (!this.connected) {
        this.connected = true;
        this.padId = pad.id;
        this.needsNeutral = true;
      }
      const axis = (action: keyof InputSettings["axes"]) => {
        const index = settings.axes[action],
          raw = pad.axes[index] ?? 0;
        return (
          clamp(
            (raw - (settings.centers[index] ?? 0)) /
              Math.max(0.1, settings.ranges[index] ?? 1),
            -1,
            1,
          ) * (settings.invert[action] ? -1 : 1)
        );
      };
      if (this.kind === "differential" && settings.tank) {
        const left = shapeAxis(axis("x"), settings.deadzone, settings.exponent),
          right = shapeAxis(
            axis("right"),
            settings.deadzone,
            settings.exponent,
          );
        x = (left + right) / 2;
        turn = (right - left) / 2;
      } else {
        if (this.kind === "differential")
          x = shapeAxis(axis("x"), settings.deadzone, settings.exponent);
        else
          ({ x, y } = shapeStick(
            axis("x"),
            axis("y"),
            settings.deadzone,
            settings.exponent,
          ));
        turn = shapeAxis(axis("turn"), settings.deadzone, settings.exponent);
      }
      const button = (action: keyof InputSettings["buttons"]) =>
        pad.buttons[settings.buttons[action]]?.pressed ?? false;
      brake = button("brake");
      precision = button("precision");
      const pause = button("pause");
      if (pause && !this.pausedButton) this.stop("Paused by driver");
      this.pausedButton = pause;
      this.info = {
        connected: true,
        name: pad.id,
        mapping: pad.mapping || "Unknown mapping — verify every binding",
        rawAxes: Array.from(pad.axes),
        rawButtons: pad.buttons.map((b) => b.value),
        neutral:
          x === 0 && y === 0 && turn === 0 && !brake && !precision && !pause,
        calibrated: settings.calibrated,
        transport: settings.transport,
        deviceSlot: pad.index,
        needsNeutral: this.needsNeutral,
      };
    }
    if (this.needsNeutral) {
      if (this.info.neutral) this.needsNeutral = false;
      this.command = zero();
      return { ...this.command };
    }
    if (settings.device === "keyboard" && !brake) {
      x = rampValue(this.command.x, x, dt, settings.ramp);
      y = rampValue(this.command.y, y, dt, settings.ramp);
      turn = rampValue(this.command.turn, turn, dt, settings.ramp);
    }
    this.command = {
      x: brake ? 0 : x,
      y: brake ? 0 : y,
      turn: brake ? 0 : turn,
      brake,
      precision,
      timestamp: now(),
      deviceSlot: settings.device === "gamepad" ? settings.gamepadIndex : -1,
    };
    return { ...this.command };
  }
  dispose() {
    if (typeof window !== "undefined") {
      window.removeEventListener("keydown", this.keydown);
      window.removeEventListener("keyup", this.keyup);
      window.removeEventListener("blur", this.blur);
      window.removeEventListener("gamepaddisconnected", this.disconnect);
      document.removeEventListener("visibilitychange", this.visibility);
    }
    this.clear();
  }
}
