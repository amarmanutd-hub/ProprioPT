/**
 * PTAppUIEngine — knee halo, chroma form states, coaching audio + haptics.
 *
 * No full stick skeleton — one anatomical halo on the active knee.
 */

import type { JointLandmark } from "../perception/PerceptionEngine";
import type {
  CompensationKind,
  SquatFrameResult,
} from "../squat/SquatEvaluator";
import { CuePlayer } from "./CuePlayer";

export type HaloTone = "normal" | "warning" | "violation";

export interface HaloPaint {
  x: number;
  y: number;
  tone: HaloTone;
  /** Optional correction arrow: -1 left / +1 right / 0 up (chest). */
  arrow: -1 | 0 | 1 | null;
}

const TONE_COLOR: Record<HaloTone, string> = {
  normal: "#3d7a5a", // moss — calm “you’re ok”
  warning: "#9a6b16", // amber — caution, not alarm
  violation: "#a33b2e", // coral — correction, not emergency siren
};

export class PTAppUIEngine {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly landmarkToCanvas: (
    lm: JointLandmark,
    vw: number,
    vh: number,
    cw: number,
    ch: number,
  ) => { x: number; y: number };
  private readonly video: HTMLVideoElement;
  private readonly bannerEl: HTMLElement | null;
  private readonly cues = new CuePlayer();

  private violationActive = false;

  constructor(options: {
    canvas: HTMLCanvasElement;
    video: HTMLVideoElement;
    bannerEl?: HTMLElement | null;
    landmarkToCanvas: (
      lm: JointLandmark,
      vw: number,
      vh: number,
      cw: number,
      ch: number,
    ) => { x: number; y: number };
  }) {
    this.canvas = options.canvas;
    const ctx = options.canvas.getContext("2d");
    if (!ctx) throw new Error("2D context required for PTAppUIEngine");
    this.ctx = ctx;
    this.video = options.video;
    this.bannerEl = options.bannerEl ?? null;
    this.landmarkToCanvas = options.landmarkToCanvas;
  }

  clear(): void {
    this.syncSize();
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.clearBanner();
    this.violationActive = false;
  }

  /**
   * Paint knee halo from squat frame. Hides stick-figure dots.
   * Clears violation banner the instant flags are gone.
   */
  render(
    landmarks: JointLandmark[],
    squat: SquatFrameResult | null,
  ): void {
    this.syncSize();
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const paint = this.resolveHalo(landmarks, squat);
    if (!paint) return;

    this.drawHalo(paint);
    if (paint.arrow != null) this.drawArrow(paint);

    if (paint.tone === "violation" && squat) {
      this.violationActive = true;
      const kind = squat.activeFlags[0] ?? null;
      if (kind) this.announceViolation(kind);
    } else if (this.violationActive) {
      this.violationActive = false;
      this.clearBanner();
    }
  }

  /** Call from a click/tap so AirPods / iOS allow coaching audio. */
  unlockAudio(): void {
    this.cues.unlock();
  }

  setMuted(muted: boolean): void {
    this.cues.setMuted(muted);
  }

  isMuted(): boolean {
    return this.cues.isMuted();
  }

  /** Phase / calibration / session coaching by clip key. */
  speakCue(_text: string, key: string): void {
    this.cues.speak(key);
  }

  speakRep(n: number): void {
    this.cues.speakRep(n);
  }

  /** External compensation events. */
  flashViolation(kind: CompensationKind, _detail: string): void {
    this.showBanner(bannerFor(kind));
    this.cues.speak(kind);
    this.haptic();
  }

