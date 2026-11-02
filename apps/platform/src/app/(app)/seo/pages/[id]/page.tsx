import Link from "next/link";
import { notFound } from "next/navigation";
import { canEditClient, formatDate, getSeoPage, listActiveStaff, listApprovals, listSeoPageSettings, listWebsites, readPageIndex } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { PageHeader, Card, CardHeader, KeyValue } from "@/components/ui/Card";
import { Badge, CONTENT_TONE, FLAG_TONE, label } from "@/components/ui/Badge";
import { SeoChangeForm, SeoPageForm, VerifyChangeForm } from "@/components/modules/SeoForms";
import { SeoSectionLinks } from "@/components/modules/SeoSubnav";
import { InnerNavAnchor, InnerNavFrame, InnerNavGroup } from "@/components/shell/InnerNav";
import { Unavailable } from "@/components/modules/seo/SeoFrame";
import { archivePageAction } from "@/app/actions/seo";
import { Button } from "@/components/ui/Button";
import { loadSeoContext, seoHref } from "@/lib/seo-workspace";

export const dynamic = "force-dynamic";

export default async function SeoPageDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string; client?: string; website?: string }> }) {
  const access = await requireAccess();
  const { id } = await params;
  const query = await searchParams;
  const data = await staffTx(access, async (db) => {
    const page = await getSeoPage(db, id);
    if (!page) return null;
    const websites = await listWebsites(db, page.client_id);
    const owners = await listActiveStaff(db);
    const approvals = await listApprovals(db, { clientId: page.client_id, statuses: ["approved"] });
    const settings = page.website_id ? await listSeoPageSettings(db, { websiteId: page.website_id }) : [];
    const indexState = page.website_id ? await readPageIndex(db, page.website_id, page.page_path) : null;
    return { page, websites, owners, approvals, settings, indexState };
  });
  if (!data) notFound();
  const { page } = data;
  const setting = data.settings.find((item) => item.page_path === page.page_path);
  const canEdit = canEditClient(access, page.client_id);
  const ctx = await loadSeoContext(access, { client: page.client_id, website: page.website_id ?? undefined });
  const redirectHref = seoHref("/seo/redirects", { client: page.client_id, website: page.website_id ?? undefined, demo: false }, { tab: "redirects", new: "1", from: page.page_path });
  const title = setting?.title || page.page_title || page.page_path;
  const description = setting?.description || "No meta description is saved for this path.";
  const sections = [
    ["appearance", "Search appearance"],
    ["url", "URL and indexing"],
    ["content", "Content checks"],
    ["social", "Social sharing"],
    ["schema", "Structured data"],
    ["history", "History"],
  ] as const;
  return (
    <InnerNavFrame
      label="SEO"
      nav={
        <>
          <SeoSectionLinks pathname="/seo/pages" ctx={ctx} />
          <InnerNavGroup title="On this page">
            {sections.map(([id, name]) => <InnerNavAnchor key={id} href={`#${id}`}>{name}</InnerNavAnchor>)}
          </InnerNavGroup>
        </>
      }
    >
      <PageHeader eyebrow={<Link href={seoHref("/seo/pages", ctx, { tab: "pages" })} className="hover:underline">{page.client_name}</Link>} title={page.page_path} description={<span className="flex flex-wrap gap-2 items-center"><Badge tone={CONTENT_TONE[page.content_status]}>{label(page.content_status)}</Badge>{page.mapping_flag !== "none" && <Badge tone={FLAG_TONE[page.mapping_flag]}>{label(page.mapping_flag)}</Badge>}{page.archived_at && <Badge>Archived</Badge>}</span>} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card id="appearance" className="p-5">
            <h2 className="font-semibold">Search appearance</h2>
            <p className="mt-1 text-xs text-muted">The preview is illustrative. It is not a guarantee of how Google displays the page.</p>
            <div className="mt-3 rounded-2xl bg-surface-muted p-4">
              <div className="text-sm text-action">{title}</div>
              <div className="text-xs text-muted">{page.website_name ?? "Website"}{page.page_path}</div>
              <p className="mt-1 text-sm">{description}</p>
            </div>
            <div className="mt-4"><KeyValue items={[{ label: "SEO title", value: title }, { label: "Meta description", value: setting?.description ?? null }, { label: "Inherited title", value: setting ? null : page.page_title }]} /></div>
            {canEdit && !page.archived_at && (
              <div className="mt-4 flex flex-wrap gap-3 items-center">
                <Link href={query.edit ? `/seo/pages/${id}` : `/seo/pages/${id}?edit=1`} className="text-sm text-action hover:underline">{query.edit ? "Close editor" : "Edit mapping"}</Link>
                <form action={archivePageAction}><input type="hidden" name="pageId" value={id} /><Button type="submit" variant="ghost" size="sm">Archive page</Button></form>
              </div>
            )}
            {canEdit && query.edit && <div className="mt-4"><SeoPageForm clientId={page.client_id} websites={data.websites} owners={data.owners.filter((owner) => owner.platform_role !== "read_only")} values={page as unknown as Record<string, unknown> & { id: string }} /></div>}
            <p className="mt-3 text-xs text-muted">Saving the mapping stores a staff draft record. It does not publish the public page. Use Settings to publish a title and description to a connected website.</p>
          </Card>
          <Card id="url" className="p-5">
            <h2 className="font-semibold">URL and indexing</h2>
            <div className="mt-3"><KeyValue items={[
              { label: "Path", value: page.page_path },
              { label: "Website", value: page.website_name },
              { label: "Canonical path", value: setting?.canonical_path ?? null },
              { label: "Configured indexing", value: data.indexState?.configured ?? (setting ? (setting.indexable ? "Index allowed" : "Noindex saved") : "Not saved") },
              { label: "Live indexability", value: data.indexState?.live ?? "Not checked" },
              { label: "Google indexing", value: data.indexState?.google ?? "Not connected" },
              { label: "Google detail", value: data.indexState?.detail ?? null },
            ]} /></div>
            {page.content_status === "published" && <p className="mt-3 text-sm">Changing this published path should propose a redirect. <Link href={redirectHref} className="text-action hover:underline">Propose a redirect from {page.page_path}</Link></p>}
            <details className="mt-3 text-sm"><summary className="cursor-pointer font-medium">Advanced</summary><p className="mt-2 text-muted">Extra robots directives and link tags are not stored. The saved preference is the staff control. A Search Console check reads the Google verdict and does not submit the page.</p></details>
          </Card>
          <Card id="content" className="p-5">
            <h2 className="font-semibold">Content checks</h2>
            <div className="mt-3"><KeyValue items={[{ label: "Focus topic", value: page.primary_keyword }, { label: "Secondary keywords", value: page.secondary_keywords.join(", ") || null }, { label: "Search intent", value: page.search_intent ? label(page.search_intent) : null }, { label: "Mapping", value: page.mapping_flag === "none" ? "None recorded" : label(page.mapping_flag) }]} /></div>
            {page.mapping_flag !== "none" && <p className="mt-3 text-sm"><strong>What was found:</strong> {page.flag_note}</p>}
            <p className="mt-3 text-sm text-muted">Headings are edited in the content source. This screen does not invent a replacement H1. No content crawl has produced internal-link recommendations.</p>
            {page.page_path.includes("blog") && <Link href="/blog" className="mt-3 inline-block text-sm text-action hover:underline">Open the blog editor</Link>}
          </Card>
          <Card id="social" className="p-5"><h2 className="font-semibold">Social sharing</h2><div className="mt-3"><Unavailable title="Open Graph and X cards are not stored">No social title, description, image or card setting is saved for this page.</Unavailable></div></Card>
          <Card id="schema" className="p-5"><h2 className="font-semibold">Structured data</h2><div className="mt-3"><Unavailable title="JSON-LD is not stored">Presets, custom schema, variables and validation are unavailable. No schema is published from this screen.</Unavailable></div></Card>
          <Card id="history">
            <CardHeader title="History" description="Changes, approval links and staff verification. Publication to the live site is not recorded here." />
            <ol className="divide-y divide-line">
              {page.changes.length === 0 && <li className="px-5 py-3 text-sm text-muted">No changes recorded.</li>}
              {page.changes.map((change) => (
                <li key={change.id} className="px-5 py-4 text-sm">
                  <div className="flex flex-wrap gap-2 items-center">
                    <Badge tone="info">{label(change.change_type)}</Badge>
                    <span>{formatDate(change.changed_on)} by {change.changed_by_name}</span>
                    {change.approval_id && <Link href={`/approvals/${change.approval_id}`} className="text-action hover:underline text-xs">Approval</Link>}
                    {change.verification_on ? <Badge tone="good">Verified {formatDate(change.verification_on)}</Badge> : <Badge tone="warn">Draft</Badge>}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 mt-2">
                    <div className="rounded-md bg-surface-muted p-2"><div className="text-xs text-muted">Before</div>{change.before_value ?? <span className="text-muted">Not recorded</span>}</div>
                    <div className="rounded-md bg-surface-muted p-2"><div className="text-xs text-muted">After</div>{change.after_value ?? <span className="text-muted">Not recorded</span>}</div>
                  </div>
                  <div className="mt-2"><span className="text-muted">Reason:</span> {change.reason}</div>
                  {change.outcome_note && <div className="mt-1"><span className="text-muted">Observed afterwards ({change.verified_by_name}):</span> {change.outcome_note}</div>}
                  {canEdit && !change.verification_on && <VerifyChangeForm pageId={id} changeId={change.id} />}
                </li>
              ))}
            </ol>
          </Card>
        </div>
        <div>
          {canEdit && !page.archived_at && (
            <Card>
              <CardHeader title="Record a change" description="This saves the staff record. It does not publish the website." />
              <div className="px-5 pb-5"><SeoChangeForm pageId={id} approvals={data.approvals} /></div>
            </Card>
          )}
        </div>
      </div>
    </InnerNavFrame>
  );
}
