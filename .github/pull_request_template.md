## Summary

<!-- What changed and why? Link the issue; note intentional out-of-scope items. -->
Closes #

## Risk and scope

<!-- Check relevant areas and briefly describe the impact. -->
- [ ] Financial calculation, decimal precision, reconciliation, or payout semantics
- [ ] Authentication, authorization, RLS/ACLs, or tenant isolation
- [ ] Database migrations, roster data, or shared Supabase access
- [ ] React async state, session switching, storage, or UI behavior
- [ ] Documentation / tooling only

**Business-rule changes or unresolved decisions:** <!-- Reference SPEC.md or docs/PRD.md; write none if not applicable. -->

## Verification evidence

<!-- Mark only checks actually performed. Give exact commands, results, date/environment, or a link to CI. "Not run" is acceptable with reason. -->

| Verification | Result and evidence |
| --- | --- |
| `npm run check` (tests, lint, build) | Not run / result: |
| `npm run check:db` (simulated PostgreSQL/Auth) | Not run / result: |
| `npm run check:supabase` (real **local** Supabase Auth/PostgREST) | Not run / result: |
| `npm run check:hosted-preflight` (offline guard checks only) | Not run / result: |
| GitHub Actions (current PR revision) | Pending / link: |
| Manual browser acceptance (with synthetic data) | Not run / owner-reported cases: |
| Hosted Supabase DEV (separately approved owner operation only) | Not run / owner-reported evidence: |

<!-- CI does not prove local Supabase or hosted checks; simulated Auth is not real Auth. -->

## Manual acceptance and remaining risks

**Manual cases to verify:** <!-- Include specific steps and expected results, or "Not applicable". -->

**What remains unverified / known limitations:** <!-- Include security, compatibility, or performance risks. -->

**Hosted DEV approval and cleanup (only if actually relevant):** <!-- Never put project references, credentials, private Auth identifiers, or employee data in a PR. No hosted access is authorized by submitting this PR. -->
