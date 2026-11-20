import type { ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock, MinusCircle } from "lucide-react";
import {
  canManageRegistry,
  canPublishClient,
  canWriteConnectionSecrets,
  formatDateTime,
  isSettingsApiPlatform,
  isWixPlatform,
  loadWebsiteConnections,
  type AccessProfile,
  type WebsiteConnectionCard,
} from "@clinic-genie/db";
import { staffTx } from "@/lib/db";
import { Badge } from "@/components/ui/Badge";
import { buttonClass } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Notice } from "@/components/ui/Notice";
import { safeErrorText } from "@/components/modules/AnalyticsConnections";
import { SeoSiteSettingsEditor } from "@/components/modules/SeoSoftLaunchForms";
import { ConnectionCheckButton } from "@/components/modules/seo/ConnectionCheckButton";
import { Unavailable } from "@/components/modules/seo/SeoFrame";
import { disconnectConnectionAction, reconnectConnectionAction, retrySyncJobsAction } from "@/app/actions/seo-connections";
import { checkFollowUp, checkOutcomeText, connectionDisplay, searchConsoleUrl } from "@/lib/seo-scope";
import type { SeoSite } from "@/lib/seo-workspace";

const NOTICES: Record<string, string> = {
  disconnected: "The connection is stopped. Stored reports and the last successful sync stay.",
  retry_queued: "Permanently failed sync jobs were queued for a new bounded attempt.",
  retry_unavailable: "No permanently failed sync job was eligible for retry.",
  secret_denied: "Changing a connection needs an administrator.",
  unavailable: "That connection is not available for this website.",
  reconnect_not_needed: "That connection does not need a reconnect. Check it instead.",
};

const ICONS = { check: CheckCircle2, alert: AlertTriangle, minus: MinusCircle, clock: Clock } as const;

const GOOGLE_SETTINGS = "ANALYTICS_GOOGLE_CLIENT_ID, ANALYTICS_GOOGLE_CLIENT_SECRET and ANALYTICS_TOKEN_KEY";
const WIX_SETTINGS = "ANALYTICS_WIX_APP_ID, ANALYTICS_WIX_APP_SECRET and ANALYTICS_TOKEN_KEY";

function sourceText(card: WebsiteConnectionCard): string {
  switch (card.provider) {
    case "gsc":
      return "Google Search Console, authorised with a Google account by an administrator";
    case "ga4":
      return "Google Analytics 4, authorised with a Google account by an administrator";
    case "wix":
      return "Wix app installed on the site";
    case "settings_api":
      return "Website settings API credential";
    default:
      return "None recorded";
  }
}

