/**
 * Local demo theater — PT builds plan → PROP code → patient starts pack.
 * No login / Supabase. Invites live in localStorage on this origin only.
 */

const STORAGE_KEY = "proprio.demo.invites";
const CARE_PLAN_KEY = "proprio.carePlan";

type Exercise = {
  name: string;
  sets?: number;
  reps?: number;
  cues?: string;
};

type ClinicalLimits = {
  side: "left" | "right" | "bilateral";
  maxKneeFlexionDeg: number;
  maxExtensionDeficitDeg: number;
  painStopAt: number;
};

type CarePlan = {
  notes?: string;
  patient_display_name?: string;
  limits?: ClinicalLimits;
  exercises: Exercise[];
};

type Invite = {
  code: string;
  plan: CarePlan;
  createdAt: string;
};

const PRESETS: Exercise[] = [
  { name: "Squats", sets: 2, reps: 10, cues: "Mini-squat OK — form coached" },
  { name: "Heel slides", sets: 2, reps: 10, cues: "Form coached" },
  { name: "Step-ups", sets: 2, reps: 8, cues: "Form coached" },
  { name: "Straight leg raise", sets: 2, reps: 10, cues: "Form coached" },
  { name: "Glute bridge", sets: 2, reps: 10, cues: "Form coached · hold at top" },
];

const PACK_URL = (() => {
  if (!import.meta.env.DEV && !(import.meta.env.VITE_DEMO_URL as string | undefined)?.trim()) {
    return "/pack/knee-v1";
  }
  const env = (import.meta.env.VITE_DEMO_URL as string | undefined)?.trim();
  const base =
    env ||
    (import.meta.env.DEV ? "http://localhost:5174/" : "/demo/");
  try {
    const u = new URL(base, location.origin);
    u.searchParams.set("pack", "knee-v1");
    return u.toString();
  } catch {
    return `${base.replace(/\/?$/, "/")}?pack=knee-v1`;
  }
})();

function loadInvites(): Record<string, Invite> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, Invite>;
  } catch {
    return {};
  }
}

function saveInvites(map: Record<string, Invite>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

function normalizeCode(raw: string): string {
  const t = raw.trim().toUpperCase();
  if (/^\d{4}$/.test(t)) return `PROP-${t}`;
  if (/^PROP-\d{4}$/.test(t)) return t;
  return t;
}

function randomCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0]! % 10000;
  return `PROP-${n.toString().padStart(4, "0")}`;
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const tabPt = $("#tab-pt");
const tabPatient = $("#tab-patient");
const viewPt = $("#view-pt");
const viewPatient = $("#view-patient");
const exList = $("#ex-list");
const presetsEl = $("#presets");
const inviteEl = $("#invite");
const inviteCode = $("#invite-code");
const ptError = $("#pt-error");
const patientError = $("#patient-error");
const planEl = $("#plan");
const planList = $("#plan-list");
const planGreeting = $("#plan-greeting");
const planNotes = $("#plan-notes");
const startSession = $("#start-session") as HTMLAnchorElement;
const codeDigits = $("#code-digits") as HTMLInputElement;

let draft: Exercise[] = [];

function showView(view: "pt" | "patient"): void {
  const isPt = view === "pt";
  viewPt.hidden = !isPt;
  viewPatient.hidden = isPt;
  tabPt.classList.toggle("on", isPt);
  tabPatient.classList.toggle("on", !isPt);
  const url = new URL(location.href);
  url.searchParams.set("view", view);
  history.replaceState(null, "", url);
}

