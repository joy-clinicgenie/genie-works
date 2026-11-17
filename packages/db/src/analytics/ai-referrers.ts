/**
 * AI assistants whose referral visits GA4 records under its session source (D60). A source is
 * counted only when it matches one of these hosts; anything else is not an AI referral.
 * ChatGPT tags its links with `utm_source=chatgpt.com`, so its sessions appear under that source
 * even when the browser sends no referrer. Other assistants are recorded only when a referrer
 * reaches GA4, so an assistant with no sessions is "none recorded", not "never cited".
 */
export const AI_REFERRERS = [
  { platform: "ChatGPT", hosts: ["chatgpt.com", "chat.openai.com"] },
  { platform: "Perplexity", hosts: ["perplexity.ai"] },
  { platform: "Gemini", hosts: ["gemini.google.com", "bard.google.com"] },
  { platform: "Copilot", hosts: ["copilot.microsoft.com", "copilot.cloud.microsoft"] },
  { platform: "Claude", hosts: ["claude.ai"] },
] as const;

export type AiPlatform = (typeof AI_REFERRERS)[number]["platform"];

const ALL_HOSTS: string[] = AI_REFERRERS.flatMap((entry) => [...entry.hosts]);

/** The assistant a GA4 session source belongs to: the host itself or any subdomain of it. */
export function classifyAiSource(source: string): AiPlatform | null {
  const host = source.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0] ?? "";
  if (!host) return null;
  for (const entry of AI_REFERRERS) {
    if (entry.hosts.some((known) => host === known || host.endsWith(`.${known}`))) return entry.platform;
  }
  return null;
}

/** GA4 dimension filter that narrows a session source report to the known AI hosts. */
export function aiSourceDimensionFilter(): unknown {
  return {
    orGroup: {
      expressions: ALL_HOSTS.map((host) => ({
        filter: { fieldName: "sessionSource", stringFilter: { matchType: "CONTAINS", value: host, caseSensitive: false } },
      })),
    },
  };
}

export interface AiReferralSummary {
  platforms: Array<{ platform: AiPlatform; sessions: number; sources: string[] }>;
  total: number;
}

/** Adds stored source rows up by assistant. Rows that only contained a host name but are not that host are left out. */
export function summariseAiReferrals(rows: Array<{ source: string; sessions: number | null }>): AiReferralSummary {
  const byPlatform = new Map<AiPlatform, { sessions: number; sources: Set<string> }>();
  for (const row of rows) {
    const platform = classifyAiSource(row.source);
    if (!platform || row.sessions === null) continue;
    const current = byPlatform.get(platform) ?? { sessions: 0, sources: new Set<string>() };
    current.sessions += row.sessions;
    current.sources.add(row.source);
    byPlatform.set(platform, current);
  }
  const platforms = AI_REFERRERS.map((entry) => entry.platform)
    .filter((platform) => byPlatform.has(platform))
    .map((platform) => ({ platform, sessions: byPlatform.get(platform)!.sessions, sources: [...byPlatform.get(platform)!.sources].sort() }))
    .sort((a, b) => b.sessions - a.sessions);
  return { platforms, total: platforms.reduce((sum, item) => sum + item.sessions, 0) };
}
