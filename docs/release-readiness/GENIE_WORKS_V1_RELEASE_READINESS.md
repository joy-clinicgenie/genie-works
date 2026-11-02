# Genie Works V1 release-readiness execution pack

Version 2. Prepared 30 October 2026, Asia/Singapore. Supersedes the previous single-run prompt.

## Objective and execution status

Complete, verify and document the existing platform in controlled Cursor sessions. Preserve current design and approved functionality. Pause deferred feature expansion.

This pack has been prepared, not executed against the Genie Works application. The application repository is not included here. Run the batches in Cursor with the actual repository open. The original audit remains dated evidence; no fix or release approval is implied by this document.

## How to use this pack

1. Extract the ZIP and place this file plus all numbered batch files in `docs/release-readiness/` inside your existing repository.
2. Add the six original audit files if they are not already present. Keep their original contents.
3. Open a fresh Cursor Agent session for Batch 00 and paste the starter prompt below.
4. Review its handover and changes. Start the next batch in a fresh session using the same prompt with the batch filename changed.
5. Do not carry an unverified claim forward as a completed dependency. A batch may finish with explicit blockers; dependent release gates remain closed.

Each batch is a scope boundary, not a promise to finish within one day. Continue a large batch with its handover if context runs low. No extra approval checkpoint is required for routine local fixes. Production actions remain outside this pack.

## Baseline and source precedence

Audit baseline: 53/100, seven P1, six P2, four P3; 116 automated tests passed. Build/typecheck/lint failed; browser automation did not launch. Running working changes were not represented by the recorded commit. These are historical observations to reproduce, not current assertions.

Read repository instructions, the six V1 audit files, latest approved decisions D11–D21 or superseding decisions, and the V1 requirements register. Audit documents are observations, not permission to alter approved product scope. Resolve conflicts explicitly. Missing external deployment evidence means unknown until checked, not automatically absent.

Keep Blog Performance, form builder, Wix publishing, crawler, bulk redirects, GBP API, llms.txt, NLWeb and alert preferences deferred unless explicitly authorised later. Operational monitoring required for release does not authorise a new staff alert-preferences feature.

## Batch order

| Batch | Purpose | Prerequisites |
| --- | --- | --- |
| 00 | [Establish the baseline and classify the work](00_BASELINE.md) | None |
| 01 | [Produce a reproducible version that builds](01_BUILD_AND_REVISION.md) | 00 |
| 02 | [Create the fictional rehearsal environment](02_SAFE_ENVIRONMENT.md) | 01 |
| 03 | [Demonstrate current-schema recovery](03_BACKUP_AND_RESTORE.md) | 02 |
| 04 | [Prove analytics synchronisation and freshness](04_ANALYTICS_SYNC.md) | 02; 03 before shared rehearsal |
| 05 | [Prove enquiries, notification retry and exports](05_ENQUIRIES_AND_RETRY.md) | 02; 03 before shared rehearsal |
| 06 | [Finish report workflow and credential permissions](06_REPORTS_AND_PERMISSIONS.md) | 01 and 02; data dependencies may use labelled fixtures |
| 07 | [Finish setup, responsive UI and documentation](07_SEED_UI_AND_DOCS.md) | 01 and 02; align docs with completed batches |
| 08 | [Verify complete journeys and negative role cases](08_BROWSER_AND_SITE_JOURNEYS.md) | 01-07; unresolved provider access blocks only dependent cases |
| 09 | [Prepare deployment, monitoring and rollback evidence](09_STAGING_OPERATIONS.md) | 01-08 for full staging readiness; local preparation can proceed earlier |
| 10 | [Freeze and re-audit the exact candidate](10_FINAL_REAUDIT.md) | All preceding applicable checks |

Dependencies are gates for the affected action, not a reason to abandon independent local work. Batches 04 and 05 may use fixtures while access is pending; this does not close live-data gates.

## Three distinct readiness decisions

| Level | Permitted purpose | Evidence required | What it does not establish |
| --- | --- | --- | --- |
| Fictional rehearsal | Supervised testing of isolated fictional data | Reproducible build, isolated targets, safe sign-in, relevant role checks and recoverable fixture data; declared integration limitations | Not an internal operational pilot; no reliance on live clinic enquiries or analytics |
| Connected internal pilot | Named staff use an approved staging environment for the agreed limited workflows | No unresolved P0/P1; exact candidate; green code/browser checks; approved data; required live sync and enquiry/retry evidence; restore; safe runtime configuration; actual scheduler/monitoring; named rollback owner | Not permission to publish publicly or move to production |
| Production candidate | Consideration for operational release | Pilot evidence plus production-specific environment/secrets, provider/sender integration, recovery, monitoring, rollout/rollback, ownership and resolved mandatory gates | No automatic deployment or approval just because a score is high |

The original audit's NO-GO remains until a follow-up establishes otherwise. A fictional demonstration with declared limitations is not relabelled as a pilot to bypass P1 blockers. Any active safety defect affecting the rehearsal environment must be corrected before that rehearsal.

## Classify work before changing code

| Work class | Appropriate response | Closure evidence |
| --- | --- | --- |
| Reproducible code defect | Apply focused change | Relevant regression and runtime checks |
| Environment/configuration gap | Correct isolated configuration; prepare hosted configuration within authority | Correct target and actual operation verified |
| Missing verification | Exercise existing behaviour first | Direct result with exact revision/environment |
| Product decision | Follow latest approved scope; record a concrete unresolved choice | Explicit approved decision and matching implementation |
| Documentation problem | Align instructions with verified behaviour | Reproducible setup/handover |

