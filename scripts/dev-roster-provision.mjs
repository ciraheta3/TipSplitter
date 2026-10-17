// Offline only: built-in file/crypto utilities; no execution, credentials or network.
import { randomUUID, createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync, lstatSync, realpathSync, existsSync } from 'node:fs'
import { resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const work = resolve(root, 'work')
export const attestation = 'I independently verified the dedicated synthetic DEV dashboard against my private owner record; these existing confirmed Auth UUIDs are approved for this fictional fixture.'
const check = (ok, message) => { if (!ok) throw new Error(message) }
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value) && !/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(value)
const keys = (value, expected) => check(value && !Array.isArray(value) && typeof value === 'object'
  && Object.keys(value).sort().join(',') === expected.split(',').sort().join(','), 'Unexpected or missing plan fields.')
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
// The CLI accepts no free-form SQL names/text. Escape anyway for defense in depth.
export const literal = value => `'${value.replaceAll("'", "''")}'`
const save = (path, content, mode = 0o400) => writeFileSync(path, content, { flag: 'wx', mode })
const json = value => JSON.stringify(value, null, 2) + '\n'

export function newPlan() {
  const run = randomUUID()
  return { version: 1, environment: 'development', run,
    organization: { id: randomUUID(), name: `Fictional Lantern DEV ${run}` },
    ownerAttestation: '', members: [{ userId: '', role: 'admin', confirmedSynthetic: false }] }
}
export function identity(plan) {
  return { version: plan.version, environment: plan.environment, run: plan.run, organization: plan.organization }
}
function validateIdentity(p) {
  check(p.version === 1 && p.environment === 'development' && uuid(p.run), 'Invalid DEV fixture identity.')
  keys(p.organization, 'id,name')
  check(uuid(p.organization.id) && p.organization.id !== p.run
    && p.organization.name === `Fictional Lantern DEV ${p.run}`, 'Exact generated fictional organization required.')
}
export function validate(plan, original) {
  keys(plan, 'version,environment,run,organization,ownerAttestation,members')
  validateIdentity(plan)
  keys(original, 'version,environment,run,organization')
  validateIdentity(original)
  check(digest(identity(plan)) === digest(original), 'Fixture identity changed from original private plan.')
  check(plan.ownerAttestation === attestation, 'Independent owner DEV attestation required.')
  check(Array.isArray(plan.members) && plan.members.length >= 1 && plan.members.length <= 16, 'Plan requires 1 to 16 approved members.')
  for (const [i, member] of plan.members.entries()) {
    keys(member, 'userId,role,confirmedSynthetic')
    check(uuid(member.userId) && member.confirmedSynthetic === true, 'Existing confirmed synthetic Auth UUID and owner approval required.')
    check(['admin', 'closer'].includes(member.role) && (i !== 0 || member.role === 'admin'), 'First member must be admin; only admin or closer allowed.')
  }
  const ids = [plan.run, plan.organization.id, ...plan.members.map(m => m.userId)]
  check(new Set(ids).size === ids.length, 'Duplicate/conflicting planned identity.')
  return plan
}

// Every component beneath the checkout must be real, owned and private. No symlinks,
// public files, hardlinks or alternate output paths. POSIX permissions are required.
function privatePath(path, directory = false) {
  check(typeof process.getuid === 'function', 'POSIX owner/permission checks required.')
  const stat = lstatSync(path)
  check(!stat.isSymbolicLink() && (directory ? stat.isDirectory() : stat.isFile())
    && stat.uid === process.getuid() && (stat.mode & 0o077) === 0
    && (directory || stat.nlink === 1), 'Private owned files/directories required; links refused.')
  check(realpathSync(path) === resolve(path), 'Symlink path refused.')
}
function runDirectory(path) {
  const dir = resolve(path)
  check(dirname(dir) === work && /^dev-roster-[0-9a-f-]{36}$/.test(basename(dir)), 'Use a generated directory directly under this checkout work/.')
  privatePath(work, true)
  privatePath(dir, true)
  return dir
}
function load(dir, name) {
  const path = resolve(dir, name)
  privatePath(path)
  check(lstatSync(path).size <= 32_768, 'Private input too large.')
  return JSON.parse(readFileSync(path, 'utf8'))
}
export function createPlan() {
  if (!existsSync(work)) mkdirSync(work, { mode: 0o700 })
  privatePath(work, true)
  const plan = newPlan(), dir = resolve(work, `dev-roster-${plan.run}`)
  mkdirSync(dir, { mode: 0o700 })
  save(resolve(dir, 'identity.json'), json(identity(plan)))
  save(resolve(dir, 'plan.json'), json(plan), 0o600)
  return dir
}
export function sealPlan(path) {
  const dir = runDirectory(path), p = validate(load(dir, 'plan.json'), load(dir, 'identity.json'))
  check(basename(dir) === `dev-roster-${p.run}`, 'Run directory identity mismatch.')
  // Reserve once; partial writes fail closed and require private inspection.
  mkdirSync(resolve(dir, 'sealed'), { mode: 0o700 })
  save(resolve(dir, 'sealed', 'plan.json'), json(p))
  save(resolve(dir, 'sealed', 'sha256.json'), json(digest(p)))
}
export function readSealed(path) {
  const dir = runDirectory(path)
  privatePath(resolve(dir, 'sealed'), true)
  const p = load(resolve(dir, 'sealed'), 'plan.json')
  validate(p, load(dir, 'identity.json'))
  check(basename(dir) === `dev-roster-${p.run}` && digest(p) === load(resolve(dir, 'sealed'), 'sha256.json')
    && digest(p) === digest(load(dir, 'plan.json')), 'Plan changed after sealing; stop and inspect.')
  return p
}

