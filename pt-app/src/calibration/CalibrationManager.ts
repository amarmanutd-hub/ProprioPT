/**
 * CalibrationManager — static T-pose capture → session R_scale.
 *
 * Patent-safe: absolute geometric distances only (torso vs femur).
 * No reference video, frame matching, or sequence sync.
 */

import type { JointLandmark } from "../perception/PerceptionEngine";

export type CalibrationPhase = "idle" | "running" | "complete" | "failed";

export interface CalibrationSession {
  /** R_scale = torsoLength / femurLength at T-pose. */
  rScale: number;
  torsoDist: number;
  femurDist: number;
  /** Mid-hip origin in world space at calibration. */
  originWorld: { x: number; y: number; z: number };
  sampleCount: number;
  completedAtMs: number;
}

export interface CalibrationProgress {
  phase: CalibrationPhase;
  /** 0–1 progress through the 5s hold window. */
  progress: number;
  /** True when current frame passes absolute T-pose geometric gates. */
  tPoseOk: boolean;
  message: string;
  session: CalibrationSession | null;
}

export interface CalibrationManagerOptions {
  /** Hold duration in ms (default 5000). */
  durationMs?: number;
  onProgress?: (p: CalibrationProgress) => void;
  onComplete?: (session: CalibrationSession) => void;
  onFailed?: (reason: string) => void;
}

// MediaPipe Pose indices — squat calib only needs torso + legs (not arm T-pose)
const NOSE = 0;
const L_SH = 11;
const R_SH = 12;
const L_HIP = 23;
const R_HIP = 24;
const L_KN = 25;
const R_KN = 26;
const L_ANK = 27;
const R_ANK = 28;

/** Joints needed for squat calibration (torso + femur). No wide T-pose arms. */
const REQUIRED = [NOSE, L_SH, R_SH, L_HIP, R_HIP, L_KN, R_KN, L_ANK, R_ANK] as const;

interface Sample {
  torso: number;
  femur: number;
  origin: { x: number; y: number; z: number };
}

export class CalibrationManager {
  private readonly durationMs: number;
  private readonly onProgress?: (p: CalibrationProgress) => void;
  private readonly onComplete?: (session: CalibrationSession) => void;
  private readonly onFailed?: (reason: string) => void;

  private phase: CalibrationPhase = "idle";
  private startedAt = 0;
  private accumulatedMs = 0;
  private lastTs = 0;
  private samples: Sample[] = [];
  private session: CalibrationSession | null = null;
  private lastTPoseOk = false;

  constructor(options: CalibrationManagerOptions = {}) {
    this.durationMs = options.durationMs ?? 5000;
    this.onProgress = options.onProgress;
    this.onComplete = options.onComplete;
    this.onFailed = options.onFailed;
  }

  getPhase(): CalibrationPhase {
    return this.phase;
  }

  getSession(): CalibrationSession | null {
    return this.session;
  }

  isReady(): boolean {
    return this.phase === "complete" && this.session != null;
  }

  /** Begin / restart the standing calibration window. */
  start(): void {
    this.phase = "running";
    this.startedAt = performance.now();
    this.accumulatedMs = 0;
    this.lastTs = 0;
    this.samples = [];
    this.session = null;
    this.emit("Stand in the outline — head to toe visible, hold still");
  }

  reset(): void {
    this.phase = "idle";
    this.accumulatedMs = 0;
    this.lastTs = 0;
    this.samples = [];
    this.session = null;
    this.emit("Calibration idle");
  }

  /**
   * Feed each perception frame while phase === running.
   * Only accumulates time/samples while standing framing gates pass.
   */
  update(landmarks: JointLandmark[], timestampMs: number): void {
    if (this.phase !== "running") return;

    const map = indexMap(landmarks);
    const tPoseOk = isStandingReady(map);
    this.lastTPoseOk = tPoseOk;

    if (!tPoseOk) {
      this.lastTs = 0;
      this.emit("Move closer until head and feet both fit in the outline");
      return;
    }

    const metrics = measureBody(map);
    if (!metrics) {
      this.emit("Need clear shoulders, hips, and knees");
      return;
    }

    this.samples.push(metrics);

    if (this.lastTs > 0) {
      this.accumulatedMs += Math.min(100, timestampMs - this.lastTs);
    }
    this.lastTs = timestampMs;

    if (this.accumulatedMs >= this.durationMs) {
      this.finalize();
      return;
    }

    const secs = ((this.durationMs - this.accumulatedMs) / 1000).toFixed(1);
    this.emit(`Hold still… ${secs}s`);
  }

  /**
   * Normalize landmarks into calibration-space using femur length as the ruler.
   * World coords are re-expressed relative to mid-hip, scaled so current femur
   * matches the calibrated femur length. Image x/y kept as-is for drawing.
   */
  normalize(landmarks: JointLandmark[]): JointLandmark[] {
    if (!this.session) return landmarks;
    const map = indexMap(landmarks);
    const metrics = measureBody(map);
    if (!metrics || metrics.femur < 1e-6) return landmarks;

    const scale = this.session.femurDist / metrics.femur;
    const o = metrics.origin;

    return landmarks.map((lm) => ({
      ...lm,
      worldX: (lm.worldX - o.x) * scale,
      worldY: (lm.worldY - o.y) * scale,
      worldZ: (lm.worldZ - o.z) * scale,
    }));
  }

  /** Live R_scale from current frame (for HUD); null if incomplete skeleton. */
  liveRScale(landmarks: JointLandmark[]): number | null {
    const metrics = measureBody(indexMap(landmarks));
    if (!metrics || metrics.femur < 1e-6) return null;
    return metrics.torso / metrics.femur;
  }

