import { afterAll, describe, expect, it, vi } from "vitest";
import { closePools } from "@clinic-genie/db";

const authMock = vi.hoisted(() => vi.fn());
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T extends (...args: never[]) => unknown>(fn: T) => fn };
});
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("./auth", () => ({ auth: authMock }));

import { prepareSearchReportAction } from "@/app/actions/seo-reports";

afterAll(async () => {
  await closePools();
});

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("preparing Search Console reports (SEO-07.1)", () => {
  it("refuses an unresolvable website and a specialist before queuing anything", async () => {
    const website = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    authMock.mockResolvedValue({ user: { email: "admin@example.invalid" } });
    await expect(prepareSearchReportAction(form({ websiteId: website, range: "30" }))).rejects.toThrow(`REDIRECT /seo/reports?website=${website}&tab=google-search&range=30&notice=denied`);
    authMock.mockResolvedValue({ user: { email: "specialist-a@example.invalid" } });
    await expect(prepareSearchReportAction(form({ websiteId: website, range: "7" }))).rejects.toThrow(/notice=denied/);
  });
});
