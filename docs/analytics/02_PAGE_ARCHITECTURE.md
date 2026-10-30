# Final proposed page architecture

## Navigation
Analytics has exactly three staff-facing destinations: Overview, Traffic, Behaviour. Reuse existing route paths. If absent, suggested paths are /analytics, /analytics/traffic and /analytics/behaviour. Detail reports are tabs or drawers within these pages, not more sidebar entries. Connection configuration remains in authorised Settings with an Analytics shortcut.

## Shared header
Clinic > website > environment context; page title; last 30 completed days by default, preserving the existing 30-day selection and saved user choices; comparison to previous equal-length period; Refresh data; Export; Data sources. Presets: 7, 28, 30, 90 days, this month, last month, custom. Today is opt-in and visibly provisional. Show source badge, timezone, measured-through date, last successful sync and partial-coverage warnings. Retain the selected clinic/date/source across the three pages. Clinic changes clear dependent filters and cached data immediately.

One selected traffic provider applies to all comparable traffic metrics. Source changes are explicit and re-query the whole page. A source badge on each panel identifies exceptions such as GSC or stored enquiries. Do not silently switch a failed provider to another source.

## Overview: what happened and where to investigate
| Order | Section | Contents and function |
| --- | --- | --- |
| 1 | Health strip | Connection issue, stale/partial period or tracking activation warning; hidden when healthy |
| 2 | Four KPIs | Site sessions; unique visitors (Wix) or total users (GA4); contact clicks; tracked successful form submissions. These preserve the four existing large cards; page views moves to Behaviour and its Overview page preview. Value, change, source and definition |
| 3 | Traffic trend | Daily sessions line and optional prior-period overlay. Metric toggle for page views/users; users are daily counts, not additive |
| 4 | Top traffic sources | Top five channels with sessions and share; View Traffic opens source tab |
| 5 | Top pages | Top five paths, page title, views; View Behaviour opens page report |
| 6 | Actions and enquiries | Contact types, stored enquiries, confirmed bookings only where verified; separate labels and sources |
| 7 | Organic search, conditional | GSC clicks/impressions and link to Traffic > Organic search; independent reporting timezone/date |

Arrange wide trend above compact summary panels using existing grid primitives. No browser/OS detail or full query table here. If contact tracking is not set up, the contact KPI says Not tracked with a setup link; do not substitute an unrelated metric automatically. If an outcome connector is absent, show Not connected rather than zero bookings.

## Traffic: who arrived and how
| Tab | Sections and table columns | Actions |
| --- | --- | --- |
| Acquisition, default | Sessions/users strip; genuine daily trend or recorded-period comparison; weekday average panel; channel ranking; source/medium table: channel, source, medium, sessions, users when compatible, session share | Filter channel/source; daily breakdown; campaign report |
| Campaigns | Campaign, source, medium, sessions; attribution coverage and unknown bucket | Drill into landing pages only where joint query supported |
| Landing pages | Entry path/title, sessions, compatible users, engagement rate if available | Open page drawer; link to Behaviour with path filter |
| Audience | Country table; device table and existing donut; new/returning audience report with validated source semantics; optional city/browser/OS subtabs, capability-gated | Filter supported dimensions; source explanation |
| Organic search | GSC clicks/impressions/CTR/average position; search trend; Queries and Pages tables; country/device filters | Query/page detail; link to existing SEO page |

Acquisition and Campaigns use session acquisition, not first-user acquisition. Keep the distinction in tooltips and exports. Search Console does not respond to GA4 acquisition filters. Disable those controls in Organic search and show its own applied filters.

## Behaviour: what visitors did
| Tab | Sections and table columns | Actions |
| --- | --- | --- |
| Pages, default | Existing duration/depth/bounce strip with verified source-specific labels; views and engagement trend; searchable page rankings with Page views, Button clicks, Average time and Exit rate controls; page table: path/title, views, compatible users and supported diagnostics | Search, sort, filter page type; detail drawer |
| Interactions | Contact action counts; button/CTA table: action type, stable CTA ID, page, location, event count | Filter type/page; tracking diagnostics |
| Forms and enquiries | Form views, starts, measured successes, stored enquiries, failure attempts and cohort completion in separate panels; source/location controls and authorised aggregate form table | Explain measurement gap; link to existing Enquiries module if permitted |
| Content | Blog view report using known page classification; post table: title, path, views, tracked scrolls | Filter content type; links to existing Blog module |
| Journeys, conditional | Existing navigation-flow report plus ordered form funnel only if a verified sequence backend already exists or consented event sequence/suitable provider reporting can supply it | Select funnel; show steps, count unit, window and exclusions |

Preserve an existing verified Journeys/flow implementation. Otherwise Journeys is explicitly unavailable until its measurement contract passes; never replace it with invented data. Side-by-side aggregate clicks and enquiries are not an ordered funnel. Do not label 90% scroll as read/completed. Contact interactions do not establish a connected call or WhatsApp conversation.

## Detail drawer
Title, normalised path, historical title label, source/date/coverage, trend, supported breakdowns, events and reporting notes. Only display combinations actually collected or queryable. Opening a public page strips tracking and patient-bearing query parameters, validates allowed host and uses a new tab safely. Drawer deep link preserves filters; Close restores focus.


## Screenshot-based final composition
Keep the existing three top tabs instead of creating three new sidebar pages. Apply UK English Behaviour in visible labels; existing `/behavior` route, if present, remains compatible. Acquisition keeps the current large trend and source/weekday side panels. Audience owns the two existing visitor/device donuts; an optional compact device preview may remain on Acquisition with a link to full detail. Behaviour Pages keeps its existing searchable metric-selector ranking; Interactions owns Top clicks. Journeys owns the existing navigation-flow visual and page selector. Forms and enquiries keeps the form-source/location switches. Nested tabs replace the long stack of Overview details.

On Overview use: health strip; existing four main cards; main trend plus compact sources; compact contact breakdown alongside distinct stored enquiries; top-page preview; conditional small search summary. Remove the duplicate six-card stats strip and repeated contact/funnel/form/device/search/connection tables from the Overview body only after their detail destinations work. Page views and post views remain available through the Behaviour page; all counts retain their definitions/source.
