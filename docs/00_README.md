# Clinic Genie: website backend build and expansion

Version: 2.0 | Prepared: 16 October 2026 | Status: implementation specifications for discovery and build.

## Authority
This pack translates Clinic_Genie_Phase_1_Developer_Implementation_Pack_V2.pdf, Version 2.0, 16 October 2026, into separate Markdown specifications. The PDF is authoritative if this derivative conflicts with it. Detailed API and database suggestions here are proposed implementation contracts, not claims that discovery or vendor selection has been completed.

The previous internal-dashboard-first pack is superseded. Do not combine its two-week launch scope with this plan. The original ten agency features are preserved as a future backlog in 01_PRODUCT_SCOPE.md.

## Read order
Read 01, 02, 03 and 04 before coding. Resolve the discovery decisions in 01. Use the relevant module file, 16_BUILD_RULES.md, 17_BUILD_TICKETS.md and 18_ACCEPTANCE_TESTS.md for each ticket. Use 20_DELIVERY_TIMELINE.md for sequencing and 19_SEED_DATA_TEST_PLAN.md for safe demonstrations.

## Target outcome
One reliable clinic website, a reusable shared form/lead/notification service, and a second dummy website proving reuse without copying backend logic. Public pages and form processing must not depend on the Control Centre interface being available. The authorized first-soft-launch SEO scope and post-launch backlog are in [06_WEBSITE_STARTER_SEO.md](06_WEBSITE_STARTER_SEO.md).

## Milestones
- Working Days 5-7: reusable foundation demonstration.
- Working Days 10-15: functional staging pilot.
- By Working Day 20: controlled launch target, only after release gates pass.
- One full-time Cursor developer; discovery, existing code and migration complexity can change estimates.

## Boundaries
No production patient data before approved arrangements and security gates. No custom calendar, mail server, password system, drag-and-drop editor or full CRM. No real secrets in this pack.

## Delivery
All 21 Markdown files form one specification pack. Start Cursor with the prompt in 16_BUILD_RULES.md. Read 17_BUILD_TICKETS.md to implement CG-01 first. This pack is documentation, not an implemented application or launch authorisation.

## File index
- [00_README.md](00_README.md)
- [01_PRODUCT_SCOPE.md](01_PRODUCT_SCOPE.md)
- [02_INFORMATION_ARCHITECTURE.md](02_INFORMATION_ARCHITECTURE.md)
- [03_ROLES_PERMISSIONS.md](03_ROLES_PERMISSIONS.md)
- [04_DATA_MODEL.md](04_DATA_MODEL.md)
- [05_CLIENT_WEBSITE_REGISTRY.md](05_CLIENT_WEBSITE_REGISTRY.md)
- [06_WEBSITE_STARTER_SEO.md](06_WEBSITE_STARTER_SEO.md)
- [07_FORMS_LEAD_CAPTURE.md](07_FORMS_LEAD_CAPTURE.md)
- [08_EMAIL_OUTBOX_ROUTING.md](08_EMAIL_OUTBOX_ROUTING.md)
- [09_BOOKING_CONNECTIONS.md](09_BOOKING_CONNECTIONS.md)
- [10_ANALYTICS_CONVERSIONS.md](10_ANALYTICS_CONVERSIONS.md)
- [11_MINIMAL_ADMIN.md](11_MINIMAL_ADMIN.md)
- [12_MEDICAL_PRIVACY_APPROVALS.md](12_MEDICAL_PRIVACY_APPROVALS.md)
- [13_SECURITY_FOUNDATION.md](13_SECURITY_FOUNDATION.md)
- [14_MONITORING_RECOVERY_HANDOVER.md](14_MONITORING_RECOVERY_HANDOVER.md)
- [15_DESIGN_SYSTEM.md](15_DESIGN_SYSTEM.md)
- [16_BUILD_RULES.md](16_BUILD_RULES.md)
- [17_BUILD_TICKETS.md](17_BUILD_TICKETS.md)
- [18_ACCEPTANCE_TESTS.md](18_ACCEPTANCE_TESTS.md)
- [19_SEED_DATA_TEST_PLAN.md](19_SEED_DATA_TEST_PLAN.md)
- [20_DELIVERY_TIMELINE.md](20_DELIVERY_TIMELINE.md)

CG-01 discovery evidence is [decisions/CG-01-pilot-scope.md](decisions/CG-01-pilot-scope.md). It is a practice decision record, not a substitute for the PDF and not a signed launch approval.

DAY-01 evidence is [decisions/DAY-01-scope-audit.md](decisions/DAY-01-scope-audit.md). It freezes that pilot scope, audits this repository, and records provider access as unconfirmed. The security reviewer is not booked.
