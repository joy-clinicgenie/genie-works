/**
 * Read-only health check of analytics connections and sync state (connection recovery).
 *
 *   npm run analytics:health -w @clinic-genie/db
 *
 * Prints counts, states, dates and eight-character hashes. It never prints a token, a property id, a site address or a
 * client name (the internal agency client is named: it is not a clinic). It runs in a read-only transaction, which the
 * database enforces, and writes nothing.
 *
 * If ANALYTICS_TOKEN_KEY is set, each stored token is decrypted IN MEMORY to answer: does this key open it, is there a
 * refresh token, when does the access token expire. The result is yes/no and a time. No provider is called.
 *
 * A database that is not on this machine needs ANALYTICS_HEALTH_REMOTE_CONFIRM set to its host name.
 */
import { createHash } from "node:crypto";
import { closePools, SERVICE, withContext } from "../src/client";
import { databasePlace } from "../src/database-environment";
import { loadRootEnv } from "../src/env";
import { decryptSecret, tokenKeyConfigured } from "../src/analytics/crypto";

loadRootEnv();
const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/");
const local = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname);
if (!local && process.env.ANALYTICS_HEALTH_REMOTE_CONFIRM !== url.hostname) {
  console.error(`Refusing: this database is not on this machine. Set ANALYTICS_HEALTH_REMOTE_CONFIRM to its host name (${url.hostname}) to read it.`);
  process.exit(2);
}
const ref = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 8);
const minutes = (ms: number) => Math.round(ms / 60_000);

