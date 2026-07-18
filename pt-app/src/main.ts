/**
 * Entry — Perception → Calibration → Biomech → Squat FSM / Pack → UI.
 * Pack mode: /demo/?pack=knee-v1
 */

import {
  PerceptionEngine,
  type JointLandmark,
  type PerceptionFrame,
} from "./perception/PerceptionEngine";
import {
  CalibrationManager,
  type CalibrationProgress,
  type CalibrationSession,
} from "./calibration/CalibrationManager";
import { BiomechanicalEvaluator } from "./biomechanics/BiomechanicalEvaluator";
import { SquatEvaluator } from "./squat/SquatEvaluator";
import { PTAppUIEngine } from "./ui/PTAppUIEngine";
import { ClinicalSessionExport } from "./export/ClinicalSessionExport";
import { PackSessionExport } from "./export/PackSessionExport";
import { PrivacyFrameQueue } from "./privacy/PrivacyFrameQueue";
import {
  persistExerciseSession,
  readEmbeddedCarePlan,
  targetRepsFromCarePlan,
} from "./session/sessionBridge";
import { PackSession } from "./pack/PackSession";
import { createKneeV1Moves, KNEE_V1_PACK_ID } from "./pack/kneeV1";
import { SquatMove } from "./pack/SquatMove";
import type { PackSessionPayload } from "./export/PackSessionExport";

const packMode =
  new URLSearchParams(location.search).get("pack") === KNEE_V1_PACK_ID;

const video = document.querySelector<HTMLVideoElement>("#cam")!;
const guide = document.querySelector<HTMLCanvasElement>("#guide")!;
video.style.transform = "";
guide.style.transform = "";
const guideCtx = guide.getContext("2d")!;
const overlay = document.querySelector<HTMLDivElement>("#overlay")!;
const tposeGuide = document.querySelector<SVGElement>("#tpose-guide")!;
const statusEl = document.querySelector<HTMLParagraphElement>("#status")!;
const kneeAngleEl = document.querySelector<HTMLSpanElement>("#knee-angle")!;
const squatStateEl = document.querySelector<HTMLSpanElement>("#squat-state")!;
const repCounterEl = document.querySelector<HTMLDivElement>("#rep-counter")!;
const flagsEl = document.querySelector<HTMLParagraphElement>("#flags")!;
const startBtn = document.querySelector<HTMLButtonElement>("#start")!;
const endSessionBtn = document.querySelector<HTMLButtonElement>("#end-session")!;
const stopBtn = document.querySelector<HTMLButtonElement>("#stop")!;
const audioBtn = document.querySelector<HTMLButtonElement>("#audio-toggle")!;
const resultsEl = document.querySelector<HTMLDivElement>("#results")!;
const resultsReps = document.querySelector<HTMLSpanElement>("#results-reps")!;
const resultsRom = document.querySelector<HTMLSpanElement>("#results-rom")!;
const resultsTut = document.querySelector<HTMLSpanElement>("#results-tut")!;
const resultsValgus = document.querySelector<HTMLSpanElement>("#results-valgus")!;
const resultsTrunk = document.querySelector<HTMLSpanElement>("#results-trunk")!;
const resultsDepth = document.querySelector<HTMLSpanElement>("#results-depth")!;
const resultsDone = document.querySelector<HTMLButtonElement>("#results-done")!;
const calibBar = document.querySelector<HTMLDivElement>("#calib-bar")!;
const calibBarFill = calibBar.querySelector("span")!;
const packBadge = document.querySelector<HTMLParagraphElement>("#pack-mode-badge");
const packChipMode = document.querySelector<HTMLSpanElement>("#pack-chip-mode");
const packProgress = document.querySelector<HTMLDivElement>("#pack-progress");
const packConfirmBtn = document.querySelector<HTMLButtonElement>("#pack-confirm")!;
const packSkipBtn = document.querySelector<HTMLButtonElement>("#pack-skip")!;
const packResultsEl = document.querySelector<HTMLDivElement>("#pack-results")!;
const packResultsList = document.querySelector<HTMLUListElement>("#pack-results-list")!;
const packDownloadHtml = document.querySelector<HTMLButtonElement>("#pack-download-html")!;
const packDownloadJson = document.querySelector<HTMLButtonElement>("#pack-download-json")!;
const packResultsDone = document.querySelector<HTMLButtonElement>("#pack-results-done")!;
const brandSub = document.querySelector<HTMLParagraphElement>("#brand-sub");

