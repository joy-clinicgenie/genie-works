# Audit execution and safety

## A — Freeze scope and identify candidate

Read current decisions and requirements, original audit, latest retest and handovers, dependency register and staging activation notes. Record current branch, HEAD, dirty/untracked paths, lockfile and runtime versions. Do not print environment files. If runtime changes are dirty, audit a reproducible snapshot in an isolated worktree and label it uncommitted; do not attribute it to HEAD. Default audit does not commit user work. A committed candidate is required for release approval.

## B — Inspect implementation

Use targeted searches and reads. Verify all nine modules and both source connectors. Compare original GW-001–017 to current code and requirements. Distinguish implementation gaps, missing evidence, configuration and product decisions. Do not classify absence of a Genie Works mail sender as a defect. Inspect D23 report artifacts and actual hosted persistence, not an invented PDF/finalisation requirement.

## C — Run isolated checks

Verify test source/destination aliases and guards first. Use the existing scripts and test framework. Run typecheck, lint, domain tests, decision tests, production build and applicable production dependency audit. Inspect PR workflow coverage. Use fictional database fixtures and separate processes. Apply schema migrations only to newly created disposable targets needed for tests, never shared targets. Log that mutation. Install required browser/dependencies when necessary without changing lockfiles unintentionally. If installation/network access is blocked, record the block.

Run browser roles and direct-request denials. Preserve current production enquiry-fixture guard. If fixture journeys require development mode, label those separately from production-mode journeys. Do not reuse an existing dev server without identifying its revision and database; use separate ports and stop only audit-created processes.

Backup/restore only fictional data into a distinct disposable destination. Include saved-artifact recovery as well as database rows or explicitly report missing coverage. Do not delete source evidence. Do not use a secret-bearing dump as a deliverable.

Audit does not fix application code, weaken tests, change migrations in place, commit, push, deploy, activate automations or send email. New tests/helpers can be created only in an isolated audit worktree; disclose their diff and keep product unchanged. Preserve all original files.

## D — External and hosted evidence

Use existing approved non-production targets and read-only access only when available. If exact property/site/source authority is absent, mark blocked. Do not select a production property as a substitute. A manual run is not a scheduled run. Live read-only provider fetches must not silently enqueue work or write shared connections; use isolated configuration. Existing source email acceptance and human receipt confirmations can be cited with their original environment/time and limitations; do not invent new receipt or send another email.

Recorded owner choices are authorisation/decisions, not successful technical checks. Separate DEP-01–08 decision-supplied/access-available/verification-complete states. Reassess each against current scope; not every website must use Resend. Unknown external configuration remains unknown, not absent.

## E — Report and review

Generate six outputs from the templates, score all registry rows with evidence and formula, then list target-specific gates. Scope exclusions require a decision reference. Preserve historical scores; explain changed scope/formula and evidence limitations. Include precise next action and responsible role for every blocker. Never invent a named person or acceptance.

## Mandatory gate matrix

| Gate | Local fictional rehearsal | Connected internal pilot | Production candidate |
| --- | --- | --- | --- |
| Reproducible build and relevant checks | Required | Required | Required for production config |
| Safe fictional/authorised data and role isolation | Required | Required with approved source access | Required with operational controls |
| No unresolved severe defect affecting target | Required for safe demo | No open P0/P1 affecting pilot | No open P0/P1 affecting production |
| Wix and native workflows | Fixture availability/limits declared | Both required under current two-source scope; any limited pilot exclusion must be explicitly approved | Both claimed supported sources verified |
| Analytics, source enquiries and consumer site | May be blocked with demo limitations | Required live/hosted evidence for approved pilot functions | Required for production functions |
| Email | Simulated or existing test evidence labelled | Source-owned sending/receipt evidence if notification tracking is included; no platform sender required | Operational source sending evidence |
| Saved reports | Local Draft/Saved snapshots verified | Durable hosted storage/retrieval/recovery proven | Durable operational storage/recovery proven |
| Backup and recovery | Isolated database and artifact checks | Current pilot schema/artifacts, restore and owner | Production recovery coverage and owner |
| Scheduler/monitoring/rollback | Local preparation may suffice for demo | Hosted evidence and named responsible owner | Production-specific evidence and rollout plan |

This audit can issue NO-GO while local tests pass. Do not repeatedly demand out-of-scope report approval states or a platform email sender.

## Severity

P0: proven critical compromise, destructive loss or isolation failure with immediate impact. P1: blocks reliable/safe operation of the target release, e.g. build failure, missing required source, data corruption or unproven recovery. P2: important workflow/permission/usability defect with constrained impact. P3: minor presentation/documentation/maintainability defect. State the affected environment. Missing evidence can block a gate without asserting an exploit or data breach. Accepted residual exposure stays documented and does not vanish from the risk register.
