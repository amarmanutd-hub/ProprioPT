import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import type { Profile } from "../lib/database.types";
import {
  clearAuthTokens,
  ensurePtProfile,
  fetchOwnProfile,
  getMfaStatus,
  type MfaStatus,
} from "./authService";
import { startIdleLockout } from "./idleLockout";

type AuthContextValue = {
  session: Session | null;
  profile: Profile | null;
  mfa: MfaStatus | null;
  loading: boolean;
  lockedOut: boolean;
  refresh: () => Promise<void>;
  unlockNotice: string | null;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [mfa, setMfa] = useState<MfaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [lockedOut, setLockedOut] = useState(false);
  const [unlockNotice, setUnlockNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const nextSession = data.session;
    setSession(nextSession);

    if (!nextSession) {
      setProfile(null);
      setMfa(null);
      setLoading(false);
      return;
    }

    const profileResult = await fetchOwnProfile();
    if (profileResult.data?.role === "pt") {
      setProfile(profileResult.data);
    } else if (profileResult.data) {
      setProfile(profileResult.data);
    } else {
      const ensured = await ensurePtProfile();
      setProfile(ensured.data);
    }

    const mfaResult = await getMfaStatus();
    setMfa(mfaResult.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (!next) {
        setProfile(null);
        setMfa(null);
        setLoading(false);
        return;
      }
      void refresh();
    });
    return () => sub.subscription.unsubscribe();
  }, [refresh]);

  useEffect(() => {
    if (!session) return;

    const stop = startIdleLockout({
      onLock: async () => {
        await clearAuthTokens();
        setSession(null);
        setProfile(null);
        setMfa(null);
        setLockedOut(true);
        setUnlockNotice(
          "Session locked after 10 minutes of inactivity. Sign in again to continue.",
        );
      },
    });

    return stop;
  }, [session]);

  const value = useMemo(
    () => ({
      session,
      profile,
      mfa,
      loading,
      lockedOut,
      refresh,
      unlockNotice,
    }),
    [session, profile, mfa, loading, lockedOut, refresh, unlockNotice],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