function formatTut(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${r}s`;
}

function statusLabel(status: string): string {
  if (status === "complete") return "Done";
  if (status === "skipped") return "Skipped";
  if (status === "aborted") return "Stopped early";
  if (status === "pending") return "Not started";
  return status;
}

function showResults(payload: ReturnType<ClinicalSessionExport["build"]>): void {
  resultsReps.textContent = String(payload.totalValidReps);
  resultsRom.textContent =
    payload.totalValidReps > 0
      ? `${Math.round(payload.peakRangeOfMotionDeg)}°`
      : "—";
  resultsTut.textContent =
    payload.timeUnderTension.totalMs > 0
      ? formatTut(payload.timeUnderTension.totalMs)
      : "—";
  resultsValgus.textContent = String(payload.compensationEventCounter.valgus);
  resultsTrunk.textContent = String(payload.compensationEventCounter.trunk);
  resultsDepth.textContent = String(
    payload.compensationEventCounter.incompleteDepth,
  );
  resultsEl.hidden = false;
  resultsEl.classList.add("is-open");
  resultsDone.focus();
}

function hideResults(): void {
  resultsEl.classList.remove("is-open");
  resultsEl.hidden = true;
}

let lastPackPayload: PackSessionPayload | null = null;

function showPackResults(payload: PackSessionPayload): void {
  lastPackPayload = payload;
  packResultsList.innerHTML = "";
  for (const e of payload.exercises) {
    const li = document.createElement("li");
    li.dataset.status = e.status;
    const mode = e.mode === "form" ? "Form coached" : "Counting only";
    const flags =
      e.formEvents.length === 0
        ? ""
        : e.formEvents.map((f) => `${f.type}: ${f.count}`).join(" · ");
    li.innerHTML = `<strong>${e.title}</strong><span class="reps">${e.repsCounted}</span><span class="mode">${mode} · ${statusLabel(e.status)}</span>${
      flags ? `<p class="notes">${flags}</p>` : ""
    }`;
    packResultsList.appendChild(li);
  }
  packResultsEl.hidden = false;
  packResultsEl.classList.add("is-open");
  packResultsDone.focus();
}

function hidePackResults(): void {
  packResultsEl.classList.remove("is-open");
  packResultsEl.hidden = true;
}

const carePlan = readEmbeddedCarePlan();
const targetReps = targetRepsFromCarePlan(carePlan);

const backSite = document.querySelector<HTMLAnchorElement>("#back-site");
if (backSite) {
  if (location.pathname.startsWith("/workout")) {
    backSite.href = "/patient";
    backSite.textContent = "← Care plan";
  } else if (location.pathname.startsWith("/demo")) {
    backSite.href = "/";
  } else {
    backSite.href = `${location.protocol}//${location.hostname}:5173/`;
  }
}

if (carePlan?.notes) {
  setStatus(carePlan.notes, "ok");
}

if (packMode) {
  document.body.classList.add("pack-mode");
  document.title = "Proprio — Knee home pack";
  // Chip + progress appear once the pack session starts (after camera calib).
  if (packBadge) packBadge.hidden = true;
  if (packProgress) packProgress.hidden = true;
  if (brandSub) {
    brandSub.textContent =
      "Five home exercises. Squats get form cues; the rest are counted. Stays on this device.";
  }
  packConfirmBtn.hidden = false;
  packSkipBtn.hidden = false;
  endSessionBtn.textContent = "Finish early";
  setStatus(
    "Start the camera when you have floor space and a place to prop your phone.",
    "ok",
  );
}

