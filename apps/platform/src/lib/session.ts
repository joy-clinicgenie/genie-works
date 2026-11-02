import { cache } from "react";
import { redirect } from "next/navigation";
import {
  canAccessClient,
  canEditClient,
  canExport,
  canManageRegistry,
  canManageUsers,
  canWriteConnectionSecrets,
  canPublishClient,
  canReviewClient,
  getActiveStaffByEmail,
  resolveAccessForStaff,
  type AccessProfile,
} from "@clinic-genie/db/src/services/auth";
import { canManageAssignments } from "@clinic-genie/db/src/services/access";
import { SERVICE, withContext } from "@clinic-genie/db/src/client";
import { auth } from "./auth";

/** Resolves the current staff access profile from the session, server-side, once per request. */
export const getAccess = cache(async (): Promise<AccessProfile | null> => {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) return null;
  return withContext(SERVICE, async (db) => {
    const staff = await getActiveStaffByEmail(db, email);
    if (!staff) return null;
    return resolveAccessForStaff(db, staff);
  });
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
  canWriteConnectionSecrets,
};
