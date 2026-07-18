import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { normalizeAccessCode } from "../lib/accessCode";
import type { CarePlan, PatientAssignment } from "../lib/database.types";
import { supabase } from "../lib/supabase";

const CARE_PLAN_KEY = "proprio.carePlan";
const ASSIGNMENT_KEY = "proprio.assignmentId";

async function ensurePatientSession(): Promise<string> {
  const { data: existing } = await supabase.auth.getSession();
  if (existing.session?.user) {
    return existing.session.user.id;
  }

  const { data, error } = await supabase.auth.signInAnonymously({
    options: {
      data: { role: "patient" },
    },
  });

  if (error) throw error;
  if (!data.user) throw new Error("Unable to create patient session");
  return data.user.id;
}

async function claimCode(rawCode: string): Promise<PatientAssignment> {
  const code = normalizeAccessCode(rawCode);
  const patientUuid = await ensurePatientSession();

  const { data, error } = await supabase.rpc("activate_patient_token", {
    input_code: code,
    patient_uuid: patientUuid,
  });

  if (error) throw error;
  if (!data) throw new Error("Activation returned no assignment");
  return data as PatientAssignment;
}

export function PatientActivatePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const initialCode = useMemo(
    () => normalizeAccessCode(params.get("code") ?? ""),
    [params],
  );

  const [digits, setDigits] = useState(
    initialCode.startsWith("PROP-") ? initialCode.slice(5) : "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function activate(code: string) {
    setBusy(true);
    setError(null);
    try {
      const assignment = await claimCode(code);
      const plan = assignment.care_plan as CarePlan | null;
      if (plan) {
        sessionStorage.setItem(CARE_PLAN_KEY, JSON.stringify(plan));
      }
      sessionStorage.setItem(ASSIGNMENT_KEY, assignment.id);
      navigate("/patient", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid or expired access code");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!initialCode) return;
    void activate(initialCode);
    // Intentionally once per invite code in the URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCode]);

  function onManual(e: FormEvent) {
    e.preventDefault();
    void activate(normalizeAccessCode(digits));
  }

  return (
    <div className="auth-shell patient">
      <div className="auth-panel narrow">
        <p className="eyebrow">Proprio</p>
        <h1>Enter your access code</h1>
        <p className="lede">One-time invite from your therapist. No password needed.</p>

        {error ? <p className="banner error">{error}</p> : null}
        {busy ? <p className="muted">Activating…</p> : null}

        <form className="stack" onSubmit={onManual}>
          <label className="field">
            <span>Code</span>
            <div className="code-entry">
              <span className="mono prefix">PROP-</span>
              <input
                className="mono code-input"
                inputMode="numeric"
                pattern="[0-9]{4}"
                maxLength={4}
                value={digits}
                onChange={(e) => setDigits(e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="8492"
                required
                autoFocus
              />
            </div>
          </label>
          <button className="btn primary" type="submit" disabled={busy || digits.length !== 4}>
            Activate
          </button>
        </form>
      </div>
    </div>
  );
}

export { CARE_PLAN_KEY, ASSIGNMENT_KEY };
