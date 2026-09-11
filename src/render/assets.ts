import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { RobotPreset, SimSnapshot } from "../types";

export const PALETTE = {
  mint: 0xc5ee8f,
  green: 0x91c66a,
  dark: 0x17272c,
  teal: 0x2f6563,
  steel: 0xa1abb0,
  orange: 0xf4a75b,
  white: 0xecefe5,
};
export function texture(kind: "carpet" | "fabric" | "metal", size = 256) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const data = ctx.createImageData(size, size);
  let seed = 713;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      seed = (1664525 * seed + 1013904223) >>> 0;
      const n = seed / 4294967296 - 0.5;
      let v =
        kind === "metal"
          ? 175 + n * 12
          : kind === "fabric"
            ? 180 + n * 42
            : 100 + n * 32;
      if (kind === "fabric") v += x % 3 === 0 || y % 3 === 0 ? -25 : 0;
      if (kind === "metal") v += (y % 3) * 3;
      const i = (y * size + x) * 4;
      data.data[i] = v;
      data.data[i + 1] = v;
      data.data[i + 2] = v;
      data.data[i + 3] = 255;
    }
  ctx.putImageData(data, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.repeat.set(kind === "carpet" ? 48 : 2, kind === "carpet" ? 24 : 2);
  return tex;
}
export function labelTexture(
  text: string,
  color = "#eaf0df",
  bg = "transparent",
  size = 512,
) {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size / 4;
  const ctx = c.getContext("2d")!;
  if (bg !== "transparent") {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, c.width, c.height);
  }
  ctx.fillStyle = color;
  ctx.font = `800 ${Math.min(size * 0.12, (size * 1.45) / Math.max(1, text.length))}px Arial`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, size / 2, size / 8, size * 0.95);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
