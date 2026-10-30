# Genie Works Version 1 test environments

Date: 2026-10-28. Local configuration only. No service was purchased, no site was deployed, and no live website was changed. Secret values are not recorded here.

This environment is ready for fixture-based checks. It is not proof that Google, Search Console or Wix APIs work, and it is not proof that a clinic website accepted a form.

## Environment architecture and isolation

Two databases share the local embedded Postgres started by this repository. They are not the sibling clinic website database.

| Database | Role | Port |
|---|---|---|
| `clinic_genie` | Platform registry, staff, SEO, blog and analytics | `127.0.0.1:54339` |
| `clinic_genie_enquiry_test` | Synthetic enquiries and notification outbox | `127.0.0.1:54339` |

The sibling clinic website database on port `54329` is never a fixture target. Fixture create, check and reset commands throw before opening a connection when the target is that port, when the database is `clinic_genie`, when the host is not local, or when `NODE_ENV` or `VERCEL_ENV` is `production`.

`ANALYTICS_LIVE_REPORTS` stays off unless an operator turns it on for a non-production sandbox. `ANALYTICS_FIXTURE_MODE=1` makes the analytics worker refuse every non-local provider host, so a fixture run cannot send events to production analytics. Live sandbox calls are a separate step and require that flag to be unset.

Outbound enquiry mail is the `notification_outbox` table. The fixture does not configure an SMTP provider. A retry updates that row and does not insert another enquiry.

The embedded Postgres fallback port is `54339`, matching `.env.example`, so a start without `EMBEDDED_PG_PORT` does not bind port `54329`.

## Fictional client, website and account matrix

All of these records are synthetic. Addresses use `example.invalid`.

| Client slug | Websites | Platform | Staff who can open the client |
|---|---|---|---|
| `harbourview-dental` | Harbourview Dental website (`harbourview-dental-wix`) | Wix, production placeholder | Admin, manager, specialist A, reviewer, read-only |
| `meridian-skin` | Meridian Skin website (`meridian-skin-production`) and Meridian Skin staging (`meridian-skin-staging`) | Next.js on Vercel | Admin, manager, specialist A, reviewer |
| `northgate-physio` | Northgate Physio website (`northgate-physio-wix`) | Wix, production placeholder | Admin, manager, specialist B |

Stable staff sign-in addresses, all fictional:

| Address | Role | Clients |
|---|---|---|
| `admin@example.invalid` | admin | all |
| `manager@example.invalid` | manager | all |
| `specialist-a@example.invalid` | specialist | Harbourview and Meridian |
| `specialist-b@example.invalid` | specialist | Northgate only |
| `reviewer@example.invalid` | reviewer | Harbourview and Meridian |
| `readonly@example.invalid` | read-only | Harbourview only |

Enquiry rows use fixed ids `11111111-1111-4111-8111-111111111101` through `…1106`. Notification rows use `22222222-2222-4222-8222-222222222201` through `…2206`. Statuses are New, Acknowledged and Closed. Attribution values are `direct`, `organic`, `referral` and `campaign`. Forms are `appointment-enquiry` and `contact`. Notification states are sent, failed, exhausted, pending and unconfigured.

## Commands

Start the local database, apply platform migrations and load the fictional platform seed if this checkout has not already done so:

```bash
npm run db:start
npm run db:migrate
npm run db:seed
```

Enquiry fixture:

```bash
npm run enquiry:seed
npm run enquiry:check
npm run enquiry:reset
npm run enquiry:link
```

`enquiry:link` rewrites only `ENQUIRY_DATABASE_URL` in the local `.env` so it selects `clinic_genie_enquiry_test` on the platform host. It does not print the value. Restart `npm run dev` after linking so the running app reads it.

Shutdown is Ctrl+C in the `npm run db:start` terminal. That stops the embedded Postgres process. It does not drop either database.

Analytics worker, local database only:

```bash
npm run analytics:work
```

