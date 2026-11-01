# V1 pilot go / no-go

31 October 2026, Asia/Singapore. Candidate `85b99c7d11a11feae4d5da93068d754a9dfcd5b4`. The original audit remains **NO-GO, 53 / 100** at `audits/V1_GO_NO_GO.md`. This file is the follow-up. The retest score is **62 / 100** under the same rubric, recorded in `docs/audits/V1_RELEASE_RETEST.md`. The number does not approve a pilot or a production release.

Joy is the hosting owner, product owner, website owner and named rollback owner. Repository owner is `joy.clinicgenie`. Clinic owner, content approver and security reviewer remain unnamed. Latest approved decisions are D22 through D29. The rollback owner is Joy. The rollback procedure is not accepted.

## Supervised fictional-data rehearsal

**Ready for a supervised local session.**

The clean candidate builds, typechecks, lints, and passes 151 automated tests, 8 decision checks, 16 role journeys and an isolated restore of the current schema. Staff can walk the nine launch modules on an isolated fictional database, including client creation, draft and saved reports, blog review, and the local enquiry fixture on the development server.

Say these limits in the room:

- Analytics figures are not a live provider window.
- A production-mode process refuses the enquiry fixture. The development fixture is not an approved clinic source, and a retry is not mail delivery.
- Reports can be saved as draft or saved. They cannot be approved or final.
- The administrator report describes this process. It does not show that a hosted monitor or schedule ran.
- Rollback of the application does not undo a database migration. The local restore was into a separate database.

This recommendation is for fictional data on the engineer’s machine. It is not permission to connect a clinic, a mailbox, or a hosted project.

## Connected internal pilot

**No-go.**

GW-004, GW-005 and GW-006 remain partially fixed. GW-008 is fixed for the local saved copy under `docs/report`. DEP-05 is decided in D22. DEP-06’s local copy is implemented. DEP-03’s labelled test was confirmed in the inbox. DEP-01, DEP-04, DEP-07 and DEP-08 remain open. DEP-02 remains open for each source connection (D36). A passing local suite does not establish live provider sync, production mail, clinic website consumption or hosted operations. `clinic-genie.com` is verified for sending. DEP03D-A72CDF was accepted from that domain, and its inbox receipt is not confirmed. The connected-pilot mail gate stays open.

| Still required | Role | Next action |
| --- | --- | --- |
| DEP-04 deployment of candidate `85b99c7d11a11feae4d5da93068d754a9dfcd5b4` on project `clinic-works`, team Clinic Genie | Hosting owner Joy | The connection is authorised. Deploy that SHA with separate variables and observe one scheduled worker call. |
| DEP-01 GA4 property, Search Console site, Wix site, and a start and end date | Account owner Marketing Clinic Genie | D25 records the aliases Wix and Google, the timezone Singapore, and OAuth authorisation. No provider has been called. |
| DEP-02 each source connection | Enquiry-source owner | A website enquiry database and each Wix form are assessed separately. None is approved. The local fixture is not an approval. |
| Production mail from the verified domain | Dispatcher operator resend | D35 records provider acceptance of DEP03D-A72CDF from `hello@clinic-genie.com`. Inbox receipt of that message is not confirmed. D33 remains the receipt of DEP03-8E4DC5. The saved dispatcher from-address remains `onboarding@resend.dev`. Company and production mail are unchanged. |
| DEP-07 token use on `https://genie-works-ashen.vercel.app/sign-in` | Website owner Joy | Token authorisation is blank. Then the site renders one article and one SEO setting. |
| DEP-08 accepted rollback procedure | Release owner Joy | Joy is named. The procedure field is blank. |

The exact variable names for a future project are in `docs/STAGING_ACTIVATION.md`. No values are stored there.

## Production

**Not approved.**

Hosted staging has not started. The live analytics, enquiry, mail and website gates are open. Rollback owner Joy is named in D29, and no rollback procedure is accepted. Production remains a separate decision after a connected pilot, not an extension of this local re-audit.
