# Page speed audit

Measured on 30 October 2026 against a local production build of the Clinic Genie platform (`next build` / `next start` on `http://127.0.0.1:3401`). The development server on port 3400 was left running and was not used for the scores.

Lighthouse 13.6.0, system Chrome, headless. Mobile used Lighthouse simulated throttling. Desktop used `--preset=desktop`. Each page was measured once. Interaction to Next Paint was not measured: the lab audit `inp-breakdown-insight` was `notApplicable`, and there is no Chrome UX Report data for localhost. PageSpeed Insights was not used because the app is not on a public URL and the pages require a staff session.

Protected pages used a short-lived database session for the seeded `admin@example.invalid` account. That session was deleted after the audit. No patient or enquiry content is included in this report.

## 1. Executive summary

The platform was already fast. Laboratory performance was 98–100 before any code change. The failures that were real product bugs were accessibility contrast, skipped headings, a missing favicon (console 404), a leftover debug request on the sign-in page, mobile overflow, and an analytics query that loaded snapshots for every client.

After the fixes:

- Accessibility is 100 on every retested page (was 96–100).
- Best Practices is 100 on every retested page (was 96).
- Performance stays 98–100. The lowest mobile Largest Contentful Paint values are 2.39s on Blog and 2.42s on Clients, under the 2.5s target.
- Cumulative Layout Shift is 0. Total Blocking Time stays under 200ms.
- SEO remains 60 on signed-in pages and 63 on sign-in. The only failing SEO audit is `is-crawlable`, because the app sends `noindex, nofollow`. That is the correct result for an internal tool. There are no public indexable pages, so the 95 SEO target does not apply.

Analytics server response time improved in the same lab run from 835ms to 432ms on mobile and from 551ms to 460ms on desktop. Other server times moved in both directions; those pages were not changed and the database is remote, so that spread is single-run variance.

## 2. Pages tested

| Route | What it is | Auth |
| --- | --- | --- |
| `/sign-in` | Public sign-in | No |
| `/` | Dashboard | Yes |
| `/clients` | Client directory | Yes |
| `/analytics` | Website analytics | Yes |
| `/seo` | SEO performance | Yes |
| `/blog` | Blog management | Yes |
| `/enquiries` | Leads and forms | Yes |
| `/reports` | Reports | Yes |
| `/settings` | Settings | Yes |
| `/admin` | Administration | Yes |

Also confirmed loading with status 200, and no browser console errors, after the final build: the same routes. Mobile overflow was measured on Dashboard, Clients, Analytics, SEO, Blog and Leads.

Not separately Lighthouse-tested: client detail, article editor, form detail, Google Ads, issues, medical review, task detail, and the public bearer-token APIs. Those routes exist and are dynamic. The shell, tables and headings they share were covered by the pages above.

There is no Lighthouse config in the repo. Playwright is configured in `playwright.config.ts` for the development server (`e2e/sign-in.spec.ts` only).

## 3. How the app is built

Next.js 16.4.2 App Router, React 19, Tailwind CSS 4. Almost every route is `force-dynamic` and rendered on the server for the signed-in staff member. Authorisation is the session plus Postgres row-level security. The shell is a client component; page content stays on the server.

Fonts are self-hosted Plus Jakarta Sans through `next/font` (`display: swap`, weights 400–700). The only shared image is `public/brandmark.svg`, served with width and height. There is no chart library. Charts are inline SVG.

`X-Robots-Tag: noindex, nofollow` is set for every response, and the root metadata sets `robots.index` and `robots.follow` to false. Authenticated HTML is not cached in a shared cache.

## 4. Original scores

Performance / Accessibility / Best Practices / SEO. Lighthouse category scores are 0–100.

| Page | Mobile | Desktop |
| --- | --- | --- |
| Sign-in | 100 / 100 / 96 / 63 | 100 / 100 / 96 / 63 |
| Dashboard | 100 / 96 / 96 / 60 | 100 / 96 / 96 / 63 |
| Clients | 98 / 100 / 96 / 60 | 100 / 100 / 96 / 63 |
| Analytics | 100 / 100 / 96 / 60 | 100 / 100 / 96 / 63 |
| SEO | 100 / 98 / 96 / 60 | 100 / 98 / 96 / 63 |
| Blog | 98 / 98 / 96 / 60 | 100 / 98 / 96 / 63 |
| Leads and forms | 100 / 98 / 96 / 60 | 100 / 98 / 96 / 63 |
| Reports | 100 / 100 / 96 / 60 | 100 / 100 / 96 / 63 |
| Settings | 100 / 100 / 96 / 60 | 100 / 100 / 96 / 63 |
| Admin | 100 / 100 / 96 / 60 | 100 / 100 / 96 / 63 |

