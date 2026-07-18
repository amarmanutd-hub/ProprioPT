/**
 * Offline squat FSM harness — run: npx tsx scripts/squat-harness.ts
 */
import { SquatEvaluator } from "../src/squat/SquatEvaluator";
import type { BiomechanicalSample } from "../src/biomechanics/BiomechanicalEvaluator";
import type { JointLandmark } from "../src/perception/PerceptionEngine";

function lm(index: number, x: number, y: number, vis = 0.9): JointLandmark {
  return { index, x, y, z: 0, visibility: vis, worldX: x, worldY: y, worldZ: 0 };
}

function landmarks(opts: { kneeW?: number; ankleW?: number; lean?: number } = {}) {
  const kneeW = opts.kneeW ?? 0.2;
  const ankleW = opts.ankleW ?? 0.18;
  const lean = opts.lean ?? 0;
  return [
    lm(11, 0.4 + lean, 0.3),
    lm(12, 0.6 + lean, 0.3),
    lm(13, 0.35, 0.4),
    lm(14, 0.65, 0.4),
    lm(15, 0.3, 0.5),
    lm(16, 0.7, 0.5),
    lm(23, 0.42, 0.55),
    lm(24, 0.58, 0.55),
    lm(25, 0.5 - kneeW / 2, 0.7),
    lm(26, 0.5 + kneeW / 2, 0.7),
    lm(27, 0.5 - ankleW / 2, 0.9),
    lm(28, 0.5 + ankleW / 2, 0.9),
  ];
}

function sample(knee: number, omega: number, t: number): BiomechanicalSample {
  const angles = {
    leftElbow: 160,
    rightElbow: 160,
    leftShoulder: 40,
    rightShoulder: 40,
    leftHip: 170,
    rightHip: 170,
    leftKnee: knee,
    rightKnee: knee,
  };
  const angularVelocity = {
    leftElbow: 0,
    rightElbow: 0,
    leftShoulder: 0,
    rightShoulder: 0,
    leftHip: 0,
    rightHip: 0,
    leftKnee: omega,
    rightKnee: omega,
  };
  return {
    timestampMs: t,
    angles,
    angularVelocity,
    torsoLength: 0.5,
    anchorDriftRatio: 0,
    anchorCompensation: false,
  };
}

type Frame = { k: number; w: number };

function runRep(label: string, frames: Frame[], lmOpts = {}) {
  const s = new SquatEvaluator();
  const voided: string[] = [];
  const squat = new SquatEvaluator({
    onCompensation: (e) => voided.push(e.detail),
  });
  void s;
  let t = 1000;
  let last = "";
  for (const { k, w } of frames) {
    const r = squat.update(sample(k, w, t), landmarks(lmOpts));
    const line = `${r.stateLabel} reps=${r.reps}`;
    if (line !== last) {
      console.log(`  t=${t} knee=${k} ω=${w} → ${line} flags=[${r.activeFlags}]`);
      last = line;
    }
    t += 33;
  }
  console.log(`=== ${label}: FINAL reps=${squat.getReps()} voids=${voided.length}`);
  if (voided.length) console.log("  voids:", voided.join(" | "));
  return { reps: squat.getReps(), voids: voided };
}

const quietStand: Frame[] = Array.from({ length: 15 }, () => ({ k: 168, w: 0 }));
const goodPath: Frame[] = [
  ...quietStand,
  { k: 160, w: -30 },
  { k: 150, w: -80 },
  { k: 140, w: -90 },
  { k: 130, w: -70 },
  { k: 120, w: -50 },
  { k: 110, w: -40 },
  { k: 100, w: -20 },
  { k: 95, w: -5 },
  { k: 98, w: 20 },
  { k: 110, w: 60 },
  { k: 125, w: 70 },
  { k: 140, w: 50 },
  { k: 155, w: 30 },
  { k: 162, w: 10 },
  { k: 166, w: 0 },
  { k: 168, w: 0 },
];

const incompletePath: Frame[] = [
  ...quietStand,
  { k: 160, w: -40 },
  { k: 150, w: -60 },
  { k: 145, w: -20 },
  { k: 148, w: 50 },
  { k: 150, w: 50 },
  { k: 152, w: 50 },
  { k: 155, w: 50 },
  { k: 158, w: 50 },
  { k: 160, w: 40 },
  { k: 162, w: 20 },
  { k: 166, w: 0 },
];

console.log("\n--- GOOD ---");
const good = runRep("GOOD", goodPath);
console.log("\n--- INCOMPLETE ---");
const incomplete = runRep("INCOMPLETE", incompletePath);
console.log("\n--- VALGUS ---");
const valgus = runRep("VALGUS", goodPath, { kneeW: 0.08, ankleW: 0.2 });
console.log("\n--- DOUBLE GOOD ---");
const double = runRep("DOUBLE", [...goodPath, ...goodPath.slice(10)]);

const fail: string[] = [];
if (good.reps !== 1) fail.push(`good expected 1 got ${good.reps}`);
if (incomplete.reps !== 0) fail.push(`incomplete expected 0 got ${incomplete.reps}`);
if (incomplete.voids.length < 1)
  fail.push(`incomplete expected a void event, got ${incomplete.voids.length}`);
if (valgus.reps !== 0) fail.push(`valgus expected 0 got ${valgus.reps}`);
if (double.reps !== 2) fail.push(`double expected 2 got ${double.reps}`);

// Asymmetric knees: depth via more-flexed side only
console.log("\n--- ASYM DEPTH ---");
const asymFrames: Frame[] = [
  ...quietStand,
  { k: 155, w: -40 },
  { k: 145, w: -60 },
  { k: 135, w: -50 },
  { k: 125, w: -40 },
  { k: 118, w: -20 },
  { k: 115, w: 10 },
  { k: 125, w: 50 },
  { k: 140, w: 60 },
  { k: 155, w: 40 },
  { k: 165, w: 10 },
];
// Custom: left deeper than right — use evaluator directly below
{
  const squat = new SquatEvaluator();
  let t = 0;
  const L = [168, 168, 168, 160, 145, 130, 115, 100, 105, 120, 140, 155, 165];
  const R = [168, 168, 168, 162, 155, 148, 140, 135, 138, 145, 155, 162, 168];
  const W = [0, 0, 0, -40, -70, -60, -40, -20, 30, 50, 40, 20, 0];
  for (let i = 0; i < L.length; i++) {
    t += 33;
    const angles = {
      leftElbow: 160, rightElbow: 160, leftShoulder: 40, rightShoulder: 40,
      leftHip: 170, rightHip: 170, leftKnee: L[i]!, rightKnee: R[i]!,
    };
    const angularVelocity = {
      leftElbow: 0, rightElbow: 0, leftShoulder: 0, rightShoulder: 0,
      leftHip: 0, rightHip: 0, leftKnee: W[i]!, rightKnee: W[i]!,
    };
    squat.update(
      {
        timestampMs: t,
        angles,
        angularVelocity,
        torsoLength: 0.5,
        anchorDriftRatio: 0,
        anchorCompensation: false,
      },
      landmarks(),
    );
  }
  console.log(`=== ASYM: FINAL reps=${squat.getReps()}`);
  if (squat.getReps() !== 1) fail.push(`asym expected 1 got ${squat.getReps()}`);
}

console.log("\n==== RESULT ====");
if (fail.length) {
  console.error("FAIL:", fail.join("; "));
  process.exit(1);
}
console.log("PASS");
