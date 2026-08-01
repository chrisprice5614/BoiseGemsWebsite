/**
 * Public staff bios - category pool, placements, page sections, gem-wall helpers.
 */

const STAFF_CATEGORY_SEED = [
  { name: "Director - Drum & Bugle Corps", section_title: "Director", pages: ["history", "corps"], sort_order: 10 },
  { name: "Director - Boise Gems Independent", section_title: "Director", pages: ["history", "bgi"], sort_order: 11 },
  { name: "Admin - Corps", section_title: "Admin", pages: ["history", "corps"], sort_order: 20 },
  { name: "Admin - Independent", section_title: "Admin", pages: ["history", "bgi"], sort_order: 21 },
  { name: "Design - Corps", section_title: "Design", pages: ["corps"], sort_order: 30 },
  { name: "Design - Independent", section_title: "Design", pages: ["bgi"], sort_order: 31 },
  { name: "Brass", section_title: "Brass", pages: ["corps"], sort_order: 40 },
  { name: "Percussion - Corps", section_title: "Percussion", pages: ["corps"], sort_order: 50 },
  { name: "Percussion - Independent", section_title: "Percussion", pages: ["bgi"], sort_order: 51 },
  { name: "Front Ensemble - Corps", section_title: "Front Ensemble", pages: ["corps"], sort_order: 60 },
  { name: "Front Ensemble - Independent", section_title: "Front Ensemble", pages: ["bgi"], sort_order: 61 },
  { name: "Color Guard", section_title: "Color Guard", pages: ["corps"], sort_order: 70 },
  { name: "Visual - Corps", section_title: "Visual", pages: ["corps"], sort_order: 80 },
  { name: "Visual - Independent", section_title: "Visual", pages: ["bgi"], sort_order: 81 },
  { name: "Board", section_title: "Board", pages: ["history", "board"], sort_order: 90 },
  { name: "Advisory Board", section_title: "Advisory Board", pages: ["history", "board"], sort_order: 100 },
];

const OLD_CATEGORY_MAP = {
  Director: "Director - Drum & Bugle Corps",
  "BGI Director": "Director - Boise Gems Independent",
  Admin: "Admin - Corps",
  Design: "Design - Corps",
  "BGI Design": "Design - Independent",
  Brass: "Brass",
  Percussion: "Percussion - Corps",
  "BGI Percussion": "Percussion - Independent",
  "Front Ensemble": "Front Ensemble - Corps",
  "BGI Front Ensemble": "Front Ensemble - Independent",
  "Color-Guard": "Color Guard",
  Visual: "Visual - Corps",
  "BGI Visual": "Visual - Independent",
  Board: "Board",
  "Advisory Board": "Advisory Board",
  Other: "Admin - Corps",
};

/** Rename legacy shared Director/Admin rows and ensure corps vs independent variants exist. */
function ensureDirectorAdminCategories(db) {
  const getByName = (name) => db.prepare("SELECT * FROM staff_categories WHERE name = ?").get(name);
  const insert = db.prepare(`
    INSERT INTO staff_categories (name, section_title, pages, sort_order) VALUES (?, ?, ?, ?)
  `);
  const update = db.prepare(`
    UPDATE staff_categories SET name = ?, section_title = ?, pages = ?, sort_order = ? WHERE id = ?
  `);

  const specs = [
    {
      name: "Director - Drum & Bugle Corps",
      legacy: ["Director"],
      section_title: "Director",
      pages: ["history", "corps"],
      sort_order: 10,
    },
    {
      name: "Director - Boise Gems Independent",
      legacy: ["BGI Director"],
      section_title: "Director",
      pages: ["history", "bgi"],
      sort_order: 11,
    },
    {
      name: "Admin - Corps",
      legacy: ["Admin"],
      section_title: "Admin",
      pages: ["history", "corps"],
      sort_order: 20,
    },
    {
      name: "Admin - Independent",
      legacy: [],
      section_title: "Admin",
      pages: ["history", "bgi"],
      sort_order: 21,
    },
  ];

  for (const spec of specs) {
    let row = getByName(spec.name);
    if (!row) {
      for (const legacyName of spec.legacy) {
        row = getByName(legacyName);
        if (row) break;
      }
    }
    if (row) {
      update.run(
        spec.name,
        spec.section_title,
        JSON.stringify(spec.pages),
        spec.sort_order,
        row.id
      );
    } else {
      insert.run(
        spec.name,
        spec.section_title,
        JSON.stringify(spec.pages),
        spec.sort_order
      );
    }
  }
}

