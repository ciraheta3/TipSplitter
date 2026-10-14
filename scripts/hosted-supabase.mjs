// Owner-controlled hosted DEV verification. Never imports the local harness.
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync, lstatSync, realpathSync } from 'node:fs'
import { resolve, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline/promises'
import { hostedHttp } from '../supabase/integration/hosted-http.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
export const categories = ['admin-A', 'closer-A', 'admin-B', 'closer-B', 'dual-admin-A-closer-B', 'dual-closer-A-admin-B', 'nonmember']
export const memberships = [[0, 0, 'admin'], [0, 1, 'closer'], [1, 2, 'admin'], [1, 3, 'closer'], [0, 4, 'admin'], [1, 4, 'closer'], [0, 5, 'closer'], [1, 5, 'admin']]
class PreparationError extends Error {}
const check = (ok, label) => { if (!ok) throw new PreparationError(label) }
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
const authUuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
const literal = value => `'${value.replaceAll("'", "''")}'`
const digest = config => createHash('sha256').update(JSON.stringify(config)).digest('hex')
const save = (path, value) => writeFileSync(path, value, { mode: 0o600, flag: 'wx' })

export function newPlan() {
  const run = randomUUID()
  return { environment: 'development', projectName: '', projectRef: '', approvedProjectRef: '', apiUrl: '', apiKey: '',
    ownerAttestedDedicatedDev: false, run, orgs: [randomUUID(), randomUUID()], roles: [randomUUID(), randomUUID()], employees: [randomUUID(), randomUUID()],
    users: categories.map((category, i) => ({ category, id: '', email: `synthetic-${run}-${i}@example.test`, password: randomBytes(32).toString('base64url') })) }
}

export function validate(config) {
  check(config.environment === 'development' && config.ownerAttestedDedicatedDev === true, 'Owner must attest this is a dedicated synthetic-only development project.')
  check(/^tipsplitter-dev-[a-z0-9-]+$/.test(config.projectName), 'Expected explicitly named tipsplitter-dev project.')
  check(/^[a-z]{20}$/.test(config.projectRef) && config.approvedProjectRef === config.projectRef, 'Project reference must match the separately owner-approved reference.')
  check(config.apiUrl === `https://${config.projectRef}.supabase.co`, 'Only the exact approved HTTPS Supabase project origin is allowed; no custom hosts, paths or redirects.')
  check(typeof config.apiKey === 'string', 'A publishable or legacy anon key is required.')
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(config.apiKey)) {
    let claims
    try { claims = JSON.parse(Buffer.from(config.apiKey.split('.')[1], 'base64url').toString()) } catch { /* Fail closed below. */ }
    check(config.apiKey.split('.').length === 3 && claims?.role === 'anon' && claims?.ref === config.projectRef, 'Privileged/unknown keys refused; legacy anon key must match this project.')
  }
  check(uuid(config.run) && ['orgs', 'roles', 'employees'].every(k => Array.isArray(config[k]) && config[k].length === 2 && config[k].every(uuid)), 'Expected random isolated fixture identifiers.')
  check(Array.isArray(config.users) && config.users.length === 7 && config.users.every((u, i) => u.category === categories[i]
    && authUuid(u.id) && u.email === `synthetic-${config.run}-${i}@example.test` && typeof u.password === 'string' && u.password.length >= 32), 'Only the seven planned synthetic Auth accounts are allowed.')
  const ids = [config.run, ...config.orgs, ...config.roles, ...config.employees, ...config.users.map(u => u.id)]
  check(new Set(ids).size === ids.length, 'Fixture and account UUIDs must be distinct.')
  return config
}

function loadConfig(path) {
  const file = realpathSync(path)
  check(file.startsWith(resolve(root, 'work') + sep) && file === resolve(path), 'Configuration must be a real file beneath this checkout work/; symlinks refused.')
  const stat = lstatSync(file)
  check(stat.isFile() && (stat.mode & 0o077) === 0 && stat.uid === process.getuid(), 'Configuration must be owner-only (chmod 600).')
  check((lstatSync(dirname(file)).mode & 0o077) === 0, 'Configuration directory must be owner-only (chmod 700).')
  return { config: validate(JSON.parse(readFileSync(file, 'utf8'))), dir: dirname(file) }
}

