import { describe, expect, it, vi } from "vitest";
import { APP_POOL_OPTIONS, DbUnavailableError, withContext } from "../src/client";

describe("database context transaction setup", () => {
  it("keeps warm connections available without creating an unbounded pool", () => {
    expect(APP_POOL_OPTIONS).toMatchObject({
      max: 8,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 60_000,
      allowExitOnIdle: true,
    });
  });

  it("starts the transaction and applies the staff RLS context in one query", async () => {
    const calls: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      query: vi.fn(async (text: string, values?: unknown[]) => {
        calls.push({ text, values });
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client) };

    await withContext(
      { kind: "staff", userId: "staff-id", role: "specialist" },
      (db) => db.query("select 1"),
      pool as never,
    );

    expect(calls).toHaveLength(3);
    expect(calls[0]?.text).toContain("begin;");
    expect(calls[0]?.text).toContain("set_config('app.context', 'staff', true)");
    expect(calls[0]?.text).toContain("set_config('app.user_id', 'staff-id', true)");
    expect(calls[0]?.text).toContain("set_config('app.platform_role', 'specialist', true)");
    expect(calls[1]).toEqual({ text: "select 1", values: undefined });
    expect(calls[2]?.text).toBe("commit");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("rolls back and releases the checked-out connection after a failure", async () => {
    const calls: string[] = [];
    const client = {
      query: vi.fn(async (text: string) => {
        calls.push(text);
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client) };

    await expect(withContext(
      { kind: "service" },
      async () => {
        throw new Error("failed");
      },
      pool as never,
    )).rejects.toThrow("failed");

    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("begin;");
    expect(calls[1]).toBe("rollback");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("maps connection acquisition failures without attempting a transaction", async () => {
    const pool = { connect: vi.fn(async () => { throw new Error("offline"); }) };

    await expect(withContext(
      { kind: "service" },
      (db) => db.query("select 1"),
      pool as never,
    )).rejects.toBeInstanceOf(DbUnavailableError);
    expect(pool.connect).toHaveBeenCalledOnce();
  });
});
