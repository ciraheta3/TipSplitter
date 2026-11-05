# Interface wording (Issue #49)

The branch `issue-49-interface-copy` starts at latest main `e4631cd`, after
Issue #48 merged in PR #52 (`0e69dc4`) and including Issue #53 / PR #54.
This is a wording and restrained presentation change. The calculation engine,
Auth/access checks, state ownership, data lifetimes, storage, management saves and
Supabase are unchanged.

| Before | After |
| --- | --- |
| TipSplitter · DEV preview, repeated DEV and membership explanations | TipSplitter heading, one small DEV indicator, account and Sign out |
| Browser-local roster / Restaurant shared roster | Local roster / Restaurant roster |
| Tip Calculator Dashboard | Calculation preview · Not saved |
| Repeated temporary-preview / no-payment explanations | Preview amounts are not recorded payments, beside the totals |
| Browser-local roster… not synchronized to Supabase… fictional data for DEV testing | Local roster · Saved in this browser only. |
| Several paragraphs about shared selection and Supabase | Choose participants for this calculation; concise relative-share help and explicit reload consequences |
| × in selected results | Exclude from calculation; accessible name also identifies the participant and duplicate IDs |
| Remove temporary participant | Retained for deleting a one-time entry; exclusion keeps that entry available |
| Shared employee name / Default shared job role / Save shared roster | Employee name / Default job role / Save roster |
| Sign in to your preview with repeated Auth/membership explanations | Sign in; contact the project owner for an account or restaurant access |

Selected restaurant context, inactive eligibility reasons, relative shares versus
percentages, exact input validation, unreadable/failed local storage, missing
membership, offline/retry and access-loss errors remain available. Source exit
still explains which local inputs survive and which restaurant-preview selections,
weights and temporary participants are cleared. Reload/discard, expired draft,
conflict and uncertain-save warnings remain explicit. Draft-safety details retain
the existing native expandable disclosure; there is no new help system.

Native form labels, decimal keyboard hints, error descriptions, live statuses,
focus management, role expansion, duplicate-name identifiers, disabled/inert access
checks and keyboard operation are retained. Exclusion's visible words also appear
in its accessible name. Result rows may wrap to accommodate the explicit action.
The unconfigured local preview also has a TipSplitter heading and a clear
not-signed-in label.

## iPad Safari acceptance checklist — pending

Use synthetic data and the reviewed feature checkout. This checklist does not
authorize deployment, hosted configuration, provisioning or roster changes.
Record the commit, iPad/Safari version, orientation and any failed step.

- [ ] Portrait and landscape: TipSplitter is recognizable, exactly one modest DEV
  marker appears when signed in, and the account/Sign out remain usable. Long
  restaurant names wrap; the selected restaurant and source are easy to identify.
- [ ] Local roster: no redundant restaurant employee list above the calculator.
  Local storage context is concise; add/remove, cash/credit and rounding still work.
- [ ] Restaurant roster: role groups/counts, temporary entries, current weight
  inputs and totals fit without horizontal scrolling, clipped actions or overlap.
  Repeat with long/duplicate names and the software keyboard open.
- [ ] Results clearly say Calculation preview · Not saved and that amounts are not
  recorded payments. With $100 and shares 100:50, expect $66.66/$33.33 and $0.01
  unassigned; whole dollars give $66/$33 and $1. No payment/finalization claim.
- [ ] Exclude from calculation deselects only that participant and updates totals;
  reselecting retains exact weight text. A temporary entry remains available after
  exclusion; Remove temporary participant deletes only that temporary entry.
- [ ] Invalid/blank/negative/excess-precision weights or invalid money show useful
  errors and unavailable results. Zero stays explicit. Inactive rows give a reason.
- [ ] Reload/source-exit consequences are understandable before acting. Routine
  access checks keep layout and valid/invalid drafts stable while blocking edits;
  explicit reload clears selections/temporary entries and restores current defaults.
- [ ] Manage roster works from either source; selected restaurant stays clear.
  Add/Edit labels and focus are useful. Back retains the calculation. Unsaved
  drafts require Keep editing or Discard draft and return. Check expired-draft,
  conflict and uncertain-save feedback only with separately authorized fixtures.
- [ ] VoiceOver: heading order, restaurant/source labels, expanded states, input
  labels/default/error descriptions, live status/errors and named exclusion/removal
  controls are useful. Duplicate names remain distinguishable.
- [ ] External keyboard: Tab, radio arrows, Space for selection/group toggles,
  Enter for actions, decimal editing and focus on management entry/return work.
  Repeat after orientation changes; check touch targets and scroll/caret stability.
- [ ] Offline/retry, no membership, lost access, account/restaurant changes and
  sign-out retain clear feedback and clear protected previews as before. These
  scenarios require owner-controlled synthetic access; no real staff/payment data.

Automated React/SDK checks use mocked transports. Chromium tablet-size screenshots
are supplementary rendering evidence, not native Safari, VoiceOver or real
Auth/PostgREST/RLS acceptance. See the PR for executed checks and results.

## Executed verification

On 2026-10-28, Linux / Node 24.19.0 / npm 11.9.0:

- `npm run check`: 429 frontend tests in eight files, 14 offline provisioning
  checks, 41 offline roster harness tests, ESLint, TypeScript and Vite build passed.
  Existing validation, storage, Auth/access, duplicate-name, draft/recovery,
  navigation and calculation tests use the updated accessible labels. Two new
  regressions cover the heading/single DEV marker/source/preview copy and
  keyboard exclusion versus temporary-entry removal.
- `git diff --check`: passed.
- Existing `check-scroll-stability.mjs`, using Chromium 154.0.8037.57: all 11
  focus/visibility/online/minute/Auth cases passed at 820 × 1180. Its selectors
  use the new labels and the restaurant controls retained after Issue #48 removed
  the local-mode shared summary.
- Supplementary synthetic Chromium screenshots inspected at 820 × 1180 and
  1180 × 820: local and restaurant previews, result actions and the management
  employee form had no horizontal overflow. These ran only against a loopback
  fixture with non-loopback requests blocked; no management save was attempted.

Native iPad Safari/VoiceOver and real Auth/PostgREST/RLS/database checks were not
run. No hosted DEV access, configuration, data change or deployment occurred.
