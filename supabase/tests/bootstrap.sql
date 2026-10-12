-- Disposable PostgreSQL ONLY: approximate Supabase API roles/default grants.
-- This is not a production migration and does not implement authentication.
CREATE ROLE anon NOLOGIN NOINHERIT NOBYPASSRLS;
CREATE ROLE authenticated NOLOGIN NOINHERIT NOBYPASSRLS;
CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
