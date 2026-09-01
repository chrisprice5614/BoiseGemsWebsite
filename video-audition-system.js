/**
 * Video audition unlocks - pay once per program per season to open audition links.
 * Corps: $30 (Neopply embed) | BGI (independent): $40 (Omnipply)
 */
const neopplyPartner = require("./neopply-partner");
const PROGRAMS = {
  corps: {
    key: "corps",
    label: "Boise Gems Drum & Bugle Corps",
    shortLabel: "Corps",
    feeCents: 3000,
  },
  independent: {
    key: "independent",
    label: "Boise Gems Independent",
    shortLabel: "BGI",
    feeCents: 4000,
  },
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
  const unlocks = getUnlocksForUser(db, member.id, seasonYear);
  const section = member.section;
  const actions = [];

  if (!member.contractedCorps) {
    const unlocked = !!unlocks.corps;
    actions.push({
      program: "corps",
      shortLabel: PROGRAMS.corps.shortLabel,
      label: PROGRAMS.corps.label,
      feeCents: PROGRAMS.corps.feeCents,
      unlocked,
      seasonYear,
      provider: "neopply",
      url: unlocked ? "/video-audition/corps" : null,
      embedHref: unlocked ? "/video-audition/corps" : null,
      payHref: `/video-audition/pay?program=corps`,
      hasConsent: hasNeopplyConsent(db, member.id, "corps"),
    });
  }

  if (!member.contractedIndependent) {
    const unlocked = !!unlocks.independent;
    actions.push({
      program: "independent",
      shortLabel: PROGRAMS.independent.shortLabel,
      label: PROGRAMS.independent.label,
      feeCents: PROGRAMS.independent.feeCents,
      unlocked,
      seasonYear,
      provider: "omnipply",
      url: unlocked ? getOmnipplyUrl("independent", section) : null,
      embedHref: null,
      payHref: `/video-audition/pay?program=independent`,
      hasConsent: false,
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

  app.get("/video-audition/pay", mustBeMember, (req, res) => {
    const program = getProgram(req.query.program);
    if (!program) {
      req.session.flashMessage = "Choose Corps or BGI video audition.";
      return res.redirect("/member-portal");
    }

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
    if (hasUnlock(db, member.id, program.key, seasonYear)) {
      if (program.key === "corps") return res.redirect("/video-audition/corps");
      return res.redirect(`/video-audition/unlocked?program=${program.key}`);
    }

    const feeCents = program.feeCents;
    const processingFee = Math.round(feeCents * 0.06);
    const totalCharge = feeCents + processingFee;

    return res.render("video-audition-pay", {
      member,
      program,
      seasonYear,
      feeCents,
      processingFee,
      totalCharge,
    });
  });

  app.post("/video-audition/pay", mustBeMember, async (req, res) => {
    const program = getProgram(req.body.program || req.query.program);
    if (!program) {
      req.session.flashMessage = "Choose Corps or BGI video audition.";
      return res.redirect("/member-portal");
    }

    const member = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.userid);
    if (!member) return res.redirect("/");

    if (program.key === "corps" && member.contractedCorps) {
      return res.redirect("/member-portal");
    }
    if (program.key === "independent" && member.contractedIndependent) {
      return res.redirect("/member-portal");
    }

    const seasonYear = getCurrentSeasonYear();
    if (hasUnlock(db, member.id, program.key, seasonYear)) {
      if (program.key === "corps") return res.redirect("/video-audition/corps");
      return res.redirect(`/video-audition/unlocked?program=${program.key}`);
    }

    const feeCents = program.feeCents;
    const processingFee = Math.round(feeCents * 0.06);
    const totalCharge = feeCents + processingFee;

    const insert = db.prepare(`
      INSERT INTO potential_video_audition
        (user_id, program, season_year, amount, processing_fee, total_charge, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const result = insert.run(
      member.id,
      program.key,
      seasonYear,
      feeCents,
      processingFee,
      totalCharge,
      Date.now()
    );
    const potentialId = result.lastInsertRowid;

    try {
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: `${program.shortLabel} video audition (${seasonYear})`,
                description: `Unlocks the ${program.label} video audition for the ${seasonYear} season.`,
              },
              unit_amount: totalCharge,
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        customer_email: member.email || undefined,
        success_url: `${process.env.BASEURL}/video-audition/success/${potentialId}`,
        cancel_url: `${process.env.BASEURL}/video-audition/pay?program=${program.key}`,
        metadata: {
          type: "video_audition",
          program: program.key,
          season_year: String(seasonYear),
          user_id: String(member.id),
          potential_id: String(potentialId),
        },
      });

      db.prepare(
        "UPDATE potential_video_audition SET stripe_session_id = ? WHERE id = ?"
      ).run(session.id, potentialId);

      return res.redirect(303, session.url);
    } catch (err) {
      console.error("Video audition Stripe session error:", err);
      if (opsSystem) {
        opsSystem.logFailedPayment(db, {
          message: "Failed to create Stripe checkout for video audition",
          detail: err,
          req,
          statusCode: 502,
        });
        opsSystem.markLogged(res, err);
      }
      db.prepare("DELETE FROM potential_video_audition WHERE id = ?").run(potentialId);
      req.session.flashMessage = "Could not start checkout. Please try again.";
      return res.redirect(`/video-audition/pay?program=${program.key}`);
    }
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
      const link =
        potential.program === "corps"
          ? `${process.env.BASEURL}/video-audition/corps`
          : getOmnipplyUrl(potential.program, member.section);
      const html = `
        <p>Hi ${member.firstname},</p>
        <p>Your ${program ? program.label : "video audition"} application fee for the <strong>${seasonYear}</strong> season is paid.</p>
        ${
          link
            ? `<p><a href="${link}">Open your video audition</a></p>`
            : `<p>Your portal now shows the unlocked Video Audition button for this program.</p>`
        }
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

    return res.redirect(
      potential.program === "corps"
        ? "/video-audition/corps"
        : `/video-audition/unlocked?program=${potential.program}`
    );
  });

  app.get("/video-audition/corps", mustBeMember, (req, res) => {
    const member = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.userid);
    if (!member) return res.redirect("/");
    if (member.contractedCorps) {
      req.session.flashMessage = "You are already contracted with the Corps.";
      return res.redirect("/member-portal");
    }

    const seasonYear = getCurrentSeasonYear();
    const unlocked = hasUnlock(db, member.id, "corps", seasonYear);
    if (!unlocked) {
      return res.redirect("/video-audition/pay?program=corps");
    }

    const hasConsent = hasNeopplyConsent(db, member.id, "corps");
    const accessToken = req.cookies.bgcookie || "";
    let embedUrl = null;
    if (hasConsent && accessToken) {
      embedUrl = neopplyPartner.buildNeopplyCorpsEmbedUrl(member, accessToken, member.section);
    }

    return res.render("video-audition-corps", {
      member,
      seasonYear,
      unlocked,
      hasConsent,
      embedUrl,
      neopplyPrivacyUrl: process.env.NEOPPLY_PRIVACY_URL || "https://neopply.com/privacy",
    });
  });

  app.post("/video-audition/corps/consent", mustBeMember, (req, res) => {
    const member = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.userid);
    if (!member) return res.redirect("/");

    const seasonYear = getCurrentSeasonYear();
    if (!hasUnlock(db, member.id, "corps", seasonYear)) {
      return res.redirect("/video-audition/pay?program=corps");
    }

    const agreed = String(req.body.agree || "").trim().toLowerCase();
    if (agreed !== "yes" && agreed !== "on" && agreed !== "1" && agreed !== "true") {
      req.session.flashMessage = "You must agree before your information can be shared with Neopply.";
      return res.redirect("/video-audition/corps");
    }

    recordNeopplyConsent(db, member.id, "corps");
    return res.redirect("/video-audition/corps");
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
    const program = getProgram(req.query.program) || PROGRAMS.corps;
    if (program.key === "corps") {
      return res.redirect("/video-audition/corps");
    }

    const member = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.userid);
    if (!member) return res.redirect("/");

    const seasonYear = getCurrentSeasonYear();
    const unlocked = hasUnlock(db, member.id, program.key, seasonYear);
    const url = unlocked ? getOmnipplyUrl(program.key, member.section) : null;

    return res.render("video-audition-unlocked", {
      member,
      program,
      seasonYear,
      unlocked,
      url,
    });
  });
}

module.exports = {
  PROGRAMS,
  OMNIPPLY_URLS,
  initVideoAudition,
  registerVideoAuditionRoutes,
  getProgram,
  getOmnipplyUrl,
  hasUnlock,
  getUnlocksForUser,
  getPortalAuditionActions,
  hasNeopplyConsent,
  recordNeopplyConsent,
  isVideoAuditionFeeBypassed,
};
