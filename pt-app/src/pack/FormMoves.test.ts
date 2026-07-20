import { describe, expect, it, vi } from "vitest";
import { StepUpMove } from "./StepUpMove";
import { SlrMove } from "./SlrMove";
import { GluteBridgeMove } from "./GluteBridgeMove";
import type { BiomechanicalSample } from "../biomechanics/BiomechanicalEvaluator";
import type { JointLandmark } from "../perception/PerceptionEngine";

function sample(knee: number, t = 1000, hip = 165): BiomechanicalSample {
  return {
    timestampMs: t,
    angles: {
      leftElbow: 160,
      rightElbow: 160,
      leftShoulder: 40,
      rightShoulder: 40,
      leftHip: hip,
      rightHip: hip,
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

function lm(index: number, x: number, y: number): JointLandmark {
  return { index, x, y, z: 0, visibility: 0.9, worldX: x, worldY: y, worldZ: 0 };
}

function legs(): JointLandmark[] {
  return [
    lm(23, 0.4, 0.4),
    lm(24, 0.45, 0.42),
    lm(25, 0.5, 0.55),
    lm(26, 0.55, 0.57),
    lm(27, 0.6, 0.7),
    lm(28, 0.65, 0.72),
  ];
}

describe("StepUpMove", () => {
  it("counts a flex → rise cycle", () => {
    const onRep = vi.fn();
    const move = new StepUpMove({ targetReps: 2, onRep });
    let t = 1000;
    for (const k of [165, 164, 150, 130, 115, 130, 150, 162, 165]) {
      move.update([], sample(k, t), t);
      t += 33;
    }
    expect(onRep).toHaveBeenCalledWith(1);
  });
});

describe("SlrMove", () => {
  it("flags bent knee during lift after sustained bend", () => {
    const onFlag = vi.fn();
    const move = new SlrMove({ targetReps: 5, onFlag });
    let t = 1000;
    move.update(legs(), sample(168, t, 165), t);
    t += 33;
    move.update(legs(), sample(168, t, 140), t); // enter up
    t += 33;
    let r = move.update(legs(), sample(130, t, 130), t);
    expect(r.flags).not.toContain("bentKnee"); // streak not yet
    for (let i = 0; i < 4; i++) {
      t += 33;
      r = move.update(legs(), sample(130, t, 125), t);
    }
    expect(r.flags).toContain("bentKnee");
    expect(onFlag).toHaveBeenCalledWith("bentKnee", expect.stringContaining("straight"));
  });

  it("does not count a lift that bent the knee", () => {
    const onRep = vi.fn();
    const onFlag = vi.fn();
    const move = new SlrMove({ targetReps: 5, onRep, onFlag });
    let t = 1000;
    move.update(legs(), sample(168, t, 165), t);
    t += 33;
    move.update(legs(), sample(168, t, 140), t);
    t += 33;
    for (let i = 0; i < 5; i++) {
      move.update(legs(), sample(130, t, 120), t); // bent mid-lift
      t += 100;
    }
    t += 500; // past MIN_UP_MS
    move.update(legs(), sample(160, t, 160), t); // lower
    expect(onRep).not.toHaveBeenCalled();
    expect(onFlag).toHaveBeenCalledWith(
      "bentKnee",
      expect.stringContaining("didn’t count"),
    );
  });

  it("counts a clean lift / lower", () => {
    const onRep = vi.fn();
    const move = new SlrMove({ targetReps: 5, onRep });
    let t = 1000;
    for (const hip of [165, 164, 163, 162]) {
      move.update(legs(), sample(168, t, hip), t);
      t += 33;
    }
    for (const hip of [148, 140, 132, 128]) {
      move.update(legs(), sample(168, t, hip), t);
      t += 100;
    }
    // Still up — too soon to complete
    move.update(legs(), sample(168, t, 158), t);
    expect(onRep).not.toHaveBeenCalled();
    t += 500;
    move.update(legs(), sample(168, t, 158), t);
    expect(onRep).toHaveBeenCalledWith(1);
  });

  it("does not instant-count from ankle noise (hip must leave + hold)", () => {
    const onRep = vi.fn();
    const move = new SlrMove({ targetReps: 10, onRep });
    let t = 1000;
    // Flat on floor — hip stable; landmarks with jittery ankle Y must not fire
    for (let i = 0; i < 30; i++) {
      const marks = legs().map((l) =>
        l.index === 28 ? { ...l, y: 0.72 + (i % 3) * 0.02 } : l,
      );
      move.update(marks, sample(168, t, 162), t);
      t += 33;
    }
    expect(onRep).not.toHaveBeenCalled();
    expect(move.update(legs(), sample(168, t, 162), t).reps).toBe(0);
  });
});

describe("GluteBridgeMove", () => {
  it("counts lift → hold → lower via hip extension", () => {
    const onRep = vi.fn();
    const move = new GluteBridgeMove({ targetReps: 2, holdSec: 0.3, onRep });
    let t = 1000;
    // Rest baseline ~100°, then extend toward 130°+, hold, return
    for (let i = 0; i < 4; i++) {
      move.update(legs(), sample(140, t, 100), t);
      t += 33;
    }
    for (const hip of [108, 115, 122, 128]) {
      move.update(legs(), sample(140, t, hip), t);
      t += 33;
    }
    for (let i = 0; i < 15; i++) {
      move.update(legs(), sample(140, t, 130), t);
      t += 33;
    }
    move.update(legs(), sample(140, t, 102), t);
    expect(onRep).toHaveBeenCalledWith(1);
  });

  it("counts when lift decreases hip angle (flipped polarity)", () => {
    const onRep = vi.fn();
    const move = new GluteBridgeMove({ targetReps: 2, holdSec: 0.3, onRep });
    let t = 1000;
    for (let i = 0; i < 4; i++) {
      move.update(legs(), sample(140, t, 150), t);
      t += 33;
    }
    for (const hip of [142, 135, 128, 120]) {
      move.update(legs(), sample(140, t, hip), t);
      t += 33;
    }
    for (let i = 0; i < 15; i++) {
      move.update(legs(), sample(140, t, 118), t);
      t += 33;
    }
    move.update(legs(), sample(140, t, 148), t);
    expect(onRep).toHaveBeenCalledWith(1);
  });
});
