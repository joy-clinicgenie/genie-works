# Analytics and conversions

## Phase 1
Configure the correct clinic's GA4 web stream and verify GSC ownership. Consolidated reporting is Phase 3. Ads conversion setup is conditional on actual clinic advertising requirements.

| Event | Trigger | Meaning |
| --- | --- | --- |
| form_start | Defined first meaningful form interaction | Started form, not a lead |
| form_submit_success | Server confirms durable accepted submission | Stored enquiry, not confirmed appointment |
| booking_link_click | Approved external booking CTA clicked | Outbound intent only |
| provider-confirmed booking | Verified provider confirmation, if integration exists | Confirmed booking under documented definition |

Define final event names, allowed parameters, consent handling, retry dedupe and conversion mapping before implementation. Keep name, phone, email, symptoms, message text and raw contact-bearing URLs out of analytics and debugging evidence. Sanitize query strings/page paths and arbitrary custom parameters.

## Attribution
Capture only approved UTM/referrer fields. Define attribution window and rules. Unknown source remains unknown. Exclude synthetic tests from production reporting where feasible; never quietly count them as patient enquiries.

## Acceptance
GA4 debug evidence matches intended events. Failed saves do not generate success events. Replays do not inflate conversions. Ads/GA4 imports do not double-count the same configured goal. Consent behaviour is tested. Source differences are documented; analytics totals need not exactly equal durable lead counts because of consent, blockers or measurement limits.
