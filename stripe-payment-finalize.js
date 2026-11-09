/**
 * Idempotent Stripe payment finalization.
 *
 * Historically the site only wrote paymentHistory when the browser hit a
 * success_url. If that redirect never completed, Stripe still took the money
 * and the website never recorded it. These helpers are shared by success
 * routes, a Stripe API poller (no dashboard webhooks required), and Chris's
 * reconcile backfill.
 */

function ensureStripePaymentColumns(db) {
  const phCols = db.prepare("PRAGMA table_info(paymentHistory)").all().map((c) => c.name);
  if (!phCols.includes("stripe_payment_intent_id")) {
    db.prepare("ALTER TABLE paymentHistory ADD COLUMN stripe_payment_intent_id TEXT").run();
  }
  if (!phCols.includes("stripe_session_id")) {
    db.prepare("ALTER TABLE paymentHistory ADD COLUMN stripe_session_id TEXT").run();
  }
  if (!phCols.includes("towards_balance")) {
    db.prepare(
      "ALTER TABLE paymentHistory ADD COLUMN towards_balance INTEGER NOT NULL DEFAULT 0"
    ).run();
    // Backfill known tuition / parent-pay rows that already reduced owed/paid
    try {
      db.prepare(
        `
        UPDATE paymentHistory
        SET towards_balance = 1
        WHERE COALESCE(towards_balance, 0) = 0
          AND lower(COALESCE(method, '')) != 'charge'
          AND (
            description LIKE '%towards their tuition%'
            OR description LIKE '%paid for their child%'
            OR title LIKE 'Payment by %'
            OR title LIKE 'Payment for % by parent%'
            OR title LIKE 'Contract down payment%'
          )
      `
      ).run();
    } catch (_) {}
  }

  const ppCols = db.prepare("PRAGMA table_info(potential_payment)").all().map((c) => c.name);
  if (!ppCols.includes("stripe_session_id")) {
    db.prepare("ALTER TABLE potential_payment ADD COLUMN stripe_session_id TEXT").run();
  }
  if (!ppCols.includes("kind")) {
    db.prepare("ALTER TABLE potential_payment ADD COLUMN kind TEXT").run();
  }

  try {
    const chrisCols = db.prepare("PRAGMA table_info(chrisPaymentHistory)").all().map((c) => c.name);
    if (!chrisCols.includes("stripe_payment_intent_id")) {
      db.prepare("ALTER TABLE chrisPaymentHistory ADD COLUMN stripe_payment_intent_id TEXT").run();
    }
    if (!chrisCols.includes("stripe_session_id")) {
      db.prepare("ALTER TABLE chrisPaymentHistory ADD COLUMN stripe_session_id TEXT").run();
    }
  } catch (_) {}

  db.prepare(`
    CREATE TABLE IF NOT EXISTS stripe_reconcile_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stripe_key TEXT NOT NULL,
      payment_intent_id TEXT,
      session_id TEXT,
      action_type TEXT NOT NULL,
      decision TEXT NOT NULL,
      user_id INTEGER,
      parent_id INTEGER,
      amount_cents INTEGER,
      note TEXT,
      decided_at INTEGER NOT NULL,
      UNIQUE(stripe_key, action_type)
    )
  `).run();

  db.prepare(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_paymentHistory_stripe_pi ON paymentHistory(stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL"
  ).run();
  db.prepare(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_paymentHistory_stripe_session ON paymentHistory(stripe_session_id) WHERE stripe_session_id IS NOT NULL"
  ).run();
}

function stripeReconcileKey({ paymentIntentId, sessionId, id } = {}) {
  if (paymentIntentId && String(paymentIntentId).startsWith("pi_")) return String(paymentIntentId);
  if (id && String(id).startsWith("pi_")) return String(id);
  if (sessionId) return `session:${sessionId}`;
  if (id) return String(id);
  return null;
}

function getReconcileDecision(db, stripeKey, actionType) {
  if (!stripeKey) return null;
  return (
    db
      .prepare(
        "SELECT * FROM stripe_reconcile_decisions WHERE stripe_key = ? AND action_type = ?"
      )
      .get(stripeKey, actionType) || null
  );
}

function saveReconcileDecision(db, {
  stripeKey,
  paymentIntentId,
  sessionId,
  actionType,
  decision,
  userId = null,
  parentId = null,
  amountCents = null,
  note = null,
}) {
  const now = Date.now();
  db.prepare(
    `
    INSERT INTO stripe_reconcile_decisions
      (stripe_key, payment_intent_id, session_id, action_type, decision, user_id, parent_id, amount_cents, note, decided_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(stripe_key, action_type) DO UPDATE SET
      decision = excluded.decision,
      user_id = excluded.user_id,
      parent_id = excluded.parent_id,
      amount_cents = excluded.amount_cents,
      note = excluded.note,
      decided_at = excluded.decided_at,
      payment_intent_id = excluded.payment_intent_id,
      session_id = excluded.session_id
  `
  ).run(
    stripeKey,
    paymentIntentId || null,
    sessionId || null,
    actionType,
    decision,
    userId,
    parentId,
    amountCents,
    note,
    now
  );
}

function findChrisShareForStripe(
  db,
  { paymentIntentId, sessionId, amountCents, aroundMs, windowMs } = {}
) {
  if (paymentIntentId) {
    try {
      const row = db
        .prepare(
          "SELECT * FROM chrisPaymentHistory WHERE stripe_payment_intent_id = ? AND type = 'credit' LIMIT 1"
        )
        .get(String(paymentIntentId));
      if (row) return row;
    } catch (_) {}
  }
  if (sessionId) {
    try {
      const row = db
        .prepare(
          "SELECT * FROM chrisPaymentHistory WHERE stripe_session_id = ? AND type = 'credit' LIMIT 1"
        )
        .get(String(sessionId));
      if (row) return row;
    } catch (_) {}
  }

  // Legacy rows (before Stripe ids were stored): match expected 3% cut near the paid time
  const expected = Math.round(Number(amountCents) || 0);
  const at = Number(aroundMs) || 0;
  if (expected > 0 && at > 0) {
    const window = Number(windowMs) > 0 ? Number(windowMs) : 3 * 24 * 60 * 60 * 1000;
    try {
      const row = db
        .prepare(
          `
          SELECT * FROM chrisPaymentHistory
          WHERE type = 'credit'
            AND amount = ?
            AND created_at BETWEEN ? AND ?
            AND (stripe_payment_intent_id IS NULL OR stripe_payment_intent_id = '')
            AND (stripe_session_id IS NULL OR stripe_session_id = '')
          ORDER BY ABS(created_at - ?) ASC
          LIMIT 1
        `
        )
        .get(expected, at - window, at + window, at);
      if (row) {
        // Backfill Stripe ids so future reconciles don't re-prompt
        try {
          if (paymentIntentId || sessionId) {
            db.prepare(
              `
              UPDATE chrisPaymentHistory
              SET stripe_payment_intent_id = COALESCE(stripe_payment_intent_id, ?),
                  stripe_session_id = COALESCE(stripe_session_id, ?)
              WHERE id = ?
            `
            ).run(paymentIntentId || null, sessionId || null, row.id);
          }
        } catch (_) {}
        return row;
      }
    } catch (_) {}
  }
  return null;
}

function recordChrisShareWithStripe(db, {
  baseAmountCents,
  source,
  paidAt,
  paymentIntentId,
  sessionId,
}) {
  const base = Math.round(Number(baseAmountCents) || 0);
  if (base <= 0) return { ok: false, error: "Invalid Chris share base amount." };
  const existing = findChrisShareForStripe(db, { paymentIntentId, sessionId });
  if (existing) return { ok: true, already: true, chrisCut: existing.amount };

  const chrisCut = Math.round(base * 0.03);
  if (!chrisCut) return { ok: true, already: false, chrisCut: 0 };

  const at = Number(paidAt) > 0 ? Number(paidAt) : Date.now();
  db.prepare("UPDATE chrisPayment SET total_owed = total_owed + ? WHERE id = 1").run(chrisCut);

  const chrisCols = db.prepare("PRAGMA table_info(chrisPaymentHistory)").all().map((c) => c.name);
  if (chrisCols.includes("stripe_payment_intent_id")) {
    db.prepare(
      `
      INSERT INTO chrisPaymentHistory
        (created_at, amount, type, note, source, stripe_payment_intent_id, stripe_session_id)
      VALUES (?, ?, 'credit', ?, ?, ?, ?)
    `
    ).run(
      at,
      chrisCut,
      `3% share from ${source || "transaction"}`,
      source || "",
      paymentIntentId || null,
      sessionId || null
    );
  } else {
    db.prepare(
      `
      INSERT INTO chrisPaymentHistory (created_at, amount, type, note, source)
      VALUES (?, ?, 'credit', ?, ?)
    `
    ).run(at, chrisCut, `3% share from ${source || "transaction"}`, source || "");
  }

  return { ok: true, already: false, chrisCut };
}

function findPaymentByStripeIds(db, { paymentIntentId, sessionId } = {}) {
  if (paymentIntentId) {
    const row = db
      .prepare("SELECT * FROM paymentHistory WHERE stripe_payment_intent_id = ?")
      .get(String(paymentIntentId));
    if (row) return row;
  }
  if (sessionId) {
    const row = db
      .prepare("SELECT * FROM paymentHistory WHERE stripe_session_id = ?")
      .get(String(sessionId));
    if (row) return row;
  }
  return null;
}

function money(cents) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format((Number(cents) || 0) / 100);
}

