import { describe, expect, it } from "vitest";
import {
  BONE_BAND,
  BONE_FREEZE_SAMPLES,
  BONE_SCALE_INVALIDATE,
  LegBonesTracker,
} from "./legBones";

function pt(x: number, y: number, visibility = 0.9) {
  return { x, y, visibility };
}

/** Clear leg: hip (0,0), knee (0,1), ankle (0,2) — thigh=shin=1 at hipWidth=1. */
function clearLeg(scale = 1) {
  return {
    hip: pt(0, 0),
    knee: pt(0, 1 * scale),
    ankle: pt(0, 2 * scale),
  };
}

function train(tracker: LegBonesTracker, hipWidth = 1, n = BONE_FREEZE_SAMPLES) {
  const leg = clearLeg();
  for (let i = 0; i < n; i++) {
    tracker.observe("left", leg.hip, leg.knee, leg.ankle, {
      hipWidth,
      kneesClose: false,
      flipStreakActive: false,
    });
  }
}

describe("LegBonesTracker", () => {
  it("skips learn when kneesClose", () => {
    const t = new LegBonesTracker();
    const leg = clearLeg();
    for (let i = 0; i < BONE_FREEZE_SAMPLES; i++) {
      t.observe("left", leg.hip, leg.knee, leg.ankle, {
        hipWidth: 1,
        kneesClose: true,
        flipStreakActive: false,
      });
    }
    expect(t.samples("left")).toBe(0);
    expect(t.isFrozen("left")).toBe(false);
  });

  it("skips learn when flipStreakActive", () => {
    const t = new LegBonesTracker();
    const leg = clearLeg();
    for (let i = 0; i < BONE_FREEZE_SAMPLES; i++) {
      t.observe("left", leg.hip, leg.knee, leg.ankle, {
        hipWidth: 1,
        kneesClose: false,
        flipStreakActive: true,
      });
    }
    expect(t.isFrozen("left")).toBe(false);
  });

  it("skips learn when visibility low", () => {
    const t = new LegBonesTracker();
    for (let i = 0; i < BONE_FREEZE_SAMPLES; i++) {
      t.observe(
        "left",
        pt(0, 0, 0.1),
        pt(0, 1, 0.9),
        pt(0, 2, 0.9),
        { hipWidth: 1, kneesClose: false, flipStreakActive: false },
      );
    }
    expect(t.isFrozen("left")).toBe(false);
  });

  it("freezes after N clear samples", () => {
    const t = new LegBonesTracker();
    train(t);
    expect(t.isFrozen("left")).toBe(true);
    expect(t.samples("left")).toBe(BONE_FREEZE_SAMPLES);
  });

  it("softPull is no-op until frozen", () => {
    const t = new LegBonesTracker();
    const knee = pt(0, 1);
    const ankle = pt(0, 3); // far
    const out = t.softPullAnkle("left", knee, ankle, 1);
    expect(out.x).toBe(ankle.x);
    expect(out.y).toBe(ankle.y);
  });

  it("softPull pulls ankle toward learned shin when outside band", () => {
    const t = new LegBonesTracker();
    train(t); // shin target length = 1 at hipWidth=1
    const knee = pt(0, 1);
    const ankle = pt(0, 1 + 1 * (1 + BONE_BAND * 3)); // well outside band
    const out = t.softPullAnkle("left", knee, ankle, 1);
    const before = Math.hypot(ankle.x - knee.x, ankle.y - knee.y);
    const after = Math.hypot(out.x - knee.x, out.y - knee.y);
    expect(after).toBeLessThan(before);
    // direction preserved (same axis)
    expect(out.x).toBeCloseTo(0, 5);
    expect(out.y).toBeGreaterThan(knee.y);
  });

  it("softPull leaves ankle alone inside band", () => {
    const t = new LegBonesTracker();
    train(t);
    const knee = pt(0, 1);
    const ankle = pt(0, 1 + 1.05); // ~5% off, inside 15% band
    const out = t.softPullAnkle("left", knee, ankle, 1);
    expect(out.y).toBe(ankle.y);
  });

  it("invalidates freeze when hipWidth jumps", () => {
    const t = new LegBonesTracker();
    train(t, 1);
    expect(t.isFrozen("left")).toBe(true);
    const leg = clearLeg(1 + BONE_SCALE_INVALIDATE * 2);
    // observe with much larger hipWidth → invalidate, not yet frozen again
    t.observe("left", leg.hip, leg.knee, leg.ankle, {
      hipWidth: 1 + BONE_SCALE_INVALIDATE * 2,
      kneesClose: false,
      flipStreakActive: false,
    });
    expect(t.isFrozen("left")).toBe(false);
    expect(t.samples("left")).toBe(1);
  });

  it("reset clears state", () => {
    const t = new LegBonesTracker();
    train(t);
    t.reset();
    expect(t.isFrozen("left")).toBe(false);
    expect(t.samples("left")).toBe(0);
  });
});
