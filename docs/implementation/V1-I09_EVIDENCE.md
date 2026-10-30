# V1-I09 evidence — client files and site access

Date: 2026-10-28. Local development only. Fictional seed records and synthetic checks only. The original audit, the baseline requirements CSV, and the reconciled requirement status columns were not edited. V1-I10 registry-write restrictions were left in place.

## Permission policy

Source: D14 in `docs/DECISIONS.md` (28 Oct 2026).

- Roles stay admin, manager, specialist, reviewer and read-only.
- Admin and manager may view, edit, review, approve, publish and export for every client.
- A specialist member may view, edit and submit for review.
- A reviewer member may view, review and approve.
- A read-only member may view.
- Publishing and export stay with admin and manager. Edit does not publish or export.
- Connection credentials stay admin-only.
- Client membership covers every website of that client. There is no second website-grant list.
- Client services are a plain text field, separate from channel tags.
- Client files are titled https links and notes. The platform does not store the file bytes. The site that hosts the file controls who can open it.
- Website and account-reference registry writes stay with admin and manager (`canManageRegistry`, migration 0007). D14 does not grant those writes to specialists. V1-I10 remains the record for that restriction.

## What was completed

- CM-01 / CM-02: `clients.services` is a text column of at most 2,000 characters. The profile form and overview show it separately from channel tags. An authorised save is checked for a changed row before audit or refresh.
- CM-06: `client_file_links` stores a title, an https URL and optional notes. Select follows `app_can_access_client`. Writes follow `app_is_global()`, the same registry-write rule as websites. URLs with a username or password are rejected. Audit metadata records only `kind: "external_link"`.
- CM-07: The client overview links to Website analytics, SEO performance, Blogs, Leads and forms, and Reports. Analytics, SEO and Blog links carry the client id and that client's production website, or the first website when no production site is stored. Leads use the client slug. Reports use the client id.
- CM-04: Stored website ownership wins. Blog articles have a foreign key on `(website_id, client_id)`. SEO settings already reject a website that belongs to another client. Analytics, SEO, Blog and Reports drop a client the caller cannot see and drop a website that does not belong to the selected client. A browser-supplied client id is not permission.
- CM-08 is recorded with V1-I08. An assignment covers every website of the client. Removing it hides those websites on the next request, because access is resolved from active memberships. Deactivating a staff user still revokes sessions through migration 0023.

## Shared authorisation

`packages/db/src/services/access.ts` exports `clientActions` for view, edit, review, submit for review, publish, export and manage assignments. Pages and actions keep their own checks. Hiding a control is not the boundary.

Integration points already using that model:

- Blog create and update require the website to belong to the client. Publish and unpublish use `canPublishClient`.
- SEO page settings, verification tags and redirects use `canPublishClient` in the action and `assertPublisher` plus `requireWebsiteForClient` in the service. Mapping a page, recording a change and saving a business-profile reference stay edit actions.
- Analytics export and report download use `canExport`. A breakdown download for a client the caller cannot see returns 403. An analytics export with no stored report returns 404 and does not substitute another client.
- Reports and Blog lists use `scopeWorkspace`. An unknown client shows a notice and is not treated as another client's empty library.

Modules that are not part of this ticket should call `clientActions` for the same verbs. Edit must not be used as a publish or export check.

## Checks

| Command | Result |
|---|---|
| `npm run db:migrate` | Applied `0024_client_services_files.sql`. 1 applied, 23 already applied. |
| `npm test -w @clinic-genie/db -- test/client-access.test.ts` | Exit 0. 5 passed. |
| `npm test -w @clinic-genie/db -- test/permissions.test.ts` | Exit 0. 19 passed, together with the client-access file in an earlier combined run of 23. |
| `npm test -w @clinic-genie/platform -- src/lib/access.test.ts` | Exit 0. 3 passed. |
| `npm run typecheck` | Exit 0. |
| `npm run lint -w @clinic-genie/platform` | Exit 0. 0 errors, 10 existing warnings. None are in the files changed for this ticket. |

The client-access tests cover role separation, a dropped foreign client and website, services stored apart from channels, file-link visibility, a specialist write denial, a website that belongs to another client, assignment grant and revoke, a mismatched revoke that does not succeed, and a committed service, note and file link read back in a later transaction and then restored.

Browser, signed in as Demo Admin, fictional Harbourview profile: Services, the assignment sentence, and the file-link form were present. A service description saved and remained after reload, then was restored to the fictional seed text. A titled https link appeared on the client overview. The overview links carried the Harbourview client id and its production website id. Leads used the Harbourview slug. An unknown client id on Analytics showed "That client is not available" and did not open another clinic. A website id from the other fictional seed client was left out, and the page stayed on Harbourview's own site. The breakdown download for the unknown client returned 403. The temporary file link was archived afterwards.

## Not claimed

- Live GA4, Search Console or Wix connection proof. Those credentials are unconfigured and remain with V1-C01. The analytics connection table already requires the website and client pair.
- A document-management system or private file bytes.
- That platform permissions control an externally public URL.
- V1-I08 invitations, retention, deletion, monitoring or backup display.
- Verified status for the whole of V1-I09 while CM-04 provider association is still unconfigured.
