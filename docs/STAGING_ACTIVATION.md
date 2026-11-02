# Staging activation checklist

31 October 2026, Asia/Singapore. Nothing in this list was activated. Variable names are listed without values. The dependency text matches `docs/audits/V1_DEPENDENCIES.md`.

D27 authorises connecting this repository to project `clinic-works` on team Clinic Genie. This checklist does not deploy that project.

## Still required before a connected staging run

| ID | Exact missing input | Role | Smallest next action |
| --- | --- | --- | --- |
| DEP-04 | D27 authorises the connection. Verification still open: deploy candidate `85b99c7d11a11feae4d5da93068d754a9dfcd5b4` on project `clinic-works`, team Clinic Genie, with separate environment values, then observe one scheduled worker call. | Hosting owner Joy | The connection is authorised. The deployment has not run. Staging values were not supplied in these answers. |
| DEP-01 | D25 records the account owner, the aliases Wix and Google, the timezone Singapore, and OAuth authorisation. Verification still open: the GA4 property, the Search Console site, the Wix site, a start and end date, and one matching sync. | Account owner Marketing Clinic Genie | Name those properties and the date window, then compare one sync. No provider has been called. |
| DEP-02 | Each source connection, assessed on its own. A website enquiry database does not cover a Wix form, and one Wix form does not cover another website. Not a production or patient database, and not the local fixture by itself. | Enquiry-source owner | No connection is approved. The alias, owner and pilot approval for each connection were left blank. |
| DEP-03 | D33 confirms inbox receipt of DEP03-8E4DC5. D35 records provider acceptance of DEP03D-A72CDF from `hello@clinic-genie.com` at 23:21:37 Asia/Singapore. Inbox receipt of DEP03D-A72CDF is not confirmed. The saved dispatcher from-address remains `onboarding@resend.dev`. Company and production mail are unchanged. | Dispatcher operator resend | Confirm whether DEP03D-A72CDF arrived. The saved sender is still the sandbox address. Production mail is still missing. |
| DEP-05 | Recorded as D22. Repository owner `joy.clinicgenie` retains the three historical files. Joy acknowledged the residual exposure. | Repository owner `joy.clinicgenie` | No further choice. The text remains in git. |
| DEP-06 | D23 is implemented. A saved report writes its copy under `docs/report`. A draft does not. | Product owner Joy | No further local choice. The copy was tested on an isolated local database. |
| DEP-07 | D28 names `https://genie-works-ashen.vercel.app/sign-in`. Website owner Joy. Token use is not authorised. | Website owner Joy | Authorise the server-side per-site token, then show one article and one SEO setting rendered by that site. |
| DEP-08 | D29 names rollback owner Joy. No procedure is accepted. | Release owner Joy | Accept the rollback path. |

Clinic owner, content approver and security reviewer remain unnamed. D22 through D35 are recorded. D33 confirms receipt of DEP03-8E4DC5. D35 records acceptance of DEP03D-A72CDF and does not record its receipt. Neither changes company or production configuration, and neither closes the connected-pilot mail gate.

## Values the hosting project must supply later

Set these on the staging project, not in this repository. Use staging values, not the local rehearsal database and not production.

| Name | Requirement |
| --- | --- |
| `DATABASE_URL` | The staging application database. Not a database on the engineer's machine. |
| `DATABASE_ADMIN_URL` | Owner connection for a controlled migration only. |
| `APP_DB_PASSWORD` | Password for the application role on that database. |
| `AUTH_SECRET` | A runtime secret. `preview-build-only` and `replace-with-a-long-random-string` are rejected after the build. |
| `AUTH_URL` | The staging origin. Not `localhost` or `127.0.0.1`. |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_GOOGLE_HD` | Only after the identity client is approved. Preview does not create an admin. |
| `AUTH_DEV_MAGIC_LINKS` | Leave unset. Preview and production ignore it. |
| `APP_ENVIRONMENT_LABEL` | A visible label such as `staging`. The label does not change permissions. |
| `ENQUIRY_DATABASE_URL` | Staff role on `clinic_genie_enquiry_staging` for the Clinic Genie website. It does not approve a Wix form. |
| `ANALYTICS_GOOGLE_CLIENT_ID`, `ANALYTICS_GOOGLE_CLIENT_SECRET`, `ANALYTICS_WIX_APP_ID`, `ANALYTICS_WIX_APP_SECRET`, `ANALYTICS_TOKEN_KEY` | Leave empty until DEP-01 names the property. |
| `ANALYTICS_WORKER_SECRET` or `CRON_SECRET` | One non-empty bearer so the cron can authenticate. |
| `ANALYTICS_LIVE_REPORTS` | Off until a sync window has been compared with the provider. |
| `ANALYTICS_FIXTURE_MODE` | Unset on staging. |
| `ANALYTICS_ALLOW_REMOTE_WORKER` | Set only when the staging database host is an approved host that is not this machine. |
| `MIGRATE_ALLOW_REMOTE` | Set only for that same approved migration. Seed, reset and restore-test stay local. |
| `UPLOADS_DIR` | The staging file location. Evidence files are not in the database export. |
| `VERCEL_ENV` | `preview` for this class. The application does not set it. |

## Checks after a project exists

These are not done.

1. Deploy the recorded candidate SHA. Confirm the running revision matches that SHA.
2. Open `/api/internal/operations/status` as an administrator. Confirm the class is connected staging, the auth secret is set rather than a placeholder, and the database is not on this machine.
3. Confirm an unauthenticated worker call is refused, then observe one scheduled `GET /api/internal/analytics/worker`. A manual call is not that observation.
4. Run the DEP-01 sync comparison only after the property is named.
5. Connect each DEP-02 source on its own, and only after that connection is approved. A website enquiry database does not cover a Wix form, and one Wix form does not cover another website. Do not point a connection at the local fixture and call that staging.
6. Do not treat a fixture retry as mail delivery, an API read as a clinic website, or this checklist as a production approval.
