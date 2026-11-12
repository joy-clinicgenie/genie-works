import { beforeAll, describe, expect, it } from "vitest";
import {
  listInboxCoverage,
  listInboxFormMessages,
  recordInboxFormMessage,
  registerInboxConversation,
  WixInboxRuleError,
} from "../src/services/wix-inbox";
import { bindWixEnquiryForm } from "../src/services/wix-enquiry-binding";
import { createClient, createWebsite } from "../src/services/registry";
import { asContext, clientBySlug, staffByEmail, staffCtx } from "./helpers";

const CONVERSATION = "5f65164f-b373-3cb9-be2e-f1fdc00c86a9";
const OTHER_CONVERSATION = "6a76275a-c484-4dca-bf3f-a2aed11d97ba";
const MESSAGE = "1640771667091213";
const SENT_AT = new Date("2026-10-30T05:12:11.383Z");

let admin: Awaited<ReturnType<typeof staffByEmail>>;
let specialist: Awaited<ReturnType<typeof staffByEmail>>;
let clientId: string;
let otherClientId: string;

function uuid(): string {
  const hex = (n: number) => Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-8${hex(3)}-${hex(12)}`;
}

beforeAll(async () => {
  admin = await staffByEmail("admin@example.invalid");
  specialist = await staffByEmail("specialist-a@example.invalid");
  clientId = await clientBySlug("clinic-genie");
  otherClientId = await asContext(staffCtx(admin), async (db) => {
    const slug = `inbox-${Math.random().toString(36).slice(2, 8)}`;
    const created = await createClient(
      db,
      { slug, name: `Inbox ${slug}`, ownerUserId: admin.id, channels: [], services: null, isSynthetic: true, notes: null },
      admin.id,
    );
    return created.id;
  }, { commit: true });
});

/** A Wix website with a known app instance, inside the caller's rolled-back transaction. */
async function wixSite(db: Parameters<Parameters<typeof asContext>[1]>[0], owner = clientId) {
  const instanceId = uuid();
  const site = await createWebsite(
    db,
    { clientId: owner, name: `Inbox site ${Math.random().toString(36).slice(2, 8)}`, url: "https://example.invalid/", platform: "Wix", environment: "production", notes: null },
    admin.id,
  );
  await bindWixEnquiryForm(db, { clientId: owner, websiteId: site.id, instanceId, formId: uuid(), formKey: "contact" }, admin.id);
  return { ...site, instanceId };
}

const message = (instanceId: string, over: Partial<Parameters<typeof recordInboxFormMessage>[1]> = {}) => ({
  instanceId,
  conversationId: CONVERSATION,
  messageId: MESSAGE,
  sequence: MESSAGE,
  appId: "14ce1214-b278-a7e4-1373-00cebd1bef7c",
  formTitle: "General Booking",
  messageCreatedAt: SENT_AT,
  eventId: "95c2f87d-ae78-4df9-aa21-95189231d6f7",
  discoveredVia: "webhook" as const,
  ...over,
});

describe("recording an Inbox form message", () => {
  it("stores one record and resolves the website from the app instance", async () => {
    await asContext({ kind: "service" }, async (db) => {
      const site = await asContext(staffCtx(admin), (d) => wixSite(d), { commit: true });
      try {
        const result = await recordInboxFormMessage(db, message(site.instanceId));
        expect(result).toEqual({ stored: true, duplicate: false, websiteId: site.id });
        const rows = (await listInboxFormMessages(db, null)).filter((row) => row.websiteId === site.id);
        expect(rows).toHaveLength(1);
        expect(rows[0]!.conversationId).toBe(CONVERSATION);
        expect(rows[0]!.messageId).toBe(MESSAGE);
        expect(rows[0]!.formTitle).toBe("General Booking");
        expect(rows[0]!.discoveredVia).toBe("webhook");
      } finally {
        await asContext(staffCtx(admin), (d) => d.query("delete from websites where id = $1", [site.id]).then(() => undefined), { commit: true }).catch(() => {});
      }
    });
  });

  it("ignores a repeated delivery of the same message", async () => {
    await asContext({ kind: "service" }, async (db) => {
      const site = await wixSite(db);
      const first = await recordInboxFormMessage(db, message(site.instanceId));
      const again = await recordInboxFormMessage(db, message(site.instanceId));
      expect(first.stored).toBe(true);
      expect(again).toEqual({ stored: false, duplicate: true, websiteId: site.id });
      const rows = (await listInboxFormMessages(db, null)).filter((row) => row.websiteId === site.id);
      expect(rows).toHaveLength(1);
    });
  });

  it("keeps two different messages in the same conversation apart", async () => {
    await asContext({ kind: "service" }, async (db) => {
      const site = await wixSite(db);
      await recordInboxFormMessage(db, message(site.instanceId));
      await recordInboxFormMessage(db, message(site.instanceId, { messageId: "1640771667091299" }));
      const rows = (await listInboxFormMessages(db, null)).filter((row) => row.websiteId === site.id);
      expect(rows).toHaveLength(2);
    });
  });

  it("stores nothing for an instance no website reads", async () => {
    await asContext({ kind: "service" }, async (db) => {
      const result = await recordInboxFormMessage(db, message(uuid()));
      expect(result).toEqual({ stored: false, duplicate: false, websiteId: null });
    });
  });

  it("refuses identifiers that are not in the expected form", async () => {
    await asContext({ kind: "service" }, async (db) => {
      const site = await wixSite(db);
      await expect(recordInboxFormMessage(db, message(site.instanceId, { conversationId: "not-a-uuid" }))).rejects.toThrow(WixInboxRuleError);
      await expect(recordInboxFormMessage(db, message(site.instanceId, { messageId: "has spaces" }))).rejects.toThrow(WixInboxRuleError);
    });
  });

  it("cannot be edited once recorded, because it is evidence of a delivery", async () => {
    await asContext({ kind: "service" }, async (db) => {
      const site = await wixSite(db);
      await recordInboxFormMessage(db, message(site.instanceId));
      // cg_app has no update grant, and a trigger refuses it too. Either is enough.
      await expect(
        db.query("update wix_inbox_messages set form_title = 'changed' where website_id = $1", [site.id]),
      ).rejects.toThrow(/permission denied|cannot be changed/);
    });
  });
});

describe("coverage", () => {
  it("reports the coverage start and the message count, so a partial window is visible", async () => {
    await asContext({ kind: "service" }, async (db) => {
      const site = await wixSite(db);
      const earlier = new Date("2026-10-01T00:00:00.000Z");
      await recordInboxFormMessage(db, message(site.instanceId));
      await recordInboxFormMessage(db, message(site.instanceId, { messageId: "1640771667000001", messageCreatedAt: earlier }));
      const coverage = (await listInboxCoverage(db, null)).filter((row) => row.websiteId === site.id);
      expect(coverage).toHaveLength(1);
      expect(coverage[0]!.messageCount).toBe(2);
      // Coverage starts at the earliest message known, not the first one recorded.
      expect(coverage[0]!.coverageStartAt?.toISOString()).toBe(earlier.toISOString());
      expect(coverage[0]!.earliestMessageAt?.toISOString()).toBe(earlier.toISOString());
    });
  });

  it("lists a Wix website with no Inbox records as having no coverage", async () => {
    await asContext({ kind: "service" }, async (db) => {
      const site = await wixSite(db);
      const coverage = (await listInboxCoverage(db, null)).filter((row) => row.websiteId === site.id);
      expect(coverage[0]!.messageCount).toBe(0);
      expect(coverage[0]!.coverageStartAt).toBeNull();
    });
  });
});

describe("registering a known conversation", () => {
  it("stores a conversation an administrator supplies, marked as registered", async () => {
    await asContext(staffCtx(admin), async (db) => {
      const site = await wixSite(db);
      const result = await registerInboxConversation(
        db,
        { clientId, websiteId: site.id, conversationId: OTHER_CONVERSATION, messageId: MESSAGE, messageCreatedAt: SENT_AT, formTitle: "General Booking" },
        admin.id,
      );
      expect(result).toEqual({ stored: true, duplicate: false });
      const rows = (await listInboxFormMessages(db, null)).filter((row) => row.websiteId === site.id);
      expect(rows[0]!.discoveredVia).toBe("registered");
    });
  });

  it("ignores a conversation already recorded by the webhook, so history never double counts", async () => {
    await asContext(staffCtx(admin), async (db) => {
      const site = await wixSite(db);
      await recordInboxFormMessage(db, message(site.instanceId));
      const result = await registerInboxConversation(
        db,
        { clientId, websiteId: site.id, conversationId: CONVERSATION, messageId: MESSAGE, messageCreatedAt: SENT_AT },
        admin.id,
      );
      expect(result).toEqual({ stored: false, duplicate: true });
      const rows = (await listInboxFormMessages(db, null)).filter((row) => row.websiteId === site.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.discoveredVia).toBe("webhook");
    });
  });

  it("refuses a malformed conversation id and a website that does not read Wix", async () => {
    await asContext(staffCtx(admin), async (db) => {
      const site = await wixSite(db);
      await expect(registerInboxConversation(db, { clientId, websiteId: site.id, conversationId: "nope", messageId: MESSAGE, messageCreatedAt: SENT_AT }, admin.id))
        .rejects.toThrow(WixInboxRuleError);
      const plain = await createWebsite(
        db,
        { clientId, name: `Plain ${Math.random().toString(36).slice(2, 7)}`, url: null, platform: "Next.js", environment: "production", notes: null },
        admin.id,
      );
      await expect(registerInboxConversation(db, { clientId, websiteId: plain.id, conversationId: OTHER_CONVERSATION, messageId: MESSAGE, messageCreatedAt: SENT_AT }, admin.id))
        .rejects.toThrow(WixInboxRuleError);
    });
  });
});

describe("permissions and client isolation", () => {
  it("gives a specialist with no membership no sight of a site and nothing to store", async () => {
    const site = await asContext(staffCtx(admin), (db) => wixSite(db), { commit: true });
    try {
      await asContext(staffCtx(specialist), async (db) => {
        // Row-level security hides the website, so the instance resolves to nothing.
        const result = await recordInboxFormMessage(db, message(site.instanceId));
        expect(result).toEqual({ stored: false, duplicate: false, websiteId: null });
        expect(await listInboxFormMessages(db, null)).toEqual([]);
      });
    } finally {
      await asContext(staffCtx(admin), (db) => d2(db, site.id), { commit: true }).catch(() => {});
    }
  });

  it("lets only an administrator or trusted server code insert a record", async () => {
    await asContext(staffCtx(admin), async (db) => {
      const site = await wixSite(db);
      // The insert policy is app_is_admin(), so a manager context is refused.
      await expect(
        db.query(
          `insert into wix_inbox_messages (website_id, client_id, conversation_id, message_id, message_created_at, discovered_via)
           values ($1, $2, $3, $4, $5, 'webhook')`,
          [site.id, clientId, CONVERSATION, MESSAGE, SENT_AT],
        ),
      ).resolves.toBeTruthy();
    });
    const site = await asContext(staffCtx(admin), (db) => wixSite(db), { commit: true });
    try {
      const manager = await staffByEmail("manager@example.invalid");
      await asContext(staffCtx(manager), async (db) => {
        await expect(
          db.query(
            `insert into wix_inbox_messages (website_id, client_id, conversation_id, message_id, message_created_at, discovered_via)
             values ($1, $2, $3, $4, $5, 'webhook')`,
            [site.id, clientId, CONVERSATION, MESSAGE, SENT_AT],
          ),
        ).rejects.toThrow(/row-level security|violates/);
      });
    } finally {
      await asContext(staffCtx(admin), (db) => d2(db, site.id), { commit: true }).catch(() => {});
    }
  });

  it("hides another client's Inbox messages from a scoped caller", async () => {
    await asContext({ kind: "service" }, async (db) => {
      const mine = await wixSite(db, clientId);
      const theirs = await wixSite(db, otherClientId);
      await recordInboxFormMessage(db, message(mine.instanceId));
      await recordInboxFormMessage(db, message(theirs.instanceId));
      const scoped = await listInboxFormMessages(db, ["clinic-genie"]);
      expect(scoped.some((row) => row.websiteId === mine.id)).toBe(true);
      expect(scoped.some((row) => row.websiteId === theirs.id)).toBe(false);
    });
  });
});

async function d2(db: Parameters<Parameters<typeof asContext>[1]>[0], websiteId: string): Promise<void> {
  await db.query("delete from wix_inbox_coverage where website_id = $1", [websiteId]);
  await db.query("delete from wix_inbox_messages where website_id = $1", [websiteId]);
  await db.query("delete from website_enquiry_forms where website_id = $1", [websiteId]);
  await db.query("delete from websites where id = $1", [websiteId]);
}
