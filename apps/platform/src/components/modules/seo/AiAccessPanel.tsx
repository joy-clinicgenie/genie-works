import { AI_CRAWLERS, formatDateTime, type AiAccessCheckRow, type CrawlerReading, type FileStatus } from "@clinic-genie/db";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Notice } from "@/components/ui/Notice";
import { Table, Td, Th } from "@/components/ui/Table";
import { runAiAccessCheckAction } from "@/app/actions/seo";

const VERDICT: Record<CrawlerReading["verdict"], [string, Tone]> = {
  allowed: ["Allowed", "good"],
  blocked: ["Blocked", "warn"],
  unknown: ["Unknown", "neutral"],
};

const RULE: Record<CrawlerReading["rule"], string> = {
  named: "A rule names this crawler",
  default: "Default rule for all crawlers (*)",
  no_file: "No robots.txt, so nothing is restricted",
  none: "robots.txt could not be read",
};

const FILE: Record<FileStatus, [string, Tone]> = {
  found: ["Found", "good"],
  missing: ["Not found", "warn"],
  not_text: ["Not plain text", "warn"],
  error: ["Could not be read", "bad"],
};

const NOTICES: Record<string, [Tone, string]> = {
  checked: ["good", "Check saved. The results below are what the website returned just now."],
  unreachable: ["warn", "Check saved, but neither file could be read. The website may be down or refusing the request."],
  "no-address": ["warn", "This website has no public https address in its record. Add one on the client profile, then run the check."],
  "not-saved": ["bad", "The check ran but was not saved. Nothing has changed."],
  denied: ["bad", "You cannot run a check for this website."],
};

const ERROR_TEXT: Record<string, string> = {
  timeout: "The website took longer than 10 seconds to answer.",
  network: "The website could not be reached.",
  dns_failed: "The website's host name did not resolve.",
  refused_address: "The host resolves to a private address, so it was not read.",
  refused_host: "A redirect left the website, so it was not followed.",
  refused_scheme: "A redirect left https, so it was not followed.",
  too_large: "A file was larger than 512 KB.",
  too_many_redirects: "More than three redirects.",
  bad_redirect: "A redirect had no destination.",
};

function FileBadge({ status }: { status: FileStatus }) {
  const [text, tone] = FILE[status];
  return <Badge tone={tone}>{text}</Badge>;
}

function bytes(n: number | null): string {
  if (n === null) return "";
  return n < 1024 ? `${n} bytes` : `${(n / 1024).toFixed(1)} KB`;
}

export function AiAccessPanel({ clientId, websiteId, canCheck, checks, notice }: {
  clientId: string;
  websiteId: string;
  canCheck: boolean;
  checks: AiAccessCheckRow[];
  notice?: string;
}) {
  const latest = checks[0];
  const message = notice ? NOTICES[notice] : undefined;
  const byAgent = new Map((latest?.crawlers ?? []).map((c) => [c.agent, c]));
  const allowed = latest?.crawlers.filter((c) => c.verdict === "allowed").length ?? 0;
  return (
    <div className="space-y-4">
      {message && <Notice tone={message[0]}>{message[1]}</Notice>}
      <Card>
        <CardHeader
          title="AI crawler access"
          description="Reads robots.txt and llms.txt from the website address in its record. This shows what the site permits. It is not a crawler log and cannot show a visit or a citation."
          action={canCheck ? (
            <form action={runAiAccessCheckAction}>
              <input type="hidden" name="clientId" value={clientId} />
              <input type="hidden" name="websiteId" value={websiteId} />
              <Button type="submit">Run AI access check</Button>
            </form>
          ) : <Button type="button" disabled title="Admins, managers and specialist members can run this check.">Run AI access check</Button>}
        />
        {!latest ? (
          <p className="px-5 pb-5 text-sm text-muted">Not checked yet. A missing check does not mean crawlers are blocked.</p>
        ) : (
          <div className="space-y-4 pb-5">
            <dl className="grid gap-3 px-5 text-sm sm:grid-cols-3">
              <div><dt className="text-xs uppercase text-muted">Checked</dt><dd>{formatDateTime(latest.checkedAt)} by {latest.checkedByName ?? "a staff member"}</dd></div>
              <div><dt className="text-xs uppercase text-muted">Website</dt><dd className="break-all">{latest.origin}</dd></div>
              <div><dt className="text-xs uppercase text-muted">Home page allowed</dt><dd>{latest.robotsStatus === "error" || latest.robotsStatus === "not_text" ? "Unknown" : `${allowed} of ${latest.crawlers.length} crawlers`}</dd></div>
            </dl>
            {latest.safeErrorCode && <p className="px-5 text-sm text-warn">{ERROR_TEXT[latest.safeErrorCode] ?? "The website could not be read."}</p>}
            <Table caption="AI crawler access from robots.txt">
              <thead><tr><Th>Crawler</Th><Th>Operator</Th><Th>Used for</Th><Th>Home page</Th><Th>Why</Th></tr></thead>
              <tbody>
                {AI_CRAWLERS.map((crawler) => {
                  const reading = byAgent.get(crawler.agent);
                  const [text, tone] = VERDICT[reading?.verdict ?? "unknown"];
                  return (
                    <tr key={crawler.agent}>
                      <Td className="font-medium">{crawler.agent}</Td>
                      <Td>{crawler.operator}</Td>
                      <Td className="text-muted">{crawler.purpose}</Td>
                      <Td><Badge tone={tone}>{text}</Badge></Td>
                      <Td className="text-muted">{RULE[reading?.rule ?? "none"]}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        )}
      </Card>

      <Card className="p-5">
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-semibold">llms.txt</h2>
          {latest ? <FileBadge status={latest.llmsStatus} /> : <Badge>Not checked</Badge>}
        </div>
        <p className="mt-1 text-sm text-muted">
          A plain-text guide to the site for AI assistants. It is read here, not edited.
          {latest?.llmsStatus === "found" && <> Size {bytes(latest.llmsBytes)}. <a href={`${latest.origin}/llms.txt`} target="_blank" rel="noreferrer" className="text-action hover:underline">Open llms.txt</a></>}
          {latest?.llmsStatus === "not_text" && " The address answered with a web page, not a text file."}
        </p>
      </Card>

      {checks.length > 1 && (
        <Card>
          <CardHeader title="Earlier checks" description="Each run is kept. Older checks cannot be changed." />
          <Table caption="Earlier AI access checks">
            <thead><tr><Th>Checked</Th><Th>robots.txt</Th><Th>llms.txt</Th><Th>Allowed</Th></tr></thead>
            <tbody>
              {checks.slice(1).map((row) => (
                <tr key={row.id}>
                  <Td>{formatDateTime(row.checkedAt)} · {row.checkedByName ?? "staff"}</Td>
                  <Td><FileBadge status={row.robotsStatus} /></Td>
                  <Td><FileBadge status={row.llmsStatus} /></Td>
                  <Td className="num">{row.crawlers.filter((c) => c.verdict === "allowed").length} of {row.crawlers.length}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
