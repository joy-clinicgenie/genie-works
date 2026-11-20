import type { ReactNode } from "react";
import Link from "next/link";
import { canEditClient, canPublishClient, effectivePageSeo, formatDate, formatDateTime, listActiveStaff, listApprovals, listWebsites, pageEditRoute, type EffectiveValue, type PageEvidence } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { Card, CardHeader, KeyValue } from "@/components/ui/Card";
import { Badge, CONTENT_TONE, label, type Tone } from "@/components/ui/Badge";
import { Button, LinkButton } from "@/components/ui/Button";
import { EmptyState, Notice } from "@/components/ui/Notice";
import { SeoChangeForm, SeoPageForm, VerifyChangeForm } from "@/components/modules/SeoForms";
import { SeoFrame } from "@/components/modules/seo/SeoFrame";
import { PageSeoForm } from "@/components/modules/seo/PageSeoForm";
import { archivePageAction } from "@/app/actions/seo";
import { checkLivePageAction } from "@/app/actions/seo-pages";
import { SEO_PAGES_TABS, loadScopedPageDetail } from "@/lib/seo-page-detail";
import { indexingLabel, inspectionErrorText, liveErrorText, pageSourceLabel, valueSourceLabel, verdictLabel, verdictTone } from "@/lib/seo-pages-view";
import { queryText, seoHref, type SeoSearch } from "@/lib/seo-workspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "Page SEO settings" };

function Value<T>({ name, value, render }: { name: string; value: EffectiveValue<T>; render: (value: T | null) => ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-line/70 py-3 last:border-0 sm:grid-cols-[12rem_minmax(0,1fr)]">
      <dt className="text-sm font-medium">{name}</dt>
      <dd className="space-y-1 text-sm">
        <div className="break-words">{render(value.value)}</div>
        <Badge tone={value.source === "override" ? "info" : "neutral"}>{valueSourceLabel(value.source)}</Badge>
      </dd>
    </div>
  );
}

function EvidenceRow({ name, tone, state, children }: { name: string; tone: Tone; state: string; children: ReactNode }) {
  return (
    <li className="grid gap-1 px-5 py-3 sm:grid-cols-[10rem_minmax(0,1fr)]" data-evidence={name}>
      <div className="text-sm font-medium">{name}</div>
      <div className="space-y-1 text-sm">
        <Badge tone={tone}>{state}</Badge>
        <div className="text-muted">{children}</div>
      </div>
    </li>
  );
}

function PublishedRow({ evidence }: { evidence: PageEvidence }) {
  const published = evidence.published;
  switch (published.state) {
    case "published":
      return <EvidenceRow name="Published" tone="good" state="Published">The website fetched these settings at {formatDateTime(published.at)}, after the last save.</EvidenceRow>;
    case "waiting":
      return <EvidenceRow name="Published" tone="warn" state="Not yet published">The website has not fetched its settings since this save. {published.lastFetch ? `Last fetch: ${formatDateTime(published.lastFetch)}.` : "No fetch has been recorded."}</EvidenceRow>;
    case "no_credential":
      return <EvidenceRow name="Published" tone="neutral" state="Not published">No website settings API credential is issued, so the website cannot fetch these settings.</EvidenceRow>;
    default:
      return <EvidenceRow name="Published" tone="neutral" state="No override">Nothing is saved for this page in Genie Works, so there is nothing to publish.</EvidenceRow>;
  }
}

function LiveRow({ evidence }: { evidence: PageEvidence }) {
  const live = evidence.live;
  const observed = live.state === "not_checked" ? null : live.check;
  const seen = observed && !observed.errorCode ? (
    <dl className="mt-1 space-y-0.5 text-xs">
      <div>Served title: {observed.title ?? "None"}</div>
      <div>Served description: {observed.description ?? "None"}</div>
      <div>Served robots: {observed.robots ?? "None (indexing allowed by default)"}</div>
    </dl>
  ) : null;
  switch (live.state) {
    case "matches":
      return <EvidenceRow name="Live checked" tone="good" state="Live page matches">Checked {formatDateTime(live.check.checkedAt)}. The saved overrides are served.{seen}</EvidenceRow>;
    case "differs":
      return <EvidenceRow name="Live checked" tone="warn" state="Live page differs">Checked {formatDateTime(live.check.checkedAt)}. The served {live.fields.join(", ")} does not match the saved override.{seen}</EvidenceRow>;
    case "observed":
      return <EvidenceRow name="Live checked" tone="info" state="Observed">Checked {formatDateTime(live.check.checkedAt)}. No override is saved, so this is what the website serves by default.{seen}</EvidenceRow>;
    case "failed":
      return <EvidenceRow name="Live checked" tone="bad" state="Check failed">Checked {formatDateTime(live.check.checkedAt)}. {liveErrorText(live.check.errorCode)}</EvidenceRow>;
    case "before_save":
      return <EvidenceRow name="Live checked" tone="neutral" state="Not checked since this save">The last live check, {formatDateTime(live.check.checkedAt)}, was before the latest save.{seen}</EvidenceRow>;
    default:
      return <EvidenceRow name="Live checked" tone="neutral" state="Not checked">Nobody has checked what the public page serves.</EvidenceRow>;
  }
}

