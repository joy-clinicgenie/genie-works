import { afterAll, describe, expect, it } from "vitest";
import { applyContext } from "../src/client";
import { adminPool, appPool, asContext, staffByEmail, staffCtx } from "./helpers";
import { provisionClinic } from "./provision";
import type pg from "pg";
import { composeReport, costPerLead, conversionRate } from "../src/services/report-builder";
import { createSavedReport, getSavedReport } from "../src/services/saved-reports";

async function record(db: pg.PoolClient, clientId: string, actorId: string, source: string, metric: string, value: number, start: string, end: string, unit = "count") {
  await db.query(
    `insert into report_snapshots (client_id, source, channel, metric, period_start, period_end, value, unit, entered_by)
     values ($1, $2, 'all', $3, $4, $5, $6, $7, $8)`,
    [clientId, source, metric, start, end, value, unit, actorId],
  );
}

afterAll(async () => {
  await adminPool.end();
  await appPool.end();
});

describe("report builder measurement rules", () => {
  it("calculates cost per lead only from cost and recorded enquiries", () => {
    expect(costPerLead(100, 4)).toEqual({ value: 25, note: "Advertising cost divided by recorded enquiries. Contact clicks are not included." });
    expect(costPerLead(100, null).value).toBeNull();
    expect(costPerLead(null, 4).value).toBeNull();
    expect(costPerLead(100, 0).value).toBeNull();
  });

  it("does not treat a session count as optional when enquiries are missing", () => {
    expect(conversionRate(null, 200).value).toBeNull();
    expect(conversionRate(10, 200).value).toBe(5);
    expect(conversionRate(10, 0).value).toBeNull();
  });

  it("keeps clicks out of the lead total and leaves cost per lead blank without both inputs", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    const built = await asContext(staffCtx(admin), async (db) => {
      const { clientId: client } = await provisionClinic(db, admin.id);
      await record(db, client, admin.id, "clinic_records", "enquiries", 4, "2030-04-01", "2030-04-30");
      await record(db, client, admin.id, "manual", "form_submissions", 7, "2030-04-01", "2030-04-30");
      await record(db, client, admin.id, "manual", "contact_whatsapp", 9, "2030-04-01", "2030-04-30");
      await record(db, client, admin.id, "manual", "contact_booking", 3, "2030-04-01", "2030-04-30");
      await record(db, client, admin.id, "manual", "contact_clicks", 15, "2030-04-01", "2030-04-30");
      await record(db, client, admin.id, "google_ads_export", "cost", 100, "2030-04-01", "2030-04-30", "sgd");
      return composeReport(db, {
        clientId: client,
        websiteId: null,
        periodStart: "2030-04-01",
        periodEnd: "2030-04-30",
        comparisonStart: null,
        comparisonEnd: null,
        items: ["total_leads", "form_submissions", "whatsapp_clicks", "call_clicks", "booking_clicks", "cost_per_lead"],
      });
    });
    const line = (key: string) => built.blocks.find((block) => block.itemKey === key)?.lines[0];
    expect(line("total_leads")?.current).toBe("4");
    expect(line("form_submissions")?.current).toBe("7");
    expect(line("whatsapp_clicks")?.current).toBe("9");
    expect(line("whatsapp_clicks")?.note).toMatch(/not a confirmed enquiry/);
    expect(line("booking_clicks")?.note).toMatch(/not a confirmed appointment/);
    expect(line("call_clicks")?.current).toBe("Not recorded");
    expect(line("call_clicks")?.note).toMatch(/undifferentiated contact click/);
    expect(line("cost_per_lead")?.current).toBe("SGD 25.00");
  });

  it("does not calculate cost per lead from clicks when enquiries are absent", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    const built = await asContext(staffCtx(admin), async (db) => {
      const { clientId: client } = await provisionClinic(db, admin.id);
      await record(db, client, admin.id, "google_ads_export", "cost", 80, "2030-05-01", "2030-05-31", "sgd");
      await record(db, client, admin.id, "manual", "contact_whatsapp", 6, "2030-05-01", "2030-05-31");
      return composeReport(db, {
        clientId: client,
        websiteId: null,
        periodStart: "2030-05-01",
        periodEnd: "2030-05-31",
        comparisonStart: null,
        comparisonEnd: null,
        items: ["total_leads", "cost_per_lead", "whatsapp_clicks"],
      });
    });
    expect(built.blocks.find((block) => block.itemKey === "total_leads")?.lines[0]?.current).toBe("Not recorded");
    expect(built.blocks.find((block) => block.itemKey === "cost_per_lead")?.lines[0]?.current).toBe("Not recorded");
    expect(built.blocks.find((block) => block.itemKey === "whatsapp_clicks")?.lines[0]?.current).toBe("6");
  });

  it("saves a draft without a client-review version and hides another client's figures", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    const specialist = await staffByEmail("specialist-b@example.invalid");
    await asContext(staffCtx(admin), async (db) => {
      const { clientId: client } = await provisionClinic(db, admin.id);
      await record(db, client, admin.id, "ga4_export", "sessions", 40, "2030-06-01", "2030-06-30");
      const id = await createSavedReport(db, {
        clientId: client,
        name: "January draft",
        periodStart: "2030-04-01",
        periodEnd: "2030-04-30",
        comparisonStart: null,
        comparisonEnd: null,
        sections: [],
        checklist: ["sessions", "total_leads"],
        summary: null,
        observations: null,
        actionsTaken: null,
        nextSteps: null,
        dataSourcesNote: null,
        missingConnections: null,
        measurementLimitations: null,
        reportType: "monthly",
        templateKey: "monthly",
      }, admin.id, { draft: true });
      const saved = await getSavedReport(db, id);
      expect(saved?.status).toBe("draft");
      expect(saved?.versions).toHaveLength(0);
      expect(saved?.checklist).toEqual(expect.arrayContaining(["sessions", "total_leads"]));
      const period = (await db.query<{ start: string; end: string }>(
        `select period_start::text as start, period_end::text as end
         from report_snapshots
         where client_id = $1 and metric = 'sessions' and superseded_by_id is null
         order by period_end desc limit 1`,
        [client],
      )).rows[0]!;
      const visible = await composeReport(db, {
        clientId: client,
        websiteId: null,
        periodStart: period.start.slice(0, 10),
        periodEnd: period.end.slice(0, 10),
        comparisonStart: null,
        comparisonEnd: null,
        items: ["sessions"],
      });
      expect(visible.blocks[0]?.lines[0]?.current).not.toBe("Not recorded");
      await applyContext(db, staffCtx(specialist));
      await db.query("savepoint outsider_report");
      await expect(createSavedReport(db, {
        clientId: client,
        name: "Not allowed",
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
        comparisonStart: null,
        comparisonEnd: null,
        sections: ["traffic"],
        summary: null,
        observations: null,
        actionsTaken: null,
        nextSteps: null,
        dataSourcesNote: null,
        missingConnections: null,
        measurementLimitations: null,
      }, specialist.id)).rejects.toThrow();
      await db.query("rollback to savepoint outsider_report");
      const hidden = await composeReport(db, {
        clientId: client,
        websiteId: null,
        periodStart: period.start.slice(0, 10),
        periodEnd: period.end.slice(0, 10),
        comparisonStart: null,
        comparisonEnd: null,
        items: ["sessions"],
      });
      expect(hidden.blocks[0]?.lines[0]?.current).toBe("Not recorded");
    });
  });
});
