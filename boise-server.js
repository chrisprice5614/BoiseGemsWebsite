require("dotenv").config() // Makes it so we can access .env file
const jwt = require("jsonwebtoken")//npm install jsonwebtoken dotenv
const bcrypt = require("bcrypt") //npm install bcrypt
const cookieParser = require("cookie-parser")//npm install cookie-parser
const express = require("express")//npm install express
const db = require("better-sqlite3")("data.db") //npm install better-sqlite3
const body_parser = require("body-parser")
const path = require('path');
const node_fetch = require("node-fetch")
const nodemailer = require("nodemailer")
const multer = require("multer")
const sharp = require('sharp');
const fs = require("fs");
const axios = require("axios");
const marked = require('marked');
const session = require('express-session');
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { verify } = require("crypto")


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
async function sendEmail(to, subject, html) {
  if(!online)
    return

    let transporter = nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: {
            user: process.env.MAILNAME,
            pass: process.env.MAILSECRET
        },
        tls: {
            rejectUnauthorized: false
        }
    });


    let info = await transporter.sendMail({
        from: '"The Boise Gems" <theboisegems@gmail.com>',
        to: to,
        subject: subject,
        html: `
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
              © 2025 Boise Gems Drum & Bugle Corps ·
              <a href="https://www.boisegems.org/" style="color: #999999; text-decoration: underline;">www.boisegems.org</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>

        `

    })

}

function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-') // Replace non-alphanumerics with -
    .replace(/^-+|-+$/g, '');    // Trim hyphens from start/end
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
        contractedIndependent INTEGER
        )
        `
    ).run()

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



})

createTables();

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

  // contracted = 1 for corps/independent
  db.prepare(`
    UPDATE forms
    SET contracted = 1
    WHERE LOWER(ensemble_type) IN ('corps','independent')
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

      -- contracted = 1 for corps/independent
      UPDATE forms
      SET contracted = 1
      WHERE id = NEW.id AND LOWER(COALESCE((SELECT ensemble_type FROM forms WHERE id = NEW.id), '')) IN ('corps','independent');

      -- contracted = 0 for 'all' or anything else
      UPDATE forms
      SET contracted = 0
      WHERE id = NEW.id AND LOWER(COALESCE((SELECT ensemble_type FROM forms WHERE id = NEW.id), '')) NOT IN ('corps','independent');
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

      -- contracted = 1 for corps/independent
      UPDATE forms
      SET contracted = 1
      WHERE id = NEW.id AND LOWER(COALESCE((SELECT ensemble_type FROM forms WHERE id = NEW.id), '')) IN ('corps','independent');

      -- contracted = 0 for 'all' or anything else
      UPDATE forms
      SET contracted = 0
      WHERE id = NEW.id AND LOWER(COALESCE((SELECT ensemble_type FROM forms WHERE id = NEW.id), '')) NOT IN ('corps','independent');
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

  // ---- Contract PDFs (corps / independent) ----
  db.prepare(`
    CREATE TABLE IF NOT EXISTS contractPdfs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ensemble TEXT NOT NULL,            -- 'corps' or 'independent'
      pdf_path TEXT NOT NULL,            -- /pdf/publicpdf/...
      uploaded_at INTEGER NOT NULL
    )
  `).run();

// call it on boot
migrateFormsTable(db);

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

  if(!req.parent){
    if(!req.admin)
      return next();
  }

  res.redirect("/")
}

//
// === FORMS VISIBILITY + COMPLETENESS HELPERS ===
//

