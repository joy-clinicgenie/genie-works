"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  AnalyticsRuleError,
  PermissionDeniedError,
  bindConnectionFromState,
  canManageRegistry,
  enqueueRangeJobs,
  canWriteConnectionSecrets,
  disconnectConnection,
  enqueueDue,
  listConnections,
  listWebsites,
  readExchangedToken,
  recordImport,
  retryFailedAnalyticsJobs,
  setSourcePolicy,
  todaySgt,
} from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { serviceTx, staffTx } from "@/lib/db";
import { str } from "@/lib/actions";
import { listGoogleProperties } from "@/lib/analytics-properties";
import { customWindow } from "@/lib/period-range";

function fail(code: string, clientId?: string): never {
  const params = new URLSearchParams({ analyticsError: code });
  if (clientId) params.set("client", clientId);
  redirect(`/settings?${params}`);
}

function done(code: string, clientId?: string): never {
  const params = new URLSearchParams({ analytics: code });
  if (clientId) params.set("client", clientId);
  redirect(`/settings?${params}`);
}

async function managerWebsite(clientId: string, websiteId: string) {
  const access = await requireAccess();
  if (!canManageRegistry(access)) fail("denied", clientId);
  const website = await staffTx(access, async (db) => (await listWebsites(db, clientId)).find((row) => row.id === websiteId) ?? null);
  if (!website) fail("denied", clientId);
  return { access, website };
}

export async function bindAnalyticsProperty(formData: FormData) {
  const access = await requireAccess();
  if (!canWriteConnectionSecrets(access)) fail("secret_denied");
  const state = str(formData, "state");
  const propertyId = str(formData, "propertyId");
  if (!state || !propertyId) fail("property_required");
  const pending = await serviceTx((db) => readExchangedToken(db, state, access.user.id));
  if (!pending || (pending.provider !== "ga4" && pending.provider !== "gsc")) fail("oauth_failed");
  const website = await staffTx(access, async (db) => (await listWebsites(db, pending.clientId)).find((row) => row.id === pending.websiteId) ?? null);
  if (!website) fail("denied", pending.clientId);
  const listed = await listGoogleProperties(pending.accessToken, pending.provider);
  if (!listed.properties.some((property) => property.id === propertyId)) fail("property_unknown", pending.clientId);
  const family = pending.provider === "gsc" ? "search" : "traffic";
  try {
    await serviceTx(async (db) => {
      if (family === "traffic") {
        const current = await listConnections(db, pending.clientId);
        const other = current.find((row) => row.website_id === pending.websiteId && row.disconnected_at === null && row.provider === "ga4");
        if (other) throw new AnalyticsRuleError("traffic_exists");
      }
      const connection = await bindConnectionFromState(db, {
        state,
        actorUserId: access.user.id,
        externalPropertyId: propertyId,
        providerTimezone: pending.provider === "gsc" ? "America/Los_Angeles" : "Asia/Singapore",
      });
      await setSourcePolicy(db, {
        clientId: pending.clientId,
        websiteId: pending.websiteId,
        reportFamily: family,
        connectionId: connection.id,
        effectiveFrom: todaySgt(),
        actorUserId: access.user.id,
      });
      await enqueueDue(db, new Date(), pending.websiteId);
    });
  } catch (error) {
    if (error instanceof PermissionDeniedError) fail("secret_denied", pending.clientId);
    if (error instanceof AnalyticsRuleError && error.message === "traffic_exists") fail("traffic_exists", pending.clientId);
    if (error instanceof AnalyticsRuleError && error.message === "analytics_scope") fail("analytics_scope", pending.clientId);
    console.error("Analytics bind failed", { name: error instanceof Error ? error.name : "Error" });
    fail("oauth_failed", pending.clientId);
  }
  revalidatePath("/settings");
  revalidatePath("/analytics");
  done("connected", pending.clientId);
}

export async function disconnectAnalytics(formData: FormData) {
  const access = await requireAccess();
  if (!canWriteConnectionSecrets(access)) fail("secret_denied");
  const connectionId = str(formData, "connectionId");
  const clientId = str(formData, "clientId");
  if (!connectionId) fail("denied", clientId);
  try {
    await serviceTx((db) => disconnectConnection(db, { connectionId, actorUserId: access.user.id }));
  } catch (error) {
    if (error instanceof PermissionDeniedError) fail("secret_denied", clientId);
    throw error;
  }
  revalidatePath("/settings");
  revalidatePath("/analytics");
  done("disconnected", clientId);
}

export async function refreshAnalytics(formData: FormData) {
  const clientId = str(formData, "clientId");
  const websiteId = str(formData, "websiteId");
  await managerWebsite(clientId, websiteId);
  await serviceTx((db) => enqueueDue(db, new Date(), websiteId));
  revalidatePath("/settings");
  done("queued", clientId);
}

const ANALYTICS_TABS = new Set(["/analytics", "/analytics/traffic", "/analytics/behavior"]);

/** Queues GA4 range reports for one custom window and the window before it (D52). Admin and manager only. */
export async function prepareAnalyticsRange(formData: FormData) {
  const clientId = str(formData, "clientId");
  const websiteId = str(formData, "websiteId");
  const from = str(formData, "from");
  const to = str(formData, "to");
  const tab = str(formData, "tab");
  await managerWebsite(clientId, websiteId);
  const window = customWindow(from, to);
  if (!window) fail("denied", clientId);
  await serviceTx((db) => enqueueRangeJobs(db, { clientId, websiteId, start: window.current.start, end: window.current.end }));
  const path = ANALYTICS_TABS.has(tab) ? tab : "/analytics";
  revalidatePath(path);
  const params = new URLSearchParams({ client: clientId, website: websiteId, range: "custom", from: window.current.start, to: window.current.end });
  redirect(`${path}?${params}`);
}

export async function retryAnalyticsFailures(formData: FormData) {
  const access = await requireAccess();
  const clientId = str(formData, "clientId");
  const connectionId = str(formData, "connectionId");
  if (!canWriteConnectionSecrets(access)) fail("secret_denied", clientId);
  if (!connectionId) fail("denied", clientId);
  const retried = await serviceTx((db) => retryFailedAnalyticsJobs(db, {
    connectionId,
    actorUserId: access.user.id,
  }));
  revalidatePath("/settings");
  done(retried > 0 ? "retry_queued" : "retry_unavailable", clientId);
}

export async function importAnalyticsCsv(formData: FormData) {
  const clientId = str(formData, "clientId");
  const websiteId = str(formData, "websiteId");
  const { access } = await managerWebsite(clientId, websiteId);
  const text = str(formData, "csv");
  if (!text || text.length > 200_000) fail("import_rejected", clientId);
  const result = await staffTx(access, (db) => recordImport(db, {
    clientId,
    websiteId,
    reportType: "metric_csv",
    timezone: "Asia/Singapore",
    text,
    actorUserId: access.user.id,
    replace: formData.get("replace") === "on",
  }));
  revalidatePath("/settings");
  if (result.error || result.decision === "reject") fail("import_rejected", clientId);
  done(result.decision, clientId);
}
