# TipSplitter roadmap

TipSplitter currently provides a browser-local tip allocation preview. The direction is a shared restaurant shift-management application that preserves true collected totals and actual historical payouts. [SPEC.md](SPEC.md) defines the current calculation contract; [docs/PRD.md](docs/PRD.md) records product direction and open business decisions. Future sequencing is provisional.

## Completed

The following milestones are merged into `main`:

| Milestone | Delivered | Merged PR |
| --- | --- | --- |
| Calculation and verification foundation | Pure integer-cent/scaled-weight engine; floor-to-cent and floor-to-dollar payouts; signed reconciliation and explicit unassigned remainder; input/storage validation; 60 engine tests and test/lint/build CI. Retains the React dashboard and browser-local roster. | [#11](https://github.com/ciraheta3/tip-calculator/pull/11) |
| Dependency security and development environment | Remediated dependency advisories at that milestone; Node 24 Dev Container aligned with CI; fixed Vite port 5173 and localhost forwarding; documented startup and draft-input reset behavior. | [#13](https://github.com/ciraheta3/tip-calculator/pull/13) |
| Secure roster schema foundation | Implemented organization-scoped PostgreSQL roles and employees, exact default weights and same-tenant constraints; versioned transactional migrations, closed RLS/ACLs, disposable PostgreSQL checks, and [backend documentation](docs/BACKEND.md). No runtime database connection, authentication, or roster sync. | [#15](https://github.com/ciraheta3/tip-calculator/pull/15) |
| React interface coverage | 15 frontend interface tests for inputs, allocation modes, validation, and roster persistence, with [test documentation](docs/UI-TESTS.md). Together with the 60 calculation tests, the automated suite totals 75 tests. | [#17](https://github.com/ciraheta3/tip-calculator/pull/17) |

These milestones provide a browser-local calculation preview and a closed database foundation, not a shared service or finalized ledger.

## In progress / proposed

No additional implementation proposal is listed here. PRs #15 and #17 are merged and appear under Completed; the milestones below remain future work.

## Planned

No delivery dates are committed. Each milestone requires separate scope and review:

1. **Memberships and authentication:** establish verified restaurant membership and permissions, with narrowly tested tenant-scoped RLS before enabling shared data access. The PostgreSQL roster schema exists; live Supabase integration and reviewed membership-based access policies remain unimplemented. See [docs/BACKEND.md](docs/BACKEND.md).
2. **Shared roster:** connect the implemented employee/role schema to the frontend, with exact weight transport, weight inheritance/overrides, localStorage import, and synchronization after access and conflict rules are defined.
3. **Shifts and immutable history:** model independent lunch/dinner participation, finalization, and immutable snapshots of collected totals and actual payouts; define corrections and audit history before implementation.
4. **Adjustments and reconciliation:** support early departure and understaffing after interaction rules are agreed; preserve true collected totals and recorded payouts.
5. **Reporting and export:** scope manager reports, exports, and any staff-facing baseline worksheets separately; distinguish simplified views from fiscal records.
6. **Offline capabilities:** consider offline work and synchronization after shared-data conflict and reconciliation policies are established.

## Open decisions

The PRD remains the source for business rules; this roadmap does not settle them:

- **Leftovers:** recipient, tie-breaker, carryover, and recording policy for residual cents/dollars. Current previews leave all residual money unassigned.
- **Overrides and participation:** role/employee/shift weight precedence and participation across lunch and dinner.
- **Combined adjustments:** order, eligible recipients, caps, and whether adjustments change the pool or shares.
- **Finalization and corrections:** authority to finalize/reopen, reconciliation requirements, allowable unassigned amounts, immutable snapshots, and audit rules.
- **Shared access and data lifecycle:** permissions, retention, and synchronization conflicts; offline reconciliation requires further design.
