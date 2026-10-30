import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  SERVICE, archiveClient, closePools, createClient, createStaff, getClientBySlug, grantMembership, restoreClient, updateStaff, withContext,
  type AccessProfile, type PlatformRole, type StaffUser,
} from "@clinic-genie/db";

const authMock = vi.hoisted(() => vi.fn());

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T extends (...args: never[]) => unknown>(fn: T) => fn };
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("./auth", () => ({ auth: authMock }));

import { updateStaffAction } from "@/app/actions/admin";
import { getAccess, permissions, requireAccess, requireClientAccess } from "./session";

const CHECKER_EMAIL = "v1-v01-checker@example.invalid";
const CLIENT_SLUG = "v1-v01-access-check";
const OTHER_CLIENT = "00000000-0000-4000-8000-000000000001";

let admin: StaffUser;
let checker: StaffUser;
let clientId = "";
let token = "";

const staffContext = (user: { id: string; platform_role: PlatformRole }) => ({ kind: "staff" as const, userId: user.id, role: user.platform_role });

function signInAs(email: string) {
  authMock.mockResolvedValue({ user: { email } });
}

function staffForm(fields: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
}

async function checkerState() {
  return withContext(SERVICE, async (db) => (
    await db.query<{ platform_role: PlatformRole; active: boolean }>("select platform_role, active from staff_users where id = $1", [checker.id])
  ).rows[0]!);
}

async function sessionCount() {
  return withContext(SERVICE, async (db) => (
    await db.query<{ n: number }>(`select count(*)::int as n from sessions where "sessionToken" = $1`, [token])
  ).rows[0]!.n);
}

