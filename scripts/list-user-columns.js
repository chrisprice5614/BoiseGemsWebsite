const Database = require("better-sqlite3");
const db = new Database(require("path").join(__dirname, "..", "data.db"));
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
for (const t of tables) {
  const cols = db.prepare(`PRAGMA table_info(${t.name})`).all();
  for (const c of cols) {
    if (/user|parent|child|member|author|uploader|sender|extender|target|created_by|requested/i.test(c.name)) {
      console.log(`${t.name}.${c.name}`);
    }
  }
}
