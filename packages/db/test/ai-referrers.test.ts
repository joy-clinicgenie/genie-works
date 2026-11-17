import { describe, expect, it } from "vitest";
import { classifyAiSource, summariseAiReferrals } from "../src/analytics/ai-referrers";
import { GA4_TEMPLATES, ga4ReportBody } from "../src/analytics/providers/ga4";

describe("AI referral sources (D60)", () => {
  it("names each assistant by its host or a subdomain of it", () => {
    expect(classifyAiSource("chatgpt.com")).toBe("ChatGPT");
    expect(classifyAiSource("chat.openai.com")).toBe("ChatGPT");
    expect(classifyAiSource("www.perplexity.ai")).toBe("Perplexity");
    expect(classifyAiSource("gemini.google.com")).toBe("Gemini");
    expect(classifyAiSource("copilot.microsoft.com")).toBe("Copilot");
    expect(classifyAiSource("Claude.ai")).toBe("Claude");
    expect(classifyAiSource("https://claude.ai/chat")).toBe("Claude");
  });

  it("refuses a source that only contains an AI host name", () => {
    expect(classifyAiSource("notchatgpt.com")).toBeNull();
    expect(classifyAiSource("claude.ai.example.com")).toBeNull();
    expect(classifyAiSource("google")).toBeNull();
    expect(classifyAiSource("(direct)")).toBeNull();
    expect(classifyAiSource("")).toBeNull();
  });

  it("adds sources up by assistant and leaves out unknown or unavailable rows", () => {
    const summary = summariseAiReferrals([
      { source: "chatgpt.com", sessions: 12 },
      { source: "chat.openai.com", sessions: 3 },
      { source: "perplexity.ai", sessions: 4 },
      { source: "fakeperplexity.ai", sessions: 99 },
      { source: "claude.ai", sessions: null },
    ]);
    expect(summary.total).toBe(19);
    expect(summary.platforms).toEqual([
      { platform: "ChatGPT", sessions: 15, sources: ["chat.openai.com", "chatgpt.com"] },
      { platform: "Perplexity", sessions: 4, sources: ["perplexity.ai"] },
    ]);
  });

  it("is empty, not zero-filled, when GA4 returned no AI rows", () => {
    expect(summariseAiReferrals([])).toEqual({ platforms: [], total: 0 });
  });

  it("asks GA4 only for sessions whose source contains a known AI host", () => {
    const body = ga4ReportBody({ start: "2026-11-01", end: "2026-11-07", ...GA4_TEMPLATES["ga4.ai_referrals"]! }) as {
      dimensions: Array<{ name: string }>;
      dimensionFilter: { orGroup: { expressions: Array<{ filter: { fieldName: string; stringFilter: { value: string } } }> } };
      keepEmptyRows: boolean;
    };
    expect(body.dimensions).toEqual([{ name: "sessionSource" }]);
    const values = body.dimensionFilter.orGroup.expressions.map((item) => item.filter.stringFilter.value);
    expect(values).toEqual(expect.arrayContaining(["chatgpt.com", "perplexity.ai", "gemini.google.com", "copilot.microsoft.com", "claude.ai"]));
    expect(body.dimensionFilter.orGroup.expressions.every((item) => item.filter.fieldName === "sessionSource")).toBe(true);
    expect(body.keepEmptyRows).toBe(false);
  });

  it("sends no filter for reports that have none", () => {
    const body = ga4ReportBody({ start: "2026-11-01", end: "2026-11-07", ...GA4_TEMPLATES["ga4.acquisition"]! }) as Record<string, unknown>;
    expect("dimensionFilter" in body).toBe(false);
  });
});
