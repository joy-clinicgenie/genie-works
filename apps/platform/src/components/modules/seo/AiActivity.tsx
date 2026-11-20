import Link from "next/link";
import { AI_PROVIDERS, AI_PROVIDER_LABELS, formatDate, formatDateTime, type AiActivity, type AiProvider, type CrawlerEventRow, type CrawlerSourceRow, type NlwebState } from "@clinic-genie/db";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { Table, Td, Th } from "@/components/ui/Table";
import { CrawlerSourceForm } from "@/components/modules/seo/CrawlerSourceForm";
import { disconnectCrawlerSourceAction, prepareReferralReportAction, recordAnswerTestAction, runNlwebTestAction, saveNlwebEndpointAction } from "@/app/actions/seo-ai";

const PURPOSE: Record<string, string> = { search: "Search", training: "Training", user: "User-initiated fetch", ads: "Ad landing check", unspecified: "Purpose not given" };

export const AI_NOTICES: Record<string, string> = {
  denied: "That action is not available for this website with your access.",
  source_disconnected: "The log source is disconnected. Crawler counts are unavailable until a connected source covers the range.",
  referrals_queued: "The AI referral report is queued. It appears after the analytics worker reads it from GA4.",
  no_ga4: "No connected GA4 property can supply referral sessions for this website.",
  test_saved: "The answer test is saved.",
  test_invalid: "The answer test was not saved.",
  nlweb_saved: "The NLWeb endpoint is saved.",
  nlweb_invalid: "The NLWeb endpoint was not accepted.",
  nlweb_not_configured: "No NLWeb endpoint is configured for this website, so nothing was sent.",
  nlweb_question: "Enter a question of up to 300 characters.",
  nlweb_tested: "The NLWeb test ran. The result is below.",
};

function rangeLink(base: Record<string, string>, extra: Record<string, string>) {
  return `/seo/ai-visibility?${new URLSearchParams({ ...base, ...extra })}`;
}