let lastSession: CalibrationSession | null = null;
let clinical = new ClinicalSessionExport("bodyweight_squat");
const privacyQueue = new PrivacyFrameQueue();
let privacyTick = 0;
let lastCalibSpeechKey = "";
let pack: PackSession | null = null;
/** After initial standing calib in pack mode, we drive PackSession. */
let packReady = false;

const PATIENT_PHASE: Record<string, string> = {
  Standing: "Ready when you are",
  Descent: "Going down — nice and steady",
  Depth: "Great depth — now stand up",
  Ascent: "Coming up",
};

function setFlow(step: 1 | 2 | 3): void {
  const s1 = document.getElementById("step-1");
  const s2 = document.getElementById("step-2");
  const s3 = document.getElementById("step-3");
  if (!s1 || !s2 || !s3) return;
  s1.className = step > 1 ? "done" : step === 1 ? "on" : "";
  s2.className = step > 2 ? "done" : step === 2 ? "on" : "";
  s3.className = step === 3 ? "on" : "";
}

function setOverlay(visible: boolean, message: string): void {
  overlay.hidden = !visible;
  overlay.querySelector(".overlay-msg")!.textContent = message;
}

function setStatus(text: string, kind: "ok" | "warn" | "err" = "ok"): void {
  statusEl.textContent = text;
  statusEl.dataset.kind = kind;
}

function syncGuideSize(): void {
  const w = guide.clientWidth || window.innerWidth;
  const h = guide.clientHeight || window.innerHeight;
  if (guide.width !== w || guide.height !== h) {
    guide.width = w;
    guide.height = h;
  }
}

function landmarkToCanvas(
  lm: JointLandmark,
  vw: number,
  vh: number,
  cw: number,
  ch: number,
): { x: number; y: number } {
  const videoAspect = vw / vh;
  const canvasAspect = cw / ch;
  let drawW: number;
  let drawH: number;
  let offsetX: number;
  let offsetY: number;
  if (videoAspect > canvasAspect) {
    drawH = ch;
    drawW = ch * videoAspect;
    offsetX = (cw - drawW) / 2;
    offsetY = 0;
  } else {
    drawW = cw;
    drawH = cw / videoAspect;
    offsetX = 0;
    offsetY = (ch - drawH) / 2;
  }
  return { x: lm.x * drawW + offsetX, y: lm.y * drawH + offsetY };
}

const SKIP_GUIDE_INDICES = new Set([17, 18, 19, 20, 21, 22]);

function drawGuide(landmarks: JointLandmark[]): void {
  syncGuideSize();
  guideCtx.clearRect(0, 0, guide.width, guide.height);
  if (!landmarks.length) return;

  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return;

  for (const lm of landmarks) {
    if (SKIP_GUIDE_INDICES.has(lm.index)) continue;
    if (lm.visibility < 0.2) continue;
    const { x, y } = landmarkToCanvas(lm, vw, vh, guide.width, guide.height);
    guideCtx.beginPath();
    guideCtx.arc(x, y, 8, 0, Math.PI * 2);
    guideCtx.fillStyle = "#8faf7a";
    guideCtx.fill();
    guideCtx.strokeStyle = "#fff";
    guideCtx.lineWidth = 2;
    guideCtx.stroke();
  }
}

const ui = new PTAppUIEngine({
  canvas: guide,
  video,
  bannerEl: flagsEl,
  landmarkToCanvas,
});

function syncPackProgress(): void {
  if (!pack || !packProgress) return;
  const idx = pack.getIndex();
  const phase = pack.getPhase();
  const spans = packProgress.querySelectorAll("span");
  spans.forEach((span, i) => {
    span.classList.remove("on", "done");
    if (phase === "done" || i < idx) span.classList.add("done");
    else if (i === idx) span.classList.add("on");
  });
}

