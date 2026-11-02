/**
 * Idempotent local test staff and the internal agency record.
 * It does not create a fictional clinic, website, or preview figure.
 * `npm run db:seed` refuses a remote database, so these accounts are not added there.
 */
import type pg from "pg";
import { createClient, createStaff } from "./services/registry";

export interface SeedSummary {
  seeded: boolean;
  staff: number;
  clients: number;
  tasks: number;
}

export const DEMO_STAFF = [
  { email: "admin@example.invalid", name: "Demo Admin", role: "admin" },
  { email: "manager@example.invalid", name: "Demo Manager", role: "manager" },
  { email: "specialist-a@example.invalid", name: "Demo Specialist A", role: "specialist" },
  { email: "specialist-b@example.invalid", name: "Demo Specialist B", role: "specialist" },
  { email: "reviewer@example.invalid", name: "Demo Reviewer", role: "reviewer" },
  { email: "readonly@example.invalid", name: "Demo Read-only", role: "read_only" },
] as const;

/** One current snapshot row. A repeat of the live unique key inserts nothing. */
export async function insertPreviewSnapshot(
  db: pg.PoolClient,
  values: [string, string, string, string, string, string, number, string, string],
): Promise<number> {
  const result = await db.query(
    `insert into report_snapshots (client_id, source, channel, metric, dimension, period_start, period_end, value, unit, note, entered_by)
     values ($1, $2, $3, $4, '', $5, $6, $7, 'count', $8, $9)
     on conflict do nothing`,
    values,
  );
  return result.rowCount ?? 0;
}

/** Internal agency directory row. Idempotent. Not a clinic client. */
async function ensureInternalAgencyClient(db: pg.PoolClient): Promise<void> {
  const existing = await db.query("select 1 from clients where slug = 'clinic-genie' or reference_number = 'CG-000'");
  if (existing.rows.length) return;
  const admin = await db.query<{ id: string }>("select id from staff_users where email = 'admin@example.invalid' and active limit 1");
  const actor = admin.rows[0]?.id;
  if (!actor) return;
  await createClient(db, {
    slug: "clinic-genie",
    name: "Clinic Genie",
    ownerUserId: actor,
    channels: ["website", "seo"],
    isSynthetic: false,
    notes: "Internal Clinic Genie record for agency work. Not a clinic client.",
    referenceNumber: "CG-000",
    shortCode: "CG",
    specialty: "Internal agency",
    legalName: "Clinic Genie",
    publicName: "Clinic Genie",
    enquiryOwnerUserId: actor,
    notificationOwnerUserId: actor,
    administrationOwnerUserId: actor,
  }, actor);
}

export async function seedDemo(pool: pg.Pool, log: (l: string) => void = () => {}): Promise<SeedSummary> {
  const db = await pool.connect();
  try {
    await db.query("begin");
    await db.query("select set_config('app.context', 'service', true)");
    let staff = 0;
    for (const person of DEMO_STAFF) {
      const existing = await db.query<{ id: string }>("select id from staff_users where email = $1", [person.email]);
      if (existing.rows[0]) continue;
      await createStaff(db, { email: person.email, displayName: person.name, role: person.role }, null);
      staff += 1;
    }
    await ensureInternalAgencyClient(db);
    const admin = await db.query<{ id: string }>("select id from staff_users where email = 'admin@example.invalid' and active limit 1");
    if (admin.rows[0] && staff > 0) {
      await db.query(
        "insert into audit_events (actor_type, actor_user_id, action, target_type, outcome, metadata) values ('system', $1, 'seed.run', 'database', 'success', $2)",
        [admin.rows[0].id, JSON.stringify({ synthetic: true, staff })],
      );
    }
    await db.query("commit");
    log(staff ? `Staff added: ${staff}.` : "Staff and the internal agency record are already present.");
    return { seeded: staff > 0, staff, clients: 0, tasks: 0 };
  } catch (err) {
    await db.query("rollback");
    throw err;
  } finally {
    db.release();
  }
}
