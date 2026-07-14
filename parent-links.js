/**
 * Parent-child linking: many parents per child, request/accept flow.
 */

function initParentLinks(db) {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS parent_child_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_id INTEGER NOT NULL,
      child_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(parent_id, child_id),
      FOREIGN KEY (parent_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (child_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS parent_link_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requester_id INTEGER NOT NULL,
      target_user_id INTEGER NOT NULL,
      target_email TEXT NOT NULL,
      direction TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `).run();

  db.prepare(`CREATE INDEX IF NOT EXISTS idx_pcl_parent ON parent_child_links(parent_id)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_pcl_child ON parent_child_links(child_id)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_plr_target ON parent_link_requests(target_user_id, status)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_plr_requester ON parent_link_requests(requester_id, status)`).run();

  migrateLegacyParentLinks(db);
  migrateLegacyChildVerify(db);
}

function migrateLegacyParentLinks(db) {
  const rows = db.prepare(`
    SELECT id, parentId FROM users WHERE parentId IS NOT NULL AND parentId > 0
  `).all();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO parent_child_links (parent_id, child_id, created_at) VALUES (?, ?, ?)
  `);
  const now = Date.now();
  for (const row of rows) {
    insert.run(row.parentId, row.id, now);
  }
}

function migrateLegacyChildVerify(db) {
  const rows = db.prepare("SELECT * FROM childVerify").all();
  if (!rows.length) return;
  const insert = db.prepare(`
    INSERT INTO parent_link_requests
      (requester_id, target_user_id, target_email, direction, status, created_at, updated_at)
    VALUES (?, ?, ?, 'parent_to_child', 'pending', ?, ?)
  `);
  const now = Date.now();
  for (const row of rows) {
    const child = db.prepare("SELECT email FROM users WHERE id = ?").get(row.target_id);
    const parent = db.prepare("SELECT email FROM users WHERE id = ?").get(row.user_id);
    if (!child || !parent) continue;
    const existing = db.prepare(`
      SELECT id FROM parent_link_requests
      WHERE requester_id = ? AND target_user_id = ? AND status = 'pending'
    `).get(row.user_id, row.target_id);
    if (existing) continue;
    insert.run(row.user_id, row.target_id, child.email || "", now, now);
  }
}

function isParentAccount(userRow) {
  return !!(userRow && (userRow.parent || String(userRow.section || "").toLowerCase() === "parent"));
}

function isParentOf(db, parentId, childId) {
  if (!parentId || !childId) return false;
  const linked = db.prepare(`
    SELECT 1 FROM parent_child_links WHERE parent_id = ? AND child_id = ?
  `).get(parentId, childId);
  if (linked) return true;
  const legacy = db.prepare("SELECT parentId FROM users WHERE id = ?").get(childId);
  return !!(legacy && Number(legacy.parentId) === Number(parentId));
}

function childHasLinkedParent(db, childId) {
  if (!childId) return false;
  const linked = db.prepare(`
    SELECT 1 FROM parent_child_links WHERE child_id = ? LIMIT 1
  `).get(childId);
  if (linked) return true;
  const legacy = db.prepare("SELECT parentId FROM users WHERE id = ?").get(childId);
  return !!(legacy && Number(legacy.parentId) > 0);
}

function getChildrenForParent(db, parentId) {
  return db.prepare(`
    SELECT DISTINCT u.*
    FROM users u
    LEFT JOIN parent_child_links l ON l.child_id = u.id AND l.parent_id = ?
    WHERE l.id IS NOT NULL OR u.parentId = ?
    ORDER BY u.lastname COLLATE NOCASE ASC, u.firstname COLLATE NOCASE ASC
  `).all(parentId, parentId);
}

function getParentsForChild(db, childId) {
  return db.prepare(`
    SELECT DISTINCT u.*
    FROM users u
    LEFT JOIN parent_child_links l ON l.parent_id = u.id AND l.child_id = ?
    WHERE l.id IS NOT NULL OR u.id = (
      SELECT parentId FROM users WHERE id = ? AND parentId IS NOT NULL AND parentId > 0
    )
    ORDER BY u.lastname COLLATE NOCASE ASC, u.firstname COLLATE NOCASE ASC
  `).all(childId, childId);
}

function getPrimaryParentId(db, childId) {
  const link = db.prepare(`
    SELECT parent_id FROM parent_child_links WHERE child_id = ? ORDER BY created_at ASC, id ASC LIMIT 1
  `).get(childId);
  if (link) return link.parent_id;
  const legacy = db.prepare("SELECT parentId FROM users WHERE id = ?").get(childId);
  return legacy && Number(legacy.parentId) > 0 ? Number(legacy.parentId) : null;
}

function linkParentChild(db, parentId, childId) {
  const now = Date.now();
  db.prepare(`
    INSERT OR IGNORE INTO parent_child_links (parent_id, child_id, created_at) VALUES (?, ?, ?)
  `).run(parentId, childId, now);

  const child = db.prepare("SELECT parentId FROM users WHERE id = ?").get(childId);
  if (!child || !child.parentId || Number(child.parentId) === 0) {
    db.prepare("UPDATE users SET parentId = ? WHERE id = ?").run(parentId, childId);
  }
}

function cancelPendingBetween(db, userA, userB) {
  db.prepare(`
    UPDATE parent_link_requests SET status = 'cancelled', updated_at = ?
    WHERE status = 'pending' AND (
      (requester_id = ? AND target_user_id = ?) OR
      (requester_id = ? AND target_user_id = ?)
    )
  `).run(Date.now(), userA, userB, userB, userA);
}

function createLinkRequest(db, requester, targetEmailRaw) {
  const targetEmail = String(targetEmailRaw || "").trim().toLowerCase();
  if (!targetEmail) return { ok: false, code: "missing_email", message: "Please enter an email address." };

  const requesterRow = db.prepare("SELECT id, email, parent, section FROM users WHERE id = ?").get(requester.userid);
  if (!requesterRow) return { ok: false, code: "error", message: "Could not load your account." };

  if (String(requesterRow.email || "").toLowerCase() === targetEmail) {
    return { ok: false, code: "self", message: "You cannot link to your own email." };
  }

  const target = db.prepare("SELECT id, email, parent, section, firstname, lastname FROM users WHERE LOWER(email) = ?").get(targetEmail);
  if (!target) {
    return { ok: false, code: "not_found", message: "No email found. Please have them create an account." };
  }

  const requesterIsParent = isParentAccount(requesterRow) || !!requester.parent;
  const targetIsParent = isParentAccount(target);

  let direction;
  let parentId;
  let childId;

  if (requesterIsParent) {
    if (targetIsParent) {
      return { ok: false, code: "invalid_target", message: "That account is a parent account, not a member." };
    }
    direction = "parent_to_child";
    parentId = requesterRow.id;
    childId = target.id;
  } else {
    if (!targetIsParent) {
      return { ok: false, code: "not_found", message: "No email found. Please have them create an account." };
    }
    direction = "child_to_parent";
    parentId = target.id;
    childId = requesterRow.id;
  }

  if (isParentOf(db, parentId, childId)) {
    return { ok: false, code: "already_linked", message: "You are already linked with this person." };
  }

  const pending = db.prepare(`
    SELECT id FROM parent_link_requests
    WHERE status = 'pending' AND requester_id = ? AND target_user_id = ?
  `).get(requesterRow.id, target.id);
  if (pending) {
    return { ok: true, code: "already_pending", message: "Request sent!" };
  }

  const reversePending = db.prepare(`
    SELECT id FROM parent_link_requests
    WHERE status = 'pending' AND requester_id = ? AND target_user_id = ?
  `).get(target.id, requesterRow.id);
  if (reversePending) {
    return acceptLinkRequest(db, reversePending.id, requesterRow.id);
  }

  const now = Date.now();
  db.prepare(`
    INSERT INTO parent_link_requests
      (requester_id, target_user_id, target_email, direction, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'pending', ?, ?)
  `).run(requesterRow.id, target.id, targetEmail, direction, now, now);

  return { ok: true, code: "sent", message: "Request sent!" };
}

function serializeRequest(row) {
  return {
    id: row.id,
    direction: row.direction,
    status: row.status,
    created_at: row.created_at,
    requester_id: row.requester_id,
    requester_first: row.requester_first,
    requester_last: row.requester_last,
    requester_email: row.requester_email,
    target_user_id: row.target_user_id,
    target_first: row.target_first,
    target_last: row.target_last,
    target_email: row.target_email,
  };
}

function getIncomingRequests(db, userId) {
  const rows = db.prepare(`
    SELECT r.*,
      ru.firstname AS requester_first, ru.lastname AS requester_last, ru.email AS requester_email,
      tu.firstname AS target_first, tu.lastname AS target_last, tu.email AS target_email
    FROM parent_link_requests r
    JOIN users ru ON ru.id = r.requester_id
    JOIN users tu ON tu.id = r.target_user_id
    WHERE r.target_user_id = ? AND r.status = 'pending'
    ORDER BY r.created_at DESC
  `).all(userId);
  return rows.map(serializeRequest);
}

function getOutgoingRequests(db, userId) {
  const rows = db.prepare(`
    SELECT r.*,
      ru.firstname AS requester_first, ru.lastname AS requester_last, ru.email AS requester_email,
      tu.firstname AS target_first, tu.lastname AS target_last, tu.email AS target_email
    FROM parent_link_requests r
    JOIN users ru ON ru.id = r.requester_id
    JOIN users tu ON tu.id = r.target_user_id
    WHERE r.requester_id = ? AND r.status = 'pending'
    ORDER BY r.created_at DESC
  `).all(userId);
  return rows.map(serializeRequest);
}

function acceptLinkRequest(db, requestId, accepterUserId) {
  const reqRow = db.prepare(`
    SELECT r.*,
      ru.firstname AS requester_first, ru.lastname AS requester_last, ru.email AS requester_email,
      tu.firstname AS target_first, tu.lastname AS target_last, tu.email AS target_email
    FROM parent_link_requests r
    JOIN users ru ON ru.id = r.requester_id
    JOIN users tu ON tu.id = r.target_user_id
    WHERE r.id = ?
  `).get(requestId);

  if (!reqRow || reqRow.status !== "pending") {
    return { ok: false, message: "This request is no longer available." };
  }
  if (Number(reqRow.target_user_id) !== Number(accepterUserId)) {
    return { ok: false, message: "You cannot accept this request." };
  }

  let parentId;
  let childId;
  if (reqRow.direction === "parent_to_child") {
    parentId = reqRow.requester_id;
    childId = reqRow.target_user_id;
  } else {
    parentId = reqRow.target_user_id;
    childId = reqRow.requester_id;
  }

  linkParentChild(db, parentId, childId);
  db.prepare(`
    UPDATE parent_link_requests SET status = 'accepted', updated_at = ? WHERE id = ?
  `).run(Date.now(), requestId);
  cancelPendingBetween(db, parentId, childId);

  db.prepare("DELETE FROM childVerify WHERE user_id = ? AND target_id = ?").run(parentId, childId);

  return {
    ok: true,
    message: "Link accepted.",
    request: serializeRequest(reqRow),
  };
}

function declineLinkRequest(db, requestId, userId) {
  const reqRow = db.prepare("SELECT * FROM parent_link_requests WHERE id = ?").get(requestId);
  if (!reqRow || reqRow.status !== "pending") {
    return { ok: false, message: "This request is no longer available." };
  }
  if (Number(reqRow.target_user_id) !== Number(userId)) {
    return { ok: false, message: "You cannot decline this request." };
  }
  db.prepare(`
    UPDATE parent_link_requests SET status = 'declined', updated_at = ? WHERE id = ?
  `).run(Date.now(), requestId);
  return { ok: true, message: "Request declined." };
}

function acceptLegacyChildVerifyCode(db, code, loggedInUserId) {
  const verify = db.prepare("SELECT * FROM childVerify WHERE code = ?").get(code);
  if (!verify) return { ok: false, message: "Invalid or expired link." };
  if (Number(verify.target_id) !== Number(loggedInUserId)) {
    return { ok: false, message: "Please log in as the member this request was sent to." };
  }

  linkParentChild(db, verify.user_id, verify.target_id);
  db.prepare("DELETE FROM childVerify WHERE id = ?").run(verify.id);
  cancelPendingBetween(db, verify.user_id, verify.target_id);
  db.prepare(`
    UPDATE parent_link_requests SET status = 'accepted', updated_at = ?
    WHERE status = 'pending' AND requester_id = ? AND target_user_id = ?
  `).run(Date.now(), verify.user_id, verify.target_id);

  const parent = db.prepare("SELECT firstname, lastname FROM users WHERE id = ?").get(verify.user_id);
  return {
    ok: true,
    message: parent ? `You have added ${parent.firstname} ${parent.lastname} as a parent/guardian.` : "Parent/guardian linked.",
  };
}

function cleanupUserParentLinks(db, userId) {
  const affectedChildren = db.prepare(`
    SELECT DISTINCT child_id AS id FROM parent_child_links WHERE parent_id = ?
  `).all(userId).map((r) => r.id);

  db.prepare("DELETE FROM parent_child_links WHERE parent_id = ? OR child_id = ?").run(userId, userId);
  db.prepare("UPDATE users SET parentId = NULL WHERE parentId = ?").run(userId);
  db.prepare(`
    UPDATE parent_link_requests SET status = 'cancelled', updated_at = ?
    WHERE status = 'pending' AND (requester_id = ? OR target_user_id = ?)
  `).run(Date.now(), userId, userId);
  db.prepare("DELETE FROM childVerify WHERE user_id = ? OR target_id = ?").run(userId, userId);

  for (const childId of affectedChildren) {
    const primary = getPrimaryParentId(db, childId);
    db.prepare("UPDATE users SET parentId = ? WHERE id = ?").run(primary, childId);
  }
}

function getChildrenForParentQueries(db, parentIds) {
  if (!parentIds || !parentIds.length) return [];
  const placeholders = parentIds.map(() => "?").join(",");
  return db.prepare(`
    SELECT DISTINCT u.id, u.firstname, u.lastname, u.parentId, l.parent_id AS link_parent_id
    FROM users u
    INNER JOIN parent_child_links l ON l.child_id = u.id
    WHERE l.parent_id IN (${placeholders})
    UNION
    SELECT u.id, u.firstname, u.lastname, u.parentId, u.parentId AS link_parent_id
    FROM users u
    WHERE u.parentId IN (${placeholders})
  `).all(...parentIds, ...parentIds);
}

function registerParentLinkRoutes(app, db, deps) {
  const { mustBeLoggedIn } = deps;

  app.post("/api/web/parent-link/request", mustBeLoggedIn, (req, res) => {
    try {
      const result = createLinkRequest(db, req.user, req.body.email);
      return res.json(result);
    } catch (e) {
      console.error("[ParentLink] request error:", e);
      return res.status(500).json({ ok: false, message: "Server error." });
    }
  });

  app.get("/api/web/parent-link/requests/incoming", mustBeLoggedIn, (req, res) => {
    try {
      return res.json({ ok: true, requests: getIncomingRequests(db, req.user.userid) });
    } catch (e) {
      return res.status(500).json({ ok: false, message: "Server error." });
    }
  });

  app.post("/api/web/parent-link/requests/:id/accept", mustBeLoggedIn, (req, res) => {
    try {
      const result = acceptLinkRequest(db, Number(req.params.id), req.user.userid);
      const status = result.ok ? 200 : 400;
      return res.status(status).json(result);
    } catch (e) {
      return res.status(500).json({ ok: false, message: "Server error." });
    }
  });

  app.post("/api/web/parent-link/requests/:id/decline", mustBeLoggedIn, (req, res) => {
    try {
      const result = declineLinkRequest(db, Number(req.params.id), req.user.userid);
      const status = result.ok ? 200 : 400;
      return res.status(status).json(result);
    } catch (e) {
      return res.status(500).json({ ok: false, message: "Server error." });
    }
  });
}

module.exports = {
  initParentLinks,
  isParentAccount,
  isParentOf,
  childHasLinkedParent,
  getChildrenForParent,
  getParentsForChild,
  getPrimaryParentId,
  linkParentChild,
  createLinkRequest,
  getIncomingRequests,
  getOutgoingRequests,
  acceptLinkRequest,
  declineLinkRequest,
  acceptLegacyChildVerifyCode,
  cleanupUserParentLinks,
  getChildrenForParentQueries,
  registerParentLinkRoutes,
};
