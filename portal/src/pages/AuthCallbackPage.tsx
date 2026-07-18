import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

/** Handles PKCE / magic-link redirect and routes into MFA or dashboard. */
export function AuthCallbackPage() {
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const { error } = await supabase.auth.exchangeCodeForSession(window.location.href);
      if (cancelled) return;
      if (error) {
        navigate("/login", { replace: true, state: { callbackError: error.message } });
        return;
      }
      navigate("/mfa", { replace: true });
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return <div className="page-center muted">Completing secure sign-in…</div>;
}
