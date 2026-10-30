---
cursor:
  subagentId: "bc-3970cf4c-8908-5da2-a074-e10e6d5f7ee9"
---

# Genie Works V1 Implementation Tracker

## V1 scope and baseline

This tracker reconciles the authoritative `Clinic_Genie_Platform.txt`, the clarification that Blog is mandatory while only Blog Performance is deferred, `docs/audits/GENIE_WORKS_V1_FUNCTIONAL_AUDIT.md`, and `docs/audits/GENIE_WORKS_V1_REQUIREMENTS.csv`. It tracks the checkout audited at commit `1ffd47d5f8049f6b3a4a2e86ad9b46d7f0ef8ec0` on branch `feature/genie-works-seo-and-modules`, with the pre-existing dirty working tree preserved. The source audit date is 2026-10-28 Singapore.

The nine V1 modules remain Agency Overview, Client Management, Website Analytics, SEO Performance, Blog, Leads and Forms, Reports, Settings and Admin. BL-01–BL-14 are mandatory. BL-15–BL-20 are explicitly deferred. RP-05 is conditional on those deferred performance functions and is nonblocking while they remain deferred. Conditional and ambiguous rows are not silently promoted; their recorded decision or trigger controls applicability.

## Progress definitions

- **Not started:** no repository evidence of active delivery work has been recorded for this ticket. This is independent of audit status.
- **In progress:** current-checkout evidence shows active work, but this does not establish implementation or verification.
- **Implemented:** all ticket deliverables exist and are traceable; runtime acceptance may still be outstanding.
- **Verified:** all applicable row-level acceptance checks have successful direct runtime evidence, including permissions/persistence/states where relevant.
- **Blocked:** a confirmed dependency prevents useful progress now; the ticket states the exact unblock condition. A preceding ticket alone is not a blocker.

No ticket is marked Implemented or Verified by this documentation task. Audit status is retained separately in the reconciled register and never determines ticket progress.

## Reconciled counts

| Dimension | Count |
|---|---:|
| Total requirements | 145 |
| Mandatory | 122 |
| Conditional | 6 |
| Explicitly deferred | 6 |
| Ambiguous | 11 |
| Mandatory VERIFIED COMPLETE (unchanged audit status) | 7 / 122 (5.7%) |

Global audit outcomes remain unchanged: 8 VERIFIED COMPLETE, 64 PARTIAL, 53 MISSING, 1 BROKEN and 19 UNVERIFIED. The mandatory denominator changes only because RP-05 is correctly conditional. “Verified” above is an audit status count, not ticket progress.

## Master ticket table

| Ticket / existing title | Type | Original priority | Separate proposed change | Progress | Requirement relationship |
|---|---|---:|---|---|---|
| V1-I01 Blog core | Implementation | P0 | No change proposed; retain P0. | Verified | Primary: BL-01–BL-14<br>Support: AO-10, AO-17, RP-05 |
| V1-I02 Agency Overview completeness | Implementation | P0 | No change proposed; retain P0. | In progress | Primary: AO-01–AO-24 |
| V1-I03 Leads/form registry | Implementation | P0 | No change proposed; retain P0. | Not started | Primary: LF-01–LF-15<br>Support: ST-10, AD-11–AD-13, AD-17 |
| V1-I04 Report workflow | Implementation | P0 | No change proposed; retain P0. | Not started | Primary: RP-01–RP-13 |
| V1-I05 Analytics gaps | Implementation | P1 | No change proposed; retain P1. | In progress | Primary: WA-01–WA-14<br>Support: CM-04, ST-04–ST-06 |
| V1-I06 SEO completion | Implementation | P1 | No change proposed; retain P1. | In progress | Primary: SEO-01–SEO-18 |
| V1-I07 Settings completion | Implementation | P1 | No change proposed; retain P1. | In progress | Primary: ST-01–ST-13 |
| V1-I08 Admin lifecycle/data controls | Implementation | P1 | No change proposed; retain P1. | In progress | Primary: CM-08, AD-01–AD-19. Permission portion only: CM-08 and AD-04–AD-06. |
| V1-I09 Client files/site access | Implementation | P2 | No change proposed; retain P2. | Implemented | Primary: CM-01–CM-02, CM-04, CM-06–CM-07. Live provider credentials stay with V1-C01. |
| V1-I10 Align registry permissions | Implementation | P0 | No change proposed; retain P0. | Verified | Primary: CM-03, CM-05, CM-09<br>Support: AD-04–AD-06 |
| V1-I11 Remove debug instrumentation | Implementation | P0 | No change proposed; retain P0. | Verified | Cross-cutting; no requirement ID applies. |
| V1-C01 Provider sandbox setup | Configuration | P0 | No change proposed; retain P0. | Implemented | Support: WA-01–WA-14, SEO-01, SEO-16–SEO-18, ST-04–ST-06 |
| V1-C02 Enquiry fixture | Configuration | P0 | No change proposed; retain P0. | Implemented | Support: AO-07, AO-12, LF-01–LF-15, AD-12–AD-13 |
| V1-C03 Website consumers | Configuration | P0 | No change proposed; retain P0. | Implemented | Support: SEO-07–SEO-14, SEO-18, BL-12–BL-14 |
| V1-V01 Repair automated suite | Verification | P0 | No change proposed; retain P0. | Verified | Verification: AD-02, AD-05 |
| V1-V02 Requirement E2E matrix | Verification | P0 | No change proposed; retain P0. | Not started | Verification: AO-01–AO-24, CM-01–CM-09, WA-01–WA-14, SEO-01–SEO-18, BL-01–BL-14, LF-01–LF-15, RP-01–RP-13, ST-01–ST-13, AD-01–AD-19 |
| V1-V03 Backup/restore evidence | Verification | P1 | No change proposed; retain P1. | Blocked | Verification: AD-19 |
| V1-V04 Build warning review | Verification | P1 | No change proposed; retain P1. | Not started | Cross-cutting; no requirement ID applies. |

