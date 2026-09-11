export type DriveKind = "swerve" | "differential" | "mecanum";
export type ControlFrame = "field" | "robot";
export type GraphicsTier = "performance" | "standard" | "high";
export type CameraMode = "station" | "orbit" | "chase" | "overhead";
export type TestId = "T01" | "T02" | "T03" | "T04" | "T05" | "T06";
export type AttemptStatus = "completed" | "dnf" | "invalid" | "practice";
export type Suite = "screening" | "full";
export interface Pose {
  x: number;
  y: number;
  yaw: number;
}
export interface Command {
  x: number;
  y: number;
  turn: number;
  brake: boolean;
  precision: boolean;
  timestamp: number;
  deviceSlot: number;
}
export interface WheelState {
  x: number;
  y: number;
  angle: number;
  speed: number;
  rotation: number;
  targetAngle: number;
}
export interface SimSnapshot extends Pose {
  tick: number;
  vx: number;
  vy: number;
  omega: number;
  speed: number;
  wheels: WheelState[];
  contacts: ContactSample[];
}
export interface ContactSample {
  id: string;
  speed: number;
  active: boolean;
  x: number;
  y: number;
}
export interface RobotPreset {
  id: string;
  version: string;
  name: string;
  kind: DriveKind;
  length: number;
  width: number;
  mass: number;
  wheelbase: number;
  track: number;
  wheelRadius: number;
  maxSpeed: number;
  maxTurnRate: number;
  maxForce: number;
  steeringRate: number;
  muLong: number;
  muLat: number;
  coastDrag: number;
  calibrated: false;
  description: string;
}
export interface InputSettings {
  device: "keyboard" | "gamepad";
  gamepadIndex: number;
  deadzone: number;
  exponent: number;
  ramp: number;
  axes: { x: number; y: number; turn: number; right: number };
  invert: { x: boolean; y: boolean; turn: boolean; right: boolean };
  centers: number[];
  ranges: number[];
  buttons: { precision: number; brake: number; pause: number };
  keys: {
    forward: string;
    back: string;
    left: string;
    right: string;
    turnLeft: string;
    turnRight: string;
    rightForward: string;
    rightBack: string;
    brake: string;
    precision: string;
    pause: string;
  };
  tank: boolean;
  calibrated: boolean;
  transport: string;
}
export interface Profile {
  id: string;
  hash: string;
  robot: RobotPreset;
  physicsVersion: string;
  buildId: string;
  courseVersion: string;
  rubricVersion: string;
  inputClass: "keyboard" | "gamepad";
  controlFrame: ControlFrame;
  input: InputSettings;
  bindingHash: string;
  assistance: { precision: boolean; brake: boolean; speedLimit: number };
  camera: CameraMode;
  graphicsTier: GraphicsTier;
  renderResolution: [number, number];
  display: {
    width: number;
    height: number;
    pixelRatio: number;
    description: string;
  };
  difficulty: string;
  seedSet: number[];
  scheduleId: string;
  accommodation: string;
  deviceDescription: string;
  qualification: string;
  familiarizationSeconds: number;
}
export interface Driver {
  id: string;
  name: string;
  notes: string;
}
export interface MetricValues {
  [key: string]: number | number[];
}
export interface AttemptEvent {
  tick: number;
  type: string;
  source?: string;
  x?: number;
  y?: number;
  value?: number;
  message?: string;
}
export interface ScoreComponent {
  metric: string;
  label: string;
  unit: string;
  value: number;
  good: number;
  weak: number;
  weight: number;
  normalized: number;
  contribution: number;
}
export interface ScoreBreakdown {
  score: number | null;
  base: number | null;
  penalty: number;
  components: ScoreComponent[];
  explanation: string;
}
export interface PerformanceRecord {
  frameP95: number;
  physicsP95: number;
  maxFrame: number;
  frames: number;
  drawCalls?: number;
  triangles?: number;
  heapMB?: number;
}
export interface ReplaySample extends Pose {
  tick: number;
  xInput: number;
  yInput: number;
  turnInput: number;
  checkpoint: number;
}
export interface Attempt {
  id: string;
  driverId: string;
  testId: TestId;
  scheduledTrial: number;
  status: AttemptStatus;
  cause: string;
  startedAt: string;
  durationTicks: number;
  wallDuration: number;
  metrics: MetricValues;
  events: AttemptEvent[];
  performance: PerformanceRecord;
  score: ScoreBreakdown;
  profile: Profile;
  practiceCompleted?: boolean;
  replay?: ReplaySample[];
}
export interface Session {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  expiresAt: string;
  label: string;
  drivers: Driver[];
  activeDriverId: string;
  profile: Profile;
  results: Attempt[];
  suite: Suite;
  activeAttempt?: {
    driverId: string;
    testId: TestId;
    scheduledTrial: number;
    startedAt: string;
    profile: Profile;
  };
  practiceExposure: Record<string, number>;
}
export interface Gate {
  id: string;
  x: number;
  y: number;
  yaw: number;
  width: number;
}
export interface Target extends Pose {
  width: number;
  length: number;
  dwell: number;
  speed: number;
  centerTolerance?: number;
  headingTolerance?: number;
}
export interface CourseSegment {
  start?: Pose;
  gate?: Gate;
  gates?: Gate[];
  target: Target;
  route: Pose[];
  entrySpeed?: [number, number];
  cue?: "left" | "right";
  cueDelay?: number;
}
export interface CourseDefinition {
  id: TestId;
  name: string;
  skill: string;
  version: string;
  description: string;
  instructions: string[];
  timeLimit: number;
  start: Pose;
  segments: CourseSegment[];
  corridor: { x: number; y: number }[];
  obstacles: {
    id: string;
    x: number;
    y: number;
    width: number;
    length: number;
    yaw: number;
  }[];
  seed: number;
  profileId: string;
}
export interface RunnerFeedback {
  state: "ready" | "running" | "completed" | "dnf" | "invalid";
  checkpoint: number;
  total: number;
  elapsed: number;
  dwell: number;
  instruction: string;
  cue: string | null;
  target: Target | null;
  gate: Gate | null;
  metrics: MetricValues;
}
