# First-release software validation

Validation date: September 11, 2026. The committed specification is preserved. This is a working software release with **provisional rubrics and uncalibrated robot presets**; the specification's physical qualification/pilot gate is not claimed complete.

## Environment

- macOS 26.6.2, Apple M5 MacBook Pro, 24 GB RAM. This is above the proposed M1/integrated-GPU baseline.
- Google Chrome 152.0.7977.83, WebGL 2, headed interactive checks and headless Playwright checks.
- Desktop viewport checks: 1280×720 and 1440×1000; benchmark renders a 1920×1080 base workload in its final configuration.
- Keyboard and synthetic Gamepad API fixtures. No physical USB controller was connected or measured. No Windows computer or real robot was available.

## Automated checks

- `npm ci` succeeds from the exact lock; npm 11.11.0 is the documented toolchain. npm 10 fresh peer resolution hit an upstream Arborist error during development; npm 11 resolved it. A later clean npm 10 `ci --ignore-scripts` also succeeded.
- TypeScript strict checks include unused locals/parameters. Prettier checks the implementation, data, tests and configuration.
- 121 unit/physics/scenario tests pass across 11 files: coordinates, input shaping/calibration/keyboard handling, actuator forces, saturation, inertia, finite steering, neutral/coast/brake, continuous contact, glancing collision severity, impossible starts, fixed-clock 30/60/120 Hz equivalence, ordered swept gates, dwell reset, wrong-way/path metrics, all six drills, T05 entry bands and first stop, T06 presentation/preheld timing, score formulas/penalties, missing/DNF/invalid/practice handling, full/screening aggregation, schedule/exposure/replacement eligibility, recovery/import/expiry/denial, PDF/HTML agreement and offline/update guards.
- All 18 robot/course combinations complete through applied forces, without pose/velocity injection, within their time limits and with zero contacts or corridor departures. Detailed times and scope are in [physics validation](physics-validation.md).
- Playwright covers actual keyboard motion/braking for all three robots; all four practice cameras; trail/input overlay; pause/resume/reset; garage/setup/roster/practice/assessment/report screens; driver recovery; six-result screening with DNF; technical replacement; profile locking; local PDF; print-only popup; countdown reload invalidation; clear-session storage removal; successful keyboard docking and its in-memory replay/report.
- Automated keyboard docking reads only the HUD state for controller feedback and sends ordinary keyboard events. It never sets chassis poses, velocities, clocks or result values. All three bays complete before the 60-second limit.

## Interactive and visual evidence

The app was exercised with keyboard input and the rendered scene was inspected. A mesh-merging defect that removed venue/frame parts was corrected by normalizing indexed geometry before merging. Startup now waits for measured warm rendered frames and real physics work. An end-to-end replay check caught the report model intentionally dropping paths; the UI now obtains the in-memory replay separately while exported reports remain compact.

Reviewed overview, all three garage cards, setup, practice/assessment lists, fixed-station arena, close-up orbit robot, results, Letter/A4 PDFs and dense raw metrics. Essential geometry and markings remain across tiers. No missing meshes, stretched wordmarks, overlapping controls, sideways page overflow or clipped report text remained in the inspected states. The 1280×720 setup/report pages scroll normally; the gameplay viewport stays 16:9 and letterboxed.

A headed keyboard T01 run completed in 44.0917 s with mean center error 0.0446 m, zero heading error and zero contacts. Its provisional score 70.9 agreed on the result screen, report and downloaded PDF. PDF text extraction independently confirmed 70.9, 0.0446 m and 44.0917 s. All three PDF pages were rendered and inspected. This is **automated software evidence, not a student driver result**. Closed-loop timing and scores vary with rendered input sample timing; deterministic physics fixtures use fixed commands/ticks.

The final production cache also supported a fresh local PDF download with browser networking disabled. A fast-navigation cleanup race discovered during this check was fixed: preview materials and GPU programs remain alive until parallel shader compilation settles, then are disposed. Browser navigation coverage exercises this path.

