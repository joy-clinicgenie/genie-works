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

import { checkRedirectAction, checkRobotsAction, checkSitemapAction, runWebsiteCheckAction } from "@/app/actions/seo-technical";
import { fetchReason, findingLabel, redirectFailureText } from "@/lib/technical-seo-view";

afterAll(async () => {
  await closePools();
});

const WEBSITE = "66666666-6666-4666-8666-666666666666";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("technical SEO actions are scoped on the server (SEO-04)", () => {
  it("refuses a website the server cannot resolve before any request to a website", async () => {
    authMock.mockResolvedValue({ user: { email: "admin@example.invalid" } });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(checkRobotsAction(form({ websiteId: WEBSITE }))).rejects.toThrow(`REDIRECT /seo/site-health?website=${WEBSITE}&tab=crawl&notice=denied`);
    await expect(checkSitemapAction(form({ websiteId: WEBSITE }))).rejects.toThrow("notice=denied");
    await expect(runWebsiteCheckAction(form({ websiteId: WEBSITE }))).rejects.toThrow("tab=checks&notice=denied");
    await expect(checkRedirectAction(form({ websiteId: WEBSITE, sourcePath: "/old", expectedPath: "/new" }))).rejects.toThrow("/seo/redirects?website=");
    await expect(checkRedirectAction(form({ websiteId: "not-a-website", sourcePath: "https://other.example.test/x", expectedPath: "/new" }))).rejects.toThrow("notice=denied");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("SEO-04 wording", () => {
  it("states reasons and redirect failures in plain words", () => {
    expect(fetchReason("http_404")).toBe("answered with HTTP status 404");
    expect(fetchReason("nested_index")).toMatch(/another sitemap index/);
    expect(findingLabel("missing_description")).toBe("Missing meta description");
    expect(redirectFailureText("loop")).toMatch(/^Redirect loop/);
    expect(redirectFailureText("wrong_destination")).toMatch(/different page/);
    expect(redirectFailureText(null)).toBe("Passed.");
  });
});
