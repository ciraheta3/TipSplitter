// Local integration diagnostics contain fixed labels and bounded numbers only.
// Never format an exception, vendor body, URL, identity or credential.
import { AssertionError } from 'node:assert'

const stages = new Set([
  'local-start', 'local-reset', 'security-audit', 'local-credentials',
  'fresh-fixture', 'auth-signup', 'auth-password-signin',
  'auth-user-verification', 'auth-identity-match', 'membership-fixture',
  'sdk-contexts', 'exact-transport', 'xmin-conflicts', 'invalid-weights',
  'authorization-denials', 'tenant-constraints', 'application-adapter',
  'revoked-membership', 'local-cleanup',
])
const categories = new Set(['operation-failed', 'transport', 'response-read', 'response-shape', 'http-status'])

export function rosterDiagnostics() {
  let replay = 0, stage = 'local-start', fixture = 0, category, httpStatus
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
    },
    failure(value, status) {
      if (!categories.has(value)) throw new Error('Invalid diagnostic category.')
      category = value
      if (Number.isInteger(status) && status >= 100 && status <= 599) httpStatus = status
    },
    format(error) {
      // Exception names are compared only to constants; no exception value is
      // included in output. Explicit HTTP/transport failures take precedence
      // over the assertion used to enforce status 200.
      const kind = error?.name === 'TimeoutError' ? 'timeout'
        : error?.name === 'AbortError' ? 'aborted'
          : category ?? (error instanceof AssertionError ? 'assertion'
            : error instanceof SyntaxError ? 'invalid-json' : 'operation-failed')
      return `Local roster diagnostic: ${JSON.stringify({ replay, stage, fixture, category: kind, ...(httpStatus === undefined ? {} : { httpStatus }) })}`
    },
  }
}