  private resolveHalo(
    landmarks: JointLandmark[],
    squat: SquatFrameResult | null,
  ): HaloPaint | null {
    const map = new Map(landmarks.map((l) => [l.index, l]));
    const lk = map.get(25);
    const rk = map.get(26);
    if (!lk || !rk) return null;
    if (lk.visibility < 0.25 && rk.visibility < 0.25) return null;

    const mid: JointLandmark = {
      index: -1,
      x: (lk.x + rk.x) / 2,
      y: (lk.y + rk.y) / 2,
      z: (lk.z + rk.z) / 2,
      visibility: Math.min(lk.visibility, rk.visibility),
      worldX: 0,
      worldY: 0,
      worldZ: 0,
    };

    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    if (!vw || !vh) return null;
    const { x, y } = this.landmarkToCanvas(
      mid,
      vw,
      vh,
      this.canvas.width,
      this.canvas.height,
    );

    let tone: HaloTone = "normal";
    let arrow: HaloPaint["arrow"] = null;

    if (squat) {
      if (squat.activeFlags.includes("valgus")) {
        tone = "violation";
        arrow = 1;
      } else if (squat.activeFlags.includes("trunk")) {
        tone = "violation";
        arrow = 0;
      } else if (squat.activeFlags.includes("incompleteDepth")) {
        tone = "violation";
        arrow = null;
      } else if (squat.state === 1 || squat.state === 3) {
        const nearDepth = squat.kneeDeg < 120 && squat.kneeDeg > 105;
        const nearStand = squat.kneeDeg > 150 && squat.state === 3;
        const fast = Math.abs(squat.kneeOmega) > 180;
        if (nearDepth || nearStand || fast) tone = "warning";
      }
    }

    return { x, y, tone, arrow };
  }

  private drawHalo(p: HaloPaint): void {
    const color = TONE_COLOR[p.tone];
    const r = Math.max(28, this.canvas.height * 0.035);

    const grd = this.ctx.createRadialGradient(p.x, p.y, r * 0.2, p.x, p.y, r * 1.6);
    grd.addColorStop(0, hexAlpha(color, 0.45));
    grd.addColorStop(0.55, hexAlpha(color, 0.18));
    grd.addColorStop(1, hexAlpha(color, 0));
    this.ctx.fillStyle = grd;
    this.ctx.beginPath();
    this.ctx.arc(p.x, p.y, r * 1.6, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.strokeStyle = hexAlpha(color, 0.9);
    this.ctx.lineWidth = 4;
    this.ctx.lineCap = "round";
    this.ctx.beginPath();
    this.ctx.arc(p.x, p.y, r, -Math.PI * 0.85, Math.PI * 0.15);
    this.ctx.stroke();

    this.ctx.strokeStyle = hexAlpha("#ffffff", 0.35);
    this.ctx.lineWidth = 1.5;
    this.ctx.beginPath();
    this.ctx.arc(p.x, p.y, r + 5, -Math.PI * 0.7, Math.PI * 0.05);
    this.ctx.stroke();
  }

  private drawArrow(p: HaloPaint): void {
    const color = TONE_COLOR.violation;
    const s = Math.max(18, this.canvas.height * 0.022);
    this.ctx.save();
    this.ctx.translate(p.x, p.y - s * 2.2);
    this.ctx.fillStyle = color;
    this.ctx.strokeStyle = "#fff";
    this.ctx.lineWidth = 2;

    if (p.arrow === 0) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, -s);
      this.ctx.lineTo(s * 0.7, s * 0.4);
      this.ctx.lineTo(-s * 0.7, s * 0.4);
      this.ctx.closePath();
      this.ctx.fill();
      this.ctx.stroke();
    } else {
      for (const dir of [-1, 1] as const) {
        this.ctx.beginPath();
        this.ctx.moveTo(dir * s * 0.3, 0);
        this.ctx.lineTo(dir * s * 1.4, -s * 0.55);
        this.ctx.lineTo(dir * s * 1.4, s * 0.55);
        this.ctx.closePath();
        this.ctx.fill();
        this.ctx.stroke();
      }
    }
    this.ctx.restore();
  }

  private announceViolation(kind: CompensationKind): void {
    // Visual only — audio/haptics come once from flashViolation.
    this.showBanner(bannerFor(kind));
  }

  private showBanner(text: string): void {
    if (!this.bannerEl) return;
    this.bannerEl.hidden = false;
    this.bannerEl.textContent = text;
  }

  private clearBanner(): void {
    if (!this.bannerEl) return;
    this.bannerEl.hidden = true;
    this.bannerEl.textContent = "";
  }

  private haptic(): void {
    try {
      if (navigator.vibrate) navigator.vibrate(40);
    } catch {
      /* desktop — no op */
    }
  }

  private syncSize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }
}

function bannerFor(kind: CompensationKind): string {
  switch (kind) {
    case "valgus":
      return "Knees caving — push them out";
    case "trunk":
      return "Chest up";
    case "incompleteDepth":
      return "Go lower";
  }
}

function hexAlpha(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}
