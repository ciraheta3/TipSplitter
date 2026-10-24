# v0.1.1 scroll stability investigation

Investigated from `main` at `de19ddfcc24bc84849f9e8ea0a57020ee491eedb`
(merged PR #43), on 2026-10-24. Fixtures contain 50 invented employees and mocked
Auth/REST responses. No hosted Supabase access, seeding or database operation was
performed. No financial engine, authorization verifier, request schedule or RLS
change is included.

## Demonstrated cause and its limits

Routine access verification collapses large sections of the document. A browser
must keep its scroll offset inside the resulting shorter scroll range; it can
also adjust its scroll anchor when content above the viewport changes. Restoring
the content does not reliably restore the user's viewport. This is a demonstrated
application defect and a credible explanation for the reported iPad symptoms.
Native iPad Safari was unavailable, so the exact cause of every reported device
jump is **not confirmed**.

Baseline source references (pinned to the investigated revision):

- [AuthGate.tsx, lines 29–42](https://github.com/ciraheta3/TipSplitter/blob/de19ddfcc24bc84849f9e8ea0a57020ee491eedb/src/AuthGate.tsx#L29-L42): the shared roster is above the browser-local calculator even when local mode is selected. Thus a shared-section defect can affect both calculation sources. The unconfigured, unsigned-in local-only prototype has no shared section; this mechanism does not explain a jump there.
- [SharedRoster.tsx, lines 25–39](https://github.com/ciraheta3/TipSplitter/blob/de19ddfcc24bc84849f9e8ea0a57020ee491eedb/src/SharedRoster.tsx#L25-L39): a 60-second timer, window focus, online/offline, and visible-document events increment the access revision. [Lines 99–123](https://github.com/ciraheta3/TipSplitter/blob/de19ddfcc24bc84849f9e8ea0a57020ee491eedb/src/SharedRoster.tsx#L99-L123) immediately classify the old revision as loading and remove the entire summary via `!loading && roster`. Loading text also changes layout.
- [SharedCalculation.tsx, lines 77–82](https://github.com/ciraheta3/TipSplitter/blob/de19ddfcc24bc84849f9e8ea0a57020ee491eedb/src/SharedCalculation.tsx#L77-L82): a pending parent check, own verification or Auth revision makes `employees` undefined. [Lines 110–124](https://github.com/ciraheta3/TipSplitter/blob/de19ddfcc24bc84849f9e8ea0a57020ee491eedb/src/SharedCalculation.tsx#L110-L124) hide the addition form with `hidden` and remove the participant list. [Line 180](https://github.com/ciraheta3/TipSplitter/blob/de19ddfcc24bc84849f9e8ea0a57020ee491eedb/src/SharedCalculation.tsx#L180) marks the calculator unavailable; [Calculator.tsx line 112](https://github.com/ciraheta3/TipSplitter/blob/de19ddfcc24bc84849f9e8ea0a57020ee491eedb/src/Calculator.tsx#L112) applies `hidden` to it, removing its layout space too.
- [SharedCalculation.tsx, lines 32–75](https://github.com/ciraheta3/TipSplitter/blob/de19ddfcc24bc84849f9e8ea0a57020ee491eedb/src/SharedCalculation.tsx#L32-L75): same-account Auth events also start verification. Routine success retains selections, defaults, temporary entries and weights in React state. The calculator remains mounted, explaining intact data after the jump. Participant DOM rows, however, are removed and recreated.

## Other hypotheses examined

Checkbox selection, rounding and tip entry update component state. They do not
call the access-refresh function or deliberately scroll/focus anything. Ordinary
rounding taps in the browser fixture caused neither a request nor a scroll change.
A touch/scroll can coincide with a minute check; returning to a tab can generate
focus/visibility/Auth events. There is no evidence here that every normal iPad tap
fires window focus or an Auth event.

Separate events can restart requests before previous ones finish; parent roster
and child calculation verification can run concurrently. Existing abort controllers,
revision checks and scope keys reject stale responses. The fix leaves these checks
and their frequency intact. Event coalescing is not necessary to correct the
measured rendering defect and could alter revocation timing.

The account/restaurant/client keys are stable within a scope. `useAuth` retains the
same-account gate during valid token checks and hides it on failure/expiry; see
[useAuth.ts](../src/useAuth.ts). No unexpected whole-calculator remount or navigation
was observed. Browser evidence records a stable `performance.timeOrigin` and the
same connected cash-input DOM node across checks; participant nodes disconnected
on baseline and remain connected with the fix. This distinguishes the observed
collapse from a full reload without pretending to prove every React lifecycle event.

The fixture blurs text input before measuring refreshes: no virtual keyboard is
needed to trigger the defect. CSS has no application scroll restoration, fixed
viewport lock or touch handler. Real Safari toolbar resizing, touch momentum,
focus/keyboard handling and its scroll-adjustment behavior remain device-specific
acceptance items. Chromium with touch enabled is **not Safari emulation**.

## Correction

[SharedRoster.tsx](../src/SharedRoster.tsx) keeps the summary subtree mounted while
pending. [SharedCalculation.tsx](../src/SharedCalculation.tsx) keeps its existing
participant, form and calculator subtree and inputs intact. Both reserve space
for their status text. PR #44 initially used `visibility: hidden` and `inert` on every pending check.
Real iPad testing then confirmed that this caused a white flash every minute.
Previously verified same-scope content now stays visible and `inert` during a
routine check, retaining its dimensions without a flash. Initial loads, explicit
reloads, offline states and failed authorization still hide or remove protected
content. The existing `canEdit` guards continue rejecting stale participant events.

Errors, revocation, account/restaurant/client changes, sign-out and explicit
snapshot reload still clear the corresponding protected data as before. Pending
DOM is retained only within the same scope; it is not a fallback after failure.
No `scrollTo`, saved scroll offset, arbitrary minimum roster height, new dependency
or security-check suppression is used. Successful routine checks keep protected content visible and preserve the
scroll position. They briefly block interaction until verification finishes. Real roster changes
or intentional source switches can legitimately change its size.

## Reproduction and automated evidence

The optional [browser harness](../scripts/check-scroll-stability.mjs) serves the
[synthetic fixture](../scripts/fixtures/scroll.tsx) through Vite. It imports real
application components and uses an in-memory SDK fetch transport. The browser also
blocks non-loopback HTTP requests. This fixture is not an entry in the production
build and needs no credentials or Supabase service.

Use an existing Playwright installation (the application gains no dependency):

```bash
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
CHROMIUM_PATH=/absolute/path/to/chromium \
node scripts/check-scroll-stability.mjs
```

With Playwright resolvable normally and its Chromium installed, omit the variables.
Results and timestamped scroll/focus/visibility/request events go to
`work/scroll/result.json`. The harness asserts scroll offsets, document/section
heights, input/row connectivity, unchanged document identity, preserved input/rounding/
weights/temporary draft values, ordinary rounding taps and removal after revocation.
It holds responses to observe the pending state, then releases successful reads.
It exercises focus, visible-document, online, a clock-advanced real minute interval,
a focus/visibility/Auth burst, and shared same-account Auth checks.

Executed with Linux Chromium 154.0.8037.57, 820 × 1180 CSS pixels, touch enabled,
Node 24.19.0 / npm 11.9.0. The same harness was run against an isolated source copy
of the baseline and the fix:

| Measurement | Baseline before → pending → complete | Fixed before → pending → complete |
| --- | --- | --- |
| Local mode, focus, scrollY | 8205 → 5511 → 8205 | 8245 → 8245 → 8245 |
| Local mode, document height | 9385 → 6691 → 9385 | 9425 → 9425 → 9425 |
| Shared mode, focus, scrollY | 9431 → 0 → 0 | 9511 → 9511 → 9511 |
| Shared participant list height | 8796 → 0 → 8796 | 8796 → 8796 → 8796 |
| Shared document height | 11318 → 1180 → 11318 | 11398 → 11398 → 11398 |

Local Chromium restored its anchor after completion in these runs; shared mode
remained at zero. That variation is consistent with layout-dependent behavior,
not evidence that Safari must choose the identical offsets. New reserved status
slots explain the small fixed-versus-baseline initial height difference.

The 11 delayed-refresh cases fail against baseline and pass with the fix. A
follow-up browser assertion requires verified summary and participant rows to
remain visible during successful pending checks. Unit regressions retain exact
DOM references for 50-row previews, assert visible/inert pending states, reject
stale edit events, and preserve local storage.
Existing tests cover failed verification, account/project/restaurant changes,
sign-out, offline access, late responses, temporary participant lifecycle and exact
arithmetic. `npm run check` passed: **383 frontend tests in 8 files**, **14 offline
provisioning groups**, **41 offline harness tests**, ESLint, TypeScript and the
production build. The focused two-file run passed **132 tests**. Browser layout
checks are a separate optional command; jsdom alone cannot verify scrolling.

No native Safari, hosted RLS, real local Supabase or database checks are claimed.
The code does not change those layers. A pending check makes controls inert and may affect focus on native Safari;
test real keyboard/touch behavior before release. The previously verified
snapshot remains visible until a check finishes, so a revoked member may see
old content while a request is in flight. Failed verification removes it; this
is not instantaneous revocation. Auth sign-out/account changes still clear the
view immediately.

## Three-minute iPad acceptance, without hosted data

1. On a computer reachable by the iPad on the same trusted network, check out this
   branch, run `npm ci`, then `npm run dev -- --host 0.0.0.0`. Open
   `http://<computer-LAN-address>:5173/scripts/fixtures/scroll.html` in iPad Safari.
   This page uses only the 50 synthetic employees and mocked access. Do not use the
   normal app URL or configure/seed hosted Supabase for this test.
2. In **Browser-local roster**, enter cash/credit, scroll to the last employees and
   continue scrolling/tapping for at least 65 seconds. Switch Safari tabs and back.
   Expect no upward displacement; amounts and roster remain.
3. Switch to **Restaurant shared roster**, select employees near the middle and
   bottom, edit a temporary weight, add a temporary participant and enter tips.
   Dismiss the keyboard. Toggle rounding, scroll/tap for at least 65 seconds and
   switch tabs and back. The verified content should stay visible during routine access checks,
   while its space and scroll position remain stable. Selections, weights, temporary
   entries and inputs must remain intact.
4. Briefly repeat with the keyboard open and after rotating the iPad. Source exit
   intentionally clears shared temporary entries; switching back to local must
   restore the local amounts/roster. Record iPadOS version, orientation, trigger,
   and whether a keyboard was visible if a jump persists. Do not export tokens or
   real employee data. No hosted revocation or database edits are needed.
