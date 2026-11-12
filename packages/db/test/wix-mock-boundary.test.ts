import { afterEach, describe, expect, it } from "vitest";
import { WIX_API_BASE_URL, resolveWixApiBaseUrl } from "../src/testing/targets";
import { WIX_MOCK_SCENARIOS, isWixMockScenario, startWixMock } from "../src/testing/wix-mock";
import { FIXTURE_WIX_BINDING } from "../src/testing/perf-fixture";

const stops: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (stops.length) await stops.pop()!();
});

const LOCAL = "postgresql://cg_app:cg_app_dev@127.0.0.1:54339/clinic_genie_perf_baseline";

describe("Wix API base URL guard", () => {
  it("returns the real provider when no override is set", () => {
    expect(resolveWixApiBaseUrl({})).toBe(WIX_API_BASE_URL);
    expect(resolveWixApiBaseUrl({ FORMS_WIX_BASE_URL: "" })).toBe(WIX_API_BASE_URL);
    expect(resolveWixApiBaseUrl({ FORMS_WIX_BASE_URL: "   " })).toBe(WIX_API_BASE_URL);
  });

  it("allows a local mock alongside a local database, and trims a trailing slash", () => {
    expect(resolveWixApiBaseUrl({ FORMS_WIX_BASE_URL: "http://127.0.0.1:3420", DATABASE_URL: LOCAL })).toBe("http://127.0.0.1:3420");
    expect(resolveWixApiBaseUrl({ FORMS_WIX_BASE_URL: "http://localhost:3420/", DATABASE_URL: LOCAL })).toBe("http://localhost:3420");
  });

  it("allows it under a local production build, which is what next start runs", () => {
    expect(resolveWixApiBaseUrl({ NODE_ENV: "production", FORMS_WIX_BASE_URL: "http://127.0.0.1:3420", DATABASE_URL: LOCAL }))
      .toBe("http://127.0.0.1:3420");
  });

  it("refuses it when the process is pointed at a shared database", () => {
    for (const database of ["", "postgresql://u:p@ep-x.ap-southeast-1.aws.neon.tech/neondb", "postgresql://u:p@127.0.0.1:54329/clinic"]) {
      expect(() => resolveWixApiBaseUrl({ FORMS_WIX_BASE_URL: "http://127.0.0.1:3420", DATABASE_URL: database }))
        .toThrow(/only available alongside a local database/);
    }
  });

  it("refuses a non-local host, so a deployment cannot be repointed at a third party", () => {
    expect(() => resolveWixApiBaseUrl({ FORMS_WIX_BASE_URL: "https://example.invalid", DATABASE_URL: LOCAL })).toThrow(/not local/);
    expect(() => resolveWixApiBaseUrl({ FORMS_WIX_BASE_URL: "https://www.wixapis.com.attacker.invalid", DATABASE_URL: LOCAL })).toThrow(/not local/);
    expect(() => resolveWixApiBaseUrl({ FORMS_WIX_BASE_URL: "not-a-url", DATABASE_URL: LOCAL })).toThrow(/not a valid URL/);
  });

  it("refuses the override anywhere VERCEL_ENV is set, whatever its value", () => {
    for (const vercelEnv of ["production", "preview", "development"]) {
      expect(() => resolveWixApiBaseUrl({ VERCEL_ENV: vercelEnv, FORMS_WIX_BASE_URL: "http://127.0.0.1:3420", DATABASE_URL: LOCAL }))
        .toThrow(/not available in a hosted environment/);
    }
  });
});

