require("dotenv").config() // Makes it so we can access .env file
const jwt = require("jsonwebtoken")//npm install jsonwebtoken dotenv
const bcrypt = require("bcrypt") //npm install bcrypt
const cookieParser = require("cookie-parser")//npm install cookie-parser
const express = require("express")//npm install express
const db = require("better-sqlite3")("data.db") //npm install better-sqlite3
const body_parser = require("body-parser")
const path = require('path');
const node_fetch = require("node-fetch")
const FormData = require("form-data");
const multer = require("multer")
const sharp = require('sharp');
const fs = require("fs");
const axios = require("axios");
const marked = require('marked');
const session = require('express-session');
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

// When true, we will attempt to automatically send Chris's 3% share
// to his connected Stripe account using Stripe Connect. When false,
// we only record the share in the local database (no automatic payout).
const ENABLE_STRIPE_SPLIT = process.env.ENABLE_STRIPE_SPLIT === "true";

// Chris's connected account ID under the Boise Gems Stripe platform.
// Example: acct_1234...  This must be configured on the Boise Gems
// Stripe account as a connected account.
const CHRIS_CONNECTED_ACCOUNT_ID = process.env.CHRIS_CONNECTED_ACCOUNT_ID || null;

// Helper to send Chris's 3% via Stripe Connect from the Boise Gems platform.
// This uses a simple transfer from the platform balance to Chris's
// connected account. It is intentionally "fire and forget" so that
// a failure to create the transfer does not block the main request.
function sendChrisStripeTransfer(chrisCutCents, source) {
  if (!ENABLE_STRIPE_SPLIT) return;
  if (!CHRIS_CONNECTED_ACCOUNT_ID) return;

  const amount = Math.round(Number(chrisCutCents || 0));
  if (!amount || amount <= 0) return;

  stripe.transfers
    .create({
      amount: amount,
      currency: "usd",
      destination: CHRIS_CONNECTED_ACCOUNT_ID,
      description: `3% share from ${source || "transaction"}`,
    })
    .then(() => {
      // Transfer created successfully â€“ nothing else to do here.
    })
    .catch((err) => {
      console.error("Failed to create Chris 3% transfer:", err);
    });
}
const { verify } = require("crypto")


const CONTRACT_EXTENSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function ensureActiveContractExtension(req, res, next) {
  const id = Number(req.params.id);
  if (!id) return res.redirect("/");

  const ext = db
    .prepare("SELECT * FROM contractExtension WHERE id = ?")
    .get(id);

  // No extension row
  if (!ext) return res.redirect("/");

  // Wrong user — allow both the designated signer (user_id) and the member
  // themselves (child_id) to access the contract page.
  if (
    !req.user ||
    (ext.user_id !== req.user.userid && ext.child_id !== req.user.userid)
  ) {
    return res.redirect("/");
  }

  const createdAt = ext.created_at || 0;
  const ageMs = Date.now() - createdAt;

  if (!createdAt || ageMs > CONTRACT_EXTENSION_TTL_MS) {
    // Extension expired â†’ delete it and tell the user
    db.prepare("DELETE FROM contractExtension WHERE id = ?").run(id);
    req.session.flashMessage = "This contract extension has expired. Please contact staff to request a new contract.";
    return res.redirect("/member-portal");
  }

  // Attach to request so handlers don't have to re-query
  req.contractExtension = ext;
  next();
}

// Very lightweight "does this PDF have form fields?" check.
// Not perfect, but good enough for typical AcroForm PDFs.
function pdfHasFormFields(fsPath) {
  try {
    const buf = fs.readFileSync(fsPath);
    // Use latin1 so we don't mangle bytes
    const text = buf.toString("latin1");
    // Heuristic: most AcroForm PDFs have these markers
    if (text.includes("/AcroForm") || text.includes("/NeedAppearances")) {
      return true;
    }
    // some forms don't include /AcroForm but have /T (field name) entries
    const fieldHits = (text.match(/\/T\s*\(/g) || []).length;
    return fieldHits > 0;
  } catch (err) {
    console.error("pdfHasFormFields error:", err);
    return false;
  }
}



const MasterEmail = "theboisegems@gmail.com"
const online = true;

function generateCustomFilename() {
  const now = new Date();
  const pad = (n) => n.toString().padStart(2, "0");

  const yymmdd = `${pad(now.getFullYear() % 100)}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const hhmmss = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const random = Math.random().toString(36).substring(2, 6 + 2); // 4 random alphanum

  return `${yymmdd}-${hhmmss}-${random}`;
}

const FILE_SECTION_CORPS = ["Brass", "Drumline", "Front Ensemble", "Guard"];
const FILE_SECTION_INDOOR = ["Drumline", "Front Ensemble"];

const filesUpload = multer({
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      const dest = path.join(__dirname, "public", "uploads", "files");
      fs.mkdirSync(dest, { recursive: true });
      cb(null, dest);
    },
    filename: function (req, file, cb) {
      const base = generateCustomFilename();
      const ext = path.extname(file.originalname || "").toLowerCase();
      cb(null, base + ext);
    }
  })
});

const supportUpload = multer({
  storage: multer.memoryStorage()
});


const pdfUpload = multer({
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      const dest = path.join(__dirname, "./public/pdf/publicpdf");
      fs.mkdirSync(dest, { recursive: true }); // ensure folder exists
      cb(null, dest);
    },
    filename: function (req, file, cb) {
      const customName = generateCustomFilename();
      cb(null, `${customName}.pdf`);
    }
  }),
  fileFilter(req, file, cb) {
    if (file.mimetype !== "application/pdf") {
      return cb(new Error("Only PDF files are allowed"));
    }
    cb(null, true);
  }
});

const pdfUploadSecure = multer({
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      const dest = path.join(__dirname, "./private/pdf");
      fs.mkdirSync(dest, { recursive: true }); // ensure folder exists
      cb(null, dest);
    },
    filename: function (req, file, cb) {
      const customName = generateCustomFilename(); // assume you defined this earlier
      cb(null, `${customName}.pdf`);
    }
  }),
  fileFilter(req, file, cb) {
    if (file.mimetype !== "application/pdf") {
      return cb(new Error("Only PDF files are allowed"));
    }
    cb(null, true);
  }
});

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // optional: 5MB limit
  fileFilter(req, file, cb) {
    if (!file.mimetype.startsWith('image/')) {
      cb(new Error('Only images are allowed'), false);
    } else {
      cb(null, true);
    }
  }
});



const processImage = async (req, res, next) => {
  if (!req.file) return res.status(400).send("Image is required");

  const customName = generateCustomFilename() + ".webp";
  const outputPath = path.join(__dirname, "./public/img/publicupload", customName);

  try {
    await sharp(req.file.buffer)
      .resize(640, 640, {
        fit: "cover",   // always crop to exact 640x640
        position: "center" // crop from center
      })
      .webp({ quality: 80 }) // save as webp, good balance of quality/speed
      .toFile(outputPath);

    req.savedFilename = customName;
    next();
  } catch (err) {
    console.error("Image processing failed:", err);
    next(err);
  }
};

const processImageJpg = async (req, res, next) => {
  if (!req.file) return res.status(400).send('Image is required');

  const customName = generateCustomFilename() + '.jpg';
  const outputPath = path.join(__dirname, './public/img/publicupload', customName);

  try {
    await sharp(req.file.buffer)
      .resize({ width: 1280, height: 1280, fit: 'inside' })
      .jpeg({ quality: 70 })
      .toFile(outputPath);

    req.savedFilename = customName;
    next();
  } catch (err) {
    next(err);
  }
};

const processImageJpgOptional = async (req, res, next) => {
  if (!req.file) {          // no new image uploaded
    req.savedFilename = null;
    return next();
  }
  // same processing as above
  try {
    const customName = generateCustomFilename() + '.jpg';
    const outDir = path.join(__dirname, 'public', 'img', 'publicupload');
    fs.mkdirSync(outDir, { recursive: true });
    const outputPath = path.join(outDir, customName);

    await sharp(req.file.buffer)
      .resize({ width: 1280, height: 1280, fit: 'inside' })
      .jpeg({ quality: 70 })
      .toFile(outputPath);

    req.savedFilename = customName;
    next();
  } catch (err) {
    next(err);
  }
};


//mailing function
async function sendEmail(to, subject, html, attachments = []) {
  if (!online) return;

  const mailgunApiKey = process.env.MAILGUN_API_KEY;
  const mailgunDomain = process.env.MAILGUN_DOMAIN;
  const mailgunApiBase = process.env.MAILGUN_API_BASE || "https://api.mailgun.net/v3";
  const fromAddress = process.env.MAILGUN_FROM || '"The Boise Gems" <theboisegems@' + mailgunDomain + ">";

  if (!mailgunApiKey || !mailgunDomain) {
    console.error("Mailgun env missing: MAILGUN_API_KEY or MAILGUN_DOMAIN");
    return;
  }

  const form = new FormData();
  form.append("from", fromAddress);
  form.append("to", to);
  form.append("subject", subject);
  form.append(
    "html",
    `
        <!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Boise Gems Drum & Bugle Corps</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #f4f4f4;
    }

    table {
      border-collapse: collapse;
    }

    @media only screen and (max-width: 600px) {
      .content {
        width: 100% !important;
      }
      .logo {
        width: 80px !important;
      }
    }
  </style>
</head>
<body>
  <!-- Main wrapper with padding on cell -->
  <table width="100%" bgcolor="#f4f4f4" cellpadding="0" cellspacing="0" role="presentation">
    <tr>
      <td align="center" style="padding: 24px;">
        <!-- Centered content table -->
        <table class="content" width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; padding: 32px; font-family: Arial, sans-serif; color: #333333; border-radius: 6px; max-width: 600px; width: 100%;">
          <!-- Logo -->
          <tr>
            <td align="center" style="padding-bottom: 24px;">
              <a href="https://www.boisegems.org/" target="_blank">
                <img src="https://raw.githubusercontent.com/chrisprice5614/chrisprice.io/refs/heads/main/gem.png" alt="Boise Gems Logo" width="100" class="logo" style="display: block; margin: 0 auto;">
              </a>
            </td>
          </tr>
          <!-- Title -->
          <tr>
            <td align="center" style="font-size: 24px; font-weight: bold; color: #60437D; padding-bottom: 12px;">
              Boise Gems Drum & Bugle Corps
            </td>
          </tr>
          <tr>
          </tr>
          <!-- Body -->
          <tr>
            <td style="font-size: 16px; line-height: 1.6; color: #333;">
              <p>${html}</p>

            
              </p>
              <p style="margin-top: 32px;">
                <strong>The Boise Gems</strong>
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td align="center" style="font-size: 12px; color: #999999; padding-top: 32px;">
              © 2026 Boise Gems Drum & Bugle Corps
              <a href="https://www.boisegems.org/" style="color: #999999; text-decoration: underline;">www.boisegems.org</a>
            </td>
          </tr>
          <tr>
            <td align="center" style="font-size: 16px; line-height: 1.6; color: #333333; padding-top: 24px;">
              Please do not respond to this email. Thank you.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
        `
  );

  if (attachments && attachments.length) {
    attachments.forEach((attachment) => {
      if (!attachment) return;
      form.append("attachment", attachment.content, {
        filename: attachment.filename || "attachment",
        contentType: attachment.contentType || "application/octet-stream",
      });
    });
  }

  try {
    await axios.post(`${mailgunApiBase}/${mailgunDomain}/messages`, form, {
      auth: {
        username: "api",
        password: mailgunApiKey,
      },
      headers: form.getHeaders(),
    });
  } catch (err) {
    console.error("Mailgun send error:", err?.response?.data || err);
  }
}

function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-') // Replace non-alphanumerics with -
    .replace(/^-+|-+$/g, '');    // Trim hyphens from start/end
}

function buildUserNameSearchClause(search) {
  const trimmed = String(search || "").trim();
  if (!trimmed) return null;

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const fullLike = `%${trimmed}%`;
  const clauses = [
    "firstname LIKE ?",
    "lastname LIKE ?",
    "(firstname || ' ' || lastname) LIKE ?",
    "(lastname || ' ' || firstname) LIKE ?",
  ];
  const params = [fullLike, fullLike, fullLike, fullLike];

  if (tokens.length > 1) {
    const tokenClauses = tokens.map(
      () => "(firstname LIKE ? OR lastname LIKE ?)"
    );
    clauses.push(`(${tokenClauses.join(" AND ")})`);
    tokens.forEach((token) => {
      const like = `%${token}%`;
      params.push(like, like);
    });
  }

  return {
    clause: `(${clauses.join(" OR ")})`,
    params,
  };
}



db.pragma("journal_mode = WAL") //Makes it faster
const createTables = db.transaction(() => {
    db.prepare(
        `
        CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title STRING,
        description STRING,
        datetime STRING,
        endtime STRING,
        location STRING,
        image STRING,
        link STRING,
        cost INTEGER,
        slug STRING,
        type STRING
        )
        `
    ).run()

     db.prepare(
      `
      CREATE TABLE IF NOT EXISTS instruments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        instrument_type TEXT,
        model TEXT,
        serial TEXT,
        checked_out_date INTEGER,
        checked_in_date INTEGER,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
      `
    ).run();

    db.prepare(`
      CREATE TABLE IF NOT EXISTS potential_payment (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        child_id INTEGER,
        parent_id INTEGER,
        amount INTEGER NOT NULL,
        user_id INTEGER,
        contract_id INTEGER,
        processing_fee INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      `).run()

    db.prepare(
        `
        CREATE TABLE IF NOT EXISTS tuitionFees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ensemble STRING,
        amount INTEGER
        )
        `
    ).run()

    const affiliateFees = db.prepare("SELECT id FROM tuitionFees WHERE ensemble = ?").get("affiliate");
    if (!affiliateFees) {
      db.prepare("INSERT INTO tuitionFees (ensemble, amount) VALUES (?, ?)").run("affiliate", 55000);
    }

    db.prepare(
        `
        CREATE TABLE IF NOT EXISTS allergies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        no_allergies INTEGER,
        allergies STRING
        )
        `
    ).run()

    db.prepare(
        `
        CREATE TABLE IF NOT EXISTS userVerify (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code STRING,
        user_id INTEGER,
        FOREIGN KEY (user_id) REFERENCES users(id)
        )
        `
    ).run()

    db.prepare(
        `
        CREATE TABLE IF NOT EXISTS materials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        section STRING,
        pdf STRING
        )
        `
    ).run()

    db.prepare(
        `
        CREATE TABLE IF NOT EXISTS emergencyContacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name STRING,
        phone STRING,
        email STRING,
        user_id INTEGER,
        FOREIGN KEY (user_id) REFERENCES users(id)
        )
        `
    ).run()

    db.prepare(
        `
        CREATE TABLE IF NOT EXISTS forgotPassword (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code STRING,
        user_id INTEGER,
        FOREIGN KEY (user_id) REFERENCES users(id)
        )
        `
    ).run()

    db.prepare(
        `
        CREATE TABLE IF NOT EXISTS childVerify (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code STRING,
        user_id INTEGER,
        target_id INTEGER,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (target_id) REFERENCES users(id)
        )
        `
    ).run()

    db.prepare(
        `
        CREATE TABLE IF NOT EXISTS forms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title STRING,
        description STRING,
        document_path STRING,
        upload BOOL,
        content STRING,
        expire_date INTEGER,
        season STRING,
        due_date INTEGER
        )
        `
    ).run()


    db.prepare(`
      CREATE TABLE IF NOT EXISTS potential_donation (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        name TEXT NOT NULL,
        message TEXT,
        amount INTEGER NOT NULL,          -- cents, the donation amount (tuition-equivalent)
        processing_fee INTEGER NOT NULL,  -- cents
        total_charge INTEGER NOT NULL,    -- cents (amount + processing_fee)
        stripe_session_id TEXT,           -- optional: store Stripe session id
        created_at INTEGER NOT NULL
      );
      `).run()

    db.prepare(`
      CREATE TABLE IF NOT EXISTS donations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      message TEXT,
      amount INTEGER NOT NULL,          -- cents (amount donated to org)
      processing_fee INTEGER NOT NULL,  -- cents
      total_charged INTEGER NOT NULL,   -- cents
      stripe_session_id TEXT,
      created_at INTEGER NOT NULL
    );
    `).run()

    db.prepare(
        `
        CREATE TABLE IF NOT EXISTS formUploads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        signer_name STRING,
        signer_email STRING,
        upload_path STRING,
        document_id INTEGER,
        signed_date INTEGER,
        ip_address STRING,
        user_agent STRING,
        signature STRING,
        consent BOOL,
        user_id INTEGER,
        FOREIGN KEY (document_id) REFERENCES forms(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
        )
        `
    ).run()

    db.prepare(
        `
        CREATE TABLE IF NOT EXISTS paymentHistory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title STRING,
        description STRING,
        amount INTEGER,
        method INTEGER,
        date INTEGER,
        user_id INTEGER,
        FOREIGN KEY (user_id) REFERENCES users(id)
        )
        `
    ).run()

    db.prepare(
        `
        CREATE TABLE IF NOT EXISTS contractedMembers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        season INTEGER,
        ensemble STRING,
        contracted_date INTEGER,
        user_id INTEGER,
        FOREIGN KEY (user_id) REFERENCES users(id)
        )
        `
    ).run()

    const cmCols = db.prepare("PRAGMA table_info(contractedMembers)").all().map(c => c.name);
    if (!cmCols.includes("signedContractPath")) {
      db.prepare("ALTER TABLE contractedMembers ADD COLUMN signedContractPath TEXT").run();
    }
    if (!cmCols.includes("paymentMethod")) {
      db.prepare("ALTER TABLE contractedMembers ADD COLUMN paymentMethod TEXT").run();
    }

    db.prepare(
        `
        CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        firstname STRING,
        lastname STRING,
        birthday INTEGER,
        phone STRING,
        email STRING,
        address STRING,
        admin BOOL,
        section STRING,
        instrument STRING,
        paid INTEGER DEFAULT 0,
        owed INTEGER DEFAULT 0,
        staff STRING,
        password STRING,
        emailsecret STRING,
        verified BOOL,
        parentId INTEGER,
        parent BOOL,
        img STRING,
        contractedCorps INTEGER,
        contractedIndependent INTEGER,
        contractedAffiliate INTEGER
        )
        `
    ).run()

    const userCols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
    if (!userCols.includes("contractedAffiliate")) {
      db.prepare("ALTER TABLE users ADD COLUMN contractedAffiliate INTEGER").run();
    }
    if (!userCols.includes("shirtSize")) {
      db.prepare("ALTER TABLE users ADD COLUMN shirtSize TEXT").run();
    }
    if (!userCols.includes("created_at")) {
      db.prepare("ALTER TABLE users ADD COLUMN created_at INTEGER DEFAULT 0").run();
    }

    db.prepare(
      `
      CREATE TABLE IF NOT EXISTS permissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        full BOOL,
        upgrade BOOL,
        forms BOOL,
        posts BOOL,
        schedule BOOL,
        events BOOL,
        merch BOOL,
        contract BOOL,
        email BOOL,
        
        FOREIGN KEY (user_id) REFERENCES users(id)
        )
      `
    ).run()

    db.prepare(
      `
      CREATE TABLE IF NOT EXISTS contractExtension (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        due_date INTEGER,
        bypass_fee BOOL DEFAULT 0,
        season INTEGER,
        extender INTEGER,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (extender) REFERENCES users(id)
        )
      `
    ).run()


    db.prepare(
      `
      CREATE TABLE IF NOT EXISTS pendingContractExtension (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        member_id INTEGER NOT NULL,
        group_type TEXT NOT NULL,
        bypass_fee BOOL DEFAULT 0,
        season INTEGER,
        requested_by INTEGER,
        created_at INTEGER,
        FOREIGN KEY (member_id) REFERENCES users(id),
        FOREIGN KEY (requested_by) REFERENCES users(id)
      )
      `
    ).run()
    db.prepare(
      `
      CREATE TABLE IF NOT EXISTS active (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pagename STRING,
        active BOOL
        )
      `
    ).run()

    db.prepare(
      `
      CREATE TABLE IF NOT EXISTS forms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name STRING,
        description STRING,
        content STRING,
        path STRING,
        required BOOL,
        expires STRING
        )
      `
    ).run()

    db.prepare(
      `
      CREATE TABLE IF NOT EXISTS seasons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name STRING,
        year INTEGER,
        content STRING,
        hero STRING
        )
      `
    ).run()


    db.prepare(
      `
      CREATE TABLE IF NOT EXISTS rsvp (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        event_id INTEGER,
        paid BOOL,

        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (event_id) REFERENCES events(id)
        )
      `
    ).run()

     db.prepare(
      `
      CREATE TABLE IF NOT EXISTS music (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ensemble STRING,
        type STRING,  -- Warmup, Repertoire, etc
        version INTEGER, -- Use datetime object
        section STRING, --Brass, Front Ensemble, Drumline, etc
        part STRING
        )
      `
    ).run()

    db.prepare(
      `
      CREATE TABLE IF NOT EXISTS viewed (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        music_id INTEGER,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (music_id) REFERENCES music(id)
        )
      `
    ).run()

    db.prepare(`
      CREATE TABLE IF NOT EXISTS potential_event_rsvp (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        event_id INTEGER NOT NULL,
        amount INTEGER NOT NULL,          -- cents (event.cost in cents)
        processing_fee INTEGER NOT NULL,  -- cents (5% fee)
        total_charge INTEGER NOT NULL,    -- cents (amount + fee)
        stripe_session_id TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (event_id) REFERENCES events(id)
      );
    `).run();

    db.prepare(`
      CREATE TABLE IF NOT EXISTS news (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        slug  TEXT NOT NULL UNIQUE,
        html  TEXT NOT NULL,
        hero  TEXT,                 -- stored filename from /public/img/publicupload
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `).run();

    db.prepare(`CREATE INDEX IF NOT EXISTS idx_news_created ON news(created_at DESC)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_news_slug ON news(slug)`).run();

    db.prepare(`
      CREATE TABLE IF NOT EXISTS staff (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        first TEXT NOT NULL,
        last  TEXT NOT NULL,
        position TEXT NOT NULL,
        category TEXT NOT NULL,          -- e.g., Design, Brass, Color-Guard, Percussion, Admin, Director
        bio TEXT,                        -- short bio
        image TEXT,                      -- filename in /public/img/publicupload ; NULL = use default
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        slug TEXT
      )
    `).run();

    db.prepare(`CREATE INDEX IF NOT EXISTS idx_staff_category_order ON staff(category, sort_order ASC, last COLLATE NOCASE ASC)`).run();

     db.prepare(`
      CREATE TABLE IF NOT EXISTS file_folders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parent_id INTEGER REFERENCES file_folders(id) ON DELETE CASCADE,
        scope TEXT NOT NULL,                -- 'corps' or 'indoor'
        year INTEGER NOT NULL,
        section TEXT,                       -- e.g., 'Brass', 'Drumline', 'Front Ensemble', 'Guard'
        name TEXT NOT NULL,                 -- '2026', 'Brass', 'Part 1', etc.
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `).run();

    db.prepare(`
      CREATE TABLE IF NOT EXISTS file_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        folder_id INTEGER NOT NULL REFERENCES file_folders(id) ON DELETE CASCADE,
        uploader_id INTEGER REFERENCES users(id),
        title TEXT NOT NULL,                -- display name chosen by staff
        original_name TEXT NOT NULL,        -- original filename
        stored_path TEXT NOT NULL,          -- e.g. '/uploads/files/2025-11-14-xxxx.pdf'
        mime_type TEXT,
        size INTEGER,
        allow_corps INTEGER NOT NULL DEFAULT 0,
        allow_independent INTEGER NOT NULL DEFAULT 0,
        allow_affiliate INTEGER NOT NULL DEFAULT 0,
        allow_noncontracted INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      )
    `).run();

    const fileItemCols = db.prepare("PRAGMA table_info(file_items)").all().map(c => c.name);
    if (!fileItemCols.includes("allow_affiliate")) {
      db.prepare("ALTER TABLE file_items ADD COLUMN allow_affiliate INTEGER NOT NULL DEFAULT 0").run();
    }

    db.prepare(`
      CREATE TABLE IF NOT EXISTS folder_views (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        folder_id INTEGER NOT NULL REFERENCES file_folders(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        viewed_at INTEGER NOT NULL,
        UNIQUE(folder_id, user_id)
      )
    `).run();

    db.prepare(`
      CREATE TABLE IF NOT EXISTS support_tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        role TEXT,
        subject TEXT NOT NULL,
        message TEXT NOT NULL,
        page_url TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        created_at INTEGER NOT NULL
      )
    `).run();

    db.prepare(`
      CREATE TABLE IF NOT EXISTS chrisPayment (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        label TEXT NOT NULL UNIQUE,
        total_owed INTEGER NOT NULL DEFAULT 0
      )
    `).run();

    db.prepare(`
      CREATE TABLE IF NOT EXISTS chrisPaymentHistory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at INTEGER NOT NULL,
        amount INTEGER NOT NULL,
        type TEXT NOT NULL,    -- 'credit' or 'payment'
        note TEXT,
        source TEXT
      )
    `).run();

    // Ensure the singleton row exists
    const existingChris = db.prepare("SELECT id FROM chrisPayment WHERE id = 1").get();
    if (!existingChris) {
      db.prepare("INSERT INTO chrisPayment (id, label, total_owed) VALUES (1, 'ChrisPayment', 0)").run();
    }

      const rsvpCols = db.prepare("PRAGMA table_info(rsvp)").all().map(c => c.name);
if (!rsvpCols.includes("checked_in")) {
  db.prepare(`ALTER TABLE rsvp ADD COLUMN checked_in INTEGER DEFAULT 0`).run();
}

const userColsPost = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);

if (!userColsPost.includes("indoorInstrument")) {
  db.prepare(`ALTER TABLE users ADD COLUMN indoorInstrument TEXT`).run();
}
if (!userColsPost.includes("indoorSection")) {
  db.prepare(`ALTER TABLE users ADD COLUMN indoorSection TEXT`).run();
}

const ppCols = db.prepare("PRAGMA table_info(potential_payment)").all().map(c => c.name);
    if (!ppCols.includes("contract_file_path")) {
      db.prepare("ALTER TABLE potential_payment ADD COLUMN contract_file_path TEXT").run();
    }


      const contractExtCols = db
    .prepare("PRAGMA table_info(contractExtension)")
    .all()
    .map((c) => c.name);

  if (!contractExtCols.includes("created_at")) {
    db.prepare(
      "ALTER TABLE contractExtension ADD COLUMN created_at INTEGER"
    ).run();
  }

  // NEW: child_id for â€œcontract for child, signed by parentâ€
  if (!contractExtCols.includes("child_id")) {
    db.prepare(
      "ALTER TABLE contractExtension ADD COLUMN child_id INTEGER"
    ).run();
  }

  // donor_list: comma-separated names editable by admins, shown on /donate
  db.prepare(`
    CREATE TABLE IF NOT EXISTS donor_list (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      names TEXT NOT NULL DEFAULT ''
    )
  `).run();
  const dlRow = db.prepare("SELECT id FROM donor_list WHERE id = 1").get();
  if (!dlRow) {
    db.prepare("INSERT INTO donor_list (id, names) VALUES (1, '')").run();
  }

  // volunteer_needs: single editable text block for admins
  db.prepare(`
    CREATE TABLE IF NOT EXISTS volunteer_needs (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      needs TEXT NOT NULL DEFAULT ''
    )
  `).run();
  const vnRow = db.prepare("SELECT id FROM volunteer_needs WHERE id = 1").get();
  if (!vnRow) {
    db.prepare("INSERT INTO volunteer_needs (id, needs) VALUES (1, '')").run();
  }

  // volunteer_contacts: form submissions from the volunteer page
  db.prepare(`
    CREATE TABLE IF NOT EXISTS volunteer_contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      firstname TEXT NOT NULL,
      lastname TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `).run();

  // donations: add hide_from_list flag for admin control
  const donationCols = db.prepare("PRAGMA table_info(donations)").all().map(c => c.name);
  if (!donationCols.includes("hide_from_list")) {
    db.prepare("ALTER TABLE donations ADD COLUMN hide_from_list INTEGER NOT NULL DEFAULT 0").run();
  }
  if (!donationCols.includes("user_id")) {
    db.prepare("ALTER TABLE donations ADD COLUMN user_id INTEGER").run();
  }
  if (!donationCols.includes("tier")) {
    db.prepare("ALTER TABLE donations ADD COLUMN tier TEXT").run();
  }
  if (!donationCols.includes("donation_type")) {
    db.prepare("ALTER TABLE donations ADD COLUMN donation_type TEXT").run(); // 'one_time','feed_the_corps','subscription'
  }

  // --- Fan columns on users table ---
  const fanCols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  if (!fanCols.includes("fan")) {
    db.prepare("ALTER TABLE users ADD COLUMN fan INTEGER DEFAULT 0").run();
  }
  if (!fanCols.includes("fanType")) {
    db.prepare("ALTER TABLE users ADD COLUMN fanType TEXT").run(); // 'individual' or 'corporate'
  }
  if (!fanCols.includes("businessName")) {
    db.prepare("ALTER TABLE users ADD COLUMN businessName TEXT").run();
  }
  if (!fanCols.includes("stripe_customer_id")) {
    db.prepare("ALTER TABLE users ADD COLUMN stripe_customer_id TEXT").run();
  }
  // Mobile app role columns — safe to add to existing databases
  if (!fanCols.includes("director")) {
    db.prepare("ALTER TABLE users ADD COLUMN director INTEGER DEFAULT 0").run();
  }
  if (!fanCols.includes("volunteer")) {
    db.prepare("ALTER TABLE users ADD COLUMN volunteer INTEGER DEFAULT 0").run();
  }

  // --- Fan donation subscriptions ---
  db.prepare(`
    CREATE TABLE IF NOT EXISTS fan_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      stripe_subscription_id TEXT NOT NULL,
      stripe_price_id TEXT,
      tier TEXT NOT NULL,
      fan_type TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      shirt_sizes TEXT,
      created_at INTEGER NOT NULL,
      cancelled_at INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `).run();

  // --- potential_donation: add columns for logged-in user tracking ---
  const pdCols = db.prepare("PRAGMA table_info(potential_donation)").all().map(c => c.name);
  if (!pdCols.includes("user_id")) {
    db.prepare("ALTER TABLE potential_donation ADD COLUMN user_id INTEGER").run();
  }
  if (!pdCols.includes("tier")) {
    db.prepare("ALTER TABLE potential_donation ADD COLUMN tier TEXT").run();
  }
  if (!pdCols.includes("donation_type")) {
    db.prepare("ALTER TABLE potential_donation ADD COLUMN donation_type TEXT").run();
  }
  if (!pdCols.includes("shirt_sizes")) {
    db.prepare("ALTER TABLE potential_donation ADD COLUMN shirt_sizes TEXT").run();
  }

})

createTables();

function addChrisShare(baseAmountCents, source) {
  ////ADD THIS TO EVERY TRANSACTION!!!
  if (!baseAmountCents || baseAmountCents <= 0) return;

  // Chris gets 3% of the base amount (half of the 6% fee)
  const chrisCut = Math.round(baseAmountCents * 0.03);
  if (!chrisCut) return;

  db.prepare(`
    UPDATE chrisPayment
    SET total_owed = total_owed + ?
    WHERE id = 1
  `).run(chrisCut);

  db.prepare(`
    INSERT INTO chrisPaymentHistory (created_at, amount, type, note, source)
    VALUES (?, ?, 'credit', ?, ?)
  `).run(
    Date.now(),
    chrisCut,
    `3% share from ${source || "transaction"}`,
    source || ""
  );

  // Also attempt to push this 3% share to Chris via Stripe Connect
  // from the Boise Gems Stripe platform, if configured.
  sendChrisStripeTransfer(chrisCut, source);
}


function ensureDefaultFolders() {
  const FILE_YEAR = 2026;
  const now = Date.now();

  const corpsSections = ["Brass", "Drumline", "Front Ensemble", "Guard"];
  const indoorSections = ["Drumline", "Front Ensemble"];

  const getYearFolder = db.prepare(`
    SELECT * FROM file_folders
    WHERE parent_id IS NULL
      AND scope = ?
      AND year = ?
      AND name = ?
    LIMIT 1
  `);

  const insertFolder = db.prepare(`
    INSERT INTO file_folders (parent_id, scope, year, section, name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  ["corps", "indoor"].forEach(scope => {
    // Year folder (e.g., "2026")
    let yearFolder = getYearFolder.get(scope, FILE_YEAR, String(FILE_YEAR));
    if (!yearFolder) {
      const info = insertFolder.run(
        null,
        scope,
        FILE_YEAR,
        null,
        String(FILE_YEAR),
        now,
        now
      );
      yearFolder = { id: info.lastInsertRowid, scope, year: FILE_YEAR, section: null, name: String(FILE_YEAR) };
    }

    const sections = scope === "corps" ? corpsSections : indoorSections;
    sections.forEach(sectionName => {
      const row = db.prepare(`
        SELECT * FROM file_folders
        WHERE parent_id = ?
          AND scope = ?
          AND year = ?
          AND section = ?
          AND name = ?
        LIMIT 1
      `).get(yearFolder.id, scope, FILE_YEAR, sectionName, sectionName);

      if (!row) {
        insertFolder.run(
          yearFolder.id,
          scope,
          FILE_YEAR,
          sectionName,
          sectionName,
          now,
          now
        );
      }
    });
  });
}

ensureDefaultFolders();

