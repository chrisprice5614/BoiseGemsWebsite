/**
 * Upsert dedicated Playwright users with a known strong password.
 * Safe to re-run; does not touch unrelated accounts.
 */
const path = require("path");
const bcrypt = require("bcrypt");
const Database = require("better-sqlite3");
const rolesSystem = require("../../roles-system");

const PASSWORD = "E2eTestPass1!";
const USERS = {
  admin: {
    email: "e2e-admin@boisegems.test",
    firstname: "E2E",
    lastname: "Admin",
    admin: 1,
    staff: 0,
    parent: 0,
    fan: 0,
  },
  staff: {
    email: "e2e-staff@boisegems.test",
    firstname: "E2E",
    lastname: "Staff",
    admin: 0,
    staff: 1,
    parent: 0,
    fan: 0,
  },
  member: {
    email: "e2e-member@boisegems.test",
    firstname: "E2E",
    lastname: "Member",
    admin: 0,
    staff: 0,
    parent: 0,
    fan: 0,
  },
  parent: {
    email: "e2e-parent@boisegems.test",
    firstname: "E2E",
    lastname: "Parent",
    admin: 0,
    staff: 0,
    parent: 1,
    fan: 0,
  },
  fan: {
    email: "e2e-fan@boisegems.test",
    firstname: "E2E",
    lastname: "Fan",
    admin: 0,
    staff: 0,
    parent: 0,
    fan: 1,
  },
};

function seedE2EUsers(dbPath = path.join(__dirname, "..", "..", "data.db")) {
  const db = new Database(dbPath);
  // Roles schema is owned by the app boot path; only assign if tables already exist.
  try {
    rolesSystem.initRoles(db);
  } catch (err) {
    console.warn("seed-users: roles init skipped:", err.message);
  }
  const hash = bcrypt.hashSync(PASSWORD, 10);
  const now = Date.now();

  for (const user of Object.values(USERS)) {
    const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(user.email);
    if (existing) {
      db.prepare(`
        UPDATE users SET
          firstname = ?, lastname = ?, password = ?,
          admin = ?, staff = ?, parent = ?, fan = ?,
          verified = 1, deactivated_at = NULL, deactivated_reason = NULL
        WHERE id = ?
      `).run(
        user.firstname,
        user.lastname,
        hash,
        user.admin,
        user.staff,
        user.parent,
        user.fan,
        existing.id
      );
    } else {
      db.prepare(`
        INSERT INTO users (
          firstname, lastname, email, password, phone, address, birthday,
          admin, staff, parent, fan, verified, created_at,
          contractedCorps, contractedIndependent, contractedAffiliate
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 0, 0, 0)
      `).run(
        user.firstname,
        user.lastname,
        user.email,
        hash,
        "2085550100",
        "123 E2E St",
        Date.now() - 20 * 365 * 24 * 60 * 60 * 1000,
        user.admin,
        user.staff,
        user.parent,
        user.fan,
        now
      );
    }
  }

  const admin = db.prepare("SELECT id FROM users WHERE email = ?").get(USERS.admin.email);
  const staff = db.prepare("SELECT id FROM users WHERE email = ?").get(USERS.staff.email);
  const superRole = db.prepare("SELECT id FROM roles WHERE slug = 'super-administrator'").get();
  const staffRole = db.prepare("SELECT id FROM roles WHERE slug = 'instructional-staff-corps'").get();

  const ensureAssignment = (userId, roleId, program) => {
    if (!userId || !roleId) return;
    const exists = db.prepare(`
      SELECT id FROM user_role_assignments WHERE user_id = ? AND role_id = ? AND active = 1 LIMIT 1
    `).get(userId, roleId);
    if (exists) return;
    db.prepare(`
      INSERT INTO user_role_assignments
        (user_id, role_id, program, season_year, department, assignment_label, starts_at, ends_at, active, created_at)
      VALUES (?, ?, ?, NULL, NULL, 'e2e', ?, NULL, 1, ?)
    `).run(userId, roleId, program, now, now);
  };

  ensureAssignment(admin && admin.id, superRole && superRole.id, null);
  ensureAssignment(staff && staff.id, staffRole && staffRole.id, "corps");

  db.close();
  return { password: PASSWORD, users: USERS };
}

if (require.main === module) {
  const result = seedE2EUsers();
  console.log("Seeded e2e users:", Object.keys(result.users).join(", "));
  console.log("Password:", result.password);
}

module.exports = { seedE2EUsers, PASSWORD, USERS };
