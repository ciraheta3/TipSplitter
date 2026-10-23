# Current engineering specification (PR 1 / Issue #10)

Product direction and open business decisions live in [docs/PRD.md](docs/PRD.md). This contract replaces the prototype's nearest-rounding and absolute-variance rules.

## Calculation contract

`src/calculation.ts` is pure TypeScript with no React, storage, or network dependencies.

- `parseTipInput` converts plain decimal text directly to integer cents. Empty cash/credit inputs mean zero. Negative, non-finite, malformed, exponent, and more-than-two-decimal values are rejected, not rounded.
- `parseWeightInput` scales a displayed share by `WEIGHT_SCALE = 100`; e.g. 100 shares = 10,000 units and 0.25 shares = 25 units. Empty weights are invalid; zero individual weights are allowed.
- Numeric money and weight-unit API inputs must be nonnegative safe integers. Collected/allocated totals and total weight units must also fit `Number.MAX_SAFE_INTEGER`; overflow is rejected. BigInt intermediates preserve exact multiplication/division even when their products exceed this range.
- `sumTipCents` adds separately validated cash and credit cents. No floating-point dollar arithmetic is used.
- `distributeTips(poolCents, participants, mode)` preserves participant order and requires nonempty unique IDs. With positive total weight `W` and weight `w`, exact-cent payout is `floor(poolCents * w / W)`. Whole-dollar payout is `100 * floor(poolCents * w / (100 * W))`.
- Empty/all-zero rosters return `status: 'no-positive-weight'`, zero payouts, and the full pool as unassigned. No division occurs. Otherwise status is `allocated`; a zero-weight participant receives zero.
- Every distribution returns the pool, payouts, total weight units, allocated cents, and signed remainder. `sum(payouts) + remainder = pool`, with `remainder >= 0`. Residual cents/dollars are never automatically awarded.
- `reconcilePayouts` also audits externally supplied integer-cent payouts: `remainder = collected - allocated`. A negative result explicitly means overpayment; reconciliation does not change those payouts.
- `formatCents` preserves the exact cent value and sign, including at the safe-integer boundary.

## Screen and persistence

- Keep the mobile-first Tailwind dashboard, cash + credit fields, roster add/remove, and legacy `employees` localStorage key in unconfigured local-only mode. Configured DEV Auth uses project/account-namespaced roster keys and never imports the legacy roster; see [Auth contract](docs/AUTH.md). Stored employee shape remains `{ id, name, jobTitle, weight }`, with numeric displayed weights; convert at the calculation boundary.
- Reject unsafe/invalid stored weights visibly rather than silently changing them. Validate stored row shapes before rendering. Unreadable saved data is left untouched on mount; an explicit roster change saves the new roster. Storage failures show a warning while allowing session-only edits.
- Label the toggle “Round down to whole dollar.” Display total collected tips, allocated tips, and a signed “Unassigned Remainder” with its meaning. Invalid inputs show errors and unavailable payouts, not plausible fallback numbers.
- This is a preview. No finalization, actual payout history or adjustment logic exists. Issue #29 adds optional DEV Auth; merged PR #34 (Issue #31) adds a separate [membership-aware read-only roster](docs/SHARED-ROSTER.md), originally without calculator inputs or synchronization. PR #39 adds shared default editing; Issue #42 on this branch adds explicit shared calculation previews with exact `weightUnits`, temporary selections and no localStorage import. Neither changes calculation rules. See [shared calculator contract](docs/SHARED-ROSTER-CALCULATOR.md). Issue #14 adds the roster schema described in [docs/BACKEND.md](docs/BACKEND.md). New rules must never be applied retroactively to future historical records.

## Verification

Run `npm test`, `npm run lint`, and `npm run build` (or `npm run check`). Tests cover required rounding examples, invalid inputs, empty/zero-weight pools, large integer products, signed overpayment, and money conservation. PR CI installs with `npm ci` and runs all three checks. Smoke-check add/remove, persistence, cash + credit, both payout modes, errors, and narrow mobile screens.

Issue #14 schema verification is separate: `npm run check:db` executes SQL migrations
and assertions in disposable local PostgreSQL 17, with no hosted credentials. The
frontend checks do not validate migrations. See [docs/BACKEND.md](docs/BACKEND.md)
for exact weight storage, tenant constraints, deny-by-default access and limitations.