## Detailed ticket checklists

### V1-I01 Blog core
- Type: Implementation
- Original priority: P0
- Proposed change: No change proposed; retain P0.
- Requirement IDs: AO-10, AO-17, BL-01–BL-14, RP-05
- Primary/support relationships: Primary owner for BL-01–BL-14. Supports AO-10, AO-17, RP-05.
- Audited gaps: No Blog implementation was found; the route was blank. Mandatory authoring, review, preview, publishing and website association are absent.
- Concrete deliverables: Persistent articles, drafts, review and publication for native websites, with server-enforced permissions and transitions, website association, editor, list, detail and protected preview. Publication uses the native blog contract, rendered page and sitemap. Wix Blog publishing is excluded by D14. Do not implement BL-15–BL-20.
- Acceptance criteria: BL-01–BL-14 row checks pass after reload and with unauthorised/cross-client denial; review is required before publish; publish/unpublish updates the live native revision and sitemap. The controlling row-level criteria and original evidence are in `GENIE_WORKS_V1_REQUIREMENTS_RECONCILED.csv`.
- Dependencies/decisions: D14 sets native-only publication and the role split. Content is `clinic-article-v1` blocks. Preview tokens expire and can be revoked. D14 does not add a separate ban on an admin, manager or reviewer approving an article they authored. Specialists cannot approve.
- Progress: Verified
- Evidence: `docs/implementation/V1-I01_EVIDENCE.md`
- Last updated: 2026-10-28

Checklist:
- [x] Resolve recorded decisions and obtain only the safe fixtures/configuration required for this ticket.
- [x] Deliver the listed scope without importing deferred Blog Performance or audit-only implementation suggestions.
- [x] Record direct evidence against each applicable row-level acceptance check.
- [x] Move progress to `Implemented` only after deliverables exist, and to `Verified` only after acceptance evidence succeeds.

### V1-I02 Agency Overview completeness
- Type: Implementation
- Original priority: P0
- Proposed change: No change proposed; retain P0.
- Requirement IDs: AO-01–AO-24
- Primary/support relationships: Primary owner for AO-01–AO-24.
- Audited gaps: Dashboard evidence was partial: aggregate work, trends/comparisons, task ownership/deadlines, freshness/error states and complete quick access were incomplete; AO-24 was omitted from the original ticket mapping.
- Concrete deliverables: Complete scoped aggregates, work queues, trends/comparisons, task/deadline displays if activated, data freshness/error states, and all required module links for AO-01–AO-24.
- Acceptance criteria: Every AO-01–AO-24 row check passes with scoped synthetic data, including empty/error/stale states and links to functional destinations; AO-14–AO-16 apply only after their condition is resolved. The controlling row-level criteria and original evidence are in `GENIE_WORKS_V1_REQUIREMENTS_RECONCILED.csv`.
- Dependencies/decisions: Depends on functional destination modules and definitions for outstanding work, comparisons and freshness. AO-14–AO-16 require task-trigger confirmation.
- Progress: In progress
- Evidence: Active work is visible in the dirty checkout, including modified `HomeDashboard.tsx`; this is progress evidence only, not implementation or verification evidence.
- Last updated: 2026-10-28

Checklist:
- [ ] Resolve recorded decisions and obtain only the safe fixtures/configuration required for this ticket.
- [ ] Deliver the listed scope without importing deferred Blog Performance or audit-only implementation suggestions.
- [ ] Record direct evidence against each applicable row-level acceptance check.
- [ ] Move progress to `Implemented` only after deliverables exist, and to `Verified` only after acceptance evidence succeeds.