export default async function PageSeoSettings({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SeoSearch & { edit?: string }> }) {
  const access = await requireAccess();
  const { id } = await params;
  const query = await searchParams;
  const { ctx, detail } = await loadScopedPageDetail(access, id, query, "");
  const site = ctx.selected;
  if (!detail || !site) {
    return (
      <SeoFrame ctx={ctx} pathname="/seo/pages" title="Page SEO settings" description="Search title, description and indexing preference for one page." tabs={SEO_PAGES_TABS} currentTab="pages">
        <EmptyState title="This page is not part of the selected website and environment" action={site ? <LinkButton href={seoHref("/seo/pages", ctx, { tab: "pages" })} variant="secondary">Open the page list</LinkButton> : undefined}>
          Open the page from the page list of its own website. No settings or Google data are shown for it here.
        </EmptyState>
      </SeoFrame>
    );
  }
  const { page, evidence, mapping } = detail;
  const effective = effectivePageSeo(page);
  const route = pageEditRoute(site.platform, page);
  const canEdit = canEditClient(access, site.clientId);
  const canPublish = canPublishClient(access, site.clientId);
  const inspectionHref = `/seo/pages/${page.id}/inspection?${new URLSearchParams({ website: site.id })}`;
  const notice = queryText(query, "notice");
  const mappingForms = mapping && canEdit
    ? await staffTx(access, async (db) => ({
      websites: await listWebsites(db, mapping.client_id),
      owners: await listActiveStaff(db),
      approvals: await listApprovals(db, { clientId: mapping.client_id, statuses: ["approved"] }),
    }))
    : null;
  const google = evidence.google;
  return (
    <SeoFrame
      ctx={ctx}
      pathname="/seo/pages"
      title={page.title ?? page.path}
      description="Search title, description and indexing preference for this page, with separate evidence for saving, publishing, the live page and Google."
      tabs={SEO_PAGES_TABS}
      currentTab="pages"
      action={<LinkButton href={inspectionHref} variant="secondary">Inspect URL</LinkButton>}
    >
      <div className="space-y-5" data-page-id={page.id}>
        {notice === "live_checked" && <Notice tone="neutral">The live page was read. Its served values are below.</Notice>}
        {notice === "live_failed" && <Notice tone="neutral">The live page could not be read. The reason is below.</Notice>}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-mono break-all">{page.path}</span>
          {detail.url && <a href={detail.url} target="_blank" rel="noreferrer" className="text-action hover:underline">Open the public page</a>}
          {page.sources.map((source) => <Badge key={source}>{pageSourceLabel(source)}</Badge>)}
        </div>

        <Card>
          <CardHeader title="Search appearance and indexing" description="Effective values. A page override replaces the inherited value for this page only." />
          <dl className="px-5 pb-2">
            <Value name="SEO title" value={effective.title} render={(value) => value ?? <span className="text-muted">Set by the website (not visible to Genie Works)</span>} />
            <Value name="Meta description" value={effective.description} render={(value) => value ?? <span className="text-muted">Set by the website (not visible to Genie Works)</span>} />
            <Value name="Indexing preference" value={effective.indexable} render={(value) => indexingLabel(value)} />
          </dl>
          <p className="px-5 pb-4 text-xs text-muted">The indexing preference is this site&apos;s instruction to search engines. Google&apos;s reported indexing status is shown separately below.</p>
          <div className="border-t border-line px-5 py-4">
            {route === "settings_api" ? (
              canPublish ? (
                <PageSeoForm
                  clientId={site.clientId}
                  websiteId={site.id}
                  pagePath={page.setting?.pagePath ?? page.path}
                  canonicalPath={page.setting?.canonicalPath ?? null}
                  title={page.setting?.title ?? null}
                  description={page.setting?.description ?? null}
                  indexable={page.setting?.indexable ?? null}
                />
              ) : <p className="text-sm text-muted">Saving page settings stays with an administrator or manager.</p>
            ) : route === "blog_editor" ? (
              <p className="text-sm text-muted">This is a blog article. Its title, description and indexing are edited in the blog editor, which publishes them. <Link href={`/blog/${page.blog!.articleId}`} className="text-action hover:underline">Open the blog editor</Link></p>
            ) : (
              <p className="text-sm text-muted">{site.platform} has no approved editing route from Genie Works, so these settings are read-only here. Use Check live page to see what the page serves.</p>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Evidence" description="Each state advances only when its own source confirms it." />
          <ul className="divide-y divide-line">
            <EvidenceRow name="Saved" tone={evidence.saved ? "good" : "neutral"} state={evidence.saved ? "Saved" : "No override saved"}>
              {evidence.saved ? `Saved in Genie Works ${formatDateTime(evidence.saved.at)}${evidence.saved.by ? ` by ${evidence.saved.by}` : ""}.` : route === "blog_editor" ? "Managed in the blog editor." : "The page uses inherited values."}
            </EvidenceRow>
            <PublishedRow evidence={evidence} />
            <LiveRow evidence={evidence} />
          </ul>
          {canEdit && (
            <form action={checkLivePageAction} className="border-t border-line px-5 py-4">
              <input type="hidden" name="websiteId" value={site.id} />
              <input type="hidden" name="pageId" value={page.id} />
              <Button type="submit" variant="secondary" size="sm">Check live page</Button>
              <p className="mt-2 text-xs text-muted">Reads the page from the website&apos;s registered HTTPS address and stores the served title, description and robots directives.</p>
            </form>
          )}
        </Card>

        <Card>
          <CardHeader title="Google" description="What Google last reported for this URL. Separate from the site's indexing preference." />
          <div className="space-y-3 px-5 pb-5 text-sm">
            {google.lastSuccess ? (
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={verdictTone(google.lastSuccess.verdict)}>{verdictLabel(google.lastSuccess.verdict)}</Badge>
                <span>{google.lastSuccess.coverage ?? "No coverage reason reported"}</span>
                <span className="text-muted">Checked {formatDateTime(google.lastSuccess.checkedAt)}</span>
              </div>
            ) : <p className="text-muted">No Google result is stored for this URL.</p>}
            {google.newerFailure && <p>A newer request failed {formatDateTime(google.newerFailure.checkedAt)}: {inspectionErrorText(google.newerFailure.errorCode)}</p>}
            <Link href={inspectionHref} className="text-action hover:underline">Open URL Inspection</Link>
          </div>
        </Card>

        {mapping && (
          <Card>
            <CardHeader title="Page mapping and change history" description="Staff records for this mapped page. They do not publish the website." />
            <div className="space-y-4 px-5 pb-5">
              <KeyValue items={[
                { label: "Mapped title", value: mapping.page_title },
                { label: "Content status", value: <Badge tone={CONTENT_TONE[mapping.content_status]}>{label(mapping.content_status)}</Badge> },
                { label: "Focus topic", value: mapping.primary_keyword },
                { label: "Mapping flag", value: mapping.mapping_flag === "none" ? "None recorded" : label(mapping.mapping_flag) },
              ]} />
              {canEdit && !mapping.archived_at && mappingForms && (
                <>
                  <div className="flex flex-wrap items-center gap-3">
                    <Link href={`/seo/pages/${page.id}?${new URLSearchParams({ website: site.id, ...(query.edit ? {} : { edit: "1" }) })}`} className="text-sm text-action hover:underline">{query.edit ? "Close mapping editor" : "Edit mapping"}</Link>
                    <form action={archivePageAction}><input type="hidden" name="pageId" value={mapping.id} /><Button type="submit" variant="ghost" size="sm">Archive page</Button></form>
                  </div>
                  {query.edit && <SeoPageForm clientId={mapping.client_id} websites={mappingForms.websites} owners={mappingForms.owners.filter((owner) => owner.platform_role !== "read_only")} values={mapping as unknown as Record<string, unknown> & { id: string }} />}
                </>
              )}
              <ol className="divide-y divide-line rounded-xl border border-line">
                {mapping.changes.length === 0 && <li className="px-4 py-3 text-sm text-muted">No changes recorded.</li>}
                {mapping.changes.map((change) => (
                  <li key={change.id} className="px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="info">{label(change.change_type)}</Badge>
                      <span>{formatDate(change.changed_on)} by {change.changed_by_name}</span>
                      {change.verification_on ? <Badge tone="good">Verified {formatDate(change.verification_on)}</Badge> : <Badge tone="warn">Draft</Badge>}
                    </div>
                    <p className="mt-1 text-muted">Before: {change.before_value ?? "Not recorded"} · After: {change.after_value ?? "Not recorded"} · Reason: {change.reason}</p>
                    {canEdit && !change.verification_on && <VerifyChangeForm pageId={mapping.id} changeId={change.id} />}
                  </li>
                ))}
              </ol>
              {canEdit && !mapping.archived_at && mappingForms && (
                <div>
                  <h3 className="mb-2 text-sm font-semibold">Record a change</h3>
                  <SeoChangeForm pageId={mapping.id} approvals={mappingForms.approvals} />
                </div>
              )}
            </div>
          </Card>
        )}
      </div>
    </SeoFrame>
  );
}
