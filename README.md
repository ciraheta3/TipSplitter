# TipSplitter

TipSplitter helps restaurant managers preview how a pooled cash and credit tip total is split among employees using share weights. The current application is a browser-local calculator; the product direction is a shared shift-management application with auditable payout history.

## Current features

- Cash and credit entry combined into one tip pool, with blank inputs treated as zero.
- Employee roster with names, job titles, share weights, and add/remove controls, saved in this browser's localStorage.
- Integer-cent-safe weighted allocation, with payouts floored to cents or whole dollars.
- Total collected, allocated payouts, and an explicitly unassigned remainder. Residual money is never automatically redistributed.
- Visible validation for invalid amounts, weights, and saved roster data; storage failures allow session-only roster edits.
- Responsive dashboard. Zero individual weights are allowed; an empty or all-zero roster leaves the entire pool unassigned.

For a $100.00 pool with weights 100:50, cent mode previews $66.66 and $33.33 with $0.01 unassigned. Whole-dollar mode previews $66 and $33 with $1.00 unassigned. These are allocation previews, not records of actual payments.

## Architecture and stack

The client uses React 19, TypeScript 6, Vite 8, and Tailwind CSS 4. [src/App.tsx](src/App.tsx) handles the dashboard, input state, and browser-local roster storage. The pure TypeScript engine in [src/calculation.ts](src/calculation.ts) parses money into integer cents, scales weights to integer hundredths, and uses BigInt intermediates for exact proportional arithmetic and signed reconciliation.

Vitest runs 75 automated tests: 60 calculation tests and 15 frontend interface tests using React Testing Library, user-event, jest-dom, and jsdom; ESLint and TypeScript check the source. GitHub Actions runs tests, lint, and the production build on pull requests and pushes to `main`.

A PostgreSQL roster schema is implemented in versioned migrations, with organization-scoped roles and employees, exact weights, same-tenant constraints, and deny-by-default RLS and table privileges. Application access remains closed: there is no live Supabase integration, authentication, or frontend database connection. See [backend design and verification](docs/BACKEND.md). A separate CI job checks the database schema.

## Development

Use Node.js 24 LTS and npm, matching CI and the Dev Container.

```bash
git clone https://github.com/ciraheta3/tip-calculator.git
cd tip-calculator
npm ci
npm run dev
```

Open `http://localhost:5173`. The development server uses a fixed port; stop any existing process on 5173 before starting it.

```bash
npm run check    # All 75 tests, ESLint, TypeScript, and production build
npm run build    # Production bundle in dist/
npm run preview  # Serve the production build locally
```

The frontend needs no backend services or credentials. With Bash and a running local Docker daemon, `npm run check:db` runs disposable PostgreSQL migration, constraint, and RLS checks. These are separate from `npm run check`, which does not validate SQL. See [docs/BACKEND.md](docs/BACKEND.md) for prerequisites, commands, and verification limits.

### VS Code Dev Container

Install Docker Desktop and the VS Code Dev Containers extension, then open the repository in VS Code. Select **Dev Containers: Reopen in Container**, or **Rebuild and Reopen in Container** after configuration changes. The [container configuration](.devcontainer/devcontainer.json) uses Node 24; run `npm ci` and `npm run dev` in its terminal.

Vite binds to `0.0.0.0` inside the container through `VITE_DEV_HOST`; outside it, Vite defaults to localhost. VS Code forwards port 5173 to localhost on your host. Open the address shown in the **Ports** panel (normally `http://localhost:5173`); no Docker host port publishing is needed.

## Limitations and direction

- Rosters are local to one browser, with no shared login, roster synchronization, or cloud storage. Cash and credit draft inputs reset on refresh.
- No lunch/dinner shift records, finalization, immutable history, or actual payout ledger exist. Preview allocations must not be treated as historical payments.
- Adjustments, automatic leftover allocation, reports, exports, and offline synchronization are not implemented. Money and weights accept nonnegative plain decimals with at most two fractional digits; invalid or unsafe values are rejected rather than rounded.

Future work includes tenant-scoped access, shared rosters, separate shifts, immutable payout history, adjustments and reconciliation, reporting/export, and eventual offline capabilities. Sequencing and business rules remain provisional. [ROADMAP.md](ROADMAP.md) records the merged calculation, development environment, roster schema, and interface-testing milestones alongside future work.

## Project documentation

- [Roadmap](ROADMAP.md): completed milestones, proposals, and future work.
- [Product requirements](docs/PRD.md): product direction and unresolved business decisions.
- [Calculation specification](SPEC.md): current allocation and persistence contract.
- [Backend foundation](docs/BACKEND.md): schema, access boundaries, migration checks, and future integration requirements.
- [Interface tests](docs/UI-TESTS.md): test commands, coverage, limitations, and browser smoke checks.
- [Contribution guidance](AGENTS.md): repository engineering and verification requirements.

## License

This project is proprietary. Unauthorized copying, distribution, or modification is prohibited.