### V1-I03 Leads/form registry
- Type: Implementation
- Original priority: P0
- Proposed change: No change proposed; retain P0.
- Requirement IDs: LF-01–LF-15, ST-10, AD-11–AD-13, AD-17
- Primary/support relationships: Primary owner for LF-01–LF-15. Supports ST-10, AD-11–AD-13, AD-17.
- Audited gaps: The current enquiry view is client-level/disconnected; website/form/source/date/export and deduplication requirements lack complete end-to-end evidence. LF-15 was omitted from the original ticket.
- Concrete deliverables: Complete website-scoped form/enquiry registry, filters, detail/status operations, CSV export, source contract, retry handling and documented deduplication/idempotency through LF-15.
- Acceptance criteria: LF-01–LF-15 row checks pass against an isolated synthetic source, survive reload, preserve associations, separate measurements, reject unauthorised access and prevent duplicate inflation. The controlling row-level criteria and original evidence are in `GENIE_WORKS_V1_REQUIREMENTS_RECONCILED.csv`.
- Dependencies/decisions: Requires approved privacy fields/consent ownership and V1-C02. Deduplication contract with the sibling source must be defined.
- Progress: Not started
- Evidence: Not yet recorded
- Last updated: 2026-10-28

Checklist:
- [ ] Resolve recorded decisions and obtain only the safe fixtures/configuration required for this ticket.
- [ ] Deliver the listed scope without importing deferred Blog Performance or audit-only implementation suggestions.
- [ ] Record direct evidence against each applicable row-level acceptance check.
- [ ] Move progress to `Implemented` only after deliverables exist, and to `Verified` only after acceptance evidence succeeds.

### V1-I04 Report workflow
- Type: Implementation
- Original priority: P0
- Proposed change: No change proposed; retain P0.
- Requirement IDs: RP-01–RP-13
- Primary/support relationships: Primary owner for RP-01–RP-13.
- Audited gaps: Reports were persisted but not fully organised by website/month/status and lacked defined review/approval/final-artifact semantics. RP-01 and RP-13 were omitted from the original mapping.
- Concrete deliverables: Complete RP-01–RP-04 and RP-06–RP-13 with website/month/status library, authoritative metrics, review/approval and immutable authorised final access. Keep RP-05 conditional.
- Acceptance criteria: All applicable report row checks pass; final reports are associated and authorised, and RP-05 is neither required nor implemented until BL-15–BL-20 are activated. The controlling row-level criteria and original evidence are in `GENIE_WORKS_V1_REQUIREMENTS_RECONCILED.csv`.
- Dependencies/decisions: Define report states, reviewer, approval record, final artifact/correction process and authoritative source. RP-05 remains gated by deferred Blog Performance.
- Progress: Not started
- Evidence: Not yet recorded
- Last updated: 2026-10-28

Checklist:
- [ ] Resolve recorded decisions and obtain only the safe fixtures/configuration required for this ticket.
- [ ] Deliver the listed scope without importing deferred Blog Performance or audit-only implementation suggestions.
- [ ] Record direct evidence against each applicable row-level acceptance check.
- [ ] Move progress to `Implemented` only after deliverables exist, and to `Verified` only after acceptance evidence succeeds.

### V1-I05 Analytics gaps
- Type: Implementation
- Original priority: P1
- Proposed change: No change proposed; retain P1.
- Requirement IDs: CM-04, WA-01–WA-14, ST-04–ST-06
- Primary/support relationships: Primary owner for WA-01–WA-14. Supports CM-04, ST-04–ST-06.
- Audited gaps: A live pipeline appeared present behind configuration, but campaign views, event coverage, freshness/error handling and no-double-counting evidence were incomplete.
- Concrete deliverables: Complete WA-01–WA-14 provider ingestion/display, campaign and event breakdowns, website/time/comparison controls, freshness and disconnected/error states, and cutover/conflict handling.
- Acceptance criteria: WA-01–WA-14 row checks pass with safe provider fixtures for each supported platform and prove website separation, persistence, freshness and no duplicate counting. The controlling row-level criteria and original evidence are in `GENIE_WORKS_V1_REQUIREMENTS_RECONCILED.csv`.
- Dependencies/decisions: Requires metric/event definitions and V1-C01 for provider proof; implementation can continue without treating absent credentials as a defect.
- Progress: In progress
- Evidence: Active analytics work is visible in modified/untracked analytics routes, actions, APIs, components and migration 0020; this is progress evidence only.
- Last updated: 2026-10-28