function syncPackButtons(): void {
  if (!packMode || !pack) {
    packConfirmBtn.disabled = true;
    packSkipBtn.disabled = true;
    return;
  }
  const phase = pack.getPhase();
  packConfirmBtn.disabled = phase !== "setup";
  packSkipBtn.disabled = phase === "done" || phase === "setup";
  endSessionBtn.disabled = false;
  endSessionBtn.textContent = phase === "done" ? "See summary" : "Finish early";
  syncPackProgress();
}

function showPackSetup(): void {
  if (!pack) return;
  const move = pack.getActive();
  if (!move) return;
  const formCoached = move.mode === "form";
  const modeLabel = formCoached ? "Form coached" : "Counting only";
  if (packBadge) packBadge.hidden = false;
  if (packProgress) packProgress.hidden = false;
  if (packChipMode) {
    packChipMode.textContent = modeLabel;
    packChipMode.dataset.kind = formCoached ? "form" : "count";
  }
  squatStateEl.textContent = move.title;
  setStatus(
    `${move.setup.copy} · Move ${pack.getIndex() + 1} of 5 · ${modeLabel}`,
    "ok",
  );
  repCounterEl.textContent = "0";
  syncPackButtons();
}

function startPackSession(): void {
  pack = new PackSession({
    packId: KNEE_V1_PACK_ID,
    moves: createKneeV1Moves({
      onSquatCompensation: (e) => {
        pack?.recordFormEvent(e.kind);
        ui.flashViolation(e.kind, e.detail);
      },
      onSquatRep: (r) => {
        repCounterEl.textContent = String(r.repIndex);
        repCounterEl.classList.remove("bump");
        void repCounterEl.offsetWidth;
        repCounterEl.classList.add("bump");
        ui.speakRep(r.repIndex);
      },
    }),
    onOrientation: (policy) => engine.setOrientationPolicy(policy),
  });
  packReady = true;
  pack.beginSetup();
  showPackSetup();
}

function onCalibProgress(p: CalibrationProgress): void {
  calibBar.classList.toggle("active", p.phase === "running");
  calibBarFill.style.width = `${Math.round(p.progress * 100)}%`;
  tposeGuide.classList.toggle("active", p.phase === "running");
  tposeGuide.classList.toggle("match", p.phase === "running" && p.tPoseOk);

  let speechKey = "";
  let speechLine = "";
  if (p.phase === "running") {
    setFlow(2);
    squatStateEl.textContent = p.tPoseOk
      ? "Hold still — almost there"
      : "Fill the outline";
    setStatus(
      p.tPoseOk
        ? "Perfect — keep holding for a few seconds."
        : "Stand so we can see you head to toe. Move closer if you look small.",
      p.tPoseOk ? "ok" : "warn",
    );
    if (p.message.startsWith("Stand in") && lastCalibSpeechKey === "") {
      speechKey = "stand";
      speechLine = "Stand in the outline. Head to toe, then hold still";
    }
  } else if (p.phase === "complete" && p.session) {
    lastSession = p.session;
    setFlow(3);
    if (packMode) {
      startPackSession();
      speechKey = "ready";
      speechLine = "You’re set. Follow the on-screen setup";
    } else {
      squatStateEl.textContent = "Ready when you are";
      setStatus(
        "You’re set. Do a squat when you’re ready — we’ll count the good ones.",
        "ok",
      );
      speechKey = "ready";
      speechLine = "You’re set. Squats when you’re ready";
    }
    startBtn.textContent = "Camera on";
  } else if (p.phase === "failed") {
    setStatus(
      "Setup didn’t stick — step into the outline and we’ll try again.",
      "warn",
    );
    speechKey = "fail";
    speechLine = "Setup didn’t finish. Try again with more light";
    lastCalibSpeechKey = "";
    window.setTimeout(() => {
      if (!engine.isRunning()) return;
      if (calibration.getPhase() === "running" || calibration.isReady()) return;
      lastCalibSpeechKey = "";
      calibration.start();
    }, 1200);
  } else if (p.phase === "idle") {
    lastCalibSpeechKey = "";
  }

  if (speechKey && speechKey !== lastCalibSpeechKey) {
    lastCalibSpeechKey = speechKey;
    ui.speakCue(speechLine, `calib-${speechKey}`);
  }
}

