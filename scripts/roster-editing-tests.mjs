// Offline tests only: injected local actions/SQL and fetch, never a Docker/HTTP call.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { rosterDiagnostics } from './roster-editing-diagnostics.mjs'
import { checkRosterEditing } from './check-roster-editing.mjs'
import { rosterEditingGate } from '../supabase/integration/roster-editing.mjs'

const privateText = 'private@example.test secret-password Bearer secret-jwt apikey-secret 00000000-0000-0000-0000-000000000000'
function diagnostic(lines, index = 0) {
  const line = lines.filter(line => line.startsWith('Local roster diagnostic: '))[index]
  assert.ok(line, 'safe diagnostic required')
  assert.ok(privateText.split(' ').every(part => !lines.join('\n').includes(part)), 'private exception/body must be withheld')
  return JSON.parse(line.slice('Local roster diagnostic: '.length))
}
async function earlyFailure(t, { failAt = 1, status = 503, thrown, bodyFailure, malformed = false, shape = false, mismatch = false, fresh = '0', credentialFailure = false, membershipFailure = true, key = 'local-test-key' } = {}) {
  t.mock.method(console, 'log', () => {})
  let requests = 0, fixtureWrites = 0
  let identity = randomUUID()
  const paths = []
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = new URL(String(input))
    assert.ok(url.origin === 'http://127.0.0.1:54321', 'offline fixture must remain local')
    assert.ok(init.redirect === 'error' && init.signal instanceof AbortSignal, 'redirect and abort guards retained')
    paths.push(url.pathname)
    requests++
    if (requests === failAt) {
      if (thrown) throw thrown
      if (bodyFailure) return { status: 200, json: async () => { throw bodyFailure } }
      return new Response(malformed ? privateText : JSON.stringify(shape ? {} : { message: privateText }), { status: malformed || shape ? 200 : status })
    }
    if (url.pathname.endsWith('/signup')) identity = randomUUID()
    const data = url.pathname.endsWith('/user') ? { id: mismatch ? randomUUID() : identity }
      : { user: { id: identity }, access_token: privateText, refresh_token: privateText }
    return Response.json(data)
  })
  const output = [], errors = [], actions = []
  let pass = 0
  const passed = await checkRosterEditing({
    runLocal: action => actions.push(action), runAudit: () => {},
    // The first replay is simulated; only the second invokes the actual gate's
    // early flow. This does not claim two real service/security replays.
    gate: async ({ diagnostics }) => {
      if (++pass === 1) return
      await rosterEditingGate({ diagnostics,
        credentials: () => {
          if (credentialFailure) throw new Error(privateText)
          return { API_URL: 'http://127.0.0.1:54321', ANON_KEY: key }
        },
        sql: query => {
          if (query.startsWith('SELECT (SELECT count(*)')) return fresh
          fixtureWrites++
          if (membershipFailure) throw new Error(privateText)
          return ''
        },
      })
    }, log: line => output.push(line), error: line => errors.push(line),
  })
  assert.equal(passed, false)
  assert.deepEqual(actions, ['start', 'reset', 'reset', 'clean'])
  assert.ok(!output.some(line => line.includes('passed on both replays')), 'no false gate pass')
  const detail = diagnostic(errors)
  assert.equal(detail.replay, 2)
  return { detail, requests, fixtureWrites, paths }
}

test('requires both ordered clean replays and always cleans the local project', async () => {
  const events = [], errors = []
  const passed = await checkRosterEditing({
    runLocal: action => events.push(action), runAudit: () => events.push('audit'),
    gate: async () => events.push('gate'), log: () => {}, error: line => errors.push(line),
  })
  assert.equal(passed, true)
  assert.deepEqual(events, ['start', 'reset', 'audit', 'gate', 'reset', 'audit', 'gate', 'clean'])
  assert.deepEqual(errors, [])
})

for (const failedStage of ['local-start', 'local-reset', 'security-audit']) {
  test(`runner labels ${failedStage} and does not continue after failure`, async () => {
    const events = [], errors = []
    const passed = await checkRosterEditing({
      runLocal: action => {
        events.push(action)
        if (`local-${action}` === failedStage) throw new Error(privateText)
      },
      runAudit: () => { events.push('audit'); if (failedStage === 'security-audit') throw new Error(privateText) },
      gate: async () => assert.fail('gate must not run'), log: () => {}, error: line => errors.push(line),
    })
    assert.equal(passed, false)
    assert.equal(diagnostic(errors).stage, failedStage)
    assert.equal(events.at(-1), 'clean')
    assert.ok(events.filter(event => event === 'reset').length <= 1)
  })
}

test('cleanup failure stays nonzero and cannot overwrite the original failure', async () => {
  const errors = []
  const passed = await checkRosterEditing({
    runLocal: action => { if (action === 'clean') throw new Error(privateText) }, runAudit: () => {},
    gate: async ({ diagnostics }) => { diagnostics.stage('fresh-fixture'); assert.fail(privateText) },
    log: () => {}, error: line => errors.push(line),
  })
  assert.equal(passed, false)
  assert.equal(diagnostic(errors).stage, 'fresh-fixture')
  assert.equal(diagnostic(errors, 1).stage, 'local-cleanup')
})

test('cleanup failure after successful assertions still fails the run', async () => {
  const errors = []
  const passed = await checkRosterEditing({
    runLocal: action => { if (action === 'clean') throw new Error(privateText) },
    runAudit: () => {}, gate: async () => {}, log: () => {}, error: line => errors.push(line),
  })
  assert.equal(passed, false)
  assert.equal(diagnostic(errors).stage, 'local-cleanup')
  assert.equal(diagnostic(errors).replay, 2)
})

