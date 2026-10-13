// Only the pinned CLI, tracked synthetic project, and local Docker socket.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

export const root = fileURLToPath(new URL('../', import.meta.url))
export const project = 'tip-calculator-integration'
const env = { ...process.env, DOCKER_HOST: 'unix:///var/run/docker.sock' }
for (const key of ['DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete env[key]
const cli = resolve(root, 'node_modules/.bin/supabase')

// Capture all vendor output: CLI status/start can contain keys; SQL errors can
// contain submitted account values. Never propagate child-process error objects.
function run(command, args, input) {
  const result = spawnSync(command, args, {
    cwd: root, env, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    detached: true, timeout: 600_000, maxBuffer: 16 * 1024 * 1024,
  })
  if (result.error || result.status !== 0) {
    // The npm CLI shim may have children. Terminate this action's process group
    // after timeout/failure so an orphan cannot keep starting services afterward.
    if (result.pid) {
      try { process.kill(-result.pid, 'SIGTERM') } catch { /* Already exited. */ }
    }
    // Only our catalog assertion labels are safe to propagate from SQL output.
    const auditLabel = /Security audit failed: ([a-zA-Z0-9_ ./:]+)/.exec(String(result.stderr))?.[1]
    const reason = auditLabel ? ` Security audit failed: ${auditLabel}.` : ` Exit ${result.error?.code ?? result.status ?? result.signal ?? 'unavailable'}.`
    throw new Error(`Local ${command === cli ? 'Supabase CLI' : 'Docker/SQL'} action failed (${args[0]}).${reason} Vendor output withheld to protect credentials.`)
  }
  return result.stdout.trim()
}
export function docker(args, input) {
  return run('docker', ['--host=unix:///var/run/docker.sock', ...args], input)
}
export function sql(input) {
  return docker(['exec', '-i', `supabase_db_${project}`, 'psql', '-X', '-qAt',
    '--set=ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], input)
}
function guard() {
  if (!readFileSync(resolve(root, 'supabase/config.toml'), 'utf8').includes(`project_id = "${project}"`)) {
    throw new Error('Refusing an unexpected local project configuration.')
  }
  if (existsSync(resolve(root, 'supabase/.temp/project-ref'))) throw new Error('Refusing a linked project checkout; use a separate unlinked checkout.')
  if (run(cli, ['--version']) !== '2.120.0') throw new Error('Run npm ci to install CLI 2.120.0.')
  docker(['info'])
}
export function local(action) {
  guard()
  const commands = {
    start: ['start', '--exclude', 'realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'],
    reset: ['db', 'reset', '--local', '--no-seed', '--yes'],
    stop: ['stop'],
    // Integration fixture volumes are disposable; normal stop preserves data.
    clean: ['stop', '--no-backup'],
  }
  if (!commands[action]) throw new Error('Allowed actions: start, reset, stop, clean.')
  run(cli, commands[action])
}
export function credentials() {
  guard()
  const status = JSON.parse(run(cli, ['status', '--output', 'json']))
  if (status.API_URL !== 'http://127.0.0.1:54321') throw new Error('Refusing a nonlocal or unexpected API URL.')
  if (!status.ANON_KEY || !status.SERVICE_ROLE_KEY) throw new Error('Missing local runtime API keys.')
  return status
}
export function audit() {
  const versions = readdirSync(resolve(root, 'supabase/migrations')).filter(f => f.endsWith('.sql')).sort().map(f => f.split('_')[0])
  const ledger = sql('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;').split('\n')
  if (JSON.stringify(ledger) !== JSON.stringify(versions)) throw new Error('CLI migration ledger differs from tracked ordered migrations.')
  sql(readFileSync(resolve(root, 'supabase/integration/audit.sql'), 'utf8'))
  // Verify actual PostgREST container config, not just config.toml.
  const schemas = docker(['inspect', '--format', '{{range .Config.Env}}{{if eq (index (split . "=") 0) "PGRST_DB_SCHEMAS"}}{{println .}}{{end}}{{end}}', `supabase_rest_${project}`])
  if (schemas !== 'PGRST_DB_SCHEMAS=public') throw new Error('PostgREST must expose exactly public.')
  console.log(`Ledger and managed-role/ACL/RLS/helper/API audit passed (${versions.length} migrations; PostgreSQL ${sql('SHOW server_version;')}).`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const action = process.argv[2]
    if (process.argv.length !== 3) throw new Error('Specify one local action; additional CLI arguments are prohibited.')
    if (action === 'audit') { credentials(); audit() } else local(action)
    console.log(`Local Supabase ${action} completed; credentials withheld.`)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
