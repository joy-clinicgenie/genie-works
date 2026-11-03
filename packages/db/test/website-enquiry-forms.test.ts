import { beforeAll, describe, expect, it } from "vitest";
import {
  addWixEnquiryForm,
  bindWixEnquiryForm,
  clearWixEnquiryForm,
  listWixEnquiryBindings,
  removeWixEnquiryForm,
  WixBindingRuleError,
} from "../src/services/wix-enquiry-binding";
import { createClient, createWebsite } from "../src/services/registry";
import { resetWixFormsTableCache } from "../src/services/wix-enquiry-binding";
import { adminPool, asContext, clientBySlug, staffByEmail, staffCtx } from "./helpers";

const INSTANCE = "11111111-2222-4333-8444-555555555555";
const FORM_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const FORM_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

let admin: Awaited<ReturnType<typeof staffByEmail>>;
let specialist: Awaited<ReturnType<typeof staffByEmail>>;
let clientId: string;
let otherClientId: string;

beforeAll(async () => {
  admin = await staffByEmail("admin@example.invalid");
  specialist = await staffByEmail("specialist-a@example.invalid");
  clientId = await clientBySlug("clinic-genie");
  // A second client, so cross-client isolation is tested against a real neighbour.
  otherClientId = await asContext(staffCtx(admin), async (db) => {
    const slug = `iso-${Math.random().toString(36).slice(2, 8)}`;
    const created = await createClient(
      db,
      { slug, name: `Isolation ${slug}`, ownerUserId: admin.id, channels: [], services: null, isSynthetic: true, notes: null },
      admin.id,
    );
    return created.id;
  }, { commit: true });
});

