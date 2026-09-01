const { test, expect } = require("@playwright/test");
const { loginAs, dismissTestSiteOverlay } = require("./helpers/auth");
test.describe("Video audition unlocks", () => {
  test("member portal shows Corps and BGI video audition options", async ({ page }) => {
    await loginAs(page, "member");
    await page.goto("/member-portal");
    await dismissTestSiteOverlay(page);
    await expect(page.getByRole("link", { name: /Corps Video Audition/i }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /BGI Video Audition/i }).first()).toBeVisible();
  });

  test("corps pay route skips checkout when fee bypass is enabled", async ({ page }) => {
    await loginAs(page, "member");
    await page.goto("/video-audition/pay?program=corps");
    await dismissTestSiteOverlay(page);
    await expect(page).toHaveURL(/\/video-audition\/corps/);
  });

  test("BGI pay route skips checkout when fee bypass is enabled", async ({ page }) => {
    await loginAs(page, "member");
    await page.goto("/video-audition/pay?program=independent");
    await dismissTestSiteOverlay(page);
    await expect(page).toHaveURL(/\/video-audition\/unlocked\?program=independent/);
  });

  test("member portal links directly to corps audition when fee bypass is enabled", async ({ page }) => {
    await loginAs(page, "member");
    await page.goto("/member-portal");
    await dismissTestSiteOverlay(page);

    const corpsLink = page.getByRole("link", { name: /Corps Video Audition/i }).first();
    await expect(corpsLink).toBeVisible();
    const href = await corpsLink.getAttribute("href");
    expect(href).toMatch(/\/video-audition\/corps/);
  });

  test("video audition tab is visible in member portal", async ({ page }) => {
    await loginAs(page, "member");
    await page.goto("/member-portal");
    await dismissTestSiteOverlay(page);
    await page.getByRole("button", { name: /Video Audition/i }).click();
    await expect(page.getByText(/Corps spots available|Boise Gems Drum/i).first()).toBeVisible();
  });

  test("available spots API returns expected shape", async ({ request }) => {
    const res = await request.get("/api/available-spots-corps");
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data).toEqual(["Trumpets:", "20", "Baritones:", "10"]);
  });
});
