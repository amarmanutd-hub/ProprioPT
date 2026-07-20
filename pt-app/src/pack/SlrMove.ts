/**
 * Straight leg raise — form-coached (bent knee / quad lag, incomplete height).
 * Working-limb lock via screen-space continuity (same as heel slides).
 *
 * Rep = leave floor (hip flex or ankle rise) → return. Brief knee jitter is
 * ignored; sustained bend refuses the count.
 */

import type { BiomechanicalSample } from "../biomechanics/BiomechanicalEvaluator";
import type { JointLandmark } from "../perception/PerceptionEngine";
import { assessTrack } from "../tracking/TrackConfidence";
import {
  pickWorkingKnee,
  type KneePos,
  type LockedKnee,
  type WorkingSide,
} from "../tracking/workingLimb";
import type { ExerciseMove, MoveDosing, MoveSetup, MoveUpdateResult } from "./types";

/** Sustained bend below this internal angle dirties the rep. */
const BENT_KNEE = 135;
const BENT_STREAK = 4;
/** Hip must drop this far from baseline to enter the lift. */
const HIP_ENTER = 12;
/** Peak hip excursion required to count. */
const HIP_MIN_LIFT = 8;
/** Ankle image-Y drop (normalized) that also counts as lift enter / height. */
const ANKLE_ENTER = 0.035;
const ANKLE_MIN_LIFT = 0.028;

export interface SlrMoveOptions {
  targetReps?: number;
  side?: WorkingSide;
  onFlag?: (kind: string, detail: string) => void;
  onRep?: (repIndex: number) => void;
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
  private baselineHip = 160;
  private peakHipFlex = 180;
  private baselineAnkleY = 0.7;
  private peakAnkleY = 1;
  private ankleReady = false;
  private bentLogged = false;
  private bentThisRep = false;
  private bentStreak = 0;
  private setComplete = false;
  private locked: LockedKnee | null = null;
  private lastKneePos: KneePos | null = null;
  /** +1 hip decreases on lift; -1 hip increases on lift (learned). */
  private hipSign: 1 | -1 | null = null;

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
    this.baselineHip = 160;
    this.peakHipFlex = 180;
    this.baselineAnkleY = 0.7;
    this.peakAnkleY = 1;
    this.ankleReady = false;
    this.bentLogged = false;
    this.bentThisRep = false;
    this.bentStreak = 0;
    this.setComplete = false;
    this.locked =
      this.side === "left" || this.side === "right" ? this.side : null;
    this.lastKneePos = null;
    this.hipSign = null;
  }

  update(
    landmarks: JointLandmark[],
    sample: BiomechanicalSample | null,
    _t: number,
  ): MoveUpdateResult {
    const track = assessTrack(landmarks, this.locked, this.side);

    if (this.setComplete) {
      return {
        reps: this.reps,
        flags: [],
        phaseLabel: "Set complete",
        setComplete: true,
        track: "ok",
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
    if (picked.lock) this.locked = picked.lock;
    if (picked.pos) this.lastKneePos = picked.pos;

    const hip = picked.hip;
    const knee = picked.knee;
    const ankleY = this.ankleY(landmarks, picked.lock);
    const flags: string[] = [];
    const label = (ok: string) =>
      track.level === "weak" ? track.reason : ok;

    if (this.phase === "down") {
      if (hip > 120) {
        this.baselineHip = this.baselineHip * 0.9 + hip * 0.1;
      }
      if (ankleY != null) {
        if (!this.ankleReady) {
          this.baselineAnkleY = ankleY;
          this.ankleReady = true;
        } else {
          this.baselineAnkleY = this.baselineAnkleY * 0.92 + ankleY * 0.08;
        }
      }
    }

    // Sustained bend only — brief MP jitter on a straight leg shouldn't kill reps.
    if (this.phase === "up") {
      if (knee < BENT_KNEE) {
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
      const hipDrop = this.baselineHip - hip;
      const ankleRise =
        ankleY != null ? this.baselineAnkleY - ankleY : 0;
      const entering =
        hipDrop >= HIP_ENTER || ankleRise >= ANKLE_ENTER;
      if (entering) {
        if (this.hipSign == null) {
          this.hipSign = hipDrop >= HIP_ENTER / 2 ? 1 : hip > this.baselineHip ? -1 : 1;
        }
        this.phase = "up";
        this.peakHipFlex = hip;
        this.peakAnkleY = ankleY ?? this.baselineAnkleY;
        this.bentLogged = false;
        this.bentThisRep = false;
        this.bentStreak = 0;
      }
      return {
        reps: this.reps,
        flags,
        phaseLabel: label("Lift the leg — knee straight"),
        setComplete: false,
        track: track.level,
        trackReason: track.reason,
      };
    }

    // Track peak excursion (hip decrease or increase per learned sign).
    const sign = this.hipSign ?? 1;
    if (sign === 1) {
      if (hip < this.peakHipFlex) this.peakHipFlex = hip;
    } else if (hip > this.peakHipFlex) {
      this.peakHipFlex = hip;
    }
    if (ankleY != null && ankleY < this.peakAnkleY) this.peakAnkleY = ankleY;

    const hipExc =
      sign === 1
        ? this.baselineHip - this.peakHipFlex
        : this.peakHipFlex - this.baselineHip;
    const ankleExc = this.baselineAnkleY - this.peakAnkleY;

    const loweredHip =
      sign === 1
        ? hip >= this.baselineHip - 10
        : hip <= this.baselineHip + 10;
    // Hip return completes the cycle; ankle is for enter/height only.
    const lowered = loweredHip;

    if (lowered) {
      const tallEnough =
        hipExc >= HIP_MIN_LIFT || ankleExc >= ANKLE_MIN_LIFT;
      if (!tallEnough) {
        flags.push("incompleteHeight");
        this.onFlag?.(
          "incompleteHeight",
          "Lift a bit higher — about a foot off the floor.",
        );
      } else if (this.bentThisRep) {
        flags.push("bentKnee");
        this.onFlag?.(
          "bentKnee",
          "That rep didn’t count — keep the knee straight next time.",
        );
      } else {
        this.reps += 1;
        this.onRep?.(this.reps);
        if (this.reps >= this.targetReps) this.setComplete = true;
      }
      this.phase = "down";
      this.peakHipFlex = 180;
      this.peakAnkleY = 1;
      this.bentLogged = false;
      this.bentThisRep = false;
      this.bentStreak = 0;
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
    };
  }

  private ankleY(
    landmarks: JointLandmark[],
    lock: LockedKnee | null,
  ): number | null {
    const idx = lock === "left" ? 27 : lock === "right" ? 28 : null;
    if (idx == null) {
      const l = landmarks.find((p) => p.index === 27);
      const r = landmarks.find((p) => p.index === 28);
      if (l && r) return Math.min(l.y, r.y);
      return l?.y ?? r?.y ?? null;
    }
    return landmarks.find((p) => p.index === idx)?.y ?? null;
  }
}