  private finalize(): void {
    if (this.samples.length < 15) {
      this.phase = "failed";
      const reason = "Not enough stable samples — step a little closer and try again";
      this.onFailed?.(reason);
      this.emit(reason);
      return;
    }

    const torsoDist = median(this.samples.map((s) => s.torso));
    const femurDist = median(this.samples.map((s) => s.femur));
    if (femurDist < 1e-6) {
      this.phase = "failed";
      const reason = "Femur distance too small — step back and retry";
      this.onFailed?.(reason);
      this.emit(reason);
      return;
    }

    const ox = median(this.samples.map((s) => s.origin.x));
    const oy = median(this.samples.map((s) => s.origin.y));
    const oz = median(this.samples.map((s) => s.origin.z));

    this.session = {
      rScale: torsoDist / femurDist,
      torsoDist,
      femurDist,
      originWorld: { x: ox, y: oy, z: oz },
      sampleCount: this.samples.length,
      completedAtMs: performance.now(),
    };
    this.phase = "complete";
    this.onComplete?.(this.session);
    this.emit(
      `Calibrated — R_scale ${this.session.rScale.toFixed(3)} (${this.session.sampleCount} samples)`,
    );
  }

  private emit(message: string): void {
    const progress: CalibrationProgress = {
      phase: this.phase,
      progress:
        this.phase === "complete"
          ? 1
          : Math.min(1, this.accumulatedMs / this.durationMs),
      tPoseOk: this.lastTPoseOk,
      message,
      session: this.session,
    };
    this.onProgress?.(progress);
  }
}

// ── Geometry helpers (absolute rules only) ───────────────────────────────────

function indexMap(landmarks: JointLandmark[]): Map<number, JointLandmark> {
  const m = new Map<number, JointLandmark>();
  for (const lm of landmarks) m.set(lm.index, lm);
  return m;
}

function mid(
  a: JointLandmark,
  b: JointLandmark,
): { x: number; y: number; z: number; worldX: number; worldY: number; worldZ: number } {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
    worldX: (a.worldX + b.worldX) / 2,
    worldY: (a.worldY + b.worldY) / 2,
    worldZ: (a.worldZ + b.worldZ) / 2,
  };
}

function dist3(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): number {
  return Math.hypot(ax - bx, ay - by, az - bz);
}

function worldDist(a: JointLandmark, b: JointLandmark): number {
  return dist3(a.worldX, a.worldY, a.worldZ, b.worldX, b.worldY, b.worldZ);
}

function measureBody(map: Map<number, JointLandmark>): Sample | null {
  for (const idx of REQUIRED) {
    const lm = map.get(idx);
    if (!lm || lm.visibility < 0.35) return null;
  }

  const lSh = map.get(L_SH)!;
  const rSh = map.get(R_SH)!;
  const lHip = map.get(L_HIP)!;
  const rHip = map.get(R_HIP)!;
  const lKn = map.get(L_KN)!;
  const rKn = map.get(R_KN)!;

  const sh = mid(lSh, rSh);
  const hip = mid(lHip, rHip);

  // Prefer world meters; fall back to image+z if world collapsed.
  let torso = dist3(sh.worldX, sh.worldY, sh.worldZ, hip.worldX, hip.worldY, hip.worldZ);
  let femurL = worldDist(lHip, lKn);
  let femurR = worldDist(rHip, rKn);

  if (torso < 1e-5 || femurL < 1e-5 || femurR < 1e-5) {
    torso = dist3(sh.x, sh.y, sh.z, hip.x, hip.y, hip.z);
    femurL = dist3(lHip.x, lHip.y, lHip.z, lKn.x, lKn.y, lKn.z);
    femurR = dist3(rHip.x, rHip.y, rHip.z, rKn.x, rKn.y, rKn.z);
  }

  const femur = (femurL + femurR) / 2;
  if (torso < 1e-6 || femur < 1e-6) return null;

  return {
    torso,
    femur,
    origin: { x: hip.worldX, y: hip.worldY, z: hip.worldZ },
  };
}

/**
 * Standing framing gates (what squat/PT apps actually need):
 * - Head → feet visible (not a wide T-pose — arms-out forces people farther back)
 * - Body fills enough of the frame (too far = fail, step closer)
 * - Upright stance for femur/torso scale
 */
function isStandingReady(map: Map<number, JointLandmark>): boolean {
  for (const idx of REQUIRED) {
    const lm = map.get(idx);
    if (!lm || lm.visibility < 0.4) return false;
  }

  const nose = map.get(NOSE)!;
  const lSh = map.get(L_SH)!;
  const rSh = map.get(R_SH)!;
  const lHip = map.get(L_HIP)!;
  const rHip = map.get(R_HIP)!;
  const lKn = map.get(L_KN)!;
  const rKn = map.get(R_KN)!;
  const lAnk = map.get(L_ANK)!;
  const rAnk = map.get(R_ANK)!;

  const shoulderWidth = Math.abs(lSh.x - rSh.x);
  if (shoulderWidth < 0.06) return false;

  // Head near top, feet near bottom — discourages standing unnecessarily far
  const headY = Math.min(nose.y, lSh.y, rSh.y);
  const footY = Math.max(lAnk.y, rAnk.y);
  const span = footY - headY;
  if (span < 0.52) return false;
  if (headY > 0.28 || footY < 0.78) return false;

  // Standing, not mid-squat
  const standing =
    lKn.y > lHip.y &&
    rKn.y > rHip.y &&
    lAnk.y > lKn.y &&
    rAnk.y > rKn.y &&
    Math.abs(lKn.x - lHip.x) < shoulderWidth * 0.95 &&
    Math.abs(rKn.x - rHip.x) < shoulderWidth * 0.95;
  if (!standing) return false;

  return true;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
