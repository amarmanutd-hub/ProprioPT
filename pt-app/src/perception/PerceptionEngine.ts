/**
 * PerceptionEngine — camera → Pose Landmarker → absolute geometric landmarks.
 *
 * Patent-safe: emits standalone coordinate matrices only. No video reference,
 * frame matching, HMM, or sequence sync. Raw frames are never persisted.
 */

import {
  FilesetResolver,
  PoseLandmarker,
  type PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";

// ── Types ────────────────────────────────────────────────────────────────────

export type BodyMode = "full" | "upper" | "lower";

/** Absolute 3D landmark in MediaPipe normalized image space (+ optional world). */
export interface JointLandmark {
  index: number;
  x: number;
  y: number;
  z: number;
  visibility: number;
  worldX: number;
  worldY: number;
  worldZ: number;
}

export interface PerceptionFrame {
  /** Monotonic clock (performance.now) when this frame was evaluated. */
  timestampMs: number;
  /** Active joints after body-mode slicing — absolute geometry only. */
  landmarks: JointLandmark[];
  /** Estimated frames per second over a short rolling window. */
  fps: number;
}

export type PerceptionHaltReason =
  | "orientation"
  | "lighting"
  | "camera"
  | "runtime"
  | "user";

export interface PerceptionAlerts {
  onHalt?: (reason: PerceptionHaltReason, message: string) => void;
  onResume?: () => void;
  onWarning?: (code: "lighting" | "capability", message: string) => void;
  onFrame?: (frame: PerceptionFrame) => void;
}

export interface PerceptionEngineOptions {
  video: HTMLVideoElement;
  /** Optional offscreen/work canvas for grayscale lux sampling (not shown). */
  sampleCanvas?: HTMLCanvasElement;
  bodyMode?: BodyMode;
  /** Mean grayscale proxy threshold ≈ 150 lux (calibrated linear map). */
  minLuxProxy?: number;
  /** Spatial stddev above this implies harsh backlight / hotspots. */
  maxLightingStd?: number;
  /** Pitch must stay within VERTICAL_PITCH_DEG ± this band. */
  orientationToleranceDeg?: number;
  alerts?: PerceptionAlerts;
}

/** upright_lock = phone ~vertical (squat). relaxed_floor / off = no upright halt (supine setups). */
export type OrientationPolicy = "upright_lock" | "relaxed_floor" | "off";

export interface RuntimeCapabilities {
  webgpu: boolean;
  wasm: boolean;
  crossOriginIsolated: boolean;
  sharedArrayBuffer: boolean;
  simdLikely: boolean;
}

// MediaPipe Pose (33 landmarks). Upper = face + torso arms; lower = hips→feet + shoulders.
const UPPER_INDICES = Array.from({ length: 17 }, (_, i) => i); // 0–16
const LOWER_INDICES = [11, 12, ...Array.from({ length: 10 }, (_, i) => 23 + i)]; // 11,12,23–32
const FULL_INDICES = Array.from({ length: 33 }, (_, i) => i);

const VERTICAL_PITCH_DEG = 90;
const LIGHTING_SAMPLE_EVERY_N = 15;
/** Maps mean grayscale [0–255] → approximate lux proxy (browser cameras lack lux meters). */
const GRAY_TO_LUX = 150 / 80; // ~80 mean gray ≈ 150 lux proxy

/** Pose L/R pairs — MediaPipe often swaps these on the lower body. */
const LR_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [11, 12],
  [13, 14],
  [15, 16],
  [23, 24],
  [25, 26],
  [27, 28],
  [29, 30],
  [31, 32],
];

/** Swap must beat keep by this factor before we treat it as an ID flip. */
const LR_FLIP_RATIO = 0.85;

/** EMA blend toward raw — base rates; motion boosts these toward ALPHA_FAST. */
const ALPHA_UPPER = 0.5;
const ALPHA_HIP = 0.4;
const ALPHA_LEG = 0.38;
const ALPHA_FAST = 0.92; // intentional movement — nearly raw
const VIS_HOLD_LOWER = 0.35;
const LOWER_MEDIAN_N = 3;
/** Only median when nearly still (fraction of hip width). */
const MEDIAN_STILL_FRAC = 0.08;
/** Clamp only true teleports (L/R flip residue), not normal bends. */
const MAX_STEP_HIP = 1.4;
const MAX_STEP_LEG = 1.25;

interface SmoothedJoint {
  x: number;
  y: number;
  z: number;
  worldX: number;
  worldY: number;
  worldZ: number;
  visibility: number;
}

