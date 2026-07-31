const { test, expect } = require("@playwright/test");
const path = require("path");
const Database = require("better-sqlite3");
const { loginAs, dismissTestSiteOverlay, USERS } = require("./helpers/auth");
const { getUserByEmail } = require("./helpers/db");

test.describe("Video audition unlocks", () => {
  test("member portal shows Corps ($30) and BGI ($40) audition CTAs", async ({ page }) => {
    await loginAs(page, "member");
    await page.goto("/member-portal");
    await dismissTestSiteOverlay(page);
    await expect(page.getByRole("link", { name: /Corps Video Audition \(\$30\)/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /BGI Video Audition \(\$40\)/i })).toBeVisible();
  });

  test("corps pay page shows $30 + 6% fee", async ({ page }) => {
    await loginAs(page, "member");
    await page.goto("/video-audition/pay?program=corps");
    await dismissTestSiteOverlay(page);
    await expect(page.getByRole("heading", { name: /Video Audition Application/i })).toBeVisible();
    await expect(page.locator("body")).toContainText("$30.00");
    await expect(page.locator("body")).toContainText("$1.80"); // 6%
    await expect(page.locator("body")).toContainText("$31.80");
    await expect(page.locator('form[action="/video-audition/pay"] input[name="program"]')).toHaveValue("corps");
  });

  test("BGI pay page shows $40 + 6% fee", async ({ page }) => {
    await loginAs(page, "member");
    await page.goto("/video-audition/pay?program=independent");
    await dismissTestSiteOverlay(page);
    await expect(page.locator("body")).toContainText("$40.00");
    await expect(page.locator("body")).toContainText("$2.40");
    await expect(page.locator("body")).toContainText("$42.40");
    await expect(page.locator('form[action="/video-audition/pay"] input[name="program"]')).toHaveValue(
      "independent"
    );
  });

  test("unlocking in DB reveals Omnipply link for current season", async ({ page }) => {
    const member = getUserByEmail(USERS.member.email);
    expect(member).toBeTruthy();

    const db = new Database(path.join(__dirname, "..", "data.db"));
    const season = db.prepare("SELECT current_season FROM site_settings WHERE id = 1").get();
    const seasonYear = Number(season && season.current_season) || 2027;
    db.prepare(`
      INSERT OR IGNORE INTO video_audition_unlocks
        (user_id, program, season_year, amount, stripe_session_id, unlocked_at)
      VALUES (?, 'corps', ?, 3000, 'e2e-test', ?)
    `).run(member.id, seasonYear, Date.now());
    // Ensure section has an Omnipply mapping
    db.prepare("UPDATE users SET section = COALESCE(NULLIF(section,''), 'brass') WHERE id = ?").run(member.id);
    db.close();

    await loginAs(page, "member");
    await page.goto("/member-portal");
    await dismissTestSiteOverlay(page);

    const corpsLink = page.getByRole("link", { name: /Corps Video Audition/i }).first();
    await expect(corpsLink).toBeVisible();
    const href = await corpsLink.getAttribute("href");
    expect(href).toMatch(/omnipply\.com/);
  });
});
