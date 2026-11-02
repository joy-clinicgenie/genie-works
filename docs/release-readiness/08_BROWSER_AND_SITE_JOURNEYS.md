# Batch 08 — Verify complete journeys and negative role cases

Prerequisites: 01-07; unresolved provider access blocks only dependent cases.

## Instructions applying to this batch

- Read `GENIE_WORKS_V1_RELEASE_READINESS.md` and this batch file in full. Follow repository instructions and approved decisions; preserve existing design and user work.
- Implement only this batch. When complete, write the handover and stop at this explicit session boundary. Do not ask for confirmation for ordinary authorised local fixes. Start the next batch when the user supplies its prompt.
- If one dependency is blocked, continue independent tasks in this batch. Record the exact missing input; never treat waiting or missing credentials as approval.
- Use fictional isolated data for all writes/tests/exports. Never reset, restore or seed shared/production data, leak secrets, send real messages, force-push, rewrite Git history, deploy or publish.
- No deferred feature expansion. Do not weaken measurement, permissions or tests to produce a pass. Do not create a second copy of enquiry messages.
- Add targeted tests for substantive behaviour changes. Reuse existing checks for cosmetic changes. Record actual commands and exit codes, separating passed, failed, skipped and blocked.
- Local reviewed task commits are permitted. Stage explicit files. Do not push. Preserve unrelated dirty work; verify candidates in a clean worktree where needed.
- Treat the audit as historical evidence, not a guarantee of the present code state. Preserve the original reports.

## Work to execute

Install the browser required by the repository Playwright version. Use fictional data and a production-mode candidate where applicable. Run actual browser tests; do not count launch failures as executed application tests.
Exercise signed-out, admin, manager, specialist, reviewer where defined and read-only roles against the approved permission matrix. Check assigned versus unassigned clients and direct-request denials.
Complete client create/edit/archive, blog draft/review/approve/publish/preview, enquiry status/retry/export and report finalisation/retrieval journeys. Confirm staff deactivation invalidates sessions. Check desktop/mobile layout and meaningful keyboard/focus/label behaviour.
For blog and SEO distinguish publishing to the protected API from a clinic website applying it. Verify a fictional article and SEO change in an authorised non-production consumer where one exists. If no consumer is available, report that integration boundary as unverified; do not build an unspecified new website.
Run relevant performance/accessibility checks on the current successful production build. Do not reuse old Lighthouse results or claim complete WCAG conformance from one automated scan. Keep any inspection screenshots containing sensitive data out of deliverables.

## Completion gate

Browsers actually execute. Happy paths, direct-request negative cases, client isolation and role boundaries have evidence. Website consumption, keyboard/accessibility limitations and external integration gaps are stated precisely. Failed/skipped/blocked cases remain distinguishable.

## Required handover

Update `docs/audits/V1_REMEDIATION_STATUS.md` and write `docs/audits/batches/BATCH_08_HANDOVER.md` with:

- Starting and ending SHA, branch and environment aliases.
- Files changed and audit issues addressed.
- Commands, exit codes and evidence references; no sensitive records or secrets.
- Fixed and verified, partially fixed, blocked and unverified items separately.
- Dependencies or decisions still needed, responsible role and smallest next action.
- The next batch and whether its prerequisites are met.

Do not fabricate timestamps, provider responses, approvals, owners or verification.
