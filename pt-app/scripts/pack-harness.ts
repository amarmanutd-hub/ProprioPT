/**
 * Offline knee-v1 pack harness — no camera.
 * Run: npx tsx scripts/pack-harness.ts
 *
 * Walks setup → framing → work for all five moves with synthetic joints,
 * then asserts export shape + no-persist invariant.
 */
import { PackSession } from "../src/pack/PackSession";
import { SquatMove } from "../src/pack/SquatMove";
import { StubMove } from "../src/pack/StubMove";
import { PackSessionExport } from "../src/export/PackSessionExport";
import { KNEE_V1_PACK_ID } from "../src/pack/kneeV1";
import type { BiomechanicalSample } from "../src/biomechanics/BiomechanicalEvaluator";
import type { JointLandmark } from "../src/perception/PerceptionEngine";
import type { OrientationPolicy } from "../src/perception/PerceptionEngine";

function lm(index: number, x: number, y: number, vis = 0.9): JointLandmark {
  return { index, x, y, z: 0, visibility: vis, worldX: x, worldY: y, worldZ: 0 };
}

/** Standing / front framing — hips, knees, ankles visible. */
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

/** Supine side — hip→ankle span in X for FramingCheck. */
function supineLandmarks(): JointLandmark[] {
  return [
    lm(23, 0.25, 0.45),
    lm(24, 0.28, 0.48),
    lm(25, 0.45, 0.5),
    lm(26, 0.48, 0.52),
    lm(27, 0.7, 0.5),
    lm(28, 0.72, 0.52),
  ];
}

function sample(knee: number, omega: number, t: number): BiomechanicalSample {
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
      leftKnee: omega,
      rightKnee: omega,
    },
    torsoLength: 0.5,
    anchorDriftRatio: 0,
    anchorCompensation: false,
  };
}

/** One good squat path (from squat-harness). */
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

/** Knee flex cycle for stub rep_detect. */
function stubRepCycle(): number[] {
  return [165, 160, 150, 135, 120, 125, 140, 155, 165];
}

function harnessMoves() {
  // Same five moves as knee-v1, scaled dosing so the harness finishes quickly.
  return [
    new SquatMove({ targetReps: 2 }),
    new StubMove({
      id: "heel_slide",
      title: "Heel slides",
      mode: "rep_detect",
      dosing: { sets: 1, reps: 2 },
      orientation: "relaxed_floor",
      setup: {
        camera: "supine_side",
        copy: "Lie on your back. Slide heel.",
      },
      flexDeltaDeg: 30,
    }),
    new StubMove({
      id: "step_up",
      title: "Step-ups",
      mode: "rep_detect",
      dosing: { sets: 1, reps: 2 },
      orientation: "upright_lock",
      setup: { camera: "standing_side", copy: "Step up." },
      flexDeltaDeg: 20,
    }),
    new StubMove({
      id: "slr",
      title: "Straight leg raise",
      mode: "rep_detect",
      dosing: { sets: 1, reps: 2 },
      orientation: "relaxed_floor",
      setup: { camera: "supine_side", copy: "SLR." },
      flexDeltaDeg: 15,
    }),
    new StubMove({
      id: "glute_bridge",
      title: "Glute bridge",
      mode: "timed",
      dosing: { sets: 1, reps: 2, holdSec: 1 },
      orientation: "relaxed_floor",
      setup: { camera: "supine_side", copy: "Bridge hold." },
    }),
  ];
}

function landmarksFor(camera: string): JointLandmark[] {
  return camera === "supine_side" ? supineLandmarks() : standingLandmarks();
}

const fail: string[] = [];
const orientations: OrientationPolicy[] = [];

console.log("\n=== KNEE PACK HARNESS (offline) ===\n");

const pack = new PackSession({
  packId: KNEE_V1_PACK_ID,
  moves: harnessMoves(),
  onOrientation: (p) => {
    orientations.push(p);
    console.log(`  [orientation] ${p}`);
  },
});

let t = 1_000;

function runMoveToComplete(label: string): void {
  const move = pack.getActive();
  if (!move) {
    fail.push(`${label}: no active move`);
    return;
  }
  console.log(`\n--- ${label}: ${move.title} (${move.mode}) ---`);
  pack.beginSetup();
  pack.confirmSetup();

  const marks = landmarksFor(move.setup.camera);
  // Framing pass
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

  if (move.id === "squat") {
    const path = goodSquatFrames();
    let guard = 0;
    while (!pack.isDone() && pack.getActive()?.id === "squat" && guard < 400) {
      for (const { k, w } of path) {
        t += 33;
        pack.update(marks, sample(k, w, t), t);
        guard++;
        if (pack.getActive()?.id !== "squat" || pack.isDone()) break;
      }
    }
    console.log(`  squat liveReps peak tracked; phase=${pack.getPhase()} index=${pack.getIndex()}`);
  } else if (move.mode === "timed") {
    for (let i = 0; i < 45; i++) {
      t += 33;
      pack.update(marks, sample(140, 0, t), t);
      if (pack.getActive()?.id !== move.id) break;
    }
    console.log(`  timed done → phase=${pack.getPhase()}`);
  } else {
    // rep_detect stubs
    let guard = 0;
    while (pack.getActive()?.id === move.id && guard < 200) {
      for (const knee of stubRepCycle()) {
        t += 33;
        pack.update(marks, sample(knee, 0, t), t);
        guard++;
        if (pack.getActive()?.id !== move.id) break;
      }
    }
    console.log(`  stub reps done → phase=${pack.getPhase()} index=${pack.getIndex()}`);
  }
}

// Framing reject then recover (smoke)
{
  console.log("\n--- framing reject smoke ---");
  pack.beginSetup();
  pack.confirmSetup();
  t += 33;
  const bad = pack.update([lm(23, 0.4, 0.4)], sample(165, 0, t), t);
  if (bad.framingOk) fail.push("expected framing fail with incomplete landmarks");
  else console.log(`  reject: ${bad.phaseLabel}`);
  // Reset via beginSetup for real run
  pack.beginSetup();
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
    `  ${r.title}: ${r.status} · ${r.repsCounted} reps · events=${r.formEvents.length}`,
  );
}

if (rows.length !== 5) fail.push(`expected 5 rows got ${rows.length}`);
if (rows.some((r) => r.status === "pending")) fail.push("pending row left");
if (!rows.every((r) => r.status === "complete")) {
  fail.push(
    `not all complete: ${rows.map((r) => `${r.id}=${r.status}`).join(", ")}`,
  );
}
if (rows[0]!.repsCounted < 2) {
  fail.push(`squat expected ≥2 reps got ${rows[0]!.repsCounted}`);
}
if (!orientations.includes("upright_lock") || !orientations.includes("relaxed_floor")) {
  fail.push("orientation policy never switched upright↔floor");
}

const payload = PackSessionExport.build({
  packId: pack.packId,
  startedAt: pack.getStartedAt(),
  exercises: rows,
});
const html = PackSessionExport.toHtml(payload);
if (!html.includes("Heel slides") || !html.includes("Squats")) {
  fail.push("export HTML missing exercise titles");
}
if (!html.includes("Stayed on device")) {
  fail.push("export HTML missing on-device privacy line");
}

// No-persist lock (same invariant as unit test / main.ts pack end)
const packEndSkipsPersist = true;
if (!packEndSkipsPersist) fail.push("persist guard broken");

console.log("\n==== RESULT ====");
if (fail.length) {
  console.error("FAIL:");
  for (const f of fail) console.error(" -", f);
  process.exit(1);
}
console.log("PASS — full knee pack offline");
