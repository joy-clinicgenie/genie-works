# Performance audit — executive summary

Date: 3 November 2026 · Platform: Genie Works · Prepared for: management review
Full detail: `CG_LATENCY_AUDIT_REPORT.md` · This was an **audit only — nothing was changed**

---

## Overall assessment

**The platform is well built and mostly fast. Two pages are slow, and they are slow for one specific, fixable reason.**

Of 70 pages, 62 load their data comfortably inside the 800-millisecond target. Two miss it badly: the **Dashboard** and the **Enquiries** page. Both miss it because they fetch enquiry data live from Wix while the page is being built, and Wix takes between half a second and a full second to answer each request.

Three things we expected to find problems in turned out to be fine, and that is worth stating plainly because it means effort can be concentrated:

- **The software framework is not slow.** Pages that do not touch the database respond in 2–6 milliseconds.
- **The amount of code sent to the browser is small** — about 330 KB compressed, with no heavy charting or table libraries.
- **The database is correctly indexed and correctly connected.** No missing index was found, and earlier optimisation work from October and November is holding up.

What limits speed is not any single slow query. It is **how many separate trips to the database a page makes**, and whether it waits on an outside service while doing so. Each database trip costs about 8.5 milliseconds. The heaviest pages make 15 to 30 of them in a row.

One important caveat on confidence: we could measure the server side thoroughly but **could not measure what staff actually see in the browser** — load times, visual stability, responsiveness to clicks. That is explained under "What we could not measure" below, and fixing it is a recommendation in its own right.

---

## The five most significant bottlenecks

### 1. Live Wix enquiry lookups block the two busiest pages

Measured Wix response times: **731 ms** to authenticate, **526 ms** to fetch one page of form submissions, **1,013 ms** to fetch a form's field definitions. The Dashboard does this across 7 connected websites; the Enquiries page across 8. Nothing appears on screen until it all finishes.

Estimated cost: **0.6 to 1.6 seconds added to every load** of those two pages — more on a freshly started server.

There is also no way to switch these lookups off if Wix slows down or has an outage.

### 2. Nothing appears on screen until everything is ready

The platform has no "progressive loading" anywhere — no partial rendering, and loading indicators on only 2 of 70 pages. On the Dashboard, four pieces of information load at the same time; three are fast local reads, one is the slow Wix lookup. All four wait for the slowest.

Showing the fast three immediately would take the Dashboard's first visible content from roughly **1.3 seconds to roughly 150 milliseconds**, with enquiry numbers filling in a moment later. **This is the single largest improvement to how fast the platform feels, and it changes no data and carries little risk.**

### 3. Analytics pages make 15 database trips where 4 to 6 would do

Every analytics report is fetched with two database queries instead of one, and seven reports are fetched one after another. Measured: **174 milliseconds** for that one step. Combining them would recover roughly **90 to 110 milliseconds** per analytics page.

### 4. Report generation makes 20 to 28 database trips

Measured at **214 milliseconds** for a single-period report and **265 milliseconds** when a comparison period is included. This is the slowest staff action we were able to measure. Grouping the queries would recover roughly **170 to 190 milliseconds**.

### 5. The client list is loaded twice on most pages

The sidebar loads the client list, then the page loads it again. Measured waste: **34 milliseconds** on the Dashboard and on every SEO page. **This is the cheapest fix in the entire audit** — the technique needed is already used elsewhere in the same codebase for user permissions.

---

## One security issue found, outside the performance scope

While reviewing the background sync job we found **leftover debugging code that was committed to the repository**. It sends information about the system's secret keys — specifically their length, and whether a caller's key matches that length — to a local address, and it does so *before* checking whether the caller is authorised.

In production nothing is listening at that address, so no data is believed to have left the system. But it should not be there, an unauthorised caller can use it to probe secret length, and **removing it is a three-line deletion.**

We did not remove it, because the brief for this audit was explicitly "audit only, do not implement fixes". **We recommend it be the first thing fixed, ahead of all performance work.**

---

## Most affected modules

| Module | State | Why |
| --- | --- | --- |
| **Leads & Forms** (Enquiries) | Worst affected | Live Wix lookups; every filter change re-runs them; list pagination is switched off whenever a Wix site is connected |
| **Agency Overview** (Dashboard) | Second worst | Live Wix lookups, with nothing shown until they finish |
| **Reports** | Slowest single action | 20–28 database trips per report |
| **Website Analytics** | Moderate | 15 database trips; two of the four pages missed an earlier optimisation |
| **SEO** | Moderate | 11 database trips plus a duplicate client list load on every page |
| **Blogs** | One specific defect | Each image on a page costs two database trips plus an audit record, every single time it is viewed, with no browser caching |
| **Clients, Tasks, Approvals, Issues, Medical Review, Google Ads, Timeline, Settings, Admin** | Healthy | Single efficient database transaction per page. No work needed. |

---

## Impact on staff productivity

Honest framing: **the measured delays are in the hundreds of milliseconds to roughly one and a half seconds.** This is not a platform that times out or fails. It is a platform where the two most frequently used pages feel sluggish, and where that sluggishness is concentrated exactly where staff spend most of their day.

- Opening the Dashboard or the Enquiries list: a **noticeable pause of around one second**, with a blank area until it resolves.
- Filtering enquiries: **each filter change repeats the full pause**, because filtering is a fresh page load that redoes the Wix lookups. This is the most irritating interaction in the platform.
- Analytics, SEO and report pages: **a quarter of a second**, which is on the edge of perceptible.
- Everything else: fast.

