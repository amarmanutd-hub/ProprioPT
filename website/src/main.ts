/**
 * Marketing site: pose silhouette + demo / pack links.
 * Dev → pt-app on :5174 (started by `npm run dev`).
 * Prod → /demo/ (built into public/demo via `npm run build`).
 */

const DEMO_BASE =
  (import.meta.env.VITE_DEMO_URL as string | undefined)?.trim() ||
  (import.meta.env.DEV ? "http://localhost:5174/" : "/demo/");

const PACK_URL = (() => {
  try {
    const u = new URL(DEMO_BASE, location.origin);
    u.searchParams.set("pack", "knee-v1");
    return u.toString();
  } catch {
    return `${DEMO_BASE.replace(/\/?$/, "/")}?pack=knee-v1`;
  }
})();

const year = document.getElementById("year");
if (year) year.textContent = String(new Date().getFullYear());

for (const a of document.querySelectorAll<HTMLAnchorElement>("[data-demo]")) {
  a.href = a.dataset.demo === "pack" ? PACK_URL : DEMO_BASE;
}

const nav = document.querySelector<HTMLElement>(".nav");
const navToggle = document.querySelector<HTMLButtonElement>("#nav-toggle");
const primaryNav = document.querySelector<HTMLElement>("#primary-nav");
if (nav && navToggle && primaryNav) {
  const setOpen = (open: boolean) => {
    nav.classList.toggle("open", open);
    navToggle.setAttribute("aria-expanded", String(open));
    navToggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  };
  navToggle.addEventListener("click", () => {
    setOpen(!nav.classList.contains("open"));
  });
  primaryNav.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).tagName === "A") setOpen(false);
  });
}

const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* —— Stats count-up —— */
function formatCount(n: number, el: HTMLElement): string {
  const suffix = el.dataset.suffix ?? "";
  if (el.dataset.count?.includes(".")) {
    return `${n.toFixed(2)}${suffix}`;
  }
  if (n >= 1000) {
    return `${Math.round(n).toLocaleString()}${suffix}`;
  }
  return `${Math.round(n)}${suffix}`;
}

function animateCount(el: HTMLElement): void {
  const target = Number(el.dataset.count);
  if (!Number.isFinite(target)) return;
  if (prefersReduced) {
    el.textContent = formatCount(target, el);
    return;
  }
  const duration = 1100;
  const start = performance.now();
  const tick = (now: number) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = formatCount(target * eased, el);
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

const stats = document.querySelectorAll<HTMLElement>("[data-count]");
const io = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      animateCount(entry.target as HTMLElement);
      io.unobserve(entry.target);
    }
  },
  { threshold: 0.4 },
);
stats.forEach((el) => io.observe(el));

/* —— Hero pose silhouette (squat cycle) —— */
type Pt = { x: number; y: number };

const EDGES: [keyof typeof BASE, keyof typeof BASE][] = [
  ["nose", "neck"],
  ["neck", "lShoulder"],
  ["neck", "rShoulder"],
  ["lShoulder", "lElbow"],
  ["lElbow", "lWrist"],
  ["rShoulder", "rElbow"],
  ["rElbow", "rWrist"],
  ["neck", "hip"],
  ["hip", "lHip"],
  ["hip", "rHip"],
  ["lHip", "lKnee"],
  ["lKnee", "lAnkle"],
  ["rHip", "rKnee"],
  ["rKnee", "rAnkle"],
];

const BASE = {
  nose: { x: 0.5, y: 0.14 },
  neck: { x: 0.5, y: 0.22 },
  lShoulder: { x: 0.38, y: 0.24 },
  rShoulder: { x: 0.62, y: 0.24 },
  lElbow: { x: 0.3, y: 0.36 },
  rElbow: { x: 0.7, y: 0.36 },
  lWrist: { x: 0.28, y: 0.48 },
  rWrist: { x: 0.72, y: 0.48 },
  hip: { x: 0.5, y: 0.48 },
  lHip: { x: 0.43, y: 0.5 },
  rHip: { x: 0.57, y: 0.5 },
  lKnee: { x: 0.42, y: 0.7 },
  rKnee: { x: 0.58, y: 0.7 },
  lAnkle: { x: 0.41, y: 0.88 },
  rAnkle: { x: 0.59, y: 0.88 },
};

