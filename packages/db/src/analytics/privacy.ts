/**
 * Analytics privacy protection (Phase 2.3A).
 *
 * The earlier filter withheld any text that CONTAINED a word such as "patient", "symptom", "phone",
 * "mobile" or "tel" (which also matched "hotel"), so it discarded ordinary clinic keywords and pages, and
 * it was applied only to Search Console. GA4 landing pages and page paths were stored without any check.
 *
 * This replacement protects against IDENTIFIERS and CREDENTIALS, not vocabulary. A word is never sensitive
 * by itself: "patient reviews dentist" is a keyword. A person's email address, phone number, national ID,
 * card number, access token or opaque record id is sensitive wherever it appears.
 *
 * Three contexts have different risks and different rules:
 *
 *   search query    Free text typed by a person. Checked for identifiers, credentials and self-disclosure
 *                   ("my phone number is"). Never rewritten, only kept or withheld.
 *   URL path        Structure chosen by the website. Checked segment by segment. The query string and
 *                   fragment are always removed; the parameters are classified by KEY NAME (whole words)
 *                   and by VALUE SHAPE, and only the category is counted, never the value.
 *   dimension       A short category (channel, device, country). Kept unless it looks like an identifier.
 *
 * Nothing here records a sensitive value. A decision carries a fixed reason label, and the tally carries
 * counts and sums of additive metrics. A test asserts the evidence cannot contain the input text.
 *
 * Known limits, stated rather than hidden: a person's name, an address in words, or health information
 * typed as ordinary text ("i have hiv") has no identifier shape and is NOT detected, by this filter or by
 * the one it replaces. Obfuscated identifiers ("john at gmail dot com", digits spelled out) are not detected.
 * Search Console already withholds rarely-used queries on Google's side.
 */

export type WithheldReason =
  | "email"
  | "phone_number"
  | "long_number"
  | "government_id"
  | "credential"
  | "opaque_identifier"
  | "self_disclosure"
  | "non_web_scheme"
  | "unparseable"
  | "empty";

export type QueryCategory = "personal_field" | "credential" | "click_identifier" | "personal_value";

export interface PrivacyDecision {
  /** The value to store, or null when it is withheld. */
  value: string | null;
  reason?: WithheldReason;
  /** A query string or fragment was removed from a URL. */
  queryStringStripped?: boolean;
  /** The removed query string had a personal field, a credential or a personal-looking value. */
  queryStringPersonalData?: boolean;
}

// ---------------------------------------------------------------------------------------------
// Identifier detectors. Each returns a reason or null. None reads a word list.

