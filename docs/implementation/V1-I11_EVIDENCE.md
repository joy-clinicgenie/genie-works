# V1-I11 evidence — remove debug instrumentation

Date: 2026-10-28. Local development only. No production service was interrupted. The original audit and baseline requirements CSV were not edited.

## Removal

The committed copies of these files contained fire-and-forget `POST` requests to a hardcoded localhost ingest endpoint, wrapped in `#region agent log` blocks. Those requests sent authentication, session, or database-error metadata. The working tree removes the requests and the code that existed only to build them:

- `apps/platform/src/lib/auth.ts`: three calls on missing email, refused sign-in, and allowed sign-in. Staff lookup, denial audit, and success audit remain.
- `apps/platform/src/lib/session.ts`: two calls on a missing session email and after access resolution. Session resolution is unchanged.
- `packages/db/src/client.ts`: one call inside `authAdapterClient` after a query failure. The query still runs through `withContext` and still rethrows. A connection failure in `withContext` still becomes `DbUnavailableError`, and a later transaction error still rolls back.

No replacement telemetry destination was added. Ordinary application requests were left in place, including analytics and OAuth calls, the local development server, and the embedded Postgres listener.

## Search

Command, excluding dependencies, generated output, local editor logs, and the historical audit text:

```bash
rg -n --glob '!node_modules/**' --glob '!.cursor/**' --glob '!docs/audits/**' --glob '!playwright-report/**' --glob '!.next/**' \
  '#region agent log|127\.0\.0\.1:[0-9]+/ingest|X-Debug-Session-Id|hypothesisId' .
```

Result: no matches.

A separate search of `apps/` and `packages/` source for the same markers also returned no matches. Remaining `fetch` calls are the analytics worker, Google token exchange, Wix token exchange, analytics property reads, and the report serial request.

## Checks

| Command | Result |
|---|---|
| `npm run typecheck` | Exit 0. Contracts, db, and platform all passed. |
| `npm run lint` | Exit 0. 0 errors, 10 warnings. None are in the three files above. The warnings are the existing anonymous ESLint export, six plain `<a>` links, and three `<img>` warnings. |
| `npm test -w @clinic-genie/db -- test/permissions.test.ts` | Exit 0. 13 passed, including session isolation and immediate loss of access after deactivation. |
| Closed-port `withContext` probe against `127.0.0.1:1` | Threw `DbUnavailableError` with the message `Database unavailable`. No connection string or credential was printed. |
| Unsigned `GET /` on `127.0.0.1:3400` | `307` to `/sign-in`. |
| Seeded `admin@example.invalid` development-link sign-in | `303` to `/dev/magic-links`, then the callback returned `200` with title `Dashboard \| Clinic Genie`. The sign-in and magic-link HTML did not contain an ingest URL. |
| `npx playwright test e2e/sign-in.spec.ts` | Did not run. Playwright reported that its Chromium executable is not installed. The HTTP sign-in check above is the substitute. |

## Limitations

- An unknown address posted to the development sign-in action returns HTTP 500. The server log shows Auth.js `AccessDenied` thrown from `sendLink` in `apps/platform/src/app/sign-in/page.tsx`. The follow-up request still redirects to `/sign-in`, so no session is created. This refusal path already returned `false` from the sign-in callback before the debug calls were removed; the 500 is not caused by this ticket.
- Untracked `.cursor/debug-*.log` files remain from earlier local debugging. They are not application source and were not changed.
- The full workspace test suite and production build were not run. This ticket does not change product behaviour beyond deleting the debug requests.
