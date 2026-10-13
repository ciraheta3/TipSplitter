-- Forward-only authorization foundation; Supabase owns auth.users and auth.uid().
BEGIN;

CREATE TABLE public.organization_memberships (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('admin', 'closer')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (organization_id, user_id)
);

-- The primary key supports org member lists; this supports per-user authorization
-- and the auth.users FK. Inactive records remain for explicit trusted lifecycle work.
CREATE INDEX organization_memberships_user_organization_idx
  ON public.organization_memberships (user_id, organization_id);
CREATE TRIGGER organization_memberships_set_timestamps
  BEFORE UPDATE ON public.organization_memberships
  FOR EACH ROW EXECUTE FUNCTION public.set_roster_timestamps();
ALTER TABLE public.organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_memberships FORCE ROW LEVEL SECURITY;

-- Membership policies cannot recursively query their own RLS-protected table.
-- Use the fixed trusted Supabase migration owner for this single read-only lookup.
-- Fail closed if that owner cannot bypass FORCE RLS (rather than recurse at runtime).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles
      WHERE rolname = 'postgres' AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Authorization helper requires trusted postgres owner with BYPASSRLS';
  END IF;
END;
$$;

-- Keep this schema out of PostgREST's exposed schemas. SQL policies need USAGE.
CREATE SCHEMA tipsplitter_private AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA tipsplitter_private FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA tipsplitter_private TO authenticated;

CREATE FUNCTION tipsplitter_private.membership_role(target_organization uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT m.role FROM public.organization_memberships AS m
  WHERE m.organization_id = target_organization
    AND m.user_id = (SELECT auth.uid()) AND m.is_active;
$$;
ALTER FUNCTION tipsplitter_private.membership_role(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION tipsplitter_private.membership_role(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION tipsplitter_private.membership_role(uuid) TO authenticated;

-- Remove possible platform default grants; clients get only the following ACLs.
REVOKE ALL ON TABLE public.organizations, public.job_roles, public.employees,
  public.organization_memberships FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.organizations, public.job_roles, public.employees,
  public.organization_memberships TO authenticated;
-- Server-generated IDs/timestamps cannot be supplied or changed by clients.
GRANT INSERT (organization_id, name, default_weight, is_active)
  ON public.job_roles TO authenticated;
GRANT UPDATE (name, default_weight, is_active) ON public.job_roles TO authenticated;
GRANT INSERT (organization_id, name, default_role_id, default_weight_override, is_active)
  ON public.employees TO authenticated;
GRANT UPDATE (name, default_role_id, default_weight_override, is_active)
  ON public.employees TO authenticated;

CREATE POLICY organizations_member_select ON public.organizations
  FOR SELECT TO authenticated
  USING (tipsplitter_private.membership_role(id) IN ('admin', 'closer'));

CREATE POLICY memberships_member_select ON public.organization_memberships
  FOR SELECT TO authenticated
  USING (
    (user_id = (SELECT auth.uid()) AND is_active
      AND tipsplitter_private.membership_role(organization_id) IN ('admin', 'closer'))
    OR tipsplitter_private.membership_role(organization_id) = 'admin'
  );

CREATE POLICY job_roles_member_select ON public.job_roles
  FOR SELECT TO authenticated
  USING (tipsplitter_private.membership_role(organization_id) IN ('admin', 'closer'));
CREATE POLICY job_roles_member_insert ON public.job_roles
  FOR INSERT TO authenticated
  WITH CHECK (tipsplitter_private.membership_role(organization_id) IN ('admin', 'closer'));
CREATE POLICY job_roles_member_update ON public.job_roles
  FOR UPDATE TO authenticated
  USING (tipsplitter_private.membership_role(organization_id) IN ('admin', 'closer'))
  WITH CHECK (tipsplitter_private.membership_role(organization_id) IN ('admin', 'closer'));

CREATE POLICY employees_member_select ON public.employees
  FOR SELECT TO authenticated
  USING (tipsplitter_private.membership_role(organization_id) IN ('admin', 'closer'));
CREATE POLICY employees_member_insert ON public.employees
  FOR INSERT TO authenticated
  WITH CHECK (tipsplitter_private.membership_role(organization_id) IN ('admin', 'closer'));
CREATE POLICY employees_member_update ON public.employees
  FOR UPDATE TO authenticated
  USING (tipsplitter_private.membership_role(organization_id) IN ('admin', 'closer'))
  WITH CHECK (tipsplitter_private.membership_role(organization_id) IN ('admin', 'closer'));

COMMENT ON TABLE public.organizations IS 'Restaurant tenant boundary; active members may read, trusted provisioning only may write.';
COMMENT ON TABLE public.organization_memberships IS 'Trusted provisioned per-restaurant Auth memberships; inactive means revoked. No client writes.';
COMMENT ON FUNCTION tipsplitter_private.membership_role(uuid) IS 'Private RLS helper: only the verified caller active membership role, never an arbitrary user lookup.';

COMMIT;
