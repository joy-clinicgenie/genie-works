import { describe, expect, it } from "vitest";
import { classifyWixForm } from "@/lib/wix-enquiries";
import { compareBoundSite, connectedFormOptions, connectedFormDetail, connectedFormStateLabel, type ConnectedForm } from "@/lib/connected-forms";

const signals = (over: Partial<Parameters<typeof classifyWixForm>[0]> = {}) => ({
  credentials: true,
  token: true,
  formsStatus: 200,
  namespaceRefused: false,
  formFound: true,
  submissionsStatus: 200,
  submissions: 0,
  ...over,
});

describe("Wix form state", () => {
  it("separates a readable form from one that is readable but empty", () => {
    expect(classifyWixForm(signals({ submissions: 3 }))).toBe("readable");
    expect(classifyWixForm(signals({ submissions: 0 }))).toBe("empty");
  });

  it("treats a refused namespace as unsupported, not as a permission failure", () => {
    // A site without the Wix Forms app: its legacy Forms & Payments forms are not readable.
    expect(classifyWixForm(signals({ namespaceRefused: true, formsStatus: 400, formFound: false }))).toBe("unsupported");
  });

  it("reports a permission failure for a refused read", () => {
    expect(classifyWixForm(signals({ formsStatus: 403 }))).toBe("permission");
    expect(classifyWixForm(signals({ token: false, formsStatus: 0 }))).toBe("permission");
    expect(classifyWixForm(signals({ submissionsStatus: 401 }))).toBe("permission");
  });

  it("reports a form that is no longer on the site", () => {
    expect(classifyWixForm(signals({ formFound: false }))).toBe("missing");
  });

  it("reports missing server credentials ahead of everything else", () => {
    expect(classifyWixForm(signals({ credentials: false, namespaceRefused: true, formsStatus: 0 }))).toBe("unconfigured");
  });

  it("gives every state a worded label, so colour is never the only signal", () => {
    for (const state of ["readable", "empty", "missing", "unsupported", "permission", "unconfigured", "disabled_read"]) {
      expect(connectedFormStateLabel(state)).not.toBe("Unknown");
    }
  });
});

const form = (over: Partial<ConnectedForm> = {}): ConnectedForm => ({
  source: "wix",
  clientSlug: "thsc",
  clientName: "The Heart Specialist Clinic",
  websiteKey: "thsc-production",
  websiteName: "The Heart Specialist Clinic website",
  formKey: "contact",
  displayName: "Contact us",
  liveDomain: "https://www.theheartspecialistclinic.com/",
  environment: "production",
  boundSiteUrl: "https://www.theheartspecialistclinic.com/",
  boundSiteName: "THSC",
  boundSiteMatch: "match",
  providerFormId: "5e8a5d87-2831-419d-88d8-420d0d9cfe16",
  namespace: "wix.form_app.form",
  platform: "Wix Studio",
  state: "empty",
  active: true,
  fields: ["first_name", "email"],
  submissions: 0,
  more: false,
  checkedAt: null,
  countsInTotals: false,
  ...over,
});

describe("form filter options", () => {
  it("offers a connected form before its first submission arrives", () => {
    expect(connectedFormOptions([form()])).toEqual([{ value: "contact", label: "Contact" }]);
  });

  it("keeps one option per form key across websites", () => {
    const options = connectedFormOptions([form(), form({ clientSlug: "tac", clientName: "The Acne Clinic" })]);
    expect(options).toHaveLength(1);
  });

  it("narrows to the selected clinic and never leaks another clinic's forms", () => {
    const options = connectedFormOptions(
      [form(), form({ clientSlug: "tac", clientName: "The Acne Clinic", formKey: "appointment-enquiry" })],
      "tac",
    );
    expect(options).toEqual([{ value: "appointment-enquiry", label: "Appointment enquiry" }]);
  });

  it("covers both connectors", () => {
    const options = connectedFormOptions([form(), form({ source: "database", formKey: "booking", platform: "Website database" })]);
    expect(options.map((option) => option.value).sort()).toEqual(["booking", "contact"]);
  });
});

describe("unsupported form detail", () => {
  it("explains a legacy-only site in words staff can act on", () => {
    expect(connectedFormDetail(form({ state: "unsupported" }))).toContain("Wix Forms & Payments");
  });

  it("says nothing extra for a website-database form", () => {
    expect(connectedFormDetail(form({ source: "database", state: "unsupported" }))).toBeNull();
  });
});

describe("bound site identity", () => {
  it("matches a record and instance that are the same site, ignoring www and trailing slash", () => {
    expect(compareBoundSite("https://www.theheartspecialistclinic.com/", "https://theheartspecialistclinic.com")).toBe("match");
  });

  it("separates two Wix Studio builds that share a host", () => {
    // The real THSC case: the record is the live domain, the binding was a Studio build.
    expect(compareBoundSite("https://www.theheartspecialistclinic.com/", "https://clinicgeniemarketing.wixstudio.com/theheartspecialist")).toBe("different");
    expect(compareBoundSite("https://clinicgeniemarketing.wixstudio.com/test", "https://clinicgeniemarketing.wixstudio.com/theheartspecialist")).toBe("different");
    expect(compareBoundSite("https://clinicgeniemarketing.wixstudio.com/test", "https://clinicgeniemarketing.wixstudio.com/test")).toBe("match");
  });

  it("says unknown rather than guessing when either address is missing or unparseable", () => {
    expect(compareBoundSite(null, "https://example.invalid/")).toBe("unknown");
    expect(compareBoundSite("not a url", "https://example.invalid/")).toBe("unknown");
  });

  it("never presents a readable form on another site as a working connection", () => {
    const detail = connectedFormDetail(form({ state: "readable", boundSiteMatch: "different" }));
    expect(detail).toContain("not a working connection");
  });
});
