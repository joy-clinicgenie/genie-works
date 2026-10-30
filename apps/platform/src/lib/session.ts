import { cache } from "react";
import { redirect } from "next/navigation";
import {
  SERVICE,
  canAccessClient,
  canEditClient,
  canExport,
  canManageAssignments,
  canManageRegistry,
  canManageUsers,
  canPublishClient,
  canReviewClient,
  getActiveStaffByEmail,
  resolveAccess,
  withContext,
  type AccessProfile,
} from "@clinic-genie/db";
import { auth } from "./auth";

/** Resolves the current staff access profile from the session, server-side, once per request. */
export const getAccess = cache(async (): Promise<AccessProfile | null> => {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) return null;
  const profile = await withContext(SERVICE, async (db) => {
    const staff = await getActiveStaffByEmail(db, email);
    if (!staff) return null;
    return resolveAccess(db, staff.id);
  });
  return profile;
});

export async function requireAccess(): Promise<AccessProfile> {
  const access = await getAccess();
  if (!access) redirect("/sign-in");
  return access;
}

export async function requireClientAccess(clientId: string): Promise<AccessProfile> {
  const access = await requireAccess();
  if (!canAccessClient(access, clientId)) redirect("/clients?denied=1");
  return access;
}

export const permissions = {
  canAccessClient,
  canEditClient,
  canReviewClient,
  canPublishClient,
  canExport,
  canManageAssignments,
  canManageRegistry,
  canManageUsers,
};
