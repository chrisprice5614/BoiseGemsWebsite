const Database = require("better-sqlite3");
const path = require("path");
const db = new Database(path.join(__dirname, "..", "data.db"));

db.prepare(`
  CREATE TABLE IF NOT EXISTS site_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    messaging_all_users INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL DEFAULT 0
  )
`).run();
const ssRow = db.prepare("SELECT id FROM site_settings WHERE id = 1").get();
if (!ssRow) {
  db.prepare("INSERT INTO site_settings (id, messaging_all_users, updated_at) VALUES (1, 1, ?)").run(Date.now());
}
console.log("site_settings ready:", db.prepare("SELECT * FROM site_settings WHERE id = 1").get());
