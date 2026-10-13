/**
 * Video auditions — materials first, then Neopply (no site fee).
 * https://www.neopply.com/org/boise-gems
 */
const neopplyPartner = require("./neopply-partner");

const NEOPPLY_ORG_AUDITION_URL =
  process.env.NEOPPLY_ORG_AUDITION_URL || "https://www.neopply.com/org/boise-gems";

const PROGRAMS = {
  corps: {
    key: "corps",
    label: "Boise Gems Drum & Bugle Corps",
    shortLabel: "Corps",
    feeCents: 0,
    materialSections: [
      "brass",
      "drumline",
      "guard",
      "front ensemble",
      "drum major",
    ],
  },
  independent: {
    key: "independent",
    label: "Boise Gems Independent",
    shortLabel: "BGI",
    feeCents: 0,
    materialSections: [
      "brass",
      "drumline (independent)",
      "front ensemble (independent)",
    ],
  },
};

const MATERIAL_LABELS = {
  brass: "Brass",
  drumline: "Drumline (Battery)",
  guard: "Color Guard",
  "front ensemble": "Front Ensemble",
  "drum major": "Drum Major Audition",
  "drumline (independent)": "Drumline (Independent)",
  "front ensemble (independent)": "Front Ensemble (Independent)",
};

/** Omnipply apply URLs by program + section. Update IDs here when programs change. */
const OMNIPPLY_URLS = {
  corps: {
    brass: "https://www.omnipply.com/programs/34bbd8ff-73b0-4452-a1ae-617a566d8817/apply",
    drumline: "https://www.omnipply.com/programs/54e57104-fb5f-4df1-8ad4-8a61f24513b8/apply",
    "front ensemble": "https://www.omnipply.com/programs/54e57104-fb5f-4df1-8ad4-8a61f24513b8/apply",
    default: "https://www.omnipply.com/programs/34bbd8ff-73b0-4452-a1ae-617a566d8817/apply",
  },
  independent: {
    brass: "https://www.omnipply.com/programs/34bbd8ff-73b0-4452-a1ae-617a566d8817/apply",
    drumline: "https://www.omnipply.com/programs/54e57104-fb5f-4df1-8ad4-8a61f24513b8/apply",
    "front ensemble": "https://www.omnipply.com/programs/54e57104-fb5f-4df1-8ad4-8a61f24513b8/apply",
    default: "https://www.omnipply.com/programs/54e57104-fb5f-4df1-8ad4-8a61f24513b8/apply",
  },
};

function normalizeProgram(raw) {
  const p = String(raw || "").trim().toLowerCase();
  if (p === "corps" || p === "dbc" || p === "drum corps") return "corps";
  if (p === "independent" || p === "bgi" || p === "indie") return "independent";
  return null;
}

function getProgram(raw) {
  const key = normalizeProgram(raw);
  return key ? PROGRAMS[key] : null;
}

function getOmnipplyUrl(programKey, section) {
  const map = OMNIPPLY_URLS[programKey];
  if (!map) return null;
  const sec = String(section || "").trim().toLowerCase();
  return map[sec] || map.default || null;
}

function getMaterialsForProgram(db, programKey) {
  const program = getProgram(programKey) || PROGRAMS.corps;
  const sections = program.materialSections || [];
  const rows = db.prepare("SELECT section, pdf FROM materials").all();
  const bySection = {};
  for (const r of rows) {
    const key = String(r.section || "").toLowerCase().trim();
    if (r.pdf) bySection[key] = r.pdf;
  }
  return sections.map((key) => ({
    key,
    label: MATERIAL_LABELS[key] || key,
    pdf: bySection[key] || null,
  }));
}

function videoAuditionPagePath(programKey) {
  const key = normalizeProgram(programKey) || "corps";
  return `/video-audition?program=${encodeURIComponent(key)}`;
}

function isVideoAuditionFeeBypassed() {
  return String(process.env.VIDEO_AUDITION_BYPASS_FEE || "").trim().toLowerCase() === "true";
}

function initVideoAudition(db) {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS potential_video_audition (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      program TEXT NOT NULL,
      season_year INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      processing_fee INTEGER NOT NULL,
      total_charge INTEGER NOT NULL,
      stripe_session_id TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS video_audition_unlocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      program TEXT NOT NULL,
      season_year INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      stripe_session_id TEXT,
      unlocked_at INTEGER NOT NULL,
      UNIQUE(user_id, program, season_year),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `).run();

  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_video_audition_unlocks_user
    ON video_audition_unlocks(user_id, season_year)
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS neopply_data_consent (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      program TEXT NOT NULL,
      consented_at INTEGER NOT NULL,
      UNIQUE(user_id, program),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `).run();
}