function Measure({ title, value, note, unavailable }: { title: string; value: string; note: string; unavailable?: boolean }) {
  return (
    <div className="rounded-xl border border-line p-4" data-measure={title}>
      <div className="text-xs uppercase tracking-[0.12em] text-muted">{title}</div>
      <div className="mt-1 text-2xl font-semibold">{unavailable ? <Badge>Unavailable</Badge> : value}</div>
      <p className="mt-1 text-xs text-muted">{note}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------
// SEO-05.3

export function AiActivityPanel({ websiteId, days, activity, events, provider, sources, canManageSources, canPrepare, ingestUrl }: {
  websiteId: string;
  days: number;
  activity: AiActivity;
  events: CrawlerEventRow[];
  provider: AiProvider | null;
  sources: CrawlerSourceRow[];
  canManageSources: boolean;
  canPrepare: boolean;
  ingestUrl: string;
}) {
  const base = { website: websiteId, tab: "visibility", range: String(days) };
  const { crawlers, referrals, mentions } = activity;
  const crawlerNote = crawlers.status === "no_source" ? "No crawler log source is connected."
    : crawlers.status === "disconnected" ? "The crawler log source is disconnected."
      : crawlers.status === "not_covered" ? "Connected sources do not cover the whole range."
        : crawlers.unavailableProviders.length ? `ChatGPT and Claude only. ${crawlers.unavailableProviders.map((p) => AI_PROVIDER_LABELS[p]).join(", ")} unavailable.` : "ChatGPT, Gemini and Claude.";
  const referralNote = referrals.status === "available" ? "Sessions from chatgpt.com, gemini.google.com and claude.ai in the connected GA4 property."
    : referrals.status === "preparing" ? "The GA4 report for this range is being prepared."
      : referrals.status === "not_prepared" ? "The GA4 referral report for this range has not been prepared."
        : referrals.status === "wix_only" ? "Wix analytics does not report session sources."
          : "No GA4 property is connected.";
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-sm" role="group" aria-label="Date range">
        <span className="text-muted">Range ({formatDate(activity.range.start)} to {formatDate(activity.range.end)}):</span>
        {[7, 30, 90].map((value) => (
          <Link key={value} href={rangeLink(base, { range: String(value) })} aria-current={value === days ? "true" : undefined} className={`rounded-full border px-3 py-1 ${value === days ? "border-action bg-brand-pale text-action" : "border-line"}`}>Last {value} days</Link>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Measure title="Crawler visits" value={String(crawlers.total ?? 0)} unavailable={crawlers.total === null} note={crawlerNote} />
        <Measure title="AI referral sessions" value={String(referrals.sessions ?? 0)} unavailable={referrals.sessions === null} note={referralNote} />
        <Measure title="Tracked mentions" value={String(mentions.mentions ?? 0)} unavailable={mentions.mentions === null} note={mentions.tests ? `${mentions.mentions} of ${mentions.tests} saved answer tests mention the clinic.` : "No answer test is saved for this range."} />
      </div>
      <p className="text-xs text-muted">The three measures are separate. A crawler visit is not a referral or a mention, and neither adds to crawler visits.</p>

      <div id="crawler-visits" className="scroll-mt-4">
      <Card>
        <CardHeader title="Crawler visits by platform" description={`Crawler tracking covers ChatGPT, Gemini and Claude only. Last source update: ${crawlers.lastSuccessAt ? formatDateTime(crawlers.lastSuccessAt) : "none"}.`} />
        <Table caption="AI crawler visits by platform">
          <thead><tr><Th>Platform</Th><Th>Visits</Th><Th>By purpose</Th><Th>Records</Th></tr></thead>
          <tbody>
            {AI_PROVIDERS.map((key) => {
              const row = crawlers.providers[key];
              return (
                <tr key={key} data-provider={key}>
                  <Td className="font-medium">{AI_PROVIDER_LABELS[key]}</Td>
                  <Td>{row.availability === "available" ? row.count : <Badge>Unavailable</Badge>}</Td>
                  <Td className="text-muted">{row.availability === "available" ? (Object.entries(row.byPurpose).map(([purpose, n]) => `${PURPOSE[purpose] ?? purpose} ${n}`).join(" · ") || "None") : key === "gemini" ? "Needs a source with documented Gemini attribution" : crawlerNote}</Td>
                  <Td>{row.availability === "available" ? <Link className="text-action hover:underline" href={rangeLink(base, { provider: key })}>View requests</Link> : null}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        {events.length > 0 && (
          <div className="border-t border-line">
            <p className="px-5 pt-4 text-sm font-semibold">{provider ? `${AI_PROVIDER_LABELS[provider]} requests` : "Requests"} · <Link className="font-normal text-action hover:underline" href={rangeLink(base, {})}>All platforms</Link></p>
            <Table caption="AI crawler requests">
              <thead><tr><Th>Time</Th><Th>Platform</Th><Th>Agent</Th><Th>Purpose</Th><Th>Path</Th><Th>Status</Th></tr></thead>
              <tbody>
                {events.map((event, index) => (
                  <tr key={index}>
                    <Td>{formatDateTime(event.occurredAt)}</Td>
                    <Td>{AI_PROVIDER_LABELS[event.provider]}</Td>
                    <Td>{event.agent}</Td>
                    <Td>{PURPOSE[event.purpose]}</Td>
                    <Td className="break-all">{event.pagePath ?? "Not supplied"}</Td>
                    <Td>{event.httpStatus ?? "Not supplied"}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card id="referral-sessions">
          <CardHeader title="AI referral sessions" description={referralNote} />
          <div className="space-y-2 px-5 pb-5 text-sm">
            {referrals.byProvider && AI_PROVIDERS.map((key) => <p key={key}>{AI_PROVIDER_LABELS[key]}: {referrals.byProvider![key]}</p>)}
            {referrals.fetchedAt && <p className="text-muted">Read from GA4 {formatDateTime(referrals.fetchedAt)}.</p>}
            {canPrepare && (referrals.status === "not_prepared" || referrals.status === "available") && (
              <form action={prepareReferralReportAction}>
                <input type="hidden" name="websiteId" value={websiteId} />
                <input type="hidden" name="days" value={days} />
                <Button type="submit" variant="secondary" size="sm">{referrals.status === "available" ? "Refresh referral report" : "Prepare referral report"}</Button>
              </form>
            )}
          </div>
        </Card>
        <Card id="tracked-mentions">
          <CardHeader title="Tracked mentions" description="Positive saved external answer tests in this range. Add tests on Questions & Tests." />
          <ul className="space-y-2 px-5 pb-5 text-sm">
            {mentions.recent.length === 0 && <li className="text-muted">No saved answer test in this range.</li>}
            {mentions.recent.map((test, index) => (
              <li key={index}>
                <Badge tone={test.mentioned ? "good" : "neutral"}>{test.mentioned ? "Mentioned" : "Not mentioned"}</Badge> {AI_PROVIDER_LABELS[test.platform]} · {formatDate(test.testedOn)} · {test.question}
                {test.citedUrl && <> · <a className="break-all text-action hover:underline" href={test.citedUrl} target="_blank" rel="noreferrer">source</a></>}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card>
        <CardHeader title="Crawler log sources" description="A connected website request log or platform feed posts eligible requests with the window it covers. Counts appear only for fully covered ranges." />
        <ul className="divide-y divide-line">
          {sources.length === 0 && <li className="px-5 py-3 text-sm text-muted">No source is connected.</li>}
          {sources.map((source) => (
            <li key={source.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm" data-source={source.status}>
              <span>
                <Badge tone={source.status === "connected" ? "good" : "neutral"}>{source.status === "connected" ? "Connected" : "Disconnected"}</Badge> {source.label}
                <span className="text-muted"> · {source.kind === "request_log" ? "Request log" : "Platform feed"} · Gemini attribution {source.geminiAttribution ? "documented" : "not supplied"} · Last update {source.lastSuccessAt ? formatDateTime(source.lastSuccessAt) : "never"}</span>
              </span>
              {canManageSources && source.status === "connected" && (
                <form action={disconnectCrawlerSourceAction}>
                  <input type="hidden" name="websiteId" value={websiteId} />
                  <input type="hidden" name="sourceId" value={source.id} />
                  <Button type="submit" variant="ghost" size="sm">Disconnect</Button>
                </form>
              )}
            </li>
          ))}
        </ul>
        {canManageSources && <div className="border-t border-line px-5 py-4"><CrawlerSourceForm websiteId={websiteId} ingestUrl={ingestUrl} /></div>}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------
// Saved external answer tests (mentions source)

export function AnswerTestForm({ websiteId, today }: { websiteId: string; today: string }) {
  return (
    <form action={recordAnswerTestAction} className="space-y-3">
      <input type="hidden" name="websiteId" value={websiteId} />
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Platform" htmlFor="test-platform">
          <Select id="test-platform" name="platform" defaultValue="chatgpt">
            {AI_PROVIDERS.map((key) => <option key={key} value={key}>{AI_PROVIDER_LABELS[key]}</option>)}
          </Select>
        </Field>
        <Field label="Tested on" htmlFor="test-date">
          <Input id="test-date" name="testedOn" type="date" defaultValue={today} required />
        </Field>
        <Field label="Clinic mentioned?" htmlFor="test-mentioned">
          <Select id="test-mentioned" name="mentioned" defaultValue="yes">
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </Select>
        </Field>
      </div>
      <Field label="Question asked" htmlFor="test-question" hint="Do not include patient details.">
        <Input id="test-question" name="question" required maxLength={300} />
      </Field>
      <Field label="Cited source (optional)" htmlFor="test-source">
        <Input id="test-source" name="citedUrl" type="url" maxLength={2048} />
      </Field>
      <Field label="Answer excerpt (optional)" htmlFor="test-excerpt">
        <Textarea id="test-excerpt" name="answerExcerpt" maxLength={1000} />
      </Field>
      <Button type="submit" variant="secondary" size="sm">Save answer test</Button>
    </form>
  );
}

// ---------------------------------------------------------------------------------------------------------
// SEO-05.2

export function NlwebPanel({ websiteId, nlweb, canEdit, canConfigure, reason }: { websiteId: string; nlweb: NlwebState; canEdit: boolean; canConfigure: boolean; reason?: string }) {
  const latest = nlweb.tests[0];
  return (
    <Card id="nlweb">
      <CardHeader title="NLWeb" description="Tests whether the website's NLWeb endpoint can answer a question from site content. Only the question you type is sent; no enquiry or patient data." />
      <div className="space-y-4 px-5 pb-5 text-sm">
        {reason && <Notice tone="warn">{reason}</Notice>}
        <p>Endpoint: {nlweb.endpointUrl ? <span className="break-all font-mono">{nlweb.endpointUrl}</span> : <Badge>Not configured</Badge>}</p>
        {canConfigure && (
          <form action={saveNlwebEndpointAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="websiteId" value={websiteId} />
            <Field label="NLWeb /ask endpoint (HTTPS on this website)" htmlFor="nlweb-endpoint">
              <Input id="nlweb-endpoint" name="endpointUrl" type="url" required defaultValue={nlweb.endpointUrl ?? ""} className="min-w-72" />
            </Field>
            <Button type="submit" variant="secondary" size="sm">Save endpoint</Button>
          </form>
        )}
        {canEdit && nlweb.endpointUrl && (
          <form action={runNlwebTestAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="websiteId" value={websiteId} />
            <Field label="Question" htmlFor="nlweb-question" hint="Up to 300 characters. Do not include patient details.">
              <Input id="nlweb-question" name="question" required maxLength={300} className="min-w-72" />
            </Field>
            <Button type="submit" size="sm">Run test</Button>
          </form>
        )}
        {!nlweb.endpointUrl && <p className="text-muted">No endpoint is configured, so no test can run.</p>}
        {latest && (
          <div className="rounded-xl border border-line p-4" data-nlweb={latest.outcome}>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={latest.outcome === "answered" ? "good" : latest.outcome === "empty" ? "warn" : "bad"}>
                {latest.outcome === "answered" ? "Answered" : latest.outcome === "empty" ? "Empty answer" : latest.outcome === "timeout" ? "Timed out" : "Error"}
              </Badge>
              <span className="text-muted">{formatDateTime(latest.testedAt)} · {latest.httpStatus === null ? "no response" : `HTTP ${latest.httpStatus}`}</span>
            </div>
            <p className="mt-2"><span className="text-muted">Question:</span> {latest.question}</p>
            {latest.answer && <p className="mt-2 whitespace-pre-wrap">{latest.answer}</p>}
            {latest.outcome === "empty" && <p className="mt-2 text-muted">The endpoint answered with no content and no sources.</p>}
            {latest.outcome === "timeout" && <p className="mt-2 text-muted">The endpoint did not answer within 10 seconds.</p>}
            {latest.outcome === "error" && <p className="mt-2 text-muted">The endpoint did not return a usable answer ({latest.errorCode}).</p>}
            {latest.sources.length > 0 && (
              <ul className="mt-2 space-y-1">
                {latest.sources.map((source) => <li key={source.url}><a className="break-all text-action hover:underline" href={source.url} target="_blank" rel="noreferrer">{source.name ?? source.url}</a></li>)}
              </ul>
            )}
          </div>
        )}
        {nlweb.tests.length > 1 && (
          <div>
            <h3 className="font-semibold">Earlier tests</h3>
            <ul className="mt-1 space-y-1" data-nlweb-history>
              {nlweb.tests.slice(1, 6).map((test, index) => (
                <li key={index}>
                  <Badge tone={test.outcome === "answered" ? "good" : test.outcome === "empty" ? "warn" : "bad"}>{test.outcome === "answered" ? "Answered" : test.outcome === "empty" ? "Empty answer" : test.outcome === "timeout" ? "Timed out" : "Error"}</Badge>{" "}
                  {formatDateTime(test.testedAt)} · {test.question}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}