function migrateFormsTable(db) {
  // 1) Ensure base table exists (as in your original)
  db.prepare(`
    CREATE TABLE IF NOT EXISTS forms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      description TEXT,
      document_path TEXT,
      upload INTEGER,
      content TEXT,
      expire_date INTEGER,
      season TEXT,
      due_date INTEGER
    )
  `).run();

  // 2) Discover existing columns
  const cols = db.prepare(`PRAGMA table_info(forms)`).all().map(c => c.name);

  // 3) Add missing columns (idempotent)
  if (!cols.includes('ensemble_type')) {
    // TEXT, default handled in backfill/trigger
    db.prepare(`ALTER TABLE forms ADD COLUMN ensemble_type TEXT`).run();
  }
  if (!cols.includes('contracted')) {
    // store booleans as 0/1
    db.prepare(`ALTER TABLE forms ADD COLUMN contracted INTEGER DEFAULT 0`).run();
  }

  // 4) Backfill existing rows (safe to re-run)
  // Normalize ensemble_type -> 'all' when NULL/blank
  db.prepare(`
    UPDATE forms
    SET ensemble_type = 'all'
    WHERE ensemble_type IS NULL OR TRIM(ensemble_type) = ''
  `).run();

  // contracted = 1 for corps/independent/affiliate
  db.prepare(`
    UPDATE forms
    SET contracted = 1
    WHERE LOWER(ensemble_type) IN ('corps','independent','affiliate')
  `).run();

  // contracted = 0 for 'all' or null (defensive)
  db.prepare(`
    UPDATE forms
    SET contracted = 0
    WHERE ensemble_type IS NULL OR LOWER(ensemble_type) = 'all'
  `).run();

  // 5) Triggers to keep data consistent going forward (idempotent; they coerce values)
  // NOTE: These are AFTER triggers that update the just-inserted/updated row.
  // SQLite won't recurse into triggers again unless PRAGMA recursive_triggers=ON.
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS forms_contract_after_insert
    AFTER INSERT ON forms
    BEGIN
      -- normalize NULL/blank ensemble_type to 'all'
      UPDATE forms
      SET ensemble_type = 'all'
      WHERE id = NEW.id AND (NEW.ensemble_type IS NULL OR TRIM(NEW.ensemble_type) = '');

      -- contracted = 1 for corps/independent/affiliate
      UPDATE forms
      SET contracted = 1
      WHERE id = NEW.id AND LOWER(COALESCE((SELECT ensemble_type FROM forms WHERE id = NEW.id), '')) IN ('corps','independent','affiliate');

      -- contracted = 0 for 'all' or anything else
      UPDATE forms
      SET contracted = 0
      WHERE id = NEW.id AND LOWER(COALESCE((SELECT ensemble_type FROM forms WHERE id = NEW.id), '')) NOT IN ('corps','independent','affiliate');
    END;
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS forms_contract_after_update
    AFTER UPDATE OF ensemble_type, contracted ON forms
    BEGIN
      -- normalize NULL/blank ensemble_type to 'all'
      UPDATE forms
      SET ensemble_type = 'all'
      WHERE id = NEW.id AND (NEW.ensemble_type IS NULL OR TRIM(NEW.ensemble_type) = '');

      -- contracted = 1 for corps/independent/affiliate
      UPDATE forms
      SET contracted = 1
      WHERE id = NEW.id AND LOWER(COALESCE((SELECT ensemble_type FROM forms WHERE id = NEW.id), '')) IN ('corps','independent','affiliate');

      -- contracted = 0 for 'all' or anything else
      UPDATE forms
      SET contracted = 0
      WHERE id = NEW.id AND LOWER(COALESCE((SELECT ensemble_type FROM forms WHERE id = NEW.id), '')) NOT IN ('corps','independent','affiliate');
    END;
  `);
}

  // ---- Extra columns for forms: role_scope (member/staff/admin) ----
  const formCols = db.prepare(`PRAGMA table_info(forms)`).all().map(c => c.name);
  if (!formCols.includes("role_scope")) {
    db.prepare(`ALTER TABLE forms ADD COLUMN role_scope TEXT`).run();
    db.prepare(`
      UPDATE forms
      SET role_scope = 'member'
      WHERE role_scope IS NULL OR TRIM(role_scope) = ''
    `).run();
  }

  // ---- Deposit amount on tuitionFees (per ensemble) ----
  const tfCols = db.prepare(`PRAGMA table_info(tuitionFees)`).all().map(c => c.name);
  if (!tfCols.includes("deposit_amount")) {
    db.prepare(`ALTER TABLE tuitionFees ADD COLUMN deposit_amount INTEGER`).run();
    // default deposit: $50 = 5000 cents if not set
    db.prepare(`
      UPDATE tuitionFees
      SET deposit_amount = 5000
      WHERE deposit_amount IS NULL
    `).run();
  }

  // ---- Contract PDFs (corps / independent / affiliate) ----
  db.prepare(`
    CREATE TABLE IF NOT EXISTS contractPdfs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ensemble TEXT NOT NULL,            -- 'corps', 'independent', or 'affiliate'
      pdf_path TEXT NOT NULL,            -- /pdf/publicpdf/...
      uploaded_at INTEGER NOT NULL
    )
  `).run();

// call it on boot
migrateFormsTable(db);

// ── Schedules tables (NEW — not altering any existing table) ─────────────────
// ⚠️  DO NOT modify existing tables here.  Add only new tables for new features.
function initSchedulesTables(db) {
  // Daily rehearsal / activity schedule
  db.prepare(`
    CREATE TABLE IF NOT EXISTS schedules (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      title         TEXT    NOT NULL,
      date          TEXT    NOT NULL,   -- YYYY-MM-DD
      location      TEXT,
      call_time     TEXT,               -- HH:MM (24h)
      dismissal_time TEXT,              -- HH:MM (24h)
      notes         TEXT,               -- member-visible notes
      staff_notes   TEXT,               -- staff-only (never sent to regular members)
      scope         TEXT    NOT NULL DEFAULT 'all', -- 'all','corps','indoor','bgi'
      created_by    INTEGER,            -- user id of creator
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    )
  `).run();

  db.prepare(`CREATE INDEX IF NOT EXISTS idx_schedules_date ON schedules(date ASC)`).run();

  // Individual time blocks within a schedule
  db.prepare(`
    CREATE TABLE IF NOT EXISTS schedule_blocks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_id INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
      title       TEXT    NOT NULL,
      start_time  TEXT    NOT NULL,     -- HH:MM (24h)
      end_time    TEXT,                 -- HH:MM (24h)
      location    TEXT,                 -- overrides parent schedule location
      -- section filter: 'all','brass','guard','frontensemble','drumline','drummajor'
      section     TEXT    NOT NULL DEFAULT 'all',
      block_type  TEXT    NOT NULL DEFAULT 'rehearsal', -- rehearsal|meal|break|meeting|performance|travel|other
      notes       TEXT,
      sort_order  INTEGER NOT NULL DEFAULT 0
    )
  `).run();
}
initSchedulesTables(db);
// ─────────────────────────────────────────────────────────────────────────────

const app = express()
app.use(express.json())
app.set("view engine", "ejs")
app.set("views", path.join(__dirname, "views"));
app.use(express.static("public")) //Using public folder
app.use(cookieParser())
app.use(express.static('/public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(body_parser.json())
app.use(express.urlencoded({ limit: "10mb", extended: true }));
app.use(session({
  secret: 'secret-key',
  resave: false,
  saveUninitialized: true
}));

function mustBeChrisPaymentViewer(req, res, next) {
  if (!req.user) return res.redirect("/login");

  const email = (req.user.email || "").toLowerCase();
  if (
    email === "austinmoldenhauer@gmail.com" ||
    email === "chris@chrispricemusic.net"
  ) {
    return next();
  }
  return res.redirect("/");
}


function generateCode(length = 4){
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890'
  let code = '';
  for(let i = 0; i < length; i ++){
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code;
}

function mustBeLoggedIn(req, res, next){
    if(req.user) {
        return next()
    }
    else
    {
        return res.redirect("/")
    }
}

function toCents(n) {
  // events.cost stored as integer dollars in your code; convert to cents safely
  const num = Number(n);
  return Number.isFinite(num) ? Math.round(num * 100) : 0;
}

function mustBeAdmin(req, res, next){
    if(req.admin) {
        return next()
    }
    else
    {
        return res.redirect("/")
    }
}

function mustBeStaff(req, res, next){
    if((req.admin) || (req.staff)) {
        return next()
    }
    else
    {
        return res.redirect("/")
    }
}

function mustBeParent(req, res, next){
    if(req.parent) {
        return next()
    }
    else
    {
        return res.redirect("/")
    }
}

function mustBeMember(req,res, next){

  if(!req.user)
  {
    return res.redirect("/")
  }

  if(req.fan){
    return res.redirect("/fan-portal")
  }

  if(!req.parent){
    if(!req.admin)
      return next();
  }

  res.redirect("/")
}

function mustBeLoggedInAny(req, res, next) {
  if (!req.user) return res.redirect("/");
  return next();
}

function mustBeStaffOrAdmin(req, res, next) {
  if (!req.user) return res.redirect("/");
  if (req.admin || req.staff) return next();
  return res.redirect("/");
}


//
// === FORMS VISIBILITY + COMPLETENESS HELPERS ===
//

// Build the WHERE and params for "required forms this user must complete"
function buildFormsQueryForUser(user) {
  const now = Date.now();

  const wantCorps       = !!user?.contractedCorps;
  const wantIndependent = !!user?.contractedIndependent;
  const wantAffiliate   = !!user?.contractedAffiliate;

  // 1) Not contracted to either group â†’ only general "all", non-contracted, member forms
  if (!wantCorps && !wantIndependent && !wantAffiliate) {
    return {
      sql: `
        SELECT *
        FROM forms
        WHERE expire_date > ?
          AND LOWER(COALESCE(ensemble_type, 'all')) = 'all'
          AND COALESCE(contracted, 0) = 0
          AND COALESCE(role_scope, 'member') = 'member'
        ORDER BY due_date IS NULL, due_date ASC, id DESC
      `,
      params: [now],
    };
  }

  // 2) Contracted to corps and/or independent
  let sql = `
    SELECT *
    FROM forms
    WHERE expire_date > ?
      AND COALESCE(role_scope, 'member') = 'member'
      AND (
        (
          LOWER(COALESCE(ensemble_type, 'all')) = 'all'
          AND COALESCE(contracted, 0) = 0
        )
  `;
  const params = [now];

  // Add corps contracted forms
  if (wantCorps) {
    sql += `
        OR (
          LOWER(ensemble_type) = 'corps'
          AND COALESCE(contracted, 0) = 1
        )
    `;
  }

  // Add independent contracted forms
  if (wantIndependent) {
    sql += `
        OR (
          LOWER(ensemble_type) = 'independent'
          AND COALESCE(contracted, 0) = 1
        )
    `;
  }

  // Add affiliate contracted forms
  if (wantAffiliate) {
    sql += `
        OR (
          LOWER(ensemble_type) = 'affiliate'
          AND COALESCE(contracted, 0) = 1
        )
    `;
  }

  // Close the big AND ( ... ) and finish query
  sql += `
      )
    ORDER BY due_date IS NULL, due_date ASC, id DESC
  `;

  return { sql, params };
}


function getRequiredFormsForUser(userId) {
  const user = db.prepare(`
    SELECT id, contractedCorps, contractedIndependent, contractedAffiliate
    FROM users
    WHERE id = ?
  `).get(userId);

  const q = buildFormsQueryForUser(user || { contractedCorps: 0, contractedIndependent: 0, contractedAffiliate: 0 });

  console.log("FORMS SQL:", q.sql);
  console.log("FORMS PARAMS:", q.params);

  return db.prepare(q.sql).all(...q.params);
}

// Given requiredForms[] and uploads[] => mark uploaded + compute leftover count
function markUploadsAndCount(requiredForms, uploads) {
  const uploadedIds = new Set((uploads || []).map(u => u.document_id));
  let leftover = 0;
  for (const f of requiredForms) {
    f.uploaded = uploadedIds.has(f.id);
    if (!f.uploaded) leftover++;
  }
  return leftover;
}


function getGraphicCenter(events) {
  if(!events.length) return null;

  let x = 0, y = 0, z = 0;
  for(const event of events) {
    const lat = event.coords[0] * Math.PI / 180;
    const lon = event.coords[1] * Math.PI / 180;

    x += Math.cos(lat) * Math.cos(lon)
    y += Math.cos(lat) * Math.sin(lon)
    z += Math.sin(lat)
  }

  const total = events.length;
  x/=total;
  y/=total;
  z/=total;

  const hyp = Math.sqrt(x * x + y * y)
  const lat = Math.atan2(z, hyp)
  const lon = Math.atan2(y, x)

  return [lat * 180/ Math.PI, lon * 180 / Math.PI];

}

const CURRENTSEASON = 2026;

app.use(function (req, res, next) {

  res.locals.CURRENTSEASON = CURRENTSEASON;

  if(req.session.flashMessage)
  {
    res.locals.flashMessage = req.session.flashMessage
    delete req.session.flashMessage;
  }

  let errors = [];

    try {
        const decoded = jwt.verify(req.cookies.bgcookie, process.env.JWTSECRET)
        req.user = decoded
        
        req.admin = req.user.admin
        req.parent = req.user.parent
        req.staff = req.user.staff
        req.fan = req.user.fan || 0
    } catch (err) {
        req.user = false
        req.staff = false;
        req.admin = false;
        req.parent = false
        req.fan = false
    }

    res.locals.user = req.user;
    res.locals.admin = req.admin;
    res.locals.parent = req.parent;
    res.locals.fan = req.fan;
    res.locals.errors = errors;

    res.locals.RECAPTCHA_SITE_KEY = process.env.RECAPTCHA_SITE_KEY || "";

    next()
})

app.get("/", (req, res) => {
  const events = db.prepare("SELECT * FROM events ORDER BY datetime DESC").all();

  const news = db.prepare(`
    SELECT id, title, slug, hero, created_at
    FROM news
    ORDER BY created_at DESC
    LIMIT 3
  `).all();

  return res.render("index", {
    admin: true,
    events,
    news
  });
});

app.get("/admin-portal", mustBeAdmin, (req,res) => {
  const memberStatement = db.prepare("SELECT * FROM users WHERE id = ?")
  const member = memberStatement.get(req.user.userid)
  return res.render("admin-portal", {member})
})

const coordinates = {
  'Boise, ID': [43.615, -116.202],
  'Salt Lake City, UT': [40.7608, -111.891],
  'Denver, CO': [39.7392, -104.9903],
  'Kennewick, WA' : [46.202,-119.120],
  'Hillsboro, OR' : [45.522,-122.989],
  'Seattle, WA' : [47.603,-122.330]
};



app.post("/register-parent", (req, res) => {
  let errors = [];

  let firstname = req.body.firstname || "";
  let lastname = req.body.lastname || "";
  let phone = req.body.phone || "";
  let email = req.body.email || "";
  let address = req.body.address || "";
  let password = req.body.password || "";
  let passwordRetype = req.body.passwordRetype || "";
  let birthday = parseBirthdayToTimestamp(req.body.birthday);

  firstname = req.body.firstname.trim();
  lastname = req.body.lastname.trim();
  phone = req.body.phone.trim();
  email = req.body.email.trim().toLowerCase();
  address = req.body.address.trim();

  placeholders = { firstname, lastname, phone, email, address, birthday };

  if (password.length < 8)
    errors.push("Your password must be at least 8 characters long");

  //Checking if email already exists
  const checkEmailstatement = db.prepare("SELECT * FROM users WHERE email = ?");
  const EmailExists = checkEmailstatement.get(email);

  if (EmailExists) errors.push("Email is already in use");

  if (password !== passwordRetype) errors.push("Passwords do not match");

  res.locals.errors = errors;

  if (errors.length) return res.render("register-parent", { placeholders });

  const salt = bcrypt.genSaltSync(10);
  password = bcrypt.hashSync(password, salt);

  // âœ… Instantly verified = 1, no emailsecret/userVerify row
  const addParent = db.prepare(
    "INSERT INTO users (firstname, lastname, password, address, birthday, email, phone, verified, parent, section, created_at) VALUES (? , ? , ? , ? , ? , ? , ? , ? , ? , ? , ?)"
  );
  const newParent = addParent.run(
    firstname,
    lastname,
    password,
    address,
    birthday,
    email,
    phone,
    1, // verified
    1, // parent flag
    "parent",
    Date.now()
  );
  const parentId = newParent.lastInsertRowid;

  // âœ… Auto-login just like /login
  const ourTokenValue = jwt.sign(
    {
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 3,
      userid: parentId,
      firstname,
      lastname,
      email,
      admin: 0,
      staff: 0,
      parent: 1,
    },
    process.env.JWTSECRET
  );

  res.cookie("bgcookie", ourTokenValue, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 24,
  });

  // âœ… Welcome email instead of verify email
  const html = `
    Hello ${firstname},

    <p>Welcome to Boise Gems! Your account has been created successfully.</p>

    <p>You can log in anytime here: <a href="${process.env.BASEURL}/login">${process.env.BASEURL}/login</a></p>

    <p>If you didn't create this account, please contact us.</p>
  `;

  sendEmail(email, "Welcome to Boise Gems!", html);

  return res.redirect("/member-portal");
});


app.get("/verify/:id", (req,res) => {
  const verifyCheck = req.params.id;

  const findVerify = db.prepare("SELECT * FROM userVerify WHERE code = ?")
  const verificationData = findVerify.get(verifyCheck);

  if(!verificationData)
  {
    return res.redirect("/")
  }

  const verifiedUserId = verificationData.user_id;

  const updateStatement = db.prepare("UPDATE users SET verified = 1 WHERE id = ?")
  updateStatement.run(verifiedUserId)

  const deleteStatement = db.prepare("DELETE FROM userVerify WHERE code = ?")
  deleteStatement.run(verifyCheck)

  const userStatement = db.prepare("SELECT * FROM users WHERE id = ?")
  const userInQuestion = userStatement.get(verifiedUserId)

  //Logging in
  // log the user in by giving them a cookie
  const ourTokenValue = jwt.sign({exp: Math.floor(Date.now() / 1000) + (60*60*24*3), userid: userInQuestion.id, firstname: userInQuestion.firstname, lastname: userInQuestion.lastname, email: userInQuestion.email, admin: userInQuestion.admin, staff: userInQuestion.staff, parent: userInQuestion.parent}, process.env.JWTSECRET) //Creating a token for logging in
  
  res.cookie("bgcookie",ourTokenValue, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24
  }) //name, string to remember,

  req.session.flashMessage = "Account verified!"
  return res.redirect("/")
})

app.post("/register-member", (req, res) => {
  if (req.user) return res.redirect("/");

  let errors = [];

  let firstname = req.body.firstname || "";
  let lastname = req.body.lastname || "";
  let phone = req.body.phone || "";
  let email = req.body.email || "";
  let address = req.body.address || "";
  let password = req.body.password || "";
  let passwordRetype = req.body.passwordRetype || "";
  let birthday = parseBirthdayToTimestamp(req.body.birthday);

  firstname = req.body.firstname.trim();
  lastname = req.body.lastname.trim();
  phone = req.body.phone.trim();
  email = req.body.email.trim().toLowerCase();
  address = req.body.address.trim();
  let section = req.body.section.trim();
  let instrument = req.body.instrument.trim();

  placeholders = {
    firstname,
    lastname,
    phone,
    email,
    address,
    birthday,
    section,
    instrument,
  };

  if (password.length < 8)
    errors.push("Your password must be at least 8 characters long");

  //Checking if email already exists
  const checkEmailstatement = db.prepare("SELECT * FROM users WHERE email = ?");
  const EmailExists = checkEmailstatement.get(email);

  if (EmailExists) errors.push("Email is already in use");

  if (password !== passwordRetype) errors.push("Passwords do not match");

  res.locals.errors = errors;

  if (errors.length) return res.render("register-member", { placeholders });

  const salt = bcrypt.genSaltSync(10);
  password = bcrypt.hashSync(password, salt);

  // We can still generate an emailsecret if the column exists, but it won't be used
  const emailsecret = bcrypt
    .hashSync(firstname + Date.now().toString(), salt)
    .replace(/[^a-zA-Z0-9]/g, "");

  // âœ… Instantly verified = 1, no userVerify insert
  const addMember = db.prepare(
    "INSERT INTO users (firstname, lastname, password, address, birthday, email, phone, verified, emailsecret, section, instrument, created_at) VALUES (? , ? , ? , ? , ? , ? , ? , ? , ? , ? , ? , ?)"
  );
  const newMember = addMember.run(
    firstname,
    lastname,
    password,
    address,
    birthday,
    email,
    phone,
    1, // verified
    emailsecret, // stored but not used
    section,
    instrument,
    Date.now()
  );

  const newMemberId = newMember.lastInsertRowid;

  const addPermissions = db.prepare(
    "INSERT INTO permissions (user_id) VALUES (?)"
  );
  addPermissions.run(newMemberId);

  // âœ… Auto-login
  const ourTokenValue = jwt.sign(
    {
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 3,
      userid: newMemberId,
      firstname,
      lastname,
      email,
      admin: 0,
      staff: 0,
      parent: 0,
    },
    process.env.JWTSECRET
  );

  res.cookie("bgcookie", ourTokenValue, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 24,
  });

  // âœ… Welcome email instead of verify email
  const html = `
    Hello ${firstname},

    <p>Welcome to Boise Gems! Your account has been created successfully.</p>

    <p>You can log in anytime here: <a href="${process.env.BASEURL}/login">${process.env.BASEURL}/login</a></p>

    <p>If you didn't create this account, please contact us.</p>
  `;

  sendEmail(email, "Welcome to Boise Gems!", html);

  return res.redirect("/");
});

// ── Register Fan ──
app.post("/register-fan", (req, res) => {
  if (req.user) return res.redirect("/");

  let errors = [];

  let firstname = (req.body.firstname || "").trim();
  let lastname = (req.body.lastname || "").trim();
  let phone = (req.body.phone || "").trim();
  let email = (req.body.email || "").trim().toLowerCase();
  let address = (req.body.address || "").trim();
  let password = req.body.password || "";
  let passwordRetype = req.body.passwordRetype || "";
  let birthday = parseBirthdayToTimestamp(req.body.birthday);
  let fanType = (req.body.fanType || "individual").trim();
  let businessName = (req.body.businessName || "").trim();

  if (!["individual", "corporate"].includes(fanType)) fanType = "individual";
  if (fanType === "corporate" && !businessName) errors.push("Business name is required for corporate accounts");

  if (password.length < 8) errors.push("Your password must be at least 8 characters long");

  const checkEmail = db.prepare("SELECT * FROM users WHERE email = ?");
  if (checkEmail.get(email)) errors.push("Email is already in use");

  if (password !== passwordRetype) errors.push("Passwords do not match");

  if (errors.length) {
    res.locals.errors = errors;
    return res.render("register", {});
  }

  const salt = bcrypt.genSaltSync(10);
  password = bcrypt.hashSync(password, salt);

  const addFan = db.prepare(
    `INSERT INTO users (firstname, lastname, password, address, birthday, email, phone, verified, section, fan, fanType, businessName, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const newFan = addFan.run(
    firstname, lastname, password, address, birthday, email, phone,
    1, "fan", 1, fanType, businessName || null, Date.now()
  );

  const fanId = newFan.lastInsertRowid;

  const ourTokenValue = jwt.sign(
    {
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 3,
      userid: fanId,
      firstname,
      lastname,
      email,
      admin: 0,
      staff: 0,
      parent: 0,
      fan: 1,
    },
    process.env.JWTSECRET
  );

  res.cookie("bgcookie", ourTokenValue, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 24,
  });

  const html = `
    Hello ${firstname},
    <p>Welcome to Boise Gems! Your fan account has been created successfully.</p>
    <p>You can log in anytime here: <a href="${process.env.BASEURL}/login">${process.env.BASEURL}/login</a></p>
    <p>If you didn't create this account, please contact us.</p>
  `;
  sendEmail(email, "Welcome to Boise Gems!", html);

  return res.redirect("/fan-portal");
});


app.get("/check-email", (req,res) => {
  return res.render("check-email")
})



// Predefined lat/lng values (normally from a geocoder)



// Route for /tour
app.get('/tour', (req, res) => {



  res.render('tour-map', { events });
});

app.get("/login", (req,res) => {
  if(req.user)
    return res.redirect("/")
  res.render("login")
})

// Quick duplicate-check used by the registration wizard
app.get("/check-registration", (req, res) => {
  const email = String(req.query.email || "").trim().toLowerCase();
  const phone = String(req.query.phone || "").trim();
  const result = {};
  if (email) {
    const row = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
    result.emailTaken = !!row;
  }
  if (phone) {
    const row = db.prepare("SELECT id FROM users WHERE phone = ?").get(phone);
    result.phoneTaken = !!row;
  }
  res.json(result);
});

app.get("/register", (req,res) => {
  if(req.user)
    return res.redirect("/")
  res.render("register");
})

app.get("/register-parent", (req,res) => {
  if(req.user)
    return res.redirect("/")
  return res.render("register-parent")
})

app.get("/register-member", (req,res) => {
  if(req.user)
    return res.redirect("/member-portal")

  return res.render("register-member", {placeholders: undefined})
})

app.get("/add-member", mustBeParent, (req,res) => {
  return res.render("add-member", {placeholders: undefined})
})

app.get("/logout", mustBeLoggedIn, (req,res) => {
  res.clearCookie("bgcookie")

  return res.redirect("/")
})

app.get("/forgot-password", (req,res) => {
  if(req.user)
    return res.redirect("/")

  return res.render("forgot-password")
})

// ── Fan Portal ──
app.get("/fan-portal", mustBeLoggedIn, (req, res) => {
  const member = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.userid);
  if (!member || !member.fan) return res.redirect("/");

  const subscriptions = db.prepare("SELECT * FROM fan_subscriptions WHERE user_id = ? ORDER BY created_at DESC").all(req.user.userid);
  const donationHistory = db.prepare("SELECT * FROM donations WHERE user_id = ? ORDER BY created_at DESC").all(req.user.userid);

  return res.render("fan-portal", { member, subscriptions, donationHistory });
});

// ── Cancel fan subscription ──
app.post("/fan-portal/cancel-subscription/:id", mustBeLoggedIn, async (req, res) => {
  const member = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.userid);
  if (!member || !member.fan) return res.redirect("/");

  const sub = db.prepare("SELECT * FROM fan_subscriptions WHERE id = ? AND user_id = ?").get(req.params.id, req.user.userid);
  if (!sub || sub.status !== "active") return res.redirect("/fan-portal");

  try {
    await stripe.subscriptions.cancel(sub.stripe_subscription_id);
  } catch (err) {
    console.error("Failed to cancel Stripe subscription:", err);
  }

  db.prepare("UPDATE fan_subscriptions SET status = 'cancelled', cancelled_at = ? WHERE id = ?").run(Date.now(), sub.id);
  return res.redirect("/fan-portal");
});

app.get("/member-portal", mustBeMember, (req,res) => {
  const member = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.userid);
  const contracts = db.prepare("SELECT * FROM contractExtension WHERE user_id = ? OR child_id = ?").all(req.user.userid, req.user.userid);

  // REQUIRED FORMS (by rules)
  const requiredForms = getRequiredFormsForUser(req.user.userid);
  const uploadedForms = db.prepare("SELECT document_id FROM formUploads WHERE user_id = ?").all(req.user.userid);
  const leftoverForms = markUploadsAndCount(requiredForms, uploadedForms);

  const allergy = db.prepare("SELECT * FROM allergies WHERE user_id = ?").get(req.user.userid);

  // Compute minor flag for UI (age < 18)
  member.minor = false;
  if (member && member.birthday) {
    const birthday = new Date(member.birthday);
    const today = new Date();
    let age = today.getFullYear() - birthday.getFullYear();
    const hadBDay =
      today.getMonth() > birthday.getMonth() ||
      (today.getMonth() === birthday.getMonth() && today.getDate() >= birthday.getDate());
    if (!hadBDay) age--;
    member.minor = age < 18;
  }

  return res.render("member-portal", { member, contracts, leftoverForms, allergy });
});

app.get("/member-transactions", mustBeMember, (req, res) => {
  // Logged-in memberâ€™s own record
  const getUserStatement = db.prepare("SELECT * FROM users WHERE id = ?");
  const thisUser = getUserStatement.get(req.user.userid);

  if (!thisUser) {
    return res.redirect("/");
  }

  const getPayments = db.prepare(
    "SELECT * FROM paymentHistory WHERE user_id = ? ORDER BY date DESC"
  );
  const payments = getPayments.all(thisUser.id);

  return res.render("transaction-history", { payments, thisUser });
});

app.get("/parent/transactions/:childId", mustBeParent, (req, res) => {
  const childId = req.params.childId;

  // Make sure this child actually belongs to the logged-in parent
  const getChild = db.prepare(
    "SELECT * FROM users WHERE id = ? AND parentId = ?"
  );
  const thisUser = getChild.get(childId, req.user.userid);

  if (!thisUser) {
    // Not your kid, or doesnâ€™t exist
    return res.redirect("/parent-portal");
  }

  const getPayments = db.prepare(
    "SELECT * FROM paymentHistory WHERE user_id = ? ORDER BY date DESC"
  );
  const payments = getPayments.all(thisUser.id);

  return res.render("transaction-history", { payments, thisUser });
});

app.post("/member-portal/indoor", mustBeMember, (req, res) => {
  const rawSection = String(req.body.indoorSection || "").trim();
  const rawInstrument = String(req.body.indoorInstrument || "").trim();

  let indoorSection = null;
  let indoorInstrument = null;

  // If they pick no section, treat as "not doing Indoor"
  if (rawSection === "" || rawSection === "none") {
    indoorSection = null;
    indoorInstrument = null;
  } else if (rawSection === "Drumline" || rawSection === "Front Ensemble") {
    indoorSection = rawSection;
    indoorInstrument = rawInstrument || null; // allow blank instrument text, but saved if provided
  }

  db.prepare("UPDATE users SET indoorSection = ?, indoorInstrument = ? WHERE id = ?")
    .run(indoorSection, indoorInstrument, req.user.userid);

  req.session.flashMessage = "Boise Gems Indoor preference updated.";
  return res.redirect("/member-portal");
});

const SHIRT_SIZE_OPTIONS = ["XS", "S", "M", "L", "XL", "XXL", "XXXL"];

function normalizeShirtSize(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return null;
  return SHIRT_SIZE_OPTIONS.includes(raw) ? raw : null;
}

app.post("/api/shirt-size", mustBeLoggedInAny, (req, res) => {
  if (req.parent) {
    return res.status(403).json({ ok: false, message: "Parents cannot update shirt size here." });
  }

  const shirtSize = normalizeShirtSize(req.body.shirtSize);

  db.prepare("UPDATE users SET shirtSize = ? WHERE id = ?").run(shirtSize, req.user.userid);

  return res.json({
    ok: true,
    shirtSize: shirtSize || "Not chosen",
    message: "Shirt size saved"
  });
});




app.get("/member-forms", mustBeMember, (req,res) => {
  const member = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.userid);
  if (!member) return res.redirect("/");

  const requiredForms = getRequiredFormsForUser(req.user.userid);
  const uploadedForms = db.prepare("SELECT document_id FROM formUploads WHERE user_id = ?").all(req.user.userid);
  const leftoverForms = markUploadsAndCount(requiredForms, uploadedForms);

  const birthday = db.prepare("SELECT birthday FROM users WHERE id = ?").get(req.user.userid);

  return res.render("member-forms", {
    requiredForms,
    leftoverForms,
    birthday: birthday?.birthday
  });
});



app.get("/member-forms-parent/:id", mustBeParent, (req,res) => {
  const childId = Number(req.params.id);

  const isParent = db.prepare("SELECT parentId FROM users WHERE id = ?").get(childId)?.parentId == req.user.userid;
  if (!isParent) return res.redirect("/");

  const requiredForms = getRequiredFormsForUser(childId);
  const uploadedForms = db.prepare("SELECT document_id FROM formUploads WHERE user_id = ?").all(childId);
  const leftoverForms = markUploadsAndCount(requiredForms, uploadedForms);

  const birthday = db.prepare("SELECT birthday FROM users WHERE id = ?").get(childId);

  req.session.child = childId;

  return res.render("member-forms", {
    requiredForms,
    leftoverForms,
    birthday: birthday?.birthday,
    parent: childId
  });
});


app.get("/upload-form-parent/:id/:child", mustBeParent, (req, res) => {
  const getParentIdStatement = db
    .prepare("SELECT parentId FROM users WHERE id = ?")
    .get(req.params.child);
  const isParent = getParentIdStatement.parentId == req.user.userid;

  if (!isParent) return res.redirect("/");

  const thisForm = db
    .prepare("SELECT * FROM forms WHERE id = ?")
    .get(req.params.id);

  let hasFillablePdf = false;
  if (thisForm && thisForm.document_path && thisForm.document_path.toLowerCase().endsWith(".pdf")) {
    try {
      const rel = thisForm.document_path.replace(/^\/+/, "");
      const abs = path.join(__dirname, "public", rel);
      hasFillablePdf = pdfHasFormFields(abs);
    } catch (err) {
      console.error("Failed to inspect form PDF (parent):", err);
    }
  }

  return res.render("upload-form", {
    thisForm,
    parent: req.params.child,
    hasFillablePdf,
  });
});


app.post("/upload-form-parent/:id/:child", mustBeParent, pdfUploadSecure.single("document_path"), (req, res) => {

  const getParentIdStatement = db.prepare("SELECT parentId FROM users WHERE id = ?").get(req.params.child)
  const isParent = getParentIdStatement.parentId == req.user.userid;

  console.log(isParent)

  if(!isParent)
    return res.redirect("/")

  const documentId = parseInt(req.params.id);
  const userId = req.params.child;

  // Check if user has already uploaded this form
    // If they already uploaded, delete old row + file (resubmission)
  const old = db
    .prepare("SELECT * FROM formUploads WHERE document_id = ? AND user_id = ?")
    .get(documentId, userId);

  if (old && old.upload_path && old.upload_path.startsWith("/secure-pdf/")) {
    const oldFsPath = path.join(__dirname, "private", "pdf", path.basename(old.upload_path));
    try {
      if (fs.existsSync(oldFsPath)) fs.unlinkSync(oldFsPath);
    } catch (err) {
      console.error("Failed to delete old secure pdf (parent):", err);
    }
    db.prepare("DELETE FROM formUploads WHERE id = ?").run(old.id);
  }

  // Pull form data


  // Pull form data
  const name = req.body.name;
  const email = req.body.email;
  const signature = req.body.signature;
  const dateSigned = new Date(req.body.date).getTime();
  const consent = req.body.read ? 1 : 0;

  const ip = req.ip;
  const userAgent = req.headers['user-agent'];
  const documentPath = req.file ? `/secure-pdf/${req.file.filename}` : null;

  // Insert into database
  const insertFormUpload = db.prepare(`
    INSERT INTO formUploads (
      signer_name, signer_email, upload_path, document_id,
      signed_date, ip_address, user_agent, signature,
      consent, user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertFormUpload.run(
    name,
    email,
    documentPath,
    documentId,
    dateSigned,
    ip,
    userAgent,
    signature,
    consent,
    Number(userId)
  );

  req.session.flashMessage = "Form uploaded.";
  return res.redirect(`/member-forms-parent/${userId}`);
});

app.get("/upload-form/:id", mustBeMember, (req, res) => {
  const thisForm = db.prepare("SELECT * FROM forms WHERE id = ?").get(req.params.id);

  let hasFillablePdf = false;
  if (thisForm && thisForm.document_path && thisForm.document_path.toLowerCase().endsWith(".pdf")) {
    try {
      const rel = thisForm.document_path.replace(/^\/+/, "");
      const abs = path.join(__dirname, "public", rel);
      hasFillablePdf = pdfHasFormFields(abs);
    } catch (err) {
      console.error("Failed to inspect form PDF:", err);
    }
  }

  return res.render("upload-form", { thisForm, hasFillablePdf });
});



app.get("/secure-pdf/:filename", mustBeAdmin, (req, res) => {
  const filePath = path.join(__dirname, "private/pdf", req.params.filename);

  if (!fs.existsSync(filePath)) {
    console.log("WOO")
    return res.status(404).send("File not found");
  }

  res.sendFile(filePath);
});

app.post("/upload-form/:id", mustBeMember, pdfUploadSecure.single("document_path"), (req, res) => {
  const documentId = parseInt(req.params.id);
  const userId = req.user.userid;

  // If they already uploaded, delete old row + file (resubmission)
  const old = db
    .prepare("SELECT * FROM formUploads WHERE document_id = ? AND user_id = ?")
    .get(documentId, userId);

  if (old && old.upload_path && old.upload_path.startsWith("/secure-pdf/")) {
    const oldFsPath = path.join(__dirname, "private", "pdf", path.basename(old.upload_path));
    try {
      if (fs.existsSync(oldFsPath)) fs.unlinkSync(oldFsPath);
    } catch (err) {
      console.error("Failed to delete old secure pdf:", err);
    }

    db.prepare("DELETE FROM formUploads WHERE id = ?").run(old.id);
  }

  // Pull form data
  const name      = req.body.name;
  const email     = req.body.email;
  const signature = req.body.signature;
  const dateSigned = new Date(req.body.date).getTime();
  const consent   = req.body.read ? 1 : 0;

  const ip        = req.ip;
  const userAgent = req.headers["user-agent"];
  const documentPath = req.file ? `/secure-pdf/${req.file.filename}` : null;

  const insertFormUpload = db.prepare(`
    INSERT INTO formUploads (
      signer_name, signer_email, upload_path, document_id,
      signed_date, ip_address, user_agent, signature,
      consent, user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertFormUpload.run(
    name,
    email,
    documentPath,
    documentId,
    dateSigned,
    ip,
    userAgent,
    signature,
    consent,
    Number(userId)
  );

  req.session.flashMessage = "Form uploaded.";
  return res.redirect(`/member-forms/${userId}`);
});



app.post("/forgot-password", (req,res) => {
  let errors = [];
  const email = req.body.email

  const findUser = db.prepare("SELECT * FROM users WHERE email = ?")
  const user = findUser.get(email)

   if(!user)
  {
    errors.push("Email does not exist in our system")
    return res.render("forgot-password", {errors})
  }

  const oldReset = db.prepare("DELETE FROM forgotPassword WHERE user_id = ?")
  oldReset.run(user.id)

 

  const salt = bcrypt.genSaltSync(10)
  const emailsecret = bcrypt.hashSync(user.email + Date.now().toString(), salt).replace(/[^a-zA-Z0-9]/g, '')

  const forgotPassword = db.prepare("INSERT INTO forgotPassword (code, user_id) VALUES (? , ?)")
  forgotPassword.run(emailsecret, user.id);

  const html = `
    Hello ${user.firstname},

    An attempt to reset your password was made. If this was not you, please ignore this email. If this was you, reset your password below
    <br/>
    <p style="text-align: center; margin: 32px 0;">
                <a href="${process.env.BASEURL}/reset-password/${emailsecret}" target="_blank" style="background-color: #9D76BB; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 4px; font-weight: bold; display: inline-block;">
                  Reset Password
                </a>
              </p>
    <br/>
    If the button above isn't working, please click here: <a href="${process.env.BASEURL}/reset-password/${emailsecret}">${process.env.BASEURL}/reset-password/${emailsecret}</a>
  `

  sendEmail(email,"Reset Your Password", html)

  return res.render("message", {message: "A link has been sent to your email to reset your password."})

})

app.get("/reset-password/:id", (req,res) => {
  const findReset = db.prepare("SELECT * FROM forgotPassword WHERE code = ?")
  const resetData = findReset.get(req.params.id)

  if(!resetData)
    return res.redirect("/")

  const code = req.params.id
  const userId = resetData.user_id

  return res.render("reset-password", {code, userId})
})

app.post("/reset-password/:id", (req,res) => {
  const findReset = db.prepare("SELECT * FROM forgotPassword WHERE code = ?")
  const resetData = findReset.get(req.params.id)

  let password = req.body.password;
  const passwordRetype = req.body.passwordRetype
  const code = req.params.id

  if(!resetData)
    return res.redirect("/")

  if(password!=passwordRetype)
  {
    errors = ["Passwords do not match."]
    return res.render("reset-password",{errors,code})
  }

  
  const userId = resetData.user_id

  const salt = bcrypt.genSaltSync(10)
  password = bcrypt.hashSync(password, salt)

  const updatePassword = db.prepare("UPDATE users SET password = ? WHERE id = ?")
  updatePassword.run(password, userId)

  const deleteData = db.prepare("DELETE FROM forgotPassword WHERE user_id = ?")
  deleteData.run(userId)

  req.session.flashMessage = `Your password has been reset.`
  return res.redirect("/")
})

app.post("/login", (req, res) => {
  errors = [];

  const email = req.body.email.trim().toLowerCase();
  const password = req.body.password;

  const getUserStatement = db.prepare("SELECT * FROM users WHERE email = ?");
  const userInQuestion = getUserStatement.get(email);

  if (!userInQuestion) {
    errors.push("Invalid email/password");
    return res.render("login", { errors });
  }

  // âŒ old check removed:
  // if(userInQuestion.verified == false) { ... }

  const matchOrNot = bcrypt.compareSync(
    req.body.password,
    userInQuestion.password
  );
  if (!matchOrNot) {
    errors = ["Invalid email/password"];
    return res.render("login", { errors });
  }

  //Logging in
  const ourTokenValue = jwt.sign(
    {
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 3,
      userid: userInQuestion.id,
      firstname: userInQuestion.firstname,
      lastname: userInQuestion.lastname,
      email: userInQuestion.email,
      admin: userInQuestion.admin,
      staff: userInQuestion.staff,
      parent: userInQuestion.parent,
      fan: userInQuestion.fan || 0,
    },
    process.env.JWTSECRET
  ); //Creating a token for logging in

  res.cookie("bgcookie", ourTokenValue, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 24,
  });

  return res.redirect("/");
});


app.get("/change-account-type/:id", mustBeAdmin, (req,res) => {
  const userId = req.params.id;
  const getUserStatement = db.prepare("SELECT * FROM users WHERE id = ?")
  const thisUser = getUserStatement.get(userId);

  if(!thisUser){
    return res.redirect("/")
  }

  return res.render("change-account-type", {thisUser})
})

app.post("/change-account-type/:id", mustBeAdmin, (req,res) => {
  const userId = req.params.id;
  const getUserStatement = db.prepare("SELECT * FROM users WHERE id = ?")
  const thisUser = getUserStatement.get(userId);

  if(!thisUser){
    return res.redirect("/")
  }

  const change = req.body.type;

  let parent = 0;
  let admin = 0;
  let staff = 0;
  if(change == "parent")
    parent = 1;

  if(change == "admin")
    admin = 1;

  if(change == "staff")
    staff = 1;

  const updateStatement = db.prepare("UPDATE users SET parent = ?, admin = ?, staff = ? WHERE id = ?")
  updateStatement.run(parent,admin,staff, userId);

  req.session.flashMessage = `${thisUser.firstname} has been changed to ${change}.`
  return res.redirect("/edit-users")

})

app.get("/change-membership/:id", mustBeAdmin,(req,res) => {
  const userId = req.params.id;
  const getUserStatement = db.prepare("SELECT * FROM users WHERE id = ?")
  const thisUser = getUserStatement.get(userId);

  if(!thisUser){
    return res.redirect("/")
  }

  if(thisUser.parent){
    req.session.flashMessage = `${thisUser.firstname} is a parent. Only members can be changed to contracted.`
    return res.redirect(req.get('Referer'))
  }

  if(thisUser.admin){
    req.session.flashMessage = `${thisUser.firstname} is an admin. Only members can be changed to contracted.`
    return res.redirect(req.get('Referer'))
  }

  if(thisUser.staff){
    req.session.flashMessage = `${thisUser.firstname} is staff. Only members can be changed to contracted.`
    return res.redirect(req.get('Referer'))
  }

  // If the member is a minor with no parent attached, block staff from
  // issuing a contract and show a popup instructing them to have a parent
  // claim the member first.
  let isMinor = false;
  if (thisUser.birthday) {
    const birthday = new Date(thisUser.birthday);
    const today = new Date();
    let age = today.getFullYear() - birthday.getFullYear();
    const hadBDay =
      today.getMonth() > birthday.getMonth() ||
      (today.getMonth() === birthday.getMonth() &&
        today.getDate() >= birthday.getDate());
    if (!hadBDay) age--;
    isMinor = age < 18;
  }

  const parentId = thisUser.parentId || null;
  if (isMinor && !parentId) {
    req.session.flashMessage = `${thisUser.firstname} ${thisUser.lastname} is a minor and does not have a parent attached. Please have a parent claim this member as their child before sending a contract.`;
    return res.redirect(req.get('Referer') || '/staff/members');
  }

  return res.render("change-membership", {thisUser})
})

app.get('/contact', (req,res) => {
  return res.render('contact')
})

app.get("/privacy", (req, res) => {
  return res.render("privacy");
})

app.get("/support/issue", mustBeLoggedInAny, (req, res) => {
  let role = "Member";
  if (req.admin) role = "Admin";
  else if (req.staff) role = "Staff";
  else if (req.parent) role = "Parent";

  res.render("support-issue", {
    role
  });
});

app.post("/support/issue", mustBeLoggedInAny, supportUpload.array("screenshots", 5), async (req, res) => {
  try {
    const subject = String(req.body.subject || "").trim();
    const message = String(req.body.message || "").trim();
    const page_url = String(req.body.page_url || "").trim();

    if (!subject || !message) {
      req.session.flashMessage = "Please provide a subject and detailed description of the issue.";
      return res.redirect("back");
    }

    let role = "Member";
    if (req.admin) role = "Admin";
    else if (req.staff) role = "Staff";
    else if (req.parent) role = "Parent";

    const now = Date.now();
    db.prepare(`
      INSERT INTO support_tickets (user_id, role, subject, message, page_url, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'open', ?)
    `).run(req.user.userid, role, subject, message, page_url, now);

    const attachments = (req.files || []).map(f => ({
      filename: f.originalname,
      content: f.buffer,
      contentType: f.mimetype
    }));

    const html = `
      <h1>Website Issue Submitted</h1>
      <p><strong>User:</strong> ${req.user.firstname} ${req.user.lastname} (ID: ${req.user.userid})</p>
      <p><strong>Role:</strong> ${role}</p>
      ${page_url ? `<p><strong>Page URL:</strong> ${page_url}</p>` : ""}
      <p><strong>Subject:</strong> ${subject}</p>
      <p><strong>Message:</strong></p>
      <p>${message.replace(/\n/g, "<br>")}</p>
    `;

    await sendEmail("chrisprice5614@gmail.com", "Boise Gems Website Issue", html, attachments);

    return res.render("message", {
      message: "Thank you! Your issue has been submitted. We'll take a look as soon as possible."
    });
  } catch (err) {
    console.error("Support issue error:", err);
    return res.status(500).render("message", { message: "Something went wrong submitting your issue. Please try again shortly." });
  }
});



app.post("/contact", async (req,res) => {
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "").trim();
  const message = String(req.body.content || "").trim();
  const token = req.body["g-recaptcha-response"];

  // Basic guards
  if (!name || !email || !message) {
    return res.status(400).render("message", { message: "Please complete all fields." });
  }
  if (!token) {
    return res.status(400).render("message", { message: "Captcha failed. Please try again." });
  }

  try {
    // Verify with Google
    const verifyURL = "https://www.google.com/recaptcha/api/siteverify";
    const params = new URLSearchParams({
      secret: process.env.RECAPTCHA_SECRET || "",
      response: token,
      remoteip: req.ip || ""
    });

    const { data } = await axios.post(verifyURL, params);
    // data: { success: boolean, challenge_ts, hostname, ... }

    if (!data || !data.success) {
      return res.status(400).render("message", { message: "Captcha verification failed. Please try again." });
    }

    // If OK, send email
    const html = `
      <h1>Message from ${name}</h1>
      <p>${message}</p>
      <p>${name}'s email: ${email}</p>
    `;

    await sendEmail(MasterEmail,"Contact Submission Received", html);

    return res.render("message", { message: "Thank you! Your message has been sent and we'll get back to you soon!" });
  } catch (err) {
    console.error("Contact captcha verify/send error:", err);
    return res.status(500).render("message", { message: "Something went wrong. Please try again in a moment." });
  }
});


