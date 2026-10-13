-- Read-only audit against real Supabase-managed catalogs. No mock auth schema,
-- SET ROLE, request claims or test grants. Fixture setup uses local postgres only.
BEGIN;
CREATE FUNCTION pg_temp.require(ok boolean, description text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Security audit failed: %', description; END IF;
END;
$$;
SELECT pg_temp.require((SELECT count(*) = 4 AND bool_and(relrowsecurity AND relforcerowsecurity)
  FROM pg_class WHERE oid IN ('public.organizations'::regclass, 'public.organization_memberships'::regclass,
    'public.job_roles'::regclass, 'public.employees'::regclass)), 'FORCE RLS on all four tables');
SELECT pg_temp.require((SELECT count(*) = 8 FROM pg_policies WHERE schemaname = 'public'
  AND tablename IN ('organizations', 'organization_memberships', 'job_roles', 'employees')), 'eight scoped policies');
SELECT pg_temp.require(NOT EXISTS (SELECT FROM pg_policies WHERE schemaname = 'public'
  AND tablename IN ('organizations', 'organization_memberships', 'job_roles', 'employees')
  AND (roles <> ARRAY['authenticated']::name[] OR cmd NOT IN ('SELECT','INSERT','UPDATE')
    OR (tablename IN ('organizations','organization_memberships') AND cmd <> 'SELECT'))), 'policy role/operation boundaries');
SELECT pg_temp.require((SELECT prosecdef AND provolatile = 's' AND proconfig = ARRAY['search_path=""']
  AND pg_get_userbyid(proowner) = 'postgres' FROM pg_proc
  WHERE oid = 'tipsplitter_private.membership_role(uuid)'::regprocedure), 'helper owner/security/search path');
SELECT pg_temp.require((SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = 'postgres')
  AND has_table_privilege('postgres', 'public.organization_memberships', 'SELECT')
  AND has_function_privilege('postgres', 'auth.uid()', 'EXECUTE'), 'helper owner can read through FORCE RLS and resolve real auth.uid');
SELECT pg_temp.require(NOT EXISTS (SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prosecdef), 'no exposed SECURITY DEFINER RPC');
SELECT pg_temp.require((SELECT NOT prosecdef AND proconfig = ARRAY['search_path=""'] FROM pg_proc
  WHERE oid = 'public.set_roster_timestamps()'::regprocedure), 'invoker timestamp trigger');
SELECT pg_temp.require((SELECT count(*) = 3 AND bool_and(NOT rolcanlogin AND NOT rolsuper)
  AND bool_and(rolbypassrls = (rolname = 'service_role')) FROM pg_roles
  WHERE rolname IN ('anon','authenticated','service_role')), 'managed API role trust boundary');
SELECT pg_temp.require((SELECT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls FROM pg_roles WHERE rolname = 'authenticator'), 'unprivileged real API connection');
SELECT pg_temp.require(pg_has_role('authenticator','authenticated','MEMBER')
  AND pg_has_role('authenticator','anon','MEMBER') AND pg_has_role('authenticator','service_role','MEMBER'), 'real PostgREST role switching');
DO $$
DECLARE t text; r text; c text; allowed boolean;
BEGIN
  FOREACH t IN ARRAY ARRAY['organizations','organization_memberships','job_roles','employees'] LOOP
    FOREACH r IN ARRAY ARRAY['anon','service_role'] LOOP
      PERFORM pg_temp.require(NOT has_any_column_privilege(r, 'public.' || t, 'SELECT,INSERT,UPDATE,REFERENCES')
        AND NOT has_table_privilege(r, 'public.' || t, 'DELETE,TRUNCATE,TRIGGER'), r || ' effective table/column grants: ' || t);
    END LOOP;
    PERFORM pg_temp.require(has_table_privilege('authenticated', 'public.' || t, 'SELECT')
      AND NOT has_table_privilege('authenticated', 'public.' || t, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      AND NOT has_any_column_privilege('authenticated', 'public.' || t, 'REFERENCES'), 'authenticated table ACL: ' || t);
    FOR c IN SELECT attname FROM pg_attribute WHERE attrelid = ('public.' || t)::regclass AND attnum > 0 AND NOT attisdropped LOOP
      allowed := t IN ('job_roles','employees') AND c NOT IN ('id','created_at','updated_at');
      PERFORM pg_temp.require(has_column_privilege('authenticated','public.' || t,c,'INSERT') = allowed, t || '.' || c || ' INSERT');
      PERFORM pg_temp.require(has_column_privilege('authenticated','public.' || t,c,'UPDATE') = (allowed AND c <> 'organization_id'), t || '.' || c || ' UPDATE');
    END LOOP;
  END LOOP;
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    PERFORM pg_temp.require(NOT has_schema_privilege(r,'tipsplitter_private','CREATE'), 'no helper replacement: ' || r);
    PERFORM pg_temp.require(has_schema_privilege(r,'tipsplitter_private','USAGE') = (r = 'authenticated'), 'private schema usage: ' || r);
    PERFORM pg_temp.require(has_function_privilege(r,'tipsplitter_private.membership_role(uuid)','EXECUTE') = (r = 'authenticated'), 'helper EXECUTE: ' || r);
    PERFORM pg_temp.require(NOT has_function_privilege(r,'public.set_roster_timestamps()','EXECUTE'), 'no timestamp RPC: ' || r);
    -- service_role is platform-privileged for Auth administration; our custom
    -- application-table revokes do not change that managed trust boundary.
    IF r <> 'service_role' THEN
      PERFORM pg_temp.require(NOT has_any_column_privilege(r,'auth.users','SELECT,INSERT,UPDATE,REFERENCES')
        AND NOT has_table_privilege(r,'auth.users','DELETE,TRUNCATE,TRIGGER'), 'no direct account administration: ' || r);
    END IF;
  END LOOP;
END;
$$;
-- Effective has_* checks above include PUBLIC and inherited privileges; also
-- reject explicit PUBLIC grants on the application objects.
SELECT pg_temp.require(NOT EXISTS (SELECT FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
  WHERE c.oid IN ('public.organizations'::regclass,'public.organization_memberships'::regclass,
    'public.job_roles'::regclass,'public.employees'::regclass) AND a.grantee = 0), 'no PUBLIC table ACL');
ROLLBACK;
