/**
 * Knee v1 pack — five moves; squat form-coached; others labeled stubs.
 */

import type { CompensationEvent, RepMetrics } from "../squat/SquatEvaluator";
import { SquatMove } from "./SquatMove";
import { StubMove } from "./StubMove";
import type { ExerciseMove } from "./types";

export function createKneeV1Moves(hooks: {
  onSquatCompensation?: (e: CompensationEvent) => void;
  onSquatRep?: (r: RepMetrics) => void;
}): ExerciseMove[] {
  return [
    new SquatMove({
      targetReps: 10,
      onCompensation: hooks.onSquatCompensation,
      onRep: hooks.onSquatRep,
    }),
    new StubMove({
      id: "heel_slide",
      title: "Heel slides",
      mode: "rep_detect",
      dosing: { sets: 2, reps: 10 },
      orientation: "relaxed_floor",
      setup: {
        camera: "supine_side",
        copy: "Lie on your back. Place the phone on its side so it sees your hips to feet. Slide your heel toward your butt, then straighten.",
      },
      flexDeltaDeg: 30,
    }),
    new StubMove({
      id: "step_up",
      title: "Step-ups",
      mode: "rep_detect",
      dosing: { sets: 2, reps: 8 },
      orientation: "upright_lock",
      setup: {
        camera: "standing_side",
        copy: "Stand beside a low step. Full body in frame. Step up and down with control.",
      },
      flexDeltaDeg: 20,
    }),
    new StubMove({
      id: "slr",
      title: "Straight leg raise",
      mode: "rep_detect",
      dosing: { sets: 2, reps: 10 },
      orientation: "relaxed_floor",
      setup: {
        camera: "supine_side",
        copy: "Lie on your back, phone on its side. Keep the knee straight and lift the leg, then lower slowly.",
      },
      flexDeltaDeg: 15,
    }),
    new StubMove({
      id: "glute_bridge",
      title: "Glute bridge",
      mode: "timed",
      dosing: { sets: 2, reps: 10, holdSec: 2 },
      orientation: "relaxed_floor",
      setup: {
        camera: "supine_side",
        copy: "Lie on your back, phone on its side. Drive through heels and lift hips; hold briefly at the top.",
      },
    }),
  ];
}

export const KNEE_V1_PACK_ID = "knee-v1";
