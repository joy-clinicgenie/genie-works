# Weighted release metrics

Use the original category weights, but the current-scope checks in 02. The new scope and fixed formula mean historical scores are context, not an exact like-for-like trend. Do not claim a percentage improvement in code quality from these numbers.

| Category | Weight /100 | Check prefix |
| --- | ---: | --- |
| Functional completeness | 20 | FN |
| Security and permissions | 20 | SC |
| Data integrity and analytics | 15 | DA |
| Forms and enquiries | 10 | EQ |
| Integrations and publishing | 10 | IN |
| UI, UX and accessibility | 7 | UX |
| Performance and stability | 5 | PS |
| Automated testing and code quality | 5 | QA |
| Deployment and recovery | 5 | OP |
| Documentation and handover | 3 | DC |
| Total | 100 | |

## Grade each applicable check 0–5

| Grade | Evidence threshold |
| --- | --- |
| 0 | Absent or no usable evidence. Mark Failed or Unverified separately; a zero does not prove a defect. |
| 1 | UI/specification only or static implementation evidence only; essential behaviour absent or not exercised. |
| 2 | Partial implementation or isolated fixture/unit success with material workflow gaps. |
| 3 | Coherent local workflow demonstrated with relevant tests; live/hosted evidence required for this check remains missing. |
| 4 | Main path plus negative/error cases verified in the relevant environment, with one material release evidence gap. |
| 5 | Entire named check verified, including relevant permissions/failure/persistence cases, for the candidate and intended environment. |

Evidence requirements depend on the check. A deterministic unit permission check can earn 5 through appropriate tests. A live provider or hosted persistence check cannot earn 5 from fixtures. Never force unrelated live-provider evidence onto purely local checks.

Statuses: Pass, Partial, Fail, Unverified, Blocked, Out of scope. Pass generally requires the complete named behaviour; Partial is incomplete behaviour. Fail means demonstrated contradiction. Blocked/unverified checks stay in the score denominator; grade only evidence actually available, often 0. Out-of-scope checks are excluded with an explicit decision reference. Never exclude a required item merely because credentials are missing.

## Calculation

All applicable checks within a category have equal weight. For category c:

`category_points = category_weight * sum(check_grades) / (5 * applicable_check_count)`

Use unrounded category values for the total; round only the final total to one decimal using ordinary half-up rounding. Display category values to two decimals. No hidden deductions or bonus points. If a whole category is legitimately excluded, do not redistribute silently: report the applicable-weight denominator and a normalised score separately.

Example: four grades 5, 4, 2, 0 in a 10-point category yield 10 * 11 / 20 = 5.50 points.

Module evidence readiness uses only FN-01 through FN-09 and the linked module checks: report grade and evidence gap per module; if showing a percentage, label it an evidence grade conversion (grade/5 *100), not percentage built.

## Required operational metrics

| Metric | Definition/evidence |
| --- | --- |
| Verification coverage | Passed applicable checks / all applicable checks; show Partial/Fail/Blocked/Unverified counts separately. |
| Automated tests | Passed/failed/skipped tests and files; distinguish domain, decision and browser suites. |
| Role coverage | Roles exercised / roles in approved matrix, with denied actions and client isolation evidence. |
| Connector coverage | Wix and native independently: configured, fixture tested, live tested, hosted verified. Never collapse to one connected flag. |
| Sync freshness | Last successful complete sync, observed time, provider timezone and age. Report per site/provider. |
| Queue state | Queued/running/succeeded/failed/cancelled where supported, oldest queued age and retry state; never drain a live queue during audit. |
| Provider reconciliation | Same property/date/timezone/filter: platform figure, provider figure, absolute difference and explanation. Relative error only if provider value is nonzero. No universal invented tolerance; explain any discrepancy. |
| Enquiry reconciliation | Unique stored source submissions versus displayed eligible records for the same site/form/window; exclude starts/clicks/bookings and apply documented spam/test rules. |
| Retry safety | Unique enquiries before/after controlled retry; attempted sends distinguished from accepted/delivered notifications. No real send. |
| Recovery | Schema version, included tables, restored representative rows/relationships, isolated destination and actual restore outcome. |
| Artifact persistence | Draft creates no artifact, saved version survives local restart, old version unchanged, authorised retrieval; hosted persistence separately. |
| Performance | Production-mode measurements only; identify tool, route, device profile, sample count. Lab LCP/CLS are not field CWV. |
| Regression closure | Original GW-001–017 status with current evidence, new findings separately. |

## Score bands and gates

95–100: strong production-candidate evidence; 85–94: strong internal-pilot-candidate evidence; 70–84: incomplete; below 70: substantial release evidence gaps. These labels never override gates. A score is not deployment authorisation.

Report three distinct assessments: supervised fictional local rehearsal, connected internal pilot, production candidate. Open P0/P1 issues affecting the target environment block operational pilot/production approval. A limited isolated demonstration can be assessed separately with explicit limitations; do not rename it a pilot.
