import { formatDateTime, type RobotsCheckRow, type SiteChecksView, type SitemapCheckRow, type SitemapStatus } from "@clinic-genie/db";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, KeyValue } from "@/components/ui/Card";
import { Notice } from "@/components/ui/Notice";
import { Table, Td, Th } from "@/components/ui/Table";
import { checkRobotsAction, checkSitemapAction, runWebsiteCheckAction } from "@/app/actions/seo-technical";
import { fetchReason, findingLabel } from "@/lib/technical-seo-view";

const NOTICES: Record<string, string> = {
  denied: "That website is not available for checks with your access.",
  missing_url: "This website has no public address recorded, so nothing was checked.",
  already_running: "A website check is already running for this website. Wait for it to finish.",
  run_completed: "The website check finished. Coverage and findings are below.",
  robots_checked: "robots.txt was read. The result is below.",
  sitemap_checked: "The sitemap was read. The result is below.",
};

export function TechnicalNotice({ notice }: { notice?: string }) {
  const text = notice ? NOTICES[notice] : undefined;
  return text ? <div className="mb-4"><Notice tone="neutral">{text}</Notice></div> : null;
}

function CheckButton({ action, websiteId, label }: { action: (formData: FormData) => Promise<void>; websiteId: string; label: string }) {
  return (
    <form action={action}>
      <input type="hidden" name="websiteId" value={websiteId} />
      <Button type="submit" variant="secondary" size="sm">{label}</Button>
    </form>
  );
}

// ---------------------------------------------------------------------------------------------------------
// SEO-04.3

