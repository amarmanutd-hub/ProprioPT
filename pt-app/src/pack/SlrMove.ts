/**
 * Straight leg raise — form-coached (bent knee / incomplete height).
 *
 * Primary signal: 2D leg elevation (hip→ankle vs resting baseline), not noisy
 * 3D hip joint angles. Matches MediaPipe SLR / FMS practice: track how far the
 * working ankle rises, then returns. Knee bend is warn-only unless extreme.
 */

import type { BiomechanicalSample } from "../biomechanics/BiomechanicalEvaluator";
import { imageKneeInteriorDeg } from "../biomechanics/BiomechanicalEvaluator";
import type { JointLandmark } from "../perception/PerceptionEngine";
import { assessTrack } from "../tracking/TrackConfidence";
import {
  pickWorkingKnee,
  type KneePos,
  type LockedKnee,
  type WorkingSide,
} from "../tracking/workingLimb";
import type { ExerciseMove, MoveDosing, MoveSetup, MoveUpdateResult } from "./types";
import { toFlexionDeg } from "./HeelSlideMove";

/** Extreme bend only (interior °) — mild ~160° noise must not refuse. */
const BENT_REFUSE = 115;
const BENT_STREAK = 8;
/** Elevation degrees above baseline to enter / count. */
const ELEV_ENTER = 12;
const ELEV_MIN = 10;
const ELEV_RETURN = 5;
const MIN_UP_MS = 350;
const MIN_REP_GAP_MS = 800;

export interface SlrMoveOptions {
  targetReps?: number;
  side?: WorkingSide;
  onFlag?: (kind: string, detail: string) => void;
  onRep?: (repIndex: number) => void;
}

function lmAt(
  landmarks: JointLandmark[],
  index: number,
): JointLandmark | undefined {
  return landmarks.find((p) => p.index === index && (p.visibility ?? 0) >= 0.25);
}

/**
 * Elevation of hip→ankle above the resting floor direction (degrees).
 * 0 ≈ leg on floor along baseline; ↑ as ankle rises toward camera-top.
 */
function legElevationDeg(
  hip: { x: number; y: number },
  ankle: { x: number; y: number },
  baseAngleRad: number,
): number {
  const ang = Math.atan2(hip.y - ankle.y, ankle.x - hip.x);
  let d = ((ang - baseAngleRad) * 180) / Math.PI;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return Math.abs(d);
}

export class SlrMove implements ExerciseMove {
  readonly id = "slr";
  readonly title = "Straight leg raise";
  readonly mode = "form" as const;
  readonly dosing: MoveDosing;
  readonly setup: MoveSetup = {
    camera: "floor_diagonal",
    copy: "Lie on your back. Phone diagonal — working leg nearer camera. Keep the knee straight and lift, pause, then lower.",
  };
  readonly orientation = "relaxed_floor" as const;

  private readonly targetReps: number;
  private readonly side: WorkingSide | undefined;
  private readonly onFlag?: (kind: string, detail: string) => void;
  private readonly onRep?: (repIndex: number) => void;

  private reps = 0;
  private phase: "down" | "up" = "down";
  private baseAngleRad = 0;
  private baselineReady = false;
  private baselineSamples = 0;
  private peakElev = 0;
  private bentLogged = false;
  private bentThisRep = false;
  private bentStreak = 0;
  private setComplete = false;
  private locked: LockedKnee | null = null;
  private lastKneePos: KneePos | null = null;
  private upSinceMs = 0;
  private lastRepAt = 0;

  constructor(options: SlrMoveOptions = {}) {
    this.targetReps = options.targetReps ?? 10;
    this.dosing = { sets: 2, reps: this.targetReps };
    this.side = options.side;
    this.onFlag = options.onFlag;
    this.onRep = options.onRep;
    if (this.side === "left" || this.side === "right") this.locked = this.side;
  }

  reset(): void {
    this.reps = 0;
    this.phase = "down";
    this.baseAngleRad = 0;
    this.baselineReady = false;
    this.baselineSamples = 0;
    this.peakElev = 0;
    this.bentLogged = false;
    this.bentThisRep = false;
    this.bentStreak = 0;
    this.setComplete = false;
    this.locked =
      this.side === "left" || this.side === "right" ? this.side : null;
    this.lastKneePos = null;
    this.upSinceMs = 0;
    this.lastRepAt = 0;
  }