Do not rewrite working functionality merely because the audit did not test it.

## Issue-to-batch map

| Finding | Primary batch | Additional evidence |
| --- | --- | --- |
| GW-001 build failure | 01 | 10 clean candidate |
| GW-002 uncommitted version | 00, 01 | 10 SHA traceability |
| GW-003 debug calls | 01 | 08 navigation |
| GW-004 real directory in setup/history | 02 | Fresh setup and explicit historical exposure decision |
| GW-005 analytics | 04 | 09 hosted scheduler, 10 |
| GW-006 enquiries | 05 | 08 role journeys |
| GW-007 recovery | 03 | 09 runbook, 10 |
| GW-008 report states | 06 | 08 report journey |
| GW-009 seed duplication | 07 | Repeat seed |
| GW-010 migration numbering | 07 | Fresh/repeated migrate |
| GW-011 connection secrets | 06 | 08 direct denials |
| GW-012 header | 07 | 08 viewport/keyboard |
| GW-013 dev sign-in | 02 | 08 authentication |
| GW-014 headings | 07 | 08 accessibility |
| GW-015 lint warnings | 01, 07 | 10 lint |
| GW-016 stale docs | 07 | 09 handover |
| GW-017 decision test | 01 | 10 decision suite |

Additional release evidence includes external blog/SEO consumer operation, source-system email sender operation, pull-request checks where appropriate and hosted operations. These must be tracked even if they lack a numbered bug.

## Dependencies and decisions to track

Batch 00 creates `docs/audits/V1_DEPENDENCIES.md` with: dependency ID, affected batches/gates, known evidence, responsible role, exact missing input, independent work possible and resolution evidence.

Expected entries include authorised non-production provider access, isolated enquiry source/sender, staging hosting access, migration-history treatment, report permission/final-artifact requirements, blog/SEO consumer destination and named rollback owner. Never place credential values in this register. Assign real names only when supplied or verified.

A local fixture can verify logic while external access is unavailable; it cannot substitute for live integration evidence.

## Required evidence documents

- `docs/audits/V1_REMEDIATION_STATUS.md`: all findings, classification, current evidence, owner role and status.
- `docs/audits/V1_DEPENDENCIES.md`: credentials/access/decision dependencies without secrets.
- `docs/audits/batches/BATCH_XX_HANDOVER.md`: bounded session handover.
- `docs/audits/V1_RELEASE_RETEST.md`: commands, exit codes, runtime/lockfile references, role journeys, provider windows and candidate SHA.
- `docs/audits/V1_PILOT_GO_NO_GO.md`: fictional rehearsal, connected pilot and production decisions separately.
- Existing README, recovery and handover documents updated in place as appropriate.

Use statuses: Not checked, Reproduced, In progress, Fixed awaiting verification, Fixed and verified, Blocked, or Not applicable with approved scope reference. Missing evidence is not a pass. A blocked history-cleanup decision does not close GW-004.

## Commit and evidence integrity

Local task commits are permitted; pushing and deployment are not part of this task. Preserve unrelated work. Verify the final implementation in a clean checkout.

Record `implementation_candidate_sha` and `tested_checkout_sha`; they must match. If evidence is committed afterwards, also record `evidence_commit_sha` and final delivery SHA. A documentation-only evidence commit may point to the tested implementation ancestor. Any runtime/schema/dependency change requires a new candidate and relevant retesting. Never claim an uncommitted working tree is the tested release commit.

## Non-negotiable data rules

No patient-data writes/tests or real clinic messages. No secrets in logs or Git. No shared-database reset/seed/restore. No history rewrite or applied migration renumbering. No second enquiry-message copy. Separate clicks, starts, submissions and bookings; never sum GA4 and Wix traffic. Clearly label fixtures and unavailable data. Preserve notification records when sending fails. Provider acceptance is not inbox receipt.

## Copy-ready starter prompt

```text
Execute Batch 00 using:
docs/release-readiness/GENIE_WORKS_V1_RELEASE_READINESS.md
docs/release-readiness/00_BASELINE.md

Read both files fully, the original audit files and applicable repository
instructions. Work in this existing Genie Works repository. Verify current
findings rather than assuming the historical audit still applies.

Complete only this batch, including its evidence and handover. Continue through
ordinary authorised local work without repeatedly asking permission. Preserve my
existing changes and design. Follow the batch's data, scope and release rules.

When blocked, record the exact missing access/decision and continue independent
work. Never claim a skipped, fixture-only or unrun integration check passed.
Do not push, deploy, rewrite Git history or mutate shared/production data.

Finish with: changes, tests actually run, unresolved blockers, handover path,
current SHA and the next batch filename. Stop at the batch boundary.
```

For the next session, replace `Batch 00` and `00_BASELINE.md` with the next number and filename. Read the previous handover before implementing that batch. To resume the same batch, state its number and ask the agent to continue from its handover without repeating completed evidence unnecessarily.

## Final review rule

A plan can be complete while implementation is blocked. Do not promise a 10/10 release or an arbitrary future score. Close findings through evidence, preserve failed mandatory gates and state exactly what remains before staff can depend on the system.