function renderDraft(): void {
  exList.innerHTML = "";
  if (draft.length === 0) {
    exList.innerHTML = `<li class="empty">No exercises yet — tap a quick add above.</li>`;
    return;
  }
  draft.forEach((ex, i) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <div>
        <strong>${ex.name}</strong>
        <span class="muted">${[ex.sets ? `${ex.sets} sets` : null, ex.reps ? `${ex.reps} reps` : null].filter(Boolean).join(" · ")}</span>
        ${ex.cues ? `<span class="cue">${ex.cues}</span>` : ""}
      </div>
      <button type="button" class="text-btn" data-remove="${i}">Remove</button>
    `;
    exList.appendChild(li);
  });
}

function renderPresets(): void {
  presetsEl.innerHTML = "";
  for (const p of PRESETS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip";
    btn.textContent = `+ ${p.name}`;
    btn.addEventListener("click", () => {
      if (draft.some((d) => d.name === p.name)) return;
      draft.push({ ...p });
      renderDraft();
    });
    presetsEl.appendChild(btn);
  }
}

exList.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const idx = t.dataset.remove;
  if (idx == null) return;
  draft.splice(Number(idx), 1);
  renderDraft();
});

$("#create-invite").addEventListener("click", () => {
  ptError.hidden = true;
  const name = ($("#patient-name") as HTMLInputElement).value.trim();
  if (!name) {
    ptError.textContent = "Add a patient name.";
    ptError.hidden = false;
    return;
  }
  if (draft.length === 0) {
    ptError.textContent = "Add at least one exercise.";
    ptError.hidden = false;
    return;
  }

  let code = randomCode();
  const map = loadInvites();
  let tries = 0;
  while (map[code] && tries < 12) {
    code = randomCode();
    tries++;
  }

  const maxFlex = Number(($("#max-flexion") as HTMLInputElement).value);
  const maxExt = Number(($("#max-ext-deficit") as HTMLInputElement).value);
  const painStop = Number(($("#pain-stop") as HTMLInputElement).value);
  const side = ($("#side") as HTMLSelectElement).value as ClinicalLimits["side"];

  const plan: CarePlan = {
    patient_display_name: name,
    notes: ($("#notes") as HTMLInputElement).value.trim() || undefined,
    limits: {
      side,
      maxKneeFlexionDeg: Number.isFinite(maxFlex) ? maxFlex : 90,
      maxExtensionDeficitDeg: Number.isFinite(maxExt) ? maxExt : 0,
      painStopAt: Number.isFinite(painStop) ? painStop : 5,
    },
    exercises: draft.map((ex) => ({ ...ex })),
  };

  map[code] = { code, plan, createdAt: new Date().toISOString() };
  saveInvites(map);

  inviteCode.textContent = code;
  inviteEl.hidden = false;
});

$("#open-patient").addEventListener("click", () => {
  const code = inviteCode.textContent ?? "";
  codeDigits.value = code.replace(/^PROP-/, "");
  showView("patient");
  planEl.hidden = true;
});

$("#copy-code").addEventListener("click", async () => {
  const code = inviteCode.textContent ?? "";
  try {
    await navigator.clipboard.writeText(code);
    $("#copy-code").textContent = "Copied";
    setTimeout(() => {
      $("#copy-code").textContent = "Copy code";
    }, 1500);
  } catch {
    /* ignore */
  }
});

function sideLabel(side: ClinicalLimits["side"]): string {
  if (side === "left") return "Left knee";
  if (side === "right") return "Right knee";
  return "Both knees";
}

function showPlan(plan: CarePlan): void {
  planGreeting.textContent = plan.patient_display_name
    ? `${plan.patient_display_name}’s plan`
    : "Your plan";
  const limitsCard = $("#plan-limits");
  if (plan.limits) {
    const L = plan.limits;
    limitsCard.innerHTML = `
      <p class="limits-card-title">Session limits from your PT</p>
      <dl class="limits-dl">
        <div><dt>Side</dt><dd>${sideLabel(L.side)}</dd></div>
        <div><dt>Max flexion</dt><dd>${L.maxKneeFlexionDeg}°</dd></div>
        <div><dt>Ext. deficit max</dt><dd>${L.maxExtensionDeficitDeg}°</dd></div>
        <div><dt>Stop if pain ≥</dt><dd>${L.painStopAt}/10</dd></div>
      </dl>
    `;
    limitsCard.hidden = false;
  } else {
    limitsCard.innerHTML = "";
    limitsCard.hidden = true;
  }
  planNotes.textContent = plan.notes ?? "";
  planNotes.hidden = !plan.notes;
  planList.innerHTML = "";
  for (const ex of plan.exercises) {
    const li = document.createElement("li");
    li.innerHTML = `
      <strong>${ex.name}</strong>
      <span class="muted">${[ex.sets ? `${ex.sets} sets` : null, ex.reps ? `${ex.reps} reps` : null].filter(Boolean).join(" · ") || "As prescribed"}</span>
      ${ex.cues ? `<span class="cue">${ex.cues}</span>` : ""}
    `;
    planList.appendChild(li);
  }
  sessionStorage.setItem(CARE_PLAN_KEY, JSON.stringify(plan));
  startSession.href = PACK_URL;
  planEl.hidden = false;
}

$("#code-form").addEventListener("submit", (e) => {
  e.preventDefault();
  patientError.hidden = true;
  const code = normalizeCode(codeDigits.value);
  const invite = loadInvites()[code];
  if (!invite) {
    patientError.textContent = "Code not found on this device. Generate one in the PT view first.";
    patientError.hidden = false;
    planEl.hidden = true;
    return;
  }
  showPlan(invite.plan);
});

tabPt.addEventListener("click", () => showView("pt"));
tabPatient.addEventListener("click", () => showView("patient"));

// Seed draft with full knee pack for a one-click demo
draft = PRESETS.map((p) => ({ ...p }));
renderPresets();
renderDraft();

const params = new URLSearchParams(location.search);
const view = params.get("view") === "patient" ? "patient" : "pt";
const codeParam = params.get("code");
showView(view);
if (codeParam) {
  codeDigits.value = normalizeCode(codeParam).replace(/^PROP-/, "");
  showView("patient");
  const invite = loadInvites()[normalizeCode(codeParam)];
  if (invite) showPlan(invite.plan);
}
