# TipSplitter roadmap

TipSplitter currently offers a browser-local tip allocation preview and optional hosted DEV authentication. It has tenant-scoped roster schema and membership authorization, but the frontend does not yet read application tables. [SPEC.md](SPEC.md) defines the calculation contract; [docs/PRD.md](docs/PRD.md) records product direction and open business decisions. Future sequencing is provisional.

## Completed

The following milestones are merged into `main`:

| Milestone | Delivered | Merged PR / evidence |
| --- | --- | --- |
| Calculation and verification foundation | Pure integer-cent/scaled-weight engine; floor-to-cent and floor-to-dollar payouts; signed reconciliation and explicit unassigned remainder; input/storage validation; 60 engine tests and test/lint/build CI. Retains the browser-local calculator and roster. | [PR #11](https://github.com/ciraheta3/TipSplitter/pull/11) |
| Dependency security and development environment | Remediated dependency advisories at that milestone; Node 24 Dev Container aligned with CI; fixed Vite port 5173 and localhost forwarding. | [PR #13](https://github.com/ciraheta3/TipSplitter/pull/13) |
| Secure roster schema foundation | Organization-scoped PostgreSQL roles and employees, exact default weights, same-tenant constraints, forward-only migrations, closed RLS/ACLs and disposable PostgreSQL checks. No frontend table connection. | [PR #15](https://github.com/ciraheta3/TipSplitter/pull/15) |
| React interface coverage | 15 calculator interface tests; together with 60 calculation tests, the original frontend suite totals 75. | [PR #17](https://github.com/ciraheta3/TipSplitter/pull/17) |
| Membership authorization | Active restaurant memberships authorize admins and closers under tenant-scoped RLS. Client membership administration, organization writes and permanent roster deletes remain denied. | [PR #22](https://github.com/ciraheta3/TipSplitter/pull/22) |
| Real local Supabase Auth/PostgREST integration | Pinned local CLI harness covers Auth-issued sessions, migration-ledger replays, and HTTP authorization against synthetic restaurants. The owner later reported a successful Mac run of 1,416 requests over two replays; this is owner-reported, separate from CI. | [PR #24](https://github.com/ciraheta3/TipSplitter/pull/24) |
| Hosted DEV preparation and authorization verification | Owner-controlled setup and verification procedure; the owner reports a hosted pass with 4,944 HTTP requests, catalog/security audit, persisted comparison, and cleanup of seven temporary users and fictional rows. Codex did not access or independently verify hosted DEV. | [PR #26](https://github.com/ciraheta3/TipSplitter/pull/26); [Issue #29](https://github.com/ciraheta3/TipSplitter/issues/29) |
| Optional DEV email/password authentication | Verified session-gated login/logout; account- and project-isolated browser-local calculator rosters; no application-table access or shared-roster synchronization. The frontend suite now has 122 tests (60 calculation, 15 calculator interface, 28 mocked Auth, and 19 configuration/request/storage-isolation tests). PR #30 reports owner-run browser login/logout acceptance separately from Codex CI results. | [PR #30](https://github.com/ciraheta3/TipSplitter/pull/30) |

These milestones provide a browser-local calculator, optional DEV authentication, and database authorization foundations. They do not provide a shared frontend roster, financial ledger, or production-ready service.

## In progress

- **Issue #31 — membership-aware organization context and read-only shared roster (DEV):** implementation is proceeding on a separate, unmerged branch. This capability is not in `main` and is not described here as completed.

## Planned

No delivery dates are committed. Each milestone needs separate scope and review:

1. **Trusted account lifecycle:** first-admin provisioning, invitations, account changes and revocation through reviewed trusted operations.
2. **Shared roster:** read/write shared roster experience, exact numeric-text weight transport, import policy, and synchronization/conflict handling after access rules are reviewed.
3. **Shifts and immutable history:** lunch/dinner participation, finalization, immutable collected-total and actual-payout snapshots, and correction/audit rules.
4. **Adjustments and reconciliation:** early departure and understaffing after interaction rules are agreed; preserve true collected totals and recorded payouts.
5. **Reporting and export:** scope manager reports, exports, and any staff-facing baseline worksheets separately from fiscal records.
6. **Offline capabilities and launch hardening:** define synchronization/recovery, security operations, backups, and production readiness before launch.

## Open decisions

The PRD remains the source for business rules; this roadmap does not settle them:

- **Leftovers:** recipient, tie-breaker, carryover, and recording policy for residual cents/dollars. Current previews leave all residual money unassigned.
- **Overrides and participation:** role/employee/shift weight precedence and participation across lunch and dinner.
- **Combined adjustments:** order, eligible recipients, caps, and whether adjustments change the pool or shares.
- **Finalization and corrections:** authority to finalize/reopen, reconciliation requirements, allowable unassigned amounts, immutable snapshots, and audit rules.
- **Shared access and data lifecycle:** permissions, retention, and synchronization conflicts; offline reconciliation requires further design.