try {
  const report = await withContext(SERVICE, async (db) => {
    await db.query("set transaction read only");
    // Fail closed: this check is only ever meant to run as the least-privileged application role.
    const who = (await db.query<{ r: string }>("select current_user as r")).rows[0]!.r;
    if (who !== "cg_app") throw new Error("Refusing: DATABASE_URL must connect as the application role cg_app (an owner or other role bypasses row-level security).");
    const q = async <T extends object>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;

    // schema_migrations has row level security and no policy, so the application role cannot read it (it reports 0 rows).
    // Migration status is inferred from objects each recent migration created, which any role can see.
    const objects = new Set((await q<{ o: string }>(
      `select table_name || '.' || column_name as o from information_schema.columns
       where table_name in ('analytics_jobs', 'analytics_connections', 'analytics_worker_invocations', 'seo_index_checks', 'enquiry_reads', 'website_enquiry_forms', 'wix_inbox_messages', 'report_snapshots')
       union select table_name || '.' as o from information_schema.tables
       where table_name in ('analytics_worker_invocations', 'seo_index_checks', 'enquiry_reads', 'website_enquiry_forms', 'wix_inbox_messages', 'report_snapshots')`)).map((r) => r.o));
    const has = (o: string) => objects.has(o);
    const evidence: Record<string, boolean> = {
      "0039_search_checks (seo_index_checks)": has("seo_index_checks."),
      "0042_analytics_job_reliability (analytics_jobs.failed_at)": has("analytics_jobs.failed_at"),
      "0043_enquiry_reads": has("enquiry_reads."),
      "0044_website_enquiry_forms": has("website_enquiry_forms."),
      "0045_wix_inbox_messages": has("wix_inbox_messages."),
      "0053_analytics_scheduling (window_class, priority, cooldown_until)": has("analytics_jobs.window_class") && has("analytics_jobs.priority") && has("analytics_connections.cooldown_until"),
      "0054_analytics_worker_invocations": has("analytics_worker_invocations."),
    };
    const tables = new Set(["report_snapshots."].filter(has).map(() => "report_snapshots"));

    const connections = await q<{
      id: string; client_id: string; website_id: string; provider: string; status: string; provider_timezone: string | null;
      secret_ref: string | null; verified_at: Date | null; created_at: Date; disconnected_at: Date | null; slug: string; ciphertext: string | null; nonce: string | null;
    }>(
      `select c.id, c.client_id, c.website_id, c.provider, c.status, c.provider_timezone, c.secret_ref, c.verified_at, c.created_at, c.disconnected_at,
              cl.slug, s.ciphertext, s.nonce
       from analytics_connections c join clients cl on cl.id = c.client_id
       left join analytics_secrets s on s.id = c.secret_ref
       order by c.created_at`,
    );
    const keyOk = tokenKeyConfigured();
    const now = Date.now();
    const rows = connections.map((c) => {
      let decrypt: "not_tested" | "ok" | "fails" | "no_secret" = c.ciphertext ? "not_tested" : "no_secret";
      let token: { hasAccessToken: boolean; hasRefreshToken: boolean; expiresInMinutes: number | null; hasInstanceId: boolean } | null = null;
      if (c.ciphertext && c.nonce && keyOk) {
        try {
          const parsed = JSON.parse(decryptSecret(c.ciphertext, c.nonce)) as { accessToken?: string; refreshToken?: string; expiresAt?: string; instanceId?: string };
          decrypt = "ok";
          const expires = parsed.expiresAt ? Date.parse(parsed.expiresAt) : NaN;
          token = { hasAccessToken: Boolean(parsed.accessToken), hasRefreshToken: Boolean(parsed.refreshToken), expiresInMinutes: Number.isFinite(expires) ? minutes(expires - now) : null, hasInstanceId: Boolean(parsed.instanceId) };
        } catch {
          decrypt = "fails";
        }
      }
      return {
        connection: ref(c.id), client: c.slug === "clinic-genie" ? "clinic-genie (internal agency, CG-000)" : ref(c.client_id), website: ref(c.website_id),
        provider: c.provider, status: c.status, disconnected: c.disconnected_at !== null, hasTimezone: Boolean(c.provider_timezone),
        verifiedAt: c.verified_at?.toISOString().slice(0, 10) ?? null, decrypt, token,
      };
    });
    const tally = <T extends object>(list: T[], key: (item: T) => string) => list.reduce<Record<string, number>>((acc, item) => ({ ...acc, [key(item)]: (acc[key(item)] ?? 0) + 1 }), {});

    const jobs = await q<{ state: string; n: number }>("select state, count(*)::int as n from analytics_jobs group by 1");
    const jobDetail = (await q<{ oldest_queued: Date | null; expired_leases: number; newest_job: Date | null }>(
      `select min(created_at) filter (where state = 'queued') as oldest_queued,
              count(*) filter (where state = 'leased' and lease_until < now())::int as expired_leases, max(created_at) as newest_job
       from analytics_jobs`))[0]!;
    const failedByCode = await q<{ code: string | null; n: number }>("select coalesce(safe_error_code, 'none') as code, count(*)::int as n from analytics_jobs where state in ('failed', 'reconnect_required') group by 1 order by 2 desc");
    const runs = (await q<{ last_ok: Date | null; ok: number; failed: number; since: Date | null }>(
      `select max(finished_at) filter (where result = 'succeeded') as last_ok,
              count(*) filter (where result = 'succeeded')::int as ok, count(*) filter (where result in ('failed', 'reconnect_required'))::int as failed, min(started_at) as since
       from analytics_sync_runs`))[0]!;
    const reports = await q<{ template_key: string; published: number; newest_end: string | null; oldest_start: string | null }>(
      `select template_key, count(*) filter (where published)::int as published, max(end_date)::text as newest_end, min(start_date)::text as oldest_start
       from analytics_report_partitions group by 1 order by 1`);
    const snapshots = tables.has("report_snapshots") ? (await q<{ n: number }>("select count(*)::int as n from report_snapshots"))[0]!.n : null;

    return {
      database: { place: databasePlace(process.env.DATABASE_URL ?? ""), role: (await q<{ r: string }>("select current_user as r"))[0]!.r === "cg_app" ? "application role (cg_app)" : "other role", readOnlyTransaction: true },
      migrationsInferredFromSchema: evidence,
      tokenKeyProvidedToThisCheck: keyOk,
      tokenKeyVerdict: !keyOk
        ? "NOT TESTED: no ANALYTICS_TOKEN_KEY was supplied to this check"
        : rows.some((r) => r.decrypt === "fails")
          ? `KEY DOES NOT OPEN ${rows.filter((r) => r.decrypt === "fails").length} of ${rows.filter((r) => r.decrypt !== "no_secret").length} stored tokens: do not deploy or run the pilot`
          : `KEY OPENS ALL ${rows.filter((r) => r.decrypt === "ok").length} stored tokens`,
      connections: {
        total: rows.length,
        byProviderAndStatus: tally(rows, (r) => `${r.provider}:${r.status}${r.disconnected ? ":disconnected" : ""}`),
        decrypt: tally(rows, (r) => r.decrypt),
        withRefreshToken: rows.filter((r) => r.token?.hasRefreshToken).length,
        withoutTimezone: rows.filter((r) => !r.hasTimezone).length,
        clients: new Set(rows.map((r) => r.client)).size,
        list: rows,
      },
      jobs: { byState: Object.fromEntries(jobs.map((j) => [j.state, j.n])), oldestQueuedAgeDays: jobDetail.oldest_queued ? +((now - jobDetail.oldest_queued.getTime()) / 86_400_000).toFixed(1) : null, expiredLeases: jobDetail.expired_leases, newestJobCreated: jobDetail.newest_job?.toISOString().slice(0, 10) ?? null, failedByCode: Object.fromEntries(failedByCode.map((f) => [f.code ?? "none", f.n])) },
      syncRuns: { lastSucceeded: runs.last_ok?.toISOString() ?? null, succeededTotal: runs.ok, failedTotal: runs.failed, firstRun: runs.since?.toISOString().slice(0, 10) ?? null },
      reports: reports.map((r) => ({ template: r.template_key, published: r.published, windowsFrom: r.oldest_start, newestWindowEnd: r.newest_end })),
      reportSnapshotsRows: snapshots,
    };
  });
  console.log(JSON.stringify(report, null, 2));
} finally {
  await closePools();
}
