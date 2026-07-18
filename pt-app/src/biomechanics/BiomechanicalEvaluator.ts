/**
 * BiomechanicalEvaluator — absolute 3D joint angles, smoothed ω, anchor drift.
 *
 * Patent-safe: standalone geometric rules on the active user's coordinates only.
 * No video alignment, HMM, or sequence scoring.
 */

import type { JointLandmark } from "../perception/PerceptionEngine";

// MediaPipe Pose
const L_SH = 11;
const R_SH = 12;
const L_EL = 13;
const R_EL = 14;
const L_WR = 15;
const R_WR = 16;
const L_HIP = 23;
const R_HIP = 24;
const L_KN = 25;
const R_KN = 26;
const L_ANK = 27;
const R_ANK = 28;

/** Internal joint angle keys (degrees). */
export type JointAngleId =
  | "leftElbow"
  | "rightElbow"
  | "leftShoulder"
  | "rightShoulder"
  | "leftHip"
  | "rightHip"
  | "leftKnee"
  | "rightKnee";

export type JointAngleMatrix = Record<JointAngleId, number>;

export type AngularVelocityMatrix = Record<JointAngleId, number>;

export interface AnchorDriftEvent {
  /** Peak stddev of anchor points as a fraction of torso length. */
  driftRatio: number;
  /** Threshold crossed (0.05 = ±5% torso). */
  threshold: number;
  timestampMs: number;
}

export interface BiomechanicalSample {
  timestampMs: number;
  /** Absolute internal joint angles (degrees). */
  angles: JointAngleMatrix;
  /** Smoothed angular velocity (deg/s) after 7-frame SG filter. */
  angularVelocity: AngularVelocityMatrix;
  /** Mid-shoulder → mid-hip Euclidean length (world, preferred). */
  torsoLength: number;
  /** Current anchor stddev / torsoLength. */
  anchorDriftRatio: number;
  /** True when drift exceeds ±5% torso length. */
  anchorCompensation: boolean;
}

export interface BiomechanicalEvaluatorOptions {
  /** Anchor stddev / torsoLength trip point (default 0.05). */
  anchorDriftThreshold?: number;
  /** Frames kept for Savitzky–Golay ω smoothing (must be 7). */
  sgWindow?: 7;
  onAnchorCompensation?: (e: AnchorDriftEvent) => void;
  onSample?: (s: BiomechanicalSample) => void;
}

const ANGLE_IDS: JointAngleId[] = [
  "leftElbow",
  "rightElbow",
  "leftShoulder",
  "rightShoulder",
  "leftHip",
  "rightHip",
  "leftKnee",
  "rightKnee",
];

/**
 * Savitzky–Golay quadratic, window=7, first-derivative coefficients
 * for uniformly spaced samples (scaled by 1/Δt later).
 * Norm factor for quadratic SG first deriv, N=7: divide by 28.
 * @see typically [-3,-2,-1,0,1,2,3]/10 for smoothing; deriv: [-3,-2,-1,0,1,2,3]/28
 */
