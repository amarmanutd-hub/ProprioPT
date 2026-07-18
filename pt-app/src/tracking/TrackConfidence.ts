/**
 * TrackConfidence — ok | weak | lost from working-chain visibility.
 */

import type { JointLandmark } from "../perception/PerceptionEngine";
import {
  chainVisibility,
  type LockedKnee,
  type WorkingSide,
} from "./workingLimb";

export type TrackLevel = "ok" | "weak" | "lost";

export interface TrackAssessment {
  level: TrackLevel;
  reason: string;
  side: LockedKnee | null;
}

const OK_MIN = 0.4;
const WEAK_MIN = 0.22;

export function assessTrack(
  landmarks: JointLandmark[],
  side: LockedKnee | null,
  prescribed: WorkingSide | undefined,
): TrackAssessment {
  const preferred: LockedKnee | null =
    prescribed === "left" || prescribed === "right"
      ? prescribed
      : side;

  if (preferred) {
    const v = chainVisibility(landmarks, preferred);
    if (v >= OK_MIN) {
      return { level: "ok", reason: "", side: preferred };
    }
    if (v >= WEAK_MIN) {
      return {
        level: "weak",
        reason: "Tracking weak — scoot so the moving leg is clearer.",
        side: preferred,
      };
    }
    return {
      level: "lost",
      reason: "Can't see the working leg — tip phone toward hips and feet.",
      side: preferred,
    };
  }

  const lv = chainVisibility(landmarks, "left");
  const rv = chainVisibility(landmarks, "right");
  const best = Math.max(lv, rv);
  const bestSide: LockedKnee = lv >= rv ? "left" : "right";
  if (best >= OK_MIN) {
    return { level: "ok", reason: "", side: bestSide };
  }
  if (best >= WEAK_MIN) {
    return {
      level: "weak",
      reason: "Tracking weak — working leg nearer the camera helps.",
      side: bestSide,
    };
  }
  return {
    level: "lost",
    reason: "Can't see hips–knees–ankles. Diagonal view, whole leg in frame.",
    side: null,
  };
}
