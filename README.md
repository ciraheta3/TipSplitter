# TipSplitter / Restaurant Tip Pool Manager

A React + TypeScript + Vite dashboard for previewing weighted tip allocations. Cash and credit tips form one pool; the employee roster remains local to this browser through localStorage. Product direction and open decisions are in [docs/PRD.md](docs/PRD.md); the current calculation contract is in [SPEC.md](SPEC.md) and milestones in [ROADMAP.md](ROADMAP.md).

## Develop and verify

Use Node.js 24 LTS (the CI version; current Vite requires at least Node 20.19 or 22.12).

```bash
git clone https://github.com/ciraheta3/tip-calculator.git
cd tip-calculator
npm ci
npm run dev
```

```bash
npm test          # Vitest engine tests, runs once
npm run lint      # ESLint
npm run build     # TypeScript check + production bundle in dist/
npm run check     # All three checks
npm run preview   # Serve the production build locally
```

GitHub Actions runs install, tests, lint, and build on pull requests and pushes to main. Preserve the lockfile when updating dependencies.

## Calculation behavior (Issue #10)

- Money parses directly into integer cents and weights scale to integer hundredths. Invalid, negative, non-finite, over-precision, or unsafe values produce visible errors rather than silent rounding. Blank cash/credit fields mean zero.
- Cent mode floors each proportional payout to the nearest lower cent. At weights 100 and 50, $100.00 allocates $66.66 and $33.33, leaving $0.01 unassigned. A $0.02 pool with three equal weights allocates $0.00 each and leaves $0.02.
- “Round down to whole dollar” floors payouts to dollars: the same $100.00 pool pays $66 and $33, leaving $1.00. This replaces the prototype's nearest-dollar rounding.
- Remainder is **collected minus allocated**, displayed with its sign. Positive means unassigned; negative would mean overpaid. The allocation engine cannot overpay. Leftovers are recorded without choosing a recipient or distributing pennies automatically.
- Zero individual weights are supported. With no participants or no positive weights, all tips stay unassigned and the screen explains why.
- The roster key/shape is compatible with the prototype. Malformed stored rows and invalid weights are reported. Unreadable saved data is not overwritten on mount; an explicit roster change saves a new roster. If browser storage fails, edits remain available only for the session.

The dashboard is a **calculation preview**, not evidence of actual payouts or a finalized ledger. PR 1 adds no backend, authentication, synchronization, adjustments, history, or reports. Leftover policy, simultaneous adjustments, override precedence, and finalization rules remain open in the PRD.

## Engineering

The pure engine is in `src/calculation.ts`; tests in `src/calculation.test.ts` cover rounding, invalid input, signed reconciliation, and conservation at small and large integer boundaries. UI/storage concerns remain in `src/App.tsx`. Contribution guidance is in [AGENTS.md](AGENTS.md).

Before handing off a change, run all checks and smoke-check mobile add/remove, roster persistence, cash + credit totals, both payout modes, and invalid-input feedback. Use synthetic employees for examples and tests.

---

## 📄 License & Terms
This project is proprietary and is protected under a private ownership license. Unauthorized copying, distribution, or modification of this source code via any medium is strictly prohibited.

---

## 👤 Author
**Carlos Iraheta** 📩 carlosiraheta543@gmail.com  
[Portfolio Link] | [LinkedIn]
