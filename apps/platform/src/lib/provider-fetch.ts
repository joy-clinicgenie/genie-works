import { assertFixtureFetch, type FetchLike } from "@clinic-genie/db";

/** Provider calls stay on this machine while fixture mode is on, and each call stops after 20 seconds. */
export function providerFetch(): FetchLike {
  return async (url, init) => {
    assertFixtureFetch(url);
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
    return {
      status: response.status,
      headers: response.headers,
      json: () => response.json(),
      text: () => response.text(),
    };
  };
}
