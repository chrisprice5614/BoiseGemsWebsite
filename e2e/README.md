# Playwright E2E

## Setup
```bash
npm install
npx playwright install chromium
npm run seed:e2e
```

## Run
```bash
npm run test:e2e
# or interactive UI
npm run test:e2e:ui
```

Tests auto-start the app on port **2319** with `test_site=true` and `E2E_BYPASS_MFA=true` so admin login works without email OTP.

## Accounts (seeded)
Password for all: `E2eTestPass1!`

| Role | Email |
|------|-------|
| Admin | e2e-admin@boisegems.test |
| Staff | e2e-staff@boisegems.test |
| Member | e2e-member@boisegems.test |
| Parent | e2e-parent@boisegems.test |
| Fan | e2e-fan@boisegems.test |

## Coverage
- Public marketing/content pages
- Auth (login fail/success, register pages, logout)
- Member / parent / fan portals
- Admin hubs (users, contracts, season, roles, monitoring, exports surfaces)
- Staff tools
- Messaging permission APIs
- Files / calendar / support surfaces
- Medical info, parent/child linking, charges/payments, audit log

Add new routes to `e2e/helpers/routes.js` so smoke coverage stays complete.

## Creating accounts in tests
On the Playwright test server (`test_site=true`), reCAPTCHA is bypassed so `/register-member` and `/register-parent` can create real users. Look for emails like `e2e-child-*@boisegems.test` / `e2e-parent-*@boisegems.test` and matching rows in `/admin/audit-log` (`medical_access`, `financial_change`).
