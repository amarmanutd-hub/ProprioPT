import { useCallback, useEffect, useState, type FormEvent } from "react";
import { signOut } from "../auth/authService";
import { useAuth } from "../auth/AuthProvider";
import type { CarePlan, ClinicalLimits, PatientAssignment } from "../lib/database.types";
import {
  createPatientAssignment,
  listAssignmentsForPt,
} from "../services/assignments";

type DraftExercise = {
  name: string;
  sets: string;
  reps: string;
  cues: string;
};

const KNEE_PRESETS: DraftExercise[] = [
  { name: "Squats", sets: "2", reps: "10", cues: "Mini-squat OK — form coached" },
  { name: "Heel slides", sets: "2", reps: "10", cues: "Form coached" },
  { name: "Step-ups", sets: "2", reps: "8", cues: "Form coached" },
  { name: "Straight leg raise", sets: "2", reps: "10", cues: "Form coached" },
  { name: "Glute bridge", sets: "2", reps: "10", cues: "Form coached · hold at top" },
];

const emptyExercise = (): DraftExercise => ({
  name: "",
  sets: "3",
  reps: "10",
  cues: "",
});

export function TherapistDashboard() {
  const { profile } = useAuth();
  const [assignments, setAssignments] = useState<PatientAssignment[]>([]);
  const [patientName, setPatientName] = useState("");
  const [notes, setNotes] = useState("");
  const [side, setSide] = useState<ClinicalLimits["side"]>("right");
  const [maxFlexion, setMaxFlexion] = useState("90");
  const [maxExtDeficit, setMaxExtDeficit] = useState("0");
  const [painStop, setPainStop] = useState("5");
  const [exercises, setExercises] = useState<DraftExercise[]>([...KNEE_PRESETS]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastInvite, setLastInvite] = useState<{ code: string; url: string } | null>(null);

  const reload = useCallback(async () => {
    if (!profile) return;
    const rows = await listAssignmentsForPt(profile.id);
    setAssignments(rows);
  }, [profile]);

  useEffect(() => {
    void reload().catch((err: Error) => setError(err.message));
  }, [reload]);

  function updateExercise(index: number, patch: Partial<DraftExercise>) {
    setExercises((prev) => prev.map((ex, i) => (i === index ? { ...ex, ...patch } : ex)));
  }

  function addPreset(preset: DraftExercise) {
    setExercises((prev) => {
      if (prev.some((e) => e.name === preset.name)) return prev;
      return [...prev, { ...preset }];
    });
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!profile) return;
    setBusy(true);
    setError(null);
    setLastInvite(null);

    const limits: ClinicalLimits = {
      side,
      maxKneeFlexionDeg: Number(maxFlexion) || 90,
      maxExtensionDeficitDeg: Number(maxExtDeficit) || 0,
      painStopAt: Number(painStop) || 5,
    };

    const carePlan: CarePlan = {
      notes: notes.trim() || undefined,
      limits,
      exercises: exercises.map((ex) => ({
        name: ex.name,
        sets: Number(ex.sets) || undefined,
        reps: Number(ex.reps) || undefined,
        cues: ex.cues.trim() || undefined,
      })),
    };

    try {
      const result = await createPatientAssignment({
        ptId: profile.id,
        patientName,
        carePlan,
      });
      setLastInvite({ code: result.accessCode, url: result.inviteUrl });
      setPatientName("");
      setNotes("");
      setExercises([...KNEE_PRESETS]);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create assignment");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="workspace">
      <header className="topbar">
        <div>
          <p className="eyebrow">Proprio</p>
          <h1>Care plans</h1>
        </div>
        <div className="topbar-actions">
          <span className="muted">{profile?.full_name ?? profile?.id}</span>
          <button className="btn ghost" type="button" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </header>

      <main className="workspace-grid">
        <section className="panel">
          <h2>New patient invite</h2>
          <p className="muted">
            Creates an unclaimed assignment and a one-time <span className="mono">PROP-XXXX</span>{" "}
            access code. Patient starts the knee pack with these limits.
          </p>

          {error ? <p className="banner error">{error}</p> : null}
          {lastInvite ? (
            <div className="banner ok invite-result">
              <strong>Access code:</strong> <span className="mono">{lastInvite.code}</span>
              <div>
                Invite URL:{" "}
                <a href={lastInvite.url} target="_blank" rel="noreferrer">
                  {lastInvite.url}
                </a>
              </div>
            </div>
          ) : null}

          <form className="stack" onSubmit={(e) => void onCreate(e)}>
            <label className="field">
              <span>Patient name</span>
              <input
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                placeholder="Jordan Lee"
                required
              />
            </label>

            <fieldset className="limits-box">
              <legend>Clinical limits</legend>
              <p className="muted small">Shown first on the patient plan and enforced in the pack.</p>
              <div className="row">
                <label className="field">
                  <span>Side</span>
                  <select value={side} onChange={(e) => setSide(e.target.value as ClinicalLimits["side"])}>
                    <option value="left">Left</option>
                    <option value="right">Right</option>
                    <option value="bilateral">Bilateral</option>
                  </select>
                </label>
                <label className="field">
                  <span>Max knee flexion (°)</span>
                  <input
                    value={maxFlexion}
                    onChange={(e) => setMaxFlexion(e.target.value)}
                    inputMode="numeric"
                  />
                </label>
              </div>
              <div className="row">
                <label className="field">
                  <span>Max extension deficit (°)</span>
                  <input
                    value={maxExtDeficit}
                    onChange={(e) => setMaxExtDeficit(e.target.value)}
                    inputMode="numeric"
                  />
                </label>
                <label className="field">
                  <span>Stop if pain ≥</span>
                  <input
                    value={painStop}
                    onChange={(e) => setPainStop(e.target.value)}
                    inputMode="numeric"
                  />
                </label>
              </div>
            </fieldset>

            <label className="field">
              <span>Care plan notes</span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Focus on controlled tempo; stop if swelling."
              />
            </label>

            <div className="stack">
              <div className="row-between">
                <h3>Exercises</h3>
                <button
                  className="btn ghost"
                  type="button"
                  onClick={() => setExercises((prev) => [...prev, emptyExercise()])}
                >
                  Add exercise
                </button>
              </div>
              <div className="preset-row">
                {KNEE_PRESETS.map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    className="chip"
                    onClick={() => addPreset(p)}
                  >
                    + {p.name}
                  </button>
                ))}
              </div>

              {exercises.map((ex, index) => (
                <div className="exercise-card" key={index}>
                  <label className="field">
                    <span>Name</span>
                    <input
                      value={ex.name}
                      onChange={(e) => updateExercise(index, { name: e.target.value })}
                      placeholder="Sit-to-stand"
                      required
                    />
                  </label>
                  <div className="row">
                    <label className="field">
                      <span>Sets</span>
                      <input
                        value={ex.sets}
                        onChange={(e) => updateExercise(index, { sets: e.target.value })}
                        inputMode="numeric"
                      />
                    </label>
                    <label className="field">
                      <span>Reps</span>
                      <input
                        value={ex.reps}
                        onChange={(e) => updateExercise(index, { reps: e.target.value })}
                        inputMode="numeric"
                      />
                    </label>
                  </div>
                  <label className="field">
                    <span>Cues</span>
                    <input
                      value={ex.cues}
                      onChange={(e) => updateExercise(index, { cues: e.target.value })}
                      placeholder="Keep knees tracking over toes"
                    />
                  </label>
                </div>
              ))}
            </div>

            <button className="btn primary" type="submit" disabled={busy}>
              Generate access token
            </button>
          </form>
        </section>

        <section className="panel">
          <h2>Assignments</h2>
          {assignments.length === 0 ? (
            <p className="muted">No patient assignments yet.</p>
          ) : (
            <ul className="assignment-list">
              {assignments.map((row) => {
                const plan = row.care_plan as CarePlan | null;
                const label = plan?.patient_display_name ?? "Patient";
                return (
                  <li key={row.id}>
                    <div className="row-between">
                      <strong>{label}</strong>
                      <span className={`pill ${row.patient_id ? "claimed" : "open"}`}>
                        {row.patient_id ? "Claimed" : "Open"}
                      </span>
                    </div>
                    <p className="mono muted">
                      {row.access_code ?? "code redeemed"} · {plan?.exercises.length ?? 0} exercises
                      {plan?.limits
                        ? ` · max flex ${plan.limits.maxKneeFlexionDeg}°`
                        : ""}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
