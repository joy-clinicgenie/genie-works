import Link from "next/link";
import { listClients, listConnections, listWebsites, readExchangedToken, type AccessProfile } from "@clinic-genie/db";
import { serviceTx, staffTx } from "@/lib/db";
import { Badge } from "@/components/ui/Badge";
import { buttonClass } from "@/components/ui/Button";
import { ClinicConnectionPicker } from "@/components/modules/ClinicConnectionPicker";
import { bindAnalyticsProperty, connectWix, disconnectAnalytics, importAnalyticsCsv, refreshAnalytics } from "@/app/actions/analytics";
import { listGoogleProperties } from "@/lib/analytics-properties";

const MESSAGES: Record<string, string> = {
  denied: "That action needs a registry manager.",
  not_configured: "Provider credentials are not configured on the server.",
  oauth_failed: "The provider did not complete the connection.",
  property_required: "Choose a property before connecting.",
  property_unknown: "Choose a property from the list returned by the provider.",
  traffic_exists: "This website already has a traffic source. Wix and GA4 stay separate.",
  wix_rejected: "Wix did not accept that site.",
  import_rejected: "That file was not imported. An overlap with a provider partition is kept out unless replace is chosen, and personal fields are rejected.",
  connected: "The property is connected. History already stored is unchanged.",
  disconnected: "The connection is stopped. Stored reports remain.",
  queued: "A refresh was queued for the recent window.",
  accept: "The file was accepted as an import. It does not replace a provider report.",
  overlap: "The file overlaps an existing range and was stored only because replace was selected. Provider partitions stay in place.",
  replay: "This file was already imported.",
};