describe("Wix mock", () => {
  async function mockFor(scenario: Parameters<typeof startWixMock>[0]["scenario"], extra: Partial<Parameters<typeof startWixMock>[0]> = {}) {
    const handle = await startWixMock({ scenario, formId: FIXTURE_WIX_BINDING.formId, namespace: FIXTURE_WIX_BINDING.namespace, delayMs: 50, ...extra });
    stops.push(handle.stop);
    return handle;
  }

  const query = (url: string, body: unknown = { query: {} }) =>
    fetch(`${url}/form-submission-service/v4/submissions/namespace/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("binds to a local address only", async () => {
    const mock = await mockFor("normal");
    expect(mock.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    // The guard accepts the address the mock actually chose.
    expect(resolveWixApiBaseUrl({ FORMS_WIX_BASE_URL: mock.url, DATABASE_URL: LOCAL })).toBe(mock.url);
  });

  it("names every scenario the baseline run needs", () => {
    expect(WIX_MOCK_SCENARIOS.map((item) => item.id)).toEqual([
      "normal", "slow", "timeout", "provider-error", "multi-page", "expired-auth", "zero-submissions",
    ]);
    expect(isWixMockScenario("normal")).toBe(true);
    expect(isWixMockScenario("nonsense")).toBe(false);
  });

  it("answers a normal query with submissions the platform parser accepts", async () => {
    const mock = await mockFor("normal");
    const token = await (await fetch(`${mock.url}/oauth2/token`, { method: "POST", body: "{}" })).json();
    expect(token.access_token).toBeTruthy();
    const body = await (await query(mock.url)).json();
    expect(body.submissions.length).toBeGreaterThan(0);
    const [first] = body.submissions;
    expect(first.formId).toBe(FIXTURE_WIX_BINDING.formId);
    expect(first.namespace).toBe(FIXTURE_WIX_BINDING.namespace);
    expect(typeof first.createdDate).toBe("string");
    expect(first.submissions.email_0002).toMatch(/@example\.invalid$/);
    expect(body.pagingMetadata.hasNext).toBe(false);
  });

  it("returns a genuine empty list, which is not a failure", async () => {
    const mock = await mockFor("zero-submissions");
    const response = await query(mock.url);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ submissions: [], pagingMetadata: { hasNext: false } });
  });

  it("refuses the token and the query when authentication has expired", async () => {
    const mock = await mockFor("expired-auth");
    expect((await fetch(`${mock.url}/oauth2/token`, { method: "POST", body: "{}" })).status).toBe(401);
    expect((await query(mock.url)).status).toBe(401);
  });

  it("reports a provider error on the query", async () => {
    const mock = await mockFor("provider-error");
    expect((await query(mock.url)).status).toBe(500);
  });

  it("pages with a cursor until the last page", async () => {
    const mock = await mockFor("multi-page", { pages: 3, pageSize: 2 });
    const first = await (await query(mock.url)).json();
    expect(first.submissions).toHaveLength(2);
    expect(first.pagingMetadata.cursors.next).toBe("mock-page-2");
    const second = await (await query(mock.url, { query: { cursorPaging: { cursor: "mock-page-2" } } })).json();
    expect(second.pagingMetadata.cursors.next).toBe("mock-page-3");
    const third = await (await query(mock.url, { query: { cursorPaging: { cursor: "mock-page-3" } } })).json();
    expect(third.pagingMetadata.hasNext).toBe(false);
    expect(mock.summary().calls).toBe(3);
  });

  it("delays a slow response and switches scenario without restarting", async () => {
    const mock = await mockFor("slow", { delayMs: 120 });
    const started = Date.now();
    await query(mock.url);
    expect(Date.now() - started).toBeGreaterThanOrEqual(100);

    const switched = await fetch(`${mock.url}/__mock/scenario`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenario: "zero-submissions" }),
    });
    expect(switched.status).toBe(200);
    expect(mock.scenario()).toBe("zero-submissions");
    // Switching also clears the recorded calls, so each measurement reports only its own traffic.
    expect(mock.summary().calls).toBe(0);
    await expect((await query(mock.url)).json()).resolves.toMatchObject({ submissions: [] });
  });

  it("stays reachable for the control endpoint while the timeout scenario is set", async () => {
    const mock = await mockFor("timeout");
    const switched = await fetch(`${mock.url}/__mock/scenario`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenario: "normal" }),
    });
    expect(switched.status).toBe(200);
    expect(mock.scenario()).toBe("normal");
  });
});
