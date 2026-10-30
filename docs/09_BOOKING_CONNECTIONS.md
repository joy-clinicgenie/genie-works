# Booking connections

## Modes
ENQUIRY: shared appointment request form; clinic confirms manually. Wording must say request received, never appointment confirmed.

EXTERNAL: clinic-approved booking link or embed. Confirm exact provider/location destination, mobile/accessibility behaviour, privacy implications and fallback. Keep a visible alternative if embedding is blocked or the provider is unavailable.

API INTEGRATION: outside baseline. Requires provider capability review, separate ticket, authentication, privacy review and tests covering availability, cancellation, rescheduling and failures.

## Configuration
Store site, mode, provider reference, approved HTTPS destination, clinic contact fallback and owner. Restrict edits and log changes. Avoid arbitrary redirects: validate approved destinations server-side. No provider tokens in public configuration.

## Discovery
Who owns the calendar? Existing practice-management provider? Supported link/embed/API? Test access? Doctor/location/timezone rules? Reminder ownership? What information transfers, and where is it retained?

## Acceptance
Demonstrate enquiry and external modes with synthetic data. Correct clinic destination, usable mobile path and failure fallback. A booking-link click is not a booking. Only a verified provider-confirmed event can count as confirmed booking. Do not delay an enquiry pilot to build a custom calendar.
