import { createPublicKey, createVerify } from "node:crypto";

/**
 * Wix sends a webhook as a signed JWT in the request body. This module verifies that
 * signature and decides whether the event describes an incoming form submission.
 *
 * It is deliberately pure and content-free: it returns identifiers and the form's own
 * title, never the submitted values. The caller stores only what this returns, so a
 * submitted field, a message body or a raw payload is never persisted.
 */

export type InboxEventOutcome =
  | { kind: "accepted"; record: InboxFormMessage }
  | { kind: "ignored"; reason: IgnoredReason }
  | { kind: "rejected"; reason: RejectedReason };

export type IgnoredReason =
  | "not_an_inbox_message"
  | "not_incoming"
  | "not_a_form_message"
  | "no_identifiers";

export type RejectedReason = "unverified_signature" | "malformed" | "expired" | "no_public_key";

export interface InboxFormMessage {
  instanceId: string;
  conversationId: string;
  messageId: string;
  sequence: string | null;
  /** The app that produced the message, so a legacy form is distinguishable from a chat. */
  appId: string | null;
  /** The form's own title, as Inbox shows it. Not a submitted field. */
  formTitle: string | null;
  /** How many fields were submitted. A count, never the values. */
  fieldCount: number;
  messageCreatedAt: Date;
  eventId: string | null;
}

const INBOX_MESSAGE_SLUG = "message_sent_to_business";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function base64UrlToBuffer(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/**
 * Verifies an RS256 JWT against the app's public key. Implemented on node:crypto so the
 * platform does not take a new dependency for one signature check.
 */
export function verifyWixJwt(token: string, publicKeyPem: string, now = Date.now()): { ok: true; payload: unknown } | { ok: false; reason: RejectedReason } {
  const parts = token.trim().split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];
  let header: { alg?: unknown };
  try {
    header = JSON.parse(base64UrlToBuffer(encodedHeader).toString("utf8")) as { alg?: unknown };
  } catch {
    return { ok: false, reason: "malformed" };
  }
  // Only RS256 is accepted. A token asking for "none" or a symmetric algorithm is refused.
  if (header.alg !== "RS256") return { ok: false, reason: "unverified_signature" };
  let verified = false;
  try {
    const key = createPublicKey(publicKeyPem);
    verified = createVerify("RSA-SHA256")
      .update(`${encodedHeader}.${encodedPayload}`)
      .verify(key, base64UrlToBuffer(encodedSignature));
  } catch {
    return { ok: false, reason: "unverified_signature" };
  }
  if (!verified) return { ok: false, reason: "unverified_signature" };
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(base64UrlToBuffer(encodedPayload).toString("utf8")) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof payload.exp === "number" && payload.exp * 1000 <= now) return { ok: false, reason: "expired" };
  return { ok: true, payload };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Wix nests JSON as strings: payload.data holds the event, event.data holds its body. */
function parseNested(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return asRecord(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Decides what one verified webhook body means. Only an incoming form message from a
 * participant is accepted; a reply, an ordinary chat, a system notice and an outgoing
 * message are ignored, so they never reach the enquiry counts.
 */
export function readInboxFormEvent(token: string, publicKeyPem: string | undefined, now = Date.now()): InboxEventOutcome {
  if (!publicKeyPem) return { kind: "rejected", reason: "no_public_key" };
  const verified = verifyWixJwt(token, publicKeyPem, now);
  if (!verified.ok) return { kind: "rejected", reason: verified.reason };
  const payload = asRecord(verified.payload);
  const event = parseNested(payload?.data);
  if (!event) return { kind: "rejected", reason: "malformed" };
  const instanceId = text(event.instanceId);
  const eventType = text(event.eventType) ?? "";
  const body = parseNested(event.data);
  if (!body) return { kind: "rejected", reason: "malformed" };

  const slug = text(body.slug) ?? "";
  // Match on the event's own slug, and accept the eventType spelling as well.
  if (slug !== INBOX_MESSAGE_SLUG && !eventType.endsWith(INBOX_MESSAGE_SLUG)) {
    return { kind: "ignored", reason: "not_an_inbox_message" };
  }
  const actionBody = asRecord(asRecord(body.actionEvent)?.body) ?? asRecord(body.body) ?? body;
  const message = asRecord(actionBody.message);
  if (!message) return { kind: "rejected", reason: "malformed" };

  if (text(message.direction) !== "PARTICIPANT_TO_BUSINESS") return { kind: "ignored", reason: "not_incoming" };
  const content = asRecord(message.content);
  const form = asRecord(content?.form);
  // A basic, minimal, template or system message is not a form submission.
  if (!form) return { kind: "ignored", reason: "not_a_form_message" };

  const conversationId = text(actionBody.conversationId);
  const messageId = text(message.id) ?? text(body.entityId);
  const created = text(message.createdDate);
  const createdAt = created ? new Date(created) : null;
  if (!instanceId || !UUID.test(instanceId) || !conversationId || !UUID.test(conversationId) || !messageId || !createdAt || Number.isNaN(createdAt.getTime())) {
    return { kind: "ignored", reason: "no_identifiers" };
  }
  const fields = Array.isArray(form.fields) ? form.fields : [];
  return {
    kind: "accepted",
    record: {
      instanceId: instanceId.toLowerCase(),
      conversationId: conversationId.toLowerCase(),
      messageId,
      sequence: text(message.sequence),
      appId: text(message.appId),
      formTitle: text(form.title),
      fieldCount: fields.length,
      messageCreatedAt: createdAt,
      eventId: text(body.id),
    },
  };
}