app.post("/change-membership/:id", mustBeAdmin, (req,res) => {
  const userId = req.params.id;
  const getUserStatement = db.prepare("SELECT * FROM users WHERE id = ?")
  const thisUser = getUserStatement.get(userId);

  if(!thisUser){
    return res.redirect("/")
  }


  const changeCorps = req.body.typeCorps;
  const changeIndependent = req.body.typeIndependent;
  const changeAffiliate = req.body.typeAffiliate;

  let contractedCorps = 0;
  let contractedIndependent = 0;
  let contractedAffiliate = 0;

  if(changeCorps == "contracted")
    contractedCorps = 1

  if(changeIndependent == "contracted")
    contractedIndependent = 1

  if(changeAffiliate == "contracted")
    contractedAffiliate = 1

  const updateStatement = db.prepare("UPDATE users SET contractedCorps = ?, contractedIndependent = ?, contractedAffiliate = ? WHERE id = ?")
  updateStatement.run(contractedCorps, contractedIndependent, contractedAffiliate, userId)
  

  req.session.flashMessage = `${thisUser.firstname} has been changed to contracted for corps is ${changeCorps}, for Independent is ${changeIndependent}, and for Affiliate is ${changeAffiliate}`


  return res.redirect("/edit-users")
})

app.get("/extend-contract/:id", mustBeStaff, (req,res) => {
  const userId = req.params.id;
  const getUserStatement = db.prepare("SELECT * FROM users WHERE id = ?")
  const thisUser = getUserStatement.get(userId);

  if(!thisUser){
    return res.redirect("/")
  }

  if(thisUser.parent){
    req.session.flashMessage = `${thisUser.firstname} is a parent. Only members can be changed to contracted.`
    return res.redirect(req.get('Referer'))
  }

  if(thisUser.admin){
    req.session.flashMessage = `${thisUser.firstname} is an admin. Only members can be changed to contracted.`
    return res.redirect(req.get('Referer'))
  }

  if(thisUser.staff){
    req.session.flashMessage = `${thisUser.firstname} is staff. Only members can be changed to contracted.`
    return res.redirect(req.get('Referer'))
  }



  return res.render("extend-contract",{thisUser})
})

app.get("/accept-contract/:id", mustBeLoggedIn, ensureActiveContractExtension, (req, res) => {
  const getContractStatement = db.prepare(
    "SELECT * FROM contractExtension WHERE id = ?"
  );
  const contractExtension = getContractStatement.get(req.params.id);

  if (!contractExtension || contractExtension.user_id != req.user.userid) {
    return res.redirect("/");
  }

  let groupLabel = "Independent";
  let ensemble = "independent";

  if (contractExtension.season.includes("corps")) {
    groupLabel = "Drum & Bugle Corps";
    ensemble = "corps";
  } else if (contractExtension.season.includes("affiliate")) {
    groupLabel = "Affiliate";
    ensemble = "affiliate";
  }

  // Tuition + deposit info
  const tuitionRow = db
    .prepare("SELECT amount, deposit_amount FROM tuitionFees WHERE ensemble = ?")
    .get(ensemble);

  const depositCents = tuitionRow?.deposit_amount || 5000;
  const depositLabel = (depositCents / 100).toFixed(2);

  // Contract PDF (if any)
  const pdfRow = db
    .prepare(
      "SELECT pdf_path FROM contractPdfs WHERE ensemble = ? ORDER BY uploaded_at DESC LIMIT 1"
    )
    .get(ensemble);

  const contractPdfPath = pdfRow ? pdfRow.pdf_path : null;

  return res.render("accept-contract", {
    group: groupLabel,
    season: CURRENTSEASON,
    contractExtension,
    bypass: contractExtension.bypass_fee,
    depositLabel,
    contractPdfPath,
  });
});



app.get("/sign-contract/:id", mustBeLoggedIn, (req,res) => {
  const getContractStatement = db.prepare("SELECT * FROM contractExtension WHERE id = ?")
  const contractExtension = getContractStatement.get(req.params.id);

  if(contractExtension.user_id != req.user.userid)
  {
    return res.redirect("/")
  }

  if(!contractExtension){
    return res.redirect("/")
  }

  let group = "Independent"

  if (contractExtension.season.includes("corps")) {
    group = "Drum & Bugle Corps";
  } else if (contractExtension.season.includes("affiliate")) {
    group = "Affiliate";
  }

  return res.render("sign-contract",{group, season: CURRENTSEASON, contractExtension})
})

app.post(
  "/sign-contract/:id",
  mustBeLoggedIn,
  pdfUploadSecure.single("signed_contract"),
  async (req, res) => {
    const getContractStatement = db.prepare(
      "SELECT * FROM contractExtension WHERE id = ?"
    );
    const contractExtension = getContractStatement.get(req.params.id);

    if (
      !contractExtension ||
      (contractExtension.user_id !== req.user.userid &&
        contractExtension.child_id !== req.user.userid)
    ) {
      return res.redirect("/");
    }

    // Who is the actual member this contract is FOR?
    const memberId = contractExtension.child_id || contractExtension.user_id;
    const isMinorContract = !!contractExtension.child_id;

    // Ensure a signed contract PDF was uploaded
    if (!req.file) {
      req.session.flashMessage = "Please upload your signed contract PDF.";
      return res.redirect(`/sign-contract/${contractExtension.id}`);
    }

    // File is stored under ./private/pdf/<filename>
    const contractFilePath = path.join("private", "pdf", req.file.filename);

    // Determine ensemble type
    let ensemble = "independent";
    if (contractExtension.season.includes("corps")) {
      ensemble = "corps";
    } else if (contractExtension.season.includes("affiliate")) {
      ensemble = "affiliate";
    }

    const getTuitionStatement = db.prepare(
      "SELECT amount, deposit_amount FROM tuitionFees WHERE ensemble = ?"
    );
    const tuition = getTuitionStatement.get(ensemble);
    if (!tuition) {
      return res.redirect("/");
    }

    // If bypass fee or user selected cash, skip Stripe but still mark contracted + store contract file
    const payWithCash = contractExtension.bypass_fee || req.body.pay_with_cash === 'on' || req.body.check === 'on';
    if (payWithCash) {
      if (ensemble === "corps") {
        db.prepare(
          "UPDATE users SET contractedCorps = 1, owed = COALESCE(owed,0) + ? WHERE id = ?"
        ).run(tuition.amount, memberId);
      } else if (ensemble === "affiliate") {
        db.prepare(
          "UPDATE users SET contractedAffiliate = 1, owed = COALESCE(owed,0) + ? WHERE id = ?"
        ).run(tuition.amount, memberId);
      } else {
        db.prepare(
          "UPDATE users SET contractedIndependent = 1, owed = COALESCE(owed,0) + ? WHERE id = ?"
        ).run(tuition.amount, memberId);
      }

      db.prepare(
        `
        INSERT INTO contractedMembers (season, ensemble, contracted_date, user_id, signedContractPath, paymentMethod)
        VALUES (?, ?, ?, ?, ?, ?)
        `
      ).run(
        contractExtension.season,
        ensemble,
        Date.now(),
        memberId,
        contractFilePath,
        'cash'
      );

      // Remove temporary contractExtension entry
      db.prepare("DELETE FROM contractExtension WHERE id = ?").run(
        req.params.id
      );

      // NEW: email the child when a minor contract is signed (cash path)
      if (isMinorContract) {
        const childRow = db
          .prepare("SELECT firstname, lastname, email FROM users WHERE id = ?")
          .get(memberId);

        if (childRow && childRow.email) {
          const html = `
            <h1>Your Boise Gems Contract Is Signed!</h1>
            <p>Hi ${childRow.firstname},</p>
            <p>
              Your parent/guardian has signed your contract for the
              ${ensemble === "corps" ? "Boise Gems Drum & Bugle Corps" : (ensemble === "affiliate" ? "Boise Gems Affiliate" : "Boise Gems Independent")}
              for the ${CURRENTSEASON} season.
            </p>
            <p>Weâ€™re excited to have you with us!</p>
          `;
          sendEmail(
            childRow.email,
            "Your Boise Gems contract has been signed!",
            html
          );
        }
      }

      const redirectTarget = isMinorContract ? "/parent-portal" : "/member-portal";
      req.session.flashMessage = "Contract signed successfully - cash/check selected. No online payment required. Welcome to Boise Gems!";
      return res.redirect(redirectTarget);
    }

    // Stripe checkout flow for down payment (from DB) + ~6% processing fee
    let downPayment = Number(tuition.deposit_amount || 0); // cents, from DB

    // If no deposit set, fall back to full tuition amount
    if (!downPayment || downPayment <= 0) {
      downPayment = Number(tuition.amount || 0);
    }

    const processingFee = Math.ceil(downPayment * 0.06);
    const totalAmount = downPayment + processingFee;

    // Save potential payment INCLUDING contract file path
    const insertPotential = db.prepare(
      `
      INSERT INTO potential_payment
        (child_id, parent_id, user_id, contract_id, amount, contract_file_path, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `
    );

    // For minors, user_id = parent (payer), child_id = member
    const childId = isMinorContract ? memberId : null;
    const parentId = isMinorContract ? req.user.userid : null;

    const result = insertPotential.run(
      childId,
      parentId,
      req.user.userid,           // payer
      contractExtension.id,
      totalAmount,
      contractFilePath,
      Date.now()
    );
    const potentialPaymentId = result.lastInsertRowid;

    // Stripe Checkout Session (unchanged below, just ensure it uses totalAmount)
    try {
      const sessionObj = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: `Contract down payment (${ensemble})`,
                description: `Down payment plus processing fee for Boise Gems ${ensemble} contract.`,
              },
              unit_amount: totalAmount,
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        success_url: `${process.env.BASEURL}/sign-contract/success/${potentialPaymentId}`,
        cancel_url: `${process.env.BASEURL}/sign-contract/${contractExtension.id}`,
      })

      return res.redirect(303, sessionObj.url);
    } catch (err) {
      console.error("Stripe session error:", err);
      req.session.flashMessage =
        "There was an error starting the payment. Please try again, or contact staff.";
      return res.redirect(`/sign-contract/${contractExtension.id}`);
    }
  }
);



app.get("/sign-contract/success/:potentialId", mustBeLoggedIn, (req, res) => {
  // Fetch the potential payment
  const getPotential = db.prepare(
    "SELECT * FROM potential_payment WHERE id = ? AND user_id = ?"
  );
  const potential = getPotential.get(req.params.potentialId, req.user.userid);

  if (!potential) {
    return res.redirect("/"); // invalid potential payment
  }

  // Fetch the related contractExtension
  const getContract = db.prepare(
    "SELECT * FROM contractExtension WHERE id = ?"
  );
  const contractExtension = getContract.get(potential.contract_id);

  if (!contractExtension) {
    return res.redirect("/");
  }

  let ensemble = "independent";
  if (contractExtension.season.includes("corps")) {
    ensemble = "corps";
  } else if (contractExtension.season.includes("affiliate")) {
    ensemble = "affiliate";
  }

  // Who is the member this contract is actually FOR?
  const memberId = contractExtension.child_id || contractExtension.user_id;
  const isMinorContract = !!contractExtension.child_id;

  // Fetch tuition fees AND deposit for the ensemble
  const getTuition = db.prepare(
    "SELECT amount, deposit_amount FROM tuitionFees WHERE ensemble = ?"
  );
  const tuition = getTuition.get(ensemble);
  if (!tuition) return res.redirect("/");

  // Update member: set contracted flag and owed tuition
  const getUser = db.prepare("SELECT * FROM users WHERE id = ?");
  const user = getUser.get(memberId);
  if (!user) return res.redirect("/");

  // Set contracted flags
  let updateFields = "";
  if (ensemble === "corps") updateFields = "contractedCorps = 1";
  else if (ensemble === "affiliate") updateFields = "contractedAffiliate = 1";
  else updateFields = "contractedIndependent = 1";

  // Add tuition amount to owed
  const newOwed = (user.owed || 0) + tuition.amount;

  const updateUser = db.prepare(
    `UPDATE users SET ${updateFields}, owed = ? WHERE id = ?`
  );
  updateUser.run(newOwed, user.id);

  // Deduct down payment based on DB deposit_amount
  let downPayment = Number(tuition.deposit_amount || 0);

  // If no deposit set, fall back to full tuition amount
  if (!downPayment || downPayment <= 0) {
    downPayment = Number(tuition.amount || 0);
  }

  const remainingOwed = newOwed - downPayment;

  // 3% Chris share, still based on downPayment
  addChrisShare(
    downPayment,
    `Contract down payment for ${ensemble} (user ${user.id})`
  );

  db.prepare("UPDATE users SET owed = ? WHERE id = ?").run(
    remainingOwed,
    user.id
  );

  // Insert into paymentHistory
  const addPayment = db.prepare(
    "INSERT INTO paymentHistory (title, description, amount, method, date, user_id) VALUES (?, ?, ?, ?, ?, ?)"
  );

  const downLabel = (downPayment / 100).toFixed(2);
  const feeCents = (potential.amount || 0) - downPayment;
  const feeLabel = feeCents > 0 ? (feeCents / 100).toFixed(2) : "0.00";

  const paymentTitle = `Contract down payment for ${ensemble} ensemble`;
  const paymentDesc = `User ${user.firstname} ${user.lastname} made a $${downLabel} down payment (plus $${feeLabel} processing fee) down payment for ${ensemble} contract.`;

  addPayment.run(
    paymentTitle,
    paymentDesc,
    potential.amount,
    "Stripe",
    Date.now(),
    user.id
  );

  // Insert contractedMembers row (with stored contract file path)
  db.prepare(
    `
    INSERT INTO contractedMembers (season, ensemble, contracted_date, user_id, signedContractPath, paymentMethod)
    VALUES (?, ?, ?, ?, ?, ?)
    `
  ).run(
    contractExtension.season,
    ensemble,
    Date.now(),
    user.id,
    potential.contract_file_path || null,
    'stripe'
  );

  // Delete potential payment to prevent reuse
  db.prepare("DELETE FROM potential_payment WHERE id = ?").run(potential.id);

  // Delete contractExtension (they are now contracted)
  db.prepare("DELETE FROM contractExtension WHERE id = ?").run(
    contractExtension.id
  );

  // NEW: email the child when a minor contract is signed
  if (isMinorContract) {
    const childRow = db
      .prepare("SELECT firstname, lastname, email FROM users WHERE id = ?")
      .get(memberId);

    if (childRow && childRow.email) {
      const html = `
        <h1>Your Boise Gems Contract Is Signed!</h1>
        <p>Hi ${childRow.firstname},</p>
        <p>
          Your parent/guardian has signed your contract for the
          ${ensemble === "corps" ? "Boise Gems Drum & Bugle Corps" : "Boise Gems Independent"}
          for the ${CURRENTSEASON} season.
        </p>
        <p>Weâ€™re excited to have you with us!</p>
      `;
      sendEmail(
        childRow.email,
        "Your Boise Gems contract has been signed!",
        html
      );
    }
  }

  const redirectTarget = isMinorContract ? "/parent-portal" : "/member-portal";
  req.session.flashMessage =
    "Contract signed successfully and payment received. Welcome to Boise Gems!";
  res.redirect(redirectTarget);
});





app.post("/extend-contract/:id", mustBeStaff, (req, res) => {
  const userId = Number(req.params.id);
  const getUserStatement = db.prepare("SELECT * FROM users WHERE id = ?");
  const thisUser = getUserStatement.get(userId);
  const group = req.body.group; // "corps" or "independent"
  const bypass = req.body.bypass ? 1 : 0;

  if (!thisUser) {
    return res.redirect("/");
  }

  // Only actual members can be contracted
  if (thisUser.parent) {
    req.session.flashMessage = `${thisUser.firstname} is a parent. Only members can be changed to contracted.`;
    return res.redirect(req.get("Referer"));
  }

  if (thisUser.admin) {
    req.session.flashMessage = `${thisUser.firstname} is an admin. Only members can be changed to contracted.`;
    return res.redirect(req.get("Referer"));
  }

  if (thisUser.staff) {
    req.session.flashMessage = `${thisUser.firstname} is staff. Only members can be changed to contracted.`;
    return res.redirect(req.get("Referer"));
  }

    // Determine if this member is a minor (under 18)
  let isMinor = false;
  if (thisUser.birthday) {
    const birthday = new Date(thisUser.birthday);
    const today = new Date();
    let age = today.getFullYear() - birthday.getFullYear();
    const hadBDay =
      today.getMonth() > birthday.getMonth() ||
      (today.getMonth() === birthday.getMonth() &&
        today.getDate() >= birthday.getDate());
    if (!hadBDay) age--;
    isMinor = age < 18;
  }

  const parentId = thisUser.parentId || null;

  // ðŸš« NEW: block sending contracts to minors with no parent attached
  if (isMinor && !parentId) {
    req.session.flashMessage = `${thisUser.firstname} ${thisUser.lastname} is a minor and does not have a parent attached. Please add a parent account before sending a contract.`;
    return res.redirect(req.get("Referer") || "/admin-portal");
  }

  // Who OWNS the contract extension (who logs in to sign)?
  //  - Adults: user signs their own contract (user_id = member id)
  //  - Minors with a parent: parent signs (user_id = parent id, child_id = member id)
  let contractOwnerId = thisUser.id;
  let childId = null;

  if (isMinor && parentId) {
    contractOwnerId = parentId;
    childId = thisUser.id;
  }



  const seasonString = String(CURRENTSEASON) + group; // e.g. "2026corps"

  // If a non-admin staff member triggers this, queue it as a pending
  // contract extension for admin review instead of sending immediately.
  if (!req.admin) {
    // First check if there is already a pending extension for this member/season
    const existingPending = db
      .prepare(
        `
        SELECT id
        FROM pendingContractExtension
        WHERE member_id = ?
          AND season = ?
        LIMIT 1
        `
      )
      .get(thisUser.id, seasonString);

    if (existingPending) {
      // Let the staff member know there is already a pending request
      req.session.flashMessage =
        "A pending contract extension for this member already exists and is awaiting admin approval.";
      return res.redirect(req.get("Referer") || "/member-portal");
    }

    // No existing pending â†’ create a new pending contract extension
    db.prepare(
      `
      INSERT INTO pendingContractExtension
        (member_id, group_type, bypass_fee, season, requested_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      `
    ).run(
      thisUser.id,
      group,
      bypass,
      seasonString,
      req.user.userid,
      Date.now()
    );

    req.session.flashMessage =
      "Contract extension request submitted for admin approval.";
    // Send them back to where they came from (usually /extend-contract/:id
    // or your staff members page) so they SEE the success message.
    return res.redirect(req.get("Referer") || "/member-portal");
  }


  // Make sure this specific member only has ONE extension for this season.
  // Use COALESCE(child_id, user_id) so it works for both adults and minors.
  const oldContractArray = db
    .prepare(
      `
      SELECT *
      FROM contractExtension
      WHERE COALESCE(child_id, user_id) = ?
        AND season = ?
      `
    )
    .all(thisUser.id, seasonString);

  oldContractArray.forEach((oldContract) => {
    db.prepare("DELETE FROM contractExtension WHERE id = ?").run(
      oldContract.id
    );
  });

  // Insert new contractExtension
  const addContractExtensionStatement = db.prepare(`
    INSERT INTO contractExtension (user_id, child_id, due_date, bypass_fee, created_at, season, extender)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const expiresAt = Date.now() + CONTRACT_EXTENSION_TTL_MS;

  addContractExtensionStatement.run(
    contractOwnerId, // who logs in to sign
    childId,         // the child this contract is FOR (null for adults)
    expiresAt,
    bypass,
    Date.now(),
    seasonString,
    req.user.userid // staff who issued extension
  );

  // Build email
  let welcomeMessage = "The Boise Gems Drum & Bugle Corps";
  if (group === "independent") {
    welcomeMessage = "Boise Gems Independent";
  } else if (group === "affiliate") {
    welcomeMessage = "Boise Gems Affiliate";
  }

  // Email goes to parent for minors, to member for adults
  let emailTarget = { email: thisUser.email, firstname: thisUser.firstname };
  if (isMinor && parentId) {
    const parentRow = db
      .prepare("SELECT firstname, email FROM users WHERE id = ?")
      .get(parentId);
    if (parentRow && parentRow.email) {
      emailTarget = parentRow;
    }
  }

  const html = `
    <h1 style="text-align: center;">Congratulations!</h1>
    <br>
    <p>
      Hello ${emailTarget.firstname},
    </p>
    <p>
      ${
        childId
          ? `${thisUser.firstname} ${thisUser.lastname} has been offered a contract with ${welcomeMessage} for the ${CURRENTSEASON} season.`
          : `You've been offered a contract with ${welcomeMessage} for the ${CURRENTSEASON} season.`
      }
    </p>
    <p>
      Please log in to your account to review the contract and sign it.
    </p>
    <div style="text-align: center; margin-top: 16px;">
      <a
        href="${process.env.BASEURL}/login"
        target="_blank"
        style="
          background-color: #0b71d9;
          color: white;
          padding: 10px 18px;
          border-radius: 4px;
          font-weight: bold;
          display: inline-block;
          text-decoration: none;
        "
      >
        Log In To Your Account
      </a>
    </div>
  `;

  sendEmail(emailTarget.email, "Contract Extension", html);

  req.session.flashMessage = "Contract extension sent.";
  return res.redirect("/admin-portal");
});

app.get("/admin/pending-contracts", mustBeAdmin, (req, res) => {
  const pending = db
    .prepare(
      `
      SELECT p.*,
             m.firstname AS member_firstname,
             m.lastname  AS member_lastname,
             m.email     AS member_email,
             r.firstname AS requester_firstname,
             r.lastname  AS requester_lastname
      FROM pendingContractExtension p
      JOIN users m ON m.id = p.member_id
      LEFT JOIN users r ON r.id = p.requested_by
      ORDER BY p.created_at DESC
      `
    )
    .all();

  return res.render("admin-pending-contracts", {
    user: req.user,
    pending,
  });
});

app.post("/admin/pending-contracts/:id/deny", mustBeAdmin, (req, res) => {
  const id = Number(req.params.id);
  db.prepare("DELETE FROM pendingContractExtension WHERE id = ?").run(id);
  req.session.flashMessage = "Pending contract request deleted.";
  return res.redirect("/admin/pending-contracts");
});

app.post("/admin/pending-contracts/:id/approve", mustBeAdmin, (req, res) => {
  const id = Number(req.params.id);

  const pending = db
    .prepare("SELECT * FROM pendingContractExtension WHERE id = ?")
    .get(id);

  if (!pending) {
    req.session.flashMessage = "Pending contract request not found.";
    return res.redirect("/admin/pending-contracts");
  }

  const member = db
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(pending.member_id);

  if (!member) {
    req.session.flashMessage = "Member not found for pending contract.";
    return res.redirect("/admin/pending-contracts");
  }

  // Only actual members can be contracted
  if (member.parent || member.admin || member.staff) {
    req.session.flashMessage =
      "Only members (not parents, staff, or admins) can be contracted.";
    return res.redirect("/admin/pending-contracts");
  }

  // Determine if this member is a minor (under 18)
  let isMinor = false;
  if (member.birthday) {
    const birthday = new Date(member.birthday);
    const today = new Date();
    let age = today.getFullYear() - birthday.getFullYear();
    const hadBDay =
      today.getMonth() > birthday.getMonth() ||
      (today.getMonth() === birthday.getMonth() &&
        today.getDate() >= birthday.getDate());
    if (!hadBDay) age--;
    isMinor = age < 18;
  }

  const parentId = member.parentId || null;

  // Minors must have a parent linked
  if (isMinor && !parentId) {
    req.session.flashMessage =
      `${member.firstname} ${member.lastname} is a minor and has no parent attached. Please add a parent account before sending a contract.`;
    return res.redirect("/admin/pending-contracts");
  }

  // Who OWNS the contract extension (who logs in to sign)?
  let contractOwnerId = member.id;
  let childId = null;

  if (isMinor && parentId) {
    contractOwnerId = parentId;
    childId = member.id;
  }

  const group = pending.group_type; // "corps" or "independent"
  const bypass = pending.bypass_fee ? 1 : 0;
  const seasonString =
    pending.season || String(CURRENTSEASON) + String(group || "");

  // Ensure only one extension for this member/season
  const oldContractArray = db
    .prepare(
      `
      SELECT *
      FROM contractExtension
      WHERE COALESCE(child_id, user_id) = ?
        AND season = ?
      `
    )
    .all(member.id, seasonString);

  oldContractArray.forEach((oldContract) => {
    db.prepare("DELETE FROM contractExtension WHERE id = ?").run(
      oldContract.id
    );
  });

  const addContractExtensionStatement = db.prepare(`
    INSERT INTO contractExtension (user_id, child_id, due_date, bypass_fee, created_at, season, extender)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const expiresAt = Date.now() + CONTRACT_EXTENSION_TTL_MS;

  addContractExtensionStatement.run(
    contractOwnerId, // who logs in to sign
    childId, // null for adults
    expiresAt,
    bypass,
    Date.now(),
    seasonString,
    req.user.userid // admin who approved
  );

  let welcomeMessage = "The Boise Gems Drum & Bugle Corps";
  if (group === "independent") {
    welcomeMessage = "Boise Gems Independent";
  } else if (group === "affiliate") {
    welcomeMessage = "Boise Gems Affiliate";
  }

  let emailTarget = { email: member.email, firstname: member.firstname };
  if (isMinor && parentId) {
    const parentRow = db
      .prepare("SELECT firstname, email FROM users WHERE id = ?")
      .get(parentId);
    if (parentRow && parentRow.email) {
      emailTarget = parentRow;
    }
  }

  const html = `
    <p>Hello ${emailTarget.firstname || ""},</p>
    <p>
      ${
        childId
          ? `${member.firstname} ${member.lastname} has been offered a contract with ${welcomeMessage} for the ${CURRENTSEASON} season.`
          : `You've been offered a contract with ${welcomeMessage} for the ${CURRENTSEASON} season.`
      }
    </p>
    <p>
      Please log in to your account to review the contract and sign it.
    </p>
    <div style="text-align: center; margin-top: 16px;">
      <a
        href="${process.env.BASEURL}/login"
        target="_blank"
        style="
          background-color: #0b71d9;
          color: white;
          padding: 10px 18px;
          border-radius: 4px;
          font-weight: bold;
          display: inline-block;
          text-decoration: none;
        "
      >
        Log In To Your Account
      </a>
    </div>
  `;

  if (emailTarget.email) {
    sendEmail(emailTarget.email, "Contract Extension", html);
  }

  db.prepare("DELETE FROM pendingContractExtension WHERE id = ?").run(id);

  req.session.flashMessage = "Pending contract approved and extension sent.";
  return res.redirect("/admin/pending-contracts");
});

app.get("/admin/contract-extensions", mustBeAdmin, (req, res) => {
  const now = Date.now();

  const rows = db
    .prepare(`
      SELECT
        ce.*,
        signer.firstname AS signerFirst,
        signer.lastname  AS signerLast,
        signer.email     AS signerEmail,
        child.firstname  AS childFirst,
        child.lastname   AS childLast
      FROM contractExtension ce
      JOIN users signer
        ON signer.id = ce.user_id
      LEFT JOIN users child
        ON child.id = ce.child_id
      ORDER BY ce.created_at DESC
    `)
    .all();

  const extensions = rows.map((ce) => {
    const dueMs = Number(ce.due_date || 0);
    let daysRemaining = null;
    let status = "unknown";

    if (dueMs > 0) {
      const diffMs = dueMs - now;
      daysRemaining = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
      status = diffMs >= 0 ? "active" : "expired";
    }

    ce.daysRemaining = daysRemaining;
    ce.status = status;
    return ce;
  });

  return res.render("admin-contract-extensions", {
    extensions,
  });
});

// Resend selected contract extensions — creates fresh extensions with the same
// data, sends new emails, then deletes the old extension rows.
app.post("/admin/contract-extensions/resend", mustBeAdmin, (req, res) => {
  const rawIds = req.body.extensionIds;
  if (!rawIds) {
    req.session.flashMessage = "No contracts selected to resend.";
    return res.redirect("/admin/contract-extensions");
  }

  const ids = (Array.isArray(rawIds) ? rawIds : [rawIds]).map(Number).filter(Boolean);
  if (!ids.length) {
    req.session.flashMessage = "No valid contracts selected.";
    return res.redirect("/admin/contract-extensions");
  }

  let sentCount = 0;

  for (const id of ids) {
    const ext = db
      .prepare(
        `SELECT ce.*,
                signer.firstname AS signerFirst, signer.lastname AS signerLast, signer.email AS signerEmail,
                child.firstname  AS childFirst,  child.lastname  AS childLast,  child.email  AS childEmail
         FROM contractExtension ce
         JOIN users signer ON signer.id = ce.user_id
         LEFT JOIN users child ON child.id = ce.child_id
         WHERE ce.id = ?`
      )
      .get(id);

    if (!ext) continue;

    // Delete the old extension
    db.prepare("DELETE FROM contractExtension WHERE id = ?").run(id);

    // Insert a fresh extension with the same parameters and a new TTL
    const newExpiresAt = Date.now() + CONTRACT_EXTENSION_TTL_MS;
    db.prepare(
      `INSERT INTO contractExtension (user_id, child_id, due_date, bypass_fee, created_at, season, extender)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      ext.user_id,
      ext.child_id || null,
      newExpiresAt,
      ext.bypass_fee,
      Date.now(),
      ext.season,
      req.user.userid
    );

    // Determine group label for email
    const group = ext.season && ext.season.includes("independent")
      ? "independent"
      : ext.season && ext.season.includes("affiliate")
        ? "affiliate"
        : "corps";

    let welcomeMessage = "The Boise Gems Drum & Bugle Corps";
    if (group === "independent") welcomeMessage = "Boise Gems Independent";
    else if (group === "affiliate") welcomeMessage = "Boise Gems Affiliate";

    // Email target is the signer (parent for minors, member for adults)
    const emailName  = ext.signerFirst || "";
    const emailAddr  = ext.signerEmail || "";
    const memberName = ext.childFirst
      ? `${ext.childFirst} ${ext.childLast}`
      : `${ext.signerFirst} ${ext.signerLast}`;

    const html = `
      <h1 style="text-align:center;">Contract Reminder</h1>
      <p>Hello ${emailName},</p>
      <p>
        ${ext.child_id
          ? `${memberName} has a pending contract with ${welcomeMessage} for the ${CURRENTSEASON} season.`
          : `You have a pending contract with ${welcomeMessage} for the ${CURRENTSEASON} season.`}
      </p>
      <p>Your previous contract link has been refreshed. Please log in to your account to review and sign it.</p>
      <div style="text-align:center; margin-top:16px;">
        <a href="${process.env.BASEURL}/login"
           target="_blank"
           style="background-color:#0b71d9;color:white;padding:10px 18px;border-radius:4px;font-weight:bold;display:inline-block;text-decoration:none;">
          Log In To Your Account
        </a>
      </div>
    `;

    if (emailAddr) {
      sendEmail(emailAddr, "Contract Extension — Resent", html);
    }

    sentCount++;
  }

  req.session.flashMessage = `${sentCount} contract${sentCount === 1 ? "" : "s"} resent successfully. Old links replaced with fresh ones.`;
  return res.redirect("/admin/contract-extensions");
});



app.get("/view-forms/:id", mustBeAdmin, (req,res) => {
  const userId = Number(req.params.id);
  const thisUser = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!thisUser) return res.redirect("/");

  const forms = getRequiredFormsForUser(userId);
  const userForms = db.prepare("SELECT * FROM formUploads WHERE user_id = ?").all(userId);

  return res.render("user-forms", { forms, userForms, thisUser });
});


app.get("/set-tuition", mustBeAdmin, (req,res) => {
  const corpsFees = db.prepare("SELECT * FROM tuitionFees WHERE ensemble = ?").get("corps")
  const independentFees = db.prepare("SELECT * FROM tuitionFees WHERE ensemble = ?").get("independent")
  const affiliateFees = db.prepare("SELECT * FROM tuitionFees WHERE ensemble = ?").get("affiliate")

  return res.render("set-tuition", {corpsFees, independentFees, affiliateFees})
})

app.post("/set-tuition", mustBeAdmin, (req, res) => {
  const corpsAmount       = Math.round(Number(req.body.corps || 0) * 100);
  const independentAmount = Math.round(Number(req.body.independent || 0) * 100);
  const corpsDeposit      = Math.round(Number(req.body.corps_deposit || 0) * 100);
  const independentDeposit= Math.round(Number(req.body.independent_deposit || 0) * 100);
  const affiliateAmount   = Math.round(Number(req.body.affiliate || 0) * 100);
  const affiliateDeposit  = Math.round(Number(req.body.affiliate_deposit || 0) * 100);

  db.prepare(
    "UPDATE tuitionFees SET amount = ?, deposit_amount = ? WHERE ensemble = ?"
  ).run(corpsAmount, corpsDeposit, "corps");

  db.prepare(
    "UPDATE tuitionFees SET amount = ?, deposit_amount = ? WHERE ensemble = ?"
  ).run(independentAmount, independentDeposit, "independent");

  db.prepare(
    "UPDATE tuitionFees SET amount = ?, deposit_amount = ? WHERE ensemble = ?"
  ).run(affiliateAmount, affiliateDeposit, "affiliate");

  req.session.flashMessage = "Tuition fees updated!";
  return res.redirect("/admin-portal");
});


app.get("/events-admin", mustBeAdmin, (req,res) => {
  const events = db.prepare("SELECT * FROM events ORDER BY datetime DESC").all();

  return res.render("edit-events", {events})
})

