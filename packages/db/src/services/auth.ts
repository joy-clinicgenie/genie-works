import type { PlatformRole } from "@clinic-genie/contracts";
import type { Queryable } from "../client";

export interface StaffUser {
  id: string;
  email: string;
  display_name: string;
  platform_role: PlatformRole;
  active: boolean;
}

export interface ClientScope {
  client_id: string;
  client_name: string;
  client_slug: string;
}

/** Resolved on the server for every request. Never built from client-supplied claims. */
export interface AccessProfile {
  user: StaffUser;
  /** Clients the user is a member of. Global roles (admin, manager) see every active client regardless. */
  memberships: ClientScope[];
}

export async function getActiveStaffByEmail(db: Queryable, email: string): Promise<StaffUser | null> {
  const { rows } = await db.query<StaffUser>(
    "select id, email, display_name, platform_role, active from staff_users where email = $1 and active",
    [email.toLowerCase()],
  );
  return rows[0] ?? null;
}

export async function getStaffById(db: Queryable, id: string): Promise<StaffUser | null> {
  const { rows } = await db.query<StaffUser>("select id, email, display_name, platform_role, active from staff_users where id = $1", [id]);
  return rows[0] ?? null;
}

export async function resolveAccess(db: Queryable, userId: string): Promise<AccessProfile | null> {
  const user = await getStaffById(db, userId);
  if (!user || !user.active) return null;
  const { rows } = await db.query<ClientScope>(
    `select m.client_id, c.name as client_name, c.slug as client_slug
     from memberships m join clients c on c.id = m.client_id
     where m.user_id = $1 and m.active and c.status = 'active' order by c.name`,
    [userId],
  );
  return { user, memberships: rows };
}

export const isGlobal = (p: AccessProfile): boolean => p.user.platform_role === "admin" || p.user.platform_role === "manager";
export const isAdmin = (p: AccessProfile): boolean => p.user.platform_role === "admin";
export const hasMembership = (p: AccessProfile, clientId: string): boolean => p.memberships.some((m) => m.client_id === clientId);

/** Read access to a client's records. */
export const canAccessClient = (p: AccessProfile, clientId: string): boolean => isGlobal(p) || hasMembership(p, clientId);
/** Create and edit tasks, SEO, Ads, issues, claims, reports for a client. */
export const canEditClient = (p: AccessProfile, clientId: string): boolean =>
  isGlobal(p) || (p.user.platform_role === "specialist" && hasMembership(p, clientId));
/** Record approval decisions and medical reviews for a client. */
export const canReviewClient = (p: AccessProfile, clientId: string): boolean =>
  isGlobal(p) || (p.user.platform_role === "reviewer" && hasMembership(p, clientId));
/** Provisional D14 publish and export gate: admin and manager, for every website of a client they can access. */
export const canPublishClient = (p: AccessProfile, clientId: string): boolean => isGlobal(p) && canAccessClient(p, clientId);
/** Manage the client registry (create, archive, websites, references). */
export const canManageRegistry = (p: AccessProfile): boolean => isGlobal(p);
/** Manage staff, roles and memberships, and view platform-wide audit and backups. */
export const canManageUsers = (p: AccessProfile): boolean => isAdmin(p);
export const canExport = (p: AccessProfile): boolean => isGlobal(p);

export class PermissionDeniedError extends Error {
  constructor(message = "You do not have permission for this action.") {
    super(message);
    this.name = "PermissionDeniedError";
  }
}

export function assertCan(ok: boolean, message?: string): void {
  if (!ok) throw new PermissionDeniedError(message);
}
