import { describe, expect, it } from "vitest";
import { buildQueue, classifyTask, compareQueued } from "../src/services/queue";
import { compareValues } from "../src/services/reports";
import { addDays, daysBetween, todaySgt } from "../src/services/dates";
import { assertSeoRedirectAcyclic, normalizeSeoPath, SeoSoftLaunchRuleError } from "../src/services/seo-soft-launch";
import { csvCellSafe } from "./csv-helper";
import type { TaskRow } from "../src/services/tasks";

function task(over: Partial<TaskRow>): TaskRow {
  return {
    id: over.id ?? "00000000-0000-0000-0000-000000000001",
    client_id: "c", client_name: "C", client_slug: "c", title: "t", description: null, owner_user_id: "u", owner_name: "U",
    priority: "medium", status: "open", due_date: null, waiting_on: null, follow_up_date: null, related_type: null, related_id: null, related_title: null, reference_url: null,
    created_by: "u", created_by_name: "U", created_at: new Date("2026-10-01T00:00:00Z"), updated_at: new Date(), completed_at: null, cancelled_at: null, ...over,
  };
}

describe("queue scoring (A-07, A-08)", () => {
  const today = "2026-10-19";
  it("classifies sections and excludes completed and cancelled", () => {
    const q = buildQueue([
      task({ id: "1", due_date: "2026-10-10", priority: "high" }),
      task({ id: "2", due_date: "2026-10-19" }),
      task({ id: "3", status: "waiting", waiting_on: "x", follow_up_date: "2026-10-18", due_date: "2026-10-30" }),
      task({ id: "4", due_date: "2026-10-24" }),
      task({ id: "5", due_date: "2026-11-30" }),
      task({ id: "6", status: "completed", due_date: "2026-10-01" }),
      task({ id: "7", status: "cancelled", due_date: "2026-10-01" }),
      task({ id: "8", priority: "critical", due_date: "2026-10-21" }),
    ], today);
    expect(q.urgent.map((x) => x.task.id)).toEqual(["1", "8"]);
    expect(q.dueToday.map((x) => x.task.id)).toEqual(["2"]);
    expect(q.waiting.map((x) => x.task.id)).toEqual(["3"]);
    expect(q.waiting[0]!.followUpDue).toBe(true);
    expect(q.upcoming.map((x) => x.task.id)).toEqual(["4"]);
    expect(q.later.map((x) => x.task.id)).toEqual(["5"]);
  });
  it("is deterministic with stable tie-breaking", () => {
    const a = classifyTask(task({ id: "a", due_date: "2026-10-20", created_at: new Date("2026-10-02T00:00:00Z") }), today);
    const b = classifyTask(task({ id: "b", due_date: "2026-10-20", created_at: new Date("2026-10-01T00:00:00Z") }), today);
    expect(a.score).toBe(b.score);
    expect(compareQueued(a, b)).toBeGreaterThan(0);
    expect(compareQueued(b, a)).toBeLessThan(0);
    const same1 = classifyTask(task({ id: "z", due_date: "2026-10-20" }), today);
    const same2 = classifyTask(task({ id: "z", due_date: "2026-10-20" }), today);
    expect(compareQueued(same1, same2)).toBe(0);
    expect(classifyTask(task({ priority: "critical", due_date: "2026-10-04" }), today).score).toBe(40 + 14 * 5);
  });
});

describe("comparison maths (A-19)", () => {
  it("never divides by a zero baseline and treats missing as unavailable", () => {
    expect(compareValues("clicks", "Clicks", "count", { value: 10 }, { value: 0 })).toMatchObject({ absoluteChange: 10, percentChange: null, status: "zero_baseline" });
    expect(compareValues("clicks", "Clicks", "count", { value: 12 }, { value: 10 })).toMatchObject({ absoluteChange: 2, percentChange: 20, status: "ok" });
    expect(compareValues("clicks", "Clicks", "count", { value: null }, { value: 10 })).toMatchObject({ absoluteChange: null, percentChange: null, status: "current_unavailable" });
    expect(compareValues("clicks", "Clicks", "count", undefined, undefined).status).toBe("not_recorded");
    expect(compareValues("clicks", "Clicks", "count", { value: 0 }, { value: 0 })).toMatchObject({ absoluteChange: 0, percentChange: null, status: "zero_baseline" });
  });
});

describe("dates", () => {
  it("uses Asia/Singapore day boundaries", () => {
    expect(todaySgt(new Date("2026-10-18T17:30:00Z"))).toBe("2026-10-19");
    expect(todaySgt(new Date("2026-10-18T15:59:00Z"))).toBe("2026-10-18");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(daysBetween("2026-10-19", "2026-10-13")).toBe(-6);
  });
});

describe("csv safety", () => {
  it("escapes formula-leading cells", () => {
    expect(csvCellSafe("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCellSafe("plain")).toBe("plain");
  });

  describe("SEO redirects", () => {
    it("accepts local paths and rejects external, ambiguous, or internal paths", () => {
      expect(normalizeSeoPath("/old-page")).toBe("/old-page");
      expect(normalizeSeoPath("/")).toBe("/");
      expect(() => normalizeSeoPath("https://example.com/page")).toThrow(SeoSoftLaunchRuleError);
      expect(() => normalizeSeoPath("//example.com/page")).toThrow(SeoSoftLaunchRuleError);
      expect(() => normalizeSeoPath("/old?page=1")).toThrow(SeoSoftLaunchRuleError);
      expect(() => normalizeSeoPath("/api/secret")).toThrow(SeoSoftLaunchRuleError);
      expect(() => normalizeSeoPath("/sitemap.xml")).toThrow(SeoSoftLaunchRuleError);
    });

    it("allows direct redirects and detects self, indirect, and edited-rule loops", () => {
      const existing = [
        { id: "one", source_path: "/old", destination_path: "/new" },
        { id: "two", source_path: "/legacy", destination_path: "/old" },
      ];
      expect(() => assertSeoRedirectAcyclic(existing, "/another", "/new")).not.toThrow();
      expect(() => assertSeoRedirectAcyclic(existing, "/new", "/legacy")).toThrow(/loop/i);
      expect(() => assertSeoRedirectAcyclic(existing, "/new", "/new")).toThrow(/itself/i);
      expect(() => assertSeoRedirectAcyclic(existing, "/old", "/legacy", "one")).toThrow(/loop/i);
    });
  });
});