app.post('/add-event', imageUpload.single('image'), processImageJpg, (req, res) => {
  const {
    title,
    description,
    datetime,
    endtime,
    location,
    link = '',
    cost,
    type
  } = req.body;

  if (!req.savedFilename) {
    return res.status(500).send('Image processing failed');
  }

  const imageFilename = req.savedFilename;

  const insert = db.prepare(`
    INSERT INTO events (title, description, datetime, location, image, link, cost, type, endtime)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = insert.run(
    title,
    description,
    datetime,
    location,
    imageFilename,
    link,
    parseInt(cost),
    type,
    endtime
  );

  const eventId = result.lastInsertRowid;

  const slug = `${eventId}-${slugify(title)}`;
  db.prepare(`UPDATE events SET slug = ? WHERE id = ?`).run(slug, eventId);

  res.redirect('/events-admin');
});



app.get("/add-event", mustBeAdmin, (req,res) => {
  return res.render("add-event")
})

app.get("/change-email/:id", mustBeAdmin, (req,res) => {
  const userId = req.params.id;
  const getUserStatement = db.prepare("SELECT * FROM users WHERE id = ?")
  const thisUser = getUserStatement.get(userId);

  if(!thisUser){
    return res.redirect("/")
  }

  return res.render("change-email", {thisUser})
})

app.post("/change-email/:id", mustBeAdmin, (req,res) => {
  const userId = req.params.id;
  const getUserStatement = db.prepare("SELECT * FROM users WHERE id = ?")
  const thisUser = getUserStatement.get(userId);

  if(!thisUser){
    return res.redirect("/")
  }

  const emailExistsCheck = db.prepare("SELECT * FROM users WHERE email = ?")
  const EmailExists = emailExistsCheck.get(req.body.email)

  if(EmailExists){
    errors = ["Email already exists"]
    return res.render("change-email",{errors, thisUser})
  }

  const updateStatement = db.prepare("UPDATE users SET email = ? WHERE id = ?")
  updateStatement.run(req.body.email, userId);

  const html = `Hello ${thisUser.firstname},<br>
  Your email has been changed to this one you're using, ${thisUser.req.body.email}.`

  sendEmail(req.body.email,"Email Change", html)

  req.session.flashMessage = `Email updated for ${thisUser.firstname} to ${req.body.email}`
  return res.redirect("/edit-users")
})

app.get("/pay-history", mustBeAdmin, (req, res) => {
  const search = String(req.query.search || "").trim();
  let payments;

  if (search) {
    const like = `%${search}%`;
    payments = db.prepare(`
      SELECT p.*, u.firstname, u.lastname, u.email
      FROM paymentHistory p
      LEFT JOIN users u ON u.id = p.user_id
      WHERE p.title       LIKE ?
         OR p.description LIKE ?
         OR u.firstname   LIKE ?
         OR u.lastname    LIKE ?
         OR u.email       LIKE ?
      ORDER BY p.date DESC
    `).all(like, like, like, like, like);
  } else {
    payments = db.prepare(`
      SELECT p.*, u.firstname, u.lastname, u.email
      FROM paymentHistory p
      LEFT JOIN users u ON u.id = p.user_id
      ORDER BY p.date DESC
    `).all();
  }

  return res.render("payment-history", { payments, search });
});

app.get("/transaction-edit/:id", mustBeAdmin, (req,res) => {

  const userId = req.params.id;
  const getUserStatement = db.prepare("SELECT * FROM users WHERE id = ?")
  const thisUser = getUserStatement.get(userId);

  if(!thisUser){
    return res.redirect("/")
  }

  const getPayments = db.prepare("SELECT * FROM paymentHistory WHERE user_id = ? ORDER BY date DESC")
  const payments = getPayments.all(userId)

  return res.render("transaction-history",{payments, thisUser})
})

app.get("/edit-users", mustBeAdmin, (req, res) => {
  const search = String(req.query.search || "").trim();
  const filter = String(req.query.filter || "all").trim();       // section filter
  const membership = String(req.query.membership || "all").trim(); // corps/independent/all
  const sort = String(req.query.sort || "section").trim();       // newest | oldest | section
  const days = String(req.query.days || "all").trim();           // all | 30 | 60 | 90
  const page = Math.max(1, parseInt(req.query.page || "1", 10));

  const limit = 20;
  const offSet = (page - 1) * limit;

  // Build WHERE dynamically
  const where = [];
  const params = [];

  if (filter !== "all") {
    where.push("section = ?");
    params.push(filter);
  }

  if (search) {
    const nameSearch = buildUserNameSearchClause(search);
    if (nameSearch) {
      where.push(nameSearch.clause);
      params.push(...nameSearch.params);
    }
  }

  if (membership === "corps") {
    where.push("contractedCorps = 1");
  } else if (membership === "independent") {
    where.push("contractedIndependent = 1");
  } else if (membership === "affiliate") {
    where.push("contractedAffiliate = 1");
  }

  // Days filter — only include accounts created within the last N days
  if (["30", "60", "90"].includes(days)) {
    const cutoff = Date.now() - parseInt(days, 10) * 24 * 60 * 60 * 1000;
    where.push("(created_at IS NOT NULL AND created_at > ?)");
    params.push(cutoff);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  // Order based on sort param
  let orderSql;
  if (sort === "newest") {
    orderSql = "ORDER BY created_at DESC";
  } else if (sort === "oldest") {
    orderSql = "ORDER BY created_at ASC";
  } else if (filter !== "all") {
    orderSql = "ORDER BY lastname COLLATE NOCASE";
  } else {
    orderSql = "ORDER BY section, lastname COLLATE NOCASE";
  }

  // Fetch users
  const listSql = `
    SELECT *
    FROM users
    ${whereSql}
    ${orderSql}
    LIMIT ? OFFSET ?
  `;
  const users = db.prepare(listSql).all(...params, limit, offSet);

  // Count for pagination
    const countSql = `
    SELECT COUNT(*) AS total
    FROM users
    ${whereSql}
  `;
  const count = db.prepare(countSql).get(...params).total;
  const totalPages = Math.max(1, Math.ceil(count / limit));

  // (kept from your code) compute allForms flag
  const getRequiredForms = db.prepare("SELECT * FROM forms WHERE expire_date > ?");
  const forms = getRequiredForms.all(Date.now()); // fixed minor bug from Date().now

  // Pre-prepare contracts query
  const getContractsForUser = db.prepare(
    "SELECT id, season, ensemble, contracted_date, signedContractPath FROM contractedMembers WHERE user_id = ? ORDER BY contracted_date DESC"
  );

  // Compute allForms per user, and attach contracts
  users.forEach(thisUser => {
    const required = getRequiredFormsForUser(thisUser.id);
    const uploaded = db
      .prepare("SELECT document_id FROM formUploads WHERE user_id = ?")
      .all(thisUser.id);
    const missing = markUploadsAndCount(required, uploaded);
    thisUser.allForms = missing === 0 ? 1 : 0;

    // Attach contracts (if any)
    thisUser.contracts = getContractsForUser.all(thisUser.id);
  });

  res.render("edit-users", {
    users,
    search,
    filter,
    membership,
    sort,
    days,
    page,
    count,
    totalPages
  });
});

app.get("/staff/members", mustBeStaffOrAdmin, (req, res) => {
  const search = String(req.query.search || "").trim();
  const filter = String(req.query.filter || "all").trim(); // section filter
  const membership = String(req.query.membership || "all").trim(); // corps/independent/all

  const where = [];
  const params = [];

  // Only real members, not parents/admin/staff accounts
  where.push("(parent IS NULL OR parent = 0)");
  where.push("(admin IS NULL OR admin = 0)");
  where.push("(staff IS NULL OR staff = 0)");

  if (filter !== "all") {
    where.push("section = ?");
    params.push(filter);
  }

  if (search) {
    const nameSearch = buildUserNameSearchClause(search);
    if (nameSearch) {
      where.push(nameSearch.clause);
      params.push(...nameSearch.params);
    }
  }

  if (membership === "corps") {
    where.push("contractedCorps = 1");
  } else if (membership === "independent") {
    where.push("contractedIndependent = 1");
  } else if (membership === "affiliate") {
    where.push("contractedAffiliate = 1");
  }

  const whereSql = where.length ? ("WHERE " + where.join(" AND ")) : "";
  const sql = `
    SELECT id,
           firstname,
           lastname,
           email,
           section,
           contractedCorps,
           contractedIndependent,
           contractedAffiliate
    FROM users
    ${whereSql}
    ORDER BY lastname COLLATE NOCASE, firstname COLLATE NOCASE
  `;

  const members = db.prepare(sql).all(...params);

  return res.render("staff-members", {
    user: req.user,
    members,
    search,
    filter,
    membership
  });
});


app.get("/admin/contracts/:userId/:contractId", mustBeAdmin, (req, res) => {
  const userId = Number(req.params.userId);
  const contractId = Number(req.params.contractId);

  const row = db.prepare(
    `
    SELECT cm.*, u.firstname, u.lastname
    FROM contractedMembers cm
    JOIN users u ON cm.user_id = u.id
    WHERE cm.id = ? AND cm.user_id = ?
    `
  ).get(contractId, userId);

  if (!row || !row.signedContractPath) {
    return res.status(404).send("Contract not found.");
  }

  const filePath = path.join(__dirname, row.signedContractPath);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send("Contract file missing.");
  }

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="contract-${row.lastname}-${row.firstname}.pdf"`
  );

  fs.createReadStream(filePath).pipe(res);
});



app.get("/send-message/:id", mustBeAdmin, (req,res) => {
  const sendId = req.params.id;
  const getUserStatement = db.prepare("SELECT * FROM users WHERE id = ?")
  const thisUser = getUserStatement.get(sendId)

  if(!thisUser)
    return res.redirect("/")

  return res.render("send-message", {thisUser})
})

app.get("/shows/2025-the-animated", (req,res) => {
  const events = [
    { date: '2025-06-30', location: 'Kennewick, WA' },
    { date: '2025-07-02', location: 'Seattle, WA' },
    { date: '2025-07-03', location: 'Hillsboro, OR' },
    { date: '2025-07-05', location: 'Boise, ID' },
  ];

  // Attach coordinates to events
  events.forEach(event => {
    event.coords = coordinates[event.location];
  });

  const center = getGraphicCenter(events)


  return res.render("show-2025", {events ,center})
})

app.post("/send-message/:id", mustBeAdmin, (req,res) => {
  const sendId = req.params.id;
  const getUserStatement = db.prepare("SELECT * FROM users WHERE id = ?")
  const thisUser = getUserStatement.get(sendId)

  if(!thisUser)
    return res.redirect("/")

  sendEmail(thisUser.email, req.body.subject, req.body.message)

  req.session.flashMessage = `Email has been sent to ${thisUser.email}`
  return res.redirect("/edit-users")
})

app.get("/edit-section/:id", mustBeAdmin, (req,res) => {
  const sendId = req.params.id;
  const getUserStatement = db.prepare("SELECT * FROM users WHERE id = ?")
  const thisUser = getUserStatement.get(sendId)

  if(!thisUser)
    return res.redirect("/")

  if(thisUser.parent)
  {
    req.session.flashMessage = `${thisUser.firstname} is a parent. You can't edit their section.`
    return res.redirect(req.get('Referer'))
  }

  return res.render("edit-section", {thisUser})
})

app.post("/edit-section/:id", mustBeAdmin, (req,res) => {
  const sendId = req.params.id;
  const getUserStatement = db.prepare("SELECT * FROM users WHERE id = ?")
  const thisUser = getUserStatement.get(sendId)

  if(!thisUser)
    return res.redirect("/")

  const updateStatement = db.prepare("UPDATE users SET section = ?, instrument = ? WHERE id = ?")
  updateStatement.run(req.body.section,req.body.instrument,sendId);

  req.session.flashMessage = `Updated ${thisUser.firstname}'s section to ${req.body.section} and instrument/role to ${req.body.instrument}`
  return res.redirect("/edit-users")
})

app.get("/add-parent/:id", (req,res) => {

  const getParentIdStatement = db.prepare("SELECT * FROM childVerify WHERE code = ?")
  const verifyItem = getParentIdStatement.get(req.params.id);
  

  if(!verifyItem)
  {
    return res.redirect("/")
  }

  const verifyId = verifyItem.target_id;

  const parentId = verifyItem.user_id;

  if(!req.user)
  {
    return res.render("message", {message: "Please login first before adding a parent/guardian"})
  }

  if(req.user.userid != verifyId)
  {
    return res.redirect("/")
  }

  const updateStatement = db.prepare("UPDATE users SET parentId = ? WHERE id = ?")
  updateStatement.run(parentId, req.user.userid);

  const deleteStatement = db.prepare("DELETE FROM childVerify WHERE user_id = ?")
  deleteStatement.run(parentId);

  const parentStatement = db.prepare("SELECT * FROM users WHERE id = ?")
  const parent = parentStatement.get(parentId);

  return res.render("message", {message: `You have added ${parent.firstname} ${parent.lastname} as a parent/guardian.`})

})

app.get("/shows", (req,res) => {
  return res.render("shows")
})

app.get("/shows/2023-esto-perpetua", (req,res) => {
  const events = [
    { date: '2023-07-10', location: 'Kennewick, WA' },
    { date: '2023-07-11', location: 'Boise, ID' },
    { date: '2023-07-12', location: 'Salt Lake City, UT' },
  ];

  // Attach coordinates to events
  events.forEach(event => {
    event.coords = coordinates[event.location];
  });

  const center = getGraphicCenter(events)


  return res.render("show-2023", {events ,center})
})

app.get("/shows/2024-ghost-stallion", (req,res) => {
  const events = [
    { date: '2024-07-05', location: 'Hillsboro, OR' },
    { date: '2024-07-06', location: 'Seattle, WA' },
    { date: '2024-07-08', location: 'Kennewick, WA' },
    { date: '2024-07-09', location: 'Boise, ID' },
  ];

  // Attach coordinates to events
  events.forEach(event => {
    event.coords = coordinates[event.location];
  });

  const center = getGraphicCenter(events)


  return res.render("show-2024", {events ,center})
})

app.get("/update-emergency", mustBeLoggedIn, (req,res) => {
  const getEmergencyStatement = db.prepare("SELECT * FROM emergencyContacts WHERE user_id = ?")
  const emergencyContacts = getEmergencyStatement.all(req.user.userid)

  return res.render("update-emergency", {emergencyContacts})
})

app.post('/update-emergency', mustBeLoggedIn, (req, res) => {
    const userId = parseInt(req.user.userid);
    const contacts = req.body.contacts; // This is an object keyed by ID

    const insertStmt = db.prepare(`
        INSERT INTO emergencyContacts (name, phone, email, user_id)
        VALUES (?, ?, ?, ?)
    `);

    const updateStmt = db.prepare(`
        UPDATE emergencyContacts
        SET name = ?, phone = ?, email = ?
        WHERE id = ? AND user_id = ?
    `);

    const userContacts = Object.values(contacts); // each one has id, name, phone, email

    for (const contact of userContacts) {
        const { id, name, phone, email } = contact;

        if (parseInt(id) === -1) {
            // New contact
            insertStmt.run(name, phone, email, userId);
        } else {
            // Existing contact
            updateStmt.run(name, phone, email, id, userId);
        }
    }

    res.redirect('/member-portal'); // or another success page
});


// Member requests a parent/guardian invite by entering their parent's email
app.post('/member-portal/request-parent-invite', mustBeMember, (req, res) => {
  const parentEmailRaw = String(req.body.parentEmail || '').trim().toLowerCase();
  if (!parentEmailRaw) {
    req.session.flashMessage = 'Please provide a parent/guardian email.';
    return res.redirect('/member-portal');
  }
  // Do NOT generate any claim codes or create childVerify records here.
  // Instead, simply notify the parent that they should register or login
  // and then use the Parent Portal "Add Member" flow to add/claim the child.

  const html = `
    Hello,

    <p>${req.user.firstname} ${req.user.lastname} has entered your email as their parent/guardian on the Boise Gems website.</p>
    <p>Please register as a parent/guardian account at <a href="${process.env.BASEURL}/register-parent">${process.env.BASEURL}/register-parent</a> or login if you already have an account.</p>
    <p>After logging in as a parent/guardian, go to your Parent Portal and use "Add Member" to add your child by their email address. That process will send a confirmation to the child so they can approve the connection.</p>
  `;

  sendEmail(parentEmailRaw, 'Please register/login to claim your child on Boise Gems', html);
  req.session.flashMessage = `An email has been sent to ${parentEmailRaw} instructing them to register or login and then add you via the Parent Portal.`;
  return res.redirect('/member-portal');
});


// Parent (or newly-registered parent) clicks link to claim child
app.get('/claim-child/:code', mustBeLoggedIn, (req, res) => {
  // Keep compatibility: if someone visits the claim link while logged in,
  // allow claiming (same behavior as the POST flow). This route is less
  // commonly used since emails no longer include direct links.
  const getVerify = db.prepare('SELECT * FROM childVerify WHERE code = ?').get(req.params.code);
  if (!getVerify) {
    return res.render('message', { message: 'Invalid or expired claim code.' });
  }

  if (getVerify.user_id && getVerify.user_id !== req.user.userid) {
    return res.render('message', { message: 'This claim code was sent to a different account. Please use the account that received the email.' });
  }

  const updateStmt = db.prepare('UPDATE users SET parentId = ? WHERE id = ?');
  updateStmt.run(req.user.userid, getVerify.target_id);

  const deleteStmt = db.prepare('DELETE FROM childVerify WHERE target_id = ?');
  deleteStmt.run(getVerify.target_id);

  return res.render('message', { message: 'You have successfully claimed this child as your own. Thank you!' });
});

// Claim child form (parent registers/logs-in first, then uses this form)
app.get('/claim-child', mustBeLoggedIn, (req, res) => {
  return res.render('claim-child');
});

app.post('/claim-child', mustBeLoggedIn, (req, res) => {
  const code = String(req.body.code || '').trim();
  if (!code) {
    req.session.flashMessage = 'Please enter a claim code.';
    return res.redirect('/claim-child');
  }

  const getVerify = db.prepare('SELECT * FROM childVerify WHERE code = ?').get(code);
  if (!getVerify) {
    return res.render('message', { message: 'Invalid or expired claim code.' });
  }

  if (getVerify.user_id && getVerify.user_id !== req.user.userid) {
    return res.render('message', { message: 'This claim code was sent to a different account. Please use the account that received the email.' });
  }

  const updateStmt = db.prepare('UPDATE users SET parentId = ? WHERE id = ?');
  updateStmt.run(req.user.userid, getVerify.target_id);

  const deleteStmt = db.prepare('DELETE FROM childVerify WHERE target_id = ?');
  deleteStmt.run(getVerify.target_id);

  return res.render('message', { message: 'You have successfully claimed this child as your own. Thank you!' });
});

app.post("/add-member", mustBeParent, (req,res) => {
  errors = [];
  const email = req.body.email;

  const getPreviousAttempt = db.prepare("SELECT * FROM childVerify WHERE user_id = ?")
  const previousAttempt = getPreviousAttempt.get(req.user.userid)

  if(previousAttempt)
  {
    const deleteStatement = db.prepare("DELETE FROM childVerify WHERE user_id = ?")
    deleteStatement.run(req.user.userid)
  }

  const userStatement = db.prepare("SELECT * FROM users WHERE email = ?")
  const user = userStatement.get(email)

  if(!user)
  {
    errors.push("Email does not exist. Make sure your child has registered an account.")
    return res.render("add-member", {errors})
  }

  if(user.id == req.user.userid)
  {
    errors.push("Cannot use your own email.")
  }

  if(errors.length > 0){
    return res.render("add-member", {errors})
  }

  const salt = bcrypt.genSaltSync(10)
  const emailsecret = bcrypt.hashSync(req.user.lastname + Date.now().toString(), salt).replace(/[^a-zA-Z0-9]/g, '')

  const verifyEmailStatment = db.prepare("INSERT INTO childVerify (code , user_id, target_id) VALUES (? , ? , ?)")
  verifyEmailStatment.run(emailsecret, req.user.userid, user.id);

  const html = `
    Hello ${user.firstname},

    ${req.user.firstname} ${req.user.lastname} has request to be your parent/guardian. Please click the button below to set them as your parent/guardian.
    <br/>
    <p style="text-align: center; margin: 32px 0;">
                <a href="${process.env.BASEURL}/add-parent/${emailsecret}" target="_blank" style="background-color: #9D76BB; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 4px; font-weight: bold; display: inline-block;">
                  Add Parent/Guardian
                </a>
              </p>
    <br/>
    If the button above isn't working, please click here: <a href="${process.env.BASEURL}/add-parent/${emailsecret}">${process.env.BASEURL}/add-parent/${emailsecret}</a>
  `

  sendEmail(email,"Request to add Parent/Guardian", html)

  return res.render("message",{message: `An email has been sent to ${email} to confirm that you're their parent/guardian. Have them check their email.`})
})

app.get("/parent-portal", mustBeParent, (req, res) => {
  const member = db
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(req.user.userid);
  const children = db
    .prepare("SELECT * FROM users WHERE parentId = ?")
    .all(req.user.userid);

  // Pre-calc child IDs for contract extension lookup
  const childIds = children.map((c) => c.id);
  let contractsByChild = {};

  if (childIds.length) {
    const placeholders = childIds.map(() => "?").join(",");
    const rows = db
      .prepare(
        `
        SELECT
          ce.*,
          u.firstname AS childFirst,
          u.lastname  AS childLast
        FROM contractExtension ce
        JOIN users u
          ON u.id = COALESCE(ce.child_id, ce.user_id)
        WHERE ce.user_id = ?
          AND COALESCE(ce.child_id, ce.user_id) IN (${placeholders})
        `
      )
      .all(req.user.userid, ...childIds);

    contractsByChild = rows.reduce((acc, row) => {
      const key = row.child_id || row.user_id;
      if (!acc[key]) acc[key] = [];
      acc[key] = acc[key] || [];
      acc[key].push(row);
      return acc;
    }, {});
  }

  children.forEach((child) => {
    // minor flag (kept)
    if (child.birthday) {
      const birthday = new Date(child.birthday);
      const today = new Date();
      let age = today.getFullYear() - birthday.getFullYear();
      const hadBDay =
        today.getMonth() > birthday.getMonth() ||
        (today.getMonth() === birthday.getMonth() &&
          today.getDate() >= birthday.getDate());
      if (!hadBDay) age--;
      child.minor = age < 18;
    }

    // child-specific required forms
    const reqForms = getRequiredFormsForUser(child.id);
    const uploaded = db
      .prepare("SELECT document_id FROM formUploads WHERE user_id = ?")
      .all(child.id);
    child.leftoverForms = markUploadsAndCount(reqForms, uploaded);

    // NEW: contract extensions for this child (if any)
    child.contractExtensions = contractsByChild[child.id] || [];
  });

  return res.render("parent-portal", { member, children });
});



app.get("/add-transaction/:id", mustBeAdmin, (req,res) => {
  const getUserStatement = db.prepare("SELECT * FROM users WHERE id = ?")
  const thisUser = getUserStatement.get(req.params.id)

  if(!thisUser){
    req.session.flashMessage = "User doesn't exist."
    return res.redirect("/admin-portal")
  }

  return res.render("add-transaction", {thisUser})
})

app.post("/add-transaction/:id", mustBeAdmin, (req,res) => {
  const getChildStatement = db.prepare("SELECT * FROM users WHERE id = ?")
  const child = getChildStatement.get(req.params.id);

  if(!child)
  {
    return res.redirect("/admin-portal")
  }

  

  const paid = req.body.payment * 100;
  
  // Always add the payment to the paid amount
  const alreadyPaid = Number(child.paid) + paid;
  
  // If "Pay Towards Balance" is checked, also reduce what they owe
  if(req.body.tuition)
  {
    const left = Number(child.owed) - paid;
    const updateStatement = db.prepare("UPDATE users SET paid = ?, owed = ? WHERE id = ?")
    updateStatement.run(alreadyPaid, left, req.params.id)
  } else {
    // Only update paid amount, don't touch owed
    const updateStatement = db.prepare("UPDATE users SET paid = ? WHERE id = ?")
    updateStatement.run(alreadyPaid, req.params.id)
  }

  const paidString = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(paid / 100);

  const addPaymentStatement = db.prepare("INSERT INTO paymentHistory (title, description, amount, method, date, user_id) VALUES (? , ? , ? , ? , ? , ?)")
  addPaymentStatement.run(req.body.title,req.body.description, paid,req.body.method, Date.now(), child.id)


  return res.redirect(`/transaction-edit/${child.id}`)
})

app.post("/add-charge/:id", mustBeAdmin, (req, res) => {
  const getUserStatement = db.prepare("SELECT * FROM users WHERE id = ?");
  const user = getUserStatement.get(req.params.id);

  if (!user) {
    req.session.flashMessage = "User doesn't exist.";
    return res.redirect("/admin-portal");
  }

  const rawAmount = Number(req.body.amount || 0);
  const amountCents = Math.round(rawAmount * 100);

  if (!amountCents || amountCents <= 0) {
    req.session.flashMessage = "Please enter a valid charge amount.";
    return res.redirect(`/add-transaction/${user.id}#add-charge`);
  }

  const title = String(req.body.title || "").trim() || "Additional charge";
  const description =
    String(req.body.description || "").trim() ||
    "Manual charge added by admin.";

  // Increase how much they owe
  const newOwed = Number(user.owed || 0) + amountCents;
  const updateUser = db.prepare("UPDATE users SET owed = ? WHERE id = ?");
  updateUser.run(newOwed, user.id);

  // Log in paymentHistory as a "Charge"
  const insertHistory = db.prepare(
    "INSERT INTO paymentHistory (title, description, amount, method, date, user_id) VALUES (? , ? , ? , ? , ? , ?)"
  );
  insertHistory.run(
    title,
    description,
    amountCents,
    "Charge",
    Date.now(),
    user.id
  );

  req.session.flashMessage = "Charge added to account.";
  return res.redirect(`/transaction-edit/${user.id}`);
});

app.get("/pay-behalf/:id", mustBeParent, (req,res) => {
  //Check if child is yours
  const getChildStatement = db.prepare("SELECT * FROM users WHERE id = ? AND parentId = ?")
  const child = getChildStatement.get(req.params.id,req.user.userid);

  if(!child)
  {
    return res.redirect("/parent-portal")
  }

  return res.render("pay-child", {child})
})

app.get("/edit-forms",mustBeAdmin, (req,res) => {

  const getFormsStatement = db.prepare("SELECT * FROM forms ORDER BY id DESC")
  const forms = getFormsStatement.all()

  return res.render("edit-forms",{forms})
})

app.get("/edit-form/:id", mustBeAdmin, (req, res) => {
  const form = db.prepare("SELECT * FROM forms WHERE id = ?").get(req.params.id);
  if (!form) {
    req.session.flashMessage = "Form not found.";
    return res.redirect("/edit-forms");
  }
  return res.render("edit-form-single", { form });
});

app.post(
  "/edit-form/:id",
  mustBeAdmin,
  pdfUpload.single("document_path"),
  (req, res) => {
    const formId = Number(req.params.id);
    const existing = db
      .prepare("SELECT * FROM forms WHERE id = ?")
      .get(formId);

    if (!existing) {
      req.session.flashMessage = "Form not found.";
      return res.redirect("/edit-forms");
    }

    const title       = String(req.body.title || "").trim();
    const description = String(req.body.description || "").trim();
    const expire_date = req.body.expire_date
      ? new Date(req.body.expire_date).getTime()
      : null;
    const due_date    = req.body.due_date
      ? new Date(req.body.due_date).getTime()
      : null;
    const content     = String(req.body.content || "").trim();

    let ensemble_type = String(req.body.ensemble_type || "all").trim().toLowerCase();
    if (!["all", "corps", "independent", "affiliate"].includes(ensemble_type)) {
      ensemble_type = "all";
    }

    let contracted =
      ensemble_type === "corps" || ensemble_type === "independent" || ensemble_type === "affiliate"
        ? 1
        : req.body.contracted
        ? 1
        : 0;

    let role_scope = String(
      req.body.role_scope || existing.role_scope || "member"
    )
      .trim()
      .toLowerCase();
    if (!["member", "staff", "admin"].includes(role_scope)) {
      role_scope = "member";
    }

    // keep old pdf unless a new one is uploaded
    let document_path = existing.document_path;
    if (req.file) {
      if (
        document_path &&
        document_path.startsWith("/pdf/publicpdf/")
      ) {
        const oldFsPath = path.join(
          __dirname,
          "public",
          "pdf",
          "publicpdf",
          path.basename(document_path)
        );
        try {
          if (fs.existsSync(oldFsPath)) fs.unlinkSync(oldFsPath);
        } catch (err) {
          console.error("Failed to delete old form pdf:", err);
        }
      }
      document_path = `/pdf/publicpdf/${req.file.filename}`;
    }

    db.prepare(
      `
      UPDATE forms
         SET title = ?,
             description = ?,
             document_path = ?,
             upload = ?,
             content = ?,
             expire_date = ?,
             due_date = ?,
             ensemble_type = ?,
             contracted = ?,
             role_scope = ?
       WHERE id = ?
    `
    ).run(
      title,
      description,
      document_path,
      req.body.upload ? 1 : 0,
      content,
      expire_date,
      due_date,
      ensemble_type,
      contracted,
      role_scope,
      formId
    );

    req.session.flashMessage = "Form updated.";
    return res.redirect("/edit-forms");
  }
);

app.post("/add-form", mustBeAdmin, pdfUpload.single('document_path'), (req, res) => {
  const title        = String(req.body.title || "").trim();
  const description  = String(req.body.description || "").trim();
  const expire_date  = new Date(req.body.expire_date).getTime();
  const due_date     = new Date(req.body.due_date).getTime();
  const content      = String(req.body.content || "").trim();

    let role_scope = String(req.body.role_scope || "member").trim().toLowerCase();
  if (!["member", "staff", "admin"].includes(role_scope)) {
    role_scope = "member";
  }

  // NEW: ensemble_type & contracted (coerced)
  let ensemble_type  = String(req.body.ensemble_type || "all").trim().toLowerCase();
  if (!["all", "corps", "independent", "affiliate"].includes(ensemble_type)) ensemble_type = "all";

  // If ensemble_type is corps/independent/affiliate => contracted must be 1, else honor the checkbox
  let contracted = (ensemble_type === "corps" || ensemble_type === "independent" || ensemble_type === "affiliate")
    ? 1
    : (req.body.contracted ? 1 : 0);

  // Optional: let triggers normalize later, but we still write clearly here
  const filePath = req.file ? `/pdf/publicpdf/${req.file.filename}` : null;

    const addForm = db.prepare(`
    INSERT INTO forms (
      title,
      description,
      document_path,
      upload,
      content,
      expire_date,
      season,
      due_date,
      ensemble_type,
      contracted,
      role_scope
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  addForm.run(
    title,
    description,
    filePath,
    req.body.upload ? 1 : 0,
    content,
    expire_date || null,
    req.body.season || null,
    due_date || null,
    ensemble_type,
    contracted,
    role_scope
  );

  req.session.flashMessage = "Form added";
  return res.redirect("/edit-forms");
});

app.get("/instruments/:id", mustBeAdmin, (req, res) => {
  const userId = Number(req.params.id);
  const getUserStatement = db.prepare("SELECT * FROM users WHERE id = ?");
  const thisUser = getUserStatement.get(userId);

  if (!thisUser) return res.redirect("/edit-users");

  const instruments = db.prepare(`
    SELECT *
    FROM instruments
    WHERE user_id = ?
    ORDER BY checked_out_date DESC, id DESC
  `).all(userId);

  return res.render("instruments", { thisUser, instruments });
});

app.post("/instruments/:id/add", mustBeAdmin, (req, res) => {
  const userId = Number(req.params.id);
  const getUserStatement = db.prepare("SELECT * FROM users WHERE id = ?");
  const thisUser = getUserStatement.get(userId);

  if (!thisUser) return res.redirect("/edit-users");

  const instrument_type = String(req.body.instrument_type || "").trim();
  const model           = String(req.body.model || "").trim();
  const serial          = String(req.body.serial || "").trim();

  if (!instrument_type) {
    req.session.flashMessage = "Instrument type is required.";
    return res.redirect(`/instruments/${userId}`);
  }

  const checked_out_date = Date.now();

  db.prepare(`
    INSERT INTO instruments (user_id, instrument_type, model, serial, checked_out_date, checked_in_date)
    VALUES (?, ?, ?, ?, ?, NULL)
  `).run(userId, instrument_type, model, serial, checked_out_date);

  req.session.flashMessage = "Instrument checkout recorded.";
  return res.redirect(`/instruments/${userId}`);
});

app.post("/instruments/:id/checkin/:instId", mustBeAdmin, (req, res) => {
  const userId = Number(req.params.id);
  const instId = Number(req.params.instId);

  db.prepare(
    "UPDATE instruments SET checked_in_date = ? WHERE id = ? AND user_id = ?"
  ).run(Date.now(), instId, userId);

  req.session.flashMessage = "Instrument checked in.";
  return res.redirect(`/instruments/${userId}`);
});

// ── Admin Instrument Checkout Hub ──────────────────────────────────────

// JSON user search for the checkout form
app.get("/admin/users/search", mustBeAdmin, (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q || q.length < 2) return res.json([]);
  const nameSearch = buildUserNameSearchClause(q);
  if (!nameSearch) return res.json([]);
  const users = db.prepare(`
    SELECT id, firstname, lastname, section
    FROM users
    WHERE ${nameSearch.clause}
      AND (parent IS NULL OR parent = 0)
    ORDER BY lastname COLLATE NOCASE ASC, firstname COLLATE NOCASE ASC
    LIMIT 15
  `).all(...nameSearch.params);
  return res.json(users);
});

app.get("/admin/instrument-checkout", mustBeAdmin, (req, res) => {
  const checkedOut = db.prepare(`
    SELECT i.*, u.firstname, u.lastname, u.section
    FROM instruments i
    JOIN users u ON u.id = i.user_id
    WHERE i.checked_in_date IS NULL
    ORDER BY i.checked_out_date DESC
  `).all();

  return res.render("admin-instrument-checkout", { checkedOut });
});

app.post("/admin/instrument-checkout/add", mustBeAdmin, (req, res) => {
  const userId = Number(req.body.user_id);
  if (!userId) {
    req.session.flashMessage = "Please select a member.";
    return res.redirect("/admin/instrument-checkout");
  }

  const userExists = db.prepare("SELECT id FROM users WHERE id = ?").get(userId);
  if (!userExists) {
    req.session.flashMessage = "Member not found.";
    return res.redirect("/admin/instrument-checkout");
  }

  const instrument_type = String(req.body.instrument_type || "").trim();
  const model           = String(req.body.model || "").trim();
  const serial          = String(req.body.serial || "").trim();

  if (!instrument_type) {
    req.session.flashMessage = "Instrument type is required.";
    return res.redirect("/admin/instrument-checkout");
  }

  db.prepare(`
    INSERT INTO instruments (user_id, instrument_type, model, serial, checked_out_date, checked_in_date)
    VALUES (?, ?, ?, ?, ?, NULL)
  `).run(userId, instrument_type, model, serial, Date.now());

  req.session.flashMessage = "Instrument checked out successfully.";
  return res.redirect("/admin/instrument-checkout");
});

app.post("/admin/instrument-checkout/checkin/:instId", mustBeAdmin, (req, res) => {
  const instId = Number(req.params.instId);
  db.prepare("UPDATE instruments SET checked_in_date = ? WHERE id = ?").run(Date.now(), instId);
  req.session.flashMessage = "Instrument checked in.";
  return res.redirect("/admin/instrument-checkout");
});

app.get("/admin/instrument-history", mustBeAdmin, (req, res) => {
  const search = String(req.query.search || "").trim();
  const status = String(req.query.status || "all").trim(); // all | out | in

  const where = [];
  const params = [];

  if (search) {
    where.push("(u.firstname LIKE ? OR u.lastname LIKE ? OR i.instrument_type LIKE ? OR i.serial LIKE ?)");
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (status === "out") {
    where.push("i.checked_in_date IS NULL");
  } else if (status === "in") {
    where.push("i.checked_in_date IS NOT NULL");
  }

  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";

  const records = db.prepare(`
    SELECT i.*, u.firstname, u.lastname, u.section
    FROM instruments i
    JOIN users u ON u.id = i.user_id
    ${whereSql}
    ORDER BY i.checked_out_date DESC
  `).all(...params);

  return res.render("admin-instrument-history", { records, search, status });
});

app.get("/email-members", mustBeAdmin, (req, res) => {
  res.render("email-members");
});

app.post("/email-members/preview", mustBeAdmin, (req, res) => {
  const subject = String(req.body.subject || "").trim();
  const message = String(req.body.message || "").trim();
  const section = String(req.body.section || "all").trim();
  const membership = String(req.body.membership || "all").trim();
  // "none" | "all" | "corps" | "independent" | "affiliate"
  const extensionMode = String(req.body.extensionMode || "none")
    .trim()
    .toLowerCase();

  if (!subject || !message) {
    return res
      .status(400)
      .json({ ok: false, error: "Subject and message are required." });
  }

  let recipients = [];

  if (extensionMode !== "none") {
    // ðŸ”¹ EXACT SAME FILTER AS /email-members (bulk send) for contractExtension
    const now = Date.now();
    const where = ["ce.due_date IS NOT NULL", "ce.due_date >= ?"];
    const params = [now];

    // Current season only (handles "2026corps"/"2026independent" strings)
    where.push("CAST(SUBSTR(ce.season, 1, 4) AS INTEGER) = ?");
    params.push(CURRENTSEASON);

    // Filter by corps vs independent vs affiliate extension
    if (extensionMode === "corps") {
      where.push("LOWER(ce.season) LIKE ?");
      params.push("%corps%");
    } else if (extensionMode === "independent") {
      where.push("LOWER(ce.season) LIKE ?");
      params.push("%independent%");
    } else if (extensionMode === "affiliate") {
      where.push("LOWER(ce.season) LIKE ?");
      params.push("%affiliate%");
    }

    // Optional section filter (Brass, Guard, etc.)
    if (section !== "all") {
      where.push("u.section = ?");
      params.push(section);
    }

    const rows = db
      .prepare(
        `
        SELECT
          u.email,
          u.firstname,
          u.lastname
        FROM contractExtension ce
        JOIN users u
          ON u.id = ce.user_id
        WHERE ${where.join(" AND ")}
      `
      )
      .all(...params);

    recipients = rows
      .filter((r) => r.email && String(r.email).trim() !== "")
      .map((r) => ({
        email: String(r.email).trim(),
        name: `${r.firstname || ""} ${r.lastname || ""}`.trim(),
      }));
  } else {
    // ðŸ”¹ Normal members list (no contract-extension filter)
    const where = [];
    const params = [];

    if (section !== "all") {
      where.push("section = ?");
      params.push(section);
    }

    if (membership === "corps") {
      where.push("contractedCorps = 1");
    } else if (membership === "independent") {
      where.push("contractedIndependent = 1");
    } else if (membership === "affiliate") {
      where.push("contractedAffiliate = 1");
    }

    where.push("email IS NOT NULL AND TRIM(email) <> ''");

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const rows = db
      .prepare(
        `
        SELECT email, firstname, lastname
        FROM users
        ${whereSql}
      `
      )
      .all(...params);

    recipients = rows
      .filter((r) => r.email && String(r.email).trim() !== "")
      .map((r) => ({
        email: String(r.email).trim(),
        name: `${r.firstname || ""} ${r.lastname || ""}`.trim(),
      }));
  }

  // âœ… Preview just returns the list; no email sent here
  return res.json({ ok: true, recipients });
});

app.post("/email-members/send-one", mustBeAdmin, async (req, res) => {
  const email = String(req.body.email || "").trim();
  const subject = String(req.body.subject || "").trim();
  const message = String(req.body.message || "").trim();

  if (!email || !subject || !message) {
    return res
      .status(400)
      .json({ ok: false, error: "Missing email, subject, or message." });
  }

  try {
    await sendEmail(email, subject, message);
    return res.json({ ok: true });
  } catch (err) {
    console.error("Bulk email send-one error", err);
    return res
      .status(500)
      .json({ ok: false, error: "Failed to send email." });
  }
});

app.post("/email-members", mustBeAdmin, (req, res) => {
  const subject = String(req.body.subject || "").trim();
  const message = String(req.body.message || "").trim();
  const section = String(req.body.section || "all").trim();
  const membership = String(req.body.membership || "all").trim();
  // NEW: extensionMode here too so the non-JS fallback respects it
  const extensionMode = String(req.body.extensionMode || "none").trim().toLowerCase();

  if (!subject || !message) {
    req.session.flashMessage = "Subject and message are required.";
    return res.redirect("/email-members");
  }

  let sentCount = 0;

  if (extensionMode !== "none") {
    const now = Date.now();
    const where = ["ce.due_date IS NOT NULL", "ce.due_date >= ?"];
    const params = [now];

    where.push("CAST(SUBSTR(ce.season, 1, 4) AS INTEGER) = ?");
    params.push(CURRENTSEASON);

    if (extensionMode === "corps") {
      where.push("LOWER(ce.season) LIKE ?");
      params.push("%corps%");
    } else if (extensionMode === "independent") {
      where.push("LOWER(ce.season) LIKE ?");
      params.push("%independent%");
    } else if (extensionMode === "affiliate") {
      where.push("LOWER(ce.season) LIKE ?");
      params.push("%affiliate%");
    }

    if (section !== "all") {
      where.push("u.section = ?");
      params.push(section);
    }

    const rows = db
      .prepare(
        `
        SELECT
          u.email,
          u.firstname,
          u.lastname
        FROM contractExtension ce
        JOIN users u
          ON u.id = ce.user_id
        WHERE ${where.join(" AND ")}
      `
      )
      .all(...params);

    rows.forEach((row) => {
      if (!row.email) return;
      sendEmail(row.email, subject, message);
      sentCount++;
    });
  } else {
    const where = [];
    const params = [];

    if (section !== "all") {
      where.push("section = ?");
      params.push(section);
    }

    if (membership === "corps") {
      where.push("contractedCorps = 1");
    } else if (membership === "independent") {
      where.push("contractedIndependent = 1");
    } else if (membership === "affiliate") {
      where.push("contractedAffiliate = 1");
    }

    where.push("email IS NOT NULL AND TRIM(email) <> ''");

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const rows = db
      .prepare(
        `
        SELECT email, firstname, lastname
        FROM users
        ${whereSql}
      `
      )
      .all(...params);

    rows.forEach((row) => {
      if (!row.email) return;
      sendEmail(row.email, subject, message);
      sentCount++;
    });
  }

  req.session.flashMessage = `Bulk email sent to ${sentCount} recipient(s).`;
  return res.redirect("/admin-portal");
});

app.get("/delete-form/:id", mustBeAdmin, (req,res) => {
  const formId = req.params.id;

  const uploadDeleteStatement = db.prepare("DELETE FROM formUploads WHERE document_id = ?")
  uploadDeleteStatement.run(formId);

  const deleteStatement = db.prepare("DELETE FROM forms WHERE id = ?")
  deleteStatement.run(formId);

  req.session.flashMessage="Form deleted";
  return res.redirect("/edit-forms")
})

app.get("/add-form", mustBeAdmin, (req,res) => {
  return res.render("add-form")
})

app.post("/pay-behalf/:id", mustBeParent, (req, res) => {
  const getChildStatement = db.prepare(
    "SELECT * FROM users WHERE id = ? AND parentId = ?"
  );
  const child = getChildStatement.get(req.params.id, req.user.userid);

  if (!child) {
    return res.redirect("/parent-portal");
  }

  const tuitionAmount = Number(req.body.payment) * 100; // pennies (base tuition payment)
  const processingFee = Math.round(tuitionAmount * 0.06); // 5% processing fee
  const totalCharge = tuitionAmount + processingFee;      // Stripe total

  // Save the potential payment (store tuition and processing fee separately)
  const insertPotential = db.prepare(
    "INSERT INTO potential_payment (child_id, parent_id, amount, processing_fee, created_at) VALUES (?, ?, ?, ?, ?)"
  );
  const result = insertPotential.run(
    child.id,
    req.user.userid,
    tuitionAmount,
    processingFee,
    Date.now()
  );

  const potentialPaymentId = result.lastInsertRowid;

  // Create a Stripe Checkout Session
  stripe.checkout.sessions
    .create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "Payment for a child's tuition/fees for The Boise Gems Drum & Bugle Corps.",
            },
            unit_amount: totalCharge,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${process.env.BASEURL}/pay-behalf/success/${potentialPaymentId}`,
      cancel_url: `${process.env.BASEURL}/pay-behalf/${child.id}`,
    })
    .then((session) => {
      res.redirect(303, session.url);
    })
    .catch((err) => {
      console.error("Stripe session error:", err);
      res.redirect("/parent-portal");
    });
});

