/**
 * Operations: error logging, database backups, and website health monitoring.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");

const BACKUP_DIR = path.join(__dirname, "db-backups");
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const BACKUP_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const RESTORE_CONTACT = "chrisprice5614@gmail.com";

const LOG_TYPES = [
  "application-error",
  "database-error",
  "failed-payment",
  "failed-email",
  "http-error",
];

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

function initOpsTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS error_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      status_code INTEGER,
      message TEXT NOT NULL,
      detail TEXT,
      path TEXT,
      method TEXT,
      user_id INTEGER,
      user_firstname TEXT,
      user_lastname TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_error_logs_created ON error_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_error_logs_type ON error_logs(type);

    CREATE TABLE IF NOT EXISTS ops_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
}

function userFromReq(req) {
  if (!req || !req.user) {
    return { userId: null, firstname: null, lastname: null };
  }
  return {
    userId: req.user.userid || null,
    firstname: req.user.firstname || null,
    lastname: req.user.lastname || null,
  };
}

function detailToString(detail) {
  if (detail == null) return null;
  if (typeof detail === "string") return detail.slice(0, 12000);
  if (detail instanceof Error) {
    return String(detail.stack || detail.message || detail).slice(0, 12000);
  }
  try {
    return JSON.stringify(detail).slice(0, 12000);
  } catch {
    return String(detail).slice(0, 12000);
  }
}

/** Raw prepare/run used by the logger so wrapped DB methods cannot recurse. */
const rawDbFns = new WeakMap();

function getRawPrepare(db) {
  const raw = rawDbFns.get(db);
  return raw ? raw.prepare : db.prepare.bind(db);
}

/**
 * Persist an error log row. Safe to call from anywhere - never throws to callers.
 */
