import { ClinicalSessionExport } from "../src/export/ClinicalSessionExport";
import type { RepMetrics } from "../src/squat/SquatEvaluator";

const exp = new ClinicalSessionExport("bodyweight_squat");
const rep = (i: number): RepMetrics => ({
  repIndex: i,
  minKneeDeg: 95,
  peakFlexionDeg: 85,
  descentMs: 1000,
  ascentMs: 800,
  hadValgus: false,
  hadTrunkLean: false,
  completedAtMs: 5000 * i,
});

exp.recordRep(rep(1));
exp.recordRep(rep(2));
exp.recordCompensation("valgus");
exp.recordCompensation("incompleteDepth");

const p = exp.build();
const fail: string[] = [];
if (p.totalValidReps !== 2) fail.push("reps");
if (p.peakRangeOfMotionDeg !== 85) fail.push("rom");
if (p.timeUnderTension.concentricMs !== 2000) fail.push("conc");
if (p.timeUnderTension.eccentricMs !== 1600) fail.push("ecc");
if (p.compensationEventCounter.total !== 2) fail.push("comp");
if (!p.sessionId || !p.exerciseId) fail.push("ids");

if (fail.length) {
  console.error("EXPORT FAIL", fail, p);
  process.exit(1);
}
console.log("EXPORT PASS", p);