Checklist:
- [ ] Resolve recorded decisions and obtain only the safe fixtures/configuration required for this ticket.
- [ ] Deliver the listed scope without importing deferred Blog Performance or audit-only implementation suggestions.
- [ ] Record direct evidence against each applicable row-level acceptance check.
- [ ] Move progress to `Implemented` only after deliverables exist, and to `Verified` only after acceptance evidence succeeds.

### V1-I06 SEO completion
- Type: Implementation
- Original priority: P1
- Proposed change: No change proposed; retain P1.
- Requirement IDs: SEO-01–SEO-18
- Primary/support relationships: Primary owner for SEO-01–SEO-18.
- Audited gaps: SEO soft-launch records existed, but the full required workspace, checks, structured data and release behaviour varied by website type and was incomplete/unverified.
- Concrete deliverables: Complete SEO-01–SEO-18 with per-website data, findings/tasks, structured data, site health, preview/review/release and platform-specific publication behaviour approved by capability matrix.
- Acceptance criteria: SEO-01–SEO-18 row checks pass for representative Wix and Vercel staging sites, including persistence, permissions, error states and platform-specific unsupported behaviour stated honestly. The controlling row-level criteria and original evidence are in `GENIE_WORKS_V1_REQUIREMENTS_RECONCILED.csv`.
- Dependencies/decisions: Requires approved Wix/Vercel capability matrix and V1-C03 for publication proof.
- Progress: In progress
- Evidence: Active SEO work is visible in modified/untracked SEO routes, actions, components and workspace code; this is progress evidence only.
- Last updated: 2026-10-28

Checklist:
- [ ] Resolve recorded decisions and obtain only the safe fixtures/configuration required for this ticket.
- [ ] Deliver the listed scope without importing deferred Blog Performance or audit-only implementation suggestions.
- [ ] Record direct evidence against each applicable row-level acceptance check.
- [ ] Move progress to `Implemented` only after deliverables exist, and to `Verified` only after acceptance evidence succeeds.

### V1-I07 Settings completion
- Type: Implementation
- Original priority: P1
- Proposed change: No change proposed; retain P1.
- Requirement IDs: ST-01–ST-13
- Primary/support relationships: Primary owner for ST-01–ST-13.
- Audited gaps: Most detailed Settings rows were absent or fixed boundaries; “Settings (basic)” conflicts with the detailed table and password semantics are unresolved.
- Concrete deliverables: After scope decisions, implement the applicable ST-01–ST-13 preferences/configuration with persistence, website association and server-side permission enforcement.
- Acceptance criteria: Every activated Settings row check passes after reload and access checks; ambiguous ST-01–ST-11 and conditional ST-12–ST-13 remain decision-gated rather than silently assumed. The controlling row-level criteria and original evidence are in `GENIE_WORKS_V1_REQUIREMENTS_RECONCILED.csv`.
- Dependencies/decisions: Resolve “Settings (basic)” versus the detailed table, magic-link password wording, alert channels and feature-trigger conditions.
- Progress: In progress
- Evidence: Active settings/connection work is visible in modified `settings/page.tsx` and untracked connection UI; this is progress evidence only.
- Last updated: 2026-10-28

Checklist:
- [ ] Resolve recorded decisions and obtain only the safe fixtures/configuration required for this ticket.
- [ ] Deliver the listed scope without importing deferred Blog Performance or audit-only implementation suggestions.
- [ ] Record direct evidence against each applicable row-level acceptance check.
- [ ] Move progress to `Implemented` only after deliverables exist, and to `Verified` only after acceptance evidence succeeds.

### V1-I08 Admin lifecycle/data controls
- Type: Implementation
- Original priority: P1
- Proposed change: No change proposed; retain P1.
- Requirement IDs: CM-08, AD-01–AD-19
- Primary/support relationships: Primary owner for CM-08, AD-01–AD-19.
- Audited gaps: Base admin/auth/audit/backup code existed, but invitations, granular lifecycle controls, retention/export/deletion and backup/recovery status were incomplete or unverified.
- Concrete deliverables: Complete AD-01–AD-18 admin lifecycle/data controls and implement AD-19 backup/recovery status display. Include CM-08 website access administration. V1-V03 owns actual backup/restore proof.
- Acceptance criteria: Mapped row checks pass with synthetic users/data and audit records; deletion follows approved policy; AD-19 displays truthful run/status information, while restoration evidence is supplied by V1-V03. The controlling row-level criteria and original evidence are in `GENIE_WORKS_V1_REQUIREMENTS_RECONCILED.csv`.
- Dependencies/decisions: D14 resolves the assignment and publish/export rules used here. Invitations, retention, legal hold, deletion authority and backup-status display remain open. V1-V03 separately verifies restore.
- Progress: In progress
- Evidence: Permission portion only, in `docs/implementation/V1-I08_PERMISSIONS_EVIDENCE.md`. Invitations, retention, deletion, monitoring and backup display are not done.
- Last updated: 2026-10-28