// Build the WHERE and params for "required forms this user must complete"
function buildFormsQueryForUser(user) {
  const now = Date.now();

  const wantCorps       = !!user?.contractedCorps;
  const wantIndependent = !!user?.contractedIndependent;

  // 1) Not contracted to either group → only general "all", non-contracted, member forms
  if (!wantCorps && !wantIndependent) {
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

  // Close the big AND ( ... ) and finish query
  sql += `
      )
    ORDER BY due_date IS NULL, due_date ASC, id DESC
  `;

  return { sql, params };
}


function getRequiredFormsForUser(userId) {
  const user = db.prepare(`
    SELECT id, contractedCorps, contractedIndependent
    FROM users
    WHERE id = ?
  `).get(userId);

  const q = buildFormsQueryForUser(user || { contractedCorps: 0, contractedIndependent: 0 });

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
    } catch (err) {
        req.user = false
        req.staff = false;
        req.admin = false;
        req.parent = false
        
    }

    res.locals.user = req.user;
    res.locals.admin = req.admin;
    res.locals.parent = req.parent;
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
  let birthday = new Date(req.body.birthday).getTime();

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

  // ✅ Instantly verified = 1, no emailsecret/userVerify row
  const addParent = db.prepare(
    "INSERT INTO users (firstname, lastname, password, address, birthday, email, phone, verified, parent, section) VALUES (? , ? , ? , ? , ? , ? , ? , ? , ? , ?)"
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
    "parent"
  );
  const parentId = newParent.lastInsertRowid;

  // ✅ Auto-login just like /login
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

  // ✅ Welcome email instead of verify email
  const html = `
    Hello ${firstname},

    <p>Welcome to Boise Gems! Your account has been created successfully.</p>

    <p>You can log in anytime here: <a href="${process.env.BASEURL}/login">${process.env.BASEURL}/login</a></p>

    <p>If you didn't create this account, please contact us.</p>
  `;

  sendEmail(email, "Welcome to Boise Gems!", html);

  return res.redirect("/");
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
  let birthday = new Date(req.body.birthday).getTime();

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

  // ✅ Instantly verified = 1, no userVerify insert
  const addMember = db.prepare(
    "INSERT INTO users (firstname, lastname, password, address, birthday, email, phone, verified, emailsecret, section, instrument) VALUES (? , ? , ? , ? , ? , ? , ? , ? , ? , ? , ?)"
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
    instrument
  );

  const newMemberId = newMember.lastInsertRowid;

  const addPermissions = db.prepare(
    "INSERT INTO permissions (user_id) VALUES (?)"
  );
  addPermissions.run(newMemberId);

  // ✅ Auto-login
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

  // ✅ Welcome email instead of verify email
  const html = `
    Hello ${firstname},

    <p>Welcome to Boise Gems! Your account has been created successfully.</p>

    <p>You can log in anytime here: <a href="${process.env.BASEURL}/login">${process.env.BASEURL}/login</a></p>

    <p>If you didn't create this account, please contact us.</p>
  `;

  sendEmail(email, "Welcome to Boise Gems!", html);

  return res.redirect("/");
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

app.get("/member-portal", mustBeMember, (req,res) => {
  const member = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.userid);
  const contracts = db.prepare("SELECT * FROM contractExtension WHERE user_id = ?").all(req.user.userid);

  // REQUIRED FORMS (by rules)
  const requiredForms = getRequiredFormsForUser(req.user.userid);
  const uploadedForms = db.prepare("SELECT document_id FROM formUploads WHERE user_id = ?").all(req.user.userid);
  const leftoverForms = markUploadsAndCount(requiredForms, uploadedForms);

  const allergy = db.prepare("SELECT * FROM allergies WHERE user_id = ?").get(req.user.userid);

  return res.render("member-portal", { member, contracts, leftoverForms, allergy });
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


app.get("/upload-form-parent/:id/:child", mustBeParent, (req,res) => {


  const getParentIdStatement = db.prepare("SELECT parentId FROM users WHERE id = ?").get(req.params.child)
  const isParent = getParentIdStatement.parentId == req.user.userid;

  if(!isParent)
    return res.redirect("/")


  const getRequiredForm = db.prepare("SELECT * FROM forms WHERE id = ?")
  const thisForm = getRequiredForm.get(req.params.id)


  return res.render("upload-form", {thisForm, parent: req.params.child})
})

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

app.get("/upload-form/:id", mustBeMember, (req,res) => {
  // Correct check: same document_id + same user_id
    const thisForm = db.prepare("SELECT * FROM forms WHERE id = ?").get(req.params.id);
  return res.render("upload-form", { thisForm });
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

  // ❌ old check removed:
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

  return res.render("change-membership", {thisUser})
})

app.get('/contact', (req,res) => {
  return res.render('contact')
})



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

  let contractedCorps = 0;
  let contractedIndependent = 0;

  if(changeCorps == "contracted")
    contractedCorps = 1

  if(changeIndependent == "contracted")
    contractedIndependent = 1

  const updateStatement = db.prepare("UPDATE users SET contractedCorps = ? , contractedIndependent = ? WHERE id = ?")
  updateStatement.run(contractedCorps, contractedIndependent, userId)
  

  req.session.flashMessage = `${thisUser.firstname} has been changed to contracted for corps is ${changeCorps} and for Independent is ${changeIndependent}`


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

app.get("/accept-contract/:id", mustBeLoggedIn, (req, res) => {
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
  }

  return res.render("sign-contract",{group, season: CURRENTSEASON, contractExtension})
})

app.post("/sign-contract/:id", mustBeLoggedIn, async (req, res) => {
  const getContractStatement = db.prepare(
    "SELECT * FROM contractExtension WHERE id = ?"
  );
  const contractExtension = getContractStatement.get(req.params.id);

  if (!contractExtension || contractExtension.user_id !== req.user.userid) {
    return res.redirect("/");
  }

  // Determine ensemble type
  const ensemble = contractExtension.season.includes("corps") ? "corps" : "independent";

  const getTuitionStatement = db.prepare(
    "SELECT amount, deposit_amount FROM tuitionFees WHERE ensemble = ?"
  );
  const tuition = getTuitionStatement.get(ensemble);
  if (!tuition) {
    return res.redirect("/");
  }

  // If bypass fee is true, skip Stripe
  if (contractExtension.bypass_fee) {
    // Set user contracted flags
    if (ensemble === "corps") {
      db.prepare("UPDATE users SET contractedCorps = 1, owed = COALESCE(owed,0) + ? WHERE id = ?")
        .run(tuition.amount, req.user.userid);
    } else {
      db.prepare("UPDATE users SET contractedIndependent = 1, owed = COALESCE(owed,0) + ? WHERE id = ?")
        .run(tuition.amount, req.user.userid);
    }

    // Delete contractExtension entry
    db.prepare("DELETE FROM contractExtension WHERE id = ?").run(req.params.id);

    req.session.flashMessage = "Welcome to the corps!";
    return res.redirect("/member-portal");
  }

  // Stripe checkout flow for $50 down payment + 5% processing fee
  const downPayment = tuition.deposit_amount || 5000; // cents
  const processingFee = Math.ceil(downPayment * 0.06);
  const totalAmount = downPayment + processingFee;

  // Save potential payment
  const insertPotential = db.prepare(
    "INSERT INTO potential_payment (user_id, contract_id, amount, created_at) VALUES (?, ?, ?, ?)"
  );
  const result = insertPotential.run(req.user.userid, contractExtension.id, totalAmount, Date.now());
  const potentialPaymentId = result.lastInsertRowid;

  // Stripe Checkout Session
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `Contract down payment for ${ensemble} ensemble`,
            },
            unit_amount: totalAmount,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${process.env.BASEURL}/sign-contract/success/${potentialPaymentId}`,
      cancel_url: `${process.env.BASEURL}/sign-contract/${contractExtension.id}`,
    });

    res.redirect(303, session.url);
  } catch (err) {
    console.error("Stripe session error:", err);
    res.redirect(`/sign-contract/${contractExtension.id}`);
  }
});

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

  const ensemble = contractExtension.season.includes("corps") ? "corps" : "independent";

  // Fetch tuition fees for the ensemble
  const getTuition = db.prepare("SELECT amount FROM tuitionFees WHERE ensemble = ?");
  const tuition = getTuition.get(ensemble);
  if (!tuition) return res.redirect("/");

  // Update user: set contracted flag and owed tuition
  const getUser = db.prepare("SELECT * FROM users WHERE id = ?");
  const user = getUser.get(req.user.userid);

  if (!user) return res.redirect("/");

  // Set contracted flags
  let updateFields = "";
  if (ensemble === "corps") updateFields = "contractedCorps = 1";
  else updateFields = "contractedIndependent = 1";

  // Add tuition amount to owed
  const newOwed = (user.owed || 0) + tuition.amount;

  const updateUser = db.prepare(
    `UPDATE users SET ${updateFields}, owed = ? WHERE id = ?`
  );
  updateUser.run(newOwed, user.id);

  // Deduct down payment (5000 pennies)
  const remainingOwed = newOwed - 5000;
  db.prepare("UPDATE users SET owed = ? WHERE id = ?").run(remainingOwed, user.id);

  // Insert into paymentHistory
  const addPayment = db.prepare(
    "INSERT INTO paymentHistory (title, description, amount, method, date, user_id) VALUES (?, ?, ?, ?, ?, ?)"
  );

  const paymentTitle = `Contract down payment for ${ensemble} ensemble`;
  const paymentDesc = `User ${user.firstname} ${user.lastname} paid $50 (plus 5% fee) down payment for ${ensemble} contract.`;
  
  addPayment.run(paymentTitle, paymentDesc, potential.amount, "Stripe", Date.now(), user.id);

  // Delete potential payment to prevent reuse
  db.prepare("DELETE FROM potential_payment WHERE id = ?").run(potential.id);

  // Delete contractExtension (they are now contracted)
  db.prepare("DELETE FROM contractExtension WHERE id = ?").run(contractExtension.id);

  // Optionally, send email receipt
  const paidString = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(potential.amount / 100);

  const emailBody = `
    <h1>Contract Down Payment Received</h1>
    <p>Thank you ${user.firstname} ${user.lastname} for paying the $50 down payment (plus 5% processing fee) for your ${ensemble} ensemble contract.</p>
    <p>Amount paid: ${paidString}</p>
    <p>Date: ${new Date().toLocaleDateString("en-US", {year:"numeric", month:"long", day:"numeric"})}</p>
  `;

  sendEmail(user.email, "Contract Down Payment Received", emailBody);

  req.session.flashMessage = "Contract down payment successful! Welcome to the corps!";
  return res.redirect("/member-portal");
});



app.post("/extend-contract/:id", mustBeStaff, (req,res) => {
  const userId = req.params.id;
  const getUserStatement = db.prepare("SELECT * FROM users WHERE id = ?")
  const thisUser = getUserStatement.get(userId);
  const group = req.body.group;

  const bypass = req.body.bypass ? 1 : 0;

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

  const seasonString = String(CURRENTSEASON)+group;

  const oldContractStatement = db.prepare("SELECT * FROM contractExtension WHERE user_id = ?")
  const oldContractArray = oldContractStatement.all(userId)

  oldContractArray.forEach(oldContract => {
    if(oldContract.season == seasonString)
    {
      const deleteStatement = db.prepare("DELETE FROM contractExtension WHERE id = ?")
      deleteStatement.run(oldContract.id)
    }
  })

  const addContractExtensionStatement = db.prepare("INSERT INTO contractExtension (user_id , due_date , bypass_fee , season , extender) VALUES (? , ? , ? , ? , ?)")
  addContractExtensionStatement.run(thisUser.id, Date.now() + 30 * 24 * 60 * 60 * 1000, bypass, seasonString, req.user.userid)

  let welcomeMessage = "The Boise Gems Drum & Bugle Corps"

  if(group == "independent"){
    welcomeMessage = "Boise Gems Independent"
  }

  const html = `<h1 style="text-align: center;">Congratulations!</h1>
  <br>
  <p>Hello ${thisUser.firstname}, you've been offered a contract at ${welcomeMessage}! Please login and go to your member portal to view the contract and sign it. We're excited to have you with us for the ${CURRENTSEASON} season!</p><br>
  <div style="text-align: center">
    <a href="${process.env.BASEURL}/login" target="_blank" style="background-color: #9D76BB; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 4px; font-weight: bold; display: inline-block;">
                  Log In To Your Account
                </a>
  </div>`

  sendEmail(thisUser.email,"Contract Extension", html)


  return res.render("message", {message: "Contract has been sent!"})
})



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

  return res.render("set-tuition", {corpsFees, independentFees})
})

app.post("/set-tuition", mustBeAdmin, (req, res) => {
  const corpsAmount       = Math.round(Number(req.body.corps || 0) * 100);
  const independentAmount = Math.round(Number(req.body.independent || 0) * 100);
  const corpsDeposit      = Math.round(Number(req.body.corps_deposit || 0) * 100);
  const independentDeposit= Math.round(Number(req.body.independent_deposit || 0) * 100);

  db.prepare(
    "UPDATE tuitionFees SET amount = ?, deposit_amount = ? WHERE ensemble = ?"
  ).run(corpsAmount, corpsDeposit, "corps");

  db.prepare(
    "UPDATE tuitionFees SET amount = ?, deposit_amount = ? WHERE ensemble = ?"
  ).run(independentAmount, independentDeposit, "independent");

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
  const membership = String(req.query.membership || "all").trim(); // new: corps/independent/all
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
    where.push("(firstname LIKE ? OR lastname LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
  }

  if (membership === "corps") {
    where.push("contractedCorps = 1");
  } else if (membership === "independent") {
    where.push("contractedIndependent = 1");
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  // Order: if section filter applied, just by lastname; else by section then lastname (same as before)
  const orderSql = filter !== "all"
    ? "ORDER BY lastname COLLATE NOCASE"
    : "ORDER BY section, lastname COLLATE NOCASE";

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

  // Compute allForms per user (by the new rules)
  users.forEach(thisUser => {
    const required = getRequiredFormsForUser(thisUser.id);
    const uploaded = db.prepare("SELECT document_id FROM formUploads WHERE user_id = ?").all(thisUser.id);
    const missing = markUploadsAndCount(required, uploaded);
    thisUser.allForms = missing === 0 ? 1 : 0;
  });


  res.render("edit-users", {
    users,
    search,
    filter,
    membership,     // <-- pass to EJS
    page,
    count,
    totalPages
  });
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

app.get("/parent-portal", mustBeParent, (req,res) => {
  const member = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.userid);
  const children = db.prepare("SELECT * FROM users WHERE parentId = ?").all(req.user.userid);

  children.forEach(child => {
    // minor flag (kept)
    if (child.birthday) {
      const birthday = new Date(child.birthday);
      const today = new Date();
      let age = today.getFullYear() - birthday.getFullYear();
      const hadBDay =
        today.getMonth() > birthday.getMonth() ||
        (today.getMonth() === birthday.getMonth() && today.getDate() >= birthday.getDate());
      if (!hadBDay) age--;
      child.minor = age < 18;
    }

    // NEW: child-specific required forms
    const reqForms = getRequiredFormsForUser(child.id);
    const uploaded = db.prepare("SELECT document_id FROM formUploads WHERE user_id = ?").all(child.id);
    child.leftoverForms = markUploadsAndCount(reqForms, uploaded);
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
  if(req.body.tuition)
  {
    const alreadyPaid = Number(child.paid) + paid;
    const left = Number(child.owed)-paid;
  

    const updateStatement = db.prepare("UPDATE users SET paid = ?, owed = ? WHERE id = ?")
    updateStatement.run(alreadyPaid, left, req.params.id)
  } else {
    const alreadyPaid = Number(child.paid)

    const updateStatement = db.prepare("UPDATE users SET paid = ? WHERE id = ?")
    updateStatement.run(alreadyPaid,req.params.id)
  }

  const paidString = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(paid / 100);

  const addPaymentStatement = db.prepare("INSERT INTO paymentHistory (title, description, amount, method, date, user_id) VALUES (? , ? , ? , ? , ? , ?)")
  addPaymentStatement.run(req.body.title,req.body.description, paid,req.body.method, Date.now(), child.id)


  return res.redirect(`/transaction-edit/${child.id}`)
})

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
    if (!["all", "corps", "independent"].includes(ensemble_type)) {
      ensemble_type = "all";
    }

    let contracted =
      ensemble_type === "corps" || ensemble_type === "independent"
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
  if (!["all", "corps", "independent"].includes(ensemble_type)) ensemble_type = "all";

  // If ensemble_type is corps/independent => contracted must be 1, else honor the checkbox
  let contracted = (ensemble_type === "corps" || ensemble_type === "independent")
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

app.get("/email-members", mustBeAdmin, (req, res) => {
  res.render("email-members");
});

app.post("/email-members", mustBeAdmin, (req, res) => {
  const subject = String(req.body.subject || "").trim();
  const message = String(req.body.message || "").trim();
  const section = String(req.body.section || "all").trim();
  const membership = String(req.body.membership || "all").trim();

  if (!subject || !message) {
    req.session.flashMessage = "Subject and message are required.";
    return res.redirect("/email-members");
  }

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
  }

  where.push("email IS NOT NULL AND TRIM(email) <> ''");

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const rows = db.prepare(`
    SELECT email, firstname, lastname
    FROM users
    ${whereSql}
  `).all(...params);

  rows.forEach(row => {
    sendEmail(row.email, subject, message);
  });

  req.session.flashMessage = `Bulk email sent to ${rows.length} recipient(s).`;
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

// Success route — finalize payment
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


// Success route — finalize payment for the user
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

app.get("/donate", (req,res) => {
  return res.render("donate")
})

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
              description: donorMsg || `Donation by ${donorName}`
            },
            unit_amount: totalCharge
          },
          quantity: 1
        }
      ],
      mode: "payment",
      success_url: `${process.env.BASEURL}/donate/success/${potentialId}`,
      cancel_url: `${process.env.BASEURL}/donate`
    });

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
        (email, name, message, amount, processing_fee, total_charged, stripe_session_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insertDonation.run(
      potential.email,
      potential.name,
      potential.message,
      potential.amount,
      potential.processing_fee,
      potential.total_charge,
      potential.stripe_session_id,
      Date.now()
    );

    // Also add to paymentHistory table for consistent transaction records.
    const paidString = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(potential.amount / 100);
    const processingString = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(potential.processing_fee / 100);
    const totalString = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(potential.total_charge / 100);

    const title = `Donation by ${potential.name}`;
    const description = `Donation of ${paidString} (processing fee ${processingString}, total charged ${totalString}). Message: ${potential.message || "—"}`;

    const insertHistory = db.prepare(
      "INSERT INTO paymentHistory (title, description, amount, method, date, user_id) VALUES (?, ?, ?, ?, ?, ?)"
    );
    // user_id NULL because donor may not be a member
    insertHistory.run(title, description, potential.total_charge, "Stripe", Date.now(), null);

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
    sendEmail(potential.email, "Thank you for your donation — Boise Gems", emailBody);
    sendEmail(MasterEmail, "Donation Received", `Donation received: ${title} — ${totalString}`);

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

app.get("/update-address", mustBeMember, (req,res) => {
  const member = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.userid);

  if(!member)
    return res.redirect("/")


  return res.render("change-address", {member})
})

app.post("/change-address", mustBeMember, (req,res) => {
  const member = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.userid);

  if(!member)
    return res.redirect("/")


  db.prepare("UPDATE users SET address = ? WHERE id = ?").run(req.body.address, req.user.userid)
  return res.redirect("/member-portal")
})

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

app.get("/set-materials", mustBeStaff, (req,res) => {
  return res.render("set-materials")
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
      title: `${event.title} — Boise Gems`,
      description: desc,
      url,
      image: img
    }
  });
});



// GET /event/:slug/rsvps-data?q=&section=*
// Admin-only JSON endpoint for live RSVP search
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
  const existing = db.prepare("SELECT * FROM rsvp WHERE user_id = ? AND event_id = ?").get(req.user.userid, event.id);
  if (existing) {
    req.session.flashMessage = "You're already RSVP'd for this event.";
    return res.redirect(`/event/${event.slug}`);
  }

  const amountCents = toCents(event.cost || 0);

  // Free RSVP: just insert and done
  if (amountCents <= 0) {
    db.prepare("INSERT INTO rsvp (user_id, event_id, paid) VALUES (?, ?, ?)").run(req.user.userid, event.id, 0);
    req.session.flashMessage = "You're RSVP'd!";
    return res.redirect(`/event/${event.slug}`);
  }

  // Paid RSVP: create potential, start Stripe Checkout
  const processingFee = Math.round(amountCents * 0.06); // 5%
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
              description: `Event on ${new Date(event.datetime).toLocaleString("en-US")}`
            },
            unit_amount: totalCharge
          },
          quantity: 1
        }
      ],
      mode: "payment",
      success_url: `${process.env.BASEURL}/event/${event.slug}/rsvp/success/${potentialId}`,
      cancel_url: `${process.env.BASEURL}/event/${event.slug}`
    });

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
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
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
      title: `${post.title} — Boise Gems`,
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

  res.render("contracts-admin", {
    corpsContract,
    independentContract,
  });
});

app.post(
  "/contracts-admin",
  mustBeAdmin,
  pdfUpload.fields([
    { name: "corps_pdf", maxCount: 1 },
    { name: "independent_pdf", maxCount: 1 },
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

    req.session.flashMessage = "Contract PDFs updated.";
    return res.redirect("/contracts-admin");
  }
);

app.get("/admin-rsvps", mustBeAdmin, (req, res) => {
  // Get all events with their RSVPs and users
  const rows = db.prepare(`
    SELECT
      e.id            AS event_id,
      e.title         AS event_title,
      e.datetime      AS event_datetime,
      e.location      AS event_location,
      r.id            AS rsvp_id,
      r.paid          AS rsvp_paid,
      u.id            AS user_id,
      u.firstname,
      u.lastname,
      u.section,
      u.instrument,
      u.staff,
      u.admin
    FROM events e
    LEFT JOIN rsvp r ON r.event_id = e.id
    LEFT JOIN users u ON u.id = r.user_id
    ORDER BY e.datetime DESC, u.lastname, u.firstname
  `).all();

  // group by event
  const eventsMap = new Map();
  const userIds = new Set();

  for (const row of rows) {
    if (!eventsMap.has(row.event_id)) {
      eventsMap.set(row.event_id, {
        id: row.event_id,
        title: row.event_title,
        datetime: row.event_datetime,
        location: row.event_location,
        rsvps: [],
      });
    }
    const evt = eventsMap.get(row.event_id);
    if (row.rsvp_id) {
      evt.rsvps.push({
        rsvp_id: row.rsvp_id,
        paid: row.rsvp_paid,
        user_id: row.user_id,
        firstname: row.firstname,
        lastname: row.lastname,
        section: row.section,
        instrument: row.instrument,
        staff: row.staff,
        admin: row.admin,
      });
      if (row.user_id) userIds.add(row.user_id);
    }
  }

  // compute "remaining performer forms" for each user
  const formsStatus = {};
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

  const parentIds = [...userIds];
  const childrenByParent = {};

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
      if (!childrenByParent[child.parentId]) {
        childrenByParent[child.parentId] = [];
      }
      childrenByParent[child.parentId].push({
        id: child.id,
        firstname: child.firstname,
        lastname: child.lastname,
      });
    }
  }

  const events = Array.from(eventsMap.values());

  res.render("admin-rsvps", {
    events,
    formsStatus,
    childrenByParent,
  });
});

app.get("/admin-forms", mustBeAdmin, (req, res) => {
  const membership = String(req.query.membership || "all").toLowerCase(); // all|corps|independent
  const sectionFilter = String(req.query.section || "").trim();

  const where = ["1=1"];
  const params = [];

  if (membership === "corps") {
    where.push("contractedCorps = 1");
  } else if (membership === "independent") {
    where.push("contractedIndependent = 1");
  }

  if (sectionFilter) {
    where.push("section = ?");
    params.push(sectionFilter);
  }

  const users = db
    .prepare(
      `
      SELECT id, firstname, lastname, section, instrument,
             contractedCorps, contractedIndependent
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

app.get("/about", (req, res) => {
  const staff = db.prepare(`
    SELECT id, first, last, position, category, bio, image, slug, sort_order
    FROM staff
    ORDER BY category COLLATE NOCASE, sort_order ASC, last COLLATE NOCASE
  `).all();

  // group by category
  const grouped = staff.reduce((acc, s) => {
    (acc[s.category || "Staff"] ||= []).push(s);
    return acc;
  }, {});

  res.render("about", { grouped });
});


app.get("/staff/:slug", (req, res) => {
  const s = db.prepare(`
    SELECT id, first, last, position, category, bio, image, slug
    FROM staff WHERE slug = ?
  `).get(req.params.slug);

  if (!s) return res.status(404).render("404");

  const base = "https://boisegems.org";
  const img  = s.image ? `${base}${s.image}` : `${base}/img/ui/gem.png`;
  const title = `${s.first} ${s.last} — ${s.position} | Boise Gems`;

  res.render("staff-show", {
    s,
    meta: {
      title,
      description: s.bio?.slice(0, 160) || `${s.first} ${s.last} — ${s.position}`,
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

    await sendEmail(MasterEmail, "Whistleblower Report — Boise Gems", html);

    return res.render("message", {
      message: "Thank you. Your whistleblower report has been submitted and will be investigated."
    });
  } catch (err) {
    console.error("Whistleblower error:", err);
    return res.status(500).render("message", { message: "Something went wrong. Please try again shortly." });
  }
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




app.use((req, res) => {
    res.status(404).render('404');
});

app.listen(2023)