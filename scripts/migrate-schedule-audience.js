const Database = require("better-sqlite3");
const path = require("path");
const db = new Database(path.join(__dirname, "..", "data.db"));
db.prepare(`
  CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    date TEXT NOT NULL,
    location TEXT,
    call_time TEXT,
    dismissal_time TEXT,
    notes TEXT,
    staff_notes TEXT,
    scope TEXT NOT NULL DEFAULT 'all',
    created_by INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
`).run();
const cols = db.prepare("PRAGMA table_info(schedules)").all().map(c => c.name);
if (!cols.includes("aud_anyone")) {
  db.prepare("ALTER TABLE schedules ADD COLUMN aud_anyone INTEGER NOT NULL DEFAULT 1").run();
  db.prepare("ALTER TABLE schedules ADD COLUMN aud_corps INTEGER NOT NULL DEFAULT 0").run();
  db.prepare("ALTER TABLE schedules ADD COLUMN aud_independent INTEGER NOT NULL DEFAULT 0").run();
  db.prepare("UPDATE schedules SET aud_corps = 1 WHERE scope = 'corps'").run();
  db.prepare("UPDATE schedules SET aud_independent = 1 WHERE scope IN ('indoor', 'bgi')").run();
  db.prepare("UPDATE schedules SET aud_anyone = 1 WHERE scope = 'all' OR scope IS NULL OR scope = ''").run();
  console.log("Added schedule audience columns");
} else {
  console.log("Schedule audience columns already exist");
}
