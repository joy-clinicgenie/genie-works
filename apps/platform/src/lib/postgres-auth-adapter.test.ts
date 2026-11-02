import { describe, expect, it, vi } from "vitest";
import { postgresAuthAdapter } from "./postgres-auth-adapter";

describe("Postgres Auth.js adapter", () => {
  it("loads a database session and user in one adapter query", async () => {
    const expires = new Date("2026-11-02T00:00:00.000Z");
    const client = {
      query: vi.fn(async () => ({
        rows: [{
          session_id: 2,
          session_token: "token",
          session_user_id: 7,
          session_expires: expires,
          user_id: 7,
          user_name: "Staff member",
          user_email: "staff@example.invalid",
          user_email_verified: null,
          user_image: null,
        }],
        rowCount: 1,
      })),
    };
    const adapter = postgresAuthAdapter(client as never);

    await expect(adapter.getSessionAndUser?.("token")).resolves.toEqual({
      session: { sessionToken: "token", userId: "7", expires },
      user: {
        id: "7",
        name: "Staff member",
        email: "staff@example.invalid",
        emailVerified: null,
        image: null,
      },
    });
    expect(client.query).toHaveBeenCalledOnce();
  });

  it("returns null when the token has no joined user", async () => {
    const client = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) };
    const adapter = postgresAuthAdapter(client as never);

    await expect(adapter.getSessionAndUser?.("missing")).resolves.toBeNull();
    expect(client.query).toHaveBeenCalledOnce();
  });
});