const SG7_DERIV = [-3, -2, -1, 0, 1, 2, 3] as const;
const SG7_DERIV_NORM = 28;

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export class BiomechanicalEvaluator {
  private readonly anchorDriftThreshold: number;
  private readonly onAnchorCompensation?: (e: AnchorDriftEvent) => void;
  private readonly onSample?: (s: BiomechanicalSample) => void;

  /** Rolling raw angle history for SG (newest at end). */
  private angleHistory: JointAngleMatrix[] = [];
  private timeHistory: number[] = [];
  /** Raw ω before SG (parallel to angle history gaps). */
  private rawOmegaHistory: AngularVelocityMatrix[] = [];

  private lastAngles: JointAngleMatrix | null = null;
  private lastTs = 0;
  private anchorCompensationActive = false;

  /** Recent mid-shoulder / mid-hip positions for stddev. */
  private anchorShoulderHist: Vec3[] = [];
  private anchorHipHist: Vec3[] = [];
  private readonly anchorHistMax = 30;

  constructor(options: BiomechanicalEvaluatorOptions = {}) {
    this.anchorDriftThreshold = options.anchorDriftThreshold ?? 0.05;
    this.onAnchorCompensation = options.onAnchorCompensation;
    this.onSample = options.onSample;
  }

  reset(): void {
    this.angleHistory = [];
    this.timeHistory = [];
    this.rawOmegaHistory = [];
    this.lastAngles = null;
    this.lastTs = 0;
    this.anchorCompensationActive = false;
    this.anchorShoulderHist = [];
    this.anchorHipHist = [];
  }

  /**
   * Evaluate one absolute landmark frame (prefer calibration-normalized world coords).
   */
  evaluate(landmarks: JointLandmark[], timestampMs: number): BiomechanicalSample | null {
    const map = indexMap(landmarks);
    const angles = computeAngleMatrix(map);
    if (!angles) return null;

    const torsoLength = measureTorsoLength(map);
    if (torsoLength < 1e-6) return null;

    // Floor/diagonal views often lose one shoulder/hip — anchor off best points.
    const midHip =
      midWorld(map.get(L_HIP), map.get(R_HIP)) ??
      visibleWorld(map.get(L_HIP)) ??
      visibleWorld(map.get(R_HIP));
    if (!midHip) return null;
    const midSh =
      midWorld(map.get(L_SH), map.get(R_SH)) ??
      visibleWorld(map.get(L_SH)) ??
      visibleWorld(map.get(R_SH)) ??
      midHip;

    this.pushAnchor(midSh, midHip);
    const anchorDriftRatio = this.computeAnchorDriftRatio(torsoLength);
    const anchorCompensation = anchorDriftRatio > this.anchorDriftThreshold;

    if (anchorCompensation && !this.anchorCompensationActive) {
      this.anchorCompensationActive = true;
      this.onAnchorCompensation?.({
        driftRatio: anchorDriftRatio,
        threshold: this.anchorDriftThreshold,
        timestampMs,
      });
    } else if (!anchorCompensation) {
      this.anchorCompensationActive = false;
    }

    const rawOmega = this.computeRawOmega(angles, timestampMs);
    this.angleHistory.push(angles);
    this.timeHistory.push(timestampMs);
    this.rawOmegaHistory.push(rawOmega);
    if (this.angleHistory.length > 7) {
      this.angleHistory.shift();
      this.timeHistory.shift();
      this.rawOmegaHistory.shift();
    }

    const angularVelocity = this.smoothOmegaSg7();

    const sample: BiomechanicalSample = {
      timestampMs,
      angles,
      angularVelocity,
      torsoLength,
      anchorDriftRatio,
      anchorCompensation,
    };
    this.onSample?.(sample);
    return sample;
  }

  private computeRawOmega(
    angles: JointAngleMatrix,
    timestampMs: number,
  ): AngularVelocityMatrix {
    const out = emptyOmega();
    if (!this.lastAngles || this.lastTs <= 0) {
      this.lastAngles = { ...angles };
      this.lastTs = timestampMs;
      return out;
    }
    const dt = (timestampMs - this.lastTs) / 1000;
    if (dt >= 1e-4) {
      for (const id of ANGLE_IDS) {
        let d = angles[id] - this.lastAngles[id];
        if (d > 180) d -= 360;
        if (d < -180) d += 360;
        out[id] = d / dt;
      }
    }
    this.lastAngles = { ...angles };
    this.lastTs = timestampMs;
    return out;
  }

  private smoothOmegaSg7(): AngularVelocityMatrix {
    const out = emptyOmega();
    const n = this.rawOmegaHistory.length;
    if (n < 7) {
      // Not enough samples — return latest raw or zeros
      return n ? { ...this.rawOmegaHistory[n - 1]! } : out;
    }

    // Use mean Δt over the window for SG scaling
    const t0 = this.timeHistory[0]!;
    const t1 = this.timeHistory[6]!;
    const dt = (t1 - t0) / 6000; // seconds per step across 6 intervals
    if (dt < 1e-4) return { ...this.rawOmegaHistory[6]! };

    // Prefer SG on angle series (true polynomial derivative) over filtering ω
    for (const id of ANGLE_IDS) {
      let acc = 0;
      for (let i = 0; i < 7; i++) {
        acc += SG7_DERIV[i]! * this.angleHistory[i]![id];
      }
      // dθ/di * di/dt ; SG first-deriv coeffs assume unit spacing
      out[id] = acc / (SG7_DERIV_NORM * dt);
    }
    return out;
  }

  private pushAnchor(shoulder: Vec3, hip: Vec3): void {
    this.anchorShoulderHist.push(shoulder);
    this.anchorHipHist.push(hip);
    if (this.anchorShoulderHist.length > this.anchorHistMax) {
      this.anchorShoulderHist.shift();
      this.anchorHipHist.shift();
    }
  }

  private computeAnchorDriftRatio(torsoLength: number): number {
    if (this.anchorShoulderHist.length < 5) return 0;
    const sStd = axisStdMax(this.anchorShoulderHist);
    const hStd = axisStdMax(this.anchorHipHist);
    const peak = Math.max(sStd, hStd);
    return peak / torsoLength;
  }
}

