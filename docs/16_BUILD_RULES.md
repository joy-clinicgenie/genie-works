# Claude and Cursor build rules

## Authority and change control
Follow the PDF Version 2.0 and this derivative pack. Implement one ticket at a time in dependency order. Do not implement the earlier dashboard-first brief, all 88 modules from the older SOP or unspecified Wix categories. Record scope changes before implementation.

## Working method
Inspect existing code first. Work in feature branches and commit daily. Keep one shared domain model, consistent naming and versioned contracts. Use migrations, managed auth and managed providers. Inspect generated code, dependencies and permissions. Run project-defined lint, type checks and relevant tests; inspect failures before merging.

Check current official provider documentation during implementation for supported APIs, limits, hosting jobs, authentication and costs. This pack does not verify any vendor capability or authorise a paid subscription.

## Ticket prompt
```text
Read 00_README.md, 01_PRODUCT_SCOPE.md, 02_INFORMATION_ARCHITECTURE.md,
03_ROLES_PERMISSIONS.md, 04_DATA_MODEL.md and this file.
Implement only Ticket CG-XX from 17_BUILD_TICKETS.md.
First inspect the repository, state dependencies and list unresolved decisions.
Explain changed files and contract/migration effects before implementation.
Preserve client isolation and the separation between public pages, shared services and admin.
Add relevant normal, failure, concurrency and unauthorised tests.
Run lint/typecheck/tests using repository scripts. Report exact results and blockers.
Provide demonstration evidence and rollback/forward-recovery steps.
Do not add unrelated modules, new paid providers or unapproved schema changes.
```

## Completion report
Ticket and commit; changed files; migrations; test commands/results; redacted demonstration; known limitations; remaining approvals; recovery path; next ticket. Do not mark live from a local visual demonstration.

Escalate major schema changes, new paid vendors, changed patient-data handling, production secrets, critical regressions, duplicated backend logic or effort increasing by more than a working day. Apply existing user authorisation to routine work; do not treat every reversible implementation choice as a fresh approval request.
