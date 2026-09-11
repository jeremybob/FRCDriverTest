import { z } from "zod";
import type { Profile, Session, Attempt } from "../types";

export const SESSION_KEY = "frc-driver-lab.session.v1";
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
export const MAX_RECOVERY_BYTES = 2 * 1024 * 1024;
export const MAX_DRIVERS = 100;
export const MAX_NOTE_LENGTH = 10000;
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export interface StorageResult {
  ok: boolean;
  notice?: string;
}
const n = z.number().finite();
const positive = n.positive();
const text = z.string().max(2000);
const id = z.string().min(1).max(200);
const date = z.string().datetime();
const index = n.int().min(0).max(255);
const robotSchema = z
  .object({
    id,
    version: id,
    name: text,
    kind: z.enum(["swerve", "differential", "mecanum"]),
    length: n.min(0.1).max(3),
    width: n.min(0.1).max(3),
    mass: n.min(1).max(200),
    wheelbase: n.min(0.05).max(3),
    track: n.min(0.05).max(3),
    wheelRadius: n.min(0.01).max(0.5),
    maxSpeed: positive.max(20),
    maxTurnRate: positive.max(30),
    maxForce: positive.max(50000),
    steeringRate: n.min(0).max(100),
    muLong: positive.max(5),
    muLat: positive.max(5),
    coastDrag: n.min(0).max(100),
    calibrated: z.literal(false),
    description: text,
  })
  .strict()
  .refine(
    (r) => r.wheelbase <= r.length && r.track <= r.width,
    "Wheel geometry must fit the chassis",
  );
const inputSchema = z
  .object({
    device: z.enum(["keyboard", "gamepad"]),
    gamepadIndex: index,
    deadzone: n.min(0).max(0.95),
    exponent: n.min(0.1).max(5),
    ramp: n.min(0).max(10),
    axes: z.object({ x: index, y: index, turn: index, right: index }).strict(),
    invert: z
      .object({
        x: z.boolean(),
        y: z.boolean(),
        turn: z.boolean(),
        right: z.boolean(),
      })
      .strict(),
    centers: z.array(n.min(-1).max(1)).max(32),
    ranges: z.array(n.min(0).max(2)).max(32),
    buttons: z
      .object({ precision: index, brake: index, pause: index })
      .strict(),
    keys: z
      .object({
        forward: id,
        back: id,
        left: id,
        right: id,
        turnLeft: id,
        turnRight: id,
        rightForward: id,
        rightBack: id,
        brake: id,
        precision: id,
        pause: id,
      })
      .strict(),
    tank: z.boolean(),
    calibrated: z.boolean(),
    transport: text,
  })
  .strict();
export const profileSchema = z
  .object({
    id,
    hash: id,
    robot: robotSchema,
    physicsVersion: id,
    buildId: id,
    courseVersion: id,
    rubricVersion: id,
    inputClass: z.enum(["keyboard", "gamepad"]),
    controlFrame: z.enum(["field", "robot"]),
    input: inputSchema,
    bindingHash: id,
    assistance: z
      .object({
        precision: z.boolean(),
        brake: z.boolean(),
        speedLimit: n.min(0.8).max(1),
      })
      .strict(),
    camera: z.enum(["station", "orbit", "chase", "overhead"]),
    graphicsTier: z.enum(["performance", "standard", "high"]),
    renderResolution: z.tuple([positive.max(32768), positive.max(32768)]),
    display: z
      .object({
        width: positive.max(32768),
        height: positive.max(32768),
        pixelRatio: positive.max(10),
        description: text,
      })
      .strict(),
    difficulty: text,
    seedSet: z.array(n.int()).min(1).max(100),
    scheduleId: id,
    accommodation: text,
    deviceDescription: text,
    qualification: text,
    familiarizationSeconds: n.min(0).max(86400),
  })
  .strict();
const testId = z.enum(["T01", "T02", "T03", "T04", "T05", "T06"]);
const component = z
  .object({
    metric: id,
    label: text,
    unit: text,
    value: n,
    good: n,
    weak: n,
    weight: n.min(0).max(1),
    normalized: n.min(0).max(100),
    contribution: n.min(0).max(100),
  })
  .strict();