function hasUnlock(db, userId, programKey, seasonYear) {
  if (isVideoAuditionFeeBypassed()) return true;
  const row = db.prepare(`
    SELECT id FROM video_audition_unlocks
    WHERE user_id = ? AND program = ? AND season_year = ?
    LIMIT 1
  `).get(userId, programKey, seasonYear);
  return !!row;
}

function getUnlocksForUser(db, userId, seasonYear) {
  if (isVideoAuditionFeeBypassed()) {
    return { corps: true, independent: true, rows: [] };
  }
  const rows = db.prepare(`
    SELECT program, season_year, unlocked_at, amount
    FROM video_audition_unlocks
    WHERE user_id = ? AND season_year = ?
  `).all(userId, seasonYear);
  const out = { corps: false, independent: false, rows };
  for (const r of rows) {
    if (r.program === "corps") out.corps = true;
    if (r.program === "independent") out.independent = true;
  }
  return out;
}

function hasNeopplyConsent(db, userId, programKey) {
  const row = db.prepare(`
    SELECT id FROM neopply_data_consent
    WHERE user_id = ? AND program = ?
    LIMIT 1
  `).get(userId, programKey);
  return !!row;
}

function recordNeopplyConsent(db, userId, programKey) {
  db.prepare(`
    INSERT OR REPLACE INTO neopply_data_consent (user_id, program, consented_at)
    VALUES (?, ?, ?)
  `).run(userId, programKey, Date.now());
}

function getPortalAuditionActions(db, member, seasonYear) {
  const actions = [];

  if (!member.contractedCorps) {
    actions.push({
      program: "corps",
      shortLabel: PROGRAMS.corps.shortLabel,
      label: PROGRAMS.corps.label,
      feeCents: 0,
      unlocked: true,
      seasonYear,
      provider: "neopply",
      url: videoAuditionPagePath("corps"),
      embedHref: null,
      payHref: videoAuditionPagePath("corps"),
      neopplyUrl: NEOPPLY_ORG_AUDITION_URL,
      external: false,
      hasConsent: true,
    });
  }

  if (!member.contractedIndependent) {
    actions.push({
      program: "independent",
      shortLabel: PROGRAMS.independent.shortLabel,
      label: PROGRAMS.independent.label,
      feeCents: 0,
      unlocked: true,
      seasonYear,
      provider: "neopply",
      url: videoAuditionPagePath("independent"),
      embedHref: null,
      payHref: videoAuditionPagePath("independent"),
      neopplyUrl: NEOPPLY_ORG_AUDITION_URL,
      external: false,
      hasConsent: true,
    });
  }

  return actions;
}

