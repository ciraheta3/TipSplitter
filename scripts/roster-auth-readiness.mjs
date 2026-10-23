import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'

// CLI reset restarts Auth and reloads Kong without waiting for Auth health.
// Probe only the guarded local API route before any signup; never retry writes.
export const authReadinessDeadlineMs = 30_000
export async function waitForLocalAuth(config, diagnostics, { now = () => performance.now(), pause = delay } = {}) {
  diagnostics.stage('auth-readiness')
  assert.match(config.API_URL, /^http:\/\/127\.0\.0\.1:\d+$/)
  const deadline = now() + authReadinessDeadlineMs
  let lastError = new Error('Local Auth readiness deadline exceeded.')
  while (now() < deadline) {
    diagnostics.stage('auth-readiness')
    let retryable = false
    const signal = AbortSignal.timeout(Math.max(1, Math.ceil(Math.min(2000, deadline - now()))))
    try {
      let response
      try {
        response = await fetch(`${config.API_URL}/auth/v1/health`, {
          method: 'GET', redirect: 'error',
          headers: { apikey: config.ANON_KEY },
          signal,
        })
      } catch (caught) {
        const error = signal.aborted ? signal.reason : caught
        diagnostics.failure('transport')
        retryable = error?.name !== 'AbortError'
        throw error
      }
      if (response.status !== 200) {
        diagnostics.failure('http-status', response.status)
        retryable = [502, 503, 504].includes(response.status)
        await response.body?.cancel()
        throw new Error('Local Auth health HTTP status rejected.')
      }
      let data
      try { data = await response.json() } catch (caught) {
        // Fetch body readers may throw AbortError even when our timer expired.
        const error = signal.aborted ? signal.reason : caught
        if (!(error instanceof SyntaxError)) {
          diagnostics.failure('response-read')
          retryable = error?.name !== 'AbortError'
        }
        throw error
      }
      if (data?.name !== 'GoTrue' || typeof data.version !== 'string' || !data.version) {
        diagnostics.failure('response-shape')
        throw new Error('Local Auth health response shape rejected.')
      }
      if (now() >= deadline) {
        diagnostics.deadlineExceeded()
        throw new DOMException('Local Auth readiness deadline exceeded.', 'TimeoutError')
      }
      return
    } catch (error) {
      if (!retryable) throw error
      lastError = error
    }
    const remaining = deadline - now()
    if (remaining > 0) await pause(Math.min(500, remaining))
  }
  diagnostics.deadlineExceeded()
  throw lastError
}
