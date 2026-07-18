/**
 * Offline knee-v1 pack harness — no camera.
 * Run: npx tsx scripts/pack-harness.ts
 */
import { PackSession } from "../src/pack/PackSession";
import { SquatMove } from "../src/pack/SquatMove";
import { HeelSlideMove } from "../src/pack/HeelSlideMove";
import { StepUpMove } from "../src/pack/StepUpMove";
import { SlrMove } from "../src/pack/SlrMove";
import { GluteBridgeMove } from "../src/pack/GluteBridgeMove";
import { PackSessionExport } from "../src/export/PackSessionExport";
import { KNEE_V1_PACK_ID } from "../src/pack/kneeV1";
import type { BiomechanicalSample } from "../src/biomechanics/BiomechanicalEvaluator";
import type { JointLandmark } from "../src/perception/PerceptionEngine";
import type { OrientationPolicy } from "../src/perception/PerceptionEngine";

function lm(index: number, x: number, y: number, vis = 0.9): JointLandmark {
  return { index, x, y, z: 0, visibility: vis, worldX: x, worldY: y, worldZ: 0 };
}

function standingLandmarks(): JointLandmark[] {
  return [
    lm(11, 0.4, 0.3),
    lm(12, 0.6, 0.3),
    lm(23, 0.42, 0.55),
    lm(24, 0.58, 0.55),
    lm(25, 0.4, 0.7),
    lm(26, 0.6, 0.7),
    lm(27, 0.41, 0.9),
    lm(28, 0.59, 0.9),
  ];
}

function supineLandmarks(hipY = 0.5): JointLandmark[] {
  return [
    lm(23, 0.25, hipY),
    lm(24, 0.28, hipY + 0.01),
    lm(25, 0.45, 0.5),
    lm(26, 0.48, 0.52),
    lm(27, 0.7, 0.5),
    lm(28, 0.72, 0.52),
  ];
}

function sample(
  knee: number,
  omega: number,
  t: number,
  hip = 165,
): BiomechanicalSample {
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
      leftKnee: omega,
      rightKnee: omega,
    },
    torsoLength: 0.5,
    anchorDriftRatio: 0,
    anchorCompensation: false,
  };
}

