-- Proprio core schema: profiles, assignments, sessions, audit + RLS + token activation

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('patient', 'pt')),
  full_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.patient_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pt_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  patient_id uuid UNIQUE REFERENCES public.profiles (id) ON DELETE SET NULL,
  access_code text UNIQUE,
  care_plan jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT patient_assignments_pt_not_patient CHECK (pt_id IS DISTINCT FROM patient_id)
);

CREATE TABLE public.exercise_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  metrics_summary jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL,
  action text NOT NULL,
  target_id uuid,
  "timestamp" timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 2. Performance indexes (FK + conditional lookup columns)
-- ---------------------------------------------------------------------------

CREATE INDEX idx_patient_assignments_pt_id
  ON public.patient_assignments (pt_id);

CREATE INDEX idx_patient_assignments_patient_id
  ON public.patient_assignments (patient_id);

CREATE INDEX idx_patient_assignments_access_code
  ON public.patient_assignments (access_code)
  WHERE access_code IS NOT NULL;

CREATE INDEX idx_exercise_sessions_patient_id
  ON public.exercise_sessions (patient_id);

CREATE INDEX idx_audit_logs_actor_id
  ON public.audit_logs (actor_id);

CREATE INDEX idx_audit_logs_timestamp
  ON public.audit_logs ("timestamp" DESC);

-- ---------------------------------------------------------------------------
-- 3. Immutable audit_logs: block UPDATE / DELETE at the table level
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.deny_audit_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is immutable';
END;
$$;

CREATE TRIGGER audit_logs_deny_update
  BEFORE UPDATE ON public.audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.deny_audit_log_mutation();

CREATE TRIGGER audit_logs_deny_delete
  BEFORE DELETE ON public.audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.deny_audit_log_mutation();

-- Auto-create profile from auth.users metadata (role defaults to patient)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_role text;
BEGIN
  new_role := COALESCE(NEW.raw_user_meta_data->>'role', 'patient');
  IF new_role NOT IN ('patient', 'pt') THEN
    new_role := 'patient';
  END IF;

  INSERT INTO public.profiles (id, role, full_name)
  VALUES (
    NEW.id,
    new_role,
    NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data->>'full_name', '')), '')
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 4. activate_patient_token (SECURITY DEFINER)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.activate_patient_token(
  input_code text,
  patient_uuid uuid
)
RETURNS public.patient_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized_code text;
  assignment public.patient_assignments;
  caller uuid;
BEGIN
  caller := auth.uid();

  IF caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF patient_uuid IS DISTINCT FROM caller THEN
    RAISE EXCEPTION 'patient_uuid must match authenticated user';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = caller
      AND p.role = 'patient'
  ) THEN
    RAISE EXCEPTION 'only patient profiles can claim an access code';
  END IF;

  normalized_code := upper(trim(input_code));
  IF normalized_code IS NULL OR normalized_code = '' THEN
    RAISE EXCEPTION 'access code is required';
  END IF;

  UPDATE public.patient_assignments pa
  SET
    patient_id = patient_uuid,
    access_code = NULL
  WHERE pa.id = (
    SELECT a.id
    FROM public.patient_assignments a
    WHERE a.access_code = normalized_code
      AND a.patient_id IS NULL
    FOR UPDATE
    LIMIT 1
  )
  RETURNING * INTO assignment;

  IF assignment.id IS NULL THEN
    RAISE EXCEPTION 'invalid or already claimed access code';
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, target_id)
  VALUES (caller, 'activate_patient_token', assignment.id);

  RETURN assignment;
END;
$$;

REVOKE ALL ON FUNCTION public.activate_patient_token(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_patient_token(text, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Row Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exercise_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.patient_assignments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.exercise_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs FORCE ROW LEVEL SECURITY;

-- profiles: own row only; role is immutable after insert
CREATE OR REPLACE FUNCTION public.protect_profile_role()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.role IS DISTINCT FROM NEW.role THEN
    RAISE EXCEPTION 'profile role cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_protect_role
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_role();

CREATE POLICY profiles_select_own
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = id);

CREATE POLICY profiles_insert_own
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = id);

CREATE POLICY profiles_update_own
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = id)
  WITH CHECK ((SELECT auth.uid()) = id);

-- patient_assignments: patient read
CREATE POLICY patient_assignments_select_patient
  ON public.patient_assignments
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = patient_id);

-- patient_assignments: PT full CRUD
CREATE POLICY patient_assignments_select_pt
  ON public.patient_assignments
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = pt_id);

CREATE POLICY patient_assignments_insert_pt
  ON public.patient_assignments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = pt_id
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
        AND p.role = 'pt'
    )
  );

CREATE POLICY patient_assignments_update_pt
  ON public.patient_assignments
  FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = pt_id)
  WITH CHECK ((SELECT auth.uid()) = pt_id);

CREATE POLICY patient_assignments_delete_pt
  ON public.patient_assignments
  FOR DELETE
  TO authenticated
  USING ((SELECT auth.uid()) = pt_id);

-- exercise_sessions: patient read + write own rows
CREATE POLICY exercise_sessions_select_patient
  ON public.exercise_sessions
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = patient_id);

CREATE POLICY exercise_sessions_insert_patient
  ON public.exercise_sessions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = patient_id
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
        AND p.role = 'patient'
    )
  );

-- exercise_sessions: PT read via active assignment
CREATE POLICY exercise_sessions_select_pt
  ON public.exercise_sessions
  FOR SELECT
  TO authenticated
  USING (
    patient_id IN (
      SELECT pa.patient_id
      FROM public.patient_assignments pa
      WHERE pa.pt_id = (SELECT auth.uid())
        AND pa.patient_id IS NOT NULL
    )
  );

-- audit_logs: actors can read their own rows; inserts via SECURITY DEFINER / matching actor
CREATE POLICY audit_logs_select_own
  ON public.audit_logs
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = actor_id);

CREATE POLICY audit_logs_insert_own
  ON public.audit_logs
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = actor_id);

-- Grants
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.patient_assignments TO authenticated;
GRANT SELECT, INSERT ON public.exercise_sessions TO authenticated;
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
