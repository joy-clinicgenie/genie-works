import { listWixEnquiryBindings, type AccessProfile } from "@clinic-genie/db";
import { staffTx } from "@/lib/db";
import { formName, listDiscoveredForms } from "@/lib/form-submissions";
import { probeWixForm, type WixFormState } from "@/lib/wix-enquiries";

/**
 * The forms Genie Works can actually read, from every connected source.
 * Wix forms are read live through the Forms API; a website-database form is
 * reported from the rows that website already holds. Nothing is copied here.
 */
export type ConnectedFormSource = "wix" | "database";

/** Whether the bound Wix site is the website this record describes. */
export type BoundSiteMatch = "match" | "different" | "unknown";

/** Compares a website's recorded address with the site the bound instance really is.
 *  Host and path are both compared, because several Wix Studio builds share one host. */
export function compareBoundSite(recordUrl: string | null, boundUrl: string | null): BoundSiteMatch {
  const normalise = (value: string | null): string | null => {
    if (!value) return null;
    try {
      const parsed = new URL(value);
      const host = parsed.host.replace(/^www\./i, "").toLowerCase();
      const path = parsed.pathname.replace(/\/+$/, "").toLowerCase();
      return `${host}${path}`;
    } catch {
      return null;
    }
  };
  const record = normalise(recordUrl);
  const bound = normalise(boundUrl);
  if (!record || !bound) return "unknown";
  return record === bound ? "match" : "different";
}

export interface ConnectedForm {
  source: ConnectedFormSource;
  clientSlug: string;
  clientName: string;
  websiteKey: string | null;
  websiteName: string | null;
  formKey: string;
  displayName: string;
  liveDomain: string | null;
  environment: string | null;
  boundSiteUrl: string | null;
  boundSiteName: string | null;
  boundSiteMatch: BoundSiteMatch;
  providerFormId: string | null;
  namespace: string | null;
  platform: string;
  state: WixFormState | "readable" | "empty";
  active: boolean | null;
  fields: string[];
  submissions: number | null;
  more: boolean;
  checkedAt: Date | null;
  countsInTotals: boolean;
}

const STATE_LABEL: Record<string, string> = {
  readable: "Readable",
  empty: "Readable, no submissions yet",
  missing: "Form not found on the site",
  unsupported: "Not supported by this connector",
  permission: "Could not be read",
  unconfigured: "Forms app not configured on this server",
  disabled_read: "Live reads are off in this environment",
};

const STATE_TONE: Record<string, "good" | "warn" | "bad" | "neutral"> = {
  readable: "good",
  empty: "neutral",
  missing: "bad",
  unsupported: "warn",
  permission: "bad",
  unconfigured: "warn",
  disabled_read: "neutral",
};

export const connectedFormStateLabel = (state: string): string => STATE_LABEL[state] ?? "Unknown";
export const connectedFormStateTone = (state: string) => STATE_TONE[state] ?? "neutral";

/** Why a form reads as unsupported, in words a member of staff can act on. */
export function connectedFormDetail(form: ConnectedForm): string | null {
  if (form.source === "database") return null;
  if (form.boundSiteMatch === "different") {
    return "This form is read from a different Wix site than the website recorded here. Submissions made on the recorded address are not in this form, so a readable result here is not a working connection for that website.";
  }
  switch (form.state) {
    case "unsupported":
      return "This site does not have the Wix Forms app. Forms built with the older Wix Forms & Payments app cannot be read through any Wix API.";
    case "missing":
      return "The connected form id is not among this site's Wix forms. It may have been deleted or rebuilt.";
    case "permission":
      return "Wix refused the read. The connection is unchanged and nothing was copied.";
    case "unconfigured":
      return "The forms app id and secret are not set on this server.";
    default:
      return null;
  }
}

export async function listConnectedForms(access: AccessProfile, scope: string[] | null): Promise<ConnectedForm[]> {
  const bindings = await staffTx(access, (db) => listWixEnquiryBindings(db, scope));
  const [wix, database] = await Promise.all([
    Promise.all(bindings.map(async (binding) => {
      const probe = await probeWixForm(binding);
      return {
        source: "wix" as const,
        clientSlug: binding.clientSlug,
        clientName: binding.clientName,
        websiteKey: binding.enquiryKey,
        websiteName: binding.websiteName,
        formKey: binding.formKey,
        displayName: probe.formName ?? formName(binding.formKey),
        liveDomain: binding.websiteUrl,
        environment: binding.environment,
        boundSiteUrl: probe.boundSiteUrl,
        boundSiteName: probe.boundSiteName,
        boundSiteMatch: compareBoundSite(binding.websiteUrl, probe.boundSiteUrl),
        providerFormId: binding.formId,
        namespace: binding.namespace,
        platform: "Wix Studio",
        state: probe.state,
        active: probe.active,
        fields: probe.fields,
        submissions: probe.submissions,
        more: probe.more,
        checkedAt: probe.checkedAt,
        countsInTotals: binding.countsInTotals,
      };
    })),
    listDiscoveredForms(scope),
  ]);
  const databaseForms: ConnectedForm[] = database.map((row) => ({
    source: "database",
    clientSlug: row.clinicId,
    clientName: row.clinicId,
    websiteKey: row.websiteKey,
    websiteName: null,
    formKey: row.formKey,
    displayName: formName(row.formKey),
    liveDomain: null,
    environment: null,
    boundSiteUrl: null,
    boundSiteName: null,
    boundSiteMatch: "unknown",
    providerFormId: null,
    namespace: null,
    platform: "Website database",
    state: "readable",
    active: null,
    fields: [],
    submissions: null,
    more: false,
    checkedAt: null,
    countsInTotals: true,
  }));
  return [...wix, ...databaseForms].sort((a, b) =>
    a.clientName.localeCompare(b.clientName) || a.displayName.localeCompare(b.displayName),
  );
}

/** Form filter options, taken from the connected sources rather than a fixed list. */
export function connectedFormOptions(forms: ConnectedForm[], clinic?: string): Array<{ value: string; label: string }> {
  const options = new Map<string, string>();
  for (const form of forms) {
    if (clinic && form.clientSlug !== clinic) continue;
    if (!options.has(form.formKey)) options.set(form.formKey, formName(form.formKey));
  }
  return [...options].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
}
