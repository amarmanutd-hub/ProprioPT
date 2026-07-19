/**
 * Pack move contract — squat wraps SquatEvaluator; stubs are rep_detect/timed.
 */

import type { BiomechanicalSample } from "../biomechanics/BiomechanicalEvaluator";
import type { JointLandmark } from "../perception/PerceptionEngine";
import type { OrientationPolicy } from "../perception/PerceptionEngine";

export type MoveMode = "form" | "rep_detect" | "timed";
export type CameraSetup =
  | "standing_front"
  | "standing_side"
  | "floor_diagonal"
  /** @deprecated use floor_diagonal */
  | "supine_side";
export type ExerciseStatus =
  | "pending"
  | "complete"
  | "incomplete"
  | "skipped"
  | "aborted";

export interface MoveDosing {
  sets: number;
  reps?: number;
  holdSec?: number;
}

export interface MoveSetup {
  camera: CameraSetup;
  copy: string;
}

export interface MoveUpdateResult {
  reps: number;
  flags: string[];
  phaseLabel: string;
  setComplete: boolean;
  track?: "ok" | "weak" | "lost";
  trackReason?: string;
  /** Working-limb ° for UI; null = show "—"; omit = caller may use legacy mean. */
  displayKneeDeg?: number | null;
}

export interface ExerciseMove {
  readonly id: string;
  readonly title: string;
  readonly mode: MoveMode;
  readonly dosing: MoveDosing;
  readonly setup: MoveSetup;
  readonly orientation: OrientationPolicy;
  reset(): void;
  update(
    landmarks: JointLandmark[],
    sample: BiomechanicalSample | null,
    t: number,
  ): MoveUpdateResult;
}

export interface PackExerciseRow {
  id: string;
  title: string;
  mode: MoveMode;
  status: ExerciseStatus;
  repsCounted: number;
  formEvents: Array<{ type: string; count: number }>;
  notes?: string;
}
