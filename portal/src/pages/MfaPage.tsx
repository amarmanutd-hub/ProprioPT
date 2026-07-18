import { useEffect, useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import {
  challengeTotp,
  enrollPasskey,
  enrollTotp,
  verifyTotpEnrollment,
} from "../auth/authService";
import { useAuth } from "../auth/AuthProvider";

export function MfaPage() {
  const { session, mfa, loading, refresh } = useAuth();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [passkeyNote, setPasskeyNote] = useState<string | null>(null);

  useEffect(() => {
    if (!mfa?.needsEnrollment || factorId) return;
    void (async () => {
      const result = await enrollTotp();
      if (result.error) {
        setError(result.error.message);
        return;
      }
      setFactorId(result.data.factorId);
      setQrCode(result.data.qrCode);
      setSecret(result.data.secret);
    })();
  }, [mfa, factorId]);

  if (loading) return <div className="page-center muted">Loading…</div>;
  if (!session) return <Navigate to="/login" replace />;
  if (mfa && !mfa.needsEnrollment && !mfa.needsChallenge) {
    return <Navigate to="/" replace />;
  }

  async function onVerify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const activeFactorId = factorId ?? mfa?.totpFactors[0]?.id;
    if (!activeFactorId) {
      setBusy(false);
      setError("No MFA factor available");
      return;
    }

    const result = mfa?.needsEnrollment
      ? await verifyTotpEnrollment(activeFactorId, code)
      : await challengeTotp(activeFactorId, code);

    setBusy(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }

    await refresh();
  }

  async function onPasskeyEnroll() {
    setBusy(true);
    setError(null);
    const result = await enrollPasskey("Proprio Therapist");
    setBusy(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setPasskeyNote("Passkey saved. Next sign-in can skip the magic link.");
  }

  return (
    <div className="auth-shell">
      <div className="auth-panel">
        <p className="eyebrow">Proprio</p>
        <h1>{mfa?.needsEnrollment ? "Enroll MFA" : "Confirm MFA"}</h1>
        <p className="lede">
          Therapist accounts require authenticator MFA after passwordless email sign-in.
        </p>

        {error ? <p className="banner error">{error}</p> : null}
        {passkeyNote ? <p className="banner ok">{passkeyNote}</p> : null}

        {mfa?.needsEnrollment && qrCode ? (
          <div className="mfa-enroll">
            <img src={qrCode} alt="TOTP QR code" className="qr" />
            {secret ? (
              <p className="mono muted">Secret: {secret}</p>
            ) : null}
          </div>
        ) : null}

        <form className="stack" onSubmit={(e) => void onVerify(e)}>
          <label className="field">
            <span>6-digit code</span>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              required
            />
          </label>
          <button className="btn primary" type="submit" disabled={busy || code.length !== 6}>
            Verify and continue
          </button>
        </form>

        <button className="btn ghost" type="button" disabled={busy} onClick={() => void onPasskeyEnroll()}>
          Also enroll a passkey
        </button>
      </div>
    </div>
  );
}
