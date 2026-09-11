# Release verification inventory

The committed product specification remains unchanged. Verification claims are scoped to this source build and the available macOS Chrome environment.

| Surface / claim | Functional evidence | Visual evidence |
| --- | --- | --- |
| Overview and robot garage | Select each drivetrain; persisted selection; reopen after reload | Desktop overview; all three model cards; no missing geometry |
| Free drive | Keyboard acceleration, turning, braking, pause/resume/reset; camera/frame/trail controls | Station, orbit, chase and overhead; live wheel animation and HUD |
| Controls | Axis shaping, neutral calibration, remapping, tank/arcade; synthetic disconnect and focus loss | Setup, input monitor, button diagnostics |
| Six courses | Runner scenarios and 18 force-driven feasibility runs; ordered gates, dwell, entry bands, cues | Instructions and active targets; T05 stop line; cue visibility |
| Scoring | Anchor boundaries, worked example, penalty caps, missing metrics, DNF, invalid and practice | Result card, raw metrics and score explanation |
| Protocol | Screening/full schedule, matched profiles, exposure rules and technical replacement cap | Assessment progress, profile lock, incomplete reports |
| Session | Reload interruption, expiry, denied storage, strict import, multiple drivers, clear | Roster, recovery notices, driver switch |
| Reports | Local Letter/A4 PDFs, batch pages, raw metrics/score agreement, Unicode/long notes, print | PDF page images and report preview |
| Runtime | Fixed 120 Hz, backlog/stall interruption, cleanup counts, measured frame/physics timing | 1280×720 and 1440 desktop screenshots |
| Offline | Manifest-only cache, no driver data, pinning, update guard; offline browser reload | Offline readiness/update notices |

Off-happy-path checks: focus loss during a scored attempt; reload during an active attempt; mismatched display profile; out-of-range imported records; driver abort after countdown; incomplete report download.

Physical USB support, Windows, physical input-to-display latency, real-robot calibration, 60-minute hardware soak and student/coach pilot require separate hardware evidence. Synthetic gamepads and scripted controllers do not establish those claims.
