// Independent disposable LOCAL design gate; preserve the original security suite.
import { local, audit } from './supabase-local.mjs'
import { rosterEditingGate } from '../supabase/integration/roster-editing.mjs'
import { rosterDiagnostics } from './roster-editing-diagnostics.mjs'
import { fileURLToPath } from 'node:url'

// Injection permits offline lifecycle/failure tests; the CLI entry point always
// uses the original guarded local operations and the real integration gate.
export async function checkRosterEditing({ runLocal = local, runAudit = audit, gate = rosterEditingGate, log = console.log, error = console.error } = {}) {
  const diagnostics = rosterDiagnostics()
  let passed = true
  try {
    log('Starting independent local shared-roster editing design gate.')
    diagnostics.stage('local-start')
    runLocal('start')
    for (let pass = 1; pass <= 2; pass++) {
      diagnostics.replay(pass)
      log(`Shared-roster design gate: clean local migration replay ${pass}/2.`)
      diagnostics.stage('local-reset')
      runLocal('reset')
      diagnostics.stage('security-audit')
      runAudit()
      await gate({ diagnostics })
    }
    log('Local shared-roster transport/RLS/observed conflict checks passed on both replays.')
  } catch (failure) {
    error(diagnostics.format(failure))
    error('Local shared-roster design gate failed; editing must remain blocked. No hosted compatibility or concurrency guarantee is established.')
    passed = false
  } finally {
    diagnostics.stage('local-cleanup')
    try { runLocal('clean') } catch (failure) {
      error(diagnostics.format(failure))
      error('Local integration cleanup failed; inspect the disposable local project privately.')
      passed = false
    }
  }
  return passed
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!await checkRosterEditing()) process.exitCode = 1
}
