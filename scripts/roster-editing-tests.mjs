// Offline tests only: injected local actions/SQL and fetch, never a Docker/HTTP call.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { rosterDiagnostics, transportCategory } from './roster-editing-diagnostics.mjs'
import { waitForLocalAuth, authReadinessDeadlineMs } from './roster-auth-readiness.mjs'
import { checkRosterEditing } from './check-roster-editing.mjs'
import { rosterEditingGate } from '../supabase/integration/roster-editing.mjs'

const privateText = 'private@example.test secret-password Bearer secret-jwt apikey-secret 00000000-0000-0000-0000-000000000000'
function diagnostic(lines, index = 0) {
  const line = lines.filter(line => line.startsWith('Local roster diagnostic: '))[index]
  assert.ok(line, 'safe diagnostic required')
  assert.ok(privateText.split(' ').every(part => !lines.join('\n').includes(part)), 'private exception/body must be withheld')
  return JSON.parse(line.slice('Local roster diagnostic: '.length))
}
async function earlyFailure(t, { failAt = 1, status = 503, thrown, bodyFailure, malformed = false, shape = false, mismatch = false, fresh = '0', credentialFailure = false, membershipFailure = true, key = 'local-test-key', healthStatus = 200 } = {}) {
  t.mock.method(console, 'log', () => {})
  let requests = 0, fixtureWrites = 0, healthRequests = 0
  let identity = randomUUID()
  const paths = []
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = new URL(String(input))
    assert.ok(url.origin === 'http://127.0.0.1:54321', 'offline fixture must remain local')
    assert.ok(init.redirect === 'error' && init.signal instanceof AbortSignal, 'redirect and abort guards retained')
    if (url.pathname === '/auth/v1/health') {
      healthRequests++
      assert.equal(init.method, 'GET')
      return Response.json({ name: 'GoTrue', version: 'test' }, { status: healthStatus })
    }
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
  assert.equal(healthRequests, credentialFailure || fresh !== '0' ? 0 : 1)
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

const localConfig = { API_URL: 'http://127.0.0.1:54321', ANON_KEY: privateText }
const healthy = () => Response.json({ name: 'GoTrue', version: 'test' })
function readinessFixture(t, respond) {
  let elapsed = 0, requests = 0
  const diagnostics = rosterDiagnostics()
  diagnostics.replay(2)
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.ok(url === `${localConfig.API_URL}/auth/v1/health`, 'only fixed local health route')
    assert.equal(init.method, 'GET')
    assert.equal(init.redirect, 'error')
    assert.ok(init.signal instanceof AbortSignal)
    assert.deepEqual(Object.keys(init.headers), ['apikey'])
    assert.ok(init.headers.apikey === privateText, 'only the local API key')
    assert.equal(init.body, undefined)
    return respond(++requests, init)
  })
  return {
    diagnostics, requests: () => requests, elapsed: () => elapsed,
    run: () => waitForLocalAuth(localConfig, diagnostics, { now: () => elapsed, pause: async ms => { elapsed += ms } }),
  }
}

test('read-only readiness recovers from gateway unavailability and connection refusal', async t => {
  const f = readinessFixture(t, n => {
    if (n === 1) return new Response(privateText, { status: 502 })
    if (n === 2) throw new TypeError(privateText, { cause: { code: 'ECONNREFUSED', address: privateText } })
    return healthy()
  })
  await f.run()
  assert.equal(f.requests(), 3)
  assert.equal(f.elapsed(), 1000)
  // A later failure must not retain an earlier HTTP status/deadline marker.
  assert.deepEqual(diagnostic([f.diagnostics.format(new Error(privateText))]), { replay: 2, stage: 'auth-readiness', fixture: 0, category: 'operation-failed' })
})

test('permanent connection refusal ends at the fixed deadline with no write requests', async t => {
  const f = readinessFixture(t, () => { throw new TypeError(privateText, { cause: { code: 'ECONNREFUSED' } }) })
  await assert.rejects(f.run(), error => {
    assert.deepEqual(diagnostic([f.diagnostics.format(error)]), { replay: 2, stage: 'auth-readiness', fixture: 0, category: 'connection-refused', deadlineExceeded: true })
    return true
  })
  assert.equal(f.elapsed(), authReadinessDeadlineMs)
  assert.equal(f.requests(), 60)
})

test('persistent gateway 503 fails at the deadline and retains only safe HTTP status', async t => {
  const f = readinessFixture(t, () => new Response(privateText, { status: 503 }))
  await assert.rejects(f.run(), error => {
    assert.deepEqual(diagnostic([f.diagnostics.format(error)]), { replay: 2, stage: 'auth-readiness', fixture: 0, category: 'http-status', httpStatus: 503, deadlineExceeded: true })
    return true
  })
  assert.equal(f.elapsed(), authReadinessDeadlineMs)
})

for (const status of [301, 401, 403, 404, 429, 500]) {
  test(`readiness HTTP ${status} fails immediately without signup or status retries`, async t => {
    const f = readinessFixture(t, () => new Response(privateText, { status }))
    await assert.rejects(f.run(), error => diagnostic([f.diagnostics.format(error)]).httpStatus === status)
    assert.equal(f.requests(), 1)
    assert.equal(f.elapsed(), 0)
  })
}

test('readiness refuses malformed JSON and an unexpected health service', async t => {
  for (const [response, category] of [[new Response(privateText), 'invalid-json'], [Response.json({ name: privateText }), 'response-shape']]) {
    const f = readinessFixture(t, () => response)
    await assert.rejects(f.run(), error => diagnostic([f.diagnostics.format(error)]).category === category)
    assert.equal(f.requests(), 1)
  }
})

