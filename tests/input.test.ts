import { describe, it, expect, vi, afterEach } from "vitest";
import {
  calibrateAxes,
  defaultInputSettings,
  InputManager,
  rampValue,
  shapeAxis,
  shapeStick,
} from "../src/input";
describe("input shaping and calibration", () => {
  it("rescales the radial deadzone and caps diagonal magnitude", () => {
    expect(shapeStick(0.04, 0.04, 0.08, 1.5)).toEqual({ x: 0, y: 0 });
    expect(shapeAxis(1, 0.08, 1.5)).toBe(1);
    expect(shapeAxis(-1, 0.08, 1.5)).toBe(-1);
    const diagonal = shapeStick(1, 1, 0.08, 1.5);
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(1);
    expect(diagonal.x).toBeCloseTo(diagonal.y);
  });
  it("ramps by elapsed seconds and does not overshoot", () => {
    expect(rampValue(0, 1, 0.05, 0.2)).toBeCloseTo(0.25);
    expect(rampValue(0.9, 1, 0.1, 0.2)).toBe(1);
    expect(rampValue(1, -1, 0.1, 0.2)).toBe(0.5);
  });
  it("records neutral offsets, travel, and observed missing travel", () => {
    const c = calibrateAxes(
      [
        [0.02, 0],
        [0.04, 0],
      ],
      [
        [1, 0],
        [-0.9, 0],
      ],
    );
    expect(c.centers[0]).toBeCloseTo(0.03);
    expect(c.ranges[0]).toBeCloseTo(0.97);
    expect(c.observedRanges[1]).toBe(0);
    expect(() => calibrateAxes([], [])).toThrow();
  });
});
describe("gamepad sampling", () => {
  afterEach(() => vi.unstubAllGlobals());
  function fixture(kind: "swerve" | "differential" = "swerve") {
    const pad = {
      index: 0,
      id: "Synthetic test device",
      connected: true,
      mapping: "standard",
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 12 }, () => ({ pressed: false, value: 0 })),
      timestamp: 1,
    };
    vi.stubGlobal("navigator", { getGamepads: () => [pad] });
    const interrupt = vi.fn(),
      settings = structuredClone(defaultInputSettings);
    settings.device = "gamepad";
    const input = new InputManager(settings, kind, interrupt);
    input.sample(1 / 120);
    return { pad, input, interrupt, settings };
  }
  it("honors inversion, calibration, remapping, and unchanged timestamps", () => {
    const { pad, input, settings } = fixture();
    pad.axes[1] = -1;
    expect(input.sample(1 / 120).x).toBe(1);
    expect(input.sample(1 / 120).x).toBe(1);
    pad.axes = [0, 0, 0, 0];
    settings.axes.x = 3;
    settings.centers[3] = 0.1;
    settings.ranges[3] = 0.5;
    input.setSettings(settings);
    pad.axes[3] = 0.1;
    input.sample(1 / 120);
    pad.axes[3] = -0.4;
    expect(input.sample(1 / 120).x).toBe(1);
    input.dispose();
  });
  it("immediately zeroes on disconnect and requires neutral on reconnect", () => {
    const { pad, input, interrupt } = fixture();
    pad.axes[1] = -1;
    expect(input.sample(1 / 120).x).toBe(1);
    pad.connected = false;
    expect(input.sample(1 / 120).x).toBe(0);
    expect(interrupt).toHaveBeenCalledWith("Controller disconnected");
    pad.connected = true;
    expect(input.sample(1 / 120).x).toBe(0);
    pad.axes[1] = 0;
    input.sample(1 / 120);
    pad.axes[1] = -1;
    expect(input.sample(1 / 120).x).toBe(1);
    input.dispose();
  });
  it("maps tank side speeds to a positive pivot and ignores strafe", () => {
    const { pad, input, settings } = fixture("differential");
    settings.tank = true;
    input.setSettings(settings);
    input.sample(1 / 120);
    pad.axes[1] = 1;
    pad.axes[3] = -1;
    const c = input.sample(1 / 120);
    expect(c.x).toBe(0);
    expect(c.turn).toBe(1);
    expect(c.y).toBe(0);
    input.dispose();
  });
  it("pause is edge triggered and braking zeros the drive command", () => {
    const { pad, input, interrupt } = fixture();
    pad.buttons[9].pressed = true;
    input.sample(1 / 120);
    input.sample(1 / 120);
    expect(interrupt).toHaveBeenCalledTimes(1);
    pad.buttons[9].pressed = false;
    input.sample(1 / 120);
    pad.axes[1] = -1;
    pad.buttons[5].pressed = true;
    const c = input.sample(1 / 120);
    expect(c.brake).toBe(true);
    expect(c.x).toBe(0);
    input.dispose();
  });
});
describe("keyboard and focus safety", () => {
  afterEach(() => vi.unstubAllGlobals());
  function keyboard(kind: "swerve" | "differential" = "swerve", tank = false) {
    const handlers = new Map<string, (event: unknown) => void>();
    vi.stubGlobal("window", {
      addEventListener: (name: string, fn: (event: unknown) => void) =>
        handlers.set(name, fn),
      removeEventListener: (name: string) => handlers.delete(name),
    });
    vi.stubGlobal("document", {
      hidden: false,
      addEventListener: (name: string, fn: (event: unknown) => void) =>
        handlers.set(name, fn),
      removeEventListener: (name: string) => handlers.delete(name),
    });
    const settings = structuredClone(defaultInputSettings);
    settings.tank = tank;
    const interrupt = vi.fn(),
      input = new InputManager(settings, kind, interrupt);
    const key = (type: string, code: string, target: unknown = null) =>
      handlers.get(type)?.({
        code,
        target,
        repeat: false,
        preventDefault: vi.fn(),
      });
    return { input, interrupt, key, handlers };
  }
  it("drives diagonally with normalization, rotation and keyboard ramps", () => {
    const { input, key } = keyboard();
    key("keydown", "KeyW");
    key("keydown", "KeyA");
    key("keydown", "KeyQ");
    const c = input.sample(0.5);
    expect(Math.hypot(c.x, c.y)).toBeCloseTo(1);
    expect(c.turn).toBe(1);
    key("keyup", "KeyW");
    key("keyup", "KeyA");
    key("keyup", "KeyQ");
    expect(input.sample(0.5).x).toBe(0);
    input.dispose();
  });
  it("implements differential arcade and tank with the correct turn signs", () => {
    const arcade = keyboard("differential");
    arcade.key("keydown", "KeyA");
    expect(arcade.input.sample(0.5).turn).toBe(1);
    arcade.input.dispose();
    const tank = keyboard("differential", true);
    tank.key("keydown", "KeyS");
    tank.key("keydown", "ArrowUp");
    const c = tank.input.sample(0.5);
    expect(c.x).toBe(0);
    expect(c.turn).toBe(1);
    tank.input.dispose();
  });
  it("zeros on blur, captures pause, and cleans event listeners", () => {
    const { input, key, interrupt, handlers } = keyboard();
    key("keydown", "KeyW");
    expect(input.sample(0.5).x).toBe(1);
    handlers.get("blur")?.({});
    expect(input.sample(0.01).x).toBe(0);
    expect(interrupt).toHaveBeenCalledWith("Window lost focus");
    key("keydown", "Escape");
    expect(interrupt).toHaveBeenCalledWith("Paused by driver");
    input.dispose();
    expect(handlers.size).toBe(0);
  });
  it("leaves text editing alone and supports brake plus either shift key", () => {
    const { input, key } = keyboard();
    key("keydown", "KeyW", { closest: () => true });
    expect(input.sample(0.5).x).toBe(0);
    key("keydown", "KeyW");
    key("keydown", "ShiftRight");
    expect(input.sample(0.5).precision).toBe(true);
    key("keydown", "Space");
    const c = input.sample(0.01);
    expect(c.brake).toBe(true);
    expect(c.x).toBe(0);
    input.dispose();
  });
});
