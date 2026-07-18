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
  it("flags bent knee during lift", () => {
    const onFlag = vi.fn();
    const move = new SlrMove({ targetReps: 5, onFlag });
    let t = 1000;
    move.update([], sample(168, t, 165), t);
    t += 33;
    move.update([], sample(168, t, 140), t); // enter up
    t += 33;
    const r = move.update([], sample(130, t, 130), t); // bent
    expect(r.flags).toContain("bentKnee");
    expect(onFlag).toHaveBeenCalledWith("bentKnee", expect.stringContaining("straight"));
  });
});

describe("GluteBridgeMove", () => {
  it("counts lift → hold → lower", () => {
    const onRep = vi.fn();
    const move = new GluteBridgeMove({ targetReps: 2, holdSec: 0.3, onRep });
    let t = 1000;
    const hips = (y: number) => [
      lm(23, 0.25, y),
      lm(24, 0.28, y + 0.005),
      lm(25, 0.45, 0.5),
      lm(26, 0.48, 0.52),
      lm(27, 0.7, 0.5),
      lm(28, 0.72, 0.52),
    ];
    for (let i = 0; i < 4; i++) {
      move.update(hips(0.55), sample(140, t, 140), t);
      t += 33;
    }
    for (const y of [0.5, 0.46, 0.42, 0.4]) {
      move.update(hips(y), sample(140, t, 140), t);
      t += 33;
    }
    for (let i = 0; i < 15; i++) {
      move.update(hips(0.4), sample(140, t, 140), t);
      t += 33;
    }
    move.update(hips(0.54), sample(140, t, 140), t);
    expect(onRep).toHaveBeenCalledWith(1);
  });

  it("counts when lift increases image Y (flipped polarity)", () => {
    const onRep = vi.fn();
    const move = new GluteBridgeMove({ targetReps: 2, holdSec: 0.3, onRep });
    let t = 1000;
    const hips = (y: number) => [
      lm(23, 0.25, y),
      lm(24, 0.28, y + 0.005),
      lm(25, 0.45, 0.5),
      lm(26, 0.48, 0.52),
      lm(27, 0.7, 0.5),
      lm(28, 0.72, 0.52),
    ];
    for (let i = 0; i < 4; i++) {
      move.update(hips(0.4), sample(140, t, 140), t);
      t += 33;
    }
    for (const y of [0.45, 0.5, 0.55, 0.58]) {
      move.update(hips(y), sample(140, t, 140), t);
      t += 33;
    }
    for (let i = 0; i < 15; i++) {
      move.update(hips(0.58), sample(140, t, 140), t);
      t += 33;
    }
    move.update(hips(0.42), sample(140, t, 140), t);
    expect(onRep).toHaveBeenCalledWith(1);
  });
});
