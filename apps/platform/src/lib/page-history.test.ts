import { describe, expect, it } from "vitest";
import { pageBackTarget, previousPage, rememberPage } from "./page-history";

describe("in-app page history", () => {
  it("records a new page and treats a return to the previous address as going back", () => {
    const dashboard = rememberPage([], "/");
    const filtered = rememberPage(dashboard, "/?client=client-1&range=last7");
    const analytics = rememberPage(filtered, "/analytics?client=client-1&range=last7");
    expect(previousPage(analytics)).toBe("/?client=client-1&range=last7");
    const returned = rememberPage(analytics, "/?client=client-1&range=last7");
    expect(returned).toEqual(["/", "/?client=client-1&range=last7"]);
    expect(previousPage(returned)).toBe("/");
    expect(previousPage(rememberPage(returned, "/"))).toBeNull();
  });

  it("keeps Back off main pages and shows it on a nested page", () => {
    const dashboard = rememberPage([], "/");
    const filtered = rememberPage(dashboard, "/?client=client-1&range=last7");
    expect(pageBackTarget("/", filtered)).toBeNull();
    const analytics = rememberPage(filtered, "/analytics?client=client-1&range=last7");
    expect(pageBackTarget("/analytics", analytics)).toBeNull();
    const traffic = rememberPage(analytics, "/analytics/traffic?range=last7");
    expect(pageBackTarget("/analytics/traffic", traffic)).toBe("/analytics?client=client-1&range=last7");
    const clients = rememberPage(traffic, "/clients");
    expect(pageBackTarget("/clients", clients)).toBeNull();
    const detail = rememberPage(clients, "/clients/client-1");
    expect(pageBackTarget("/clients/client-1", detail)).toBe("/clients");
    expect(pageBackTarget("/reports/report-1/print", rememberPage(["/reports/report-1"], "/reports/report-1/print"))).toBe("/reports/report-1");
  });

  it("ignores a repeat of the current page and addresses outside this app", () => {
    const stack = rememberPage(["/reports"], "/reports");
    expect(stack).toEqual(["/reports"]);
    expect(previousPage(rememberPage(stack, "https://example.invalid/reports"))).toBeNull();
  });
});