Checklist:
- [x] Resolve the assignment, view, edit, review, publish and export rules from D14.
- [x] Deliver CM-08 and the shared AD-04–AD-06 checks without widening website or account-reference writes.
- [ ] Record acceptance for invitations, retention, deletion, monitoring and AD-19. Those remain outside this portion.
- [ ] Move the whole ticket to `Implemented` only after the remaining admin deliverables exist.

### V1-I09 Client files/site access
- Type: Implementation
- Original priority: P2
- Proposed change: No change proposed; retain P2.
- Requirement IDs: CM-01–CM-02, CM-04, CM-06–CM-07
- Primary/support relationships: Primary owner for CM-01–CM-02, CM-04, CM-06–CM-07.
- Audited gaps: The client registry existed, but mandatory files/documents and website-level access interpretation were incomplete; the original CM-10 reference is invalid.
- Concrete deliverables: Complete CM-01, CM-02, CM-04, CM-06 and CM-07: directory/workspace details, services interpretation, files/documents access and linked-site access under the approved storage/access model.
- Acceptance criteria: Mapped CM checks pass after reload for authorised staff and deny cross-client access; no invalid CM-10 is introduced. The controlling row-level criteria and original evidence are in `GENIE_WORKS_V1_REQUIREMENTS_RECONCILED.csv`.
- Dependencies/decisions: D14 defines services as plain text, files as titled links and notes, and client membership as covering every website. Live provider credentials remain with V1-C01. Registry writes stay with V1-I10.
- Progress: Implemented
- Evidence: `docs/implementation/V1-I09_EVIDENCE.md`
- Last updated: 2026-10-28

Checklist:
- [x] Follow D14 for services, files and client-to-website access.
- [x] Deliver services, file links, workspace links and shared authorisation without a second website-grant list.
- [x] Record isolation, persistence and browser evidence. Live provider connection proof stays with V1-C01.
- [ ] Move to `Verified` after CM-04 provider association is proven with configured fixtures. The ownership checks in this ticket passed; missing credentials are not treated as a defect here.

### V1-I10 Align registry permissions
- Type: Implementation
- Original priority: P0
- Proposed change: No change proposed; retain P0.
- Requirement IDs: CM-03, CM-05, CM-09, AD-04–AD-06
- Primary/support relationships: Primary owner for CM-03, CM-05, CM-09. Supports AD-04–AD-06.
- Audited gaps: Specialist registry controls could report success while RLS filtered writes, creating a reproducible false-success defect.
- Concrete deliverables: Align UI, actions, services and RLS for CM-03, CM-05 and CM-09 under the approved role model; return a failure when no authorised row changes.
- Acceptance criteria: Specialist controls either persist authorised changes or are absent/denied; zero-row writes cannot report success; admin and cross-client denial paths pass. The controlling row-level criteria and original evidence are in `GENIE_WORKS_V1_REQUIREMENTS_RECONCILED.csv`.
- Dependencies/decisions: Registry create and update stay with admin and manager, matching `canManageRegistry` and migration 0007. D14 does not explicitly extend specialist edit to website or account-reference records, so no new grant was added. See the evidence note.
- Progress: Verified
- Evidence: [V1-I10_EVIDENCE.md](V1-I10_EVIDENCE.md). Admin and manager writes persist and read back. Specialist, reviewer, read-only and cross-client updates fail without changing the row. The specialist profile shows the records and hides the edit controls.
- Last updated: 2026-10-28

Checklist:
- [x] Resolve recorded decisions and obtain only the safe fixtures/configuration required for this ticket.
- [x] Deliver the listed scope without importing deferred Blog Performance or audit-only implementation suggestions.
- [x] Record direct evidence against each applicable row-level acceptance check.
- [x] Move progress to `Implemented` only after deliverables exist, and to `Verified` only after acceptance evidence succeeds.

### V1-I11 Remove debug instrumentation
- Type: Implementation
- Original priority: P0
- Proposed change: No change proposed; retain P0.
- Requirement IDs: Cross-cutting; no requirement ID applies.
- Primary/support relationships: Cross-cutting ticket; no requirement ID applies and none is invented.
- Audited gaps: Hardcoded localhost debug/ingest instrumentation was found in authentication/session/database paths; this cross-cutting risk has no anchor requirement ID.
- Concrete deliverables: Remove the identified instrumentation and confirm normal error handling without transmitting metadata. This is a safety correction, not a new product function.
- Acceptance criteria: Repository search finds no equivalent hardcoded ingest calls and existing sign-in/database behaviour remains functional; no requirement ID is invented. The controlling row-level criteria and original evidence are in `GENIE_WORKS_V1_REQUIREMENTS_RECONCILED.csv`.
- Dependencies/decisions: None beyond preserving normal auth/session/database behaviour.
- Progress: Verified
- Evidence: [V1-I11_EVIDENCE.md](V1-I11_EVIDENCE.md). Source search found no remaining debug ingest calls. Seeded local sign-in reaches the dashboard, a closed database port throws `DbUnavailableError`, and the permission suite passed.
- Last updated: 2026-10-28

