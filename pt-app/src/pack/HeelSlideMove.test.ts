import { describe, expect, it, vi } from "vitest";
import { HeelSlideMove } from "./HeelSlideMove";
import { limitsFromCarePlan, DEFAULT_LIMITS } from "../session/sessionBridge";
import type { BiomechanicalSample } from "../biomechanics/BiomechanicalEvaluator";

function sample(knee: number, t = 1000): BiomechanicalSample {
  return {
    timestampMs: t,
    angles: {
      leftElbow: 160,
      rightElbow: 160,
      leftShoulder: 40,
      rightShoulder: 40,
      leftHip: 170,
      rightHip: 170,
      leftKnee: knee,
      rightKnee: knee,
    },
    angularVelocity: {
      leftElbow: 0,
      rightElbow: 0,
      leftShoulder: 0,
      rightShoulder: 0,
      leftHip: 0,
      rightHip: 0,
      leftKnee: 0,
      rightKnee: 0,
    },
    torsoLength: 0.5,
    anchorDriftRatio: 0,
    anchorCompensation: false,
  };
}

describe("limitsFromCarePlan", () => {
  it("uses defaults when care plan has no limits", () => {
    expect(limitsFromCarePlan(null)).toEqual(DEFAULT_LIMITS);
    expect(limitsFromCarePlan({})).toEqual(DEFAULT_LIMITS);
  });

  it("reads clinical limits from care plan", () => {
    const L = limitsFromCarePlan({
      limits: {
        side: "left",
        maxKneeFlexionDeg: 100,
        maxExtensionDeficitDeg: 5,
        painStopAt: 4,
      },
      exercises: [],
    });
    expect(L.maxKneeFlexionDeg).toBe(100);
    expect(L.painStopAt).toBe(4);
    expect(L.side).toBe("left");
  });
});

describe("HeelSlideMove", () => {
  it("flags overFlexion past PT limit", () => {
    const onFlag = vi.fn();
    const move = new HeelSlideMove({
      targetReps: 5,
      maxKneeFlexionDeg: 100,
      onFlag,
    });
    // extend → start flexing past 100°
    move.update([], sample(165), 1000);
    const r = move.update([], sample(95), 1033);
    expect(r.flags).toContain("overFlexion");
    expect(onFlag).toHaveBeenCalledWith(
      "overFlexion",
      expect.stringContaining("100"),
    );
  });

  it("counts a full slide-in / straighten cycle", () => {
    const onRep = vi.fn();
    const move = new HeelSlideMove({ targetReps: 2, onRep });
    let t = 1000;
    // warm baseline extended
    for (const k of [165, 164, 163, 162]) {
      move.update([], sample(k, t), t);
      t += 33;
    }
    // slide in
    for (const k of [150, 140, 130, 120]) {
      move.update([], sample(k, t), t);
      t += 33;
    }
    // straighten out
    for (const k of [130, 140, 150, 158, 162]) {
      move.update([], sample(k, t), t);
      t += 33;
    }
    expect(onRep).toHaveBeenCalledWith(1);
    expect(move.update([], sample(162, t), t).reps).toBe(1);
  });

  it("flags incompleteFlex on shallow slide (not incompleteReturn)", () => {
    const onFlag = vi.fn();
    const move = new HeelSlideMove({ targetReps: 5, onFlag });
    let t = 1000;
    for (const k of [165, 164, 163, 162]) {
      move.update([], sample(k, t), t);
      t += 33;
    }
    // ~14° flex then return (below 25° depth target)
    for (const k of [155, 150, 148, 155, 160, 163]) {
      move.update([], sample(k, t), t);
      t += 33;
    }
    expect(onFlag).toHaveBeenCalledWith(
      "incompleteFlex",
      expect.stringContaining("farther"),
    );
    expect(onFlag).not.toHaveBeenCalledWith(
      "incompleteReturn",
      expect.anything(),
    );
    expect(onFlag.mock.calls.filter((c) => c[0] === "incompleteFlex")).toHaveLength(
      1,
    );
  });

  it("locks onto the more flexed knee when L/R diverge (side view)", () => {
    const move = new HeelSlideMove({ targetReps: 2 });
    let t = 1000;
    // Warm with matched knees
    for (const k of [165, 164, 163]) {
      move.update([], sample(k, t), t);
      t += 33;
    }
    // Left stays extended, right slides — should track right only
    const asymmetric = (L: number, R: number): BiomechanicalSample => {
      const s = sample(L, t);
      s.angles.leftKnee = L;
      s.angles.rightKnee = R;
      return s;
    };
    for (const [L, R] of [
      [162, 150],
      [162, 140],
      [162, 125],
      [162, 120],
    ] as const) {
      move.update([], asymmetric(L, R), t);
      t += 33;
    }
    for (const [L, R] of [
      [162, 135],
      [162, 150],
      [162, 160],
    ] as const) {
      move.update([], asymmetric(L, R), t);
      t += 33;
    }
    expect(move.update([], asymmetric(162, 162), t).reps).toBe(1);
  });
});
