import { afterAll, describe, expect, it, vi } from "vitest";
import { closePools } from "@clinic-genie/db";

const authMock = vi.hoisted(() => vi.fn());

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T extends (...args: never[]) => unknown>(fn: T) => fn };
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("./auth", () => ({ auth: authMock }));

import { bindAnalyticsProperty, connectWix, disconnectAnalytics } from "@/app/actions/analytics";
import { rotateSeoSiteTokenAction } from "@/app/actions/seo";
import { GET as startConnection } from "@/app/api/analytics/google/start/route";
import { GET as finishConnection } from "@/app/api/analytics/google/callback/route";

function signInAs(email: string) {
  authMock.mockResolvedValue({ user: { email } });
}

afterAll(async () => {
  await closePools();
});

describe("direct connection-secret requests", () => {
  it("lets an administrator past the credential gate and stops before a provider call when the server is not configured", async () => {
    signInAs("admin@example.invalid");
    await expect(bindAnalyticsProperty(new FormData())).rejects.toThrow("REDIRECT /settings?analyticsError=property_required");
    const saved = {
      id: process.env.ANALYTICS_GOOGLE_CLIENT_ID,
      secret: process.env.ANALYTICS_GOOGLE_CLIENT_SECRET,
      key: process.env.ANALYTICS_TOKEN_KEY,
    };
    delete process.env.ANALYTICS_GOOGLE_CLIENT_ID;
    delete process.env.ANALYTICS_GOOGLE_CLIENT_SECRET;
    delete process.env.ANALYTICS_TOKEN_KEY;
    try {
      const response = await startConnection(new Request("http://127.0.0.1:3405/api/analytics/google/start?client=00000000-0000-4000-8000-000000000001&website=00000000-0000-4000-8000-000000000002"));
      const location = response.headers.get("location") ?? "";
      expect(location).toContain("analyticsError=not_configured");
      expect(location).not.toContain("accounts.google.com");
      expect(location).not.toContain("secret_denied");
    } finally {
      if (saved.id) process.env.ANALYTICS_GOOGLE_CLIENT_ID = saved.id;
      if (saved.secret) process.env.ANALYTICS_GOOGLE_CLIENT_SECRET = saved.secret;
      if (saved.key) process.env.ANALYTICS_TOKEN_KEY = saved.key;
    }
  });

  it("refuses a manager, specialist and read-only user before any provider call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      for (const email of ["manager@example.invalid", "specialist-a@example.invalid", "readonly@example.invalid", "reviewer@example.invalid"]) {
        signInAs(email);
        fetchSpy.mockClear();
        await expect(bindAnalyticsProperty(new FormData())).rejects.toThrow("REDIRECT /settings?analyticsError=secret_denied");
        await expect(disconnectAnalytics(new FormData())).rejects.toThrow("REDIRECT /settings?analyticsError=secret_denied");
        const wix = new FormData();
        wix.set("clientId", "00000000-0000-4000-8000-000000000001");
        wix.set("websiteId", "00000000-0000-4000-8000-000000000002");
        wix.set("instanceId", "not-a-provider-call");
        await expect(connectWix(wix)).rejects.toThrow(/analyticsError=secret_denied/);
        const token = await rotateSeoSiteTokenAction(null, wix);
        expect(token).toEqual({ ok: false, error: "Only an administrator can create or rotate website API credentials." });
        expect(token).not.toHaveProperty("token");
        const start = await startConnection(new Request("http://127.0.0.1:3405/api/analytics/google/start?client=00000000-0000-4000-8000-000000000001&website=00000000-0000-4000-8000-000000000002&provider=ga4"));
        expect(start.headers.get("location") ?? "").toContain("analyticsError=secret_denied");
        expect(start.headers.get("location") ?? "").not.toContain("accounts.google.com");
        const callback = await finishConnection(new Request("http://127.0.0.1:3405/api/analytics/google/callback?code=not-a-code&state=not-a-state"));
        expect(callback.headers.get("location") ?? "").toContain("analyticsError=secret_denied");
        expect(fetchSpy).not.toHaveBeenCalled();
      }
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
