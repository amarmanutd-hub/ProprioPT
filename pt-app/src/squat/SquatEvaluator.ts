/**
 * SquatEvaluator — 4-state deterministic FSM on absolute knee geometry.
 *
 * Patent-safe: no video alignment, HMM, or sequence matching.
 * States follow the product FSM (descent / depth / ascent / stand).
 */

import type { JointLandmark } from "../perception/PerceptionEngine";
import type { BiomechanicalSample } from "../biomechanics/BiomechanicalEvaluator";

export type SquatState = 0 | 1 | 2 | 3;

export type CompensationKind =
  | "valgus"
  | "trunk"
  | "incompleteDepth"
  | "overFlexion";

export interface CompensationEvent {
  kind: CompensationKind;
  timestampMs: number;
  detail: string;
}

export interface RepMetrics {
  repIndex: number;
  minKneeDeg: number;
  peakFlexionDeg: number; // 180 - minKnee for ROM feel
  descentMs: number;
  ascentMs: number;
  hadValgus: boolean;
  hadTrunkLean: boolean;
  completedAtMs: number;
}

export interface SquatFrameResult {
  state: SquatState;
  stateLabel: string;
  reps: number;
  kneeDeg: number;
  kneeOmega: number;
  activeFlags: CompensationKind[];
  lastEvent: CompensationEvent | null;
  lastRep: RepMetrics | null;
}

export interface SquatEvaluatorOptions {
  standDeg?: number; // State 0 enter / rep complete
  depthDeg?: number; // State 2 target
  ascentUnlockDeg?: number; // State 3 enter after depth
  /** Clinical max flexion: knee angle must not go below this (180=straight). */
  minKneeAngleDeg?: number;
  valgusKneeAnkleRatio?: number; // flag if kneeWidth < ratio * ankleWidth
  trunkLeanDeg?: number; // flag if torso tilt > this before depth
  onCompensation?: (e: CompensationEvent) => void;
  onRep?: (r: RepMetrics) => void;
  onStateChange?: (from: SquatState, to: SquatState) => void;
}

const STATE_LABEL: Record<SquatState, string> = {
  0: "Standing",
  1: "Descent",
  2: "Depth",
  3: "Ascent",
};

const L_SH = 11;
const R_SH = 12;
const L_HIP = 23;
const R_HIP = 24;
const L_KN = 25;
const R_KN = 26;
const L_ANK = 27;
const R_ANK = 28;

export class SquatEvaluator {
  private readonly standDeg: number;
  private readonly depthDeg: number;
  private readonly ascentUnlockDeg: number;
  private readonly minKneeAngleDeg: number | null;
  private readonly valgusRatio: number;
  private readonly trunkLeanDeg: number;
  private readonly onCompensation?: (e: CompensationEvent) => void;
  private readonly onRep?: (r: RepMetrics) => void;
  private readonly onStateChange?: (from: SquatState, to: SquatState) => void;

  private state: SquatState = 0;
  private reps = 0;
  private minKnee = 180;
  private descentStartMs = 0;
  private depthReachedMs = 0;
  private ascentStartMs = 0;
  private repHadValgus = false;
  private repHadTrunk = false;
  private incompleteLogged = false;
  private overFlexionLogged = false;
  private lastEvent: CompensationEvent | null = null;
  private lastRep: RepMetrics | null = null;
  private activeFlags = new Set<CompensationKind>();
  /** Latch trunk flag once per rep until stand reset. */
  private trunkLatched = false;
  private valgusLatched = false;
  private valgusStreak = 0;
  private trunkStreak = 0;
  private descentStreak = 0;
  private readonly confirmFrames = 6; // trunk — keep slower
  private readonly valgusConfirmFrames = 4; // catch cave sooner
  private readonly descentConfirmFrames = 4;
  /** Knee angle when descent began — used for relative stand/depth gates. */
  private standBaseline = 155;

