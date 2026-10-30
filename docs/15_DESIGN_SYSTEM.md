# Clinic Genie admin design system

## Status and scope
Confirmed brand anchor: pale aqua #DDF7F8 from the user's supplied direction. Supporting colours below are proposed interface tokens, not a verified corporate brand manual. The previous dashboard mock-ups are visual references only; their production-tracking screens and illustrative facts are not requirements.

| Token | Value | Use |
| --- | --- | --- |
| brand-pale | #DDF7F8 | Navigation and restrained section backgrounds |
| action | #136C72 | Primary actions, links and focus accents |
| text | #173C40 | Main text |
| canvas | #F6FBFC | App background |
| surface | #FFFFFF | Panels, tables and forms |
| border | #D7E7E9 | Quiet separation |

Use Helvetica/Arial/system sans-serif fallback. Base 16px; compact table text may be 14px. Use consistent spacing on a 4/8px scale, modest corners, readable density and minimal shadows. No decorative gradients or invented corporate logo. Use a text placeholder until the approved vector logo is supplied.

## Phase 1 shell
Navigation: Websites, Enquiries, Notification status, Settings. Add future modules only when implemented. Header includes authorised site context and user menu. Clearly mark staging and synthetic data.

## Interaction rules
Visible labels and keyboard focus; error text next to fields; adequate touch targets; contrast checked before acceptance. Status uses words/icons as well as colour. Distinguish 'Enquiry received', 'Notification pending' and 'Appointment confirmed'. Show honest failure and empty states. Avoid technical diagnostics in patient-facing text.

Public clinic sites retain their own approved branding. Review responsive and accessible behaviour on both public pages and admin screens.
