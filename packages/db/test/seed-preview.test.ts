import { afterAll, describe, expect, it } from "vitest";
import { adminPool, appPool } from "./helpers";
import { insertPreviewSnapshot } from "../src/seed";

afterAll(async () => {
  await adminPool.end();
  await appPool.end();
});

describe("preview snapshot seed", () => {
  it("inserts a current snapshot once when the same unique key is sent again", async () => {
    const db = await adminPool.connect();
    try {
      await db.query("begin");
      const admin = await db.query<{ id: string }>("select id from staff_users where email = 'admin@example.invalid' and active limit 1");
      const actor = admin.rows[0]?.id;
      expect(actor).toBeTruthy();
      const client = await db.query<{ id: string }>(
        `insert into clients (slug, name, public_name, short_code, channels, is_synthetic, status)
         values ('fictional-seed-check', 'Fictional Seed Check Clinic', 'Fictional Seed Check Clinic', 'ZXSEED', '{}', true, 'active')
         returning id`,
      );
      const clientId = client.rows[0]!.id;
      const values = [clientId, "ga4_export", "all", "sessions", "2026-09-01", "2026-09-30", 12, "Synthetic seed check.", actor!] as [string, string, string, string, string, string, number, string, string];
      expect(await insertPreviewSnapshot(db, values)).toBe(1);
      expect(await insertPreviewSnapshot(db, values)).toBe(0);
      const current = await db.query<{ n: string }>(
        `select count(*)::text as n from report_snapshots
         where client_id = $1 and superseded_by_id is null`,
        [clientId],
      );
      const duplicates = await db.query<{ n: string }>(
        `select count(*)::text as n from (
           select 1 from report_snapshots
           where client_id = $1 and superseded_by_id is null
           group by client_id, source, channel, metric, dimension, period_start, period_end
           having count(*) > 1
         ) dupes`,
        [clientId],
      );
      expect(current.rows[0]?.n).toBe("1");
      expect(duplicates.rows[0]?.n).toBe("0");
    } finally {
      await db.query("rollback");
      db.release();
    }
  });
});
