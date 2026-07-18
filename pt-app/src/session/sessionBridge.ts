/**
 * Persist completed clinical sessions to Supabase (patient RLS).
 * No-op when env/session missing so local camera demos still work.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ClinicalSessionPayload } from "../export/ClinicalSessionExport";

const CARE_PLAN_KEY = "proprio.carePlan";
const ASSIGNMENT_KEY = "proprio.assignmentId";

export type EmbeddedCarePlan = {
  notes?: string;
  patient_display_name?: string;
  exercises: Array<{
    name: string;
    sets?: number;
    reps?: number;
    cues?: string;
  }>;
};

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient | null {
  if (client) return client;
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !anon) return null;
  client = createClient(url, anon, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  return client;
}

export function readEmbeddedCarePlan(): EmbeddedCarePlan | null {
  try {
    const raw = sessionStorage.getItem(CARE_PLAN_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as EmbeddedCarePlan;
  } catch {
    return null;
  }
}

export function targetRepsFromCarePlan(plan: EmbeddedCarePlan | null): number | null {
  if (!plan?.exercises?.length) return null;
  const squatish =
    plan.exercises.find((e) => /squat|sit.?to.?stand/i.test(e.name)) ??
    plan.exercises[0];
  return squatish?.reps && squatish.reps > 0 ? squatish.reps : null;
}

export async function persistExerciseSession(
  payload: ClinicalSessionPayload,
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const sb = getClient();
  if (!sb) return { ok: false, reason: "supabase_env_missing" };

  const {
    data: { session },
  } = await sb.auth.getSession();
  if (!session?.user) return { ok: false, reason: "not_authenticated" };

  const assignmentId = sessionStorage.getItem(ASSIGNMENT_KEY);
  const carePlan = readEmbeddedCarePlan();

  const { data, error } = await sb
    .from("exercise_sessions")
    .insert({
      patient_id: session.user.id,
      metrics_summary: {
        ...payload,
        assignmentId,
        carePlanPatientName: carePlan?.patient_display_name ?? null,
        carePlanNotes: carePlan?.notes ?? null,
      },
    })
    .select("id")
    .single();

  if (error) return { ok: false, reason: error.message };
  return { ok: true, id: data.id as string };
}
