# V1-I01 evidence — native Blog core

Date: 2026-10-28. Local development only. Fictional seed records and one synthetic article. Nothing was published to production. The original audit and the baseline requirements CSV were not edited. BL-15–BL-20 stay deferred. Wix Blog publishing was not built.

## Decisions used

Source: D14 in `docs/DECISIONS.md` (28 Oct 2026).

- Admin and manager may view, edit, review, approve and publish for every client.
- A specialist member may view, edit and submit for review. A specialist cannot approve or publish.
- A reviewer member may view, review and approve. A reviewer cannot edit content or publish.
- Read-only members may view.
- D14 does not add a separate ban on an admin, manager or reviewer approving an article they authored. This ticket does not invent that ban.
- Publication is for native websites only. Wix Blog publishing is excluded and is not a blocker for the native workflow.
- A published article keeps one live revision. A later save becomes a draft and does not replace the live revision until that draft is approved and published.

## What was completed

- Articles belong to a client and a website. The website must belong to that client. A supplied client id is not treated as proof of ownership.
- Statuses are draft, in review, approved, published and archived. Transitions are enforced in the service and by `blog_articles_guard`.
- Content is `clinic-article-v1` blocks: headings, paragraphs, http(s) links, and images with alt text. Scripts and other URL schemes are rejected. SEO fields are title, description, slug, canonical path and the sitemap flag.
- Each save writes an immutable version with the editor and timestamp. A save must name the version it started from. A stale save is rejected and does not report success.
- Preview links last 72 hours, name one version, and can be revoked. They require a staff session for that client. The preview response is `noindex` and `private, no-store`. Preview paths are not in the sitemap.
- Publishing sets `live_version_id` to the approved version. The public read uses that version, not the working copy. Unpublishing clears it and keeps the version history.
- The local native consumer is served by the running platform at `GET /api/public/blog/[websiteId]`, `/page`, `/page/[slug]` and `/sitemap`, with the site token. A missing token, draft slug, or unpublished article is not found. Responses use `Cache-Control: private, no-store`.
- The service role used by those routes cannot select draft rows, revision history, approvals or preview tokens. It can execute `published_blog_articles` and `published_blog_media`, which return the live revision only when the token is valid, and only media named by that revision.
- Submit, approve, return, publish and unpublish write timeline events and audit metadata with the actor, time and version id. They do not copy the article body.

## Requirement evidence

| ID | Result | Evidence |
|---|---|---|
| BL-01 | Pass | List shows client and website. Creating an article checks the website against the stored client. Specialist B cannot read a Meridian article. |
| BL-02 | Pass | Category, author and reviewer are stored, shown and filterable. Search matches title or slug. |
| BL-03 | Pass | Draft, in review, approved, published and archived are enforced. A published working copy can return to draft while the live revision stays public. Archive is refused while a revision is live. |
| BL-04 | Pass | Block content is saved and still present after a new database transaction. The staff article page shows it through the version list after reload. |
| BL-05 | Pass | Images require alt text and are PNG, JPEG or WebP up to 1 MB. A stored image is not returned by the public media route unless the live revision names it. Staff media requires a client session. |
| BL-06 | Pass | Links must be http or https. `javascript:` is rejected. Category is required and kept on the version. |
| BL-07 | Pass | SEO title, description, slug, canonical path and sitemap flag are stored on the version and emitted on the public page. |
| BL-08 | Pass | Author and reviewer are assigned on the article. The list shows both. |
| BL-09 | Pass | Preview is scoped to one version, expires, and can be revoked. The public service role cannot open it. The page is excluded from indexing and shared cache. |
| BL-10 | Pass | Versions stay after unpublish. The check article kept version 1, “V1 blog check note”, and version 2, “Draft only check”, with editor and Singapore time. |
| BL-11 | Pass | Publish before approval is rejected. An approval of version 1 does not authorise version 2. The database trigger also requires an approval row for the version being published, and a native platform. |
| BL-12 | Pass | Local HTTP publish and unpublish, below. Not a production deployment and not a Wix write. |
| BL-13 | Pass | Public HTML uses the same block order as the staff layout: category, title, heading, paragraph and link. Canonical and description are present. |
| BL-14 | Pass | While published, the sitemap contained only the live canonical URL. After a draft edit it still did. After unpublish the sitemap was an empty urlset and the article URL returned 404. |

