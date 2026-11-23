import { describe, expect, it } from "vitest";
import { drainProviderJobs } from "../src/analytics/worker-run";

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

  it("does not start a job that the longest job so far says cannot finish before the deadline (Phase 2.2)", async () => {
    let time = 0;
    let calls = 0;
    const result = await drainProviderJobs(async () => {
      calls += 1;
      time += 60;
      return { worked: true, result: "retry" };
    }, { limit: 10, deadlineAt: 100, now: () => time });

    // The first job takes 60. At 60 with a deadline of 100, another 60 would end at 120, so it does not start.
    expect(calls).toBe(1);
    expect(result).toMatchObject({ jobs: 1, retryScheduled: 1, stopped: "deadline" });
  });
});
