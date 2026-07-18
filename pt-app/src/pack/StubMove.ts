/**
 * Stub moves — rep_detect (knee ROM cycles) or timed hold. Not clinical form.
 */

import type { BiomechanicalSample } from "../biomechanics/BiomechanicalEvaluator";
import type { JointLandmark } from "../perception/PerceptionEngine";
import type {
  ExerciseMove,
  MoveDosing,
  MoveMode,
  MoveSetup,
  MoveUpdateResult,
} from "./types";
import type { OrientationPolicy } from "../perception/PerceptionEngine";

export interface StubMoveOptions {
  id: string;
  title: string;
  mode: Exclude<MoveMode, "form">;
  dosing: MoveDosing;
  setup: MoveSetup;
  orientation: OrientationPolicy;
  /** For rep_detect: knee must drop below this from standing baseline. */
  flexDeltaDeg?: number;
}

export class StubMove implements ExerciseMove {
  readonly id: string;
  readonly title: string;
  readonly mode: Exclude<MoveMode, "form">;
  readonly dosing: MoveDosing;
  readonly setup: MoveSetup;
  readonly orientation: OrientationPolicy;
  private readonly flexDelta: number;
  private readonly targetReps: number;
  private readonly holdSec: number;

  private reps = 0;
  private phase: "up" | "down" = "up";
  private holdStartMs: number | null = null;
  private setComplete = false;
  private baselineKnee = 160;

  constructor(options: StubMoveOptions) {
    this.id = options.id;
    this.title = options.title;
    this.mode = options.mode;
    this.dosing = options.dosing;
    this.setup = options.setup;
    this.orientation = options.orientation;
    this.flexDelta = options.flexDeltaDeg ?? 25;
    this.targetReps = options.dosing.reps ?? 10;
    this.holdSec = options.dosing.holdSec ?? 2;
  }

  reset(): void {
    this.reps = 0;
    this.phase = "up";
    this.holdStartMs = null;
    this.setComplete = false;
    this.baselineKnee = 160;
  }

  update(
    _landmarks: JointLandmark[],
    sample: BiomechanicalSample | null,
    t: number,
  ): MoveUpdateResult {
    if (this.setComplete || !sample) {
      return {
        reps: this.reps,
        flags: [],
        phaseLabel: this.setComplete ? "Set complete" : "Waiting for pose",
        setComplete: this.setComplete,
      };
    }

    const knee =
      (sample.angles.leftKnee + sample.angles.rightKnee) / 2;

    if (this.mode === "timed") {
      if (this.holdStartMs == null) this.holdStartMs = t;
      const held = (t - this.holdStartMs) / 1000;
      const done = held >= this.holdSec * (this.dosing.sets || 1);
      if (done) {
        this.setComplete = true;
        this.reps = this.targetReps;
      }
      return {
        reps: this.reps,
        flags: [],
        phaseLabel: done
          ? "Set complete"
          : `Hold ${Math.min(held, this.holdSec).toFixed(1)}s`,
        setComplete: this.setComplete,
      };
    }

    // rep_detect: simple up/down on knee angle
    if (this.phase === "up") {
      if (knee < this.baselineKnee - this.flexDelta) {
        this.phase = "down";
      } else if (knee > this.baselineKnee) {
        this.baselineKnee = knee * 0.2 + this.baselineKnee * 0.8;
      }
    } else if (knee > this.baselineKnee - this.flexDelta * 0.35) {
      this.phase = "up";
      this.reps += 1;
      if (this.reps >= this.targetReps) this.setComplete = true;
    }

    return {
      reps: this.reps,
      flags: [],
      phaseLabel: this.setComplete
        ? "Set complete"
        : `Counting — ${this.reps} / ${this.targetReps}`,
      setComplete: this.setComplete,
    };
  }
}
