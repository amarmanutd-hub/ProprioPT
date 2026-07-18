export type ProfileRole = "patient" | "pt";

export type Profile = {
  id: string;
  role: ProfileRole;
  full_name: string | null;
  created_at: string;
};

export type CarePlan = {
  notes?: string;
  patient_display_name?: string;
  exercises: Array<{
    name: string;
    sets?: number;
    reps?: number;
    cues?: string;
  }>;
};

export type PatientAssignment = {
  id: string;
  pt_id: string;
  patient_id: string | null;
  access_code: string | null;
  care_plan: CarePlan | null;
  created_at: string;
};

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: {
          id: string;
          role: ProfileRole;
          full_name?: string | null;
          created_at?: string;
        };
        Update: {
          role?: ProfileRole;
          full_name?: string | null;
        };
        Relationships: [];
      };
      patient_assignments: {
        Row: PatientAssignment;
        Insert: {
          id?: string;
          pt_id: string;
          patient_id?: string | null;
          access_code?: string | null;
          care_plan?: CarePlan | null;
          created_at?: string;
        };
        Update: {
          patient_id?: string | null;
          access_code?: string | null;
          care_plan?: CarePlan | null;
        };
        Relationships: [];
      };
      exercise_sessions: {
        Row: {
          id: string;
          patient_id: string;
          metrics_summary: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          patient_id: string;
          metrics_summary?: Json | null;
          created_at?: string;
        };
        Update: {
          metrics_summary?: Json | null;
        };
        Relationships: [];
      };
      audit_logs: {
        Row: {
          id: string;
          actor_id: string;
          action: string;
          target_id: string | null;
          timestamp: string;
        };
        Insert: {
          id?: string;
          actor_id: string;
          action: string;
          target_id?: string | null;
          timestamp?: string;
        };
        Update: {
          action?: never;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      activate_patient_token: {
        Args: { input_code: string; patient_uuid: string };
        Returns: PatientAssignment;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
