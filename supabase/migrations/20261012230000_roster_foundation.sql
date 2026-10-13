-- Roster foundation only. Apply once, in order, as a migration owner.
-- Supabase supplies anon/authenticated/service_role; plain PostgreSQL validation
-- supplies those role names in its disposable test fixture, never in this migration.
BEGIN;

CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (
    name = btrim(name) AND char_length(name) BETWEEN 1 AND 160
    AND name ~ '[^[:space:]]'
  ),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp()
);

CREATE TABLE public.job_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (
    name = btrim(name) AND char_length(name) BETWEEN 1 AND 100
    AND name ~ '[^[:space:]]'
  ),
  -- Unconstrained numeric avoids numeric(p, 2)'s silent rounding before CHECK.
  -- One displayed share = 100 integer engine units; reject excess precision.
  default_weight numeric NOT NULL CHECK (
    default_weight BETWEEN 0 AND 90071992547409.91
    AND scale(default_weight) <= 2
  ),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  UNIQUE (organization_id, id)
);

CREATE UNIQUE INDEX job_roles_organization_name_key
  ON public.job_roles (organization_id, lower(name));

CREATE TABLE public.employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (
    name = btrim(name) AND char_length(name) BETWEEN 1 AND 160
    AND name ~ '[^[:space:]]'
  ),
  -- A roster default, not a permanent assignment or a shift snapshot.
  default_role_id uuid NOT NULL,
  default_weight_override numeric CHECK (
    default_weight_override BETWEEN 0 AND 90071992547409.91
    AND scale(default_weight_override) <= 2
  ),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT employees_default_role_same_organization_fkey
    FOREIGN KEY (organization_id, default_role_id)
    REFERENCES public.job_roles (organization_id, id) ON DELETE RESTRICT
);

-- Covers organization lookups and the composite role FK's referencing side.
CREATE INDEX employees_organization_default_role_idx
  ON public.employees (organization_id, default_role_id);

CREATE FUNCTION public.set_roster_timestamps()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.created_at := OLD.created_at;
  NEW.updated_at := statement_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER organizations_set_timestamps BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.set_roster_timestamps();
CREATE TRIGGER job_roles_set_timestamps BEFORE UPDATE ON public.job_roles
  FOR EACH ROW EXECUTE FUNCTION public.set_roster_timestamps();
CREATE TRIGGER employees_set_timestamps BEFORE UPDATE ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.set_roster_timestamps();

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.job_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_roles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees FORCE ROW LEVEL SECURITY;

-- No policies. Also remove Supabase's possible inherited default ACL grants.
-- FORCE RLS includes ordinary owners, but superusers/BYPASSRLS remain trusted.
REVOKE ALL ON TABLE public.organizations, public.job_roles, public.employees
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_roster_timestamps()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE public.organizations IS 'Restaurant/workspace tenant boundary; no client access until membership authorization is implemented.';
COMMENT ON TABLE public.job_roles IS 'Organization-scoped configurable roster roles; defaults are not historical shift weights.';
COMMENT ON TABLE public.employees IS 'Organization-scoped roster defaults; default role must belong to the same organization.';
COMMENT ON COLUMN public.job_roles.default_weight IS 'Displayed shares, exact nonnegative hundredths; multiply by 100 for existing engine weightUnits.';
COMMENT ON COLUMN public.employees.default_weight_override IS 'NULL inherits role default; zero explicitly overrides to zero shares.';

COMMIT;
