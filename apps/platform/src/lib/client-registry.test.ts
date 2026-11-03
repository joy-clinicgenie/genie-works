import { describe, expect, it } from "vitest";
import type { Queryable, ShellClient } from "@clinic-genie/db";
import { shellClients, type ShellClientStore } from "@/lib/client-registry";

const CLIENTS: ShellClient[] = [
  { id: "c1", name: "Clinic One", slug: "one", reference_number: "CG-001", short_code: "ONE", public_name: null, legal_name: null, specialty: null },
];

/** Stands in for a checked-out transaction and records how many statements it was asked to run. */
function fakeDb(rows: ShellClient[] = CLIENTS) {
  let calls = 0;
  const db = {
    query: async () => {
      calls += 1;
      return { rows };
    },
  } as unknown as Queryable;
  return { db, calls: () => calls };
}

function store(): ShellClientStore {
  return { pending: null };
}

describe("request-scoped client registry", () => {
  it("reads once when the layout and the page share a request store", async () => {
    const shared = store();
    const layout = fakeDb();
    const page = fakeDb();
    const fromLayout = await shellClients(layout.db, shared);
    const fromPage = await shellClients(page.db, shared);
    expect(fromLayout).toEqual(CLIENTS);
    expect(fromPage).toEqual(CLIENTS);
    expect(layout.calls()).toBe(1);
    // The second caller reuses the first result rather than spending a statement in its own transaction.
    expect(page.calls()).toBe(0);
  });

  it("deduplicates callers that start before the first read resolves", async () => {
    const shared = store();
    const first = fakeDb();
    const second = fakeDb();
    const [a, b] = await Promise.all([shellClients(first.db, shared), shellClients(second.db, shared)]);
    expect(a).toBe(b);
    expect(first.calls()).toBe(1);
    expect(second.calls()).toBe(0);
  });

  it("keeps separate requests separate, so nothing is shared between users", async () => {
    const mine = fakeDb(CLIENTS);
    const theirs = fakeDb([]);
    expect(await shellClients(mine.db, store())).toEqual(CLIENTS);
    expect(await shellClients(theirs.db, store())).toEqual([]);
    expect(mine.calls()).toBe(1);
    expect(theirs.calls()).toBe(1);
  });

  it("does not cache a failure, so a later caller in the same request can still read", async () => {
    const shared = store();
    let attempts = 0;
    const failing = {
      query: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("Database unavailable");
        return { rows: CLIENTS };
      },
    } as unknown as Queryable;
    await expect(shellClients(failing, shared)).rejects.toThrow("Database unavailable");
    expect(await shellClients(failing, shared)).toEqual(CLIENTS);
    expect(attempts).toBe(2);
  });
});
