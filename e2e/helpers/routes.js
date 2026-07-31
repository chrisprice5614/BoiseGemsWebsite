/** Public marketing / content pages that should load for anonymous visitors. */
const PUBLIC_PAGES = [
  { path: "/", text: /Boise Gems/i },
  { path: "/login", text: /login|email|password/i },
  { path: "/register", text: /register|account/i },
  { path: "/register-member", text: /member|register/i },
  { path: "/register-parent", text: /parent|register/i },
  { path: "/forgot-password", text: /forgot|password|email/i },
  { path: "/contact", text: /contact/i },
  { path: "/privacy", text: /privacy/i },
  { path: "/donate", text: /donat/i },
  { path: "/volunteer", text: /volunteer/i },
  { path: "/press-kit", text: /press|kit|media/i },
  { path: "/news", text: /news|announcement|post/i },
  { path: "/calendar", text: /calendar|event|schedule/i },
  { path: "/shows", text: /show/i },
  { path: "/shows/2026-the-color-of-chaos", text: /color|chaos|show/i },
  { path: "/shows/2026-dreams-of-freedom", text: /dream|freedom|show/i },
  { path: "/shows/2025-the-animated", text: /animated|show/i },
  { path: "/shows/2024-ghost-stallion", text: /ghost|stallion|show/i },
  { path: "/shows/2023-esto-perpetua", text: /esto|perpetua|show/i },
  { path: "/robots.txt", text: /User-agent|Disallow|Allow/i },
];

/** Admin portal destinations (require admin login). */
const ADMIN_PAGES = [
  "/admin-portal",
  "/edit-users",
  "/events-admin",
  "/news-admin",
  "/edit-forms",
  "/add-form",
  "/set-tuition",
  "/pay-history",
  "/email-members",
  "/admin/pending-contracts",
  "/admin/contract-extensions",
  "/admin/contracted-members",
  "/admin/contract-history",
  "/admin/expired-contracts",
  "/admin/season-roster",
  "/admin/instrument-checkout",
  "/admin/instrument-history",
  "/admin/volunteer-needs",
  "/admin/join-corps",
  "/admin/board-of-directors",
  "/admin/donors",
  "/admin/press-kit",
  "/admin/subscriptions",
  "/admin/member-view",
  "/admin/monitoring",
  "/admin/season",
  "/admin/roles",
  "/admin/audit-log",
  "/admin/login-history",
  "/staff-admin",
  "/set-materials",
  "/staff/members",
];

/** Staff-accessible pages. */
const STAFF_PAGES = [
  "/staff/members",
  "/set-materials",
  "/admin/season-roster",
];

/** Member portal pages. */
const MEMBER_PAGES = [
  "/member-portal",
  "/member-forms",
  "/member-transactions",
  "/update-info",
  "/update-profile-photo",
  "/update-emergency",
  "/allergy-info",
  "/make-payment",
];

/** Parent portal pages. */
const PARENT_PAGES = [
  "/parent-portal",
  "/update-info",
  "/claim-child",
];

/** Fan portal pages. */
const FAN_PAGES = [
  "/fan-portal",
  "/update-info",
];

module.exports = {
  PUBLIC_PAGES,
  ADMIN_PAGES,
  STAFF_PAGES,
  MEMBER_PAGES,
  PARENT_PAGES,
  FAN_PAGES,
};
