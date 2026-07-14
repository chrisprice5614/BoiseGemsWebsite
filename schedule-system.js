/**
 * Schedule v2 — time slots with expandable section entries.
 */
const SCHEDULE_GROUPS = {
  whole_corps: "Whole Corps",
  brass: "Brass",
  front_ensemble: "Front Ensemble",
  drumline: "Drumline",
  guard: "Guard",
};

const parentLinks = require("./parent-links");

function todayYmdLocal(d) {
  const dt = d || new Date();
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getScheduleIdForDate(db, dateStr) {
  const row = db.prepare("SELECT id FROM schedules WHERE date = ? ORDER BY id DESC LIMIT 1").get(dateStr);
  return row ? row.id : null;
}

function dedupeSchedulesForDate(db, dateStr, keepId) {
  db.prepare("DELETE FROM schedules WHERE date = ? AND id != ?").run(dateStr, keepId);
}

function dedupeAllScheduleDates(db) {
  const dupDates = db.prepare(`
    SELECT date FROM schedules GROUP BY date HAVING COUNT(*) > 1
  `).all();
  for (const { date } of dupDates) {
    const keep = db.prepare("SELECT id FROM schedules WHERE date = ? ORDER BY id DESC LIMIT 1").get(date);
    if (keep) dedupeSchedulesForDate(db, date, keep.id);
  }
}

function initSchedulesV2(db) {
  const legacy = [
    "schedule_content_items",
    "schedule_lanes",
    "schedule_subsections",
    "schedule_sections",
    "schedule_blocks",
  ];
  for (const t of legacy) {
    try { db.prepare(`DROP TABLE IF EXISTS ${t}`).run(); } catch (_) {}
  }

  const cols = db.prepare("PRAGMA table_info(schedules)").all().map((c) => c.name);
  if (cols.length && (!cols.includes("aud_everyone") || cols.includes("scope") || cols.includes("title"))) {
    db.prepare("DROP TABLE IF EXISTS schedule_entries").run();
    db.prepare("DROP TABLE IF EXISTS schedule_times").run();
    db.prepare("DROP TABLE IF EXISTS schedules").run();
  }

  db.prepare(`
    CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      aud_everyone INTEGER NOT NULL DEFAULT 1,
      aud_corps INTEGER NOT NULL DEFAULT 0,
      aud_independent INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS schedule_times (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_id INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
      time TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS schedule_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      time_id INTEGER NOT NULL REFERENCES schedule_times(id) ON DELETE CASCADE,
      group_type TEXT NOT NULL,
      location_label TEXT NOT NULL DEFAULT '',
      location_type TEXT,
      location_address TEXT,
      location_lat REAL,
      location_lng REAL,
      content TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0
    )
  `).run();

  db.prepare(`CREATE INDEX IF NOT EXISTS idx_schedules_date ON schedules(date ASC)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_schedule_times_sched ON schedule_times(schedule_id, sort_order, time)`).run();
  dedupeAllScheduleDates(db);
  try {
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_schedules_date_unique ON schedules(date)`).run();
  } catch (_) {
    dedupeAllScheduleDates(db);
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_schedules_date_unique ON schedules(date)`).run();
  }
}

function getScheduleAudienceForUser(db, userId) {
  const u = db.prepare(`
    SELECT id, admin, staff, director, parent, contractedCorps, contractedIndependent
    FROM users WHERE id = ?
  `).get(userId);
  if (!u) return { canAlwaysSee: false, everyone: false, corps: false, independent: false };

  if (u.admin || u.staff || u.director) {
    return { canAlwaysSee: true, everyone: true, corps: true, independent: true };
  }

  let corps = !!u.contractedCorps;
  let independent = !!u.contractedIndependent;
  if (u.parent) {
    const children = parentLinks.getChildrenForParent(db, u.id);
    corps = corps || children.some((c) => c.contractedCorps);
    independent = independent || children.some((c) => c.contractedIndependent);
  }
  return { canAlwaysSee: false, everyone: true, corps, independent };
}

function scheduleVisibleToUser(schedule, audienceCtx) {
  if (!schedule) return false;
  if (audienceCtx.canAlwaysSee) return true;
  const audEveryone = Number(schedule.aud_everyone);
  const audCorps = Number(schedule.aud_corps);
  const audIndependent = Number(schedule.aud_independent);
  if (!audEveryone && !audCorps && !audIndependent) return false;
  if (audEveryone && audienceCtx.everyone) return true;
  if (audCorps && audienceCtx.corps) return true;
  if (audIndependent && audienceCtx.independent) return true;
  return false;
}

function audienceFlagsFromBody(body) {
  return {
    aud_everyone: body.aud_everyone ? 1 : 0,
    aud_corps: body.aud_corps ? 1 : 0,
    aud_independent: body.aud_independent ? 1 : 0,
  };
}

