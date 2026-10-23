// Local integration diagnostics contain fixed labels and bounded numbers only.
// Never format an exception, vendor body, URL, identity or credential.
import { AssertionError } from 'node:assert'

const stages = new Set([
  'local-start', 'local-reset', 'security-audit', 'local-credentials',
  'fresh-fixture', 'auth-readiness', 'auth-signup', 'auth-password-signin',
  'auth-user-verification', 'auth-identity-match', 'membership-fixture',
  'sdk-contexts', 'exact-transport', 'xmin-conflicts', 'invalid-weights',
  'authorization-denials', 'tenant-constraints', 'application-adapter',
  'revoked-membership', 'local-cleanup',
])
const categories = new Set(['operation-failed', 'transport', 'response-read', 'response-shape', 'http-status'])

// Node fetch wraps socket errors in TypeError.cause (sometimes AggregateError).
// Compare only a bounded set of codes; never output messages, addresses or codes
// supplied by the exception itself. An unknown cause remains generic transport.
export function transportCategory(error) {
  const pending = [error]
  for (let n = 0; n < 8 && pending.length; n++) {
    const item = pending.shift()
    if (!item || typeof item !== 'object') continue
    if (item.name === 'TimeoutError' || ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'].includes(item.code)) return 'timeout'
    if (item.name === 'AbortError') return 'aborted'
    if (item.code === 'ECONNREFUSED') return 'connection-refused'
    if (['ECONNRESET', 'EPIPE'].includes(item.code)) return 'connection-reset'
    if (item.code === 'UND_ERR_SOCKET') return 'socket-closed'
    if (['ENOTFOUND', 'EAI_AGAIN'].includes(item.code)) return 'dns-failure'
    if (['ENETUNREACH', 'EHOSTUNREACH'].includes(item.code)) return 'network-unreachable'
    pending.push(item.cause)
    if (item instanceof AggregateError) pending.push(...item.errors.slice(0, 4))
  }
  return 'transport'
}

export function rosterDiagnostics() {
  let replay = 0, stage = 'local-start', fixture = 0, category, httpStatus, deadlineExceeded = false
  return {
    replay(value) {
      if (![1, 2].includes(value)) throw new Error('Invalid diagnostic replay.')
      replay = value
    },
    stage(value, ordinal = 0) {
      if (!stages.has(value) || ![0, 1, 2, 3, 4].includes(ordinal)) throw new Error('Invalid diagnostic stage.')
      stage = value
      fixture = ordinal
      category = undefined
      httpStatus = undefined
      deadlineExceeded = false
    },
    failure(value, status) {
      if (!categories.has(value)) throw new Error('Invalid diagnostic category.')
      category = value
      httpStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined
    },
    deadlineExceeded() { deadlineExceeded = true },
    format(error) {
      // Exception names are compared only to constants; no exception value is
      // included in output. Explicit HTTP/transport failures take precedence
      // over the assertion used to enforce status 200.
      const transport = transportCategory(error)
      const kind = category === 'transport' || category === 'response-read'
        ? transport === 'transport' ? category : transport
        : error?.name === 'TimeoutError' ? 'timeout'
        : error?.name === 'AbortError' ? 'aborted'
          : category ?? (error instanceof AssertionError ? 'assertion'
            : error instanceof SyntaxError ? 'invalid-json' : 'operation-failed')
      return `Local roster diagnostic: ${JSON.stringify({ replay, stage, fixture, category: kind, ...(httpStatus === undefined ? {} : { httpStatus }), ...(deadlineExceeded ? { deadlineExceeded: true } : {}) })}`
    },
  }
}