  constructor(options: SquatEvaluatorOptions = {}) {
    // Reachable on phone cams: standing ~150–160°, depth ~30° below that.
    this.standDeg = options.standDeg ?? 150;
    this.depthDeg = options.depthDeg ?? 128;
    this.ascentUnlockDeg = options.ascentUnlockDeg ?? 135;
    this.minKneeAngleDeg =
      options.minKneeAngleDeg != null && Number.isFinite(options.minKneeAngleDeg)
        ? options.minKneeAngleDeg
        : null;
    this.valgusRatio = options.valgusKneeAnkleRatio ?? 0.88;
    this.trunkLeanDeg = options.trunkLeanDeg ?? 45;
    this.onCompensation = options.onCompensation;
    this.onRep = options.onRep;
    this.onStateChange = options.onStateChange;
  }

  reset(): void {
    this.state = 0;
    this.reps = 0;
    this.minKnee = 180;
    this.descentStartMs = 0;
    this.depthReachedMs = 0;
    this.ascentStartMs = 0;
    this.repHadValgus = false;
    this.repHadTrunk = false;
    this.incompleteLogged = false;
    this.lastEvent = null;
    this.lastRep = null;
    this.activeFlags.clear();
    this.trunkLatched = false;
    this.valgusLatched = false;
    this.valgusStreak = 0;
    this.trunkStreak = 0;
    this.descentStreak = 0;
    this.standBaseline = 155;
  }

  getReps(): number {
    return this.reps;
  }

  getState(): SquatState {
    return this.state;
  }

