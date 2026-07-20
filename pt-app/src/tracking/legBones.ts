/**
 * Soft bone-length seatbelt — learn thigh/shin as fractions of hip width when
 * tracking is clear; after freeze, soft-pull joints that drift off target length
 * while preserving detector direction (BLAPose-style, online 2D).
 */

export type BoneSide = "left" | "right";

export interface BonePoint {
  x: number;
  y: number;
  visibility?: number;
}

export const BONE_VIS_MIN = 0.4;
export const BONE_FREEZE_SAMPLES = 20;
/** Outside this fraction of target length → soft pull. */
export const BONE_BAND = 0.15;
/** Blend toward target when outside band (1 = hard snap). */
export const BONE_BLEND = 0.35;
/** Re-learn if hipWidth drifts this fraction from freeze-time width. */
export const BONE_SCALE_INVALIDATE = 0.2;

interface SideState {
  /** thigh length / hipWidth */
  thighFrac: number;
  /** shin length / hipWidth */
  shinFrac: number;
  samples: number;
  frozen: boolean;
  freezeHipWidth: number;
}

function dist(a: BonePoint, b: BonePoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function emptySide(): SideState {
  return {
    thighFrac: 0,
    shinFrac: 0,
    samples: 0,
    frozen: false,
    freezeHipWidth: 0,
  };
}

export class LegBonesTracker {
  private left = emptySide();
  private right = emptySide();

  reset(): void {
    this.left = emptySide();
    this.right = emptySide();
  }

  isFrozen(side: BoneSide): boolean {
    return this.side(side).frozen;
  }

  samples(side: BoneSide): number {
    return this.side(side).samples;
  }

  /** Learned thigh length in image units, or null until frozen. */
  thighLength(side: BoneSide, hipWidth: number): number | null {
    const st = this.side(side);
    if (!st.frozen || st.thighFrac <= 0) return null;
    return st.thighFrac * Math.max(0.04, hipWidth);
  }

  /**
   * Place knee at ownHip + dir * thighLen. Dir from last good knee, else away
   * from otherHip. Used when MP collapses far knee onto near.
   */
  reconstructKnee(
    side: BoneSide,
    ownHip: BonePoint,
    otherHip: BonePoint,
    prevKnee: BonePoint | undefined,
    hipWidth: number,
  ): BonePoint {
    const hw = Math.max(0.04, hipWidth);
    const thighLen = this.thighLength(side, hw) ?? hw * 0.95;
    let dx: number;
    let dy: number;
    if (prevKnee) {
      dx = prevKnee.x - ownHip.x;
      dy = prevKnee.y - ownHip.y;
    } else {
      dx = ownHip.x - otherHip.x;
      dy = ownHip.y - otherHip.y;
    }
    const len = Math.hypot(dx, dy) || 1;
    return {
      x: ownHip.x + (dx / len) * thighLen,
      y: ownHip.y + (dy / len) * thighLen,
      visibility: prevKnee?.visibility,
    };
  }

  /**
   * Learn lengths when clear. Skip on kneesClose, flip streak, low vis, or bad scale.
   */
  observe(
    side: BoneSide,
    hip: BonePoint,
    knee: BonePoint,
    ankle: BonePoint,
    opts: {
      hipWidth: number;
      kneesClose: boolean;
      flipStreakActive: boolean;
    },
  ): void {
    const st = this.side(side);
    const hw = Math.max(0.04, opts.hipWidth);

    if (st.frozen) {
      if (
        st.freezeHipWidth > 0 &&
        Math.abs(hw - st.freezeHipWidth) / st.freezeHipWidth >
          BONE_SCALE_INVALIDATE
      ) {
        Object.assign(st, emptySide());
      } else {
        return;
      }
    }

    if (opts.kneesClose || opts.flipStreakActive) return;
    if (!this.visOk(hip, knee, ankle)) return;

    const thigh = dist(hip, knee) / hw;
    const shin = dist(knee, ankle) / hw;
    if (!(thigh > 0.15 && thigh < 4 && shin > 0.15 && shin < 4)) return;

    const n = st.samples;
    st.thighFrac = n === 0 ? thigh : st.thighFrac + (thigh - st.thighFrac) / (n + 1);
    st.shinFrac = n === 0 ? shin : st.shinFrac + (shin - st.shinFrac) / (n + 1);
    st.samples = n + 1;

    if (st.samples >= BONE_FREEZE_SAMPLES) {
      st.frozen = true;
      st.freezeHipWidth = hw;
    }
  }

  /** Soft-pull ankle toward learned shin length; no-op until frozen. */
  softPullAnkle(
    side: BoneSide,
    knee: BonePoint,
    ankle: BonePoint,
    hipWidth: number,
  ): BonePoint {
    const st = this.side(side);
    if (!st.frozen || st.shinFrac <= 0) return ankle;
    const hw = Math.max(0.04, hipWidth);
    return this.softPull(knee, ankle, st.shinFrac * hw);
  }

  /** Soft-pull knee toward learned thigh length (wider feel ok). */
  softPullKnee(
    side: BoneSide,
    hip: BonePoint,
    knee: BonePoint,
    hipWidth: number,
  ): BonePoint {
    const st = this.side(side);
    if (!st.frozen || st.thighFrac <= 0) return knee;
    const hw = Math.max(0.04, hipWidth);
    return this.softPull(hip, knee, st.thighFrac * hw);
  }

  private softPull(
    parent: BonePoint,
    child: BonePoint,
    targetLen: number,
  ): BonePoint {
    const d = dist(parent, child);
    if (d < 1e-6) return child;
    const err = Math.abs(d - targetLen) / targetLen;
    if (err <= BONE_BAND) return child;

    const ux = (child.x - parent.x) / d;
    const uy = (child.y - parent.y) / d;
    const desiredX = parent.x + ux * targetLen;
    const desiredY = parent.y + uy * targetLen;
    return {
      x: child.x + (desiredX - child.x) * BONE_BLEND,
      y: child.y + (desiredY - child.y) * BONE_BLEND,
      visibility: child.visibility,
    };
  }

  private visOk(a: BonePoint, b: BonePoint, c: BonePoint): boolean {
    return (
      (a.visibility ?? 0) >= BONE_VIS_MIN &&
      (b.visibility ?? 0) >= BONE_VIS_MIN &&
      (c.visibility ?? 0) >= BONE_VIS_MIN
    );
  }

  private side(side: BoneSide): SideState {
    return side === "left" ? this.left : this.right;
  }
}
