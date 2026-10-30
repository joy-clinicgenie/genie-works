# Architecture and module boundaries

## Layers
1. Clinic websites: independently configured public pages, local SEO output, booking interface and forms. Prefer static/pre-rendered content where appropriate.
2. Shared backend: registry, authentication/authorisation, form intake, lead persistence, outbox and protected admin endpoints.
3. Control Centre: minimal lead administration in Phase 1; agency operations and intelligence later.

Use a modular monolith. A proposed workspace is apps/site-template, apps/control-centre, packages/shared-ui, packages/contracts and services/backend. Framework placement can differ if ownership and boundaries stay clear. Do not create microservices without evidence of need.

## Failure isolation
Public pages must render when the Control Centre UI is unavailable. Form processing must not require a dashboard page or session. Backend failure must show an honest form error and clinic fallback, never a false success. Email failure must not remove a stored enquiry. If apps share hosting, document shared deployment risks rather than claiming independent outage isolation.

## Interfaces
- Versioned public form submission endpoint; proposed contract in 07_FORMS_LEAD_CAPTURE.md.
- Protected client/site configuration and lead administration endpoints.
- Provider adapter for notification send and delivery status.
- Booking mode adapter: enquiry or approved external destination.
- Background dispatcher with a documented supported scheduler/queue, retries and worker authentication.

## Constraints
All writes, provider secrets, recipient routing and tenant checks run server-side. Public site identifiers are routing hints, not permissions. No browser-provided recipient or client ID can determine access.

## Dependency order
Repository/environments → registry/access → site starter/SEO → form contract/persistence → outbox/email → booking/analytics → reuse proof/security/recovery → controlled launch.