test('readiness cannot accept an otherwise healthy response after its total deadline', async t => {
  const diagnostics = rosterDiagnostics()
  let elapsed = 0
  t.mock.method(globalThis, 'fetch', async () => {
    elapsed = authReadinessDeadlineMs
    return healthy()
  })
  await assert.rejects(waitForLocalAuth(localConfig, diagnostics, { now: () => elapsed }), error => {
    const detail = diagnostic([diagnostics.format(error)])
    return detail.category === 'timeout' && detail.deadlineExceeded === true
  })
})

for (const phase of ['fetch', 'body']) test(`a hung health ${phase} is aborted within the remaining total budget`, async t => {
  const diagnostics = rosterDiagnostics()
  let reads = 0, elapsed = 0, requests = 0
  t.mock.method(globalThis, 'fetch', (_url, init) => {
    requests++
    const hang = () => new Promise((_resolve, reject) => {
      const watchdog = setTimeout(() => reject(new Error('Health request did not abort.')), 1000)
      init.signal.addEventListener('abort', () => {
        clearTimeout(watchdog)
        elapsed = authReadinessDeadlineMs
        reject(phase === 'fetch' ? init.signal.reason : new DOMException(privateText, 'AbortError'))
      }, { once: true })
    })
    return phase === 'fetch' ? hang() : { status: 200, json: hang }
  })
  await assert.rejects(waitForLocalAuth(localConfig, diagnostics, {
    now: () => ++reads === 1 ? 0 : elapsed || authReadinessDeadlineMs - 5,
  }), error => {
    const detail = diagnostic([diagnostics.format(error)])
    return detail.category === 'timeout' && detail.deadlineExceeded === true
  })
  assert.equal(requests, 1)
})

test('readiness refuses nonlocal URLs before sending any request', async t => {
  let requests = 0
  t.mock.method(globalThis, 'fetch', async () => { requests++; return healthy() })
  for (const API_URL of ['https://example.test', 'http://127.0.0.1:54321@external.test', 'http://127.0.0.1:54321/redirect']) {
    await assert.rejects(waitForLocalAuth({ ...localConfig, API_URL }, rosterDiagnostics()))
  }
  assert.equal(requests, 0)
})

test('second replay readiness failure prevents signup and fixture SQL but still cleans up', async t => {
  const result = await earlyFailure(t, { healthStatus: 401 })
  assert.equal(result.detail.stage, 'auth-readiness')
  assert.equal(result.requests, 0)
  assert.equal(result.fixtureWrites, 0)
})

test('every gate invocation waits for fresh health before one signup attempt', async t => {
  t.mock.method(console, 'log', () => {})
  let healthRequests = 0, signups = 0, releaseHealth, observedHealth
  t.mock.method(globalThis, 'fetch', async input => {
    if (String(input).endsWith('/health')) {
      healthRequests++
      return { status: 200, json: () => new Promise(resolve => { releaseHealth = resolve; observedHealth() }) }
    }
    assert.ok(String(input).endsWith('/signup'), 'no further Auth operation after failed signup')
    signups++
    throw new TypeError(privateText, { cause: { code: 'ECONNRESET' } })
  })
  for (let pass = 1; pass <= 2; pass++) {
    const started = new Promise(resolve => { observedHealth = resolve })
    const diagnostics = rosterDiagnostics()
    const run = rosterEditingGate({ credentials: () => localConfig, diagnostics, sql: query => {
      assert.ok(query.startsWith('SELECT (SELECT count(*)'), 'no membership write before verified Auth')
      return '0'
    } })
    await started
    assert.equal(signups, pass - 1, 'signup waits for the health body')
    releaseHealth({ name: 'GoTrue', version: 'test' })
    await assert.rejects(run, error => {
      const detail = diagnostic([diagnostics.format(error)])
      return detail.stage === 'auth-signup' && detail.category === 'connection-reset'
    })
    assert.equal(signups, pass, 'failed signup is never retried')
  }
  assert.equal(healthRequests, 2, 'readiness success is not cached between replays')
})

test('transport classification is fixed, bounded and private, including nested causes', () => {
  for (const [code, expected] of [
    ['ECONNREFUSED', 'connection-refused'], ['ECONNRESET', 'connection-reset'],
    ['EPIPE', 'connection-reset'], ['UND_ERR_SOCKET', 'socket-closed'],
    ['ETIMEDOUT', 'timeout'], ['UND_ERR_CONNECT_TIMEOUT', 'timeout'],
    ['UND_ERR_HEADERS_TIMEOUT', 'timeout'], ['UND_ERR_BODY_TIMEOUT', 'timeout'],
    ['ENOTFOUND', 'dns-failure'], ['EAI_AGAIN', 'dns-failure'],
    ['ENETUNREACH', 'network-unreachable'], ['EHOSTUNREACH', 'network-unreachable'],
    [privateText, 'transport'],
  ]) {
    const error = new TypeError(privateText, { cause: new AggregateError([Object.assign(new Error(privateText), { code, address: privateText })], privateText) })
    const diagnostics = rosterDiagnostics()
    diagnostics.stage('auth-signup', 1)
    diagnostics.failure('transport')
    assert.equal(diagnostic([diagnostics.format(error)]).category, expected)
  }
  const cyclic = new Error(privateText)
  cyclic.cause = cyclic
  assert.equal(transportCategory(cyclic), 'transport')
})