Core Web Vitals from that same baseline run are in section 8.

## 5. Issues

### P0

None of the tested routes were broken on the production build. Sign-in, dashboard, clients, analytics, SEO, blog, leads, reports, settings and admin all returned 200 with a valid staff session.

During the audit, the already-running development server logged `AdapterError` / Postgres `3D000` when the sign-in form was submitted. A new connection to the configured database succeeded, and the production server on port 3401 served authenticated pages. The development process was not restarted as part of this work.

### P1

- Analytics loaded up to 50,000 snapshot rows for every visible client, then kept one client in memory (`apps/platform/src/lib/site-view.ts`). Mobile server-response time was 835ms.
- Sign-in posted to `http://127.0.0.1:7497` on every visit and the request was refused. That was leftover debug code, and it was the console error on the sign-in page.
- `/favicon.ico` returned 404 on every page. That was the console error that held Best Practices at 96.

### P2

- Dashboard enquiry card used `text-white/75` on `#136C72`. Lighthouse failed colour contrast for that line.
- Blog, SEO and Leads empty states used an `h3` directly after the page `h1`.
- Collapsed navigation used an `h2` before the page `h1`.
- Navigation collapse was stored only in `localStorage`, so a returning user could shift the sidebar after hydration.
- Mobile pages overflowed horizontally. Data tables expanded the document. The clinic `<select>` sized itself to the longest name. Dashboard cards grew past the viewport. The header “Add new” control extended about 50px past a 390px screen.
- The production build traced the whole repository because upload and `.env` paths are dynamic. That warning is gone after the trace ignore comments.

### P3

- Lighthouse still reports unused JavaScript, legacy JavaScript and a render-blocking stylesheet. These come from the Next.js runtime and the compiled Tailwind file. Performance is already 98–100, so they were not rewritten.
- Dynamic authenticated responses use `Cache-Control: no-store`, so they cannot enter the back/forward cache. That was left in place so clinic pages are not restored from a shared browser’s history.
- Blog images are private, uncached, and do not declare dimensions. They are not on the audited list pages. Caching them publicly would be the wrong trade for an internal tool.

## 6. Root causes

- The analytics loader needed to know which clients have session snapshots, and it answered that by reading the snapshot table for everyone.
- A previous debugging session left a client `fetch` and a server `fetch` aimed at a local ingest port, plus a `gw_dbg` cookie on the auth route.
- Chrome requests `/favicon.ico` even when the brand SVG is used in the page. Nothing answered that URL.
- White at 75% opacity on the action teal falls below the contrast ratio for 12px text.
- `EmptyState` always rendered an `h3`, including on pages whose only previous heading was an `h1`.
- Grid and flex children default to `min-width: auto`, so long table cells, select options and nowrap buttons widened the page. A native `<select>` uses its longest option as its minimum width.
- The sidebar preference could not be known during server render.

## 7. Fixes

- Analytics now asks for the client ids that have a current `sessions` snapshot, then loads at most 20,000 snapshot rows for the chosen client. The dashboard asks the enquiry list for 5 rows instead of the default 25.
- Removed the debug probe, the debug cookie, and the local ingest requests. Deleted `SignInErrorProbe.tsx`.
- `/favicon.ico` rewrites to `/brandmark.svg`. The document icon is the same SVG.
- Enquiry-card text on the teal panel is solid white.
- Empty-state titles are `h2`. Collapsed nav group labels are paragraphs, not headings.
- The sidebar preference is stored in the `gw-nav` cookie so the server and the browser agree. An existing `localStorage` value is copied into that cookie once.
- Tables can scroll inside the page (`min-w-0` on the existing overflow wrapper). Cards cannot force the page wider. The clinic picker has a bounded width and its row can wrap. Below the `sm` breakpoint the add control keeps the plus icon and an accessible name; the words “Add new” remain visible from `sm` upward.
- Dynamic filesystem reads that made Turbopack trace the whole repo are marked `turbopackIgnore`. Behaviour of those reads is unchanged.
- Audit builds can use `NEXT_DIST_DIR` so they do not share `.next` with `next dev`. `.next-audit/` is gitignored.