const GOVERNMENT_ID = /\b[STFGM]\d{7}[A-Z]\b/i;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
// At least one a-f, so a long run of digits is left to the number rules (a card number is a number, not a token).
const LONG_HEX = /\b(?=[0-9a-f]*[a-f])[0-9a-f]{16,}\b/i;
const MIXED_RUN = /[A-Za-z0-9]{20,}/g;
const JWT = /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{3,}/;
const KNOWN_KEYS = /\bAIza[\w-]{20,}|\bya29\.[\w-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bGOCSPX-[\w-]{10,}/;
const BEARER = /\b(?:bearer|basic)\s+[\w.~+/=-]{8,}/i;
const KEY_VALUE_CREDENTIAL = /\b(?:access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|apikey|client[_-]?secret|secret|password|passwd|pwd|token|authorization|auth|session(?:[_-]?id)?|sid)\s*[=:]\s*\S{3,}/i;
const SELF_DISCLOSURE =
  /\bmy\s+(?:full\s+)?(?:name|e-?mail(?:\s+address)?|phone(?:\s+number)?|mobile(?:\s+number)?|contact(?:\s+number)?|number|nric|ic(?:\s+number)?|fin|passport(?:\s+number)?|home\s+address|address|password|account(?:\s+number)?|date\s+of\s+birth|dob)\s*(?:is|are|was|=|:)/i;

/** Digit runs joined by at most two separator characters (space, dot, dash, brackets). */
const DIGIT_RUN = /\+?\d(?:[\s().-]{0,2}\d)+/g;

function isPlausibleYear(group: string): boolean {
  const n = Number(group);
  return group.length === 4 && n >= 1900 && n <= 2100;
}

/** A run that is only dates or years is not a phone number: "2024 2025", "2026-11-12", "20261112". */
function isDateLike(candidate: string, digits: string): boolean {
  const groups = candidate.split(/[\s().-]+/).filter(Boolean);
  if (groups.length > 0 && groups.every(isPlausibleYear)) return true;
  if (groups.length === 1 && digits.length === 8) {
    const y = Number(digits.slice(0, 4));
    const m = Number(digits.slice(4, 6));
    const d = Number(digits.slice(6, 8));
    return y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31;
  }
  if (groups.length === 3) {
    const [a, b, c] = groups as [string, string, string];
    const ymd = isPlausibleYear(a) && Number(b) >= 1 && Number(b) <= 12 && Number(c) >= 1 && Number(c) <= 31;
    const dmy = isPlausibleYear(c) && Number(b) >= 1 && Number(b) <= 12 && Number(a) >= 1 && Number(a) <= 31;
    return ymd || dmy;
  }
  return false;
}

function numberReason(text: string): "phone_number" | "long_number" | null {
  for (const match of text.matchAll(DIGIT_RUN)) {
    const candidate = match[0];
    const digits = candidate.replace(/\D/g, "");
    if (digits.length < 8 || isDateLike(candidate, digits)) continue;
    return digits.length >= 13 ? "long_number" : "phone_number";
  }
  return null;
}

function opaqueReason(text: string): boolean {
  if (UUID.test(text) || LONG_HEX.test(text) || JWT.test(text)) return true;
  for (const run of text.matchAll(MIXED_RUN)) {
    // A long unbroken run with both letters and digits is a token or record id, not a word.
    if (/[A-Za-z]/.test(run[0]) && /\d/.test(run[0])) return true;
  }
  return false;
}

function credentialReason(text: string): boolean {
  return BEARER.test(text) || KEY_VALUE_CREDENTIAL.test(text) || JWT.test(text) || KNOWN_KEYS.test(text);
}

/** First identifier-shaped thing in `text`, or null. `free` also checks self-disclosure phrasing. */
function findIdentifier(text: string, free: boolean): WithheldReason | null {
  if (text.includes("@")) return "email";
  if (credentialReason(text)) return "credential";
  if (GOVERNMENT_ID.test(text)) return "government_id";
  if (free && SELF_DISCLOSURE.test(text)) return "self_disclosure";
  // A token is checked before numbers: a 32-character hex token contains digit runs but is not a phone number.
  if (opaqueReason(text)) return "opaque_identifier";
  return numberReason(text);
}

function decodeSafe(value: string): string {
  let current = value;
  // Twice, so "%2540" (an encoded %40) cannot hide an "@".
  for (let i = 0; i < 2; i += 1) {
    try {
      const next = decodeURIComponent(current);
      if (next === current) break;
      current = next;
    } catch {
      break;
    }
  }
  return current;
}

// ---------------------------------------------------------------------------------------------
// Search queries

export function classifySearchQuery(text: string): PrivacyDecision {
  const trimmed = text.trim();
  if (!trimmed) return { value: null, reason: "empty" };
  const reason = findIdentifier(trimmed, true);
  if (reason) return { value: null, reason };
  return { value: trimmed.slice(0, 200) };
}

// ---------------------------------------------------------------------------------------------
// URLs and paths

/** Split a name into lower-case whole words: "firstName", "first_name" and "first-name" are all [first, name]. */
export function keyTokens(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

const PERSONAL_FIELD_WORDS = new Set([
  "email", "mail", "phone", "mobile", "tel", "telephone", "name", "firstname", "lastname", "fullname", "surname",
  "nric", "fin", "passport", "dob", "birthday", "address", "postcode", "zip", "message", "comment", "symptom", "symptoms",
]);
const CREDENTIAL_WORDS = new Set(["token", "secret", "password", "passwd", "pwd", "key", "apikey", "auth", "authorization", "session", "sid", "otp"]);
const CLICK_ID_WORDS = new Set(["gclid", "fbclid", "msclkid", "dclid", "wbraid", "gbraid", "yclid"]);

export interface QueryStringReading {
  present: boolean;
  personalData: boolean;
  categories: QueryCategory[];
}

/**
 * Classify a query string by parameter KEY (whole words, so "hotel_id" is not a "tel" field) and by VALUE SHAPE.
 * Returns categories only. A value is read to decide a category and is never returned or stored.
 */
export function classifyQueryString(search: string): QueryStringReading {
  const text = search.startsWith("?") ? search.slice(1) : search;
  if (!text) return { present: false, personalData: false, categories: [] };
  const categories = new Set<QueryCategory>();
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(text);
  } catch {
    return { present: true, personalData: true, categories: ["personal_value"] };
  }
  for (const [key, value] of params) {
    const words = keyTokens(key);
    if (words.some((w) => PERSONAL_FIELD_WORDS.has(w))) categories.add("personal_field");
    if (words.some((w) => CREDENTIAL_WORDS.has(w))) categories.add("credential");
    if (words.some((w) => CLICK_ID_WORDS.has(w))) categories.add("click_identifier");
    if (findIdentifier(decodeSafe(value), false)) categories.add("personal_value");
  }
  return {
    present: true,
    personalData: categories.has("personal_field") || categories.has("credential") || categories.has("personal_value"),
    categories: [...categories],
  };
}
/** The query-string keys that carry personal fields, credentials or personal-looking values. Keys only. */
export function sensitiveQueryKeys(search: string): string[] {
  const text = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(text);
  return [...params].filter(([key, value]) => {
    const words = keyTokens(key);
    return words.some((w) => PERSONAL_FIELD_WORDS.has(w) || CREDENTIAL_WORDS.has(w) || CLICK_ID_WORDS.has(w)) || findIdentifier(decodeSafe(value), false) !== null;
  }).map(([key]) => key);
}

/** A placeholder GA4 uses for "no value", such as "(not set)". It is kept as it is. */
const PLACEHOLDER = /^\([a-z ]{1,24}\)$/i;

/**
 * A URL or path to a stored path. The query string and fragment are always removed. Segments are checked for
 * identifiers; the words in them never matter. `/for-patients` and `/blog/phone-etiquette` are kept.
 */
export function classifyPath(input: string): PrivacyDecision {
  const trimmed = input.trim();
  if (!trimmed) return { value: null, reason: "empty" };
  if (PLACEHOLDER.test(trimmed)) return { value: trimmed };
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) return { value: null, reason: "non_web_scheme" };
  let pathname = trimmed;
  let search = "";
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      pathname = url.pathname;
      search = url.search;
      if (url.hash) search += "#";
    } catch {
      return { value: null, reason: "unparseable" };
    }
  } else {
    const hash = pathname.indexOf("#");
    if (hash >= 0) {
      search = "#";
      pathname = pathname.slice(0, hash);
    }
    const question = pathname.indexOf("?");
    if (question >= 0) {
      search = pathname.slice(question) + search;
      pathname = pathname.slice(0, question);
    }
  }
  if (!pathname.startsWith("/")) pathname = `/${pathname}`;
  const reading = classifyQueryString(search.replace(/#$/, ""));
  const stripped = search.length > 0;
  const segments = pathname.split("/").filter(Boolean).map(decodeSafe);
  for (const segment of segments) {
    const reason = findIdentifier(segment, false);
    if (reason) return { value: null, reason, queryStringStripped: stripped, queryStringPersonalData: reading.personalData };
  }
  const cleaned = `/${segments.join("/")}`.replace(/\/{2,}/g, "/");
  return { value: cleaned === "/" ? "/" : cleaned.replace(/\/$/, ""), queryStringStripped: stripped, queryStringPersonalData: reading.personalData };
}

// ---------------------------------------------------------------------------------------------
// Dimensions

/** Dimensions whose value is a URL path. */
export const PATH_DIMENSIONS = new Set(["pagePath", "landingPage", "page"]);
/** Dimensions whose value is a short category set by the provider. */
export const CATEGORY_DIMENSIONS = new Set(["sessionDefaultChannelGroup", "deviceCategory", "country", "newVsReturning"]);

export function classifyDimension(name: string, value: string): PrivacyDecision {
  if (PATH_DIMENSIONS.has(name)) return classifyPath(value);
  if (name === "query") return classifySearchQuery(value);
  if (CATEGORY_DIMENSIONS.has(name)) {
    const trimmed = value.trim();
    if (!trimmed) return { value: null, reason: "empty" };
    const reason = findIdentifier(trimmed, false);
    return reason || trimmed.length > 120 ? { value: null, reason: reason ?? "opaque_identifier" } : { value: trimmed };
  }
  return { value };
}

// ---------------------------------------------------------------------------------------------
// Evidence

/** Metrics that add across rows. Everything else (users, rates, averages) must not be added. */
export const ADDITIVE_METRICS = new Set(["clicks", "impressions", "sessions", "screenPageViews", "userEngagementDuration"]);

/**
 * What was withheld, as counts and sums. It holds fixed reason labels and numbers and never any input text.
 * `withheldByPrivacyFilter` keeps the shape recorded in Phase 2.3 (`rows`, `clicks`, `impressions`) and adds `byReason`.
 */
export class PrivacyTally {
  private rows = 0;
  private readonly byReason: Partial<Record<WithheldReason, number>> = {};
  private readonly metrics: Record<string, number> = {};
  private stripped = 0;
  private strippedPersonal = 0;

  withhold(reason: WithheldReason, metrics: Record<string, number | null> = {}): void {
    this.rows += 1;
    this.byReason[reason] = (this.byReason[reason] ?? 0) + 1;
    for (const [key, value] of Object.entries(metrics)) {
      if (ADDITIVE_METRICS.has(key) && value !== null && Number.isFinite(value)) this.metrics[key] = (this.metrics[key] ?? 0) + value;
    }
  }

  note(decision: PrivacyDecision): void {
    if (decision.queryStringStripped) {
      this.stripped += 1;
      if (decision.queryStringPersonalData) this.strippedPersonal += 1;
    }
  }

  get withheldRows(): number {
    return this.rows;
  }

  toQuality(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (this.rows > 0) out.withheldByPrivacyFilter = { rows: this.rows, ...this.metrics, byReason: this.byReason };
    if (this.stripped > 0) out.queryStringsStripped = { rows: this.stripped, withPersonalData: this.strippedPersonal };
    return out;
  }
}
