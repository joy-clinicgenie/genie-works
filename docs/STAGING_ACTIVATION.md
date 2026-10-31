# Staging activation checklist

31 October 2026, Asia/Singapore. Nothing in this list was activated. Variable names are listed without values. The dependency text matches `docs/audits/V1_DEPENDENCIES.md`.

Do not create a staging project from this checklist. DEP-04 is the gate for that project.

## Still required before a connected staging run

| ID | Exact missing input | Role | Smallest next action |
| --- | --- | --- | --- |
| DEP-04 | The authorised staging project, team, and whether this repository is allowed to be connected. | Hosting owner | Name that project and confirm the connection is allowed. Then deploy the candidate SHA with separate environment variables and observe one cron invocation. |
| DEP-01 | A named non-production property for GA4, Search Console and Wix, permission to read it, and confirmation that the configured OAuth client may be used for that property. A production property is not a substitute. | Account owner for each provider | Name the property and grant the non-production client. One successful sync window must later match the provider, with the property alias, date window, timezone and both figures, and without secrets. |
| DEP-02 | An enquiry database the source owner approves for the connected pilot. Not a production or patient database, and not the local fixture by itself. | Enquiry-source owner | Approve that source. The same status, retry and export checks then run against it, with no second copy of the message. |
| DEP-03 | Who operates the outbox dispatcher, which non-production recipient may be used, and whether provider acceptance is the required V1 proof. | Sender owner | Name the operator and the recipient, or record that provider acceptance is enough. A fixture retry is not that proof. |
| DEP-05 | A written choice in `docs/DECISIONS.md`: leave `0009_client_master_list.sql`, `0031_clinic_websites.sql` and `0034_client_public_profiles.sql` as historical exposure, or authorise a history rewrite outside this pack. | Repository owner | Record that choice. This row is not a hosting project and not a rollback owner. A fresh fictional database does not close it. |
| DEP-06 | One approved choice: implement Draft, In review, Approved and Final, or accept `draft` / `saved` as V1 and amend D14. The same record must say where the final artifact lives. | Product owner | Record the choice. Staging can be discussed without this choice. Report finalisation cannot. |
| DEP-07 | The staging website that will call the blog and SEO APIs, and confirmation it is allowed to receive a token. | Website owner | Name that site. It must render one published article and one saved SEO setting from the API. |
| DEP-08 | The person's name and the rollback path they accept. | Release owner | Name the person and the path. The local restore test does not do that. |

Clinic owner, content approver, security reviewer and release approver remain unnamed. No D22 is recorded.

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
| `ENQUIRY_DATABASE_URL` | Leave empty until DEP-02 names the source. |
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
5. Connect the DEP-02 enquiry source only after it is approved. Do not point it at the local fixture and call that staging.
6. Do not treat a fixture retry as mail delivery, an API read as a clinic website, or this checklist as a production approval.
