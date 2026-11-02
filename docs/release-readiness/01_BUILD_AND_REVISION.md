# Batch 01 — Produce a reproducible version that builds

Prerequisites: 00.

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

Reproduce current build/typecheck/lint failures before fixing them. Address the unused Link import, temporary localhost ingest regions, BackButton lint failure and obsolete DAY-01 decision assertion where still applicable. Search all relevant files for the audited ingest endpoint and equivalent temporary telemetry. Do not disable useful lint rules globally.
Use the existing test commands. Preserve scope and security assertions while updating obsolete tests. Resolve relevant failures and document warnings intentionally retained.
Review the diff; explicitly stage only intended files. Never use git add indiscriminately across unrelated work. Make a local task commit when checks pass. Verify the committed version in a clean worktree/checkout with isolated configuration. Keep the original working changes safe. Do not push or deploy.

## Completion gate

Typecheck, lint, domain tests, decision tests and production build pass for the candidate, with exact commands and exit codes. The fresh checkout renders the intended home page. Debug ingest calls are absent. Intended implementation files are committed; unrelated changes are documented.

## Required handover

Update `docs/audits/V1_REMEDIATION_STATUS.md` and write `docs/audits/batches/BATCH_01_HANDOVER.md` with:

- Starting and ending SHA, branch and environment aliases.
- Files changed and audit issues addressed.
- Commands, exit codes and evidence references; no sensitive records or secrets.
- Fixed and verified, partially fixed, blocked and unverified items separately.
- Dependencies or decisions still needed, responsible role and smallest next action.
- The next batch and whether its prerequisites are met.

Do not fabricate timestamps, provider responses, approvals, owners or verification.