const biomech = new BiomechanicalEvaluator({
  anchorDriftThreshold: 0.05,
  onAnchorCompensation: (e) => {
    console.warn("[Anchor compensation]", e);
    setStatus(
      `Body shifted a lot (${(e.driftRatio * 100).toFixed(0)}%). Plant your feet and try again.`,
      "warn",
    );
  },
});

const squat = new SquatEvaluator({
  onCompensation: (e) => {
    console.warn("[Squat compensation]", e);
    clinical.recordCompensation(e.kind);
    ui.flashViolation(e.kind, e.detail);
  },
  onRep: (r) => {
    console.info("[Rep]", r);
    clinical.recordRep(r);
    repCounterEl.textContent = targetReps
      ? `${r.repIndex} / ${targetReps}`
      : String(r.repIndex);
    repCounterEl.classList.remove("bump");
    void repCounterEl.offsetWidth;
    repCounterEl.classList.add("bump");
    ui.speakRep(r.repIndex);
  },
});

const calibration = new CalibrationManager({
  durationMs: 5000,
  onProgress: onCalibProgress,
  onComplete: (session) => {
    lastSession = session;
    biomech.reset();
    squat.reset();
    clinical = new ClinicalSessionExport("bodyweight_squat");
    if (!packMode) {
      repCounterEl.textContent = "0";
      squatStateEl.textContent = "Ready when you are";
      endSessionBtn.disabled = false;
      endSessionBtn.className = "primary";
      endSessionBtn.textContent = "See results";
    }
    console.info("[Calibration]", session);
  },
  onFailed: (reason) => console.warn("[Calibration]", reason),
});

const engine = new PerceptionEngine({
  video,
  bodyMode: "full",
  alerts: {
    onHalt: (reason, message) => {
      setOverlay(true, message);
      setStatus(`Halted (${reason}): ${message}`, "err");
      ui.clear();
      ui.speakCue(message, "halt");
    },
    onResume: () => {
      setOverlay(false, "");
      setStatus("Resumed — stand in frame", "ok");
    },
    onWarning: (code, message) => {
      console.warn(`[${code}]`, message);
      if (code === "capability") setStatus(`[${code}] ${message}`, "warn");
    },
    onFrame: (frame: PerceptionFrame) => {
      const hasPose = frame.landmarks.length > 0;

      privacyTick += 1;
      if (privacyTick % 15 === 0) {
        void privacyQueue.enqueueVideoFrame(video);
      }

      const calibrating = calibration.getPhase() === "running";

      if (calibrating) {
        drawGuide(frame.landmarks);
        calibration.update(frame.landmarks, frame.timestampMs);
        return;
      }

      const normalized = calibration.isReady()
        ? calibration.normalize(frame.landmarks)
        : frame.landmarks;

      const sample = biomech.evaluate(normalized, frame.timestampMs);
      if (sample) {
        kneeAngleEl.textContent = (
          (sample.angles.leftKnee + sample.angles.rightKnee) /
          2
        ).toFixed(0);
      } else {
        kneeAngleEl.textContent = "—";
      }

      // ── Pack path ──────────────────────────────────────────────────────────
      if (packMode && packReady && pack && !pack.isDone()) {
        const phase = pack.getPhase();
        if (phase === "setup") {
          drawGuide(frame.landmarks);
          return;
        }

        const hint = pack.update(frame.landmarks, sample, frame.timestampMs);
        const active = pack.getActive();
        const phaseNow = pack.getPhase();

        if (phaseNow === "setup") {
          showPackSetup();
          drawGuide(frame.landmarks);
          syncPackButtons();
          return;
        }

        squatStateEl.textContent = hint.phaseLabel;
        repCounterEl.textContent = String(pack.getLiveReps());

        if (active instanceof SquatMove && phaseNow === "work") {
          const last = active.getLastResult();
          ui.render(frame.landmarks, last);
        } else {
          drawGuide(frame.landmarks);
        }

        if (pack.isDone()) {
          const payload = PackSessionExport.build({
            packId: pack.packId,
            startedAt: pack.getStartedAt(),
            exercises: pack.getRows(),
          });
          showPackResults(payload);
          setStatus("Pack complete — download your summary.", "ok");
          ui.speakCue("Session complete.", "session-done");
          syncPackButtons();
          return;
        }

        if (phaseNow === "framing") {
          setStatus(
            hint.framingReason ?? hint.phaseLabel,
            hint.framingOk ? "ok" : "warn",
          );
        } else if (phaseNow === "work") {
          setStatus(
            active?.mode === "form"
              ? "Looking good — keep going at your own pace."
              : "Counting only — form coaching comes later for this move.",
            "ok",
          );
        }

        syncPackButtons();
        return;
      }

      // ── Single-squat demo path ─────────────────────────────────────────────
      let squatResult = null;
      if (sample && calibration.isReady()) {
        squatResult = squat.update(sample, frame.landmarks);
        squatStateEl.textContent =
          PATIENT_PHASE[squatResult.stateLabel] ?? squatResult.stateLabel;
        repCounterEl.textContent = String(squatResult.reps);
        ui.render(frame.landmarks, squatResult);
      } else if (calibration.getPhase() !== "running") {
        drawGuide(frame.landmarks);
      }

      (window as unknown as { __proprioDebug?: unknown }).__proprioDebug = {
        fps: frame.fps,
        joints: frame.landmarks.length,
        rScale: lastSession?.rScale ?? null,
        biomech: sample,
        squat: squatResult,
        pack: packMode,
      };

      if (!hasPose) {
        setStatus("Step back so we can see your whole body.", "warn");
        return;
      }

      if (sample?.anchorCompensation) return;

      if (calibration.isReady() && lastSession && squatResult) {
        if (squatResult.activeFlags.length === 0) {
          setStatus("Looking good — keep going at your own pace.", "ok");
        }
      } else if (calibration.isReady() && lastSession) {
        setStatus("You’re set. Do a squat when you’re ready.", "ok");
      } else if (calibration.getPhase() !== "running") {
        setStatus("Stand in the outline — head to toe.", "ok");
      }
    },
  },
});

