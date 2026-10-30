# Product scope and discovery

## Phase 1 objective
Replace essential Wix-dependent functions with a maintainable website foundation. Start with one controlled clinic website, then prove shared backend reuse with a second dummy website. Aim for 1-3 independently deployed clinic websites over the next three months, subject to phased gates.

## Include now
- Vercel hosting, environment separation, domains, HTTPS and repeatable deployment.
- Responsive site starter or adaptation of existing compatible code; approved medical copy and assets.
- Metadata, canonicals, schema, redirects, sitemap, robots, 404 handling and optimised media.
- Native SEO soft launch: editable page metadata published to supported clinic-site HTML; individual searchable/editable 301 redirects with loop validation; an honest setup checklist; automatic XML sitemaps; generated safe robots.txt defaults; Google Search Console HTML verification support; and branch-level Google Business Profile references, setup status and open-in-Google links.
- Client/site registry, staff authentication and enforced client-scoped access.
- Contact and appointment enquiry forms; durable storage, deduplication and correct clinic routing.
- Notification outbox, transactional email, bounded retries, delivery/failure visibility.
- Enquiry or approved external booking link/embed; accessible fallback.
- GA4/GSC setup, agreed events, permitted attribution and optional Ads conversion setup.
- Minimal protected lead administration, monitoring, backups, restore tests and handover.

## Preserve as backlog
| Original capability | Disposition |
| --- | --- |
| Client profiles and account references | Core registry now; expanded profiles Phase 2 |
| Dashboard and personal action queue | Minimal admin now; full queue Phase 2 |
| Task ownership, deadlines and follow-up | Phase 2 |
| Approvals and decision history | Manual clinical sign-off now; full module Phase 2 |
| SEO content and search mapping | Existing mapping retained; broader content and blog tracker Phase 2 |
| Google Ads audit and change log | Phase 2 |
| Issue register, evidence and verification | Build bug register now; agency module Phase 2 |
| Medical review and sources | Approval evidence now; full records Phase 2 |
| Performance reporting/comparisons | Tracking now; consolidated reporting Phase 3 |
| Change and Outcome Timeline | Git/deploy records now; agency timeline Phase 2-3 |

Recurring deliverables, service-delivery tracker and social/design/video production tracking remain excluded. An internal website revision/project QA tracker remains excluded; actual launch QA is mandatory. Advanced CMS, off-site intelligence and AI monitoring are later-phase work.

### Post-soft-launch SEO/GEO backlog
The following are explicitly deferred until after the first soft launch: bulk redirects, redirect groups, advanced metadata templates, automated Site Inspection, direct Google Business Profile API management, SEO performance reporting, `llms.txt`, and NLWeb. Do not add placeholder routes or empty screens for these items.

## Discovery decision register: due by Day 2
For each decision record owner, date, options, decision, cost, evidence and blocker status:
pilot clinic; new build versus migration; existing code/framework; required pages; repository ownership; Vercel plan; managed PostgreSQL vendor and region; managed auth; email provider and sender domain; clinic recipient; booking provider/mode; GA4/GSC ownership; retention and processing arrangements; security reviewer; release approver; maintenance and incident owners.

Next.js/TypeScript is a recommended default only if compatible. Supabase is a candidate, not a selected vendor. Inspect current official vendor documentation after selection before implementation. Obtain approval before paid vendor commitments. Keep uncertainty visible; do not invent IDs, approvals or provider capabilities.
