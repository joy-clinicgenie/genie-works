import { NextResponse } from "next/server";
import { canManageUsers } from "@clinic-genie/db";
import { getAccess } from "@/lib/session";
import { loadOperationsReport, operationsAudience } from "@/lib/operations-status";

export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
};

/** Administrator-only operational status. It does not call a provider or send a notification. */
export async function GET() {
  const access = await getAccess();
  if (!access || operationsAudience(access.user.platform_role) === "unauthenticated") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  }
  if (!canManageUsers(access) || operationsAudience(access.user.platform_role) !== "allowed") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers });
  }
  const report = await loadOperationsReport(access);
  return NextResponse.json(report, { headers });
}
