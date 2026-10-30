# V1-V01 evidence — repair automated suite

Date: 2026-10-28. Local development database only. No production account was changed and no invitation was sent. The original audit and the baseline requirements CSV were not edited. Historical requirement status columns were left as recorded.

## Reproduced failures

`npm test` is `npm run test --workspaces --if-present`. Contracts has no test script, so it is not a test target. The database and platform workspaces are.

| Command | Result before this ticket's new tests |
|---|---|
| `npm test -w @clinic-genie/platform` | Exit 1. Vitest 4.1.12: "No test files found, exiting with code 1". Include pattern `src/**/*.test.ts`. `passWithNoTests` is not set. |
| `npm test -w @clinic-genie/db -- test/permissions.test.ts -t "deactivated member"` | Exit 0. 1 passed, 17 skipped. |

The audited deactivation failure is not the current test. The working tree already deactivates through `updateStaff` as an admin staff context, which satisfies the admin-only trigger, and revokes sessions through `revoke_staff_sessions`. That function is security definer and still raises unless `app_is_admin()` is true. Triggers and row-level security were not disabled.

A later full permission run failed one existing isolation assertion because a leftover synthetic website, `V1-I10 synthetic site`, was still visible to specialist A. It had no child rows. That website row was removed. The archived client record and its audit events remain. The assertion was left as an exact seed-client list.

## Root cause

The platform workspace runs Vitest, and Vitest exits 1 when the include pattern matches nothing. That made the root test command fail even when the database suite passed. The platform package had no `src/**/*.test.ts` file.

The application access check is separate from a hand-set database context. `getAccess` loads only an active staff record for the session email, and `requireAccess` redirects to `/sign-in` when that record is missing. Deactivation also deletes the database session through the admin-only revoke function.

## Changes

- `packages/db/test/permissions.test.ts`: after an admin deactivation, `getActiveStaffByEmail` is null and the named session is gone. After the admin restores the account, the active staff record is readable again. Existing task and `sessionsRevoked >= 1` assertions stay. A specialist cannot change their own role or active flag; the admin-only trigger rejects it. A manager cannot change another staff record; row-level security changes no row and the service throws `RegistryRuleError`. The staff row is unchanged.
- `apps/platform/src/lib/access.test.ts`: calls `getAccess`, `requireAccess`, `requireClientAccess`, and `updateStaffAction` against the local database. The session email is supplied to the same access function the application uses. No pass-with-no-tests setting was added.

## Commands

| Command | Result |
|---|---|
| `npm test -w @clinic-genie/db -- test/permissions.test.ts` | Exit 0. 19 passed. |
| `npm test -w @clinic-genie/platform` | Exit 0. 3 passed. |
| `npm test` | Exit 0. Database 7 files, 51 passed. Platform 1 file, 3 passed. |
| `npm run typecheck` | Exit 0. |
| `npm run lint` | Exit 0. 0 errors, 10 existing warnings. None are in the files changed for this ticket. |

Vitest still exits 1 when a test fails. That was observed on the platform command before any test file existed, and on the permission file while the leftover website was present.

## Deactivation and permissions

- An active synthetic specialist, with a database session and a membership on synthetic client `v1-v01-access-check`, is returned by `getAccess`. They can edit that client and cannot manage the registry or users. `requireClientAccess` opens that client and redirects `/clients?denied=1` for another client id.
- A read-only account cannot access or edit that client. An admin can.
- `updateStaffAction` as specialist A and as the manager returns "Only admins can change staff records." The synthetic account stays an active specialist and the session remains.
- `updateStaffAction` as the admin deactivates the account. The session count for that token becomes 0. `getAccess` for the same email returns null. `requireAccess` redirects `/sign-in`.
- The admin action reactivates the account. `getAccess` succeeds again. The synthetic client is archived at the end of the platform file. The synthetic staff account is left active.

## Requirement notes

- AD-02: the checks above are the runtime deactivation evidence for this ticket. The reconciled CSV status was not changed.
- AD-05: viewing and editing are enforced by `getAccess` plus `canAccessClient` and `canEditClient`, including a denied client. The historical verified status was not rewritten.

## Limitations

The platform tests mock the Auth.js session lookup and return the email. They then use the real staff lookup, membership resolution, server action, and session revoke. They do not drive a browser sign-in. `signIn` uses the same active-staff lookup as `getAccess`.

The synthetic client `v1-v01-access-check` remains archived, with its membership and audit events. The synthetic staff account `v1-v01-checker@example.invalid` remains active. Seed staff rows used by the permission file were restored when a test changed them.
