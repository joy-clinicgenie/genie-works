/**
 * Local mock of the Wix Forms API, for measuring the enquiry pages without contacting a Wix account.
 *
 * It binds to 127.0.0.1 only. The application reaches it through FORMS_WIX_BASE_URL, which
 * resolveWixApiBaseUrl refuses unless the host is local and the environment is not hosted. Every
 * submission it returns is synthetic and labelled; nothing here is a real person or a real enquiry.
 *
 * Payload shapes match apps/platform/src/lib/wix-form-map.ts: a submission is
 * `{ id, formId, namespace, createdDate, submissions: {...answers} }`, and a list carries
 * `pagingMetadata.cursors.next`.
 */
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";

export const WIX_MOCK_SCENARIOS = [
  { id: "normal", description: "One page of submissions, answered immediately." },
  { id: "slow", description: "A normal response delayed by delayMs, to measure a slow provider." },
  { id: "timeout", description: "No response at all, so the caller's 15 second timeout decides." },
  { id: "provider-error", description: "HTTP 500 from the submissions query." },
  { id: "multi-page", description: "Several cursor pages, so sequential paging is measured." },
  { id: "expired-auth", description: "HTTP 401 invalid_grant on the token call." },
  { id: "zero-submissions", description: "A successful response with a genuinely empty list." },
] as const;

export type WixMockScenario = (typeof WIX_MOCK_SCENARIOS)[number]["id"];

export function isWixMockScenario(value: string | undefined): value is WixMockScenario {
  return WIX_MOCK_SCENARIOS.some((item) => item.id === value);
}

export interface WixMockCall {
  method: string;
  path: string;
  status: number;
  durationMs: number;
  page?: number;
}

export interface WixMockOptions {
  scenario: WixMockScenario;
  /** The form the fixture binds to. Submissions are returned for this form only. */
  formId: string;
  namespace?: string;
  /** Submissions per page. The real client asks for a page limit; this mock decides what it returns. */
  pageSize?: number;
  /** Pages for the multi-page scenario. The caller stops at its own MAX_PAGES. */
  pages?: number;
  delayMs?: number;
  /** How long the timeout scenario holds a socket before destroying it. */
  abandonAfterMs?: number;
  port?: number;
}

export interface WixMockHandle {
  url: string;
  scenario: () => WixMockScenario;
  /** Switches scenario without restarting, so one mock serves a whole baseline run. */
  setScenario: (next: WixMockScenario) => void;
  /** Forgets recorded calls, so each measurement reports only its own provider traffic. */
  reset: () => void;
  calls: WixMockCall[];
  /** Totals per path, so a baseline can report how many provider calls a page made. */
  summary: () => { calls: number; byPath: Record<string, number>; totalDurationMs: number };
  stop: () => Promise<void>;
}

