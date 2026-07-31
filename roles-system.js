/**
 * Roles, permissions, MFA (email OTP), sessions, audit log, login history,
 * shared season settings, and contract/assignment expiry.
 */
const crypto = require("crypto");
const bcrypt = require("bcrypt");

const LEAD_ADMIN_EMAIL = "chrisprice5614@gmail.com";
const MFA_TTL_MS = 10 * 60 * 1000;
const EXPIRY_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SEASON = 2027;
const DEFAULT_SEASON_END = "2027-12-31";

const PERMISSION_KEYS = [
  { key: "admin_portal", label: "Admin portal", group: "Portal" },
  { key: "staff_portal", label: "Staff portal", group: "Portal" },
  { key: "manage_season", label: "Manage season", group: "Portal" },
  { key: "manage_roles", label: "Manage roles", group: "Portal" },
  { key: "manage_users", label: "Manage users", group: "Portal" },
  { key: "deactivate_users", label: "Deactivate users", group: "Portal" },
  { key: "force_logout", label: "Force logout users", group: "Portal" },
  { key: "view_medical", label: "View medical", group: "Sensitive" },
  { key: "edit_medical", label: "Edit medical", group: "Sensitive" },
  { key: "view_financial", label: "View financial", group: "Sensitive" },
  { key: "edit_financial", label: "Edit financial", group: "Sensitive" },
  { key: "view_disciplinary", label: "View disciplinary", group: "Sensitive" },
  { key: "view_background_check", label: "View background checks", group: "Sensitive" },
  { key: "view_minor_info", label: "View minor information", group: "Sensitive" },
  { key: "download_sensitive_files", label: "Download sensitive files", group: "Sensitive" },
  { key: "manage_contracts", label: "Manage contracts", group: "Domain" },
  { key: "extend_contracts", label: "Extend contracts", group: "Domain" },
  { key: "manage_rosters", label: "Manage rosters", group: "Domain" },
  { key: "manage_forms", label: "Manage forms", group: "Domain" },
  { key: "manage_files", label: "Manage files", group: "Domain" },
  { key: "manage_schedule", label: "Manage schedule", group: "Domain" },
  { key: "view_staff_records", label: "View staff records", group: "Domain" },
  { key: "edit_staff_records", label: "Edit staff records", group: "Domain" },
  { key: "msg_create_direct", label: "Create direct message chats", group: "Messaging" },
  { key: "msg_create_group", label: "Create & name group chats", group: "Messaging" },
  { key: "msg_message_corps_contracted", label: "Message corps contracted members", group: "Messaging" },
  { key: "msg_message_independent_contracted", label: "Message independent contracted members", group: "Messaging" },
  { key: "msg_message_noncontracted", label: "Message non-contracted members", group: "Messaging" },
  { key: "msg_message_parents", label: "Message parents/guardians", group: "Messaging" },
  { key: "msg_message_corps_staff", label: "Message corps staff", group: "Messaging" },
  { key: "msg_message_independent_staff", label: "Message independent staff", group: "Messaging" },
  { key: "view_audit_log", label: "View audit log", group: "Audit" },
  { key: "view_login_history", label: "View login history", group: "Audit" },
];

const ALL_PERMISSION_KEYS = PERMISSION_KEYS.map((p) => p.key);

const MSG_STAFF_PERMS = [
  "msg_create_direct",
  "msg_create_group",
  "msg_message_corps_contracted",
  "msg_message_independent_contracted",
  "msg_message_noncontracted",
  "msg_message_parents",
  "msg_message_corps_staff",
  "msg_message_independent_staff",
];

const MSG_CORPS_PERMS = [
  "msg_create_direct",
  "msg_create_group",
  "msg_message_corps_contracted",
  "msg_message_noncontracted",
  "msg_message_parents",
  "msg_message_corps_staff",
];

const MSG_INDEPENDENT_PERMS = [
  "msg_create_direct",
  "msg_create_group",
  "msg_message_independent_contracted",
  "msg_message_noncontracted",
  "msg_message_parents",
  "msg_message_independent_staff",
];

const MESSAGE_AUDIENCES = [
  { key: "corps_staff", label: "Corps staff", permission: "msg_message_corps_staff" },
  { key: "independent_staff", label: "Independent staff", permission: "msg_message_independent_staff" },
  { key: "corps_contracted", label: "Corps contracted members", permission: "msg_message_corps_contracted" },
  { key: "independent_contracted", label: "Independent contracted members", permission: "msg_message_independent_contracted" },
  { key: "noncontracted", label: "Non-contracted members", permission: "msg_message_noncontracted" },
  { key: "parents", label: "Parents / guardians", permission: "msg_message_parents" },
];

function staffBase(extra) {
  return ["staff_portal", "view_minor_info", ...extra];
}

