import { local, audit } from './supabase-local.mjs'
import { integration } from '../supabase/integration/authorization.mjs'

try {
  console.log('Starting local synthetic Supabase project (first image pull can take several minutes).')
  local('start')
  for (let pass = 1; pass <= 2; pass++) {
    console.log(`Clean Supabase CLI migration replay ${pass}/2 (destroys only this local fixture database).`)
    local('reset')
    audit()
    await integration()
  }
  console.log('Real local Supabase integration passed: two clean CLI-ledger replays, Auth sessions and PostgREST authorization.')
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  // Remove synthetic accounts/sessions/volumes even after an assertion failure.
  try { local('clean') } catch (error) { console.error(error.message); process.exitCode = 1 }
}
