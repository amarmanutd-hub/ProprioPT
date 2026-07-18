import { useState, type FormEvent } from "react";
import { Navigate, useLocation } from "react-router-dom";
import {
  enrollPasskey,
  sendMagicLink,
  signInWithPasskey,
} from "../auth/authService";
import { useAuth } from "../auth/AuthProvider";

export function LoginPage() {
  const { session, mfa, loading, unlockNotice } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!loading && session) {
    if (mfa?.needsEnrollment || mfa?.needsChallenge) {
      return <Navigate to="/mfa" replace />;
    }
    const from = (location.state as { from?: string } | null)?.from ?? "/";
    return <Navigate to={from} replace />;
  }

  async function onPasskey() {
    setBusy(true);
    setError(null);
    setMessage(null);
    const result = await signInWithPasskey();
    setBusy(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setMessage("Passkey accepted. Loading workspace…");
  }

  async function onMagicLink(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    const result = await sendMagicLink(email);
    setBusy(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setMessage("Magic link sent. Open it on this device, then complete MFA.");
  }

  async function onEnrollPasskey() {
    setBusy(true);
    setError(null);
    const result = await enrollPasskey("Proprio Therapist");
    setBusy(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setMessage("Passkey enrolled for this device.");
  }

  return (
    <div className="auth-shell">
      <div className="auth-panel">
        <p className="eyebrow">Proprio</p>
        <h1>Therapist sign-in</h1>
        <p className="lede">
          Prefer a passkey (Face ID / Touch ID). Magic link + MFA is available as fallback.
        </p>

        {unlockNotice ? <p className="banner warn">{unlockNotice}</p> : null}
        {error ? <p className="banner error">{error}</p> : null}
        {message ? <p className="banner ok">{message}</p> : null}

        <button className="btn primary" type="button" disabled={busy} onClick={() => void onPasskey()}>
          Continue with passkey
        </button>

        <div className="divider">
          <span>or magic link</span>
        </div>

        <form className="stack" onSubmit={(e) => void onMagicLink(e)}>
          <label className="field">
            <span>Work email</span>
            <input
              type="email"
              autoComplete="username webauthn"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@clinic.com"
              required
            />
          </label>
          <button className="btn" type="submit" disabled={busy}>
            Email me a sign-in link
          </button>
        </form>

        {session ? (
          <button className="btn ghost" type="button" disabled={busy} onClick={() => void onEnrollPasskey()}>
            Enroll passkey on this device
          </button>
        ) : null}
      </div>
    </div>
  );
}
