const { expect } = require("@playwright/test");
const { PASSWORD } = require("./seed-users");
const { dismissTestSiteOverlay, loginAs } = require("./auth");

function uniqueTag() {
  return `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

async function loginWithCredentials(page, email, password = PASSWORD) {
  await page.goto("/login");
  await dismissTestSiteOverlay(page);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('form[action="/login"] button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/login(\/mfa)?$/, { timeout: 15000 });
  await dismissTestSiteOverlay(page);
}

async function logout(page) {
  await page.goto("/logout");
  await dismissTestSiteOverlay(page);
}

/**
 * Register a new member via the UI (captcha bypassed on test_site).
 * Returns { email, password, firstname, lastname }.
 */
async function registerMember(page, overrides = {}) {
  const tag = uniqueTag();
  const account = {
    firstname: overrides.firstname || "E2EChild",
    lastname: overrides.lastname || `Mem${tag.slice(-6)}`,
    email: overrides.email || `e2e-child-${tag}@boisegems.test`,
    phone: overrides.phone || `(208) 555-${String(Math.floor(Math.random() * 9000) + 1000)}`,
    address: overrides.address || "100 E2E Child St, Boise, ID",
    birthday: overrides.birthday || "2010-06-15", // minor
    section: overrides.section || "brass",
    instrument: overrides.instrument || "trumpet",
    password: overrides.password || PASSWORD,
  };

  await page.goto("/register-member");
  await dismissTestSiteOverlay(page);
  await page.locator('input[name="firstname"]').fill(account.firstname);
  await page.locator('input[name="lastname"]').fill(account.lastname);
  await page.locator('input[name="phone"]').fill(account.phone);
  await page.locator('input[name="email"]').fill(account.email);
  await page.locator('input[name="address"]').fill(account.address);
  await page.locator('input[name="birthday"]').fill(account.birthday);
  await page.locator('select[name="section"]').selectOption(account.section);
  // instrument select is injected by page JS
  await page.waitForSelector('select[name="instrument"]');
  await page.locator('select[name="instrument"]').selectOption(account.instrument);
  await page.locator('input[name="password"]').fill(account.password);
  await page.locator('input[name="passwordRetype"]').fill(account.password);
  await page.locator('form[action="/register-member"] button[type="submit"]').click();

  // Auto-login redirect to home (or stay on form with errors)
  await page.waitForLoadState("domcontentloaded");
  const errors = page.locator(".error-box");
  if (await errors.count()) {
    const msgs = await errors.allTextContents();
    throw new Error(`Member registration failed: ${msgs.join("; ")}`);
  }
  await dismissTestSiteOverlay(page);
  return account;
}

/**
 * Register a new parent via the UI.
 */
async function registerParent(page, overrides = {}) {
  const tag = uniqueTag();
  const account = {
    firstname: overrides.firstname || "E2EParent",
    lastname: overrides.lastname || `Par${tag.slice(-6)}`,
    email: overrides.email || `e2e-parent-${tag}@boisegems.test`,
    phone: overrides.phone || `(208) 555-${String(Math.floor(Math.random() * 9000) + 1000)}`,
    address: overrides.address || "200 E2E Parent St, Boise, ID",
    birthday: overrides.birthday || "1980-03-20",
    password: overrides.password || PASSWORD,
  };

  await page.goto("/register-parent");
  await dismissTestSiteOverlay(page);
  await page.locator('input[name="firstname"]').fill(account.firstname);
  await page.locator('input[name="lastname"]').fill(account.lastname);
  await page.locator('input[name="phone"]').fill(account.phone);
  await page.locator('input[name="email"]').fill(account.email);
  await page.locator('input[name="address"]').fill(account.address);
  await page.locator('input[name="birthday"]').fill(account.birthday);
  await page.locator('input[name="password"]').fill(account.password);
  await page.locator('input[name="passwordRetype"]').fill(account.password);
  await page.locator('form[action="/register-parent"] button[type="submit"]').click();

  await page.waitForLoadState("domcontentloaded");
  const errors = page.locator(".error-box");
  if (await errors.count()) {
    const msgs = await errors.allTextContents();
    throw new Error(`Parent registration failed: ${msgs.join("; ")}`);
  }
  await dismissTestSiteOverlay(page);
  // Parent register currently redirects toward member-portal then away; land on parent portal.
  await page.goto("/parent-portal");
  await dismissTestSiteOverlay(page);
  await expect(page).toHaveURL(/parent-portal/);
  return account;
}

async function requestParentLink(page, targetEmail) {
  const result = await page.evaluate(async (email) => {
    const res = await fetch("/api/web/parent-link/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    return res.json();
  }, targetEmail);
  if (!result.ok) {
    throw new Error(`Parent link request failed: ${result.message || JSON.stringify(result)}`);
  }
  return result;
}

async function acceptIncomingParentLink(page) {
  const incoming = await page.evaluate(async () => {
    const res = await fetch("/api/web/parent-link/requests/incoming");
    return res.json();
  });
  if (!incoming.ok || !incoming.requests || !incoming.requests.length) {
    throw new Error("No incoming parent-link requests to accept");
  }
  const reqId = incoming.requests[0].id;
  const accepted = await page.evaluate(async (id) => {
    const res = await fetch(`/api/web/parent-link/requests/${id}/accept`, { method: "POST" });
    return res.json();
  }, reqId);
  if (!accepted.ok) {
    throw new Error(`Accept link failed: ${accepted.message || JSON.stringify(accepted)}`);
  }
  return accepted;
}

module.exports = {
  uniqueTag,
  loginWithCredentials,
  logout,
  registerMember,
  registerParent,
  requestParentLink,
  acceptIncomingParentLink,
  loginAs,
  PASSWORD,
};
