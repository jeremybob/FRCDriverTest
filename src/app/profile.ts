import type { Profile } from "../types";
import { ROBOTS } from "../../content/robots";
import { defaultInputSettings } from "../input";
import { profileHash } from "../session";
import { COURSE_VERSION } from "../tests/courses";
import { RUBRIC_VERSION } from "../scoring";
export const BUILD_ID =
  import.meta.env.VITE_BUILD_ID ?? "frc-driver-lab-1.0.0-development";
export function defaultProfile(): Profile {
  const profile: Profile = {
    id: "generic-core-v1",
    hash: "",
    robot: structuredClone(ROBOTS[0]),
    physicsVersion: "rapier-0.19.3-force-1.0.0",
    buildId: BUILD_ID,
    courseVersion: COURSE_VERSION,
    rubricVersion: RUBRIC_VERSION,
    inputClass: "keyboard",
    controlFrame: "field",
    input: { ...structuredClone(defaultInputSettings), calibrated: true },
    bindingHash: "",
    assistance: { precision: true, brake: true, speedLimit: 1 },
    camera: "station",
    graphicsTier: "standard",
    renderResolution: [1280, 720],
    display: {
      width: window.innerWidth,
      height: window.innerHeight,
      pixelRatio: window.devicePixelRatio,
      description: "Physical display size and viewing distance not recorded",
    },
    difficulty: "core-standard",
    seedSet: [101, 202, 303],
    scheduleId: "balanced-v1",
    accommodation: "None",
    deviceDescription: "Keyboard",
    qualification:
      "Provisional rubric; generic uncalibrated robot; physical station and USB latency unverified",
    familiarizationSeconds: 0,
  };
  return freezeProfile(profile);
}
export function freezeProfile(p: Profile): Profile {
  const profile = structuredClone(p);
  profile.inputClass = profile.input.device;
  if (profile.robot.kind === "differential") profile.controlFrame = "robot";
  profile.id = `${profile.robot.kind}-${profile.controlFrame}-${profile.inputClass}-core-v1`;
  profile.bindingHash = profileHash(profile.input);
  profile.hash = profileHash(profile);
  return profile;
}
