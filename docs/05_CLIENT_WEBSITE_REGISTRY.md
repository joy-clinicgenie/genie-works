# Client and website registry

## Purpose
Create one authoritative mapping between clinic, websites, active forms, approved recipients, staff access and booking configuration. This replaces the old full-dashboard specification in the critical path.

## Inputs and behaviour
Create a client with accountable owner and status. Add its website domain, staging URL, platform, deployment reference, environment and booking mode. Attach approved form definitions and recipient references. Validate relationships on the server. Keep sender/provider secrets in managed secret storage; configuration stores references.

Separate site deployment configuration from staff permissions. The public site uses only safe identifiers. A domain or origin check alone does not prove a caller is authentic.

## Minimal screens
- Client/site list with status and owner.
- Site detail showing domain, environment, active form versions, recipient reference, booking mode and setup checklist.
- Privileged edit action with change summary and audit event.

Do not add SEO scores, agency workload dashboards or broad CRM features now.

## Acceptance
Create two client/site pairs; route each form to its own clinic. Invalid site/form combinations fail. Recipient changes require privileged access and are audited. Inactive forms reject new submissions. Archiving a site does not silently delete stored leads. Staff can identify the setup owner and unresolved onboarding decisions.