With `ANALYTICS_FIXTURE_MODE=1` that command refuses Google and Wix hosts. Without the flag, and only after the sandbox variables below are set in `.env`, the same command is the local way to run one due sync. The HTTP worker is `POST /api/internal/analytics/worker` with `Authorization: Bearer` set from `ANALYTICS_WORKER_SECRET`. A missing or wrong bearer returns HTTP 401.

Consumer probe:

```bash
npm run consumers:check
```

## Environment variable names

Copy `.env.example` to `.env`. Fill values only in that local file. Do not paste secrets into chat or commit them.

Platform and fixture:

- `DATABASE_ADMIN_URL`
- `DATABASE_URL`
- `APP_DB_PASSWORD`
- `EMBEDDED_PG_PORT` (`54339`)
- `EMBEDDED_PG_DIR`
- `SEED_ALLOWED_DB_PATTERN`
- `ENQUIRY_DATABASE_URL` (local fixture database only)
- `AUTH_SECRET`
- `AUTH_URL`
- `AUTH_DEV_MAGIC_LINKS`

Provider sandbox, server-side only. Tokens are encrypted with `ANALYTICS_TOKEN_KEY` and are not sent to the browser.

- `ANALYTICS_GOOGLE_CLIENT_ID`
- `ANALYTICS_GOOGLE_CLIENT_SECRET`
- `ANALYTICS_WIX_APP_ID`
- `ANALYTICS_WIX_APP_SECRET`
- `ANALYTICS_TOKEN_KEY`
- `ANALYTICS_WORKER_SECRET`
- `ANALYTICS_LIVE_REPORTS`
- `ANALYTICS_FIXTURE_MODE`
- `ANALYTICS_ALLOW_REMOTE_WORKER`
- `GENIE_WORKS_BASE_URL`

## Provider fixtures and live sandbox

Fixture checks mock the provider response inside the existing sync job path. They cover successful retrieval, an empty result, expired credentials (`invalid_grant` reconnect), HTTP 500, HTTP 429, a stale last-success time, two websites with different property ids, and an overlapping source that is rejected rather than added. Those results do not show that a live API works.

Live sandbox, still outstanding:

1. Create a non-production GA4 property and a non-production Search Console property. Do not use a clinic's production property.
2. Create an OAuth client that may redirect to `http://localhost:3400/api/analytics/google/callback`.
3. Create a non-production Wix site and a Wix app, if Wix analytics is in scope. Wix Blog publishing is not required.
4. Put the client id, client secret, Wix app id, Wix app secret, a long `ANALYTICS_TOKEN_KEY` and a long `ANALYTICS_WORKER_SECRET` in `.env`.
5. Leave `ANALYTICS_FIXTURE_MODE` empty for that run. Keep `ANALYTICS_ALLOW_REMOTE_WORKER` empty unless the database itself is an approved non-production host.
6. Connect one website at a time from the analytics screen, then run `npm run analytics:work` or the authenticated HTTP worker.

On 2026-10-28 the local `.env` had empty values for the Google client, Wix app, token key and worker secret. No live provider call was made.

## Mail sink

Enquiry notifications stay in `notification_outbox` on `clinic_genie_enquiry_test`. The fixture provider name is `fixture-sink`. Nothing is handed to an external mail system. Sign-in links in local development continue to use the existing magic-link table and `/dev/magic-links`, which does not send mail.

## Website capability matrix

| Capability | State | Counts as passed |
|---|---|---|
| Native SEO metadata, canonical and indexable flag via `GET /api/public/seo/[websiteId]` | Required, contract testable | Only after a tokened read of a real staging consumer. The unauthenticated probe is not that check. |
| Native redirects in the same response | Required, contract testable | Same limit. |
| Staging noindex through `indexable: false` | Required, contract testable | No public staging site was deployed. |
| Native Blog read via `GET /api/public/blog/[websiteId]` | Required, contract testable | The contract exists. A probe without a token is not publication. |
| Native staging website that calls those APIs | Required, blocked | The sibling site template does not call these routes. This task does not deploy one. |
| Wix analytics or SEO on a non-production site | Required for Wix operations, blocked | No non-production Wix site or app credentials. |
| Wix Blog publishing | Excluded | Must not be required for native Blog. |
| Blog Performance | Excluded for this step | Deferred. |

