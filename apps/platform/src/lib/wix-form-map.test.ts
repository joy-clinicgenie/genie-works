import { describe, expect, it } from "vitest";
import { labelsByTarget, mapWixAnswers, parseWixSubmissionList, wixEnquiryReference } from "./wix-form-map";

const SUBMISSION_ID = "11111111-1111-4111-8111-111111111199";

describe("Wix form mapping", () => {
  it("reads the contact fields and leaves the Wix status unused", () => {
    const labels = new Map([
      ["short_answer_110f", "Message"],
      ["short_answer_8020", "Preferred time"],
      ["dropdown_4c44", "Reason"],
    ]);
    const parsed = parseWixSubmissionList({
      submissions: [{
        id: SUBMISSION_ID.toUpperCase(),
        formId: "00000000-0000-4000-8000-0000000000a1",
        namespace: "wix.form_app.form",
        status: "CONFIRMED",
        createdDate: "2026-11-01T02:00:00.000Z",
        submissions: {
          first_name_9efc: "Ada",
          last_name_6eb3: "Lovelace",
          email_f703: "ada@example.invalid",
          phone_1000: "00000000",
          short_answer_110f: "A fictional note",
          dropdown_4c44: "Cleaning",
          short_answer_8020: "Morning",
        },
      }],
      metadata: { count: 1, hasNext: false, cursors: { next: "ignored" } },
    });
    expect(parsed.next).toBeNull();
    expect(parsed.submissions).toHaveLength(1);
    const row = parsed.submissions[0]!;
    expect(row.id).toBe(SUBMISSION_ID);
    expect(row).not.toHaveProperty("status");
    const mapped = mapWixAnswers(row.answers, labels);
    expect(mapped.name).toBe("Ada Lovelace");
    expect(mapped.email).toBe("ada@example.invalid");
    expect(mapped.phone).toBe("00000000");
    expect(mapped.reason).toBe("Cleaning");
    expect(mapped.message).toBe("Message\nA fictional note\n\nPreferred time\nMorning");
    expect(mapped.message).not.toContain("ada@example.invalid");
    expect(mapped.message).not.toContain("00000000");
    expect(wixEnquiryReference(row.id)).toBe("WIX-11111111");
  });

  it("finds a label nested under the field target", () => {
    const labels = labelsByTarget({
      fields: [{ target: "email_f703", inputOptions: { stringOptions: { label: "Email" } } }],
    });
    expect(labels.get("email_f703")).toBe("Email");
  });

  it("follows the next cursor only when another page exists", () => {
    expect(parseWixSubmissionList({
      submissions: [],
      metadata: { hasNext: true, cursors: { next: "page-2" } },
    }).next).toBe("page-2");
  });
});
