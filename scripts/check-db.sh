#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# Only the local daemon: never use a remote context or an existing database.
docker_local() {
  env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS \
    -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH \
    docker --host=unix:///var/run/docker.sock "$@"
}

docker_local info >/dev/null
container_id=""
cleanup() {
  if [[ -n "$container_id" ]]; then
    docker_local rm -f "$container_id" >/dev/null
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

container_id=$(docker_local run -d --rm --network none \
  --tmpfs /var/lib/postgresql/data \
  -e POSTGRES_PASSWORD=disposable-test-only \
  -e POSTGRES_DB=roster_check postgres:17-bookworm)

ready=false
for ((attempt = 0; attempt < 60; attempt++)); do
  # PID 1 is postgres only after the entrypoint's temporary bootstrap server exits.
  if docker_local exec "$container_id" sh -c \
    'test "$(cat /proc/1/comm)" = postgres && pg_isready -U postgres -d roster_check' >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  docker_local logs "$container_id" >&2
  exit 1
fi

sql() {
  docker_local exec -i "$container_id" \
    psql -X --set=ON_ERROR_STOP=1 -U postgres -d roster_check "$@"
}

sql -c 'SELECT version();'
# Replay twice on clean databases, not twice on an already migrated schema.
for pass in 1 2; do
  if [[ "$pass" = 2 ]]; then
    sql -c 'DROP SCHEMA public CASCADE; DROP SCHEMA tipsplitter_private CASCADE; DROP SCHEMA auth CASCADE; CREATE SCHEMA public; DROP ROLE anon, authenticated, service_role;'
  fi
  sql < supabase/tests/bootstrap.sql
  for migration in supabase/migrations/*.sql; do
    echo "Applying $migration (clean replay $pass)"
    sql < "$migration"
  done
  cat supabase/tests/roster.sql supabase/tests/authorization.sql | sql
done

echo 'Database checks passed: two clean migration replays, constraints, timestamps, ACLs and membership-scoped RLS.'