audioBtn.addEventListener("click", () => {
  if (ui.isMuted()) {
    ui.setMuted(false);
    ui.unlockAudio();
    ui.speakCue("Sound on", "audio-on");
  } else {
    ui.setMuted(true);
  }
  syncAudioBtn();
});

function syncAudioBtn(): void {
  const muted = ui.isMuted();
  audioBtn.textContent = muted ? "Unmute" : "Mute";
  audioBtn.setAttribute("aria-pressed", muted ? "true" : "false");
}
syncAudioBtn();

startBtn.addEventListener("click", async () => {
  startBtn.disabled = true;
  ui.unlockAudio();
  setStatus("Turning on the camera…");
  try {
    privacyQueue.start();
    await engine.start();
    stopBtn.disabled = false;
    endSessionBtn.disabled = true;
    setOverlay(false, "");
    setFlow(2);
    squatStateEl.textContent = "Fill the outline";
    startBtn.textContent = "Camera on";
    setStatus("Stand in the outline — head to toe, then hold still.", "ok");
    engine.setBodyMode("full");
    engine.setOrientationPolicy("upright_lock");
    lastCalibSpeechKey = "";
    packReady = false;
    pack = null;
    calibration.start();
  } catch (err) {
    startBtn.disabled = false;
    privacyQueue.stop();
    setStatus(
      "We couldn’t open the camera. Check permissions and try again.",
      "err",
    );
    console.error(err);
  }
});

packConfirmBtn.addEventListener("click", () => {
  if (!pack || pack.getPhase() !== "setup") return;
  pack.confirmSetup();
  setStatus("Hold the framing — we’ll start when you’re in view.", "ok");
  syncPackButtons();
});

