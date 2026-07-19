/**
 * Working-limb selection for floor / unilaterals.
 * Prefer prescribed clinical side; else lock via screen-space continuity
 * (MediaPipe L/R labels swap on overlap — follow xy, not index).
 */

import type { JointLandmark } from "../perception/PerceptionEngine";
import type { ClinicalLimits } from "../session/sessionBridge";

export type WorkingSide = ClinicalLimits["side"];
export type LockedKnee = "left" | "right";

export interface KneePos {
  x: number;
  y: number;
}

export interface WorkingLimbPick {
  knee: number;
  hip: number;
  lock: LockedKnee | null;
  pos: KneePos | null;
}

const L_HIP = 23;
const R_HIP = 24;
const L_KN = 25;
const R_KN = 26;
const L_ANK = 27;
const R_ANK = 28;

/** Stick with locked side unless other knee is clearly closer. */
const HYSTERESIS = 1.35;
const VIS_MIN = 0.15;
const FLEX_LOCK_DELTA = 18;

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

function dist2(a: KneePos, b: KneePos): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function kneeLm(
  map: Map<number, JointLandmark>,
  side: LockedKnee,
): JointLandmark | undefined {
  return map.get(side === "left" ? L_KN : R_KN);
}

function pickFromSide(
  side: LockedKnee,
  leftKnee: number,
  rightKnee: number,
  leftHip: number,
  rightHip: number,
  map: Map<number, JointLandmark>,
): WorkingLimbPick {
  const lm = kneeLm(map, side);
  return {
    knee: side === "left" ? leftKnee : rightKnee,
    hip: side === "left" ? leftHip : rightHip,
    lock: side,
    pos: lm ? { x: lm.x, y: lm.y } : null,
  };
}

/**
 * Pick working knee/hip angles. When `lastPos` is set, follow the landmark
 * nearest that point so MP L/R swaps do not flip the physical leg.
 */
export function pickWorkingKnee(
  landmarks: JointLandmark[],
  leftKnee: number,
  rightKnee: number,
  prescribed: WorkingSide | undefined,
  locked: LockedKnee | null,
  lastPos: KneePos | null = null,
  leftHip = 170,
  rightHip = 170,
): WorkingLimbPick {
  const map = new Map(landmarks.map((l) => [l.index, l]));
  const lKn = map.get(L_KN);
  const rKn = map.get(R_KN);

  if (lastPos) {
    type Cand = {
      side: LockedKnee;
      d: number;
      knee: number;
      hip: number;
      pos: KneePos;
    };
    const cands: Cand[] = [];
    if (lKn && (lKn.visibility ?? 0) >= VIS_MIN) {
      cands.push({
        side: "left",
        d: dist2(lastPos, lKn),
        knee: leftKnee,
        hip: leftHip,
        pos: { x: lKn.x, y: lKn.y },
      });
    }
    if (rKn && (rKn.visibility ?? 0) >= VIS_MIN) {
      cands.push({
        side: "right",
        d: dist2(lastPos, rKn),
        knee: rightKnee,
        hip: rightHip,
        pos: { x: rKn.x, y: rKn.y },
      });
    }
    if (cands.length > 0) {
      cands.sort((a, b) => a.d - b.d);
      let best = cands[0]!;
      if (cands.length === 2 && locked && best.side !== locked) {
        const stick = cands.find((c) => c.side === locked);
        if (stick && stick.d < best.d * HYSTERESIS) best = stick;
      }
      return {
        knee: best.knee,
        hip: best.hip,
        lock: best.side,
        pos: best.pos,
      };
    }
  }

  if (prescribed === "left" || prescribed === "right") {
    return pickFromSide(
      prescribed,
      leftKnee,
      rightKnee,
      leftHip,
      rightHip,
      map,
    );
  }

  if (locked === "left" || locked === "right") {
    return pickFromSide(locked, leftKnee, rightKnee, leftHip, rightHip, map);
  }

  const lv = lKn?.visibility ?? 0;
  const rv = rKn?.visibility ?? 0;

  if (Math.abs(leftKnee - rightKnee) >= FLEX_LOCK_DELTA) {
    const next: LockedKnee = leftKnee < rightKnee ? "left" : "right";
    return pickFromSide(next, leftKnee, rightKnee, leftHip, rightHip, map);
  }

  if (lv > 0.35 && rv < 0.22) {
    return pickFromSide("left", leftKnee, rightKnee, leftHip, rightHip, map);
  }
  if (rv > 0.35 && lv < 0.22) {
    return pickFromSide("right", leftKnee, rightKnee, leftHip, rightHip, map);
  }

  // Ambiguous — use more flexed angle this frame but do not lock/pos yet
  // (avoids sticking to the wrong side before flex delta is clear).
  const softLeft = leftKnee <= rightKnee;
  return {
    knee: softLeft ? leftKnee : rightKnee,
    hip: softLeft ? leftHip : rightHip,
    lock: null,
    pos: null,
  };
}
