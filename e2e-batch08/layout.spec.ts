import { expect, test } from "@playwright/test";
import { controlFindings, focusedStyle, headerLayout, openAs } from "./support.ts";

const widths = [390, 768, 1440];

test("desktop, tablet and mobile layouts keep the header readable", async ({ browser }) => {
  const { page, close } = await openAs(browser, "admin@example.invalid");
  try {
    for (const width of widths) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.goto("/clients");
      const layout = await headerLayout(page);
      console.log(`viewport ${width}: pageOverflow=${layout.pageOverflow} headerOverflow=${layout.headerOverflow} overlaps=${layout.overlaps.length}`);
      expect(layout.pageOverflow, `${width}px page overflow`).toBeLessThanOrEqual(1);
      expect(layout.headerOverflow, `${width}px header overflow`).toBeLessThanOrEqual(1);
      expect(layout.overlaps, `${width}px overlaps ${layout.overlaps.join("; ")}`).toEqual([]);
      if (width === 768) {
        await expect(page.getByPlaceholder("Name, client ID or short code")).toBeVisible();
        await expect(page.getByLabel("Status")).toBeVisible();
        const clientLink = page.locator("table a").first();
        await expect(clientLink).toBeVisible();
        const tableUsable = await page.evaluate(() => {
          const table = document.querySelector("table");
          const scroller = table?.parentElement;
          const link = document.querySelector("table a");
          if (!table || !scroller || !link) return false;
          const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
          const style = getComputedStyle(scroller);
          const linkBox = link.getBoundingClientRect();
          const scrollerBox = scroller.getBoundingClientRect();
          return overflow <= 1 && style.overflowX === "auto" && linkBox.width > 0 && linkBox.top < window.innerHeight && scrollerBox.width > 0;
        });
        expect(tableUsable, "768px table controls").toBe(true);
      }
      if (width < 1024) await expect(page.getByRole("button", { name: "Open menu" })).toBeVisible();
      else await expect(page.getByRole("link", { name: "Clients" }).first()).toBeVisible();
    }
  } finally {
    await close();
  }
});

test("keyboard focus, labels and headings are present on the checked pages", async ({ browser, page }) => {
  await page.goto("/sign-in");
  const signInFindings = await controlFindings(page);
  console.log(`a11y /sign-in: ${signInFindings.join("; ") || "none"}`);
  expect(signInFindings).toEqual([]);

  const signedIn = await openAs(browser, "admin@example.invalid");
  try {
    await signedIn.page.setViewportSize({ width: 390, height: 844 });
    await signedIn.page.goto("/");
    await signedIn.page.locator("body").press("Tab");
    const firstFocus = await focusedStyle(signedIn.page);
    console.log(`focus first-tab: ${JSON.stringify(firstFocus)}`);
    expect(firstFocus.outlineStyle).toBe("solid");
    expect(firstFocus.outlineWidth).toBe("3px");
    expect(firstFocus.outlineColor).toBe("rgb(19, 108, 114)");
    await signedIn.page.getByRole("button", { name: "Open menu" }).focus();
    await signedIn.page.keyboard.press("Enter");
    await expect(signedIn.page.getByRole("link", { name: "Dashboard", exact: true })).toBeFocused();
    await signedIn.page.keyboard.press("Tab");
    await expect(signedIn.page.getByRole("link", { name: "Clients", exact: true })).toBeFocused();
    await expect.poll(async () => focusedStyle(signedIn.page), { timeout: 1000 }).toMatchObject({
      outlineStyle: "solid",
      outlineWidth: "3px",
      outlineColor: "rgb(19, 108, 114)",
    });
    console.log(`focus clients-link: ${JSON.stringify(await focusedStyle(signedIn.page))}`);
    await signedIn.page.keyboard.press("Enter");
    await expect(signedIn.page).toHaveURL(/\/clients$/);

    await signedIn.page.setViewportSize({ width: 1440, height: 900 });
    await signedIn.page.goto("/clients/new");
    await signedIn.page.locator("#name").click();
    const fieldFocus = await focusedStyle(signedIn.page);
    console.log(`focus clinic-name: ${JSON.stringify(fieldFocus)}`);
    expect(fieldFocus.outlineStyle).toBe("solid");
    expect(fieldFocus.outlineWidth).toBe("3px");
    expect(fieldFocus.outlineColor).toBe("rgb(19, 108, 114)");
    await signedIn.page.keyboard.press("Tab");
    const tabbed = await focusedStyle(signedIn.page);
    console.log(`focus after-tab: ${JSON.stringify(tabbed)}`);
    expect(tabbed.outlineStyle).toBe("solid");
    expect(tabbed.outlineWidth).toBe("3px");
    expect(tabbed.outlineColor).toBe("rgb(19, 108, 114)");

    for (const path of ["/", "/clients", "/clients/new", "/reports/new"]) {
      await signedIn.page.goto(path);
      const findings = await controlFindings(signedIn.page);
      console.log(`a11y ${path}: ${findings.join("; ") || "none"}`);
      expect(findings, findings.join("; ")).toEqual([]);
    }
  } finally {
    await signedIn.close();
  }
});
