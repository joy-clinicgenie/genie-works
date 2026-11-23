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

import { checkLivePageAction, inspectPageAction } from "@/app/actions/seo-pages";
import { inspectionErrorText, isConnectionProblem, liveErrorText, valueSourceLabel, verdictLabel } from "@/lib/seo-pages-view";

afterAll(async () => {
  await closePools();
});

const WEBSITE = "44444444-4444-4444-8444-444444444444";
const PAGE = "55555555-5555-4555-8555-555555555555";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("page actions resolve the website and page on the server (SEO-03)", () => {
  it("refuses a page the server cannot resolve inside the website, before any fetch or Google call", async () => {
    authMock.mockResolvedValue({ user: { email: "admin@example.invalid" } });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const denied = `REDIRECT /seo/pages?website=${WEBSITE}&notice=page_unavailable`;
    await expect(inspectPageAction(form({ websiteId: WEBSITE, pageId: PAGE }))).rejects.toThrow(denied);
    await expect(checkLivePageAction(form({ websiteId: WEBSITE, pageId: PAGE }))).rejects.toThrow(denied);
    await expect(inspectPageAction(form({ websiteId: "not-a-website", pageId: PAGE }))).rejects.toThrow("notice=page_unavailable");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("SEO-03 wording", () => {
  it("names inherited and overridden values", () => {
    expect(valueSourceLabel("override")).toBe("Page override");
    expect(valueSourceLabel("blog")).toBe("Inherited from the blog article");
    expect(valueSourceLabel("website_default")).toBe("Inherited from the website default");
  });

  it("uses Google's verdict terms and routes connection problems to Website Connections", () => {
    expect(verdictLabel("PASS")).toBe("Valid");
    expect(verdictLabel("NEUTRAL")).toBe("Excluded");
    expect(verdictLabel("FAIL")).toBe("Error");
    expect(verdictLabel(null)).toBe("Unknown");
    expect(isConnectionProblem("outside_property")).toBe(true);
    expect(isConnectionProblem("reconnect_required")).toBe(true);
    expect(isConnectionProblem("inspection_forbidden")).toBe(true);
    expect(isConnectionProblem("provider_unavailable")).toBe(false);
    expect(inspectionErrorText("outside_property")).toMatch(/not sent to Google/);
    expect(liveErrorText("http_404")).toBe("The page answered with HTTP status 404.");
  });
});
