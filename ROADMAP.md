# Tip Calculator Project Roadmap — Production Demo Milestone

## [ ] Milestone 1: Core Architecture Baseline (V1.0) — COMPLETE ✅
- [x] Scaffold Vite + React + TypeScript environment
- [x] Configure Tailwind CSS v4 styling layer
- [x] Implement immutable array state mutation for employee roster (Add/Remove)
- [x] Code derived state calculations (Total Tip, Total Shares, Payout Per Share)
- [x] Build dynamic tip distribution engine with a Round-to-Dollar toggle
- [x] Integrate mathematical TDD verification panel with absolute variance indicators
- [x] Deploy lazy state initialization to persist data locally via browser localStorage

## [ ] Milestone 2: Engineering Hardening (V1.1) — CURRENT BATTLEGROUND 🛠️
- [x] **Task 2.1: Zero-Weight Edge Case Validation Guard**
  - *Threat:* Roster containing exclusively 0-weight entries breaks calculation runtime.
  - *Fix:* Enforce active form-level rejection or fallback state to prevent layout breaking.
- [x] **Task 2.2: Local Storage Defensive Serialization (Type-Safety)**
  - *Threat:* Malformed or corrupted browser data triggers unhandled parsing exceptions on mount.
  - *Fix:* Refactor state initialization block with a explicit `try/catch` and array verification wrapper.
- [ ] **Task 2.3: Floating-Point Rounding Defense (Cents Scaling Layer)**
  - *Threat:* Native binary arithmetic floating-point leaks fractional micro-pennies.
  - *Fix:* Refactor internal state calculations to operate entirely via integer cents ($Dollars \times 100$).

## [ ] Milestone 3: Feature Expansion for Workplace Demo (V2.0) 🚀
- [ ] **Task 3.1: Historical Shift Logger**
  - *Goal:* Save a permanent snapshot of a completed shift payout pool into a local history log.
- [ ] **Task 3.2: Export to CSV Engine**
  - *Goal:* Allow managers to download a spreadsheet-compatible text file of tip distributions for payroll.
- [ ] **Task 3.3: Roster Templates**
  - *Goal:* Allow saving standard employee team templates so managers don't re-type names every shift.

## [ ] Milestone 4: Frontend Polish & Brand Alignment (V2.1) 🎨
- [ ] Refactor visual wireframe shell into a high-contrast theme matching workplace aesthetics
- [ ] Integrate dark mode optimization toggle
- [ ] Conduct comprehensive mobile viewport responsive design audit