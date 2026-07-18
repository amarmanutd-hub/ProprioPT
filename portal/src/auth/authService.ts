import type { AuthError, Factor, Session, User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import type { Profile } from "../lib/database.types";

export type AuthResult<T> = { data: T; error: null } | { data: null; error: AuthError | Error };

function portalOrigin(): string {
  return import.meta.env.VITE_PORTAL_ORIGIN || window.location.origin;
}

export async function signInWithPasskey(): Promise<AuthResult<Session>> {
  const { data, error } = await supabase.auth.signInWithPasskey();
  if (error) return { data: null, error };
  if (!data.session) return { data: null, error: new Error("Passkey sign-in returned no session") };
  return { data: data.session, error: null };
}

/** Passwordless magic-link fallback (email OTP link). */
export async function sendMagicLink(email: string): Promise<AuthResult<true>> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return { data: null, error: new Error("Email is required") };

  const { error } = await supabase.auth.signInWithOtp({
    email: normalized,
    options: {
      emailRedirectTo: `${portalOrigin()}/auth/callback`,
      data: { role: "pt" },
      shouldCreateUser: true,
    },
  });

  if (error) return { data: null, error };
  return { data: true, error: null };
}

/** Register a platform passkey for the current therapist session (Face ID / Touch ID). */
export async function enrollPasskey(_friendlyName?: string): Promise<AuthResult<{ id: string }>> {
  const { data, error } = await supabase.auth.registerPasskey();
  if (error) return { data: null, error };
  return { data: { id: data.id }, error: null };
}

export async function getSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function getUser(): Promise<User | null> {
  const { data } = await supabase.auth.getUser();
  return data.user;
}

export async function fetchOwnProfile(): Promise<AuthResult<Profile>> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) return { data: null, error: userError };
  if (!userData.user) return { data: null, error: new Error("Not authenticated") };

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (error) return { data: null, error };
  if (!data) return { data: null, error: new Error("Profile not found") };
  return { data, error: null };
}

export async function ensurePtProfile(fullName?: string): Promise<AuthResult<Profile>> {
  const existing = await fetchOwnProfile();
  if (existing.data) {
    if (existing.data.role !== "pt") {
      return { data: null, error: new Error("This account is registered as a patient, not a therapist") };
    }
    if (fullName && !existing.data.full_name) {
      const { data, error } = await supabase
        .from("profiles")
        .update({ full_name: fullName })
        .eq("id", existing.data.id)
        .select("*")
        .single();
      if (error) return { data: null, error };
      return { data, error: null };
    }
    return existing;
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) return { data: null, error: userError };
  if (!userData.user) return { data: null, error: new Error("Not authenticated") };

  const { data, error } = await supabase
    .from("profiles")
    .upsert(
      {
        id: userData.user.id,
        role: "pt",
        full_name: fullName ?? userData.user.user_metadata?.full_name ?? null,
      },
      { onConflict: "id" },
    )
    .select("*")
    .single();

  if (error) return { data: null, error };
  if (data.role !== "pt") {
    return { data: null, error: new Error("Unable to elevate account to therapist role") };
  }
  return { data, error: null };
}

/** Clears in-memory + persisted Supabase auth tokens (clinical lockout). */
export async function clearAuthTokens(): Promise<void> {
  await supabase.auth.signOut({ scope: "local" });
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

export type MfaStatus = {
  currentLevel: string | null;
  nextLevel: string | null;
  totpFactors: Factor[];
  needsEnrollment: boolean;
  needsChallenge: boolean;
};

export async function getMfaStatus(): Promise<AuthResult<MfaStatus>> {
  const { data: aal, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aalError) return { data: null, error: aalError };

  const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
  if (factorsError) return { data: null, error: factorsError };

  const totpFactors = factors.totp.filter((f) => f.status === "verified");
  const currentLevel = aal.currentLevel;
  const nextLevel = aal.nextLevel;
  const needsEnrollment = totpFactors.length === 0;
  const needsChallenge =
    !needsEnrollment && nextLevel === "aal2" && currentLevel !== "aal2";

  return {
    data: {
      currentLevel,
      nextLevel,
      totpFactors,
      needsEnrollment,
      needsChallenge,
    },
    error: null,
  };
}

export async function enrollTotp(): Promise<
  AuthResult<{ factorId: string; qrCode: string; secret: string }>
> {
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "Proprio Therapist MFA",
  });
  if (error) return { data: null, error };
  return {
    data: {
      factorId: data.id,
      qrCode: data.totp.qr_code,
      secret: data.totp.secret,
    },
    error: null,
  };
}

export async function verifyTotpEnrollment(
  factorId: string,
  code: string,
): Promise<AuthResult<Session>> {
  const challenge = await supabase.auth.mfa.challenge({ factorId });
  if (challenge.error) return { data: null, error: challenge.error };

  const verified = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.data.id,
    code: code.trim(),
  });
  if (verified.error) return { data: null, error: verified.error };

  const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
    access_token: verified.data.access_token,
    refresh_token: verified.data.refresh_token,
  });
  if (sessionError) return { data: null, error: sessionError };
  if (!sessionData.session) {
    return { data: null, error: new Error("MFA verification returned no session") };
  }
  return { data: sessionData.session, error: null };
}

export async function challengeTotp(factorId: string, code: string): Promise<AuthResult<Session>> {
  return verifyTotpEnrollment(factorId, code);
}