describe("application access after deactivation", () => {
  beforeAll(async () => {
    admin = (await withContext(SERVICE, async (db) => (
      await db.query<StaffUser>("select id, email, display_name, platform_role, active from staff_users where email = $1", ["admin@example.invalid"])
    ).rows[0]))!;
    const existingChecker = await withContext(SERVICE, async (db) => (
      await db.query<StaffUser>("select id, email, display_name, platform_role, active from staff_users where email = $1", [CHECKER_EMAIL])
    ).rows[0] ?? null);
    if (!existingChecker) {
      const id = await withContext(staffContext(admin), (db) => createStaff(db, { email: CHECKER_EMAIL, displayName: "V1-V01 Checker", role: "specialist" }, admin.id));
      checker = { id, email: CHECKER_EMAIL, display_name: "V1-V01 Checker", platform_role: "specialist", active: true };
    } else {
      checker = existingChecker;
      if (!checker.active || checker.platform_role !== "specialist") {
        await withContext(staffContext(admin), (db) => updateStaff(db, checker.id, { displayName: "V1-V01 Checker", role: "specialist", active: true }, admin.id));
        checker = { ...checker, display_name: "V1-V01 Checker", platform_role: "specialist", active: true };
      }
    }

    const existingClient = await withContext(staffContext(admin), (db) => getClientBySlug(db, CLIENT_SLUG));
    if (!existingClient) {
      const created = await withContext(staffContext(admin), (db) => createClient(db, {
        slug: CLIENT_SLUG,
        name: "V1-V01 Access Check (fictional)",
        ownerUserId: admin.id,
        channels: ["website"],
        isSynthetic: true,
        notes: "Synthetic client for the automated access suite.",
        specialty: "Demonstration",
        publicName: "V1-V01 Access Check",
        contactEmail: "hello@v1-v01.example.invalid",
      }, admin.id));
      clientId = created.id;
    } else {
      clientId = existingClient.id;
      if (existingClient.status !== "active") await withContext(staffContext(admin), (db) => restoreClient(db, clientId, admin.id));
    }
    await withContext(staffContext(admin), (db) => grantMembership(db, { userId: checker.id, clientId }, admin.id));

    token = `v1-v01-${checker.id}`;
    await withContext(SERVICE, async (db) => {
      const existingUser = await db.query<{ id: number }>("select id from users where lower(email) = lower($1) limit 1", [CHECKER_EMAIL]);
      const userId = existingUser.rows[0]?.id ?? (await db.query<{ id: number }>("insert into users (email, name) values ($1, $2) returning id", [CHECKER_EMAIL, "V1-V01 Checker"])).rows[0]!.id;
      await db.query(`delete from sessions where "sessionToken" = $1`, [token]);
      await db.query(`insert into sessions ("userId", expires, "sessionToken") values ($1, now() + interval '1 hour', $2)`, [userId, token]);
    });
  });

  afterAll(async () => {
    try {
      if (admin && checker) {
        await withContext(staffContext(admin), (db) => updateStaff(db, checker.id, { displayName: "V1-V01 Checker", role: "specialist", active: true }, admin.id));
      }
      if (admin && clientId) await withContext(staffContext(admin), (db) => archiveClient(db, clientId, admin.id));
      if (token) await withContext(SERVICE, (db) => db.query(`delete from sessions where "sessionToken" = $1`, [token]));
    } finally {
      await closePools();
    }
  });

  it("resolves an active member and refuses a client they cannot open", async () => {
    signInAs(CHECKER_EMAIL);
    const access = await getAccess();
    expect(access?.user.id).toBe(checker.id);
    expect(access?.user.platform_role).toBe("specialist");
    expect(permissions.canAccessClient(access as AccessProfile, clientId)).toBe(true);
    expect(permissions.canEditClient(access as AccessProfile, clientId)).toBe(true);
    expect(permissions.canManageRegistry(access as AccessProfile)).toBe(false);
    expect(permissions.canManageUsers(access as AccessProfile)).toBe(false);
    expect(permissions.canAccessClient(access as AccessProfile, OTHER_CLIENT)).toBe(false);
    expect(permissions.canEditClient(access as AccessProfile, OTHER_CLIENT)).toBe(false);
    await expect(requireClientAccess(clientId)).resolves.toMatchObject({ user: { id: checker.id } });
    await expect(requireClientAccess(OTHER_CLIENT)).rejects.toThrow("REDIRECT /clients?denied=1");

    signInAs("readonly@example.invalid");
    const reader = await getAccess();
    expect(reader?.user.platform_role).toBe("read_only");
    expect(permissions.canAccessClient(reader as AccessProfile, clientId)).toBe(false);
    expect(permissions.canEditClient(reader as AccessProfile, clientId)).toBe(false);
    await expect(requireClientAccess(clientId)).rejects.toThrow("REDIRECT /clients?denied=1");

    signInAs("admin@example.invalid");
    const adminAccess = await getAccess();
    expect(permissions.canManageUsers(adminAccess as AccessProfile)).toBe(true);
    expect(permissions.canEditClient(adminAccess as AccessProfile, clientId)).toBe(true);
    expect(await sessionCount()).toBe(1);
  });

  it("refuses staff changes from a specialist or manager", async () => {
    for (const email of ["specialist-a@example.invalid", "manager@example.invalid"]) {
      signInAs(email);
      const result = await updateStaffAction(null, staffForm({
        userId: checker.id, displayName: "V1-V01 Checker", role: "admin", deactivate: "on",
      }));
      expect(result).toEqual({ ok: false, error: "Only admins can change staff records." });
    }
    expect(await checkerState()).toEqual({ platform_role: "specialist", active: true });
    expect(await sessionCount()).toBe(1);
  });

  it("an admin deactivation removes the live session and later requests", async () => {
    signInAs("admin@example.invalid");
    const saved = await updateStaffAction(null, staffForm({
      userId: checker.id, displayName: "V1-V01 Checker", role: "specialist", deactivate: "on",
    }));
    expect(saved).toEqual({ ok: true, message: "Staff record saved." });
    expect(await checkerState()).toEqual({ platform_role: "specialist", active: false });
    expect(await sessionCount()).toBe(0);

    signInAs(CHECKER_EMAIL);
    expect(await getAccess()).toBeNull();
    await expect(requireAccess()).rejects.toThrow("REDIRECT /sign-in");

    signInAs("admin@example.invalid");
    const restored = await updateStaffAction(null, staffForm({
      userId: checker.id, displayName: "V1-V01 Checker", role: "specialist",
    }));
    expect(restored).toEqual({ ok: true, message: "Staff record saved." });
    signInAs(CHECKER_EMAIL);
    const access = await getAccess();
    expect(access?.user.active).toBe(true);
    expect(permissions.canEditClient(access as AccessProfile, clientId)).toBe(true);
  });
});