export function fixtureSql(c) {
  validate(c)
  const orgName = o => `Fictional ${o === 0 ? 'Juniper Cafe' : 'Moonbeam Diner'} ${c.run}`
  const guards = `DO $$ BEGIN
    IF EXISTS (SELECT FROM public.organizations) OR EXISTS (SELECT FROM public.organization_memberships)
      OR EXISTS (SELECT FROM public.job_roles) OR EXISTS (SELECT FROM public.employees) THEN
      RAISE EXCEPTION 'DEV fixture requires empty application tables; stop and inspect'; END IF;
    IF (SELECT count(*) FROM auth.users) <> 7 OR NOT (${c.users.map(u => `EXISTS (SELECT FROM auth.users WHERE id=${literal(u.id)}::uuid AND email=${literal(u.email)} AND email_confirmed_at IS NOT NULL)`).join(' AND ')}) THEN
      RAISE EXCEPTION 'Synthetic confirmed Auth identity mismatch'; END IF;
  END $$;`
  const setup = `-- OWNER REVIEW + APPROVAL required in the exact DEV dashboard. Not a migration.\nBEGIN;\n${guards}
INSERT INTO public.organizations (id,name) VALUES ${c.orgs.map((id, o) => `(${literal(id)},${literal(orgName(o))})`).join(',')};
INSERT INTO public.job_roles (id,organization_id,name,default_weight) VALUES ${c.roles.map((id, o) => `(${literal(id)},${literal(c.orgs[o])},'Synthetic server',1)`).join(',')};
INSERT INTO public.employees (id,organization_id,name,default_role_id) VALUES ${c.employees.map((id, o) => `(${literal(id)},${literal(c.orgs[o])},'Synthetic employee ${o}',${literal(c.roles[o])})`).join(',')};
INSERT INTO public.organization_memberships (organization_id,user_id,role) VALUES ${memberships.map(([o, i, r]) => `(${literal(c.orgs[o])},${literal(c.users[i].id)},${literal(r)})`).join(',')};\nCOMMIT;\n`
  const scope = c.orgs.map(literal).join(',')
  const identity = `DO $$ BEGIN IF (SELECT count(*) FROM public.organizations WHERE ${c.orgs.map((id, o) => `(id=${literal(id)}::uuid AND name=${literal(orgName(o))})`).join(' OR ')}) <> 2 THEN RAISE EXCEPTION 'Fixture ownership mismatch; stop'; END IF; END $$;`
  const revoke = `-- OWNER APPROVAL required while verifier is paused; preserve the same sessions.\nBEGIN;\n${identity}
UPDATE public.organization_memberships SET is_active=false WHERE
  (organization_id=${literal(c.orgs[0])} AND user_id IN (${[1, 4, 5].map(i => literal(c.users[i].id)).join(',')}))
  OR (organization_id=${literal(c.orgs[1])} AND user_id=${literal(c.users[2].id)});\nCOMMIT;\n`
  const cleanup = `-- SEPARATE OWNER APPROVAL required. Review rows first; never run automatically.\nBEGIN;\n${identity}
DELETE FROM public.employees WHERE organization_id IN (${scope});
DELETE FROM public.job_roles WHERE organization_id IN (${scope});
DELETE FROM public.organization_memberships WHERE organization_id IN (${scope});
DELETE FROM public.organizations WHERE id IN (${scope});\nCOMMIT;
-- Then delete ONLY the seven manifest accounts through Dashboard Auth, not SQL.
-- Confirm they have zero memberships in every organization first. No auth schema writes.\n`
  return { setup, revoke, cleanup }
}

