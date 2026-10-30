/**
 * Shared client and website authorisation.
 *
 * Source: D14 (28 Oct 2026). Admin and manager may view, edit, review, approve,
 * publish and export for every client. A specialist member may view, edit and
 * submit for review. A reviewer member may view, review and approve. A read-only
 * member may view. Publishing and export stay with admin and manager. Connection
 * credentials stay admin-only. Client membership covers every website of that
 * client. There is no second website-grant list.
 *
 * Registry creates and updates for websites and account references stay with
 * admin and manager (canManageRegistry). D14 does not name those records, and
 * V1-I10 did not add a specialist grant.
 */
import {
  canAccessClient,
  canEditClient,
  canExport,
  canPublishClient,
  canReviewClient,
  isAdmin,
  type AccessProfile,
} from "./auth";

export const canViewClient = canAccessClient;
export const canSubmitForReview = canEditClient;
export const canManageAssignments = (profile: AccessProfile): boolean => isAdmin(profile);

export const clientActions = {
  view: canViewClient,
  edit: canEditClient,
  review: canReviewClient,
  submitForReview: canSubmitForReview,
  publish: canPublishClient,
  export: (_profile: AccessProfile, _clientId: string): boolean => canExport(_profile),
  manageAssignments: (profile: AccessProfile, _clientId: string): boolean => canManageAssignments(profile),
};

export interface WorkspaceSelection {
  clientId: string | null;
  websiteId: string | null;
  denied: boolean;
  websiteReplaced: boolean;
}

/**
 * An explicit client or website in the URL is not permission. Unknown or
 * cross-client ids are dropped. Callers must not fall back to another client
 * after `denied` is true.
 */
export function scopeWorkspace(input: {
  requestedClientId?: string | null;
  requestedWebsiteId?: string | null;
  clients: ReadonlyArray<{ id: string }>;
  websites: ReadonlyArray<{ id: string; clientId: string }>;
}): WorkspaceSelection {
  const requestedClientId = input.requestedClientId || null;
  const requestedWebsiteId = input.requestedWebsiteId || null;
  if (requestedClientId && !input.clients.some((client) => client.id === requestedClientId)) {
    return { clientId: null, websiteId: null, denied: true, websiteReplaced: false };
  }
  const clientId = requestedClientId;
  const owned = requestedWebsiteId
    ? input.websites.find((site) => site.id === requestedWebsiteId && (!clientId || site.clientId === clientId))
    : undefined;
  return {
    clientId,
    websiteId: owned?.id ?? null,
    denied: false,
    websiteReplaced: Boolean(requestedWebsiteId) && !owned,
  };
}