test('separates credential discovery from fresh fixture refusal before any Auth request', async t => {
  const credentials = await earlyFailure(t, { credentialFailure: true })
  assert.equal(credentials.detail.stage, 'local-credentials')
  assert.equal(credentials.requests, 0)
  const fresh = await earlyFailure(t, { fresh: '4' })
  assert.equal(fresh.detail.stage, 'fresh-fixture')
  assert.equal(fresh.detail.category, 'assertion')
  assert.equal(fresh.requests, 0)
  assert.equal(fresh.fixtureWrites, 0)
})

for (const [failAt, stage] of [[1, 'auth-signup'], [2, 'auth-password-signin'], [3, 'auth-user-verification'], [10, 'auth-signup']]) {
  test(`second replay HTTP failure at ${stage}, request ${failAt}, is private and never retried`, async t => {
    const result = await earlyFailure(t, { failAt, status: failAt === 10 ? 429 : 502 })
    assert.deepEqual(result.detail, { replay: 2, stage, fixture: Math.ceil(failAt / 3), category: 'http-status', httpStatus: failAt === 10 ? 429 : 502 })
    assert.equal(result.requests, failAt)
    assert.equal(result.fixtureWrites, 0)
  })
}

for (const [name, error, category] of [
  ['transport', new TypeError(privateText), 'transport'],
  ['timeout', new DOMException(privateText, 'TimeoutError'), 'timeout'],
  ['abort', new DOMException(privateText, 'AbortError'), 'aborted'],
]) {
  test(`Auth ${name} retains its stage without leaking the exception or retrying`, async t => {
    const result = await earlyFailure(t, { failAt: 2, thrown: error })
    assert.equal(result.detail.stage, 'auth-password-signin')
    assert.equal(result.detail.category, category)
    assert.equal(result.requests, 2)
    assert.equal(result.fixtureWrites, 0)
  })
}

test('malformed Auth JSON is private and distinguished from a rejected HTTP status', async t => {
  const result = await earlyFailure(t, { malformed: true })
  assert.equal(result.detail.stage, 'auth-signup')
  assert.equal(result.detail.category, 'invalid-json')
  assert.equal(result.requests, 1)
})

test('Auth response stream failure and body timeout retain the request stage', async t => {
  const stream = await earlyFailure(t, { failAt: 3, bodyFailure: new Error(privateText) })
  assert.equal(stream.detail.stage, 'auth-user-verification')
  assert.equal(stream.detail.category, 'response-read')
  assert.equal(stream.requests, 3)
  const timeout = await earlyFailure(t, { failAt: 3, bodyFailure: new DOMException(privateText, 'TimeoutError') })
  assert.equal(timeout.detail.stage, 'auth-user-verification')
  assert.equal(timeout.detail.category, 'timeout')
  assert.equal(timeout.requests, 3)
})

for (const [failAt, stage] of [[1, 'auth-signup'], [2, 'auth-password-signin'], [3, 'auth-user-verification']]) {
  test(`unexpected successful ${stage} response fails closed at its own stage`, async t => {
    const result = await earlyFailure(t, { failAt, shape: true })
    assert.equal(result.detail.stage, stage)
    assert.equal(result.detail.category, 'response-shape')
    assert.equal(result.requests, failAt)
    assert.equal(result.fixtureWrites, 0)
  })
}

test('real identity mismatch remains fatal before membership writes', async t => {
  const result = await earlyFailure(t, { failAt: 0, mismatch: true })
  assert.equal(result.detail.stage, 'auth-identity-match')
  assert.equal(result.detail.category, 'assertion')
  assert.equal(result.requests, 3)
  assert.equal(result.fixtureWrites, 0)
})

test('membership SQL failure is distinguished after all four verified Auth fixtures', async t => {
  const result = await earlyFailure(t, { failAt: 0 })
  assert.equal(result.detail.stage, 'membership-fixture')
  assert.equal(result.detail.fixture, 0)
  assert.equal(result.requests, 12)
  assert.equal(result.fixtureWrites, 1, 'fixture transaction is never retried')
})

test('SDK context failure is distinguished from Auth/fixture creation', async t => {
  const result = await earlyFailure(t, { failAt: 0, membershipFailure: false, key: '' })
  assert.equal(result.detail.stage, 'sdk-contexts')
  assert.equal(result.requests, 12)
  assert.equal(result.fixtureWrites, 1)
})

test('later roster assertion retains its own stage and sends no duplicate INSERT', async t => {
  const result = await earlyFailure(t, { failAt: 13, membershipFailure: false })
  assert.equal(result.detail.stage, 'exact-transport')
  assert.equal(result.detail.category, 'assertion')
  assert.equal(result.paths.filter(path => path === '/rest/v1/job_roles').length, 1)
})

test('diagnostic state resets between stages and runs; arbitrary values are never echoed', () => {
  const first = rosterDiagnostics()
  first.replay(1)
  first.stage('auth-signup', 4)
  first.failure('http-status', 429)
  first.stage('membership-fixture')
  assert.deepEqual(diagnostic([first.format(new Error(privateText))]), { replay: 1, stage: 'membership-fixture', fixture: 0, category: 'operation-failed' })
  const next = rosterDiagnostics()
  assert.deepEqual(diagnostic([next.format({ name: privateText, message: privateText, headers: privateText, body: privateText })]), { replay: 0, stage: 'local-start', fixture: 0, category: 'operation-failed' })
  assert.throws(() => next.stage(privateText), /^Error: Invalid diagnostic stage\.$/)
  assert.throws(() => next.replay(privateText), /^Error: Invalid diagnostic replay\.$/)
  assert.throws(() => next.failure(privateText), /^Error: Invalid diagnostic category\.$/)
  next.failure('http-status', privateText)
  assert.ok(!next.format(new Error(privateText)).includes(privateText))
})