  /**
   * Advance FSM from one biomechanical sample + landmarks (for valgus/trunk).
   */
  update(
    sample: BiomechanicalSample,
    landmarks: JointLandmark[],
  ): SquatFrameResult {
    // Min = most flexed (depth); max = most extended (stand). Averaging hid depth.
    const flexed =
      Math.min(sample.angles.leftKnee, sample.angles.rightKnee);
    const extended =
      Math.max(sample.angles.leftKnee, sample.angles.rightKnee);
    const kneeDeg = flexed;
    const kneeOmega =
      (sample.angularVelocity.leftKnee + sample.angularVelocity.rightKnee) /
      2;

    this.activeFlags.delete("valgus");
    this.activeFlags.delete("trunk");

    if (this.state === 1 || this.state === 2 || this.state === 3) {
      if (this.isValgus(landmarks)) {
        this.valgusStreak += 1;
      } else {
        this.valgusStreak = 0;
      }
      if (this.valgusStreak >= this.valgusConfirmFrames) {
        this.activeFlags.add("valgus");
        if (!this.valgusLatched) {
          this.valgusLatched = true;
          this.repHadValgus = true;
          this.emit({
            kind: "valgus",
            timestampMs: sample.timestampMs,
            detail: "Knees caving in — push them outward.",
          });
        }
      }
    } else {
      this.valgusStreak = 0;
    }

    if (this.state === 1 && !this.trunkLatched) {
      const lean = this.trunkLeanFromVertical(landmarks);
      if (lean != null && lean > this.trunkLeanDeg) {
        this.trunkStreak += 1;
      } else {
        this.trunkStreak = 0;
      }
      if (this.trunkStreak >= this.confirmFrames) {
        this.trunkLatched = true;
        this.repHadTrunk = true;
        this.activeFlags.add("trunk");
        this.emit({
          kind: "trunk",
          timestampMs: sample.timestampMs,
          detail: `Chest tipping forward (${lean!.toFixed(0)}°) — stand taller.`,
        });
      }
    } else {
      this.trunkStreak = 0;
    }

    if (this.state === 1 || this.state === 2 || this.state === 3) {
      if (flexed < this.minKnee) this.minKnee = flexed;
    }

    // Relative depth: ~30° of flexion from this rep's standing baseline
    // Clinical max flexion: don't require (or allow) going past minKneeAngle.
    let depthTarget = Math.min(this.depthDeg, this.standBaseline - 30);
    if (this.minKneeAngleDeg != null) {
      depthTarget = Math.max(depthTarget, this.minKneeAngleDeg);
    }
    const standTarget = Math.min(this.standDeg, this.standBaseline - 8);

    if (
      this.minKneeAngleDeg != null &&
      (this.state === 1 || this.state === 2) &&
      flexed < this.minKneeAngleDeg - 2
    ) {
      if (!this.overFlexionLogged) {
        this.overFlexionLogged = true;
        this.emit({
          kind: "overFlexion",
          timestampMs: sample.timestampMs,
          detail: `Past your PT limit (${this.minKneeAngleDeg}°) — ease up.`,
        });
      }
    } else if (this.minKneeAngleDeg != null && flexed >= this.minKneeAngleDeg) {
      this.overFlexionLogged = false;
      this.activeFlags.delete("overFlexion");
    }

    const prev = this.state;

    switch (this.state) {
      case 0: {
        // Quiet standing → refresh baseline (don’t chase every frame)
        if (Math.abs(kneeOmega) < 20 && extended > 140) {
          this.standBaseline = this.standBaseline * 0.92 + extended * 0.08;
        }

        // Real squat start only: clearly bent + moving down for a few frames.
        // (A lone “past stand gate” fired on normal standing noise → false “go deeper”.)
        const flexedEnough = flexed <= this.standBaseline - 14;
        const movingDown = kneeOmega < -14;
        if (flexedEnough && movingDown) {
          this.descentStreak += 1;
        } else {
          this.descentStreak = 0;
        }

        if (this.descentStreak >= this.descentConfirmFrames) {
          this.enter(1, sample.timestampMs);
          this.minKnee = flexed;
          this.standBaseline = Math.max(this.standBaseline, extended);
          this.descentStartMs = sample.timestampMs;
          this.depthReachedMs = 0;
          this.ascentStartMs = 0;
          this.repHadValgus = false;
          this.repHadTrunk = false;
          this.incompleteLogged = false;
          this.overFlexionLogged = false;
          this.trunkLatched = false;
          this.valgusLatched = false;
          this.valgusStreak = 0;
          this.trunkStreak = 0;
          this.descentStreak = 0;
          this.activeFlags.delete("incompleteDepth");
        }
        break;
      }
      case 1: {
        if (flexed <= depthTarget) {
          this.incompleteLogged = false;
          this.activeFlags.delete("incompleteDepth");
          this.enter(2, sample.timestampMs);
          this.depthReachedMs = sample.timestampMs;
          break;
        }

        const nearStand = extended >= this.standBaseline - 12;
        const settling = kneeOmega > -12;
        if (nearStand && settling) {
          const ms = sample.timestampMs - this.descentStartMs;
          const bent = this.standBaseline - this.minKnee;
          // Cue shallow attempts that looked intentional.
          if (!this.incompleteLogged && ms > 280 && bent > 12) {
            this.incompleteLogged = true;
            this.emit({
              kind: "incompleteDepth",
              timestampMs: sample.timestampMs,
              detail: `Came up early at ${flexed.toFixed(0)}° — go lower next time.`,
            });
          }
          this.enter(0, sample.timestampMs);
          this.minKnee = 180;
          this.activeFlags.clear();
          this.descentStreak = 0;
        }
        break;
      }
      case 2: {
        // Rising out of the hole
        const rising =
          flexed > this.minKnee + 8 || extended >= this.ascentUnlockDeg;
        if (rising && (kneeOmega > 5 || extended >= this.ascentUnlockDeg)) {
          this.enter(3, sample.timestampMs);
          this.ascentStartMs = sample.timestampMs;
        }
        break;
      }
      case 3: {
        // Back near the posture we started from (depth already credited)
        const stoodUp =
          extended >= standTarget ||
          extended >= this.standBaseline - 10;
        if (stoodUp && kneeOmega > -8) {
          if (this.depthReachedMs > 0 && !this.repHadValgus) {
            const rep: RepMetrics = {
              repIndex: this.reps + 1,
              minKneeDeg: this.minKnee,
              peakFlexionDeg: 180 - this.minKnee,
              descentMs: Math.max(
                0,
                (this.depthReachedMs || this.ascentStartMs) -
                  this.descentStartMs,
              ),
              ascentMs: Math.max(0, sample.timestampMs - this.ascentStartMs),
              hadValgus: this.repHadValgus,
              hadTrunkLean: this.repHadTrunk,
              completedAtMs: sample.timestampMs,
            };
            this.reps += 1;
            this.lastRep = rep;
            this.onRep?.(rep);
          }
          this.enter(0, sample.timestampMs);
          this.minKnee = 180;
          this.activeFlags.clear();
          this.descentStreak = 0;
        }
        break;
      }
    }

    if (prev !== this.state) {
      this.onStateChange?.(prev, this.state);
    }

    return {
      state: this.state,
      stateLabel: STATE_LABEL[this.state],
      reps: this.reps,
      kneeDeg: flexed,
      kneeOmega,
      activeFlags: [...this.activeFlags],
      lastEvent: this.lastEvent,
      lastRep: this.lastRep,
    };
  }