## Local native consumer

Website: Meridian Skin production, `97f35131-4a08-4b15-aabc-cebf7f988d40`, origin `https://meridian-skin.example.invalid`. The check ran against `http://127.0.0.1:3400` with a site token created for the request and revoked afterwards.

Published `GET /page/v1-blog-check-note` returned 200, `text/html`, `Cache-Control: private, no-store`, and `X-Robots-Tag: noindex, nofollow` because this platform host is not the public clinic site. The document itself contained:

- title and description for the article
- canonical `https://meridian-skin.example.invalid/blog/v1-blog-check-note`
- article robots `index,follow`
- heading “V1 blog check note” and the sentence `PUBLIC-SENTENCE for the native page check.`
- the https care link

`GET /sitemap` returned that canonical URL. `GET` without a token returned 404. A request for `/page/draft-only-check` returned 404 before and after the draft save.

After the draft save, the same public URL still returned “V1 blog check note” and `PUBLIC-SENTENCE`. It did not return `DRAFT-SENTENCE`. The sitemap still listed only the live path.

After unpublish, the article URL returned 404, the JSON contract returned `articles: []` and `sitemap: []`, and the sitemap XML was an empty urlset. A later request with the revoked token returned 404.

This is separate from the database tests. The database tests roll back. This request was served by the running platform after the publication row was committed, and the public page changed only when the live revision changed.

The sibling clinic site in `clinic-demo-a` still has no blog routes and does not call this API. No staging host was deployed. That gap is recorded on V1-C03. It was not treated as a reason to stop the native workflow.

## Staff screens

Signed in as Demo Admin on the local platform.

- Blog search for “Draft only” showed one row: Meridian Skin Clinic (fictional), Meridian Skin website, Care, Demo Specialist A, Demo Reviewer, Archived.
- The article page showed version 2 as the working copy and version 1 as the earlier saved copy, the approval of version 1 by Demo Reviewer, and the note “Synthetic check”. Archived articles cannot be edited.
- The dashboard timeline already listed the submit, approval, publication and unpublication events for this article, with actor and time. Agency Overview was not rebuilt.

## Checks that failed closed

- Publishing a draft throws and does not mark the article published.
- A specialist cannot approve. A reviewer cannot publish. Wix publish throws and leaves the article approved.
- A second save that still names the old version throws “A newer version was saved” and leaves the newer title in place.
- The service role’s direct selects of `blog_articles` and `blog_article_versions` return no rows. `getPublishedBlog` still returns the live revision.
- Two Meridian websites can use the same slug. A second article on the same website cannot.

## Commands

- `npm run db:migrate` — applied `0025_blog_live_revision.sql` and `0026_blog_public_boundary.sql`.
- `npm test` — `@clinic-genie/db` 11 files, 66 tests passed; `@clinic-genie/platform` 1 file, 3 tests passed.
- `npm run typecheck` — exit 0.
- `npm run lint` — exit 0, 10 existing warnings, 0 errors.
- `npm run build` — Next.js build completed. The blog page, preview, JSON, HTML and sitemap routes are in the route list. The filesystem tracing warnings come from the existing upload helper.

## Left in the local database

Article `55d6d451-3262-473a-b780-f84d76b66554` is archived, `live_version_id` is null, and its preview link is revoked. The site token used for the HTTP check is revoked. It is not publicly available. Both versions and the approval remain.

## Not in this ticket

- Wix Blog publishing.
- BL-15–BL-20 Blog Performance, and RP-05 while those stay deferred.
- AI writing, scheduled publishing, and a second permission model.
- A production deployment or a change to the sibling clinic site.