const SYSTEM_ROLES = [
  {
    slug: "super-administrator",
    name: "Super administrator",
    description: "Full system access (all programs)",
    requires_mfa: 1,
    default_program: null,
    permissions: ALL_PERMISSION_KEYS,
  },
  {
    slug: "executive-director",
    name: "Executive director",
    description: "Organization leadership (all programs)",
    requires_mfa: 1,
    default_program: null,
    permissions: ALL_PERMISSION_KEYS.filter((k) => k !== "manage_roles"),
  },
  {
    slug: "corps-program-director",
    name: "Corps/program director",
    description: "Corps program leadership",
    requires_mfa: 1,
    default_program: "corps",
    permissions: [
      "admin_portal", "staff_portal", "manage_users", "manage_contracts", "extend_contracts",
      "manage_rosters", "manage_forms", "manage_files", "manage_schedule",
      "view_staff_records", "view_minor_info", "download_sensitive_files",
      ...MSG_CORPS_PERMS,
    ],
  },
  {
    slug: "independent-program-director",
    name: "Independent program director",
    description: "Independent program leadership",
    requires_mfa: 1,
    default_program: "independent",
    permissions: [
      "admin_portal", "staff_portal", "manage_users", "manage_contracts", "extend_contracts",
      "manage_rosters", "manage_forms", "manage_files", "manage_schedule",
      "view_staff_records", "view_minor_info", "download_sensitive_files",
      ...MSG_INDEPENDENT_PERMS,
    ],
  },
  {
    slug: "administrative-director",
    name: "Administrative director",
    description: "Administrative operations (all programs)",
    requires_mfa: 1,
    default_program: null,
    permissions: [
      "admin_portal", "staff_portal", "manage_users", "deactivate_users", "force_logout",
      "manage_contracts", "extend_contracts", "manage_forms", "manage_files",
      "view_financial", "edit_financial", "view_minor_info", "view_audit_log", "view_login_history",
      ...MSG_STAFF_PERMS,
    ],
  },
  {
    slug: "operations-director",
    name: "Operations director",
    description: "Day-to-day operations (all programs)",
    requires_mfa: 1,
    default_program: null,
    permissions: [
      "admin_portal", "staff_portal", "manage_rosters", "manage_schedule", "manage_files",
      "manage_forms", "extend_contracts", "view_staff_records",
      ...MSG_STAFF_PERMS,
    ],
  },
  {
    slug: "medical-staff-corps",
    name: "Medical staff (Corps)",
    description: "Corps medical and allergy information",
    requires_mfa: 0,
    default_program: "corps",
    permissions: staffBase(["view_medical", "edit_medical", "download_sensitive_files", ...MSG_CORPS_PERMS]),
  },
  {
    slug: "medical-staff-independent",
    name: "Medical staff (Independent)",
    description: "Independent medical and allergy information",
    requires_mfa: 0,
    default_program: "independent",
    permissions: staffBase(["view_medical", "edit_medical", "download_sensitive_files", ...MSG_INDEPENDENT_PERMS]),
  },
  {
    slug: "food-staff-corps",
    name: "Food staff (Corps)",
    description: "Corps food service and allergy awareness",
    requires_mfa: 0,
    default_program: "corps",
    permissions: staffBase(["view_medical", ...MSG_CORPS_PERMS.filter((k) => k !== "msg_create_group")]),
  },
  {
    slug: "food-staff-independent",
    name: "Food staff (Independent)",
    description: "Independent food service and allergy awareness",
    requires_mfa: 0,
    default_program: "independent",
    permissions: staffBase(["view_medical", ...MSG_INDEPENDENT_PERMS.filter((k) => k !== "msg_create_group")]),
  },
  {
    slug: "caption-head-corps",
    name: "Caption head (Corps)",
    description: "Corps caption leadership",
    requires_mfa: 0,
    default_program: "corps",
    permissions: staffBase([
      "manage_rosters", "manage_files", "manage_schedule", "extend_contracts", ...MSG_CORPS_PERMS,
    ]),
  },
  {
    slug: "caption-head-independent",
    name: "Caption head (Independent)",
    description: "Independent caption leadership",
    requires_mfa: 0,
    default_program: "independent",
    permissions: staffBase([
      "manage_rosters", "manage_files", "manage_schedule", "extend_contracts", ...MSG_INDEPENDENT_PERMS,
    ]),
  },
  {
    slug: "instructional-staff-corps",
    name: "Instructional staff (Corps)",
    description: "Corps instruction and rehearsals",
    requires_mfa: 0,
    default_program: "corps",
    permissions: staffBase([
      "manage_files", "manage_schedule", "extend_contracts", ...MSG_CORPS_PERMS,
    ]),
  },
  {
    slug: "instructional-staff-independent",
    name: "Instructional staff (Independent)",
    description: "Independent instruction and rehearsals",
    requires_mfa: 0,
    default_program: "independent",
    permissions: staffBase([
      "manage_files", "manage_schedule", "extend_contracts", ...MSG_INDEPENDENT_PERMS,
    ]),
  },
];

const LEGACY_ROLE_MIGRATIONS = {
  "medical-staff": "medical-staff-corps",
  "food-staff": "food-staff-corps",
  "caption-head": "caption-head-corps",
  "instructional-staff": "instructional-staff-corps",
};

function ensureColumn(db, table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${ddl}`).run();
  }
}

function initRolesTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      is_system INTEGER NOT NULL DEFAULT 0,
      requires_mfa INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS role_permissions (
      role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      permission_key TEXT NOT NULL,
      PRIMARY KEY (role_id, permission_key)
    );

    CREATE TABLE IF NOT EXISTS user_role_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      program TEXT,
      season_year INTEGER,
      department TEXT,
      assignment_label TEXT,
      starts_at INTEGER,
      ends_at INTEGER,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ura_user ON user_role_assignments(user_id);
    CREATE INDEX IF NOT EXISTS idx_ura_active ON user_role_assignments(active);

    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      revoked_at INTEGER,
      user_agent TEXT,
      ip TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);

    CREATE TABLE IF NOT EXISTS mfa_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      consumed_at INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS login_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      email TEXT,
      success INTEGER NOT NULL DEFAULT 0,
      ip TEXT,
      user_agent TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_login_history_created ON login_history(created_at DESC);

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id INTEGER,
      actor_email TEXT,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      meta_json TEXT,
      ip TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
  `);

  ensureColumn(db, "site_settings", "current_season", `current_season INTEGER NOT NULL DEFAULT ${DEFAULT_SEASON}`);
  ensureColumn(db, "site_settings", "season_end_date", `season_end_date TEXT NOT NULL DEFAULT '${DEFAULT_SEASON_END}'`);
  ensureColumn(db, "users", "corps_contract_ends_at", "corps_contract_ends_at INTEGER");
  ensureColumn(db, "users", "independent_contract_ends_at", "independent_contract_ends_at INTEGER");
  ensureColumn(db, "users", "affiliate_contract_ends_at", "affiliate_contract_ends_at INTEGER");
  ensureColumn(db, "users", "deactivated_at", "deactivated_at INTEGER");
  ensureColumn(db, "users", "deactivated_reason", "deactivated_reason TEXT");
  ensureColumn(db, "contractedMembers", "ends_at", "ends_at INTEGER");
  ensureColumn(db, "file_items", "sensitive", "sensitive INTEGER NOT NULL DEFAULT 0");

  const ss = db.prepare("SELECT current_season, season_end_date FROM site_settings WHERE id = 1").get();
  if (ss) {
    if (!ss.current_season || Number(ss.current_season) < DEFAULT_SEASON) {
      db.prepare("UPDATE site_settings SET current_season = ? WHERE id = 1").run(DEFAULT_SEASON);
    }
    if (!ss.season_end_date) {
      db.prepare("UPDATE site_settings SET season_end_date = ? WHERE id = 1").run(DEFAULT_SEASON_END);
    }
  }

  seedSystemRoles(db);
  migrateLegacyRoles(db);
  backfillUserRoles(db);
}

