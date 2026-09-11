import { SESSION_KEY } from "./session";
const PIN = "frc-build";
export interface OfflineStatus {
  state: "ready" | "update" | "unavailable" | "blocked";
  message: string;
  build?: string;
}
export interface OfflineOptions {
  hasActiveSession?: () => boolean;
  onStatus?: (status: OfflineStatus) => void;
}
export interface CachedBuilds {
  current: string;
  versions: string[];
}
let registration: ServiceWorkerRegistration | null = null;
let activeSession = () => {
  try {
    return sessionStorage.getItem(SESSION_KEY) !== null;
  } catch {
    return true;
  }
};
let notify: (status: OfflineStatus) => void = (status) =>
  window.dispatchEvent(
    new CustomEvent("driver-lab-offline-status", { detail: status }),
  );
let applying = false;
function rpc<T>(
  worker: ServiceWorker,
  message: unknown,
  timeout = 5000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      reject(
        new Error(
          "Offline worker did not respond. Try again after ending other app tabs.",
        ),
      );
    }, timeout);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(event.data as T);
    };
    worker.postMessage(message, [channel.port2]);
  });
}
/** Register only in a production entrypoint. Never refresh a running assessment. */
export async function registerOffline(
  options: OfflineOptions = {},
): Promise<void> {
  if (options.hasActiveSession) activeSession = options.hasActiveSession;
  if (options.onStatus) {
    const callback = options.onStatus;
    notify = (status) => {
      callback(status);
      window.dispatchEvent(
        new CustomEvent("driver-lab-offline-status", { detail: status }),
      );
    };
  }
  if (!("serviceWorker" in navigator) || !window.isSecureContext) {
    notify({
      state: "unavailable",
      message:
        "Offline support requires HTTPS or localhost in a browser with service workers.",
    });
    return;
  }
  const build = document.querySelector<HTMLMetaElement>(
    'meta[name="frc-asset-build"]',
  )?.content;
  if (!build) {
    notify({
      state: "unavailable",
      message:
        "Offline assets are not included in this build. Run the full production build command.",
    });
    return;
  }
  // A URL-level asset pin survives worker suspension and reload, without student data.
  const url = new URL(location.href);
  url.searchParams.set(PIN, build);
  history.replaceState(history.state, "", url);
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "PREPARE_UPDATE") {
      const source = event.source as ServiceWorker | null;
      source?.postMessage({
        type: "UPDATE_READINESS",
        token: event.data.token,
        ready: !activeSession(),
      });
    }
  });
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (applying && !activeSession()) {
      const next = new URL(location.href);
      next.searchParams.delete(PIN);
      location.replace(next.href);
    } else if (applying) {
      applying = false;
      notify({
        state: "blocked",
        message:
          "The update is installed. This session remains pinned to its original assets; end it before changing builds.",
      });
    }
  });
  window.addEventListener("driver-lab-apply-update", () => {
    void applyOfflineUpdate();
  });
  try {
    registration = await navigator.serviceWorker.register(
      new URL("sw.js", new URL(import.meta.env.BASE_URL, location.origin)),
      { updateViaCache: "none" },
    );
    const updated = () => {
      if (registration?.waiting && registration.active) {
        window.dispatchEvent(new Event("driver-lab-update"));
        notify({
          state: "update",
          message:
            "An update is downloaded. Apply it between sessions; all app tabs must be idle.",
          build,
        });
      }
    };
    const trackInstalling = () => {
      const worker = registration?.installing;
      worker?.addEventListener("statechange", () => {
        updated();
        if (worker.state === "activated")
          notify({
            state: "ready",
            message: "Application assets are ready for offline reload.",
            build,
          });
        if (worker.state === "redundant")
          notify({
            state: "unavailable",
            message:
              "Offline installation failed; keep this tab open and retry online.",
          });
      });
    };
    updated();
    trackInstalling();
    registration.addEventListener("updatefound", trackInstalling);
    await navigator.serviceWorker.ready;
    notify({
      state: "ready",
      message: "Application assets are ready for offline reload.",
      build,
    });
    updated();
  } catch (error) {
    notify({
      state: "unavailable",
      message: `Offline assets are unavailable: ${error instanceof Error ? error.message : "registration failed"}`,
    });
  }
}
export async function applyOfflineUpdate(): Promise<boolean> {
  if (activeSession()) {
    notify({
      state: "blocked",
      message: "End the current session before applying an application update.",
    });
    return false;
  }
  if (!registration?.waiting) {
    notify({ state: "blocked", message: "No downloaded update is waiting." });
    return false;
  }
  applying = true;
  try {
    const result = await rpc<{ ok: boolean; reason?: string }>(
      registration.waiting,
      { type: "ACTIVATE" },
    );
    if (!result.ok) {
      applying = false;
      notify({
        state: "blocked",
        message:
          result.reason || "The update must wait until all sessions end.",
      });
    }
    return result.ok;
  } catch (error) {
    applying = false;
    notify({ state: "unavailable", message: (error as Error).message });
    return false;
  }
}
export async function listOfflineBuilds(): Promise<CachedBuilds> {
  const worker = navigator.serviceWorker.controller;
  if (!worker) throw new Error("No offline worker controls this tab yet.");
  return rpc(worker, { type: "LIST_BUILDS" });
}
/** Restore cached application assets in this idle tab, without changing other tabs. */
export async function rollbackOfflineBuild(version?: string): Promise<void> {
  if (activeSession())
    throw new Error(
      "End the current session before changing application builds.",
    );
  const builds = await listOfflineBuilds(),
    current = new URL(location.href).searchParams.get(PIN) ?? builds.current;
  const target = version ?? builds.versions.find((v) => v !== current);
  if (!target || !builds.versions.includes(target))
    throw new Error("No previous application build is cached on this browser.");
  const url = new URL(location.href);
  url.searchParams.set(PIN, target);
  location.replace(url.href);
}
