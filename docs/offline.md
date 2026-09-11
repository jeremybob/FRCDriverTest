# Offline delivery and updates

`npm run build` must run `node scripts/build-offline.mjs` after Vite. The generator scans the completed distribution, includes application JavaScript/CSS/WASM/images/fonts and their font notices, and writes a content-hash manifest and `sw.js`. It excludes source maps, uploaded files, session files and PDF exports. The generated cache contains only explicit build assets; runtime responses are never added to it.

Serve the `dist` directory over HTTPS, or use localhost for local testing. A first launch needs an online connection. Offline readiness is announced only after the service worker has installed the complete asset list. Browser storage denial or eviction can make offline assets unavailable; live in-memory assessment and export remain independent of the service worker.

## Application integration

Replace the custom registration code in `src/main.tsx` with:

```ts
import { registerOffline } from './offline';
if (import.meta.env.PROD) void registerOffline();
```

The default session guard treats a persisted session record as active. For an application with separate in-memory session state, provide `hasActiveSession: () => boolean` to registration. Return true during a session even if browser storage was denied. Updates should be requested after **End session and clear**, before the next session is created. The application may keep an idle setup screen without a session record.

The module dispatches:

- `driver-lab-update` when a new worker is waiting.
- `driver-lab-offline-status`, a `CustomEvent<OfflineStatus>` describing readiness, update availability or a failure.
- It listens for `driver-lab-apply-update`; `applyOfflineUpdate()` is also available directly.

An update must be acknowledged as safe by **every open app tab**. An active, unresponsive or older tab prevents forced activation. The caller receives a clear notice to end those sessions. A requesting idle tab reloads only after the replacement worker takes control. Other tabs do not unexpectedly reload.

## Build pinning and rollback

The generated HTML contains an immutable application asset hash. The page keeps it in the `frc-build` URL query parameter. This contains no driver identity or assessment data. The worker reads the pin from each client's URL, so it survives worker suspension and page reload. Cached HTML, fonts and dynamic code for that tab come from that exact build; an unavailable old build produces an explicit error instead of silently mixing releases.

Activation retains the latest application cache, the preceding cache, and any older caches still pinned by an open tab. `listOfflineBuilds()` returns available hashes. `rollbackOfflineBuild()` restores a previous cached build in the current idle tab; an explicit hash may also be supplied. This does not change another tab's active session. A cached build is **not automatically a qualified build**; coaches must retain the version they have actually checked on their station. Rollback cannot restore assets after browser storage eviction.

## Verification

Unit tests exercise manifest inclusion/exclusion, deterministic content hashes, offline cache hits for the font and navigation, version isolation, no runtime caching, and refusal/acceptance of update activation. These use a service-worker harness and do not establish actual browser offline behavior.

Before release, run the production preview, open once online, wait for the offline-ready notice, disable network access and reload. Navigate through setup and practice, then download a PDF with the network still disabled. Re-enable the network to test a changed build: it must wait during a session, activate between sessions, and preserve another pinned tab. Test rollback with two installed builds. Record the browser/platform used and any untested platforms in release notes.

Implementation follows the platform's [service worker lifecycle](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers) and [explicit skipWaiting behavior](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/skipWaiting).
