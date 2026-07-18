import { describe, expect, it } from "vitest";
import { BiomechanicalEvaluator } from "./BiomechanicalEvaluator";
import type { JointLandmark } from "../perception/PerceptionEngine";

function lm(
  index: number,
  vis: number,
  x = 0.5,
  y = 0.5,
): JointLandmark {
  return {
    index,
    x,
    y,
    z: 0,
    visibility: vis,
    worldX: x,
    worldY: y,
    worldZ: 0,
  };
}

/** Side-lying-ish: legs ok, far arm nearly invisible. */
function sideLyingLandmarks(): JointLandmark[] {
  return [
    lm(11, 0.7, 0.4, 0.35), // L sh
    lm(12, 0.15, 0.42, 0.36), // R sh — occluded
    lm(13, 0.6, 0.35, 0.4),
    lm(14, 0.1, 0.38, 0.42), // R el — occluded
    lm(15, 0.55, 0.3, 0.45),
    lm(16, 0.08, 0.32, 0.48), // R wr — occluded
    lm(23, 0.8, 0.45, 0.5),
    lm(24, 0.75, 0.48, 0.52),
    lm(25, 0.85, 0.55, 0.55),
    lm(26, 0.7, 0.58, 0.58),
    lm(27, 0.9, 0.7, 0.6),
    lm(28, 0.65, 0.72, 0.62),
  ];
}

describe("BiomechanicalEvaluator floor/side path", () => {
  it("still yields a sample when arms are occluded (heel-slide side view)", () => {
    const e = new BiomechanicalEvaluator();
    const s = e.evaluate(sideLyingLandmarks(), 1000);
    expect(s).not.toBeNull();
    expect(s!.angles.leftKnee).toBeGreaterThan(0);
    expect(s!.angles.rightKnee).toBeGreaterThan(0);
  });

  it("yields a sample when only one leg chain is visible", () => {
    const e = new BiomechanicalEvaluator();
    // Far (right) chain occluded
    const marks = sideLyingLandmarks().map((m) => {
      if ([12, 14, 16, 24, 26, 28].includes(m.index)) {
        return { ...m, visibility: 0.05 };
      }
      return m;
    });
    const s = e.evaluate(marks, 1000);
    expect(s).not.toBeNull();
    expect(s!.angles.leftKnee).toBeGreaterThan(0);
  });

  it("returns null when a knee chain is missing", () => {
    const e = new BiomechanicalEvaluator();
    const marks = sideLyingLandmarks().map((m) =>
      [25, 26].includes(m.index) ? { ...m, visibility: 0.05 } : m,
    );
    expect(e.evaluate(marks, 1000)).toBeNull();
  });
});
