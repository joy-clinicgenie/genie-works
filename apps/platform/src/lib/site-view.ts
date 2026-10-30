import { getClient, listAccountReferences, listClients, listSnapshotClientIds, listSnapshots, listWebsites, type AccessProfile, type AccountReferenceRow, type SnapshotRow, type WebsiteRow } from "@clinic-genie/db";
import { staffTx } from "@/lib/db";
import { alignRecordedPeriod, latestUpdate, matchedPeriods, day, type PeriodWindow } from "@/lib/site-metrics";

export interface SiteView {
  clients: Array<{ id: string; name: string; referenceNumber: string | null }>;
  clientId: string;
  clientName: string;
  clientReference: string | null;
  clientSpecialty: string | null;
  clientSlug: string;
  enquiryOwnerName: string | null;
  notificationOwnerName: string | null;
  websiteUrl: string | null;
  websiteId: string | null;
  websiteCleared: boolean;
  snapshots: SnapshotRow[];
  references: AccountReferenceRow[];
  current?: PeriodWindow;
  previous?: PeriodWindow;
  updatedAt: Date | null;
}

export async function loadSiteView(access: AccessProfile, requestedId?: string, windows?: { current: PeriodWindow; previous: PeriodWindow }, exact = false, requestedWebsiteId?: string): Promise<SiteView | "denied" | null> {
  return staffTx(access, async (db) => {
    const clients = await listClients(db);
    if (requestedId && !clients.some((client) => client.id === requestedId)) {
      const requested = await getClient(db, requestedId);
      if (!requested) return "denied";
      clients.unshift(requested);
    }
    if (clients.length === 0) return null;
    const withSessions = new Set(await listSnapshotClientIds(db, "sessions"));
    const chosen = clients.find((client) => client.id === requestedId) ?? clients.find((client) => withSessions.has(client.id)) ?? clients[0]!;
    const snapshots = await listSnapshots(db, { clientId: chosen.id, limit: 20000 });
    const websites = await listWebsites(db, chosen.id);
    const references = await listAccountReferences(db, chosen.id);
    const requestedSite = requestedWebsiteId ? websites.find((item: WebsiteRow) => item.id === requestedWebsiteId) : undefined;
    const site = requestedSite ?? websites.find((item: WebsiteRow) => item.environment === "production" && item.url) ?? websites.find((item: WebsiteRow) => item.url);
    const periods = windows ? alignRecordedPeriod(snapshots, windows, exact) : matchedPeriods(snapshots);
    const inWindow = snapshots.filter((row) => {
      const start = day(row.period_start);
      const end = day(row.period_end);
      return (periods.current && start === periods.current.start && end === periods.current.end) || (periods.previous && start === periods.previous.start && end === periods.previous.end);
    });
    return {
      clients: clients.map((client) => ({ id: client.id, name: client.name, referenceNumber: client.reference_number })),
      clientId: chosen.id,
      clientName: chosen.name,
      clientReference: chosen.reference_number,
      clientSpecialty: chosen.specialty,
      clientSlug: chosen.slug,
      enquiryOwnerName: chosen.enquiry_owner_name,
      notificationOwnerName: chosen.notification_owner_name,
      websiteUrl: site?.url ?? null,
      websiteId: site?.id ?? null,
      websiteCleared: Boolean(requestedWebsiteId) && !requestedSite,
      snapshots,
      references,
      current: periods.current,
      previous: periods.previous,
      updatedAt: latestUpdate(inWindow),
    };
  });
}
