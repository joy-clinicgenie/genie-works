import type { AccessProfile } from "@clinic-genie/db";
import { formName, listDiscoveredForms } from "@/lib/form-submissions";

/**
 * The forms Genie Works can read. Each is reported from the rows its website already holds in the
 * clinic website enquiry database. Nothing is copied here. Wix forms are no longer read (D61).
 */
export interface ConnectedForm {
  source: "database";
  clientSlug: string;
  clientName: string;
  websiteKey: string | null;
  formKey: string;
  displayName: string;
  platform: string;
}

export async function listConnectedForms(_access: AccessProfile, scope: string[] | null): Promise<ConnectedForm[]> {
  const database = await listDiscoveredForms(scope);
  return database
    .map((row): ConnectedForm => ({
      source: "database",
      clientSlug: row.clinicId,
      clientName: row.clinicId,
      websiteKey: row.websiteKey,
      formKey: row.formKey,
      displayName: formName(row.formKey),
      platform: "Website database",
    }))
    .sort((a, b) => a.clientName.localeCompare(b.clientName) || a.displayName.localeCompare(b.displayName));
}

/** Form filter options, taken from the connected forms rather than a fixed list. */
export function connectedFormOptions(forms: ConnectedForm[], clinic?: string): Array<{ value: string; label: string }> {
  const options = new Map<string, string>();
  for (const form of forms) {
    if (clinic && form.clientSlug !== clinic) continue;
    if (!options.has(form.formKey)) options.set(form.formKey, formName(form.formKey));
  }
  return [...options].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
}