function submission(formId: string, namespace: string, index: number, anchorIso: string): Record<string, unknown> {
  const created = new Date(Date.parse(anchorIso) - index * 3_600_000).toISOString();
  return {
    id: `f0000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    formId,
    namespace,
    createdDate: created,
    submissions: {
      first_name_0000: `Mock`,
      last_name_0001: `Person ${index}`,
      email_0002: `mock.person${index}@example.invalid`,
      phone_0003: "00000000",
      dropdown_0004: index % 2 === 0 ? "General enquiry" : "Appointment request",
      long_answer_0005: "Synthetic mock submission. Not a real enquiry.",
    },
  };
}

const FORM_SCHEMA = (formId: string) => ({
  form: {
    id: formId,
    fields: [
      { target: "first_name_0000", label: "First name" },
      { target: "last_name_0001", label: "Last name" },
      { target: "email_0002", label: "Email" },
      { target: "phone_0003", label: "Telephone" },
      { target: "dropdown_0004", label: "Reason" },
      { target: "long_answer_0005", label: "Message" },
    ],
  },
});

/** Starts the mock on 127.0.0.1. Returns the base URL to put in FORMS_WIX_BASE_URL. */
export async function startWixMock(options: WixMockOptions): Promise<WixMockHandle> {
  let scenario = options.scenario;
  const namespace = options.namespace ?? "wix.form_app.form";
  const pageSize = options.pageSize ?? 25;
  const pages = options.pages ?? 3;
  const delayMs = options.delayMs ?? 1_500;
  // Longer than the caller's own 15 second timeout, so the abort is always the client's decision.
  const abandonAfterMs = options.abandonAfterMs ?? 18_000;
  const anchorIso = new Date().toISOString();
  const calls: WixMockCall[] = [];
  const held: Array<ReturnType<typeof setTimeout>> = [];

  const server: Server = createServer((request, response) => {
    const started = performance.now();
    const path = (request.url ?? "").split("?")[0] ?? "";
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const send = (status: number, payload: unknown, page?: number) => {
        const finish = () => {
          response.writeHead(status, { "content-type": "application/json" });
          response.end(JSON.stringify(payload));
          calls.push({ method: request.method ?? "GET", path, status, durationMs: Math.round(performance.now() - started), page });
        };
        if (scenario === "slow") held.push(setTimeout(finish, delayMs));
        else finish();
      };

      if (path === "/__mock/scenario") {
        try {
          const parsed = JSON.parse(body || "{}") as { scenario?: string };
          if (!isWixMockScenario(parsed.scenario)) throw new Error("unknown scenario");
          scenario = parsed.scenario;
          calls.length = 0;
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ scenario }));
        } catch {
          response.writeHead(400, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: "unknown_scenario" }));
        }
        return;
      }

      if (scenario === "timeout" && !path.startsWith("/__mock/")) {
        // Accept the request and never answer, so the caller's own 15 second AbortSignal decides.
        calls.push({ method: request.method ?? "GET", path, status: 0, durationMs: 0 });
        // Then destroy the socket. Without this the connection stays half-open and the client's
        // keep-alive pool can hand it to the next scenario, which then hangs for reasons that have
        // nothing to do with that scenario.
        held.push(setTimeout(() => request.socket.destroy(), abandonAfterMs));
        return;
      }

      if (path === "/oauth2/token") {
        if (scenario === "expired-auth") {
          send(401, { error: "invalid_grant", error_description: "Mock expired authentication." });
          return;
        }
        send(200, { access_token: "mock-access-token", expires_in: 300 });
        return;
      }

      if (path === "/form-submission-service/v4/submissions/namespace/query") {
        if (scenario === "expired-auth") {
          // The caller caches a token for minutes, so an expired credential usually surfaces here
          // rather than on the token call. Both are refused so the scenario holds either way.
          send(401, { error: "invalid_grant", error_description: "Mock expired authentication." });
          return;
        }
        if (scenario === "provider-error") {
          send(500, { error: "mock_provider_error" });
          return;
        }
        if (scenario === "zero-submissions") {
          send(200, { submissions: [], pagingMetadata: { hasNext: false, cursors: {} } });
          return;
        }
        let cursor: string | null = null;
        try {
          const parsed = JSON.parse(body || "{}") as { query?: { cursorPaging?: { cursor?: string } } };
          cursor = parsed.query?.cursorPaging?.cursor ?? null;
        } catch {
          cursor = null;
        }
        const pageNumber = cursor ? Number(cursor.replace("mock-page-", "")) : 1;
        const totalPages = scenario === "multi-page" ? pages : 1;
        const offset = (pageNumber - 1) * pageSize;
        const rows = Array.from({ length: pageSize }, (_, i) => submission(options.formId, namespace, offset + i + 1, anchorIso));
        const hasNext = pageNumber < totalPages;
        send(200, {
          submissions: rows,
          pagingMetadata: { hasNext, cursors: hasNext ? { next: `mock-page-${pageNumber + 1}` } : {} },
        }, pageNumber);
        return;
      }

      if (path.startsWith("/form-schema-service/v4/forms/")) {
        send(200, FORM_SCHEMA(options.formId));
        return;
      }

      if (path.startsWith("/form-submission-service/v4/submissions/")) {
        const id = path.split("/").pop() ?? "";
        send(200, { submission: { ...submission(options.formId, namespace, 1, anchorIso), id } });
        return;
      }

      send(404, { error: "mock_not_found" });
    });
  });

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${address.port}`;

  return {
    url,
    scenario: () => scenario,
    setScenario: (next) => {
      scenario = next;
    },
    reset: () => {
      calls.length = 0;
    },
    calls,
    summary: () => {
      const byPath: Record<string, number> = {};
      for (const call of calls) byPath[call.path] = (byPath[call.path] ?? 0) + 1;
      return { calls: calls.length, byPath, totalDurationMs: calls.reduce((sum, call) => sum + call.durationMs, 0) };
    },
    stop: async () => {
      for (const handle of held) clearTimeout(handle);
      await new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      });
    },
  };
}