// Success route â€” finalize payment
app.get("/pay-behalf/success/:potentialId", mustBeParent, (req, res) => {
  const getPotential = db.prepare(
    "SELECT * FROM potential_payment WHERE id = ? AND parent_id = ?"
  );
  const potential = getPotential.get(req.params.potentialId, req.user.userid);

  if (!potential) {
    return res.redirect("/parent-portal");
  }

  const getChild = db.prepare("SELECT * FROM users WHERE id = ?");
  const child = getChild.get(potential.child_id);

  if (!child) {
    return res.redirect("/parent-portal");
  }

  const paid = potential.amount; // pennies
  const alreadyPaid = Number(child.paid) + paid;
  const left = Number(child.owed) - paid;

  const updateStatement = db.prepare(
    "UPDATE users SET paid = ?, owed = ? WHERE id = ?"
  );
  updateStatement.run(alreadyPaid, left, child.id);

  const paidString = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(paid / 100);

  addChrisShare(paid, `Parent ${req.user.firstname} ${req.user.lastname} paid for their child, ${child.firstname} ${child.lastname} with an amount of ${paidString}.`);

  const addPaymentStatement = db.prepare(
    "INSERT INTO paymentHistory (title, description, amount, method, date, user_id) VALUES (? , ? , ? , ? , ? , ?)"
  );
  addPaymentStatement.run(
    `Payment for ${child.firstname} ${child.lastname} by parent, ${req.user.firstname} ${req.user.lastname}`,
    `Parent ${req.user.firstname} ${req.user.lastname} paid for their child, ${child.firstname} ${child.lastname} with an amount of ${paidString}.`,
    paid,
    "Stripe",
    Date.now(),
    child.id
  );

  // Delete potential payment entry (to prevent reuse)
  const deletePotential = db.prepare("DELETE FROM potential_payment WHERE id = ?");
  deletePotential.run(req.params.potentialId);

  // Send emails
  const emailBody = `
    <h1 style="text-align: center;">Payment Received!</h1>
    <br/>
    <p>
      We have received a payment from ${req.user.firstname} ${req.user.lastname} for 
      ${child.firstname} ${child.lastname}'s tuition. The amount paid was ${paidString}, 
      being paid through Stripe on 
      ${new Date(Date.now()).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })}
    </p>
  `;

  sendEmail(req.user.email, "Payment Received!", emailBody);
  sendEmail(MasterEmail, "Payment Received!", emailBody);

  return res.redirect("/payment-received");
});

app.get("/payment-received", (req,res) => {
  return res.render("payment-received")
})

app.get("/make-payment", mustBeMember, (req,res) => {
  const getUserStatement = db.prepare(
    "SELECT * FROM users WHERE id = ?"
  );
  const member = getUserStatement.get(req.user.userid);

  if (!member) {
    return res.redirect("/parent-portal");
  }

  return res.render("make-payment", {member})
})

// User making their own payment
app.post("/make-payment", mustBeLoggedIn, (req, res) => {
  const getUserStatement = db.prepare("SELECT * FROM users WHERE id = ?");
  const user = getUserStatement.get(req.user.userid);

  if (!user || user.id !== req.user.userid) {
    // prevent paying for someone else
    return res.redirect("/dashboard");
  }

  const tuitionAmount = Number(req.body.payment) * 100; // pennies (base tuition payment)
  const processingFee = Math.round(tuitionAmount * 0.06); // 5% processing fee
  const totalCharge = tuitionAmount + processingFee;

  // Save the potential payment
  const insertPotential = db.prepare(
    "INSERT INTO potential_payment (user_id, amount, processing_fee, created_at) VALUES (?, ?, ?, ?)"
  );
  const result = insertPotential.run(user.id, tuitionAmount, processingFee, Date.now());
  const potentialPaymentId = result.lastInsertRowid;

  // Create a Stripe Checkout Session
  stripe.checkout.sessions
    .create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "Payment for tuition/fees for The Boise Gems Drum & Bugle Corps.",
            },
            unit_amount: totalCharge,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${process.env.BASEURL}/make-payment/success/${potentialPaymentId}`,
      cancel_url: `${process.env.BASEURL}/make-payment`,
    })
    .then((session) => {
      res.redirect(303, session.url);
    })
    .catch((err) => {
      console.error("Stripe session error:", err);
      res.redirect("/dashboard");
    });
});


// Success route â€” finalize payment for the user
app.get("/make-payment/success/:potentialId", mustBeLoggedIn, (req, res) => {
  const getPotential = db.prepare(
    "SELECT * FROM potential_payment WHERE id = ? AND user_id = ?"
  );
  const potential = getPotential.get(req.params.potentialId, req.user.userid);

  if (!potential) {
    return res.redirect("/dashboard");
  }

  const getUser = db.prepare("SELECT * FROM users WHERE id = ?");
  const user = getUser.get(potential.user_id);

  if (!user) {
    return res.redirect("/dashboard");
  }

  const paid = potential.amount; // pennies
  const alreadyPaid = Number(user.paid) + paid;
  const left = Number(user.owed) - paid;

  const updateStatement = db.prepare(
    "UPDATE users SET paid = ?, owed = ? WHERE id = ?"
  );
  updateStatement.run(alreadyPaid, left, user.id);

  const paidString = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(paid / 100);

    addChrisShare(paid, `${user.firstname} ${user.lastname} made a payment of ${paidString} towards their tuition/fees.`);


  const addPaymentStatement = db.prepare(
    "INSERT INTO paymentHistory (title, description, amount, method, date, user_id) VALUES (? , ? , ? , ? , ? , ?)"
  );
  addPaymentStatement.run(
    `Payment by ${user.firstname} ${user.lastname}`,
    `${user.firstname} ${user.lastname} made a payment of ${paidString} towards their tuition/fees.`,
    paid,
    "Stripe",
    Date.now(),
    user.id
  );

  // Delete potential payment entry (to prevent reuse)
  const deletePotential = db.prepare("DELETE FROM potential_payment WHERE id = ?");
  deletePotential.run(req.params.potentialId);

  // Send emails
  const emailBody = `
    <h1 style="text-align: center;">Payment Received!</h1>
    <br/>
    <p>
      We have received a payment from ${user.firstname} ${user.lastname}. 
      The amount paid was ${paidString}, paid through Stripe on 
      ${new Date(Date.now()).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })}
    </p>
  `;

  sendEmail(user.email, "Payment Received!", emailBody);
  sendEmail(MasterEmail, "Payment Received!", emailBody);

  return res.redirect("/payment-received");
});

app.get("/update-profile-photo", mustBeMember, (req,res) => {
  const member = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.userid);

  if(!member){
    return res.redirect("/")
  }

  return res.render("update-pfp", {member})
})

app.post(
  "/update-profile-photo",
  mustBeLoggedIn,
  imageUpload.single("photo"),
  processImage,
  (req, res) => {
    try {
      if (!req.savedFilename) return res.status(400).send("Image processing failed");

      const imgPath = `/img/publicupload/${req.savedFilename}`;
      const updateStmt = db.prepare("UPDATE users SET img = ? WHERE id = ?");
      updateStmt.run(imgPath, req.user.userid);

      res.redirect("/member-portal");
    } catch (err) {
      console.error("Failed to save image:", err);
      res.status(500).send("Failed to save image");
    }
  }
);

app.get("/donate", (req, res) => {
  const dlRow = db.prepare("SELECT names FROM donor_list WHERE id = 1").get();
  const rawNames = dlRow ? (dlRow.names || "") : "";
  const donorNames = rawNames
    .split(",")
    .map(n => n.trim())
    .filter(n => n.length > 0);

  let fanType = null;
  if (req.user) {
    const member = db.prepare("SELECT fanType FROM users WHERE id = ?").get(req.user.userid);
    fanType = member ? (member.fanType || "individual") : "individual";
  }

  return res.render("donate", { donorNames, fanType });
});

// GET /volunteer
app.get("/volunteer", (req, res) => {
  const vnRow = db.prepare("SELECT needs FROM volunteer_needs WHERE id = 1").get();
  return res.render("volunteer", { needs: vnRow ? vnRow.needs : "" });
});

// POST /volunteer - save volunteer contact form
app.post("/volunteer", (req, res) => {
  const firstname = String(req.body.firstname || "").trim();
  const lastname  = String(req.body.lastname  || "").trim();
  const email     = String(req.body.email     || "").trim();
  const phone     = String(req.body.phone     || "").trim();
  const message   = String(req.body.message   || "").trim();
  if (!firstname || !lastname || !email || !phone || !message) {
    return res.status(400).send("All fields are required.");
  }
  db.prepare(
    "INSERT INTO volunteer_contacts (firstname, lastname, email, phone, message, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(firstname, lastname, email, phone, message, Date.now());
  req.session.flashMessage = "Thanks! We'll get back to you soon.";
  return res.redirect("/volunteer");
});

// GET /admin/volunteer-needs
app.get("/admin/volunteer-needs", mustBeAdmin, (req, res) => {
  const vnRow = db.prepare("SELECT needs FROM volunteer_needs WHERE id = 1").get();
  const contacts = db.prepare("SELECT * FROM volunteer_contacts ORDER BY created_at DESC").all();
  return res.render("admin-volunteer-needs", { needs: vnRow ? vnRow.needs : "", contacts });
});

// POST /admin/volunteer-needs
app.post("/admin/volunteer-needs", mustBeAdmin, (req, res) => {
  const needs = String(req.body.needs || "").trim();
  db.prepare("UPDATE volunteer_needs SET needs = ? WHERE id = 1").run(needs);
  req.session.flashMessage = "Volunteer needs updated.";
  return res.redirect("/admin/volunteer-needs");
});

// GET /admin/donors
app.get("/admin/donors", mustBeAdmin, (req, res) => {
  const dlRow = db.prepare("SELECT names FROM donor_list WHERE id = 1").get();
  return res.render("admin-donors", { names: dlRow ? (dlRow.names || "") : "" });
});

// POST /admin/donors
app.post("/admin/donors", mustBeAdmin, (req, res) => {
  const names = String(req.body.names || "").trim();
  db.prepare("UPDATE donor_list SET names = ? WHERE id = 1").run(names);
  req.session.flashMessage = "Donor list updated.";
  return res.redirect("/admin/donors");
});

// ═══ Admin Subscriptions & Donations ═══
app.get("/admin/subscriptions", mustBeAdmin, (req, res) => {
  const subscriptions = db.prepare("SELECT * FROM fan_subscriptions ORDER BY created_at DESC").all();
  const allDonations = db.prepare("SELECT * FROM donations ORDER BY created_at DESC").all();

  // Build a map of user_id -> user info for subscriptions
  const subUsers = {};
  const userIds = [...new Set(subscriptions.map(s => s.user_id))];
  userIds.forEach(uid => {
    const u = db.prepare("SELECT id, firstname, lastname, email, fanType, businessName FROM users WHERE id = ?").get(uid);
    if (u) subUsers[uid] = u;
  });

  return res.render("admin-subscriptions", { subscriptions, allDonations, subUsers });
});

// POST /donate - create potential donation and redirect to Stripe Checkout
app.post("/donate", async (req, res) => {
  try {
    // read donor info from form
    const donorEmail = String(req.body.email || "").trim();
    const donorName  = String(req.body.name || "").trim();
    const donorMsg   = req.body.message ? String(req.body.message).trim() : "";

    if (!donorEmail || !donorName || !req.body.payment) {
      return res.status(400).send("Missing required donation fields.");
    }



    // payment input expected in dollars (e.g. 25.00)
    const amountCents = Math.round(Number(req.body.payment) * 100);
    if (!Number.isFinite(amountCents) || amountCents < 50) { // minimum $0.50 per your form
      return res.status(400).send("Invalid donation amount.");
    }

    // processing fee: 5%
    const processingFee = Math.round(amountCents * 0.06);
    const totalCharge = amountCents + processingFee;

    // insert a potential_donation row
    const insertPotential = db.prepare(
      `INSERT INTO potential_donation
        (email, name, message, amount, processing_fee, total_charge, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const result = insertPotential.run(
      donorEmail,
      donorName,
      donorMsg,
      amountCents,
      processingFee,
      totalCharge,
      Date.now()
    );
    const potentialId = result.lastInsertRowid;

    // create Stripe Checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "Donation to The Boise Gems Drum & Bugle Corps",
              description: donorMsg || `Donation by ${donorName}`,
            },
            unit_amount: totalCharge,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${process.env.BASEURL}/donate/success/${potentialId}`,
      cancel_url: `${process.env.BASEURL}/donate`,
    })

    // store the stripe session id for reference
    const updateSession = db.prepare("UPDATE potential_donation SET stripe_session_id = ? WHERE id = ?");
    updateSession.run(session.id, potentialId);

    // redirect user to Stripe Checkout
    return res.redirect(303, session.url);
  } catch (err) {
    console.error("Donate route error:", err);
    return res.status(500).send("Failed to create Stripe session");
  }
});

app.get("/admin/chris-payment", mustBeChrisPaymentViewer, (req, res) => {
  const summary = db
    .prepare("SELECT total_owed FROM chrisPayment WHERE id = 1")
    .get() || { total_owed: 0 };

  const history = db
    .prepare("SELECT * FROM chrisPaymentHistory ORDER BY created_at DESC")
    .all();

  const email = (req.user.email || "").toLowerCase();
  const canRecordPayment = email === "chris@chrispricemusic.net";

  res.render("admin-chris-payment", {
    totalOwedCents: summary.total_owed || 0,
    history,
    canRecordPayment,
  });
});

app.post("/admin/chris-payment/pay", mustBeChrisPaymentViewer, (req, res) => {
  const email = (req.user.email || "").toLowerCase();
  if (email !== "chris@chrispricemusic.net") {
    // Only Chris can record payments
    return res.redirect("/");
  }

  let amountDollars = parseFloat(req.body.amount || "0");
  if (!isFinite(amountDollars) || amountDollars <= 0) {
    req.session.flashMessage = "Enter a valid payment amount.";
    return res.redirect("/admin/chris-payment");
  }

  const amountCents = Math.round(amountDollars * 100);
  const note = (req.body.note || "").trim();

  const row =
    db.prepare("SELECT total_owed FROM chrisPayment WHERE id = 1").get() ||
    { total_owed: 0 };

  const current = row.total_owed || 0;
  const newTotal = Math.max(0, current - amountCents);

  // Log history
  db.prepare(`
    INSERT INTO chrisPaymentHistory (created_at, amount, type, note, source)
    VALUES (?, ?, 'payment', ?, ?)
  `).run(
    Date.now(),
    amountCents,
    note || "Payment made",
    "manual payment"
  );

  // Update total
  db.prepare(`
    UPDATE chrisPayment
    SET total_owed = ?
    WHERE id = 1
  `).run(newTotal);

  req.session.flashMessage = "Payment recorded.";
  res.redirect("/admin/chris-payment");
});


// GET /donate/success/:potentialId - finalize donation after successful checkout
app.get("/donate/success/:potentialId", async (req, res) => {
  try {
    const potentialId = Number(req.params.potentialId);
    if (!potentialId) return res.redirect("/donate");

    const getPotential = db.prepare("SELECT * FROM potential_donation WHERE id = ?");
    const potential = getPotential.get(potentialId);

    if (!potential) {
      return res.redirect("/donate");
    }

    // (Optional) You could verify payment with Stripe API here using session id,
    // but for simplicity we assume returning from Stripe Checkout means success.
    // If you want bulletproof guarantee, use Stripe webhooks (recommended).

    // Move the potential row into finalized donations
    const insertDonation = db.prepare(
      `INSERT INTO donations
        (email, name, message, amount, processing_fee, total_charged, stripe_session_id, created_at, user_id, tier, donation_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insertDonation.run(
      potential.email,
      potential.name,
      potential.message,
      potential.amount,
      potential.processing_fee,
      potential.total_charge,
      potential.stripe_session_id,
      Date.now(),
      potential.user_id || null,
      potential.tier || null,
      potential.donation_type || "one_time"
    );

    // Also add to paymentHistory table for consistent transaction records.
    const paidString = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(potential.amount / 100);
    const processingString = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(potential.processing_fee / 100);
    const totalString = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(potential.total_charge / 100);

    const title = `Donation by ${potential.name}`;
    const description = `Donation of ${paidString} (processing fee ${processingString}, total charged ${totalString}). Message: ${potential.message || "â€”"}`;

    const insertHistory = db.prepare(
      "INSERT INTO paymentHistory (title, description, amount, method, date, user_id) VALUES (?, ?, ?, ?, ?, ?)"
    );
    // user_id NULL because donor may not be a member
    insertHistory.run(title, description, potential.total_charge, "Stripe", Date.now(), null);

    addChrisShare(potential.total_charge, `Donation of ${paidString} (processing fee ${processingString}, total charged ${totalString}). Message: ${potential.message || "â€”"}`);

    // delete potential_donation row (prevent reuse)
    const deletePotential = db.prepare("DELETE FROM potential_donation WHERE id = ?");
    deletePotential.run(potentialId);

    // Send receipt email to donor
    const emailBody = `
      <h1 style="text-align:center;">Thank you for your donation!</h1>
      <p>Dear ${potential.name},</p>
      <p>Thank you for your generous donation to The Boise Gems Drum & Bugle Corps.</p>
      <ul>
        <li>Donation: ${paidString}</li>
        <li>Processing fee: ${processingString}</li>
        <li><strong>Total charged: ${totalString}</strong></li>
      </ul>
      <p>Your optional message: ${potential.message ? `<em>${potential.message}</em>` : "No message provided."}</p>
      <p>Date: ${new Date(Date.now()).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</p>
      <p>Sincerely,<br/>The Boise Gems Drum & Bugle Corps</p>
    `;

    // sendEmail function expected to exist
    sendEmail(potential.email, "Thank you for your donation â€” Boise Gems", emailBody);
    sendEmail(MasterEmail, "Donation Received", `Donation received: ${title} â€” ${totalString}`);

    // redirect donor to a thank-you page
    return res.redirect("/donate/thank-you");
  } catch (err) {
    console.error("Donation success handler error:", err);
    return res.status(500).send("Failed to finalize donation");
  }
});

app.get("/donate/thank-you", (req,res) => {
  return res.render("donation-thank-you")
})

// ═══ Feed the Corps one-time donation (logged-in) ═══
app.post("/donate/feed-the-corps", mustBeLoggedIn, async (req, res) => {
  try {
    const member = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.userid);
    if (!member) return res.redirect("/donate");

    const tier = String(req.body.ftcTier || "").trim();
    const amountCents = Math.round(Number(req.body.ftcAmount));
    const message = String(req.body.ftcMessage || "").trim();

    const validTiers = { water_break: 2500, gatorade: 5000, pbj: 10000, lunch: 20000, dinner: 30000 };
    if (!validTiers[tier] || amountCents !== validTiers[tier]) return res.status(400).send("Invalid tier.");

    const processingFee = Math.round(amountCents * 0.06);
    const totalCharge = amountCents + processingFee;

    const insertPotential = db.prepare(
      `INSERT INTO potential_donation (email, name, message, amount, processing_fee, total_charge, created_at, user_id, tier, donation_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const result = insertPotential.run(
      member.email,
      member.firstname + " " + member.lastname,
      message,
      amountCents,
      processingFee,
      totalCharge,
      Date.now(),
      member.id,
      tier,
      "feed_the_corps"
    );
    const potentialId = result.lastInsertRowid;

    const tierNames = { water_break: "Water Break", gatorade: "Gatorade", pbj: "PB&J Sandwiches", lunch: "Lunch", dinner: "Dinner" };
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: {
            name: `Feed the Corps – ${tierNames[tier]}`,
            description: message || `Feed the Corps donation by ${member.firstname} ${member.lastname}`,
          },
          unit_amount: totalCharge,
        },
        quantity: 1,
      }],
      mode: "payment",
      success_url: `${process.env.BASEURL}/donate/success/${potentialId}`,
      cancel_url: `${process.env.BASEURL}/donate`,
    });

    db.prepare("UPDATE potential_donation SET stripe_session_id = ? WHERE id = ?").run(session.id, potentialId);
    return res.redirect(303, session.url);
  } catch (err) {
    console.error("Feed the corps donate error:", err);
    return res.status(500).send("Failed to create Stripe session");
  }
});

// ═══ One-time donation (logged-in) ═══
app.post("/donate/onetime", mustBeLoggedIn, async (req, res) => {
  try {
    const member = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.userid);
    if (!member) return res.redirect("/donate");

    const amountCents = Math.round(Number(req.body.payment) * 100);
    if (!Number.isFinite(amountCents) || amountCents < 50) return res.status(400).send("Invalid amount.");

    const tier = String(req.body.selectedTier || "").trim() || null;
    const message = String(req.body.message || "").trim();

    // Collect shirt sizes from form
    const shirtSizes = [];
    for (const key of Object.keys(req.body)) {
      if (key.startsWith("shirtSize_")) {
        shirtSizes.push(req.body[key]);
      }
    }

    const processingFee = Math.round(amountCents * 0.06);
    const totalCharge = amountCents + processingFee;

    const insertPotential = db.prepare(
      `INSERT INTO potential_donation (email, name, message, amount, processing_fee, total_charge, created_at, user_id, tier, donation_type, shirt_sizes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const result = insertPotential.run(
      member.email,
      member.firstname + " " + member.lastname,
      message,
      amountCents,
      processingFee,
      totalCharge,
      Date.now(),
      member.id,
      tier,
      "one_time",
      shirtSizes.length ? JSON.stringify(shirtSizes) : null
    );
    const potentialId = result.lastInsertRowid;

    const desc = tier
      ? `${tier.replace("_", " ")} tier donation`
      : `One-time donation`;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: {
            name: "Donation to The Boise Gems Drum & Bugle Corps",
            description: desc + (message ? ` – ${message}` : ""),
          },
          unit_amount: totalCharge,
        },
        quantity: 1,
      }],
      mode: "payment",
      success_url: `${process.env.BASEURL}/donate/success/${potentialId}`,
      cancel_url: `${process.env.BASEURL}/donate`,
    });

    db.prepare("UPDATE potential_donation SET stripe_session_id = ? WHERE id = ?").run(session.id, potentialId);
    return res.redirect(303, session.url);
  } catch (err) {
    console.error("One-time donate error:", err);
    return res.status(500).send("Failed to create Stripe session");
  }
});

// ═══ Subscription donation (logged-in) ═══
app.post("/donate/subscribe", mustBeLoggedIn, async (req, res) => {
  try {
    const member = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.userid);
    if (!member) return res.redirect("/donate");

    const tier = String(req.body.tier || "").trim();
    const fanType = String(req.body.fanType || "individual").trim();
    const monthlyDollars = Number(req.body.monthlyAmount);

    if (!tier || !monthlyDollars || monthlyDollars < 1) return res.status(400).send("Invalid subscription data.");

    // Validate minimum amounts
    const indMins = { bronze: 10, silver: 25, gold: 50, platinum: 75, star_garnet: 100 };
    const corpMins = { bronze: 100, silver: 500, gold: 1000, platinum: 2500, star_garnet: 5000 };
    const mins = fanType === "corporate" ? corpMins : indMins;
    if (!mins[tier] || monthlyDollars < mins[tier]) return res.status(400).send("Amount below minimum for this tier.");

    const monthlyCents = Math.round(monthlyDollars * 100);
    const processingFee = Math.round(monthlyCents * 0.06);
    const totalMonthly = monthlyCents + processingFee;

    // Collect shirt sizes
    const shirtSizes = [];
    for (const key of Object.keys(req.body)) {
      if (key.startsWith("indShirtSize_") || key.startsWith("corpShirtSize_")) {
        shirtSizes.push(req.body[key]);
      }
    }

    // Get or create Stripe customer
    let stripeCustomerId = member.stripe_customer_id;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: member.email,
        name: member.firstname + " " + member.lastname,
        metadata: { user_id: String(member.id), fan_type: fanType, business_name: member.businessName || "" },
      });
      stripeCustomerId = customer.id;
      db.prepare("UPDATE users SET stripe_customer_id = ? WHERE id = ?").run(stripeCustomerId, member.id);
    }

    // Create a Stripe price for the subscription
    const tierNames = { bronze: "Bronze", silver: "Silver", gold: "Gold", platinum: "Platinum", star_garnet: "Star Garnet" };
    const product = await stripe.products.create({
      name: `Boise Gems ${tierNames[tier]} ${fanType === "corporate" ? "Corporate" : "Individual"} Sponsorship`,
      metadata: { tier, fan_type: fanType },
    });

    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: totalMonthly,
      currency: "usd",
      recurring: { interval: "month" },
    });

    // Create Stripe Checkout session in subscription mode
    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      payment_method_types: ["card"],
      line_items: [{ price: price.id, quantity: 1 }],
      mode: "subscription",
      success_url: `${process.env.BASEURL}/donate/subscribe/success?session_id={CHECKOUT_SESSION_ID}&tier=${encodeURIComponent(tier)}&fan_type=${encodeURIComponent(fanType)}&amount=${totalMonthly}&shirts=${encodeURIComponent(JSON.stringify(shirtSizes))}`,
      cancel_url: `${process.env.BASEURL}/donate`,
    });

    return res.redirect(303, session.url);
  } catch (err) {
    console.error("Subscription error:", err);
    return res.status(500).send("Failed to create subscription");
  }
});

