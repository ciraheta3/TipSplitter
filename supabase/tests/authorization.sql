-- Concatenated after roster.sql in its rolled-back transaction. Synthetic identities
-- and simulated claims are ONLY for disposable PostgreSQL, never hosted Auth.
INSERT INTO auth.users (id)
SELECT ('10000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
FROM generate_series(1, 9) AS n;
INSERT INTO public.organization_memberships (organization_id, user_id, role)
SELECT '00000000-0000-0000-0000-000000000001', id,
  CASE WHEN right(id::text, 1) IN ('1', '3', '6') THEN 'admin' ELSE 'closer' END
FROM auth.users WHERE right(id::text, 1) IN ('1', '2', '3', '4', '6', '7');
INSERT INTO public.organization_memberships (organization_id, user_id, role)
SELECT '00000000-0000-0000-0000-000000000002', id,
  CASE WHEN right(id::text, 1) IN ('7', '8') THEN 'admin' ELSE 'closer' END
FROM auth.users WHERE right(id::text, 1) IN ('6', '7', '8', '9');
INSERT INTO public.employees (organization_id, name, default_role_id)
VALUES ('00000000-0000-0000-0000-000000000002', 'Synthetic B employee',
  '00000000-0000-0000-0000-000000001002');

CREATE FUNCTION pg_temp.login(user_number integer) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  -- Deliberately contradictory tenant/admin claims: only sub + DB membership count.
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', CASE WHEN user_number IS NOT NULL THEN
      '10000000-0000-0000-0000-' || lpad(user_number::text, 12, '0') END,
    'organization_id', '00000000-0000-0000-0000-000000000002',
    'role', 'authenticated', 'membership_role', 'admin')::text, true);
END;
$$;

-- Constraints on verified identities, per-org roles, lifecycle and timestamps.
SELECT pg_temp.expect_error($$INSERT INTO public.organization_memberships VALUES
  ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'closer', true, DEFAULT, DEFAULT)$$,
  '23505', 'one membership per organization/user');