function normalizeSectionKey(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, "");
}

function userRowForFilter(db, userId) {
  return db.prepare("SELECT section, indoorSection, parent FROM users WHERE id = ?").get(userId);
}

function childSectionsForParent(db, userId) {
  return parentLinks.getChildrenForParent(db, userId).map((c) => ({
    section: c.section,
    indoorSection: c.indoorSection,
  }));
}

function matchesGroup(groupType, userRow, childRows, isStaffAdmin) {
  if (isStaffAdmin) return true;
  if (groupType === "whole_corps") return true;

  const checkSection = (section, indoor) => {
    const s = normalizeSectionKey(section);
    const ind = normalizeSectionKey(indoor);
    if (groupType === "brass") return s === "brass";
    if (groupType === "guard") return s === "guard";
    if (groupType === "front_ensemble") return s === "frontensemble" || ind === "frontensemble";
    if (groupType === "drumline") {
      return ["drumline", "drummajor", "percussion"].includes(s) || ind === "drumline";
    }
    return false;
  };

  if (userRow && checkSection(userRow.section, userRow.indoorSection)) return true;
  if (childRows && childRows.some((c) => checkSection(c.section, c.indoorSection))) return true;
  return false;
}

function serializeEntry(row) {
  return {
    id: row.id,
    group: row.group_type,
    group_label: SCHEDULE_GROUPS[row.group_type] || row.group_type,
    location_label: row.location_label || "",
    location_type: row.location_type || null,
    location_address: row.location_address || null,
    location_lat: row.location_lat != null ? Number(row.location_lat) : null,
    location_lng: row.location_lng != null ? Number(row.location_lng) : null,
    content: row.content || "",
  };
}

function loadScheduleTimes(db, scheduleId, userId, forEditor) {
  const userRow = userRowForFilter(db, userId);
  const childRows = userRow?.parent ? childSectionsForParent(db, userId) : [];
  const isStaffAdmin = forEditor || (() => {
    const u = db.prepare("SELECT admin, staff, director FROM users WHERE id = ?").get(userId);
    return !!(u && (u.admin || u.staff || u.director));
  })();

  const times = db.prepare(`
    SELECT * FROM schedule_times WHERE schedule_id = ?
    ORDER BY sort_order ASC, time ASC, id ASC
  `).all(scheduleId);

  return times.map((t) => {
    const entries = db.prepare(`
      SELECT * FROM schedule_entries WHERE time_id = ?
      ORDER BY sort_order ASC, id ASC
    `).all(t.id);
    const visible = forEditor || isStaffAdmin
      ? entries
      : entries.filter((e) => matchesGroup(e.group_type, userRow, childRows, false));
    return {
      id: t.id,
      time: t.time,
      title: t.title || "",
      entries: visible.map(serializeEntry),
    };
  }).filter((t) => forEditor || isStaffAdmin || t.entries.length > 0);
}

function loadSchedulePayload(db, scheduleRow, userId, forEditor) {
  if (!scheduleRow) return null;
  const audienceCtx = getScheduleAudienceForUser(db, userId);
  if (!forEditor && !scheduleVisibleToUser(scheduleRow, audienceCtx)) return null;

  return {
    id: scheduleRow.id,
    date: scheduleRow.date,
    aud_everyone: Number(scheduleRow.aud_everyone) || 0,
    aud_corps: Number(scheduleRow.aud_corps) || 0,
    aud_independent: Number(scheduleRow.aud_independent) || 0,
    times: loadScheduleTimes(db, scheduleRow.id, userId, forEditor),
  };
}

