import { afterAll, describe, expect, it } from "vitest";
import { SERVICE, applyContext } from "../src/client";
import { adminPool, appPool, asContext, clientBySlug, staffByEmail, staffCtx } from "./helpers";
import { clientActions, scopeWorkspace } from "../src/services/access";
import { PermissionDeniedError, type AccessProfile } from "../src/services/auth";
import { saveSeoPageSetting } from "../src/services/seo-soft-launch";
import {
  RegistryRuleError,
  archiveClientFileLink,
  createClientFileLink,
  externalFileUrl,
  getClient,
  grantMembership,
  listClientFileLinks,
  listWebsites,
  requireWebsiteForClient,
  revokeMembership,
  updateClient,
} from "../src/services/registry";

afterAll(async () => {
  await adminPool.end();
  await appPool.end();
});

describe("client ownership and shared permissions", () => {
  it("keeps publish and export separate from edit, and assignments with admin", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    const manager = await staffByEmail("manager@example.invalid");
    const specialist = await staffByEmail("specialist-a@example.invalid");
    const reviewer = await staffByEmail("reviewer@example.invalid");
    const readonly = await staffByEmail("readonly@example.invalid");
    const harbour = await clientBySlug("harbourview-dental");
    const northgate = await clientBySlug("northgate-physio");
    const profile = (user: typeof admin, memberships: AccessProfile["memberships"] = []): AccessProfile => ({
      user: { ...user, email: "synthetic@example.invalid", display_name: "Synthetic", active: true },
      memberships,
    });
    expect(clientActions.publish(profile(admin), harbour)).toBe(true);
    expect(clientActions.export(profile(manager), harbour)).toBe(true);
    expect(clientActions.manageAssignments(profile(admin), harbour)).toBe(true);
    expect(clientActions.manageAssignments(profile(manager), harbour)).toBe(false);
    const member = profile(specialist, [{ client_id: harbour, client_name: "Harbour", client_slug: "harbourview-dental" }]);
    expect(clientActions.view(member, harbour)).toBe(true);
    expect(clientActions.edit(member, harbour)).toBe(true);
    expect(clientActions.submitForReview(member, harbour)).toBe(true);
    expect(clientActions.publish(member, harbour)).toBe(false);
    expect(clientActions.export(member, harbour)).toBe(false);
    expect(clientActions.view(member, northgate)).toBe(false);
    const reviewerMember = profile(reviewer, [{ client_id: harbour, client_name: "Harbour", client_slug: "harbourview-dental" }]);
    expect(clientActions.review(reviewerMember, harbour)).toBe(true);
    expect(clientActions.edit(reviewerMember, harbour)).toBe(false);
    expect(clientActions.publish(reviewerMember, harbour)).toBe(false);
    const reader = profile(readonly, [{ client_id: harbour, client_name: "Harbour", client_slug: "harbourview-dental" }]);
    expect(clientActions.view(reader, harbour)).toBe(true);
    expect(clientActions.edit(reader, harbour)).toBe(false);
    expect(clientActions.review(reader, harbour)).toBe(false);
  });

  it("drops a client or website that is outside the stored relationship", () => {
    const clients = [{ id: "client-a" }, { id: "client-b" }];
    const websites = [{ id: "site-a1", clientId: "client-a" }, { id: "site-a2", clientId: "client-a" }, { id: "site-b", clientId: "client-b" }];
    expect(scopeWorkspace({ requestedClientId: "client-b", requestedWebsiteId: "site-a1", clients, websites })).toMatchObject({
      clientId: "client-b", websiteId: null, denied: false, websiteReplaced: true,
    });
    expect(scopeWorkspace({ requestedClientId: "missing", requestedWebsiteId: "site-b", clients, websites })).toMatchObject({
      denied: true, clientId: null, websiteId: null,
    });
    expect(scopeWorkspace({ requestedClientId: "client-a", requestedWebsiteId: "site-a2", clients, websites }).websiteId).toBe("site-a2");
  });

  it("stores services apart from channels and keeps file links inside the client", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    const specA = await staffByEmail("specialist-a@example.invalid");
    const specB = await staffByEmail("specialist-b@example.invalid");
    const harbour = await clientBySlug("harbourview-dental");
    const meridian = await clientBySlug("meridian-skin");
    await asContext(staffCtx(admin), async (db) => {
      const before = (await getClient(db, harbour))!;
      await updateClient(db, harbour, {
        name: before.name,
        ownerUserId: before.owner_user_id,
        channels: before.channels,
        services: "Synthetic service list for the access check",
        notes: before.notes,
        referenceNumber: before.reference_number,
        shortCode: before.short_code,
        specialty: before.specialty,
        legalName: before.legal_name,
        publicName: before.public_name,
        address: before.address,
        contactEmail: before.contact_email,
        contactPhone: before.contact_phone,
        enquiryOwnerUserId: before.enquiry_owner_user_id,
        notificationOwnerUserId: before.notification_owner_user_id,
        administrationOwnerUserId: before.administration_owner_user_id,
      }, admin.id);
      const saved = await getClient(db, harbour);
      expect(saved?.services).toBe("Synthetic service list for the access check");
      expect(saved?.channels).toEqual(before.channels);
      const link = await createClientFileLink(db, harbour, { title: "Synthetic brief", url: "https://files.example.invalid/brief", notes: "Test link" }, admin.id);
      expect(await listClientFileLinks(db, harbour)).toEqual([expect.objectContaining({ id: link, title: "Synthetic brief" })]);
      await applyContext(db, staffCtx(specA));
      expect((await listClientFileLinks(db, harbour)).map((row) => row.id)).toContain(link);
      await db.query("savepoint specialist_file");
      await expect(createClientFileLink(db, harbour, { title: "No", url: "https://files.example.invalid/no", notes: null }, specA.id)).rejects.toThrow();
      await db.query("rollback to savepoint specialist_file");
      await applyContext(db, staffCtx(specB));
      expect(await listClientFileLinks(db, harbour)).toEqual([]);
      await applyContext(db, staffCtx(specA));
      await expect(updateClient(db, harbour, {
        name: before.name, ownerUserId: before.owner_user_id, channels: before.channels, services: "changed", notes: before.notes,
      }, specA.id)).rejects.toBeInstanceOf(RegistryRuleError);
      const sites = await listWebsites(db, meridian);
      await expect(requireWebsiteForClient(db, sites[0]!.id, harbour)).rejects.toBeInstanceOf(RegistryRuleError);
      const ownSites = await listWebsites(db, harbour);
      await expect(saveSeoPageSetting(db, harbour, ownSites[0]!.id, {
        pagePath: "/synthetic-access", title: "Synthetic", description: "Synthetic description for the access check.", canonicalPath: null, indexable: true,
      }, specA.id)).rejects.toBeInstanceOf(PermissionDeniedError);
    });
    expect(externalFileUrl("https://files.example.invalid/brief")).toBe("https://files.example.invalid/brief");
    expect(() => externalFileUrl("http://files.example.invalid/brief")).toThrow(/https/);
    expect(() => externalFileUrl("https://user:secret@files.example.invalid/brief")).toThrow(/https/);
  });

  it("makes an assignment cover the client websites and removes that access when revoked", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    const specB = await staffByEmail("specialist-b@example.invalid");
    const harbour = await clientBySlug("harbourview-dental");
    await asContext(SERVICE, async (db) => {
      await applyContext(db, staffCtx(admin));
      const membershipId = await grantMembership(db, { userId: specB.id, clientId: harbour }, admin.id);
      await applyContext(db, staffCtx(specB));
      const names = (await listWebsites(db, harbour)).map((site) => site.name);
      expect(names.length).toBeGreaterThan(0);
      await applyContext(db, staffCtx(admin));
      await expect(revokeMembership(db, membershipId, admin.id, "00000000-0000-4000-8000-000000000099")).rejects.toBeInstanceOf(RegistryRuleError);
      expect((await listWebsites(db, harbour)).length).toBeGreaterThan(0);
      await applyContext(db, staffCtx(specB));
      expect((await listWebsites(db, harbour)).length).toBeGreaterThan(0);
      await applyContext(db, staffCtx(admin));
      await revokeMembership(db, membershipId, admin.id, harbour);
      await applyContext(db, staffCtx(specB));
      expect(await listWebsites(db, harbour)).toEqual([]);
    });
  });

  it("keeps an authorised service, note and file link in a later transaction", async () => {
    const admin = await staffByEmail("admin@example.invalid");
    const harbour = await clientBySlug("harbourview-dental");
    const before = await asContext(staffCtx(admin), async (db) => (await getClient(db, harbour))!);
    const profile = {
      name: before.name,
      ownerUserId: before.owner_user_id,
      channels: before.channels,
      notes: before.notes,
      referenceNumber: before.reference_number,
      shortCode: before.short_code,
      specialty: before.specialty,
      legalName: before.legal_name,
      publicName: before.public_name,
      address: before.address,
      contactEmail: before.contact_email,
      contactPhone: before.contact_phone,
      enquiryOwnerUserId: before.enquiry_owner_user_id,
      notificationOwnerUserId: before.notification_owner_user_id,
      administrationOwnerUserId: before.administration_owner_user_id,
    };
    let linkId = "";
    try {
      linkId = await asContext(staffCtx(admin), async (db) => {
        await updateClient(db, harbour, { ...profile, services: "Reload check service", notes: "Reload check note" }, admin.id);
        return createClientFileLink(db, harbour, { title: "Reload check file", url: "https://files.example.invalid/reload", notes: null }, admin.id);
      }, { commit: true });
      await asContext(staffCtx(admin), async (db) => {
        const saved = await getClient(db, harbour);
        expect(saved?.services).toBe("Reload check service");
        expect(saved?.notes).toBe("Reload check note");
        expect(saved?.channels).toEqual(before.channels);
        expect((await listClientFileLinks(db, harbour)).some((row) => row.id === linkId)).toBe(true);
      });
    } finally {
      await asContext(staffCtx(admin), async (db) => {
        await updateClient(db, harbour, { ...profile, services: before.services }, admin.id);
        if (linkId) await archiveClientFileLink(db, linkId, harbour, admin.id);
      }, { commit: true });
    }
  });
});
