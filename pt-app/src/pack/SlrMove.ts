/**
 * Straight leg raise — form-coached (bent knee / quad lag, incomplete height).
 */

import type { BiomechanicalSample } from "../biomechanics/BiomechanicalEvaluator";
import type { JointLandmark } from "../perception/PerceptionEngine";
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
    camera: "supine_side",
    copy: "Lie on your back, phone on its side. Keep the knee straight and lift the leg, pause, then lower.",
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
  private setComplete = false;

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
    this.setComplete = false;
  }

  update(
    _landmarks: JointLandmark[],
    sample: BiomechanicalSample | null,
    _t: number,
  ): MoveUpdateResult {
    if (this.setComplete || !sample) {
      return {
        reps: this.reps,
        flags: [],
        phaseLabel: this.setComplete ? "Set complete" : "Waiting for pose",
        setComplete: this.setComplete,
      };
    }

    // Working leg ≈ more flexed hip (smaller internal angle when lifting)
    const hip = Math.min(sample.angles.leftHip, sample.angles.rightHip);
    const knee = Math.min(sample.angles.leftKnee, sample.angles.rightKnee);
    const flags: string[] = [];

    if (this.phase === "down" && hip > 130) {
      this.baselineHip = this.baselineHip * 0.9 + hip * 0.1;
    }

    // Quad lag: knee bends while intending a straight-leg raise
    if (this.phase === "up" && knee < 150) {
      flags.push("bentKnee");
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
      }
      return {
        reps: this.reps,
        flags,
        phaseLabel: "Lift the leg — knee straight",
        setComplete: false,
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
      } else {
        this.reps += 1;
        this.onRep?.(this.reps);
        if (this.reps >= this.targetReps) this.setComplete = true;
      }
      this.phase = "down";
      this.peakHipFlex = 180;
      this.bentLogged = false;
    }

    return {
      reps: this.reps,
      flags,
      phaseLabel: this.setComplete ? "Set complete" : "Lower with control",
      setComplete: this.setComplete,
    };
  }
}
