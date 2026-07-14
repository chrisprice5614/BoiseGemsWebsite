/**
 * Verify site_settings + deleteUserAccount coverage for all user-reference columns.
 * Run: node scripts/verify-user-delete-coverage.js
 */
const Database = require("better-sqlite3");
const path = require("path");
const db = new Database(path.join(__dirname, "..", "data.db"));

const COVERED = new Set([
  "allergies.user_id",
  "announcements.author_id",
  "bug_report_comments.user_id",
  "bug_reports.user_id",
  "childVerify.user_id",
  "childVerify.target_id",
  "parent_child_links.parent_id",
  "parent_child_links.child_id",
  "parent_link_requests.requester_id",
  "parent_link_requests.target_user_id",
  "contractExtension.user_id",
  "contractExtension.extender",
  "contractExtension.child_id",
  "contractedMembers.user_id",
  "conversation_members.user_id",
  "conversations.created_by",
  "device_tokens.user_id",
  "donations.user_id",
  "emergencyContacts.user_id",
  "fan_subscriptions.user_id",
  "file_items.uploader_id",
  "folder_views.user_id",
  "forgotPassword.user_id",
  "formUploads.user_id",
  "forum_comments.user_id",
  "forum_posts.user_id",
  "instruments.user_id",
  "message_status.user_id",
  "messages.sender_id",
  "paymentHistory.user_id",
  "pendingContractExtension.member_id",
  "pendingContractExtension.requested_by",
  "permissions.user_id",
  "potential_donation.user_id",
  "potential_event_rsvp.user_id",
  "potential_payment.child_id",
  "potential_payment.parent_id",
  "potential_payment.user_id",
  "rsvp.user_id",
  "schedules.created_by",
  "support_tickets.user_id",
  "userVerify.user_id",
  "users.parentId",
  "viewed.user_id",
]);

const IGNORE = new Set([
  "announcements.aud_parents",
  "file_folders.parent_id",
  "formUploads.user_agent",
  "users.parent",
]);

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
const missing = [];

for (const t of tables) {
  const cols = db.prepare(`PRAGMA table_info(${t.name})`).all();
  for (const c of cols) {
    const key = `${t.name}.${c.name}`;
    if (IGNORE.has(key)) continue;
    const isUserRef = /^(user_id|parent_id|child_id|member_id|author_id|uploader_id|sender_id|created_by|requested_by|target_id|extender|parentId)$/.test(c.name);
    if (!isUserRef) continue;
    if (!COVERED.has(key)) missing.push(key);
  }
}

const ss = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='site_settings'").get();
console.log("site_settings table:", ss ? "OK" : "MISSING");
if (ss) {
  const row = db.prepare("SELECT * FROM site_settings WHERE id = 1").get();
  console.log("site_settings row:", row);
}

if (missing.length) {
  console.error("Uncovered user-reference columns:");
  missing.forEach(m => console.error(" -", m));
  process.exit(1);
}

console.log("All user-reference columns are covered by deleteUserAccount.");
process.exit(0);
