const { test, expect } = require("@playwright/test");
const { loginAs, dismissTestSiteOverlay } = require("./helpers/auth");
const {
  registerMember,
  registerParent,
  logout,
  loginWithCredentials,
  requestParentLink,
  acceptIncomingParentLink,
  PASSWORD,
} = require("./helpers/accounts");
const {
  getUserByEmail,
  getAuditRows,
  getAllergies,
  getEmergencyContacts,
  getPaymentHistory,
  isParentOf,
} = require("./helpers/db");

test.describe.serial("Medical, family links, transactions & audit", () => {
  /** @type {{ email: string, firstname: string, lastname: string, password?: string }} */
  let childAccount;
  /** @type {{ email: string, firstname: string, lastname: string, password?: string }} */
  let parentAccount;
  let childId;
  let parentId;
  const runStamp = Date.now();

  test("create parent and child accounts via registration", async ({ page }) => {
    childAccount = await registerMember(page, {
      firstname: "AuditChild",
      lastname: `Kid${String(runStamp).slice(-5)}`,
    });
    await logout(page);

    parentAccount = await registerParent(page, {
      firstname: "AuditParent",
      lastname: `Par${String(runStamp).slice(-5)}`,
    });

    const childRow = getUserByEmail(childAccount.email);
    const parentRow = getUserByEmail(parentAccount.email);
    expect(childRow, "child should exist in DB").toBeTruthy();
    expect(parentRow, "parent should exist in DB").toBeTruthy();
    expect(Number(parentRow.parent)).toBe(1);
    childId = childRow.id;
    parentId = parentRow.id;
  });

  test("parent requests link and child accepts", async ({ page }) => {
    await loginWithCredentials(page, parentAccount.email, parentAccount.password || PASSWORD);
    await page.goto("/parent-portal");
    await dismissTestSiteOverlay(page);

    const sent = await requestParentLink(page, childAccount.email);
    expect(sent.ok).toBeTruthy();

    await logout(page);
    await loginWithCredentials(page, childAccount.email, childAccount.password || PASSWORD);
    await page.goto("/member-portal");
    await dismissTestSiteOverlay(page);

    await acceptIncomingParentLink(page);
    expect(isParentOf(parentId, childId)).toBeTruthy();

    await logout(page);
    await loginWithCredentials(page, parentAccount.email, parentAccount.password || PASSWORD);
    await page.goto("/parent-portal");
    await dismissTestSiteOverlay(page);
    await expect(page.getByText(childAccount.firstname, { exact: false }).first()).toBeVisible();
  });

  test("child updates allergy and emergency contact info", async ({ page }) => {
    await loginWithCredentials(page, childAccount.email, childAccount.password || PASSWORD);

    await page.goto("/allergy-info");
    await dismissTestSiteOverlay(page);
    const noAllergies = page.locator('input[name="no_allergies"]');
    if (await noAllergies.isChecked()) await noAllergies.uncheck();
    await page.locator('textarea[name="allergies"]').fill(`E2E peanut audit ${runStamp}`);
    await page.locator('form[action="/set-allergies"] button').click();
    await expect(page).toHaveURL(/member-portal/);

    const allergy = getAllergies(childId);
    expect(allergy).toBeTruthy();
    expect(String(allergy.allergies)).toContain(`E2E peanut audit ${runStamp}`);

    await page.goto("/update-emergency");
    await dismissTestSiteOverlay(page);
    await page.getByRole("button", { name: /Add Emergency Contact/i }).click();
    await page.locator('input[name="contacts[-0][name]"]').fill("E2E Emergency Contact");
    await page.locator('input[name="contacts[-0][email]"]').fill("e2e-emergency@boisegems.test");
    await page.locator('input[name="contacts[-0][phone]"]').fill("(208) 555-9999");
    await page.locator('form#emergencyContactForm button[type="submit"]').click();
    await page.waitForLoadState("domcontentloaded");

    const contacts = getEmergencyContacts(childId);
    expect(contacts.some((c) => c.name === "E2E Emergency Contact")).toBeTruthy();
  });

  test("admin views medical info and leaves medical_access audit", async ({ page }) => {
    await loginAs(page, "admin");

    const res = await page.goto(`/view-emergency/${childId}`);
    expect(res.status()).toBeLessThan(500);
    await expect(page.getByText("E2E Emergency Contact")).toBeVisible();

    // CSV export also audits
    const csv = await page.request.get("/admin/export-allergies.csv");
    expect(csv.status()).toBeLessThan(500);
    const csvText = await csv.text();
    expect(csvText.toLowerCase()).toMatch(/allerg|email|firstname|peanut|e2e/i);

    const medicalAudits = getAuditRows({ action: "medical_access", limit: 20 });
    expect(
      medicalAudits.some((r) => String(r.target_id) === String(childId) || r.target_id === "allergies")
    ).toBeTruthy();

    await page.goto("/admin/audit-log?action=medical_access");
    await dismissTestSiteOverlay(page);
    await expect(page.locator("table tbody tr td").filter({ hasText: "medical_access" }).first()).toBeVisible();
  });

  test("admin charges and records payment (financial_change audit)", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/add-transaction/${childId}`);
    await dismissTestSiteOverlay(page);

    // Add a charge first
    await page.locator('form[action="/add-charge/' + childId + '"] input[name="title"]').fill(
      `E2E Tuition Charge ${runStamp}`
    );
    await page.locator('form[action="/add-charge/' + childId + '"] input[name="amount"]').fill("75.00");
    await page
      .locator('form[action="/add-charge/' + childId + '"] textarea[name="description"]')
      .fill("Playwright charge for audit trail");
    await page.locator('form[action="/add-charge/' + childId + '"] button[type="submit"]').click();
    await expect(page).toHaveURL(new RegExp(`transaction-edit/${childId}`));

    // Record a payment toward balance (audited)
    await page.goto(`/add-transaction/${childId}`);
    await dismissTestSiteOverlay(page);
    await page.locator('form[action="/add-transaction/' + childId + '"] input[name="title"]').fill(
      `E2E Cash Payment ${runStamp}`
    );
    await page.locator('form[action="/add-transaction/' + childId + '"] input[name="payment"]').fill("25.00");
    await page
      .locator('form[action="/add-transaction/' + childId + '"] textarea[name="description"]')
      .fill("Playwright payment for audit trail");
    await page.locator('form[action="/add-transaction/' + childId + '"] select[name="method"]').selectOption("cash");
    await page.locator('form[action="/add-transaction/' + childId + '"] input[name="tuition"]').check();
    await page.locator('form[action="/add-transaction/' + childId + '"] button').click();
    await expect(page).toHaveURL(new RegExp(`transaction-edit/${childId}`));

    const history = getPaymentHistory(childId);
    expect(history.some((h) => String(h.title).includes(`E2E Tuition Charge ${runStamp}`))).toBeTruthy();
    expect(history.some((h) => String(h.title).includes(`E2E Cash Payment ${runStamp}`))).toBeTruthy();

    const financeAudits = getAuditRows({ action: "financial_change", q: String(childId), limit: 20 });
    expect(financeAudits.length).toBeGreaterThan(0);

    await page.goto("/pay-history");
    await dismissTestSiteOverlay(page);
    expect((await page.goto(`/transaction-edit/${childId}`)).status()).toBeLessThan(500);
    await expect(page.getByText(new RegExp(`E2E Cash Payment ${runStamp}`)).first()).toBeVisible();
  });

  test("member and parent can see transaction surfaces; audit log lists activity", async ({ page }) => {
    await loginWithCredentials(page, childAccount.email, childAccount.password || PASSWORD);
    const memberTxn = await page.goto("/member-transactions");
    expect(memberTxn.status()).toBeLessThan(500);
    await expect(page.getByText(new RegExp(`E2E Cash Payment ${runStamp}|E2E Tuition Charge ${runStamp}`)).first()).toBeVisible();

    await logout(page);
    await loginWithCredentials(page, parentAccount.email, parentAccount.password || PASSWORD);
    await page.goto("/parent-portal");
    await dismissTestSiteOverlay(page);
    // Balance badge / child name after charge
    await expect(page.getByText(childAccount.firstname, { exact: false }).first()).toBeVisible();

    await logout(page);
    await loginAs(page, "admin");
    await page.goto("/admin/audit-log");
    await dismissTestSiteOverlay(page);
    await expect(page.locator("table tbody tr").first()).toBeVisible();

    // Filter financial
    await page.goto("/admin/audit-log?action=financial_change");
    await dismissTestSiteOverlay(page);
    await expect(page.locator("table tbody tr td").filter({ hasText: "financial_change" }).first()).toBeVisible();
  });
});
