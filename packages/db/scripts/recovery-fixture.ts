/** Adds one fictional article and disposable sign-in rows to the rehearsal database. */
import { randomBytes } from "node:crypto";
import { assertRecoverySource } from "../src/backup";
import { closePools, getAdminPool, withContext } from "../src/client";
import { loadRootEnv, requireEnv } from "../src/env";
import { databaseNameFromUrl, describeDatabaseTarget } from "../src/migrate";
import { createArticle } from "../src/services/blog";

loadRootEnv();
const adminUrl = requireEnv("DATABASE_ADMIN_URL");
const appUrl = requireEnv("DATABASE_URL");
assertRecoverySource(adminUrl);
if (databaseNameFromUrl(appUrl) !== databaseNameFromUrl(adminUrl)) {
  throw new Error("Refusing recovery fixture: the application database does not match the owner database.");
}
console.log(describeDatabaseTarget(adminUrl));

const admin = getAdminPool();
const place = await admin.query<{ client_id: string; website_id: string | null; user_id: string }>(
  `select c.id as client_id, w.id as website_id, u.id as user_id
   from clients c
   join staff_users u on u.email = 'admin@example.invalid' and u.active
   left join websites w on w.client_id = c.id and w.status = 'active'
   where c.slug = 'clinic-genie'
   order by w.created_at nulls last
   limit 1`,
);
const found = place.rows[0];
if (!found) throw new Error("Refusing recovery fixture: the internal agency client is not ready.");
const row = found.website_id
  ? { client_id: found.client_id, website_id: found.website_id, user_id: found.user_id }
  : (await admin.query<{ client_id: string; website_id: string; user_id: string }>(
      `insert into websites (client_id, name, url, platform, environment, notes)
       values ($1, 'Clinic Genie website', 'https://clinic-genie.example.invalid', 'Next.js on Vercel', 'production', 'Recovery fixture website.')
       returning client_id, id as website_id, $2::uuid as user_id`,
      [found.client_id, found.user_id],
    )).rows[0];
if (!row) throw new Error("Refusing recovery fixture: the internal agency website was not saved.");

const existing = await admin.query("select 1 from blog_articles where website_id = $1 and slug = 'recovery-check'", [row.website_id]);
if (existing.rowCount === 0) {
  await withContext({ kind: "staff", userId: row.user_id, role: "admin" }, (db) =>
    createArticle(db, {
      clientId: row.client_id,
      websiteId: row.website_id,
      title: "Recovery check",
      slug: "recovery-check",
      slugEdited: true,
      excerpt: "Fictional article used to prove backup coverage.",
      category: "Recovery",
      authorUserId: row.user_id,
      reviewerUserId: null,
      seoTitle: "Recovery check",
      seoDescription: "Fictional article used to prove backup coverage.",
      canonicalPath: "/blog/recovery-check",
      indexable: false,
      body: { layout: "clinic-article-v1", blocks: [{ type: "paragraph", text: "Fictional recovery check." }] },
    }, row.user_id),
  );
}

let userId = (await admin.query<{ id: number }>("select id from users where email = 'recovery-check@example.invalid' order by id limit 1")).rows[0]?.id;
if (!userId) {
  userId = (await admin.query<{ id: number }>("insert into users (name, email) values ('Recovery Check', 'recovery-check@example.invalid') returning id")).rows[0]?.id;
}
if (!userId) throw new Error("Refusing recovery fixture: the disposable identity row was not created.");
const session = await admin.query("select 1 from sessions where \"userId\" = $1", [userId]);
if (session.rowCount === 0) {
  await admin.query(`insert into sessions ("userId", expires, "sessionToken") values ($1, now() + interval '1 day', $2)`, [userId, randomBytes(24).toString("hex")]);
}
const token = await admin.query("select 1 from verification_token where identifier = 'recovery-check@example.invalid'");
if (token.rowCount === 0) {
  await admin.query(
    "insert into verification_token (identifier, expires, token) values ('recovery-check@example.invalid', now() + interval '1 day', $1)",
    [randomBytes(24).toString("hex")],
  );
}
const link = await admin.query("select 1 from dev_magic_links where email = 'recovery-check@example.invalid'");
if (link.rowCount === 0) {
  await admin.query(
    "insert into dev_magic_links (email, url, expires_at) values ('recovery-check@example.invalid', 'https://example.invalid/recovery-check', now() + interval '1 day')",
  );
}

const counts = await admin.query<{ articles: number; activity: number; sessions: number; tokens: number; links: number }>(
  `select
     (select count(*)::int from blog_articles where slug = 'recovery-check') as articles,
     (select count(*)::int from blog_activity) as activity,
     (select count(*)::int from sessions) as sessions,
     (select count(*)::int from verification_token) as tokens,
     (select count(*)::int from dev_magic_links) as links`,
);
console.log(JSON.stringify(counts.rows[0]));
await closePools();
