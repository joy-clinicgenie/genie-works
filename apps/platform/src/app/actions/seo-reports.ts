"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canManageRegistry, prepareSearchReport } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { serviceTx, staffTx } from "@/lib/db";
import { str } from "@/lib/actions";
import { isWebsiteId } from "@/lib/seo-scope";
import { loadSeoContextWithDb, readGoogleControls, searchConsoleWindow } from "@/lib/seo-workspace";

const PAGE = "/seo/reports";

/**
 * SEO-07.1 (D66): an administrator or manager queues the Search Console reports the selected window is missing,
 * including its dated rows and the equal window before. The window is recomputed on the server.
 */
export async function prepareSearchReportAction(formData: FormData): Promise<void> {
  const websiteId = str(formData, "websiteId");
  const controls = readGoogleControls({ range: str(formData, "range"), from: str(formData, "from"), to: str(formData, "to") });
  const keep = { website: websiteId, tab: "google-search", range: controls.range, ...(controls.range === "custom" ? { from: controls.from ?? "", to: controls.to ?? "" } : {}) };
  const back = (notice: string): never => redirect(`${PAGE}?${new URLSearchParams({ ...keep, notice })}`);
  const access = await requireAccess();
  const site = isWebsiteId(websiteId) ? await staffTx(access, async (db) => (await loadSeoContextWithDb(db, { website: websiteId })).selected) : null;
  if (!site || site.id !== websiteId || !canManageRegistry(access)) back("denied");
  const window = searchConsoleWindow(controls);
  if (!window) back("bad_dates");
  const created = await serviceTx((db) => prepareSearchReport(db, { clientId: site!.clientId, websiteId, start: window!.start, end: window!.end, refresh: str(formData, "refresh") === "1" }));
  revalidatePath(PAGE);
  back(created ? "search_queued" : "search_nothing");
}