PDF fixtures also verify the specification's 53.2 worked example, 0.0700 m raw center error and 4.0 penalty. Long names/notes produce readable additional pages. Batch Letter/A4 fixture reports produce six pages with separate driver summaries. Fonts are embedded; text is selectable. The DejaVu glyph-coverage limitation is documented in [attribution](asset-attribution.md).

Screenshots and browser-exported QA PDFs are generated under ignored `output/playwright/`; representative finished screenshots are checked in under `docs/images/`. Re-run the browser suite to regenerate evidence. The original specification PDF is unchanged.

## Performance and memory scope

The final headed station check on the M5 selected **High at 1920×1080**: 180 measured frames after 30 warm-up frames, 9.4 ms frame p95, 0.40 ms per two physics ticks, 2.90 ms CPU submission p95, 10.2 ms longest frame, 167 draw calls and 56,894 triangles. The browser viewport was 1440×1000. The original downloaded [station measurements](evidence/station-check-1080.txt) are retained. These are local short-run measurements, not minimum-machine claims.

The completed T01 run recorded 10.0 ms frame p95, 0.60 ms two-tick physics p95, 10.4 ms maximum interval, 86 draw calls and 44,610 triangles; reported JavaScript heap was approximately 55–60 MB. Browser heap excludes native/GPU allocations. Geometry counts remain well below the 500,000-triangle guide. Procedural 256 px textures and 1024–2048 px shadow maps have a conservative per-scene texture footprint below the 128 MB texture budget; browser GPU/total-process memory is not fully exposed and is not certified here.

RAF/input/world/context cleanup is explicit. Six additional free-drive/exit cycles, each followed by Chrome DevTools garbage collection, retained 21.80, 21.91, 22.17, 22.25, 22.29 and 22.29 MB of JavaScript heap. Each returned to exactly one overview canvas. This short sequence shows stabilization after warm-up, not proof of an absence of all leaks. No 60-minute/20-driver real-station soak, thermal/power-mode sweep, or physical USB-to-display latency measurement was performed. Those remain qualification work; unit-clock tests cannot replace them.

The production distribution is approximately 4.9 MB uncompressed. Bundled JS+CSS gzip totals approximately 1.61 MB, plus the locally bundled font. Exact asset hashes are written in `dist/offline-manifest.json`; exact dependency versions are locked. No runtime CDN or remote PDF service is used.

## Offline and update behavior

An actual production page installed its worker and was reloaded with the browser context set offline. The overview, local font, Three.js scene, Rapier physics and free-drive startup worked without network. Cache inspection showed only build assets, font/license, software notices, favicon, index and manifest; no driver data or reports. A fresh install was also checked to avoid presenting its transient waiting worker as an available update.

A second content-hashed build was downloaded while a session remained active. Activation was refused and the tab kept its original URL build pin. Ending/clearing the session allowed activation and navigation to the new pin. Two build caches were retained. The cleared-session rollback control restored the previous cached build. These checks supplement the worker unit fixtures for multi-tab readiness and missing pinned assets. Rebuild from source after any update fixture; the delivery build contains no QA marker.

## Genuine remaining limitations / release gates

1. **Physical controller and OS matrix:** exact USB model, firmware, data cable/adapter, Windows/macOS browser combinations, keyboard ghosting and reconnect behavior need device testing. Synthetic gamepads establish software handling only.
2. **Real-robot fidelity:** calibration of steady speed, acceleration, coasting/braking and turn/strafe response needs measured team robots. Flat-floor support omits suspension, ramp/tipping dynamics, battery sag and mechanisms.
3. **Assessment validity:** rubric anchors, variants, repeatability and real-robot transfer need the proposed student/coach pilot. No percentile, pass/fail, medical reaction-time or driver-selection validity claim is made.
4. **Sustained hardware performance:** minimum-machine 1080p qualification, total CPU/GPU memory, physical latency and 60-minute cohort soak remain unmeasured. The short software gate is enforced separately.
5. **Font coverage:** unsupported PDF glyphs use explicit Unicode code points; HTML retains original characters.
6. **Deployment environment:** school filtering, managed-browser policy and HTTPS hosting on the team's actual network are unverified. The local application and reproducible static build are complete.