function squatPose(phase: number): Record<keyof typeof BASE, Pt> {
  // phase 0 = stand, 1 = bottom of squat
  const d = phase;
  const out = {} as Record<keyof typeof BASE, Pt>;
  for (const key of Object.keys(BASE) as (keyof typeof BASE)[]) {
    out[key] = { ...BASE[key] };
  }
  out.hip.y += 0.12 * d;
  out.lHip.y += 0.12 * d;
  out.rHip.y += 0.12 * d;
  out.neck.y += 0.1 * d;
  out.nose.y += 0.1 * d;
  out.lShoulder.y += 0.1 * d;
  out.rShoulder.y += 0.1 * d;
  out.lElbow.y += 0.08 * d;
  out.rElbow.y += 0.08 * d;
  out.lWrist.y += 0.06 * d;
  out.rWrist.y += 0.06 * d;
  out.lKnee.x -= 0.03 * d;
  out.rKnee.x += 0.03 * d;
  out.lKnee.y -= 0.02 * d;
  out.rKnee.y -= 0.02 * d;
  out.lAnkle.x -= 0.01 * d;
  out.rAnkle.x += 0.01 * d;
  return out;
}

function drawPose(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  w: number,
  h: number,
  t: number
): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.restore();

  const cycle = (Math.sin(t * 0.0011) + 1) / 2;
  const phase = cycle * cycle * (3 - 2 * cycle); // smoothstep-ish
  const pose = squatPose(phase);

  const px = (p: Pt) => p.x * w;
  const py = (p: Pt) => p.y * h;

  // Single soft contact shadow under the ankles
  ctx.fillStyle = "rgba(47, 122, 134, 0.14)";
  ctx.beginPath();
  ctx.ellipse(w * 0.5, h * 0.905, w * 0.22, h * 0.018, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(230, 242, 245, 0.92)";
  ctx.lineWidth = Math.max(3.5, w * 0.01);

  for (const [a, b] of EDGES) {
    ctx.beginPath();
    ctx.moveTo(px(pose[a]), py(pose[a]));
    ctx.lineTo(px(pose[b]), py(pose[b]));
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(242, 246, 247, 0.95)";
  for (const key of Object.keys(pose) as (keyof typeof BASE)[]) {
    const p = pose[key];
    const r = key === "nose" ? w * 0.018 : w * 0.012;
    ctx.beginPath();
    ctx.arc(px(p), py(p), r, 0, Math.PI * 2);
    ctx.fill();
  }

  // depth cue ring at bottom of squat
  if (phase > 0.75) {
    const alpha = (phase - 0.75) / 0.25;
    ctx.strokeStyle = `rgba(47, 122, 134, ${0.35 + alpha * 0.45})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px(pose.hip), py(pose.hip), w * 0.09, 0, Math.PI * 2);
    ctx.stroke();
  }
}

const canvas = document.getElementById("pose-canvas") as HTMLCanvasElement | null;
if (canvas) {
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let cssW = 0;
    let cssH = 0;

    const resize = () => {
      cssW = canvas.clientWidth || 420;
      cssH = cssW * (900 / 720);
      canvas.width = Math.max(1, Math.round(cssW * dpr));
      canvas.height = Math.max(1, Math.round(cssH * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    let raf = 0;
    const loop = (t: number) => {
      if (Math.abs((canvas.clientWidth || 420) - cssW) > 1) resize();
      drawPose(ctx, canvas, cssW, cssH, t);
      raf = requestAnimationFrame(loop);
    };
    if (prefersReduced) {
      drawPose(ctx, canvas, cssW, cssH, 0);
    } else {
      raf = requestAnimationFrame(loop);
    }
    window.addEventListener("beforeunload", () => cancelAnimationFrame(raf));
  }
}
