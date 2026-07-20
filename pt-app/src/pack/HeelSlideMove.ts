/**
 * Heel slides — form-coached ROM cycle (incomplete flex + over-flexion).
 * Floor diagonal: working-limb lock + silence ° on overlap/weak + clean-cycle reps.
 *
 * Display uses clinical flexion (° from straight): 0 ≈ straight, ↑ as heel slides in.
 * Internal joint angle still drives the FSM (180 ≈ straight, ↓ when flexed).
 */

import type { BiomechanicalSample } from "../biomechanics/BiomechanicalEvaluator";
import { imageKneeInteriorDeg } from "../biomechanics/BiomechanicalEvaluator";
import type { JointLandmark } from "../perception/PerceptionEngine";
import { OneEuroAngle } from "../tracking/OneEuroAngle";
import { assessTrack } from "../tracking/TrackConfidence";
import {
  pickWorkingKnee,
  type KneePos,
  type LockedKnee,
  type WorkingSide,
} from "../tracking/workingLimb";
import type { ExerciseMove, MoveDosing, MoveSetup, MoveUpdateResult } from "./types";

/** Degrees of flexion from straight needed to enter the return half of a rep. */
const FLEX_ENTER = 18;
/** Return to within this of baseline internal angle to complete the rep. */
const RETURN_BAND = 14;
/** Shallow attempt band (from baseline) that triggers incompleteFlex. */
const SHALLOW_MIN = 8;
const SHALLOW_MAX = FLEX_ENTER;

export interface HeelSlideMoveOptions {
  targetReps?: number;
  maxKneeFlexionDeg?: number;
  side?: WorkingSide;
  onFlag?: (kind: string, detail: string) => void;
  onRep?: (repIndex: number) => void;
}

/** Clinical flexion from internal joint angle (180≈straight → 0 flexion). */
export function toFlexionDeg(internalKneeDeg: number): number {
  return Math.max(0, Math.min(180, 180 - internalKneeDeg));
}

export class HeelSlideMove implements ExerciseMove {
  readonly id = "heel_slide";
  readonly title = "Heel slides";
  readonly mode = "form" as const;
  readonly dosing: MoveDosing;
  readonly setup: MoveSetup = {
    camera: "floor_diagonal",
    copy: "Lie on your back. Phone diagonal (~30–45°) — working leg nearer camera, hips to feet in frame. Slide that heel in, then straighten.",
  };
  readonly orientation = "relaxed_floor" as const;

  private readonly targetReps: number;
  /** Min allowed internal knee angle (= clinical max flexion when 180=straight). */
  private readonly minKneeAngle: number;
  private readonly side: WorkingSide;
  private readonly onFlag?: (kind: string, detail: string) => void;
  private readonly onRep?: (repIndex: number) => void;
  private readonly kneeFilter = new OneEuroAngle(3.6, 0.08, 1.0);

  private reps = 0;
  private phase: "extend" | "flex" = "extend";
  private baselineKnee = 160;
  private minThisRep = 180;
  private setComplete = false;
  private overLogged = false;
  private shallowLatched = false;
  private locked: LockedKnee | null = null;
  private lastKneePos: KneePos | null = null;
  private prevKneePos: KneePos | null = null;
  /** Mid-rep silence / identity glitch — do not count this cycle. */
  private dirtyThisRep = false;
  /** Freeze baseline after we have a stable extended pose. */
  private baselineFrozen = false;
  private baselineSamples = 0;

  constructor(options: HeelSlideMoveOptions = {}) {
    this.targetReps = options.targetReps ?? 10;
    this.dosing = { sets: 2, reps: this.targetReps };
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
    this.lastKneePos = null;
    this.prevKneePos = null;
    this.dirtyThisRep = false;
    this.baselineFrozen = false;
    this.baselineSamples = 0;
    this.kneeFilter.reset();
  }