// ═══ Subscription success callback ═══
app.get("/donate/subscribe/success", mustBeLoggedIn, async (req, res) => {
  try {
    const sessionId = req.query.session_id;
    const tier = req.query.tier;
    const fanType = req.query.fan_type || "individual";
    const amountCents = Number(req.query.amount) || 0;
    const shirtSizes = req.query.shirts ? JSON.parse(req.query.shirts) : [];

    if (!sessionId) return res.redirect("/donate");

    // Retrieve the subscription ID from Stripe
    const stripeSession = await stripe.checkout.sessions.retrieve(sessionId);
    const subscriptionId = stripeSession.subscription;

    if (!subscriptionId) return res.redirect("/donate");

    // Check we haven't already recorded this
    const existing = db.prepare("SELECT id FROM fan_subscriptions WHERE stripe_subscription_id = ?").get(subscriptionId);
    if (!existing) {
      db.prepare(
        `INSERT INTO fan_subscriptions (user_id, stripe_subscription_id, stripe_price_id, tier, fan_type, amount_cents, status, shirt_sizes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`
      ).run(
        req.user.userid,
        subscriptionId,
        stripeSession.line_items ? "" : "",
        tier,
        fanType,
        amountCents,
        shirtSizes.length ? JSON.stringify(shirtSizes) : null,
        Date.now()
      );

      // Record the first payment in donations table
      const member = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.userid);
      const donorName = member ? (member.firstname + " " + member.lastname) : "Fan";
      const baseCents = Math.round(amountCents / 1.06); // reverse the 6% fee
      const feeCents = amountCents - baseCents;

      db.prepare(
        `INSERT INTO donations (email, name, message, amount, processing_fee, total_charged, stripe_session_id, created_at, user_id, tier, donation_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        member ? member.email : "",
        donorName,
        `${tier} subscription started`,
        baseCents,
        feeCents,
        amountCents,
        sessionId,
        Date.now(),
        req.user.userid,
        tier,
        "subscription"
      );

      addChrisShare(amountCents, `Subscription ${tier} by ${donorName}`);

      // Send acknowledgement email
      if (member) {
        let emailBody = `
          <h1 style="text-align:center;">Thank you for your subscription!</h1>
          <p>Dear ${member.firstname},</p>
          <p>You are now a <strong>${tier.replace("_", " ").replace(/\b\w/g, c => c.toUpperCase())}</strong> level subscriber to The Boise Gems Drum &amp; Bugle Corps.</p>
          <p><strong>Monthly charge:</strong> $${(amountCents / 100).toFixed(2)}</p>
          <p>You can manage or cancel your subscription at any time from your Fan Portal.</p>
        `;
        if (fanType === "corporate") {
          emailBody += `<p><em>If we need additional information (such as your corporate logo for the equipment trailer), we will reach out via email.</em></p>`;
        }
        emailBody += `<p>Sincerely,<br/>The Boise Gems Drum &amp; Bugle Corps</p>`;
        sendEmail(member.email, "Subscription Confirmed – Boise Gems", emailBody);
        sendEmail(MasterEmail, "New Subscription", `New ${tier} ${fanType} subscription by ${donorName} (${member.email}) – $${(amountCents / 100).toFixed(2)}/mo`);
      }
    }

    return res.redirect("/donate/thank-you");
  } catch (err) {
    console.error("Subscription success error:", err);
    return res.redirect("/donate/thank-you");
  }
});

app.get("/update-info", mustBeLoggedInAny, (req,res) => {
  const member = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.userid);

  if(!member)
    return res.redirect("/")


  return res.render("change-address", {member})
})

app.post("/change-address", mustBeLoggedInAny, (req, res) => {
  const member = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.userid);

  if (!member) {
    return res.redirect("/");
  }

  const address = String(req.body.address || "").trim();
  const email = String(req.body.email || "").trim();
  const phone = String(req.body.phone || "").trim();
  const birthdayRaw = String(req.body.birthday || "").trim();

  if (!address || !email) {
    req.session.flashMessage = "Address and email are required.";
    return res.redirect("/update-info"); // your GET route (you said you renamed it)
  }

  // Make sure email is unique to this user
  const existingEmail = db
    .prepare("SELECT id FROM users WHERE email = ? AND id != ?")
    .get(email, req.user.userid);

  if (existingEmail) {
    req.session.flashMessage =
      "That email address is already in use. Please use a different one.";
    return res.redirect("/update-info");
  }

  // Preserve old birthday unless we get a valid new one
  let birthdayMs = member.birthday || null;
  if (birthdayRaw) {
    const parsed = parseBirthdayToTimestamp(birthdayRaw);
    if (parsed) {
      birthdayMs = parsed;
    }
  }

  db.prepare(
    "UPDATE users SET address = ?, email = ?, phone = ?, birthday = ? WHERE id = ?"
  ).run(address, email, phone, birthdayMs, req.user.userid);

  req.session.flashMessage = "Contact information updated.";
  // Redirect based on role
  if (req.parent) return res.redirect('/parent-portal');
  if (req.staff) return res.redirect('/staff/members');
  if (req.admin) return res.redirect('/admin-portal');
  return res.redirect('/member-portal');
});


// Admin â€” view all contracted members and balances
app.get('/admin/contracted-members', mustBeAdmin, (req, res) => {
  const rows = db.prepare(
     `SELECT 
       u.id, u.firstname, u.lastname, u.email, u.phone, u.address, u.owed, 
      u.contractedCorps AS contractedCorps, u.contractedIndependent AS contractedIndependent, u.contractedAffiliate AS contractedAffiliate,
       (
         SELECT paymentMethod 
         FROM contractedMembers cm 
         WHERE cm.user_id = u.id 
         ORDER BY cm.contracted_date DESC 
         LIMIT 1
       ) AS paymentMethod
    FROM users u
    WHERE u.contractedCorps = 1 OR u.contractedIndependent = 1 OR u.contractedAffiliate = 1
     ORDER BY u.lastname, u.firstname`
  ).all();

  return res.render('admin-contracted-members', { members: rows });
});

// Admin â€” view expired contract extensions
app.get('/admin/expired-contracts', mustBeAdmin, (req, res) => {
  const now = Date.now();
  const rows = db.prepare(
    `SELECT ce.*, u.firstname AS signerFirst, u.lastname AS signerLast, u.email AS signerEmail, 
            child.firstname AS childFirst, child.lastname AS childLast
     FROM contractExtension ce
     JOIN users u ON u.id = ce.user_id
     LEFT JOIN users child ON child.id = ce.child_id
     WHERE ce.due_date IS NOT NULL AND ce.due_date < ?
     ORDER BY ce.due_date DESC`
  ).all(now);

  return res.render('admin-expired-contracts', { extensions: rows });
});

// Admin â€” delete a contract extension
app.post('/admin/contract-extension/:id/delete', mustBeAdmin, (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM contractExtension WHERE id = ?').run(id);
  req.session.flashMessage = 'Contract extension deleted.';
  return res.redirect('/admin/expired-contracts');
});



app.get("/allergy-info", mustBeMember, (req,res) => {
  const allergyInfo = db.prepare("SELECT * FROM allergies WHERE user_id = ?").get(req.user.userid)

  if(!allergyInfo)
    return res.render("set-allergies", {allergyInfo: {no_allergies: 0, allergies: ""}})

  return res.render("set-allergies", {allergyInfo})
})

app.post("/set-allergies", mustBeLoggedIn, (req,res) => {
  const no_allergies = req.body.no_allergies || 0;
  const allergies = req.body.allergies;

  const allergyExists = db.prepare("SELECT * FROM allergies WHERE user_id = ?").get(req.user.userid)

  if(allergyExists)
    db.prepare("UPDATE allergies SET no_allergies = ?, allergies = ? WHERE user_id = ?").run(no_allergies,allergies,req.user.userid)
  else
    db.prepare("INSERT INTO allergies (no_allergies, allergies, user_id) VALUES (?,?,?)").run(no_allergies,allergies,req.user.userid)

  req.session.flashMessage = "Updated allergy information"
  return res.redirect("/member-portal")
})

app.get("/set-materials", mustBeStaff, (req, res) => {
  const rows = db.prepare("SELECT section, pdf FROM materials").all();
  const materials = {};
  for (const r of rows) {
    if (r.pdf) materials[String(r.section || "").toLowerCase().trim()] = r.pdf;
  }
  return res.render("set-materials", { materials });
})

// Admin: view the member portal as themselves (member view preview)
app.get("/admin/member-view", mustBeAdmin, (req, res) => {
  const member = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.userid);
  if (!member) return res.redirect("/admin-portal");

  const contracts = db.prepare("SELECT * FROM contractExtension WHERE user_id = ? OR child_id = ?").all(req.user.userid, req.user.userid);
  const requiredForms = getRequiredFormsForUser(req.user.userid);
  const uploadedForms = db.prepare("SELECT document_id FROM formUploads WHERE user_id = ?").all(req.user.userid);
  const leftoverForms = markUploadsAndCount(requiredForms, uploadedForms);
  const allergy = db.prepare("SELECT * FROM allergies WHERE user_id = ?").get(req.user.userid);

  member.minor = false;
  if (member.birthday) {
    const birthday = new Date(member.birthday);
    const today = new Date();
    let age = today.getFullYear() - birthday.getFullYear();
    const hadBDay =
      today.getMonth() > birthday.getMonth() ||
      (today.getMonth() === birthday.getMonth() && today.getDate() >= birthday.getDate());
    if (!hadBDay) age--;
    member.minor = age < 18;
  }

  return res.render("member-portal", {
    member,
    contracts,
    leftoverForms,
    allergy,
    previewMode: true
  });
})


// ADD/REPLACE your current /set-materials handler with this updated version
app.post(
  "/set-materials",
  mustBeStaff,
  pdfUpload.fields([
    { name: "brass", maxCount: 1 },
    { name: "drumline", maxCount: 1 },
    { name: "guard", maxCount: 1 },
    { name: "front", maxCount: 1 },

    // NEW:
    { name: "drum_major", maxCount: 1 },            // Drum Major Audition
    { name: "drumline_independent", maxCount: 1 },  // Drumline (Independent)
    { name: "front_independent", maxCount: 1 }      // Front Ensemble (Independent)
  ]),
  (req, res) => {
    try {
      const files = req.files || {};

      // map form field names -> materials.section values in DB
      const sectionMap = {
        brass: "brass",
        drumline: "drumline",
        guard: "guard",
        front: "front ensemble",

        // NEW:
        drum_major: "drum major",
        drumline_independent: "drumline (independent)",
        front_independent: "front ensemble (independent)"
      };

      // Ensure upload dir exists
      const uploadDir = path.join(__dirname, "public", "pdf", "publicpdf");
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

      Object.keys(sectionMap).forEach((field) => {
        if (!files[field] || !files[field][0]) return; // only process uploaded ones

        const file = files[field][0];
        const section = sectionMap[field];
        const pdfPath = `/pdf/publicpdf/${file.filename}`; // what we store in DB

        // Get existing row (if any) including the old pdf path
        const existing = db.prepare("SELECT id, pdf FROM materials WHERE section = ?").get(section);

        if (existing) {
          // best-effort delete previous PDF file to avoid orphans
          if (existing.pdf) {
            try {
              const relative = existing.pdf.replace(/^\/+/, "");
              const oldFullPath = path.join(__dirname, "public", relative);
              if (fs.existsSync(oldFullPath)) fs.unlinkSync(oldFullPath);
            } catch (e) {
              console.error("Failed to delete old PDF:", e);
            }
          }
          db.prepare("UPDATE materials SET pdf = ? WHERE section = ?").run(pdfPath, section);
        } else {
          db.prepare("INSERT INTO materials (section, pdf) VALUES (?, ?)").run(section, pdfPath);
        }
      });

      req.session.flashMessage = "Audition materials updated successfully.";
      return req.admin ? res.redirect("/admin-portal") : res.redirect("/member-portal");
    } catch (err) {
      console.error("Error in /set-materials:", err);
      req.session.flashMessage = "There was an error uploading materials.";
      return res.redirect("/set-materials");
    }
  }
);


app.get('/edit-event/:id', (req, res) => {
  const id = Number(req.params.id);
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  if (!event) return res.status(404).send('Event not found');

  // helper to format for <input type="datetime-local">
  const toLocal = (s) => {
    if (!s) return '';
    const d = new Date(s);
    if (isNaN(d)) return s; // already formatted
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  event.datetime_local = toLocal(event.datetime);
  event.endtime_local  = toLocal(event.endtime);

  res.render('edit-event', { event });
});

app.post('/events/:id/edit', imageUpload.single('image'), processImageJpgOptional, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  if (!existing) return res.status(404).send('Event not found');

  const {
    title,
    description,
    datetime,
    endtime = '',
    location,
    link = '',
    cost,
    type
  } = req.body;

  // If processImageJpg handled a new file, it should set req.savedFilename.
  const hasNewImage = !!req.savedFilename;
  const newImagePath = hasNewImage ? req.savedFilename : existing.image;

  const costInt = Number.isFinite(Number(cost)) ? parseInt(cost, 10) : 0;
  const slug = `${id}-${slugify(title)}`;

  const update = db.prepare(`
    UPDATE events
       SET title = ?, description = ?, datetime = ?, endtime = ?, location = ?,
           image = ?, link = ?, cost = ?, type = ?, slug = ?
     WHERE id = ?
  `);

  // Do the DB update first
  try {
    update.run(
      title,
      description,
      datetime,
      endtime || null,
      location,
      newImagePath || null,
      link || '',
      costInt,
      type,
      slug,
      id
    );
  } catch (err) {
    console.error('Update failed:', err);
    return res.status(500).send('Failed to update event');
  }

  // After successful update, if we swapped images, remove the old file (best-effort)
  if (hasNewImage && existing.image && existing.image !== newImagePath) {
    try {
      const oldAbs = path.join(__dirname, 'public', existing.image.replace(/^\/+/, ''));
      fs.unlink(oldAbs, () => {});
    } catch (_) {}
  }

  return res.redirect('/events-admin');
});

app.get('/calendar', (req, res) => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end   = new Date(start.getFullYear(), start.getMonth() + 12, 1);

  // Pull only fields we need
  const rows = db.prepare(`
    SELECT id, title, slug, datetime, type, image, endtime, description, cost
    FROM events
    WHERE datetime >= ? AND datetime < ?
    ORDER BY datetime ASC
  `).all(
    start.toISOString().slice(0,19),  // "YYYY-MM-DDTHH:MM:SS"
    end.toISOString().slice(0,19)
  );

  res.render('calendar', { events: rows });
});

app.get("/event/:slug", (req, res) => {
  const event = db.prepare("SELECT * FROM events WHERE slug = ?").get(req.params.slug);
  if (!event) return res.status(404).render("404");

  // Build Google Maps links
  const locale  = "https://www.google.com/maps/search/" + String(event.location || "").replace(/ /g, "+");
  const mapAddy = String(event.location || "").replace(/ /g, "+");

  // RSVPs
  const rsvps = db.prepare("SELECT * FROM rsvp WHERE event_id = ?").all(event.id);
  let reservedSelf = false;
  if (req.user) {
    reservedSelf = !!db.prepare("SELECT 1 FROM rsvp WHERE event_id = ? AND user_id = ?").get(event.id, req.user.userid);
  }

  // Meta tags (match the style used in /news/:slug)
  const base = "https://boisegems.org";
  const url  = `${base}/event/${event.slug}`;
  const img  = event.image ? `${base}/img/publicupload/${event.image}` : undefined;

  // Use your existing excerpt() helper if available (same as news)
  const desc = typeof excerpt === "function"
    ? excerpt(event.description || "")
    : (event.description || "").toString().slice(0, 180); // safe fallback

  return res.render("event", {
    event,
    locale,
    mapAddy,
    rsvps,
    reservedSelf,
    meta: {
      title: `${event.title} â€” Boise Gems`,
      description: desc,
      url,
      image: img
    }
  });
});




app.get("/event/:slug/rsvps-data", mustBeAdmin, (req, res) => {
  const event = db.prepare("SELECT * FROM events WHERE slug = ?").get(req.params.slug);
  if (!event) return res.status(404).json({ error: "Event not found" });

  const q = String(req.query.q || "").trim();
  const sectionFilter = String(req.query.section || "all").trim();

  // Build LIKEs for name search (case-insensitive)
  const likeStr = `%${q}%`;

  let sql = `
    SELECT r.id as rsvp_id,
           r.paid,
           u.id as user_id,
           u.firstname,
           u.lastname,
           COALESCE(NULLIF(TRIM(u.section), ''), 'Unassigned') as section,
           COALESCE(NULLIF(TRIM(u.instrument), ''), 'Unassigned') as instrument
    FROM rsvp r
    JOIN users u ON u.id = r.user_id
    WHERE r.event_id = ?
      AND (
            ? = '' OR
            u.firstname LIKE ? OR
            u.lastname LIKE ? OR
            (u.firstname || ' ' || u.lastname) LIKE ?
          )
  `;

  const params = [event.id, q, likeStr, likeStr, likeStr];

  if (sectionFilter !== "all") {
    sql += ` AND COALESCE(NULLIF(TRIM(u.section), ''), 'Unassigned') = ? `;
    params.push(sectionFilter);
  }

  sql += `
    ORDER BY section COLLATE NOCASE,
             instrument COLLATE NOCASE,
             u.lastname COLLATE NOCASE,
             u.firstname COLLATE NOCASE
  `;

  const rsvps = db.prepare(sql).all(...params);

   const parentIds = rsvps.map(r => r.user_id).filter(Boolean);
  if (parentIds.length) {
    const placeholders = parentIds.map(() => "?").join(",");
    const childrenByParent = {};
    const childRows = db
      .prepare(
        `
        SELECT id, firstname, lastname, parentId
        FROM users
        WHERE parentId IN (${placeholders})
        ORDER BY lastname COLLATE NOCASE, firstname COLLATE NOCASE
        `
      )
      .all(...parentIds);

    for (const child of childRows) {
      if (!childrenByParent[child.parentId]) {
        childrenByParent[child.parentId] = [];
      }
      childrenByParent[child.parentId].push({
        id: child.id,
        firstname: child.firstname,
        lastname: child.lastname,
      });
    }

    for (const r of rsvps) {
      r.children = childrenByParent[r.user_id] || [];
    }
  } else {
    // keep shape consistent
    for (const r of rsvps) {
      r.children = [];
    }
  }

  // Distinct sections for dropdown (based on *all* RSVPs for this event)
  const allSections = db.prepare(`
    SELECT DISTINCT
      COALESCE(NULLIF(TRIM(u.section), ''), 'Unassigned') as section
    FROM rsvp r
    JOIN users u ON u.id = r.user_id
    WHERE r.event_id = ?
    ORDER BY section COLLATE NOCASE
  `).all(event.id).map(row => row.section);

  res.json({ rsvps, sections: allSections });
});


// POST /event/:slug/rsvp  - decides free vs paid
app.post("/event/:slug/rsvp", mustBeLoggedIn, async (req, res) => {
  const event = db.prepare("SELECT * FROM events WHERE slug = ?").get(req.params.slug);
  if (!event) return res.redirect("/");

  // Already RSVP'd?
  const existing = db
    .prepare("SELECT * FROM rsvp WHERE user_id = ? AND event_id = ?")
    .get(req.user.userid, event.id);

  if (existing) {
    req.session.flashMessage = "You're already RSVP'd for this event.";
    return res.redirect(`/event/${event.slug}`);
  }

  const amountCents = toCents(event.cost || 0);
  const eventType = String(event.type || "").toLowerCase();

  // Check member contract status
  const userRow =
    db
      .prepare(
        "SELECT contractedCorps, contractedIndependent, contractedAffiliate FROM users WHERE id = ?"
      )
      .get(req.user.userid) || {};

  // Look for any contracted children of this user (parentId = current user)
  const childContracts =
    db
      .prepare(
        `
        SELECT
          MAX(COALESCE(contractedCorps, 0))       AS anyCorps,
          MAX(COALESCE(contractedIndependent, 0)) AS anyIndependent,
          MAX(COALESCE(contractedAffiliate, 0))   AS anyAffiliate
        FROM users
        WHERE parentId = ?
        `
      )
      .get(req.user.userid) || {};

  const isCorpsContracted =
    !!(userRow.contractedCorps || childContracts.anyCorps);
  const isIndependentContracted =
    !!(userRow.contractedIndependent || childContracts.anyIndependent);
  const isAffiliateContracted =
    !!(userRow.contractedAffiliate || childContracts.anyAffiliate);

  // RULES:
  // 1) Corps contracted => free RSVP for "experience camp" and "camp"
  const corpsFreeTypes = ["experience camp", "camp"];

  // 2) Independent contracted => free RSVP for "BGI Audition" and "BGI Camp"
  const bgiFreeTypes = ["bgi audition", "bgi camp"];

  // 3) Affiliate contracted => add event types here if needed
  const affiliateFreeTypes = [];

  let isFreeForThisUser = false;
  let freeReason = "";

  if (isCorpsContracted && corpsFreeTypes.includes(eventType)) {
    isFreeForThisUser = true;
    freeReason =
      "Contracted corps members (or their parents) do not pay for this camp.";
  }

  if (isIndependentContracted && bgiFreeTypes.includes(eventType)) {
    isFreeForThisUser = true;
    freeReason =
      "Contracted independent members (or their parents) do not pay for this BGI event.";
  }

  if (isAffiliateContracted && affiliateFreeTypes.includes(eventType)) {
    isFreeForThisUser = true;
    freeReason =
      "Contracted affiliate members (or their parents) do not pay for this event.";
  }

  // If user qualifies for free RSVP based on contract + event type
  if (isFreeForThisUser) {
    // Mark RSVP as "paid" so they don't get charged later
    db.prepare(
      "INSERT INTO rsvp (user_id, event_id, paid) VALUES (?, ?, 1)"
    ).run(req.user.userid, event.id);

    req.session.flashMessage = freeReason || "You're RSVP'd!";
    return res.redirect(`/event/${event.slug}`);
  }

  // If event itself is free, just RSVP (unpaid)
  if (amountCents <= 0) {
    db.prepare(
      "INSERT INTO rsvp (user_id, event_id, paid) VALUES (?, ?, 0)"
    ).run(req.user.userid, event.id);

    req.session.flashMessage = "You're RSVP'd!";
    return res.redirect(`/event/${event.slug}`);
  }

  // Paid RSVP: create potential row, start Stripe Checkout
  const processingFee = Math.round(amountCents * 0.06); // ~6% fee
  const totalCharge   = amountCents + processingFee;

  const insertPot = db.prepare(`
    INSERT INTO potential_event_rsvp (user_id, event_id, amount, processing_fee, total_charge, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(req.user.userid, event.id, amountCents, processingFee, totalCharge, Date.now());

  const potentialId = insertPot.lastInsertRowid;

  try {
    const sessionObj = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `RSVP: ${event.title}`,
              description: `Event on ${new Date(event.datetime).toLocaleString("en-US")}`,
            },
            unit_amount: totalCharge,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${process.env.BASEURL}/event/${event.slug}/rsvp/success/${potentialId}`,
      cancel_url: `${process.env.BASEURL}/event/${event.slug}`,
    })

    db.prepare("UPDATE potential_event_rsvp SET stripe_session_id = ? WHERE id = ?")
      .run(sessionObj.id, potentialId);

    // 303 redirect is ideal after POST
    return res.redirect(303, sessionObj.url);
  } catch (err) {
    console.error("Stripe RSVP session error:", err);
    req.session.flashMessage = "We couldn't start the checkout. Please try again.";
    return res.redirect(`/event/${event.slug}`);
  }
});


// GET /event/:slug/rsvp/success/:potentialId  - finalize paid RSVP
app.get("/event/:slug/rsvp/success/:potentialId", mustBeLoggedIn, (req, res) => {
  const event = db.prepare("SELECT * FROM events WHERE slug = ?").get(req.params.slug);
  if (!event) return res.redirect("/");

  const potential = db.prepare(`
    SELECT * FROM potential_event_rsvp WHERE id = ? AND user_id = ? AND event_id = ?
  `).get(Number(req.params.potentialId), req.user.userid, event.id);

  if (!potential) {
    return res.redirect(`/event/${event.slug}`);
  }

  addChrisShare(potential.total_charge, `$${potential.totalCharge/100} RSVP for ${event.title} by userID ${req.user.userid}`);

  // Guard: if already RSVP'd (e.g., user hits back/refresh)
  const existing = db.prepare("SELECT * FROM rsvp WHERE user_id = ? AND event_id = ?").get(req.user.userid, event.id);
  if (!existing) {
    // Mark RSVP paid
    db.prepare("INSERT INTO rsvp (user_id, event_id, paid) VALUES (?, ?, 1)")
      .run(req.user.userid, event.id);

    // Record in paymentHistory (optional but consistent)
    const totalString = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })
      .format(potential.total_charge / 100);

    db.prepare(`
      INSERT INTO paymentHistory (title, description, amount, method, date, user_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      `Event RSVP: ${event.title}`,
      `RSVP fee collected (${totalString}).`,
      potential.total_charge,
      "Stripe",
      Date.now(),
      req.user.userid
    );
  }

  // Cleanup potential (prevent reuse)
  db.prepare("DELETE FROM potential_event_rsvp WHERE id = ?").run(potential.id);

  req.session.flashMessage = "You're RSVP'd! See you there.";
  return res.redirect(`/event/${event.slug}`);
});

// Helpers for meta/excerpt
function stripHtml(s = "") {
  return String(s).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
function excerpt(s, n = 160) {
  const t = stripHtml(s);
  return t.length > n ? t.slice(0, n - 1) + "â€¦" : t;
}

// PUBLIC: list
app.get("/news", (req, res) => {
  const posts = db.prepare(`
    SELECT id, title, slug, hero, created_at
    FROM news
    ORDER BY created_at DESC
  `).all();
  res.render("news-list", { posts });
});



// ADMIN: hub
app.get("/news-admin", mustBeAdmin, (req, res) => {
  const posts = db.prepare(`
    SELECT id, title, slug, created_at, updated_at
    FROM news ORDER BY created_at DESC
  `).all();
  res.render("news-admin", { posts });
});

// ADMIN: new
app.get("/news/new", mustBeAdmin, (req, res) => {
  res.render("news-new");
});

app.post("/news/new", mustBeAdmin, imageUpload.single("hero"), processImageJpg, (req, res) => {
  const title = String(req.body.title || "").trim();
  const html  = String(req.body.html  || "").trim();
  if (!title || !html) return res.status(400).send("Title and content are required");

  const now  = Date.now();
  const slug = slugify(title);
  const hero = req.savedFilename || null;

  const insert = db.prepare(`
    INSERT INTO news (title, slug, html, hero, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  let finalSlug = slug;

  try {
    insert.run(title, slug, html, hero, now, now);
  } catch (e) {
    const alt = `${slug}-${Math.floor(now / 1000)}`;
    insert.run(title, alt, html, hero, now, now);
    finalSlug = alt;
  }

  // Email all registered emails about the new post
  try {
    const recipients = db.prepare(`
      SELECT email, firstname, lastname
      FROM users
      WHERE email IS NOT NULL
        AND TRIM(email) <> ''
    `).all();

    const base = process.env.BASEURL || "https://boisegems.org";
    const link = `${base}/news/${finalSlug}`;
    const subject = `New Boise Gems News: ${title}`;

    recipients.forEach(row => {
      const name = [row.firstname || "", row.lastname || ""].join(" ").trim();
      const body = `
        <h1>${title}</h1>
        <p>We've posted a new update on the Boise Gems website.</p>
        <p><a href="${link}">Click here to read it.</a></p>
        <hr/>
        <p>This email was sent to all registered emails on the Boise Gems website.</p>
      `;
      sendEmail(row.email, subject, body);
    });
  } catch (err) {
    console.error("Error sending news email blast:", err);
  }

  return res.redirect("/news-admin");
});

// ADMIN: upload a single inline image for the news editor (returns JSON)
app.post("/news/upload-image", mustBeAdmin, imageUpload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No image provided" });
  try {
    const meta = await sharp(req.file.buffer).metadata();
    const longSide = Math.max(meta.width || 320, meta.height || 320);
    const scale = longSide > 320 ? 320 / longSide : 1;
    const w = Math.round((meta.width || 320) * scale);
    const h = Math.round((meta.height || 320) * scale);

    const customName = generateCustomFilename() + ".webp";
    const outputPath = path.join(__dirname, "public", "img", "publicupload", customName);
    await sharp(req.file.buffer)
      .resize(w, h)
      .webp({ quality: 85 })
      .toFile(outputPath);

    res.json({ url: `/img/publicupload/${customName}`, filename: customName });
  } catch (err) {
    console.error("News image upload error:", err);
    res.status(500).json({ error: "Image processing failed" });
  }
});

// ADMIN: list available images for the editor gallery
app.get("/news/images", mustBeAdmin, (req, res) => {
  const dirs = [
    { dir: path.join(__dirname, "public", "img", "publicupload"), base: "/img/publicupload/" },
    { dir: path.join(__dirname, "public", "img", "photos"),       base: "/img/photos/"       },
    { dir: path.join(__dirname, "public", "img", "shows"),        base: "/img/shows/"        },
  ];
  const images = [];
  dirs.forEach(({ dir, base }) => {
    try {
      fs.readdirSync(dir).forEach(f => {
        if (/\.(jpe?g|png|gif|webp|avif|svg)$/i.test(f)) {
          images.push({ url: base + encodeURIComponent(f), name: f, dir: base });
        }
      });
    } catch (_) {}
  });
  res.json(images);
});

// ADMIN: edit
app.get("/news/:id/edit", mustBeAdmin, (req, res) => {
  const post = db.prepare(`SELECT * FROM news WHERE id = ?`).get(Number(req.params.id));
  if (!post) return res.redirect("/news-admin");
  res.render("news-edit", { post });
});

app.post("/news/:id/edit", mustBeAdmin, imageUpload.single("hero"), processImageJpgOptional, (req, res) => {
  const id    = Number(req.params.id);
  const row   = db.prepare(`SELECT * FROM news WHERE id = ?`).get(id);
  if (!row) return res.redirect("/news-admin");

  const title = String(req.body.title || "").trim();
  const html  = String(req.body.html  || "").trim();
  const hero  = req.savedFilename ? req.savedFilename : row.hero;
  const slug  = slugify(title);
  const now   = Date.now();

  try {
    db.prepare(`
      UPDATE news
         SET title = ?, slug = ?, html = ?, hero = ?, updated_at = ?
       WHERE id = ?
    `).run(title, slug, html, hero, now, id);
  } catch (e) {
    // On slug conflict, append -id and retry
    const alt = `${slug}-${id}`;
    db.prepare(`
      UPDATE news
         SET title = ?, slug = ?, html = ?, hero = ?, updated_at = ?
       WHERE id = ?
    `).run(title, alt, html, hero, now, id);
  }

  res.redirect("/news-admin");
});

// ADMIN: delete
app.post("/news/:id/delete", mustBeAdmin, (req, res) => {
  const id   = Number(req.params.id);
  const post = db.prepare(`SELECT * FROM news WHERE id = ?`).get(id);
  if (post) {
    // best-effort remove image file if it exists and changed
    if (post.hero) {
      try {
        const oldAbs = path.join(__dirname, "public", "img", "publicupload", post.hero);
        if (fs.existsSync(oldAbs)) fs.unlinkSync(oldAbs);
      } catch (_) {}
    }
    db.prepare(`DELETE FROM news WHERE id = ?`).run(id);
  }
  res.redirect("/news-admin");
});

// PUBLIC: detail
app.get("/news/:slug", (req, res) => {
  const post = db.prepare(`SELECT * FROM news WHERE slug = ?`).get(req.params.slug);
  if (!post) return res.status(404).render("404");

  // Meta tags
  const base = "https://boisegems.org";
  const url  = `${base}/news/${post.slug}`;
  const img  = post.hero ? `${base}/img/publicupload/${post.hero}` : undefined;
  const desc = excerpt(post.html);

  res.render("news-detail", {
    post,
    meta: {
      title: `${post.title} â€” Boise Gems`,
      description: desc,
      url,
      image: img
    }
  });
});

app.get("/view-emergency/:id", mustBeAdmin, (req,res) => {
  const thisUser = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id)

  if(!thisUser)
    return res.redirect("/")

  const contacts = db.prepare("SELECT * FROM emergencyContacts WHERE user_id = ?").all(req.params.id)

  return res.render("emergency-contacts", {contacts, thisUser})
})

app.get("/join-corps", (req,res) => {
  return res.render("join-corps")
})

app.get("/join-independent", (req,res) => {
  return res.render("join-independent")
})

// ---------- STAFF ADMIN ----------

// Categories offered in the UI (you can change this list anytime)
const STAFF_CATEGORIES = [
  "Director",
  "Admin",
  "Design",
  "Brass",
  "Percussion",
  "Color-Guard",
  "Front Ensemble",
  "Visual",
  "BGI Director",
  "BGI Visual",
  "BGI Design",
  "BGI Percussion",
  "BGI Front Ensemble",
  "Board",
  "Advisory Board",
  "Other"
];

// Admin hub: list by category with order numbers
app.get("/staff-admin", mustBeAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM staff
    ORDER BY category COLLATE NOCASE, sort_order ASC, last COLLATE NOCASE, first COLLATE NOCASE
  `).all();

  // group by category
  const grouped = {};
  for (const r of rows) {
    const cat = r.category || "Other";
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(r);
  }
  res.render("staff-admin", { grouped, categories: STAFF_CATEGORIES });
});

// New staff form
app.get("/staff/new", mustBeAdmin, (req, res) => {
  res.render("staff-new", { categories: STAFF_CATEGORIES });
});

app.get("/contracts-admin", mustBeAdmin, (req, res) => {
  const corpsContract = db
    .prepare(
      "SELECT * FROM contractPdfs WHERE ensemble = ? ORDER BY uploaded_at DESC LIMIT 1"
    )
    .get("corps");

  const independentContract = db
    .prepare(
      "SELECT * FROM contractPdfs WHERE ensemble = ? ORDER BY uploaded_at DESC LIMIT 1"
    )
    .get("independent");

  const affiliateContract = db
    .prepare(
      "SELECT * FROM contractPdfs WHERE ensemble = ? ORDER BY uploaded_at DESC LIMIT 1"
    )
    .get("affiliate");

  res.render("contracts-admin", {
    corpsContract,
    independentContract,
    affiliateContract,
  });
});

const csvEscape = (value) => {
  if (value === null || value === undefined) return '""';
  const normalized = String(value).replace(/\r?\n/g, " ").replace(/"/g, '""');
  return `"${normalized}"`;
};

const MEMBER_EXPORT_COLUMN_OPTIONS = {
  firstname: "First Name",
  lastname: "Last Name",
  email: "Email",
  phone: "Phone",
  birthday: "Date of Birth",
  address: "Address",
  section: "Section",
  instrument: "Instrument",
  shirtSize: "Shirt Size",
  contractedCorps: "Contracted Corps",
  contractedIndependent: "Contracted Independent",
  contractedAffiliate: "Contracted Affiliate",
  staff: "Staff",
  paid: "Paid (USD)",
  owed: "Owed (USD)",
  allergies: "Allergies"
};

function parseCheckboxFlag(raw) {
  return raw === "on" || raw === "1" || raw === 1 || raw === true || raw === "true";
}

function toDollarsString(cents) {
  const numeric = Number(cents || 0);
  return (numeric / 100).toFixed(2);
}

const formatBirthdayHuman = (timestamp) => {
  const millis = Number(timestamp);
  if (!Number.isFinite(millis) || millis <= 0) return "";
  return new Date(millis).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC"
  });
};

// Format a birthday timestamp to YYYY-MM-DD string in UTC (for <input type="date"> value)
const formatBirthdayISO = (timestamp) => {
  const millis = Number(timestamp);
  if (!Number.isFinite(millis) || millis <= 0) return "";
  const d = new Date(millis);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

// Parse a date string (YYYY-MM-DD) to a UTC noon timestamp to avoid timezone day-shift
const parseBirthdayToTimestamp = (dateStr) => {
  if (!dateStr) return null;
  const parts = String(dateStr).split("-");
  if (parts.length !== 3) {
    const fallback = new Date(dateStr);
    return isNaN(fallback.getTime()) ? null : fallback.getTime();
  }
  // Build a UTC date at noon to avoid any timezone shifting
  const d = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 12, 0, 0));
  return isNaN(d.getTime()) ? null : d.getTime();
};

function buildMemberExportRows(selectedGroups, selectedFields, sort = "az", days = "all") {
  const whereClauses = [];
  const sqlParams = [];

  if (["30", "60", "90"].includes(days)) {
    const cutoff = Date.now() - parseInt(days, 10) * 24 * 60 * 60 * 1000;
    whereClauses.push("(created_at IS NOT NULL AND created_at > ?)");
    sqlParams.push(cutoff);
  }

  let orderBy;
  if (sort === "newest") orderBy = "created_at DESC";
  else if (sort === "oldest") orderBy = "created_at ASC";
  else orderBy = "lastname COLLATE NOCASE ASC, firstname COLLATE NOCASE ASC";

  const users = db.prepare(`
    SELECT
      u.id,
      u.firstname,
      u.lastname,
      u.email,
      u.phone,
      u.birthday,
      u.address,
      u.section,
      u.instrument,
      u.shirtSize,
      u.contractedCorps,
      u.contractedIndependent,
      u.contractedAffiliate,
      u.staff,
      u.parent,
      u.paid,
      u.owed,
      a.no_allergies,
      a.allergies AS allergyText
    FROM users u
    LEFT JOIN allergies a ON a.user_id = u.id
    ${whereClauses.length ? "WHERE " + whereClauses.join(" AND ") : ""}
    ORDER BY ${orderBy}
  `).all(...sqlParams);

  return users
    .filter((row) => {
      if (row.parent) return false;

      const corps = !!row.contractedCorps;
      const independent = !!row.contractedIndependent;
      const affiliate = !!row.contractedAffiliate;
      const staff = !!row.staff;
      const uncontracted = !corps && !independent && !affiliate && !staff;

      return (
        (selectedGroups.corps && corps) ||
        (selectedGroups.independent && independent) ||
        (selectedGroups.affiliate && affiliate) ||
        (selectedGroups.staff && staff) ||
        (selectedGroups.uncontracted && uncontracted)
      );
    })
    .map((row) => {
      const output = {};
      selectedFields.forEach((field) => {
        if (field === "birthday") {
          output[field] = formatBirthdayHuman(row.birthday);
          return;
        }
        if (field === "shirtSize") {
          output[field] = row.shirtSize || "Not chosen";
          return;
        }
        if (
          field === "contractedCorps" ||
          field === "contractedIndependent" ||
          field === "contractedAffiliate" ||
          field === "staff"
        ) {
          output[field] = row[field] ? "Yes" : "No";
          return;
        }
        if (field === "paid" || field === "owed") {
          output[field] = toDollarsString(row[field]);
          return;
        }
        if (field === "allergies") {
          if (row.no_allergies) {
            output[field] = "No allergies";
          } else {
            output[field] = row.allergyText || "Not provided";
          }
          return;
        }
        output[field] = row[field] || "";
      });
      return output;
    });
}

app.get("/contracts-admin/export-contracts.csv", mustBeAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT
      firstname,
      lastname,
      birthday,
      phone,
      email,
      section,
      instrument,
      contractedCorps,
      contractedIndependent,
      contractedAffiliate
    FROM users
    WHERE contractedCorps = 1 OR contractedIndependent = 1 OR contractedAffiliate = 1
  `).all();

  const groupOrder = { Corps: 0, Independent: 1, Affiliate: 2 };

  const decorated = [];
  rows.forEach((row) => {
    const groups = [];
    if (row.contractedCorps) groups.push("Corps");
    if (row.contractedIndependent) groups.push("Independent");
    if (row.contractedAffiliate) groups.push("Affiliate");

    // Create one row per contract type so members with multiple contracts appear in each group
    if (groups.length === 0) groups.push("");

    groups.forEach((contractedBy) => {
      decorated.push({
        contractedBy,
        firstname: row.firstname || "",
        lastname: row.lastname || "",
        birthday: formatBirthdayHuman(row.birthday),
        phone: row.phone || "",
        email: row.email || "",
        section: row.section || "",
        instrument: row.instrument || ""
      });
    });
  });

  decorated.sort((a, b) => {
    const aGroup = groupOrder[a.contractedBy] ?? 999;
    const bGroup = groupOrder[b.contractedBy] ?? 999;
    if (aGroup !== bGroup) return aGroup - bGroup;

    const ln = a.lastname.localeCompare(b.lastname, "en", { sensitivity: "base" });
    if (ln !== 0) return ln;
    return a.firstname.localeCompare(b.firstname, "en", { sensitivity: "base" });
  });

  const lines = [
    [
      "Contracted By",
      "First Name",
      "Last Name",
      "Date of Birth",
      "Phone Number",
      "Email",
      "Section",
      "Instrument"
    ].join(",")
  ];

  decorated.forEach((row) => {
    lines.push([
      csvEscape(row.contractedBy),
      csvEscape(row.firstname),
      csvEscape(row.lastname),
      csvEscape(row.birthday),
      csvEscape(row.phone),
      csvEscape(row.email),
      csvEscape(row.section),
      csvEscape(row.instrument)
    ].join(","));
  });

  const csv = lines.join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="contracts-${Date.now()}.csv"`);
  return res.send(csv);
});

app.get("/contracts-admin/export-emergency.csv", mustBeAdmin, (req, res) => {
  const users = db.prepare(`
    SELECT id, firstname, lastname, birthday, phone, email
    FROM users
    ORDER BY lastname COLLATE NOCASE ASC, firstname COLLATE NOCASE ASC
  `).all();

  const contactRows = db.prepare(`
    SELECT user_id, name, phone, email
    FROM emergencyContacts
    ORDER BY user_id ASC, id ASC
  `).all();

  const contactsByUser = new Map();
  contactRows.forEach((contact) => {
    if (!contactsByUser.has(contact.user_id)) contactsByUser.set(contact.user_id, []);
    contactsByUser.get(contact.user_id).push(contact);
  });

  const lines = [
    [
      "First Name",
      "Last Name",
      "Date of Birth",
      "Phone Number",
      "Email",
      "Emergency Contacts"
    ].join(",")
  ];

  users.forEach((userRow) => {
    const contacts = contactsByUser.get(userRow.id) || [];
    const allEmergencyInfo = contacts.length
      ? contacts
          .map((contact) => {
            const pieces = [contact.name || "", contact.phone || "", contact.email || ""].filter(Boolean);
            return pieces.join(" | ");
          })
          .join(" || ")
      : "";

    lines.push([
      csvEscape(userRow.firstname || ""),
      csvEscape(userRow.lastname || ""),
      csvEscape(formatBirthdayHuman(userRow.birthday)),
      csvEscape(userRow.phone || ""),
      csvEscape(userRow.email || ""),
      csvEscape(allEmergencyInfo)
    ].join(","));
  });

  const csv = lines.join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="emergency-${Date.now()}.csv"`);
  return res.send(csv);
});

app.get("/admin/export-member-info", mustBeAdmin, (req, res) => {
  const member = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.userid);

  const selectedGroups = {
    corps: true,
    independent: true,
    affiliate: true,
    staff: true,
    uncontracted: true
  };

  const selectedFields = ["firstname", "lastname", "email", "section", "instrument", "shirtSize"];

  return res.render("admin-export-members", {
    member,
    selectedGroups,
    selectedFields,
    rows: [],
    hasResults: false,
    columnOptions: MEMBER_EXPORT_COLUMN_OPTIONS,
    sortBy: "az",
    daysFilter: "all"
  });
});

app.post("/admin/export-member-info", mustBeAdmin, (req, res) => {
  const member = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.userid);

  const selectedGroups = {
    corps: parseCheckboxFlag(req.body.group_corps),
    independent: parseCheckboxFlag(req.body.group_independent),
    affiliate: parseCheckboxFlag(req.body.group_affiliate),
    staff: parseCheckboxFlag(req.body.group_staff),
    uncontracted: parseCheckboxFlag(req.body.group_uncontracted)
  };

  const selectedFieldsRaw = Array.isArray(req.body.export_fields)
    ? req.body.export_fields
    : (req.body.export_fields ? [req.body.export_fields] : []);

  const selectedFields = selectedFieldsRaw.filter((field) => Object.prototype.hasOwnProperty.call(MEMBER_EXPORT_COLUMN_OPTIONS, field));

  const normalizedFields = selectedFields.length
    ? selectedFields
    : ["firstname", "lastname", "email"];

  const sortBy = ["newest", "oldest", "az"].includes(req.body.sort_by) ? req.body.sort_by : "az";
  const daysFilter = ["30", "60", "90"].includes(req.body.days_filter) ? req.body.days_filter : "all";

  const rows = buildMemberExportRows(selectedGroups, normalizedFields, sortBy, daysFilter);

  return res.render("admin-export-members", {
    member,
    selectedGroups,
    selectedFields: normalizedFields,
    rows,
    hasResults: true,
    columnOptions: MEMBER_EXPORT_COLUMN_OPTIONS,
    sortBy,
    daysFilter
  });
});

app.post("/admin/export-member-info/csv", mustBeAdmin, (req, res) => {
  const selectedGroups = {
    corps: parseCheckboxFlag(req.body.group_corps),
    independent: parseCheckboxFlag(req.body.group_independent),
    affiliate: parseCheckboxFlag(req.body.group_affiliate),
    staff: parseCheckboxFlag(req.body.group_staff),
    uncontracted: parseCheckboxFlag(req.body.group_uncontracted)
  };

  const selectedFieldsRaw = Array.isArray(req.body.export_fields)
    ? req.body.export_fields
    : (req.body.export_fields ? [req.body.export_fields] : []);

  const selectedFields = selectedFieldsRaw.filter((field) => Object.prototype.hasOwnProperty.call(MEMBER_EXPORT_COLUMN_OPTIONS, field));

  const normalizedFields = selectedFields.length
    ? selectedFields
    : ["firstname", "lastname", "email"];

  const sortBy = ["newest", "oldest", "az"].includes(req.body.sort_by) ? req.body.sort_by : "az";
  const daysFilter = ["30", "60", "90"].includes(req.body.days_filter) ? req.body.days_filter : "all";

  const rows = buildMemberExportRows(selectedGroups, normalizedFields, sortBy, daysFilter);

  const headerLine = normalizedFields
    .map((field) => csvEscape(MEMBER_EXPORT_COLUMN_OPTIONS[field]))
    .join(",");

  const bodyLines = rows.map((row) => {
    return normalizedFields.map((field) => csvEscape(row[field] || "")).join(",");
  });

  const csv = [headerLine, ...bodyLines].join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="member-info-${Date.now()}.csv"`);
  return res.send(csv);
});