  update(
    landmarks: JointLandmark[],
    sample: BiomechanicalSample | null,
    t: number,
  ): MoveUpdateResult {
    const track = assessTrack(landmarks, this.locked, this.side);

    if (this.setComplete) {
      return {
        reps: this.reps,
        flags: [],
        phaseLabel: "Set complete",
        setComplete: true,
        track: "ok",
        displayKneeDeg: null,
      };
    }

    if (track.level === "lost" || !sample) {
      return {
        reps: this.reps,
        flags: [],
        phaseLabel: track.reason || "Tracking lost — show the working leg",
        setComplete: false,
        track: "lost",
        trackReason: track.reason,
        displayKneeDeg: null,
      };
    }

    const picked = pickWorkingKnee(
      landmarks,
      sample.angles.leftKnee,
      sample.angles.rightKnee,
      this.side,
      this.locked,
      this.lastKneePos,
      sample.angles.leftHip,
      sample.angles.rightHip,
    );
    if (this.side === "left" || this.side === "right") {
      this.locked = this.side;
    } else if (picked.lock) {
      this.locked = picked.lock;
    }
    if (picked.pos) this.lastKneePos = picked.pos;

    const side = this.locked ?? "right";
    const hipI = side === "left" ? 23 : 24;
    const anI = side === "left" ? 27 : 28;
    const hipLm = lmAt(landmarks, hipI);
    const anLm = lmAt(landmarks, anI);

    const imgKnee = imageKneeInteriorDeg(landmarks, side);
    const knee =
      imgKnee != null ? Math.min(imgKnee, picked.knee) : picked.knee;
    const flags: string[] = [];
    const label = (ok: string) =>
      track.level === "weak" ? track.reason : ok;
    const flexDisp = toFlexionDeg(knee);

    if (!hipLm || !anLm) {
      return {
        reps: this.reps,
        flags,
        phaseLabel: label("Show hip and ankle of the working leg"),
        setComplete: false,
        track: track.level === "ok" ? "weak" : track.level,
        trackReason: "Need hip and ankle in frame",
        displayKneeDeg: flexDisp,
      };
    }

    if (this.phase === "down" && !this.baselineReady) {
      const ang = Math.atan2(hipLm.y - anLm.y, anLm.x - hipLm.x);
      this.baseAngleRad =
        this.baselineSamples === 0
          ? ang
          : this.baseAngleRad + (ang - this.baseAngleRad) / (this.baselineSamples + 1);
      this.baselineSamples += 1;
      if (this.baselineSamples >= 10) this.baselineReady = true;
    }

    const elev = this.baselineReady
      ? legElevationDeg(hipLm, anLm, this.baseAngleRad)
      : 0;

    if (this.phase === "up") {
      if (knee < BENT_REFUSE) {
        this.bentStreak += 1;
        if (this.bentStreak >= BENT_STREAK) {
          flags.push("bentKnee");
          this.bentThisRep = true;
          if (!this.bentLogged) {
            this.bentLogged = true;
            this.onFlag?.(
              "bentKnee",
              "Knee bending — lock the quad and keep the leg straight.",
            );
          }
        }
      } else {
        this.bentStreak = 0;
      }
    }

    if (this.phase === "down") {
      if (this.baselineReady && elev >= ELEV_ENTER) {
        this.phase = "up";
        this.upSinceMs = t;
        this.peakElev = elev;
        this.bentLogged = false;
        this.bentThisRep = false;
        this.bentStreak = 0;
      }
      return {
        reps: this.reps,
        flags,
        phaseLabel: label(
          this.baselineReady
            ? "Lift the leg — knee straight"
            : "Hold still a moment — calibrating",
        ),
        setComplete: false,
        track: track.level,
        trackReason: track.reason,
        displayKneeDeg: flexDisp,
      };
    }

    if (elev > this.peakElev) this.peakElev = elev;

    const lowered = elev <= ELEV_RETURN;
    const heldLongEnough = t - this.upSinceMs >= MIN_UP_MS;
    const gapOk = t - this.lastRepAt >= MIN_REP_GAP_MS;

    if (lowered && heldLongEnough) {
      if (this.peakElev < ELEV_MIN) {
        flags.push("incompleteHeight");
        this.onFlag?.(
          "incompleteHeight",
          "Lift a bit higher — about a foot off the floor.",
        );
      } else if (this.bentThisRep) {
        // Extreme bend: still count but cue — missed reps were the bigger pain.
        flags.push("bentKnee");
        this.onFlag?.(
          "bentKnee",
          "Try to keep the knee straighter next time.",
        );
        if (gapOk) {
          this.reps += 1;
          this.lastRepAt = t;
          this.onRep?.(this.reps);
          if (this.reps >= this.targetReps) this.setComplete = true;
        }
      } else if (gapOk) {
        this.reps += 1;
        this.lastRepAt = t;
        this.onRep?.(this.reps);
        if (this.reps >= this.targetReps) this.setComplete = true;
      }
      this.phase = "down";
      this.peakElev = 0;
      this.bentLogged = false;
      this.bentThisRep = false;
      this.bentStreak = 0;
      this.upSinceMs = 0;
    }

    return {
      reps: this.reps,
      flags,
      phaseLabel: this.setComplete
        ? "Set complete"
        : label("Lower with control"),
      setComplete: this.setComplete,
      track: track.level,
      trackReason: track.reason,
      displayKneeDeg: this.setComplete ? null : flexDisp,
    };
  }
}
