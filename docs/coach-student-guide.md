# Coach and student guide

## Student quick start

Pick a robot and enter Free Drive. Release the controls before starting. The light front bumper panel and top arrow show the robot's forward direction.

| Control | Keyboard default |
| --- | --- |
| Forward / reverse | W / S |
| Swerve or mecanum strafe | A / D |
| Swerve or mecanum rotation | Q / E |
| Differential arcade steering | A / D |
| Differential tank | W/S left wheels, Up/Down right wheels |
| Precision | Hold Shift |
| Brake / swerve X-lock | Hold Space |
| Pause | Escape |

Field-relative translation follows field axes. Robot-relative translation follows the robot's front. Free Drive allows camera changes, a trail, frame switching and heading zero. These aids and settings are restricted during scored attempts. The controller overlay shows the consumed command. A disconnected device or focus loss zeros input.

Practice one skill at a time. Read the instructions. Green outlines mark the active target or gate. White markings show the rest of the route; gold dashed lines mark legal corridor boundaries. Move the entire bumper through an opening in the correct direction. Stop and dwell where requested; touching a target is insufficient.

## The six drills

| Drill | What to do | Key evidence |
| --- | --- | --- |
| Distance docking | Settle in near, middle and far bays; complete footprint, ≤0.12 m center error, ≤10° heading, <0.15 m/s for 0.75 s | Center/heading errors and time |
| Orientation shuttle | Four prescribed starting headings, ordered destination gates and endpoint stops | Wrong-way motion in each leg's first second, distance-sampled path RMS, time |
| Speed slalom | Alternating gates down and back, all in order/direction, then settle | Time, path RMS, contacts and departures |
| Precision gates | Straight, offset and angled passages; finish with a controlled dwell | Swept bumper clearance, gate offset RMS, heading |
| Sprint and stop | Cross each entry line at 65–80% of the robot maximum, then hold a stop | Signed front-bumper stopping error, overshoot, actual entry speed |
| Cue and recover | Approach the junction; wait for a displayed left/right cue; take the matching branch and stop | Cue-to-sustained-input time, wrong branches and time |

Trial time limits are 60 seconds except slalom and sprint/stop (45 seconds). Prescribed segment resets belong to the test and require releasing input. During sprint/stop, the gold stop line is the target for the **front bumper**, not the robot center. An out-of-band entry remains unmet, even if the robot stops accurately.

## Coach setup

Record the actual computer/display, viewing distance, input device and coach-confirmed transport. Browser gamepad detection does not prove USB transport. Capture neutral stick samples for at least a second, sweep each mapped axis through its full range, save calibration, and confirm axis direction and every button in Free Drive. Unknown mappings must be checked explicitly. Avoid ghosted keyboard combinations on inexpensive keyboards.

Run the graphics check. It tries High, Standard, then Performance and selects the highest passing tier. Measurements include frame pacing, actual physics work, CPU submission, geometry counts and output dimensions. This short check is distinct from OS/controller qualification and thermal soak. Record it with the station notes. Keep viewport, camera, graphics, robot, bindings and assistance identical between compared drivers.

The standard protocol uses three minutes of free driving plus one full unscored exposure per skill, followed by scheduled trials. Full exposure means completing the practice course or using its entire time limit. Unlimited extra practice is available. To assess after shortened or unequal exposure, set `Exposure override: reason` **before the first recorded trial**, use the same named profile across the comparison group, and explain the reason in notes. Practice exposure does not transfer after changing robot/input/assistance settings.

Screening: six trials, preliminary skill scores, no Core index or repeatability. Full: eighteen trials, three per skill, with a planned break after each six-trial block. The fixed schedule is T01–T06, then T03–T06/T01–T02, then T05–T06/T01–T04. Skill scores are medians. Core index requires all six medians. Repeatability measures spread independently; consistently low performance can have high repeatability.

Student pause, reset, abort, timeout or unmet conditions are DNF and score zero. Device/focus/hidden-tab/context loss, display changes, invalid setup and performance interruptions are technical invalidations. One technical replacement is allowed per scheduled slot. A repeated technical failure stops that comparison workflow; retain the record, resolve the problem, and start a new session. There is no best-of retry for a poor score.

## Review, export and privacy

Use Driver reports to inspect all trial scores, raw metrics, penalty components, events, and recorded pose replay. A replay is a stored path, not resimulated physics. Missing and unscored results display a dash; only DNF becomes zero. Do not rank incompatible profile hashes.

Download PDF makes a local file. Print opens a report-only page and the system print dialog. Letter/A4, batch export, grayscale bars, selectable text, long notes and detailed provenance are supported. The bundled font covers common Latin, Greek and Cyrillic text; unsupported PDF characters are explicitly represented by their Unicode code point. HTML preserves the original text.

Reload recovery stores compact results/settings/notes in this tab's sessionStorage, without replays. The session expires eight hours after creation. Browser storage failures show a notice; in-memory reports remain available. Export before clearing. Downloaded PDFs/JSON remain on the computer until removed. End session clears the active roster, notes, results and recovery record. Closing a tab alone may not prevent the browser restoring it.

Scores are developmental feedback. Observe communication, strategy and safe real-robot operation separately. All presets and rubrics remain uncalibrated/provisional pending the documented hardware and student pilot.
