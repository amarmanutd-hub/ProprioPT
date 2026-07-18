/**
 * Form-coached squat as an ExerciseMove.
 */

import type { BiomechanicalSample } from "../biomechanics/BiomechanicalEvaluator";
import type { JointLandmark } from "../perception/PerceptionEngine";
import {
  SquatEvaluator,
  type CompensationEvent,
  type RepMetrics,
  type SquatFrameResult,
} from "../squat/SquatEvaluator";
import type { ExerciseMove, MoveDosing, MoveSetup, MoveUpdateResult } from "./types";
import { sampleForSide, type WorkingSide } from "./workingSide";

export interface SquatMoveOptions {
  targetReps?: number;
  /** Clinical max flexion → min knee angle (degrees). */
  maxKneeFlexionDeg?: number;
  side?: WorkingSide;
  onCompensation?: (e: CompensationEvent) => void;
  onRep?: (r: RepMetrics) => void;
}

export class SquatMove implements ExerciseMove {
  readonly id = "squat";
  readonly title = "Squats";
  readonly mode = "form" as const;
  readonly dosing: MoveDosing;
  readonly setup: MoveSetup = {
    camera: "standing_front",
    copy: "Stand facing the camera, full body in frame. Mini-squat depth is fine.",
  };
  readonly orientation = "upright_lock" as const;

  private readonly squat: SquatEvaluator;
  private readonly targetReps: number;
  private readonly side: WorkingSide;
  private flagCounts = new Map<string, number>();
  private setComplete = false;
  private lastReps = 0;
  private lastResult: SquatFrameResult | null = null;

  constructor(options: SquatMoveOptions = {}) {
    this.targetReps = options.targetReps ?? 10;
    this.side = options.side ?? "bilateral";
    this.dosing = { sets: 2, reps: this.targetReps };
    this.squat = new SquatEvaluator({
      minKneeAngleDeg: options.maxKneeFlexionDeg,
      onCompensation: (e) => {
        this.flagCounts.set(e.kind, (this.flagCounts.get(e.kind) ?? 0) + 1);
        options.onCompensation?.(e);
      },
      onRep: (r) => {
        this.lastReps = r.repIndex;
        if (r.repIndex >= this.targetReps) this.setComplete = true;
        options.onRep?.(r);
      },
    });
  }

  getLastResult(): SquatFrameResult | null {
    return this.lastResult;
  }

  getFlagCounts(): Map<string, number> {
    return this.flagCounts;
  }

  reset(): void {
    this.squat.reset();
    this.flagCounts.clear();
    this.setComplete = false;
    this.lastReps = 0;
    this.lastResult = null;
  }

  update(
    landmarks: JointLandmark[],
    sample: BiomechanicalSample | null,
    _t: number,
  ): MoveUpdateResult {
    if (!sample) {
      return {
        reps: this.lastReps,
        flags: [],
        phaseLabel: "Waiting for pose",
        setComplete: this.setComplete,
      };
    }
    const r = this.squat.update(sampleForSide(sample, this.side), landmarks);
    this.lastResult = r;
    this.lastReps = r.reps;
    if (r.reps >= this.targetReps) this.setComplete = true;
    return {
      reps: r.reps,
      flags: [...r.activeFlags],
      phaseLabel: r.stateLabel,
      setComplete: this.setComplete,
    };
  }
}
