import type { BiomechanicalSample } from "../biomechanics/BiomechanicalEvaluator";
import type { ClinicalLimits } from "../session/sessionBridge";

export type WorkingSide = ClinicalLimits["side"];

/** Mirror working-limb knee onto both sides so bilateral min/avg math tracks one leg. */
export function sampleForSide(
  sample: BiomechanicalSample,
  side: WorkingSide | undefined,
): BiomechanicalSample {
  if (!side || side === "bilateral") return sample;
  const knee =
    side === "left" ? sample.angles.leftKnee : sample.angles.rightKnee;
  const omega =
    side === "left"
      ? sample.angularVelocity.leftKnee
      : sample.angularVelocity.rightKnee;
  return {
    ...sample,
    angles: { ...sample.angles, leftKnee: knee, rightKnee: knee },
    angularVelocity: {
      ...sample.angularVelocity,
      leftKnee: omega,
      rightKnee: omega,
    },
  };
}
