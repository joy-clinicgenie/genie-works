import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import {
  AI_CRAWLERS, AiAccessFetchError, aiAccessOrigin, aiAccessTarget, listAiAccessChecks, parseRobots, readAiAccess, recordAiAccessCheck, robotsVerdict,
  type AiAccessReading, type TextFetcher,
} from "../src/services/ai-access";
import { adminPool, appPool, asContext, staffByEmail, staffCtx } from "./helpers";

type Staff = Awaited<ReturnType<typeof staffByEmail>>;

function text(body: string, status = 200, contentType = "text/plain; charset=utf-8") {
  return { status, contentType, body, bytes: Buffer.byteLength(body) };
}

function fetcherFor(files: Record<string, ReturnType<typeof text> | Error>): TextFetcher {
  return async (url) => {
    const path = new URL(url).pathname;
    const hit = files[path];
    if (hit instanceof Error) throw hit;
    return hit ?? text("Not found", 404, "text/html");
  };
}

const SAMPLE_READING: AiAccessReading = {
  origin: "https://ai.example.com",
  robotsStatus: "found",
  robotsHttp: 200,
  llmsStatus: "found",
  llmsHttp: 200,
  llmsBytes: 10,
  crawlers: AI_CRAWLERS.map(({ agent }) => ({ agent, verdict: "allowed" as const, rule: "named" as const })),
  safeErrorCode: null,
};

describe("robots.txt evaluation", () => {
  it("uses a group that names the crawler before the default group", () => {
    const groups = parseRobots(`
User-agent: *
Disallow: /

# AI crawlers are welcome
User-agent: GPTBot
User-agent: ClaudeBot
Allow: /
Disallow: /api/
`);
    expect(robotsVerdict(groups, "GPTBot")).toEqual({ verdict: "allowed", rule: "named" });
    expect(robotsVerdict(groups, "claudebot")).toEqual({ verdict: "allowed", rule: "named" });
    expect(robotsVerdict(groups, "CCBot")).toEqual({ verdict: "blocked", rule: "default" });
    expect(robotsVerdict(groups, "GPTBot", "/api/leads").verdict).toBe("blocked");
  });

  it("applies the longest rule, lets Allow win a tie and ignores an empty Disallow", () => {
    const groups = parseRobots("User-agent: *\nDisallow: /private\nAllow: /private/open\nDisallow: /a\nAllow: /a\nUser-agent: GPTBot\nDisallow:\n");
    expect(robotsVerdict(groups, "Bingbot", "/private/x").verdict).toBe("blocked");
    expect(robotsVerdict(groups, "Bingbot", "/private/open/page").verdict).toBe("allowed");
    expect(robotsVerdict(groups, "Bingbot", "/a").verdict).toBe("allowed");
    expect(robotsVerdict(groups, "GPTBot", "/private/x")).toEqual({ verdict: "allowed", rule: "named" });
  });

  it("supports * and $ in paths", () => {
    const groups = parseRobots("User-agent: PerplexityBot\nDisallow: /*.pdf$\nDisallow: /$\n");
    expect(robotsVerdict(groups, "PerplexityBot", "/").verdict).toBe("blocked");
    expect(robotsVerdict(groups, "PerplexityBot", "/about").verdict).toBe("allowed");
    expect(robotsVerdict(groups, "PerplexityBot", "/files/a.pdf").verdict).toBe("blocked");
    expect(robotsVerdict(groups, "PerplexityBot", "/files/a.pdf?x=1").verdict).toBe("allowed");
  });
});

describe("registry origin", () => {
  it("keeps only a public https origin", () => {
    expect(aiAccessOrigin("https://www.Clinic.example.com/about?x=1")).toBe("https://www.clinic.example.com");
    for (const bad of [null, "", "not a url", "http://clinic.example.com", "https://user:pw@clinic.example.com", "https://127.0.0.1", "https://localhost", "https://intranet", "https://site.internal", "https://[::1]"]) {
      expect(() => aiAccessOrigin(bad), String(bad)).toThrow(expect.objectContaining({ name: "AiAccessRuleError" }));
    }
  });
});

