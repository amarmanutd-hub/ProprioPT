import { generateAccessCode } from "../lib/accessCode";
import type { CarePlan, PatientAssignment } from "../lib/database.types";
import { supabase } from "../lib/supabase";

const MAX_CODE_ATTEMPTS = 8;

export type CreateAssignmentInput = {
  ptId: string;
  patientName: string;
  carePlan: CarePlan;
};

export type CreateAssignmentResult = {
  assignment: PatientAssignment;
  accessCode: string;
  inviteUrl: string;
};

function inviteBase(): string {
  return import.meta.env.VITE_PORTAL_ORIGIN || window.location.origin;
}

export async function listAssignmentsForPt(ptId: string): Promise<PatientAssignment[]> {
  const { data, error } = await supabase
    .from("patient_assignments")
    .select("*")
    .eq("pt_id", ptId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function createPatientAssignment(
  input: CreateAssignmentInput,
): Promise<CreateAssignmentResult> {
  const carePlan: CarePlan = {
    ...input.carePlan,
    notes: input.carePlan.notes?.trim() || undefined,
    limits: input.carePlan.limits,
    exercises: input.carePlan.exercises.map((ex) => ({
      ...ex,
      name: ex.name.trim(),
    })),
  };

  carePlan.exercises = carePlan.exercises.filter((ex) => ex.name.length > 0);
  if (carePlan.exercises.length === 0) {
    throw new Error("Add at least one exercise to the care plan");
  }

  const patientLabel = input.patientName.trim();
  if (!patientLabel) throw new Error("Patient name is required");

  const planWithPatient: CarePlan = {
    ...carePlan,
    patient_display_name: patientLabel,
  };

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const accessCode = generateAccessCode();
    const { data, error } = await supabase
      .from("patient_assignments")
      .insert({
        pt_id: input.ptId,
        patient_id: null,
        access_code: accessCode,
        care_plan: planWithPatient,
      })
      .select("*")
      .single();

    if (!error && data) {
      await supabase.from("audit_logs").insert({
        actor_id: input.ptId,
        action: "create_patient_assignment",
        target_id: data.id,
      });

      return {
        assignment: data,
        accessCode,
        inviteUrl: `${inviteBase()}/activate?code=${encodeURIComponent(accessCode)}`,
      };
    }

    lastError = error ?? new Error("Failed to create assignment");
    // Unique violation on access_code — retry with a new code.
    if (error && error.code !== "23505") break;
  }

  throw lastError ?? new Error("Unable to allocate a unique access code");
}
