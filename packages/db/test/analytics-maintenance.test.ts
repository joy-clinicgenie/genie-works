import { describe, expect, it } from "vitest";
import { drainProviderJobs } from "../src/analytics/maintenance";

describe("analytics maintenance drain", () => {
  it("processes multiple jobs and continues after one permanently fails", async () => {
    const outcomes = ["failed", "succeeded", "succeeded"] as const;
    let index = 0;
    const result = await drainProviderJobs(async () => {
      const outcome = outcomes[index++];
      return outcome ? { worked: true, result: outcome } : { worked: false };
    }, { limit: 10, deadlineAt: 1000, now: () => 0 });

    expect(result).toMatchObject({ jobs: 3, failed: 1, succeeded: 2 });
  });

  it("counts a missing server setting separately and keeps draining (D51)", async () => {
    const outcomes = ["not_configured", "succeeded"] as const;
    let index = 0;
    const result = await drainProviderJobs(async () => {
      const outcome = outcomes[index++];
      return outcome ? { worked: true, result: outcome } : { worked: false };
    }, { limit: 10, deadlineAt: 1000, now: () => 0 });

    expect(result).toMatchObject({ jobs: 2, notConfigured: 1, succeeded: 1, failed: 0, reconnectRequired: 0 });
  });

  it("stops at the configured limit", async () => {
    let calls = 0;
    const result = await drainProviderJobs(async () => {
      calls += 1;
      return { worked: true, result: "succeeded" };
    }, { limit: 2, deadlineAt: 1000, now: () => 0 });

    expect(calls).toBe(2);
    expect(result.jobs).toBe(2);
  });

  it("does not start another job once the deadline is reached", async () => {
    let time = 0;
    let calls = 0;
    const result = await drainProviderJobs(async () => {
      calls += 1;
      time += 60;
      return { worked: true, result: "retry" };
    }, { limit: 10, deadlineAt: 100, now: () => time });

    expect(calls).toBe(2);
    expect(result).toMatchObject({ jobs: 2, retryScheduled: 2 });
  });
});