app.get("/admin/export-allergies.csv", mustBeAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT
      u.firstname,
      u.lastname,
      u.email,
      u.phone,
      u.section,
      u.instrument,
      a.allergies
    FROM users u
    INNER JOIN allergies a ON a.user_id = u.id
    WHERE (a.no_allergies = 0 OR a.no_allergies IS NULL)
      AND a.allergies IS NOT NULL
      AND TRIM(a.allergies) != ''
    ORDER BY u.lastname COLLATE NOCASE ASC, u.firstname COLLATE NOCASE ASC
  `).all();

  const headers = ["First Name", "Last Name", "Email", "Phone", "Section", "Instrument", "Allergies"];
  const headerLine = headers.map(csvEscape).join(",");

  const bodyLines = rows.map((row) => [
    row.firstname || "",
    row.lastname || "",
    row.email || "",
    row.phone || "",
    row.section || "",
    row.instrument || "",
    row.allergies || ""
  ].map(csvEscape).join(","));

  const csv = [headerLine, ...bodyLines].join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="member-allergies-${Date.now()}.csv"`);
  return res.send(csv);
});

app.post(
  "/contracts-admin",
  mustBeAdmin,
  pdfUpload.fields([
    { name: "corps_pdf", maxCount: 1 },
    { name: "independent_pdf", maxCount: 1 },
    { name: "affiliate_pdf", maxCount: 1 },
  ]),
  (req, res) => {
    const now = Date.now();

    if (req.files && req.files["corps_pdf"] && req.files["corps_pdf"][0]) {
      const file = req.files["corps_pdf"][0];
      const pdfPath = `/pdf/publicpdf/${file.filename}`;
      db.prepare(
        "INSERT INTO contractPdfs (ensemble, pdf_path, uploaded_at) VALUES (?, ?, ?)"
      ).run("corps", pdfPath, now);
    }

    if (req.files && req.files["independent_pdf"] && req.files["independent_pdf"][0]) {
      const file = req.files["independent_pdf"][0];
      const pdfPath = `/pdf/publicpdf/${file.filename}`;
      db.prepare(
        "INSERT INTO contractPdfs (ensemble, pdf_path, uploaded_at) VALUES (?, ?, ?)"
      ).run("independent", pdfPath, now);
    }

    if (req.files && req.files["affiliate_pdf"] && req.files["affiliate_pdf"][0]) {
      const file = req.files["affiliate_pdf"][0];
      const pdfPath = `/pdf/publicpdf/${file.filename}`;
      db.prepare(
        "INSERT INTO contractPdfs (ensemble, pdf_path, uploaded_at) VALUES (?, ?, ?)"
      ).run("affiliate", pdfPath, now);
    }

    req.session.flashMessage = "Contract PDFs updated.";
    return res.redirect("/contracts-admin");
  }
);

app.get("/admin-rsvps", mustBeAdmin, (req, res) => {
  const eventId = req.query.eventId ? Number(req.query.eventId) : null;
  const searchQuery = (req.query.q || "").trim();

  // For the event dropdown
  const allEvents = db.prepare(`
    SELECT id, title, datetime, location, slug
    FROM events
    ORDER BY datetime DESC
  `).all();

  let events = [];
  let formsStatus = {};
  let childrenByParent = {};
  let searchResults = [];

  if (eventId) {
    // Get RSVPs + users for the selected event only
    const rows = db.prepare(`
      SELECT
        e.id            AS event_id,
        e.title         AS event_title,
        e.slug          AS event_slug,
        e.datetime      AS event_datetime,
        e.location      AS event_location,
        r.id            AS rsvp_id,
        r.paid          AS rsvp_paid,
        r.checked_in    AS rsvp_checked,
        u.id            AS user_id,
        u.firstname,
        u.lastname,
        u.section,
        u.instrument,
        u.staff,
        u.admin,
        u.parentId
      FROM events e
      LEFT JOIN rsvp r ON r.event_id = e.id
      LEFT JOIN users u ON u.id = r.user_id
      WHERE e.id = ?
      ORDER BY e.datetime DESC, u.lastname, u.firstname
    `).all(eventId);

    const eventsMap = new Map();
    const userIds = new Set();
    const rsvpByUser = {};

    for (const row of rows) {
      if (!eventsMap.has(row.event_id)) {
        eventsMap.set(row.event_id, {
          id: row.event_id,
          title: row.event_title,
          slug: row.event_slug,
          datetime: row.event_datetime,
          location: row.event_location,
          rsvps: [],
        });
      }

      if (row.user_id) {
        userIds.add(row.user_id);

        const evt = eventsMap.get(row.event_id);
        evt.rsvps.push({
          rsvp_id: row.rsvp_id,
          paid: !!row.rsvp_paid,
          checked_in: !!row.rsvp_checked,
          user_id: row.user_id,
          firstname: row.firstname,
          lastname: row.lastname,
          section: row.section,
          instrument: row.instrument,
          staff: row.staff,
          admin: row.admin,
          parentId: row.parentId,
        });

        rsvpByUser[row.user_id] = {
          id: row.rsvp_id,
          paid: !!row.rsvp_paid,
          checked_in: !!row.rsvp_checked,
        };
      }
    }

    // Forms status per user (initially just for RSVP users)
    formsStatus = {};
    for (const uid of userIds) {
      const required = getRequiredFormsForUser(uid);
      const uploads = db
        .prepare("SELECT * FROM formUploads WHERE user_id = ?")
        .all(uid);
      const leftover = markUploadsAndCount(required, uploads);
      formsStatus[uid] = {
        requiredCount: required.length,
        missingCount: leftover,
      };
    }

    // Children display under parents (for RSVP list)
    const parentIds = [...userIds].filter(Boolean);
    const childrenBy = {};

    if (parentIds.length) {
      const placeholders = parentIds.map(() => "?").join(",");
      const childRows = db
        .prepare(
          `
          SELECT id, firstname, lastname, parentId
          FROM users
          WHERE parentId IN (${placeholders})
          ORDER BY lastname COLLATE NOCASE, firstname COLLATE NOCASE
          `
        )
        .all(...parentIds);

      for (const child of childRows) {
        if (!childrenBy[child.parentId]) {
          childrenBy[child.parentId] = [];
        }
        childrenBy[child.parentId].push({
          id: child.id,
          firstname: child.firstname,
          lastname: child.lastname,
        });
      }
    }

    childrenByParent = childrenBy;
    events = Array.from(eventsMap.values());

    // === Search across ALL members for quick check-in ===
    if (searchQuery) {
      const like = `%${searchQuery}%`;

      const users = db
        .prepare(
          `
          SELECT
            id,
            firstname,
            lastname,
            section,
            instrument,
            staff,
            admin,
            parentId,
            email
          FROM users
          WHERE (parent IS NULL OR parent = 0)
            AND (
              firstname LIKE ? OR
              lastname LIKE ? OR
              email LIKE ?
            )
          ORDER BY lastname COLLATE NOCASE, firstname COLLATE NOCASE
          `
        )
        .all(like, like, like);

      // Extend formsStatus to cover these users too
      const extraIds = [];
      for (const u of users) {
        if (!formsStatus[u.id]) {
          extraIds.push(u.id);
        }
      }
      for (const uid of extraIds) {
        const required = getRequiredFormsForUser(uid);
        const uploads = db
          .prepare("SELECT * FROM formUploads WHERE user_id = ?")
          .all(uid);
        const leftover = markUploadsAndCount(required, uploads);
        formsStatus[uid] = {
          requiredCount: required.length,
          missingCount: leftover,
        };
      }

      // Build searchResults with rsvp info if it exists
      searchResults = users.map((u) => {
        let rsvp = rsvpByUser[u.id];
        if (!rsvp) {
          const existing = db
            .prepare(
              "SELECT id, paid, checked_in FROM rsvp WHERE event_id = ? AND user_id = ?"
            )
            .get(eventId, u.id);
          if (existing) {
            rsvp = {
              id: existing.id,
              paid: !!existing.paid,
              checked_in: !!existing.checked_in,
            };
            rsvpByUser[u.id] = rsvp;
          }
        }

        return {
          user: u,
          paid: rsvp ? !!rsvp.paid : false,
          checked_in: rsvp ? !!rsvp.checked_in : false,
        };
      });
    }
  }

  res.render("admin-rsvps", {
    allEvents,
    events,
    selectedEventId: eventId,
    formsStatus,
    childrenByParent,
    searchResults,
    searchQuery,
  });
});


app.post("/admin-rsvps/:eventId/checkin/:userId", mustBeAdmin, (req, res) => {
  const eventId = Number(req.params.eventId);
  const userId = Number(req.params.userId);
  const markPaid = req.body.markPaid === "1";

  const event = db.prepare("SELECT * FROM events WHERE id = ?").get(eventId);
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);

  if (!event || !user) {
    req.session.flashMessage = "Event or user not found.";
    return res.redirect(`/admin-rsvps?eventId=${eventId}`);
  }

  // Ensure RSVP row exists
  let rsvp = db
    .prepare("SELECT * FROM rsvp WHERE event_id = ? AND user_id = ?")
    .get(eventId, userId);

  if (!rsvp) {
    db.prepare(
      "INSERT INTO rsvp (user_id, event_id, paid, checked_in) VALUES (?, ?, ?, ?)"
    ).run(userId, eventId, markPaid ? 1 : 0, 1);
  } else {
    db.prepare(
      "UPDATE rsvp SET checked_in = 1, paid = CASE WHEN ? THEN 1 ELSE paid END WHERE id = ?"
    ).run(markPaid ? 1 : 0, rsvp.id);
  }

  // If we marked as paid, also write a paymentHistory row
  if (markPaid) {
    const amountCents = (event.cost || 0) * 100;
    const title = `Event RSVP (cash): ${event.title}`;
    const desc = `RSVP fee collected in cash for event on ${new Date(
      event.datetime
    ).toLocaleString("en-US")}.`;

    db.prepare(`
      INSERT INTO paymentHistory (title, description, amount, method, date, user_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(title, desc, amountCents, "Cash", Date.now(), userId);
  }

  req.session.flashMessage = "Check-in recorded.";
  return res.redirect(`/admin-rsvps?eventId=${eventId}`);
});

app.post("/admin-rsvps/:eventId/email/:userId", mustBeAdmin, async (req, res) => {
  const eventId = Number(req.params.eventId);
  const userId = Number(req.params.userId);

  const event = db.prepare("SELECT * FROM events WHERE id = ?").get(eventId);
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);

  if (!event || !user || !user.email) {
    req.session.flashMessage = "Cannot send email: missing event, user, or email.";
    return res.redirect(`/admin-rsvps?eventId=${eventId}`);
  }

  const baseUrl = process.env.BASEURL || "https://boisegems.org";
  const eventUrl = `${baseUrl}/event/${event.slug}`;

  const subject = `Payment needed for ${event.title}`;
  const html = `
    <p>Hi ${user.firstname},</p>
    <p>This is a reminder that your RSVP payment for the event
    <strong>${event.title}</strong> on
    <strong>${new Date(event.datetime).toLocaleString("en-US")}</strong>
    has not yet been completed.</p>
    <p>You can finish your RSVP and payment here:</p>
    <p><a href="${eventUrl}">${eventUrl}</a></p>
    <p>If you believe you've already paid, you can ignore this email or contact us so we can double-check.</p>
    <p>â€“ Boise Gems</p>
  `;

  try {
    await sendEmail(user.email, subject, html);
    req.session.flashMessage = "Payment reminder email sent.";
  } catch (err) {
    console.error("RSVP reminder email error:", err);
    req.session.flashMessage = "Failed to send reminder email.";
  }

  return res.redirect(`/admin-rsvps?eventId=${eventId}`);
});


app.get("/admin-forms", mustBeAdmin, (req, res) => {
  const membership = String(req.query.membership || "all").toLowerCase(); // all|corps|independent|affiliate
  const sectionFilter = String(req.query.section || "").trim();

  const where = ["1=1"];
  const params = [];

  if (membership === "corps") {
    where.push("contractedCorps = 1");
  } else if (membership === "independent") {
    where.push("contractedIndependent = 1");
  } else if (membership === "affiliate") {
    where.push("contractedAffiliate = 1");
  }

  if (sectionFilter) {
    where.push("section = ?");
    params.push(sectionFilter);
  }

  const users = db
    .prepare(
      `
      SELECT id, firstname, lastname, section, instrument,
             contractedCorps, contractedIndependent, contractedAffiliate
      FROM users
      WHERE ${where.join(" AND ")}
      ORDER BY lastname, firstname
    `
    )
    .all(...params);

  const rows = [];
  for (const u of users) {
    const required = getRequiredFormsForUser(u.id);
    const uploads = db
      .prepare("SELECT * FROM formUploads WHERE user_id = ?")
      .all(u.id);
    const missing = markUploadsAndCount(required, uploads);

    rows.push({
      user: u,
      requiredCount: required.length,
      missingCount: missing,
    });
  }

  // finished first
  rows.sort((a, b) => {
    const aFinished = a.requiredCount > 0 && a.missingCount === 0;
    const bFinished = b.requiredCount > 0 && b.missingCount === 0;
    if (aFinished && !bFinished) return -1;
    if (!aFinished && bFinished) return 1;
    return 0;
  });

  res.render("admin-forms", {
    rows,
    membership,
    sectionFilter,
  });
});




// Create staff
app.post("/staff/new", mustBeAdmin, imageUpload.single("image"), processImageJpgOptional, (req, res) => {
  const first    = String(req.body.first || "").trim();
  const last     = String(req.body.last || "").trim();
  const position = String(req.body.position || "").trim();
  const category = (String(req.body.category || "").trim()) || "Other";
  const bio      = String(req.body.bio || "").trim();

  if (!first || !last || !position) {
    req.session.flashMessage = "First, Last, and Position are required.";
    return res.redirect("/staff/new");
  }

  // Use uploaded image if present; otherwise NULL (frontend can fall back to /img/ui/gem.png)
  const imageOrNull = req.savedFilename ? req.savedFilename : null;

  // If an explicit sort_order was provided, respect it; otherwise place next within category
  const maxRow = db.prepare(
    `SELECT COALESCE(MAX(sort_order), 0) AS maxo FROM staff WHERE category = ?`
  ).get(category);

  const sortOrderInt = Number.isFinite(Number(req.body.sort_order))
    ? parseInt(req.body.sort_order, 10)
    : (maxRow?.maxo || 0) + 1;

  const now = Date.now();
  const slug = slugify(`${first} ${last}`);

  db.prepare(`
    INSERT INTO staff (first, last, position, category, bio, image, sort_order, created_at, updated_at, slug)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(first, last, position, category, bio, imageOrNull, sortOrderInt, now, now, slug);

  res.redirect("/staff-admin");
});


// Edit staff
app.get("/staff/:id/edit", mustBeAdmin, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare(`SELECT * FROM staff WHERE id = ?`).get(id);
  if (!row) return res.redirect("/staff-admin");
  res.render("staff-edit", { staffer: row, categories: STAFF_CATEGORIES });
});

app.post("/staff/:id/edit", mustBeAdmin, imageUpload.single("image"), processImageJpgOptional, (req, res) => {
  const id  = Number(req.params.id);
  const row = db.prepare(`SELECT * FROM staff WHERE id = ?`).get(id);
  if (!row) return res.redirect("/staff-admin");

  const first    = String(req.body.first || "").trim();
  const last     = String(req.body.last || "").trim();
  const position = String(req.body.position || "").trim();
  const category = String(req.body.category || "").trim() || "Other";
  const bio      = String(req.body.bio || "").trim();

  if (!first || !last || !position) {
    req.session.flashMessage = "First, Last, and Position are required.";
    return res.redirect(`/staff/${id}/edit`);
  }

  // Decide sort_order:
  // - If user typed one, use it.
  // - If category changed and no order was provided, push to end of new category.
  // - Else keep existing.
  const sortRaw = req.body.sort_order;
  let sortOrderInt;

  if (sortRaw !== undefined && String(sortRaw).trim() !== "" && Number.isFinite(Number(sortRaw))) {
    sortOrderInt = parseInt(sortRaw, 10);
  } else if (category !== row.category) {
    const maxRow = db.prepare(`SELECT COALESCE(MAX(sort_order), 0) AS maxo FROM staff WHERE category = ?`).get(category);
    sortOrderInt = (maxRow?.maxo || 0) + 1;
  } else {
    sortOrderInt = Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : 0;
  }

  // Image: keep existing unless a new one was uploaded
  const image = req.savedFilename ? req.savedFilename : row.image;

  const slug = slugify(`${first} ${last}`);
  const now  = Date.now();

  db.prepare(`
    UPDATE staff
       SET first=?, last=?, position=?, category=?, bio=?, image=?, sort_order=?, slug=?, updated_at=?
     WHERE id=?
  `).run(first, last, position, category, bio, image, sortOrderInt, slug, now, id);

  res.redirect("/staff-admin");
});


// Delete staff
app.post("/staff/:id/delete", mustBeAdmin, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare(`SELECT * FROM staff WHERE id = ?`).get(id);
  if (row) {
    // optional: remove old image file if you want
    // if (row.image) { try { fs.unlinkSync(path.join(__dirname, "public", "img", "publicupload", row.image)); } catch(_){} }
    db.prepare(`DELETE FROM staff WHERE id = ?`).run(id);
  }
  res.redirect("/staff-admin");
});

// Reorder staff within categories (expects fields like order[<id>]=<number>)
app.post("/staff/reorder", mustBeAdmin, (req, res) => {
  const orders = req.body.order || {}; // object keyed by staff id
  const stmt = db.prepare(`UPDATE staff SET sort_order = ?, updated_at = ? WHERE id = ?`);
  const now = Date.now();

  for (const idStr of Object.keys(orders)) {
    const id = Number(idStr);
    const val = Number(orders[idStr]);
    if (Number.isFinite(id) && Number.isFinite(val)) {
      stmt.run(val, now, id);
    }
  }
  res.redirect("/staff-admin");
});

const getStaffForAboutPages = () => {
  return db.prepare(`
    SELECT id, first, last, position, category, bio, image, slug, sort_order
    FROM staff
    ORDER BY category COLLATE NOCASE, sort_order ASC, last COLLATE NOCASE
  `).all();
};

const normalizeStaffText = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const getCombinedStaffText = (s) =>
  `${normalizeStaffText(s.category)} ${normalizeStaffText(s.position)}`.trim();

const matchesAnyWord = (text, words) => words.some((word) => text.includes(word));

const buildStaffSections = (staff, sectionDefs) => {
  return sectionDefs
    .map((section) => ({
      title: section.title,
      staff: staff.filter(section.match)
    }))
    .filter((section) => section.staff.length > 0);
};

const getBaseStaffSectionDefs = () => [
  {
    title: "Director",
    match: (s) => matchesAnyWord(getCombinedStaffText(s), ["director"])
  },
  {
    title: "Admin",
    match: (s) => matchesAnyWord(getCombinedStaffText(s), ["admin"])
  }
];

app.get("/our-history-about", (req, res) => {
  const staff = getStaffForAboutPages();

  const staffSections = buildStaffSections(staff, [
    ...getBaseStaffSectionDefs(),
    {
      title: "Board",
      match: (s) => {
        const text = getCombinedStaffText(s);
        return text.includes("board") && !text.includes("advisory");
      }
    },
    {
      title: "Advisory Board",
      match: (s) => {
        const text = getCombinedStaffText(s);
        return text.includes("advisory");
      }
    }
  ]);

  res.render("our-history-about", { staffSections });
});

app.get("/boise-gems-corps-about", (req, res) => {
  const staff = getStaffForAboutPages();
  const nonBGIStaff = staff.filter((s) => !getCombinedStaffText(s).includes("bgi"));

  const staffSections = buildStaffSections(nonBGIStaff, [
    ...getBaseStaffSectionDefs(),
    {
      title: "Design",
      match: (s) => matchesAnyWord(getCombinedStaffText(s), ["design"])
    },
    {
      title: "Brass",
      match: (s) => matchesAnyWord(getCombinedStaffText(s), ["brass"])
    },
    {
      title: "Percussion",
      match: (s) => {
        const text = getCombinedStaffText(s);
        return text.includes("percussion") && !text.includes("front ensemble");
      }
    },
    {
      title: "Front Ensemble",
      match: (s) => matchesAnyWord(getCombinedStaffText(s), ["front ensemble"])
    },
    {
      title: "Color Guard",
      match: (s) => {
        const text = getCombinedStaffText(s);
        return text.includes("color guard") || text.includes("colorguard");
      }
    },
    {
      title: "Visual",
      match: (s) => matchesAnyWord(getCombinedStaffText(s), ["visual"])
    }
  ]);

  res.render("boise-gems-corps-about", { staffSections });
});

app.get("/boise-gems-independent", (req, res) => {
  const staff = getStaffForAboutPages();
  const baseSections = buildStaffSections(staff, getBaseStaffSectionDefs());

  const bgiCategoryMap = new Map();
  staff.forEach((s) => {
    const category = String(s.category || "").trim();
    if (!/^bgi\b/i.test(category)) return;

    if (!bgiCategoryMap.has(category)) bgiCategoryMap.set(category, []);
    bgiCategoryMap.get(category).push(s);
  });

  const bgiSections = Array.from(bgiCategoryMap.entries()).map(([title, categoryStaff]) => ({
    title,
    staff: categoryStaff
  }));

  res.render("boise-gems-independent", { staffSections: [...baseSections, ...bgiSections] });
});

app.get("/about", (req, res) => {
  res.redirect("/our-history-about");
});



app.get("/staff/:slug", (req, res) => {
  const s = db.prepare(`
    SELECT id, first, last, position, category, bio, image, slug
    FROM staff WHERE slug = ?
  `).get(req.params.slug);

  if (!s) return res.status(404).render("404");

  const base = "https://boisegems.org";
  const img  = s.image ? `${base}${s.image}` : `${base}/img/ui/gem.png`;
  const title = `${s.first} ${s.last} â€” ${s.position} | Boise Gems`;

  res.render("staff-show", {
    s,
    meta: {
      title,
      description: s.bio?.slice(0, 160) || `${s.first} ${s.last} â€” ${s.position}`,
      image: img,
      url: `${base}/staff/${s.slug}`
    }
  });
});

// GET /whistleblower
app.get("/whistleblower", mustBeLoggedIn, (req, res) => {
  return res.render("whistleblower");
});

// POST /whistleblower
app.post("/whistleblower", async (req, res) => {
  try {
    const message = String(req.body.content || "").trim();
    const followEmail = String(req.body.email || "").trim();
    const token = req.body["g-recaptcha-response"];

    // Required: message + captcha token
    if (!message) {
      return res.status(400).render("message", { message: "Please provide details about your concern." });
    }
    if (!token) {
      return res.status(400).render("message", { message: "Captcha verification failed. Please try again." });
    }

    // Verify captcha
    const verifyURL = "https://www.google.com/recaptcha/api/siteverify";
    const params = new URLSearchParams({
      secret: process.env.RECAPTCHA_SECRET || "",
      response: token,
      remoteip: req.ip || ""
    });

    const { data } = await axios.post(verifyURL, params);
    if (!data || !data.success) {
      return res.status(400).render("message", { message: "Captcha verification failed. Please try again." });
    }

    // Build email body (anonymous unless optional email provided)
    const ip = req.ip || "unknown";
    const ua = req.headers["user-agent"] || "unknown";
    const when = new Date().toLocaleString("en-US", { year:"numeric", month:"long", day:"numeric", hour:"numeric", minute:"2-digit" });

    const html = `
      <h1>Whistleblower Report</h1>
      <p><strong>Submitted:</strong> ${when}</p>
      <p><strong>Anonymous:</strong> ${followEmail ? "No (follow-up email provided)" : "Yes"}</p>
      ${followEmail ? `<p><strong>Follow-up Email:</strong> ${followEmail}</p>` : ""}
      <hr/>
      <p style="white-space:pre-wrap;">${message.replace(/</g,"&lt;").replace(/>/g,"&gt;")}</p>
      <hr/>
      <p><small>IP: ${ip}</small></p>
      <p><small>User-Agent: ${ua}</small></p>
    `;

    await sendEmail(MasterEmail, "Whistleblower Report â€” Boise Gems", html);

    return res.render("message", {
      message: "Thank you. Your whistleblower report has been submitted and will be investigated."
    });
  } catch (err) {
    console.error("Whistleblower error:", err);
    return res.status(500).render("message", { message: "Something went wrong. Please try again shortly." });
  }
});

function getFolderWithAncestors(folderId) {
  const getFolder = db.prepare("SELECT * FROM file_folders WHERE id = ?");
  const chain = [];
  let current = getFolder.get(folderId);
  if (!current) return null;
  chain.unshift(current);
  while (current.parent_id) {
    current = getFolder.get(current.parent_id);
    if (!current) break;
    chain.unshift(current);
  }
  return chain; // [root, ..., target]
}

function deriveFolderContext(chain) {
  if (!chain || !chain.length) return null;
  const target = chain[chain.length - 1];
  let scope = target.scope;
  let year = target.year;
  let section = target.section;

  // inherit section from ancestors if missing
  for (let i = chain.length - 1; i >= 0; i--) {
    if (!section && chain[i].section) section = chain[i].section;
  }

  return { scope, year, section, folder: target };
}

function getSectionRoster(section, scope) {
  if (!section) return [];
  const rows = db.prepare(`
    SELECT
      id,
      firstname,
      lastname,
      section,
      instrument,
      contractedCorps,
      contractedIndependent,
      contractedAffiliate,
      img,
      indoorSection,
      indoorInstrument
    FROM users
    WHERE LOWER(section) = LOWER(?)
      AND (parent IS NULL OR parent = 0)
  `).all(section);

  const viewsByUser = {};
  return rows;
}



function buildVisibilityFlags(audience) {
  // audience: 'corps', 'independent', 'affiliate', 'both', 'all_contracted', 'everyone'
  let allow_corps = 0;
  let allow_independent = 0;
  let allow_affiliate = 0;
  let allow_noncontracted = 0;

  switch (audience) {
    case "corps":
      allow_corps = 1;
      break;
    case "independent":
      allow_independent = 1;
      break;
    case "affiliate":
      allow_affiliate = 1;
      break;
    case "both":
      allow_corps = 1;
      allow_independent = 1;
      break;
    case "all_contracted":
      allow_corps = 1;
      allow_independent = 1;
      allow_affiliate = 1;
      break;
    case "everyone":
      allow_corps = 1;
      allow_independent = 1;
      allow_affiliate = 1;
      allow_noncontracted = 1;
      break;
    default:
      allow_corps = 1;
      allow_independent = 1;
  }

  return { allow_corps, allow_independent, allow_affiliate, allow_noncontracted };
}

function canUserSeeFileItem(userRow, fileRow) {
  if (!userRow) return false;
  const isCorps = !!userRow.contractedCorps;
  const isInd = !!userRow.contractedIndependent;
  const isAffiliate = !!userRow.contractedAffiliate;

  if (fileRow.allow_noncontracted) {
    // Everyone can see
    return true;
  }

  // Contracted only
  if (fileRow.allow_corps && isCorps) return true;
  if (fileRow.allow_independent && isInd) return true;
  if (fileRow.allow_affiliate && isAffiliate) return true;

  // Edge case: both but user not contracted in either => no
  return false;
}

// Files home â€” choose Corps vs Indoor (2026)
app.get("/files", mustBeLoggedInAny, (req, res) => {
  res.render("files-root", {
    user: req.user
  });
});



// View a specific folder (and its contents)
app.get("/files/folder/:id", mustBeLoggedInAny, (req, res) => {
  const folderId = parseInt(req.params.id, 10);
  const chain = getFolderWithAncestors(folderId);
  if (!chain) {
    return res.status(404).render("message", { message: "Folder not found." });
  }

  const ctx = deriveFolderContext(chain);
  const folder = ctx.folder;

  // Mark view for this user (members, staff, admins)
  if (req.user && !req.parent) {
    db.prepare(`
      INSERT INTO folder_views (folder_id, user_id, viewed_at)
      VALUES (?, ?, ?)
      ON CONFLICT(folder_id, user_id) DO UPDATE SET viewed_at = excluded.viewed_at
    `).run(folder.id, req.user.userid, Date.now());
  }

  // Subfolders
  const subfolders = db.prepare(`
    SELECT * FROM file_folders
    WHERE parent_id = ?
    ORDER BY name COLLATE NOCASE
  `).all(folder.id);

  // Files (raw)
  const rawFiles = db.prepare(`
    SELECT * FROM file_items
    WHERE folder_id = ?
    ORDER BY created_at DESC
  `).all(folder.id);

  const userRow = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.userid);
  const canManage = !!(req.admin || req.staff);

  const files = rawFiles.filter(f => {
    if (canManage) return true;
    return canUserSeeFileItem(userRow, f);
  });

  // Roster + views
  let roster = [];
  if (ctx.section) {
    const rosterRows = db.prepare(`
      SELECT id, firstname, lastname, section, instrument, img,
              contractedCorps, contractedIndependent, contractedAffiliate
      FROM users
      WHERE LOWER(section) = LOWER(?)
        AND (parent IS NULL OR parent = 0)
    `).all(ctx.section);

    const viewedRows = db.prepare(`
      SELECT user_id FROM folder_views WHERE folder_id = ?
    `).all(folder.id);
    const viewedSet = new Set(viewedRows.map(r => r.user_id));

    roster = rosterRows.map(r => ({
      id: r.id,
      img: r.img,
      name: `${r.firstname} ${r.lastname}`,
      instrument: r.instrument,
      contractedCorps: !!r.contractedCorps,
      contractedIndependent: !!r.contractedIndependent,
      contractedAffiliate: !!r.contractedAffiliate,
      hasViewed: viewedSet.has(r.id)
    }));
  }

  const breadcrumbs = [
    { label: "Files Home", href: "/files" },
    {
      label: ctx.scope === "corps" ? "Corps" : "Indoor",
      href: `/files/${ctx.scope}/${ctx.year}`
    },
    // year & below from chain
    ...chain.map(c => ({
      label: c.name,
      href: c.id === folder.id ? null : `/files/folder/${c.id}`
    }))
  ];

  res.render("files-folder", {
    user: req.user,
    canManage,
    breadcrumbs,
    folder,
    subfolders,
    files,
    roster,
    scope: ctx.scope,
    year: ctx.year,
    section: ctx.section
  });
});

