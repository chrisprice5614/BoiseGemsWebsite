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

  const ppCols = db.prepare("PRAGMA table_info(potential_payment)").all().map((c) => c.name);
  if (!ppCols.includes("stripe_session_id")) {
    db.prepare("ALTER TABLE potential_payment ADD COLUMN stripe_session_id TEXT").run();
  }
  if (!ppCols.includes("kind")) {
    db.prepare("ALTER TABLE potential_payment ADD COLUMN kind TEXT").run();
  }

  db.prepare(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_paymentHistory_stripe_pi ON paymentHistory(stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL"
  ).run();
  db.prepare(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_paymentHistory_stripe_session ON paymentHistory(stripe_session_id) WHERE stripe_session_id IS NOT NULL"
  ).run();
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
}) {
  return db
    .prepare(
      `
      INSERT INTO paymentHistory
        (title, description, amount, method, date, user_id, stripe_payment_intent_id, stripe_session_id)
      VALUES (?, ?, ?, 'Stripe', ?, ?, ?, ?)
    `
    )
    .run(
      title,
      description,
      amountCents,
      paidAt || Date.now(),
      userId || null,
      paymentIntentId || null,
      sessionId || null
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

  if (typeof addChrisShare === "function") {
    addChrisShare(paid, chrisNote, stripeMeta.paidAt || null);
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

  return { ok: true, already: false, paymentId, userId: user.id, amountCents: paid };
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

  if (typeof addChrisShare === "function") {
    addChrisShare(
      downPayment,
      `Contract down payment for ${ensemble} (user ${user.id})`,
      stripeMeta.paidAt || null
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

async function handleCheckoutSessionCompleted(db, session, deps) {
  if (!session || (session.payment_status && session.payment_status !== "paid" && session.status !== "complete")) {
    return { ok: false, error: "Session not paid." };
  }

  const stripeMeta = stripeIdsFromSession(session);
  const already = findPaymentByStripeIds(db, stripeMeta);
  if (already) return { ok: true, already: true, paymentId: already.id };

  const kind = String(session.metadata?.kind || "");

  // Merch / donations have their own tables — leave those alone here if marked
  if (kind === "donation" || kind === "merch" || kind === "fan_subscribe" || kind === "event_rsvp") {
    return { ok: true, skipped: true, reason: kind };
  }

  const potential = findPotentialForSession(db, session);
  if (potential) {
    return finalizePotentialPayment(db, potential, deps, stripeMeta);
  }

  // No potential left — try to credit a member by email for tuition-like checkouts
  if (kind === "make_payment" || kind === "pay_behalf" || !kind) {
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
            note: `auto webhook ${session.id}`,
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
  if (blob.includes("donation") || blob.includes("donate")) return { kind: "donation", potentialId: null };
  if (blob.includes("audition")) return { kind: "video_audition", potentialId: null };
  if (blob.includes("contract") || blob.includes("down payment")) return { kind: "contract", potentialId: null };
  if (blob.includes("tuition") || blob.includes("payment for tuition")) return { kind: "make_payment", potentialId: null };
  if (blob.includes("store") || blob.includes("merch")) return { kind: "merch", potentialId: null };
  return { kind: "unknown", potentialId: null };
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

  if (typeof deps.addChrisShare === "function") {
    deps.addChrisShare(total, `Donation of ${money(base)} (reconcile)`, paidAt || null);
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

  return { ok: true, already: false, paymentId, donationId, amountCents: total };
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

  if (typeof deps.addChrisShare === "function") {
    deps.addChrisShare(
      amount,
      `Video audition unlock (${prog} ${season})`,
      paidAt || null
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

  return { ok: true, already: false, paymentId, userId: user.id, amountCents: amount };
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
      (amt, src) => deps.addChrisShare(amt, src, paidAt),
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

module.exports = {
  ensureStripePaymentColumns,
  findPaymentByStripeIds,
  finalizePotentialPayment,
  finalizeTuitionPotential,
  finalizeContractPotential,
  backfillTuitionFromStripe,
  backfillDonationFromStripe,
  backfillVideoAuditionFromStripe,
  findPotentialForSession,
  handleCheckoutSessionCompleted,
  stripeIdsFromSession,
  inferPotentialKind,
  classifyStripeCheckout,
  parseSuccessUrl,
  applyReconcilePayment,
};
