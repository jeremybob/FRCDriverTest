import type {
  ControlFrame,
  CourseDefinition,
  CourseSegment,
  Gate,
  Pose,
  RobotPreset,
  Target,
  TestId,
} from "../types";
import { corners, insidePolygon, local } from "./geometry";
export const COURSE_VERSION = "core-courses-1.0.0";
export const TEST_CATALOG: {
  id: TestId;
  name: string;
  skill: string;
  description: string;
}[] = [
  {
    id: "T01",
    name: "Distance docking",
    skill: "Distance and alignment",
    description:
      "Dock at near, middle, and far depths with a complete bumper dwell.",
  },
  {
    id: "T02",
    name: "Orientation shuttle",
    skill: "Orientation control",
    description:
      "Four prescribed starting headings, ordered gates, and endpoint stops.",
  },
  {
    id: "T03",
    name: "Speed slalom",
    skill: "Speed control",
    description:
      "Pass alternating gates down and back, then settle in the finish box.",
  },
  {
    id: "T04",
    name: "Precision gates",
    skill: "Precision maneuvering",
    description:
      "Negotiate straight, offset, and angled bumper-clearance passages.",
  },
  {
    id: "T05",
    name: "Sprint and stop",
    skill: "Braking judgment",
    description:
      "Enter at 65–80% of preset maximum speed and stop at three targets.",
  },
  {
    id: "T06",
    name: "Cue and recover",
    skill: "Cue response",
    description: "Follow three seeded direction cues after the approach gate.",
  },
];
const pose = (x: number, y = 4, yaw = 0): Pose => ({ x, y, yaw });
const gate = (
  id: string,
  x: number,
  y: number,
  yaw = 0,
  width = 2.5,
): Gate => ({ id, x, y, yaw, width });
export function createCourse(
  testId: TestId,
  preset: RobotPreset,
  controlFrame: ControlFrame,
  seed = 101,
): CourseDefinition {
  const meta = TEST_CATALOG.find((t) => t.id === testId);
  if (!meta) throw new Error("Unknown test");
  if (!Number.isSafeInteger(seed) || !["field", "robot"].includes(controlFrame))
    throw new Error("Invalid course seed or control frame");
  const target = (
    x: number,
    y = 4,
    yaw = 0,
    dwell = 0.75,
    speed = 0.15,
  ): Target => ({ ...pose(x, y, yaw), width: 2.5, length: 2.5, dwell, speed });
  let segments: CourseSegment[] = [];
  const B = preset.width,
    L = preset.length;
  if (testId === "T01")
    segments = [5, 9, 13].map((x, i) => ({
      start: pose(2, i === 1 ? 5 : 3),
      target: {
        ...target(x, i === 1 ? 5 : 3),
        width: B + 0.3,
        length: L + 0.3,
        centerTolerance: 0.12,
        headingTolerance: 10,
      },
      route: [pose(2, i === 1 ? 5 : 3), pose(x, i === 1 ? 5 : 3)],
    }));
  if (testId === "T02")
    segments = [0, Math.PI, Math.PI / 2, (3 * Math.PI) / 2].map((yaw) => ({
      start: pose(3, 4, yaw),
      gate: gate(`orientation-${yaw}`, 7, 4, 0, 3),
      target: target(11, 4, 0, 0.5, 0.2),
      route: [pose(3), pose(7), pose(11)],
    }));
  if (testId === "T03") {
    const swing = preset.kind === "differential" ? 0.5 : 0.7;
    const gates = [
      ...Array.from({ length: 5 }, (_, i) =>
        gate(`out-${i}`, 3 + 2 * i, 2 + (i % 2 ? swing : -swing), 0, 2.2),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        gate(
          `back-${i}`,
          11 - 2 * i,
          6 + (i % 2 ? -swing : swing),
          Math.PI,
          2.2,
        ),
      ),
    ];
    segments = [
      {
        start: pose(1.3, 2),
        gates,
        target: target(1.5, 6, Math.PI, 0.5, 0.2),
        route: [
          pose(1.3, 2),
          ...gates.slice(0, 5).map((g) => pose(g.x, g.y, g.yaw)),
          pose(13, 2),
          pose(13, 6),
          ...gates.slice(5).map((g) => pose(g.x, g.y, g.yaw)),
          pose(1.5, 6, Math.PI),
        ],
      },
    ];
  }
  if (testId === "T04") {
    const gates = [
      gate("straight", 5, 2, 0, B + 0.2),
      gate("offset", 9, 4, 0, B + 0.2),
      gate("angled", 12, 5, Math.PI / 6, B + 0.2),
    ];
    segments = [
      {
        start: pose(2, 2),
        gates,
        target: {
          ...target(13.5, 5.866, Math.PI / 6),
          width: B + 0.3,
          length: L + 0.3,
          headingTolerance: 10,
        },
        route: [
          pose(2, 2),
          ...gates.map((g) => pose(g.x, g.y, g.yaw)),
          pose(13.5, 5.866, Math.PI / 6),
        ],
      },
    ];
  }
  if (testId === "T05")
    segments = [10.5, 11.5, 12.5].map((x, i) => ({
      start: pose(1.3),
      gate: gate(`entry-${i}`, 7, 4, 0, 3),
      target: { ...target(x), width: 3, length: 5, dwell: 0.75, speed: 0.1 },
      entrySpeed: [0.65 * preset.maxSpeed, 0.8 * preset.maxSpeed],
      route: [pose(1.3), pose(7), pose(x)],
    }));
  if (testId === "T06") {
    let state = seed >>> 0;
    const rand = () => {
      state = (1664525 * state + 1013904223) >>> 0;
      return state / 4294967296;
    };
    const first = rand() < 0.5 ? "left" : "right";
    const cues: ("left" | "right")[] = [
      first,
      first === "left" ? "right" : "left",
      rand() < 0.5 ? "left" : "right",
    ];
    segments = cues.map((cue, i) => {
      const sign = cue === "left" ? 1 : -1;
      return {
        start: pose(2),
        gate: gate(`approach-${i}`, 6, 4, 0, 3),
        gates: [
          gate(`branch-${i}`, 9, 4 + sign * 1.5, (sign * Math.PI) / 2, 3),
        ],
        cue,
        cueDelay: 0.7 + rand() * 0.6,
        target: target(9, 4 + sign * 2.5, (sign * Math.PI) / 2, 0.5, 0.2),
        route: [pose(2), pose(6), pose(9), pose(9, 4 + sign * 2.5)],
      };
    });
  }
  const instructions: Record<TestId, string[]> = {
    T01: [
      "Drive into the highlighted bay.",
      "Stop with the whole bumper inside, center within 12 cm, and heading within 10°.",
      "Hold below 0.15 m/s for 0.75 s. The robot resets for the next depth.",
    ],
    T02: [
      "Each leg begins at a prescribed heading.",
      "Pass the highlighted gate in its arrow direction, then hold the endpoint below 0.20 m/s for 0.50 s.",
      "Input is disabled during each automatic reset.",
    ],
    T03: [
      "Pass all ten gates in arrow order, down the near lane and back along the far lane.",
      "Turn in the far pocket, then settle in the finish box.",
      "Speed alone earns no points; missed gates must be corrected.",
    ],
    T04: [
      "Pass the straight, offset, and angled openings with the entire bumper.",
      "Use the open turning pockets to line up.",
      "Stop in the final bay for 0.75 s below 0.15 m/s.",
    ],
    T05: [
      `Cross each entry line at ${(preset.maxSpeed * 0.65).toFixed(2)}–${(preset.maxSpeed * 0.8).toFixed(2)} m/s. Use the speed-band HUD.`,
      "Stop your front bumper at the target line; hold below 0.10 m/s for 0.75 s.",
      "The first qualifying stop is recorded, including early stops and overshoot. An out-of-band crossing must be retried.",
    ],
    T06: [
      "Pass the approach gate, then watch for LEFT or RIGHT.",
      "Release pre-held branch input before responding; sustain a correct command for 0.15 s.",
      "Pass the indicated branch gate and stop at its endpoint. Three events reset automatically.",
    ],
  };
  const obstacles =
    testId === "T05"
      ? []
      : segments.flatMap((s) =>
          [...(s.gate ? [s.gate] : []), ...(s.gates ?? [])].flatMap((g) =>
            [-1, 1].map((side) => ({
              id: `${g.id}-post-${side}`,
              x: g.x - Math.sin(g.yaw) * (g.width / 2 + 0.1) * side,
              y: g.y + Math.cos(g.yaw) * (g.width / 2 + 0.1) * side,
              width: 0.2,
              length: 0.2,
              yaw: g.yaw,
            })),
          ),
        );
  // Resets use identical locations across T02/T06; retain one fixture per physical location.
  const unique = obstacles.filter(
    (o, i, a) =>
      a.findIndex((p) => Math.hypot(o.x - p.x, o.y - p.y) < 0.001) === i,
  );
  const course: CourseDefinition = {
    ...meta,
    version: COURSE_VERSION,
    instructions: instructions[testId],
    timeLimit: testId === "T03" || testId === "T05" ? 45 : 60,
    start: segments[0].start!,
    segments,
    corridor: [
      { x: 0.05, y: 0.05 },
      { x: 15.95, y: 0.05 },
      { x: 15.95, y: 7.95 },
      { x: 0.05, y: 7.95 },
    ],
    obstacles: unique,
    seed,
    profileId: `${testId}-${preset.kind}-${controlFrame}-${COURSE_VERSION}-seed${seed}`,
  };
  validateCourse(course, preset);
  return course;
}
export function validateCourse(
  course: CourseDefinition,
  preset: RobotPreset,
): void {
  if (
    !Number.isFinite(preset.width) ||
    !Number.isFinite(preset.length) ||
    !Number.isFinite(preset.maxSpeed) ||
    preset.maxSpeed <= 0 ||
    preset.width <= 0 ||
    preset.length <= 0 ||
    preset.width > 1.5 ||
    preset.length > 1.8
  )
    throw new Error("Unsupported bumper geometry");
  if (
    !Number.isFinite(course.timeLimit) ||
    course.timeLimit <= 0 ||
    !course.segments.length ||
    course.corridor.length < 3
  )
    throw new Error("Invalid course");
  if (course.corridor.some((p) => ![p.x, p.y].every(Number.isFinite)))
    throw new Error("Nonfinite legal corridor");
  const area = course.corridor.reduce((sum, p, i) => {
    const q = course.corridor[(i + 1) % course.corridor.length];
    return sum + p.x * q.y - p.y * q.x;
  }, 0);
  if (Math.abs(area) < 1e-6) throw new Error("Degenerate legal corridor");
  const ids = new Set<string>();
  for (const s of course.segments) {
    for (const p of [s.start, s.target, ...s.route].filter(
      (p): p is Pose => !!p,
    ))
      if (
        ![p.x, p.y, p.yaw].every(Number.isFinite) ||
        p.x < 0 ||
        p.x > 16 ||
        p.y < 0 ||
        p.y > 8
      )
        throw new Error("Impossible course pose");
    if (
      ![
        s.target.width,
        s.target.length,
        s.target.dwell,
        s.target.speed,
        s.target.centerTolerance ?? 0,
        s.target.headingTolerance ?? 0,
      ].every(Number.isFinite) ||
      s.target.width < preset.width ||
      s.target.length < preset.length ||
      s.target.dwell <= 0 ||
      s.target.speed <= 0 ||
      (s.target.centerTolerance ?? 0) < 0 ||
      (s.target.headingTolerance ?? 0) < 0
    )
      throw new Error("Impossible target");
    if (
      s.entrySpeed &&
      (!s.entrySpeed.every(Number.isFinite) ||
        s.entrySpeed[0] <= 0 ||
        s.entrySpeed[1] <= s.entrySpeed[0] ||
        s.entrySpeed[1] > preset.maxSpeed)
    )
      throw new Error("Impossible entry band");
    const start = s.start ?? course.start;
    if (corners(start, preset).some((p) => !insidePolygon(p, course.corridor)))
      throw new Error("Start bumper outside corridor");
    if (
      course.obstacles.some((o) =>
        corners(start, preset).some((p) => {
          const q = local(p, o);
          return Math.abs(q.x) < o.length / 2 && Math.abs(q.y) < o.width / 2;
        }),
      )
    )
      throw new Error("Overlapping starting geometry");
    for (const g of [...(s.gate ? [s.gate] : []), ...(s.gates ?? [])]) {
      if (ids.has(g.id)) throw new Error("Duplicate checkpoint");
      ids.add(g.id);
      if (
        ![g.x, g.y, g.yaw, g.width].every(Number.isFinite) ||
        g.width <= preset.width
      )
        throw new Error("Impossible gate");
    }
  }
  for (const o of course.obstacles)
    if (
      ![o.x, o.y, o.yaw, o.width, o.length].every(Number.isFinite) ||
      o.width <= 0 ||
      o.length <= 0
    )
      throw new Error("Invalid obstacle");
}