function parsePages(raw) {
  try {
    const p = JSON.parse(raw || "[]");
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

function initStaffDisplay(db) {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS staff_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      section_title TEXT NOT NULL,
      pages TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS staff_placements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      staff_id INTEGER NOT NULL,
      category_id INTEGER NOT NULL,
      position_title TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE,
      FOREIGN KEY (category_id) REFERENCES staff_categories(id) ON DELETE CASCADE
    )
  `).run();

  db.prepare(`CREATE INDEX IF NOT EXISTS idx_staff_placements_cat ON staff_placements(category_id, sort_order)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_staff_placements_staff ON staff_placements(staff_id)`).run();

  const staffCols = db.prepare("PRAGMA table_info(staff)").all().map((c) => c.name);
  if (!staffCols.includes("email")) db.prepare("ALTER TABLE staff ADD COLUMN email TEXT").run();
  if (!staffCols.includes("phone")) db.prepare("ALTER TABLE staff ADD COLUMN phone TEXT").run();

  db.prepare(`UPDATE staff_categories SET name = REPLACE(name, char(8212), '-')`).run();
  db.prepare(`UPDATE staff_categories SET name = REPLACE(name, char(8211), '-')`).run();

  // Ensure Board / Advisory Board appear on the Board of Directors page
  for (const name of ["Board", "Advisory Board"]) {
    const row = db.prepare("SELECT id, pages FROM staff_categories WHERE name = ?").get(name);
    if (!row) continue;
    const pages = parsePages(row.pages);
    if (!pages.includes("board")) {
      pages.push("board");
      db.prepare("UPDATE staff_categories SET pages = ? WHERE id = ?").run(JSON.stringify(pages), row.id);
    }
  }

  const catCount = db.prepare("SELECT COUNT(*) AS c FROM staff_categories").get().c;
  if (!catCount) {
    const insert = db.prepare(`
      INSERT INTO staff_categories (name, section_title, pages, sort_order) VALUES (?, ?, ?, ?)
    `);
    for (const row of STAFF_CATEGORY_SEED) {
      insert.run(row.name, row.section_title, JSON.stringify(row.pages), row.sort_order);
    }
  }

  ensureDirectorAdminCategories(db);

  const placementCount = db.prepare("SELECT COUNT(*) AS c FROM staff_placements").get().c;
  if (!placementCount) {
    const legacy = db.prepare("SELECT id, position, category, sort_order FROM staff").all();
    if (legacy.length) {
      const catByName = {};
      db.prepare("SELECT id, name FROM staff_categories").all().forEach((c) => { catByName[c.name] = c.id; });
      const insertPlacement = db.prepare(`
        INSERT INTO staff_placements (staff_id, category_id, position_title, sort_order) VALUES (?, ?, ?, ?)
      `);
      for (const row of legacy) {
        const mapped = OLD_CATEGORY_MAP[row.category] || OLD_CATEGORY_MAP.Other;
        const catId = catByName[mapped];
        if (!catId) continue;
        insertPlacement.run(row.id, catId, row.position || mapped, row.sort_order || 0);
      }
    }
  }
}

function getStaffCategories(db) {
  return db.prepare(`
    SELECT id, name, section_title, pages, sort_order FROM staff_categories
    ORDER BY sort_order ASC, name COLLATE NOCASE ASC
  `).all().map((c) => ({
    ...c,
    pages: parsePages(c.pages),
  }));
}

function parsePlacementsFromBody(body) {
  const raw = body.placements;
  if (raw) {
    const rows = Array.isArray(raw) ? raw : Object.values(raw);
    return rows
      .map((p) => ({
        category_id: Number(p.category_id),
        position_title: String(p.position_title || "").trim(),
      }))
      .filter((p) => p.category_id > 0 && p.position_title);
  }

  const byIndex = {};
  Object.keys(body || {}).forEach((key) => {
    const catMatch = key.match(/^placements\[(\d+)\]\[category_id\]$/);
    const titleMatch = key.match(/^placements\[(\d+)\]\[position_title\]$/);
    if (catMatch) {
      const i = catMatch[1];
      byIndex[i] = byIndex[i] || {};
      byIndex[i].category_id = Number(body[key]);
    }
    if (titleMatch) {
      const i = titleMatch[1];
      byIndex[i] = byIndex[i] || {};
      byIndex[i].position_title = String(body[key] || "").trim();
    }
  });

  return Object.keys(byIndex)
    .sort((a, b) => Number(a) - Number(b))
    .map((i) => byIndex[i])
    .filter((p) => p.category_id > 0 && p.position_title);
}

function saveStaffPlacements(db, staffId, placements) {
  db.prepare("DELETE FROM staff_placements WHERE staff_id = ?").run(staffId);
  const insert = db.prepare(`
    INSERT INTO staff_placements (staff_id, category_id, position_title, sort_order) VALUES (?, ?, ?, ?)
  `);
  placements.forEach((p, idx) => {
    insert.run(staffId, p.category_id, p.position_title, idx);
  });
}

function getPlacementsForStaff(db, staffId) {
  return db.prepare(`
    SELECT p.id, p.category_id, p.position_title, p.sort_order, c.name AS category_name, c.section_title
    FROM staff_placements p
    JOIN staff_categories c ON c.id = p.category_id
    WHERE p.staff_id = ?
    ORDER BY c.sort_order ASC, p.sort_order ASC
  `).all(staffId);
}

function getStaffAdminGrouped(db) {
  const categories = getStaffCategories(db);
  const grouped = {};
  for (const cat of categories) {
    const rows = db.prepare(`
      SELECT p.id AS placement_id, p.position_title, p.sort_order,
             s.id, s.first, s.last, s.image, s.slug
      FROM staff_placements p
      JOIN staff s ON s.id = p.staff_id
      WHERE p.category_id = ?
      ORDER BY p.sort_order ASC, s.last COLLATE NOCASE ASC, s.first COLLATE NOCASE ASC
    `).all(cat.id);
    if (rows.length) grouped[cat.name] = { category: cat, rows };
  }
  return grouped;
}

function getStaffSectionsForPage(db, pageKey) {
  const categories = getStaffCategories(db).filter((c) => c.pages.includes(pageKey));
  const sections = [];
  const byTitle = new Map();

  for (const cat of categories) {
    const staff = db.prepare(`
      SELECT s.id, s.first, s.last, s.bio, s.image, s.slug,
             p.position_title AS position, p.sort_order AS placement_order
      FROM staff_placements p
      JOIN staff s ON s.id = p.staff_id
      WHERE p.category_id = ?
      ORDER BY p.sort_order ASC, s.last COLLATE NOCASE ASC, s.first COLLATE NOCASE ASC
    `).all(cat.id).map((row) => ({
      ...row,
      category: cat.section_title,
    }));

    if (!staff.length) continue;

    const existing = byTitle.get(cat.section_title);
    if (existing) {
      existing.staff.push(...staff);
    } else {
      const section = { title: cat.section_title, staff, categoryId: cat.id };
      byTitle.set(cat.section_title, section);
      sections.push(section);
    }
  }

  return sections;
}

function gemTileStyle(id) {
  const n = Number(id) || 0;
  const a = (n * 7 + 3) % 11 - 5;
  const b = (n * 5 + 1) % 9 - 4;
  const c = (n * 3 + 7) % 10 - 5;
  const d = (n * 11 + 2) % 9 - 4;
  const e = (n * 17 + 5) % 8 - 3;
  const rot = ((n * 13) % 7) - 3;
  const z = (n % 7) + 1;
  const scale = 0.92 + ((n % 6) * 0.025);
  const clip = `polygon(${2 + a}% ${1 + b}%, ${98 - b}% ${3 + c}%, ${99 - c}% ${62 + e}%, ${97 - d}% ${98 - a}%, ${50 + e}% ${99 - b}%, ${1 + d}% ${96 - c}%, ${3 + c}% ${38 - e}%)`;
  const marginTop = -10 - (n % 5) * 6;
  const marginLeft = -8 - ((n >> 2) % 4) * 5;
  const marginRight = -6 - ((n >> 3) % 4) * 4;
  const minHeight = 220 + (n % 5) * 36;
  return { clip, rot, z, scale, marginTop, marginLeft, marginRight, minHeight };
}

/** Any signed-in admin may reorder; staff-admin routes are already mustBeAdmin. */
function canReorderStaff(user) {
  if (!user) return false;
  const a = user.admin;
  return a === true || a === 1 || a === "1" || Number(a) === 1;
}

function reorderPlacements(db, categoryId, placementIds) {
  const stmt = db.prepare(`
    UPDATE staff_placements SET sort_order = ? WHERE id = ? AND category_id = ?
  `);
  placementIds.forEach((id, idx) => {
    stmt.run(idx, Number(id), categoryId);
  });
}

function getStaffForMobileApi(db) {
  return db.prepare(`
    SELECT s.id, s.first, s.last, s.slug, s.bio, s.image,
           p.position_title, c.name AS category_name, c.section_title, p.sort_order
    FROM staff s
    JOIN staff_placements p ON p.staff_id = s.id
    JOIN staff_categories c ON c.id = p.category_id
    ORDER BY c.sort_order ASC, p.sort_order ASC, s.last COLLATE NOCASE
  `).all().map((s) => ({
    id: s.id,
    firstname: s.first || "",
    lastname: s.last || "",
    slug: s.slug || null,
    role: s.position_title || null,
    section: s.section_title || s.category_name || null,
    bio: s.bio || null,
    img: s.image ? `/img/publicupload/${s.image}` : null,
    sort_order: s.sort_order,
  }));
}

function normalizeStaffEmail(email) {
  const e = String(email || "").trim();
  return e || null;
}

/** Strip to 10 US digits; drops leading country code 1 when present. */
function digitsFromPhone(input) {
  let d = String(input || "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (d.length > 10) d = d.slice(0, 10);
  return d.length === 10 ? d : null;
}

/** Display format: (XXX) XXX - XXXX */
function formatUSPhoneDisplay(input) {
  const d =
    typeof input === "string" && /^\d{10}$/.test(input)
      ? input
      : digitsFromPhone(input);
  if (!d) return null;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)} - ${d.slice(6)}`;
}

function normalizeStaffPhone(phone) {
  const formatted = formatUSPhoneDisplay(phone);
  if (formatted) return formatted;
  const t = String(phone || "").trim();
  return t || null;
}

function phoneTelHref(phone) {
  const d = digitsFromPhone(phone);
  return d ? `tel:+1${d}` : null;
}

function phoneVCardTel(phone) {
  const d = digitsFromPhone(phone);
  return d ? `+1${d}` : null;
}

function vcardEscape(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function buildStaffVCard(staff) {
  const first = String(staff.first || "").trim();
  const last = String(staff.last || "").trim();
  const email = normalizeStaffEmail(staff.email);
  const tel = phoneVCardTel(staff.phone);
  if (!tel) return null;

  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${vcardEscape(`${first} ${last}`.trim())}`,
    `N:${vcardEscape(last)};${vcardEscape(first)};;;`,
    "ORG:Boise Gems",
    `TEL;TYPE=CELL,VOICE:${tel}`,
  ];
  if (email) lines.push(`EMAIL;TYPE=INTERNET:${vcardEscape(email)}`);
  lines.push("END:VCARD");
  return lines.join("\r\n");
}

module.exports = {
  STAFF_CATEGORY_SEED,
  initStaffDisplay,
  getStaffCategories,
  parsePlacementsFromBody,
  saveStaffPlacements,
  getPlacementsForStaff,
  getStaffAdminGrouped,
  getStaffSectionsForPage,
  gemTileStyle,
  canReorderStaff,
  reorderPlacements,
  getStaffForMobileApi,
  normalizeStaffEmail,
  normalizeStaffPhone,
  digitsFromPhone,
  formatUSPhoneDisplay,
  phoneTelHref,
  phoneVCardTel,
  buildStaffVCard,
};
