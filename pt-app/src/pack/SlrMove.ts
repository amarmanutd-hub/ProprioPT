/**
 * Straight leg raise — form-coached (bent knee / quad lag, incomplete height).
 * Working-limb lock via screen-space continuity (same as heel slides).
 *
 * Display uses clinical flexion (0≈straight). Mild angle noise (~160 interior)
 * must not refuse counts — only a clearly bent knee does.
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

/** Refuse count only when clearly bent (interior). 160° noise is fine. */
const BENT_REFUSE = 120;
const BENT_STREAK = 6;
const HIP_ENTER = 12;
const HIP_MIN_LIFT = 9;
const MIN_UP_MS = 400;

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
  private bentLogged = false;
  private bentThisRep = false;
  private bentStreak = 0;
  private setComplete = false;
  private locked: LockedKnee | null = null;
  private lastKneePos: KneePos | null = null;
  private hipSign: 1 | -1 | null = null;
  private upSinceMs = 0;

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
    this.bentLogged = false;
    this.bentThisRep = false;
    this.bentStreak = 0;
    this.setComplete = false;
    this.locked =
      this.side === "left" || this.side === "right" ? this.side : null;
    this.lastKneePos = null;
    this.hipSign = null;
    this.upSinceMs = 0;
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
    if (picked.lock) this.locked = picked.lock;
    if (picked.pos) this.lastKneePos = picked.pos;

    const hip = picked.hip;
    const imgKnee =
      picked.lock != null
        ? imageKneeInteriorDeg(landmarks, picked.lock)
        : null;
    const knee = imgKnee != null ? Math.min(imgKnee, picked.knee) : picked.knee;
    const flags: string[] = [];
    const label = (ok: string) =>
      track.level === "weak" ? track.reason : ok;
    const flexDisp = toFlexionDeg(knee);

    if (this.phase === "down" && hip > 120) {
      this.baselineHip = this.baselineHip * 0.9 + hip * 0.1;
    }

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
      const hipDrop = this.baselineHip - hip;
      const hipRise = hip - this.baselineHip;
      const entering = hipDrop >= HIP_ENTER || hipRise >= HIP_ENTER;
      if (entering) {
        this.hipSign = hipDrop >= hipRise ? 1 : -1;
        this.phase = "up";
        this.upSinceMs = t;
        this.peakHipFlex = hip;
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
        displayKneeDeg: flexDisp,
      };
    }

    const sign = this.hipSign ?? 1;
    if (sign === 1) {
      if (hip < this.peakHipFlex) this.peakHipFlex = hip;
    } else if (hip > this.peakHipFlex) {
      this.peakHipFlex = hip;
    }

    const hipExc =
      sign === 1
        ? this.baselineHip - this.peakHipFlex
        : this.peakHipFlex - this.baselineHip;

    const lowered =
      sign === 1
        ? hip >= this.baselineHip - 10
        : hip <= this.baselineHip + 10;
    const heldLongEnough = t - this.upSinceMs >= MIN_UP_MS;

    if (lowered && heldLongEnough) {
      if (hipExc < HIP_MIN_LIFT) {
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
