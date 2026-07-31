const { test, expect } = require("@playwright/test");
const { PUBLIC_PAGES } = require("./helpers/routes");

test.describe("Public pages", () => {
  for (const pageDef of PUBLIC_PAGES) {
    test(`loads ${pageDef.path}`, async ({ page }) => {
      const res = await page.goto(pageDef.path, { waitUntil: "domcontentloaded" });
      expect(res).toBeTruthy();
      expect(res.status(), `${pageDef.path} should not 5xx`).toBeLessThan(500);
      if (pageDef.path === "/robots.txt") {
        const body = await page.locator("body").innerText();
        expect(body).toMatch(pageDef.text);
        return;
      }
      await expect(page.locator("body")).toContainText(pageDef.text);
    });
  }
});
