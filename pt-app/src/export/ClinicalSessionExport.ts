/**
 * ClinicalSessionExport — de-fluffed session JSON (no rest/prep timestamps).
 *
 * Patent-safe: aggregates absolute rule outcomes only.
 */

import type { CompensationKind, RepMetrics } from "../squat/SquatEvaluator";

export interface ClinicalSessionPayload {
  sessionId: string;
  exerciseId: string;
  totalValidReps: number;
  /** Peak flexion ROM in degrees (180 − min knee angle across valid reps). */
  peakRangeOfMotionDeg: number;
  timeUnderTension: {
    /** Spec labels: concentric = descent phase durations summed. */
    concentricMs: number;
    /** Spec labels: eccentric = ascent phase durations summed. */
    eccentricMs: number;
    totalMs: number;
  };
  compensationEventCounter: {
    valgus: number;
    trunk: number;
    incompleteDepth: number;
    overFlexion: number;
    total: number;
  };
}

export class ClinicalSessionExport {
  private readonly sessionId: string;
  private readonly exerciseId: string;
  private reps: RepMetrics[] = [];
  private compensations: Record<CompensationKind, number> = {
    valgus: 0,
    trunk: 0,
    incompleteDepth: 0,
    overFlexion: 0,
  };

  constructor(exerciseId = "bodyweight_squat") {
    this.sessionId = crypto.randomUUID();
    this.exerciseId = exerciseId;
  }

  reset(exerciseId = this.exerciseId): ClinicalSessionExport {
    return new ClinicalSessionExport(exerciseId);
  }

  getSessionId(): string {
    return this.sessionId;
  }

  recordRep(rep: RepMetrics): void {
    this.reps.push(rep);
  }

  recordCompensation(kind: CompensationKind): void {
    this.compensations[kind] += 1;
  }

  /** Strip prep/rest gaps — only valid-rep TUT + compensation tallies. */
  build(): ClinicalSessionPayload {
    let concentricMs = 0;
    let eccentricMs = 0;
    let peakRom = 0;

    for (const r of this.reps) {
      concentricMs += r.descentMs;
      eccentricMs += r.ascentMs;
      if (r.peakFlexionDeg > peakRom) peakRom = r.peakFlexionDeg;
    }

    const totalComp =
      this.compensations.valgus +
      this.compensations.trunk +
      this.compensations.incompleteDepth +
      this.compensations.overFlexion;

    return {
      sessionId: this.sessionId,
      exerciseId: this.exerciseId,
      totalValidReps: this.reps.length,
      peakRangeOfMotionDeg: Math.round(peakRom * 10) / 10,
      timeUnderTension: {
        concentricMs,
        eccentricMs,
        totalMs: concentricMs + eccentricMs,
      },
      compensationEventCounter: {
        valgus: this.compensations.valgus,
        trunk: this.compensations.trunk,
        incompleteDepth: this.compensations.incompleteDepth,
        overFlexion: this.compensations.overFlexion,
        total: totalComp,
      },
    };
  }

  download(filename?: string): ClinicalSessionPayload {
    const payload = this.build();
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download =
      filename ??
      `proprio-${this.exerciseId}-${this.sessionId.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    return payload;
  }
}
