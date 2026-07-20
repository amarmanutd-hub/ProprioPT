/**
 * Knee v1 pack — all five moves form-coached.
 */

import type { CompensationEvent, RepMetrics } from "../squat/SquatEvaluator";
import type { ClinicalLimits } from "../session/sessionBridge";
import { HeelSlideMove } from "./HeelSlideMove";
import { SquatMove } from "./SquatMove";
import { StepUpMove } from "./StepUpMove";
import { SlrMove } from "./SlrMove";
import { GluteBridgeMove } from "./GluteBridgeMove";
import type { ExerciseMove } from "./types";

export type PackFlagHandler = (kind: string, detail: string) => void;

export function createKneeV1Moves(hooks: {
  targetReps?: number;
  maxKneeFlexionDeg?: number;
  side?: ClinicalLimits["side"];
  onSquatCompensation?: (e: CompensationEvent) => void;
  onSquatRep?: (r: RepMetrics) => void;
  onHeelFlag?: PackFlagHandler;
  onHeelRep?: (repIndex: number) => void;
  onStepFlag?: PackFlagHandler;
  onStepRep?: (repIndex: number) => void;
  onSlrFlag?: PackFlagHandler;
  onSlrRep?: (repIndex: number) => void;
  onBridgeFlag?: PackFlagHandler;
  onBridgeRep?: (repIndex: number) => void;
}): ExerciseMove[] {
  const reps = hooks.targetReps ?? 10;
  const side = hooks.side ?? "bilateral";
  return [
    new SquatMove({
      targetReps: reps,
      maxKneeFlexionDeg: hooks.maxKneeFlexionDeg,
      side,
      onCompensation: hooks.onSquatCompensation,
      onRep: hooks.onSquatRep,
    }),
    new HeelSlideMove({
      targetReps: reps,
      maxKneeFlexionDeg: hooks.maxKneeFlexionDeg,
      side,
      onFlag: hooks.onHeelFlag,
      onRep: hooks.onHeelRep,
    }),
    new StepUpMove({
      targetReps: Math.min(reps, 8),
      side,
      onFlag: hooks.onStepFlag,
      onRep: hooks.onStepRep,
    }),
    new SlrMove({
      targetReps: reps,
      side,
      onFlag: hooks.onSlrFlag,
      onRep: hooks.onSlrRep,
    }),
    new GluteBridgeMove({
      targetReps: reps,
      holdSec: 2,
      onFlag: hooks.onBridgeFlag,
      onRep: hooks.onBridgeRep,
    }),
  ];
}

export const KNEE_V1_PACK_ID = "knee-v1";