SELECT pg_temp.expect_error($$INSERT INTO public.organization_memberships (organization_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000009999', 'admin')$$,
  '23503', 'membership requires existing Auth identity');
SELECT pg_temp.expect_error($$INSERT INTO public.organization_memberships (organization_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-000000000099', '10000000-0000-0000-0000-000000000005', 'admin')$$,
  '23503', 'membership requires existing organization');
SELECT pg_temp.expect_error($$UPDATE public.organization_memberships SET role = 'owner'$$,
  '23514', 'membership roles are constrained');
SELECT pg_temp.expect_error('UPDATE public.organization_memberships SET role = NULL', '23502', 'role required');
SELECT pg_temp.expect_error('UPDATE public.organization_memberships SET is_active = NULL', '23502', 'active state required');
SELECT pg_temp.expect_error($$DELETE FROM auth.users WHERE id = '10000000-0000-0000-0000-000000000001'$$,
  '23503', 'Auth deletion requires explicit trusted membership cleanup, never cascade roster');
DO $$
BEGIN
  UPDATE public.organization_memberships SET created_at = '2100-01-01Z', updated_at = '1999-01-01Z';
  PERFORM pg_temp.assert_true((SELECT bool_and(created_at < '2100-01-01Z' AND updated_at = statement_timestamp())
    FROM public.organization_memberships), 'membership timestamps managed by database');
END;
$$;
SELECT pg_temp.assert_true((SELECT relrowsecurity AND relforcerowsecurity FROM pg_class
  WHERE oid = 'public.organization_memberships'::regclass), 'membership FORCE RLS');
SELECT pg_temp.assert_true((SELECT prosecdef AND provolatile = 's' AND proconfig = ARRAY['search_path=""']
  AND pg_get_userbyid(proowner) = 'postgres' FROM pg_proc
  WHERE oid = 'tipsplitter_private.membership_role(uuid)'::regprocedure), 'fixed trusted helper owner and empty search path');
SELECT pg_temp.assert_true(NOT EXISTS (SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prosecdef), 'no exposed elevated functions');
SELECT pg_temp.assert_true((SELECT count(*) = 8 FROM pg_policies WHERE schemaname = 'public'
  AND tablename IN ('organizations', 'job_roles', 'employees', 'organization_memberships')),
  'only operation-specific read/roster insert/update policies');

DO $$
DECLARE table_name text; role_name text; column_name text; allowed boolean;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['organizations', 'organization_memberships', 'job_roles', 'employees'] LOOP
    FOREACH role_name IN ARRAY ARRAY['anon', 'service_role'] LOOP
      PERFORM pg_temp.assert_true(NOT has_any_column_privilege(role_name, 'public.' || table_name,
        'SELECT,INSERT,UPDATE,REFERENCES') AND NOT has_table_privilege(role_name, 'public.' || table_name,
        'DELETE,TRUNCATE,TRIGGER'), role_name || ' no table or column grants on ' || table_name);
    END LOOP;
    PERFORM pg_temp.assert_true(has_table_privilege('authenticated', 'public.' || table_name, 'SELECT')
      AND NOT has_table_privilege('authenticated', 'public.' || table_name,
        'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), 'authenticated SELECT only at table level: ' || table_name);
    FOR column_name IN SELECT attname FROM pg_attribute WHERE attrelid = ('public.' || table_name)::regclass
      AND attnum > 0 AND NOT attisdropped LOOP
      allowed := table_name IN ('job_roles', 'employees') AND column_name NOT IN ('id', 'created_at', 'updated_at');
      PERFORM pg_temp.assert_true(has_column_privilege('authenticated', 'public.' || table_name, column_name, 'INSERT') = allowed,
        table_name || '.' || column_name || ' INSERT ACL');
      allowed := allowed AND column_name <> 'organization_id';
      PERFORM pg_temp.assert_true(has_column_privilege('authenticated', 'public.' || table_name, column_name, 'UPDATE') = allowed,
        table_name || '.' || column_name || ' UPDATE ACL');
    END LOOP;
  END LOOP;
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    PERFORM pg_temp.assert_true(NOT has_function_privilege(role_name, 'public.set_roster_timestamps()', 'EXECUTE'),
      'timestamp function not client executable');
    PERFORM pg_temp.assert_true(NOT has_schema_privilege(role_name, 'tipsplitter_private', 'CREATE'),
      role_name || ' cannot replace helper');
  END LOOP;
  PERFORM pg_temp.assert_true(has_function_privilege('authenticated', 'tipsplitter_private.membership_role(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'tipsplitter_private.membership_role(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('service_role', 'tipsplitter_private.membership_role(uuid)', 'EXECUTE'), 'helper execute restricted');
  PERFORM pg_temp.assert_true(NOT EXISTS (
    SELECT FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
    WHERE c.oid IN ('public.organizations'::regclass, 'public.job_roles'::regclass,
      'public.employees'::regclass, 'public.organization_memberships'::regclass) AND a.grantee = 0), 'no PUBLIC table ACLs');
END;
$$;

CREATE FUNCTION pg_temp.forbidden_writes() RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE table_name text; column_name text; value_text text;
BEGIN
  PERFORM pg_temp.expect_error($q$INSERT INTO public.organizations (name) VALUES ('Self provisioning')$q$, '42501', 'no organization creation');
  PERFORM pg_temp.expect_error($q$UPDATE public.organizations SET name = 'Escalation'$q$, '42501', 'no organization rename');
  PERFORM pg_temp.expect_error($q$UPDATE public.organizations SET id = '00000000-0000-0000-0000-000000000099'$q$, '42501', 'no organization identity change');
  PERFORM pg_temp.expect_error($q$INSERT INTO public.organization_memberships (organization_id, user_id, role) VALUES
    ('00000000-0000-0000-0000-000000000002', auth.uid(), 'admin')$q$, '42501', 'no self invitation');
  FOREACH column_name IN ARRAY ARRAY['organization_id', 'user_id', 'role', 'is_active', 'created_at', 'updated_at'] LOOP
    value_text := CASE column_name
      WHEN 'organization_id' THEN $q$'00000000-0000-0000-0000-000000000002'$q$
      WHEN 'user_id' THEN $q$'10000000-0000-0000-0000-000000000005'$q$
      WHEN 'role' THEN $q$'admin'$q$ WHEN 'is_active' THEN 'true' ELSE $q$'2100-01-01Z'$q$ END;
    PERFORM pg_temp.expect_error(format('UPDATE public.organization_memberships SET %I = %s', column_name, value_text),
      '42501', 'no membership identity, promotion, reactivation or timestamp edits');
  END LOOP;
  FOREACH table_name IN ARRAY ARRAY['organizations', 'organization_memberships', 'job_roles', 'employees'] LOOP
    PERFORM pg_temp.expect_error(format('DELETE FROM public.%I', table_name), '42501', 'no permanent deletion: ' || table_name);
    PERFORM pg_temp.expect_error(format('TRUNCATE public.%I', table_name), '42501', 'no truncation: ' || table_name);
  END LOOP;
  FOREACH table_name IN ARRAY ARRAY['job_roles', 'employees'] LOOP
    PERFORM pg_temp.expect_error(format('UPDATE public.%I SET organization_id = %L', table_name,
      '00000000-0000-0000-0000-000000000002'), '42501', 'no tenant reassignment, even for dual members');
    PERFORM pg_temp.expect_error(format('UPDATE public.%I SET id = %L', table_name,
      '00000000-0000-0000-0000-000000009999'), '42501', 'no key reassignment');
    FOREACH column_name IN ARRAY ARRAY['created_at', 'updated_at'] LOOP
      PERFORM pg_temp.expect_error(format('UPDATE public.%I SET %I = %L', table_name, column_name, '2100-01-01Z'), '42501', 'no client timestamp edits');
    END LOOP;
    PERFORM pg_temp.expect_error(format('INSERT INTO public.%I (id) VALUES (%L)', table_name,
      '00000000-0000-0000-0000-000000009999'), '42501', 'no client-generated key');
  END LOOP;
  PERFORM pg_temp.expect_error('SELECT * FROM auth.users', '42501', 'no account access');
  PERFORM pg_temp.expect_error($q$UPDATE auth.users SET id = '10000000-0000-0000-0000-000000000005'$q$, '42501', 'no account administration');
  PERFORM pg_temp.expect_error($q$CREATE OR REPLACE FUNCTION tipsplitter_private.membership_role(uuid) RETURNS text
    LANGUAGE sql AS 'SELECT ''admin''::text'$q$, '42501', 'cannot replace elevated helper');
END;
$$;

CREATE FUNCTION pg_temp.no_roster_access(check_acl boolean DEFAULT true) RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE table_name text; visible bigint; affected bigint;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['organizations', 'organization_memberships', 'job_roles', 'employees'] LOOP
    IF has_table_privilege(current_user, 'public.' || table_name, 'SELECT') THEN
      EXECUTE format('SELECT count(*) FROM public.%I', table_name) INTO visible;
      PERFORM pg_temp.assert_true(visible = 0, 'no visible ' || table_name);
    ELSE
      PERFORM pg_temp.expect_error(format('SELECT * FROM public.%I', table_name), '42501', 'no read ACL');
    END IF;
  END LOOP;
  FOREACH table_name IN ARRAY ARRAY['job_roles', 'employees'] LOOP
    IF has_column_privilege(current_user, 'public.' || table_name, 'name', 'UPDATE') THEN
      EXECUTE format('UPDATE public.%I SET name = ''Forbidden''', table_name);
      GET DIAGNOSTICS affected = ROW_COUNT;
      PERFORM pg_temp.assert_true(affected = 0, 'RLS blocks nonmember update');
    ELSE
      PERFORM pg_temp.expect_error(format('UPDATE public.%I SET name = ''Forbidden''', table_name), '42501', 'no update ACL');
    END IF;
  END LOOP;
  PERFORM pg_temp.expect_error($q$INSERT INTO public.job_roles (organization_id, name, default_weight) VALUES
    ('00000000-0000-0000-0000-000000000001', 'Forbidden', 1)$q$, '42501', 'no roster role INSERT');
  PERFORM pg_temp.expect_error($q$INSERT INTO public.employees (organization_id, name, default_role_id) VALUES
    ('00000000-0000-0000-0000-000000000001', 'Forbidden', '00000000-0000-0000-0000-000000001001')$q$,
    '42501', 'no roster employee INSERT');
  IF check_acl THEN PERFORM pg_temp.forbidden_writes(); END IF;
END;
$$;

-- Anon with an active subject still has no ACL; authenticated with no sub, no
-- verified identity or no membership has no rows. Tenant/admin claims grant nothing.
SELECT pg_temp.login(1);
SET LOCAL ROLE anon;
SELECT pg_temp.no_roster_access();
RESET ROLE;
SELECT pg_temp.login(NULL);
SET LOCAL ROLE authenticated;
SELECT pg_temp.no_roster_access();
RESET ROLE;
SELECT pg_temp.login(5);
SET LOCAL ROLE authenticated;
SELECT pg_temp.no_roster_access();
RESET ROLE;
SELECT pg_temp.login(9999);
SET LOCAL ROLE authenticated;
SELECT pg_temp.no_roster_access();
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.no_roster_access();
RESET ROLE;

CREATE FUNCTION pg_temp.roster_access(org_id uuid, label text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE role_id uuid; employee_id uuid; affected bigint;
BEGIN
  PERFORM pg_temp.assert_true((SELECT count(*) = 1 FROM public.organizations WHERE id = org_id), 'own organization readable');
  PERFORM pg_temp.assert_true(EXISTS (SELECT FROM public.job_roles WHERE organization_id = org_id)
    AND EXISTS (SELECT FROM public.employees WHERE organization_id = org_id), 'own roster readable');
  INSERT INTO public.job_roles (organization_id, name, default_weight)
    VALUES (org_id, label, 0.25) RETURNING id INTO role_id;
  INSERT INTO public.employees (organization_id, name, default_role_id, default_weight_override)
    VALUES (org_id, label, role_id, 0) RETURNING id INTO employee_id;
  UPDATE public.job_roles SET name = label || ' edited', default_weight = 1.25, is_active = false WHERE id = role_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  PERFORM pg_temp.assert_true(affected = 1, 'member edits/deactivates role');
  UPDATE public.employees SET name = label || ' edited', default_weight_override = NULL, is_active = false WHERE id = employee_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  PERFORM pg_temp.assert_true(affected = 1, 'member edits/deactivates employee');
  UPDATE public.job_roles SET is_active = true WHERE id = role_id;
  UPDATE public.employees SET is_active = true WHERE id = employee_id;
  PERFORM pg_temp.assert_true((SELECT is_active AND default_weight = 1.25 FROM public.job_roles WHERE id = role_id)
    AND (SELECT is_active AND default_weight_override IS NULL AND updated_at = statement_timestamp()
      FROM public.employees WHERE id = employee_id), 'member reactivates; defaults/timestamps preserved');
  UPDATE public.employees SET default_role_id = CASE WHEN org_id = '00000000-0000-0000-0000-000000000001'::uuid
    THEN '00000000-0000-0000-0000-000000001001'::uuid ELSE '00000000-0000-0000-0000-000000001002'::uuid END
    WHERE id = employee_id;
  PERFORM pg_temp.expect_error(format('UPDATE public.job_roles SET default_weight = 0.001 WHERE id = %L', role_id),
    '23514', 'client weight precision still constrained');
END;
$$;

CREATE FUNCTION pg_temp.cross_tenant_denied(other_org uuid) RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE table_name text; affected bigint; visible bigint; other_role uuid;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['organizations', 'organization_memberships', 'job_roles', 'employees'] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %I = %L', table_name,
      CASE WHEN table_name = 'organizations' THEN 'id' ELSE 'organization_id' END, other_org) INTO visible;
    PERFORM pg_temp.assert_true(visible = 0, 'other tenant hidden: ' || table_name);
  END LOOP;
  FOREACH table_name IN ARRAY ARRAY['job_roles', 'employees'] LOOP
    EXECUTE format('UPDATE public.%I SET name = ''Stolen'' WHERE organization_id = %L', table_name, other_org);
    GET DIAGNOSTICS affected = ROW_COUNT;
    PERFORM pg_temp.assert_true(affected = 0, 'UPDATE USING blocks other tenant');
  END LOOP;
  PERFORM pg_temp.expect_error(format('INSERT INTO public.job_roles (organization_id, name, default_weight) VALUES (%L, ''Stolen'', 1)', other_org),
    '42501', 'INSERT WITH CHECK blocks other tenant');
  other_role := CASE WHEN other_org = '00000000-0000-0000-0000-000000000002'::uuid
    THEN '00000000-0000-0000-0000-000000001002'::uuid ELSE '00000000-0000-0000-0000-000000001001'::uuid END;
  PERFORM pg_temp.expect_error(format('INSERT INTO public.employees (organization_id, name, default_role_id) VALUES (%L, ''Stolen'', %L)', other_org, other_role),
    '42501', 'employee INSERT WITH CHECK blocks other tenant');
  PERFORM pg_temp.expect_error(format('UPDATE public.employees SET default_role_id = %L', other_role),
    '23503', 'same-tenant role FK remains enforced on client updates');
END;
$$;

-- A hostile search_path or a roster role named admin cannot elevate a closer.
SAVEPOINT helper_shadow;
CREATE TEMP TABLE organization_memberships (organization_id uuid, user_id uuid, role text, is_active boolean);
INSERT INTO pg_temp.organization_memberships VALUES ('00000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000002', 'admin', true);
CREATE FUNCTION pg_temp.uid() RETURNS uuid LANGUAGE sql AS
  'SELECT ''10000000-0000-0000-0000-000000000001''::uuid';
SELECT pg_temp.login(2);
SET LOCAL ROLE authenticated;
SET LOCAL search_path = pg_temp, public;
SELECT pg_temp.assert_true(tipsplitter_private.membership_role('00000000-0000-0000-0000-000000000001') = 'closer'
  AND tipsplitter_private.membership_role('00000000-0000-0000-0000-000000000002') IS NULL,
  'helper uses verified caller and qualified objects despite shadow identities/memberships');
INSERT INTO public.job_roles (organization_id, name, default_weight)
  VALUES ('00000000-0000-0000-0000-000000000001', 'admin', 1);
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.organization_memberships),
  'editing roster roles cannot grant account administrator privileges');
RESET ROLE;
ROLLBACK TO SAVEPOINT helper_shadow;

-- Both roles in each restaurant; dual members have different roles in each org.
DO $$
DECLARE user_number integer; org_a uuid := '00000000-0000-0000-0000-000000000001';
  org_b uuid := '00000000-0000-0000-0000-000000000002'; expected_members integer;
BEGIN
  FOREACH user_number IN ARRAY ARRAY[1, 2, 6, 7, 8, 9] LOOP
    PERFORM pg_temp.login(user_number);
    SET LOCAL ROLE authenticated;
    expected_members := CASE user_number WHEN 1 THEN 6 WHEN 2 THEN 1 WHEN 6 THEN 7 WHEN 7 THEN 5 WHEN 8 THEN 4 ELSE 1 END;
    PERFORM pg_temp.assert_true((SELECT count(*) = expected_members FROM public.organization_memberships),
      'own active membership plus admin same-org member list; roles scoped per org');
    IF user_number IN (1, 2, 6, 7) THEN
      PERFORM pg_temp.roster_access(org_a, 'Synthetic user ' || user_number || ' A');
    END IF;
    IF user_number IN (6, 7, 8, 9) THEN
      PERFORM pg_temp.roster_access(org_b, 'Synthetic user ' || user_number || ' B');
    END IF;
    IF user_number IN (1, 2) THEN PERFORM pg_temp.cross_tenant_denied(org_b); END IF;
    IF user_number IN (8, 9) THEN PERFORM pg_temp.cross_tenant_denied(org_a); END IF;
    PERFORM pg_temp.forbidden_writes();
    RESET ROLE;
  END LOOP;
END;
$$;

-- Revocation applies on the next statement with the SAME simulated JWT, for
-- both admin/closer. Revoking one restaurant leaves a dual member's other access.
DO $$
DECLARE user_number integer;
BEGIN
  FOREACH user_number IN ARRAY ARRAY[3, 4] LOOP
    PERFORM pg_temp.login(user_number);
    SET LOCAL ROLE authenticated;
    PERFORM pg_temp.assert_true(EXISTS (SELECT FROM public.employees), 'active before revocation');
    RESET ROLE;
    UPDATE public.organization_memberships SET is_active = false WHERE user_id = auth.uid();
    SET LOCAL ROLE authenticated;
    PERFORM pg_temp.no_roster_access();
    RESET ROLE;
  END LOOP;
END;
$$;
SELECT pg_temp.login(6);
UPDATE public.organization_memberships SET is_active = false
  WHERE user_id = auth.uid() AND organization_id = '00000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT pg_temp.cross_tenant_denied('00000000-0000-0000-0000-000000000001');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.organization_memberships), 'dual member retains only B closer membership');
SELECT pg_temp.roster_access('00000000-0000-0000-0000-000000000002', 'Synthetic retained B access');
RESET ROLE;
SELECT pg_temp.expect_error($$DELETE FROM auth.users WHERE id = '10000000-0000-0000-0000-000000000003'$$,
  '23503', 'inactive memberships also block implicit Auth deletion');
-- Active admin can inspect inactive members; revoked users cannot inspect even self.
SELECT pg_temp.login(1);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true((SELECT count(*) = 3 FROM public.organization_memberships WHERE NOT is_active), 'admin reads same-org revoked records');
RESET ROLE;

-- Test RLS separately from ACLs. Additional privileges are test-only and revoked
-- by rolling back the savepoint. This is NOT a proposed application grant.
SAVEPOINT rls_only;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations, public.organization_memberships,
  public.job_roles, public.employees TO anon, authenticated;
SELECT pg_temp.login(1);
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error($$UPDATE public.job_roles SET organization_id = '00000000-0000-0000-0000-000000000002'
  WHERE name = 'Synthetic user 1 A edited'$$, '42501', 'UPDATE WITH CHECK rejects new unauthorized tenant');
SELECT pg_temp.expect_error($$UPDATE public.employees SET organization_id = '00000000-0000-0000-0000-000000000002',
  default_role_id = '00000000-0000-0000-0000-000000001002' WHERE name = 'Synthetic user 1 A edited'$$,
  '42501', 'employee UPDATE WITH CHECK rejects new unauthorized tenant');
DO $$
DECLARE table_name text; affected bigint;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['organizations', 'organization_memberships', 'job_roles', 'employees'] LOOP
    EXECUTE format('DELETE FROM public.%I', table_name);
    GET DIAGNOSTICS affected = ROW_COUNT;
    PERFORM pg_temp.assert_true(affected = 0, 'RLS has no delete policy');
  END LOOP;
  UPDATE public.organization_memberships SET role = 'admin', is_active = true;
  GET DIAGNOSTICS affected = ROW_COUNT;
  PERFORM pg_temp.assert_true(affected = 0, 'no membership UPDATE policy');
  UPDATE public.organizations SET name = 'Forbidden';
  GET DIAGNOSTICS affected = ROW_COUNT;
  PERFORM pg_temp.assert_true(affected = 0, 'no organization UPDATE policy');
  PERFORM pg_temp.expect_error($q$INSERT INTO public.organization_memberships (organization_id, user_id, role)
    VALUES ('00000000-0000-0000-0000-000000000002', auth.uid(), 'admin')$q$, '42501', 'no membership INSERT policy');
  PERFORM pg_temp.expect_error($q$INSERT INTO public.organizations (name) VALUES ('Forbidden')$q$, '42501', 'no organization INSERT policy');
END;
$$;
RESET ROLE;
-- No policies target anon, even when its subject is an active admin.
SET LOCAL ROLE anon;
SELECT pg_temp.no_roster_access(false);
RESET ROLE;
SELECT pg_temp.login(5);
SET LOCAL ROLE authenticated;
SELECT pg_temp.no_roster_access(false);
RESET ROLE;
ROLLBACK TO SAVEPOINT rls_only;

ROLLBACK;
\echo 'Roster and authorization assertions passed; all fixtures and test-only grants rolled back.'