Checklist:
- [x] Resolve recorded decisions and obtain only the safe fixtures/configuration required for this ticket.
- [x] Deliver the listed scope without importing deferred Blog Performance or audit-only implementation suggestions.
- [x] Record direct evidence against each applicable row-level acceptance check.
- [x] Move progress to `Implemented` only after deliverables exist, and to `Verified` only after acceptance evidence succeeds.

### V1-C01 Provider sandbox setup
- Type: Configuration
- Original priority: P0
- Proposed change: No change proposed; retain P0.
- Requirement IDs: WA-01–WA-14, SEO-01, SEO-16–SEO-18, ST-04–ST-06
- Primary/support relationships: Supports WA-01–WA-14, SEO-01, SEO-16–SEO-18, ST-04–ST-06.
- Audited gaps: Required non-production integration configuration was unavailable, limiting verification without proving code broken.
- Concrete deliverables: Provide approved GA4/GSC/Wix sandbox properties/credentials, token key and safe worker scheduling for mapped requirements.
- Acceptance criteria: Mapped checks retrieve only synthetic/non-sensitive data and expose accurate sync timestamps/errors without touching production. The controlling row-level criteria and original evidence are in `GENIE_WORKS_V1_REQUIREMENTS_RECONCILED.csv`.
- Dependencies/decisions: Fixture mode, local worker authentication and mock provider scenarios are in place. The live portion remains blocked on a non-production GA4 property, a non-production Search Console property, `ANALYTICS_GOOGLE_CLIENT_ID`, `ANALYTICS_GOOGLE_CLIENT_SECRET`, `ANALYTICS_TOKEN_KEY`, `ANALYTICS_WORKER_SECRET`, and, for Wix analytics only, a non-production Wix site plus `ANALYTICS_WIX_APP_ID` and `ANALYTICS_WIX_APP_SECRET`.
- Progress: Implemented
- Evidence: [V1-C01_EVIDENCE.md](V1-C01_EVIDENCE.md). Fixture scenarios passed. HTTP worker calls without a valid bearer returned 401. No live provider call was made. The ticket is not Verified while that live check is outstanding. Handover: [GENIE_WORKS_V1_TEST_ENVIRONMENTS.md](../testing/GENIE_WORKS_V1_TEST_ENVIRONMENTS.md).
- Last updated: 2026-10-28

Checklist:
- [x] Resolve recorded decisions and obtain only the safe fixtures/configuration required for this ticket.
- [x] Deliver the listed scope without importing deferred Blog Performance or audit-only implementation suggestions.
- [x] Record direct evidence against each applicable row-level acceptance check.
- [ ] Move progress to `Implemented` only after deliverables exist, and to `Verified` only after acceptance evidence succeeds. Live provider acceptance is still outstanding, so this ticket stays `Implemented`.

### V1-C02 Enquiry fixture
- Type: Configuration
- Original priority: P0
- Proposed change: No change proposed; retain P0.
- Requirement IDs: AO-07, AO-12, LF-01–LF-15, AD-12–AD-13
- Primary/support relationships: Supports AO-07, AO-12, LF-01–LF-15, AD-12–AD-13.
- Audited gaps: The enquiry source was disconnected and no safe fixture existed.
- Concrete deliverables: Provision an isolated synthetic enquiry/outbox database matching the sibling website contract, with no real patient data or mail delivery.
- Acceptance criteria: Mapped enquiry, dashboard and admin paths can be exercised end to end without real data, external notifications or duplicate inflation. The controlling row-level criteria and original evidence are in `GENIE_WORKS_V1_REQUIREMENTS_RECONCILED.csv`.
- Dependencies/decisions: The fixture database is provisioned and matches the Genie Works reader. Compatibility with the sibling SQL remains provisional because `packages/platform/src/db/migrations` and `packages/platform/src/enquiries/service.ts` are absent from the sibling checkout. Seeded rows are not intake proof.
- Progress: Implemented
- Evidence: [V1-C02_EVIDENCE.md](V1-C02_EVIDENCE.md). `clinic_genie_enquiry_test` on `127.0.0.1:54339` holds 6 labelled enquiries and 6 outbox rows. Retry does not create a second enquiry. Unsafe reset targets exit 1. Not Verified as a sibling-schema match or as intake processing. Handover: [GENIE_WORKS_V1_TEST_ENVIRONMENTS.md](../testing/GENIE_WORKS_V1_TEST_ENVIRONMENTS.md).
- Last updated: 2026-10-28

