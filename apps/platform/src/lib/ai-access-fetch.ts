import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { AiAccessFetchError, assertFixtureFetch, isNonPublicHostName, type TextFetcher } from "@clinic-genie/db";

/** D57 limits. The address always comes from the website registry, never from the request. */
export const AI_ACCESS_MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 10_000;

/** True for loopback, private, link-local, CGNAT, multicast, reserved and unique-local addresses. */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a, b] = address.split(".").map(Number) as [number, number];
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19));
  }
  if (version === 6) {
    const v = address.toLowerCase();
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]!);
    return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || /^fe[89ab]/.test(v) || v.startsWith("ff");
  }
  return true;
}

/** Same site: identical host, or the same host with or without a leading `www.`. */
export function sameSite(a: string, b: string): boolean {
  const strip = (host: string) => host.toLowerCase().replace(/^www\./, "");
  return strip(a) === strip(b);
}

type Resolver = (host: string) => Promise<string[]>;
const resolveAll: Resolver = async (host) => (await lookup(host, { all: true, verbatim: true })).map((entry) => entry.address);

async function assertPublicTarget(url: URL, siteHost: string, resolver: Resolver): Promise<void> {
  if (url.protocol !== "https:") throw new AiAccessFetchError("refused_scheme");
  if (url.username || url.password) throw new AiAccessFetchError("refused_host");
  if (isNonPublicHostName(url.hostname) || !sameSite(url.hostname, siteHost)) throw new AiAccessFetchError("refused_host");
  let addresses: string[];
  try {
    addresses = await resolver(url.hostname);
  } catch {
    throw new AiAccessFetchError("dns_failed");
  }
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) throw new AiAccessFetchError("refused_address");
}

async function readCapped(response: Response): Promise<{ body: string; bytes: number }> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > AI_ACCESS_MAX_BYTES) throw new AiAccessFetchError("too_large");
  if (!response.body) return { body: "", bytes: 0 };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > AI_ACCESS_MAX_BYTES) {
      await reader.cancel();
      throw new AiAccessFetchError("too_large");
    }
    chunks.push(value);
  }
  return { body: Buffer.concat(chunks).toString("utf8"), bytes };
}

/**
 * Reads one public text file. Each hop is re-checked: https, a public host name on the same site,
 * and public DNS answers. Redirects are followed manually, at most three.
 */
export function aiAccessFetcher(opts: { fetch?: typeof fetch; resolve?: Resolver } = {}): TextFetcher {
  const doFetch = opts.fetch ?? fetch;
  const resolver = opts.resolve ?? resolveAll;
  return async (start) => {
    let url = new URL(start);
    const siteHost = url.hostname;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      assertFixtureFetch(url.toString());
      await assertPublicTarget(url, siteHost, resolver);
      let response: Response;
      try {
        response = await doFetch(url, {
          method: "GET",
          redirect: "manual",
          headers: { "user-agent": "GenieWorks-AIAccessCheck/1.0", accept: "text/plain, text/markdown;q=0.9, */*;q=0.1" },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (err) {
        const name = (err as { name?: string })?.name;
        throw new AiAccessFetchError(name === "TimeoutError" || name === "AbortError" ? "timeout" : "network");
      }
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new AiAccessFetchError("bad_redirect");
        url = new URL(location, url);
        continue;
      }
      const { body, bytes } = await readCapped(response);
      return { status: response.status, contentType: response.headers.get("content-type"), body, bytes };
    }
    throw new AiAccessFetchError("too_many_redirects");
  };
}