describe("reading a website", () => {
  it("reports every crawler from a found robots.txt and a found llms.txt", async () => {
    const reading = await readAiAccess(fetcherFor({
      "/robots.txt": text("User-agent: *\nAllow: /\nUser-agent: CCBot\nDisallow: /\n"),
      "/llms.txt": text("# Clinic\n> Summary\n", 200, "text/plain"),
    }), "https://clinic.example.com");
    expect(reading.robotsStatus).toBe("found");
    expect(reading.llmsStatus).toBe("found");
    expect(reading.llmsBytes).toBe(19);
    expect(reading.crawlers).toHaveLength(AI_CRAWLERS.length);
    expect(reading.crawlers.find((c) => c.agent === "CCBot")).toEqual({ agent: "CCBot", verdict: "blocked", rule: "named" });
    expect(reading.crawlers.find((c) => c.agent === "GPTBot")).toEqual({ agent: "GPTBot", verdict: "allowed", rule: "default" });
    expect(reading.safeErrorCode).toBeNull();
  });

  it("treats a missing robots.txt as no restriction and an HTML llms.txt as not plain text", async () => {
    const reading = await readAiAccess(fetcherFor({ "/llms.txt": text("<html></html>", 200, "text/html") }), "https://clinic.example.com");
    expect(reading.robotsStatus).toBe("missing");
    expect(reading.crawlers.every((c) => c.verdict === "allowed" && c.rule === "no_file")).toBe(true);
    expect(reading.llmsStatus).toBe("not_text");
    expect(reading.llmsBytes).toBeNull();
  });

  it("marks crawlers Unknown when the site fails, and stores only a safe code", async () => {
    const down = await readAiAccess(fetcherFor({ "/robots.txt": text("oops", 503), "/llms.txt": new AiAccessFetchError("timeout") }), "https://clinic.example.com");
    expect(down.robotsStatus).toBe("error");
    expect(down.crawlers.every((c) => c.verdict === "unknown")).toBe(true);
    expect(down.llmsStatus).toBe("error");
    expect(down.safeErrorCode).toBe("timeout");

    const thrown = await readAiAccess(fetcherFor({ "/robots.txt": new Error("ECONNRESET at 10.0.0.1"), "/llms.txt": new Error("x") }), "https://clinic.example.com");
    expect(thrown.safeErrorCode).toBe("fetch_failed");
  });
});

