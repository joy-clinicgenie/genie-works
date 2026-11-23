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

import { acceptRecommendationAction, dismissRecommendationAction, moveSeoIssueAction, recordSetupReviewAction, refreshRecommendationsAction, verifySeoIssueAction } from "@/app/actions/seo-work";

afterAll(async () => {
  await closePools();
});

const WEBSITE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ITEM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("checklist and task actions are scoped on the server (SEO-02)", () => {
  it("refuses a website the server cannot resolve before changing anything", async () => {
    authMock.mockResolvedValue({ user: { email: "admin@example.invalid" } });
    const denied = (tab: string) => `REDIRECT /seo/tasks?website=${WEBSITE}&tab=${tab}&notice=denied`;
    await expect(recordSetupReviewAction(form({ websiteId: WEBSITE, step: "homepage_seo" }))).rejects.toThrow(denied("setup"));
    await expect(moveSeoIssueAction(form({ websiteId: WEBSITE, issueId: ITEM, to: "investigating" }))).rejects.toThrow(denied("issues"));
    await expect(verifySeoIssueAction(form({ websiteId: WEBSITE, issueId: ITEM, evidence: "recorded", note: "x" }))).rejects.toThrow(denied("issues"));
    await expect(refreshRecommendationsAction(form({ websiteId: WEBSITE }))).rejects.toThrow(denied("recommendations"));
    await expect(acceptRecommendationAction(form({ websiteId: WEBSITE, recommendationId: ITEM }))).rejects.toThrow(denied("recommendations"));
    await expect(dismissRecommendationAction(form({ websiteId: WEBSITE, recommendationId: ITEM }))).rejects.toThrow(denied("recommendations"));
  });
});
