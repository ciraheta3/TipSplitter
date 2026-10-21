# Engineering guidance

- Keep changes small and tied to the issue; preserve React, TypeScript, Vite, and the existing UI where practical.
- Keep calculation code pure. Use integer cents and scaled integer weights; never hide an overpayment or silently distribute residual money.
- Preserve true collected totals and actual historical payouts. Calculation previews are not finalized ledgers; never rewrite history with new rules.
- Clarify business ambiguities and record open decisions in docs/PRD.md and the PR. Do not invent redistribution or finalization policies.
- Never commit secrets or real employee, wage, or restaurant data. Use synthetic examples.
- Work on a feature branch. Run npm test, npm run lint, and npm run build before handing off; explain failures if blocked.
- Explain the behavior change, checks run, and remaining risks in a reviewable PR against main. Avoid unrelated cleanup and unnecessary abstractions.

## Code Review Rules

- Independently inspect the actual PR diff, its base/head revisions, relevant unchanged dependencies, and applicable project specifications. Do not treat the PR description or agent-reported checks as verification.
- Flag floating-point money calculations, unsafe decimal-to-weight conversions, silently changed rounding, reconciliation defects, or residual-money redistribution contrary to SPEC.md.
- Flag authentication and tenant-boundary regressions: unverified session identity, unauthorized membership access, broadened RLS/ACL grants, cross-restaurant reads/writes, service credentials in the browser, and privileged public RPC exposure. Verify against docs/BACKEND.md and docs/AUTH.md.
- Flag migrations that edit already-applied files, weaken constraints or grants, incorrectly change trusted helper privileges, or risk hosted data. New database migrations must be forward-only and separately reviewed.
- Flag stale React state or async results displayed after logout, account/project switching, membership revocation, retries, cancellation, or failed refresh. Preserve isolation between browser-local calculator data and shared restaurant records.
- Flag behavior that implies previews are finalized payouts or invents business rules absent from docs/PRD.md.
- Distinguish frontend tests, disposable simulated PostgreSQL checks, real local Supabase Auth/PostgREST tests, owner-reported browser/hosted acceptance, and independently verified evidence. CI is not proof of unrun manual checks.
- Report actionable findings with severity, file/line, concrete impact, and an appropriate fix. If a required check cannot be verified, call out the gap rather than assuming it passed. Do not merge or operate hosted infrastructure during review.