// ── Angle math ───────────────────────────────────────────────────────────────

function emptyAngles(): JointAngleMatrix {
  return {
    leftElbow: 0,
    rightElbow: 0,
    leftShoulder: 0,
    rightShoulder: 0,
    leftHip: 0,
    rightHip: 0,
    leftKnee: 0,
    rightKnee: 0,
  };
}

function emptyOmega(): AngularVelocityMatrix {
  return emptyAngles();
}

function indexMap(landmarks: JointLandmark[]): Map<number, JointLandmark> {
  const m = new Map<number, JointLandmark>();
  for (const lm of landmarks) m.set(lm.index, lm);
  return m;
}

function asWorld(lm: JointLandmark): Vec3 {
  // Prefer world; fall back to image+z if world is degenerate later in measure
  return { x: lm.worldX, y: lm.worldY, z: lm.worldZ };
}

function midWorld(
  a: JointLandmark | undefined,
  b: JointLandmark | undefined,
): Vec3 | null {
  if (!a || !b) return null;
  return {
    x: (a.worldX + b.worldX) / 2,
    y: (a.worldY + b.worldY) / 2,
    z: (a.worldZ + b.worldZ) / 2,
  };
}

function visibleWorld(lm: JointLandmark | undefined): Vec3 | null {
  if (!lm || lm.visibility < 0.25) return null;
  return asWorld(lm);
}