  private enter(to: SquatState, _ts: number): void {
    this.state = to;
  }

  private emit(e: CompensationEvent): void {
    this.lastEvent = e;
    this.activeFlags.add(e.kind);
    this.onCompensation?.(e);
  }

  /** Horizontal knee width < ratio × ankle width → valgus. */
  private isValgus(landmarks: JointLandmark[]): boolean {
    const map = idxMap(landmarks);
    const lk = map.get(L_KN);
    const rk = map.get(R_KN);
    const la = map.get(L_ANK);
    const ra = map.get(R_ANK);
    if (!lk || !rk || !la || !ra) return false;
    if (
      lk.visibility < 0.35 ||
      rk.visibility < 0.35 ||
      la.visibility < 0.35 ||
      ra.visibility < 0.35
    ) {
      return false;
    }
    const kneeW = Math.abs(lk.x - rk.x);
    const ankleW = Math.abs(la.x - ra.x);
    if (ankleW < 1e-4) return false;
    return kneeW < this.valgusRatio * ankleW;
  }

  /**
   * Forward trunk tilt vs true vertical (degrees).
   * Uses mid-shoulder − mid-hip in image+z / world; vertical = -Y image (down is +y).
   */
  private trunkLeanFromVertical(landmarks: JointLandmark[]): number | null {
    const map = idxMap(landmarks);
    const lSh = map.get(L_SH);
    const rSh = map.get(R_SH);
    const lHip = map.get(L_HIP);
    const rHip = map.get(R_HIP);
    if (!lSh || !rSh || !lHip || !rHip) return null;

    // Prefer world; fall back to image
    const useWorld =
      Math.hypot(lSh.worldX, lSh.worldY, lSh.worldZ) +
        Math.hypot(lHip.worldX, lHip.worldY, lHip.worldZ) >
      1e-5;

    let sx: number;
    let sy: number;
    let sz: number;
    let hx: number;
    let hy: number;
    let hz: number;
    if (useWorld) {
      sx = (lSh.worldX + rSh.worldX) / 2;
      sy = (lSh.worldY + rSh.worldY) / 2;
      sz = (lSh.worldZ + rSh.worldZ) / 2;
      hx = (lHip.worldX + rHip.worldX) / 2;
      hy = (lHip.worldY + rHip.worldY) / 2;
      hz = (lHip.worldZ + rHip.worldZ) / 2;
    } else {
      sx = (lSh.x + rSh.x) / 2;
      sy = (lSh.y + rSh.y) / 2;
      sz = (lSh.z + rSh.z) / 2;
      hx = (lHip.x + rHip.x) / 2;
      hy = (lHip.y + rHip.y) / 2;
      hz = (lHip.z + rHip.z) / 2;
    }

    // Torso vector hip → shoulder
    const tx = sx - hx;
    const ty = sy - hy;
    const tz = sz - hz;
    const tLen = Math.hypot(tx, ty, tz);
    if (tLen < 1e-6) return null;

    // Vertical reference: world Y-up is often -Y in MediaPipe world (gravity +Y down
    // in image). Use image convention: vertical = (0, -1, 0) toward head in image
    // when person upright (shoulder above hip → ty < 0).
    // Angle from vertical: acos( dot(torso, up) / |torso| )
    const upX = 0;
    const upY = useWorld ? -1 : -1; // headward
    const upZ = 0;
    let cos = (tx * upX + ty * upY + tz * upZ) / tLen;
    cos = Math.min(1, Math.max(-1, cos));
    return (Math.acos(cos) * 180) / Math.PI;
  }
}

function idxMap(landmarks: JointLandmark[]): Map<number, JointLandmark> {
  const m = new Map<number, JointLandmark>();
  for (const lm of landmarks) m.set(lm.index, lm);
  return m;
}
