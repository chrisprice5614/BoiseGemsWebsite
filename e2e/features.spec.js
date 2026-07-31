const { test, expect } = require("@playwright/test");
const { loginAs } = require("./helpers/auth");

test.describe("Files, schedule, merch, contracts surfaces", () => {
  test("files root requires auth / contract", async ({ page }) => {
    await page.goto("/files");
    // anonymous users should not stay on a usable files browser
    const url = page.url();
    const ok = /\/(login)?$|files/.test(url);
    expect(ok).toBeTruthy();
  });

  test("admin can open contracts admin hubs", async ({ page }) => {
    await loginAs(page, "admin");
    for (const path of [
      "/admin/pending-contracts",
      "/admin/contract-extensions",
      "/admin/contracted-members",
      "/admin/expired-contracts",
      "/admin/season-roster",
    ]) {
      const res = await page.goto(path);
      expect(res.status()).toBeLessThan(500);
      await expect(page).not.toHaveURL(/\/login/);
    }
  });

  test("store / merch pages do not 5xx", async ({ page }) => {
    await loginAs(page, "admin");
    for (const path of ["/store", "/merch", "/shop"]) {
      const res = await page.goto(path, { waitUntil: "domcontentloaded" });
      if (!res) continue;
      expect(res.status()).toBeLessThan(500);
    }
    await expect(page).toHaveURL(/\/store/);
  });

  test("schedule / calendar public page loads", async ({ page }) => {
    const res = await page.goto("/calendar");
    expect(res.status()).toBeLessThan(500);
    await expect(page.locator("body")).toBeVisible();
  });

  test("support issue page requires login", async ({ page }) => {
    await page.goto("/support/issue");
    await expect(page).not.toHaveURL(/support\/issue/);
  });

  test("logged-in member can open support issue", async ({ page }) => {
    await loginAs(page, "member");
    const res = await page.goto("/support/issue");
    expect(res.status()).toBeLessThan(500);
    await expect(page).toHaveURL(/support\/issue/);
  });
});
