/**
 * Glute bridge — form-coached (incomplete lift, uneven hips).
 * Lift direction learned from first significant hip motion (dual polarity).
 */

import type { BiomechanicalSample } from "../biomechanics/BiomechanicalEvaluator";
import type { JointLandmark } from "../perception/PerceptionEngine";
import type { ExerciseMove, MoveDosing, MoveSetup, MoveUpdateResult } from "./types";

export interface GluteBridgeMoveOptions {
  targetReps?: number;
  holdSec?: number;
  onFlag?: (kind: string, detail: string) => void;
  onRep?: (repIndex: number) => void;
}

function midHipY(landmarks: JointLandmark[]): number | null {
  const l = landmarks.find((p) => p.index === 23 && p.visibility >= 0.3);
  const r = landmarks.find((p) => p.index === 24 && p.visibility >= 0.3);
  if (!l || !r) return null;
  return (l.y + r.y) / 2;
}

function hipSkew(landmarks: JointLandmark[]): number | null {
  const l = landmarks.find((p) => p.index === 23 && p.visibility >= 0.3);
  const r = landmarks.find((p) => p.index === 24 && p.visibility >= 0.3);
  if (!l || !r) return null;
  return Math.abs(l.y - r.y);
}

export class GluteBridgeMove implements ExerciseMove {
  readonly id = "glute_bridge";
  readonly title = "Glute bridge";
  readonly mode = "form" as const;
  readonly dosing: MoveDosing;
  readonly setup: MoveSetup = {
    camera: "supine_side",
    copy: "Lie on your back, phone on its side. Drive through heels, lift hips, hold briefly, then lower.",
  };
  readonly orientation = "relaxed_floor" as const;

  private readonly targetReps: number;
  private readonly holdSec: number;
  private readonly onFlag?: (kind: string, detail: string) => void;
  private readonly onRep?: (repIndex: number) => void;

  private reps = 0;
  private phase: "rest" | "lift" | "hold" = "rest";
  private baselineY: number | null = null;
  /** Sign of (y - baseline) at first lift; liftMag = max(0, (y-baseline)*sign). */
  private liftSign: number | null = null;
  private peakLift = 0;
  private holdStartMs: number | null = null;
  private unevenLogged = false;
  private setComplete = false;

  constructor(options: GluteBridgeMoveOptions = {}) {
    this.targetReps = options.targetReps ?? 10;
    this.holdSec = options.holdSec ?? 2;
    this.dosing = { sets: 2, reps: this.targetReps, holdSec: this.holdSec };
    this.onFlag = options.onFlag;
    this.onRep = options.onRep;
  }

  reset(): void {
    this.reps = 0;
    this.phase = "rest";
    this.baselineY = null;
    this.liftSign = null;
    this.peakLift = 0;
    this.holdStartMs = null;
    this.unevenLogged = false;
    this.setComplete = false;
  }

  update(
    landmarks: JointLandmark[],
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

    const y = midHipY(landmarks);
    const flags: string[] = [];
    if (y == null) {
      return {
        reps: this.reps,
        flags,
        phaseLabel: "Hips in frame",
        setComplete: false,
      };
    }

    if (this.baselineY == null) this.baselineY = y;
    const delta = y - this.baselineY;
    const abs = Math.abs(delta);

    if (this.phase === "rest") {
      if (abs < 0.02) {
        this.baselineY = this.baselineY * 0.92 + y * 0.08;
      }
      if (abs >= 0.04) {
        this.liftSign = delta >= 0 ? 1 : -1;
        this.phase = "lift";
        this.peakLift = abs;
        this.unevenLogged = false;
      }
      return {
        reps: this.reps,
        flags,
        phaseLabel: "Lift hips",
        setComplete: false,
      };
    }

    const sign = this.liftSign ?? (delta >= 0 ? 1 : -1);
    const liftMag = Math.max(0, delta * sign);
    if (liftMag > this.peakLift) this.peakLift = liftMag;

    const skew = hipSkew(landmarks);
    if (skew != null && skew > 0.045) {
      flags.push("unevenHips");
      if (!this.unevenLogged) {
        this.unevenLogged = true;
        this.onFlag?.(
          "unevenHips",
          "Hips uneven — level them at the top.",
        );
      }
    }

    if (this.phase === "lift") {
      if (liftMag >= 0.055 && liftMag >= this.peakLift - 0.01) {
        this.phase = "hold";
        this.holdStartMs = t;
      } else if (liftMag < 0.025) {
        flags.push("incompleteLift");
        this.onFlag?.(
          "incompleteLift",
          "Lift higher — squeeze glutes at the top.",
        );
        this.phase = "rest";
        this.peakLift = 0;
        this.unevenLogged = false;
      }
      return {
        reps: this.reps,
        flags,
        phaseLabel: "Drive hips up",
        setComplete: false,
      };
    }

    const held = this.holdStartMs != null ? (t - this.holdStartMs) / 1000 : 0;
    if (liftMag < 0.03) {
      if (this.peakLift < 0.05) {
        flags.push("incompleteLift");
        this.onFlag?.(
          "incompleteLift",
          "Lift higher — squeeze glutes at the top.",
        );
      } else if (held < this.holdSec * 0.4) {
        flags.push("incompleteLift");
        this.onFlag?.(
          "incompleteLift",
          `Hold ~${this.holdSec}s at the top before lowering.`,
        );
      } else {
        this.reps += 1;
        this.onRep?.(this.reps);
        if (this.reps >= this.targetReps) this.setComplete = true;
      }
      this.phase = "rest";
      this.peakLift = 0;
      this.holdStartMs = null;
      this.unevenLogged = false;
      return {
        reps: this.reps,
        flags,
        phaseLabel: this.setComplete ? "Set complete" : "Lift hips",
        setComplete: this.setComplete,
      };
    }

    return {
      reps: this.reps,
      flags,
      phaseLabel: `Hold ${Math.min(held, this.holdSec).toFixed(1)}s`,
      setComplete: false,
    };
  }
}