// ── Engine ───────────────────────────────────────────────────────────────────

export class PerceptionEngine {
  private readonly video: HTMLVideoElement;
  private readonly sampleCanvas: HTMLCanvasElement;
  private readonly sampleCtx: CanvasRenderingContext2D;
  private readonly alerts: PerceptionAlerts;
  private readonly minLuxProxy: number;
  private readonly maxLightingStd: number;
  private readonly orientationToleranceDeg: number;

  private bodyMode: BodyMode;
  private landmarker: PoseLandmarker | null = null;
  private stream: MediaStream | null = null;
  private rafId = 0;
  private running = false;
  private halted = false;
  private haltReason: PerceptionHaltReason | null = null;
  private frameCounter = 0;
  private lastInferMs = 0;
  private fpsEma = 0;
  private orientationListener: ((e: DeviceOrientationEvent) => void) | null =
    null;
  private orientationPolicy: OrientationPolicy = "upright_lock";

  /** Transient RGBA buffer for lighting — overwritten each sample; never stored. */
  private lightingScratch: ImageData | null = null;

  /** Per-index EMA state for landmark jitter suppression. */
  private smoothState = new Map<number, SmoothedJoint>();
  /** Short history for lower-body median (kills single-frame L/R spikes). */
  private lowerHistory = new Map<number, SmoothedJoint[]>();

