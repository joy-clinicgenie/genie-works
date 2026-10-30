---
cursor:
  subagentId: "bc-3970cf4c-8908-5da2-a074-e10e6d5f7ee9"
---

# Genie Works V1 Reconciliation Log

## Baseline and preservation

Reconciliation used the complete 145-row original register and the authoritative anchor. The original audit and register were not edited.

- `docs/audits/GENIE_WORKS_V1_FUNCTIONAL_AUDIT.md`: SHA-256 `22ad32f054bebba8b298eee59bd594b592a18b43eb3250c2f1d0d0a1b8130037`; 87,263 bytes at baseline.
- `docs/audits/GENIE_WORKS_V1_REQUIREMENTS.csv`: SHA-256 `0725a6d4747c5e5f42f894a4d1d8380301e3778210093c307cd957a0f2e8b34f`; 69,013 bytes at baseline.
- Audited commit: `1ffd47d5f8049f6b3a4a2e86ad9b46d7f0ef8ec0`.
- All original IDs, wording, locations, acceptance checks, inferred flags, audit statuses, evidence, runtime evidence, gaps and work-required text are copied once into labeled baseline columns in the reconciled CSV.

## Corrected mappings

| Ticket | Original mapping | Reconciled mapping | Correction |
|---|---|---|---|
| V1-I01 | BL-01–BL-14 | BL-01–BL-14 | Retained; BL-15–BL-20 stay deferred and have no V1 owner. |
| V1-I02 | AO-03–AO-23 | AO-01–AO-24 | Added previously omitted AO-01, AO-02 and AO-24. |
| V1-I03 | LF-01–LF-14 | LF-01–LF-15 | Added omitted LF-15 so all Leads and Forms requirements have implementation and verification coverage. |
| V1-I04 | RP-02–RP-12 | RP-01–RP-13 | Added omitted RP-01 and RP-13; RP-05 remains assigned as future conditional ownership, not current mandatory work. |
| V1-I05 | WA-05–WA-15 | WA-01–WA-14 | Removed nonexistent WA-15 and added omitted WA-01–WA-04; the actual register ends at WA-14. |
| V1-I06 | SEO-07–SEO-18 | SEO-01–SEO-18 | Added omitted SEO-01–SEO-06. |
| V1-I07 | ST-02–ST-13 | ST-01–ST-13 | Added omitted ST-01 while preserving ambiguity/conditions. |
| V1-I08 | AD-01–AD-17 | AD-01–AD-19, plus CM-08 | Added AD-18 deletion procedures and AD-19 implementation/status display; CM-08 is the admin access-management owner. Backup/restore execution stays with V1-V03. |
| V1-I09 | CM-04–CM-10 | CM-01, CM-02, CM-04, CM-06, CM-07 | Removed nonexistent CM-10 and assigned actual client/file/site-access scope. The register ends at CM-09. |
| V1-I10 | CM-03, CM-05 | CM-03, CM-05, CM-09 | Added CM-09 to the registry permission/alignment defect owner. |
| V1-C01 | WA-01–WA-15, SEO-01, SEO-16–SEO-18, ST-04–ST-06 | WA-01–WA-14, SEO-01, SEO-16–SEO-18, ST-04–ST-06 | Removed nonexistent WA-15. |
| V1-C02 | AO-07/AO-12, LF-01–LF-14, AD-12 | AO-07, AO-12, LF-01–LF-15, AD-12, AD-13 | Added LF-15 and the adjacent admin retry/status dependency AD-13. |
| V1-C03 | SEO-07–SEO-14, BL-12–BL-14 | SEO-07–SEO-14, SEO-18, BL-12–BL-14 | Added SEO-18 where website-consumer proof is required. |
| V1-V01 | AD-02/AD-05 | AD-02, AD-05 | Retained and normalized. |
| V1-V02 | All non-deferred | Every mandatory row; applicable conditional/ambiguous rows | Made row-level coverage explicit; RP-05 runs only if activated. |
| V1-V03 | AD-18 | AD-19 | Corrected backup/recovery verification to AD-19. AD-18 remains deletion-procedure implementation under V1-I08. |
| V1-I11 / V1-V04 | Cross-cutting | Cross-cutting | Retained without inventing requirement IDs. |

## Scope correction and calculated counts

