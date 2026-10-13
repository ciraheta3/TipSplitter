-- Synthetic fixtures and temporary access grants are rolled back at the end.
-- Run as the disposable database superuser, with psql ON_ERROR_STOP enabled.
BEGIN;

CREATE FUNCTION pg_temp.assert_true(condition boolean, message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF condition IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Assertion failed: %', message;
  END IF;
END;
$$;

CREATE FUNCTION pg_temp.expect_error(command text, expected_state text, message text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual_state text;
BEGIN
  BEGIN
    EXECUTE command;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS actual_state = RETURNED_SQLSTATE;
    IF actual_state = expected_state THEN RETURN; END IF;
    RAISE EXCEPTION '%: expected SQLSTATE %, got % (%)', message, expected_state, actual_state, SQLERRM;
  END;
  RAISE EXCEPTION '%: expected SQLSTATE %, command succeeded', message, expected_state;
END;
$$;

INSERT INTO public.organizations (id, name, created_at, updated_at) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Synthetic organization A', '2000-01-01Z', '2000-01-01Z'),
  ('00000000-0000-0000-0000-000000000002', 'Synthetic organization B', DEFAULT, DEFAULT);
INSERT INTO public.job_roles (id, organization_id, name, default_weight, created_at, updated_at) VALUES
  ('00000000-0000-0000-0000-000000001001', '00000000-0000-0000-0000-000000000001', 'Synthetic server', 100, '2000-01-01Z', '2000-01-01Z'),
  ('00000000-0000-0000-0000-000000001002', '00000000-0000-0000-0000-000000000002', 'Synthetic server', 50, DEFAULT, DEFAULT),
  ('00000000-0000-0000-0000-000000001003', '00000000-0000-0000-0000-000000000001', 'Custom specialty', 0.25, DEFAULT, DEFAULT);
INSERT INTO public.employees (id, organization_id, name, default_role_id, default_weight_override, created_at, updated_at) VALUES
  ('00000000-0000-0000-0000-000000002001', '00000000-0000-0000-0000-000000000001', 'Synthetic employee', '00000000-0000-0000-0000-000000001001', NULL, '2000-01-01Z', '2000-01-01Z'),
  ('00000000-0000-0000-0000-000000002002', '00000000-0000-0000-0000-000000000001', 'Synthetic employee', '00000000-0000-0000-0000-000000001001', 0, DEFAULT, DEFAULT),
  ('00000000-0000-0000-0000-000000002003', '00000000-0000-0000-0000-000000000001', 'Synthetic fraction', '00000000-0000-0000-0000-000000001003', 0.01, DEFAULT, DEFAULT);

SELECT pg_temp.assert_true(
  (SELECT array_agg(coalesce(e.default_weight_override, r.default_weight) * 100 ORDER BY e.id)
   FROM public.employees e JOIN public.job_roles r
     ON (e.organization_id, e.default_role_id) = (r.organization_id, r.id))
   = ARRAY[10000, 0, 1]::numeric[],
  'NULL inherits the role weight, zero overrides it, exact hundredths map to integer units');

SELECT pg_temp.expect_error(
  $$INSERT INTO public.employees (organization_id, name, default_role_id) VALUES
    ('00000000-0000-0000-0000-000000000001', 'Cross tenant', '00000000-0000-0000-0000-000000001002')$$,
  '23503', 'cross-organization role INSERT');
SELECT pg_temp.expect_error(
  $$UPDATE public.employees SET default_role_id = '00000000-0000-0000-0000-000000001002'
    WHERE id = '00000000-0000-0000-0000-000000002001'$$,
  '23503', 'cross-organization role UPDATE');
SELECT pg_temp.expect_error(
  $$UPDATE public.employees SET organization_id = '00000000-0000-0000-0000-000000000002'
    WHERE id = '00000000-0000-0000-0000-000000002001'$$,
  '23503', 'employee tenant change cannot leave a foreign role');
SELECT pg_temp.expect_error(
  $$UPDATE public.job_roles SET organization_id = '00000000-0000-0000-0000-000000000002', name = 'Moved role'
    WHERE id = '00000000-0000-0000-0000-000000001001'$$,
  '23503', 'referenced role cannot move to another organization');
SELECT pg_temp.expect_error(
  $$INSERT INTO public.job_roles (organization_id, name, default_weight) VALUES
    ('00000000-0000-0000-0000-000000000099', 'Orphan', 1)$$,
  '23503', 'orphan organization');
SELECT pg_temp.expect_error(
  $$INSERT INTO public.employees (organization_id, name, default_role_id) VALUES
    ('00000000-0000-0000-0000-000000000001', 'Orphan', '00000000-0000-0000-0000-000000009999')$$,
  '23503', 'orphan role');
SELECT pg_temp.expect_error(
  $$DELETE FROM public.organizations WHERE id = '00000000-0000-0000-0000-000000000001'$$,
  '23503', 'organization deletion does not cascade');
SELECT pg_temp.expect_error(
  $$DELETE FROM public.job_roles WHERE id = '00000000-0000-0000-0000-000000001001'$$,
  '23503', 'referenced role deletion does not cascade');
SELECT pg_temp.expect_error(
  $$INSERT INTO public.job_roles (organization_id, name, default_weight) VALUES
    ('00000000-0000-0000-0000-000000000001', 'SYNTHETIC SERVER', 1)$$,
  '23505', 'role names are unique ignoring case within a tenant');

DO $$
DECLARE table_name text; bad_name text; bad_weight text; column_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['organizations', 'job_roles', 'employees'] LOOP
    FOREACH bad_name IN ARRAY ARRAY['', ' ', E'\t\n', ' padded ', repeat('x', 161)] LOOP
      PERFORM pg_temp.expect_error(format('UPDATE public.%I SET name = %L', table_name, bad_name),
        '23514', table_name || ' invalid name');
    END LOOP;
    PERFORM pg_temp.expect_error(format('UPDATE public.%I SET name = NULL', table_name),
      '23502', table_name || ' required name');
  END LOOP;
  PERFORM pg_temp.expect_error($q$UPDATE public.job_roles SET name = repeat('x', 101)$q$,
    '23514', 'role name length bound');
  FOREACH table_name IN ARRAY ARRAY['job_roles', 'employees'] LOOP
    column_name := CASE table_name WHEN 'job_roles' THEN 'default_weight' ELSE 'default_weight_override' END;
    FOREACH bad_weight IN ARRAY ARRAY['-0.01', '0.001', '1.999', '90071992547409.92', 'NaN', 'Infinity', '-Infinity'] LOOP
      PERFORM pg_temp.expect_error(format('UPDATE public.%I SET %I = %L::numeric', table_name, column_name, bad_weight),
        '23514', table_name || ' invalid weight ' || bad_weight);
    END LOOP;
    EXECUTE format('UPDATE public.%I SET %I = 90071992547409.91', table_name, column_name);
    PERFORM pg_temp.assert_true(90071992547409.91::numeric * 100 = 9007199254740991,
      'maximum individual weight maps to MAX_SAFE_INTEGER units');
    EXECUTE format('UPDATE public.%I SET %I = 0', table_name, column_name);
    PERFORM pg_temp.expect_error(format('UPDATE public.%I SET organization_id = NULL', table_name),
      '23502', table_name || ' required tenant');
  END LOOP;
END;
$$;

SELECT pg_temp.expect_error('UPDATE public.job_roles SET default_weight = NULL', '23502', 'role weight required');
SELECT pg_temp.expect_error('UPDATE public.employees SET default_role_id = NULL', '23502', 'default role required');
SELECT pg_temp.expect_error($$INSERT INTO public.organizations (name, created_at) VALUES ('Missing timestamp', NULL)$$,
  '23502', 'creation timestamp required');

-- Roster defaults can change between shifts; nothing here creates shift history.
UPDATE public.employees SET default_role_id = '00000000-0000-0000-0000-000000001003', default_weight_override = NULL
  WHERE id = '00000000-0000-0000-0000-000000002001';
UPDATE public.job_roles SET is_active = false WHERE id = '00000000-0000-0000-0000-000000001003';
UPDATE public.employees SET is_active = false WHERE id = '00000000-0000-0000-0000-000000002001';

DO $$
DECLARE table_name text; row_id uuid; inserted public.organizations;
BEGIN
  INSERT INTO public.organizations (name) VALUES ('Generated defaults') RETURNING * INTO inserted;
  PERFORM pg_temp.assert_true(inserted.id IS NOT NULL AND inserted.created_at IS NOT NULL
    AND inserted.updated_at = inserted.created_at, 'UUID and timestamp defaults');
  FOREACH table_name IN ARRAY ARRAY['organizations', 'job_roles', 'employees'] LOOP
    row_id := CASE table_name
      WHEN 'organizations' THEN '00000000-0000-0000-0000-000000000001'::uuid
      WHEN 'job_roles' THEN '00000000-0000-0000-0000-000000001001'::uuid
      ELSE '00000000-0000-0000-0000-000000002001'::uuid END;
    EXECUTE format('UPDATE public.%I SET name = name || '' updated'', created_at = ''2100-01-01Z'', updated_at = ''1999-01-01Z'' WHERE id = %L', table_name, row_id);
    EXECUTE format('SELECT pg_temp.assert_true(created_at = ''2000-01-01Z'' AND updated_at = statement_timestamp() AND updated_at > created_at, %L) FROM public.%I WHERE id = %L',
      table_name || ' preserves creation time and manages update time', table_name, row_id);
  END LOOP;
END;
$$;

-- Check the actual catalog, not SQL string matching.
SELECT pg_temp.assert_true(
  (SELECT count(*) = 3 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity)
   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname IN ('organizations', 'job_roles', 'employees')),
  'all roster tables enable and force RLS');
SELECT pg_temp.assert_true(
  NOT EXISTS (SELECT FROM pg_policies WHERE schemaname = 'public'
    AND tablename IN ('organizations', 'job_roles', 'employees')), 'no access policies');
SELECT pg_temp.assert_true(
  (SELECT NOT prosecdef AND proconfig = ARRAY['search_path=""'] FROM pg_proc
   WHERE oid = 'public.set_roster_timestamps()'::regprocedure), 'timestamp function is invoker with an empty search path');

DO $$
DECLARE role_name text; table_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    FOREACH table_name IN ARRAY ARRAY['organizations', 'job_roles', 'employees'] LOOP
      PERFORM pg_temp.assert_true(NOT has_table_privilege(role_name, 'public.' || table_name,
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), role_name || ' has no table grants');
    END LOOP;
    PERFORM pg_temp.assert_true(NOT has_function_privilege(role_name, 'public.set_roster_timestamps()', 'EXECUTE'),
      role_name || ' cannot call timestamp function');
    EXECUTE format('SET LOCAL ROLE %I', role_name);
    PERFORM pg_temp.expect_error('SELECT * FROM public.organizations', '42501', role_name || ' denied by ACL');
    PERFORM pg_temp.expect_error($q$INSERT INTO public.organizations (name) VALUES ('Denied')$q$, '42501', role_name || ' denied INSERT');
    PERFORM pg_temp.expect_error('UPDATE public.employees SET is_active = false', '42501', role_name || ' denied UPDATE');
    PERFORM pg_temp.expect_error('DELETE FROM public.job_roles', '42501', role_name || ' denied DELETE');
    PERFORM pg_temp.expect_error('TRUNCATE public.employees', '42501', role_name || ' denied TRUNCATE');
    RESET ROLE;
  END LOOP;
END;
$$;

-- Test RLS independently of ACLs: these grants exist only in this rolled-back test.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations, public.job_roles, public.employees TO anon, authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000009999","organization_id":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
DO $$
DECLARE role_name text; table_name text; visible bigint; affected bigint; insert_command text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    EXECUTE format('SET LOCAL ROLE %I', role_name);
    FOREACH table_name IN ARRAY ARRAY['organizations', 'job_roles', 'employees'] LOOP
      EXECUTE format('SELECT count(*) FROM public.%I', table_name) INTO visible;
      PERFORM pg_temp.assert_true(visible = 0, role_name || ' RLS hides all ' || table_name);
      EXECUTE format('UPDATE public.%I SET name = ''RLS forbidden''', table_name);
      GET DIAGNOSTICS affected = ROW_COUNT;
      PERFORM pg_temp.assert_true(affected = 0, role_name || ' RLS prevents UPDATE of ' || table_name);
      EXECUTE format('DELETE FROM public.%I', table_name);
      GET DIAGNOSTICS affected = ROW_COUNT;
      PERFORM pg_temp.assert_true(affected = 0, role_name || ' RLS prevents DELETE of ' || table_name);
      insert_command := CASE table_name
        WHEN 'organizations' THEN $q$INSERT INTO public.organizations (name) VALUES ('RLS forbidden')$q$
        WHEN 'job_roles' THEN $q$INSERT INTO public.job_roles (organization_id, name, default_weight) VALUES ('00000000-0000-0000-0000-000000000001', 'RLS forbidden', 1)$q$
        ELSE $q$INSERT INTO public.employees (organization_id, name, default_role_id) VALUES ('00000000-0000-0000-0000-000000000001', 'RLS forbidden', '00000000-0000-0000-0000-000000001001')$q$ END;
      PERFORM pg_temp.expect_error(insert_command, '42501', role_name || ' RLS prevents INSERT into ' || table_name);
    END LOOP;
    RESET ROLE;
  END LOOP;
END;
$$;

ROLLBACK;
\echo 'Roster assertions passed; all fixtures and test-only grants rolled back.'
