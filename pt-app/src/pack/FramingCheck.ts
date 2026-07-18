/**
 * Side-view / supine framing gate — visibility of hip–knee–ankle before floor work.
 */

import type { JointLandmark } from "../perception/PerceptionEngine";

const L_HIP = 23;
const R_HIP = 24;
const L_KN = 25;
const R_KN = 26;
const L_ANK = 27;
const R_ANK = 28;

const NEED = [L_HIP, R_HIP, L_KN, R_KN, L_ANK, R_ANK] as const;

export interface FramingResult {
  ok: boolean;
  reason?: string;
}

export function checkSupineSideFraming(
  landmarks: JointLandmark[],
  minVis = 0.4,
): FramingResult {
  const map = new Map(landmarks.map((l) => [l.index, l]));
  for (const idx of NEED) {
    const lm = map.get(idx);
    if (!lm || lm.visibility < minVis) {
      return {
        ok: false,
        reason: "Lie on your side so hips, knees, and ankles are in frame.",
      };
    }
  }

  const hips = [map.get(L_HIP)!, map.get(R_HIP)!];
  const anks = [map.get(L_ANK)!, map.get(R_ANK)!];
  const hipY = (hips[0].y + hips[1].y) / 2;
  const ankY = (anks[0].y + anks[1].y) / 2;
  // Side view on floor: legs often extend across X more than Y span.
  const hipX = (hips[0].x + hips[1].x) / 2;
  const ankX = (anks[0].x + anks[1].x) / 2;
  const spanX = Math.abs(ankX - hipX);
  const spanY = Math.abs(ankY - hipY);
  if (spanX < 0.12 && spanY < 0.12) {
    return {
      ok: false,
      reason: "Move farther back so your whole leg is visible.",
    };
  }

  return { ok: true };
}

export function checkStandingFraming(
  landmarks: JointLandmark[],
  minVis = 0.4,
): FramingResult {
  const map = new Map(landmarks.map((l) => [l.index, l]));
  for (const idx of NEED) {
    const lm = map.get(idx);
    if (!lm || lm.visibility < minVis) {
      return {
        ok: false,
        reason: "Stand so hips, knees, and ankles are in frame.",
      };
    }
  }
  return { ok: true };
}
