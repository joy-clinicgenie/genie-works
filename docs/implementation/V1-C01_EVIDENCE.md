# V1-C01 evidence — provider sandbox setup

Date: 2026-10-28. Fixture mode only. No Google, Search Console or Wix call was made. The original audit and the baseline requirements CSV were not edited.

## What is in place

- Environment names are in `.env.example`. Secrets stay in the local `.env` and are not printed.
- `ANALYTICS_TOKEN_KEY` remains the server-side encryption key used by the existing connection store.
- `ANALYTICS_FIXTURE_MODE=1` makes `npm run analytics:work` and `POST /api/internal/analytics/worker` refuse non-local provider hosts.
- The worker returns HTTP 401 when the bearer is missing or wrong. Confirmed against `http://127.0.0.1:3400`.
- `npm run analytics:work` refuses a non-local database unless `ANALYTICS_ALLOW_REMOTE_WORKER=1`, and it always refuses production.
- Fixture scenarios in `packages/db/src/testing/provider-fixtures.ts` and `packages/db/test/provider-fixtures.test.ts` cover success, empty results, expired credentials, HTTP 500, HTTP 429, stale data, two websites, and an overlapping source that is not added.

## What this does not prove

The local `.env` has no Google client, Wix app, token key or worker secret. Fixture job results are mock responses. They are not live API results.

## Still blocked

The live non-production check needs a GA4 property, a Search Console property, the Google OAuth client, `ANALYTICS_TOKEN_KEY`, `ANALYTICS_WORKER_SECRET`, and, for Wix analytics only, a non-production Wix site plus the Wix app id and secret. Put them in `.env`. Do not paste them into chat.

Progress for the ticket is Implemented. It is not Verified while that live check is outstanding.
