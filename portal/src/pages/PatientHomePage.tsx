import { useMemo } from "react";
import { Link, Navigate } from "react-router-dom";
import { CARE_PLAN_KEY } from "./PatientActivatePage";
import type { CarePlan } from "../lib/database.types";
import { signOut } from "../auth/authService";

export function PatientHomePage() {
  const carePlan = useMemo(() => {
    const raw = sessionStorage.getItem(CARE_PLAN_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as CarePlan;
    } catch {
      return null;
    }
  }, []);

  if (!carePlan) {
    return <Navigate to="/activate" replace />;
  }

  const primary =
    carePlan.exercises.find((e) => /squat|sit.?to.?stand/i.test(e.name)) ??
    carePlan.exercises[0];

  return (
    <div className="workspace patient-home">
      <header className="topbar">
        <div>
          <p className="eyebrow">Proprio</p>
          <h1>Your care plan</h1>
        </div>
        <button className="btn ghost" type="button" onClick={() => void signOut()}>
          Sign out
        </button>
      </header>

      <main className="panel stack">
        {carePlan.patient_display_name ? (
          <p className="muted">Welcome, {carePlan.patient_display_name}</p>
        ) : null}
        {carePlan.notes ? <p>{carePlan.notes}</p> : null}

        <ul className="assignment-list">
          {carePlan.exercises.map((ex, i) => (
            <li key={`${ex.name}-${i}`}>
              <strong>{ex.name}</strong>
              <p className="muted">
                {[ex.sets ? `${ex.sets} sets` : null, ex.reps ? `${ex.reps} reps` : null]
                  .filter(Boolean)
                  .join(" · ") || "As prescribed"}
              </p>
              {ex.cues ? <p>{ex.cues}</p> : null}
            </li>
          ))}
        </ul>

        <a className="btn primary" href="/workout/">
          Start {primary?.name ?? "session"}
        </a>

        <p className="muted">
          Opens the camera workout on this device. Results save to your therapist when you tap
          See results. <Link to="/activate">Enter another code</Link>
        </p>
      </main>
    </div>
  );
}