describe("stored checks: permissions and client isolation", () => {
  let admin: Staff, manager: Staff, specA: Staff, specB: Staff, reviewer: Staff, readonly: Staff;
  let clientId = "";
  let websiteId = "";
  let otherClientId = "";

  beforeAll(async () => {
    [admin, manager, specA, specB, reviewer, readonly] = await Promise.all([
      staffByEmail("admin@example.invalid"),
      staffByEmail("manager@example.invalid"),
      staffByEmail("specialist-a@example.invalid"),
      staffByEmail("specialist-b@example.invalid"),
      staffByEmail("reviewer@example.invalid"),
      staffByEmail("readonly@example.invalid"),
    ]);
    const make = async (label: string, url: string | null) => {
      const slug = `ai-${label}-${randomBytes(3).toString("hex")}`;
      return (await adminPool.query<{ client_id: string; id: string }>(
        `with clinic as (
           insert into clients (slug, name, owner_user_id, channels, is_synthetic, created_by, updated_by)
           values ($1, $2, $3, array['website'], true, $3, $3)
           returning id
         )
         insert into websites (client_id, name, url, platform, environment, enquiry_key)
         select id, $2, $4, 'Next.js', 'production', $5 from clinic
         returning client_id, id`,
        [slug, `AI access ${label}`, admin.id, url, `${slug}-site`],
      )).rows[0]!;
    };
    const mine = await make("mine", "https://ai.example.com/home");
    const other = await make("other", null);
    clientId = mine.client_id;
    websiteId = mine.id;
    otherClientId = other.client_id;
    // specialist-a, reviewer and read-only belong to the first clinic; specialist-b only to the second.
    await adminPool.query(
      "insert into memberships (user_id, client_id, granted_by) values ($1, $4, $5), ($2, $4, $5), ($3, $4, $5), ($6, $7, $5)",
      [specA.id, reviewer.id, readonly.id, clientId, admin.id, specB.id, otherClientId],
    );
  });

  afterAll(async () => {
    const ids = [clientId, otherClientId].filter(Boolean);
    await adminPool.query("delete from seo_ai_access_checks where client_id = any($1::uuid[])", [ids]);
    await adminPool.query("delete from memberships where client_id = any($1::uuid[])", [ids]);
    await adminPool.query("delete from websites where client_id = any($1::uuid[])", [ids]);
    await adminPool.query("delete from clients where id = any($1::uuid[])", [ids]);
    await adminPool.end();
    await appPool.end();
  });

  const record = (who: Staff, opts: { userId?: string; commit?: boolean } = {}) =>
    asContext(staffCtx(who), (db) => recordAiAccessCheck(db, { clientId, websiteId, userId: opts.userId ?? who.id, reading: SAMPLE_READING }), { commit: opts.commit });

  it("lets admin, manager and a specialist member record a check", async () => {
    for (const who of [admin, manager, specA]) {
      await expect(record(who)).resolves.toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it("refuses reviewer and read-only members, a specialist from another client, and a spoofed actor", async () => {
    for (const who of [reviewer, readonly, specB]) {
      await expect(record(who), who.platform_role).rejects.toThrow(/row-level security/);
    }
    await expect(record(specA, { userId: admin.id })).rejects.toThrow(/row-level security/);
  });

  it("resolves the target from the stored website and refuses a mismatched client", async () => {
    const target = await asContext(staffCtx(specA), (db) => aiAccessTarget(db, { clientId, websiteId }));
    expect(target).toEqual({ clientId, websiteId, origin: "https://ai.example.com" });
    await expect(asContext(staffCtx(admin), (db) => aiAccessTarget(db, { clientId: otherClientId, websiteId }))).rejects.toThrow(/not available/);
    await expect(asContext(staffCtx(specB), (db) => aiAccessTarget(db, { clientId, websiteId }))).rejects.toThrow(/not available/);
  });

  it("shows history to members of the client only and keeps it append-only", async () => {
    await record(specA, { commit: true });
    for (const who of [admin, specA, reviewer, readonly]) {
      const rows = await asContext(staffCtx(who), (db) => listAiAccessChecks(db, websiteId));
      expect(rows, who.platform_role).toHaveLength(1);
      expect(rows[0]!.crawlers).toHaveLength(AI_CRAWLERS.length);
      expect(rows[0]!.checkedBy).toBe(specA.id);
    }
    const hidden = await asContext(staffCtx(specB), (db) => listAiAccessChecks(db, websiteId));
    expect(hidden).toEqual([]);

    await expect(asContext(staffCtx(admin), (db) => db.query("update seo_ai_access_checks set llms_status = 'missing' where website_id = $1", [websiteId]))).rejects.toThrow(/permission denied/);
    await expect(asContext(staffCtx(admin), (db) => db.query("delete from seo_ai_access_checks where website_id = $1", [websiteId]))).rejects.toThrow(/permission denied/);
  });

  it("rejects a non-https origin at the database", async () => {
    await expect(asContext(staffCtx(admin), (db) => recordAiAccessCheck(db, {
      clientId, websiteId, userId: admin.id, reading: { ...SAMPLE_READING, origin: "http://ai.example.com" },
    }))).rejects.toThrow(/check constraint/);
  });
});
