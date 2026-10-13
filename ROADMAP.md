# TipSplitter roadmap

TipSplitter currently provides a browser-local tip allocation preview. The direction is a shared restaurant shift-management application that preserves true collected totals and actual historical payouts. [SPEC.md](SPEC.md) defines the current calculation contract; [docs/PRD.md](docs/PRD.md) records product direction and open business decisions. Future sequencing is provisional.

## Completed

The following milestones are merged into `main`:

| Milestone | Delivered | Merged PR |
| --- | --- | --- |
| Calculation and verification foundation | Pure integer-cent/scaled-weight engine; floor-to-cent and floor-to-dollar payouts; signed reconciliation and explicit unassigned remainder; input/storage validation; 60 engine tests and test/lint/build CI. Retains the React dashboard and browser-local roster. | [#11](https://github.com/ciraheta3/tip-calculator/pull/11) |
| Dependency security and development environment | Remediated dependency advisories at that milestone; Node 24 Dev Container aligned with CI; fixed Vite port 5173 and localhost forwarding; documented startup and draft-input reset behavior. | [#13](https://github.com/ciraheta3/tip-calculator/pull/13) |

These milestones provide a calculation preview, not a shared service or finalized ledger.

## In progress / proposed

Both proposals below remain open and unmerged. Their changes are not part of the current application on `main`:

| Proposal | Scope | Status |
| --- | --- | --- |
| [#15: Secure roster schema foundation](https://github.com/ciraheta3/tip-calculator/pull/15) | Proposed PostgreSQL/Supabase organizations, roles, and employees with tenant constraints and row-level security (RLS) closed to application access. Does not introduce live backend access, authentication, or roster sync. | Open; awaiting review |
| [#17: React UI tests](https://github.com/ciraheta3/tip-calculator/pull/17) | Proposed automated interface coverage for inputs, allocation modes, validation, and roster persistence, plus UI test documentation. | Open; awaiting review |

## Planned

No delivery dates are committed. Each milestone requires separate scope and review:

1. **Memberships and authentication:** establish verified restaurant membership and permissions, with narrowly tested tenant-scoped RLS before enabling shared data access. Supabase is a proposed foundation, not a connected service today.
2. **Shared roster:** introduce shared employees and configurable roles, weight inheritance/overrides, and synchronization after access and conflict rules are defined.
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
