import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { PLATFORM_DB, PROD_ORIGIN, DEV_ORIGIN, adminUrl } from "./targets.ts";

export { PROD_ORIGIN, DEV_ORIGIN };

export interface BatchContext {
  adminId: string;
  meridianId: string;
  clinicGenieId: string;
  meridianWebsiteId: string;
}

export function loadContext(): BatchContext {
  return JSON.parse(readFileSync("e2e-batch08/.run/context.json", "utf8")) as BatchContext;
}

function platformAdminUrl(): string {
  const url = adminUrl(PLATFORM_DB);
  const parsed = new URL(url);
  if (parsed.hostname !== "127.0.0.1" || parsed.pathname !== `/${PLATFORM_DB}`) {
    throw new Error("Refusing session setup outside the isolated batch database.");
  }
  return url;
}

export async function insertSession(email: string): Promise<string> {
  const token = randomBytes(24).toString("hex");
  const client = new pg.Client({ connectionString: platformAdminUrl() });
  await client.connect();
  try {
    const staff = await client.query("select 1 from staff_users where email = $1 and active", [email]);
    if ((staff.rowCount ?? 0) === 0) throw new Error("No active staff record for the requested session.");
    const existing = await client.query<{ id: number }>("select id from users where email = $1 order by id limit 1", [email]);
    const userId = existing.rows[0]?.id ?? (await client.query<{ id: number }>("insert into users (name, email) values ($1, $2) returning id", [email, email])).rows[0]?.id;
    if (!userId) throw new Error("Session user was not created.");
    await client.query("insert into sessions (\"userId\", expires, \"sessionToken\") values ($1, now() + interval '12 hours', $2)", [userId, token]);
  } finally {
    await client.end();
  }
  return token;
}

export async function sessionCount(email: string): Promise<number> {
  const client = new pg.Client({ connectionString: platformAdminUrl() });
  await client.connect();
  try {
    const result = await client.query<{ count: number }>(
      "select count(*)::int as count from sessions s join users u on u.id = s.\"userId\" where u.email = $1",
      [email],
    );
    return result.rows[0]?.count ?? 0;
  } finally {
    await client.end();
  }
}

export async function reportStatus(id: string): Promise<string | null> {
  const client = new pg.Client({ connectionString: platformAdminUrl() });
  await client.connect();
  try {
    const result = await client.query<{ status: string }>("select status from saved_reports where id = $1", [id]);
    return result.rows[0]?.status ?? null;
  } finally {
    await client.end();
  }
}

export async function issueBlogReadToken(websiteId: string, clientId: string, adminId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const client = new pg.Client({ connectionString: platformAdminUrl() });
  await client.connect();
  try {
    await client.query("update seo_site_tokens set revoked_at = now() where website_id = $1 and revoked_at is null", [websiteId]);
    await client.query(
      "insert into seo_site_tokens (client_id, website_id, token_hash, created_by) values ($1, $2, $3, $4)",
      [clientId, websiteId, tokenHash, adminId],
    );
  } finally {
    await client.end();
  }
  return token;
}

export async function openAs(browser: Browser, email: string): Promise<{ page: Page; context: BrowserContext; close: () => Promise<void> }> {
  const token = await insertSession(email);
  const context = await browser.newContext();
  const cookie = { name: "authjs.session-token", value: token, httpOnly: true, sameSite: "Lax" as const };
  await context.addCookies([
    { ...cookie, url: PROD_ORIGIN },
    { ...cookie, url: DEV_ORIGIN },
  ]);
  const page = await context.newPage();
  return { page, context, close: () => context.close() };
}

export async function focusedStyle(page: Page): Promise<{ name: string; outlineStyle: string; outlineWidth: string; outlineColor: string; boxShadow: string }> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    const style = el ? getComputedStyle(el) : null;
    return {
      name: el?.getAttribute("aria-label") || el?.textContent?.trim().slice(0, 60) || el?.id || "",
      outlineStyle: style?.outlineStyle ?? "",
      outlineWidth: style?.outlineWidth ?? "",
      outlineColor: style?.outlineColor ?? "",
      boxShadow: style?.boxShadow ?? "",
    };
  });
}

export async function controlFindings(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const findings: string[] = [];
    const h1 = document.querySelectorAll("h1");
    if (h1.length !== 1) findings.push(`heading: ${h1.length} h1 elements`);
    document.querySelectorAll("input, select, textarea").forEach((node) => {
      const el = node as HTMLInputElement;
      if (el.type === "hidden" || el.disabled) return;
      const labelled = Boolean(
        (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`))
        || el.getAttribute("aria-label")
        || el.getAttribute("aria-labelledby")
        || el.closest("label"),
      );
      if (!labelled) findings.push(`unlabelled ${el.tagName.toLowerCase()} ${el.getAttribute("name") ?? el.id}`);
    });
    document.querySelectorAll("button, a").forEach((node) => {
      const el = node as HTMLElement;
      if (el.getAttribute("aria-hidden") === "true") return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const name = el.getAttribute("aria-label") || el.textContent?.trim();
      if (!name) findings.push(`unnamed ${el.tagName.toLowerCase()}`);
    });
    document.querySelectorAll("img").forEach((node) => {
      if (!node.hasAttribute("alt")) findings.push("image missing alt");
    });
    return findings;
  });
}

export async function headerLayout(page: Page): Promise<{ pageOverflow: number; headerOverflow: number; overlaps: string[] }> {
  return page.evaluate(() => {
    const header = document.querySelector("header");
    const pageOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    const headerOverflow = header ? header.scrollWidth - header.clientWidth : 0;
    const boxes = [...(header?.querySelectorAll("a, button, input") ?? [])].flatMap((node) => {
      const el = node as HTMLElement;
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return [];
      return [{ name: (el.getAttribute("aria-label") || el.textContent || el.id || "").trim().slice(0, 40), rect }];
    });
    const overlaps: string[] = [];
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        const x = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
        const y = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
        if (x > 4 && y > 4) overlaps.push(`${a.name} / ${b.name}`);
      }
    }
    return { pageOverflow, headerOverflow, overlaps };
  });
}
