# Force-model and course feasibility verification

Verified locally on September 11, 2026 using the bundled Rapier 0.19.3 WASM model, physics version `rapier-0.19.3-force-1.0.0`, preset version 1.0.0, and `core-courses-1.0.0` with seed 101. These are software engineering fixtures; the presets remain generic and uncalibrated.

## Reproduction

```sh
npm ci
npx vitest run tests/physics.test.ts tests/input.test.ts tests/feasibility.test.ts
FEASIBILITY_REPORT=1 npx vitest run tests/feasibility.test.ts --reporter=verbose --silent=false
```

`tests/feasibility.test.ts` connects the actual `PhysicsWorld` and `TestRunner`. A deterministic closed-loop controller produces normalized actuator commands from the measured pose every 1/120 second. The fixture never assigns robot velocity, advances synthetic poses, skips checkpoints, changes time limits, or bypasses required dwells. Pose resets occur only at the published starting pose and after the runner's prescribed between-segment resets. T06 cues are marked presented on a monotonically advancing synthetic wall clock and require subsequent sustained correct commands.

All 18 drive/course combinations completed under the published time limits with **zero minor contacts, major contacts, and boundary departures**. These are existence checks for achievable completion, not recommended student pacing, score anchors, pilot performance, or measured input latency. The two holonomic drives use field-relative profiles; coordinate fixtures separately verify robot/field transforms and heading signs. Differential ignores holonomic control-frame selection.

| Course | Swerve seconds | Differential seconds | Mecanum seconds | Published limit |
| --- | ---: | ---: | ---: | ---: |
| T01 Distance docking | 13.475 | 13.792 | 14.117 | 60 s |
| T02 Orientation shuttle | 23.425 | 32.033 | 25.225 | 60 s |
| T03 Speed slalom | 32.433 | 34.933 | 35.892 | 45 s |
| T04 Precision gates | 10.625 | 17.267 | 11.525 | 60 s |
| T05 Sprint and stop | 13.733 | 14.942 | 15.633 | 45 s |
| T06 Cue and recover | 28.467 | 35.442 | 29.467 | 60 s |

T03 differential uses a continuous path at a controlled 1.05 m/s instead of stopping and rotating at every gate. This succeeds without touching posts. The fixture includes the far turn pocket and every outward/return gate. T04 aligns in the open pockets and drives through all three physical openings, including the 30-degree gate with only 0.20 m of total extra bumper clearance. No course dimensions or allowed times were changed to obtain these results.

T05 has sufficient acceleration and stopping room in all presets. The measured speed at each of the three entry center-plane crossings and the range of signed front-bumper stopping errors are:

| Drive | Measured entry speed | Allowed band | Signed stop-error range |
| --- | ---: | ---: | ---: |
| Swerve | 3.285 m/s | 2.925–3.600 m/s | −0.0160 to −0.0156 m |
| Differential | 2.920 m/s | 2.600–3.200 m/s | −0.0092 to −0.0091 m |
| Mecanum | 2.663 m/s | 2.470–3.040 m/s | +0.0136 to +0.0137 m |

Negative signed error means stopping before the line. The three repetitions include their required low-speed 0.75-second dwell. Automated assertions require all three entry speeds inside the published band and every absolute stop error below 0.05 m.

## Additional engineering coverage

The 17 physics fixtures cover coordinate basis/signs, wheel-speed saturation, traction ellipses, finite swerve steering, straight acceleration and speed envelopes, braking versus coast, differential no-strafe, mecanum strafe without steering, all-drive positive pivots, field-relative motion, thin-wall CCD, stationary pushing, normal-speed glancing contact severity, impossible initial overlaps, fixed timestep, eight-tick catch-up limits, and equivalent trajectories at 30/60/120 Hz rendering.

The 11 input fixtures cover radial deadzone rescaling, diagonal normalization, ramps, neutral/full-travel calibration, gamepad remapping/inversion, unchanged timestamps, disconnect/reconnect neutral interlocks, tank signs, edge-triggered pause, braking, keyboard translation/rotation, both Shift keys, text-field exclusion, focus loss, and listener cleanup. Gamepads are synthetic fixtures; this does not verify physical USB compatibility.

## Limits

The chassis uses a 3D dynamic rigid body with cuboid mass/inertia, planar wheel forces and collider-resolved impacts. Flat-floor support constrains vertical translation, pitch and roll. Suspension, ramps, tipping fidelity, battery sag and damage are outside this model. Static wheel loads and friction coefficients have not been fitted to measured robots. Normal contact closing speeds are derived from pre-step body velocity plus angular velocity at Rapier solver contact points; contact episode separation rules are owned by the test runner.

Cross-platform motion tolerances, actual controller/OS combinations, Windows graphics, physical input-to-display latency, and coach/student driving feel still require the hardware qualification and pilot described in the committed specification. A successful automated controller is not evidence of real-robot training transfer or rubric validity.