Representative native paths for a future staging consumer, all non-indexable on staging: `/`, `/request-appointment`, `/contact`, `/blog`, `/blog/routine-skin-care-note`.

`npm run consumers:check` prints this matrix. On 2026-10-28 the local platform returned HTTP 404 for an unauthenticated SEO read and an unauthenticated Blog read. That shows the routes hide a missing token. It does not show published output.

## Checks performed

| Check | Result |
|---|---|
| `npm test -w @clinic-genie/db -- test/fixture-targets.test.ts test/enquiry-fixture.test.ts test/provider-fixtures.test.ts` | 3 files, 8 tests passed |
| `npm run enquiry:seed` and `npm run enquiry:check` | `clinic_genie_enquiry_test` on `127.0.0.1:54339`, 3 clinics, 6 enquiries, 6 notifications |
| Reset and check against `clinic_genie`, port `54329`, and `NODE_ENV=production` | Each exited 1 before changing data |
| Duplicate idempotency key | Rejected. Enquiry count stayed 6 |
| Retry of the failed Harbourview notification | Status returned to pending. Enquiry count stayed 6 |
| Retry of a sent notification, and a Northgate-scoped retry of a Harbourview row | No row updated |
| Harbourview-only read | No Meridian or Northgate enquiry |
| Worker `POST` without a bearer, and with the wrong bearer | HTTP 401 `Unauthorized` |
| `ANALYTICS_FIXTURE_MODE=1` | Refuses `googleapis.com` and `wixapis.com` |
| Provider fixture job | Separate session counts 4 and 9 for the two Meridian websites. Empty partition, HTTP 500 retry, HTTP 429 retry, expired token reconnect, overlapping import rejected |
| `npm run consumers:check` | Matrix printed. Unauthenticated public reads returned HTTP 404 |
| `npm run typecheck -w @clinic-genie/db` and `npm run typecheck -w @clinic-genie/platform` | Exit 0 |

Seeded enquiry rows can be listed by the platform reader. They are not evidence that the website intake path or its deduplication processing ran. The reader insert shape used by `createTestSubmission` was inserted and then removed.

## Remaining access and implementation dependencies

Live provider portion of V1-C01, still blocked:

- Non-production GA4 property id and Search Console property
- `ANALYTICS_GOOGLE_CLIENT_ID` and `ANALYTICS_GOOGLE_CLIENT_SECRET`
- `ANALYTICS_TOKEN_KEY` and `ANALYTICS_WORKER_SECRET`
- For Wix analytics only: a non-production Wix site, `ANALYTICS_WIX_APP_ID` and `ANALYTICS_WIX_APP_SECRET`

Supply those in `.env` on this machine. Do not send them in chat.

Enquiry contract portion, provisional:

- The Genie Works reader queries and the sibling lifecycle document were used to shape the fixture.
- `packages/platform/src/db/migrations` is missing from the sibling checkout `~/vsc/clinic-demo-a`, although `packages/platform/src/db/migrate.ts` expects it.
- `packages/platform/src/enquiries/service.ts` is missing, although the sibling RLS test imports it.
- Until those files are available, this fixture must not be described as a verified copy of the sibling schema. Intake and deduplication remain unproven.

Website consumers, still blocked:

- A protected native staging site that calls the SEO and Blog read APIs with a site token
- A non-production Wix site for the supported analytics and SEO operations
- Native Blog publication checks stay on the Blog implementation. This environment does not add a Wix Blog adapter and does not treat the consumer list as published output
