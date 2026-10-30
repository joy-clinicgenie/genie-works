import { analyticsLiveReports } from "@/lib/analytics-flag";
import { boardFromLive, boardFromSnapshots, liveFactsFromBundle, type AnalyticsBoard } from "@/lib/analytics-board";
import { staffTx } from "@/lib/db";
import { loadLiveBundle } from "@/lib/live-analytics";
import { requireAccess } from "@/lib/session";
import type { SiteView } from "@/lib/site-view";

export async function loadAnalyticsBoard(view: SiteView): Promise<AnalyticsBoard> {
  const base = boardFromSnapshots(view);
  if (!analyticsLiveReports()) return base;
  const access = await requireAccess();
  const bundle = await staffTx(access, (db) => loadLiveBundle(db, view));
  return boardFromLive(base, liveFactsFromBundle(bundle));
}
