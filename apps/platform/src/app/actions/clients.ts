"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  RegistryRuleError, archiveClient, archiveClientFileLink, canManageAssignments, canManageRegistry, createAccountReference, createClient, createClientContact, createClientFileLink, createWebsite, grantMembership, listAccountReferences, listWebsites, restoreClient,
  revokeMembership, updateAccountReference, updateClient, updateClientContact, updateWebsite, type ClientChannel, type WebsiteRow,
} from "@clinic-genie/db";
import { CLIENT_CHANNELS } from "@clinic-genie/contracts";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { bool, list, optional, str, toActionError, type ActionState } from "@/lib/actions";

function channels(form: FormData): ClientChannel[] {
  return list(form, "channels").filter((c): c is ClientChannel => (CLIENT_CHANNELS as readonly string[]).includes(c));
}

function emailField(form: FormData, key: string): { value: string | null; error?: string } {
  const value = optional(form, key);
  if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return { value: null, error: "Enter a valid email address." };
  return { value: value?.toLowerCase() ?? null };
}

function shortCodeField(form: FormData): string | null {
  const value = optional(form, "shortCode");
  return value ? value.toUpperCase() : null;
}

function profileFields(form: FormData) {
  return {
    referenceNumber: optional(form, "referenceNumber"),
    shortCode: shortCodeField(form),
    specialty: optional(form, "specialty"),
    legalName: optional(form, "legalName"),
    publicName: optional(form, "publicName"),
    address: optional(form, "address"),
    contactPhone: optional(form, "contactPhone"),
    enquiryOwnerUserId: optional(form, "enquiryOwnerUserId"),
    notificationOwnerUserId: optional(form, "notificationOwnerUserId"),
    administrationOwnerUserId: optional(form, "administrationOwnerUserId"),
  };
}

export async function createClientAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const access = await requireAccess();
  if (!canManageRegistry(access)) return { ok: false, error: "Only admins and managers can create clients." };
  const slug = str(form, "slug").toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) return { ok: false, error: "Identifier must be lowercase letters, numbers and hyphens.", field: "slug" };
  const contactEmail = emailField(form, "contactEmail");
  if (contactEmail.error) return { ok: false, error: contactEmail.error, field: "contactEmail" };
  const shortCode = shortCodeField(form);
  if (shortCode && !/^[A-Z0-9][A-Z0-9-]{0,19}$/.test(shortCode)) return { ok: false, error: "Short code uses letters, numbers and hyphens.", field: "shortCode" };
  let id: string;
  try {
    const client = await staffTx(access, (db) =>
      createClient(db, { slug, name: str(form, "name"), ownerUserId: optional(form, "ownerUserId"), channels: channels(form), services: optional(form, "services"), isSynthetic: bool(form, "isSynthetic"), notes: optional(form, "notes"), ...profileFields(form), contactEmail: contactEmail.value }, access.user.id),
    );
    id = client.id;
  } catch (err) {
    const state = toActionError(err);
    if (state && !state.ok && (err as { code?: string; constraint?: string }).code === "23505") {
      const constraint = (err as { constraint?: string }).constraint ?? "";
      if (constraint.includes("short")) return { ok: false, error: "That short code is already in use.", field: "shortCode" };
      if (constraint.includes("reference")) return { ok: false, error: "That reference number is already in use.", field: "referenceNumber" };
      return { ok: false, error: "That identifier is already in use.", field: "slug" };
    }
    return state;
  }
  revalidatePath("/clients");
  redirect(`/clients/${id}`);
}

export async function updateClientAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const access = await requireAccess();
  if (!canManageRegistry(access)) return { ok: false, error: "Only admins and managers can edit client profiles." };
  const id = str(form, "clientId");
  const contactEmail = emailField(form, "contactEmail");
  if (contactEmail.error) return { ok: false, error: contactEmail.error, field: "contactEmail" };
  const shortCode = shortCodeField(form);
  if (shortCode && !/^[A-Z0-9][A-Z0-9-]{0,19}$/.test(shortCode)) return { ok: false, error: "Short code uses letters, numbers and hyphens.", field: "shortCode" };
  try {
    await staffTx(access, (db) => updateClient(db, id, { name: str(form, "name"), ownerUserId: optional(form, "ownerUserId"), channels: channels(form), services: optional(form, "services"), notes: optional(form, "notes"), ...profileFields(form), contactEmail: contactEmail.value }, access.user.id));
  } catch (err) {
    const state = toActionError(err);
    if (state && !state.ok && (err as { code?: string; constraint?: string }).code === "23505") {
      const constraint = (err as { constraint?: string }).constraint ?? "";
      if (constraint.includes("short")) return { ok: false, error: "That short code is already in use.", field: "shortCode" };
      return { ok: false, error: "That reference number is already in use.", field: "referenceNumber" };
    }
    return state;
  }
  revalidatePath(`/clients/${id}`, "layout");
  return { ok: true, message: "Profile saved." };
}

export async function archiveClientAction(form: FormData): Promise<void> {
  const access = await requireAccess();
  if (!canManageRegistry(access)) return;
  const id = str(form, "clientId");
  const restore = bool(form, "restore");
  await staffTx(access, (db) => (restore ? restoreClient(db, id, access.user.id) : archiveClient(db, id, access.user.id)));
  revalidatePath("/clients", "layout");
  redirect(`/clients/${id}`);
}

