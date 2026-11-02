import PostgresAdapter from "@auth/pg-adapter";
import type pg from "pg";

/**
 * Keeps the official adapter's writes and account handling, but reads a
 * database session and its user with one service-context query.
 */
export function postgresAuthAdapter(client: pg.Pool) {
  const adapter = PostgresAdapter(client);
  return {
    ...adapter,
    async getSessionAndUser(sessionToken: string) {
      const result = await client.query<{
        session_id: number;
        session_token: string;
        session_user_id: number;
        session_expires: Date;
        user_id: number;
        user_name: string | null;
        user_email: string;
        user_email_verified: Date | null;
        user_image: string | null;
      }>(
        `select
           s.id as session_id,
           s."sessionToken" as session_token,
           s."userId" as session_user_id,
           s.expires as session_expires,
           u.id as user_id,
           u.name as user_name,
           u.email as user_email,
           u."emailVerified" as user_email_verified,
           u.image as user_image
         from sessions s
         join users u on u.id = s."userId"
         where s."sessionToken" = $1`,
        [sessionToken],
      );
      const row = result.rows[0];
      if (!row) return null;
      return {
        session: {
          sessionToken: row.session_token,
          userId: String(row.session_user_id),
          expires: row.session_expires,
        },
        user: {
          id: String(row.user_id),
          name: row.user_name,
          email: row.user_email,
          emailVerified: row.user_email_verified,
          image: row.user_image,
        },
      };
    },
  } satisfies ReturnType<typeof PostgresAdapter>;
}
