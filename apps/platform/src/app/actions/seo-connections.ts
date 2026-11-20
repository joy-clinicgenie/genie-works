"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  canManageRegistry,
  canWriteConnectionSecrets,
  disconnectConnection,
  loadConnectionCheckTarget,
  loadWebsiteConnections,
  probeConnection,
  recordConnectionCheck,
  retryFailedAnalyticsJobs,
  type AccessProfile,
  type ConnectionCheckOutcome,
  type WebsiteConnectionCard,
  type WebsiteConnections,
} from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { serviceTx, staffTx } from "@/lib/db";
import { str } from "@/lib/actions";
import { providerFetch } from "@/lib/provider-fetch";
import { isWebsiteId } from "@/lib/seo-scope";

export type ConnectionCheckResult =
  | { ok: true; websiteId: string; connectionId: string; outcome: ConnectionCheckOutcome; checkedAt: string }
  | { ok: false; websiteId: string; connectionId: string; error: string };

const SETTINGS = "/seo/settings";

/**
 * Resolves the website and one of its connections for this staff member (SEO-08.1, D60). Row-level security
 * decides readability, so another clinic's website returns nothing.
 */
async function scopedConnection(access: AccessProfile, websiteId: string, connectionId: string): Promise<{ site: WebsiteConnections; card: WebsiteConnectionCard } | null> {
  if (!isWebsiteId(websiteId) || !isWebsiteId(connectionId)) return null;
  const site = await staffTx(access, (db) => loadWebsiteConnections(db, websiteId));
  if (!site) return null;
  const card = Object.values(site.cards).find((item) => item.connectionId === connectionId && item.state !== "disconnected");
  return card ? { site, card } : null;
}

function back(websiteId: string, notice: string): never {
  const params = new URLSearchParams({ website: websiteId, tab: "connections", connections: notice });
  redirect(`${SETTINGS}?${params}`);
}

/** Checks one connection with its stored credential. Administrator or manager; never writes a sync run. */
export async function checkConnectionAction(input: { websiteId: string; connectionId: string }): Promise<ConnectionCheckResult> {
  const { websiteId, connectionId } = input;
  const access = await requireAccess();
  if (!canManageRegistry(access)) return { ok: false, websiteId, connectionId, error: "Checking a connection needs an administrator or manager." };
  const scoped = await scopedConnection(access, websiteId, connectionId);
  if (!scoped) return { ok: false, websiteId, connectionId, error: "That connection is not available for this website." };
  const target = await serviceTx((db) => loadConnectionCheckTarget(db, { websiteId, connectionId }));
  if (!target) return { ok: false, websiteId, connectionId, error: "That connection was disconnected. Refresh the page." };
  // Provider I/O stays outside a database transaction.
  const outcome = await probeConnection(target, {
    fetch: providerFetch(),
    now: new Date(),
    googleClientId: process.env.ANALYTICS_GOOGLE_CLIENT_ID,
    googleClientSecret: process.env.ANALYTICS_GOOGLE_CLIENT_SECRET,
    wixAppId: process.env.ANALYTICS_WIX_APP_ID,
    wixAppSecret: process.env.ANALYTICS_WIX_APP_SECRET,
  });
  const recorded = await serviceTx((db) => recordConnectionCheck(db, { websiteId, connectionId, outcome, actorUserId: access.user.id }));
  revalidatePath(SETTINGS);
  if (!recorded) return { ok: false, websiteId, connectionId, error: "That connection was disconnected while it was being checked." };
  return { ok: true, websiteId, connectionId, outcome, checkedAt: recorded.checkedAt.toISOString() };
}

/**
 * Reconnect is offered only when the stored credential was rejected. The connection is disconnected with the
 * existing audited disconnect, then the existing connection flow starts. Administrator only.
 */
export async function reconnectConnectionAction(formData: FormData): Promise<void> {
  const websiteId = str(formData, "websiteId");
  const connectionId = str(formData, "connectionId");
  const access = await requireAccess();
  if (!canWriteConnectionSecrets(access)) back(websiteId, "secret_denied");
  const scoped = await scopedConnection(access, websiteId, connectionId);
  if (!scoped) back(websiteId, "unavailable");
  if (scoped.card.state !== "reconnect_required") back(websiteId, "reconnect_not_needed");
  await serviceTx((db) => disconnectConnection(db, { connectionId, actorUserId: access.user.id }));
  revalidatePath(SETTINGS);
  if (scoped.card.provider === "wix") redirect(`/settings?${new URLSearchParams({ client: scoped.site.clientId })}`);
  const provider = scoped.card.provider === "gsc" ? "gsc" : "ga4";
  redirect(`/api/analytics/google/start?${new URLSearchParams({ client: scoped.site.clientId, website: websiteId, provider })}`);
}

/** Stops one connection with the existing audited disconnect. Stored reports and sync history stay. Administrator only. */
export async function disconnectConnectionAction(formData: FormData): Promise<void> {
  const websiteId = str(formData, "websiteId");
  const connectionId = str(formData, "connectionId");
  const access = await requireAccess();
  if (!canWriteConnectionSecrets(access)) back(websiteId, "secret_denied");
  const scoped = await scopedConnection(access, websiteId, connectionId);
  if (!scoped) back(websiteId, "unavailable");
  await serviceTx((db) => disconnectConnection(db, { connectionId, actorUserId: access.user.id }));
  revalidatePath(SETTINGS);
  revalidatePath("/analytics");
  back(websiteId, "disconnected");
}

/** Puts permanently failed sync jobs back in the queue with the existing audited retry. Administrator only. */
export async function retrySyncJobsAction(formData: FormData): Promise<void> {
  const websiteId = str(formData, "websiteId");
  const connectionId = str(formData, "connectionId");
  const access = await requireAccess();
  if (!canWriteConnectionSecrets(access)) back(websiteId, "secret_denied");
  const scoped = await scopedConnection(access, websiteId, connectionId);
  if (!scoped) back(websiteId, "unavailable");
  const retried = await serviceTx((db) => retryFailedAnalyticsJobs(db, { connectionId, actorUserId: access.user.id }));
  revalidatePath(SETTINGS);
  back(websiteId, retried > 0 ? "retry_queued" : "retry_unavailable");
}