Two risks worth flagging to management because they are about the future, not today:

1. **The platform has very little real data in it yet.** Several pages are written to fetch everything and then filter in memory — up to 20,000 analytics records, or the entire enquiry list. These cost nothing now because those tables are nearly empty. They will become the dominant cost as real data accumulates. We have listed them so they can be fixed before they bite, not after.
2. **The database connection limit is 8 simultaneous connections**, while the heaviest pages hold one for a quarter of a second. On that arithmetic, roughly **9 staff loading an analytics page at the same time would begin queuing.** We could not test this and it may be the most likely cause of complaints that do not match our measurements.

---

## Recommended order of improvements

| Order | Work | Effect | Effort | Risk |
| --- | --- | --- | --- | --- |
| **1** | Delete the committed debug code | Closes a security gap | Minutes | None |
| **2** | Six small fixes: duplicate client list, duplicate database query, two analytics pages, a redundant redirect page, image dimensions | ~50 ms off several pages | ~1 day | Very low |
| **3** | **Set up a proper test environment with realistic data** | Makes everything below verifiable | ~2–3 days | Low |
| **4** | **Show the Dashboard progressively** | Biggest felt improvement: ~1.3 s → ~150 ms | ~2 days | Low |
| **5** | Add an off switch for Wix lookups | Protects against a Wix outage | ~0.5 day | Low |
| **6** | Combine the analytics database queries | ~100 ms off analytics pages | ~2 days | Low |
| **7** | Establish browser-side performance measurement | First real view of what staff experience | ~2–3 days | Low |
| **8** | Combine the report queries | ~180 ms off report generation | ~3 days | Medium |
| **9** | **Move Wix enquiry data off the page-load path** | ~0.6–1.6 s off the two slow pages | ~1–2 weeks | Medium |
| **10** | Restore proper pagination on the enquiries list | Prevents future degradation | Included in 9 | Medium |

Items 1 to 7 are roughly **two weeks of work for a measurable improvement across the platform**. Item 9 is the structural fix and the largest single win, but it should come after item 3 so the result can actually be verified, and it needs a decision recorded first (see below).

---

## Decisions management needs to make

Three items are not purely technical and should be decided before the work starts:

1. **How fresh must enquiry data be?** Moving Wix data off the page-load path means reading a recently synced copy rather than a live lookup. If staff need live-to-the-second enquiry counts, the fix is constrained and the gain is smaller. If a 15-minute or hourly sync is acceptable, the full gain is available. **We recommend asking the staff who use the page.**
2. **Should every single image view be recorded in the audit trail?** At present, loading a blog article with ten images writes ten audit records, every time anyone views it. Reducing this to one record per article view would cut a lot of write activity, but the audit trail is a compliance artefact and the change should be recorded as a formal decision rather than treated as an optimisation.
3. **File storage needs to move to a cloud service.** Evidence files and blog images are currently read from the server's local disk, which does not persist on the hosting platform. This is a correctness problem rather than a speed problem, it was already known to the team, and it involves a new paid supplier — so it needs escalation and a budget decision, not a ticket.

---

## Risks requiring attention

| Risk | Severity | Note |
| --- | --- | --- |
| Committed debug code leaking secret-key metadata | **High** | Three-line fix. Do it first. |
| No performance monitoring of any kind installed | **High** | We cannot currently detect a performance regression, confirm an improvement, or see what staff actually experience. This is a gap against the platform's own monitoring specification. |
| Dependence on Wix with no off switch and no cached fallback | **Medium** | A Wix outage or slowdown degrades the two busiest pages, with a worst case the code permits of 75 seconds per connected site. |
| Pages that fetch everything and filter in memory | **Medium** | Harmless today, expensive later. Fix before data volume makes them visible. |
| Eight simultaneous database connections | **Medium** | Untested. Likely the first thing to break under concurrent use. |
| File storage on a non-persistent disk | **Medium** | Known. Affects correctness in production, not speed. |
| Report query batching | **Low–Medium** | Report figures are permanent records; any change must produce identical numbers. Existing tests must gate it. |

---

## What we could not measure, and why it matters

We measured the server thoroughly: database timing, exact query counts per page, Wix response times, framework overhead, and browser download size. **We could not measure anything from inside a browser as a signed-in user** — page load time as experienced, visual stability, click responsiveness, or navigation speed.

The reason is that a signed-in session could not be created safely in this environment: the development sign-in shortcut is correctly disabled because the local setup points at the shared live database, and creating a session directly would have meant writing to that shared database, which we declined to do.

Rather than estimate those numbers, we have marked them as not measured throughout. **There are no invented figures anywhere in this audit.**

The fix is recommendation 3 above — a properly isolated test environment with realistic data. The tooling for it already exists in the codebase and is unused. Once it is running, every figure in this audit becomes verifiable, and the platform gains the ability to detect performance regressions before staff report them.

---

## In one paragraph

Genie Works is architecturally sound and 62 of its 70 pages are fast. The Dashboard and Enquiries pages are roughly a second slower than they should be, for one identifiable reason: they wait on live Wix lookups while the page is being assembled. A day of small fixes plus two days of progressive-loading work would make the platform feel substantially faster without changing any data. One security defect — committed debugging code that exposes information about secret keys — should be deleted immediately. And the platform currently has no performance monitoring at all, which means nobody can tell whether any of this is getting better or worse; closing that gap is the recommendation with the longest-lasting value.
