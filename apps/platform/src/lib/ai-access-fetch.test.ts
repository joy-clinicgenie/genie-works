import { describe, expect, it } from "vitest";
import { AI_ACCESS_MAX_BYTES, aiAccessFetcher, isPrivateAddress, sameSite } from "./ai-access-fetch";

const publicDns = async () => ["93.184.216.34"];

function fakeFetch(routes: Record<string, () => Response>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    const route = routes[url];
    if (!route) throw new Error(`unexpected ${url}`);
    return route();
  }) as typeof fetch;
}

const redirect = (to: string) => () => new Response(null, { status: 301, headers: { location: to } });

describe("AI access fetch guard", () => {
  it("classifies private and public addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["93.184.216.34", "8.8.8.8", "2606:4700::1111"]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
    expect(sameSite("clinic.example.com", "www.clinic.example.com")).toBe(true);
    expect(sameSite("clinic.example.com", "evil.example.net")).toBe(false);
  });

  it("follows a same-site redirect and returns the text", async () => {
    const read = aiAccessFetcher({
      resolve: publicDns,
      fetch: fakeFetch({
        "https://clinic.example.com/robots.txt": redirect("https://www.clinic.example.com/robots.txt"),
        "https://www.clinic.example.com/robots.txt": () => new Response("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain" } }),
      }),
    });
    const result = await read("https://clinic.example.com/robots.txt");
    expect(result.status).toBe(200);
    expect(result.body).toContain("User-agent");
    expect(result.contentType).toBe("text/plain");
  });

  it("refuses a redirect to another site, to http, or to a private address", async () => {
    const offSite = aiAccessFetcher({ resolve: publicDns, fetch: fakeFetch({ "https://clinic.example.com/llms.txt": redirect("https://evil.example.net/llms.txt") }) });
    await expect(offSite("https://clinic.example.com/llms.txt")).rejects.toMatchObject({ code: "refused_host" });

    const plain = aiAccessFetcher({ resolve: publicDns, fetch: fakeFetch({ "https://clinic.example.com/llms.txt": redirect("http://clinic.example.com/llms.txt") }) });
    await expect(plain("https://clinic.example.com/llms.txt")).rejects.toMatchObject({ code: "refused_scheme" });

    const rebinding = aiAccessFetcher({ resolve: async () => ["10.0.0.5"], fetch: fakeFetch({}) });
    await expect(rebinding("https://clinic.example.com/robots.txt")).rejects.toMatchObject({ code: "refused_address" });
  });

  it("stops after three redirects and at the size cap", async () => {
    const loop = aiAccessFetcher({ resolve: publicDns, fetch: fakeFetch({ "https://clinic.example.com/robots.txt": redirect("/robots.txt") }) });
    await expect(loop("https://clinic.example.com/robots.txt")).rejects.toMatchObject({ code: "too_many_redirects" });

    const big = "x".repeat(AI_ACCESS_MAX_BYTES + 1);
    const large = aiAccessFetcher({ resolve: publicDns, fetch: fakeFetch({ "https://clinic.example.com/llms.txt": () => new Response(big) }) });
    await expect(large("https://clinic.example.com/llms.txt")).rejects.toMatchObject({ code: "too_large" });
  });

  it("reports a network failure with a safe code", async () => {
    const broken = aiAccessFetcher({ resolve: publicDns, fetch: (async () => { throw new TypeError("fetch failed: 10.0.0.1"); }) as typeof fetch });
    await expect(broken("https://clinic.example.com/robots.txt")).rejects.toMatchObject({ code: "network" });
  });
});
