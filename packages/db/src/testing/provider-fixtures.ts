/** Names for fixture scenarios. These are not live provider results. */
export const PROVIDER_FIXTURE_SCENARIOS = [
  { id: "success", description: "A mock provider returns rows and the job succeeds." },
  { id: "empty", description: "A mock provider returns no rows and the partition is empty." },
  { id: "expired-credentials", description: "An expired token with invalid_grant requires reconnect." },
  { id: "provider-error", description: "HTTP 500 is retried and does not replace stored data." },
  { id: "rate-limit", description: "HTTP 429 is retried with the provider retry delay." },
  { id: "stale", description: "A last-success time older than the freshness window is stale." },
  { id: "multiple-websites", description: "Two websites keep separate property results." },
  { id: "overlapping-sources", description: "An overlapping second source is rejected and not added." },
] as const;

export type ProviderFixtureScenarioId = (typeof PROVIDER_FIXTURE_SCENARIOS)[number]["id"];

const DEFAULT_FRESH_HOURS = 36;

export function syncIsStale(lastSuccessAt: Date | null, now: Date, maxAgeHours = DEFAULT_FRESH_HOURS): boolean {
  if (!lastSuccessAt || Number.isNaN(lastSuccessAt.getTime())) return true;
  return now.getTime() - lastSuccessAt.getTime() > maxAgeHours * 60 * 60 * 1000;
}
