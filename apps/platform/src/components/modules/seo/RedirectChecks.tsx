import { formatDateTime, type RedirectCheckRow } from "@clinic-genie/db";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { checkRedirectAction } from "@/app/actions/seo-technical";
import { redirectFailureText } from "@/lib/technical-seo-view";

/** SEO-04.4: an old path and the expected destination, both on the selected website. */
export function RedirectCheckForm({ websiteId, sourcePath, expectedPath }: { websiteId: string; sourcePath: string; expectedPath: string }) {
  return (
    <form id="check-redirect" action={checkRedirectAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="websiteId" value={websiteId} />
      <Field label="Old path" htmlFor="check-source">
        <Input id="check-source" name="sourcePath" defaultValue={sourcePath} required maxLength={500} placeholder="/old-page" />
      </Field>
      <Field label="Expected destination" htmlFor="check-expected">
        <Input id="check-expected" name="expectedPath" defaultValue={expectedPath} required maxLength={500} placeholder="/new-page" />
      </Field>
      <Button type="submit" variant="secondary" size="sm">Check redirect</Button>
    </form>
  );
}

/** The latest result with each hop, the failing hop marked, and a recheck for after a site-side fix. */
export function RedirectCheckResult({ check, websiteId, canCheck, highlight }: { check: RedirectCheckRow; websiteId: string; canCheck: boolean; highlight: boolean }) {
  const passed = check.result === "passed";
  const temporary = check.hops.filter((hop) => hop.status === 302 || hop.status === 303 || hop.status === 307).length;
  return (
    <div className={`space-y-2 text-sm ${highlight ? "rounded-xl bg-brand-pale/40 p-3" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={passed ? "good" : "bad"}>{passed ? "Passed" : "Failed"}</Badge>
        <span className="font-mono break-all">{check.sourcePath}</span>
        <span className="text-muted">expected</span>
        <span className="font-mono break-all">{check.expectedPath}</span>
        <span className="text-muted">· checked {formatDateTime(check.checkedAt)}</span>
      </div>
      <p>{redirectFailureText(check.failure)}{passed && temporary > 0 ? ` ${temporary} hop(s) use a temporary redirect; a permanent redirect (301 or 308) is usual for a moved page.` : ""}</p>
      <p className="text-muted break-all">Actual destination: {check.finalUrl ?? "None reached"} · Final status: {check.finalStatus ?? "None"}</p>
      <ol className="space-y-1">
        {check.hops.map((hop, index) => (
          <li key={`${index}-${hop.url}`} data-hop={index} className={check.failingHop === index ? "font-medium text-bad" : ""}>
            {index + 1}. <span className="break-all">{hop.url}</span> → {hop.status ?? "no response"}
            {hop.location ? <> · Location <span className="break-all">{hop.location}</span></> : null}
            {check.failingHop === index ? " · this hop" : ""}
          </li>
        ))}
      </ol>
      {canCheck && (
        <form action={checkRedirectAction}>
          <input type="hidden" name="websiteId" value={websiteId} />
          <input type="hidden" name="sourcePath" value={check.sourcePath} />
          <input type="hidden" name="expectedPath" value={check.expectedPath} />
          <Button type="submit" variant="ghost" size="sm">Recheck</Button>
        </form>
      )}
    </div>
  );
}