const attemptSchema = z
  .object({
    id,
    driverId: id,
    testId,
    scheduledTrial: n.int().min(1).max(3),
    status: z.enum(["completed", "dnf", "invalid", "practice"]),
    cause: text,
    startedAt: date,
    durationTicks: n.int().nonnegative(),
    wallDuration: n.nonnegative(),
    metrics: z.record(z.string().max(100), z.union([n, z.array(n).max(20000)])),
    events: z
      .array(
        z
          .object({
            tick: n.int().nonnegative(),
            type: id,
            source: text.optional(),
            x: n.optional(),
            y: n.optional(),
            value: n.optional(),
            message: text.optional(),
          })
          .strict(),
      )
      .max(20000),
    performance: z
      .object({
        frameP95: n.nonnegative(),
        physicsP95: n.nonnegative(),
        maxFrame: n.nonnegative(),
        frames: n.int().nonnegative(),
        drawCalls: n.nonnegative().optional(),
        triangles: n.nonnegative().optional(),
        heapMB: n.nonnegative().optional(),
      })
      .strict(),
    score: z
      .object({
        score: n.min(0).max(100).nullable(),
        base: n.min(0).max(100).nullable(),
        penalty: n.min(0).max(40),
        components: z.array(component).max(30),
        explanation: text,
      })
      .strict(),
    profile: profileSchema,
    practiceCompleted: z.boolean().optional(),
    replay: z
      .array(
        z
          .object({
            tick: n.int().nonnegative(),
            x: n,
            y: n,
            yaw: n,
            xInput: n,
            yInput: n,
            turnInput: n,
            checkpoint: n.int(),
          })
          .strict(),
      )
      .max(100000)
      .optional(),
  })
  .strict()
  .superRefine((a, c) => {
    if (
      (a.status === "invalid" || a.status === "practice") &&
      a.score.score !== null
    )
      c.addIssue({
        code: "custom",
        message: "Practice and invalid attempts must have no assessment score",
      });
    if (a.status === "dnf" && a.score.score !== 0)
      c.addIssue({ code: "custom", message: "DNF must score zero" });
    if (a.status === "completed") {
      const score = a.score,
        components = score.components;
      const expectedBase = components.reduce(
        (sum, v) => sum + v.contribution,
        0,
      );
      const arithmeticValid =
        score.score !== null &&
        score.base !== null &&
        components.length > 0 &&
        Math.abs(components.reduce((sum, v) => sum + v.weight, 0) - 1) < 1e-6 &&
        Math.abs(score.base - expectedBase) < 1e-6 &&
        Math.abs(
          score.score - Math.max(0, Math.min(100, score.base - score.penalty)),
        ) < 1e-6 &&
        components.every(
          (v) =>
            v.weak > v.good &&
            a.metrics[v.metric] === v.value &&
            Math.abs(
              v.normalized -
                100 *
                  Math.max(
                    0,
                    Math.min(1, (v.weak - v.value) / (v.weak - v.good)),
                  ),
            ) < 1e-6 &&
            Math.abs(v.contribution - v.normalized * v.weight) < 1e-6,
        );
      if (!arithmeticValid)
        c.addIssue({
          code: "custom",
          message:
            "Completed score does not agree with its frozen metrics, anchors, weights and penalty",
        });
    }
  });
const sessionSchema = z
  .object({
    schemaVersion: z.literal(1),
    id,
    createdAt: date,
    expiresAt: date,
    label: z.string().max(300),
    drivers: z
      .array(
        z
          .object({
            id,
            name: z.string().min(1).max(300),
            notes: z.string().max(MAX_NOTE_LENGTH),
          })
          .strict(),
      )
      .max(MAX_DRIVERS),
    activeDriverId: z.string().max(200),
    profile: profileSchema,
    results: z.array(attemptSchema).max(10000),
    suite: z.enum(["screening", "full"]),
    activeAttempt: z
      .object({
        driverId: id,
        testId,
        scheduledTrial: n.int().min(1).max(3),
        startedAt: date,
        profile: profileSchema,
      })
      .strict()
      .optional(),
    practiceExposure: z.record(z.string().max(200), n.nonnegative().max(86400)),
  })
  .strict();

