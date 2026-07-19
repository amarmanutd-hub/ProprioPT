/**
 * Working-limb selection for floor / unilaterals.
 * Prefer prescribed clinical side; else lock via screen-space continuity
 * (MediaPipe L/R labels swap on overlap — follow xy, not index).
 * Heel may opt into velocity bias + freeze-lock-when-close; SLR leaves defaults off.
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
  /** True when L/R knees are spatially close (overlap risk). */
  kneesClose: boolean;
}

/** Opt-in; defaults keep SLR behavior unchanged. */
export interface PickWorkingKneeOpts {
  useVelocityBias?: boolean;
  /** Previous frame pos (with lastPos) for constant-velocity prediction. */
  prevPos?: KneePos | null;
  /** When knees close and locked, never switch side. */
  freezeLockWhenClose?: boolean;
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
/** Image-normalized knee–knee distance² (~0.045 apart). */
export const KNEE_CLOSE_DIST2 = 0.045 * 0.045;

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

export function kneeVisibilities(landmarks: JointLandmark[]): {
  left: number;
  right: number;
} {
  const map = new Map(landmarks.map((l) => [l.index, l]));
  return {
    left: map.get(L_KN)?.visibility ?? 0,
    right: map.get(R_KN)?.visibility ?? 0,
  };
}

export function kneesClose(landmarks: JointLandmark[]): boolean {
  const map = new Map(landmarks.map((l) => [l.index, l]));
  const l = map.get(L_KN);
  const r = map.get(R_KN);
  if (!l || !r) return false;
  if ((l.visibility ?? 0) < VIS_MIN || (r.visibility ?? 0) < VIS_MIN) {
    return false;
  }
  return dist2(l, r) <= KNEE_CLOSE_DIST2;
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
  close: boolean,
): WorkingLimbPick {
  const lm = kneeLm(map, side);
  return {
    knee: side === "left" ? leftKnee : rightKnee,
    hip: side === "left" ? leftHip : rightHip,
    lock: side,
    pos: lm ? { x: lm.x, y: lm.y } : null,
    kneesClose: close,
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
  opts: PickWorkingKneeOpts = {},
): WorkingLimbPick {
  const map = new Map(landmarks.map((l) => [l.index, l]));
  const lKn = map.get(L_KN);
  const rKn = map.get(R_KN);
  const close = kneesClose(landmarks);

  if (
    opts.freezeLockWhenClose &&
    close &&
    (locked === "left" || locked === "right")
  ) {
    return pickFromSide(
      locked,
      leftKnee,
      rightKnee,
      leftHip,
      rightHip,
      map,
      close,
    );
  }

  let refPos = lastPos;
  if (
    opts.useVelocityBias &&
    lastPos &&
    opts.prevPos &&
    Number.isFinite(opts.prevPos.x)
  ) {
    refPos = {
      x: lastPos.x + (lastPos.x - opts.prevPos.x),
      y: lastPos.y + (lastPos.y - opts.prevPos.y),
    };
  }

  if (refPos) {
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
        d: dist2(refPos, lKn),
        knee: leftKnee,
        hip: leftHip,
        pos: { x: lKn.x, y: lKn.y },
      });
    }
    if (rKn && (rKn.visibility ?? 0) >= VIS_MIN) {
      cands.push({
        side: "right",
        d: dist2(refPos, rKn),
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
        kneesClose: close,
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
      close,
    );
  }

  if (locked === "left" || locked === "right") {
    return pickFromSide(
      locked,
      leftKnee,
      rightKnee,
      leftHip,
      rightHip,
      map,
      close,
    );
  }

  const lv = lKn?.visibility ?? 0;
  const rv = rKn?.visibility ?? 0;

  if (Math.abs(leftKnee - rightKnee) >= FLEX_LOCK_DELTA) {
    const next: LockedKnee = leftKnee < rightKnee ? "left" : "right";
    return pickFromSide(
      next,
      leftKnee,
      rightKnee,
      leftHip,
      rightHip,
      map,
      close,
    );
  }

  if (lv > 0.35 && rv < 0.22) {
    return pickFromSide(
      "left",
      leftKnee,
      rightKnee,
      leftHip,
      rightHip,
      map,
      close,
    );
  }
  if (rv > 0.35 && lv < 0.22) {
    return pickFromSide(
      "right",
      leftKnee,
      rightKnee,
      leftHip,
      rightHip,
      map,
      close,
    );
  }

  const softLeft = leftKnee <= rightKnee;
  return {
    knee: softLeft ? leftKnee : rightKnee,
    hip: softLeft ? leftHip : rightHip,
    lock: null,
    pos: null,
    kneesClose: close,
  };
}
