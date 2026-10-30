# Shared data model

Implement versioned migrations after discovery confirms the database. Field names below are minimum concepts; define exact types and constraints in migration review.

| Entity | Minimum fields | Integrity rule |
| --- | --- | --- |
| clients | id, name, status, owner | Top-level tenant |
| websites | id, client_id, domain, environment, status, booking_mode | Exactly one client |
| staff_users / memberships | user_id, client_id, role, active | Unique active membership rule defined |
| forms | id, website_id, type, version, active, schema/config reference | Only approved fields/form versions accepted |
| submissions | id, form_id, website_id, created_at, status, limited contact fields, consent evidence, permitted attribution | Form and website must agree |
| notification_outbox | id, submission_id, recipient_ref, status, attempts, next_attempt_at, provider_message_id | Durable job tied to submission |
| booking_config | website_id, provider_type, approved_url/config_ref, fallback | No browser-visible provider secret |
| audit_events | actor, action, target, timestamp, outcome, safe metadata | Protected append-oriented history |
| seo_page_settings | client_id, website_id, page_path, title, description, canonical_path, indexable, updated_by | Unique page path per site; only connected public sites receive published values |
| seo_website_settings | website_id, client_id, Google Search Console HTML verification token | Token is published as a verification meta tag; ownership must still be confirmed in Search Console |
| seo_redirects | client_id, website_id, source_path, destination_path, active, actors, timestamps | Individual same-site 301 rules; unique active source and loop validation |
| seo_site_tokens | client_id, website_id, SHA-256 token hash, created_by, revoked_at | One active server-to-server credential per website; raw token shown once and never stored |
| seo_business_profiles | client_id, branch_name, Google profile URL/ID, setup_status, notes, updated_by | One reference per client branch; no Google API connection or claimed external verification |

SEO settings and redirect mutations are audited. SEO website tokens are visible only to trusted service-context code; staff receive a generated token once for deployment configuration. Branch-level Business Profile records are references and manually maintained setup statuses, not a connected integration.

Proposed supporting fields: site-scoped idempotency key and request digest, form version, privacy notice version, retention expiry, worker lease and notification event type. Document additions in the schema decision log.

## Transaction and uniqueness
Commit submission and initial outbox event in one transaction. Use a uniqueness constraint for website/form/idempotency key. Reject reuse with different payload; do not create multiple leads during concurrent retries. Define the key expiry and duplicate-handling policy before implementation.

## Isolation and lifecycle
Use foreign keys and validated parent relationships. Index client/site/date/status access paths. Avoid casual cascade deletion of leads or evidence. Define retention, deletion, backup expiry and export policy with the clinic. Keep production contact details out of fixtures, error logs and analytics.

## Changes
Every migration has an upgrade plan, compatibility assessment and rollback or forward-recovery plan. Test restores into an isolated environment. Do not call a database change reversible unless recovery is demonstrated.
