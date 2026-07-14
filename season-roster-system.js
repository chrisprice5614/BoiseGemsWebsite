/**
 * Season roster placements (2026 Corps, 2026 Independent).
 * Sections: caption, guard, brass, percussion.
 */

const ROSTER_SEASONS = [
  { key: "2026-corps", year: 2026, ensemble: "corps", label: "2026 Corps" },
  { key: "2026-independent", year: 2026, ensemble: "independent", label: "2026 Independent" },
];

const ROSTER_SECTIONS = [
  { key: "caption", label: "Caption" },
  { key: "guard", label: "Guard" },
  { key: "brass", label: "Brass" },
  { key: "percussion", label: "Percussion" },
];

const SECTION_KEYS = new Set(ROSTER_SECTIONS.map((s) => s.key));

function initSeasonRosters(db) {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS season_rosters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      season_year INTEGER NOT NULL,
      ensemble TEXT NOT NULL CHECK (ensemble IN ('corps', 'independent')),
      section TEXT NOT NULL CHECK (section IN ('caption', 'guard', 'brass', 'percussion')),
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      position_label TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(season_year, ensemble, user_id)
    )
  `).run();
  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_season_rosters_lookup
    ON season_rosters(season_year, ensemble, section, sort_order)
  `).run();
}

function getSeasonByKey(key) {
  return ROSTER_SEASONS.find((s) => s.key === key) || ROSTER_SEASONS[0];
}

function normalizeSection(section) {
  const s = String(section || "").trim().toLowerCase();
  return SECTION_KEYS.has(s) ? s : null;
}

function folderSectionToRosterSection(sectionName) {
  const s = String(sectionName || "").trim().toLowerCase();
  if (s === "brass") return "brass";
  if (s === "guard") return "guard";
  if (s === "drumline" || s === "front ensemble") return "percussion";
  return null;
}

function scopeToEnsemble(scope) {
  return String(scope || "").toLowerCase() === "indoor" ? "independent" : "corps";
}

function listRosterForSeason(db, seasonKey) {
  const season = getSeasonByKey(seasonKey);
  const rows = db.prepare(`
    SELECT r.*, u.firstname, u.lastname, u.img,
           u.contractedCorps, u.contractedIndependent, u.contractedAffiliate
    FROM season_rosters r
    JOIN users u ON u.id = r.user_id
    WHERE r.season_year = ? AND r.ensemble = ?
    ORDER BY r.section, r.sort_order, u.lastname, u.firstname
  `).all(season.year, season.ensemble);

  const bySection = {};
  ROSTER_SECTIONS.forEach((sec) => {
    bySection[sec.key] = [];
  });
  rows.forEach((row) => {
    if (!bySection[row.section]) bySection[row.section] = [];
    bySection[row.section].push({
      id: row.id,
      userId: row.user_id,
      name: `${row.firstname} ${row.lastname}`.trim(),
      position: row.position_label || "",
      img: row.img,
      contractedCorps: !!row.contractedCorps,
      contractedIndependent: !!row.contractedIndependent,
      contractedAffiliate: !!row.contractedAffiliate,
      sortOrder: row.sort_order,
    });
  });
  return { season, bySection };
}

function listRosterForFolder(db, year, scope, folderSectionName) {
  const rosterSection = folderSectionToRosterSection(folderSectionName);
  if (!rosterSection) return [];
  const ensemble = scopeToEnsemble(scope);
  const rows = db.prepare(`
    SELECT r.id, r.user_id, r.position_label, u.firstname, u.lastname, u.img,
           u.contractedCorps, u.contractedIndependent, u.contractedAffiliate
    FROM season_rosters r
    JOIN users u ON u.id = r.user_id
    WHERE r.season_year = ? AND r.ensemble = ? AND r.section = ?
    ORDER BY r.sort_order, u.lastname, u.firstname
  `).all(Number(year) || 2026, ensemble, rosterSection);

  return rows.map((r) => ({
    id: r.user_id,
    rosterId: r.id,
    name: `${r.firstname} ${r.lastname}`.trim(),
    instrument: r.position_label || "",
    img: r.img,
    contractedCorps: !!r.contractedCorps,
    contractedIndependent: !!r.contractedIndependent,
    contractedAffiliate: !!r.contractedAffiliate,
  }));
}

function listEligibleMembers(db, seasonKey, excludeUserIds) {
  const season = getSeasonByKey(seasonKey);
  const exclude = new Set((excludeUserIds || []).map(Number));
  let contractClause = "u.contractedCorps = 1";
  if (season.ensemble === "independent") contractClause = "u.contractedIndependent = 1";

  const rows = db.prepare(`
    SELECT u.id, u.firstname, u.lastname, u.email
    FROM users u
    WHERE (u.parent IS NULL OR u.parent = 0)
      AND (u.admin IS NULL OR u.admin = 0)
      AND (u.fan IS NULL OR u.fan = 0)
      AND ${contractClause}
    ORDER BY u.lastname, u.firstname
  `).all();

  return rows
    .filter((r) => !exclude.has(r.id))
    .map((r) => ({
      id: r.id,
      label: `${r.firstname} ${r.lastname}`.trim(),
      email: r.email,
    }));
}

function addRosterEntry(db, seasonKey, section, userId, positionLabel) {
  const season = getSeasonByKey(seasonKey);
  const sec = normalizeSection(section);
  if (!sec) throw new Error("Invalid section.");
  const uid = Number(userId);
  if (!uid) throw new Error("Select a member.");
  const position = String(positionLabel || "").trim();
  if (!position) throw new Error("Position is required (e.g. Trumpet 1, Snare, Flag).");

  const maxSort = db.prepare(`
    SELECT COALESCE(MAX(sort_order), -1) AS m
    FROM season_rosters
    WHERE season_year = ? AND ensemble = ? AND section = ?
  `).get(season.year, season.ensemble);
  const now = Date.now();
  db.prepare(`
    INSERT INTO season_rosters (season_year, ensemble, section, user_id, position_label, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(season.year, season.ensemble, sec, uid, position, (maxSort?.m ?? -1) + 1, now, now);
}

function updateRosterEntry(db, id, { section, positionLabel }) {
  const row = db.prepare("SELECT * FROM season_rosters WHERE id = ?").get(id);
  if (!row) throw new Error("Roster entry not found.");
  const sec = section != null ? normalizeSection(section) : row.section;
  if (!sec) throw new Error("Invalid section.");
  const position = positionLabel != null ? String(positionLabel).trim() : row.position_label;
  if (!position) throw new Error("Position is required.");
  db.prepare(`
    UPDATE season_rosters SET section = ?, position_label = ?, updated_at = ? WHERE id = ?
  `).run(sec, position, Date.now(), id);
}

function deleteRosterEntry(db, id) {
  db.prepare("DELETE FROM season_rosters WHERE id = ?").run(id);
}

module.exports = {
  ROSTER_SEASONS,
  ROSTER_SECTIONS,
  initSeasonRosters,
  getSeasonByKey,
  folderSectionToRosterSection,
  scopeToEnsemble,
  listRosterForSeason,
  listRosterForFolder,
  listEligibleMembers,
  addRosterEntry,
  updateRosterEntry,
  deleteRosterEntry,
};
