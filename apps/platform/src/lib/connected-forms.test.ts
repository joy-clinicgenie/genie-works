import { describe, expect, it } from "vitest";
import { connectedFormOptions, type ConnectedForm } from "@/lib/connected-forms";

const form = (over: Partial<ConnectedForm> = {}): ConnectedForm => ({
  source: "database",
  clientSlug: "demo-clinic-a",
  clientName: "demo-clinic-a",
  websiteKey: "demo-clinic-a-production",
  formKey: "contact",
  displayName: "Contact",
  platform: "Website database",
  ...over,
});

describe("form filter options", () => {
  it("offers one option per connected form key", () => {
    expect(connectedFormOptions([form()])).toEqual([{ value: "contact", label: "Contact" }]);
  });

  it("keeps one option per form key across websites", () => {
    const options = connectedFormOptions([form(), form({ clientSlug: "demo-clinic-b", websiteKey: "demo-clinic-b-production" })]);
    expect(options).toHaveLength(1);
  });

  it("narrows to the selected clinic and never leaks another clinic's forms", () => {
    const options = connectedFormOptions(
      [form(), form({ clientSlug: "demo-clinic-b", formKey: "appointment-enquiry" })],
      "demo-clinic-b",
    );
    expect(options).toEqual([{ value: "appointment-enquiry", label: "Appointment enquiry" }]);
  });

  it("lists every form from the website database only (D61)", () => {
    const options = connectedFormOptions([form(), form({ formKey: "booking" })]);
    expect(options.map((option) => option.value).sort()).toEqual(["booking", "contact"]);
  });
});
