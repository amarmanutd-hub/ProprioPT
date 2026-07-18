/**
 * Pack session — setup → framing → work → (rest → work)×sets → next/skip/abort.
 */

import type { BiomechanicalSample } from "../biomechanics/BiomechanicalEvaluator";
import type { JointLandmark } from "../perception/PerceptionEngine";
import type { OrientationPolicy } from "../perception/PerceptionEngine";
import {
  checkStandingFraming,
  checkSupineSideFraming,
} from "./FramingCheck";
import type {
  ExerciseMove,
  ExerciseStatus,
  MoveUpdateResult,
  PackExerciseRow,
} from "./types";

export type PackPhase = "setup" | "framing" | "work" | "rest" | "done";

export interface PackSessionOptions {
  packId: string;
  moves: ExerciseMove[];
  /** Rest between sets (default 5s). */
  restSec?: number;
  onOrientation?: (policy: OrientationPolicy) => void;
}

export class PackSession {
  readonly packId: string;
  private readonly moves: ExerciseMove[];
  private readonly restSec: number;
  private readonly onOrientation?: (policy: OrientationPolicy) => void;
  private index = 0;
  private phase: PackPhase = "setup";
  private startedAt = new Date().toISOString();
  private rows: PackExerciseRow[] = [];
  private liveReps = 0;
  private liveFlags: string[] = [];
  private formEventCounts = new Map<string, number>();
  /** 0-based set within current exercise. */
  private setIndex = 0;
  private repsThisExercise = 0;
  private restUntilMs: number | null = null;

  constructor(options: PackSessionOptions) {
    this.packId = options.packId;
    this.moves = options.moves;
    this.restSec = options.restSec ?? 5;
    this.onOrientation = options.onOrientation;
    this.rows = this.moves.map((m) => ({
      id: m.id,
      title: m.title,
      mode: m.mode,
      status: "pending" as ExerciseStatus,
      repsCounted: 0,
      formEvents: [],
    }));
    this.applyOrientation();
  }

  getPhase(): PackPhase {
    return this.phase;
  }

  getIndex(): number {
    return this.index;
  }

  /** 1-based set number for UI. */
  getSetNumber(): number {
    return this.setIndex + 1;
  }

  getTargetSets(): number {
    return this.getActive()?.dosing.sets ?? 1;
  }

  getActive(): ExerciseMove | null {
    if (this.phase === "done") return null;
    return this.moves[this.index] ?? null;
  }

  getLiveReps(): number {
    return this.liveReps;
  }

  getLiveFlags(): string[] {
    return this.liveFlags;
  }

  getRows(): PackExerciseRow[] {
    return this.rows.map((r) => ({ ...r, formEvents: [...r.formEvents] }));
  }

  getStartedAt(): string {
    return this.startedAt;
  }

  beginSetup(): void {
    if (this.phase === "done") return;
    this.phase = "setup";
    this.liveReps = 0;
    this.liveFlags = [];
    this.formEventCounts.clear();
    this.setIndex = 0;
    this.repsThisExercise = 0;
    this.restUntilMs = null;
    this.moves[this.index]?.reset();
    this.applyOrientation();
  }

  confirmSetup(): void {
    if (this.phase !== "setup") return;
    this.phase = "framing";
  }

  update(
    landmarks: JointLandmark[],
    sample: BiomechanicalSample | null,
    t: number,
  ): { phaseLabel: string; framingOk: boolean; framingReason?: string } {
    const move = this.getActive();
    if (!move || this.phase === "done" || this.phase === "setup") {
      return {
        phaseLabel: move?.setup.copy ?? "Pack complete",
        framingOk: false,
      };
    }

    if (this.phase === "rest") {
      const left = Math.max(0, ((this.restUntilMs ?? t) - t) / 1000);
      if (t >= (this.restUntilMs ?? 0)) {
        this.phase = "work";
        this.restUntilMs = null;
        return {
          phaseLabel: `Set ${this.setIndex + 1} of ${move.dosing.sets} — go`,
          framingOk: true,
        };
      }
      return {
        phaseLabel: `Rest ${left.toFixed(0)}s — then set ${this.setIndex + 1}`,
        framingOk: true,
      };
    }

    if (this.phase === "framing") {
      const check =
        move.setup.camera === "supine_side"
          ? checkSupineSideFraming(landmarks)
          : checkStandingFraming(landmarks);
      if (check.ok) {
        this.phase = "work";
        return { phaseLabel: "Looking good — begin", framingOk: true };
      }
      return {
        phaseLabel: check.reason ?? "Adjust camera",
        framingOk: false,
        framingReason: check.reason,
      };
    }

    // work — latch counts only via recordFormEvent (onFlag / squat compensations)
    const result = move.update(landmarks, sample, t);
    this.liveReps = this.repsThisExercise + result.reps;
    this.liveFlags = result.flags;
    if (result.setComplete) {
      this.onSetComplete(result, t);
    }
    const sets = move.dosing.sets || 1;
    return {
      phaseLabel:
        sets > 1
          ? `${result.phaseLabel} · set ${this.setIndex + 1}/${sets}`
          : result.phaseLabel,
      framingOk: true,
    };
  }

  /** Latch a form event once (from move onFlag / squat compensation). */
  recordFormEvent(type: string): void {
    this.formEventCounts.set(type, (this.formEventCounts.get(type) ?? 0) + 1);
  }

  skip(): void {
    if (this.phase === "done") return;
    this.finishCurrent("skipped", {
      reps: this.liveReps,
      flags: this.liveFlags,
      phaseLabel: "Skipped",
      setComplete: false,
    });
  }

  abortPack(): void {
    if (this.phase === "done") return;
    const move = this.getActive();
    if (move) {
      this.rows[this.index] = {
        ...this.rows[this.index],
        status: "aborted",
        repsCounted: this.liveReps,
        formEvents: [...this.formEventCounts.entries()].map(([type, count]) => ({
          type,
          count,
        })),
        notes: "Pack aborted",
      };
    }
    this.phase = "done";
  }

  nextIncomplete(): void {
    if (this.phase === "done") return;
    this.finishCurrent("incomplete", {
      reps: this.liveReps,
      flags: this.liveFlags,
      phaseLabel: "Incomplete",
      setComplete: false,
    });
  }

  isDone(): boolean {
    return this.phase === "done";
  }

  private onSetComplete(result: MoveUpdateResult, t: number): void {
    const move = this.moves[this.index];
    const sets = move.dosing.sets || 1;
    this.repsThisExercise += result.reps;
    this.liveReps = this.repsThisExercise;
    this.setIndex += 1;

    if (this.setIndex < sets) {
      // Keep formEventCounts across sets; reset move for next set only
      move.reset();
      this.phase = "rest";
      this.restUntilMs = t + this.restSec * 1000;
      return;
    }

    this.finishCurrent("complete", {
      ...result,
      reps: this.repsThisExercise,
    });
  }

  private finishCurrent(
    status: ExerciseStatus,
    result: MoveUpdateResult,
  ): void {
    this.rows[this.index] = {
      id: this.moves[this.index].id,
      title: this.moves[this.index].title,
      mode: this.moves[this.index].mode,
      status,
      repsCounted: result.reps,
      formEvents: [...this.formEventCounts.entries()].map(([type, count]) => ({
        type,
        count,
      })),
    };

    if (this.index >= this.moves.length - 1) {
      this.phase = "done";
      return;
    }
    this.index += 1;
    this.beginSetup();
  }

  private applyOrientation(): void {
    const move = this.getActive();
    if (move) this.onOrientation?.(move.orientation);
  }
}
