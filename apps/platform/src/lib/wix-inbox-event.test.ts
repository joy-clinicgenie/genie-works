import { createSign, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readInboxFormEvent, verifyWixJwt } from "@/lib/wix-inbox-event";

// A throwaway key pair, generated here. No Wix key and no live payload is used.
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PUBLIC_PEM = publicKey.export({ type: "spki", format: "pem" }).toString();
const OTHER = generateKeyPairSync("rsa", { modulusLength: 2048 });

const b64 = (value: object | string): string =>
  Buffer.from(typeof value === "string" ? value : JSON.stringify(value))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

function sign(payload: object, key = privateKey, alg = "RS256"): string {
  const head = b64({ alg, typ: "JWT" });
  const body = b64(payload);
  const signature = createSign("RSA-SHA256").update(`${head}.${body}`).sign(key);
  return `${head}.${body}.${signature.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

const INSTANCE = "21f82399-5ad8-4197-b764-20953b3846fc";
const CONVERSATION = "5f65164f-b373-3cb9-be2e-f1fdc00c86a9";

/** The envelope Wix documents: payload.data is a JSON string, event.data another. */
function envelope(body: object, instanceId = INSTANCE): object {
  return { data: JSON.stringify({ instanceId, eventType: "wix.crm.inbox.v2.message_sent_to_business", data: JSON.stringify(body) }) };
}

function formEvent(over: Record<string, unknown> = {}, messageOver: Record<string, unknown> = {}): object {
  return {
    id: "95c2f87d-ae78-4df9-aa21-95189231d6f7",
    entityFqdn: "wix.crm.inbox.v2.message",
    slug: "message_sent_to_business",
    entityId: "1640771667091213",
    actionEvent: {
      body: {
        conversationId: CONVERSATION,
        message: {
          direction: "PARTICIPANT_TO_BUSINESS",
          id: "1640771667091213",
          sequence: "1640771667091213",
          appId: "14ce1214-b278-a7e4-1373-00cebd1bef7c",
          visibility: "BUSINESS",
          createdDate: "2026-10-30T05:12:11.383Z",
          content: {
            previewText: "A person made a booking",
            form: {
              title: "General Booking",
              fields: [
                { name: "First Name", value: "REDACTED" },
                { name: "Last Name", value: "REDACTED" },
                { name: "Let us know what you need", value: "REDACTED" },
              ],
            },
          },
          ...messageOver,
        },
      },
    },
    ...over,
  };
}

describe("webhook signature", () => {
  it("accepts a token signed by the app's key", () => {
    const result = verifyWixJwt(sign({ data: "{}" }), PUBLIC_PEM);
    expect(result.ok).toBe(true);
  });

  it("refuses a token signed by a different key", () => {
    const result = verifyWixJwt(sign({ data: "{}" }, OTHER.privateKey), PUBLIC_PEM);
    expect(result).toEqual({ ok: false, reason: "unverified_signature" });
  });

  it("refuses an unsigned token and a tampered payload", () => {
    const parts = sign({ data: "{}" }).split(".");
    expect(verifyWixJwt(`${parts[0]}.${parts[1]}.`, PUBLIC_PEM)).toEqual({ ok: false, reason: "unverified_signature" });
    const swapped = b64({ data: JSON.stringify({ tampered: true }) });
    expect(verifyWixJwt(`${parts[0]}.${swapped}.${parts[2]}`, PUBLIC_PEM)).toEqual({ ok: false, reason: "unverified_signature" });
    expect(verifyWixJwt("not.a.jwt", PUBLIC_PEM)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyWixJwt("onlyonepart", PUBLIC_PEM)).toEqual({ ok: false, reason: "malformed" });
  });

  it("refuses an algorithm other than RS256, so alg:none cannot pass", () => {
    const head = b64({ alg: "none", typ: "JWT" });
    const body = b64({ data: "{}" });
    expect(verifyWixJwt(`${head}.${body}.`, PUBLIC_PEM)).toEqual({ ok: false, reason: "unverified_signature" });
  });

  it("refuses an expired token", () => {
    const token = sign({ data: "{}", exp: Math.floor(Date.now() / 1000) - 60 });
    expect(verifyWixJwt(token, PUBLIC_PEM)).toEqual({ ok: false, reason: "expired" });
  });
});

describe("reading an Inbox form event", () => {
  it("accepts an incoming form message and returns identifiers only", () => {
    const outcome = readInboxFormEvent(sign(envelope(formEvent())), PUBLIC_PEM);
    expect(outcome.kind).toBe("accepted");
    if (outcome.kind !== "accepted") return;
    expect(outcome.record).toEqual({
      instanceId: INSTANCE,
      conversationId: CONVERSATION,
      messageId: "1640771667091213",
      sequence: "1640771667091213",
      appId: "14ce1214-b278-a7e4-1373-00cebd1bef7c",
      formTitle: "General Booking",
      fieldCount: 3,
      messageCreatedAt: new Date("2026-10-30T05:12:11.383Z"),
      eventId: "95c2f87d-ae78-4df9-aa21-95189231d6f7",
    });
    // No submitted value is carried out of the parser.
    expect(JSON.stringify(outcome.record)).not.toContain("REDACTED");
  });

  it("refuses an event with no verified signature before reading anything", () => {
    const outcome = readInboxFormEvent(sign(envelope(formEvent()), OTHER.privateKey), PUBLIC_PEM);
    expect(outcome).toEqual({ kind: "rejected", reason: "unverified_signature" });
  });

  it("reports a missing public key rather than trusting the body", () => {
    expect(readInboxFormEvent(sign(envelope(formEvent())), undefined)).toEqual({ kind: "rejected", reason: "no_public_key" });
  });

  it("ignores a reply from the business", () => {
    const outcome = readInboxFormEvent(sign(envelope(formEvent({}, { direction: "BUSINESS_TO_PARTICIPANT" }))), PUBLIC_PEM);
    expect(outcome).toEqual({ kind: "ignored", reason: "not_incoming" });
  });

  it("ignores an ordinary chat, a minimal activity and a system notice", () => {
    for (const content of [
      { previewText: "hello", basic: { items: [{ text: "hello" }] } },
      { previewText: "Booked", minimal: { text: "Booked a spa appointment" } },
      { previewText: "policy", system: { text: "Facebook policy requires a reply" } },
      { previewText: "buttons", template: { title: "Choose", buttons: [] } },
    ]) {
      const outcome = readInboxFormEvent(sign(envelope(formEvent({}, { content }))), PUBLIC_PEM);
      expect(outcome).toEqual({ kind: "ignored", reason: "not_a_form_message" });
    }
  });

  it("ignores an event that is not an Inbox message", () => {
    const other = { id: "1", slug: "order_canceled", actionEvent: { body: { message: { direction: "PARTICIPANT_TO_BUSINESS" } } } };
    const token = sign({ data: JSON.stringify({ instanceId: INSTANCE, eventType: "wix.ecom.v1.order_canceled", data: JSON.stringify(other) }) });
    expect(readInboxFormEvent(token, PUBLIC_PEM)).toEqual({ kind: "ignored", reason: "not_an_inbox_message" });
  });

  it("ignores a form message whose identifiers are missing or malformed", () => {
    const noConversation = formEvent();
    (noConversation as { actionEvent: { body: Record<string, unknown> } }).actionEvent.body.conversationId = "not-a-uuid";
    expect(readInboxFormEvent(sign(envelope(noConversation)), PUBLIC_PEM)).toEqual({ kind: "ignored", reason: "no_identifiers" });
    expect(readInboxFormEvent(sign(envelope(formEvent(), "not-a-uuid")), PUBLIC_PEM)).toEqual({ kind: "ignored", reason: "no_identifiers" });
    const noDate = formEvent({}, { createdDate: undefined });
    expect(readInboxFormEvent(sign(envelope(noDate)), PUBLIC_PEM)).toEqual({ kind: "ignored", reason: "no_identifiers" });
  });

  it("rejects a malformed envelope rather than guessing", () => {
    expect(readInboxFormEvent(sign({ data: "not json" }), PUBLIC_PEM)).toEqual({ kind: "rejected", reason: "malformed" });
    expect(readInboxFormEvent(sign({ data: JSON.stringify({ instanceId: INSTANCE, data: "not json" }) }), PUBLIC_PEM)).toEqual({ kind: "rejected", reason: "malformed" });
  });

  it("accepts the same event twice identically, so the caller can dedupe on the ids", () => {
    const token = sign(envelope(formEvent()));
    const first = readInboxFormEvent(token, PUBLIC_PEM);
    const second = readInboxFormEvent(token, PUBLIC_PEM);
    expect(first).toEqual(second);
  });
});
