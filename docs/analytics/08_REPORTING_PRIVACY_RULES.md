# Reporting, attribution and privacy rules

## Dates and comparisons
Default last 30 completed website-local days, preserving the screenshots’ 30-day convention and existing saved user selections. Retain 28 days as an optional preset. UI ranges inclusive; adapter converts API-specific boundaries. Keep GA4 property timezone, Wix query timezone and GSC Pacific dates visible. Never shift aggregated GSC daily rows into Singapore dates as if raw timestamps were available. Organic search panels therefore have a separately labelled date basis. Current-day and this-month-to-date reports are partial. Comparisons must use equivalent elapsed periods or display the mismatch.

Previous equal-length period: immediately preceding N completed dates. Year comparison maps dates explicitly around leap day. Percentage change = (current - previous) / previous * 100; previous=0 yields New activity when current>0 and no percentage, both zero yields no change. Missing previous data yields Unavailable. Rate differences use percentage points; position change uses numeric positions and explains lower is generally better. Round presentation only, normally whole event counts, one decimal percentage, seconds/duration clearly labelled.

## Totals and provenance
Do not sum distinct users across days, pages, devices, providers or clinics. Session counts across page groups can overlap. Keep separate provider-derived aggregate totals. Use compatible numerators/denominators for rates and weighted means. Cross-clinic reporting is not part of these three single-website views. Other/Unknown are explicit categories; top five is a preview with a labelled full total, not the whole population. Suppression and truncation travel into charts and exports.

Provider series may disagree because definitions, consent, bots, timezone, attribution, filters or processing differ. Show same-context reconciliation evidence; never silently scale one source to match another. Manual refresh cannot make a provider process data sooner. External search statistics are not website realtime data.

## Attribution
Acquisition reports use provider session attribution. Backend enquiries use approved safe captured attribution with an explicit rule: baseline is submission-session attribution only. No cross-device matching, last-known channel imputation or patient-level join. If the existing implementation has an approved different window, preserve it and version the rule rather than overwriting it. Unknown remains Unknown. Historic channel mapping uses versioned rules; preserve raw safe source/medium categories. Never infer Google Ads enquiries from all-site WhatsApp/phone counts.

## Instrumentation and deduplication
Approved events: phone_click, whatsapp_click, email_click, booking_link_click, cta_click, form_start, form_submit_success and optional consented content events. Inspect current event names first and map existing equivalents rather than renaming destructively. Prefer one central delegated click handler or existing component instrumentation; exclude nested double triggers. Contact clicks use the specific event, with generic CTA counts reported separately. SPA pageviews fire once per intended navigation; verify existing GoogleAnalyticsPageViews component if present.

Form start uses first meaningful interaction per attempt. Durable enquiry creation remains the authoritative internal count. Notification retries do not emit new lead or success events. A browser refresh/retry must not resend an already acknowledged success. Use the existing idempotency mechanism; any consent-dependent GA4 event outbox requires a distinct authorised ticket and must not transmit patient data. Delivery to analytics is not guaranteed exactly once. Do not claim replay safety solely because GA4 receives an event_id.

## Privacy by design
Keep names, email, phone numbers, symptoms, free-text messages, patient IDs and contact-bearing URLs out of events, exports, provider queries, logs and annotations. Store safe route identifiers or approved normalised paths, not query strings/fragments. Sanitize/refuse sensitive dynamic path segments and arbitrary UTM values; allowlisted keys alone do not make their values safe. Strip tel/mailto/WhatsApp payloads; report action type and CTA ID instead. Geo is coarse provider reporting, never exact patient residence.

Use existing consent implementation and approved policy. Test consent denied/granted/revoked, blockers and disabled tracking. Never bypass consent with Measurement Protocol or backend events. A tracking activation date applies to every feature; no retrospective success claim. Aggregate analytics views do not grant lead-detail access.

## Retention proposal requiring owner decision before collection
Keep sanitised aggregate report snapshots for a proposed 24 months, sync diagnostics 90 days, import source files 30 days, temporary exports 24 hours, pseudonymous raw journey events at most 30 days if separately enabled. These are proposed operational settings, not asserted legal requirements or existing approvals. Enquiry retention remains governed by its existing policy. Configure deletion and backup expiry with the selected provider and clinic owner. No new raw journey collection until its purpose/retention are approved.

## Export/reporting
CSV is the initial export. Reuse existing PDF/report export if already implemented; no new PDF engine required. Add source/property label, dates, timezone, filters, comparison basis, definitions/version, synced-at, measured-through, coverage, tracking start and quality notes in export metadata/companion section. Protect CSV cells beginning with formula control characters. Preserve UTF-8 and UK English. Export is an immutable snapshot reference, so later sync changes do not silently alter a previously generated report.

Reporting notes explain observed changes without claiming causation or medical outcomes. Do not invent benchmarks, score grades, revenue or attributed patients. Not connected, Not tracked, Partial, Unavailable and a genuine measured zero are distinct states.
