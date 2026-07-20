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

/** Right-leg SLR pose — ankleY↓ = lift (image y grows downward). */
function slrPose(ankleY: number): JointLandmark[] {
  return [
    lm(23, 0.35, 0.5),
    lm(24, 0.5, 0.5),
    lm(25, 0.45, 0.62),
    lm(26, 0.62, 0.62),
    lm(27, 0.55, 0.78),
    lm(28, 0.72, ankleY),
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
  function calibrate(move: SlrMove, t0: number): number {
    let t = t0;
    for (let i = 0; i < 12; i++) {
      move.update(slrPose(0.78), sample(168, t, 165), t);
      t += 33;
    }
    return t;
  }

  it("flags bent knee during lift after sustained clear bend", () => {
    const onFlag = vi.fn();
    const move = new SlrMove({ targetReps: 5, side: "right", onFlag });
    let t = calibrate(move, 1000);
    move.update(slrPose(0.5), sample(168, t, 140), t); // enter up
    t += 33;
    let r = move.update(slrPose(0.48), sample(130, t, 130), t);
    expect(r.flags).not.toContain("bentKnee");
    for (let i = 0; i < 9; i++) {
      t += 33;
      r = move.update(slrPose(0.48), sample(110, t, 125), t);
    }
    expect(r.flags).toContain("bentKnee");
    expect(onFlag).toHaveBeenCalledWith("bentKnee", expect.stringContaining("straight"));
  });

  it("still counts when knee is mildly noisy (~160°)", () => {
    const onRep = vi.fn();
    const onFlag = vi.fn();
    const move = new SlrMove({ targetReps: 5, side: "right", onRep, onFlag });
    let t = calibrate(move, 1000);
    for (const y of [0.65, 0.55, 0.48, 0.45]) {
      move.update(slrPose(y), sample(160, t, 140), t);
      t += 100;
    }
    t += 400;
    move.update(slrPose(0.78), sample(160, t, 160), t);
    expect(onRep).toHaveBeenCalledWith(1);
  });

  it("counts a bent lift but cues to keep straighter", () => {
    const onRep = vi.fn();
    const onFlag = vi.fn();
    const move = new SlrMove({ targetReps: 5, side: "right", onRep, onFlag });
    let t = calibrate(move, 1000);
    move.update(slrPose(0.5), sample(168, t, 140), t);
    t += 33;
    for (let i = 0; i < 10; i++) {
      move.update(slrPose(0.45), sample(110, t, 120), t);
      t += 80;
    }
    t += 400;
    move.update(slrPose(0.78), sample(160, t, 160), t);
    expect(onRep).toHaveBeenCalledWith(1);
    expect(onFlag).toHaveBeenCalledWith(
      "bentKnee",
      expect.stringContaining("straighter"),
    );
  });

  it("counts a clean lift / lower via ankle elevation", () => {
    const onRep = vi.fn();
    const move = new SlrMove({ targetReps: 5, side: "right", onRep });
    let t = calibrate(move, 1000);
    for (const y of [0.7, 0.6, 0.5, 0.42]) {
      move.update(slrPose(y), sample(168, t, 140), t);
      t += 100;
    }
    move.update(slrPose(0.42), sample(168, t, 130), t);
    expect(onRep).not.toHaveBeenCalled();
    t += 400;
    move.update(slrPose(0.78), sample(168, t, 160), t);
    expect(onRep).toHaveBeenCalledWith(1);
  });

  it("debounces double-count from rapid elevation flicker", () => {
    const onRep = vi.fn();
    const move = new SlrMove({ targetReps: 10, side: "right", onRep });
    let t = calibrate(move, 1000);
    move.update(slrPose(0.45), sample(168, t), t);
    t += 400;
    move.update(slrPose(0.78), sample(168, t), t); // count 1
    t += 50;
    move.update(slrPose(0.45), sample(168, t), t);
    t += 400;
    move.update(slrPose(0.78), sample(168, t), t); // too soon
    expect(onRep).toHaveBeenCalledTimes(1);
  });

  it("does not count from resting ankle jitter alone", () => {
    const onRep = vi.fn();
    const move = new SlrMove({ targetReps: 10, side: "right", onRep });
    let t = calibrate(move, 1000);
    for (let i = 0; i < 30; i++) {
      move.update(slrPose(0.78 + (i % 3) * 0.005), sample(168, t, 162), t);
      t += 33;
    }
    expect(onRep).not.toHaveBeenCalled();
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
