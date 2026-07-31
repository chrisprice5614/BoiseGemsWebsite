const path = require("path");
const Database = require("better-sqlite3");

const DB_PATH = path.join(__dirname, "..", "..", "data.db");

function openDb() {
  return new Database(DB_PATH, { readonly: true, fileMustExist: true });
}

function getUserByEmail(email) {
  const db = openDb();
  try {
    return db.prepare("SELECT * FROM users WHERE LOWER(email) = LOWER(?)").get(email) || null;
  } finally {
    db.close();
  }
}

function getAuditRows({ action, q, limit = 50 } = {}) {
  const db = openDb();
  try {
    let sql = "SELECT * FROM audit_log WHERE 1=1";
    const params = [];
    if (action) {
      sql += " AND action = ?";
      params.push(action);
    }
    if (q) {
      sql += " AND (actor_email LIKE ? OR target_id LIKE ? OR CAST(meta_json AS TEXT) LIKE ?)";
      const like = `%${q}%`;
      params.push(like, like, like);
    }
    sql += " ORDER BY created_at DESC LIMIT ?";
    params.push(limit);
    return db.prepare(sql).all(...params);
  } finally {
    db.close();
  }
}

function getAllergies(userId) {
  const db = openDb();
  try {
    return db.prepare("SELECT * FROM allergies WHERE user_id = ?").get(userId) || null;
  } finally {
    db.close();
  }
}

function getEmergencyContacts(userId) {
  const db = openDb();
  try {
    return db.prepare("SELECT * FROM emergencyContacts WHERE user_id = ?").all(userId);
  } finally {
    db.close();
  }
}

function getPaymentHistory(userId) {
  const db = openDb();
  try {
    return db
      .prepare("SELECT * FROM paymentHistory WHERE user_id = ? ORDER BY date DESC")
      .all(userId);
  } finally {
    db.close();
  }
}

function isParentOf(parentId, childId) {
  const db = openDb();
  try {
    const link = db
      .prepare("SELECT 1 AS ok FROM parent_child_links WHERE parent_id = ? AND child_id = ?")
      .get(parentId, childId);
    return !!link;
  } finally {
    db.close();
  }
}

module.exports = {
  getUserByEmail,
  getAuditRows,
  getAllergies,
  getEmergencyContacts,
  getPaymentHistory,
  isParentOf,
};
