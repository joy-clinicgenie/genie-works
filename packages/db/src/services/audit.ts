import type { Queryable } from "../client";

export interface AuditInput {
  actorType: "staff" | "service" | "public" | "system";
  actorUserId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  clientId?: string | null;
  outcome: "success" | "denied" | "failure";
  /** Safe metadata only. Never names, emails, phone numbers, message text or tokens. */
  metadata?: Record<string, unknown>;
}

export async function recordAudit(db: Queryable, input: AuditInput): Promise<void> {
  await db.query(
    `insert into audit_events (actor_type, actor_user_id, action, target_type, target_id, client_id, outcome, metadata)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      input.actorType,
      input.actorUserId ?? null,
      input.action,
      input.targetType,
      input.targetId ?? null,
      input.clientId ?? null,
      input.outcome,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}

export interface AuditEventRow {
  id: string;
  occurred_at: Date;
  actor_type: string;
  actor_user_id: string | null;
  actor_name: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  client_id: string | null;
  client_name: string | null;
  outcome: string;
  metadata: Record<string, unknown>;
}

export async function listAuditEvents(db: Queryable, opts: { clientId?: string; limit?: number; action?: string; targetIds?: string[] } = {}): Promise<AuditEventRow[]> {
  const targetIds = opts.targetIds && opts.targetIds.length > 0 ? opts.targetIds : null;
  if (opts.targetIds && opts.targetIds.length === 0) return [];
  const { rows } = await db.query<AuditEventRow>(
    `select a.*, u.display_name as actor_name, c.name as client_name
     from audit_events a
     left join staff_users u on u.id = a.actor_user_id
     left join clients c on c.id = a.client_id
     where ($1::uuid is null or a.client_id = $1)
       and ($3::text is null or a.action = $3)
       and ($4::text[] is null or a.target_id = any($4))
     order by a.occurred_at desc
     limit $2`,
    [opts.clientId ?? null, opts.limit ?? 100, opts.action ?? null, targetIds],
  );
  return rows;
}
