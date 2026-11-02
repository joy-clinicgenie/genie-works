# Copy-ready Cursor re-audit prompt

```text
Perform a fresh, evidence-based Genie Works V1 re-audit.

Read all files in docs/re-audit-pack/, including the metrics,
check registry, execution rules and six templates. Read repository
instructions, current approved decisions, requirements, original audit,
latest retest, batch/report handovers and DEP-01 through DEP-08 records.

Audit the current implementation; do not fix application code.
Do not stop at a plan. Complete all available inspection, isolated
checks and six report outputs in this session or continue with a
checkpoint if context runs low.

Current scope:
- All nine platform modules.
- Enquiries from BOTH Wix and vibe-coded website sources.
- Each website owns sending. Genie Works reads submissions and
  available notification status, with supported source retry requests.
- No inbox ingestion, platform mail sender or second stored copy of
  personal submission messages is required or authorised.
- Reports are Draft/Saved under D23, with frozen versioned JSON under
  docs/report. No Approved/Final states unless a later decision says so.
- Evaluate hosted report durability separately from local success.
- Respect explicit deferred features and recorded history decisions.

Identify the exact current candidate and whether it is committed.
Use a clean isolated checkout/worktree for repeatable checks. Record
SHA, dirty changes, runtime, lockfile and redacted environment aliases.
Never attribute dirty runtime code to HEAD. Do not commit user changes.

Run existing typecheck, lint, tests, decision checks, production build,
browser role/negative journeys and fictional backup/restore checks.
Verify database AND saved-artifact recovery. Preserve the production
fixture guard. Distinguish development-fixture from production checks.
Inspect source/role/secret/tenant boundaries and both connectors.
Use authorised non-production read-only provider evidence where
available. Do not pick production accounts to bypass a blocker.

Do not send email, drain live queues, deploy, push, change hosted
settings, reset shared data or weaken tests. Stop only audit-created
processes. No secrets, personal submissions or sensitive screenshots
in deliverables. Existing receipt evidence is historical evidence,
not a new receipt or general production-delivery proof.

Score every applicable check in 02_CHECK_REGISTRY.md using the fixed
formula in 01_METRICS_AND_SCORING.md. Keep blocked/unverified required
checks in the denominator, with only the grade evidence supports.
No hidden deductions. State score comparability limits against 53/100
and 62/100. Do not reuse either as the new score.

Create a uniquely dated output directory under docs/audits/ and write:
1. V1_GO_NO_GO.md
2. V1_RELEASE_SCORECARD.md
3. V1_MODULE_PARITY.md
4. V1_BUG_REGISTER.md
5. V1_TEST_RESULTS.md
6. V1_REMEDIATION_PLAN.md

Preserve old reports and original issue IDs. Track new findings with
new IDs. Separate demonstrated defects, accepted risks and missing
verification. Assess DEP decisions versus actual verification.

Finish with the exact tested SHA, new score and calculation, pass/
partial/fail/blocked/unverified counts, original issue closure counts,
new findings, and separate local-rehearsal/internal-pilot/production
recommendations. Name the top five next actions and evidence paths.
If blocked, continue independent checks and state precise missing inputs.
Never claim an unrun check passed or all checks were live.
```