const failIf = (condition, label) => `IF ${condition} THEN RAISE EXCEPTION '${label}'; END IF;`
const rowCount = n => `GET DIAGNOSTICS affected = ROW_COUNT;\n${failIf(`affected <> ${n}`, 'Unexpected affected row count; transaction aborted')}`
const orgGuard = p => {
  const id = literal(p.organization.id), name = literal(p.organization.name)
  return failIf(`(SELECT count(*) FROM public.organizations WHERE id=${id}::uuid AND name=${name}) <> 1
    OR (SELECT count(*) FROM public.organizations WHERE lower(name)=lower(${name})) <> 1`, 'Exact organization identity mismatch')
}
const authGuard = m => failIf(`NOT EXISTS (SELECT FROM auth.users WHERE id=${literal(m.userId)}::uuid AND email_confirmed_at IS NOT NULL)`, 'Confirmed Auth identity missing')
const noRoster = p => failIf(`EXISTS (SELECT FROM public.job_roles WHERE organization_id=${literal(p.organization.id)}::uuid)
    OR EXISTS (SELECT FROM public.employees WHERE organization_id=${literal(p.organization.id)}::uuid)`, 'Unexpected roster rows; stop for separate cleanup review')
function membershipGuard(p, expected) {
  const rows = expected.map(({ member, active }) => `(${literal(member.userId)}::uuid,${literal(member.role)}::text,${active}::boolean)`)
  if (!rows.length) return failIf(`EXISTS (SELECT FROM public.organization_memberships WHERE organization_id=${literal(p.organization.id)}::uuid)`, 'Unexpected memberships')
  return failIf(`EXISTS (
    WITH expected(user_id,role,is_active) AS (VALUES ${rows.join(',')})
    (SELECT user_id,role,is_active FROM public.organization_memberships WHERE organization_id=${literal(p.organization.id)}::uuid EXCEPT SELECT * FROM expected)
    UNION ALL
    (SELECT * FROM expected EXCEPT SELECT user_id,role,is_active FROM public.organization_memberships WHERE organization_id=${literal(p.organization.id)}::uuid)
  )`, 'Unexpected membership set or state')
}
const memberWhere = (p, m) => `organization_id=${literal(p.organization.id)}::uuid AND user_id=${literal(m.userId)}::uuid AND role=${literal(m.role)} AND is_active=true`

