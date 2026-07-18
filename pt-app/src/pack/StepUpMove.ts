/**
 * Step-ups — form-coached (incomplete rise, valgus, trunk lean).
 */

import type { BiomechanicalSample } from "../biomechanics/BiomechanicalEvaluator";
import type { JointLandmark } from "../perception/PerceptionEngine";
import type { ExerciseMove, MoveDosing, MoveSetup, MoveUpdateResult } from "./types";
import { sampleForSide, type WorkingSide } from "./workingSide";

export interface StepUpMoveOptions {
  targetReps?: number;
  side?: WorkingSide;
  onFlag?: (kind: string, detail: string) => void;
  onRep?: (repIndex: number) => void;
}

function lm(landmarks: JointLandmark[], i: number): JointLandmark | undefined {
  return landmarks.find((l) => l.index === i && l.visibility >= 0.3);
}

export class StepUpMove implements ExerciseMove {
  readonly id = "step_up";
  readonly title = "Step-ups";
  readonly mode = "form" as const;
  readonly dosing: MoveDosing;
  readonly setup: MoveSetup = {
    camera: "standing_front",
    copy: "Face the camera, full body in frame, low step in front of you. Step up with control, then step down.",
  };
  readonly orientation = "upright_lock" as const;

  private readonly targetReps: number;
  private readonly side: WorkingSide;
  private readonly onFlag?: (kind: string, detail: string) => void;
  private readonly onRep?: (repIndex: number) => void;

  private reps = 0;
  private phase: "stand" | "step" = "stand";
  private baselineKnee = 160;
  private minThisRep = 180;
  private setComplete = false;
  private flagged = new Set<string>();

  constructor(options: StepUpMoveOptions = {}) {
    this.targetReps = options.targetReps ?? 8;
    this.side = options.side ?? "bilateral";
    this.dosing = { sets: 2, reps: this.targetReps };
    this.onFlag = options.onFlag;
    this.onRep = options.onRep;
  }

  reset(): void {
    this.reps = 0;
    this.phase = "stand";
    this.baselineKnee = 160;
    this.minThisRep = 180;
    this.setComplete = false;
    this.flagged.clear();
  }

  update(
    landmarks: JointLandmark[],
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

    const sided = sampleForSide(sample, this.side);
    const knee = Math.min(sided.angles.leftKnee, sided.angles.rightKnee);
    const flags: string[] = [];

    if (this.phase === "stand" && knee > 140) {
      this.baselineKnee = this.baselineKnee * 0.9 + knee * 0.1;
    }

    if (this.phase === "step") {
      if (this.isValgus(landmarks)) {
        flags.push("valgus");
        this.emitOnce("valgus", "Knee caving — push it out over the toes.");
      }
      const lean = this.trunkLeanDeg(landmarks);
      if (lean != null && lean > 28) {
        flags.push("trunk");
        this.emitOnce("trunk", "Chest tipping — stand taller on the step.");
      }
    }

    if (this.phase === "stand") {
      if (knee <= this.baselineKnee - 22) {
        this.phase = "step";
        this.minThisRep = knee;
        this.flagged.clear();
      }
      return {
        reps: this.reps,
        flags,
        phaseLabel: "Step up",
        setComplete: false,
      };
    }

    if (knee < this.minThisRep) this.minThisRep = knee;
    const risen = knee >= this.baselineKnee - 14;
    if (risen) {
      const depth = this.baselineKnee - this.minThisRep;
      if (depth < 16) {
        flags.push("incompleteRise");
        this.onFlag?.(
          "incompleteRise",
          "Didn’t rise fully — finish standing tall on the step.",
        );
      } else {
        this.reps += 1;
        this.onRep?.(this.reps);
        if (this.reps >= this.targetReps) this.setComplete = true;
      }
      this.phase = "stand";
      this.minThisRep = 180;
      this.flagged.clear();
    }

    return {
      reps: this.reps,
      flags,
      phaseLabel: this.setComplete ? "Set complete" : "Control the rise",
      setComplete: this.setComplete,
    };
  }

  private emitOnce(kind: string, detail: string): void {
    if (this.flagged.has(kind)) return;
    this.flagged.add(kind);
    this.onFlag?.(kind, detail);
  }

  private isValgus(landmarks: JointLandmark[]): boolean {
    const lk = lm(landmarks, 25);
    const rk = lm(landmarks, 26);
    const la = lm(landmarks, 27);
    const ra = lm(landmarks, 28);
    if (!lk || !rk || !la || !ra) return false;
    const kneeW = Math.abs(lk.x - rk.x);
    const ankleW = Math.abs(la.x - ra.x);
    if (ankleW < 0.02) return false;
    return kneeW < ankleW * 0.72;
  }

  private trunkLeanDeg(landmarks: JointLandmark[]): number | null {
    const ls = lm(landmarks, 11);
    const rs = lm(landmarks, 12);
    const lh = lm(landmarks, 23);
    const rh = lm(landmarks, 24);
    if (!ls || !rs || !lh || !rh) return null;
    const midSx = (ls.x + rs.x) / 2;
    const midSy = (ls.y + rs.y) / 2;
    const midHx = (lh.x + rh.x) / 2;
    const midHy = (lh.y + rh.y) / 2;
    const dx = midSx - midHx;
    const dy = midHy - midSy;
    if (Math.abs(dy) < 0.02) return null;
    return (Math.abs(Math.atan2(dx, dy)) * 180) / Math.PI;
  }
}
