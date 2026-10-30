# V1-C02 evidence — enquiry fixture

Date: 2026-10-28. The fixture database is `clinic_genie_enquiry_test` on `127.0.0.1:54339`. Port `54329` was refused. The original audit and the baseline requirements CSV were not edited.

## Contract source

The row shape follows `apps/platform/src/lib/form-submissions.ts` and the sibling lifecycle note in `clinic-demo-a/docs/ENQUIRY_LIFECYCLE.md`.

The sibling checkout does not contain `packages/platform/src/db/migrations` or `packages/platform/src/enquiries/service.ts`. The fixture is therefore provisional against that missing SQL. It is compatible with the Genie Works reader, including the insert used by `createTestSubmission`.

## What was exercised

- Three fictional clinics, four website keys, two forms, New / Acknowledged / Closed, and attribution values `direct`, `organic`, `referral`, `campaign`.
- Notifications in sent, failed, exhausted, pending and unconfigured states. Mail stays in `notification_outbox`.
- A second insert with the same clinic and idempotency key is rejected. The enquiry count stays 6.
- Requeue of the failed Harbourview notification returns it to pending and does not create an enquiry.
- Requeue of a sent notification does nothing. A Northgate scope cannot requeue a Harbourview notification.
- Commands: `npm run enquiry:seed`, `npm run enquiry:check`, `npm run enquiry:reset`, `npm run enquiry:link`.
- Reset and check exit 1 for the platform database, port `54329`, and `NODE_ENV=production` before any destructive statement.

Seeded rows are for reader and screen checks. They are not a run of the website intake path.

## Still provisional

Confirm the fixture against the sibling migrations and `submitEnquiry` when those files are in the checkout. Until then, do not treat this database as proof of submission processing or deduplication.