function registerVideoAuditionRoutes(app, deps) {
  const {
    db,
    stripe,
    mustBeMember,
    mustBeLoggedIn,
    getCurrentSeasonYear,
    addChrisShare,
    sendEmail,
    MasterEmail,
    opsSystem,
  } = deps;

  function renderVideoAuditionPage(req, res, programRaw) {
    const program = getProgram(programRaw) || PROGRAMS.corps;
    const member = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.userid);
    if (!member) return res.redirect("/");

    if (program.key === "corps" && member.contractedCorps) {
      req.session.flashMessage = "You are already contracted with the Corps.";
      return res.redirect("/member-portal");
    }
    if (program.key === "independent" && member.contractedIndependent) {
      req.session.flashMessage = "You are already contracted with Boise Gems Independent.";
      return res.redirect("/member-portal");
    }

    const seasonYear = getCurrentSeasonYear();
    const materials = getMaterialsForProgram(db, program.key);
    const memberSection = String(member.section || "").toLowerCase().trim();

    return res.render("video-audition", {
      member,
      program,
      seasonYear,
      materials,
      memberSection,
      neopplyUrl: NEOPPLY_ORG_AUDITION_URL,
    });
  }

  app.get("/video-audition", mustBeMember, (req, res) => {
    return renderVideoAuditionPage(req, res, req.query.program);
  });

  // Legacy pay URLs — no fee; show materials + Neopply CTA.
  app.get("/video-audition/pay", mustBeMember, (req, res) => {
    return res.redirect(302, videoAuditionPagePath(req.query.program));
  });

  app.post("/video-audition/pay", mustBeMember, (req, res) => {
    return res.redirect(303, videoAuditionPagePath(req.body.program || req.query.program));
  });

  app.get("/video-audition/success/:potentialId", mustBeLoggedIn, async (req, res) => {
    const potential = db.prepare(`
      SELECT * FROM potential_video_audition WHERE id = ? AND user_id = ?
    `).get(req.params.potentialId, req.user.userid);

    if (!potential) {
      // Already finalized or invalid - send them to unlocked / portal
      return res.redirect("/member-portal");
    }

    if (potential.stripe_session_id && stripe) {
      try {
        const session = await stripe.checkout.sessions.retrieve(potential.stripe_session_id);
        if (session.payment_status && session.payment_status !== "paid") {
          req.session.flashMessage = "Payment not completed yet. Please finish checkout.";
          return res.redirect(`/video-audition/pay?program=${potential.program}`);
        }
      } catch (err) {
        console.error("Video audition session retrieve failed:", err.message);
        // Fall through and finalize like other success-URL flows if retrieve fails
      }
    }

    const program = getProgram(potential.program);
    const seasonYear = Number(potential.season_year);
    const now = Date.now();

    db.prepare(`
      INSERT OR IGNORE INTO video_audition_unlocks
        (user_id, program, season_year, amount, stripe_session_id, unlocked_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      potential.user_id,
      potential.program,
      seasonYear,
      potential.amount,
      potential.stripe_session_id || null,
      now
    );

    try {
      addChrisShare(
        potential.amount,
        `Video audition unlock (${program ? program.shortLabel : potential.program} ${seasonYear})`
      );
    } catch (err) {
      console.error("Video audition chris share failed:", err);
    }

    const paidString = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(potential.amount / 100);

    db.prepare(`
      INSERT INTO paymentHistory (title, description, amount, method, date, user_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      `${program ? program.shortLabel : "Video"} audition unlock ${seasonYear}`,
      `Video audition application fee (${paidString}) for ${seasonYear}. Processing fee ${new Intl.NumberFormat(
        "en-US",
        { style: "currency", currency: "USD" }
      ).format((potential.processing_fee || 0) / 100)}.`,
      potential.amount,
      "Stripe",
      now,
      potential.user_id
    );

    db.prepare("DELETE FROM potential_video_audition WHERE id = ?").run(potential.id);

    const member = db.prepare("SELECT * FROM users WHERE id = ?").get(potential.user_id);
    if (member && member.email && sendEmail) {
      const link = NEOPPLY_ORG_AUDITION_URL;
      const html = `
        <p>Hi ${member.firstname},</p>
        <p>Your ${program ? program.label : "video audition"} for the <strong>${seasonYear}</strong> season is ready.</p>
        <p><a href="${link}">Open your video audition on Neopply</a></p>
        <p>- Boise Gems Staff</p>
      `;
      try {
        sendEmail(member.email, `Video audition unlocked - ${seasonYear}`, html);
        if (MasterEmail) {
          sendEmail(
            MasterEmail,
            `Video audition paid - ${member.firstname} ${member.lastname}`,
            `<p>${member.firstname} ${member.lastname} (${member.email}) unlocked ${
              program ? program.shortLabel : potential.program
            } for ${seasonYear} (${paidString}).</p>`
          );
        }
      } catch (err) {
        console.error("Video audition email failed:", err);
      }
    }

    return res.redirect(302, videoAuditionPagePath(potential.program));
  });

  app.get("/video-audition/corps", mustBeMember, (req, res) => {
    return renderVideoAuditionPage(req, res, "corps");
  });

  app.post("/video-audition/corps/consent", mustBeMember, (req, res) => {
    return res.redirect(302, videoAuditionPagePath("corps"));
  });

  app.get("/api/partner/neopply/embed-url", mustBeMember, (req, res) => {
    const program = normalizeProgram(req.query.program) || "corps";
    if (program !== "corps") {
      return res.status(400).json({ ok: false, message: "Unsupported program" });
    }

    const member = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.userid);
    if (!member) return res.status(404).json({ ok: false, message: "User not found" });

    const seasonYear = getCurrentSeasonYear();
    if (!hasUnlock(db, member.id, "corps", seasonYear)) {
      return res.status(403).json({ ok: false, message: "Video audition not unlocked" });
    }
    if (!hasNeopplyConsent(db, member.id, "corps")) {
      return res.status(403).json({ ok: false, message: "Neopply consent required" });
    }

    const accessToken = req.cookies.bgcookie || "";
    if (!accessToken) {
      return res.status(401).json({ ok: false, message: "Not signed in" });
    }

    const embedUrl = neopplyPartner.buildNeopplyCorpsEmbedUrl(member, accessToken, member.section);
    if (!embedUrl) {
      return res.status(503).json({ ok: false, message: "Neopply partner not configured" });
    }

    return res.json({ ok: true, embedUrl });
  });

  app.get("/video-audition/unlocked", mustBeMember, (req, res) => {
    return res.redirect(302, videoAuditionPagePath(req.query.program));
  });
}

module.exports = {
  NEOPPLY_ORG_AUDITION_URL,
  PROGRAMS,
  OMNIPPLY_URLS,
  initVideoAudition,
  registerVideoAuditionRoutes,
  getProgram,
  getOmnipplyUrl,
  getMaterialsForProgram,
  videoAuditionPagePath,
  hasUnlock,
  getUnlocksForUser,
  getPortalAuditionActions,
  hasNeopplyConsent,
  recordNeopplyConsent,
  isVideoAuditionFeeBypassed,
};