function logError(db, opts = {}) {
  try {
    const type = LOG_TYPES.includes(opts.type) ? opts.type : "application-error";
    const statusCode =
      opts.statusCode != null && Number.isFinite(Number(opts.statusCode))
        ? Number(opts.statusCode)
        : null;
    const message = String(opts.message || "Unknown error").slice(0, 2000);
    const detail = detailToString(opts.detail);
    const pathVal = opts.path != null ? String(opts.path).slice(0, 500) : null;
    const method = opts.method != null ? String(opts.method).slice(0, 16) : null;

    let userId = opts.userId != null ? opts.userId : null;
    let firstname = opts.userFirstname != null ? opts.userFirstname : null;
    let lastname = opts.userLastname != null ? opts.userLastname : null;

    if (opts.req) {
      const u = userFromReq(opts.req);
      if (userId == null) userId = u.userId;
      if (firstname == null) firstname = u.firstname;
      if (lastname == null) lastname = u.lastname;
    }

    const reqPath =
      pathVal ||
      (opts.req && (opts.req.originalUrl || opts.req.url)) ||
      null;
    const reqMethod = method || (opts.req && opts.req.method) || null;

    getRawPrepare(db)(
      `INSERT INTO error_logs
        (type, status_code, message, detail, path, method, user_id, user_firstname, user_lastname, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      type,
      statusCode,
      message,
      detail,
      reqPath ? String(reqPath).slice(0, 500) : null,
      reqMethod,
      userId,
      firstname,
      lastname,
      Date.now()
    );

    console.error(`[ops:${type}]`, message);
  } catch (e) {
    console.error("[ops] Failed to write error log:", e);
  }
}

function logApplicationError(db, opts) {
  return logError(db, { ...opts, type: "application-error" });
}

function logDatabaseError(db, opts) {
  return logError(db, { ...opts, type: "database-error" });
}

function logFailedPayment(db, opts) {
  return logError(db, { ...opts, type: "failed-payment" });
}

function logFailedEmail(db, opts) {
  return logError(db, { ...opts, type: "failed-email" });
}

/**
 * Wrap better-sqlite3 so prepare/exec failures and statement run/get/all throws
 * are recorded as database-error logs.
 */
function wrapDbForErrorLogging(db) {
  if (db.__opsWrapped) return db;
  db.__opsWrapped = true;

  const originalPrepare = db.prepare.bind(db);
  const originalExec = db.exec.bind(db);
  rawDbFns.set(db, { prepare: originalPrepare, exec: originalExec });

  const wrapStatement = (stmt, sql) => {
    const wrapMethod = (name) => {
      const original = stmt[name].bind(stmt);
      stmt[name] = function wrappedStmtMethod(...args) {
        try {
          return original(...args);
        } catch (err) {
          logDatabaseError(db, {
            message: `Database ${name}() failed`,
            detail: `${err && err.message ? err.message : err}\nSQL: ${sql}`,
          });
          throw err;
        }
      };
    };
    ["run", "get", "all", "iterate"].forEach(wrapMethod);
    return stmt;
  };

  db.prepare = function opsPrepare(sql) {
    try {
      return wrapStatement(originalPrepare(sql), sql);
    } catch (err) {
      logDatabaseError(db, {
        message: "Database prepare() failed",
        detail: `${err && err.message ? err.message : err}\nSQL: ${sql}`,
      });
      throw err;
    }
  };

  db.exec = function opsExec(sql) {
    try {
      return originalExec(sql);
    } catch (err) {
      logDatabaseError(db, {
        message: "Database exec() failed",
        detail: `${err && err.message ? err.message : err}\nSQL: ${String(sql).slice(0, 2000)}`,
      });
      throw err;
    }
  };

  return db;
}

/**
 * Express middleware: after each response, log non-4xx server errors (5xx+).
 * Skips if the route already logged via res.locals.opsLogged.
 */
function httpErrorLoggingMiddleware(db) {
  return function opsHttpErrorLogger(req, res, next) {
    res.on("finish", () => {
      try {
        if (res.locals && res.locals.opsLogged) return;
        const code = res.statusCode;
        // Log server errors only - not 4xx client errors
        if (!code || code < 500) return;
        logError(db, {
          type: "http-error",
          statusCode: code,
          message: `HTTP ${code} ${req.method} ${req.originalUrl || req.url}`,
          detail: res.locals && res.locals.opsErrorDetail
            ? res.locals.opsErrorDetail
            : null,
          req,
        });
      } catch (e) {
        console.error("[ops] http finish logger failed:", e);
      }
    });
    next();
  };
}

function markLogged(res, detail) {
  if (!res || !res.locals) return;
  res.locals.opsLogged = true;
  if (detail) res.locals.opsErrorDetail = detailToString(detail);
}

function getMeta(db, key) {
  const row = db.prepare("SELECT value FROM ops_meta WHERE key = ?").get(key);
  return row ? row.value : null;
}

function setMeta(db, key, value) {
  db.prepare(
    "INSERT INTO ops_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, String(value));
}

function backupFilename(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  return `data-${stamp}.db`;
}

function listBackupFiles() {
  ensureBackupDir();
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith("data-") && f.endsWith(".db"))
    .map((name) => {
      const full = path.join(BACKUP_DIR, name);
      const stat = fs.statSync(full);
      return {
        name,
        path: full,
        sizeBytes: stat.size,
        createdAt: stat.mtimeMs,
      };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

function pruneOldBackups() {
  const cutoff = Date.now() - BACKUP_RETENTION_MS;
  let removed = 0;
  for (const file of listBackupFiles()) {
    if (file.createdAt < cutoff) {
      try {
        fs.unlinkSync(file.path);
        removed += 1;
      } catch (e) {
        console.error("[ops] Failed to delete old backup:", file.name, e);
      }
    }
  }
  return removed;
}

/**
 * Create a hot backup of the SQLite database using better-sqlite3's backup API.
 */
async function runDatabaseBackup(db, { reason = "scheduled" } = {}) {
  ensureBackupDir();
  const name = backupFilename();
  const dest = path.join(BACKUP_DIR, name);

  try {
    await db.backup(dest);
    setMeta(db, "last_backup_at", String(Date.now()));
    setMeta(db, "last_backup_file", name);
    setMeta(db, "last_backup_reason", reason);
    setMeta(db, "last_backup_ok", "1");
    const pruned = pruneOldBackups();
    console.log(`[ops] Database backup saved: ${name} (pruned ${pruned} old)`);
    return { ok: true, name, pruned };
  } catch (err) {
    setMeta(db, "last_backup_ok", "0");
    setMeta(db, "last_backup_error", String(err && err.message ? err.message : err));
    logApplicationError(db, {
      message: "Database backup failed",
      detail: err,
    });
    console.error("[ops] Database backup failed:", err);
    return { ok: false, error: err };
  }
}

function startBackupScheduler(db) {
  ensureBackupDir();

  const maybeBackup = async (reason) => {
    const last = Number(getMeta(db, "last_backup_at") || 0);
    if (reason === "startup" && last && Date.now() - last < BACKUP_INTERVAL_MS) {
      console.log("[ops] Skipping startup backup; last backup still fresh.");
      pruneOldBackups();
      return;
    }
    await runDatabaseBackup(db, { reason });
  };

  // Startup: back up if none in the last 24h
  setTimeout(() => {
    maybeBackup("startup").catch((e) => console.error("[ops] startup backup error:", e));
  }, 15_000);

  setInterval(() => {
    runDatabaseBackup(db, { reason: "scheduled" }).catch((e) =>
      console.error("[ops] scheduled backup error:", e)
    );
  }, BACKUP_INTERVAL_MS);

  console.log("[ops] Database backup scheduler started (every 24h, retain 7 days).");
}

function formatBytes(n) {
  const num = Number(n) || 0;
  if (num < 1024) return `${num} B`;
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
  if (num < 1024 * 1024 * 1024) return `${(num / (1024 * 1024)).toFixed(1)} MB`;
  return `${(num / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function getErrorStats(db, sinceMs) {
  const since = Date.now() - sinceMs;
  const byType = db
    .prepare(
      `SELECT type, COUNT(*) AS count FROM error_logs WHERE created_at >= ? GROUP BY type ORDER BY count DESC`
    )
    .all(since);
  const total = byType.reduce((sum, r) => sum + r.count, 0);
  const recent = db
    .prepare(
      `SELECT * FROM error_logs WHERE created_at >= ? ORDER BY created_at DESC LIMIT 10`
    )
    .all(since);
  return { total, byType, recent };
}

function getHealthStatus(db) {
  const startedAt = Number(getMeta(db, "server_started_at") || Date.now());
  const uptimeMs = Date.now() - startedAt;
  const mem = process.memoryUsage();

  let dbOk = false;
  let dbError = null;
  let userCount = null;
  try {
    db.prepare("SELECT 1 AS ok").get();
    const row = db.prepare("SELECT COUNT(*) AS c FROM users").get();
    userCount = row ? row.c : null;
    dbOk = true;
  } catch (e) {
    dbError = e && e.message ? e.message : String(e);
  }

  const lastBackupAt = Number(getMeta(db, "last_backup_at") || 0);
  const lastBackupOk = getMeta(db, "last_backup_ok") === "1";
  const lastBackupFile = getMeta(db, "last_backup_file");
  const backups = listBackupFiles();
  const stats24h = getErrorStats(db, 24 * 60 * 60 * 1000);

  const checks = [
    {
      id: "database",
      label: "Database",
      ok: dbOk,
      detail: dbOk
        ? `Connected · ${userCount != null ? userCount + " users" : "OK"}`
        : dbError || "Unreachable",
    },
    {
      id: "backups",
      label: "Database backups",
      ok: lastBackupAt > 0 && lastBackupOk && Date.now() - lastBackupAt < BACKUP_INTERVAL_MS * 1.5,
      detail: lastBackupAt
        ? `Last: ${new Date(lastBackupAt).toLocaleString()} (${lastBackupFile || "-"}) · ${backups.length} kept`
        : "No backup recorded yet",
    },
    {
      id: "errors",
      label: "Errors (24h)",
      ok: stats24h.total < 25,
      warn: stats24h.total > 0 && stats24h.total < 25,
      detail: `${stats24h.total} logged in the last 24 hours`,
    },
    {
      id: "stripe",
      label: "Stripe config",
      ok: Boolean(process.env.STRIPE_SECRET_KEY),
      detail: process.env.STRIPE_SECRET_KEY ? "Secret key present" : "STRIPE_SECRET_KEY missing",
    },
    {
      id: "mailgun",
      label: "Mailgun config",
      ok: Boolean(process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN),
      detail:
        process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN
          ? "API key & domain present"
          : "MAILGUN_API_KEY or MAILGUN_DOMAIN missing",
    },
    {
      id: "memory",
      label: "Process memory",
      ok: mem.rss < 1.5 * 1024 * 1024 * 1024,
      detail: `RSS ${formatBytes(mem.rss)} · Heap ${formatBytes(mem.heapUsed)} / ${formatBytes(mem.heapTotal)}`,
    },
  ];

  const overallOk = checks.every((c) => c.ok || c.warn);

  return {
    overallOk,
    startedAt,
    uptimeMs,
    uptimeLabel: formatDuration(uptimeMs),
    hostname: os.hostname(),
    nodeVersion: process.version,
    platform: `${os.type()} ${os.release()}`,
    checks,
    stats24h,
    backups,
    lastBackupAt,
    lastBackupFile,
    lastBackupOk,
    restoreContact: RESTORE_CONTACT,
    backupRetentionDays: 7,
    backupIntervalHours: 24,
  };
}

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours || days) parts.push(`${hours}h`);
  parts.push(`${mins}m`);
  return parts.join(" ");
}

function queryErrorLogs(db, { type = "", q = "", limit = 100, offset = 0 } = {}) {
  const clauses = [];
  const params = [];
  if (type && LOG_TYPES.includes(type)) {
    clauses.push("type = ?");
    params.push(type);
  }
  if (q && String(q).trim()) {
    clauses.push(
      "(message LIKE ? OR detail LIKE ? OR path LIKE ? OR user_firstname LIKE ? OR user_lastname LIKE ?)"
    );
    const like = `%${String(q).trim()}%`;
    params.push(like, like, like, like, like);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const total = db
    .prepare(`SELECT COUNT(*) AS c FROM error_logs ${where}`)
    .get(...params).c;
  const rows = db
    .prepare(
      `SELECT * FROM error_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    .all(...params, Math.min(Number(limit) || 100, 500), Number(offset) || 0);
  return { total, rows };
}

function registerOpsRoutes(app, { db, mustBeAdmin }) {
  app.get("/admin/monitoring", mustBeAdmin, (req, res) => {
    const health = getHealthStatus(db);
    const typeFilter = String(req.query.type || "");
    const q = String(req.query.q || "");
    const logs = queryErrorLogs(db, { type: typeFilter, q, limit: 150 });
    const flashMessage = req.session.flashMessage || null;
    req.session.flashMessage = null;

    return res.render("admin-monitoring", {
      health,
      logs,
      typeFilter,
      q,
      logTypes: LOG_TYPES,
      flashMessage,
      restoreContact: RESTORE_CONTACT,
    });
  });

  app.get("/admin/error-logs/:id", mustBeAdmin, (req, res) => {
    const row = db.prepare("SELECT * FROM error_logs WHERE id = ?").get(req.params.id);
    if (!row) {
      req.session.flashMessage = "Log entry not found.";
      return res.redirect("/admin/monitoring#logs");
    }
    return res.render("admin-error-log-detail", { log: row, restoreContact: RESTORE_CONTACT });
  });

  app.post("/admin/monitoring/backup-now", mustBeAdmin, async (req, res) => {
    const result = await runDatabaseBackup(db, { reason: "manual" });
    req.session.flashMessage = result.ok
      ? `Backup created: ${result.name}`
      : "Backup failed - check error logs.";
    return res.redirect("/admin/monitoring#backups");
  });

  app.post("/admin/monitoring/clear-logs", mustBeAdmin, (req, res) => {
    const olderThanDays = Math.max(1, Math.min(365, Number(req.body.olderThanDays) || 30));
    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    const info = db.prepare("DELETE FROM error_logs WHERE created_at < ?").run(cutoff);
    req.session.flashMessage = `Cleared ${info.changes} log(s) older than ${olderThanDays} days.`;
    return res.redirect("/admin/monitoring#logs");
  });
}

function initOps(db) {
  initOpsTables(db);
}

/** Call after schema bootstrap so migrations are not recorded as database errors. */
function startOpsRuntime(db) {
  wrapDbForErrorLogging(db);
  setMeta(db, "server_started_at", String(Date.now()));
  startBackupScheduler(db);
}

module.exports = {
  BACKUP_DIR,
  RESTORE_CONTACT,
  LOG_TYPES,
  initOps,
  initOpsTables,
  startOpsRuntime,
  wrapDbForErrorLogging,
  logError,
  logApplicationError,
  logDatabaseError,
  logFailedPayment,
  logFailedEmail,
  httpErrorLoggingMiddleware,
  markLogged,
  startBackupScheduler,
  runDatabaseBackup,
  listBackupFiles,
  getHealthStatus,
  queryErrorLogs,
  registerOpsRoutes,
  userFromReq,
};