export function generateSql(p, action, slot, cleanupStates) {
  validate(p, identity(p)) // Disk entrypoint additionally compares original + sealed hash.
  const id = literal(p.organization.id)
  if (action === 'verify') {
    check(slot === undefined && cleanupStates === undefined, 'Verification takes no other arguments.')
    const users = p.members.map(m => literal(m.userId) + '::uuid').join(',')
    return `-- PRIVATE. Separate owner approval + independent DEV dashboard check required. Read only.\nBEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSET LOCAL search_path = pg_catalog;\nSET LOCAL standard_conforming_strings = on;\nSELECT id,name,created_at,updated_at FROM public.organizations WHERE id=${id}::uuid OR lower(name)=lower(${literal(p.organization.name)});\nSELECT id,email_confirmed_at FROM auth.users WHERE id IN (${users});\n-- ALL organizations, BOTH active and inactive memberships; required before dashboard Auth deletion.\nSELECT organization_id,user_id,role,is_active FROM public.organization_memberships WHERE organization_id=${id}::uuid OR user_id IN (${users}) ORDER BY organization_id,user_id;\nSELECT id,organization_id,name FROM public.job_roles WHERE organization_id=${id}::uuid;\nSELECT id,organization_id,name,default_role_id FROM public.employees WHERE organization_id=${id}::uuid;\nROLLBACK;\n`
  }
  check(['bootstrap', 'member', 'revoke', 'cleanup'].includes(action), 'Unknown offline operation.')
  let body, member
  if (['member', 'revoke'].includes(action)) {
    check(Number.isInteger(slot) && slot >= (action === 'member' ? 2 : 1) && slot <= p.members.length, 'Invalid planned member slot.')
    member = p.members[slot - 1]
  } else check(slot === undefined, 'Unexpected member slot.')
  if (action !== 'cleanup') check(cleanupStates === undefined, 'Unexpected cleanup states.')
  if (action === 'bootstrap') {
    member = p.members[0]
    body = `${authGuard(member)}\n${failIf(`EXISTS (SELECT FROM public.organizations WHERE id=${id}::uuid OR lower(name)=lower(${literal(p.organization.name)}))`, 'Organization already present or conflicting; never retry blindly')}\n${membershipGuard(p, [])}\n${noRoster(p)}
INSERT INTO public.organizations (id,name) VALUES (${id}::uuid,${literal(p.organization.name)});
${rowCount(1)}
INSERT INTO public.organization_memberships (organization_id,user_id,role,is_active) VALUES (${id}::uuid,${literal(member.userId)}::uuid,'admin',true);
${rowCount(1)}`
  } else if (action === 'member') {
    body = `${orgGuard(p)}\n${authGuard(member)}\n${membershipGuard(p, p.members.slice(0, slot - 1).map(m => ({ member: m, active: true })))}
INSERT INTO public.organization_memberships (organization_id,user_id,role,is_active) VALUES (${id}::uuid,${literal(member.userId)}::uuid,${literal(member.role)},true);
${rowCount(1)}`
  } else if (action === 'revoke') {
    body = `${orgGuard(p)}\n${failIf(`(SELECT count(*) FROM public.organization_memberships WHERE ${memberWhere(p, member)}) <> 1`, 'Exact active membership and role required; no reactivation or retry')}
UPDATE public.organization_memberships SET is_active=false WHERE ${memberWhere(p, member)};
${rowCount(1)}`
  } else {
    check(Array.isArray(cleanupStates) && cleanupStates.length === p.members.length
      && cleanupStates.every(s => ['absent', 'active', 'inactive'].includes(s))
      && cleanupStates[0] !== 'absent', 'Explicit cleanup states required for every planned member.')
    const expected = p.members.flatMap((m, i) => cleanupStates[i] === 'absent' ? [] : [{ member: m, active: cleanupStates[i] === 'active' }])
    body = `${orgGuard(p)}\n${noRoster(p)}\n${membershipGuard(p, expected)}\n`
    for (const { member: m, active } of expected) body += `DELETE FROM public.organization_memberships WHERE ${memberWhere(p, m).replace('is_active=true', `is_active=${active}`)};\n${rowCount(1)}\n`
    body += `DELETE FROM public.organizations WHERE id=${id}::uuid AND name=${literal(p.organization.name)};\n${rowCount(1)}`
  }
  return `-- PRIVATE OWNER REVIEW ONLY. Not a migration. Nothing executes this file automatically.
-- Independently verify the DEV dashboard and approve this exact operation before use.
-- ${action === 'revoke' ? 'Revocation does not sign out or invalidate a JWT.' : 'Stop on any mismatch; never widen guards or auto-retry.'}
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL standard_conforming_strings = on;
SET LOCAL search_path = pg_catalog;
-- Serialize checks and writes, including concurrent inserts; short owner-only DEV transaction.
LOCK TABLE public.organizations, public.organization_memberships, public.job_roles, public.employees IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE auth.users IN SHARE MODE;
DO $dev_roster$ DECLARE affected bigint; BEGIN
${body}
END $dev_roster$;
COMMIT;
`
}
export function writeSql(path, action, slot) {
  const dir = runDirectory(path), p = readSealed(dir)
  let states
  if (action === 'cleanup') {
    const input = load(dir, 'cleanup-review.json')
    keys(input, 'ownerApprovedExactCleanup,states')
    check(input.ownerApprovedExactCleanup === true, 'Separate exact cleanup review required.')
    states = input.states
  }
  const sql = generateSql(p, action, slot, states)
  const out = resolve(dir, `${action}${slot === undefined ? '' : `-${slot}`}`)
  mkdirSync(out, { mode: 0o700 })
  save(resolve(out, 'review.sql'), sql)
  save(resolve(out, 'plan-sha256.json'), json(digest(p)))
}
function main() {
  const [action, path, rawSlot, ...extra] = process.argv.slice(2)
  check(!extra.length, 'Extra arguments refused.')
  if (action === 'plan') {
    check(path === undefined && rawSlot === undefined, 'Plan takes no arguments.')
    const dir = createPlan()
    console.log(`Offline private plan created: work/${basename(dir)}/plan.json. See docs/DEV-PROVISIONING.md.`)
  } else {
    check(path && (rawSlot === undefined || /^[1-9][0-9]?$/.test(rawSlot)), 'Use an offline operation and private run directory; optional numeric slot only.')
    if (action === 'seal') { check(rawSlot === undefined, 'Seal takes no slot.'); sealPlan(path) }
    else writeSql(path, action, rawSlot === undefined ? undefined : Number(rawSlot))
    console.log('Offline private review files written. No SQL executed; no connection made.')
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { main() } catch {
    // Never echo input, filesystem errors, IDs, JSON or generated SQL.
    console.error('Offline provisioning stopped. Inspect private files, permissions and docs/DEV-PROVISIONING.md; no operation was executed.')
    process.exitCode = 1
  }
}
