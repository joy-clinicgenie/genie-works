import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runPilotProbe: vi.fn(),
  runPilotSync: vi.fn(),
  withContext: vi.fn(async (_ctx: unknown, fn: (db: unknown) => unknown) => fn("rw-db")),
  withReadOnlyContext: vi.fn(async (_ctx: unknown, fn: (db: unknown) => unknown) => fn("ro-db")),
}));

vi.mock("@clinic-genie/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@clinic-genie/db")>()),
  runPilotProbe: mocks.runPilotProbe,
  runPilotSync: mocks.runPilotSync,
  withContext: mocks.withContext,
  withReadOnlyContext: mocks.withReadOnlyContext,
}));

const URL_UNDER_TEST = "http://localhost/api/internal/analytics/pilot";
const REF = "abcdef01";
const post = (body: unknown, headers: Record<string, string> = { authorization: "Bearer cron-secret-value" }, raw?: string) =>
  new Request(URL_UNDER_TEST, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: raw ?? JSON.stringify(body) });

describe("pilot route", () => {
  const original = { worker: process.env.ANALYTICS_WORKER_SECRET, cron: process.env.CRON_SECRET, db: process.env.DATABASE_URL, allow: process.env.ANALYTICS_PILOT_ALLOWED_CONNECTIONS };

  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockClear();
    mocks.runPilotProbe.mockResolvedValue({ mode: "probe", connection: REF, ready: true });
    mocks.runPilotSync.mockResolvedValue({ mode: "run", connection: REF, jobs: 1 });
    process.env.ANALYTICS_WORKER_SECRET = "worker-secret-value";
    process.env.CRON_SECRET = "cron-secret-value";
    process.env.DATABASE_URL = "postgresql://cg_app:cg_app_dev@127.0.0.1:54339/clinic_genie";
    process.env.ANALYTICS_PILOT_ALLOWED_CONNECTIONS = REF;
  });

  afterEach(() => {
    const restore = (key: string, value: string | undefined) => { if (value === undefined) delete process.env[key]; else process.env[key] = value; };
    restore("ANALYTICS_WORKER_SECRET", original.worker);
    restore("CRON_SECRET", original.cron);
    restore("DATABASE_URL", original.db);
    restore("ANALYTICS_PILOT_ALLOWED_CONNECTIONS", original.allow);
  });

  it("refuses a missing, malformed or wrong bearer before reading the body or touching anything", async () => {
    const { POST } = await import("@/app/api/internal/analytics/pilot/route");
    for (const authorization of [undefined, "Bearer", "Bearer wrong-secret-value", "cron-secret-value", "Basic cron-secret-value", "Bearer "]) {
      const response = await POST(post({ connection: REF, mode: "probe" }, authorization ? { authorization } : {}));
      expect(response.status, String(authorization)).toBe(401);
      expect(await response.text()).toBe(JSON.stringify({ error: "Unauthorized" }));
    }
    expect(mocks.runPilotProbe).not.toHaveBeenCalled();
    expect(mocks.runPilotSync).not.toHaveBeenCalled();
    expect(mocks.withContext).not.toHaveBeenCalled();
  });

  it("accepts the same two bearers as the worker", async () => {
    const { POST } = await import("@/app/api/internal/analytics/pilot/route");
    for (const secret of ["worker-secret-value", "cron-secret-value"]) {
      expect((await POST(post({ connection: REF, mode: "probe" }, { authorization: `Bearer ${secret}` }))).status).toBe(200);
    }
  });

  it("does nothing at all unless the allow-list is set", async () => {
    const { POST } = await import("@/app/api/internal/analytics/pilot/route");
    for (const value of [undefined, "", "   ", "not-a-reference, 123"]) {
      if (value === undefined) delete process.env.ANALYTICS_PILOT_ALLOWED_CONNECTIONS; else process.env.ANALYTICS_PILOT_ALLOWED_CONNECTIONS = value;
      const response = await POST(post({ connection: REF, mode: "run" }));
      expect(response.status, String(value)).toBe(403);
      expect(await response.json()).toEqual({ error: "The pilot is not enabled." });
    }
    expect(mocks.runPilotProbe).not.toHaveBeenCalled();
    expect(mocks.runPilotSync).not.toHaveBeenCalled();
  });

  it("refuses to run from an environment that may not use this database", async () => {
    process.env.DATABASE_URL = "postgresql://cg_app:not-a-real-password@db.unlisted.example.test:5432/clinic_genie";
    const { POST } = await import("@/app/api/internal/analytics/pilot/route");
    const response = await POST(post({ connection: REF, mode: "probe" }));
    expect(response.status).toBe(409);
    const text = await response.text();
    expect(text).not.toMatch(/example\.test|not-a-real-password|postgresql/);
    expect(mocks.runPilotProbe).not.toHaveBeenCalled();
  });

  it("rejects a body that is too large, not JSON, or not a valid pilot request, without running anything", async () => {
    const { POST } = await import("@/app/api/internal/analytics/pilot/route");
    expect((await POST(post(null, undefined, "x".repeat(5000)))).status).toBe(413);
    expect((await POST(post(null, undefined, "{not json"))).status).toBe(400);
    for (const body of [{}, { connection: "abc", mode: "run" }, { connection: REF, mode: "wipe" }, { connection: REF, mode: "run", maxJobs: 99 }, { connection: REF, mode: "run", connectionId: "x" }]) {
      const response = await POST(post(body));
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect((await response.json()).code).toBe("invalid_request");
    }
    expect(mocks.runPilotProbe).not.toHaveBeenCalled();
    expect(mocks.runPilotSync).not.toHaveBeenCalled();
  });

  it("refuses GET, which has no meaning here and must not reveal anything", async () => {
    const { GET } = await import("@/app/api/internal/analytics/pilot/route");
    const response = GET();
    expect(response.status).toBe(405);
    expect(await response.json()).toEqual({ error: "Method not allowed" });
  });

  it("probe: passes the parsed request and the allow-list, and backs the read-only runner with a read-only transaction", async () => {
    const { POST } = await import("@/app/api/internal/analytics/pilot/route");
    const response = await POST(post({ connection: REF.toUpperCase(), mode: "probe" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ mode: "probe", connection: REF, ready: true });
    const [run, request, , options] = mocks.runPilotProbe.mock.calls[0]!;
    expect(request).toMatchObject({ connection: REF, mode: "probe" });
    expect([...options.allowList]).toEqual([REF]);
    // The runner given to the probe is the READ-ONLY context; the ordinary runner is the writable one.
    await options.runReadOnly(() => "x");
    expect(mocks.withReadOnlyContext).toHaveBeenCalledTimes(1);
    expect(mocks.withContext).not.toHaveBeenCalled();
    await run(() => "x");
    expect(mocks.withContext).toHaveBeenCalledTimes(1);
  });

  it("run: passes the request, the allow-list and bounded options", async () => {
    const { POST } = await import("@/app/api/internal/analytics/pilot/route");
    const response = await POST(post({ connection: REF, mode: "run", maxJobs: 1, templates: ["ga4.traffic_daily"] }));
    expect(response.status).toBe(200);
    const [, request, deps, options] = mocks.runPilotSync.mock.calls[0]!;
    expect(request).toMatchObject({ connection: REF, mode: "run", maxJobs: 1, templates: ["ga4.traffic_daily"] });
    expect([...options.allowList]).toEqual([REF]);
    expect(options.budgetMs).toBeLessThanOrEqual(90_000);
    expect(deps).not.toHaveProperty("onlyConnectionId"); // scoping is decided inside the pilot, from the allow-listed reference, never from the request
    expect(mocks.runPilotProbe).not.toHaveBeenCalled();
  });

  it("maps a refusal to its status and an unexpected error to a generic 500 that echoes nothing", async () => {
    const { POST } = await import("@/app/api/internal/analytics/pilot/route");
    const { PilotError } = await import("@clinic-genie/db");
    mocks.runPilotSync.mockRejectedValueOnce(new PilotError(403, "not_allowed", "This connection is not allowed for the pilot."));
    const denied = await POST(post({ connection: REF, mode: "run" }));
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: "This connection is not allowed for the pilot.", code: "not_allowed" });

    mocks.runPilotSync.mockRejectedValueOnce(new Error("connect ECONNREFUSED postgresql://owner:hunter2@prod.example.invalid/db token=abc123"));
    const failed = await POST(post({ connection: REF, mode: "run" }));
    expect(failed.status).toBe(500);
    const text = await failed.text();
    expect(text).not.toMatch(/ECONNREFUSED|hunter2|postgresql|prod\.example|abc123/);
  });

  it("never reflects the bearer in any response", async () => {
    const { POST } = await import("@/app/api/internal/analytics/pilot/route");
    const texts = [
      await (await POST(post({ connection: REF, mode: "probe" }))).text(),
      await (await POST(post({ bad: true }))).text(),
      await (await POST(post({ connection: REF, mode: "probe" }, { authorization: "Bearer wrong-secret-value" }))).text(),
    ];
    for (const text of texts) expect(text).not.toMatch(/cron-secret-value|worker-secret-value|wrong-secret-value/);
  });
});
