import { describe, expect, it } from "vitest";
import { pickWorkingKnee } from "./workingLimb";
import type { JointLandmark } from "../perception/PerceptionEngine";

function kn(
  index: number,
  x: number,
  y: number,
  vis = 0.9,
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

/** Both chains; knee positions optional for swap tests. */
function legs(lx: number, ly: number, rx: number, ry: number): JointLandmark[] {
  return [
    kn(23, lx - 0.05, ly - 0.1),
    kn(24, rx - 0.05, ry - 0.1),
    kn(25, lx, ly),
    kn(26, rx, ry),
    kn(27, lx + 0.05, ly + 0.1),
    kn(28, rx + 0.05, ry + 0.1),
  ];
}

describe("pickWorkingKnee spatial continuity", () => {
  it("stays on the same physical knee when MP L/R labels swap", () => {
    // Frame 1: left landmark at (0.3,0.5), right at (0.7,0.5); left more flexed
    const a = pickWorkingKnee(
      legs(0.3, 0.5, 0.7, 0.5),
      120,
      165,
      undefined,
      null,
      null,
      140,
      165,
    );
    expect(a.lock).toBe("left");
    expect(a.knee).toBe(120);
    expect(a.pos).toEqual({ x: 0.3, y: 0.5 });

    // Frame 2: MP swapped — index 25 now at old right pos with straight angle,
    // index 26 at old left pos with flexed angle. Continuity must follow (0.3,0.5).
    const b = pickWorkingKnee(
      legs(0.7, 0.5, 0.3, 0.5),
      165,
      118,
      undefined,
      a.lock,
      a.pos,
      165,
      138,
    );
    expect(b.lock).toBe("right");
    expect(b.knee).toBe(118);
    expect(b.pos!.x).toBeCloseTo(0.3, 2);
    expect(b.hip).toBe(138);
  });

  it("hysteresis prefers locked side when distances are close", () => {
    const locked = pickWorkingKnee(
      legs(0.4, 0.5, 0.6, 0.5),
      130,
      160,
      undefined,
      null,
      { x: 0.4, y: 0.5 },
      150,
      165,
    );
    expect(locked.lock).toBe("left");

    // Both knees drift toward midline; left still slightly nearer after hysteresis
    const mid = pickWorkingKnee(
      legs(0.48, 0.5, 0.52, 0.5),
      135,
      155,
      undefined,
      "left",
      { x: 0.4, y: 0.5 },
      150,
      165,
    );
    expect(mid.lock).toBe("left");
  });

  it("honors prescribed side for initial lock", () => {
    const p = pickWorkingKnee(
      legs(0.3, 0.5, 0.7, 0.5),
      100,
      100,
      "right",
      null,
      null,
      160,
      160,
    );
    expect(p.lock).toBe("right");
    expect(p.knee).toBe(100);
    expect(p.pos).toEqual({ x: 0.7, y: 0.5 });
  });
});