function saveScheduleTree(db, scheduleId, times) {
  db.prepare("DELETE FROM schedule_times WHERE schedule_id = ?").run(scheduleId);

  const insertTime = db.prepare(`
    INSERT INTO schedule_times (schedule_id, time, title, sort_order) VALUES (?, ?, ?, ?)
  `);
  const insertEntry = db.prepare(`
    INSERT INTO schedule_entries
      (time_id, group_type, location_label, location_type, location_address, location_lat, location_lng, content, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  (times || []).forEach((t, ti) => {
    const timeInfo = insertTime.run(scheduleId, t.time || "08:00", t.title || "", t.sort_order ?? ti);
    const timeId = timeInfo.lastInsertRowid;
    (t.entries || []).forEach((e, ei) => {
      const gt = e.group || e.group_type;
      if (!SCHEDULE_GROUPS[gt]) return;
      insertEntry.run(
        timeId,
        gt,
        e.location_label || "",
        e.location_type || null,
        e.location_address || null,
        e.location_lat != null ? Number(e.location_lat) : null,
        e.location_lng != null ? Number(e.location_lng) : null,
        e.content || "",
        e.sort_order ?? ei,
      );
    });
  });
}

function registerScheduleSystem(app, db, deps) {
  const { webScheduleAuth, canEditSchedules, mobileAuth, mustBeAdmin } = deps;

  function handleSave(req, res, existingId) {
    if (!canEditSchedules(req)) {
      return res.status(403).json({ ok: false, message: "Admin or director only" });
    }
    const { date, times } = req.body;
    if (!date) return res.status(400).json({ ok: false, message: "date is required" });
    const dateStr = String(date).slice(0, 10);
    const aud = audienceFlagsFromBody(req.body);
    const now = Date.now();

    let scheduleId = existingId > 0 ? Number(existingId) : null;
    const existingForDate = getScheduleIdForDate(db, dateStr);

    if (existingForDate) {
      scheduleId = scheduleId === existingForDate ? scheduleId : existingForDate;
      dedupeSchedulesForDate(db, dateStr, scheduleId);
    } else if (scheduleId) {
      const ex = db.prepare("SELECT id FROM schedules WHERE id = ?").get(scheduleId);
      if (!ex) scheduleId = null;
    }

    if (existingId > 0 && existingId !== scheduleId) {
      db.prepare("DELETE FROM schedules WHERE id = ?").run(existingId);
    }

    if (scheduleId) {
      const ex = db.prepare("SELECT id FROM schedules WHERE id = ?").get(scheduleId);
      if (!ex) return res.status(404).json({ ok: false, message: "Schedule not found" });
      db.prepare(`
        UPDATE schedules SET date = ?, aud_everyone = ?, aud_corps = ?, aud_independent = ?, updated_at = ?
        WHERE id = ?
      `).run(dateStr, aud.aud_everyone, aud.aud_corps, aud.aud_independent, now, scheduleId);
    } else {
      const info = db.prepare(`
        INSERT INTO schedules (date, aud_everyone, aud_corps, aud_independent, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(dateStr, aud.aud_everyone, aud.aud_corps, aud.aud_independent, req.user.userid, now, now);
      scheduleId = info.lastInsertRowid;
    }

    dedupeSchedulesForDate(db, dateStr, scheduleId);

    if (Array.isArray(times)) saveScheduleTree(db, scheduleId, times);
    return res.json({ ok: true, scheduleId });
  }

  function listSchedules(req, res, listAll) {
    try {
      const audienceCtx = getScheduleAudienceForUser(db, req.user.userid);
      const forEditor = req.query.edit === "1" && canEditSchedules(req);
      const dateFilter = req.query.date ? String(req.query.date) : null;
      let rows;
      if (listAll) {
        rows = db.prepare(`
          SELECT s.id, s.date, s.aud_everyone, s.aud_corps, s.aud_independent, s.updated_at
          FROM schedules s
          INNER JOIN (
            SELECT date, MAX(id) AS id FROM schedules GROUP BY date
          ) latest ON s.id = latest.id
          ORDER BY s.date DESC LIMIT 200
        `).all();
      } else if (dateFilter) {
        const normalizedDate = String(dateFilter).slice(0, 10);
        rows = db.prepare(`
          SELECT * FROM schedules WHERE date = ? ORDER BY id DESC LIMIT 1
        `).all(normalizedDate);
      } else {
        const today = todayYmdLocal();
        rows = db.prepare(`
          SELECT * FROM schedules WHERE date >= ? ORDER BY date ASC LIMIT 60
        `).all(today);
      }

      const schedules = rows
        .filter((s) => listAll || scheduleVisibleToUser(s, audienceCtx))
        .map((s) => {
          if (listAll) {
            const tc = db.prepare("SELECT COUNT(*) AS c FROM schedule_times WHERE schedule_id = ?").get(s.id);
            return {
              id: s.id,
              date: s.date,
              aud_everyone: Number(s.aud_everyone) || 0,
              aud_corps: Number(s.aud_corps) || 0,
              aud_independent: Number(s.aud_independent) || 0,
              timeCount: tc?.c || 0,
            };
          }
          return loadSchedulePayload(db, s, req.user.userid, forEditor);
        });

      return res.json({ ok: true, schedules });
    } catch (e) {
      console.error("[Schedules] list error:", e);
      return res.status(500).json({ ok: false, message: "Server error" });
    }
  }

  const mobileList = (req, res) => listSchedules(req, res, req.query.all === "1" && canEditSchedules(req));
  app.get("/api/mobile/schedules", mobileAuth, mobileList);
  app.get("/api/web/schedules", webScheduleAuth, (req, res) => listSchedules(req, res, req.query.all === "1" && canEditSchedules(req)));

  function getDetail(req, res) {
    try {
      const row = db.prepare("SELECT * FROM schedules WHERE id = ?").get(Number(req.params.id));
      if (!row) return res.status(404).json({ ok: false, message: "Schedule not found" });
      const payload = loadSchedulePayload(db, row, req.user.userid, canEditSchedules(req));
      if (!payload) return res.status(403).json({ ok: false, message: "You do not have access to this schedule." });
      return res.json({ ok: true, schedule: payload });
    } catch (e) {
      return res.status(500).json({ ok: false, message: "Server error" });
    }
  }
  app.get("/api/mobile/schedules/:id", mobileAuth, getDetail);
  app.get("/api/web/schedules/:id", webScheduleAuth, getDetail);

  app.post("/api/mobile/schedules", mobileAuth, (req, res) => {
    const existingId = Number(req.body.id);
    return handleSave(req, res, existingId > 0 ? existingId : null);
  });
  app.post("/api/web/schedules", webScheduleAuth, (req, res) => {
    const existingId = Number(req.body.id);
    return handleSave(req, res, existingId > 0 ? existingId : null);
  });
  app.post("/api/mobile/schedules/update", mobileAuth, (req, res) => {
    const id = Number(req.body.id);
    if (!id) return res.status(400).json({ ok: false, message: "id is required" });
    return handleSave(req, res, id);
  });
  app.post("/api/web/schedules/update", webScheduleAuth, (req, res) => {
    const id = Number(req.body.id);
    if (!id) return res.status(400).json({ ok: false, message: "id is required" });
    return handleSave(req, res, id);
  });
  app.put("/api/mobile/schedules/:id", mobileAuth, (req, res) => handleSave(req, res, Number(req.params.id)));

  function deleteSchedule(req, res) {
    if (!canEditSchedules(req)) return res.status(403).json({ ok: false, message: "Admin or director only" });
    try {
      const id = Number(req.params.id);
      const ex = db.prepare("SELECT id FROM schedules WHERE id = ?").get(id);
      if (!ex) return res.status(404).json({ ok: false, message: "Schedule not found" });
      db.prepare("DELETE FROM schedules WHERE id = ?").run(id);
      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ ok: false, message: "Server error" });
    }
  }
  app.delete("/api/mobile/schedules/:id", mobileAuth, deleteSchedule);
  app.delete("/api/web/schedules/:id", webScheduleAuth, deleteSchedule);

  app.get("/admin/schedules", mustBeAdmin, (req, res) => {
    const schedules = db.prepare(`
      SELECT s.id, s.date, s.aud_everyone, s.aud_corps, s.aud_independent,
        (SELECT COUNT(*) FROM schedule_times t WHERE t.schedule_id = s.id) AS time_count
      FROM schedules s
      INNER JOIN (
        SELECT date, MAX(id) AS id FROM schedules GROUP BY date
      ) latest ON s.id = latest.id
      ORDER BY s.date DESC LIMIT 200
    `).all();
    return res.render("admin-schedules", { schedules });
  });

  app.get("/admin/schedules/designer/today", mustBeAdmin, (req, res) => {
    const today = todayYmdLocal();
    const existing = getScheduleIdForDate(db, today);
    if (existing) return res.redirect(`/admin/schedules/designer/${existing}`);
    return res.redirect(`/admin/schedules/designer?date=${today}`);
  });

  app.get("/admin/schedules/designer", mustBeAdmin, (req, res) => {
    const date = req.query.date ? String(req.query.date).slice(0, 10) : null;
    if (date) {
      const existing = getScheduleIdForDate(db, date);
      if (existing) return res.redirect(`/admin/schedules/designer/${existing}`);
    }
    return res.render("admin-schedule-designer", {
      scheduleId: null,
      initialDate: date,
    });
  });

  app.get("/admin/schedules/designer/:id", mustBeAdmin, (req, res) => {
    const scheduleId = Number(req.params.id);
    if (!db.prepare("SELECT id FROM schedules WHERE id = ?").get(scheduleId)) {
      req.session.flashMessage = "Schedule not found.";
      return res.redirect("/admin/schedules");
    }
    return res.render("admin-schedule-designer", { scheduleId, initialDate: null });
  });
}

function loadNextScheduleForDashboard(db, userId, includeAllEntries) {
  const today = todayYmdLocal();
  const audienceCtx = getScheduleAudienceForUser(db, userId);
  const rows = db.prepare(`
    SELECT * FROM schedules WHERE date >= ? ORDER BY date ASC LIMIT 1
  `).all(today);
  for (const row of rows) {
    if (!scheduleVisibleToUser(row, audienceCtx)) continue;
    const payload = loadSchedulePayload(db, row, userId, includeAllEntries);
    if (payload && payload.times.length) return payload;
  }
  return null;
}

module.exports = {
  SCHEDULE_GROUPS,
  initSchedulesV2,
  todayYmdLocal,
  getScheduleIdForDate,
  getScheduleAudienceForUser,
  scheduleVisibleToUser,
  loadSchedulePayload,
  loadNextScheduleForDashboard,
  registerScheduleSystem,
};