Checklist:
- [x] Resolve recorded decisions and obtain only the safe fixtures/configuration required for this ticket.
- [x] Deliver the listed scope without importing deferred Blog Performance or audit-only implementation suggestions.
- [x] Record direct evidence against each applicable row-level acceptance check.
- [ ] Move progress to `Implemented` only after deliverables exist, and to `Verified` only after acceptance evidence succeeds. Sibling SQL compatibility and intake processing are still unproven, so this ticket stays `Implemented`.

### V1-C03 Website consumers
- Type: Configuration
- Original priority: P0
- Proposed change: No change proposed; retain P0.
- Requirement IDs: SEO-07–SEO-14, SEO-18, BL-12–BL-14
- Primary/support relationships: Supports SEO-07–SEO-14, SEO-18, BL-12–BL-14.
- Audited gaps: No representative clinic consumer was available for both Wix and Vercel publication behaviour.
- Concrete deliverables: Provide representative staging consumers/tokens and approve the platform capability matrix for SEO and Blog publication.
- Acceptance criteria: Mapped publish/unpublish/redirect/SEO/sitemap checks pass where supported; unsupported capabilities are explicit and do not show false success. The controlling row-level criteria and original evidence are in `GENIE_WORKS_V1_REQUIREMENTS_RECONCILED.csv`.
- Dependencies/decisions: The capability matrix is recorded. Native SEO and Blog read routes exist. A protected native staging consumer that calls them, and a non-production Wix site, are still absent. Wix Blog publishing and Blog Performance are excluded. Unblock the blocked rows by supplying those consumers without a public deploy.
- Progress: Implemented
- Evidence: [V1-C03_EVIDENCE.md](V1-C03_EVIDENCE.md). Unauthenticated public SEO and Blog reads returned HTTP 404. Blocked and excluded capabilities are not counted as passed. Not Verified as publication. Handover: [GENIE_WORKS_V1_TEST_ENVIRONMENTS.md](../testing/GENIE_WORKS_V1_TEST_ENVIRONMENTS.md).
- Last updated: 2026-10-28

Checklist:
- [x] Resolve recorded decisions and obtain only the safe fixtures/configuration required for this ticket.
- [x] Deliver the listed scope without importing deferred Blog Performance or audit-only implementation suggestions.
- [x] Record direct evidence against each applicable row-level acceptance check.
- [ ] Move progress to `Implemented` only after deliverables exist, and to `Verified` only after acceptance evidence succeeds. Staging publication checks have not passed, so this ticket stays `Implemented`.

### V1-V01 Repair automated suite
- Type: Verification
- Original priority: P0
- Proposed change: No change proposed; retain P0.
- Requirement IDs: AD-02, AD-05
- Primary/support relationships: Verification owner for AD-02, AD-05.
- Audited gaps: The existing automated suite was red around deactivation context and lacked adequate platform coverage.
- Concrete deliverables: Repair test setup for authorised service/owner context and add direct session/access invalidation coverage for AD-02 and AD-05.
- Acceptance criteria: The relevant existing suite and direct deactivation checks pass without weakening RLS or production behaviour. The controlling row-level criteria and original evidence are in `GENIE_WORKS_V1_REQUIREMENTS_RECONCILED.csv`.
- Dependencies/decisions: Implementation changes that affect access/session lifecycle must be available; no external credential dependency.
- Progress: Verified
- Evidence: [V1-V01_EVIDENCE.md](V1-V01_EVIDENCE.md). `npm test` exits 0: database 51 passed, platform 3 passed. Deactivation removes the session and the application access check. Specialist and manager staff changes are denied.
- Last updated: 2026-10-28

Checklist:
- [x] Resolve recorded decisions and obtain only the safe fixtures/configuration required for this ticket.
- [x] Deliver the listed scope without importing deferred Blog Performance or audit-only implementation suggestions.
- [x] Record direct evidence against each applicable row-level acceptance check.
- [x] Move progress to `Implemented` only after deliverables exist, and to `Verified` only after acceptance evidence succeeds.