// Create a new subfolder under a section or existing folder
app.post("/files/folder/:id/new-folder", mustBeStaffOrAdmin, (req, res) => {
  const parentId = parseInt(req.params.id, 10);
  const name = String(req.body.name || "").trim();
  if (!name) {
    req.session.flashMessage = "Folder name is required.";
    return res.redirect("back");
  }

  const chain = getFolderWithAncestors(parentId);
  if (!chain) {
    req.session.flashMessage = "Parent folder not found.";
    return res.redirect("back");
  }

  const ctx = deriveFolderContext(chain);
  const parent = ctx.folder;
  const now = Date.now();

  db.prepare(`
    INSERT INTO file_folders (parent_id, scope, year, section, name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(parent.id, ctx.scope, ctx.year, ctx.section, name, now, now);

  // Any content change resets views for this folder
  db.prepare("DELETE FROM folder_views WHERE folder_id = ?").run(parent.id);

  res.redirect(`/files/folder/${parent.id}`);
});

// Upload multiple files into a folder
// Upload multiple files into a folder
app.post("/files/folder/:id/upload", mustBeStaffOrAdmin, filesUpload.array("files", 20), async (req, res) => {
  const folderId = parseInt(req.params.id, 10);
  const chain = getFolderWithAncestors(folderId);
  if (!chain) {
    req.session.flashMessage = "Folder not found.";
    return res.redirect("back");
  }

  const ctx = deriveFolderContext(chain);
  const folder = ctx.folder;

  const audience = String(req.body.audience || "corps").toLowerCase();
  const { allow_corps, allow_independent, allow_affiliate, allow_noncontracted } = buildVisibilityFlags(audience);

  // Titles can be provided as one-per-line
  const titlesText = String(req.body.titlesText || "")
    .split("\n")
    .map(s => s.trim())
    .filter(Boolean);
  const now = Date.now();

  if (!req.files || !req.files.length) {
    req.session.flashMessage = "You must select at least one file to upload.";
    return res.redirect("back");
  }

  const insertFile = db.prepare(`
    INSERT INTO file_items (
      folder_id, uploader_id, title, original_name, stored_path,
      mime_type, size,
      allow_corps, allow_independent, allow_affiliate, allow_noncontracted,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  req.files.forEach((file, idx) => {
    const displayTitle = titlesText[idx] || file.originalname;
    const storedPath = "/uploads/files/" + path.basename(file.path);

    insertFile.run(
      folder.id,
      req.user.userid,
      displayTitle,
      file.originalname,
      storedPath,
      file.mimetype,
      file.size,
      allow_corps,
      allow_independent,
      allow_affiliate,
      allow_noncontracted,
      now
    );
  });

  // Reset views for this folder (new stuff to see)
  db.prepare("DELETE FROM folder_views WHERE folder_id = ?").run(folder.id);

  // âœ… No emails here anymore â€“ just go back to the folder
  res.redirect(`/files/folder/${folder.id}`);
});

app.post("/files/folder/:id/notify", mustBeStaffOrAdmin, async (req, res) => {
  const folderId = parseInt(req.params.id, 10);
  const chain = getFolderWithAncestors(folderId);
  if (!chain) {
    req.session.flashMessage = "Folder not found.";
    return res.redirect("back");
  }

  const ctx = deriveFolderContext(chain);
  const folder = ctx.folder;

  // Default: notify everyone in this section (contracted or not)
  const audience = String(req.body.audience || "everyone").toLowerCase();

  if (!ctx.section) {
    req.session.flashMessage = "This folder is not tied to a specific section.";
    return res.redirect(`/files/folder/${folder.id}`);
  }

  try {
    // Build who weâ€™re emailing
    let where = "LOWER(section) = LOWER(?) AND (parent IS NULL OR parent = 0)";
    const params = [ctx.section];

    if (audience === "corps") {
      where += " AND contractedCorps = 1";
    } else if (audience === "independent") {
      where += " AND contractedIndependent = 1";
    } else if (audience === "affiliate") {
      where += " AND contractedAffiliate = 1";
    } else if (audience === "both") {
      where += " AND (contractedCorps = 1 OR contractedIndependent = 1)";
    } else if (audience === "all_contracted") {
      where += " AND (contractedCorps = 1 OR contractedIndependent = 1 OR contractedAffiliate = 1)";
    } else if (audience === "everyone") {
      // no contract filter
    }

    const rows = db.prepare(`
      SELECT firstname, lastname, email, contractedCorps, contractedIndependent, contractedAffiliate
      FROM users
      WHERE ${where}
    `).all(...params);

    if (!rows.length) {
      req.session.flashMessage = "No members found to notify for this section.";
      return res.redirect(`/files/folder/${folder.id}`);
    }

    const scopeLabel = ctx.scope === "corps" ? "Corps" : "Independent";
    const subject = `New files uploaded â€” ${scopeLabel} ${ctx.section} (${ctx.year})`;

    // Build breadcrumb-style path for email text
    const chain2 = getFolderWithAncestors(folder.id);
    const ctx2 = deriveFolderContext(chain2);
    const crumbs = [
      { label: ctx2.scope === "corps" ? "Corps" : "Indoor" },
      { label: String(ctx2.year) },
      ...(chain2.map(c => ({ label: c.name })))
    ];
    const folderPathText = crumbs.map(b => b.label).join(" / ");
    const pathUrl = `https://boisegems.org/files/folder/${folderId}`;

    let sentCount = 0;

    // âœ… Send separate emails (NOT joined together)
    for (const r of rows) {
      if (!r.email) continue;
      const fullName = `${r.firstname || ""} ${r.lastname || ""}`.trim() || "there";

      const html = `
        <p>Hi ${fullName},</p>
        <p>New files have been uploaded for <strong>${scopeLabel} ${ctx.section}</strong> in the Boise Gems member portal.</p>
        <p><strong>Folder path (inside the portal):</strong> ${folderPathText}</p>
        <p>You can go directly to the folder here:</p>
        <p><a href="${pathUrl}">${pathUrl}</a></p>
        <p>Please log in to the member portal to view the latest music and materials.</p>
      `;

      await sendEmail(r.email, subject, html);
      sentCount++;
    }

    req.session.flashMessage = `Notification sent to ${sentCount} member${sentCount === 1 ? "" : "s"}.`;
  } catch (err) {
    console.error("Error sending file folder notifications:", err);
    req.session.flashMessage = "There was an error sending notifications. Check the server logs.";
  }

  res.redirect(`/files/folder/${folder.id}`);
});

// Delete a file
app.post("/files/item/:id/delete", mustBeStaffOrAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = db.prepare("SELECT * FROM file_items WHERE id = ?").get(id);
  const folderId = row.folder_id;
  if (!row) {
    req.session.flashMessage = "File not found.";
    return res.redirect(`/files/folder/${folderId}`);
  }

  // delete file from disk if present
  try {
    const absPath = path.join(__dirname, "public", row.stored_path.replace(/^\//, ""));
    if (fs.existsSync(absPath)) fs.unlinkSync(absPath);
  } catch (err) {
    console.error("Error deleting file from disk:", err);
  }

  db.prepare("DELETE FROM file_items WHERE id = ?").run(id);

  // reset views on that folder
  db.prepare("DELETE FROM folder_views WHERE folder_id = ?").run(row.folder_id);

  return res.redirect(`/files/folder/${folderId}`);
});

// Year view â€” show sections under Corps/Indoor for 2026
app.get("/files/:scope/:year", mustBeLoggedInAny, (req, res) => {
  const scope = (req.params.scope || "").toLowerCase();
  const year = parseInt(req.params.year, 10) || 2026;

  if (!["corps", "indoor"].includes(scope)) {
    return res.status(404).render("message", { message: "Unknown file group." });
  }

  const yearFolder = db.prepare(`
    SELECT * FROM file_folders
    WHERE parent_id IS NULL
      AND scope = ?
      AND year = ?
      AND name = ?
    LIMIT 1
  `).get(scope, year, String(year));

  if (!yearFolder) {
    return res.status(404).render("message", { message: "No folders for that season yet." });
  }

  const sections = db.prepare(`
    SELECT * FROM file_folders
    WHERE parent_id = ?
    ORDER BY section COLLATE NOCASE
  `).all(yearFolder.id);

  res.render("files-year", {
    user: req.user,
    scope,
    year,
    yearFolder,
    sections
  });
});

app.get("/admin/callbacks", mustBeStaffOrAdmin, (req, res) => {
  // Pull all non-parent users (students); adapt WHERE if you use a different flag
  const members = db.prepare(`
    SELECT 
      id, firstname, lastname, email, section, instrument, img
    FROM users
    WHERE 
      -- NOT admin
      (admin IS NULL OR admin = 0)
      
      AND 
      -- NOT staff
      (staff IS NULL OR staff = 0)
      
      AND
      -- NOT a parent account
      (parent IS NULL OR parent = 0 OR parent = id)
      
      AND
      -- Must have an email
      email IS NOT NULL
      AND TRIM(email) <> ''
      
    ORDER BY lastname COLLATE NOCASE, firstname COLLATE NOCASE
  `).all();

  res.render("admin-callbacks", {
    user: req.user,
    members
  });
});

// Admin: send callback emails
app.post("/admin/callbacks", mustBeStaffOrAdmin, async (req, res) => {
  const rawIds = String(req.body.selectedIds || "")
    .split(",")
    .map(s => parseInt(s, 10))
    .filter(Boolean);

  const message = String(req.body.message || "").trim();

  if (!rawIds.length) {
    req.session.flashMessage = "Select at least one member to send callbacks to.";
    return res.redirect("/admin/callbacks");
  }

  if (!message) {
    req.session.flashMessage = "Callback message is required.";
    return res.redirect("/admin/callbacks");
  }

  const placeholders = rawIds.map(() => "?").join(", ");
  const rows = db.prepare(`
    SELECT id, firstname, lastname, email
    FROM users
    WHERE id IN (${placeholders})
  `).all(...rawIds);

  const subject = "Congratulations! You Received a Callback!";
  const messageHtml = message.replace(/\n/g, "<br/>");

  let sentCount = 0;

  try {
    for (const r of rows) {
      if (!r.email) continue;

      const fullName =
        `${r.firstname || ""} ${r.lastname || ""}`.trim() || "there";

      const html = `
        <p>Hi ${fullName},</p>
        <p>${messageHtml}</p>
        <p>â€” Boise Gems Staff</p>
      `;

      await sendEmail(r.email, subject, html);
      sentCount++;
    }

    req.session.flashMessage =
      `Callback email sent to ${sentCount} member${sentCount === 1 ? "" : "s"}.`;
  } catch (err) {
    console.error("Error sending callback emails:", err);
    req.session.flashMessage =
      "There was an error sending callbacks. Check the server logs.";
  }

  res.redirect("/admin/callbacks");
});

// PUBLIC: audition materials
app.get("/view-materials", (req, res) => {
  // Include the new sections
  const SECTIONS = [
    "brass",
    "drumline",
    "guard",
    "front ensemble",
    "drum major",                 // NEW
    "drumline (independent)",     // NEW
    "front ensemble (independent)"// NEW
  ];

  const rows = db.prepare("SELECT section, pdf FROM materials").all();

  const materials = Object.fromEntries(SECTIONS.map(s => [s, null]));
  for (const r of rows) {
    const key = String(r.section || "").toLowerCase().trim();
    if (materials.hasOwnProperty(key) && r.pdf) {
      materials[key] = r.pdf;
    }
  }

  res.render("view-materials", { materials });
});




// ─────────────────────────────────────────────────────────────────────────────
// MOBILE API  –  /api/mobile/*
// All responses are JSON. Authentication uses a Bearer token in the
// Authorization header (the same JWT secret as the cookie-based web auth).
// No HTML pages are modified; existing website routes are untouched.
// ─────────────────────────────────────────────────────────────────────────────

function mobileAuth(req, res, next) {
  const header = req.headers["authorization"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ ok: false, message: "Unauthorized" });
  try {
    req.user      = jwt.verify(token, process.env.JWTSECRET);
    req.admin     = req.user.admin;
    req.director  = req.user.director || 0;
    req.staff     = req.user.staff;
    req.parent    = req.user.parent;
    req.volunteer = req.user.volunteer || 0;
    req.fan       = req.user.fan || 0;
    next();
  } catch {
    return res.status(401).json({ ok: false, message: "Invalid or expired token" });
  }
}

function mobileAuthOptional(req, res, next) {
  const header = req.headers["authorization"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (token) {
    try {
      req.user      = jwt.verify(token, process.env.JWTSECRET);
      req.admin     = req.user.admin;
      req.director  = req.user.director || 0;
      req.staff     = req.user.staff;
      req.parent    = req.user.parent;
      req.volunteer = req.user.volunteer || 0;
      req.fan       = req.user.fan || 0;
    } catch { /* ignore */ }
  }
  next();
}

// Safe user serializer – avoids type surprises on the mobile client
// ─── Mobile API helpers ──────────────────────────────────────────────────────
// ⚠️  DO NOT ALTER EXISTING WEBSITE TABLES in this section.
//     All schema work (CREATE TABLE, ALTER TABLE) belongs ONLY inside
//     initializeDB() above. Any new mobile-only tables must also live
//     inside initializeDB(). Never alter existing tables here.

/** Serialize a DB user row to a safe, type-consistent JSON object for the
 *  mobile app.  paid/owed are stored as INTEGER CENTS in the DB — we divide
 *  by 100 here so Flutter receives dollars (e.g. 50000 → 500.00).
 *  img is a relative path like /img/publicupload/x.webp — Flutter prepends
 *  the base URL.
 */
function serializeUser(u) {
  if (!u) return null;
  return {
    id: Number(u.id),
    firstname: u.firstname || "",
    lastname: u.lastname || "",
    email: u.email || "",
    phone: u.phone || null,
    birthday: u.birthday != null ? Number(u.birthday) : null,
    admin: u.admin ? 1 : 0,
    director: u.director ? 1 : 0,
    staff: u.staff ? 1 : 0,
    parent: u.parent ? 1 : 0,
    volunteer: u.volunteer ? 1 : 0,
    fan: u.fan ? 1 : 0,
    section: u.section || null,
    instrument: u.instrument || null,
    img: u.img || null,          // relative path — Flutter prepends baseUrl
    contractedCorps: u.contractedCorps ? 1 : 0,
    contractedIndependent: u.contractedIndependent ? 1 : 0,
    contractedAffiliate: u.contractedAffiliate ? 1 : 0,
    shirtSize: u.shirtSize || null,
    paid: (Number(u.paid) || 0) / 100,   // cents → dollars
    owed: (Number(u.owed) || 0) / 100,   // cents → dollars
    address: u.address || null,
    city: u.city || null,
    state: u.state || null,
    zip: u.zip || null,
    school: u.school || null,
    grade: u.grade || null,
    parentId: u.parentId != null ? Number(u.parentId) : null,
  };
}

// POST /api/mobile/login
app.post("/api/mobile/login", (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    if (!email || !password) return res.status(400).json({ ok: false, message: "Email and password required" });

    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    if (!user) return res.status(401).json({ ok: false, message: "Invalid email or password" });

    const match = bcrypt.compareSync(password, user.password);
    if (!match) return res.status(401).json({ ok: false, message: "Invalid email or password" });

    const token = jwt.sign(
      {
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
        userid: Number(user.id),
        firstname: user.firstname || "",
        lastname: user.lastname || "",
        email: user.email || "",
        admin: user.admin ? 1 : 0,
        director: user.director ? 1 : 0,
        staff: user.staff ? 1 : 0,
        parent: user.parent ? 1 : 0,
        volunteer: user.volunteer ? 1 : 0,
        fan: user.fan ? 1 : 0,
      },
      process.env.JWTSECRET
    );

    return res.json({ ok: true, token, user: serializeUser(user) });
  } catch (e) {
    console.error("mobile login error", e);
    return res.status(500).json({ ok: false, message: "Server error during login" });
  }
});

// POST /api/mobile/register-member
app.post("/api/mobile/register-member", (req, res) => {
  try {
    const firstname = String(req.body.firstname || "").trim();
    const lastname  = String(req.body.lastname  || "").trim();
    const email     = String(req.body.email     || "").trim().toLowerCase();
    const phone     = String(req.body.phone     || "").trim();
    const address   = String(req.body.address   || "").trim();
    const section   = String(req.body.section   || "").trim();
    const instrument = String(req.body.instrument || "").trim();
    const password  = String(req.body.password  || "");
    const passwordRetype = String(req.body.passwordRetype || "");
    const birthdayRaw = req.body.birthday || null;
    const birthday  = birthdayRaw ? parseBirthdayToTimestamp(birthdayRaw) : null;

    const errors = [];
    if (!firstname) errors.push("First name is required");
    if (!lastname)  errors.push("Last name is required");
    if (!email)     errors.push("Email is required");
    if (password.length < 8) errors.push("Password must be at least 8 characters");
    if (password !== passwordRetype) errors.push("Passwords do not match");

    const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
    if (existing) errors.push("Email is already in use");

    if (errors.length) return res.status(400).json({ ok: false, message: errors[0], errors });

    const salt = bcrypt.genSaltSync(10);
    const hashed = bcrypt.hashSync(password, salt);
    const emailsecret = bcrypt.hashSync(firstname + Date.now().toString(), salt).replace(/[^a-zA-Z0-9]/g, "");

    const result = db.prepare(
      "INSERT INTO users (firstname, lastname, password, address, birthday, email, phone, verified, emailsecret, section, instrument, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
    ).run(firstname, lastname, hashed, address, birthday, email, phone, 1, emailsecret, section, instrument, Date.now());

    const newId = Number(result.lastInsertRowid);
    db.prepare("INSERT INTO permissions (user_id) VALUES (?)").run(newId);

    const newUser = db.prepare("SELECT * FROM users WHERE id = ?").get(newId);

    const token = jwt.sign(
      { exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30, userid: newId, firstname, lastname, email, admin: 0, director: 0, staff: 0, parent: 0, volunteer: 0, fan: 0 },
      process.env.JWTSECRET
    );

    try { sendEmail(email, "Welcome to Boise Gems!", `<p>Hello ${firstname}, welcome to Boise Gems! Your account has been created.</p>`); } catch(_) {}

    return res.json({ ok: true, token, user: serializeUser(newUser) });
  } catch (e) {
    console.error("mobile register-member error", e);
    return res.status(500).json({ ok: false, message: "Server error during registration" });
  }
});

// POST /api/mobile/register-parent
app.post("/api/mobile/register-parent", (req, res) => {
  try {
    const firstname = String(req.body.firstname || "").trim();
    const lastname  = String(req.body.lastname  || "").trim();
    const email     = String(req.body.email     || "").trim().toLowerCase();
    const phone     = String(req.body.phone     || "").trim();
    const address   = String(req.body.address   || "").trim();
    const password  = String(req.body.password  || "");
    const passwordRetype = String(req.body.passwordRetype || "");
    const birthdayRaw = req.body.birthday || null;
    const birthday  = birthdayRaw ? parseBirthdayToTimestamp(birthdayRaw) : null;

    const errors = [];
    if (!firstname) errors.push("First name is required");
    if (!lastname)  errors.push("Last name is required");
    if (!email)     errors.push("Email is required");
    if (password.length < 8) errors.push("Password must be at least 8 characters");
    if (password !== passwordRetype) errors.push("Passwords do not match");

    const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
    if (existing) errors.push("Email is already in use");

    if (errors.length) return res.status(400).json({ ok: false, message: errors[0], errors });

    const salt = bcrypt.genSaltSync(10);
    const hashed = bcrypt.hashSync(password, salt);

    const result = db.prepare(
      "INSERT INTO users (firstname, lastname, password, address, birthday, email, phone, verified, parent, section, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
    ).run(firstname, lastname, hashed, address, birthday, email, phone, 1, 1, "parent", Date.now());

    const newId = Number(result.lastInsertRowid);
    const newUser = db.prepare("SELECT * FROM users WHERE id = ?").get(newId);

    const token = jwt.sign(
      { exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30, userid: newId, firstname, lastname, email, admin: 0, director: 0, staff: 0, parent: 1, volunteer: 0, fan: 0 },
      process.env.JWTSECRET
    );

    try { sendEmail(email, "Welcome to Boise Gems!", `<p>Hello ${firstname}, welcome to Boise Gems! Your parent account has been created.</p>`); } catch(_) {}

    return res.json({ ok: true, token, user: serializeUser(newUser) });
  } catch (e) {
    console.error("mobile register-parent error", e);
    return res.status(500).json({ ok: false, message: "Server error during registration" });
  }
});

// POST /api/mobile/register-volunteer
app.post("/api/mobile/register-volunteer", (req, res) => {
  try {
    const firstname = String(req.body.firstname || "").trim();
    const lastname  = String(req.body.lastname  || "").trim();
    const email     = String(req.body.email     || "").trim().toLowerCase();
    const phone     = String(req.body.phone     || "").trim();
    const address   = String(req.body.address   || "").trim();
    const password  = String(req.body.password  || "");
    const passwordRetype = String(req.body.passwordRetype || "");

    const errors = [];
    if (!firstname) errors.push("First name is required");
    if (!lastname)  errors.push("Last name is required");
    if (!email)     errors.push("Email is required");
    if (password.length < 8) errors.push("Password must be at least 8 characters");
    if (password !== passwordRetype) errors.push("Passwords do not match");

    const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
    if (existing) errors.push("Email is already in use");

    if (errors.length) return res.status(400).json({ ok: false, message: errors[0], errors });

    const salt = bcrypt.genSaltSync(10);
    const hashed = bcrypt.hashSync(password, salt);

    const result = db.prepare(
      "INSERT INTO users (firstname, lastname, password, address, email, phone, verified, volunteer, section, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)"
    ).run(firstname, lastname, hashed, address, email, phone, 1, 1, "volunteer", Date.now());

    const newId = Number(result.lastInsertRowid);
    const newUser = db.prepare("SELECT * FROM users WHERE id = ?").get(newId);

    const token = jwt.sign(
      { exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30, userid: newId, firstname, lastname, email, admin: 0, director: 0, staff: 0, parent: 0, volunteer: 1, fan: 0 },
      process.env.JWTSECRET
    );

    try { sendEmail(email, "Welcome to Boise Gems!", `<p>Hello ${firstname}, welcome to Boise Gems! Your volunteer account has been created.</p>`); } catch(_) {}

    return res.json({ ok: true, token, user: serializeUser(newUser) });
  } catch (e) {
    console.error("mobile register-volunteer error", e);
    return res.status(500).json({ ok: false, message: "Server error during registration" });
  }
});

// GET /api/mobile/check-email?email=...
app.get("/api/mobile/check-email", (req, res) => {
  try {
    const email = String(req.query.email || "").trim().toLowerCase();
    if (!email) return res.json({ ok: true, available: false, message: "Email required" });
    const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
    return res.json({ ok: true, available: !existing });
  } catch (e) {
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

// GET /api/mobile/me
app.get("/api/mobile/me", mobileAuth, (req, res) => {
  try {
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.userid);
    if (!user) return res.status(404).json({ ok: false, message: "User not found" });

    let allergy = null;
    let emergency = null;
    try { allergy = db.prepare("SELECT * FROM allergies WHERE user_id = ?").get(user.id) || null; } catch(_) {}
    try { emergency = db.prepare("SELECT * FROM emergencyContacts WHERE user_id = ?").get(user.id) || null; } catch(_) {}

    return res.json({ ok: true, user: serializeUser(user), allergy, emergency });
  } catch (e) {
    console.error("mobile /me error", e);
    return res.status(500).json({ ok: false, message: "Server error: " + (e && e.message ? e.message : String(e)) });
  }
});

// GET /api/mobile/events  – upcoming events (next 12 months)
app.get("/api/mobile/events", mobileAuthOptional, (req, res) => {
  try {
    const now = new Date();
    const end = new Date(now.getFullYear(), now.getMonth() + 12, 1);
    const rows = db.prepare(`
      SELECT id, title, slug, datetime, endtime, type, image, description, cost, location, link
      FROM events
      WHERE datetime >= ? AND datetime < ?
      ORDER BY datetime ASC
    `).all(now.toISOString().slice(0, 19), end.toISOString().slice(0, 19));
    return res.json({ ok: true, events: rows });
  } catch (e) {
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

// GET /api/mobile/events/:id
app.get("/api/mobile/events/:id", mobileAuthOptional, (req, res) => {
  try {
    const event = db.prepare("SELECT * FROM events WHERE id = ?").get(Number(req.params.id));
    if (!event) return res.status(404).json({ ok: false, message: "Event not found" });
    let rsvpCount = 0;
    let reservedSelf = false;
    try { rsvpCount = db.prepare("SELECT COUNT(*) as c FROM rsvp WHERE event_id = ?").get(event.id).c; } catch(_) {}
    if (req.user) {
      try { reservedSelf = !!db.prepare("SELECT 1 FROM rsvp WHERE event_id = ? AND user_id = ?").get(event.id, req.user.userid); } catch(_) {}
    }
    return res.json({ ok: true, event, rsvpCount, reservedSelf });
  } catch (e) {
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

// GET /api/mobile/news
app.get("/api/mobile/news", (req, res) => {
  try {
    const posts = db.prepare("SELECT id, title, slug, hero, created_at FROM news ORDER BY created_at DESC LIMIT 30").all();
    return res.json({ ok: true, posts });
  } catch (e) {
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

// GET /api/mobile/news/:slug
app.get("/api/mobile/news/:slug", (req, res) => {
  try {
    const post = db.prepare("SELECT * FROM news WHERE slug = ?").get(req.params.slug);
    if (!post) return res.status(404).json({ ok: false, message: "Not found" });
    return res.json({ ok: true, post });
  } catch (e) {
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

// GET /api/mobile/transactions
app.get("/api/mobile/transactions", mobileAuth, (req, res) => {
  try {
    if (req.parent) return res.status(403).json({ ok: false, message: "Use /parent/child/:id/transactions" });
    const user = db.prepare("SELECT paid, owed FROM users WHERE id = ?").get(req.user.userid);
    const rawPayments = db.prepare("SELECT * FROM paymentHistory WHERE user_id = ? ORDER BY date DESC").all(req.user.userid);
    // amounts in paymentHistory are stored as cents — convert to dollars for mobile
    const payments = rawPayments.map(p => ({ ...p, amount: (Number(p.amount) || 0) / 100 }));
    return res.json({
      ok: true,
      paid: (Number(user?.paid) || 0) / 100,
      owed: (Number(user?.owed) || 0) / 100,
      payments,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, message: "Server error: " + (e && e.message ? e.message : String(e)) });
  }
});

// GET /api/mobile/forms
app.get("/api/mobile/forms", mobileAuth, (req, res) => {
  try {
    if (req.parent) return res.status(403).json({ ok: false, message: "Use /parent/child/:id/forms" });
    const requiredForms = getRequiredFormsForUser(req.user.userid);
    const uploadedForms = db.prepare("SELECT document_id FROM formUploads WHERE user_id = ?").all(req.user.userid);
    markUploadsAndCount(requiredForms, uploadedForms); // mutates requiredForms, adds .uploaded
    return res.json({ ok: true, forms: requiredForms });
  } catch (e) {
    console.error("mobile forms error", e);
    return res.status(500).json({ ok: false, message: "Server error: " + (e && e.message ? e.message : String(e)) });
  }
});

// GET /api/mobile/staff
app.get("/api/mobile/staff", (req, res) => {
  try {
    const staff = db.prepare(
      "SELECT id, first, last, slug, position, category, bio, image, sort_order FROM staff ORDER BY sort_order ASC, last COLLATE NOCASE"
    ).all().map(s => ({
      id:        s.id,
      firstname: s.first  || "",
      lastname:  s.last   || "",
      slug:      s.slug   || null,
      role:      s.position || null,
      section:   s.category || null,
      bio:       s.bio    || null,
      img:       s.image  ? `/img/publicupload/${s.image}` : null,
      sort_order: s.sort_order,
    }));
    return res.json({ ok: true, staff });
  } catch (e) {
    console.error("[Mobile API] staff error:", e.message || e);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

// GET /api/mobile/files
app.get("/api/mobile/files", mobileAuth, (req, res) => {
  try {
    const roots = db.prepare("SELECT * FROM file_folders WHERE parent_id IS NULL ORDER BY scope, year DESC").all();
    return res.json({ ok: true, roots });
  } catch (e) {
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

// GET /api/mobile/files/folder/:id
app.get("/api/mobile/files/folder/:id", mobileAuth, (req, res) => {
  try {
    const folderId = parseInt(req.params.id, 10);
    const folder = db.prepare("SELECT * FROM file_folders WHERE id = ?").get(folderId);
    if (!folder) return res.status(404).json({ ok: false, message: "Folder not found" });
    const subfolders = db.prepare("SELECT * FROM file_folders WHERE parent_id = ? ORDER BY name COLLATE NOCASE").all(folderId);
    const userRow = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.userid);
    const canManage = !!(req.admin || req.staff);
    const rawFiles = db.prepare("SELECT * FROM file_items WHERE folder_id = ? ORDER BY created_at DESC").all(folderId);
    const files = rawFiles.filter(f => canManage || canUserSeeFileItem(userRow, f));
    return res.json({ ok: true, folder, subfolders, files });
  } catch (e) {
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

// GET /api/mobile/dashboard
// Returns role-tailored data so each account type sees what matters most.
app.get("/api/mobile/dashboard", mobileAuth, (req, res) => {
  try {
    const userId  = req.user.userid;
    const today   = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const nowISO  = new Date().toISOString().slice(0, 19);

    // ── Shared: upcoming events & latest news ─────────────────────────────
    const upcomingEvents = db.prepare(`
      SELECT id, title, slug, datetime, type, location
      FROM events WHERE datetime >= ? ORDER BY datetime ASC LIMIT 5
    `).all(nowISO);

    const latestNews = db.prepare(`
      SELECT id, title, slug, hero, created_at FROM news ORDER BY created_at DESC LIMIT 3
    `).all();

    // ── Shared helper: next schedule ──────────────────────────────────────
    function getNextSchedule(includeStaffNotes) {
      try {
        const s = db.prepare(`
          SELECT id, title, date, location, call_time, dismissal_time, notes
          ${includeStaffNotes ? ', staff_notes' : ''}
          FROM schedules WHERE date >= ? ORDER BY date ASC, call_time ASC LIMIT 1
        `).get(today);
        if (!s) return null;
        const blocks = db.prepare(`
          SELECT id, title, start_time, end_time, location, section, block_type, notes, sort_order
          FROM schedule_blocks WHERE schedule_id = ? ORDER BY sort_order ASC, start_time ASC
        `).all(s.id);
        return { ...s, blocks };
      } catch(_) { return null; }
    }

    // ── Member data ───────────────────────────────────────────────────────
    let memberData = null;
    if (!req.parent && !req.fan && !req.staff && !req.admin && !req.director) {
      const user = db.prepare("SELECT paid, owed, section, instrument, contractedCorps, contractedIndependent, contractedAffiliate FROM users WHERE id = ?").get(userId);
      let missingFormsCount = 0;
      try {
        const requiredForms = getRequiredFormsForUser(userId);
        const uploadedForms = db.prepare("SELECT document_id FROM formUploads WHERE user_id = ?").all(userId);
        missingFormsCount = markUploadsAndCount(requiredForms, uploadedForms);
      } catch(_) {}
      const nextSchedule = getNextSchedule(false);
      memberData = {
        paid:                 (Number(user?.paid) || 0) / 100,
        owed:                 (Number(user?.owed) || 0) / 100,
        section:              user?.section || null,
        instrument:           user?.instrument || null,
        contractedCorps:      user?.contractedCorps ? 1 : 0,
        contractedIndependent:user?.contractedIndependent ? 1 : 0,
        contractedAffiliate:  user?.contractedAffiliate ? 1 : 0,
        missingFormsCount,
        nextSchedule,
      };
    }

    // ── Parent data ───────────────────────────────────────────────────────
    let parentData = null;
    if (req.parent) {
      const children = db.prepare(`
        SELECT id, firstname, lastname, section, instrument, paid, owed, img,
               contractedCorps, contractedIndependent, contractedAffiliate
        FROM users WHERE parentId = ?
      `).all(userId).map(serializeUser);

      // Count missing forms across all children
      let totalMissingForms = 0;
      for (const child of children) {
        try {
          const requiredForms = getRequiredFormsForUser(child.id);
          const uploadedForms = db.prepare("SELECT document_id FROM formUploads WHERE user_id = ?").all(child.id);
          totalMissingForms += markUploadsAndCount(requiredForms, uploadedForms);
        } catch(_) {}
      }

      const nextSchedule = getNextSchedule(false);
      parentData = { children, totalMissingForms, nextSchedule };
    }

    // ── Staff data ────────────────────────────────────────────────────────
    let staffData = null;
    if (req.staff && !req.admin && !req.director) {
      const nextSchedule = getNextSchedule(true); // staff sees staff_notes

      // Count of active members for roster awareness
      let memberCount = 0;
      try { memberCount = Number(db.prepare("SELECT COUNT(*) as c FROM users WHERE (parent IS NULL OR parent=0) AND (admin IS NULL OR admin=0) AND (fan IS NULL OR fan=0) AND (staff IS NULL OR staff=0)").get().c); } catch(_) {}

      staffData = { nextSchedule, memberCount };
    }

    // ── Director data ─────────────────────────────────────────────────────
    let directorData = null;
    if (req.director) {
      const nextSchedule = getNextSchedule(true);

      let memberCount = 0, contractedCorps = 0, contractedIndependent = 0;
      try {
        const r = db.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN contractedCorps=1 THEN 1 ELSE 0 END) as corps, SUM(CASE WHEN contractedIndependent=1 THEN 1 ELSE 0 END) as indep FROM users WHERE (parent IS NULL OR parent=0) AND (admin IS NULL OR admin=0) AND (fan IS NULL OR fan=0)").get();
        memberCount = Number(r.total); contractedCorps = Number(r.corps); contractedIndependent = Number(r.indep);
      } catch(_) {}

      let pendingContracts = 0;
      try { pendingContracts = Number(db.prepare("SELECT COUNT(*) as c FROM contractExtension").get().c); } catch(_) {}

      let staffCount = 0;
      try { staffCount = Number(db.prepare("SELECT COUNT(*) as c FROM staff").get().c); } catch(_) {}

      directorData = { nextSchedule, memberCount, contractedCorps, contractedIndependent, pendingContracts, staffCount };
    }

    // ── Admin data ────────────────────────────────────────────────────────
    let adminData = null;
    if (req.admin) {
      let memberCount = 0, contractedCorps = 0, contractedIndependent = 0;
      try {
        const r = db.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN contractedCorps=1 THEN 1 ELSE 0 END) as corps, SUM(CASE WHEN contractedIndependent=1 THEN 1 ELSE 0 END) as indep FROM users WHERE (parent IS NULL OR parent=0) AND (admin IS NULL OR admin=0) AND (fan IS NULL OR fan=0)").get();
        memberCount = Number(r.total); contractedCorps = Number(r.corps); contractedIndependent = Number(r.indep);
      } catch(_) {}

      let pendingContracts = 0;
      try { pendingContracts = Number(db.prepare("SELECT COUNT(*) as c FROM contractExtension").get().c); } catch(_) {}

      // Members with outstanding balance
      let outstandingCount = 0;
      try { outstandingCount = Number(db.prepare("SELECT COUNT(*) as c FROM users WHERE owed > paid AND (parent IS NULL OR parent=0) AND (admin IS NULL OR admin=0) AND (fan IS NULL OR fan=0)").get().c); } catch(_) {}

      // Total outstanding amount
      let totalOutstanding = 0;
      try {
        const r = db.prepare("SELECT SUM(owed - paid) as total FROM users WHERE owed > paid AND (parent IS NULL OR parent=0) AND (admin IS NULL OR admin=0) AND (fan IS NULL OR fan=0)").get();
        totalOutstanding = (Number(r?.total) || 0) / 100;
      } catch(_) {}

      // Volunteer contact count
      let volunteerCount = 0;
      try { volunteerCount = Number(db.prepare("SELECT COUNT(*) as c FROM volunteer_contacts").get().c); } catch(_) {}

      const nextSchedule = getNextSchedule(true);

      // Recent activity: last 3 news + upcoming events already in upcomingEvents
      adminData = {
        memberCount, contractedCorps, contractedIndependent,
        pendingContracts, outstandingCount, totalOutstanding,
        volunteerCount, nextSchedule,
      };
    }

    return res.json({ ok: true, upcomingEvents, latestNews, memberData, parentData, staffData, directorData, adminData });
  } catch (e) {
    console.error("mobile dashboard error", e);
    return res.status(500).json({ ok: false, message: "Server error loading dashboard" });
  }
});

// GET /api/mobile/parent/children
app.get("/api/mobile/parent/children", mobileAuth, (req, res) => {
  try {
    if (!req.parent) return res.status(403).json({ ok: false, message: "Parents only" });
    const children = db.prepare(`
      SELECT id, firstname, lastname, section, instrument, paid, owed, img,
             contractedCorps, contractedIndependent, contractedAffiliate, shirtSize, parentId
      FROM users WHERE parentId = ?
    `).all(req.user.userid).map(serializeUser);
    return res.json({ ok: true, children });
  } catch (e) {
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

// GET /api/mobile/parent/child/:id/transactions
app.get("/api/mobile/parent/child/:id/transactions", mobileAuth, (req, res) => {
  try {
    if (!req.parent) return res.status(403).json({ ok: false, message: "Parents only" });
    const childId = Number(req.params.id);
    const child = db.prepare("SELECT id, firstname, lastname, paid, owed, parentId FROM users WHERE id = ?").get(childId);
    if (!child || Number(child.parentId) !== Number(req.user.userid)) return res.status(403).json({ ok: false, message: "Forbidden" });
    const rawPayments = db.prepare("SELECT * FROM paymentHistory WHERE user_id = ? ORDER BY date DESC").all(childId);
    const payments = rawPayments.map(p => ({ ...p, amount: (Number(p.amount) || 0) / 100 }));
    return res.json({
      ok: true,
      paid: (Number(child.paid) || 0) / 100,
      owed: (Number(child.owed) || 0) / 100,
      payments,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, message: "Server error: " + (e && e.message ? e.message : String(e)) });
  }
});

// GET /api/mobile/parent/child/:id/forms
app.get("/api/mobile/parent/child/:id/forms", mobileAuth, (req, res) => {
  try {
    if (!req.parent) return res.status(403).json({ ok: false, message: "Parents only" });
    const childId = Number(req.params.id);
    const child = db.prepare("SELECT id, parentId FROM users WHERE id = ?").get(childId);
    if (!child || Number(child.parentId) !== Number(req.user.userid)) return res.status(403).json({ ok: false, message: "Forbidden" });
    const requiredForms = getRequiredFormsForUser(childId);
    const uploadedForms = db.prepare("SELECT document_id FROM formUploads WHERE user_id = ?").all(childId);
    markUploadsAndCount(requiredForms, uploadedForms);
    return res.json({ ok: true, forms: requiredForms });
  } catch (e) {
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

// GET /api/mobile/admin/members
app.get("/api/mobile/admin/members", mobileAuth, (req, res) => {
  try {
    if (!req.admin && !req.staff) return res.status(403).json({ ok: false, message: "Staff/admin only" });
    const members = db.prepare(`
      SELECT id, firstname, lastname, email, phone, section, instrument, paid, owed, img,
             contractedCorps, contractedIndependent, contractedAffiliate, shirtSize, admin, staff, parentId
      FROM users
      WHERE (parent IS NULL OR parent = 0) AND (fan IS NULL OR fan = 0)
      ORDER BY lastname COLLATE NOCASE, firstname COLLATE NOCASE
    `).all().map(serializeUser);
    return res.json({ ok: true, members });
  } catch (e) {
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

// GET /api/mobile/admin/stats
app.get("/api/mobile/admin/stats", mobileAuth, (req, res) => {
  try {
    if (!req.admin && !req.staff) return res.status(403).json({ ok: false, message: "Staff/admin only" });
    const totalMembers = db.prepare("SELECT COUNT(*) as c FROM users WHERE (parent IS NULL OR parent=0) AND (admin IS NULL OR admin=0) AND (fan IS NULL OR fan=0) AND (staff IS NULL OR staff=0)").get().c;
    const contractedCorps = db.prepare("SELECT COUNT(*) as c FROM users WHERE contractedCorps = 1").get().c;
    const contractedIndependent = db.prepare("SELECT COUNT(*) as c FROM users WHERE contractedIndependent = 1").get().c;
    const totalOwed = db.prepare("SELECT COALESCE(SUM(owed),0) as s FROM users").get().s;
    const totalPaid = db.prepare("SELECT COALESCE(SUM(paid),0) as s FROM users").get().s;
    const recentPayments = db.prepare("SELECT * FROM paymentHistory ORDER BY date DESC LIMIT 10").all();
    return res.json({
      ok: true,
      totalMembers: Number(totalMembers),
      contractedCorps: Number(contractedCorps),
      contractedIndependent: Number(contractedIndependent),
      totalOwed: (Number(totalOwed) || 0) / 100,   // cents → dollars
      totalPaid: (Number(totalPaid) || 0) / 100,   // cents → dollars
      recentPayments: recentPayments.map(p => ({ ...p, amount: (Number(p.amount) || 0) / 100 })),
    });
  } catch (e) {
    return res.status(500).json({ ok: false, message: "Server error: " + (e && e.message ? e.message : String(e)) });
  }
});

// ── Schedules ──────────────────────────────────────────────────────────────
// GET /api/mobile/schedules
// Returns upcoming schedules (today + future), with blocks filtered by the
// requesting user's section.  Staff/admin see all blocks.
app.get("/api/mobile/schedules", mobileAuth, (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const userSection = (() => {
      try {
        const u = db.prepare("SELECT section, indoorSection, staff, admin FROM users WHERE id = ?").get(req.user.userid);
        return { section: u?.section || null, indoorSection: u?.indoorSection || null, isStaff: !!(u?.staff || u?.admin) };
      } catch (_) { return { section: null, indoorSection: null, isStaff: false }; }
    })();

    const schedules = db.prepare(`
      SELECT id, title, date, location, call_time, dismissal_time, notes, scope
      FROM schedules
      WHERE date >= ?
      ORDER BY date ASC, call_time ASC
      LIMIT 30
    `).all(today);

    const result = schedules.map(s => {
      const allBlocks = db.prepare(`
        SELECT id, title, start_time, end_time, location, section, block_type, notes, sort_order
        FROM schedule_blocks
        WHERE schedule_id = ?
        ORDER BY sort_order ASC, start_time ASC
      `).all(s.id);

      // Filter blocks by section unless staff/admin
      const blocks = userStaffAdmin => allBlocks.filter(b => {
        if (userStaffAdmin) return true;
        return b.section === 'all' || b.section === userSection.section || b.section === userSection.indoorSection;
      });

      return { ...s, blocks: blocks(userSection.isStaff) };
    });

    return res.json({ ok: true, schedules: result });
  } catch (e) {
    console.error('[Mobile API] schedules error:', e.message || e);
    return res.status(500).json({ ok: false, message: "Server error: " + (e && e.message ? e.message : String(e)) });
  }
});

// GET /api/mobile/schedules/:id  – single schedule detail (all blocks for staff)
app.get("/api/mobile/schedules/:id", mobileAuth, (req, res) => {
  try {
    const scheduleId = Number(req.params.id);
    const schedule = db.prepare("SELECT * FROM schedules WHERE id = ?").get(scheduleId);
    if (!schedule) return res.status(404).json({ ok: false, message: "Schedule not found" });

    const isStaffAdmin = !!(req.admin || req.staff);
    const allBlocks = db.prepare(`
      SELECT id, title, start_time, end_time, location, section, block_type, notes, sort_order
      FROM schedule_blocks WHERE schedule_id = ? ORDER BY sort_order ASC, start_time ASC
    `).all(scheduleId);

    let blocks = allBlocks;
    if (!isStaffAdmin) {
      // For regular members, only show blocks for their section + 'all' blocks
      const u = db.prepare("SELECT section, indoorSection FROM users WHERE id = ?").get(req.user.userid);
      const memberSection = u?.section || null;
      const memberIndoor = u?.indoorSection || null;
      blocks = allBlocks.filter(b => b.section === 'all' || b.section === memberSection || b.section === memberIndoor);
    }

    // Staff notes only for staff/admin
    const { staff_notes, ...publicSchedule } = schedule;
    const payload = isStaffAdmin ? schedule : publicSchedule;

    return res.json({ ok: true, schedule: payload, blocks });
  } catch (e) {
    console.error('[Mobile API] schedule detail error:', e.message || e);
    return res.status(500).json({ ok: false, message: "Server error: " + (e && e.message ? e.message : String(e)) });
  }
});

// POST /api/mobile/schedules  – create a schedule (staff/admin only)
app.post("/api/mobile/schedules", mobileAuth, (req, res) => {
  try {
    if (!req.admin && !req.staff) return res.status(403).json({ ok: false, message: "Staff or admin only" });
    const { title, date, location, call_time, dismissal_time, notes, staff_notes, scope, blocks } = req.body;
    if (!title || !date) return res.status(400).json({ ok: false, message: "title and date are required" });

    const now = Date.now();
    const info = db.prepare(`
      INSERT INTO schedules (title, date, location, call_time, dismissal_time, notes, staff_notes, scope, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(title, date, location || null, call_time || null, dismissal_time || null, notes || null, staff_notes || null, scope || 'all', req.user.userid, now, now);

    const scheduleId = info.lastInsertRowid;

    if (Array.isArray(blocks)) {
      const insertBlock = db.prepare(`
        INSERT INTO schedule_blocks (schedule_id, title, start_time, end_time, location, section, block_type, notes, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      blocks.forEach((b, i) => {
        insertBlock.run(scheduleId, b.title || 'Block', b.start_time || '08:00', b.end_time || null, b.location || null, b.section || 'all', b.block_type || 'rehearsal', b.notes || null, b.sort_order ?? i);
      });
    }

    return res.json({ ok: true, scheduleId });
  } catch (e) {
    console.error('[Mobile API] create schedule error:', e.message || e);
    return res.status(500).json({ ok: false, message: "Server error: " + (e && e.message ? e.message : String(e)) });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// END MOBILE API
// ─────────────────────────────────────────────────────────────────────────────

app.use((req, res) => {
    res.status(404).render('404');
});

app.listen(2023)