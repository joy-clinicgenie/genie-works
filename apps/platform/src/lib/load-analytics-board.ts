import { analyticsLiveReports } from "@/lib/analytics-flag";
import { boardFromLive, boardFromSnapshots, liveFactsFromBundle } from "@/lib/analytics-board";
import { staffTx } from "@/lib/db";
import { loadLiveBundle } from "@/lib/live-analytics";
import { requireAccess } from "@/lib/session";
import { loadAnalyticsForAccess } from "@/components/modules/AnalyticsShell";
import { canManageRegistry, rangeJobStatus, type AccessProfile, type RangeJobStatus } from "@clinic-genie/db";

/** Loads the board every analytics tab renders from. Overview, Traffic and Behaviour all use this. */
export async function loadAnalyticsOverview(params: { client?: string; website?: string; range?: string; from?: string; to?: string }) {
  const access = await requireAccess();
  return loadAnalyticsOverviewForAccess(access, params);
}

/** Resolves the analytics view and its live data under one staff RLS context. */
export async function loadAnalyticsOverviewForAccess(access: AccessProfile, params: { client?: string; website?: string; range?: string; from?: string; to?: string }) {
  return staffTx(access, async (db) => {
    const live = analyticsLiveReports();
    const loaded = await loadAnalyticsForAccess(access, db, params.client, params.range, params.from, params.to, params.website, live);
    if (!loaded.view) return { ...loaded, board: null, range: null };
    const base = boardFromSnapshots(loaded.view);
    if (!live) return { ...loaded, board: base, range: null };
    const bundle = await loadLiveBundle(db, loaded.view);
    const board = boardFromLive(base, liveFactsFromBundle(bundle));
    const view = loaded.view;
    // A custom range has range reports only once someone prepares it (D52).
    const range: { status: RangeJobStatus; canPrepare: boolean } | null = loaded.rangeId === "custom" && view.websiteId && view.current
      ? { status: await rangeJobStatus(db, { clientId: view.clientId, websiteId: view.websiteId, start: view.current.start, end: view.current.end }), canPrepare: canManageRegistry(access) }
      : null;
    // The header's "updated" time follows the provider data, not the recorded export (D51).
    return { ...loaded, view: { ...view, updatedAt: board.updatedAt }, board, range };
  });
}
