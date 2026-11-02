import { afterAll, describe, expect, it } from "vitest";
import { closePools, withContext } from "../src/client";
import { appPool, staffByEmail, staffCtx } from "./helpers";

describe("pooled transaction context isolation", () => {
  afterAll(async () => {
    await appPool.end();
    await closePools();
  });

  it("does not leak identity between concurrent staff transactions", async () => {
    const specialist = await staffByEmail("specialist-a@example.invalid");
    const reviewer = await staffByEmail("reviewer@example.invalid");

    const observations = await Promise.all(
      Array.from({ length: 12 }, async (_, index) => {
        const actor = index % 2 === 0 ? specialist : reviewer;
        return withContext(staffCtx(actor), async (db) => {
          const before = await db.query<{ user_id: string; role: string }>(
            `select current_setting('app.user_id', true) as user_id,
                    current_setting('app.platform_role', true) as role`,
          );
          await db.query("select pg_sleep(0.005)");
          const after = await db.query<{ user_id: string; role: string }>(
            `select current_setting('app.user_id', true) as user_id,
                    current_setting('app.platform_role', true) as role`,
          );
          return { actor, before: before.rows[0], after: after.rows[0] };
        }, appPool);
      }),
    );

    for (const observation of observations) {
      expect(observation.before).toEqual({
        user_id: observation.actor.id,
        role: observation.actor.platform_role,
      });
      expect(observation.after).toEqual(observation.before);
    }
  });
});
