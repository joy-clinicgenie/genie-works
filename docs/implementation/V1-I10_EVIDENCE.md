# V1-I10 evidence — align registry permissions

Date: 2026-10-28. Local development only. No production service was interrupted. The original audit, the baseline requirements CSV, and the reconciled requirement status columns were not edited.

## Permission policy

Website and account-reference creates and updates stay with admin and manager.

Sources:

- `canManageRegistry` in `packages/db/src/services/auth.ts` is true only for admin and manager. Its comment covers client registry writes, including websites and references.
- Migration `0007_deny_by_default.sql` replaces `websites_write` and `account_references_write` with `app_is_global()`. Select policies from `0001_foundation.sql` still allow a member to read a client's websites and references.
- D6 records the five roles and client membership. D14 says a specialist member may view, edit and submit for review, and that client membership covers every website of that client. D14 does not name website or account-reference registry records.

No migration was added. Row-level security was not widened, and the application role was not bypassed.

## Root cause

`saveWebsiteAction` and `saveReferenceAction` allowed any specialist member through `canEditClient`. The profile page showed the website and reference forms on the same check. An update that matched no row under the global write policy changed nothing. The service now throws `RegistryRuleError` when a website or account-reference create or update returns no row, and the action returns that failure instead of a success message. The forms and both actions now use `canManageRegistry`. A submitted website or reference id must belong to the posted client before the update runs. The failure text does not name another client's record.

## Requirement evidence

Historical audit status is unchanged.

- CM-03: An admin created a website inside a rolled-back transaction and read the new name, URL and environment back. A manager committed a website note change, read it in a later transaction, and the test restored the original note. In the browser, Demo Admin saved the fictional Harbourview website note, reloaded the profile, and saw the saved note. The original note was then restored through the local service. A specialist member no longer sees Save website or Add website.
- CM-05: An admin created and updated an account reference and read the label back inside a transaction. A committed label change was readable in a later transaction and then restored. The specialist profile shows the reference as text, without Save reference or Add reference.
- CM-09: Existing isolation coverage remains. New checks deny a member specialist, a specialist from another client, a reviewer and a read-only user. Each update throws `RegistryRuleError`, and the website name and reference label stay unchanged. Create attempts by those roles also throw.
- AD-04: No website-level membership was added. D14 already says client membership covers every website of that client. This ticket does not change that assignment model, so AD-04 is not newly verified.
- AD-05: Viewing and editing checks above support the existing admin, manager and member rules. The historical verified status was not rewritten.
- AD-06: Publishing and export were not changed.

## Checks

| Command | Result |
|---|---|
| `npm test -w @clinic-genie/db -- test/permissions.test.ts` | Exit 0. 18 passed. |
| `npm run typecheck` | Exit 0. Contracts, db, and platform passed. |
| `npm run lint` | Exit 0. 0 errors, 10 warnings. None are in the registry files changed for this ticket. The warnings are the existing anonymous ESLint export, six plain links, and three image warnings. |

Browser, signed in as Demo Admin, fictional Harbourview profile: Save website and Save reference were present. Saving a website note returned "Website saved." A reload showed the new note. The original note was restored and a later reload showed it.

Browser, signed in as Demo Specialist A, on an active synthetic client created for this check: the website and reference were visible as text. Save website, Add website, Save reference, Add reference, and the booking-edit hint were absent. The only form on the page was sign-out. That synthetic client was then archived.

A hand-built specialist POST to the website action id returned HTTP 500 with "Connection closed" before the permission check. The website name was unchanged afterward. The direct denial evidence is the service and RLS tests, not that protocol error.

## Unresolved decision

Whether D14's specialist "edit" includes creating and updating websites and account references is not stated. This ticket does not grant that write. If that grant is wanted, it needs an explicit decision and a new migration. Until then, those writes remain admin and manager only.

## Limitations

The permission suite rolls back its create checks, then commits and restores one website note and one reference label. Those restores leave append-only audit events. The browser save and restore did the same for the Harbourview website note. The synthetic client `v1-i10-registry-check` remains archived in the local database, with its website, reference and audit events. Seed client rows were restored to their previous values.