function seedSystemRoles(db) {
  const now = Date.now();
  const insertRole = db.prepare(`
    INSERT INTO roles (slug, name, description, is_system, requires_mfa, created_at)
    VALUES (?, ?, ?, 1, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      is_system = 1,
      requires_mfa = excluded.requires_mfa
  `);
  const getRole = db.prepare("SELECT id FROM roles WHERE slug = ?");
  const insertPerm = db.prepare(
    "INSERT OR IGNORE INTO role_permissions (role_id, permission_key) VALUES (?, ?)"
  );

  for (const role of SYSTEM_ROLES) {
    insertRole.run(role.slug, role.name, role.description || "", role.requires_mfa ? 1 : 0, now);
    const row = getRole.get(role.slug);
    if (!row) continue;
    for (const key of role.permissions) {
      insertPerm.run(row.id, key);
    }
  }
}

function migrateLegacyRoles(db) {
  const now = Date.now();
  for (const [oldSlug, newSlug] of Object.entries(LEGACY_ROLE_MIGRATIONS)) {
    const oldRole = db.prepare("SELECT id FROM roles WHERE slug = ?").get(oldSlug);
    const newRole = db.prepare("SELECT id FROM roles WHERE slug = ?").get(newSlug);
    if (!oldRole || !newRole) continue;
    const assignments = db.prepare("SELECT * FROM user_role_assignments WHERE role_id = ?").all(oldRole.id);
    for (const a of assignments) {
      const exists = db.prepare(`
        SELECT id FROM user_role_assignments
        WHERE user_id = ? AND role_id = ? AND active = 1
          AND IFNULL(program,'') = IFNULL(?, '')
        LIMIT 1
      `).get(a.user_id, newRole.id, a.program || "corps");
      if (!exists) {
        db.prepare(`
          INSERT INTO user_role_assignments
            (user_id, role_id, program, season_year, department, assignment_label, starts_at, ends_at, active, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          a.user_id,
          newRole.id,
          a.program || "corps",
          a.season_year,
          a.department,
          a.assignment_label || "migrated",
          a.starts_at,
          a.ends_at,
          a.active,
          now
        );
      }
      db.prepare("UPDATE user_role_assignments SET active = 0 WHERE id = ?").run(a.id);
    }
    db.prepare(`
      UPDATE roles SET is_system = 0, description = COALESCE(description,'') || ' (legacy - use Corps/Independent variants)'
      WHERE id = ? AND description NOT LIKE '%legacy%'
    `).run(oldRole.id);
  }
}

function backfillUserRoles(db) {
  const now = Date.now();
  const superRole = db.prepare("SELECT id FROM roles WHERE slug = 'super-administrator'").get();
  const staffRole = db.prepare("SELECT id FROM roles WHERE slug = 'instructional-staff-corps'").get()
    || db.prepare("SELECT id FROM roles WHERE slug = 'instructional-staff'").get();
  if (!superRole || !staffRole) return;

  const hasAssignment = db.prepare(
    "SELECT id FROM user_role_assignments WHERE user_id = ? AND role_id = ? LIMIT 1"
  );
  const insert = db.prepare(`
    INSERT INTO user_role_assignments
      (user_id, role_id, program, season_year, department, assignment_label, starts_at, ends_at, active, created_at)
    VALUES (?, ?, ?, NULL, NULL, 'backfill', ?, NULL, 1, ?)
  `);

  const admins = db.prepare("SELECT id FROM users WHERE admin = 1").all();
  for (const u of admins) {
    if (!hasAssignment.get(u.id, superRole.id)) {
      insert.run(u.id, superRole.id, null, now, now);
    }
  }

  const staff = db.prepare("SELECT id FROM users WHERE staff = 1 AND (admin IS NULL OR admin = 0)").all();
  for (const u of staff) {
    const any = db.prepare("SELECT id FROM user_role_assignments WHERE user_id = ? LIMIT 1").get(u.id);
    if (!any) {
      insert.run(u.id, staffRole.id, "corps", now, now);
    }
  }
}

function getCurrentSeason(db) {
  try {
    const row = db.prepare("SELECT current_season FROM site_settings WHERE id = 1").get();
    const n = Number(row && row.current_season);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_SEASON;
  } catch {
    return DEFAULT_SEASON;
  }
}

function getSeasonEndDate(db) {
  try {
    const row = db.prepare("SELECT season_end_date FROM site_settings WHERE id = 1").get();
    return (row && row.season_end_date) || DEFAULT_SEASON_END;
  } catch {
    return DEFAULT_SEASON_END;
  }
}

function seasonEndDateToMs(isoDate) {
  if (!isoDate) return null;
  const d = new Date(String(isoDate) + "T23:59:59.999Z");
  const t = d.getTime();
  return Number.isFinite(t) ? t : null;
}

function getDefaultContractEndsAt(db) {
  return seasonEndDateToMs(getSeasonEndDate(db));
}

function validateStrongPassword(password) {
  const errors = [];
  const p = String(password || "");
  if (p.length < 12) errors.push("Password must be at least 12 characters long");
  if (!/[A-Z]/.test(p)) errors.push("Password must include an uppercase letter");
  if (!/[a-z]/.test(p)) errors.push("Password must include a lowercase letter");
  if (!/[0-9]/.test(p)) errors.push("Password must include a number");
  if (!/[^A-Za-z0-9]/.test(p)) errors.push("Password must include a special character");
  return errors;
}

function clientIp(req) {
  if (!req) return null;
  const xf = req.headers && (req.headers["x-forwarded-for"] || req.headers["x-real-ip"]);
  if (xf) return String(xf).split(",")[0].trim();
  return req.ip || null;
}

function getMessagingCapabilities(db, userId) {
  const perms = getUserPermissionSet(db, userId);
  const isStaffish = !!(
    db.prepare("SELECT 1 AS ok FROM users WHERE id = ? AND (admin = 1 OR staff = 1)").get(userId) ||
    perms.has("staff_portal") ||
    perms.has("admin_portal")
  );
  const audiences = MESSAGE_AUDIENCES.filter((a) => perms.has(a.permission)).map((a) => ({
    key: a.key,
    label: a.label,
  }));
  return {
    createDirect: perms.has("msg_create_direct"),
    createGroup: perms.has("msg_create_group"),
    canStartChats: perms.has("msg_create_direct") || perms.has("msg_create_group"),
    isStaffish,
    audiences,
    messageCorpsContracted: perms.has("msg_message_corps_contracted"),
    messageIndependentContracted: perms.has("msg_message_independent_contracted"),
    messageNoncontracted: perms.has("msg_message_noncontracted"),
    messageParents: perms.has("msg_message_parents"),
    messageCorpsStaff: perms.has("msg_message_corps_staff"),
    messageIndependentStaff: perms.has("msg_message_independent_staff"),
  };
}

function userIsCorpsStaff(db, userId) {
  const u = db.prepare("SELECT admin, staff FROM users WHERE id = ?").get(userId);
  if (!u || (!(u.admin || u.staff) && !hasPermission(db, userId, "staff_portal"))) return false;
  const row = db.prepare(`
    SELECT 1 AS ok
    FROM user_role_assignments ura
    JOIN roles r ON r.id = ura.role_id
    WHERE ura.user_id = ? AND ura.active = 1
      AND (
        ura.program = 'corps'
        OR r.slug LIKE '%corps%'
        OR (ura.program IS NULL AND r.slug NOT LIKE '%independent%')
      )
    LIMIT 1
  `).get(userId);
  if (row) return true;
  // Admin / staff with no program-specific assignment still count as corps staff for org-wide roles
  return !!(u.admin || u.staff);
}

function userIsIndependentStaff(db, userId) {
  const u = db.prepare("SELECT admin, staff FROM users WHERE id = ?").get(userId);
  if (!u) return false;
  const row = db.prepare(`
    SELECT 1 AS ok
    FROM user_role_assignments ura
    JOIN roles r ON r.id = ura.role_id
    WHERE ura.user_id = ? AND ura.active = 1
      AND (ura.program = 'independent' OR r.slug LIKE '%independent%')
    LIMIT 1
  `).get(userId);
  return !!row;
}

function resolveAudienceUserIds(db, audienceKeys, excludeUserId) {
  const keys = new Set([].concat(audienceKeys || []).map(String));
  const ids = new Set();
  const addRows = (rows) => {
    for (const r of rows) {
      if (Number(r.id) !== Number(excludeUserId)) ids.add(Number(r.id));
    }
  };

  if (keys.has("corps_contracted")) {
    addRows(db.prepare(`
      SELECT id FROM users
      WHERE contractedCorps = 1
        AND (parent IS NULL OR parent = 0)
        AND (fan IS NULL OR fan = 0)
        AND (admin IS NULL OR admin = 0)
        AND (staff IS NULL OR staff = 0)
        AND deactivated_at IS NULL
    `).all());
  }
  if (keys.has("independent_contracted")) {
    addRows(db.prepare(`
      SELECT id FROM users
      WHERE contractedIndependent = 1
        AND (parent IS NULL OR parent = 0)
        AND (fan IS NULL OR fan = 0)
        AND (admin IS NULL OR admin = 0)
        AND (staff IS NULL OR staff = 0)
        AND deactivated_at IS NULL
    `).all());
  }
  if (keys.has("noncontracted")) {
    addRows(db.prepare(`
      SELECT id FROM users
      WHERE (parent IS NULL OR parent = 0)
        AND (fan IS NULL OR fan = 0)
        AND (admin IS NULL OR admin = 0)
        AND (staff IS NULL OR staff = 0)
        AND COALESCE(contractedCorps,0) = 0
        AND COALESCE(contractedIndependent,0) = 0
        AND COALESCE(contractedAffiliate,0) = 0
        AND deactivated_at IS NULL
    `).all());
  }
  if (keys.has("parents")) {
    addRows(db.prepare(`
      SELECT id FROM users WHERE parent = 1 AND deactivated_at IS NULL
    `).all());
  }
  if (keys.has("corps_staff") || keys.has("independent_staff")) {
    const staffUsers = db.prepare(`
      SELECT id, admin, staff FROM users
      WHERE (admin = 1 OR staff = 1) AND deactivated_at IS NULL
    `).all();
    for (const u of staffUsers) {
      if (keys.has("corps_staff") && userIsCorpsStaff(db, u.id)) ids.add(Number(u.id));
      if (keys.has("independent_staff") && userIsIndependentStaff(db, u.id)) ids.add(Number(u.id));
    }
  }

  return [...ids];
}

function canMessageTargetUser(db, actorId, targetUser) {
  if (!targetUser) return false;
  const caps = getMessagingCapabilities(db, actorId);
  if (Number(targetUser.parent) === 1) return caps.messageParents;
  if (Number(targetUser.admin) === 1 || Number(targetUser.staff) === 1) {
    const corps = userIsCorpsStaff(db, targetUser.id);
    const ind = userIsIndependentStaff(db, targetUser.id);
    if (corps && caps.messageCorpsStaff) return true;
    if (ind && caps.messageIndependentStaff) return true;
    // Org-wide staff/admin with no independent assignment: allow via corps staff perm
    if (!ind && caps.messageCorpsStaff) return true;
    return false;
  }
  const contractedCorps = Number(targetUser.contractedCorps) === 1;
  const contractedInd = Number(targetUser.contractedIndependent) === 1;
  if (contractedCorps && caps.messageCorpsContracted) return true;
  if (contractedInd && caps.messageIndependentContracted) return true;
  if (!contractedCorps && !contractedInd && Number(targetUser.contractedAffiliate) !== 1) {
    return caps.messageNoncontracted;
  }
  if (Number(targetUser.contractedAffiliate) === 1 && caps.messageCorpsContracted) return true;
  return false;
}

function filterUsersForMessaging(db, actorId, users) {
  return (users || []).filter((u) => canMessageTargetUser(db, actorId, u));
}

function recordLogin(db, { userId = null, email = null, success = false, req = null } = {}) {
  db.prepare(`
    INSERT INTO login_history (user_id, email, success, ip, user_agent, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    email ? String(email).toLowerCase() : null,
    success ? 1 : 0,
    clientIp(req),
    req && req.headers ? String(req.headers["user-agent"] || "").slice(0, 500) : null,
    Date.now()
  );
}

function writeAudit(db, req, action, { targetType = null, targetId = null, meta = null } = {}) {
  const actorId = req && req.user ? req.user.userid : null;
  const actorEmail = req && req.user ? req.user.email : null;
  db.prepare(`
    INSERT INTO audit_log (actor_id, actor_email, action, target_type, target_id, meta_json, ip, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    actorId,
    actorEmail,
    action,
    targetType,
    targetId != null ? String(targetId) : null,
    meta != null ? JSON.stringify(meta).slice(0, 8000) : null,
    clientIp(req),
    Date.now()
  );
}

function getActiveAssignments(db, userId) {
  const now = Date.now();
  return db.prepare(`
    SELECT ura.*, r.slug AS role_slug, r.name AS role_name, r.requires_mfa
    FROM user_role_assignments ura
    JOIN roles r ON r.id = ura.role_id
    WHERE ura.user_id = ?
      AND ura.active = 1
      AND (ura.starts_at IS NULL OR ura.starts_at <= ?)
      AND (ura.ends_at IS NULL OR ura.ends_at >= ?)
  `).all(userId, now, now);
}

function getUserPermissionSet(db, userId, scope = {}) {
  const user = db.prepare("SELECT id, admin, email, deactivated_at FROM users WHERE id = ?").get(userId);
  if (!user || user.deactivated_at) return new Set();

  // Legacy admin flag or lead admin email → full access
  if (Number(user.admin) === 1 || String(user.email || "").toLowerCase() === LEAD_ADMIN_EMAIL) {
    return new Set(ALL_PERMISSION_KEYS);
  }

  const assignments = getActiveAssignments(db, userId);
  const perms = new Set();
  const season = scope.season_year != null ? Number(scope.season_year) : null;
  const program = scope.program ? String(scope.program).toLowerCase() : null;

  for (const a of assignments) {
    if (a.season_year != null && season != null && Number(a.season_year) !== season) continue;
    if (a.program && program && String(a.program).toLowerCase() !== program) continue;
    if (scope.department && a.department && String(a.department) !== String(scope.department)) continue;

    const keys = db.prepare("SELECT permission_key FROM role_permissions WHERE role_id = ?").all(a.role_id);
    for (const k of keys) perms.add(k.permission_key);
  }
  return perms;
}

function hasPermission(db, userId, permissionKey, scope = {}) {
  if (!userId || !permissionKey) return false;
  return getUserPermissionSet(db, userId, scope).has(permissionKey);
}

function userRequiresMfa(db, userRow) {
  if (!userRow) return false;
  if (Number(userRow.admin) === 1) return true;
  if (String(userRow.email || "").toLowerCase() === LEAD_ADMIN_EMAIL) return true;
  const assignments = getActiveAssignments(db, userRow.id);
  for (const a of assignments) {
    if (a.requires_mfa) return true;
    const hasAdminPortal = db
      .prepare("SELECT 1 AS ok FROM role_permissions WHERE role_id = ? AND permission_key = 'admin_portal'")
      .get(a.role_id);
    if (hasAdminPortal) return true;
  }
  return false;
}

function canManageSeason(db, userId) {
  if (!userId) return false;
  const user = db.prepare("SELECT id, admin, email FROM users WHERE id = ?").get(userId);
  if (!user) return false;
  if (String(user.email || "").toLowerCase() === LEAD_ADMIN_EMAIL) return true;
  if (hasPermission(db, userId, "manage_season")) return true;
  const assignments = getActiveAssignments(db, userId);
  return assignments.some((a) => a.role_slug === "executive-director" || a.role_slug === "super-administrator");
}

function createAuthSession(db, userId, req) {
  const id = crypto.randomUUID();
  const now = Date.now();
  db.prepare(`
    INSERT INTO auth_sessions (id, user_id, created_at, last_seen_at, revoked_at, user_agent, ip)
    VALUES (?, ?, ?, ?, NULL, ?, ?)
  `).run(
    id,
    userId,
    now,
    now,
    req && req.headers ? String(req.headers["user-agent"] || "").slice(0, 500) : null,
    clientIp(req)
  );
  return id;
}

function isSessionActive(db, sessionId, userId) {
  if (!sessionId || !userId) return false;
  const row = db.prepare("SELECT id, user_id, revoked_at FROM auth_sessions WHERE id = ?").get(sessionId);
  if (!row || row.revoked_at) return false;
  if (Number(row.user_id) !== Number(userId)) return false;
  db.prepare("UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?").run(Date.now(), sessionId);
  return true;
}

function revokeSession(db, sessionId) {
  if (!sessionId) return;
  db.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(Date.now(), sessionId);
}

function revokeAllSessionsForUser(db, userId, exceptSessionId = null) {
  if (exceptSessionId) {
    db.prepare(`
      UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND id != ?
    `).run(Date.now(), userId, exceptSessionId);
  } else {
    db.prepare(`
      UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL
    `).run(Date.now(), userId);
  }
}

function createMfaCode(db, userId) {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const codeHash = bcrypt.hashSync(code, 8);
  const now = Date.now();
  db.prepare("UPDATE mfa_codes SET consumed_at = ? WHERE user_id = ? AND consumed_at IS NULL").run(now, userId);
  db.prepare(`
    INSERT INTO mfa_codes (user_id, code_hash, expires_at, consumed_at, created_at)
    VALUES (?, ?, ?, NULL, ?)
  `).run(userId, codeHash, now + MFA_TTL_MS, now);
  return code;
}

function verifyMfaCode(db, userId, code) {
  const row = db.prepare(`
    SELECT * FROM mfa_codes
    WHERE user_id = ? AND consumed_at IS NULL
    ORDER BY created_at DESC LIMIT 1
  `).get(userId);
  if (!row) return false;
  if (row.expires_at < Date.now()) return false;
  const ok = bcrypt.compareSync(String(code || ""), row.code_hash);
  if (!ok) return false;
  db.prepare("UPDATE mfa_codes SET consumed_at = ? WHERE id = ?").run(Date.now(), row.id);
  return true;
}

function runExpiryJob(db) {
  const now = Date.now();
  db.prepare(`
    UPDATE user_role_assignments SET active = 0
    WHERE active = 1 AND ends_at IS NOT NULL AND ends_at < ?
  `).run(now);

  const corpsExpired = db.prepare(`
    SELECT id FROM users
    WHERE contractedCorps = 1 AND corps_contract_ends_at IS NOT NULL AND corps_contract_ends_at < ?
  `).all(now);
  for (const u of corpsExpired) {
    db.prepare("UPDATE users SET contractedCorps = 0, corps_contract_ends_at = NULL WHERE id = ?").run(u.id);
  }

  const indExpired = db.prepare(`
    SELECT id FROM users
    WHERE contractedIndependent = 1 AND independent_contract_ends_at IS NOT NULL AND independent_contract_ends_at < ?
  `).all(now);
  for (const u of indExpired) {
    db.prepare("UPDATE users SET contractedIndependent = 0, independent_contract_ends_at = NULL WHERE id = ?").run(u.id);
  }

  const affExpired = db.prepare(`
    SELECT id FROM users
    WHERE contractedAffiliate = 1 AND affiliate_contract_ends_at IS NOT NULL AND affiliate_contract_ends_at < ?
  `).all(now);
  for (const u of affExpired) {
    db.prepare("UPDATE users SET contractedAffiliate = 0, affiliate_contract_ends_at = NULL WHERE id = ?").run(u.id);
  }

  return {
    rolesExpired: db.prepare(`
      SELECT changes() AS c
    `).get(),
    corps: corpsExpired.length,
    independent: indExpired.length,
    affiliate: affExpired.length,
  };
}

function startExpiryScheduler(db) {
  const tick = () => {
    try {
      runExpiryJob(db);
    } catch (err) {
      console.error("roles expiry job failed:", err);
    }
  };
  tick();
  setInterval(tick, EXPIRY_INTERVAL_MS);
}

function listRoles(db) {
  return db.prepare(`
    SELECT r.*,
      (SELECT COUNT(*) FROM role_permissions rp WHERE rp.role_id = r.id) AS permission_count,
      (SELECT COUNT(*) FROM user_role_assignments ura WHERE ura.role_id = r.id AND ura.active = 1) AS assignment_count
    FROM roles r
    ORDER BY r.is_system DESC, r.name COLLATE NOCASE
  `).all();
}

function getRoleWithPermissions(db, roleId) {
  const role = db.prepare("SELECT * FROM roles WHERE id = ?").get(roleId);
  if (!role) return null;
  const perms = db.prepare("SELECT permission_key FROM role_permissions WHERE role_id = ?").all(roleId)
    .map((r) => r.permission_key);
  return { ...role, permissions: perms };
}

function setRolePermissions(db, roleId, keys) {
  const allowed = new Set(ALL_PERMISSION_KEYS);
  db.prepare("DELETE FROM role_permissions WHERE role_id = ?").run(roleId);
  const insert = db.prepare("INSERT INTO role_permissions (role_id, permission_key) VALUES (?, ?)");
  for (const key of keys || []) {
    if (allowed.has(key)) insert.run(roleId, key);
  }
}

function requirePermissionFactory(db, { redirectTo = "/" } = {}) {
  return function requirePermission(permissionKey, scopeFn) {
    return function (req, res, next) {
      if (!req.user) {
        if (req.path && req.path.startsWith("/api/")) {
          return res.status(401).json({ ok: false, message: "Unauthorized" });
        }
        return res.redirect(redirectTo);
      }
      const scope = typeof scopeFn === "function" ? scopeFn(req) : {};
      if (hasPermission(db, req.user.userid, permissionKey, scope || {})) {
        return next();
      }
      if (req.path && req.path.startsWith("/api/")) {
        return res.status(403).json({ ok: false, message: "Forbidden" });
      }
      return res.status(403).render("message", {
        message: "You do not have permission to access this resource.",
      });
    };
  };
}

function attachAuthHelpers(app, db, { jwt, sendEmail }) {
  // no-op placeholder if needed later
  void app;
  void jwt;
  void sendEmail;
}

function registerRolesRoutes(app, deps) {
  const {
    db,
    mustBeAdmin,
    sendEmail,
    jwt,
    issueLoginToken,
  } = deps;

  const requirePermission = requirePermissionFactory(db);

  // ── MFA verify ──────────────────────────────────────────
  app.get("/login/mfa", (req, res) => {
    if (!req.session.pendingMfaUserId) {
      return res.redirect("/login");
    }
    return res.render("login-mfa", { errors: [] });
  });

  app.post("/login/mfa", async (req, res) => {
    const userId = req.session.pendingMfaUserId;
    if (!userId) return res.redirect("/login");
    const code = String(req.body.code || "").trim();
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
    if (!user || user.deactivated_at) {
      delete req.session.pendingMfaUserId;
      return res.redirect("/login");
    }
    if (!verifyMfaCode(db, userId, code)) {
      recordLogin(db, { userId, email: user.email, success: false, req });
      return res.render("login-mfa", { errors: ["Invalid or expired code. Please try again."] });
    }
    delete req.session.pendingMfaUserId;
    if (typeof issueLoginToken === "function") {
      return issueLoginToken(req, res, user);
    }
    return res.redirect("/");
  });

  app.post("/login/mfa/resend", async (req, res) => {
    const userId = req.session.pendingMfaUserId;
    if (!userId) return res.redirect("/login");
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
    if (!user) return res.redirect("/login");
    const code = createMfaCode(db, userId);
    try {
      await sendEmail(
        user.email,
        "Boise Gems login verification code",
        `<h1>Your verification code</h1><p style="font-size:28px;letter-spacing:0.2em;font-weight:bold;">${code}</p><p>This code expires in 10 minutes.</p>`
      );
    } catch (err) {
      console.error("MFA resend failed:", err);
    }
    req.session.flashMessage = "A new code has been sent to your email.";
    return res.redirect("/login/mfa");
  });

  // ── Season ──────────────────────────────────────────────
  app.get("/admin/season", mustBeAdmin, (req, res) => {
    if (!canManageSeason(db, req.user.userid)) {
      return res.status(403).render("message", { message: "Only the executive director or lead admin can change the season." });
    }
    return res.render("admin-season", {
      currentSeason: getCurrentSeason(db),
      seasonEndDate: getSeasonEndDate(db),
      flashMessage: req.session.flashMessage || null,
    });
  });

  app.post("/admin/season", mustBeAdmin, (req, res) => {
    if (!canManageSeason(db, req.user.userid)) {
      return res.status(403).render("message", { message: "Only the executive director or lead admin can change the season." });
    }
    const season = parseInt(req.body.current_season, 10);
    const endDate = String(req.body.season_end_date || "").trim();
    if (!Number.isFinite(season) || season < 2000 || season > 2100) {
      req.session.flashMessage = "Invalid season year.";
      return res.redirect("/admin/season");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      req.session.flashMessage = "Season end date must be YYYY-MM-DD.";
      return res.redirect("/admin/season");
    }
    db.prepare("UPDATE site_settings SET current_season = ?, season_end_date = ?, updated_at = ? WHERE id = 1")
      .run(season, endDate, Date.now());
    writeAudit(db, req, "permission_change", {
      targetType: "season",
      targetId: String(season),
      meta: { season_end_date: endDate },
    });
    req.session.flashMessage = `Season set to ${season} (ends ${endDate}). Applies to both corps and independent.`;
    return res.redirect("/admin/season");
  });

  // ── Roles CRUD ──────────────────────────────────────────
  app.get("/admin/roles", mustBeAdmin, requirePermission("manage_roles"), (req, res) => {
    return res.render("admin-roles", {
      roles: listRoles(db),
      flashMessage: req.session.flashMessage || null,
      permissionKeys: PERMISSION_KEYS,
    });
  });

  app.get("/admin/roles/new", mustBeAdmin, requirePermission("manage_roles"), (req, res) => {
    return res.render("admin-role-edit", {
      role: null,
      permissions: [],
      permissionKeys: PERMISSION_KEYS,
      errors: [],
    });
  });

  app.post("/admin/roles/new", mustBeAdmin, requirePermission("manage_roles"), (req, res) => {
    const name = String(req.body.name || "").trim();
    const description = String(req.body.description || "").trim();
    const requiresMfa = req.body.requires_mfa === "on" || req.body.requires_mfa === "1" ? 1 : 0;
    const keys = [].concat(req.body.permissions || []);
    if (!name) {
      return res.render("admin-role-edit", {
        role: null,
        permissions: keys,
        permissionKeys: PERMISSION_KEYS,
        errors: ["Name is required."],
      });
    }
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || `role-${Date.now()}`;
    try {
      const info = db.prepare(`
        INSERT INTO roles (slug, name, description, is_system, requires_mfa, created_at)
        VALUES (?, ?, ?, 0, ?, ?)
      `).run(slug, name, description, requiresMfa, Date.now());
      setRolePermissions(db, info.lastInsertRowid, keys);
      writeAudit(db, req, "permission_change", {
        targetType: "role",
        targetId: String(info.lastInsertRowid),
        meta: { action: "create", name, permissions: keys },
      });
      req.session.flashMessage = `Role "${name}" created.`;
      return res.redirect("/admin/roles");
    } catch (err) {
      return res.render("admin-role-edit", {
        role: null,
        permissions: keys,
        permissionKeys: PERMISSION_KEYS,
        errors: ["Could not create role (slug may already exist)."],
      });
    }
  });

  app.get("/admin/roles/:id", mustBeAdmin, requirePermission("manage_roles"), (req, res) => {
    const role = getRoleWithPermissions(db, req.params.id);
    if (!role) {
      req.session.flashMessage = "Role not found.";
      return res.redirect("/admin/roles");
    }
    return res.render("admin-role-edit", {
      role,
      permissions: role.permissions,
      permissionKeys: PERMISSION_KEYS,
      errors: [],
    });
  });

  app.post("/admin/roles/:id", mustBeAdmin, requirePermission("manage_roles"), (req, res) => {
    const role = getRoleWithPermissions(db, req.params.id);
    if (!role) {
      req.session.flashMessage = "Role not found.";
      return res.redirect("/admin/roles");
    }
    const name = String(req.body.name || "").trim();
    const description = String(req.body.description || "").trim();
    const requiresMfa = req.body.requires_mfa === "on" || req.body.requires_mfa === "1" ? 1 : 0;
    const keys = [].concat(req.body.permissions || []);
    if (!name) {
      return res.render("admin-role-edit", {
        role,
        permissions: keys,
        permissionKeys: PERMISSION_KEYS,
        errors: ["Name is required."],
      });
    }
    db.prepare("UPDATE roles SET name = ?, description = ?, requires_mfa = ? WHERE id = ?")
      .run(name, description, requiresMfa, role.id);
    setRolePermissions(db, role.id, keys);
    writeAudit(db, req, "permission_change", {
      targetType: "role",
      targetId: String(role.id),
      meta: { action: "update", name, permissions: keys },
    });
    req.session.flashMessage = `Role "${name}" updated.`;
    return res.redirect("/admin/roles");
  });

  app.post("/admin/roles/:id/delete", mustBeAdmin, requirePermission("manage_roles"), (req, res) => {
    const role = db.prepare("SELECT * FROM roles WHERE id = ?").get(req.params.id);
    if (!role) {
      req.session.flashMessage = "Role not found.";
      return res.redirect("/admin/roles");
    }
    if (role.is_system) {
      req.session.flashMessage = "System roles cannot be deleted.";
      return res.redirect("/admin/roles");
    }
    db.prepare("DELETE FROM roles WHERE id = ?").run(role.id);
    writeAudit(db, req, "permission_change", {
      targetType: "role",
      targetId: String(role.id),
      meta: { action: "delete", name: role.name },
    });
    req.session.flashMessage = `Role "${role.name}" deleted.`;
    return res.redirect("/admin/roles");
  });

  // ── User role assignments ───────────────────────────────
  app.get("/admin/user-roles/:id", mustBeAdmin, requirePermission("manage_roles"), (req, res) => {
    const thisUser = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
    if (!thisUser) return res.redirect("/edit-users");
    const assignments = db.prepare(`
      SELECT ura.*, r.name AS role_name, r.slug AS role_slug
      FROM user_role_assignments ura
      JOIN roles r ON r.id = ura.role_id
      WHERE ura.user_id = ?
      ORDER BY ura.active DESC, ura.created_at DESC
    `).all(thisUser.id);
    return res.render("admin-user-roles", {
      thisUser,
      assignments,
      roles: listRoles(db),
      currentSeason: getCurrentSeason(db),
      flashMessage: req.session.flashMessage || null,
    });
  });

  app.post("/admin/user-roles/:id", mustBeAdmin, requirePermission("manage_roles"), (req, res) => {
    const thisUser = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
    if (!thisUser) return res.redirect("/edit-users");
    const roleId = parseInt(req.body.role_id, 10);
    const role = db.prepare("SELECT * FROM roles WHERE id = ?").get(roleId);
    if (!role) {
      req.session.flashMessage = "Select a valid role.";
      return res.redirect(`/admin/user-roles/${thisUser.id}`);
    }
    const program = String(req.body.program || "").trim() || null;
    const seasonYear = req.body.season_year ? parseInt(req.body.season_year, 10) : null;
    const department = String(req.body.department || "").trim() || null;
    const assignmentLabel = String(req.body.assignment_label || "").trim() || null;
    const startsAt = req.body.starts_at ? Date.parse(req.body.starts_at) : Date.now();
    const endsAt = req.body.ends_at ? Date.parse(req.body.ends_at + "T23:59:59.999Z") : null;
    const info = db.prepare(`
      INSERT INTO user_role_assignments
        (user_id, role_id, program, season_year, department, assignment_label, starts_at, ends_at, active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      thisUser.id,
      role.id,
      program,
      Number.isFinite(seasonYear) ? seasonYear : null,
      department,
      assignmentLabel,
      Number.isFinite(startsAt) ? startsAt : Date.now(),
      Number.isFinite(endsAt) ? endsAt : null,
      Date.now()
    );
    writeAudit(db, req, "permission_change", {
      targetType: "user_role",
      targetId: String(info.lastInsertRowid),
      meta: { user_id: thisUser.id, role: role.name, program, season_year: seasonYear, ends_at: endsAt },
    });
    req.session.flashMessage = `Assigned "${role.name}" to ${thisUser.firstname}.`;
    return res.redirect(`/admin/user-roles/${thisUser.id}`);
  });

  app.post("/admin/user-roles/:userId/revoke/:assignmentId", mustBeAdmin, requirePermission("manage_roles"), (req, res) => {
    const assignment = db.prepare("SELECT * FROM user_role_assignments WHERE id = ? AND user_id = ?")
      .get(req.params.assignmentId, req.params.userId);
    if (assignment) {
      db.prepare("UPDATE user_role_assignments SET active = 0, ends_at = ? WHERE id = ?").run(Date.now(), assignment.id);
      writeAudit(db, req, "permission_change", {
        targetType: "user_role",
        targetId: String(assignment.id),
        meta: { action: "revoke", user_id: assignment.user_id },
      });
      req.session.flashMessage = "Assignment revoked.";
    }
    return res.redirect(`/admin/user-roles/${req.params.userId}`);
  });

  // ── Audit & login history ───────────────────────────────
  app.get("/admin/audit-log", mustBeAdmin, requirePermission("view_audit_log"), (req, res) => {
    const action = String(req.query.action || "");
    const q = String(req.query.q || "").trim();
    const clauses = [];
    const params = [];
    if (action) {
      clauses.push("action = ?");
      params.push(action);
    }
    if (q) {
      clauses.push("(actor_email LIKE ? OR target_type LIKE ? OR target_id LIKE ? OR meta_json LIKE ?)");
      const like = `%${q}%`;
      params.push(like, like, like, like);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = db.prepare(`
      SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT 200
    `).all(...params);
    return res.render("admin-audit-log", { rows, action, q, flashMessage: null });
  });

  app.get("/admin/login-history", mustBeAdmin, requirePermission("view_login_history"), (req, res) => {
    const q = String(req.query.q || "").trim();
    const onlyFail = req.query.fail === "1";
    const clauses = [];
    const params = [];
    if (onlyFail) clauses.push("success = 0");
    if (q) {
      clauses.push("(email LIKE ? OR ip LIKE ?)");
      params.push(`%${q}%`, `%${q}%`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = db.prepare(`
      SELECT * FROM login_history ${where} ORDER BY created_at DESC LIMIT 200
    `).all(...params);
    return res.render("admin-login-history", { rows, q, onlyFail, flashMessage: null });
  });

  // ── Sessions / force logout ─────────────────────────────
  app.get("/admin/sessions/:userId", mustBeAdmin, requirePermission("force_logout"), (req, res) => {
    const thisUser = db.prepare("SELECT id, firstname, lastname, email FROM users WHERE id = ?").get(req.params.userId);
    if (!thisUser) return res.redirect("/edit-users");
    const sessions = db.prepare(`
      SELECT * FROM auth_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50
    `).all(thisUser.id);
    return res.render("admin-sessions", {
      thisUser,
      sessions,
      flashMessage: req.session.flashMessage || null,
    });
  });

  app.post("/admin/sessions/:userId/revoke-all", mustBeAdmin, requirePermission("force_logout"), (req, res) => {
    const userId = parseInt(req.params.userId, 10);
    revokeAllSessionsForUser(db, userId);
    writeAudit(db, req, "permission_change", {
      targetType: "user_sessions",
      targetId: String(userId),
      meta: { action: "revoke_all" },
    });
    req.session.flashMessage = "All sessions signed out.";
    return res.redirect(`/admin/sessions/${userId}`);
  });

  // ── Deactivate / reactivate ─────────────────────────────
  app.post("/admin/deactivate-user/:id", mustBeAdmin, requirePermission("deactivate_users"), (req, res) => {
    const thisUser = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
    if (!thisUser) return res.redirect("/edit-users");
    const reason = String(req.body.reason || "").trim() || "Deactivated by administrator";
    db.prepare("UPDATE users SET deactivated_at = ?, deactivated_reason = ? WHERE id = ?")
      .run(Date.now(), reason, thisUser.id);
    revokeAllSessionsForUser(db, thisUser.id);
    db.prepare("UPDATE user_role_assignments SET active = 0 WHERE user_id = ? AND active = 1").run(thisUser.id);
    writeAudit(db, req, "permission_change", {
      targetType: "user",
      targetId: String(thisUser.id),
      meta: { action: "deactivate", reason },
    });
    req.session.flashMessage = `${thisUser.firstname} ${thisUser.lastname} has been deactivated.`;
    return res.redirect("/edit-users");
  });

  app.post("/admin/reactivate-user/:id", mustBeAdmin, requirePermission("deactivate_users"), (req, res) => {
    const thisUser = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
    if (!thisUser) return res.redirect("/edit-users");
    db.prepare("UPDATE users SET deactivated_at = NULL, deactivated_reason = NULL WHERE id = ?").run(thisUser.id);
    writeAudit(db, req, "permission_change", {
      targetType: "user",
      targetId: String(thisUser.id),
      meta: { action: "reactivate" },
    });
    req.session.flashMessage = `${thisUser.firstname} ${thisUser.lastname} has been reactivated.`;
    return res.redirect("/edit-users");
  });

  void jwt;
}

function initRoles(db) {
  initRolesTables(db);
}

function startRolesRuntime(db) {
  startExpiryScheduler(db);
}

module.exports = {
  LEAD_ADMIN_EMAIL,
  PERMISSION_KEYS,
  ALL_PERMISSION_KEYS,
  SYSTEM_ROLES,
  MESSAGE_AUDIENCES,
  DEFAULT_SEASON,
  DEFAULT_SEASON_END,
  initRoles,
  initRolesTables,
  startRolesRuntime,
  getCurrentSeason,
  getSeasonEndDate,
  getDefaultContractEndsAt,
  seasonEndDateToMs,
  validateStrongPassword,
  recordLogin,
  writeAudit,
  hasPermission,
  getUserPermissionSet,
  getActiveAssignments,
  userRequiresMfa,
  canManageSeason,
  createAuthSession,
  isSessionActive,
  revokeSession,
  revokeAllSessionsForUser,
  createMfaCode,
  verifyMfaCode,
  runExpiryJob,
  requirePermissionFactory,
  registerRolesRoutes,
  listRoles,
  getRoleWithPermissions,
  setRolePermissions,
  clientIp,
  getMessagingCapabilities,
  resolveAudienceUserIds,
  canMessageTargetUser,
  filterUsersForMessaging,
  userIsCorpsStaff,
  userIsIndependentStaff,
};
