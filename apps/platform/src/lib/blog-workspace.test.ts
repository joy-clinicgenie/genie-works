import { describe, expect, it } from "vitest";
import { chooseClientWebsite } from "./blog-workspace";

const websites = [
  { id: "forms", name: "Forms test", clientId: "genie" },
  { id: "genie-site", name: "Clinic Genie Website", clientId: "genie" },
  { id: "aqua", name: "AquaPhysio website", clientId: "aqua" },
];

describe("chooseClientWebsite", () => {
  it("selects the only website for a client", () => {
    expect(chooseClientWebsite("aqua", websites)).toBe("aqua");
  });

  it("selects the first website by name when the client has several", () => {
    expect(chooseClientWebsite("genie", websites)).toBe("genie-site");
  });

  it("keeps a website that already belongs to the client", () => {
    expect(chooseClientWebsite("genie", websites, "forms")).toBe("forms");
  });

  it("replaces a website from another client", () => {
    expect(chooseClientWebsite("aqua", websites, "forms")).toBe("aqua");
  });

  it("returns nothing when the client has no website", () => {
    expect(chooseClientWebsite("missing", websites)).toBe("");
  });
});
