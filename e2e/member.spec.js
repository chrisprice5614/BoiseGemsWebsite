const { test, expect } = require("@playwright/test");
const { loginAs } = require("./helpers/auth");
const { MEMBER_PAGES } = require("./helpers/routes");

test.describe("Member portal", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "member");
  });

  for (const path of MEMBER_PAGES) {
    test(`member can open ${path}`, async ({ page }) => {
      const res = await page.goto(path, { waitUntil: "domcontentloaded" });
      expect(res.status()).toBeLessThan(500);
      await expect(page).toHaveURL(new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    });
  }

  test("member cannot open admin portal", async ({ page }) => {
    await page.goto("/admin-portal");
    await expect(page).not.toHaveURL(/admin-portal/);
  });

  test("member messenger cannot create chats", async ({ page }) => {
    await page.goto("/member-portal");
    const fab = page.locator("#bgMsgFab");
    if (await fab.count()) {
      await fab.click();
      await expect(page.locator("#bgMsgNewChat")).toBeHidden();
      await expect(page.locator("#bgMsgNewGroup")).toBeHidden();
    }
  });
});
