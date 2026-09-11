import type { RobotPreset } from "../../src/types";

/** Engineering fixtures, not calibrated robot specifications. Dimensions include bumpers. */
export const ROBOTS: RobotPreset[] = [
  {
    id: "swerve-generic",
    version: "1.0.0",
    name: "Vector S4",
    kind: "swerve",
    length: 0.9,
    width: 0.9,
    mass: 55,
    wheelbase: 0.6,
    track: 0.6,
    wheelRadius: 0.0508,
    maxSpeed: 4.5,
    maxTurnRate: 5.5,
    maxForce: 440,
    steeringRate: 9,
    muLong: 1.05,
    muLat: 1.12,
    coastDrag: 0.19,
    calibrated: false,
    description:
      "Four independently steered modules. Generic, uncalibrated preset.",
  },
  {
    id: "differential-generic",
    version: "1.0.0",
    name: "Traction D6",
    kind: "differential",
    length: 0.96,
    width: 0.85,
    mass: 57,
    wheelbase: 0.66,
    track: 0.59,
    wheelRadius: 0.0762,
    maxSpeed: 4.0,
    maxTurnRate: 3.5,
    maxForce: 420,
    steeringRate: 0,
    muLong: 1.1,
    muLat: 0.6,
    coastDrag: 0.22,
    calibrated: false,
    description:
      "Six fixed wheels with center-weighted support and lateral scrub. Generic, uncalibrated preset.",
  },
  {
    id: "mecanum-generic",
    version: "1.0.0",
    name: "Omni M4",
    kind: "mecanum",
    length: 0.9,
    width: 0.85,
    mass: 54,
    wheelbase: 0.6,
    track: 0.57,
    wheelRadius: 0.0762,
    maxSpeed: 3.8,
    maxTurnRate: 4.0,
    maxForce: 330,
    steeringRate: 0,
    muLong: 0.85,
    muLat: 0.07,
    coastDrag: 0.16,
    calibrated: false,
    description:
      "Four fixed wheels with X-pattern 45° rollers; reduced lateral traction. Generic, uncalibrated preset.",
  },
];

/** Shared, versioned physical assumptions, included through PHYSICS_VERSION in profiles. */
export const ROBOT_MODEL_PROVENANCE = {
  version: "1.0.0",
  centerOfMass: { x: 0, y: 0, z: 0.23 },
  inertiaPolicy:
    "Uniform solid bumper cuboid, 0.36 m tall; Rapier computes inertia from dimensions and mass.",
  support:
    "Flat-floor, vertical translation and roll/pitch constrained; per-wheel static normal load.",
  neutralBehavior:
    "Velocity-proportional rolling drag; explicit brake applies force-limited zero-speed control.",
  calibrationProvenance:
    "Illustrative engineering settings only. No physical robot measurements or fidelity validation.",
  wheelOrder: [
    "front-left",
    "front-right",
    "rear-left",
    "rear-right",
    "center-left (differential only)",
    "center-right (differential only)",
  ],
  mecanumRollers: "X pattern; FL/RR force axis -45 degrees, FR/RL +45 degrees.",
};

export function validatePreset(p: RobotPreset): void {
  const positive = [
    "length",
    "width",
    "mass",
    "wheelbase",
    "track",
    "wheelRadius",
    "maxSpeed",
    "maxTurnRate",
    "maxForce",
    "muLong",
    "muLat",
  ] as const;
  for (const key of positive)
    if (!Number.isFinite(p[key]) || p[key] <= 0)
      throw new Error(`Invalid robot ${key}`);
  if (
    !["swerve", "differential", "mecanum"].includes(p.kind) ||
    p.length > 2 ||
    p.width > 2 ||
    p.mass > 200 ||
    p.maxSpeed > 15 ||
    p.maxForce > 5000 ||
    p.wheelbase >= p.length ||
    p.track >= p.width ||
    !Number.isFinite(p.steeringRate) ||
    p.steeringRate < 0 ||
    !Number.isFinite(p.coastDrag) ||
    p.coastDrag < 0
  )
    throw new Error("Robot preset outside supported bounds");
}