export async function saveWebsiteAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const access = await requireAccess();
  const clientId = str(form, "clientId");
  // Registry writes follow canManageRegistry and websites_write: admin and manager only.
  if (!canManageRegistry(access)) return { ok: false, error: "You do not have permission for this action." };
  const websiteId = optional(form, "websiteId");
  const url = optional(form, "url");
  if (url && !/^https?:\/\//.test(url)) return { ok: false, error: "Website URL must start with http:// or https://.", field: "url" };
  const input = { name: str(form, "name"), url, platform: str(form, "platform") || "unknown", environment: (str(form, "environment") || "production") as WebsiteRow["environment"], notes: optional(form, "notes") };
  try {
    await staffTx(access, async (db) => {
      if (!websiteId) {
        await createWebsite(db, { clientId, ...input }, access.user.id);
        return;
      }
      const owned = (await listWebsites(db, clientId)).some((site) => site.id === websiteId);
      if (!owned) throw new RegistryRuleError("Website was not saved. You may not have permission to change it.");
      await updateWebsite(db, websiteId, {
        ...input,
        status: (str(form, "status") || "active") as WebsiteRow["status"],
        blogRequirements: {
          author: bool(form, "requireAuthor"),
          category: bool(form, "requireCategory"),
          featuredImage: bool(form, "requireFeaturedImage"),
          seo: bool(form, "requireSeo"),
          social: bool(form, "requireSocial"),
        },
      }, access.user.id);
    });
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath(`/clients/${clientId}`, "layout");
  return { ok: true, message: "Website saved." };
}

export async function saveReferenceAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const access = await requireAccess();
  const clientId = str(form, "clientId");
  if (!canManageRegistry(access)) return { ok: false, error: "You do not have permission for this action." };
  const refId = optional(form, "referenceId");
  const input = { kind: str(form, "kind") || "other", label: str(form, "label"), externalIdentifier: optional(form, "externalIdentifier"), url: optional(form, "url"), vaultReference: optional(form, "vaultReference"), notes: optional(form, "notes"), ownerUserId: optional(form, "ownerUserId") };
  if (!input.label) return { ok: false, error: "Label is required.", field: "label" };
  if (input.url && !/^https?:\/\//.test(input.url)) return { ok: false, error: "Link must start with http:// or https://.", field: "url" };
  try {
    await staffTx(access, async (db) => {
      if (!refId) {
        await createAccountReference(db, clientId, input, access.user.id);
        return;
      }
      const owned = (await listAccountReferences(db, clientId, true)).some((reference) => reference.id === refId);
      if (!owned) throw new RegistryRuleError("Reference was not saved. You may not have permission to change it.");
      await updateAccountReference(db, refId, { ...input, active: !bool(form, "deactivate") }, access.user.id);
    });
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath(`/clients/${clientId}`, "layout");
  return { ok: true, message: "Reference saved. Secrets stay in the vault." };
}

export async function saveContactAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const access = await requireAccess();
  const clientId = str(form, "clientId");
  if (!canManageRegistry(access)) return { ok: false, error: "Only admins and managers can edit client contacts." };
  const contactId = optional(form, "contactId");
  const name = str(form, "name");
  if (!name) return { ok: false, error: "Contact name is required.", field: "name" };
  const workEmail = emailField(form, "workEmail");
  if (workEmail.error) return { ok: false, error: workEmail.error, field: "workEmail" };
  const input = { name, designation: optional(form, "designation"), workEmail: workEmail.value, workPhone: optional(form, "workPhone"), isPrimary: bool(form, "isPrimary"), active: !bool(form, "deactivate") };
  try {
    await staffTx(access, (db) => (contactId ? updateClientContact(db, contactId, input, access.user.id) : createClientContact(db, clientId, input, access.user.id).then(() => undefined)));
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath(`/clients/${clientId}`, "layout");
  return { ok: true, message: "Contact saved." };
}

export async function membershipAction(form: FormData): Promise<void> {
  const access = await requireAccess();
  if (!canManageAssignments(access)) return;
  const clientId = str(form, "clientId");
  const membershipId = optional(form, "membershipId");
  const userId = optional(form, "userId");
  await staffTx(access, (db) => (membershipId ? revokeMembership(db, membershipId, access.user.id, clientId) : userId ? grantMembership(db, { userId, clientId }, access.user.id).then(() => undefined) : Promise.resolve()));
  revalidatePath(`/clients/${clientId}`, "layout");
  revalidatePath("/admin", "layout");
}

export async function saveFileLinkAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const access = await requireAccess();
  if (!canManageRegistry(access)) return { ok: false, error: "Only admins and managers can save file links." };
  const clientId = str(form, "clientId");
  try {
    await staffTx(access, (db) => createClientFileLink(db, clientId, { title: str(form, "title"), url: str(form, "url"), notes: optional(form, "notes") }, access.user.id));
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath(`/clients/${clientId}`, "layout");
  return { ok: true, message: "File link saved. The site that hosts the file still controls who can open it." };
}

export async function archiveFileLinkAction(form: FormData): Promise<void> {
  const access = await requireAccess();
  if (!canManageRegistry(access)) return;
  const clientId = str(form, "clientId");
  const id = str(form, "fileLinkId");
  await staffTx(access, (db) => archiveClientFileLink(db, id, clientId, access.user.id));
  revalidatePath(`/clients/${clientId}`, "layout");
}