/** A fresh Wix website for this client, inside the caller's rolled-back transaction. */
function uuid(): string {
  const hex = (n: number) => Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-8${hex(3)}-${hex(12)}`;
}

async function wixWebsite(db: Parameters<Parameters<typeof asContext>[1]>[0], owner = clientId, formKey = "contact", formId = uuid()) {
  const site = await createWebsite(
    db,
    { clientId: owner, name: `Site ${formKey} ${Math.random().toString(36).slice(2, 8)}`, url: "https://example.invalid/", platform: "Wix", environment: "production", notes: null },
    admin.id,
  );
  await bindWixEnquiryForm(db, { clientId: owner, websiteId: site.id, instanceId: INSTANCE, formId, formKey }, admin.id);
  return { ...site, formId };
}

describe("multiple Wix forms on one website", () => {
  it("returns one binding per form, with the shape the reader expects", async () => {
    await asContext(staffCtx(admin), async (db) => {
      const site = await wixWebsite(db, clientId, "contact", FORM_A);
      const rows = (await listWixEnquiryBindings(db, null)).filter((row) => row.websiteId === site.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.instanceId).toBe(INSTANCE);
      expect(rows[0]!.formId).toBe(FORM_A);
      expect(rows[0]!.namespace).toBe("wix.form_app.form");
      expect(rows[0]!.environment).toBe("production");
      expect(rows[0]!.websiteUrl).toBe("https://example.invalid/");
    });
  });

  it("reads two forms on one website, each as its own binding", async () => {
    await asContext(staffCtx(admin), async (db) => {
      const site = await wixWebsite(db, clientId, "contact", FORM_A);
      await addWixEnquiryForm(db, { clientId, websiteId: site.id, formId: FORM_B, formKey: "appointment-enquiry", displayName: "Appointments" }, admin.id);
      const rows = (await listWixEnquiryBindings(db, null)).filter((row) => row.websiteId === site.id);
      expect(rows.map((row) => row.formKey).sort()).toEqual(["appointment-enquiry", "contact"]);
      expect(rows.map((row) => row.formId).sort()).toEqual([FORM_A, FORM_B].sort());
      // One app instance serves both forms.
      expect(new Set(rows.map((row) => row.instanceId)).size).toBe(1);
    });
  });

  it("keeps production counting off for a newly added form", async () => {
    await asContext(staffCtx(admin), async (db) => {
      const site = await wixWebsite(db);
      await addWixEnquiryForm(db, { clientId, websiteId: site.id, formId: FORM_B, formKey: "second", displayName: null }, admin.id);
      const rows = (await listWixEnquiryBindings(db, null)).filter((row) => row.websiteId === site.id);
      expect(rows.every((row) => row.countsInTotals === false)).toBe(true);
    });
  });

  it("refuses the same form key twice on one website", async () => {
    await asContext(staffCtx(admin), async (db) => {
      const site = await wixWebsite(db);
      await expect(
        addWixEnquiryForm(db, { clientId, websiteId: site.id, formId: FORM_B, formKey: "contact" }, admin.id),
      ).rejects.toThrow(WixBindingRuleError);
    });
  });

  it("refuses one Wix form on two websites, so submissions are never counted twice", async () => {
    await asContext(staffCtx(admin), async (db) => {
      const first = await wixWebsite(db, clientId, "contact", FORM_A);
      const second = await wixWebsite(db, clientId, "other-key");
      expect(first.id).not.toBe(second.id);
      // FORM_A already belongs to the first website.
      await expect(
        addWixEnquiryForm(db, { clientId, websiteId: second.id, formId: FORM_A, formKey: "duplicate" }, admin.id),
      ).rejects.toThrow(WixBindingRuleError);
    });
  });

  it("refuses a form on a website that is not connected to Wix", async () => {
    await asContext(staffCtx(admin), async (db) => {
      const site = await createWebsite(
        db,
        { clientId, name: `Database site ${Math.random().toString(36).slice(2, 8)}`, url: null, platform: "Next.js", environment: "production", notes: null },
        admin.id,
      );
      await expect(
        addWixEnquiryForm(db, { clientId, websiteId: site.id, formId: FORM_B, formKey: "contact" }, admin.id),
      ).rejects.toThrow(WixBindingRuleError);
    });
  });

  it("removes one form and leaves the rest", async () => {
    await asContext(staffCtx(admin), async (db) => {
      const site = await wixWebsite(db);
      await addWixEnquiryForm(db, { clientId, websiteId: site.id, formId: FORM_B, formKey: "appointment-enquiry" }, admin.id);
      await removeWixEnquiryForm(db, { clientId, websiteId: site.id, formKey: "appointment-enquiry" }, admin.id);
      const rows = (await listWixEnquiryBindings(db, null)).filter((row) => row.websiteId === site.id);
      expect(rows.map((row) => row.formKey)).toEqual(["contact"]);
    });
  });

  it("returning a website to its enquiry database removes every form it read", async () => {
    await asContext(staffCtx(admin), async (db) => {
      const site = await wixWebsite(db);
      await addWixEnquiryForm(db, { clientId, websiteId: site.id, formId: FORM_B, formKey: "appointment-enquiry" }, admin.id);
      await clearWixEnquiryForm(db, { clientId, websiteId: site.id }, admin.id);
      const rows = (await listWixEnquiryBindings(db, null)).filter((row) => row.websiteId === site.id);
      expect(rows).toEqual([]);
    });
  });
});

describe("permissions and client isolation", () => {
  it("stops a specialist adding a form", async () => {
    const site = await asContext(staffCtx(admin), (db) => wixWebsite(db), { commit: true });
    try {
      await asContext(staffCtx(specialist), async (db) => {
        await expect(
          addWixEnquiryForm(db, { clientId, websiteId: site.id, formId: FORM_B, formKey: "appointment-enquiry" }, specialist.id),
        ).rejects.toThrow();
      });
    } finally {
      await asContext(staffCtx(admin), (db) => clearWixEnquiryForm(db, { clientId, websiteId: site.id }, admin.id), { commit: true });
    }
  });

  it("hides another client's forms from a scoped caller", async () => {
    await asContext(staffCtx(admin), async (db) => {
      const mine = await wixWebsite(db, clientId, "contact");
      const theirs = await wixWebsite(db, otherClientId, "contact");
      const scoped = await listWixEnquiryBindings(db, ["clinic-genie"]);
      expect(scoped.some((row) => row.websiteId === mine.id)).toBe(true);
      expect(scoped.some((row) => row.websiteId === theirs.id)).toBe(false);
    });
  });
});

describe("database without migration 0044", () => {
  it("falls back to the single binding on websites, so the reader still works", async () => {
    // The shared database may not have 0044 yet. Hiding the table reproduces that.
    const client = await adminPool.connect();
    try {
      await client.query("begin");
      const owner = (await client.query("select id from clients limit 1")).rows[0].id;
      await client.query(
        `insert into websites (client_id, name, url, platform, environment, enquiry_key, enquiry_source,
           wix_instance_id, wix_form_id, wix_form_namespace, wix_form_key, wix_counts_in_totals)
         values ($1, 'Pre-0044 reader', 'https://example.invalid/', 'Wix', 'production', $2, 'wix',
           $3, $4, 'wix.form_app.form', 'contact', true)`,
        [owner, `pre0044-${Math.random().toString(36).slice(2, 7)}`, INSTANCE, FORM_A],
      );
      await client.query("alter table website_enquiry_forms rename to website_enquiry_forms_hidden");
      resetWixFormsTableCache();
      const rows = (await listWixEnquiryBindings(client, null)).filter((row) => row.websiteName === "Pre-0044 reader");
      expect(rows).toHaveLength(1);
      expect(rows[0]!.formId).toBe(FORM_A);
      expect(rows[0]!.instanceId).toBe(INSTANCE);
      expect(rows[0]!.namespace).toBe("wix.form_app.form");
      // The production-counting setting must survive the fallback unchanged.
      expect(rows[0]!.countsInTotals).toBe(true);
    } finally {
      await client.query("rollback").catch(() => {});
      client.release();
      resetWixFormsTableCache();
    }
  });
});
