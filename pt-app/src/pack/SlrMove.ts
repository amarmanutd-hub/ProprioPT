/**
 * Straight leg raise — form-coached (bent knee / quad lag, incomplete height).
 * Working-limb lock via screen-space continuity (same as heel slides).
 */

import type { BiomechanicalSample } from "../biomechanics/BiomechanicalEvaluator";
import type { JointLandmark } from "../perception/PerceptionEngine";
import { assessTrack } from "../tracking/TrackConfidence";
import {
  pickWorkingKnee,
  type KneePos,
  type LockedKnee,
} from "../tracking/workingLimb";
import type { ExerciseMove, MoveDosing, MoveSetup, MoveUpdateResult } from "./types";

export interface SlrMoveOptions {
  targetReps?: number;
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
  private readonly onFlag?: (kind: string, detail: string) => void;
  private readonly onRep?: (repIndex: number) => void;

  private reps = 0;
  private phase: "down" | "up" = "down";
  private baselineHip = 160;
  private peakHipFlex = 180;
  private bentLogged = false;
  /** True if knee bent during this lift — cue only used to refuse the count. */
  private bentThisRep = false;
  private setComplete = false;
  private locked: LockedKnee | null = null;
  private lastKneePos: KneePos | null = null;

  constructor(options: SlrMoveOptions = {}) {
    this.targetReps = options.targetReps ?? 10;
    this.dosing = { sets: 2, reps: this.targetReps };
    this.onFlag = options.onFlag;
    this.onRep = options.onRep;
  }

  reset(): void {
    this.reps = 0;
    this.phase = "down";
    this.baselineHip = 160;
    this.peakHipFlex = 180;
    this.bentLogged = false;
    this.bentThisRep = false;
    this.setComplete = false;
    this.locked = null;
    this.lastKneePos = null;
  }

  update(
    landmarks: JointLandmark[],
    sample: BiomechanicalSample | null,
    _t: number,
  ): MoveUpdateResult {
    const track = assessTrack(landmarks, this.locked, undefined);

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
      undefined,
      this.locked,
      this.lastKneePos,
      sample.angles.leftHip,
      sample.angles.rightHip,
    );
    if (picked.lock) this.locked = picked.lock;
    if (picked.pos) this.lastKneePos = picked.pos;

    const hip = picked.hip;
    const knee = picked.knee;
    const flags: string[] = [];
    const label = (ok: string) =>
      track.level === "weak" ? track.reason : ok;

    if (this.phase === "down" && hip > 130) {
      this.baselineHip = this.baselineHip * 0.9 + hip * 0.1;
    }

    // Quad lag: knee bends while intending a straight-leg raise
    if (this.phase === "up" && knee < 150) {
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

    if (this.phase === "down") {
      if (hip <= this.baselineHip - 18) {
        this.phase = "up";
        this.peakHipFlex = hip;
        this.bentLogged = false;
        this.bentThisRep = false;
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

    if (hip < this.peakHipFlex) this.peakHipFlex = hip;
    const lowered = hip >= this.baselineHip - 10;
    if (lowered) {
      const lift = this.baselineHip - this.peakHipFlex;
      if (lift < 14) {
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
}