export async function AnalyticsConnections({
  access,
  clientId,
  stateToken,
  notice,
}: {
  access: AccessProfile;
  clientId?: string;
  stateToken?: string;
  notice?: string;
}) {
  const googleReady = Boolean(process.env.ANALYTICS_GOOGLE_CLIENT_ID && process.env.ANALYTICS_GOOGLE_CLIENT_SECRET && process.env.ANALYTICS_TOKEN_KEY);
  const wixReady = Boolean(process.env.ANALYTICS_WIX_APP_ID && process.env.ANALYTICS_WIX_APP_SECRET && process.env.ANALYTICS_TOKEN_KEY);
  const pending = stateToken
    ? await serviceTx(async (db) => {
        const exchanged = await readExchangedToken(db, stateToken, access.user.id);
        if (!exchanged || (exchanged.provider !== "ga4" && exchanged.provider !== "gsc")) return null;
        const listed = await listGoogleProperties(exchanged.accessToken, exchanged.provider);
        return { provider: exchanged.provider, clientId: exchanged.clientId, websiteId: exchanged.websiteId, properties: listed.properties, error: listed.error };
      })
    : null;
  const requestedClientId = pending?.clientId || clientId;
  const data = await staffTx(access, async (db) => {
    const clients = await listClients(db);
    const selected = clients.find((client) => client.id === requestedClientId) ?? clients[0] ?? null;
    if (!selected) return { clients, selected: null, websites: [], connections: [] };
    return {
      clients,
      selected,
      websites: await listWebsites(db, selected.id),
      connections: await listConnections(db, selected.id),
    };
  });
  const message = notice ? MESSAGES[notice] : undefined;
  const pendingWebsite = data.websites.find((website) => website.id === pending?.websiteId);
  return (
    <div className="border-t border-line px-5 py-5">
      <h3 className="text-sm font-semibold text-ink">Analytics providers</h3>
      <p className="mt-1 text-sm text-ink-soft">One traffic source per website. Search Console can sit beside it. Tokens stay on the server.</p>
      {message && <p className="mt-3 text-sm text-ink">{message}</p>}
      {!googleReady && !wixReady && <p className="mt-3 text-sm text-ink-soft">Not configured. Add the provider credentials on the server before connecting a clinic.</p>}
      <ClinicConnectionPicker key={data.selected?.id ?? "none"} clients={data.clients.map((client) => ({ id: client.id, name: client.name }))} selected={data.selected?.id ?? ""} />
      {data.selected && data.websites.length === 0 && <p className="mt-4 text-sm text-ink-soft">This clinic has no website yet.</p>}
      {data.websites.map((website) => {
        const rows = data.connections.filter((connection) => connection.website_id === website.id && connection.disconnected_at === null);
        const wixSite = website.platform.toLowerCase().includes("wix");
        return (
          <section key={website.id} className="mt-4 rounded-xl border border-line p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold text-ink">{website.name}</h4>
                <p className="text-sm text-ink-soft">{website.url ?? "No public URL"}</p>
              </div>
              <form action={refreshAnalytics}>
                <input type="hidden" name="clientId" value={data.selected?.id} />
                <input type="hidden" name="websiteId" value={website.id} />
                <button className={buttonClass("secondary", "sm")} type="submit">Refresh recent window</button>
              </form>
            </div>
            {rows.length === 0 && <p className="mt-3 text-sm text-ink-soft">Not connected.</p>}
            <ul className="mt-3 space-y-2">
              {rows.map((connection) => (
                <li key={connection.id} className="flex flex-wrap items-center justify-between gap-3 text-sm">
                  <span className="text-ink">{connection.provider.toUpperCase()} · {connection.external_property_id}</span>
                  <span className="flex items-center gap-2">
                    <Badge tone={connection.status === "connected" ? "good" : "warn"}>{connection.status === "reconnect_required" ? "Reconnect required" : connection.status}</Badge>
                    <form action={disconnectAnalytics}>
                      <input type="hidden" name="connectionId" value={connection.id} />
                      <input type="hidden" name="clientId" value={data.selected?.id} />
                      <button className={buttonClass("secondary", "sm")} type="submit">Disconnect</button>
                    </form>
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex flex-wrap gap-2">
              {googleReady && <Link className={buttonClass("secondary", "sm")} href={`/api/analytics/google/start?client=${data.selected?.id}&website=${website.id}&provider=ga4`}>Connect GA4</Link>}
              {googleReady && <Link className={buttonClass("secondary", "sm")} href={`/api/analytics/google/start?client=${data.selected?.id}&website=${website.id}&provider=gsc`}>Connect Search Console</Link>}
            </div>
            {wixSite && wixReady && (
              <form action={connectWix} className="mt-3 flex flex-wrap items-end gap-2">
                <input type="hidden" name="clientId" value={data.selected?.id} />
                <input type="hidden" name="websiteId" value={website.id} />
                <label className="text-sm text-ink">
                  Wix site instance
                  <input name="instanceId" required maxLength={200} className="mt-1 block min-h-10 rounded-xl border border-line px-3 text-sm" />
                </label>
                <button className={buttonClass("secondary", "sm")} type="submit">Connect Wix</button>
              </form>
            )}
            {wixSite && <p className="mt-2 text-xs text-muted">The Wix app needs scope SCOPE.DC-ANALYTICS-AND-REPORTS.READ-SITE-ANALYTICS. There is no Wix user sign-in step.</p>}
          </section>
        );
      })}
      {pending && (
        <form action={bindAnalyticsProperty} className="mt-4 rounded-xl border border-line p-4">
          <h4 className="text-sm font-semibold text-ink">Choose the {pending.provider === "gsc" ? "Search Console" : "GA4"} property{pendingWebsite ? ` for ${pendingWebsite.name}` : ""}</h4>
          <p className="mt-1 text-sm text-ink-soft">{data.selected?.name}{pendingWebsite ? ` · ${pendingWebsite.name}` : ""}</p>
          {pending.error && <p className="mt-2 text-sm text-ink-soft">{pending.error}</p>}
          <input type="hidden" name="state" value={stateToken} />
          <div className="mt-3 space-y-2">
            {pending.properties.map((property) => (
              <label key={property.id} className="flex items-center gap-2 text-sm text-ink">
                <input type="radio" name="propertyId" value={property.id} required />
                {property.label}
              </label>
            ))}
          </div>
          <button className={`${buttonClass("primary", "sm")} mt-3`} type="submit">Use this property</button>
        </form>
      )}
      {data.selected && data.websites[0] && (
        <form action={importAnalyticsCsv} className="mt-4">
          <h4 className="text-sm font-semibold text-ink">Import a metric file</h4>
          <p className="mt-1 text-sm text-ink-soft">Columns are date, metric and value. A file that overlaps a provider partition is rejected unless replace is selected, and even then the provider rows stay.</p>
          <input type="hidden" name="clientId" value={data.selected.id} />
          <input type="hidden" name="websiteId" value={data.websites[0].id} />
          <textarea name="csv" required rows={4} className="mt-2 w-full rounded-xl border border-line px-3 py-2 text-sm" placeholder={"date,metric,value"} />
          <label className="mt-2 flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" name="replace" />
            Replace overlap
          </label>
          <button className={`${buttonClass("secondary", "sm")} mt-3`} type="submit">Preview and store</button>
        </form>
      )}
    </div>
  );
}
