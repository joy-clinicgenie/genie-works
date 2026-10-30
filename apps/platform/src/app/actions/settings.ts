"use server";

import { revalidatePath } from "next/cache";
import { updateOwnName } from "@clinic-genie/db";
import { requireAccess } from "@/lib/session";
import { staffTx } from "@/lib/db";
import { str, toActionError, type ActionState } from "@/lib/actions";

export async function updateOwnNameAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const access = await requireAccess();
  const name = str(form, "displayName");
  if (!name) return { ok: false, error: "Enter your name.", field: "displayName" };
  if (name.length > 120) return { ok: false, error: "Name must be 120 characters or fewer.", field: "displayName" };
  try {
    await staffTx(access, (db) => updateOwnName(db, access.user.id, name));
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Name saved." };
}