## 8. Files modified

- `apps/platform/next.config.ts`
- `apps/platform/eslint.config.mjs`
- `apps/platform/src/app/layout.tsx`
- `apps/platform/src/app/globals.css`
- `apps/platform/src/app/(app)/layout.tsx`
- `apps/platform/src/app/(app)/page.tsx`
- `apps/platform/src/app/sign-in/page.tsx`
- `apps/platform/src/app/api/auth/[...nextauth]/route.ts`
- `apps/platform/src/lib/auth.ts`
- `apps/platform/src/lib/site-view.ts`
- `apps/platform/src/lib/storage.ts`
- `apps/platform/src/components/shell/Shell.tsx`
- `apps/platform/src/components/shell/TopBar.tsx`
- `apps/platform/src/components/ui/Notice.tsx`
- `apps/platform/src/components/ui/Table.tsx`
- `apps/platform/src/components/modules/LaunchDashboard.tsx`
- `apps/platform/src/components/modules/SiteHeader.tsx`
- `apps/platform/src/components/modules/ClientPicker.tsx`
- `packages/db/src/services/reports.ts`
- `packages/db/src/env.ts`
- `.gitignore`
- `apps/platform/src/components/modules/SignInErrorProbe.tsx` (removed)

## 9. Before and after

The score columns are Lighthouse performance. Status is Pass when performance is at least 90, accessibility at least 95, Best Practices at least 95, LCP at most 2.5s, CLS at most 0.1, and TBT at most 200ms. SEO is excluded from that status for the reason in section 1.

These Lighthouse numbers are from the production build that contained the contrast, heading, favicon, debug-request and analytics-query fixes. The overflow containment landed in a later build of the same day. That later build was checked in Chrome at 390px and 1280px (section 11), not with a second full Lighthouse sweep.

| Page | Mobile before | Mobile after | Desktop before | Desktop after | Status |
| --- | --- | --- | --- | --- | --- |
| Dashboard | 100 | 100 | 100 | 100 | Pass |
| Clients | 98 | 98 | 100 | 100 | Pass |
| Analytics | 100 | 100 | 100 | 100 | Pass |
| SEO | 100 | 100 | 100 | 100 | Pass |
| Blog | 98 | 98 | 100 | 100 | Pass |
| Leads and forms | 100 | 99 | 100 | 100 | Pass |
| Reports | 100 | 100 | 100 | 100 | Pass |
| Settings | 100 | 100 | 100 | 100 | Pass |
| Admin | 100 | 100 | 100 | 100 | Pass |
| Sign-in | 100 | 100 | 100 | 100 | Pass |

Accessibility and Best Practices after the same run: 100 / 100 on every page above, both mobile and desktop. Before, accessibility was 96 on Dashboard and 98 on SEO, Blog and Leads. Best Practices was 96 everywhere.

### Core Web Vitals and diagnostics

LCP and TBT are milliseconds. CLS is unitless. INP is not listed because it was not measured.

| Page | Form | LCP before | LCP after | CLS | TBT before | TBT after | TTFB before | TTFB after |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Dashboard | Mobile | 637 | 658 | 0 | 13 | 12 | 455 | 337 |
| Dashboard | Desktop | 184 | 194 | 0 | 0 | 9 | 395 | 341 |
| Clients | Mobile | 2380 | 2417 | 0 | 54 | 32 | 291 | 270 |
| Clients | Desktop | 647 | 627 | 0 | 0 | 0 | 195 | 318 |
| Analytics | Mobile | 776 | 628 | 0 | 35 | 27 | 835 | 432 |
| Analytics | Desktop | 185 | 188 | 0 | 0 | 0 | 551 | 460 |
| SEO | Mobile | 880 | 662 | 0 | 38 | 33 | 377 | 474 |
| SEO | Desktop | 231 | 199 | 0 | 16 | 0 | 394 | 472 |
| Blog | Mobile | 2417 | 2389 | 0 | 33 | 25 | 254 | 315 |
| Blog | Desktop | 597 | 622 | 0 | 9 | 0 | 422 | 295 |
| Leads and forms | Mobile | 620 | 635 | 0 | 10 | 130 | 199 | 358 |
| Leads and forms | Desktop | 190 | 190 | 0 | 0 | 0 | 372 | 400 |
| Reports | Mobile | 630 | 801 | 0 | 12 | 26 | 200 | 375 |
| Reports | Desktop | 194 | 184 | 0 | 0 | 0 | 326 | 352 |
| Settings | Mobile | 627 | 788 | 0 | 11 | 27 | 447 | 941 |
| Settings | Desktop | 194 | 246 | 0 | 0 | 8 | 428 | 390 |
| Admin | Mobile | 789 | 729 | 0 | 10 | 69 | 271 | 596 |
| Admin | Desktop | 183 | 188 | 0 | 0 | 0 | 332 | 334 |
| Sign-in | Mobile | 663 | 662 | 0 | 18 | 21 | 21 | 30 |
| Sign-in | Desktop | 203 | 180 | 0 | 0 | 0 | 121 | 26 |

