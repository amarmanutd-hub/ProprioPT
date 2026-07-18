/**
 * Pack session state machine — setup → work → next/skip/abort → export rows.
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

export type PackPhase = "setup" | "framing" | "work" | "done";

export interface PackSessionOptions {
  packId: string;
  moves: ExerciseMove[];
  onOrientation?: (policy: OrientationPolicy) => void;
}

export class PackSession {
  readonly packId: string;
  private readonly moves: ExerciseMove[];
  private readonly onOrientation?: (policy: OrientationPolicy) => void;
  private index = 0;
  private phase: PackPhase = "setup";
  private startedAt = new Date().toISOString();
  private rows: PackExerciseRow[] = [];
  private liveReps = 0;
  private liveFlags: string[] = [];
  private formEventCounts = new Map<string, number>();

  constructor(options: PackSessionOptions) {
    this.packId = options.packId;
    this.moves = options.moves;
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

  /** Call when entering setup for current move (or after next/skip). */
  beginSetup(): void {
    if (this.phase === "done") return;
    this.phase = "setup";
    this.liveReps = 0;
    this.liveFlags = [];
    this.formEventCounts.clear();
    this.moves[this.index]?.reset();
    this.applyOrientation();
  }

  /** Patient confirmed setup — enter framing check. */
  confirmSetup(): void {
    if (this.phase !== "setup") return;
    this.phase = "framing";
  }

  /**
   * Feed frames during framing/work. Returns UI hints.
   */
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

    // work
    const result = move.update(landmarks, sample, t);
    this.liveReps = result.reps;
    this.liveFlags = result.flags;
    for (const f of result.flags) {
      this.formEventCounts.set(f, (this.formEventCounts.get(f) ?? 0) + 1);
    }
    if (result.setComplete) {
      this.finishCurrent("complete", result);
    }
    return { phaseLabel: result.phaseLabel, framingOk: true };
  }

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

  /** Manual “Next” when set not auto-complete (e.g. patient done early). */
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
