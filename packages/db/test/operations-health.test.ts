import { describe, expect, it } from "vitest";
import type { Queryable } from "../src/client";
import { platformSyncHealth } from "../src/analytics/sync";

describe("platform sync health", () => {
  it("returns counts and drops an unsafe error string", async () => {
    const db = {
      async query() {
        return {
          rows: [{
            connections: 2,
            queued: 1,
            leased: 1,
            stalled: 1,
            failed: 3,
            reconnect_required: 0,
            last_success_at: "2026-10-30T00:00:00.000Z",
            safe_error: "provider said postgresql://secret",
          }],
        };
      },
    } as unknown as Queryable;
    const health = await platformSyncHealth(db);
    expect(health).toMatchObject({
      connections: 2,
      queued: 1,
      leased: 1,
      stalledLeases: 1,
      failed: 3,
      safeError: null,
    });
    expect(health.lastSuccessAt?.toISOString()).toBe("2026-10-30T00:00:00.000Z");
  });

  it("keeps a short safe error code", async () => {
    const db = {
      async query() {
        return { rows: [{ connections: 0, queued: 0, leased: 0, stalled: 0, failed: 1, reconnect_required: 0, last_success_at: null, safe_error: "lease_expired" }] };
      },
    } as unknown as Queryable;
    expect((await platformSyncHealth(db)).safeError).toBe("lease_expired");
  });
});
