# Implementation notes and assumptions

The September 11 specification remains unchanged. This document records decisions made where it intentionally left engineering fixtures open.

## Boundaries and data flow

`src/input` shapes keyboard/gamepad samples. `src/drivetrains` produces wheel force targets. `src/sim` owns Rapier and fixed-clock math. `src/tests` owns course progression, swept geometry and cue timing. `src/metrics` reduces measurements. `src/scoring` is pure and uses versioned rubrics. `src/session` validates and stores records and enforces protocol eligibility. `src/reports` freezes one model for HTML/PDF. `src/render` creates original geometry and reads snapshots. `src/app/engine.ts` orchestrates a 120 Hz loop outside React; React receives a throttled HUD snapshot.

Robotics coordinates are +X forward, +Y left, +Z up, yaw counterclockwise. Arena coordinates span X 0–16 m and Y 0–8 m. Rendering uses `(X,Z,-Y)`. Dimensions include bumpers. Course gate yaw points along the legal crossing normal, width along local +Y. Render interpolation uses the last two physics poses. Wheel rotation and steering come from actual wheel state.

The flat-floor support approximation locks vertical displacement/roll/pitch and retains a dynamic planar chassis, inertial yaw, 3D bumper collisions and CCD. This is the specification's bounded-load flat-floor model, not suspension or ramp/tipping fidelity. Horizontal traction is entirely from applied wheel forces. Floor friction is zero. Robot provenance records the center-of-mass/inertia policy and uncalibrated source. Differential uses center-weighted load and scrub; mecanum uses an explicit X roller matrix and anisotropic traction.

Contacts use maximum pre-impact **normal closing speed**, including rotational contact-point velocity. Runner episode hysteresis merges sustained pushing and gaps under 0.30 s. Marked corridor departures are separate from wall collisions. Initial overlaps are setup faults. See the fixtures for high-speed impacts and glancing contacts.

## Protocol and timing

One final frozen profile is shared by the engine, active recovery marker, result and aggregate. It includes exact input bindings/shaping, robot data, software/physics/course/rubric versions, camera, tier, actual internal render dimensions, viewport/display declaration, assistance, seeds and accommodation. Fingerprints detect accidental differences; they are not tamper-proof authority. Completed scores are stored and validated arithmetically, and historical scores are not silently rescored under a new rubric.

Screening/full schedules, replacement caps and practice readiness are pure helpers. Practice is unlimited; one full matched exposure is the initial comparative protocol. Unequal/shortened exposure uses an explicitly named override profile. Free-drive exposure is scoped to robot/input/physics/assistance rather than just a driver name. Seed variants are fixed published fixtures; their calibration remains provisional. Exact fixtures and numeric choices are under `content/`.

Scored time advances only in running fixed ticks. Countdown cannot move the robot. Maximum catch-up is eight ticks; backlog and >250 ms stalls invalidate scores. Free drive can discard an interrupted interval and continue, explicitly without crediting the skipped time. Guided practice pauses. Focus/disconnection requires neutral input before resume/restart. Pose resets occur only at initialization, explicit unscored reset, or prescribed course transitions.

T06 updates the visible DOM cue and acknowledges it at the beginning of the following animation frame, **before** polling new input and stepping physics. The prior command determines whether a response was preheld. A hidden or missing cue is not acknowledged. This next-frame convention is conservative internal presentation timing, not measured physical display scanout. Input and cue timestamps use `performance.now()`.

Preflight measures warmed physics and rendered frames. Attempt performance records exclude setup and countdown. Persistent scored p95 failures invalidate without changing rendering settings. The auto-tier benchmark is a separate non-assessment workload; it executes two fixed ticks per render frame for predictable work, not a timed training trial. Camera/geometry remain identical across tiers.

## Graphics and assets

All robot and venue graphics are original procedural assets: aluminum rails, rounded fabric bumper sections, seam piping, exposed battery/electronics/wires, steering forks, hubs/spokes, tires, and fixed mecanum rollers. Canvas-generated deterministic noise creates carpet, weave and brushed-metal maps. Material-compatible static geometry is merged after normalizing indexed geometry; articulated groups retain independent transforms. RoomEnvironment supplies generated PBR reflections. ACES tone mapping, hemisphere/key/rim lighting and contact shadows are fixed during assessment. No downloaded photographs, models or runtime image services are required.

Camera, shadow filtering, scene exposure and essential course geometry do not vary mid-attempt. Tiers change internal resolution/shadow detail. Free-drive posts use shared visible/physical extents. Long labels retain aspect ratio. Geometry, textures, render targets, worlds, event queues, RAFs and input listeners are explicitly released on exit. GPU material disposal waits for pending parallel shader compilation to settle so rapid navigation cannot invalidate Three.js program polling.

## Records and delivery

Raw command/tick records are retained for the active attempt; poses are sampled at 30 Hz for local review. The replay budget is 25 MB with a visible discard notice while scores/metrics remain. Recovery excludes replays and is capped at 2 MB. Storage denial retains in-memory results and PDF export. JSON import caps size, names, notes, drivers and numerical ranges and rejects duplicate IDs, invalid fingerprints, inconsistent score math and invalid enums. Recovery invalidates an interrupted recorded attempt.

Production build IDs fingerprint sources, content and dependency lock. The service-worker build hash fingerprints emitted assets. Only application files are cached. Update activation checks all app tabs and waits until sessions end. URL build pins and cache retention isolate reloads from deployment updates. Cached rollback is available after ending a session. See `docs/offline.md`.

The implementation keeps the web stack. No observed software limitation justified a native rewrite. The specification's *physical* prototype gate could not be completed without designated controllers, Windows computers and robot measurements; the user authorized completing independent software work. Consequently the delivered software remains visibly provisional and has no hardware-qualified station claim.
