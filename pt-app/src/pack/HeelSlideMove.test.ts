import { describe, expect, it, vi } from "vitest";
import { HeelSlideMove } from "./HeelSlideMove";
import { limitsFromCarePlan, DEFAULT_LIMITS } from "../session/sessionBridge";
import type { BiomechanicalSample } from "../biomechanics/BiomechanicalEvaluator";
import type { JointLandmark } from "../perception/PerceptionEngine";

function lm(index: number, vis = 0.9): JointLandmark {
  return {
    index,
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: vis,
    worldX: 0.5,
    worldY: 0.5,
    worldZ: 0,
  };
}

/** Both lower chains visible — TrackConfidence ok. */
function visibleLegs(): JointLandmark[] {
  return [23, 24, 25, 26, 27, 28].map((i) => lm(i));
}

/** Spatially separated knees — needed for L/R lock tests. */
function separatedLegs(): JointLandmark[] {
  return [
    lmAt(23, 0.35, 0.4),
    lmAt(24, 0.55, 0.4),
    lmAt(25, 0.35, 0.55),
    lmAt(26, 0.55, 0.55),
    lmAt(27, 0.35, 0.7),
    lmAt(28, 0.55, 0.7),
  ];
}

function lmAt(index: number, x: number, y: number, vis = 0.9): JointLandmark {
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
    move.update(separatedLegs(), sample(165), 1000);
    const r = move.update(separatedLegs(), sample(95), 1033);
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
    for (const k of [165, 164, 163, 162]) {
      move.update(separatedLegs(), sample(k, t), t);
      t += 33;
    }
    for (const k of [150, 140, 130, 120]) {
      move.update(separatedLegs(), sample(k, t), t);
      t += 33;
    }
    for (const k of [130, 140, 150, 158, 162]) {
      move.update(separatedLegs(), sample(k, t), t);
      t += 33;
    }
    expect(onRep).toHaveBeenCalledWith(1);
    expect(move.update(separatedLegs(), sample(162, t), t).reps).toBe(1);
  });

  it("flags incompleteFlex on shallow slide (not incompleteReturn)", () => {
    const onFlag = vi.fn();
    const move = new HeelSlideMove({ targetReps: 5, onFlag });
    let t = 1000;
    for (const k of [165, 164, 163, 162]) {
      move.update(separatedLegs(), sample(k, t), t);
      t += 33;
    }
    for (const k of [155, 152, 150, 148, 149, 152, 155, 158, 160, 163]) {
      move.update(separatedLegs(), sample(k, t), t);
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
      move.update(separatedLegs(), asymmetric(L, R), t);
      t += 33;
    }
    for (const [L, R] of [
      [162, 135],
      [162, 150],
      [162, 160],
    ] as const) {
      move.update(separatedLegs(), asymmetric(L, R), t);
      t += 33;
    }
    expect(move.update(separatedLegs(), asymmetric(162, 162), t).reps).toBe(1);
  });

  it("freezes displayKneeDeg to null when knees overlap", () => {
    const move = new HeelSlideMove({ targetReps: 5 });
    let t = 1000;
    move.update(separatedLegs(), sample(160, t), t);
    t += 33;
    const overlap = [
      lmAt(23, 0.4, 0.4),
      lmAt(24, 0.42, 0.4),
      lmAt(25, 0.5, 0.55),
      lmAt(26, 0.51, 0.55),
      lmAt(27, 0.5, 0.7),
      lmAt(28, 0.51, 0.7),
    ];
    const r = move.update(overlap, sample(140, t), t);
    expect(r.displayKneeDeg).toBeNull();
    expect(r.track).toBe("weak");
  });

  it("uses more-flexed of image vs sample for display", () => {
    const move = new HeelSlideMove({ targetReps: 5, side: "right" });
    // Image: clearly bent (~90° interior). Sample claims nearly straight.
    const bentRight = [
      lmAt(23, 0.35, 0.4),
      lmAt(24, 0.55, 0.4),
      lmAt(25, 0.35, 0.55),
      lmAt(26, 0.7, 0.45), // knee forward
      lmAt(27, 0.35, 0.7),
      lmAt(28, 0.55, 0.7), // ankle back → bent
    ];
    const r = move.update(bentRight, sample(170, 1000), 1000);
    expect(r.displayKneeDeg).not.toBeNull();
    expect(r.displayKneeDeg!).toBeGreaterThan(40);
  });

  it("still counts when deep flex happens under knee overlap", () => {
    const onRep = vi.fn();
    const move = new HeelSlideMove({ targetReps: 2, onRep });
    let t = 1000;
    for (const k of [165, 164, 163, 162]) {
      move.update(separatedLegs(), sample(k, t), t);
      t += 33;
    }
    const overlap = [
      lmAt(23, 0.4, 0.4),
      lmAt(24, 0.42, 0.4),
      lmAt(25, 0.5, 0.55),
      lmAt(26, 0.51, 0.55),
      lmAt(27, 0.5, 0.7),
      lmAt(28, 0.51, 0.7),
    ];
    // Enter flex while overlapped (this used to stall the FSM).
    for (const k of [150, 140, 130, 120]) {
      move.update(overlap, sample(k, t), t);
      t += 33;
    }
    for (const k of [130, 140, 150, 158, 162]) {
      move.update(separatedLegs(), sample(k, t), t);
      t += 33;
    }
    expect(onRep).toHaveBeenCalledWith(1);
  });

  it("still counts when knees overlap mid-rep if lock is held", () => {
    const onRep = vi.fn();
    const move = new HeelSlideMove({ targetReps: 2, onRep });
    let t = 1000;
    for (const k of [165, 164, 163, 162]) {
      move.update(separatedLegs(), sample(k, t), t);
      t += 33;
    }
    for (const k of [150, 140, 130, 120]) {
      move.update(separatedLegs(), sample(k, t), t);
      t += 33;
    }
    const overlap = [
      lmAt(23, 0.4, 0.4),
      lmAt(24, 0.42, 0.4),
      lmAt(25, 0.5, 0.55),
      lmAt(26, 0.51, 0.55),
      lmAt(27, 0.5, 0.7),
      lmAt(28, 0.51, 0.7),
    ];
    const silenced = move.update(overlap, sample(120, t), t);
    expect(silenced.displayKneeDeg).toBeNull();
    t += 33;
    for (const k of [130, 140, 150, 158, 162]) {
      move.update(separatedLegs(), sample(k, t), t);
      t += 33;
    }
    expect(onRep).toHaveBeenCalledWith(1);
  });

  it("does not count a rep if track goes weak mid-rep", () => {
    const onRep = vi.fn();
    const move = new HeelSlideMove({ targetReps: 2, onRep, side: "right" });
    let t = 1000;
    for (const k of [165, 164, 163, 162]) {
      move.update(separatedLegs(), sample(k, t), t);
      t += 33;
    }
    for (const k of [150, 140, 130, 120]) {
      move.update(separatedLegs(), sample(k, t), t);
      t += 33;
    }
    // Prescribed right chain barely visible → weak → dirty
    const weak = [
      lmAt(23, 0.35, 0.4, 0.9),
      lmAt(24, 0.55, 0.4, 0.05),
      lmAt(25, 0.35, 0.55, 0.9),
      lmAt(26, 0.55, 0.55, 0.05),
      lmAt(27, 0.35, 0.7, 0.9),
      lmAt(28, 0.55, 0.7, 0.05),
    ];
    move.update(weak, sample(120, t), t);
    t += 33;
    for (const k of [130, 140, 150, 158, 162]) {
      move.update(separatedLegs(), sample(k, t), t);
      t += 33;
    }
    expect(onRep).not.toHaveBeenCalled();
  });
});