function inferPotentialKind(potential) {
  if (potential.kind) return String(potential.kind);
  if (potential.contract_id) return "contract";
  if (potential.child_id && potential.parent_id) return "pay_behalf";
  return "make_payment";
}

function insertStripePaymentHistory(db, {
  title,
  description,
  amountCents,
  userId,
  paymentIntentId,
  sessionId,
  paidAt,
  towardsBalance = false,
}) {
  ensureStripePaymentColumns(db);
  return db
    .prepare(
      `
      INSERT INTO paymentHistory
        (title, description, amount, method, date, user_id, stripe_payment_intent_id, stripe_session_id, towards_balance)
      VALUES (?, ?, ?, 'Stripe', ?, ?, ?, ?, ?)
    `
    )
    .run(
      title,
      description,
      amountCents,
      paidAt || Date.now(),
      userId || null,
      paymentIntentId || null,
      sessionId || null,
      towardsBalance ? 1 : 0
    );
}

/**
 * Apply a tuition-style payment (member self-pay or parent pay-behalf).
 * potential.amount is the tuition base (not including processing fee).
 */
function maybeSendEmail(deps, to, subject, html) {
  if (deps?.silent) return;
  if (typeof deps?.sendEmail !== "function") return;
  if (!to) return;
  deps.sendEmail(to, subject, html);
}

function finalizeTuitionPotential(db, potential, deps, stripeMeta = {}) {
  const { addChrisShare, MasterEmail } = deps;
  const existing = findPaymentByStripeIds(db, stripeMeta);
  if (existing) {
    if (potential?.id) {
      db.prepare("DELETE FROM potential_payment WHERE id = ?").run(potential.id);
    }
    return { ok: true, already: true, paymentId: existing.id };
  }

  const kind = inferPotentialKind(potential);
  const isPayBehalf = kind === "pay_behalf" || (!!potential.child_id && !!potential.parent_id);
  const beneficiaryId = isPayBehalf ? potential.child_id : potential.user_id;
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(beneficiaryId);
  if (!user) return { ok: false, error: "User not found for potential payment." };

  const paid = Number(potential.amount) || 0;
  if (paid <= 0) return { ok: false, error: "Invalid potential payment amount." };

  const alreadyPaid = Number(user.paid || 0) + paid;
  const left = Number(user.owed || 0) - paid;
  db.prepare("UPDATE users SET paid = ?, owed = ? WHERE id = ?").run(
    alreadyPaid,
    left,
    user.id
  );

  const paidString = money(paid);
  let title;
  let description;
  let emailTo = user.email;
  let chrisNote;

  if (isPayBehalf) {
    const parent = db.prepare("SELECT * FROM users WHERE id = ?").get(potential.parent_id);
    const parentName = parent
      ? `${parent.firstname} ${parent.lastname}`
      : "Parent";
    title = `Payment for ${user.firstname} ${user.lastname} by parent, ${parentName}`;
    description = `Parent ${parentName} paid for their child, ${user.firstname} ${user.lastname} with an amount of ${paidString}.`;
    chrisNote = description;
    emailTo = parent?.email || user.email;
  } else {
    title = `Payment by ${user.firstname} ${user.lastname}`;
    description = `${user.firstname} ${user.lastname} made a payment of ${paidString} towards their tuition/fees.`;
    chrisNote = description;
  }

  if (!deps.skipChrisShare && typeof addChrisShare === "function") {
    addChrisShare(paid, chrisNote, stripeMeta.paidAt || null, {
      paymentIntentId: stripeMeta.paymentIntentId,
      sessionId: stripeMeta.sessionId,
    });
  }

  let paymentId;
  try {
    paymentId = insertStripePaymentHistory(db, {
      title,
      description,
      amountCents: paid,
      userId: user.id,
      paymentIntentId: stripeMeta.paymentIntentId,
      sessionId: stripeMeta.sessionId,
      paidAt: stripeMeta.paidAt,
      towardsBalance: true,
    }).lastInsertRowid;
  } catch (err) {
    // Unique index race: another request already recorded this Stripe id
    const again = findPaymentByStripeIds(db, stripeMeta);
    if (again) {
      if (potential?.id) {
        db.prepare("DELETE FROM potential_payment WHERE id = ?").run(potential.id);
      }
      return { ok: true, already: true, paymentId: again.id };
    }
    throw err;
  }

  if (potential?.id) {
    db.prepare("DELETE FROM potential_payment WHERE id = ?").run(potential.id);
  }

  const emailBody = `
    <h1 style="text-align: center;">Payment Received!</h1>
    <br/>
    <p>${description}</p>
    <p>Paid through Stripe on ${new Date(stripeMeta.paidAt || Date.now()).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    })}.</p>
  `;
  maybeSendEmail(deps, emailTo, "Payment Received!", emailBody);
  maybeSendEmail(deps, MasterEmail, "Payment Received!", emailBody);

  return {
    ok: true,
    already: false,
    paymentId,
    userId: user.id,
    amountCents: paid,
    chrisBaseCents: paid,
    chrisNote,
  };
}

/**
 * Finalize a contract down-payment potential (amount includes fee in potential.amount).
 */
