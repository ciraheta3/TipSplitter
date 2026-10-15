# TipSplitter

TipSplitter helps restaurant managers preview how a pooled cash and credit tip total is split among employees using share weights. The current application is a browser-local calculator with optional hosted DEV email/password authentication; the product direction is a shared shift-management application with auditable payout history.

## Current features

- Cash and credit entry combined into one tip pool, with blank inputs treated as zero.
- Employee roster with names, job titles, share weights, and add/remove controls, saved in this browser's localStorage.
- Integer-cent-safe weighted allocation, with payouts floored to cents or whole dollars.
- Total collected, allocated payouts, and an explicitly unassigned remainder. Residual money is never automatically redistributed.
- Visible validation for invalid amounts, weights, and saved roster data; storage failures allow session-only roster edits.
- Optional hosted DEV sign-in/sign-out, verified session restoration and per-account browser-local roster isolation. No shared roster synchronization.
- Membership-aware **Shared roster · DEV · Read only** with a restaurant selector, separate from the calculator. Shared weights and editing are deferred; see [design, validation and owner acceptance](docs/SHARED-ROSTER.md).
- Responsive dashboard. Zero individual weights are allowed; an empty or all-zero roster leaves the entire pool unassigned.

For a $100.00 pool with weights 100:50, cent mode previews $66.66 and $33.33 with $0.01 unassigned. Whole-dollar mode previews $66 and $33 with $1.00 unassigned. These are allocation previews, not records of actual payments.

## Architecture and stack

The client uses React 19, TypeScript 6, Vite 8, and Tailwind CSS 4. [src/App.tsx](src/App.tsx) selects local preview or the DEV Auth gate; [src/Calculator.tsx](src/Calculator.tsx) handles the unchanged calculator inputs and browser-local roster. See [frontend Auth setup and acceptance](docs/AUTH.md). The pure TypeScript engine in [src/calculation.ts](src/calculation.ts) parses money into integer cents, scales weights to integer hundredths, and uses BigInt intermediates for exact proportional arithmetic and signed reconciliation.

Vitest preserves the original 75-test foundation (60 calculation and 15 interface tests) and adds mocked authentication/configuration tests using React Testing Library, user-event, jest-dom, and jsdom; ESLint and TypeScript check the source. GitHub Actions runs tests, lint, and the production build on pull requests and pushes to `main`.

A PostgreSQL roster schema is implemented in versioned migrations, with organization-scoped roles and employees, exact weights, same-tenant constraints, and deny-by-default RLS and table privileges. Active admins and closers can inspect their restaurant's shared roster after verified Auth; the separate browser-local calculator remains unchanged. A local Supabase harness verifies real Auth/PostgREST authorization. See [backend design and verification](docs/BACKEND.md). A separate CI job checks the database schema.

## Development

Use Node.js 24 LTS and npm, matching CI and the Dev Container.

```bash
git clone https://github.com/ciraheta3/TipSplitter.git
cd TipSplitter
npm ci
npm run dev
```

Open `http://localhost:5173`. The development server uses a fixed port; stop any existing process on 5173 before starting it.

```bash
npm run check    # All tests, ESLint, TypeScript, and production build
npm run build    # Production bundle in dist/
npm run preview  # Serve the production build locally
```

The explicitly marked local-only prototype needs no backend services or credentials. For optional DEV email/password login, follow [docs/AUTH.md](docs/AUTH.md): configure only the project URL and publishable key in ignored `.env.local`. In configured mode, a verified signed-in session is required before the calculator appears. With Bash and a running local Docker daemon, `npm run check:db` runs disposable PostgreSQL migration, constraint, and RLS checks. `npm run check:supabase` runs real local Supabase Auth/PostgREST tests with synthetic accounts and two fictional restaurants, using pinned CLI 2.120.0. Run it from Mac Terminal with Docker Desktop, not the VS Code Dev Container. It resets and removes the dedicated local integration database. Both backend checks are separate from `npm run check`, which does not validate SQL. See [docs/BACKEND.md](docs/BACKEND.md) for prerequisites, commands, and verification limits.

For an isolated hosted development project, follow the [owner-controlled Supabase
DEV guide](docs/HOSTED-DEV.md). It includes manual setup/migrations and explicitly
approved synthetic authorization verification. Issue #29 records **owner-reported** completed hosted authorization verification
(4,944 HTTP requests), catalog/security audit, persisted comparison and cleanup of
all seven temporary users/fictional rows. Codex has not independently rerun it.
`npm run check:hosted-preflight` tests only local safety guards; no hosted workflow
runs automatically. Browser login/logout acceptance remains owner-manual after PR review.

### VS Code Dev Container

Install Docker Desktop and the VS Code Dev Containers extension, then open the repository in VS Code. Select **Dev Containers: Reopen in Container**, or **Rebuild and Reopen in Container** after configuration changes. The [container configuration](.devcontainer/devcontainer.json) uses Node 24; run `npm ci` and `npm run dev` in its terminal.

Vite binds to `0.0.0.0` inside the container through `VITE_DEV_HOST`; outside it, Vite defaults to localhost. VS Code forwards port 5173 to localhost on your host. Open the address shown in the **Ports** panel (normally `http://localhost:5173`); no Docker host port publishing is needed.

## Limitations and direction

- Rosters remain local to one browser, isolated by project and verified account when DEV Auth is configured; local-only mode keeps the legacy roster. No roster synchronization or cloud roster storage. Cash and credit draft inputs reset on refresh.
- No lunch/dinner shift records, finalization, immutable history, or actual payout ledger exist. Preview allocations must not be treated as historical payments.
- Adjustments, automatic leftover allocation, reports, exports, and offline synchronization are not implemented. Money and weights accept nonnegative plain decimals with at most two fractional digits; invalid or unsafe values are rejected rather than rounded.

Future work includes tenant-scoped access, shared rosters, separate shifts, immutable payout history, adjustments and reconciliation, reporting/export, and eventual offline capabilities. Sequencing and business rules remain provisional. [ROADMAP.md](ROADMAP.md) records the merged calculation, development environment, roster schema, and interface-testing milestones alongside future work.

## Project documentation

- [Roadmap](ROADMAP.md): completed milestones, proposals, and future work.
- [Product requirements](docs/PRD.md): product direction and unresolved business decisions.
- [Calculation specification](SPEC.md): current allocation and persistence contract.
- [Backend foundation](docs/BACKEND.md): schema, access boundaries, migration checks, and future integration requirements.
- [DEV authentication](docs/AUTH.md): frontend configuration, architecture, manual login/logout checklist and cleanup.
- [Interface tests](docs/UI-TESTS.md): test commands, coverage, limitations, and browser smoke checks.
- [Contribution guidance](AGENTS.md): repository engineering and verification requirements.

## License

This project is proprietary. Unauthorized copying, distribution, or modification is prohibited.