function visibleEnough(lm: JointLandmark | undefined, minVis = 0.25): boolean {
  return !!lm && lm.visibility >= minVis;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function len(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

/** Internal joint angle (degrees) via 3D cosine formula at vertex B. */
export function jointAngleDeg(a: Vec3, b: Vec3, c: Vec3): number {
  const ba = sub(a, b);
  const bc = sub(c, b);
  const la = len(ba);
  const lc = len(bc);
  if (la < 1e-9 || lc < 1e-9) return 0;
  let cos = (ba.x * bc.x + ba.y * bc.y + ba.z * bc.z) / (la * lc);
  cos = Math.min(1, Math.max(-1, cos));
  return (Math.acos(cos) * 180) / Math.PI;
}

function chainOk(
  map: Map<number, JointLandmark>,
  hip: number,
  kn: number,
  ank: number,
): boolean {
  return (
    visibleEnough(map.get(hip)) &&
    visibleEnough(map.get(kn)) &&
    visibleEnough(map.get(ank))
  );
}

function computeAngleMatrix(
  map: Map<number, JointLandmark>,
): JointAngleMatrix | null {
  // Floor/diagonal: far leg often occluded. Need ≥1 hip–knee–ankle chain;
  // arms optional. Mirror the good chain onto the missing side so moves that
  // average or pickWorkingKnee still see a stable signal.
  const leftOk = chainOk(map, L_HIP, L_KN, L_ANK);
  const rightOk = chainOk(map, R_HIP, R_KN, R_ANK);
  if (!leftOk && !rightOk) return null;

  const anchorHip = map.get(leftOk ? L_HIP : R_HIP)!;
  const probe =
    (visibleEnough(map.get(L_SH)) ? len(asWorld(map.get(L_SH)!)) : 0) +
    (visibleEnough(map.get(R_SH)) ? len(asWorld(map.get(R_SH)!)) : 0) +
    len(asWorld(anchorHip));
  const useImage = probe < 1e-6;
  const pt = (lm: JointLandmark): Vec3 =>
    useImage ? { x: lm.x, y: lm.y, z: lm.z } : asWorld(lm);

  const LShLm = map.get(L_SH);
  const RShLm = map.get(R_SH);
  const LElLm = map.get(L_EL);
  const RElLm = map.get(R_EL);
  const LWrLm = map.get(L_WR);
  const RWrLm = map.get(R_WR);

  const LSh = visibleEnough(LShLm) ? pt(LShLm!) : null;
  const RSh = visibleEnough(RShLm) ? pt(RShLm!) : null;
  const LEl = visibleEnough(LElLm) ? pt(LElLm!) : null;
  const REl = visibleEnough(RElLm) ? pt(RElLm!) : null;
  const LWr = visibleEnough(LWrLm) ? pt(LWrLm!) : null;
  const RWr = visibleEnough(RWrLm) ? pt(RWrLm!) : null;

  let leftKnee = 170;
  let rightKnee = 170;
  let leftHip = 170;
  let rightHip = 170;

  if (leftOk) {
    const LHip = pt(map.get(L_HIP)!);
    const LKn = pt(map.get(L_KN)!);
    const LAnk = pt(map.get(L_ANK)!);
    leftKnee = jointAngleDeg(LHip, LKn, LAnk);
    leftHip = LSh ? jointAngleDeg(LSh, LHip, LKn) : 170;
  }
  if (rightOk) {
    const RHip = pt(map.get(R_HIP)!);
    const RKn = pt(map.get(R_KN)!);
    const RAnk = pt(map.get(R_ANK)!);
    rightKnee = jointAngleDeg(RHip, RKn, RAnk);
    rightHip = RSh ? jointAngleDeg(RSh, RHip, RKn) : 170;
  }
  if (leftOk && !rightOk) {
    rightKnee = leftKnee;
    rightHip = leftHip;
  } else if (rightOk && !leftOk) {
    leftKnee = rightKnee;
    leftHip = rightHip;
  }

  return {
    leftElbow: LSh && LEl && LWr ? jointAngleDeg(LSh, LEl, LWr) : 160,
    rightElbow: RSh && REl && RWr ? jointAngleDeg(RSh, REl, RWr) : 160,
    leftShoulder:
      leftOk && LSh && LEl
        ? jointAngleDeg(pt(map.get(L_HIP)!), LSh, LEl)
        : 40,
    rightShoulder:
      rightOk && RSh && REl
        ? jointAngleDeg(pt(map.get(R_HIP)!), RSh, REl)
        : 40,
    leftHip,
    rightHip,
    leftKnee,
    rightKnee,
  };
}

function measureTorsoLength(map: Map<number, JointLandmark>): number {
  const midSh =
    midWorld(map.get(L_SH), map.get(R_SH)) ??
    visibleWorld(map.get(L_SH)) ??
    visibleWorld(map.get(R_SH));
  const midHip =
    midWorld(map.get(L_HIP), map.get(R_HIP)) ??
    visibleWorld(map.get(L_HIP)) ??
    visibleWorld(map.get(R_HIP));
  if (!midSh || !midHip) return 0;
  let d = len(sub(midSh, midHip));
  if (d > 1e-6) return d;
  // Image fallback — need at least one shoulder + one hip
  const shLm = map.get(L_SH) ?? map.get(R_SH);
  const hipLm = map.get(L_HIP) ?? map.get(R_HIP);
  if (!shLm || !hipLm) return 0;
  return len(
    sub(
      { x: shLm.x, y: shLm.y, z: shLm.z },
      { x: hipLm.x, y: hipLm.y, z: hipLm.z },
    ),
  );
}

function axisStdMax(points: Vec3[]): number {
  const n = points.length;
  if (n < 2) return 0;
  let mx = 0;
  let my = 0;
  let mz = 0;
  for (const p of points) {
    mx += p.x;
    my += p.y;
    mz += p.z;
  }
  mx /= n;
  my /= n;
  mz /= n;
  let vx = 0;
  let vy = 0;
  let vz = 0;
  for (const p of points) {
    vx += (p.x - mx) ** 2;
    vy += (p.y - my) ** 2;
    vz += (p.z - mz) ** 2;
  }
  vx /= n;
  vy /= n;
  vz /= n;
  return Math.sqrt(Math.max(vx, vy, vz));
}
