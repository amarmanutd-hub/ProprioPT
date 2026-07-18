import { useMemo } from "react";
import { Link, Navigate } from "react-router-dom";
import { CARE_PLAN_KEY } from "./PatientActivatePage";
import type { CarePlan } from "../lib/database.types";
import { signOut } from "../auth/authService";

function sideLabel(side: NonNullable<CarePlan["limits"]>["side"]): string {
  if (side === "left") return "Left knee";
  if (side === "right") return "Right knee";
  return "Both knees";
}

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

  const workoutHref = "/workout/?pack=knee-v1";

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

        {carePlan.limits ? (
          <div className="limits-card" aria-label="Clinical limits">
            <p className="limits-title">Session limits from your PT</p>
            <dl className="limits-dl">
              <div>
                <dt>Side</dt>
                <dd>{sideLabel(carePlan.limits.side)}</dd>
              </div>
              <div>
                <dt>Max flexion</dt>
                <dd>{carePlan.limits.maxKneeFlexionDeg}°</dd>
              </div>
              <div>
                <dt>Ext. deficit max</dt>
                <dd>{carePlan.limits.maxExtensionDeficitDeg}°</dd>
              </div>
              <div>
                <dt>Stop if pain ≥</dt>
                <dd>{carePlan.limits.painStopAt}/10</dd>
              </div>
            </dl>
          </div>
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

        <a className="btn primary" href={workoutHref}>
          Start knee pack
        </a>

        <p className="muted">
          Opens the camera coach on this device. Video stays here.{" "}
          <Link to="/activate">Enter another code</Link>
        </p>
      </main>
    </div>
  );
}
