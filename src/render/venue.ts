import * as THREE from "three";
import { FREE_GATES, FREE_OBSTACLES } from "../../content/courses/free";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import {
  box,
  createRobot,
  disposeObject,
  mergeStatic,
  PALETTE,
  textPlane,
  texture,
} from "./assets";
import type { RobotVisual } from "./assets";
import type {
  CameraMode,
  CourseDefinition,
  GraphicsTier,
  RobotPreset,
  RunnerFeedback,
  SimSnapshot,
} from "../types";

export class Venue {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(44, 16 / 9, 0.05, 120);
  private environment: THREE.WebGLRenderTarget;
  private robot: RobotVisual;
  private courseGroup = new THREE.Group();
  private activeTarget = new THREE.Group();
  private activeGate = new THREE.Group();
  private lastCheckpoint = "";
  private trail: THREE.Line;
  private trailPositions = new Float32Array(3000 * 3);
  private trailCount = 0;
  private cameraMode: CameraMode = "station";
  private hero: boolean;
  private orbitAngle = -0.7;
  private lastSnapshot: SimSnapshot | null = null;
  private disposed = false;
  private warming: Promise<unknown> | null = null;
  private resourcesDisposed = false;
  constructor(
    readonly canvas: HTMLCanvasElement,
    preset: RobotPreset,
    readonly tier: GraphicsTier = "standard",
    hero = false,
  ) {
    this.hero = hero;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(
      hero
        ? Math.min(devicePixelRatio, 1.5)
        : tier === "performance"
          ? 1
          : Math.min(devicePixelRatio, tier === "high" ? 2 : 1.25),
    );
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = hero ? 0.9 : 1.0;
    this.scene.background = new THREE.Color(hero ? 0x182c30 : 0x202e35);
    this.scene.fog = new THREE.Fog(hero ? 0x182c30 : 0x202e35, 22, 60);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.environment = pmrem.fromScene(room, 0.05);
    this.scene.environment = this.environment.texture;
    room.dispose();
    pmrem.dispose();
    this.scene.add(new THREE.HemisphereLight(0xe2f3f6, 0x354a40, 1.5));
    const key = new THREE.DirectionalLight(0xfff5df, 3.1);
    key.position.set(3, 12, -2);
    key.castShadow = true;
    key.shadow.mapSize.setScalar(
      tier === "high" ? 2048 : tier === "standard" ? 1536 : 1024,
    );
    key.shadow.camera.left = -13;
    key.shadow.camera.right = 13;
    key.shadow.camera.top = 10;
    key.shadow.camera.bottom = -10;
    key.shadow.normalBias = 0.025;
    key.shadow.bias = -0.0001;
    key.target.position.set(7, 0, -4);
    this.scene.add(key, key.target);
    const rim = new THREE.DirectionalLight(0xaedee1, 1.1);
    rim.position.set(14, 5, -9);
    this.scene.add(rim);
    this.robot = createRobot(preset);
    this.scene.add(this.robot.root);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(this.trailPositions, 3),
    );
    trailGeo.setDrawRange(0, 0);
    this.trail = new THREE.Line(
      trailGeo,
      new THREE.LineBasicMaterial({
        color: PALETTE.mint,
        transparent: true,
        opacity: 0.55,
      }),
    );
    this.scene.add(this.trail);
    this.trail.frustumCulled = false;
    if (hero) {
      this.buildStage();
      this.robot.root.position.set(0, 0, 0);
      this.camera.position.set(1.35, 1.03, 1.45);
      this.camera.lookAt(0, 0.17, 0);
      key.position.set(1, 5, 2);
      key.target.position.set(0, 0, 0);
      key.shadow.camera.left = -2;
      key.shadow.camera.right = 2;
      key.shadow.camera.top = 2;
      key.shadow.camera.bottom = -2;
    } else this.buildVenue();
    this.scene.add(this.courseGroup, this.activeTarget, this.activeGate);
    this.resize();
  }
  private buildStage() {
    const m = new THREE.MeshStandardMaterial({
      color: 0x122529,
      roughness: 0.86,
    });
    const platform = new THREE.Mesh(
      new THREE.CylinderGeometry(0.85, 0.89, 0.06, 80),
      m,
    );
    platform.position.y = -0.034;
    platform.receiveShadow = true;
    this.scene.add(platform);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshStandardMaterial({ color: 0x09181d, roughness: 0.96 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.07;
    floor.receiveShadow = true;
    this.scene.add(floor);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.8, 0.004, 6, 100),
      new THREE.MeshStandardMaterial({
        color: PALETTE.mint,
        emissive: PALETTE.mint,
        emissiveIntensity: 0.4,
      }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.001;
    this.scene.add(ring);
  }
  private buildVenue() {
    const fixed = new THREE.Group();
    this.scene.add(fixed);
    const carpet = texture("carpet");
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0xa5a7a1,
      map: carpet,
      bumpMap: carpet,
      bumpScale: 0.004,
      roughness: 1,
    });
    box(fixed, 16, 0.08, 8, 8, -0.041, -4, floorMat);
    const concrete = new THREE.MeshStandardMaterial({
      color: 0x324247,
      roughness: 0.92,
    });
    box(fixed, 38, 0.1, 30, 8, -0.12, -4, concrete);
    const frame = new THREE.MeshStandardMaterial({
      color: 0x55676d,
      roughness: 0.46,
      metalness: 0.66,
    });
    const panel = new THREE.MeshStandardMaterial({
      color: 0x243b42,
      roughness: 0.73,
      metalness: 0.2,
    });
    // Low field walls with aluminum cap and regularly spaced posts.
    for (const z of [0.1, -8.1]) {
      box(fixed, 16.35, 0.22, 0.16, 8, 0.11, z, panel, 0.025);
      box(fixed, 16.35, 0.025, 0.2, 8, 0.233, z, frame, 0.006);
      for (let x = 0; x <= 16; x += 2)
        box(fixed, 0.06, 0.39, 0.1, x, 0.195, z, frame, 0.006);
    }
    for (const x of [-0.1, 16.1]) {
      box(fixed, 0.16, 0.22, 8.35, x, 0.11, -4, panel, 0.02);
      box(fixed, 0.2, 0.025, 8.35, x, 0.233, -4, frame, 0.006);
    }
    const tape = new THREE.MeshStandardMaterial({
      color: 0xe0e7d6,
      roughness: 0.9,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    const green = new THREE.MeshStandardMaterial({
      color: 0x92b785,
      roughness: 1,
    });
    for (const z of [-0.2, -7.8])
      box(fixed, 15.6, 0.003, 0.035, 8, 0.004, z, tape);
    for (const x of [0.2, 15.8])
      box(fixed, 0.035, 0.003, 7.6, x, 0.004, -4, tape);
    box(fixed, 0.04, 0.003, 7.5, 8, 0.005, -4, tape);
    for (let x = 1; x < 16; x++) {
      box(fixed, 0.018, 0.003, 0.14, x, 0.006, -0.32, tape);
      box(fixed, 0.018, 0.003, 0.14, x, 0.006, -7.68, tape);
    }
    for (const x of [1.4, 14.6]) {
      box(fixed, 1.6, 0.003, 1.15, x, 0.003, -4, green);
      const txt = textPlane(x < 2 ? "START" : "DRIVER LAB", 1.2, "#233c38");
      txt.rotation.x = -Math.PI / 2;
      txt.rotation.z = -Math.PI / 2;
      txt.position.set(x, 0.012, -4);
      fixed.add(txt);
    }
    const center = new THREE.Mesh(
      new THREE.RingGeometry(0.72, 0.745, 64),
      tape,
    );
    center.rotation.x = -Math.PI / 2;
    center.position.set(8, 0.007, -4);
    fixed.add(center);
    // Structural backdrop: acoustic panels, braces, venue identity, luminous roof strips.
    box(fixed, 0.2, 5.5, 20, 19, 2.6, -4, panel);
    box(fixed, 35, 5.5, 0.2, 8, 2.6, -13, panel);
    for (let z = -12; z <= 4; z += 2) {
      box(fixed, 0.18, 5.5, 0.12, 18.85, 2.6, z, frame);
      box(fixed, 0.04, 1.25, 1.7, 18.72, 1.05, z - 0.9, concrete);
    }
    for (let x = -4; x <= 19; x += 4) {
      box(fixed, 0.18, 5.5, 0.15, x, 2.6, -12.8, frame);
      box(fixed, 0.12, 0.16, 24, x, 9.25, -4, frame);
    }
    const wallLogo = textPlane("FRC DRIVER LAB", 7.4);
    wallLogo.position.set(18.74, 3, -4);
    wallLogo.rotation.y = -Math.PI / 2;
    fixed.add(wallLogo);
    const wallSub = textPlane(
      "CONTROL  /  PRECISION  /  PROGRESS",
      6,
      "#8da49e",
    );
    wallSub.position.set(18.73, 2, -4);
    wallSub.rotation.y = -Math.PI / 2;
    fixed.add(wallSub);
    // Low equipment benches outside the playable arena.
    for (const z of [-10.5, 2.5]) {
      box(fixed, 5, 0.09, 0.6, 11, 0.65, z, frame, 0.025);
      for (const x of [8.8, 13.2])
        box(fixed, 0.07, 0.65, 0.45, x, 0.29, z, panel);
      for (let i = 0; i < 4; i++)
        box(fixed, 0.52, 0.34, 0.46, 9.5 + i * 0.8, 0.21, z, panel, 0.035);
    }
    // All static material buckets merged to keep field draw calls modest.
    mergeStatic(fixed);
  }
  setRobot(preset: RobotPreset) {
    disposeObject(this.robot.root);
    this.robot.root.removeFromParent();
    this.robot = createRobot(preset);
    this.scene.add(this.robot.root);
  }
  setCamera(mode: CameraMode) {
    this.cameraMode = mode;
  }
  setOrbit(delta: number) {
    this.orbitAngle += delta;
  }
  resize() {
    if (this.disposed) return;
    const w = Math.max(1, this.canvas.clientWidth),
      h = Math.max(1, this.canvas.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  setCourse(course: CourseDefinition | null) {
    disposeObject(this.courseGroup);
    this.courseGroup.clear();
    this.lastCheckpoint = "";
    this.trailCount = 0;
    this.trail.geometry.setDrawRange(0, 0);
    const white = new THREE.MeshStandardMaterial({
      color: 0xe1e8dc,
      roughness: 0.88,
    });
    const dark = new THREE.MeshStandardMaterial({
      color: 0x304a4b,
      metalness: 0.6,
      roughness: 0.4,
    });
    if (!course) {
      FREE_GATES.forEach((g, i) =>
        this.drawGate(
          this.courseGroup,
          g.x,
          g.y,
          g.yaw,
          g.width,
          white,
          String(i + 1),
        ),
      );
      for (const post of FREE_OBSTACLES) {
        const body = new THREE.Mesh(
          new THREE.CylinderGeometry(0.07, 0.07, 0.36, 12),
          dark,
        );
        body.position.set(post.x, 0.18, -post.y);
        body.castShadow = true;
        this.courseGroup.add(body);
        box(
          this.courseGroup,
          0.14,
          0.06,
          0.14,
          post.x,
          0.34,
          -post.y,
          white,
          0.014,
        );
      }
      this.drawTarget(this.courseGroup, 12, 6, 0, 1.2, 1.2, white);
      this.drawTarget(this.courseGroup, 6, 1.7, Math.PI / 4, 1.2, 1.2, white);
      return;
    }
    for (const obstacle of course.obstacles) {
      const obj = new THREE.Group();
      obj.position.set(obstacle.x, 0, -obstacle.y);
      obj.rotation.y = obstacle.yaw;
      box(obj, obstacle.length, 0.42, obstacle.width, 0, 0.21, 0, dark, 0.02);
      box(
        obj,
        obstacle.length + 0.018,
        0.065,
        obstacle.width + 0.018,
        0,
        0.39,
        0,
        white,
        0.008,
      );
      this.courseGroup.add(obj);
    }
    course.segments.forEach((seg, i) => {
      for (const gate of seg.gates ?? (seg.gate ? [seg.gate] : []))
        this.drawGate(
          this.courseGroup,
          gate.x,
          gate.y,
          gate.yaw,
          gate.width,
          white,
          String(i + 1),
        );
      this.drawTarget(
        this.courseGroup,
        seg.target.x,
        seg.target.y,
        seg.target.yaw,
        seg.target.length,
        seg.target.width,
        white,
      );
      if (course.id === "T05") {
        const line = new THREE.Group();
        line.position.set(seg.target.x, 0.016, -seg.target.y);
        line.rotation.y = seg.target.yaw;
        box(
          line,
          0.065,
          0.004,
          seg.target.width,
          0,
          0,
          0,
          new THREE.MeshStandardMaterial({ color: 0xf6b568, roughness: 0.8 }),
        );
        const sign = textPlane("STOP LINE", 1.0, "#f6b568");
        sign.rotation.x = -Math.PI / 2;
        sign.rotation.z = -Math.PI / 2;
        sign.position.set(0.4, 0.006, 0);
        line.add(sign);
        this.courseGroup.add(line);
      }
    });
    if (course.corridor.length) {
      const points = course.corridor.map(
        (v) => new THREE.Vector3(v.x, 0.008, -v.y),
      );
      points.push(points[0]);
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineDashedMaterial({
          color: 0xd9ac68,
          dashSize: 0.2,
          gapSize: 0.14,
        }),
      );
      line.computeLineDistances();
      this.courseGroup.add(line);
    }
  }
  private drawTarget(
    parent: THREE.Group,
    x: number,
    y: number,
    yaw: number,
    length: number,
    width: number,
    mat: THREE.Material,
  ) {
    const g = new THREE.Group();
    g.position.set(x, 0.012, -y);
    g.rotation.y = yaw;
    for (const z of [-width / 2, width / 2])
      box(g, length, 0.003, 0.033, 0, 0, z, mat);
    for (const px of [-length / 2, length / 2])
      box(g, 0.033, 0.003, width, px, 0, 0, mat);
    box(g, 0.1, 0.003, 0.04, 0.1, 0.002, 0, mat);
    box(g, 0.04, 0.003, 0.1, 0, 0.002, 0, mat);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.17, 3), mat);
    tip.rotation.z = -Math.PI / 2;
    tip.rotation.x = Math.PI / 2;
    tip.position.set(length / 2 - 0.16, 0.014, 0);
    g.add(tip);
    parent.add(g);
  }
  private drawGate(
    parent: THREE.Group,
    x: number,
    y: number,
    yaw: number,
    width: number,
    mat: THREE.Material,
    num: string,
  ) {
    const g = new THREE.Group();
    g.position.set(x, 0.014, -y);
    g.rotation.y = yaw;
    box(g, 0.033, 0.002, width, 0, 0, 0, mat);
    for (const z of [-width / 2, width / 2])
      box(g, 0.22, 0.004, 0.06, 0, 0.002, z, mat);
    const label = textPlane(num, 0.44);
    label.rotation.x = -Math.PI / 2;
    label.rotation.z = Math.PI / 2;
    label.position.set(-0.25, 0.005, -width / 2 - 0.2);
    g.add(label);
    parent.add(g);
  }
  update(
    snapshot: SimSnapshot,
    feedback: RunnerFeedback | null,
    trail = false,
  ) {
    this.lastSnapshot = snapshot;
    this.robot.update(snapshot);
    if (trail && snapshot.tick % 4 === 0 && this.trailCount < 3000) {
      const i = this.trailCount++ * 3;
      this.trailPositions[i] = snapshot.x;
      this.trailPositions[i + 1] = 0.023;
      this.trailPositions[i + 2] = -snapshot.y;
      this.trail.geometry.attributes.position.needsUpdate = true;
      this.trail.geometry.setDrawRange(0, this.trailCount);
    }
    this.trail.visible = trail;
    const progressKey = feedback
      ? `${feedback.checkpoint}:${feedback.gate?.id ?? "target"}`
      : "";
    if (feedback && progressKey !== this.lastCheckpoint) {
      this.lastCheckpoint = progressKey;
      disposeObject(this.activeTarget);
      this.activeTarget.clear();
      disposeObject(this.activeGate);
      this.activeGate.clear();
      const material = new THREE.MeshStandardMaterial({
        color: PALETTE.mint,
        emissive: PALETTE.mint,
        emissiveIntensity: 0.2,
        roughness: 0.8,
      });
      const t = feedback.target;
      if (t)
        this.drawTarget(
          this.activeTarget,
          t.x,
          t.y,
          t.yaw,
          t.length,
          t.width,
          material,
        );
      const g = feedback.gate;
      if (g)
        this.drawGate(
          this.activeGate,
          g.x,
          g.y,
          g.yaw,
          g.width,
          material,
          "GO",
        );
    }
  }
  render(time = 0) {
    if (this.disposed) return;
    if (this.hero) {
      this.robot.root.rotation.y = 0.4 + Math.sin(time * 0.00015) * 0.13;
    } else {
      const s = this.lastSnapshot ?? { x: 2, y: 4, yaw: 0 };
      if (this.cameraMode === "station") {
        this.camera.position.set(-5.8, 8.7, -4);
        this.camera.lookAt(7.3, 0, -4);
      } else if (this.cameraMode === "overhead") {
        this.camera.position.set(8, 15, -4);
        this.camera.lookAt(8, 0, -4);
        this.camera.up.set(1, 0, 0);
      } else if (this.cameraMode === "chase") {
        const c = Math.cos(s.yaw),
          sn = Math.sin(s.yaw);
        this.camera.position.lerp(
          new THREE.Vector3(s.x - c * 3.3, 2.3, -s.y + sn * 3.3),
          0.1,
        );
        this.camera.up.set(0, 1, 0);
        this.camera.lookAt(s.x + c, 0.1, -s.y - sn);
      } else {
        this.camera.position.set(
          s.x + Math.cos(this.orbitAngle) * 3.4,
          2.9,
          -s.y + Math.sin(this.orbitAngle) * 3.4,
        );
        this.camera.up.set(0, 1, 0);
        this.camera.lookAt(s.x, 0.1, -s.y);
      }
    }
    if (this.cameraMode === "station") this.camera.up.set(0, 1, 0);
    this.renderer.render(this.scene, this.camera);
  }
  async warm() {
    if (this.disposed) return;
    // Three polls material programs during parallel shader compilation. Keep them
    // alive until that work settles even if React has already removed the canvas.
    this.warming ??= this.renderer.compileAsync(this.scene, this.camera);
    try {
      await this.warming;
    } finally {
      this.warming = null;
      if (this.disposed) this.releaseResources();
    }
    if (!this.disposed) this.render();
  }
  stats() {
    const r = this.renderer.info;
    return {
      drawCalls: r.render.calls,
      triangles: r.render.triangles,
      geometries: r.memory.geometries,
      textures: r.memory.textures,
      resolution: [this.canvas.width, this.canvas.height] as [number, number],
    };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (!this.warming) this.releaseResources();
  }
  private releaseResources() {
    if (this.resourcesDisposed) return;
    this.resourcesDisposed = true;
    disposeObject(this.scene);
    this.environment.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
