import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertDeliveryOrigin, requestRevalidate, verifyPublicArticle, websitePreviewUrl } from "@/lib/blog-delivery";

const V1 = "11111111-1111-4111-8111-111111111111";
const V2 = "22222222-2222-4222-8222-222222222222";
const SECRET = "s".repeat(43);

/** A stand-in website: a revalidate endpoint, articles carrying a revision marker, and images. */
let served = V1;
let revalidated: string[][] = [];
let server: Server;
let origin = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://local");
    if (url.pathname === "/api/genie-works/revalidate") {
      if (req.headers.authorization !== `Bearer ${SECRET}`) { res.writeHead(401).end(); return; }
      let raw = "";
      req.on("data", (chunk) => { raw += chunk; });
      req.on("end", () => { revalidated.push(JSON.parse(raw).paths); res.writeHead(200, { "content-type": "application/json" }).end("{}"); });
      return;
    }
    if (url.pathname === "/genie-tips/live") {
      res.writeHead(200, { "content-type": "text/html" }).end(`<html><head><meta name="genie-works-revision" content="${served}"><meta name="genie-works-featured-image" content="/img/ok.png"></head></html>`);
      return;
    }
    if (url.pathname === "/genie-tips/broken-image") {
      res.writeHead(200, { "content-type": "text/html" }).end(`<meta name="genie-works-revision" content="${V1}"><meta name="genie-works-featured-image" content="/img/missing.png">`);
      return;
    }
    if (url.pathname === "/genie-tips/notion") { res.writeHead(200, { "content-type": "text/html" }).end("<h1>A Notion article</h1>"); return; }
    if (url.pathname === "/img/ok.png") { res.writeHead(200, { "content-type": "image/png" }).end(Buffer.from([0x89, 0x50])); return; }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe("blog delivery to the website (D86)", () => {
  it("asks the website to refresh with the publish secret, and reports a refused or missing website", async () => {
    revalidated = [];
    expect(await requestRevalidate(origin, SECRET, ["/genie-tips", "/genie-tips/live"])).toBeNull();
    expect(revalidated).toEqual([["/genie-tips", "/genie-tips/live"]]);
    expect(await requestRevalidate(origin, "wrong".repeat(9), ["/genie-tips"])).toBe("site_refused");
    expect(await requestRevalidate("http://127.0.0.1:9", SECRET, ["/genie-tips"])).toBe("site_unreachable");
  });

  it("verifies only the expected revision and a loadable featured image", async () => {
    served = V1;
    expect(await verifyPublicArticle(`${origin}/genie-tips/live`, V1, { expectImage: true })).toBeNull();
    expect(await verifyPublicArticle(`${origin}/genie-tips/live`, V2, { attempts: 2, delayMs: 10 })).toBe("different_revision");
    expect(await verifyPublicArticle(`${origin}/genie-tips/missing`, V1, { attempts: 2, delayMs: 10 })).toBe("not_found_yet");
    expect(await verifyPublicArticle(`${origin}/genie-tips/notion`, V1, { attempts: 1 })).toBe("different_article");
    expect(await verifyPublicArticle(`${origin}/genie-tips/broken-image`, V1, { attempts: 1 })).toBe("image_unavailable");
  });

  it("picks up a revision the website starts serving during the retry window", async () => {
    served = V1;
    setTimeout(() => { served = V2; }, 30);
    expect(await verifyPublicArticle(`${origin}/genie-tips/live`, V2, { attempts: 5, delayMs: 25 })).toBeNull();
  });

  it("calls https websites only, and a local website only from a local server", () => {
    expect(assertDeliveryOrigin("https://www.example.invalid/x", {})).toBe("https://www.example.invalid");
    expect(assertDeliveryOrigin("http://localhost:3000", {})).toBe("http://localhost:3000");
    expect(() => assertDeliveryOrigin("http://www.example.invalid", {})).toThrow(/https/);
    expect(() => assertDeliveryOrigin("http://localhost:3000", { VERCEL_ENV: "preview" })).toThrow();
    expect(() => assertDeliveryOrigin("https://localhost:3000", { NODE_ENV: "production" })).toThrow(/local website/);
    expect(() => assertDeliveryOrigin("ftp://www.example.invalid", {})).toThrow(/https/);
    expect(websitePreviewUrl("https://www.example.invalid", "abc_DEF-1")).toBe("https://www.example.invalid/api/genie-works/preview?token=abc_DEF-1");
  });
});