export function WebsiteChecksPanel({ websiteId, view, canCheck }: { websiteId: string; view: SiteChecksView; canCheck: boolean }) {
  const run = view.lastCompleted;
  const notCompleted = view.items.filter((item) => item.outcome !== "completed");
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Last completed run"
          description="The home page and known public pages, read from the website's own address. A page that was not reached is listed with its reason and is never marked as passed."
          action={canCheck ? <CheckButton action={runWebsiteCheckAction} websiteId={websiteId} label="Run website check" /> : undefined}
        />
        <div className="space-y-3 px-5 pb-5 text-sm">
          {view.running && <p>A run started {formatDateTime(view.running.startedAt)} is still running.</p>}
          {run ? (
            <>
              <KeyValue items={[
                { label: "Finished", value: run.finishedAt ? formatDateTime(run.finishedAt) : "Not finished" },
                { label: "Attempted", value: String(run.attempted) },
                { label: "Completed", value: String(run.completed) },
                { label: "Failed", value: String(run.failed) },
                { label: "Skipped", value: String(run.skipped) },
              ]} />
              {notCompleted.length > 0 && (
                <div>
                  <h3 className="mb-2 font-semibold">Pages not checked in this run</h3>
                  <ul className="space-y-1">
                    {notCompleted.map((item) => (
                      <li key={item.pagePath} data-coverage={item.outcome}>
                        <Badge tone={item.outcome === "failed" ? "bad" : "neutral"}>{item.outcome === "failed" ? "Failed" : "Skipped"}</Badge>{" "}
                        <span className="break-all">{item.url ?? item.pagePath}</span> {fetchReason(item.reason)}.
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : <p className="text-muted">No website check has completed for this website.</p>}
        </div>
      </Card>
      <Card>
        <CardHeader title="Open findings" description="One finding per page and check type. A repeat in a later run updates the same finding; a later run that completes the page without it closes it." />
        {view.openFindings.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-muted">{run ? "No open findings." : "No findings yet."}</p>
        ) : (
          <Table caption="Open website check findings">
            <thead><tr><Th>Page</Th><Th>Finding</Th><Th>First seen</Th><Th>Last seen</Th><Th>Runs</Th></tr></thead>
            <tbody>
              {view.openFindings.map((finding) => (
                <tr key={finding.id} data-finding={finding.checkType}>
                  <Td className="break-all">{finding.pagePath}</Td>
                  <Td><Badge tone="warn">{findingLabel(finding.checkType)}</Badge>{finding.detail && <span className="ml-2 text-muted">{finding.detail}</span>}</Td>
                  <Td>{formatDateTime(finding.firstSeenAt)}</Td>
                  <Td>{formatDateTime(finding.lastSeenAt)}</Td>
                  <Td>{finding.seenCount}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------
// SEO-04.1 and SEO-04.2

function SitemapResult({ row, heading }: { row: SitemapCheckRow; heading: string }) {
  const passed = row.result === "passed";
  return (
    <div className="space-y-2" data-sitemap={row.result}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">{heading}</h3>
        <Badge tone={passed ? "good" : row.result === "incomplete" ? "warn" : "bad"}>{passed ? "Full pass" : row.result === "incomplete" ? "Incomplete" : "Failed"}</Badge>
      </div>
      <KeyValue items={[
        { label: "Checked", value: formatDateTime(row.checkedAt) },
        { label: "Sitemap", value: `${row.sitemapUrl}${row.source === "robots" ? " (declared in robots.txt)" : " (default location)"}` },
        { label: "Final URL", value: row.finalUrl },
        { label: "HTTP status", value: row.httpStatus === null ? "No response" : String(row.httpStatus) },
        { label: "Type", value: row.kind === "sitemapindex" ? "Sitemap index" : row.kind === "urlset" ? "URL list" : "Not read" },
        { label: "URLs listed", value: passed || row.result === "incomplete" ? String(row.urlCount) : "Not counted" },
      ]} />
      {!passed && row.children.length === 0 && <p className="text-sm">The sitemap {fetchReason(row.errorCode)}.</p>}
      {row.children.length > 0 && (
        <ul className="space-y-1 text-sm">
          {row.children.map((child) => (
            <li key={child.url} data-child={child.result}>
              <Badge tone={child.result === "read" ? "good" : child.result === "failed" ? "bad" : "neutral"}>{child.result === "read" ? "Read" : child.result === "failed" ? "Unreadable" : "Not checked"}</Badge>{" "}
              <span className="break-all">{child.url}</span>{child.result === "read" ? ` · ${child.urlCount} URLs` : ` ${fetchReason(child.reason)}.`}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function CrawlSettingsPanel({ websiteId, sitemap, robots, canCheck }: { websiteId: string; sitemap: SitemapStatus; robots: RobotsCheckRow | null; canCheck: boolean }) {
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Sitemap"
          description="Read from the website's own address. Only a check where every sitemap file was read counts as a full pass; the last full pass stays visible beside a newer incomplete attempt."
          action={canCheck ? <CheckButton action={checkSitemapAction} websiteId={websiteId} label="Check sitemap" /> : undefined}
        />
        <div className="space-y-5 px-5 pb-5">
          {sitemap.newerAttempt && <SitemapResult row={sitemap.newerAttempt} heading="Latest attempt" />}
          {sitemap.latestPass ? <SitemapResult row={sitemap.latestPass} heading="Last full pass" /> : <p className="text-sm text-muted">No full sitemap pass is recorded.</p>}
        </div>
      </Card>
      <Card>
        <CardHeader
          title="robots.txt"
          description="The live crawl instructions for this website and environment. Crawl blocking and noindex are different controls."
          action={canCheck ? <CheckButton action={checkRobotsAction} websiteId={websiteId} label="Check robots.txt" /> : undefined}
        />
        <div className="space-y-4 px-5 pb-5 text-sm" data-robots={robots?.availability ?? "not_checked"}>
          {!robots ? <p className="text-muted">robots.txt has not been checked.</p> : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={robots.availability === "available" ? "good" : robots.availability === "not_found" ? "neutral" : "bad"}>
                  {robots.availability === "available" ? "Available" : robots.availability === "not_found" ? "No robots.txt" : "Unavailable"}
                </Badge>
                <span className="text-muted">Checked {formatDateTime(robots.checkedAt)} · {robots.httpStatus === null ? "No response" : `HTTP ${robots.httpStatus}`}</span>
              </div>
              {robots.availability === "unavailable" && <p>The file {fetchReason(robots.errorCode)}. Search engines may pause crawling while robots.txt is unavailable.</p>}
              {robots.availability === "not_found" && <p>The file {fetchReason(robots.errorCode)}. Search engines treat a missing robots.txt as no crawl restrictions.</p>}
              {robots.parsed && (
                <>
                  {robots.parsed.groups.filter((group) => group.broad.length > 0).map((group) => (
                    <div key={group.agents.join(",")} data-broad={group.agents.join(",")}>
                      <Notice tone="warn" title={`Whole site blocked for ${group.agents.join(", ")}`}>
                        {group.broad.map((path) => `Disallow: ${path}`).join(", ")} applies to {group.agents.includes("*") ? "every crawler without its own group" : `only ${group.agents.join(", ")}`}.
                      </Notice>
                    </div>
                  ))}
                  <KeyValue items={[
                    { label: "User-agent groups", value: robots.parsed.groups.length ? robots.parsed.groups.map((group) => `${group.agents.join(", ")} (${group.rules.length} rule${group.rules.length === 1 ? "" : "s"})`).join("; ") : "None" },
                    { label: "Sitemap lines", value: robots.parsed.sitemaps.length ? robots.parsed.sitemaps.join(", ") : "None declared" },
                  ]} />
                  {robots.truncated && <p className="text-muted">The file is larger than 500 KiB; Google ignores content after that point and so does this summary.</p>}
                  <details>
                    <summary className="cursor-pointer font-medium">Retrieved text</summary>
                    <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-surface-muted p-3 text-xs">{robots.body}</pre>
                  </details>
                </>
              )}
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
