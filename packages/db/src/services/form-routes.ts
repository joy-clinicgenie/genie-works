import type { Queryable } from "../client";
import { recordAudit } from "./audit";

// Client-level routes remain for existing rows. New proposals are stored in website_forms.

export class FormRouteRuleError extends Error {
  field?: string;
  constructor(message: string, field?: string) {
    super(message);
    this.name = "FormRouteRuleError";
    this.field = field;
  }
}

export interface FormRouteRow {
  client_id: string;
  recipient_contact_id: string | null;
  confirmation_message: string | null;
  updated_at: Date;
}

export async function listFormRoutes(db: Queryable, clientIds: string[] | null): Promise<FormRouteRow[]> {
  const { rows } = await db.query<FormRouteRow>(
    `select client_id, recipient_contact_id, confirmation_message, updated_at
     from form_routes
     where ($1::uuid[] is null or client_id = any($1))`,
    [clientIds],
  );
  return rows;
}

export async function saveFormRoute(
  db: Queryable,
  input: { clientId: string; recipientContactId: string | null; confirmationMessage: string | null; updatedBy: string },
): Promise<void> {
  const message = input.confirmationMessage?.trim() || null;
  if (message && message.length > 1000) throw new FormRouteRuleError("Confirmation wording must be 1000 characters or fewer.", "confirmationMessage");
  if (input.recipientContactId) {
    const contact = await db.query<{ id: string }>(
      "select id from client_contacts where id = $1 and client_id = $2 and active",
      [input.recipientContactId, input.clientId],
    );
    if (!contact.rows[0]) throw new FormRouteRuleError("Choose a contact from this client.", "recipientContactId");
  }
  await db.query(
    `insert into form_routes (client_id, recipient_contact_id, confirmation_message, updated_by)
     values ($1, $2, $3, $4)
     on conflict (client_id) do update set
       recipient_contact_id = excluded.recipient_contact_id,
       confirmation_message = excluded.confirmation_message,
       updated_by = excluded.updated_by,
       updated_at = now()`,
    [input.clientId, input.recipientContactId, message, input.updatedBy],
  );
  await recordAudit(db, {
    actorType: "staff",
    actorUserId: input.updatedBy,
    action: "form_route.update",
    targetType: "form_route",
    targetId: input.clientId,
    clientId: input.clientId,
    outcome: "success",
    metadata: { recipientSet: Boolean(input.recipientContactId), messageSet: Boolean(message) },
  });
}
