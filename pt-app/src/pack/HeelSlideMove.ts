/**
 * Heel slides — form-coached ROM cycle (incomplete flex + over-flexion).
 * Floor diagonal: working-limb lock + clean-cycle reps.
 *
 * Display uses clinical flexion (° from straight): 0 ≈ straight, ↑ as heel slides in.
 * Prefer 2D image knee angle; if prescribed side looks straight while the other
 * is clearly flexed, treat as L/R swap and follow the flexed side.
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

const FLEX_ENTER = 18;
const RETURN_BAND = 14;
const SHALLOW_MIN = 8;
const SHALLOW_MAX = FLEX_ENTER;
/** Min time in flex half before a return can count. */
const MIN_FLEX_MS = 280;
/** Min gap between counted reps (blocks double-fire from angle teleport). */
const MIN_REP_GAP_MS = 700;

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
  private dirtyThisRep = false;
  private baselineFrozen = false;
  private baselineSamples = 0;
  private flexEnteredAt = 0;
  private lastRepAt = 0;
  private lastGoodFlex: number | null = null;

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
    this.flexEnteredAt = 0;
    this.lastRepAt = 0;
    this.lastGoodFlex = null;
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
        displayKneeDeg: this.lastGoodFlex,
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

    // Prescribed clinical side: never flip lock mid-set (deep slides were
    // getting dirtied by L/R swaps → silent missed reps past the 90° cue).
    if (this.side === "left" || this.side === "right") {
      this.locked = this.side;
    } else {
      if (
        prevLock &&
        picked.lock &&
        picked.lock !== prevLock &&
        !picked.kneesClose
      ) {
        this.markDirtyIfActive();
      }
      if (picked.lock) this.locked = picked.lock;
    }
    if (picked.pos) {
      this.prevKneePos = this.lastKneePos;
      this.lastKneePos = picked.pos;
    }

    if (track.level === "weak") {
      this.markDirtyIfActive();
      return {
        reps: this.reps,
        flags: [],
        phaseLabel: track.reason || "Tracking paused — keep the working leg clear",
        setComplete: false,
        track: "weak",
        trackReason: track.reason,
        displayKneeDeg: this.lastGoodFlex,
      };
    }

    const rawKnee = this.resolveInteriorKnee(landmarks, picked.knee);
    const knee = this.kneeFilter.filter(rawKnee, t);
    const flags: string[] = [];
    const flexNow = toFlexionDeg(knee);
    if (!picked.kneesClose) this.lastGoodFlex = flexNow;
    const flexDisp = this.lastGoodFlex;

    if (rawKnee < this.minKneeAngle - 2) {
      flags.push("overFlexion");
      if (!this.overLogged) {
        this.overLogged = true;
        this.onFlag?.(
          "overFlexion",
          `Past your PT limit (${this.minKneeAngle}°) — ease the slide (rep still counts).`,
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
        this.flexEnteredAt = t;
        this.overLogged = false;
        this.shallowLatched = false;
        return {
          reps: this.reps,
          flags,
          phaseLabel: "Straighten the knee",
          setComplete: false,
          track: "ok",
          displayKneeDeg: flexDisp,
        };
      }

      // Skip incomplete cues while knees overlap — angle identity is unreliable.
      if (!picked.kneesClose) {
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
      }

      return {
        reps: this.reps,
        flags,
        phaseLabel: "Slide heel in",
        setComplete: false,
        track: "ok",
        displayKneeDeg: flexDisp,
      };
    }

    if (knee < this.minThisRep) this.minThisRep = knee;
    const returned = knee >= this.baselineKnee - RETURN_BAND;
    if (returned) {
      const heldLongEnough = t - this.flexEnteredAt >= MIN_FLEX_MS;
      const gapOk = t - this.lastRepAt >= MIN_REP_GAP_MS;
      if (!this.dirtyThisRep && heldLongEnough && gapOk) {
        this.reps += 1;
        this.lastRepAt = t;
        this.onRep?.(this.reps);
        if (this.reps >= this.targetReps) this.setComplete = true;
      }
      this.phase = "extend";
      this.minThisRep = 180;
      this.overLogged = false;
      this.shallowLatched = false;
      this.dirtyThisRep = false;
      this.flexEnteredAt = 0;
    }

    return {
      reps: this.reps,
      flags,
      phaseLabel: this.setComplete ? "Set complete" : "Straighten the knee",
      setComplete: this.setComplete,
      track: "ok",
      displayKneeDeg: this.setComplete ? null : flexDisp,
    };
  }

  /**
   * Prefer image-plane angle. If prescribed side looks extended while the
   * other is clearly flexed, MP likely swapped L/R — follow the flexed side.
   */
  private resolveInteriorKnee(
    landmarks: JointLandmark[],
    sampleKnee: number,
  ): number {
    const imgL = imageKneeInteriorDeg(landmarks, "left");
    const imgR = imageKneeInteriorDeg(landmarks, "right");
    const preferred =
      this.locked === "left"
        ? imgL
        : this.locked === "right"
          ? imgR
          : imgL != null && imgR != null
            ? Math.min(imgL, imgR)
            : (imgL ?? imgR);

    if (
      this.locked &&
      imgL != null &&
      imgR != null &&
      Math.abs(imgL - imgR) > 25
    ) {
      const mine = this.locked === "left" ? imgL : imgR;
      const other = this.locked === "left" ? imgR : imgL;
      // Prescribed looks straight, other clearly bent → use other.
      if (mine > 150 && other < mine - 25) {
        return Math.min(other, sampleKnee);
      }
    }

    if (preferred != null) return Math.min(preferred, sampleKnee);
    return sampleKnee;
  }

  private markDirtyIfActive(): void {
    if (this.phase === "flex" || this.minThisRep < 170) {
      this.dirtyThisRep = true;
    }
  }
}
