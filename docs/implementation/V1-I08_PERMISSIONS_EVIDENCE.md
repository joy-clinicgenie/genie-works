# V1-I08 evidence — permission portion only

Date: 2026-10-28. This file covers CM-08 and the shared parts of AD-04, AD-05 and AD-06. It does not complete V1-I08. Invitations, retention, deletion, monitoring and backup-status display remain separate. The original audit and baseline CSV were not edited.

## Policy

Source: D14 in `docs/DECISIONS.md` (28 Oct 2026), with the V1-I10 restriction that website and account-reference writes stay with admin and manager.

Shared interface: `clientActions` in `packages/db/src/services/access.ts`.

| Action | Rule |
|---|---|
| View | Admin, manager, or a member of the client. |
| Edit and submit for review | Admin, manager, or a specialist member. |
| Review and approve | Admin, manager, or a reviewer member. |
| Publish | Admin or manager who can access the client. |
| Export | Admin or manager. |
| Manage assignments | Admin only. One membership covers every website of that client. |

Removal of a membership takes effect on the next request. `resolveAccess` loads only active memberships. Deactivating the staff user also revokes sessions, which V1-V01 already covers.

AD-03 role invitations and the rest of the admin lifecycle were not changed.

## Checks

The same `packages/db/test/client-access.test.ts` run recorded in `V1-I09_EVIDENCE.md` asserts the role split, that a specialist can edit without publish or export, that a reviewer can review without edit or publish, and that granting then revoking a membership changes website visibility. A revoke aimed at the wrong client throws and leaves the assignment in place.

SEO page settings, verification tags and redirects now refuse a specialist both in the action (`canPublishClient`) and in the service. Blog publish already used the same publish rule.

## Still open on V1-I08

Invitations, retention, legal hold, deletion, monitoring, and the AD-19 backup/recovery display. Do not treat this file as completion of those rows.
