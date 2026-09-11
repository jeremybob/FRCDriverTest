import { describe, it, expect, vi } from "vitest";
import {
  createSession,
  saveSession,
  recoverSession,
  clearSession,
  validateSession,
  exportSession,
  profileHash,
  SESSION_KEY,
  MAX_RECOVERY_BYTES,
} from "../src/session";
import type { StorageLike } from "../src/session";
import type { Profile, Attempt } from "../src/types";
import { ROBOTS } from "../content/robots";
import { defaultInputSettings } from "../src/input";
import { scoreAttempt } from "../src/scoring";
import { defaultProfile, freezeProfile } from "../src/app/profile";
export function fixtureProfile(): Profile {
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
export function fixtureAttempt(profile = fixtureProfile()): Attempt {
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
export function fixtureSession() {
  const s = createSession(fixtureProfile());
  s.drivers = [
    { id: "driver-1", name: "Zoë Παπαδοπούλου", notes: "Coach notes" },
  ];
  s.activeDriverId = "driver-1";
  return s;
}
function memoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}
describe("temporary session safety", () => {
  it("saves compact results and recovers without persisting replay", () => {
    const s = fixtureSession();
    s.results = [
      {
        ...fixtureAttempt(s.profile),
        replay: [
          {
            tick: 1,
            x: 1,
            y: 1,
            yaw: 0,
            xInput: 1,
            yInput: 0,
            turnInput: 0,
            checkpoint: 0,
          },
        ],
      },
    ];
    const store = memoryStorage();
    expect(saveSession(s, store).ok).toBe(true);
    expect(store.getItem(SESSION_KEY)).not.toContain("replay");
    expect(s.results[0].replay).toHaveLength(1);
    expect(recoverSession(store).session?.results).toHaveLength(1);
  });
  it("expires after eight hours and explicitly clears storage", () => {
    const s = fixtureSession();
    s.createdAt = new Date(Date.now() - 9 * 3600000).toISOString();
    s.expiresAt = new Date(Date.now() - 3600000).toISOString();
    const store = memoryStorage();
    saveSession(s, store);
    expect(recoverSession(store).session).toBeNull();
    expect(store.getItem(SESSION_KEY)).toBeNull();
    saveSession(fixtureSession(), store);
    expect(clearSession(store).ok).toBe(true);
    expect(store.getItem(SESSION_KEY)).toBeNull();
  });
  it("invalidates interrupted reload while retaining original frozen profile", () => {
    const s = fixtureSession();
    const original = structuredClone(s.profile);
    original.camera = "overhead";
    original.hash = profileHash(original);
    s.activeAttempt = {
      driverId: "driver-1",
      testId: "T02",
      scheduledTrial: 1,
      startedAt: new Date().toISOString(),
      profile: original,
    };
    const store = memoryStorage();
    saveSession(s, store);
    const recovered = recoverSession(store).session!;
    expect(recovered.activeAttempt).toBeUndefined();
    expect(recovered.results[0].status).toBe("invalid");
    expect(recovered.results[0].score.score).toBeNull();
    expect(recovered.results[0].profile.hash).toBe(original.hash);
    expect(recoverSession(store).session!.results).toHaveLength(1);
  });
  it("preserves in-memory data under storage denial", () => {
    const store: StorageLike = {
      getItem: () => {
        throw Error("denied");
      },
      setItem: () => {
        throw Error("denied");
      },
      removeItem: () => {
        throw Error("denied");
      },
    };
    const s = fixtureSession();
    expect(saveSession(s, store)).toMatchObject({ ok: false });
    expect(saveSession(s, store).notice).toContain("export remain available");
    expect(recoverSession(store).session).toBeNull();
    expect(clearSession(store).ok).toBe(false);
    expect(s.drivers).toHaveLength(1);
  });
  it("strictly rejects malformed JSON, unknown versions/fields, bad geometry and duplicate IDs", () => {
    expect(() => validateSession("{bad")).toThrow("JSON");
    for (const mutate of [
      (s: any) => (s.schemaVersion = 2),
      (s: any) => (s.surprise = true),
      (s: any) => (s.profile.robot.mass = Infinity),
      (s: any) => (s.profile.robot.track = 4),
      (s: any) => s.drivers.push(s.drivers[0]),
      (s: any) => (s.drivers[0].notes = "x".repeat(10001)),
      (s: any) => (s.profile.camera = "secret"),
    ]) {
      const s = fixtureSession();
      mutate(s);
      expect(() => validateSession(s)).toThrow();
    }
    expect(() => validateSession(" ".repeat(MAX_RECOVERY_BYTES + 1))).toThrow(
      "2 MB",
    );
  });
  it("round trips JSON including escaped Unicode text and rejects missing roster references", () => {
    const s = fixtureSession();
    s.drivers[0].notes = '<script>alert("x")</script>\nΔοκιμή';
    s.practiceExposure = { "driver-1:T01": 1, "driver-1:free": 60 };
    expect(validateSession(exportSession(s))).toEqual(s);
    s.results = [{ ...fixtureAttempt(s.profile), driverId: "missing" }];
    expect(() => validateSession(s)).toThrow("missing driver");
  });
  it("fingerprints all comparison settings and is independent of object order and profile labels", () => {
    const p = fixtureProfile();
    expect(profileHash({ ...p, id: "new", hash: "new" })).toBe(profileHash(p));
    expect(profileHash({ ...p, camera: "overhead" })).not.toBe(profileHash(p));
    expect(
      profileHash({ ...p, robot: { ...p.robot, id: "different" } }),
    ).not.toBe(profileHash(p));
  });
  it("rejects altered historical score arithmetic without rerunning a newer rubric", () => {
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
        metrics,
        score: scoreAttempt("T01", "completed", metrics),
      },
    ];
    expect(() => validateSession(s)).not.toThrow();
    s.results[0].score.score = 99;
    expect(() => validateSession(s)).toThrow("frozen metrics");
  });
  it("round trips the actual default profile for every real preset with synthetic display context", () => {
    vi.stubGlobal("window", {
      innerWidth: 1920,
      innerHeight: 1080,
      devicePixelRatio: 2,
    });
    try {
      const defaults = defaultProfile();
      for (const robot of ROBOTS) {
        const session = createSession(freezeProfile({ ...defaults, robot }));
        expect(validateSession(exportSession(session))).toEqual(session);
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("rejects changed comparison settings or bindings with stale fingerprints", () => {
    const changed = fixtureSession();
    changed.profile.camera = "overhead";
    expect(() => validateSession(changed)).toThrow("Profile fingerprint");
    const bindings = fixtureSession();
    bindings.profile.input.deadzone = 0.2;
    expect(() => validateSession(bindings)).toThrow("binding fingerprint");
  });
  it("hashes all Unicode codepoints distinctly and uses deterministic key order", () => {
    expect(profileHash({ name: "😀" })).not.toBe(profileHash({ name: "😁" }));
    expect(profileHash({ z: 1, a: { c: 3, b: 2 } })).toBe(
      profileHash({ a: { b: 2, c: 3 }, z: 1 }),
    );
  });
  it("accepts all three declared drivetrain presets", () => {
    for (const robot of ROBOTS) {
      const s = fixtureSession();
      s.profile = freezeProfile({ ...s.profile, robot });
      expect(() => validateSession(s)).not.toThrow();
    }
  });
});
