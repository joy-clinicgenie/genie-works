import { afterAll, describe, expect, it, vi } from "vitest";
import { closePools } from "@clinic-genie/db";

const authMock = vi.hoisted(() => vi.fn());
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T extends (...args: never[]) => unknown>(fn: T) => fn };
});
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("./auth", () => ({ auth: authMock }));

import { createCrawlerSourceAction, prepareReferralReportAction, runNlwebTestAction, saveNlwebEndpointAction } from "@/app/actions/seo-ai";
import { POST as ingest } from "@/app/api/public/crawler-events/[websiteId]/route";

afterAll(async () => {
  await closePools();
});

const WEBSITE = "77777777-7777-4777-8777-777777777777";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("AI visibility actions are scoped on the server (SEO-05)", () => {
  it("refuses an unresolvable website before any request, and keeps source tokens with administrators", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    authMock.mockResolvedValue({ user: { email: "admin@example.invalid" } });
    await expect(runNlwebTestAction(form({ websiteId: WEBSITE, question: "Hours?" }))).rejects.toThrow(`REDIRECT /seo/ai-visibility?website=${WEBSITE}&tab=access&notice=denied`);
    await expect(saveNlwebEndpointAction(form({ websiteId: WEBSITE, endpointUrl: "https://example.invalid/ask" }))).rejects.toThrow("notice=denied");
    await expect(prepareReferralReportAction(form({ websiteId: WEBSITE, days: "30" }))).rejects.toThrow("notice=denied");
    expect(await createCrawlerSourceAction(null, form({ websiteId: WEBSITE, label: "Log" }))).toEqual({ ok: false, error: "That website is not available." });
    authMock.mockResolvedValue({ user: { email: "manager@example.invalid" } });
    expect(await createCrawlerSourceAction(null, form({ websiteId: WEBSITE, label: "Log" }))).toEqual({ ok: false, error: "Connecting a crawler log source needs an administrator." });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("rejects an ingestion request without a valid source token", async () => {
    const call = (headers: Record<string, string>, body: string, websiteId = WEBSITE) =>
      ingest(new Request(`http://localhost/api/public/crawler-events/${websiteId}`, { method: "POST", headers, body }), { params: Promise.resolve({ websiteId }) });
    expect((await call({}, "{}")).status).toBe(404);
    expect((await call({ authorization: "Bearer short" }, "{}")).status).toBe(404);
    const token = `Bearer ${"a".repeat(43)}`;
    expect((await call({ authorization: token }, "not json")).status).toBe(400);
    expect((await call({ authorization: token }, JSON.stringify({ windowStart: "2026-11-01T00:00:00Z", windowEnd: "2026-11-02T00:00:00Z", events: [] }))).status).toBe(404);
  });
});
