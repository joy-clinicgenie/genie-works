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
    const loaded = await loadAnalyticsForAccess(access, db, params.client, params.range, params.from, params.to, params.website);
    if (!loaded.view) return { ...loaded, board: null };
    const base = boardFromSnapshots(loaded.view);
    if (!analyticsLiveReports()) return { ...loaded, board: base };
    const bundle = await loadLiveBundle(db, loaded.view);
    return { ...loaded, board: boardFromLive(base, liveFactsFromBundle(bundle)) };
  });
}