function goodSquatFrames(): { k: number; w: number }[] {
  const quiet = Array.from({ length: 12 }, () => ({ k: 168, w: 0 }));
  return [
    ...quiet,
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
}

function heelSlideCycle(): number[] {
  return [165, 164, 162, 150, 135, 120, 110, 120, 135, 150, 158, 162, 164];
}

function stepUpCycle(): number[] {
  return [165, 164, 150, 135, 120, 110, 125, 140, 155, 162, 165];
}

function slrCycle(): { hip: number; knee: number }[] {
  return [
    { hip: 165, knee: 168 },
    { hip: 160, knee: 168 },
    { hip: 145, knee: 168 },
    { hip: 135, knee: 168 },
    { hip: 125, knee: 168 },
    { hip: 135, knee: 168 },
    { hip: 150, knee: 168 },
    { hip: 160, knee: 168 },
    { hip: 165, knee: 168 },
  ];
}

/** 2 sets × 2 reps — matches production dosing.sets=2 with harness-scaled reps. */
function harnessMoves() {
  return [
    new SquatMove({ targetReps: 2 }),
    new HeelSlideMove({ targetReps: 2, maxKneeFlexionDeg: 90 }),
    new StepUpMove({ targetReps: 2 }),
    new SlrMove({ targetReps: 2 }),
    new GluteBridgeMove({ targetReps: 2, holdSec: 0.3 }),
  ];
}

function landmarksFor(camera: string, hipY = 0.5): JointLandmark[] {
  return camera === "supine_side" ? supineLandmarks(hipY) : standingLandmarks();
}

const fail: string[] = [];
const orientations: OrientationPolicy[] = [];
let formLatches = 0;

console.log("\n=== KNEE PACK HARNESS (offline, multi-set) ===\n");

const pack = new PackSession({
  packId: KNEE_V1_PACK_ID,
  moves: harnessMoves(),
  restSec: 0.15,
  onOrientation: (p) => {
    orientations.push(p);
    console.log(`  [orientation] ${p}`);
  },
});

let t = 1_000;

function drainRest(marks: JointLandmark[]): void {
  while (pack.getPhase() === "rest") {
    t += 50;
    pack.update(marks, sample(165, 0, t), t);
  }
}

function runMoveToComplete(label: string): void {
  const move = pack.getActive();
  if (!move) {
    fail.push(`${label}: no active move`);
    return;
  }
  console.log(`\n--- ${label}: ${move.title} (${move.mode}) sets=${move.dosing.sets} ---`);
  pack.beginSetup();
  pack.confirmSetup();

  let marks = landmarksFor(move.setup.camera);
  let framed = false;
  for (let i = 0; i < 5; i++) {
    t += 33;
    const u = pack.update(marks, sample(165, 0, t), t);
    if (u.framingOk && pack.getPhase() === "work") {
      framed = true;
      console.log(`  framing ok → work`);
      break;
    }
  }
  if (!framed) {
    fail.push(`${label}: never entered work`);
    return;
  }

  let guard = 0;
  while (
    pack.getActive()?.id === move.id &&
    !pack.isDone() &&
    pack.getPhase() !== "setup" &&
    guard < 800
  ) {
    drainRest(marks);
    if (pack.getActive()?.id !== move.id || pack.getPhase() === "setup") break;

    if (move.id === "squat") {
      for (const { k, w } of goodSquatFrames()) {
        t += 33;
        pack.update(marks, sample(k, w, t), t);
        guard++;
        drainRest(marks);
        if (pack.getActive()?.id !== "squat") break;
      }
    } else if (move.id === "heel_slide") {
      for (const knee of heelSlideCycle()) {
        t += 33;
        pack.update(marks, sample(knee, 0, t), t);
        guard++;
        drainRest(marks);
        if (pack.getActive()?.id !== "heel_slide") break;
      }
    } else if (move.id === "step_up") {
      for (const knee of stepUpCycle()) {
        t += 33;
        pack.update(marks, sample(knee, 0, t), t);
        guard++;
        drainRest(marks);
        if (pack.getActive()?.id !== "step_up") break;
      }
    } else if (move.id === "slr") {
      for (const { hip, knee } of slrCycle()) {
        t += 33;
        pack.update(marks, sample(knee, 0, t, hip), t);
        guard++;
        drainRest(marks);
        if (pack.getActive()?.id !== "slr") break;
      }
    } else if (move.id === "glute_bridge") {
      // Polarity A: smaller y = lift
      const seqDown: { y: number; dt: number }[] = [
        { y: 0.55, dt: 4 },
        { y: 0.5, dt: 2 },
        { y: 0.45, dt: 2 },
        { y: 0.4, dt: 12 },
        { y: 0.54, dt: 4 },
      ];
      for (const { y, dt } of seqDown) {
        for (let i = 0; i < dt; i++) {
          t += 33;
          marks = landmarksFor("supine_side", y);
          pack.update(marks, sample(140, 0, t, 140), t);
          guard++;
        }
        drainRest(marks);
        if (pack.getActive()?.id !== "glute_bridge") break;
      }
    }
  }

  console.log(`  done → phase=${pack.getPhase()} index=${pack.getIndex()}`);
}

{
  console.log("\n--- framing reject smoke ---");
  pack.beginSetup();
  pack.confirmSetup();
  t += 33;
  const bad = pack.update([lm(23, 0.4, 0.4)], sample(165, 0, t), t);
  if (bad.framingOk) fail.push("expected framing fail with incomplete landmarks");
  else console.log(`  reject: ${bad.phaseLabel}`);
  pack.beginSetup();
}

// Latch-only smoke: record two events, ensure not frame-inflated later
{
  pack.recordFormEvent("overFlexion");
  pack.recordFormEvent("incompleteFlex");
  formLatches = 2;
}

runMoveToComplete("1/5");
runMoveToComplete("2/5");
runMoveToComplete("3/5");
runMoveToComplete("4/5");
runMoveToComplete("5/5");

if (!pack.isDone()) fail.push(`pack not done at end (phase=${pack.getPhase()} index=${pack.getIndex()})`);

const rows = pack.getRows();
console.log("\n--- rows ---");
for (const r of rows) {
  console.log(
    `  ${r.title}: ${r.status} · ${r.repsCounted} reps · mode=${r.mode} · events=${r.formEvents.length}`,
  );
}

if (rows.length !== 5) fail.push(`expected 5 rows got ${rows.length}`);
if (!rows.every((r) => r.status === "complete")) {
  fail.push(`not all complete: ${rows.map((r) => `${r.id}=${r.status}`).join(", ")}`);
}
if (!rows.every((r) => r.mode === "form")) {
  fail.push(`expected all form`);
}
// 2 sets × 2 reps
for (const r of rows) {
  if (r.repsCounted < 4) {
    fail.push(`${r.id} expected ≥4 reps (2×2 sets) got ${r.repsCounted}`);
  }
}
if (!orientations.includes("upright_lock") || !orientations.includes("relaxed_floor")) {
  fail.push("orientation policy never switched upright↔floor");
}
if (formLatches !== 2) fail.push("latch smoke broken");

const payload = PackSessionExport.build({
  packId: pack.packId,
  startedAt: pack.getStartedAt(),
  exercises: rows,
});
const html = PackSessionExport.toHtml(payload);
if (!html.includes("Heel slides") || !html.includes("Squats") || !html.includes("Glute bridge")) {
  fail.push("export HTML missing exercise titles");
}

console.log("\n==== RESULT ====");
if (fail.length) {
  console.error("FAIL:");
  for (const f of fail) console.error(" -", f);
  process.exit(1);
}
console.log("PASS — form×5 multi-set offline");
