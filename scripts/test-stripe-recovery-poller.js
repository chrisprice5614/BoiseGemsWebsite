/**
 * Stripe recovery poller integration test (TEST MODE ONLY).
 *
 * Creates real Checkout Sessions with Stripe test keys, then runs the poller
 * against a paid-session proxy (Checkout can't be completed headlessly).
 * Uses a temporary SQLite DB — never touches production data.db.
 *
 * Usage: node scripts/test-stripe-recovery-poller.js
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const os = require("os");
const Database = require("better-sqlite3");
const Stripe = require("stripe");
const stripePaymentFinalize = require("../stripe-payment-finalize");

function pickTestSecret() {
  const candidates = [
    process.env.STRIPE_SECRET_TEST,
    process.env.STRIPE_SECRET_KEY,
  ].filter(Boolean);
  for (const key of candidates) {
    if (String(key).startsWith("sk_live_")) {
      throw new Error("Refusing to run: live Stripe key detected. Use sk_test_ only.");
    }
    if (String(key).startsWith("sk_test_")) return key;
  }
  throw new Error("No Stripe test secret found (STRIPE_SECRET_TEST / STRIPE_SECRET_KEY).");
}

function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function setupSchema(db) {
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      firstname TEXT, lastname TEXT, email TEXT,
      parent INTEGER DEFAULT 0, parentId INTEGER,
      owed INTEGER DEFAULT 0, paid INTEGER DEFAULT 0,
      contractedCorps INTEGER DEFAULT 0,
      contractedIndependent INTEGER DEFAULT 0,
      contractedAffiliate INTEGER DEFAULT 0
    );
    CREATE TABLE paymentHistory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT, description TEXT, amount INTEGER, method TEXT,
      date INTEGER, user_id INTEGER
    );
    CREATE TABLE potential_payment (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      child_id INTEGER, parent_id INTEGER, amount INTEGER NOT NULL,
      user_id INTEGER, contract_id INTEGER, processing_fee INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL, contract_file_path TEXT,
      stripe_session_id TEXT, kind TEXT
    );
    CREATE TABLE potential_donation (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT, name TEXT, message TEXT,
      amount INTEGER, processing_fee INTEGER, total_charge INTEGER,
      stripe_session_id TEXT, created_at INTEGER,
      user_id INTEGER, tier TEXT, donation_type TEXT, shirt_sizes TEXT
    );
    CREATE TABLE donations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT, name TEXT, message TEXT,
      amount INTEGER, processing_fee INTEGER, total_charged INTEGER,
      stripe_session_id TEXT, created_at INTEGER,
      user_id INTEGER, tier TEXT, donation_type TEXT
    );
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT, slug TEXT, datetime INTEGER, cost INTEGER DEFAULT 0
    );
    CREATE TABLE rsvp (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER, event_id INTEGER, paid INTEGER DEFAULT 0,
      checked_in INTEGER DEFAULT 0
    );
    CREATE TABLE potential_event_rsvp (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL, event_id INTEGER NOT NULL,
      amount INTEGER NOT NULL, processing_fee INTEGER NOT NULL,
      total_charge INTEGER NOT NULL, stripe_session_id TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE chrisPayment (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      total_owed INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE chrisPaymentHistory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER, amount INTEGER, type TEXT, note TEXT, source TEXT
    );
    INSERT INTO chrisPayment (id, total_owed) VALUES (1, 0);
  `);
  stripePaymentFinalize.ensureStripePaymentColumns(db);
}

function makePaidStripeProxy(realStripe, sessionBag) {
  return {
    checkout: {
      sessions: {
        create: (...args) => realStripe.checkout.sessions.create(...args),
        retrieve: async (id) => {
          const s = await realStripe.checkout.sessions.retrieve(id);
          return Object.assign({}, s, {
            payment_status: "paid",
            status: "complete",
          });
        },
        list: async () => {
          const data = [];
          for (const id of sessionBag) {
            const s = await realStripe.checkout.sessions.retrieve(id);
            data.push(
              Object.assign({}, s, {
                payment_status: "paid",
                status: "complete",
              })
            );
          }
          return { data, has_more: false };
        },
      },
    },
  };
}

async function createSession(realStripe, { name, amountCents, successUrl, metadata, customerEmail }) {
  return realStripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    customer_email: customerEmail || undefined,
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: { name },
          unit_amount: amountCents,
        },
        quantity: 1,
      },
    ],
    success_url: successUrl,
    cancel_url: "https://example.com/cancel",
    metadata: metadata || {},
  });
}

async function main() {
  const secret = pickTestSecret();
  console.log("Using Stripe TEST key:", secret.slice(0, 12) + "…");

  const tmpDbPath = path.join(
    os.tmpdir(),
    `boise-stripe-poller-test-${Date.now()}.db`
  );
  const db = new Database(tmpDbPath);
  setupSchema(db);

  const realStripe = Stripe(secret);
  const sessionBag = [];

  const member = db
    .prepare(
      "INSERT INTO users (firstname, lastname, email, parent, owed, paid) VALUES (?,?,?,0,50000,0)"
    )
    .run("Test", "Member", "poller-member@example.com");
  const memberId = member.lastInsertRowid;

  const parent = db
    .prepare(
      "INSERT INTO users (firstname, lastname, email, parent, owed, paid) VALUES (?,?,?,1,0,0)"
    )
    .run("Test", "Parent", "poller-parent@example.com");
  const parentId = parent.lastInsertRowid;

  const child = db
    .prepare(
      "INSERT INTO users (firstname, lastname, email, parent, parentId, owed, paid) VALUES (?,?,?,0,?,40000,0)"
    )
    .run("Test", "Child", "poller-child@example.com", parentId);
  const childId = child.lastInsertRowid;

  const camp = db
    .prepare(
      "INSERT INTO events (title, slug, datetime, cost) VALUES (?,?,?,?)"
    )
    .run("Summer Camp 2026", "summer-camp-2026", Date.now() + 86400000, 15000);
  const campId = camp.lastInsertRowid;

  const audition = db
    .prepare(
      "INSERT INTO events (title, slug, datetime, cost) VALUES (?,?,?,?)"
    )
    .run("BGI Callback Audition", "bgi-callback-audition", Date.now() + 172800000, 2500);
  const auditionId = audition.lastInsertRowid;

  const results = [];
  const base = "https://example.com";

  // --- 1) Member tuition ---
  {
    const tuition = 10000;
    const fee = Math.round(tuition * 0.06);
    const total = tuition + fee;
    const pot = db
      .prepare(
        "INSERT INTO potential_payment (user_id, amount, processing_fee, created_at, kind) VALUES (?,?,?,?,?)"
      )
      .run(memberId, tuition, fee, Date.now(), "make_payment");
    const potId = pot.lastInsertRowid;
    const session = await createSession(realStripe, {
      name: "Payment for tuition/fees for The Boise Gems Drum & Bugle Corps.",
      amountCents: total,
      successUrl: `${base}/make-payment/success/${potId}`,
      customerEmail: "poller-member@example.com",
      metadata: { kind: "make_payment", potential_id: String(potId), user_id: String(memberId) },
    });
    db.prepare("UPDATE potential_payment SET stripe_session_id = ? WHERE id = ?").run(
      session.id,
      potId
    );
    sessionBag.push(session.id);
    results.push({ label: "tuition", potId, sessionId: session.id, expectAmount: tuition });
    console.log("Created tuition checkout:", session.id);
  }

  // --- 2) Parent pay-behalf ---
  {
    const tuition = 8000;
    const fee = Math.round(tuition * 0.06);
    const total = tuition + fee;
    const pot = db
      .prepare(
        "INSERT INTO potential_payment (child_id, parent_id, amount, processing_fee, created_at, kind) VALUES (?,?,?,?,?,?)"
      )
      .run(childId, parentId, tuition, fee, Date.now(), "pay_behalf");
    const potId = pot.lastInsertRowid;
    const session = await createSession(realStripe, {
      name: "Payment for a child's tuition/fees for The Boise Gems Drum & Bugle Corps.",
      amountCents: total,
      successUrl: `${base}/pay-behalf/success/${potId}`,
      customerEmail: "poller-parent@example.com",
      metadata: {
        kind: "pay_behalf",
        potential_id: String(potId),
        child_id: String(childId),
        parent_id: String(parentId),
      },
    });
    db.prepare("UPDATE potential_payment SET stripe_session_id = ? WHERE id = ?").run(
      session.id,
      potId
    );
    sessionBag.push(session.id);
    results.push({ label: "pay_behalf", potId, sessionId: session.id, expectAmount: tuition });
    console.log("Created parent pay-behalf checkout:", session.id);
  }

  // --- 3) Camp RSVP ---
  {
    const amount = 15000;
    const fee = Math.round(amount * 0.06);
    const total = amount + fee;
    const pot = db
      .prepare(
        "INSERT INTO potential_event_rsvp (user_id, event_id, amount, processing_fee, total_charge, created_at) VALUES (?,?,?,?,?,?)"
      )
      .run(memberId, campId, amount, fee, total, Date.now());
    const potId = pot.lastInsertRowid;
    const session = await createSession(realStripe, {
      name: "RSVP: Summer Camp 2026",
      amountCents: total,
      successUrl: `${base}/event/summer-camp-2026/rsvp/success/${potId}`,
      customerEmail: "poller-member@example.com",
      metadata: {
        kind: "event_rsvp",
        potential_id: String(potId),
        event_id: String(campId),
        user_id: String(memberId),
      },
    });
    db.prepare("UPDATE potential_event_rsvp SET stripe_session_id = ? WHERE id = ?").run(
      session.id,
      potId
    );
    sessionBag.push(session.id);
    results.push({ label: "camp_rsvp", potId, sessionId: session.id, expectAmount: total });
    console.log("Created camp RSVP checkout:", session.id);
  }

  // --- 4) Callback audition RSVP ---
  {
    const amount = 2500;
    const fee = Math.round(amount * 0.06);
    const total = amount + fee;
    const pot = db
      .prepare(
        "INSERT INTO potential_event_rsvp (user_id, event_id, amount, processing_fee, total_charge, created_at) VALUES (?,?,?,?,?,?)"
      )
      .run(childId, auditionId, amount, fee, total, Date.now());
    const potId = pot.lastInsertRowid;
    const session = await createSession(realStripe, {
      name: "RSVP: BGI Callback Audition",
      amountCents: total,
      successUrl: `${base}/event/bgi-callback-audition/rsvp/success/${potId}`,
      customerEmail: "poller-child@example.com",
      metadata: {
        kind: "event_rsvp",
        potential_id: String(potId),
        event_id: String(auditionId),
        user_id: String(childId),
      },
    });
    db.prepare("UPDATE potential_event_rsvp SET stripe_session_id = ? WHERE id = ?").run(
      session.id,
      potId
    );
    sessionBag.push(session.id);
    results.push({ label: "callback_rsvp", potId, sessionId: session.id, expectAmount: total });
    console.log("Created callback RSVP checkout:", session.id);
  }

  // --- 5) Donation ---
  {
    const amount = 5000;
    const fee = Math.round(amount * 0.06);
    const total = amount + fee;
    const pot = db
      .prepare(
        `INSERT INTO potential_donation
          (email, name, message, amount, processing_fee, total_charge, created_at, donation_type)
         VALUES (?,?,?,?,?,?,?,?)`
      )
      .run(
        "poller-donor@example.com",
        "Poller Donor",
        "Test donation",
        amount,
        fee,
        total,
        Date.now(),
        "one_time"
      );
    const potId = pot.lastInsertRowid;
    const session = await createSession(realStripe, {
      name: "Donation to The Boise Gems Drum & Bugle Corps",
      amountCents: total,
      successUrl: `${base}/donate/success/${potId}`,
      customerEmail: "poller-donor@example.com",
      metadata: { kind: "donation", potential_id: String(potId) },
    });
    db.prepare("UPDATE potential_donation SET stripe_session_id = ? WHERE id = ?").run(
      session.id,
      potId
    );
    sessionBag.push(session.id);
    results.push({ label: "donation", potId, sessionId: session.id, expectAmount: total });
    console.log("Created donation checkout:", session.id);
  }

  const chrisCredits = [];
  const deps = {
    addChrisShare: (cents, source, paidAt) => {
      chrisCredits.push({ cents, source, paidAt });
      db.prepare("UPDATE chrisPayment SET total_owed = total_owed + ? WHERE id = 1").run(
        Math.round(Number(cents) * 0.03) || 0
      );
      db.prepare(
        "INSERT INTO chrisPaymentHistory (created_at, amount, type, note, source) VALUES (?, ?, 'credit', ?, ?)"
      ).run(paidAt || Date.now(), Math.round(Number(cents) * 0.03) || 0, source, source);
    },
    sendEmail: () => {},
    MasterEmail: null,
    silent: true,
    markUserContracted: () => null,
  };

  const stripeProxy = makePaidStripeProxy(realStripe, sessionBag);
  console.log("\nRunning poller (pass 1)…");
  const summary1 = await stripePaymentFinalize.pollAndRecoverPaidCheckouts(
    db,
    stripeProxy,
    deps,
    { lookbackHours: 2 }
  );
  console.log("Pass 1 summary:", summary1);

  // Assertions
  const memberAfter = db.prepare("SELECT owed, paid FROM users WHERE id = ?").get(memberId);
  assert(memberAfter.paid === 10000, `member paid expected 10000 got ${memberAfter.paid}`);
  assert(memberAfter.owed === 40000, `member owed expected 40000 got ${memberAfter.owed}`);

  const childAfter = db.prepare("SELECT owed, paid FROM users WHERE id = ?").get(childId);
  assert(childAfter.paid === 8000, `child paid expected 8000 got ${childAfter.paid}`);
  assert(childAfter.owed === 32000, `child owed expected 32000 got ${childAfter.owed}`);

  const campRsvp = db
    .prepare("SELECT * FROM rsvp WHERE user_id = ? AND event_id = ?")
    .get(memberId, campId);
  assert(campRsvp && campRsvp.paid === 1, "camp RSVP not paid/recorded");

  const auditionRsvp = db
    .prepare("SELECT * FROM rsvp WHERE user_id = ? AND event_id = ?")
    .get(childId, auditionId);
  assert(auditionRsvp && auditionRsvp.paid === 1, "callback audition RSVP not paid/recorded");

  const donation = db
    .prepare("SELECT * FROM donations WHERE email = ?")
    .get("poller-donor@example.com");
  assert(donation, "donation row missing");
  assert(donation.total_charged === 5300, `donation total expected 5300 got ${donation.total_charged}`);

  const hist = db.prepare("SELECT * FROM paymentHistory ORDER BY id").all();
  assert(hist.length >= 5, `expected >=5 paymentHistory rows, got ${hist.length}`);
  assert(
    hist.some((h) => /tuition|Payment by Test Member/i.test(h.title + h.description)),
    "tuition paymentHistory missing"
  );
  assert(
    hist.some((h) => /parent/i.test(h.title + h.description)),
    "parent pay-behalf paymentHistory missing"
  );
  assert(
    hist.some((h) => /Summer Camp/i.test(h.title)),
    "camp RSVP paymentHistory missing"
  );
  assert(
    hist.some((h) => /Callback Audition/i.test(h.title)),
    "callback RSVP paymentHistory missing"
  );
  assert(
    hist.some((h) => /Donation/i.test(h.title)),
    "donation paymentHistory missing"
  );

  assert(
    db.prepare("SELECT COUNT(*) AS c FROM potential_payment").get().c === 0,
    "potential_payment rows should be cleared"
  );
  assert(
    db.prepare("SELECT COUNT(*) AS c FROM potential_event_rsvp").get().c === 0,
    "potential_event_rsvp rows should be cleared"
  );
  assert(
    db.prepare("SELECT COUNT(*) AS c FROM potential_donation").get().c === 0,
    "potential_donation rows should be cleared"
  );

  assert(chrisCredits.length >= 5, `expected Chris share credits >=5 got ${chrisCredits.length}`);

  // Idempotency
  console.log("\nRunning poller (pass 2 — idempotency)…");
  const paidBefore = db.prepare("SELECT COUNT(*) AS c FROM paymentHistory").get().c;
  const owedChrisBefore = db.prepare("SELECT total_owed FROM chrisPayment WHERE id = 1").get()
    .total_owed;
  const summary2 = await stripePaymentFinalize.pollAndRecoverPaidCheckouts(
    db,
    stripeProxy,
    deps,
    { lookbackHours: 2 }
  );
  const paidAfter = db.prepare("SELECT COUNT(*) AS c FROM paymentHistory").get().c;
  const owedChrisAfter = db.prepare("SELECT total_owed FROM chrisPayment WHERE id = 1").get()
    .total_owed;
  assert(paidAfter === paidBefore, "idempotency failed: extra paymentHistory rows");
  assert(owedChrisAfter === owedChrisBefore, "idempotency failed: Chris share double-counted");
  assert(summary2.recovered === 0, `pass 2 should recover 0, got ${summary2.recovered}`);

  console.log("\nALL POLLER TESTS PASSED");
  console.log(`Temp DB: ${tmpDbPath}`);
  console.log("paymentHistory:");
  for (const h of hist) {
    console.log(`  - ${h.title} | $${(h.amount / 100).toFixed(2)} | ${h.method}`);
  }

  db.close();
  try {
    fs.unlinkSync(tmpDbPath);
  } catch (_) {}
}

main().catch((err) => {
  console.error("\nTEST FAILED:", err && err.stack ? err.stack : err);
  process.exit(1);
});