CLS was 0 before and after for every row. The Leads mobile TBT increase and the Settings mobile TTFB increase did not drop those pages below the targets. They were single samples against a remote database.

## 10. Outstanding issues

- SEO will stay near 60 while `noindex` is set. Removing it would publish the internal app to search engines.
- Clients and Blog mobile LCP sit just under 2.5s in simulated slow-4G conditions. On Clients the LCP element was the directory description, not an image. Another run can move that number across the line without a code change.
- Back/forward cache remains disabled by `no-store`.
- Unused and legacy JavaScript warnings remain and do not decide the performance score.
- Field INP is unknown until the app is on a public origin with enough Chrome traffic. Do not treat the lab TBT figures as INP.
- One client with more than 20,000 current snapshot rows would have older rows omitted from analytics period matching. The previous cap was 50,000 rows across all clients. The volumes described in `docs/PERFORMANCE.md` are well below 20,000 per client.
- The Node `pg` client warns that `sslmode=require` is currently treated as `verify-full`. The connection succeeded. The connection string was not changed.

## 11. Recommendations

- Keep authenticated HTML uncached. If analytics snapshots grow, page the query by period instead of raising the row cap.
- When the app has a public hostname, collect field INP from CrUX or the Vercel analytics product. Do not add a third-party tag only to manufacture a lab score.
- The six `no-html-link-for-pages` warnings on the “new” forms, and the `<img>` warnings for the SVG brand mark, were already present. They are not user-visible failures.
- If the development sign-in form still returns 500, restart `npm run dev` so it drops any pooled connection from before the database was reachable.

## 12. QA and regression results

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm run lint -w @clinic-genie/platform` | Passed with 0 errors and 10 existing warnings |
| `npm test -w @clinic-genie/db -- test/pure.test.ts` | 7 passed |
| Platform unit tests for forms, analytics board, SEO workspace and article blocks | 26 passed |
| Database integration tests | Not run. Several tests commit rows, and the configured database is the shared remote database |
| `e2e/sign-in.spec.ts` | Not run. It targets the development server, which refused the sign-in form with a database error during this audit |
| Production build | Passed. The Turbopack whole-repo trace warnings are gone |
| Authenticated production pages | 200, correct document title, no console errors |
| Favicon | 200, `image/svg+xml` |
| Sidebar toggle | Sets `gw-nav=closed`, then `gw-nav=open` |
| Mobile 390px overflow (`scrollWidth - clientWidth`) | 0 on Dashboard, Clients, Analytics, SEO, Blog and Leads after the final build. Desktop Dashboard overflow was 0 |
| Mobile menu button | Present |
| Desktop “Add new” label | Still visible |

## Commands

Production build beside the development server:

```bash
NEXT_DIST_DIR=.next-audit npm run build -w @clinic-genie/platform
cd apps/platform && NEXT_DIST_DIR=.next-audit npx next start -H 127.0.0.1 -p 3401
```

Lighthouse, once per page, with a cookie header file for signed-in routes and `--preset=desktop` for the desktop pass:

```bash
npx --yes lighthouse http://127.0.0.1:3401/ \
  --chrome-path="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --only-categories=performance,accessibility,best-practices,seo \
  --output=json --quiet \
  --chrome-flags="--headless=new --disable-gpu --no-first-run" \
  --extra-headers=/tmp/lh-after/headers.json
```

Sign-in was measured without the cookie header. Raw JSON was left in the local temp directory and is not committed.
