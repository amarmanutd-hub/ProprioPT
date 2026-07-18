/**
 * Heel slides — form-coached ROM cycle (incomplete flex + over-flexion).
 * Side camera: lock onto one working knee (prescribed side or first clear asymmetry).
 */

import type { BiomechanicalSample } from "../biomechanics/BiomechanicalEvaluator";
import type { JointLandmark } from "../perception/PerceptionEngine";
import type { ExerciseMove, MoveDosing, MoveSetup, MoveUpdateResult } from "./types";
import type { WorkingSide } from "./workingSide";

export interface HeelSlideMoveOptions {
  targetReps?: number;
  maxKneeFlexionDeg?: number;
  side?: WorkingSide;
  onFlag?: (kind: string, detail: string) => void;
  onRep?: (repIndex: number) => void;
}

type LockedKnee = "left" | "right";

export class HeelSlideMove implements ExerciseMove {
  readonly id = "heel_slide";
  readonly title = "Heel slides";
  readonly mode = "form" as const;
  readonly dosing: MoveDosing;
  readonly setup: MoveSetup = {
    camera: "supine_side",
    copy: "Lie on your back. Phone on its side — hips to feet in frame. Move only one heel; keep the other leg still.",
  };
  readonly orientation = "relaxed_floor" as const;

  private readonly targetReps: number;
  private readonly minKneeAngle: number;
  private readonly side: WorkingSide;
  private readonly onFlag?: (kind: string, detail: string) => void;
  private readonly onRep?: (repIndex: number) => void;

  private reps = 0;
  private phase: "extend" | "flex" = "extend";
  private baselineKnee = 160;
  private minThisRep = 180;
  private setComplete = false;
  private overLogged = false;
  private shallowLatched = false;
  /** Resolved working knee for this set (side view L/R is unreliable until locked). */
  private locked: LockedKnee | null = null;

  constructor(options: HeelSlideMoveOptions = {}) {
    this.targetReps = options.targetReps ?? 10;
    this.dosing = { sets: 2, reps: this.targetReps };
    // max flexion deg → min knee angle (straight ≈ 180)
    this.minKneeAngle = options.maxKneeFlexionDeg ?? 90;
    this.side = options.side ?? "bilateral";
    this.onFlag = options.onFlag;
    this.onRep = options.onRep;
    if (this.side === "left" || this.side === "right") this.locked = this.side;
  }

  reset(): void {
    this.reps = 0;
    this.phase = "extend";
    this.baselineKnee = 160;
    this.minThisRep = 180;
    this.setComplete = false;
    this.overLogged = false;
    this.shallowLatched = false;
    this.locked =
      this.side === "left" || this.side === "right" ? this.side : null;
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

    const knee = this.pickWorkingKnee(landmarks, sample);
    const flags: string[] = [];

    if (knee < this.minKneeAngle - 2) {
      flags.push("overFlexion");
      if (!this.overLogged) {
        this.overLogged = true;
        this.onFlag?.(
          "overFlexion",
          `Past your PT limit (${this.minKneeAngle}°) — ease the slide.`,
        );
      }
    }

    if (this.phase === "extend") {
      if (knee > 140) {
        this.baselineKnee = this.baselineKnee * 0.9 + knee * 0.1;
      }
      // Track deepest during this attempt
      if (knee < this.minThisRep) this.minThisRep = knee;

      const flexedEnough = knee <= this.baselineKnee - 25;
      if (flexedEnough) {
        this.phase = "flex";
        this.overLogged = false;
        this.shallowLatched = false;
        return {
          reps: this.reps,
          flags,
          phaseLabel: "Straighten the knee",
          setComplete: false,
        };
      }

      // Shallow attempt: dipped then returned without reaching depth target
      const attempt = this.baselineKnee - this.minThisRep;
      if (
        attempt >= 10 &&
        attempt < 25 &&
        knee >= this.baselineKnee - 10 &&
        this.minThisRep < 180
      ) {
        flags.push("incompleteFlex");
        if (!this.shallowLatched) {
          this.shallowLatched = true;
          this.onFlag?.(
            "incompleteFlex",
            "Slide the heel farther in before straightening.",
          );
        }
        this.minThisRep = 180;
      } else if (knee >= this.baselineKnee - 5) {
        this.minThisRep = 180;
        this.shallowLatched = false;
      }

      return {
        reps: this.reps,
        flags,
        phaseLabel: "Slide heel in",
        setComplete: false,
      };
    }

    // flex phase — returning toward extension (depth already earned)
    if (knee < this.minThisRep) this.minThisRep = knee;
    const returned = knee >= this.baselineKnee - 12;
    if (returned) {
      this.reps += 1;
      this.onRep?.(this.reps);
      if (this.reps >= this.targetReps) this.setComplete = true;
      this.phase = "extend";
      this.minThisRep = 180;
      this.overLogged = false;
      this.shallowLatched = false;
    }

    return {
      reps: this.reps,
      flags,
      phaseLabel: this.setComplete ? "Set complete" : "Straighten the knee",
      setComplete: this.setComplete,
    };
  }

  /** Prefer prescribed side; else lock to the clearly moving (more flexed) knee. */
  private pickWorkingKnee(
    landmarks: JointLandmark[],
    sample: BiomechanicalSample,
  ): number {
    const L = sample.angles.leftKnee;
    const R = sample.angles.rightKnee;

    if (this.locked === "left") return L;
    if (this.locked === "right") return R;

    const map = new Map(landmarks.map((l) => [l.index, l]));
    const lv = map.get(25)?.visibility ?? 0;
    const rv = map.get(26)?.visibility ?? 0;

    // Working heel is usually more flexed once the slide starts.
    if (Math.abs(L - R) >= 18) {
      this.locked = L < R ? "left" : "right";
      return this.locked === "left" ? L : R;
    }

    // Ignore a ghost/occluded joint in side view.
    if (lv > 0.35 && rv < 0.22) return L;
    if (rv > 0.35 && lv < 0.22) return R;

    return lv >= rv ? L : R;
  }
}