export function textPlane(text: string, width: number, color = "#eaf0df") {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(width, width / 4),
    new THREE.MeshBasicMaterial({
      map: labelTexture(text, color),
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  return m;
}
export function box(
  parent: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  mat: THREE.Material,
  round = 0,
) {
  const m = new THREE.Mesh(
    round
      ? new RoundedBoxGeometry(w, h, d, 2, round)
      : new THREE.BoxGeometry(w, h, d),
    mat,
  );
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
function cylinder(
  parent: THREE.Object3D,
  r: number,
  length: number,
  x: number,
  y: number,
  z: number,
  mat: THREE.Material,
  segments = 16,
) {
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r, length, segments),
    mat,
  );
  m.position.set(x, y, z);
  parent.add(m);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
/** Merge only static meshes by material, preserving articulated wheel/module children. */
export function mergeStatic(group: THREE.Group) {
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const meshes: THREE.Mesh[] = [];
  group.updateMatrixWorld(true);
  const inverse = group.matrixWorld.clone().invert();
  group.traverse((o) => {
    if (o instanceof THREE.Mesh && !Array.isArray(o.material)) {
      let p = o.parent;
      let animated = false;
      while (p && p !== group) {
        if (p.userData.animated) animated = true;
        p = p.parent;
      }
      if (animated || o.userData.animated) return;
      const clone = o.geometry.clone();
      const g = clone.index ? clone.toNonIndexed() : clone;
      if (g !== clone) clone.dispose();
      g.applyMatrix4(
        new THREE.Matrix4().multiplyMatrices(inverse, o.matrixWorld),
      );
      const list = buckets.get(o.material) || [];
      list.push(g);
      buckets.set(o.material, list);
      meshes.push(o);
    }
  });
  for (const mesh of meshes) {
    mesh.removeFromParent();
    mesh.geometry.dispose();
  }
  for (const [material, geometries] of buckets) {
    const g = mergeGeometries(geometries, false);
    geometries.forEach((v) => v.dispose());
    if (g) {
      const mesh = new THREE.Mesh(g, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
}
export interface RobotVisual {
  root: THREE.Group;
  update(s: SimSnapshot): void;
}
export function createRobot(preset: RobotPreset): RobotVisual {
  const root = new THREE.Group();
  const fixed = new THREE.Group();
  root.add(fixed);
  const brushed = texture("metal");
  const cloth = texture("fabric");
  const steel = new THREE.MeshStandardMaterial({
    color: 0xc5cdd0,
    metalness: 0.86,
    roughness: 0.34,
    map: brushed,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: 0x253037,
    metalness: 0.72,
    roughness: 0.42,
  });
  const rubber = new THREE.MeshStandardMaterial({
    color: 0x151e22,
    roughness: 0.94,
  });
  const hubs = new THREE.MeshStandardMaterial({
    color: 0x73908e,
    metalness: 0.72,
    roughness: 0.35,
  });
  const fabric = new THREE.MeshStandardMaterial({
    color: 0x4c8c8e,
    map: cloth,
    bumpMap: cloth,
    bumpScale: 0.0018,
    roughness: 1,
  });
  const trim = new THREE.MeshStandardMaterial({
    color: PALETTE.mint,
    roughness: 0.67,
  });
  const copper = new THREE.MeshStandardMaterial({
    color: 0xd9904f,
    metalness: 0.65,
    roughness: 0.38,
  });
  const L = preset.length,
    B = preset.width;
  // Open extruded aluminum frame, bottom belly pan, and crossmembers.
  box(fixed, L - 0.18, 0.035, B - 0.18, 0, 0.145, 0, dark, 0.012);
  for (const z of [-B / 2 + 0.14, B / 2 - 0.14])
    box(fixed, L - 0.19, 0.075, 0.048, 0, 0.24, z, steel, 0.008);
  for (const x of [-L / 2 + 0.14, L / 2 - 0.14])
    box(fixed, 0.05, 0.075, B - 0.19, x, 0.24, 0, steel, 0.008);
  for (const x of [-0.16, 0.17])
    box(fixed, 0.035, 0.035, B - 0.21, x, 0.2, 0, steel, 0.005);
  // Exposed battery, electronics, controller fins and deliberately routed cables.
  box(fixed, 0.23, 0.12, 0.14, -0.12, 0.23, 0, dark, 0.01);
  box(fixed, 0.15, 0.018, 0.145, -0.12, 0.296, 0, trim, 0.005);
  box(fixed, 0.14, 0.028, 0.17, 0.16, 0.22, 0.04, hubs, 0.008);
  box(
    fixed,
    0.11,
    0.012,
    0.1,
    0.16,
    0.258,
    0.04,
    new THREE.MeshStandardMaterial({
      color: 0x2f6e80,
      metalness: 0.35,
      roughness: 0.3,
    }),
    0.004,
  );
  for (const side of [-1, 1]) {
    box(fixed, 0.28, 0.018, 0.018, -0.02, 0.29, side * 0.2, steel, 0.003);
    const wire = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.15, 0.31, side * 0.075),
      new THREE.Vector3(-0.22, 0.305, side * 0.17),
      new THREE.Vector3(0.05, 0.305, side * 0.24),
      new THREE.Vector3(0.22, 0.26, side * 0.22),
    ]);
    fixed.add(
      new THREE.Mesh(
        new THREE.TubeGeometry(wire, 18, 0.0035, 6, false),
        copper,
      ),
    );
  }
  for (let i = 0; i < 7; i++)
    box(
      fixed,
      0.105,
      0.025,
      0.008,
      0.16,
      0.245,
      -0.026 + i * 0.022,
      steel,
      0.002,
    );
  for (const sign of [-1, 1]) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.12, 0.3, sign * 0.045),
      new THREE.Vector3(-0.02, 0.32, sign * 0.09),
      new THREE.Vector3(0.12, 0.27, sign * 0.08),
    ]);
    fixed.add(
      new THREE.Mesh(
        new THREE.TubeGeometry(curve, 10, 0.005, 6, false),
        sign === 1 ? copper : rubber,
      ),
    );
  }
  // Bumper perimeter matches physics, with piping and lower seam.
  for (const z of [-B / 2 + 0.046, B / 2 - 0.046]) {
    box(fixed, L, 0.165, 0.092, 0, 0.365, z, fabric, 0.028);
    box(
      fixed,
      L - 0.055,
      0.009,
      0.006,
      0,
      0.424,
      z + Math.sign(z) * 0.047,
      trim,
      0.002,
    );
  }
  for (const x of [-L / 2 + 0.046, L / 2 - 0.046]) {
    box(fixed, 0.092, 0.165, B - 0.12, x, 0.365, 0, fabric, 0.028);
  }
  for (const side of [-1, 1]) {
    const plate = textPlane(
      preset.kind === "swerve"
        ? "SW / 04"
        : preset.kind === "mecanum"
          ? "MC / 04"
          : "DF / 06",
      0.47,
    );
    plate.position.set(0, 0.37, side * (B / 2 + 0.003));
    if (side < 0) plate.rotation.y = Math.PI;
    fixed.add(plate);
  }
  // Front chevron and status lights visible from the driver station.
  box(fixed, 0.014, 0.15, 0.28, L / 2 + 0.002, 0.363, 0, trim, 0.004);
  const arrowShape = new THREE.Shape();
  arrowShape.moveTo(0.09, -0.07);
  arrowShape.lineTo(0.23, 0);
  arrowShape.lineTo(0.09, 0.07);
  arrowShape.lineTo(0.12, 0);
  arrowShape.closePath();
  const arrow = new THREE.Mesh(
    new THREE.ShapeGeometry(arrowShape),
    new THREE.MeshStandardMaterial({
      color: PALETTE.mint,
      side: THREE.DoubleSide,
    }),
  );
  arrow.rotation.x = -Math.PI / 2;
  arrow.position.y = 0.295;
  fixed.add(arrow);
  for (const z of [-0.16, 0.16])
    box(
      fixed,
      0.06,
      0.025,
      0.025,
      -0.1,
      0.318,
      z,
      new THREE.MeshStandardMaterial({
        color: PALETTE.mint,
        emissive: PALETTE.mint,
        emissiveIntensity: 0.6,
      }),
      0.006,
    );
  // Low-cost fastener heads on frame rails.
  for (const x of [-0.3, -0.2, 0, 0.2, 0.3])
    for (const z of [-0.31, 0.31])
      cylinder(fixed, 0.008, 0.006, x, 0.281, z, steel, 6);
  const wheels: { steer: THREE.Group; roll: THREE.Group }[] = [];
  const xs =
    preset.kind === "differential"
      ? [preset.wheelbase / 2, 0, -preset.wheelbase / 2]
      : [preset.wheelbase / 2, -preset.wheelbase / 2];
  // Wheel order is front-left, front-right, then next axle left/right.
  for (const x of xs)
    for (const y of [preset.track / 2, -preset.track / 2]) {
      const steer = new THREE.Group();
      steer.userData.animated = true;
      steer.position.set(x, preset.wheelRadius, -y);
      root.add(steer);
      const roll = new THREE.Group();
      roll.userData.animated = true;
      steer.add(roll);
      const tire = cylinder(
        roll,
        preset.wheelRadius,
        0.075,
        0,
        0,
        0,
        rubber,
        24,
      );
      tire.rotation.x = Math.PI / 2;
      for (const side of [-1, 1]) {
        const rim = cylinder(
          roll,
          preset.wheelRadius * 0.67,
          0.009,
          0,
          0,
          side * 0.041,
          hubs,
          16,
        );
        rim.rotation.x = Math.PI / 2;
        const axle = cylinder(
          roll,
          0.016,
          0.014,
          0,
          0,
          side * 0.049,
          steel,
          12,
        );
        axle.rotation.x = Math.PI / 2;
        for (let i = 0; i < 6; i++) {
          const a = (i * Math.PI) / 3;
          const spoke = box(
            roll,
            0.011,
            preset.wheelRadius * 0.95,
            0.005,
            Math.sin(a) * 0.031,
            Math.cos(a) * 0.031,
            side * 0.048,
            steel,
          );
          spoke.rotation.z = -a;
        }
      }
      if (preset.kind === "mecanum")
        for (let i = 0; i < 8; i++) {
          const a = (i * Math.PI) / 4;
          const roller = cylinder(
            roll,
            0.024,
            0.073,
            Math.sin(a) * preset.wheelRadius * 0.91,
            Math.cos(a) * preset.wheelRadius * 0.91,
            0,
            hubs,
            10,
          );
          roller.rotation.set(
            Math.PI / 2,
            0,
            -a + ((x * y > 0 ? 1 : -1) * Math.PI) / 4,
          );
        }
      else
        for (let i = 0; i < 14; i++) {
          const a = (i * Math.PI) / 7;
          const tread = box(
            roll,
            0.013,
            0.008,
            0.076,
            Math.sin(a) * preset.wheelRadius,
            Math.cos(a) * preset.wheelRadius,
            0,
            dark,
            0.002,
          );
          tread.rotation.z = -a;
        }
      // Machined fork and finite-steering cap remain fixed relative to steering assembly.
      for (const sign of [-1, 1])
        box(steer, 0.13, 0.1, 0.016, 0, 0.063, sign * 0.057, steel, 0.008);
      box(steer, 0.14, 0.024, 0.13, 0, 0.116, 0, dark, 0.01);
      if (preset.kind === "swerve") {
        cylinder(steer, 0.055, 0.025, 0, 0.137, 0, hubs, 20);
        const motor = cylinder(steer, 0.032, 0.083, -0.049, 0.18, 0, dark, 16);
        motor.rotation.z = Math.PI / 2;
      }
      mergeStatic(roll);
      mergeStatic(steer);
      wheels.push({ steer, roll });
    }
  mergeStatic(fixed);
  return {
    root,
    update(s) {
      root.position.set(s.x, 0, -s.y);
      root.rotation.y = s.yaw;
      for (let i = 0; i < wheels.length; i++) {
        const state = s.wheels[i];
        if (!state) continue;
        wheels[i].steer.position.set(state.x, preset.wheelRadius, -state.y);
        wheels[i].steer.rotation.y = preset.kind === "swerve" ? state.angle : 0;
        wheels[i].roll.rotation.z = -state.rotation;
      }
    },
  };
}
export function disposeObject(root: THREE.Object3D) {
  const geos = new Set<THREE.BufferGeometry>();
  const mats = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((o) => {
    if (
      o instanceof THREE.Mesh ||
      o instanceof THREE.Line ||
      o instanceof THREE.Points
    ) {
      geos.add(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : [o.material])
        mats.add(m);
    }
  });
  for (const m of mats) {
    for (const v of Object.values(m))
      if (v instanceof THREE.Texture) textures.add(v);
    m.dispose();
  }
  textures.forEach((t) => t.dispose());
  geos.forEach((g) => g.dispose());
}
