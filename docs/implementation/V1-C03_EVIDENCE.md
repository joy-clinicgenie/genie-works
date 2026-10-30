# V1-C03 evidence — website consumers

Date: 2026-10-28. No site was deployed and no live website was changed. The original audit and the baseline requirements CSV were not edited.

## What is in place

`packages/db/src/testing/consumers.ts` separates native and Wix capabilities into testable, blocked and excluded. Blocked and excluded rows cannot count as passed. `npm run consumers:check` prints that matrix and the representative native paths.

The native read contract is the existing platform routes:

- `GET /api/public/seo/[websiteId]`
- `GET /api/public/blog/[websiteId]`

Both require the site bearer token. On 2026-10-28 an unauthenticated request to each route on `http://127.0.0.1:3400` returned HTTP 404. That is an authentication probe, not a publication check.

Wix Blog publishing is excluded. Blog Performance is excluded. Native Blog does not need Wix credentials.

## What is not claimed

The sibling site under `~/vsc/clinic-demo-a` does not call these Genie Works routes. No protected staging site was created. No non-production Wix site was available. A listed path such as `/blog/routine-skin-care-note` is a consumer target, not a published article produced by this task.

## Still blocked

- A native staging consumer that calls the SEO and Blog read APIs with a real site token
- A non-production Wix site for supported analytics and SEO operations
- Publication and sitemap acceptance, which stay on the Blog and SEO implementation tickets
