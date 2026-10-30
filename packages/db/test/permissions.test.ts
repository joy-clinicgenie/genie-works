import { afterAll, describe, expect, it } from "vitest";
import { SERVICE } from "../src/client";
import { adminPool, appPool, asContext, clientBySlug, staffByEmail, staffCtx } from "./helpers";
import { getActiveStaffByEmail } from "../src/services/auth";
import {
  RegistryRuleError, createAccountReference, createWebsite, listAccountReferences, listClients, listWebsites, updateAccountReference, updateStaff, updateWebsite, type WebsiteRow,
} from "../src/services/registry";
import { listTasks, createTask } from "../src/services/tasks";
import { listApprovals } from "../src/services/approvals";
import { listIssues } from "../src/services/issues";
import { listClaims } from "../src/services/medical";

afterAll(async () => {
  await adminPool.end();
  await appPool.end();
});

describe("client isolation through row-level security (A-04, A-05, A-06)", () => {
  it("a specialist sees only clients they are a member of", async () => {
    const specB = await staffByEmail("specialist-b@example.invalid");
    const clients = await asContext(staffCtx(specB), (db) => listClients(db, { includeArchived: true }));
    expect(clients.map((c) => c.slug)).toEqual(["northgate-physio"]);
  });

  it("direct queries for another client's tasks, approvals, issues and claims return nothing", async () => {
    const specB = await staffByEmail("specialist-b@example.invalid");
    const harbour = await clientBySlug("harbourview-dental");
    const meridian = await clientBySlug("meridian-skin");
    const result = await asContext(staffCtx(specB), async (db) => ({
      tasks: await listTasks(db, { clientId: harbour }),
      approvals: await listApprovals(db, { clientId: harbour }),
      issues: await listIssues(db, { clientId: meridian }),
      claims: await listClaims(db, { clientId: meridian }),
      rawTasks: (await db.query("select count(*)::int as n from tasks where client_id = $1", [harbour])).rows[0].n,
      rawSnapshots: (await db.query("select count(*)::int as n from report_snapshots where client_id = $1", [harbour])).rows[0].n,
    }));
    expect(result.tasks).toHaveLength(0);
    expect(result.approvals).toHaveLength(0);
    expect(result.issues).toHaveLength(0);
    expect(result.claims).toHaveLength(0);
    expect(result.rawTasks).toBe(0);
    expect(result.rawSnapshots).toBe(0);
  });

  it("guessing a record id outside the membership behaves as not found", async () => {
    const specB = await staffByEmail("specialist-b@example.invalid");
    const { rows } = await adminPool.query("select t.id from tasks t join clients c on c.id = t.client_id where c.slug = 'harbourview-dental' limit 1");
    const found = await asContext(staffCtx(specB), async (db) => (await db.query("select id from tasks where id = $1", [rows[0].id])).rows.length);
    expect(found).toBe(0);
  });

  it("a specialist cannot insert a task for a client they do not belong to, even with a valid id", async () => {
    const specB = await staffByEmail("specialist-b@example.invalid");
    const harbour = await clientBySlug("harbourview-dental");
    await expect(
      asContext(staffCtx(specB), (db) => createTask(db, { clientId: harbour, title: "Cross-client write", description: null, ownerUserId: specB.id, priority: "low", dueDate: null, relatedType: null, relatedId: null }, specB.id)),
    ).rejects.toThrow();
  });

  it("read-only users cannot mutate records through direct statements", async () => {
    const ro = await staffByEmail("readonly@example.invalid");
    const harbour = await clientBySlug("harbourview-dental");
    const visible = await asContext(staffCtx(ro), (db) => listTasks(db, { clientId: harbour }));
    expect(visible.length).toBeGreaterThan(0);
    await expect(asContext(staffCtx(ro), (db) => db.query("update tasks set title = 'tampered' where id = $1", [visible[0]!.id]).then((r) => { if ((r.rowCount ?? 0) === 0) throw new Error("no rows updated"); }))).rejects.toThrow();
    await expect(asContext(staffCtx(ro), (db) => db.query("insert into task_notes (task_id, client_id, author_user_id, body) values ($1, $2, $3, 'x')", [visible[0]!.id, harbour, ro.id]))).rejects.toThrow();
  });

  it("a reviewer can read their client's records but cannot edit tasks", async () => {
    const reviewer = await staffByEmail("reviewer@example.invalid");
    const meridian = await clientBySlug("meridian-skin");
    const tasks = await asContext(staffCtx(reviewer), (db) => listTasks(db, { clientId: meridian }));
    expect(tasks.length).toBeGreaterThan(0);
    const updated = await asContext(staffCtx(reviewer), async (db) => (await db.query("update tasks set title = 'tampered' where id = $1", [tasks[0]!.id])).rowCount);
    expect(updated).toBe(0);
  });

  it("two specialists see only their own client websites", async () => {
    const specA = await staffByEmail("specialist-a@example.invalid");
    const specB = await staffByEmail("specialist-b@example.invalid");
    const sites = async (user: Awaited<ReturnType<typeof staffByEmail>>) =>
      asContext(staffCtx(user), async (db) => (await db.query<{ slug: string }>("select c.slug from websites w join clients c on c.id = w.client_id order by c.slug")).rows.map((r) => r.slug));
    expect(await sites(specA)).toEqual(["harbourview-dental", "meridian-skin", "meridian-skin"]);
    expect(await sites(specB)).toEqual(["northgate-physio"]);
  });

  it("a specialist cannot add a website, even for a client they belong to", async () => {
    const specB = await staffByEmail("specialist-b@example.invalid");
    const northgate = await clientBySlug("northgate-physio");
    await expect(
      asContext(staffCtx(specB), (db) => db.query("insert into websites (client_id, name, platform) values ($1, 'Cross-role site', 'unknown')", [northgate])),
    ).rejects.toThrow(/row-level security/);
  });

  it("staff and anonymous contexts cannot read sign-in sessions", async () => {
    const specA = await staffByEmail("specialist-a@example.invalid");
    const staff = await asContext(staffCtx(specA), async (db) => (await db.query("select count(*)::int as n from sessions")).rows[0].n);
    const anon = await asContext({ kind: "public" }, async (db) => (await db.query("select count(*)::int as n from sessions")).rows[0].n);
    const links = await asContext(staffCtx(specA), async (db) => (await db.query("select count(*)::int as n from dev_magic_links")).rows[0].n);
    expect(staff).toBe(0);
    expect(anon).toBe(0);
    expect(links).toBe(0);
  });

  it("an anonymous (public) context sees no client data at all", async () => {
    const counts = await asContext({ kind: "public" }, async (db) => ({
      clients: (await db.query("select count(*)::int as n from clients")).rows[0].n,
      tasks: (await db.query("select count(*)::int as n from tasks")).rows[0].n,
      audit: (await db.query("select count(*)::int as n from audit_events")).rows[0].n,
    }));
    expect(counts).toEqual({ clients: 0, tasks: 0, audit: 0 });
  });

  it("a deactivated member loses access and live sessions immediately", async () => {
    const specA = await staffByEmail("specialist-a@example.invalid");
    const admin = await staffByEmail("admin@example.invalid");
    const person = (await adminPool.query<{ display_name: string; email: string; platform_role: "specialist" }>(
      "select display_name, email, platform_role from staff_users where id = $1",
      [specA.id],
    )).rows[0]!;
    const harbour = await clientBySlug("harbourview-dental");
    const token = `deactivation-test-${specA.id}`;
    let createdUserId: number | null = null;
    await asContext({ kind: "service" }, async (db) => {
      const existing = await db.query<{ id: number }>("select id from users where lower(email) = lower($1) limit 1", [person.email]);
      const userId = existing.rows[0]?.id ?? (await db.query<{ id: number }>("insert into users (email, name) values ($1, $2) returning id", [person.email, person.display_name])).rows[0]!.id;
      if (!existing.rows[0]) createdUserId = userId;
      await db.query(`insert into sessions ("userId", expires, "sessionToken") values ($1, now() + interval '1 hour', $2)`, [userId, token]);
    }, { commit: true });
    try {
      const before = await asContext(staffCtx(specA), (db) => listTasks(db, { clientId: harbour }));
      expect(before.length).toBeGreaterThan(0);
      const revoked = await asContext(
        staffCtx(admin),
        (db) => updateStaff(db, specA.id, { displayName: person.display_name, role: person.platform_role, active: false }, admin.id),
        { commit: true },
      );
      expect(revoked.sessionsRevoked).toBeGreaterThanOrEqual(1);
      const after = await asContext(staffCtx(specA), (db) => listTasks(db, { clientId: harbour }));
      expect(after).toHaveLength(0);
      const hidden = await asContext(SERVICE, (db) => getActiveStaffByEmail(db, person.email));
      expect(hidden).toBeNull();
      const sessions = await asContext({ kind: "service" }, async (db) => (await db.query<{ n: number }>(`select count(*)::int as n from sessions where "sessionToken" = $1`, [token])).rows[0]!.n);
      expect(sessions).toBe(0);
    } finally {
      await asContext(
        staffCtx(admin),
        (db) => updateStaff(db, specA.id, { displayName: person.display_name, role: person.platform_role, active: true }, admin.id),
        { commit: true },
      );
      await asContext({ kind: "service" }, async (db) => {
        await db.query(`delete from sessions where "sessionToken" = $1`, [token]);
        if (createdUserId) await db.query("delete from users where id = $1", [createdUserId]);
      }, { commit: true });
    }
    const restored = await asContext(SERVICE, (db) => getActiveStaffByEmail(db, person.email));
    expect(restored?.id).toBe(specA.id);
  });

  it("a specialist or manager cannot deactivate a staff account or change its role", async () => {
    const specA = await staffByEmail("specialist-a@example.invalid");
    const manager = await staffByEmail("manager@example.invalid");
    const admin = await staffByEmail("admin@example.invalid");
    const person = (await adminPool.query<{ display_name: string; platform_role: "specialist"; active: boolean }>(
      "select display_name, platform_role, active from staff_users where id = $1",
      [specA.id],
    )).rows[0]!;
    const unchanged = async () => {
      const row = (await adminPool.query<{ display_name: string; platform_role: string; active: boolean }>(
        "select display_name, platform_role, active from staff_users where id = $1",
        [specA.id],
      )).rows[0]!;
      expect(row).toEqual({ display_name: person.display_name, platform_role: person.platform_role, active: person.active });
    };
    try {
      await expect(asContext(staffCtx(specA), (db) => updateStaff(db, specA.id, {
        displayName: person.display_name, role: "admin", active: false,
      }, specA.id))).rejects.toThrow(/Only an admin can change access, email or account status/);
      await unchanged();
      await expect(asContext(staffCtx(manager), (db) => updateStaff(db, specA.id, {
        displayName: person.display_name, role: "read_only", active: false,
      }, manager.id))).rejects.toBeInstanceOf(RegistryRuleError);
      await unchanged();
    } finally {
      const row = (await adminPool.query<{ platform_role: "specialist"; active: boolean; display_name: string }>(
        "select display_name, platform_role, active from staff_users where id = $1",
        [specA.id],
      )).rows[0]!;
      if (row.active !== person.active || row.platform_role !== person.platform_role || row.display_name !== person.display_name) {
        await asContext(staffCtx(admin), (db) => updateStaff(db, specA.id, {
          displayName: person.display_name, role: person.platform_role, active: person.active,
        }, admin.id), { commit: true });
      }
    }
  });

  it("a specialist website update that changes no row fails instead of reporting success", async () => {
    const specA = await staffByEmail("specialist-a@example.invalid");
    const harbour = await clientBySlug("harbourview-dental");
    const site = (await adminPool.query<WebsiteRow>("select * from websites where client_id = $1 and status = 'active' limit 1", [harbour])).rows[0]!;
    await expect(asContext(staffCtx(specA), (db) => updateWebsite(db, site.id, {
      name: `${site.name} edited`,
      url: site.url,
      platform: site.platform,
      environment: site.environment,
      status: site.status,
      notes: site.notes,
    }, specA.id))).rejects.toBeInstanceOf(RegistryRuleError);
    const name = (await adminPool.query<{ name: string }>("select name from websites where id = $1", [site.id])).rows[0]!.name;
    expect(name).toBe(site.name);
  });

  it("an admin or manager can create and update a website, then read the saved values", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    const manager = await staffByEmail("manager@example.invalid");
    const harbour = await clientBySlug("harbourview-dental");
    await asContext(staffCtx(admin), async (db) => {
      const created = await createWebsite(db, {
        clientId: harbour, name: "V1-I10 synthetic site", url: "https://example.invalid/v1-i10", platform: "Next.js", environment: "staging", notes: "Synthetic registry check",
      }, admin.id);
      const listed = await listWebsites(db, harbour);
      expect(listed.find((site) => site.id === created.id)).toMatchObject({ name: "V1-I10 synthetic site", url: "https://example.invalid/v1-i10", environment: "staging" });
    });
    const site = (await adminPool.query<WebsiteRow>("select * from websites where client_id = $1 and status = 'active' limit 1", [harbour])).rows[0]!;
    await asContext(staffCtx(manager), async (db) => {
      await updateWebsite(db, site.id, {
        name: `${site.name} persisted`, url: site.url, platform: site.platform, environment: site.environment, status: site.status, notes: "Synthetic update check",
      }, manager.id);
      const listed = await listWebsites(db, harbour);
      expect(listed.find((row) => row.id === site.id)).toMatchObject({ name: `${site.name} persisted`, notes: "Synthetic update check" });
    });
    const unchanged = (await adminPool.query<{ name: string; notes: string | null }>("select name, notes from websites where id = $1", [site.id])).rows[0]!;
    expect(unchanged).toEqual({ name: site.name, notes: site.notes });
  });

  it("a committed website update is readable in a later transaction and can be restored", async () => {
    const manager = await staffByEmail("manager@example.invalid");
    const harbour = await clientBySlug("harbourview-dental");
    const site = (await adminPool.query<WebsiteRow>("select * from websites where client_id = $1 and status = 'active' limit 1", [harbour])).rows[0]!;
    const marker = "Synthetic V1-I10 persistence check";
    const write = (notes: string | null) => asContext(staffCtx(manager), (db) => updateWebsite(db, site.id, {
      name: site.name, url: site.url, platform: site.platform, environment: site.environment, status: site.status, notes,
    }, manager.id), { commit: true });
    try {
      await write(marker);
      const listed = await asContext(staffCtx(manager), (db) => listWebsites(db, harbour));
      expect(listed.find((row) => row.id === site.id)?.notes).toBe(marker);
    } finally {
      await write(site.notes);
    }
    const restored = (await adminPool.query<{ notes: string | null }>("select notes from websites where id = $1", [site.id])).rows[0]!.notes;
    expect(restored).toBe(site.notes);
  });

  it("an admin can create and update an account reference, then read the saved values", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    const harbour = await clientBySlug("harbourview-dental");
    const existing = (await adminPool.query<{ id: string; kind: string; label: string; external_identifier: string | null; url: string | null; vault_reference: string | null; notes: string | null; owner_user_id: string | null; active: boolean }>(
      "select id, kind, label, external_identifier, url, vault_reference, notes, owner_user_id, active from account_references where client_id = $1 limit 1",
      [harbour],
    )).rows[0]!;
    await asContext(staffCtx(admin), async (db) => {
      const created = await createAccountReference(db, harbour, {
        kind: "other", label: "V1-I10 synthetic reference", externalIdentifier: "PLACEHOLDER-V1-I10", url: "https://example.invalid/ref", vaultReference: "vault://clinic-genie/synthetic", notes: "Synthetic registry check", ownerUserId: admin.id,
      }, admin.id);
      const listed = await listAccountReferences(db, harbour, true);
      expect(listed.find((reference) => reference.id === created.id)?.label).toBe("V1-I10 synthetic reference");
      await updateAccountReference(db, existing.id, {
        kind: existing.kind, label: `${existing.label} persisted`, externalIdentifier: existing.external_identifier, url: existing.url, vaultReference: existing.vault_reference, notes: existing.notes, ownerUserId: existing.owner_user_id, active: existing.active,
      }, admin.id);
      const updated = await listAccountReferences(db, harbour, true);
      expect(updated.find((reference) => reference.id === existing.id)?.label).toBe(`${existing.label} persisted`);
    });
    const label = (await adminPool.query<{ label: string }>("select label from account_references where id = $1", [existing.id])).rows[0]!.label;
    expect(label).toBe(existing.label);
  });

  it("a committed account-reference update is readable in a later transaction and can be restored", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    const harbour = await clientBySlug("harbourview-dental");
    const existing = (await adminPool.query<{ id: string; kind: string; label: string; external_identifier: string | null; url: string | null; vault_reference: string | null; notes: string | null; owner_user_id: string | null; active: boolean }>(
      "select id, kind, label, external_identifier, url, vault_reference, notes, owner_user_id, active from account_references where client_id = $1 limit 1",
      [harbour],
    )).rows[0]!;
    const marker = `${existing.label} V1-I10`;
    const write = (label: string) => asContext(staffCtx(admin), (db) => updateAccountReference(db, existing.id, {
      kind: existing.kind, label, externalIdentifier: existing.external_identifier, url: existing.url, vaultReference: existing.vault_reference, notes: existing.notes, ownerUserId: existing.owner_user_id, active: existing.active,
    }, admin.id), { commit: true });
    try {
      await write(marker);
      const listed = await asContext(staffCtx(admin), (db) => listAccountReferences(db, harbour, true));
      expect(listed.find((reference) => reference.id === existing.id)?.label).toBe(marker);
    } finally {
      await write(existing.label);
    }
    const restored = (await adminPool.query<{ label: string }>("select label from account_references where id = $1", [existing.id])).rows[0]!.label;
    expect(restored).toBe(existing.label);
  });

  it("a specialist, reviewer, read-only user, or other client's specialist cannot change a website or account reference", async () => {
    const harbour = await clientBySlug("harbourview-dental");
    const site = (await adminPool.query<WebsiteRow>("select * from websites where client_id = $1 and status = 'active' limit 1", [harbour])).rows[0]!;
    const reference = (await adminPool.query<{ id: string; kind: string; label: string; external_identifier: string | null; url: string | null; vault_reference: string | null; notes: string | null; owner_user_id: string | null; active: boolean }>(
      "select id, kind, label, external_identifier, url, vault_reference, notes, owner_user_id, active from account_references where client_id = $1 limit 1",
      [harbour],
    )).rows[0]!;
    for (const email of ["specialist-a@example.invalid", "specialist-b@example.invalid", "reviewer@example.invalid", "readonly@example.invalid"]) {
      const user = await staffByEmail(email);
      await expect(asContext(staffCtx(user), (db) => updateWebsite(db, site.id, {
        name: `${site.name} denied`, url: site.url, platform: site.platform, environment: site.environment, status: site.status, notes: site.notes,
      }, user.id))).rejects.toBeInstanceOf(RegistryRuleError);
      await expect(asContext(staffCtx(user), (db) => updateAccountReference(db, reference.id, {
        kind: reference.kind, label: `${reference.label} denied`, externalIdentifier: reference.external_identifier, url: reference.url, vaultReference: reference.vault_reference, notes: reference.notes, ownerUserId: reference.owner_user_id, active: reference.active,
      }, user.id))).rejects.toBeInstanceOf(RegistryRuleError);
      await expect(asContext(staffCtx(user), (db) => createWebsite(db, {
        clientId: harbour, name: `Denied ${email}`, url: null, platform: "Next.js", environment: "staging", notes: null,
      }, user.id))).rejects.toThrow();
    }
    const name = (await adminPool.query<{ name: string }>("select name from websites where id = $1", [site.id])).rows[0]!.name;
    const label = (await adminPool.query<{ label: string }>("select label from account_references where id = $1", [reference.id])).rows[0]!.label;
    expect(name).toBe(site.name);
    expect(label).toBe(reference.label);
  });
});

describe("audit log protection (A-21)", () => {
  it("audit events cannot be updated or deleted, even by the owner", async () => {
    const { rows } = await adminPool.query("select id from audit_events limit 1");
    await expect(adminPool.query("update audit_events set outcome = 'denied' where id = $1", [rows[0].id])).rejects.toThrow(/append-only/);
    await expect(adminPool.query("delete from audit_events where id = $1", [rows[0].id])).rejects.toThrow(/append-only/);
  });
});
