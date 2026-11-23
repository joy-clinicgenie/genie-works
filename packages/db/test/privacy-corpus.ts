/**
 * Fixtures for the privacy filter (Phase 2.3A). Every value is fictional: example.invalid hosts, invented numbers,
 * and tokens that are not real keys.
 *
 * `legacy*` is the filter as it was before this phase, frozen here as the reference for before-and-after results.
 */

const SENSITIVE_KEY = /email|e-mail|phone|tel|mobile|name|symptom|message|token|secret|password|patient|utm_|gclid|fbclid|msclkid/i;
const SENSITIVE_VALUE = /[@]|^\+?\d[\d\s()-]{6,}$|bearer\s/i;

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function legacySafeSearchQuery(value: string): string | null {
  const trimmed = value.trim().slice(0, 200);
  if (!trimmed || SENSITIVE_KEY.test(trimmed) || SENSITIVE_VALUE.test(trimmed)) return null;
  return trimmed;
}

export function legacySafeAnalyticsPath(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || /^(mailto:|tel:|sms:|whatsapp:)/i.test(trimmed)) return null;
  let path = trimmed;
  try {
    if (/^https?:\/\//i.test(trimmed)) path = new URL(trimmed).pathname;
  } catch {
    return null;
  }
  path = path.split("#")[0]?.split("?")[0] ?? "";
  if (!path.startsWith("/")) path = `/${path}`;
  const segments = path.split("/").filter(Boolean);
  if (segments.some((segment) => SENSITIVE_KEY.test(decodeURIComponentSafe(segment)) || SENSITIVE_VALUE.test(decodeURIComponentSafe(segment)))) return null;
  const cleaned = `/${segments.map((segment) => decodeURIComponentSafe(segment)).join("/")}`.replace(/\/{2,}/g, "/");
  return cleaned === "/" ? "/" : cleaned.replace(/\/$/, "");
}

/** Ordinary clinic search queries. All must be kept. */
export const LEGITIMATE_QUERIES = [
  "dental implants cost singapore",
  "symptoms of gum disease",
  "what are the symptoms of a root canal infection",
  "tmj symptoms treatment",
  "mobile dentist near me",
  "mobile dental clinic",
  "hotel near dental clinic",
  "clinic name and address",
  "name of the best dentist",
  "patient reviews dentist",
  "patient information leaflet scaling",
  "message therapy",
  "tel aviv dentist",
  "telephone number of dental clinic",
  "dentist phone number singapore",
  "email address for clinic appointments",
  "emergency dentist open now",
  "braces for adults 2024",
  "chas subsidy 2024 2025",
  "dr tan dental clinic",
  "teeth whitening price",
  "invisalign vs braces",
  "dentist 6 am",
  "10 best dental clinics",
  "root canal $1,200",
  "nric requirement for dental subsidy",
  "token of appreciation dentist gift",
  "secret to white teeth",
  "how to reset password for clinic portal",
  "dental clinic 123 orchard road",
];

/** Search queries that hold personal identifiers, credentials or a statement of personal details. All must be withheld. */
export const SENSITIVE_QUERIES = [
  // email
  "person@example.invalid",
  "contact jane.doe@example.invalid dentist",
  "JANE@EXAMPLE.INVALID",
  // phone numbers, in the shapes people write them
  "91234567",
  "dentist 9123 4567",
  "john tan 91234567",
  "+65 9123 4567 appointment",
  "(65) 6123-4567",
  "call 6123.4567",
  "+6591234567",
  "tel 91234567 clinic",
  "00 65 9123 4567",
  // national id and card numbers
  "S1234567D",
  "T0123456A dental",
  "4111 1111 1111 1111",
  "4111111111111111",
  // credentials
  "password=hunter2xyz",
  // Built from parts so no key-shaped literal sits in the repository for a secret scanner to trip on.
  `api_key: ${"AI" + "zaSyA"}-fictional-0123456789abcdef`,
  "bearer abcdef1234567890",
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig1234567890abc",
  // opaque identifiers
  "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  "a1b2c3d4e5f60718293a4b5c6d7e8f90",
  "ABCD1234efgh5678IJKL9012mnop",
  // statements of personal details
  "my name is john tan",
  "my phone number is eight one two",
  "my email is",
  "my nric is",
  "my password is",
];

export const LEGITIMATE_PATHS = [
  "/services/implants",
  "/for-patients",
  "/patient-reviews",
  "/patient-information",
  "/blog/phone-etiquette",
  "/contact",
  "/about-our-team-names",
  "/blog/2024/05/14/whitening",
  "/blog/20240514-whitening",
  "/blog/top-10-dental-clinics-2024",
  "/hotel-partnerships",
  "/mobile-dentistry",
  "/telehealth",
  "/blog/symptoms-of-gum-disease",
  "/forgot-password",
  "/login",
  "/messages",
  "/name-change-policy",
  "/best-teeth-whitening-singapore-complete-guide-for-adults",
  "https://clinic.example.invalid/services/whitening",
  "(not set)",
];

/** Paths that carry an identifier or credential in a segment. All must be withheld. */
export const SENSITIVE_PATHS = [
  "/patients/person@example.invalid",
  "/thank-you/person%40example.invalid",
  "/thank-you/person%2540example.invalid",
  "/appointment/confirm/3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  "/reset-password/a1b2c3d4e5f60718293a4b5c6d7e8f90",
  "/u/ABCD1234efgh5678IJKL9012mnop",
  "/call/91234567",
  "/call/+65-9123-4567",
  "/nric/S1234567D",
  "/verify/eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig1234567890abc",
  "mailto:person@example.invalid",
  "tel:+6591234567",
  "sms:+6591234567",
  "whatsapp://send?phone=6591234567",
  "javascript:alert(1)",
  "/booking/4111111111111111",
  "/files/token=abc123secret456",
];

/** A URL whose path is fine but whose query string carries personal data. The path is kept; the query string is removed. */
export const QUERY_STRING_PATHS: Array<{ input: string; path: string; personal: boolean }> = [
  { input: "https://clinic.example.invalid/contact?email=person@example.invalid", path: "/contact", personal: true },
  { input: "/thank-you?name=Jane&phone=91234567", path: "/thank-you", personal: true },
  { input: "/booking?session_id=abc123", path: "/booking", personal: true },
  { input: "/offers?gclid=fictional123", path: "/offers", personal: false },
  { input: "/search?q=dentist", path: "/search", personal: false },
  { input: "/clinics?hotel_id=12&utm_source=newsletter", path: "/clinics", personal: false },
  { input: "/contact?ref=ZGVudGlzdEBleGFtcGxlLmludmFsaWQxMjM0NTY3ODkw", path: "/contact", personal: true },
  { input: "/contact#section", path: "/contact", personal: false },
];
