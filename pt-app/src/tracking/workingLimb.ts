/**
 * Working-limb selection for floor / unilaterals.
 * Prefer prescribed clinical side; else lock to visibly flexed chain.
 */

import type { JointLandmark } from "../perception/PerceptionEngine";
import type { ClinicalLimits } from "../session/sessionBridge";

export type WorkingSide = ClinicalLimits["side"];
export type LockedKnee = "left" | "right";

const L_HIP = 23;
const R_HIP = 24;
const L_KN = 25;
const R_KN = 26;
const L_ANK = 27;
const R_ANK = 28;

export function chainVisibility(
  landmarks: JointLandmark[],
  side: LockedKnee,
): number {
  const map = new Map(landmarks.map((l) => [l.index, l]));
  const ids = side === "left" ? [L_HIP, L_KN, L_ANK] : [R_HIP, R_KN, R_ANK];
  let min = 1;
  for (const id of ids) {
    const v = map.get(id)?.visibility ?? 0;
    if (v < min) min = v;
  }
  return min;
}

export function pickWorkingKnee(
  landmarks: JointLandmark[],
  leftKnee: number,
  rightKnee: number,
  prescribed: WorkingSide | undefined,
  locked: LockedKnee | null,
): { knee: number; lock: LockedKnee | null } {
  if (prescribed === "left") return { knee: leftKnee, lock: "left" };
  if (prescribed === "right") return { knee: rightKnee, lock: "right" };
  if (locked === "left") return { knee: leftKnee, lock: "left" };
  if (locked === "right") return { knee: rightKnee, lock: "right" };

  const map = new Map(landmarks.map((l) => [l.index, l]));
  const lv = map.get(L_KN)?.visibility ?? 0;
  const rv = map.get(R_KN)?.visibility ?? 0;

  if (Math.abs(leftKnee - rightKnee) >= 18) {
    const next: LockedKnee = leftKnee < rightKnee ? "left" : "right";
    return { knee: next === "left" ? leftKnee : rightKnee, lock: next };
  }

  if (lv > 0.35 && rv < 0.22) return { knee: leftKnee, lock: null };
  if (rv > 0.35 && lv < 0.22) return { knee: rightKnee, lock: null };
  return { knee: lv >= rv ? leftKnee : rightKnee, lock: null };
}