function bytes(s: string) {
  return new TextEncoder().encode(s).byteLength;
}
export function validateSession(input: string | unknown): Session {
  let value: unknown = input;
  if (typeof input === "string") {
    if (bytes(input) > MAX_RECOVERY_BYTES)
      throw new Error("Session file exceeds the 2 MB limit.");
    try {
      value = JSON.parse(input);
    } catch {
      throw new Error("Session file is not valid JSON.");
    }
  }
  const parsed = sessionSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `Invalid session at ${issue.path.join(".") || "root"}: ${issue.message}`,
    );
  }
  const s = parsed.data as Session;
  const created = Date.parse(s.createdAt),
    expiry = Date.parse(s.expiresAt);
  if (expiry <= created || expiry - created > SESSION_TTL_MS)
    throw new Error("Session expiry must be within eight hours of creation.");
  const drivers = new Set(s.drivers.map((d) => d.id));
  if (drivers.size !== s.drivers.length)
    throw new Error("Duplicate driver IDs are not allowed.");
  if (new Set(s.results.map((a) => a.id)).size !== s.results.length)
    throw new Error("Duplicate attempt IDs are not allowed.");
  if (s.activeDriverId && !drivers.has(s.activeDriverId))
    throw new Error("Active driver is missing from the roster.");
  if (
    s.results.some((a) => !drivers.has(a.driverId)) ||
    (s.activeAttempt && !drivers.has(s.activeAttempt.driverId))
  )
    throw new Error("An attempt refers to a missing driver.");
  if (
    Object.keys(s.practiceExposure).some(
      (k) =>
        !drivers.has(k) &&
        !s.drivers.some(
          (d) =>
            new RegExp("^(p-[a-f0-9]{8}:)?(T0[1-6]|free)$").test(
              k.slice(d.id.length + 1),
            ) && k.startsWith(d.id + ":"),
        ),
    )
  )
    throw new Error("Practice exposure refers to a missing driver.");
  for (const profile of [
    s.profile,
    ...s.results.map((a) => a.profile),
    ...(s.activeAttempt ? [s.activeAttempt.profile] : []),
  ]) {
    if (profile.bindingHash !== profileHash(profile.input))
      throw new Error(
        "Input binding fingerprint does not match the recorded input settings.",
      );
    if (profile.hash !== profileHash(profile))
      throw new Error(
        "Profile fingerprint does not match the recorded comparison settings.",
      );
    if (profile.inputClass !== profile.input.device)
      throw new Error(
        "Profile input class does not match the recorded device.",
      );
    if (
      profile.robot.kind === "differential" &&
      profile.controlFrame !== "robot"
    )
      throw new Error("Differential profiles require robot-relative controls.");
  }
  return s;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, child]) => JSON.stringify(key) + ":" + canonical(child))
        .join(",") +
      "}"
    );
  return JSON.stringify(value) ?? "null";
}
/** Stable UTF-8 compatibility fingerprint, not a cryptographic signature. */
export function profileHash(profile: unknown): string {
  const value =
    profile && typeof profile === "object"
      ? Object.fromEntries(
          Object.entries(profile).filter(
            ([key]) => key !== "id" && key !== "hash",
          ),
        )
      : profile;
  let h = 2166136261;
  for (const byte of new TextEncoder().encode(canonical(value))) {
    h ^= byte;
    h = Math.imul(h, 16777619);
  }
  return "p-" + (h >>> 0).toString(16).padStart(8, "0");
}
export function createSession(profile: Profile): Session {
  const now = new Date();
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
    label: "Driver assessment",
    drivers: [],
    activeDriverId: "",
    profile: structuredClone(profile),
    results: [],
    suite: "screening",
    practiceExposure: {},
  };
}
function compact(session: Session): Session {
  return {
    ...session,
    results: session.results.map(({ replay: _, ...a }) => a),
  };
}
export function exportSession(session: Session): string {
  const json = JSON.stringify(compact(session), null, 2);
  validateSession(json);
  return json;
}
function getStorage(provided?: StorageLike): StorageLike {
  return provided ?? window.sessionStorage;
}
export function saveSession(
  session: Session,
  storage?: StorageLike,
): StorageResult {
  try {
    const json = JSON.stringify(compact(session));
    if (bytes(json) > MAX_RECOVERY_BYTES)
      throw new Error(
        "The compact recovery record exceeds 2 MB. Export results before clearing old sessions.",
      );
    validateSession(json);
    getStorage(storage).setItem(SESSION_KEY, json);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      notice: `Reload recovery unavailable. In-memory results and export remain available. ${e instanceof Error ? e.message : "Storage was denied."}`,
    };
  }
}
export function clearSession(storage?: StorageLike): StorageResult {
  try {
    getStorage(storage).removeItem(SESSION_KEY);
    return { ok: true };
  } catch {
    return {
      ok: false,
      notice:
        "Browser storage could not be cleared. Close this tab and remove its site data on shared computers.",
    };
  }
}
export function recoverSession(storage?: StorageLike): {
  session: Session | null;
  notice?: string;
} {
  try {
    const raw = getStorage(storage).getItem(SESSION_KEY);
    if (!raw) return { session: null };
    const session = validateSession(raw);
    if (
      Date.now() >= Date.parse(session.expiresAt) ||
      Date.parse(session.createdAt) > Date.now() + 60000
    ) {
      clearSession(storage);
      return {
        session: null,
        notice:
          "The previous session expired after eight hours and was cleared.",
      };
    }
    if (session.activeAttempt) {
      const a = session.activeAttempt;
      const interrupted: Attempt = {
        ...a,
        id: crypto.randomUUID(),
        status: "invalid",
        cause:
          "Page reload interrupted the attempt. Original comparison profile retained.",
        durationTicks: 0,
        wallDuration: 0,
        metrics: {},
        events: [],
        performance: { frameP95: 0, physicsP95: 0, maxFrame: 0, frames: 0 },
        score: {
          score: null,
          base: null,
          penalty: 0,
          components: [],
          explanation:
            "Technical interruption: excluded; replacement permitted.",
        },
      };
      session.results.push(interrupted);
      delete session.activeAttempt;
      const saved = saveSession(session, storage);
      return {
        session,
        notice: `Session recovered. The interrupted attempt is invalid and may be repeated.${saved.notice ? " " + saved.notice : ""}`,
      };
    }
    return { session, notice: "Previous session recovered in this tab." };
  } catch (e) {
    return {
      session: null,
      notice: `Could not recover the previous session: ${e instanceof Error ? e.message : "Storage unavailable."}`,
    };
  }
}
