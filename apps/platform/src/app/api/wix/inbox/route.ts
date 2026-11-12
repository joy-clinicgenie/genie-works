import { recordInboxFormMessage } from "@clinic-genie/db";
import { serviceTx } from "@/lib/db";
import { readInboxFormEvent } from "@/lib/wix-inbox-event";

/**
 * Wix Inbox webhook. Subscribed to message_sent_to_business, which is the only
 * supported way to discover a conversation: the Inbox API has no endpoint that lists
 * conversations. See D50.
 *
 * The body is a signed JWT. It is verified against the app's public key before anything
 * is read from it, and an unverified request is refused. Only identifiers are stored:
 * the submitted fields arrive in the event and are deliberately discarded. Nothing from
 * the payload is logged, so patient details never reach the application log.
 */

export const dynamic = "force-dynamic";

const ok = () => new Response(null, { status: 200 });

export async function POST(request: Request): Promise<Response> {
  const token = await request.text();
  const outcome = readInboxFormEvent(token, process.env.FORMS_WIX_WEBHOOK_PUBLIC_KEY);

  if (outcome.kind === "rejected") {
    // 400 for a request we cannot trust. Wix retries on a non-2xx, and a bad signature
    // will not become good, so the reason is reported without echoing any payload.
    const status = outcome.reason === "no_public_key" ? 503 : 400;
    console.warn(`wix inbox webhook refused: ${outcome.reason}`);
    return new Response(null, { status });
  }

  // A reply, a chat, a system notice or an outgoing message is acknowledged and dropped,
  // so Wix does not retry it and it never reaches the enquiry counts.
  if (outcome.kind === "ignored") return ok();

  const record = outcome.record;
  try {
    const result = await serviceTx((db) => recordInboxFormMessage(db, {
      instanceId: record.instanceId,
      conversationId: record.conversationId,
      messageId: record.messageId,
      sequence: record.sequence,
      appId: record.appId,
      formTitle: record.formTitle,
      messageCreatedAt: record.messageCreatedAt,
      eventId: record.eventId,
      discoveredVia: "webhook",
    }));
    if (!result.websiteId) {
      // The event is for a site this platform does not read. Acknowledged so Wix stops.
      console.warn("wix inbox webhook: no website reads this Wix site instance");
      return ok();
    }
    // A repeated delivery of the same message stores nothing: site, conversation and
    // message are unique together, which is the duplicate-event protection.
    console.info(`wix inbox webhook: ${result.stored ? "stored" : "duplicate"} ${result.websiteId}`);
    return ok();
  } catch (err) {
    // A storage failure returns 500 so Wix retries the delivery. No payload is logged.
    console.error("wix inbox webhook: could not record the message", err instanceof Error ? err.name : "unknown");
    return new Response(null, { status: 500 });
  }
}
