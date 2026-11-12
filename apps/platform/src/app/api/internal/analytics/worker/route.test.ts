import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ drainMaintenance: vi.fn() }));

vi.mock("@clinic-genie/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@clinic-genie/db")>()),
  drainMaintenance: mocks.drainMaintenance,
}));

const URL_UNDER_TEST = "http://localhost/api/internal/analytics/worker";
const EMPTY_OUTCOME = {
  enqueued: 0,
  jobs: 0,
  succeeded: 0,
  failed: 0,
  retryScheduled: 0,
  reconnectRequired: 0,
  stale: 0,
  inspected: 0,
  measured: 0,
  result: null,
};

describe("analytics worker route authorisation", () => {
  const original = { worker: process.env.ANALYTICS_WORKER_SECRET, cron: process.env.CRON_SECRET };

  beforeEach(() => {
    mocks.drainMaintenance.mockReset();
    mocks.drainMaintenance.mockResolvedValue(EMPTY_OUTCOME);
    process.env.ANALYTICS_WORKER_SECRET = "worker-secret-value";
    process.env.CRON_SECRET = "cron-secret-value";
  });

  afterEach(() => {
    if (original.worker === undefined) delete process.env.ANALYTICS_WORKER_SECRET;
    else process.env.ANALYTICS_WORKER_SECRET = original.worker;
    if (original.cron === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original.cron;
  });

  it("refuses an unauthorised request on GET and POST and runs no job", async () => {
    const { GET, POST } = await import("@/app/api/internal/analytics/worker/route");
    const headers = [undefined, "Bearer", "Bearer wrong-secret-value", "worker-secret-value", "Basic worker-secret-value"];
    for (const authorization of headers) {
      const init = authorization ? { headers: { authorization } } : {};
      const get = await GET(new Request(URL_UNDER_TEST, init));
      expect(get.status, `GET ${String(authorization)}`).toBe(401);
      const post = await POST(new Request(URL_UNDER_TEST, { method: "POST", ...init }));
      expect(post.status, `POST ${String(authorization)}`).toBe(401);
    }
    expect(mocks.drainMaintenance).not.toHaveBeenCalled();
  });

  it("refuses every request when no secret is configured on the server", async () => {
    delete process.env.ANALYTICS_WORKER_SECRET;
    delete process.env.CRON_SECRET;
    const { GET } = await import("@/app/api/internal/analytics/worker/route");
    const response = await GET(new Request(URL_UNDER_TEST, { headers: { authorization: "Bearer " } }));
    expect(response.status).toBe(401);
    expect(mocks.drainMaintenance).not.toHaveBeenCalled();
  });

  it("drains the queue for the worker secret and for the cron secret", async () => {
    const { GET } = await import("@/app/api/internal/analytics/worker/route");
    for (const secret of ["worker-secret-value", "cron-secret-value"]) {
      const response = await GET(new Request(URL_UNDER_TEST, { headers: { authorization: `Bearer ${secret}` } }));
      expect(response.status, secret).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ worked: false, jobs: 0 });
    }
    expect(mocks.drainMaintenance).toHaveBeenCalledTimes(2);
  });

  it("never reports secret values or secret metadata in the refusal", async () => {
    const { GET } = await import("@/app/api/internal/analytics/worker/route");
    const response = await GET(new Request(URL_UNDER_TEST, { headers: { authorization: "Bearer wrong-secret-value" } }));
    const body = await response.text();
    expect(body).toBe(JSON.stringify({ error: "Unauthorized" }));
    expect(body).not.toContain("worker-secret-value");
    expect(body).not.toContain("cron-secret-value");
    expect(body).not.toMatch(/length/i);
  });
});