function finalizeContractPotential(db, potential, deps, stripeMeta = {}) {
  const { addChrisShare, sendEmail, MasterEmail, markUserContracted } = deps;
  const existing = findPaymentByStripeIds(db, stripeMeta);
  if (existing) {
    if (potential?.id) {
      db.prepare("DELETE FROM potential_payment WHERE id = ?").run(potential.id);
    }
    return { ok: true, already: true, paymentId: existing.id };
  }

  const contractExtension = db
    .prepare("SELECT * FROM contractExtension WHERE id = ?")
    .get(potential.contract_id);
  if (!contractExtension) {
    return { ok: false, error: "Contract extension missing for potential payment." };
  }

  let ensemble = "independent";
  if (String(contractExtension.season || "").includes("corps")) ensemble = "corps";
  else if (String(contractExtension.season || "").includes("affiliate")) ensemble = "affiliate";

  const memberId = contractExtension.child_id || contractExtension.user_id;
  const isMinorContract = !!contractExtension.child_id;
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(memberId);
  if (!user) return { ok: false, error: "Contract member not found." };

  const tuition = db
    .prepare("SELECT amount, deposit_amount FROM tuitionFees WHERE ensemble = ?")
    .get(ensemble);
  if (!tuition) return { ok: false, error: "Tuition fees missing for ensemble." };

  const alreadyContracted = db
    .prepare(
      `
      SELECT id FROM contractedMembers
      WHERE user_id = ? AND season = ? AND ensemble = ?
      ORDER BY contracted_date DESC LIMIT 1
    `
    )
    .get(user.id, contractExtension.season, ensemble);

  let endsAt = null;
  if (!alreadyContracted) {
    endsAt = markUserContracted(memberId, ensemble, tuition.amount);
  } else {
    endsAt = alreadyContracted.ends_at || null;
  }

  const userAfter = db.prepare("SELECT * FROM users WHERE id = ?").get(memberId);
  let downPayment = Number(tuition.deposit_amount || 0);
  if (!downPayment || downPayment <= 0) downPayment = Number(tuition.amount || 0);

  // Only deduct deposit if we just added tuition via markUserContracted / or still owed
  if (!alreadyContracted) {
    const remainingOwed = Number(userAfter?.owed || 0) - downPayment;
    db.prepare("UPDATE users SET owed = ? WHERE id = ?").run(remainingOwed, user.id);
  }

  if (!deps.skipChrisShare && typeof addChrisShare === "function") {
    addChrisShare(
      downPayment,
      `Contract down payment for ${ensemble} (user ${user.id})`,
      stripeMeta.paidAt || null,
      {
        paymentIntentId: stripeMeta.paymentIntentId,
        sessionId: stripeMeta.sessionId,
      }
    );
  }

  const feeCents = (Number(potential.amount) || 0) - downPayment;
  const paymentTitle = `Contract down payment for ${ensemble} ensemble`;
  const paymentDesc = `User ${user.firstname} ${user.lastname} made a $${(downPayment / 100).toFixed(
    2
  )} down payment (plus $${(Math.max(0, feeCents) / 100).toFixed(
    2
  )} processing fee) down payment for ${ensemble} contract.`;

  let paymentId;
  try {
    paymentId = insertStripePaymentHistory(db, {
      title: paymentTitle,
      description: paymentDesc,
      amountCents: potential.amount,
      userId: user.id,
      paymentIntentId: stripeMeta.paymentIntentId,
      sessionId: stripeMeta.sessionId,
      paidAt: stripeMeta.paidAt,
      towardsBalance: true,
    }).lastInsertRowid;
  } catch (err) {
    const again = findPaymentByStripeIds(db, stripeMeta);
    if (again) {
      if (potential?.id) {
        db.prepare("DELETE FROM potential_payment WHERE id = ?").run(potential.id);
      }
      return { ok: true, already: true, paymentId: again.id };
    }
    throw err;
  }

  if (!alreadyContracted) {
    db.prepare(
      `
      INSERT INTO contractedMembers
        (season, ensemble, contracted_date, user_id, signedContractPath, paymentMethod, field_values_json, signers_log_json, ends_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      contractExtension.season,
      ensemble,
      stripeMeta.paidAt || Date.now(),
      user.id,
      potential.contract_file_path || null,
      "stripe",
      contractExtension.field_values_json || null,
      contractExtension.signers_log_json || null,
      endsAt
    );
  }

  if (potential?.id) {
    db.prepare("DELETE FROM potential_payment WHERE id = ?").run(potential.id);
  }
  db.prepare("DELETE FROM contractExtension WHERE id = ?").run(contractExtension.id);

  if (isMinorContract) {
    const childRow = db
      .prepare("SELECT firstname, lastname, email FROM users WHERE id = ?")
      .get(memberId);
    if (childRow?.email) {
      maybeSendEmail(
        deps,
        childRow.email,
        "Your Boise Gems Contract Is Signed!",
        `<h1>Your Boise Gems Contract Is Signed!</h1><p>Hi ${childRow.firstname}, your ${ensemble} contract payment was received.</p>`
      );
    }
  }
  maybeSendEmail(deps, MasterEmail, "Contract payment received", paymentDesc);

  return { ok: true, already: false, paymentId, userId: user.id, amountCents: potential.amount };
}

function finalizePotentialPayment(db, potential, deps, stripeMeta = {}) {
  if (!potential) return { ok: false, error: "Missing potential payment." };
  const kind = inferPotentialKind(potential);
  if (kind === "contract") {
    return finalizeContractPotential(db, potential, deps, stripeMeta);
  }
  return finalizeTuitionPotential(db, potential, deps, stripeMeta);
}

/**
 * Record a succeeded Stripe payment that has no leftover potential_payment row
 * (the common failure mode when success_url never loaded).
 * Treats amount as tuition+~6% fee unless recordAmountCents is provided.
 */
function backfillTuitionFromStripe(db, {
  userId,
  stripeAmountCents,
  paymentIntentId,
  sessionId,
  paidAt,
  note,
  parentId,
}, deps) {
  const existing = findPaymentByStripeIds(db, { paymentIntentId, sessionId });
  if (existing) return { ok: true, already: true, paymentId: existing.id };

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!user) return { ok: false, error: "User not found." };

  const total = Math.round(Number(stripeAmountCents) || 0);
  if (total <= 0) return { ok: false, error: "Invalid Stripe amount." };

  // Recover base tuition from total that included ~6% fee
  let tuitionAmount = Math.round(total / 1.06);
  if (tuitionAmount <= 0 || tuitionAmount > total) tuitionAmount = total;

  const fakePotential = {
    id: null,
    amount: tuitionAmount,
    user_id: parentId ? null : userId,
    child_id: parentId ? userId : null,
    parent_id: parentId || null,
    kind: parentId ? "pay_behalf" : "make_payment",
  };

  // Apply balances + history directly (reuse tuition path without needing potential row)
  const result = finalizeTuitionPotential(
    db,
    fakePotential,
    deps,
    { paymentIntentId, sessionId, paidAt }
  );

  if (result.ok && !result.already && note) {
    db.prepare("UPDATE paymentHistory SET description = description || ? WHERE id = ?").run(
      ` [Backfilled from Stripe: ${note}]`,
      result.paymentId
    );
  }
  return result;
}

function findPotentialForSession(db, session) {
  const meta = session?.metadata || {};
  const potentialId = Number(meta.potential_id || meta.potentialId || 0);
  if (potentialId) {
    const row = db.prepare("SELECT * FROM potential_payment WHERE id = ?").get(potentialId);
    if (row) return row;
  }
  if (session?.id) {
    const row = db
      .prepare("SELECT * FROM potential_payment WHERE stripe_session_id = ?")
      .get(session.id);
    if (row) return row;
  }
  return null;
}

function stripeIdsFromSession(session) {
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id || null;
  return {
    paymentIntentId,
    sessionId: session.id || null,
    paidAt: session.created ? session.created * 1000 : Date.now(),
  };
}

function findDonationPotentialForSession(db, session) {
  const meta = session?.metadata || {};
  const potentialId = Number(meta.potential_id || meta.potentialId || 0);
  if (potentialId) {
    const row = db.prepare("SELECT * FROM potential_donation WHERE id = ?").get(potentialId);
    if (row) return row;
  }
  if (session?.id) {
    const row = db
      .prepare("SELECT * FROM potential_donation WHERE stripe_session_id = ?")
      .get(session.id);
    if (row) return row;
  }
  const fromUrl = parseSuccessUrl(session?.success_url || "");
  if (fromUrl.kind === "donation" && fromUrl.potentialId) {
    return db.prepare("SELECT * FROM potential_donation WHERE id = ?").get(fromUrl.potentialId) || null;
  }
  return null;
}

function finalizeDonationPotential(db, potential, deps, stripeMeta = {}) {
  if (!potential) return { ok: false, error: "Missing donation potential." };
  const existing = findPaymentByStripeIds(db, stripeMeta);
  if (existing) {
    try {
      db.prepare("DELETE FROM potential_donation WHERE id = ?").run(potential.id);
    } catch (_) {}
    return { ok: true, already: true, paymentId: existing.id };
  }
  if (stripeMeta.sessionId) {
    const don = db
      .prepare("SELECT id FROM donations WHERE stripe_session_id = ?")
      .get(stripeMeta.sessionId);
    if (don) {
      try {
        db.prepare("DELETE FROM potential_donation WHERE id = ?").run(potential.id);
      } catch (_) {}
      return { ok: true, already: true, donationId: don.id };
    }
  }

  const paidAt = stripeMeta.paidAt || Date.now();
  const donationId = db
    .prepare(
      `
      INSERT INTO donations
        (email, name, message, amount, processing_fee, total_charged, stripe_session_id, created_at, user_id, tier, donation_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    )
    .run(
      potential.email,
      potential.name,
      potential.message || "",
      potential.amount,
      potential.processing_fee || 0,
      potential.total_charge,
      stripeMeta.sessionId || potential.stripe_session_id || null,
      paidAt,
      potential.user_id || null,
      potential.tier || null,
      potential.donation_type || "one_time"
    ).lastInsertRowid;

  if (!deps.skipChrisShare && typeof deps.addChrisShare === "function") {
    deps.addChrisShare(
      potential.total_charge,
      `Donation of ${money(potential.amount)} (processing fee ${money(potential.processing_fee || 0)}, total charged ${money(potential.total_charge)})`,
      paidAt,
      {
        paymentIntentId: stripeMeta.paymentIntentId,
        sessionId: stripeMeta.sessionId || potential.stripe_session_id,
      }
    );
  }

  let paymentId;
  try {
    paymentId = insertStripePaymentHistory(db, {
      title: `Donation by ${potential.name}`,
      description: `Donation of ${money(potential.amount)} (processing fee ${money(
        potential.processing_fee || 0
      )}, total charged ${money(potential.total_charge)}). Message: ${potential.message || "-"}`,
      amountCents: potential.total_charge,
      userId: potential.user_id || null,
      paymentIntentId: stripeMeta.paymentIntentId,
      sessionId: stripeMeta.sessionId || potential.stripe_session_id,
      paidAt,
    }).lastInsertRowid;
  } catch (err) {
    const again = findPaymentByStripeIds(db, stripeMeta);
    if (again) {
      try {
        db.prepare("DELETE FROM potential_donation WHERE id = ?").run(potential.id);
      } catch (_) {}
      return { ok: true, already: true, paymentId: again.id, donationId };
    }
    throw err;
  }

  try {
    db.prepare("DELETE FROM potential_donation WHERE id = ?").run(potential.id);
  } catch (_) {}

  return {
    ok: true,
    already: false,
    paymentId,
    donationId,
    amountCents: potential.total_charge,
  };
}

function findEventRsvpPotentialForSession(db, session) {
  const meta = session?.metadata || {};
  const potentialId = Number(meta.potential_id || meta.potentialId || 0);
  if (potentialId) {
    const row = db.prepare("SELECT * FROM potential_event_rsvp WHERE id = ?").get(potentialId);
    if (row) return row;
  }
  if (session?.id) {
    const row = db
      .prepare("SELECT * FROM potential_event_rsvp WHERE stripe_session_id = ?")
      .get(session.id);
    if (row) return row;
  }
  const fromUrl = parseSuccessUrl(session?.success_url || "");
  if (fromUrl.kind === "event_rsvp" && fromUrl.potentialId) {
    return db.prepare("SELECT * FROM potential_event_rsvp WHERE id = ?").get(fromUrl.potentialId) || null;
  }
  return null;
}

async function handleCheckoutSessionCompleted(db, session, deps) {
  if (!session || (session.payment_status && session.payment_status !== "paid" && session.status !== "complete")) {
    return { ok: false, error: "Session not paid." };
  }

  if (
    !isFromBoiseGemsWebsite({
      successUrl: session.success_url,
      cancelUrl: session.cancel_url,
      metadata: session.metadata,
    })
  ) {
    return {
      ok: true,
      skipped: true,
      error: "Not a boisegems.org checkout — ignored.",
    };
  }

  const stripeMeta = stripeIdsFromSession(session);
  const already = findPaymentByStripeIds(db, stripeMeta);
  if (already) return { ok: true, already: true, paymentId: already.id };

  const classified = classifyStripeCheckout(session, []);
  const kind = String(session.metadata?.kind || classified.kind || "");

  // Event RSVP — finalize leftover potential or match event from success URL / line items
  if (kind === "event_rsvp") {
    const pot = findEventRsvpPotentialForSession(db, session);
    if (pot) {
      return backfillEventRsvpFromStripe(
        db,
        {
          userId: pot.user_id,
          eventId: pot.event_id,
          stripeAmountCents: pot.total_charge || session.amount_total || 0,
          paymentIntentId: stripeMeta.paymentIntentId,
          sessionId: stripeMeta.sessionId,
          paidAt: stripeMeta.paidAt,
          potentialId: pot.id,
        },
        deps
      );
    }
    const eventHit = findEventForStripeRow(db, {
      guessedPotentialId: classified.potentialId,
      sessionId: session.id,
      successUrl: session.success_url,
      lineItems: [],
    });
    // Without a user we can't safely RSVP — leave for manual reconcile
    return {
      ok: false,
      error: "Paid event RSVP with no leftover potential; needs manual reconcile.",
      stripeMeta,
      eventId: eventHit?.event?.id || null,
    };
  }

  if (kind === "merch" || kind === "fan_subscribe") {
    return { ok: true, skipped: true, reason: kind };
  }

  if (kind === "donation") {
    const pot = findDonationPotentialForSession(db, session);
    if (pot) {
      return finalizeDonationPotential(db, pot, deps, stripeMeta);
    }
    // No leftover potential — still record a donation row so money isn't invisible
    return backfillDonationFromStripe(
      db,
      {
        stripeAmountCents: session.amount_total || 0,
        paymentIntentId: stripeMeta.paymentIntentId,
        sessionId: stripeMeta.sessionId,
        paidAt: stripeMeta.paidAt,
        email: session.customer_details?.email || session.customer_email || "",
        name:
          session.customer_details?.name ||
          session.customer_email ||
          "Donor",
        message: "Recorded by Stripe recovery poller",
      },
      deps
    );
  }

  const potential = findPotentialForSession(db, session);
  if (potential) {
    return finalizePotentialPayment(db, potential, deps, stripeMeta);
  }

  // No potential left — try to credit a member by email for tuition-like checkouts
  if (kind === "make_payment" || kind === "pay_behalf" || kind === "unknown" || !kind) {
    const email = String(
      session.customer_details?.email || session.customer_email || ""
    )
      .trim()
      .toLowerCase();
    if (email) {
      const user = db
        .prepare("SELECT * FROM users WHERE lower(email) = ? LIMIT 1")
        .get(email);
      if (user && !user.parent) {
        return backfillTuitionFromStripe(
          db,
          {
            userId: user.id,
            stripeAmountCents: session.amount_total || 0,
            paymentIntentId: stripeMeta.paymentIntentId,
            sessionId: stripeMeta.sessionId,
            paidAt: stripeMeta.paidAt,
            note: `auto recovery ${session.id}`,
            parentId: null,
          },
          deps
        );
      }
      // Parent email paying for child: only if metadata/kind says pay_behalf with child id
      if (user && (user.parent || kind === "pay_behalf") && session.metadata?.child_id) {
        return backfillTuitionFromStripe(
          db,
          {
            userId: Number(session.metadata.child_id),
            stripeAmountCents: session.amount_total || 0,
            paymentIntentId: stripeMeta.paymentIntentId,
            sessionId: stripeMeta.sessionId,
            paidAt: stripeMeta.paidAt,
            note: `auto recovery ${session.id}`,
            parentId: user.id,
          },
          deps
        );
      }
    }
  }

  return {
    ok: false,
    error: "No potential_payment row and could not auto-match a member. Needs manual backfill.",
    stripeMeta,
  };
}

/**
 * Poll Stripe for recently paid Checkout Sessions and finalize any the site missed
 * (e.g. success_url never loaded). No webhook / dashboard access required.
 */
async function pollAndRecoverPaidCheckouts(db, stripe, deps, options = {}) {
  ensureStripePaymentColumns(db);
  const lookbackHours = Math.max(1, Number(options.lookbackHours) || 48);
  const sinceUnix = Math.floor(Date.now() / 1000) - lookbackHours * 3600;
  const summary = {
    checkedPotentials: 0,
    checkedSessions: 0,
    recovered: 0,
    already: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  async function trySession(session, source) {
    if (!session) return;
    if (session.payment_status !== "paid" && session.status !== "complete") return;
    if (
      !isFromBoiseGemsWebsite({
        successUrl: session.success_url,
        cancelUrl: session.cancel_url,
        metadata: session.metadata,
      })
    ) {
      summary.skipped += 1;
      return;
    }
    try {
      const result = await handleCheckoutSessionCompleted(db, session, deps);
      if (result?.already) summary.already += 1;
      else if (result?.skipped) summary.skipped += 1;
      else if (result?.ok) {
        summary.recovered += 1;
        console.log(
          `[stripe-recover] finalized ${session.id} via ${source}` +
            (result.eventTitle ? ` (RSVP ${result.eventTitle})` : "")
        );
      } else {
        summary.failed += 1;
        if (result?.error) summary.errors.push(`${session.id}: ${result.error}`);
      }
    } catch (err) {
      summary.failed += 1;
      summary.errors.push(`${session.id}: ${err.message || err}`);
      console.error("[stripe-recover] finalize failed:", session.id, err.message || err);
    }
  }

  // 1) Leftover potential rows that still have a Stripe session id
  const openSessions = [];
  try {
    openSessions.push(
      ...db
        .prepare(
          "SELECT stripe_session_id AS sid FROM potential_payment WHERE stripe_session_id IS NOT NULL AND TRIM(stripe_session_id) <> ''"
        )
        .all()
        .map((r) => r.sid)
    );
  } catch (_) {}
  try {
    openSessions.push(
      ...db
        .prepare(
          "SELECT stripe_session_id AS sid FROM potential_event_rsvp WHERE stripe_session_id IS NOT NULL AND TRIM(stripe_session_id) <> ''"
        )
        .all()
        .map((r) => r.sid)
    );
  } catch (_) {}
  try {
    openSessions.push(
      ...db
        .prepare(
          "SELECT stripe_session_id AS sid FROM potential_donation WHERE stripe_session_id IS NOT NULL AND TRIM(stripe_session_id) <> ''"
        )
        .all()
        .map((r) => r.sid)
    );
  } catch (_) {}

  const uniqueOpen = [...new Set(openSessions.filter(Boolean))];
  for (const sid of uniqueOpen) {
    summary.checkedPotentials += 1;
    try {
      const session = await stripe.checkout.sessions.retrieve(sid);
      await trySession(session, "potential");
    } catch (err) {
      summary.failed += 1;
      summary.errors.push(`${sid}: ${err.message || err}`);
    }
  }

  // 2) Recent paid Checkout Sessions from Stripe API
  let starting_after;
  for (;;) {
    const page = await stripe.checkout.sessions.list({
      limit: 100,
      created: { gte: sinceUnix },
      ...(starting_after ? { starting_after } : {}),
    });
    const data = page.data || [];
    for (const session of data) {
      summary.checkedSessions += 1;
      const ids = stripeIdsFromSession(session);
      if (findPaymentByStripeIds(db, ids)) {
        summary.already += 1;
        continue;
      }
      await trySession(session, "list");
    }
    if (!page.has_more || !data.length) break;
    starting_after = data[data.length - 1].id;
  }

  return summary;
}

function startStripeRecoveryPoller(db, stripe, deps, options = {}) {
  const enabled =
    String(process.env.STRIPE_RECOVERY_POLLER || "true").trim().toLowerCase() !== "false";
  if (!enabled) {
    console.log("[stripe-recover] poller disabled (STRIPE_RECOVERY_POLLER=false)");
    return null;
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    console.log("[stripe-recover] poller skipped — no STRIPE_SECRET_KEY");
    return null;
  }

  const intervalMs = Math.max(
    60 * 1000,
    Number(options.intervalMs || process.env.STRIPE_RECOVERY_INTERVAL_MS || 5 * 60 * 1000)
  );
  const lookbackHours = Number(options.lookbackHours || process.env.STRIPE_RECOVERY_LOOKBACK_HOURS || 48);

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const summary = await pollAndRecoverPaidCheckouts(db, stripe, deps, { lookbackHours });
      if (summary.recovered > 0 || summary.failed > 0) {
        console.log(
          `[stripe-recover] potentials=${summary.checkedPotentials} sessions=${summary.checkedSessions} recovered=${summary.recovered} already=${summary.already} failed=${summary.failed}`
        );
      }
    } catch (err) {
      console.error("[stripe-recover] poll failed:", err.message || err);
    } finally {
      running = false;
    }
  };

  // First run shortly after boot, then on interval
  setTimeout(tick, 20 * 1000);
  const handle = setInterval(tick, intervalMs);
  if (handle.unref) handle.unref();
  console.log(
    `[stripe-recover] poller started (every ${Math.round(intervalMs / 1000)}s, lookback ${lookbackHours}h)`
  );
  return handle;
}

function parseSuccessUrl(url) {
  const s = String(url || "");
  const patterns = [
    { kind: "make_payment", re: /\/make-payment\/success\/(\d+)/i },
    { kind: "pay_behalf", re: /\/pay-behalf\/success\/(\d+)/i },
    { kind: "contract", re: /\/sign-contract\/success\/(\d+)/i },
    { kind: "donation", re: /\/donate\/success\/(\d+)/i },
    { kind: "video_audition", re: /\/video-audition\/success\/(\d+)/i },
    { kind: "event_rsvp", re: /\/rsvp\/success\/(\d+)/i },
    { kind: "merch", re: /\/store\/success\/(\d+)/i },
  ];
  for (const p of patterns) {
    const m = s.match(p.re);
    if (m) return { kind: p.kind, potentialId: Number(m[1]) || null };
  }
  return { kind: null, potentialId: null };
}

/** Hosts that count as THIS Boise Gems website (not jackets / Payment Links / other apps). */
function getBoiseGemsWebsiteHosts() {
  const hosts = new Set(["boisegems.org", "www.boisegems.org"]);
  try {
    const base = String(process.env.BASEURL || "").trim();
    if (base) {
      const u = new URL(base.includes("://") ? base : `https://${base}`);
      if (u.hostname) hosts.add(String(u.hostname).toLowerCase());
    }
  } catch (_) {}
  return hosts;
}

function urlIsBoiseGemsWebsite(url) {
  const raw = String(url || "").trim();
  if (!raw) return false;
  try {
    const u = new URL(raw);
    const host = String(u.hostname || "").toLowerCase();
    if (!host) return false;
    const allowed = getBoiseGemsWebsiteHosts();
    if (allowed.has(host)) return true;
    // Treat apex / www as the same site
    const bare = host.replace(/^www\./, "");
    for (const h of allowed) {
      if (h.replace(/^www\./, "") === bare) return true;
    }
    return false;
  } catch (_) {
    return false;
  }
}

/**
 * True only when the Stripe checkout/payment was created by this website.
 * Primary signal: success_url / cancel_url on boisegems.org (or BASEURL host).
 * Merch uses PaymentIntents with potential_order_id and may have no Checkout URL.
 */
function isFromBoiseGemsWebsite({ successUrl, cancelUrl, metadata } = {}) {
  if (urlIsBoiseGemsWebsite(successUrl) || urlIsBoiseGemsWebsite(cancelUrl)) {
    return true;
  }
  const meta = metadata || {};
  // Store checkout PaymentIntents created by merch-system.js on this site
  if (meta.potential_order_id) return true;
  return false;
}

function classifyStripeCheckout(session, lineItemNames = []) {
  const meta = session?.metadata || {};
  if (meta.kind) {
    return {
      kind: String(meta.kind),
      potentialId: Number(meta.potential_id || meta.potentialId || meta.potential_order_id || 0) || null,
    };
  }
  if (meta.potential_order_id) {
    return { kind: "merch", potentialId: Number(meta.potential_order_id) || null };
  }
  const fromUrl = parseSuccessUrl(session?.success_url || "");
  if (fromUrl.kind) return fromUrl;

  const blob = `${lineItemNames.join(" ")} ${session?.description || ""}`.toLowerCase();
  // RSVP line items look like "RSVP: BGI Callback Audition" — check before "audition"
  if (/\brsvp\b/.test(blob) || /^rsvp\s*:/.test(blob.trim())) {
    return { kind: "event_rsvp", potentialId: null };
  }
  if (blob.includes("donation") || blob.includes("donate")) return { kind: "donation", potentialId: null };
  if (
    blob.includes("video audition") ||
    blob.includes("audition unlock") ||
    blob.includes("audition application")
  ) {
    return { kind: "video_audition", potentialId: null };
  }
  if (blob.includes("contract") || blob.includes("down payment")) return { kind: "contract", potentialId: null };
  if (blob.includes("tuition") || blob.includes("payment for tuition")) return { kind: "make_payment", potentialId: null };
  if (blob.includes("store") || blob.includes("merch")) return { kind: "merch", potentialId: null };
  return { kind: "unknown", potentialId: null };
}

function findEventForStripeRow(db, {
  guessedPotentialId,
  sessionId,
  successUrl,
  lineItems,
} = {}) {
  const potId = Number(guessedPotentialId) || 0;
  let potential = null;
  if (potId) {
    potential = db.prepare("SELECT * FROM potential_event_rsvp WHERE id = ?").get(potId) || null;
  }
  if (!potential && sessionId) {
    potential =
      db.prepare("SELECT * FROM potential_event_rsvp WHERE stripe_session_id = ?").get(sessionId) ||
      null;
  }
  if (potential) {
    const event = db.prepare("SELECT * FROM events WHERE id = ?").get(potential.event_id);
    if (event) return { event, potential };
  }

  const slugMatch = String(successUrl || "").match(/\/event\/([^/?#]+)\/rsvp\/success/i);
  if (slugMatch) {
    const event = db.prepare("SELECT * FROM events WHERE slug = ?").get(decodeURIComponent(slugMatch[1]));
    if (event) return { event, potential: null };
  }

  for (const li of lineItems || []) {
    const name = String(li.name || "").trim();
    const m = name.match(/^RSVP:\s*(.+)$/i);
    if (!m) continue;
    const title = m[1].trim();
    let event =
      db.prepare("SELECT * FROM events WHERE title = ? COLLATE NOCASE LIMIT 1").get(title) || null;
    if (!event) {
      event =
        db
          .prepare(
            `
            SELECT * FROM events
            WHERE title LIKE ? COLLATE NOCASE
            ORDER BY datetime DESC
            LIMIT 1
          `
          )
          .get(`%${title}%`) || null;
    }
    if (event) return { event, potential: null, matchedTitle: title };
  }
  return null;
}

function backfillEventRsvpFromStripe(db, {
  userId,
  eventId,
  stripeAmountCents,
  paymentIntentId,
  sessionId,
  paidAt,
  potentialId,
}, deps) {
  const existing = findPaymentByStripeIds(db, { paymentIntentId, sessionId });
  if (existing) return { ok: true, already: true, paymentId: existing.id };

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!user) return { ok: false, error: "User not found for event RSVP." };
  const event = db.prepare("SELECT * FROM events WHERE id = ?").get(eventId);
  if (!event) return { ok: false, error: "Event not found for RSVP." };

  const total = Math.round(Number(stripeAmountCents) || 0);
  if (total <= 0) return { ok: false, error: "Invalid RSVP amount." };

  const existingRsvp = db
    .prepare("SELECT * FROM rsvp WHERE user_id = ? AND event_id = ?")
    .get(user.id, event.id);
  if (existingRsvp) {
    db.prepare("UPDATE rsvp SET paid = 1 WHERE id = ?").run(existingRsvp.id);
  } else {
    db.prepare("INSERT INTO rsvp (user_id, event_id, paid) VALUES (?, ?, 1)").run(
      user.id,
      event.id
    );
  }

  if (!deps.skipChrisShare && typeof deps.addChrisShare === "function") {
    deps.addChrisShare(
      total,
      `$${ (total / 100).toFixed(2) } RSVP for ${event.title} by userID ${user.id}`,
      paidAt || null,
      { paymentIntentId, sessionId }
    );
  }

  let paymentId;
  try {
    paymentId = insertStripePaymentHistory(db, {
      title: `Event RSVP: ${event.title}`,
      description: `RSVP fee collected (${money(total)}). Recorded from Stripe reconcile.`,
      amountCents: total,
      userId: user.id,
      paymentIntentId,
      sessionId,
      paidAt,
    }).lastInsertRowid;
  } catch (err) {
    const again = findPaymentByStripeIds(db, { paymentIntentId, sessionId });
    if (again) return { ok: true, already: true, paymentId: again.id };
    throw err;
  }

  if (potentialId) {
    try {
      db.prepare("DELETE FROM potential_event_rsvp WHERE id = ?").run(Number(potentialId));
    } catch (_) {}
  } else if (sessionId) {
    try {
      db.prepare("DELETE FROM potential_event_rsvp WHERE stripe_session_id = ?").run(sessionId);
    } catch (_) {}
  }

  return {
    ok: true,
    already: false,
    paymentId,
    userId: user.id,
    eventId: event.id,
    eventTitle: event.title,
    amountCents: total,
    chrisBaseCents: total,
    chrisNote: `$${ (total / 100).toFixed(2) } RSVP for ${event.title} by userID ${user.id}`,
  };
}

function backfillDonationFromStripe(db, {
  stripeAmountCents,
  paymentIntentId,
  sessionId,
  paidAt,
  email,
  name,
  message,
}, deps) {
  const existing = findPaymentByStripeIds(db, { paymentIntentId, sessionId });
  if (existing) return { ok: true, already: true, paymentId: existing.id };

  if (sessionId) {
    const don = db.prepare("SELECT id FROM donations WHERE stripe_session_id = ?").get(sessionId);
    if (don) {
      // Ensure paymentHistory has stripe ids for future matching
      try {
        insertStripePaymentHistory(db, {
          title: `Donation by ${name || email || "donor"}`,
          description: "Donation (linked during reconcile).",
          amountCents: stripeAmountCents,
          userId: null,
          paymentIntentId,
          sessionId,
          paidAt,
        });
      } catch (_) {}
      return { ok: true, already: true, donationId: don.id };
    }
  }

  const total = Math.round(Number(stripeAmountCents) || 0);
  if (total <= 0) return { ok: false, error: "Invalid donation amount." };

  // Recover base/fee split (~6% fee) for donations table shape
  const base = Math.round(total / 1.06);
  const fee = Math.max(0, total - base);
  const donorEmail = String(email || "").trim() || "unknown@stripe.reconcile";
  const donorName = String(name || "").trim() || donorEmail;

  const donationId = db
    .prepare(
      `
      INSERT INTO donations
        (email, name, message, amount, processing_fee, total_charged, stripe_session_id, created_at, user_id, tier, donation_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'one_time')
    `
    )
    .run(
      donorEmail,
      donorName,
      message || "Recorded from Stripe reconcile (no member balance).",
      base,
      fee,
      total,
      sessionId || null,
      paidAt || Date.now()
    ).lastInsertRowid;

  if (!deps.skipChrisShare && typeof deps.addChrisShare === "function") {
    deps.addChrisShare(total, `Donation of ${money(base)} (reconcile)`, paidAt || null, {
      paymentIntentId,
      sessionId,
    });
  }

  let paymentId = null;
  try {
    paymentId = insertStripePaymentHistory(db, {
      title: `Donation by ${donorName}`,
      description: `Donation of ${money(base)} (processing fee ${money(fee)}, total charged ${money(total)}). Recorded from Stripe reconcile.`,
      amountCents: total,
      userId: null,
      paymentIntentId,
      sessionId,
      paidAt,
    }).lastInsertRowid;
  } catch (err) {
    const again = findPaymentByStripeIds(db, { paymentIntentId, sessionId });
    if (again) return { ok: true, already: true, paymentId: again.id, donationId };
    throw err;
  }

  return {
    ok: true,
    already: false,
    paymentId,
    donationId,
    amountCents: total,
    chrisBaseCents: total,
    chrisNote: `Donation of ${money(base)} (reconcile)`,
  };
}

function backfillVideoAuditionFromStripe(db, {
  userId,
  program,
  seasonYear,
  stripeAmountCents,
  paymentIntentId,
  sessionId,
  paidAt,
}, deps) {
  const existing = findPaymentByStripeIds(db, { paymentIntentId, sessionId });
  if (existing) return { ok: true, already: true, paymentId: existing.id };

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!user) return { ok: false, error: "User not found for video audition unlock." };

  const prog = String(program || "corps").toLowerCase() === "independent" ? "independent" : "corps";
  const season = Number(seasonYear) || new Date().getFullYear();
  const total = Math.round(Number(stripeAmountCents) || 0);
  const base = Math.round(total / 1.06);
  const fee = Math.max(0, total - base);
  const amount = base > 0 ? base : total;

  if (sessionId) {
    const bySession = db
      .prepare("SELECT id FROM video_audition_unlocks WHERE stripe_session_id = ?")
      .get(sessionId);
    if (bySession) {
      // Unlock exists; still attach paymentHistory for matching
    } else {
      db.prepare(
        `
        INSERT OR IGNORE INTO video_audition_unlocks
          (user_id, program, season_year, amount, stripe_session_id, unlocked_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `
      ).run(user.id, prog, season, amount, sessionId, paidAt || Date.now());
    }
  } else {
    db.prepare(
      `
      INSERT OR IGNORE INTO video_audition_unlocks
        (user_id, program, season_year, amount, stripe_session_id, unlocked_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `
    ).run(user.id, prog, season, amount, null, paidAt || Date.now());
  }

  // Clean leftover potential if present
  if (sessionId) {
    try {
      db.prepare("DELETE FROM potential_video_audition WHERE stripe_session_id = ?").run(sessionId);
    } catch (_) {}
  }

  if (!deps.skipChrisShare && typeof deps.addChrisShare === "function") {
    deps.addChrisShare(
      amount,
      `Video audition unlock (${prog} ${season})`,
      paidAt || null,
      { paymentIntentId, sessionId }
    );
  }

  let paymentId;
  try {
    paymentId = insertStripePaymentHistory(db, {
      title: `${prog === "independent" ? "BGI" : "Corps"} audition unlock ${season}`,
      description: `Video audition application fee (${money(amount)}) for ${season}. Processing fee ${money(fee)}. Recorded from Stripe reconcile.`,
      amountCents: amount,
      userId: user.id,
      paymentIntentId,
      sessionId,
      paidAt,
    }).lastInsertRowid;
  } catch (err) {
    const again = findPaymentByStripeIds(db, { paymentIntentId, sessionId });
    if (again) return { ok: true, already: true, paymentId: again.id };
    throw err;
  }

  return {
    ok: true,
    already: false,
    paymentId,
    userId: user.id,
    amountCents: amount,
    chrisBaseCents: amount,
    chrisNote: `Video audition unlock (${prog} ${season})`,
  };
}

/**
 * Chris reconcile apply — no audit logging. Silent by default (no receipt emails).
 */
function applyReconcilePayment(db, body, deps) {
  ensureStripePaymentColumns(db);

  const action = String(body.action || "").trim();
  const paymentIntentId = String(body.payment_intent_id || "").trim() || null;
  const sessionId = String(body.session_id || "").trim() || null;
  const paidAt = Number(body.paid_at) || Date.now();
  const stripeAmountCents = Math.round(Number(body.stripe_amount_cents) || 0);
  const email = String(body.email || "").trim().toLowerCase();
  const silentDeps = { ...deps, silent: true };

  if (!paymentIntentId && !sessionId) {
    return { ok: false, error: "Missing Stripe payment id." };
  }

  const already = findPaymentByStripeIds(db, { paymentIntentId, sessionId });
  if (already) return { ok: true, already: true, paymentId: already.id };

  if (action === "donation") {
    return backfillDonationFromStripe(
      db,
      {
        stripeAmountCents,
        paymentIntentId,
        sessionId,
        paidAt,
        email,
        name: body.name || email,
        message: body.message || "",
      },
      silentDeps
    );
  }

  if (action === "tuition" || action === "pay_behalf") {
    const userId = Number(body.user_id);
    if (!userId) return { ok: false, error: "Pick the member account this payment belongs to." };
    const parentId = action === "pay_behalf" ? Number(body.parent_id) || null : null;
    if (action === "pay_behalf" && !parentId) {
      return { ok: false, error: "Parent account is required for parent payments." };
    }

    // Prefer leftover potential_payment if Chris confirmed that id
    const potentialId = Number(body.potential_id) || 0;
    if (potentialId) {
      const potential = db.prepare("SELECT * FROM potential_payment WHERE id = ?").get(potentialId);
      if (potential) {
        return finalizePotentialPayment(db, potential, silentDeps, {
          paymentIntentId,
          sessionId,
          paidAt,
        });
      }
    }

    return backfillTuitionFromStripe(
      db,
      {
        userId,
        stripeAmountCents,
        paymentIntentId,
        sessionId,
        paidAt,
        note: "manual reconcile",
        parentId,
      },
      silentDeps
    );
  }

  if (action === "contract") {
    const potentialId = Number(body.potential_id) || 0;
    if (!potentialId) {
      return {
        ok: false,
        error: "Contract backfill needs the leftover potential payment id from checkout.",
      };
    }
    const potential = db.prepare("SELECT * FROM potential_payment WHERE id = ?").get(potentialId);
    if (!potential) return { ok: false, error: "Contract potential payment row not found." };
    return finalizeContractPotential(db, potential, silentDeps, {
      paymentIntentId,
      sessionId,
      paidAt,
    });
  }

  if (action === "video_audition") {
    const userId = Number(body.user_id);
    if (!userId) return { ok: false, error: "Pick the member to unlock." };
    return backfillVideoAuditionFromStripe(
      db,
      {
        userId,
        program: body.program || "corps",
        seasonYear: body.season_year,
        stripeAmountCents,
        paymentIntentId,
        sessionId,
        paidAt,
      },
      silentDeps
    );
  }

  if (action === "event_rsvp") {
    const userId = Number(body.user_id);
    const eventId = Number(body.event_id);
    if (!userId) return { ok: false, error: "Pick the member for this RSVP." };
    if (!eventId) return { ok: false, error: "Pick the event this RSVP belongs to." };
    return backfillEventRsvpFromStripe(
      db,
      {
        userId,
        eventId,
        stripeAmountCents,
        paymentIntentId,
        sessionId,
        paidAt,
        potentialId: Number(body.potential_id) || null,
      },
      silentDeps
    );
  }

  if (action === "merch") {
    if (typeof deps.finalizeMerchOrder !== "function") {
      return { ok: false, error: "Merch finalize helper unavailable." };
    }
    let potential = null;
    const potentialId = Number(body.potential_id) || 0;
    if (potentialId) {
      potential = db.prepare("SELECT * FROM merch_potential_orders WHERE id = ?").get(potentialId);
    }
    if (!potential && paymentIntentId) {
      potential = db
        .prepare("SELECT * FROM merch_potential_orders WHERE stripe_payment_intent_id = ?")
        .get(paymentIntentId);
    }
    if (!potential) {
      return {
        ok: false,
        error: "No leftover merch checkout row found. Cannot rebuild store order automatically.",
      };
    }
    const existingOrder = paymentIntentId
      ? db
          .prepare("SELECT id FROM merch_orders WHERE stripe_payment_intent_id = ?")
          .get(paymentIntentId)
      : null;
    if (existingOrder) {
      // Link paymentHistory for matching if needed
      try {
        insertStripePaymentHistory(db, {
          title: `Store order #${existingOrder.id}`,
          description: "Store order (already finalized; linked during reconcile).",
          amountCents: stripeAmountCents,
          userId: potential.user_id || null,
          paymentIntentId,
          sessionId,
          paidAt,
        });
      } catch (_) {}
      return { ok: true, already: true, orderId: existingOrder.id };
    }

    const orderId = deps.finalizeMerchOrder(
      db,
      potential,
      (amt, src) =>
        deps.addChrisShare(amt, src, paidAt, { paymentIntentId, sessionId }),
      typeof deps.sendEmail === "function" ? deps.sendEmail : () => {},
      deps.getSiteSettings
    );
    try {
      insertStripePaymentHistory(db, {
        title: `Store order #${orderId}`,
        description: "Store order recorded from Stripe reconcile.",
        amountCents: stripeAmountCents,
        userId: potential.user_id || null,
        paymentIntentId,
        sessionId,
        paidAt,
      });
    } catch (_) {}
    return { ok: true, already: false, orderId };
  }

  return { ok: false, error: `Unknown action: ${action}` };
}

/**
 * Separate accept/deny for account credit vs Chris Payment share.
 * Accept/deny removes that prompt from the reconcile queue.
 */
function applyReconcileDecision(db, body, deps = {}) {
  ensureStripePaymentColumns(db);

  const decision = String(body.decision || "").trim().toLowerCase(); // accept | deny
  const scope = String(body.scope || "").trim().toLowerCase(); // account | chris
  const paymentIntentId = String(body.payment_intent_id || "").trim() || null;
  const sessionId = String(body.session_id || "").trim() || null;
  const paidAt = Number(body.paid_at) || Date.now();
  const stripeAmountCents = Math.round(Number(body.stripe_amount_cents) || 0);
  const stripeKey = stripeReconcileKey({
    paymentIntentId,
    sessionId,
    id: body.stripe_id,
  });

  if (!stripeKey) return { ok: false, error: "Missing Stripe payment id." };
  if (decision !== "accept" && decision !== "deny") {
    return { ok: false, error: "Decision must be accept or deny." };
  }
  if (scope !== "account" && scope !== "chris") {
    return { ok: false, error: "Scope must be account or chris." };
  }

  const existingDecision = getReconcileDecision(db, stripeKey, scope);
  if (existingDecision) {
    return {
      ok: true,
      already: true,
      message: `Already ${existingDecision.decision} for ${scope}.`,
    };
  }

  if (decision === "deny") {
    saveReconcileDecision(db, {
      stripeKey,
      paymentIntentId,
      sessionId,
      actionType: scope,
      decision: "denied",
      amountCents: stripeAmountCents,
      note: String(body.note || "").trim() || "Denied in Stripe reconcile",
    });
    return { ok: true, denied: true, scope };
  }

  // ACCEPT
  if (scope === "chris") {
    const existingChris = findChrisShareForStripe(db, { paymentIntentId, sessionId });
    if (existingChris) {
      saveReconcileDecision(db, {
        stripeKey,
        paymentIntentId,
        sessionId,
        actionType: "chris",
        decision: "accepted",
        amountCents: existingChris.amount,
        note: "Chris share already present",
      });
      return { ok: true, already: true, scope: "chris", chrisCut: existingChris.amount };
    }

    // Prefer tuition base (amount/1.06) for tuition-like payments; donations/rsvp use full charged
    const actionHint = String(body.action || body.suggested_action || "").trim();
    let base = stripeAmountCents;
    if (
      actionHint === "tuition" ||
      actionHint === "pay_behalf" ||
      actionHint === "make_payment" ||
      actionHint === "video_audition"
    ) {
      base = Math.round(stripeAmountCents / 1.06) || stripeAmountCents;
    }
    if (Number(body.chris_base_cents) > 0) {
      base = Math.round(Number(body.chris_base_cents));
    }

    const note =
      String(body.chris_note || "").trim() ||
      `Stripe reconcile ${stripeKey}`;

    let result;
    if (typeof deps.addChrisShare === "function") {
      deps.addChrisShare(base, note, paidAt, { paymentIntentId, sessionId });
      result = { ok: true, chrisCut: Math.round(base * 0.03) };
    } else {
      result = recordChrisShareWithStripe(db, {
        baseAmountCents: base,
        source: note,
        paidAt,
        paymentIntentId,
        sessionId,
      });
    }
    if (!result.ok) return result;

    saveReconcileDecision(db, {
      stripeKey,
      paymentIntentId,
      sessionId,
      actionType: "chris",
      decision: "accepted",
      amountCents: result.chrisCut || Math.round(base * 0.03),
      note,
    });
    return { ok: true, scope: "chris", chrisCut: result.chrisCut, already: !!result.already };
  }

  // ACCOUNT ACCEPT
  const action = String(body.action || "").trim();
  const userId = Number(body.user_id) || 0;
  const parentId = Number(body.parent_id) || 0;

  if (
    (action === "tuition" || action === "pay_behalf" || action === "video_audition" || action === "event_rsvp") &&
    !userId
  ) {
    return { ok: false, error: "Pick the member/child account this payment belongs to." };
  }

  if (action === "pay_behalf") {
    if (!parentId) return { ok: false, error: "Parent account is required for parent payments." };
    if (typeof deps.isParentOf === "function") {
      if (!deps.isParentOf(db, parentId, userId)) {
        return {
          ok: false,
          error: "That child is not linked to the selected parent. Fix the parent/child link first.",
        };
      }
    }
  }

  // If parent was selected as beneficiary by mistake, require child
  if (userId && action !== "donation" && action !== "merch") {
    const beneficiary = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
    if (!beneficiary) return { ok: false, error: "Selected user was not found." };
    const beneficiaryIsParent =
      !!beneficiary.parent ||
      (typeof deps.isParentAccount === "function" && deps.isParentAccount(beneficiary));
    if (beneficiaryIsParent && action !== "donation") {
      return {
        ok: false,
        error: "Cannot credit a parent account balance. Pick the linked child performer.",
      };
    }
  }

  const silentDeps = {
    ...deps,
    silent: true,
    skipChrisShare: true, // Chris share is a separate accept/deny
  };

  const applyBody = {
    ...body,
    action,
    payment_intent_id: paymentIntentId,
    session_id: sessionId,
    paid_at: paidAt,
    stripe_amount_cents: stripeAmountCents,
    user_id: userId || body.user_id,
    parent_id: parentId || body.parent_id,
  };

  const result = applyReconcilePayment(db, applyBody, silentDeps);
  if (!result || !result.ok) return result || { ok: false, error: "Account apply failed." };

  saveReconcileDecision(db, {
    stripeKey,
    paymentIntentId,
    sessionId,
    actionType: "account",
    decision: "accepted",
    userId: result.userId || userId || null,
    parentId: parentId || null,
    amountCents: result.amountCents || stripeAmountCents,
    note: `Account apply (${action})`,
  });

  return {
    ok: true,
    scope: "account",
    ...result,
    chrisPending: !findChrisShareForStripe(db, { paymentIntentId, sessionId }),
  };
}

function attachReconcileDecisionState(db, row) {
  const piId = row.id && String(row.id).startsWith("pi_") ? row.id : null;
  const key = stripeReconcileKey({
    paymentIntentId: piId,
    sessionId: row.sessionId,
    id: row.id,
  });
  const accountDecision = getReconcileDecision(db, key, "account");
  const chrisDecision = getReconcileDecision(db, key, "chris");

  const tuitionLike =
    row.suggestedAction === "tuition" ||
    row.suggestedAction === "pay_behalf" ||
    row.suggestedAction === "video_audition" ||
    row.suggestedAction === "contract";
  const chrisBase = tuitionLike
    ? Math.round((row.amount || 0) / 1.06) || row.amount || 0
    : row.amount || 0;
  const expectedChris = Math.round(chrisBase * 0.03);

  const chrisShare = findChrisShareForStripe(db, {
    paymentIntentId: piId,
    sessionId: row.sessionId,
    amountCents: expectedChris,
    aroundMs: row.created,
  });

  const alreadyOnAccount = findPaymentByStripeIds(db, {
    paymentIntentId: piId,
    sessionId: row.sessionId,
  });

  row.reconcileKey = key;
  row.accountDecision = accountDecision
    ? accountDecision.decision
    : alreadyOnAccount
      ? "accepted"
      : null;
  row.chrisDecision = chrisDecision ? chrisDecision.decision : null;
  row.chrisShareApplied = !!chrisShare || chrisDecision?.decision === "accepted";
  row.chrisShareCents = chrisShare ? chrisShare.amount : expectedChris;
  row.chrisBaseCents = chrisBase;
  row.needsAccountAction = !accountDecision && !alreadyOnAccount;
  row.needsChrisAction = !chrisDecision && !chrisShare;
  row.needsAnyAction = row.needsAccountAction || row.needsChrisAction;
  return row;
}

module.exports = {
  ensureStripePaymentColumns,
  findPaymentByStripeIds,
  finalizePotentialPayment,
  finalizeTuitionPotential,
  finalizeContractPotential,
  backfillTuitionFromStripe,
  backfillDonationFromStripe,
  finalizeDonationPotential,
  findDonationPotentialForSession,
  backfillVideoAuditionFromStripe,
  backfillEventRsvpFromStripe,
  findEventForStripeRow,
  findPotentialForSession,
  handleCheckoutSessionCompleted,
  stripeIdsFromSession,
  inferPotentialKind,
  classifyStripeCheckout,
  parseSuccessUrl,
  isFromBoiseGemsWebsite,
  urlIsBoiseGemsWebsite,
  applyReconcilePayment,
  applyReconcileDecision,
  attachReconcileDecisionState,
  stripeReconcileKey,
  getReconcileDecision,
  findChrisShareForStripe,
  recordChrisShareWithStripe,
  pollAndRecoverPaidCheckouts,
  startStripeRecoveryPoller,
};