### V1-V02 Requirement E2E matrix
- Type: Verification
- Original priority: P0
- Proposed change: No change proposed; retain P0.
- Requirement IDs: AO-01–AO-24, CM-01–CM-09, WA-01–WA-14, SEO-01–SEO-18, BL-01–BL-14, LF-01–LF-15, RP-01–RP-13, ST-01–ST-13, AD-01–AD-19
- Primary/support relationships: Verification owner for AO-01–AO-24, CM-01–CM-09, WA-01–WA-14, SEO-01–SEO-18, BL-01–BL-14, LF-01–LF-15, RP-01–RP-13, ST-01–ST-13, AD-01–AD-19.
- Audited gaps: Only limited sign-in smokes existed; most requirements lacked direct runtime evidence.
- Concrete deliverables: Build a requirement-indexed runtime matrix for every non-deferred applicable row: normal, persistence/reload, association, empty/loading/error/disconnected and unauthorised cases as relevant.
- Acceptance criteria: Each mandatory row has successful direct runtime evidence before being marked verified; conditional/ambiguous rows run only when activated/resolved; deferred rows remain excluded. The controlling row-level criteria and original evidence are in `GENIE_WORKS_V1_REQUIREMENTS_RECONCILED.csv`.
- Dependencies/decisions: Applicable implementation and configuration tickets must supply testable behaviour/data; ticket ordering alone is not a blocker.
- Progress: Not started
- Evidence: Not yet recorded
- Last updated: 2026-10-28

Checklist:
- [ ] Resolve recorded decisions and obtain only the safe fixtures/configuration required for this ticket.
- [ ] Deliver the listed scope without importing deferred Blog Performance or audit-only implementation suggestions.
- [ ] Record direct evidence against each applicable row-level acceptance check.
- [ ] Move progress to `Implemented` only after deliverables exist, and to `Verified` only after acceptance evidence succeeds.

### V1-V03 Backup/restore evidence
- Type: Verification
- Original priority: P1
- Proposed change: No change proposed; retain P1.
- Requirement IDs: AD-19
- Primary/support relationships: Verification owner for AD-19.
- Audited gaps: Backup capability/status UI existed, but no approved backup and isolated restore run was recorded. The original audit incorrectly mapped this to AD-18.
- Concrete deliverables: For AD-19, run an approved local logical backup and isolated restore verification; record counts, relationships, RLS and status evidence. Do not treat this as AD-18 deletion work.
- Acceptance criteria: A safe backup and isolated restore succeed with documented integrity/RLS checks, and the admin status reflects the run; no production data is touched. The controlling row-level criteria and original evidence are in `GENIE_WORKS_V1_REQUIREMENTS_RECONCILED.csv`.
- Dependencies/decisions: running backup would create an audit artifact and requires explicit approval plus a local storage policy. Unblock condition: approving a safe local backup and isolated restore target.
- Progress: Blocked
- Evidence: Blocked: running backup would create an audit artifact and requires explicit approval plus a local storage policy. Unblock by approving a safe local backup and isolated restore target.
- Last updated: 2026-10-28

Checklist:
- [ ] Resolve recorded decisions and obtain only the safe fixtures/configuration required for this ticket.
- [ ] Deliver the listed scope without importing deferred Blog Performance or audit-only implementation suggestions.
- [ ] Record direct evidence against each applicable row-level acceptance check.
- [ ] Move progress to `Implemented` only after deliverables exist, and to `Verified` only after acceptance evidence succeeds.

### V1-V04 Build warning review
- Type: Verification
- Original priority: P1
- Proposed change: No change proposed; retain P1.
- Requirement IDs: Cross-cutting; no requirement ID applies.
- Primary/support relationships: Cross-cutting ticket; no requirement ID applies and none is invented.
- Audited gaps: The build passed with filesystem tracing warnings; this cross-cutting deployment review has no anchor requirement ID.
- Concrete deliverables: Review traced paths against the deployment target and document or constrain unintended inclusions without changing product scope.
- Acceptance criteria: Build artifact review shows no unintended repository content; intentional warnings are documented. No requirement ID is invented. The controlling row-level criteria and original evidence are in `GENIE_WORKS_V1_REQUIREMENTS_RECONCILED.csv`.
- Dependencies/decisions: Requires deployment-target decision; review may proceed independently of feature tickets.
- Progress: Not started
- Evidence: Not yet recorded
- Last updated: 2026-10-28

Checklist:
- [ ] Resolve recorded decisions and obtain only the safe fixtures/configuration required for this ticket.
- [ ] Deliver the listed scope without importing deferred Blog Performance or audit-only implementation suggestions.
- [ ] Record direct evidence against each applicable row-level acceptance check.
- [ ] Move progress to `Implemented` only after deliverables exist, and to `Verified` only after acceptance evidence succeeds.


## Completion discipline

Use the reconciled CSV as the row-level source for scope, unchanged audit status, acceptance checks, evidence, ownership and decisions. Update ticket progress only from recorded delivery/verification evidence. Deferred BL-15–BL-20 must remain visible but excluded until an explicit scope decision activates them; RP-05 follows that decision. Cross-cutting V1-I11 and V1-V04 intentionally have no requirement IDs.
