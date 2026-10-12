# Restaurant Tip Pool Manager roadmap

[docs/PRD.md](docs/PRD.md) is the product direction and open-decision source; [SPEC.md](SPEC.md) is the current engineering contract. This roadmap supersedes the prototype demo's export/template/polish priorities.

## Prototype baseline (completed before PR 1)

- React + TypeScript + Vite and Tailwind dashboard.
- Cash/credit pool inputs and add/remove employee roster persisted locally.
- Inline calculations and an on-screen variance panel; nearest rounding could overpay, and the panel was not an automated test suite.

## PR 1: calculation foundation (Issue #10)

- Pure integer-cent/scaled-weight calculation and signed reconciliation engine.
- Floor-to-cent and floor-to-dollar modes with explicit unassigned money.
- Validation and minimal existing-screen integration.
- Automated engine tests, test/check scripts, PR CI, AGENTS.md, and aligned documentation.

## PR 3: secure roster schema foundation (Issue #14)

- Organization-scoped roles and employees with exact default weights and same-tenant foreign keys.
- Versioned transactional migrations, closed RLS/ACLs, disposable PostgreSQL checks and backend design documentation.
- No runtime database connection; the existing frontend and local roster continue unchanged.

## Later work (provisional order)

Memberships, verified authentication and narrow tenant policies must be reviewed
before introducing shared roster synchronization. See [docs/BACKEND.md](docs/BACKEND.md).

1. Shared employees, independent lunch/dinner shifts, and weight override models.
2. Early-departure and understaffing adjustments after simultaneous-adjustment rules are decided.
3. Finalization, actual payout history, and reconciliation after audit/editing rules are decided.
4. Secure shared accounts/sync and separately scoped reporting.

Leftover allocation, override precedence, simultaneous adjustments, and finalization remain explicitly open in the PRD. No export, print, authentication, Supabase, or redistribution work is authorized by PR 1.