  update(
    landmarks: JointLandmark[],
    sample: BiomechanicalSample | null,
    t: number,
  ): MoveUpdateResult {
    const track = assessTrack(landmarks, this.locked, this.side);

    if (this.setComplete) {
      return {
        reps: this.reps,
        flags: [],
        phaseLabel: "Set complete",
        setComplete: true,
        track: "ok",
        displayKneeDeg: null,
      };
    }

    if (track.level === "lost" || !sample) {
      this.markDirtyIfActive();
      return {
        reps: this.reps,
        flags: [],
        phaseLabel: track.reason || "Tracking lost — show the working leg",
        setComplete: false,
        track: "lost",
        trackReason: track.reason,
        displayKneeDeg: null,
      };
    }

    const prevLock = this.locked;
    const picked = pickWorkingKnee(
      landmarks,
      sample.angles.leftKnee,
      sample.angles.rightKnee,
      this.side,
      this.locked,
      this.lastKneePos,
      sample.angles.leftHip,
      sample.angles.rightHip,
      {
        useVelocityBias: true,
        prevPos: this.prevKneePos,
        freezeLockWhenClose: true,
      },
    );

    if (
      prevLock &&
      picked.lock &&
      picked.lock !== prevLock &&
      !picked.kneesClose
    ) {
      this.markDirtyIfActive();
    }

    if (picked.lock) this.locked = picked.lock;
    if (picked.pos) {
      this.prevKneePos = this.lastKneePos;
      this.lastKneePos = picked.pos;
    }

    // Weak track: unreliable angles → discard cycle + hide °.
    // Knee overlap alone: hide ° but KEEP driving the FSM (deep slides
    // often overlap; pausing the state machine was dropping reps).
    if (track.level === "weak") {
      this.markDirtyIfActive();
      return {
        reps: this.reps,
        flags: [],
        phaseLabel: track.reason || "Tracking paused — keep the working leg clear",
        setComplete: false,
        track: "weak",
        trackReason: track.reason,
        displayKneeDeg: null,
      };
    }

    const hideDeg = picked.kneesClose;
    // Floor diagonal: 3D often under-reports bend; take the more flexed reading.
    const imgKnee =
      picked.lock != null
        ? imageKneeInteriorDeg(landmarks, picked.lock)
        : null;
    const rawKnee =
      imgKnee != null ? Math.min(imgKnee, picked.knee) : picked.knee;
    const knee = this.kneeFilter.filter(rawKnee, t);
    const flags: string[] = [];
    const flexDisp = hideDeg ? null : toFlexionDeg(knee);

    if (rawKnee < this.minKneeAngle - 2) {
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
      if (!this.baselineFrozen && knee >= this.baselineKnee - 8) {
        this.baselineKnee = this.baselineKnee * 0.9 + knee * 0.1;
        this.baselineSamples += 1;
        if (this.baselineSamples >= 12) this.baselineFrozen = true;
      }
      if (rawKnee < this.minThisRep) this.minThisRep = rawKnee;

      const flexedEnough = knee <= this.baselineKnee - FLEX_ENTER;
      if (flexedEnough) {
        this.phase = "flex";
        this.overLogged = false;
        this.shallowLatched = false;
        return {
          reps: this.reps,
          flags,
          phaseLabel: "Straighten the knee",
          setComplete: false,
          track: hideDeg ? "weak" : "ok",
          trackReason: hideDeg
            ? "Tracking paused — keep the working leg clear"
            : undefined,
          displayKneeDeg: flexDisp,
        };
      }

      const attempt = this.baselineKnee - this.minThisRep;
      if (
        attempt >= SHALLOW_MIN &&
        attempt < SHALLOW_MAX &&
        rawKnee >= this.minThisRep + 8 &&
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
      } else if (
        rawKnee >= this.baselineKnee - 5 &&
        this.baselineKnee - this.minThisRep < SHALLOW_MIN
      ) {
        this.minThisRep = 180;
        this.shallowLatched = false;
      }

      return {
        reps: this.reps,
        flags,
        phaseLabel: "Slide heel in",
        setComplete: false,
        track: hideDeg ? "weak" : "ok",
        trackReason: hideDeg
          ? "Tracking paused — keep the working leg clear"
          : undefined,
        displayKneeDeg: flexDisp,
      };
    }

    if (knee < this.minThisRep) this.minThisRep = knee;
    const returned = knee >= this.baselineKnee - RETURN_BAND;
    if (returned) {
      if (!this.dirtyThisRep) {
        this.reps += 1;
        this.onRep?.(this.reps);
        if (this.reps >= this.targetReps) this.setComplete = true;
      }
      this.phase = "extend";
      this.minThisRep = 180;
      this.overLogged = false;
      this.shallowLatched = false;
      this.dirtyThisRep = false;
    }

    return {
      reps: this.reps,
      flags,
      phaseLabel: this.setComplete ? "Set complete" : "Straighten the knee",
      setComplete: this.setComplete,
      track: hideDeg ? "weak" : "ok",
      trackReason: hideDeg
        ? "Tracking paused — keep the working leg clear"
        : undefined,
      displayKneeDeg: this.setComplete ? null : flexDisp,
    };
  }

  private markDirtyIfActive(): void {
    if (this.phase === "flex" || this.minThisRep < 170) {
      this.dirtyThisRep = true;
    }
  }
}