export function persistedSql(state) {
  const tables = ['organizations', 'organization_memberships', 'job_roles', 'employees']
  const body = tables.map(table => `IF (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.${table} t) <> (SELECT coalesce(jsonb_agg(x ORDER BY x::text),'[]'::jsonb) FROM jsonb_array_elements(${literal(JSON.stringify(state[table]))}::jsonb) x) THEN RAISE EXCEPTION 'Persisted ${table} differs from verified HTTP rows'; END IF;`).join('\n')
  // Server-returned text must not terminate the surrounding dollar-quoted body.
  let delimiter
  do { delimiter = `$hosted_${randomUUID().replaceAll('-', '')}$` } while (body.includes(delimiter))
  return `-- OWNER: run in the same DEV SQL editor after approval; no persistent writes.\nBEGIN;\nSET LOCAL TIME ZONE 'UTC';\nSET LOCAL standard_conforming_strings = on;\nDO ${delimiter} BEGIN\n${body}\nEND ${delimiter};\nROLLBACK;\n`
}

async function approve(rl, prompt, phrase) {
  check((await rl.question(prompt)).trim() === phrase, 'Approval not granted; stopping without further hosted operations.')
}

async function main() {
  const [action, path, ...extra] = process.argv.slice(2)
  check(extra.length === 0, 'Additional arguments refused.')
  if (action === 'plan' && !path) {
    const c = newPlan()
    const dir = resolve(root, 'work', `hosted-${c.run}`)
    mkdirSync(dir, { mode: 0o700, recursive: true })
    save(resolve(dir, 'config.json'), JSON.stringify(c, null, 2) + '\n')
    console.log(`Offline synthetic plan created: work/hosted-${c.run}/config.json. No hosted connection made.`)
    return
  }
  check(['prepare', 'verify'].includes(action) && path, 'Usage: node scripts/hosted-supabase.mjs plan | prepare CONFIG | verify CONFIG')
  const { config, dir } = loadConfig(path)
  if (action === 'prepare') {
    const sql = fixtureSql(config)
    for (const [name, content] of Object.entries(sql)) save(resolve(dir, `${name}.sql`), content)
    save(resolve(dir, 'prepared.sha256'), digest(config))
    console.log('Offline setup/revocation/cleanup SQL prepared for owner review. Nothing executed remotely.')
    return
  }
  check(readFileSync(resolve(dir, 'prepared.sha256'), 'utf8') === digest(config), 'Configuration changed after preparation; make a new plan.')
  check(process.stdin.isTTY && process.stdout.isTTY && !process.env.CI, 'Hosted verification requires an interactive owner terminal; CI and piped approval refused.')
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    await approve(rl, 'Compare dashboard organization/name/ref with private config. Type CONNECT DEVELOPMENT followed by the approved project reference: ', `CONNECT DEVELOPMENT ${config.projectRef}`)
    await approve(rl, 'Confirm migrations/catalog audit and setup.sql passed, and approve bounded synthetic HTTP writes/denial probes. Type TEST SYNTHETIC followed by the run UUID: ', `TEST SYNTHETIC ${config.run}`)
    const pause = () => approve(rl, 'Owner: review and explicitly approve executing revoke.sql in the same DEV dashboard now. After it succeeds, type REVOKED followed by the run UUID (sessions must remain valid): ', `REVOKED ${config.run}`)
    const state = await hostedHttp(config, memberships, pause)
    // Independent SQL verification remains a manual, separately approved step.
    save(resolve(dir, 'persisted.sql'), persistedSql(state))
    console.log('Hosted HTTP assertions passed. Independent persisted.sql/catalog/ledger checks require owner execution; hosted verification is incomplete until those pass. No cleanup performed.')
  } finally { rl.close() }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Never print third-party errors, config, response bodies, identifiers or tokens.
  main().catch(error => {
    if (error instanceof PreparationError) console.error(error.message)
    console.error('Stopped: hosted preparation/verification did not complete. Review private configuration, approval gates and the last assertion category. Vendor details withheld; fixture may remain. See docs/HOSTED-DEV.md.')
    process.exitCode = 1
  })
}
