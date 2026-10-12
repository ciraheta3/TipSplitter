# Engineering guidance

- Keep changes small and tied to the issue; preserve React, TypeScript, Vite, and the existing UI where practical.
- Keep calculation code pure. Use integer cents and scaled integer weights; never hide an overpayment or silently distribute residual money.
- Preserve true collected totals and actual historical payouts. Calculation previews are not finalized ledgers; never rewrite history with new rules.
- Clarify business ambiguities and record open decisions in docs/PRD.md and the PR. Do not invent redistribution or finalization policies.
- Never commit secrets or real employee, wage, or restaurant data. Use synthetic examples.
- Work on a feature branch. Run npm test, npm run lint, and npm run build before handing off; explain failures if blocked.
- Explain the behavior change, checks run, and remaining risks in a reviewable PR against main. Avoid unrelated cleanup and unnecessary abstractions.