RP-05 keeps its ID, wording, evidence and MISSING audit status but changes from baseline `mandatory` to reconciled `Conditional`. Its source function—Blog performance in reports—depends on explicitly deferred BL-15–BL-20. It is nonblocking and excluded from mandatory scoring while Blog Performance remains deferred.

Calculated from the actual CSV:

- Baseline: 145 total; 123 mandatory; 5 conditional; 6 explicitly deferred; 11 ambiguous.
- Reconciled: 145 total; 122 mandatory; 6 conditional; 6 explicitly deferred; 11 ambiguous.
- Global audit statuses unchanged: 8 VERIFIED COMPLETE; 64 PARTIAL; 53 MISSING; 1 BROKEN; 19 UNVERIFIED.
- Mandatory VERIFIED COMPLETE: 7 / 122 = 5.7% (rounded to one decimal).

There is no discrepancy from the expected reconciliation: only RP-05 changes scope.

## Formerly unmapped assignments

- AO-01, AO-02 and AO-24 → V1-I02.
- LF-15 → V1-I03, supported by V1-C02 and verified by V1-V02.
- RP-01 and RP-13 → V1-I04.
- WA-01–WA-04 → V1-I05, with V1-C01 support.
- SEO-01–SEO-06 → V1-I06 (SEO-01 also has V1-C01 support).
- ST-01 → V1-I07, still decision-gated.
- CM-01, CM-02, CM-06 and CM-07 → V1-I09; CM-08 → V1-I08; CM-09 → V1-I10.
- AD-18 and AD-19 → V1-I08 for implementation/status display; V1-V03 verifies AD-19 backup/restore.

Each actionable non-deferred requirement now has one primary implementation owner. Supporting tickets do not replace that owner.

## Remaining decisions and exact resolution

| Decision/blocker | Resolution needed |
|---|---|
| “Settings (basic)” versus detailed ST-01–ST-11 | Approve which detailed rows are V1 and define ST-01 password behaviour for magic-link authentication. |
| Conditional AO-14–AO-16 | Confirm whether the existing task module means “as task tracking becomes available” is activated; if yes, these become V1-blocking. |
| Conditional ST-12–ST-13 | Define which underlying alerts are active and supported channels as their source features become available. |
| RP-05 / Blog Performance | Leave nonblocking while BL-15–BL-20 are deferred; if activated, define reporting semantics and run its implementation/verification work. |
| Client “Services” | Resolved by D14 (28 Oct 2026): a plain text field, separate from channel tags. Implemented under V1-I09. The baseline CSV status was not rewritten. |
| Website permissions | Resolved by D14: client membership covers every website of that client. No second website-grant list was added. Website and account-reference registry writes stay with admin and manager (V1-I10). |
| Wix versus Vercel | Approve a capability matrix for analytics, SEO, Blog publishing, redirects and sitemap updates. Blog publishing is settled for this ticket by D14: native websites only. Wix Blog stays excluded. |
| Blog self-approval | D14 lets admin, manager and reviewer approve. It does not forbid approving an article the same person authored. V1-I01 does not add a separate ban. Specialists cannot approve. |
| Reports | Define states, reviewer, approval record, final artifact, correction process and authoritative data source. |
| Retention/deletion | Supply policy owner, periods, legal holds, deletion authority, export and audit requirements. |
| Safe integration proof | Supply non-production provider sandboxes, an isolated synthetic enquiry fixture and representative staging consumers. |
| Backup/restore evidence | Approve local artifact/storage policy and isolated target, then run V1-V03 without production data. |

## Audit suggestions beyond the anchor

The following may be useful implementation choices but are not promoted to V1 requirements by this reconciliation: a campaign-template design, a particular scheduler mechanism, a rich-text storage format, an explicit website-grant schema, a granular permission model beyond approved roles, a specific rollback mechanism, and support/operations tooling. Each requires a design or policy decision if selected. Cross-cutting removal of identified debug instrumentation and build-warning review remain safety/verification tickets from the audit, not invented product requirements.

## Validation intent

Documentation-only validation must prove: every original row appears exactly once; IDs are unchanged and valid; every mandatory row has primary implementation and verification coverage; every conditional/ambiguous row has a dependency or decision; deferred rows remain visible and excluded; ticket mappings match the reconciled CSV; original hashes are unchanged; only the three requested checkout documents were created by this step; and store copies are byte-identical.
