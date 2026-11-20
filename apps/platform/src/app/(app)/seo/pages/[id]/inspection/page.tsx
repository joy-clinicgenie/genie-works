import Link from "next/link";
import { canEditClient, formatDateTime, type InspectionRow } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { Card, CardHeader, KeyValue } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button, LinkButton } from "@/components/ui/Button";
import { EmptyState, Notice } from "@/components/ui/Notice";
import { SeoFrame } from "@/components/modules/seo/SeoFrame";
import { inspectPageAction } from "@/app/actions/seo-pages";
import { SEO_PAGES_TABS, loadScopedPageDetail } from "@/lib/seo-page-detail";
import { inspectionErrorText, isConnectionProblem, verdictLabel, verdictTone } from "@/lib/seo-pages-view";
import { seoHref, type SeoSearch } from "@/lib/seo-workspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "URL Inspection" };

function words(value: string | null): string | null {
  return value ? value.toLowerCase().replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase()) : null;
}

function Result({ row }: { row: InspectionRow }) {
  return (
    <KeyValue items={[
      { label: "Google verdict", value: <Badge tone={verdictTone(row.verdict)}>{verdictLabel(row.verdict)}</Badge> },
      { label: "Coverage reason", value: row.coverage ?? "Not reported" },
      { label: "Checked", value: `${formatDateTime(row.checkedAt)} (${row.source === "manual" ? "staff request" : "scheduled Site Health check"})` },
      { label: "Indexing allowed by the page", value: words(row.indexingState) },
      { label: "Page fetch", value: words(row.pageFetchState) },
      { label: "robots.txt", value: words(row.robotsTxtState) },
      { label: "Last crawl by Google", value: row.lastCrawlTime ? formatDateTime(row.lastCrawlTime) : "Not crawled" },
      { label: "Google-selected canonical", value: row.googleCanonical },
    ]} />
  );
}

export default async function UrlInspection({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SeoSearch> }) {
  const access = await requireAccess();
  const { id } = await params;
  const query = await searchParams;
  const { ctx, detail } = await loadScopedPageDetail(access, id, query, "/inspection");
  const site = ctx.selected;
  if (!detail || !site) {
    return (
      <SeoFrame ctx={ctx} pathname="/seo/pages" title="URL Inspection" description="What Google reports for one URL." tabs={SEO_PAGES_TABS} currentTab="pages">
        <EmptyState title="This page is not part of the selected website and environment" action={site ? <LinkButton href={seoHref("/seo/pages", ctx, { tab: "pages" })} variant="secondary">Open the page list</LinkButton> : undefined}>
          Open the page from the page list of its own website. Nothing was sent to Google.
        </EmptyState>
      </SeoFrame>
    );
  }
  const { page, search, url, urlInProperty } = detail;
  const { lastSuccess, newerFailure } = detail.evidence.google;
  const connectionsHref = seoHref("/seo/settings", ctx, { tab: "connections" });
  const settingsHref = `/seo/pages/${page.id}?${new URLSearchParams({ website: site.id })}`;
  const canInspect = canEditClient(access, site.clientId);
  const connected = search.state === "connected" || search.state === "reconnect_required" || search.state === "pending";
  return (
    <SeoFrame
      ctx={ctx}
      pathname="/seo/pages"
      title={`URL Inspection · ${page.title ?? page.path}`}
      description="What Google currently reports about this URL. This reads Google's status only; it does not request indexing."
      tabs={SEO_PAGES_TABS}
      currentTab="pages"
      action={<LinkButton href={settingsHref} variant="secondary">Page settings</LinkButton>}
    >
      <div className="space-y-5" data-page-id={page.id}>
        <Card className="p-5">
          <KeyValue items={[
            { label: "URL", value: url ?? "No public address is recorded for this website" },
            { label: "Search Console property", value: connected ? search.property : "Not connected" },
            { label: "Inside the property", value: !url || !connected ? "Cannot be checked" : urlInProperty ? "Yes" : "No. This URL will not be sent to Google." },
          ]} />
          {!connected && (
            <div className="mt-4"><Notice tone="neutral" title="Search Console is not connected">Connect a Search Console property for this website and environment in <Link href={connectionsHref} className="text-action hover:underline">Website Connections</Link>.</Notice></div>
          )}
          {canInspect ? (
            <form action={inspectPageAction} className="mt-4">
              <input type="hidden" name="websiteId" value={site.id} />
              <input type="hidden" name="pageId" value={page.id} />
              <Button type="submit" size="sm">{lastSuccess || newerFailure ? "Recheck" : "Inspect URL"}</Button>
            </form>
          ) : <p className="mt-4 text-sm text-muted">Requesting an inspection needs edit access to this clinic.</p>}
        </Card>

        {newerFailure && (
          <div role="status" data-inspection="failure">
            <Notice tone="warn" title={`Latest request failed · ${formatDateTime(newerFailure.checkedAt)}`}>
              {inspectionErrorText(newerFailure.errorCode)}{" "}
              {isConnectionProblem(newerFailure.errorCode)
                ? <Link href={connectionsHref} className="text-action hover:underline">Open Website Connections</Link>
                : lastSuccess ? "The last successful result below is unchanged." : null}
            </Notice>
          </div>
        )}

        <Card>
          <CardHeader title="Last successful result" description={lastSuccess ? `Google's answer as of ${formatDateTime(lastSuccess.checkedAt)}. Search data can lag behind the live page.` : undefined} />
          <div className="px-5 pb-5">
            {lastSuccess ? <Result row={lastSuccess} /> : <p className="text-sm text-muted">No successful inspection is stored for this URL yet.</p>}
          </div>
        </Card>
      </div>
    </SeoFrame>
  );
}