function StatusBadge({ card }: { card: WebsiteConnectionCard }) {
  const display = connectionDisplay(card);
  const Icon = ICONS[display.icon];
  return (
    <Badge tone={display.tone} className="inline-flex items-center gap-1">
      <Icon className="size-3.5" aria-hidden="true" />
      {display.label}
    </Badge>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase text-muted">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

function HiddenIds({ websiteId, connectionId }: { websiteId: string; connectionId: string }) {
  return (
    <>
      <input type="hidden" name="websiteId" value={websiteId} />
      <input type="hidden" name="connectionId" value={connectionId} />
    </>
  );
}

function ConnectionCard({
  title,
  testId,
  card,
  websiteId,
  canCheck,
  canManage,
  serverReady,
  serverSettings,
  connect,
  children,
}: {
  title: string;
  testId: string;
  card: WebsiteConnectionCard;
  websiteId: string;
  canCheck: boolean;
  canManage: boolean;
  serverReady: boolean;
  serverSettings: string;
  connect?: ReactNode;
  children?: ReactNode;
}) {
  const active = card.connectionId !== null && card.state !== "disconnected";
  const recorded = card.connectionId !== null;
  const followUp = card.lastCheck ? checkFollowUp(card.lastCheck.outcome, card.provider) : null;
  const showSearchConsole = card.provider === "gsc" && followUp === "search_console";
  return (
    <Card className="p-5" id={`connection-${testId}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="font-semibold">{title}</h2>
        <StatusBadge card={card} />
      </div>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
        <Detail label="Mapped property">{card.property ?? "None mapped"}</Detail>
        <Detail label="Source">{sourceText(card)}</Detail>
        {recorded && <Detail label="Access verified">{card.verifiedAt ? formatDateTime(card.verifiedAt) : "Not verified"}</Detail>}
        {recorded && <Detail label="Last successful sync">{card.lastSuccessAt ? formatDateTime(card.lastSuccessAt) : "No successful sync recorded"}</Detail>}
        {card.lastCheck && (
          <Detail label="Last connection check">
            {formatDateTime(card.lastCheck.at)}. {checkOutcomeText(card.lastCheck.outcome, card.provider)}
          </Detail>
        )}
      </dl>
      {active && card.syncError && <p className="mt-3 text-sm text-ink">Sync: {safeErrorText(card.syncError)}</p>}
      {active && card.failedJobs > 0 && <p className="mt-1 text-sm text-ink">{card.failedJobs} sync job(s) failed permanently.</p>}
      {showSearchConsole && (
        <p className="mt-3 text-sm">
          <a href={searchConsoleUrl(card.property)} target="_blank" rel="noreferrer" className="text-action hover:underline">Open Search Console to verify ownership or grant access</a>
        </p>
      )}
      {!serverReady && <p className="mt-3 text-sm text-muted">Needed to verify: the server settings {serverSettings}. They are not configured, so a check will report that.</p>}
      {children}
      <div className="mt-4 flex flex-wrap items-start gap-2">
        {active && canCheck && <ConnectionCheckButton websiteId={websiteId} connectionId={card.connectionId!} provider={card.provider} />}
        {active && canManage && card.state === "reconnect_required" && (
          <form action={reconnectConnectionAction}>
            <HiddenIds websiteId={websiteId} connectionId={card.connectionId!} />
            <button className={buttonClass("primary", "sm")} type="submit">Reconnect</button>
          </form>
        )}
        {active && canManage && card.state === "connected" && card.failedJobs > 0 && (
          <form action={retrySyncJobsAction}>
            <HiddenIds websiteId={websiteId} connectionId={card.connectionId!} />
            <button className={buttonClass("secondary", "sm")} type="submit">Retry failed sync jobs</button>
          </form>
        )}
        {active && canManage && (
          <form action={disconnectConnectionAction}>
            <HiddenIds websiteId={websiteId} connectionId={card.connectionId!} />
            <button className={buttonClass("ghost", "sm")} type="submit">Disconnect</button>
          </form>
        )}
        {!active && canManage && connect}
      </div>
      {!canCheck && active && <p className="mt-2 text-xs text-muted">Checking a connection stays with an administrator or manager.</p>}
    </Card>
  );
}

/**
 * SEO-08.1 Website Connections for the selected website and environment (D60). Status, source and last
 * successful sync come from the connection records; a check tests access and never changes the sync time.
 */
export async function WebsiteConnectionsPanel({ access, site, verification, settingsApiConnected, notice }: {
  access: AccessProfile;
  site: SeoSite;
  verification: string | null;
  settingsApiConnected: boolean;
  notice?: string;
}) {
  const data = await staffTx(access, (db) => loadWebsiteConnections(db, site.id));
  if (!data) return <Notice tone="neutral" title="Connections unavailable">This website is not available to you.</Notice>;
  const canCheck = canManageRegistry(access);
  const canManage = canWriteConnectionSecrets(access);
  const tokenKey = Boolean(process.env.ANALYTICS_TOKEN_KEY);
  const googleReady = Boolean(process.env.ANALYTICS_GOOGLE_CLIENT_ID && process.env.ANALYTICS_GOOGLE_CLIENT_SECRET && tokenKey);
  const wixReady = Boolean(process.env.ANALYTICS_WIX_APP_ID && process.env.ANALYTICS_WIX_APP_SECRET && tokenKey);
  const wixSite = isWixPlatform(site.platform);
  const googleConnect = (provider: "gsc" | "ga4", text: string) => googleReady
    ? <Link className={buttonClass("secondary", "sm")} href={`/api/analytics/google/start?${new URLSearchParams({ client: site.clientId, website: site.id, provider })}`}>{text}</Link>
    : <p className="text-sm text-muted">Connecting needs the server settings {GOOGLE_SETTINGS}.</p>;
  const wixConnect = <Link className={buttonClass("secondary", "sm")} href={`/settings?${new URLSearchParams({ client: site.clientId })}`}>Connect Wix in Settings</Link>;
  const { platform, search, analytics } = data.cards;
  const message = notice ? NOTICES[notice] : undefined;
  return (
    <div className="space-y-4">
      {message && <Notice tone="neutral">{message}</Notice>}
      <p className="text-sm text-muted">Each connection is shown and checked on its own. A connection check tests access only. It does not fetch reports, so it never changes the last successful sync.</p>

      <ConnectionCard
        title={`Website platform · ${site.platform}`}
        testId="platform"
        card={platform}
        websiteId={site.id}
        canCheck={canCheck}
        canManage={canManage}
        serverReady={!wixSite || wixReady}
        serverSettings={WIX_SETTINGS}
        connect={wixSite ? wixConnect : undefined}
      >
        {platform.provider === "settings_api" && (
          <p className="mt-3 text-sm text-muted">
            Credential issued {platform.issuedAt ? formatDateTime(platform.issuedAt) : ""}. Genie Works does not record when the website reads its settings, so access cannot be verified here. Needed to verify: a record of the website&apos;s settings API requests.
          </p>
        )}
        {platform.provider === null && !wixSite && !isSettingsApiPlatform(site.platform) && (
          <p className="mt-3 text-sm text-muted">Genie Works has no supported connection route for this platform, so it cannot verify it.</p>
        )}
        {platform.provider === null && wixSite && <p className="mt-3 text-sm text-muted">No Wix app connection is recorded for this website.</p>}
        {platform.provider === null && isSettingsApiPlatform(site.platform) && <p className="mt-3 text-sm text-muted">No website settings API credential is issued for this website. An administrator or editor can issue one below.</p>}
        {isSettingsApiPlatform(site.platform) && (
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-medium">Website settings API credential</summary>
            <div className="mt-3">
              <SeoSiteSettingsEditor clientId={site.clientId} website={site} settings={[]} verificationToken={verification} connected={settingsApiConnected} canManageIntegration={canManage} canPublish={canPublishClient(access, site.clientId)} section="connection" />
            </div>
          </details>
        )}
      </ConnectionCard>

      <ConnectionCard
        title="Google Search Console"
        testId="search"
        card={search}
        websiteId={site.id}
        canCheck={canCheck}
        canManage={canManage}
        serverReady={googleReady}
        serverSettings={GOOGLE_SETTINGS}
        connect={googleConnect("gsc", search.state === "disconnected" ? "Connect Search Console again" : "Connect Search Console")}
      >
        {search.state === "not_connected" && <p className="mt-3 text-sm text-muted">No Search Console property is mapped to this website and environment.</p>}
      </ConnectionCard>

      <ConnectionCard
        title={analytics.provider === "wix" ? "Analytics · Wix" : "Analytics · Google Analytics 4"}
        testId="analytics"
        card={analytics}
        websiteId={site.id}
        canCheck={canCheck}
        canManage={canManage}
        serverReady={analytics.provider === "wix" ? wixReady : googleReady}
        serverSettings={analytics.provider === "wix" ? WIX_SETTINGS : GOOGLE_SETTINGS}
        connect={<>{googleConnect("ga4", analytics.state === "disconnected" ? "Connect GA4 again" : "Connect GA4")}{wixSite && wixConnect}</>}
      >
        {analytics.state === "not_connected" && <p className="mt-3 text-sm text-muted">No analytics property is mapped to this website and environment. One traffic source (GA4 or Wix) is allowed per website.</p>}
        {analytics.provider === "wix" && platform.connectionId === analytics.connectionId && <p className="mt-3 text-sm text-muted">The Wix app connection is also this website&apos;s analytics source.</p>}
      </ConnectionCard>

      <Unavailable title="Other providers">Keyword research, AI referral analytics, crawler logs, AI test providers and deployment access beyond the settings API are not connected. Account switching is unavailable.</Unavailable>
    </div>
  );
}
