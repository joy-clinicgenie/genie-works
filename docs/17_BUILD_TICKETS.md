# Build tickets CG-01 to CG-18

Use the source PDF's ticket IDs. Tickets are build units, not a promise of one ticket per day. Before coding each ticket, expand it into: objective, why, dependencies, expected files, inputs/outputs, security implications, steps, exclusions, tests, evidence, rollback, owner and due date.

| Ticket | Scope | Dependency / done evidence |
| --- | --- | --- |
| CG-01 | Audit code, pilot needs, providers and architecture | First; scope, gap list and decision log signed |
| CG-02 | Repository, branch rules, staging and deploy approach | CG-01; reproducible staging and recovery reference |
| CG-03 | Clients, sites and memberships migrations | CG-02; two test clients/sites, relationship checks |
| CG-04 | Managed staff login and enforced permissions | CG-03; authenticated cross-client denial proof |
| CG-05 | Reusable configured website starter | CG-02/03; responsive clinic template on staging |
| CG-06 | Soft-launch SEO: published page metadata, individual 301 redirects, honest checklist, sitemap/robots defaults, Search Console meta verification, branch-level Business Profile references | CG-05/registry; connected-site HTML and status-code evidence; preserve existing mapping and structured data |
| CG-07 | Form contract, validation, consent and anti-spam | CG-01/03; contract and valid/invalid test evidence |
| CG-08 | Durable submission, dedupe and atomic outbox | CG-07; concurrency and failure tests |
| CG-09 | Email adapter, clinic routing and retries | CG-08; outage/recovery and correct recipient proof |
| CG-10 | Protected lead list, status and export | CG-04/08/09; tenant-only access and audit evidence |
| CG-11 | Booking modes and fallback | CG-05/07-09; enquiry/external mobile tests |
| CG-12 | GA4/GSC and optional Ads events | CG-06/08/11; correct source IDs, no PII/duplicate goals |
| CG-13 | Uptime, errors and synthetic form monitoring | CG-08/09; simulated outage reaches owner |
| CG-14 | Backup/restore and migration recovery | CG-03/08; non-production restore proof |
| CG-15 | Security testing and independent review | CG-04/07-14; critical/high findings closed |
| CG-16 | Browser/mobile/accessibility/performance/SEO QA | CG-05-12; critical defects fixed, evidence attached |
| CG-17 | Second dummy-site configuration dry run | CG-03-12; independent configuration, same backend |
| CG-18 | Controlled release, live verification and handover | All relevant tickets, CG-17 and G1-G5; sign-off and owner |

CG-17 belongs before final launch even though its identifier follows CG-16. Provider decisions must precede integration work. Add a dedicated migration ticket and revise estimates if the pilot replaces Wix. A missing dependency blocks completion rather than being silently mocked in acceptance evidence.

## Authorized SEO soft-launch implementation checklist
Implement in this order; do not start deferred SEO/GEO work:

1. [x] Inspect existing SEO mapping, website registry, public page metadata, structured data, sitemap, robots defaults, deployment shape and auth boundaries.
2. [x] Record the revised soft-launch scope and post-launch backlog; identify database and deployment requirements.
3. [x] Add tenant-scoped page SEO settings, site verification settings, individual redirects, per-website API token hashes and branch profile references with RLS, audit and backup/restore coverage.
4. [x] Add authenticated, read-only website-published settings API and one-time per-site token rotation in Genie Works.
5. [x] Add page settings UI, searchable/editable 301 manager with loop validation, honest checklist, Search Console code support, and branch-level Google Business Profile references/actions.
6. [x] Connect only supported Next.js clinic deployments to the API; apply SEO settings to public HTML, sitemap, redirects and verification output while preserving code defaults and structured data on API failure.
7. [ ] Validate normal, invalid, unauthorized, loop, tenant-isolation, build and deployed-output behavior; document deployment environment values and remaining external verification steps.

Steps 3–6 are implemented in code. Evidence so far: database pure tests and typecheck pass, targeted Genie Works lint passes, public-site typecheck/lint pass, and the public-site production build succeeds. Step 7 remains open: migration 0019 has not been applied to a database, and tenant/RLS, unauthorized-access, backup/restore, and deployed-host behavior still require environment-level validation. No production site credentials or deployment environment values have been configured. The Genie Works platform typecheck continues to report errors in unrelated existing timeline/dashboard/navigation files; the new SEO files produce no type errors.

### External access and approvals
- No Google OAuth or Google Business Profile API credential is required for this soft launch; direct GBP API management is deferred.
- An authorised user must access the correct Google Search Console property, provide its HTML-tag token, and confirm ownership after the tag is deployed.
- A profile URL/ID and branch setup status are staff-entered references. A user with appropriate Google Business Profile access is needed to perform and confirm setup outside this platform.
- A deployment administrator must configure each supported site's server-only API URL, website UUID and generated bearer token, and approve changes to the production site's environment/deployment. No credentials are assumed for Wix or other providers.

## CG-01 status

Practice record: [decisions/CG-01-pilot-scope.md](decisions/CG-01-pilot-scope.md). The pilot is synthetic Demo Clinic A, the build is a new website, and live Wix stays unchanged. The decision log is not signed. Unknown clinic owner, URLs, and approvals remain blockers.

## CG-02 status

DAY-01 records the branch rules and the staging approach in [decisions/DAY-01-scope-audit.md](decisions/DAY-01-scope-audit.md). No staging URL, host, or recovery environment exists yet. Provider access is not confirmed, and the independent security reviewer is not booked.
