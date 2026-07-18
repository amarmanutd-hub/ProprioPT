/**
 * Framing gates — standing vs floor diagonal (working leg nearer camera).
 */

import type { JointLandmark } from "../perception/PerceptionEngine";

const L_HIP = 23;
const R_HIP = 24;
const L_KN = 25;
const R_KN = 26;
const L_ANK = 27;
const R_ANK = 28;

export interface FramingResult {
  ok: boolean;
  reason?: string;
}

function chainOk(
  map: Map<number, JointLandmark>,
  hip: number,
  kn: number,
  ank: number,
  minVis: number,
): boolean {
  for (const idx of [hip, kn, ank]) {
    const lm = map.get(idx);
    if (!lm || lm.visibility < minVis) return false;
  }
  return true;
}

/** ≥1 clear hip–knee–ankle chain + some length in frame (diagonal OK). */
export function checkFloorDiagonalFraming(
  landmarks: JointLandmark[],
  minVis = 0.35,
): FramingResult {
  const map = new Map(landmarks.map((l) => [l.index, l]));
  const leftOk = chainOk(map, L_HIP, L_KN, L_ANK, minVis);
  const rightOk = chainOk(map, R_HIP, R_KN, R_ANK, minVis);
  if (!leftOk && !rightOk) {
    return {
      ok: false,
      reason:
        "Diagonal view — hips to feet in frame, working leg nearer the camera.",
    };
  }

  const hip = leftOk ? map.get(L_HIP)! : map.get(R_HIP)!;
  const ank = leftOk ? map.get(L_ANK)! : map.get(R_ANK)!;
  const spanX = Math.abs(ank.x - hip.x);
  const spanY = Math.abs(ank.y - hip.y);
  if (spanX < 0.1 && spanY < 0.1) {
    return {
      ok: false,
      reason: "Move farther back so your whole leg is visible.",
    };
  }

  return { ok: true };
}

/** @deprecated alias — floor moves use diagonal now */
export const checkSupineSideFraming = checkFloorDiagonalFraming;

export function checkStandingFraming(
  landmarks: JointLandmark[],
  minVis = 0.4,
): FramingResult {
  const map = new Map(landmarks.map((l) => [l.index, l]));
  const leftOk = chainOk(map, L_HIP, L_KN, L_ANK, minVis);
  const rightOk = chainOk(map, R_HIP, R_KN, R_ANK, minVis);
  if (!leftOk || !rightOk) {
    return {
      ok: false,
      reason: "Stand so hips, knees, and ankles are in frame.",
    };
  }
  return { ok: true };
}
