# Staff access and client isolation

The following is a proposed minimal role matrix to confirm during discovery. Use managed authentication; no custom password or session implementation.

| Action | Platform admin | Assigned clinic operator | Public visitor |
| --- | --- | --- | --- |
| View approved public pages | Yes | Yes | Yes |
| Submit active public form | Yes | Yes | Yes |
| View leads | Explicit authorised client scope | Assigned client scope | No |
| Update lead status | Explicit authorised client scope | Assigned client scope | No |
| Export leads | Separate export permission | Only if explicitly granted | No |
| Change recipients/site configuration | Privileged permission with audit | No by default | No |
| Manage memberships | Privileged permission with audit | No | No |

Membership contains user, client, role and active state. Resolve access from authenticated server-side membership on every request. Scope database queries before reading records; check website, form and submission relationship consistency. Direct database access, if allowed, requires corresponding database policies. Elevated service credentials must never bypass application authorisation accidentally.

Do not grant every admin unrestricted patient-data access automatically. Explicitly document privileged scope, exports and break-glass access if adopted. Disable revoked users promptly and account for active sessions.

Acceptance: two separately authenticated users prove isolation through direct API requests, guessed record IDs, lists, exports and status updates. Public callers cannot read submissions. Expired/revoked sessions fail. Normal users cannot edit audit evidence. Record permission changes, recipient changes and privileged exports without copying sensitive values into logs.