packSkipBtn.addEventListener("click", () => {
  if (!pack || pack.isDone()) return;
  pack.skip();
  if (pack.isDone()) {
    const payload = PackSessionExport.build({
      packId: pack.packId,
      startedAt: pack.getStartedAt(),
      exercises: pack.getRows(),
    });
    showPackResults(payload);
  } else {
    showPackSetup();
  }
  syncPackButtons();
});

endSessionBtn.addEventListener("click", () => {
  if (packMode && pack) {
    if (!pack.isDone()) pack.abortPack();
    const payload = PackSessionExport.build({
      packId: pack.packId,
      startedAt: pack.getStartedAt(),
      exercises: pack.getRows(),
    });
    // CRITICAL: never persist pack sessions
    showPackResults(payload);
    setStatus("Pack wrapped — download your summary. Nothing uploaded.", "ok");
    ui.speakCue("Session complete.", "session-done");
    syncPackButtons();
    return;
  }

  const payload = clinical.build();
  console.info("[Clinical session]", payload);
  showResults(payload);

  void persistExerciseSession(payload).then((result) => {
    if (result.ok) {
      console.info("[Clinical session] saved", result.id);
      return;
    }
    console.warn("[Clinical session] not saved:", result.reason);
  });

  const line =
    payload.totalValidReps > 0
      ? `Session complete — ${payload.totalValidReps} good squat${payload.totalValidReps === 1 ? "" : "s"}.`
      : "Session complete. No full squats this round — that’s okay.";
  setStatus(line, "ok");
  ui.speakCue(
    payload.totalValidReps > 0
      ? `Session complete. ${payload.totalValidReps} good ${payload.totalValidReps === 1 ? "squat" : "squats"}.`
      : "Session complete.",
    "session-done",
  );
  clinical = new ClinicalSessionExport("bodyweight_squat");
  squat.reset();
  repCounterEl.textContent = targetReps ? `0 / ${targetReps}` : "0";
  squatStateEl.textContent = "Session wrapped";
  endSessionBtn.disabled = true;
});

packDownloadHtml.addEventListener("click", () => {
  if (lastPackPayload) PackSessionExport.downloadHtml(lastPackPayload);
});
packDownloadJson.addEventListener("click", () => {
  if (lastPackPayload) PackSessionExport.downloadJson(lastPackPayload);
});
packResultsDone.addEventListener("click", () => {
  hidePackResults();
  setStatus("Stop the camera when you’re done, or Start again for another pack.", "ok");
});

resultsDone.addEventListener("click", () => {
  hideResults();
  squatStateEl.textContent = "Ready when you are";
  endSessionBtn.disabled = false;
  setStatus(
    "You’re set. Do another round, or stop the camera when you’re done.",
    "ok",
  );
});

stopBtn.addEventListener("click", () => {
  hideResults();
  hidePackResults();
  calibration.reset();
  biomech.reset();
  squat.reset();
  pack = null;
  packReady = false;
  engine.setOrientationPolicy("upright_lock");
  privacyQueue.stop();
  tposeGuide.classList.remove("active", "match");
  calibBar.classList.remove("active");
  calibBarFill.style.width = "0%";
  engine.stop();
  stopBtn.disabled = true;
  endSessionBtn.disabled = true;
  packConfirmBtn.disabled = true;
  packSkipBtn.disabled = true;
  startBtn.disabled = false;
  startBtn.textContent = "Start camera";
  kneeAngleEl.textContent = "—";
  squatStateEl.textContent = "Let’s get set up";
  repCounterEl.textContent = "0";
  lastSession = null;
  clinical = new ClinicalSessionExport("bodyweight_squat");
  ui.clear();
  setFlow(1);
  setStatus(
    packMode
      ? "Press Start — you’ll run five home exercises with a downloadable summary."
      : "Press Start when you have space to move.",
    "ok",
  );
  setOverlay(false, "");
});

console.info("[Proprio] main.ts loaded", packMode ? `(pack=${KNEE_V1_PACK_ID})` : "");
setFlow(1);
if (targetReps && !packMode) {
  repCounterEl.textContent = `0 / ${targetReps}`;
}
