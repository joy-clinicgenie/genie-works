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

import { recordBranchReviewAction } from "@/app/actions/seo-branches";

afterAll(async () => {
  await closePools();
});

const WEBSITE = "88888888-8888-4888-8888-888888888888";
const BRANCH = "99999999-9999-4999-8999-999999999999";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("branch review action (SEO-06.2)", () => {
  it("refuses a website or branch the server cannot resolve", async () => {
    authMock.mockResolvedValue({ user: { email: "admin@example.invalid" } });
    await expect(recordBranchReviewAction(form({ websiteId: WEBSITE, branchId: BRANCH, reviewedOn: "2026-11-20", reviewed_phone: "on" }))).rejects.toThrow(`REDIRECT /seo/business-profile/${BRANCH}?website=${WEBSITE}&notice=denied`);
    await expect(recordBranchReviewAction(form({ websiteId: "not-a-website", branchId: BRANCH }))).rejects.toThrow("notice=denied");
  });
});
