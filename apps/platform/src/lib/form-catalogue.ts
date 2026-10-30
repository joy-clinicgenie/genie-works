export interface AcceptedField {
  label: string;
  type: string;
  required: boolean;
}

export interface KnownForm {
  key: string;
  name: string;
  pagePath: string;
  fields: AcceptedField[];
}

const APPOINTMENT_FIELDS: AcceptedField[] = [
  { label: "Name", type: "Text", required: true },
  { label: "Telephone", type: "Telephone", required: true },
  { label: "Email", type: "Email", required: false },
  { label: "Reason", type: "Text", required: true },
  { label: "Preferred date", type: "Date", required: false },
  { label: "Preferred time", type: "Text", required: false },
  { label: "Message", type: "Text", required: false },
];

const CONTACT_FIELDS: AcceptedField[] = [
  { label: "Name", type: "Text", required: true },
  { label: "Telephone", type: "Telephone", required: true },
  { label: "Email", type: "Email", required: false },
  { label: "Reason", type: "Text", required: true },
  { label: "Message", type: "Text", required: false },
];

export const KNOWN_FORMS: KnownForm[] = [
  { key: "appointment-enquiry", name: "Appointment enquiry", pagePath: "/request-appointment", fields: APPOINTMENT_FIELDS },
  { key: "contact", name: "Contact", pagePath: "/contact", fields: CONTACT_FIELDS },
];

export function knownForm(key: string): KnownForm | null {
  return KNOWN_FORMS.find((item) => item.key === key) ?? null;
}

export function acceptedFields(key: string): AcceptedField[] | null {
  return knownForm(key)?.fields ?? null;
}

/** Absolute page address when both the website URL and a path are known. */
export function formPageHref(url: string | null, pagePath: string | null): string | null {
  if (!url || !pagePath || !pagePath.startsWith("/")) return null;
  try {
    return new URL(pagePath, url).toString();
  } catch {
    return null;
  }
}