  constructor(options: PerceptionEngineOptions) {
    this.video = options.video;
    this.sampleCanvas = options.sampleCanvas ?? document.createElement("canvas");
    const ctx = this.sampleCanvas.getContext("2d", {
      willReadFrequently: true,
    });
    if (!ctx) {
      throw new Error("2D canvas context unavailable for lighting sampling");
    }
    this.sampleCtx = ctx;
    this.bodyMode = options.bodyMode ?? "full";
    this.minLuxProxy = options.minLuxProxy ?? 150;
    this.maxLightingStd = options.maxLightingStd ?? 70;
    this.orientationToleranceDeg = options.orientationToleranceDeg ?? 5;
    this.alerts = options.alerts ?? {};
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Change mid-session when pack switches standing ↔ floor moves. */
  setOrientationPolicy(policy: OrientationPolicy): void {
    this.orientationPolicy = policy;
    if (
      policy !== "upright_lock" &&
      this.halted &&
      this.haltReason === "orientation"
    ) {
      this.clearHalt();
    }
  }

  getOrientationPolicy(): OrientationPolicy {
    return this.orientationPolicy;
  }

  static probeCapabilities(): RuntimeCapabilities {
    const webgpu = typeof navigator !== "undefined" && "gpu" in navigator;
    const wasm = typeof WebAssembly !== "undefined";
    const coi =
      typeof globalThis.crossOriginIsolated === "boolean" &&
      globalThis.crossOriginIsolated === true;
    const sharedArrayBuffer = typeof SharedArrayBuffer !== "undefined";
    // SIMD is not feature-detectable reliably; COI + SAB is the usual multi-thread path.
    const simdLikely = wasm;
    return {
      webgpu,
      wasm,
      crossOriginIsolated: coi,
      sharedArrayBuffer,
      simdLikely,
    };
  }

  /** Log graceful capability boundaries (WebGPU / threaded WASM). */
  static reportCapabilities(alerts?: PerceptionAlerts): RuntimeCapabilities {
    const caps = PerceptionEngine.probeCapabilities();
    if (!caps.webgpu) {
      alerts?.onWarning?.(
        "capability",
        "WebGPU unavailable — Pose Landmarker will use WASM GPU/CPU delegate. ONNX WebGPU path deferred.",
      );
      console.warn("[PerceptionEngine] WebGPU missing; WASM fallback active.");
    }
    if (!caps.wasm) {
      alerts?.onWarning?.(
        "capability",
        "WebAssembly unavailable — pose inference cannot run in this browser.",
      );
      console.error("[PerceptionEngine] WebAssembly unsupported.");
    }
    if (!caps.sharedArrayBuffer || !caps.crossOriginIsolated) {
      alerts?.onWarning?.(
        "capability",
        "Cross-origin isolation / SharedArrayBuffer missing — multi-threaded WASM+SIMD disabled; single-thread WASM used.",
      );
      console.warn(
        "[PerceptionEngine] Multi-threaded WASM unavailable (need COOP/COEP).",
      );
    }
    return caps;
  }

  setBodyMode(mode: BodyMode): void {
    this.bodyMode = mode;
  }

  getBodyMode(): BodyMode {
    return this.bodyMode;
  }

  isRunning(): boolean {
    return this.running && !this.halted;
  }

  async start(): Promise<void> {
    if (this.running) return;

    const caps = PerceptionEngine.reportCapabilities(this.alerts);
    if (!caps.wasm) {
      this.alerts.onHalt?.(
        "runtime",
        "WebAssembly is required for local pose inference.",
      );
      throw new Error("WebAssembly unavailable");
    }

    await this.ensureOrientationPermission();
    this.bindOrientationGuard();

    await this.openCamera();
    await this.initLandmarker(caps.webgpu);

    this.running = true;
    this.halted = false;
    this.haltReason = null;
    this.frameCounter = 0;
    this.lastInferMs = 0;
    this.smoothState.clear();
    this.lowerHistory.clear();
    this.loop();
  }

  stop(): void {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.unbindOrientationGuard();
    this.teardownCamera();
    this.landmarker?.close();
    this.landmarker = null;
    this.lightingScratch = null;
    this.smoothState.clear();
    this.lowerHistory.clear();
    this.alerts.onHalt?.("user", "Perception stopped.");
  }

  // ── Camera ─────────────────────────────────────────────────────────────────

  private async openCamera(): Promise<void> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, min: 24 },
        },
      });
      this.video.srcObject = this.stream;
      this.video.playsInline = true;
      this.video.muted = true;
      await this.video.play();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Camera permission denied";
      this.alerts.onHalt?.("camera", msg);
      throw err;
    }
  }

  private teardownCamera(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  // ── Pose landmarker (MediaPipe Tasks — local WASM; GPU when available) ─────

  private async initLandmarker(preferGpu: boolean): Promise<void> {
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm",
    );

    const modelAssetPath =
      "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task";

    try {
      this.landmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath,
          delegate: preferGpu ? "GPU" : "CPU",
        },
        runningMode: "VIDEO",
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.65,
      });
    } catch (gpuErr) {
      console.warn(
        "[PerceptionEngine] GPU delegate failed; retrying CPU.",
        gpuErr,
      );
      this.landmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath,
          delegate: "CPU",
        },
        runningMode: "VIDEO",
        numPoses: 1,
      });
    }
  }

  // ── Orientation lock (Phase 1.1) ───────────────────────────────────────────

  private async ensureOrientationPermission(): Promise<void> {
    const DOE = DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<"granted" | "denied">;
    };
    if (typeof DOE.requestPermission === "function") {
      const state = await DOE.requestPermission();
      if (state !== "granted") {
        this.alerts.onWarning?.(
          "capability",
          "Device orientation permission denied — orientation lock inactive.",
        );
      }
    }
  }

  private bindOrientationGuard(): void {
    // Laptops often emit beta≈0 (flat) with no real IMU — skip unless this looks like a handheld.
    const handheld =
      window.matchMedia("(pointer: coarse)").matches ||
      navigator.maxTouchPoints > 0;
    if (!handheld) {
      console.info(
        "[PerceptionEngine] Orientation lock skipped (desktop / no touch).",
      );
      return;
    }

    this.orientationListener = (e: DeviceOrientationEvent) => {
      // Floor / pack supine moves: skip upright lock (phone often on its side).
      if (this.orientationPolicy !== "upright_lock") {
        if (this.halted && this.haltReason === "orientation") this.clearHalt();
        return;
      }
      // beta ≈ pitch: 0 flat, ±90 upright (screen in vertical plane)
      if (e.beta == null) return;
      const pitchAbs = Math.abs(e.beta);
      const delta = Math.abs(pitchAbs - VERTICAL_PITCH_DEG);
      if (delta > this.orientationToleranceDeg) {
        this.enterHalt(
          "orientation",
          `Hold the device upright (pitch ${pitchAbs.toFixed(0)}°; need ~${VERTICAL_PITCH_DEG}° ±${this.orientationToleranceDeg}°).`,
        );
      } else if (this.halted && this.haltReason === "orientation") {
        this.clearHalt();
      }
    };
    window.addEventListener("deviceorientation", this.orientationListener);
  }

  private unbindOrientationGuard(): void {
    if (this.orientationListener) {
      window.removeEventListener(
        "deviceorientation",
        this.orientationListener,
      );
      this.orientationListener = null;
    }
  }

  // ── Lighting validation (Phase 1.2) ────────────────────────────────────────

  /**
   * Downsample current video frame to grayscale; compute mean (lux proxy) + stddev.
   * Mutates a single scratch ImageData — no frames retained after return.
   */
  private sampleLighting(): { luxProxy: number; std: number } | null {
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    if (!vw || !vh) return null;

    // Aggressive downsample for cheap ambient stats
    const w = 64;
    const h = Math.max(1, Math.round((64 * vh) / vw));
    this.sampleCanvas.width = w;
    this.sampleCanvas.height = h;
    this.sampleCtx.drawImage(this.video, 0, 0, w, h);

    const img = this.sampleCtx.getImageData(0, 0, w, h);
    this.lightingScratch = img;
    const data = img.data;
    const n = w * h;
    let sum = 0;
    const grays = new Float32Array(n);

    for (let i = 0, p = 0; i < n; i++, p += 4) {
      // Rec. 601 luma
      const g = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
      grays[i] = g;
      sum += g;
      // Immediately zero RGB so buffer holds no recoverable image after loop
      data[p] = 0;
      data[p + 1] = 0;
      data[p + 2] = 0;
      data[p + 3] = 0;
    }

    const mean = sum / n;
    let varSum = 0;
    for (let i = 0; i < n; i++) {
      const d = grays[i] - mean;
      varSum += d * d;
      grays[i] = 0; // wipe intensity vector
    }
    const std = Math.sqrt(varSum / n);
    const luxProxy = mean * GRAY_TO_LUX;

    this.lightingScratch = null;
    return { luxProxy, std };
  }

  private evaluateLighting(): void {
    const stats = this.sampleLighting();
    if (!stats) return;

    if (stats.luxProxy < this.minLuxProxy) {
      this.alerts.onWarning?.(
        "lighting",
        `Low ambient light (~${stats.luxProxy.toFixed(0)} lux proxy). Add light or face a brighter area.`,
      );
    } else if (stats.std > this.maxLightingStd) {
      this.alerts.onWarning?.(
        "lighting",
        `Harsh backlight / uneven lighting (σ=${stats.std.toFixed(0)}). Soften contrast behind you.`,
      );
    }
  }

  // ── Landmark slicing (Phase 1.3) ───────────────────────────────────────────

  private activeIndices(): readonly number[] {
    switch (this.bodyMode) {
      case "upper":
        return UPPER_INDICES;
      case "lower":
        return LOWER_INDICES;
      default:
        return FULL_INDICES;
    }
  }

  private sliceLandmarks(result: PoseLandmarkerResult): JointLandmark[] {
    const pose = result.landmarks[0];
    const world = result.worldLandmarks?.[0];
    if (!pose) return [];

    const byIndex = new Map<number, JointLandmark>();
    for (const idx of this.activeIndices()) {
      const lm = pose[idx];
      if (!lm) continue;
      const w = world?.[idx];
      byIndex.set(idx, {
        index: idx,
        x: lm.x,
        y: lm.y,
        z: lm.z,
        visibility: lm.visibility ?? 0,
        worldX: w?.x ?? 0,
        worldY: w?.y ?? 0,
        worldZ: w?.z ?? 0,
      });
    }

    // Undo left/right ID flips before EMA (smoothing alone can't fix identity swaps).
    this.stabilizeLaterality(byIndex);

    const out: JointLandmark[] = [];
    for (const idx of this.activeIndices()) {
      const raw = byIndex.get(idx);
      if (!raw) continue;
      // Median only while still — during bends it adds visible lag.
      const gated = this.maybeMedianLowerBody(raw);
      const clamped = this.clampLowerJump(gated);
      out.push(this.smoothLandmark(clamped));
    }
    return out;
  }

  private dist2(
    a: { x: number; y: number },
    b: { x: number; y: number },
  ): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
  }

  /**
   * If MediaPipe swaps L/R labels, matching current→previous with a swap
   * is cheaper than keeping indices. Reassign coords back onto stable indices.
   */
  private stabilizeLaterality(byIndex: Map<number, JointLandmark>): void {
    for (const [leftIdx, rightIdx] of LR_PAIRS) {
      const curL = byIndex.get(leftIdx);
      const curR = byIndex.get(rightIdx);
      if (!curL || !curR) continue;

      const prevL = this.smoothState.get(leftIdx);
      const prevR = this.smoothState.get(rightIdx);
      if (!prevL || !prevR) continue;

      const keep =
        this.dist2(curL, prevL) + this.dist2(curR, prevR);
      const swap =
        this.dist2(curL, prevR) + this.dist2(curR, prevL);

      if (swap < keep * LR_FLIP_RATIO) {
        byIndex.set(leftIdx, { ...curR, index: leftIdx });
        byIndex.set(rightIdx, { ...curL, index: rightIdx });
      }
    }

    // Hip-anchored chain: only repair when a knee teleports past the opposite hip
    // (true ID thrash). Do NOT hold-on-midline — that lags real squat/bend motion.
    this.enforceLegChain(byIndex, 23, 25, 27);
    this.enforceLegChain(byIndex, 24, 26, 28);
  }

  /**
   * Only intervene when the knee is clearly closer to the *opposite* hip than
   * its own by a wide margin (swap residue). Soft midline approaches during
   * bends are allowed through.
   */
  private enforceLegChain(
    byIndex: Map<number, JointLandmark>,
    hipIdx: number,
    kneeIdx: number,
    ankleIdx: number,
  ): void {
    const hip = byIndex.get(hipIdx);
    const knee = byIndex.get(kneeIdx);
    const ankle = byIndex.get(ankleIdx);
    if (!hip || !knee) return;

    const otherHipIdx = hipIdx === 23 ? 24 : 23;
    const otherHip = byIndex.get(otherHipIdx);
    if (!otherHip) return;

    const toOwn = this.dist2(knee, hip);
    const toOther = this.dist2(knee, otherHip);
    // Was 0.85 — too tight; squatting brings knees inward and false-triggered holds.
    if (toOther < toOwn * 0.45) {
      const prevKnee = this.smoothState.get(kneeIdx);
      if (prevKnee) {
        byIndex.set(kneeIdx, {
          index: kneeIdx,
          x: prevKnee.x,
          y: prevKnee.y,
          z: prevKnee.z,
          visibility: knee.visibility,
          worldX: prevKnee.worldX,
          worldY: prevKnee.worldY,
          worldZ: prevKnee.worldZ,
        });
      }
    }

    if (!ankle) return;
    const kneeNow = byIndex.get(kneeIdx)!;
    const ankleToOwnKnee = this.dist2(ankle, kneeNow);
    const ankleToOtherHip = this.dist2(ankle, otherHip);
    if (ankleToOtherHip < ankleToOwnKnee * 0.4) {
      const prevAnkle = this.smoothState.get(ankleIdx);
      if (prevAnkle) {
        byIndex.set(ankleIdx, {
          index: ankleIdx,
          x: prevAnkle.x,
          y: prevAnkle.y,
          z: prevAnkle.z,
          visibility: ankle.visibility,
          worldX: prevAnkle.worldX,
          worldY: prevAnkle.worldY,
          worldZ: prevAnkle.worldZ,
        });
      }
    }
  }

  private hipWidth(): number {
    const l = this.smoothState.get(23);
    const r = this.smoothState.get(24);
    if (!l || !r) return 0.12;
    return Math.max(0.04, Math.hypot(l.x - r.x, l.y - r.y));
  }

  private maybeMedianLowerBody(raw: JointLandmark): JointLandmark {
    if (raw.index < 23) return raw;

    const sample: SmoothedJoint = {
      x: raw.x,
      y: raw.y,
      z: raw.z,
      worldX: raw.worldX,
      worldY: raw.worldY,
      worldZ: raw.worldZ,
      visibility: raw.visibility,
    };
    let buf = this.lowerHistory.get(raw.index);
    if (!buf) {
      buf = [];
      this.lowerHistory.set(raw.index, buf);
    }
    buf.push(sample);
    if (buf.length > LOWER_MEDIAN_N) buf.shift();

    const prev = this.smoothState.get(raw.index);
    if (prev) {
      const step = Math.hypot(raw.x - prev.x, raw.y - prev.y);
      // Moving on purpose — skip median so pose keeps up with the limb.
      if (step > this.hipWidth() * MEDIAN_STILL_FRAC) return raw;
    }

    if (buf.length < 3) return raw;

    const mid = (key: keyof SmoothedJoint): number => {
      const vals = buf!.map((s) => s[key]).sort((a, b) => a - b);
      return vals[Math.floor(vals.length / 2)]!;
    };

    return {
      index: raw.index,
      x: mid("x"),
      y: mid("y"),
      z: mid("z"),
      worldX: mid("worldX"),
      worldY: mid("worldY"),
      worldZ: mid("worldZ"),
      visibility: raw.visibility,
    };
  }

  /** Reject only teleport jumps (flip residue), not squat/bend motion. */
  private clampLowerJump(raw: JointLandmark): JointLandmark {
    if (raw.index < 23) return raw;
    const prev = this.smoothState.get(raw.index);
    if (!prev) return raw;

    const maxStep =
      this.hipWidth() * (raw.index >= 25 ? MAX_STEP_LEG : MAX_STEP_HIP);
    const dx = raw.x - prev.x;
    const dy = raw.y - prev.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= maxStep) return raw;

    const t = maxStep / dist;
    return {
      ...raw,
      x: prev.x + dx * t,
      y: prev.y + dy * t,
      z: prev.z + (raw.z - prev.z) * t,
      worldX: prev.worldX + (raw.worldX - prev.worldX) * t,
      worldY: prev.worldY + (raw.worldY - prev.worldY) * t,
      worldZ: prev.worldZ + (raw.worldZ - prev.worldZ) * t,
    };
  }

  private baseAlphaForIndex(index: number): number {
    if (index >= 25) return ALPHA_LEG;
    if (index >= 23) return ALPHA_HIP;
    return ALPHA_UPPER;
  }

  private smoothLandmark(raw: JointLandmark): JointLandmark {
    const prev = this.smoothState.get(raw.index);
    const isLower = raw.index >= 23;

    if (prev && isLower && raw.visibility < VIS_HOLD_LOWER) {
      return {
        index: raw.index,
        ...prev,
        visibility: raw.visibility,
      };
    }

    if (!prev) {
      const seed: SmoothedJoint = {
        x: raw.x,
        y: raw.y,
        z: raw.z,
        worldX: raw.worldX,
        worldY: raw.worldY,
        worldZ: raw.worldZ,
        visibility: raw.visibility,
      };
      this.smoothState.set(raw.index, seed);
      return { index: raw.index, ...seed };
    }

    let alpha = this.baseAlphaForIndex(raw.index);
    if (isLower) {
      const step = Math.hypot(raw.x - prev.x, raw.y - prev.y);
      const hw = this.hipWidth();
      // 0 at rest → 1 at ~25% hip-width step: blend toward ALPHA_FAST
      const motion = Math.min(1, step / (hw * 0.25));
      alpha = alpha + (ALPHA_FAST - alpha) * motion;
    }

    const next: SmoothedJoint = {
      x: prev.x + alpha * (raw.x - prev.x),
      y: prev.y + alpha * (raw.y - prev.y),
      z: prev.z + alpha * (raw.z - prev.z),
      worldX: prev.worldX + alpha * (raw.worldX - prev.worldX),
      worldY: prev.worldY + alpha * (raw.worldY - prev.worldY),
      worldZ: prev.worldZ + alpha * (raw.worldZ - prev.worldZ),
      visibility: prev.visibility + alpha * (raw.visibility - prev.visibility),
    };
    this.smoothState.set(raw.index, next);
    return { index: raw.index, ...next };
  }

  // ── Halt / resume ──────────────────────────────────────────────────────────

  private enterHalt(reason: PerceptionHaltReason, message: string): void {
    if (this.halted && this.haltReason === reason) return;
    this.halted = true;
    this.haltReason = reason;
    this.alerts.onHalt?.(reason, message);
  }

  private clearHalt(): void {
    if (!this.halted) return;
    this.halted = false;
    this.haltReason = null;
    this.alerts.onResume?.();
  }

  // ── Main loop ──────────────────────────────────────────────────────────────

  private loop = (): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.loop);

    if (this.halted) return;
    if (this.video.readyState < 2 || !this.landmarker) return;

    const now = performance.now();
    // MediaPipe VIDEO mode requires strictly increasing timestamps
    if (now <= this.lastInferMs) return;

    this.frameCounter++;
    if (this.frameCounter % LIGHTING_SAMPLE_EVERY_N === 0) {
      this.evaluateLighting();
    }

    let result: PoseLandmarkerResult;
    try {
      result = this.landmarker.detectForVideo(this.video, now);
    } catch (err) {
      console.error("[PerceptionEngine] detectForVideo failed", err);
      return;
    }

    if (this.lastInferMs > 0) {
      const dt = now - this.lastInferMs;
      const instFps = 1000 / dt;
      this.fpsEma = this.fpsEma === 0 ? instFps : this.fpsEma * 0.9 + instFps * 0.1;
    }
    this.lastInferMs = now;

    const landmarks = this.sliceLandmarks(result);
    // Drop MediaPipe result refs ASAP — only absolute joints leave this scope
    this.alerts.onFrame?.({
      timestampMs: now,
      landmarks,
      fps: this.fpsEma,
    });
  };
}
