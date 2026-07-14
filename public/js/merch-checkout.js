(function () {
  "use strict";

  var cfg = window.MERCH_CHECKOUT || {};
  var payBtn = document.getElementById("payBtn");
  var form = document.getElementById("merchCheckoutForm");
  var statusEl = document.getElementById("checkoutStatus");

  if (!cfg.publishableKey) {
    if (statusEl) statusEl.textContent = "Payment is not configured. Please contact support.";
    return;
  }

  var stripe = Stripe(cfg.publishableKey);
  var elements = null;
  var paymentElement = null;
  var clientSecret = null;
  var potentialId = null;
  var appliedPromo = "";
  var quoteTimer = null;
  var payTimer = null;
  var payInFlight = false;
  var hasPhysical = !!cfg.hasPhysical;

  function fmt(cents) {
    return "$" + (cents / 100).toFixed(2);
  }

  function val(id) {
    var el = document.getElementById(id);
    return el ? el.value.trim() : "";
  }

  function parseCityStateZip(segment) {
    if (!segment) return null;
    var s = segment.trim().replace(/\s+/g, " ");
    var m = s.match(/^(.+?),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
    if (m) return { city: m[1].trim(), state: m[2].toUpperCase(), postal: m[3] };
    m = s.match(/^(.+?)\s+([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
    if (m) return { city: m[1].trim(), state: m[2].toUpperCase(), postal: m[3] };
    m = s.match(/^([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
    if (m) return { city: "", state: m[1].toUpperCase(), postal: m[2] };
    return null;
  }

  function parseAddressFromLine1() {
    if (!hasPhysical) return;
    var line1El = document.getElementById("shipLine1");
    var cityEl = document.getElementById("shipCity");
    var stateEl = document.getElementById("shipState");
    var postalEl = document.getElementById("shipPostal");
    if (!line1El || !cityEl || !postalEl) return;

    var raw = line1El.value.trim();
    if (!raw || (cityEl.value.trim() && postalEl.value.trim())) return;

    var lines = raw.split(/[\r\n]+/).map(function (l) { return l.trim(); }).filter(Boolean);
    var parsed = null;

    if (lines.length >= 2) {
      var csp = parseCityStateZip(lines[lines.length - 1]);
      if (csp) {
        line1El.value = lines[0];
        if (lines.length > 2) {
          var line2El = document.getElementById("shipLine2");
          if (line2El && !line2El.value.trim()) line2El.value = lines.slice(1, -1).join(", ");
        }
        parsed = csp;
      }
    } else if (raw.indexOf(",") !== -1) {
      var parts = raw.split(",").map(function (p) { return p.trim(); }).filter(Boolean);
      if (parts.length >= 3) {
        var last = parts[parts.length - 1];
        var secondLast = parts[parts.length - 2];
        var cspLast = parseCityStateZip(last);
        if (cspLast) {
          line1El.value = (cspLast.city ? parts.slice(0, -1) : parts.slice(0, -2)).join(", ");
          parsed = {
            city: cspLast.city || secondLast,
            state: cspLast.state,
            postal: cspLast.postal,
          };
        } else if (parts.length >= 4 && /^\d{5}(-\d{4})?$/.test(last) && /^[A-Za-z]{2}$/.test(secondLast)) {
          line1El.value = parts.slice(0, -3).join(", ");
          parsed = {
            city: parts[parts.length - 3],
            state: secondLast.toUpperCase(),
            postal: last,
          };
        }
      }
    }

    if (!parsed) return;
    if (!cityEl.value.trim() && parsed.city) cityEl.value = parsed.city;
    if (stateEl && !stateEl.value && parsed.state) stateEl.value = parsed.state;
    if (!postalEl.value.trim() && parsed.postal) postalEl.value = parsed.postal;
  }

  function formPayload() {
    var data = {
      email: val("checkoutEmail"),
      name: val("checkoutName"),
      promo_code: appliedPromo,
    };
    if (hasPhysical) {
      data.ship_line1 = val("shipLine1");
      data.ship_line2 = val("shipLine2");
      data.ship_city = val("shipCity");
      data.ship_state = val("shipState");
      data.ship_postal = val("shipPostal");
      data.ship_country = document.getElementById("shipCountry").value;
    }
    return data;
  }

  function contactReady() {
    return val("checkoutEmail") && val("checkoutName");
  }

  function shippingReady() {
    if (!hasPhysical) return true;
    return val("shipLine1") && val("shipCity") && val("shipPostal") && document.getElementById("shipCountry").value;
  }

  function canStartPayment() {
    return contactReady() && shippingReady();
  }

  function updateSummary(totals) {
    var discountRow = document.getElementById("sumDiscount");
    var discountVal = document.getElementById("sumDiscountVal");
    if (discountRow && discountVal) {
      if (totals.discountCents > 0) {
        discountRow.style.display = "";
        discountVal.textContent = "-" + fmt(totals.discountCents);
      } else {
        discountRow.style.display = "none";
      }
    }
    var shipRow = document.getElementById("sumShipping");
    var shipVal = document.getElementById("sumShippingVal");
    if (shipRow && shipVal && hasPhysical) {
      shipRow.style.display = "";
      shipVal.textContent = totals.shippingCents > 0 ? fmt(totals.shippingCents) : "Free";
    }
    var taxVal = document.getElementById("sumTaxVal");
    if (taxVal) taxVal.textContent = fmt(totals.taxCents);
    var totalVal = document.getElementById("sumTotalVal");
    if (totalVal) totalVal.textContent = fmt(totals.totalCents);
  }

  function fetchQuote() {
    return fetch("/store/checkout/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(formPayload()),
    }).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok || !data.ok) throw new Error(data.message || "Could not update totals.");
        return data;
      });
    });
  }

  function scheduleQuote() {
    clearTimeout(quoteTimer);
    quoteTimer = setTimeout(function () {
      if (!contactReady()) return;
      fetchQuote()
        .then(function (data) {
          updateSummary(data.totals);
          var msg = document.getElementById("promoMsg");
          if (msg) {
            if (data.promoLabel) {
              msg.hidden = false;
              msg.textContent = "Promo " + data.promoLabel + " applied.";
              msg.className = "merch-promo-msg merch-promo-msg--ok";
            } else if (appliedPromo) {
              msg.hidden = false;
              msg.textContent = "Promo applied.";
              msg.className = "merch-promo-msg merch-promo-msg--ok";
            }
          }
        })
        .catch(function (e) {
          var msg = document.getElementById("promoMsg");
          if (msg && appliedPromo) {
            msg.hidden = false;
            msg.textContent = e.message;
            msg.className = "merch-promo-msg merch-promo-msg--err";
          }
        });
    }, 350);
  }

  function mountPayment(secret) {
    if (!secret) return;
    if (elements && clientSecret === secret) {
      if (payBtn) payBtn.disabled = false;
      return;
    }
    clientSecret = secret;
    if (paymentElement) {
      paymentElement.destroy();
      paymentElement = null;
    }
    elements = stripe.elements({
      clientSecret: secret,
      appearance: {
        theme: "stripe",
        variables: {
          colorPrimary: "#60437d",
          colorText: "#1a0e2a",
          borderRadius: "0px",
          fontFamily: "Gesta, system-ui, sans-serif",
        },
        rules: {
          ".Input": { border: "2px solid #d8c8ec", boxShadow: "none" },
          ".Input:focus": { border: "2px solid #60437d" },
        },
      },
    });
    paymentElement = elements.create("payment");
    paymentElement.mount("#paymentElement");
    if (payBtn) payBtn.disabled = false;
  }

  function initPayment(force) {
    if (!canStartPayment()) {
      if (statusEl) {
        statusEl.textContent = hasPhysical
          ? "Enter your contact and shipping details to load payment."
          : "Enter your email and name to load payment.";
      }
      if (payBtn) payBtn.disabled = true;
      return;
    }

    clearTimeout(payTimer);
    payTimer = setTimeout(function () {
      if (payInFlight && !force) return;
      payInFlight = true;
      if (statusEl) statusEl.textContent = "Loading secure payment form...";
      if (payBtn) payBtn.disabled = true;

      fetch("/store/checkout/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(formPayload()),
      })
        .then(function (r) {
          return r.json().then(function (data) {
            if (!r.ok || !data.ok) throw new Error(data.message || "Could not start payment.");
            return data;
          });
        })
        .then(function (data) {
          potentialId = data.potentialId;
          mountPayment(data.clientSecret);
          if (statusEl) statusEl.textContent = "Enter your card details below.";
        })
        .catch(function (e) {
          clientSecret = null;
          potentialId = null;
          if (statusEl) statusEl.textContent = e.message;
          if (window.bgAlert) bgAlert(e.message);
        })
        .finally(function () {
          payInFlight = false;
        });
    }, force ? 0 : 500);
  }

  document.getElementById("applyPromoBtn").addEventListener("click", function () {
    appliedPromo = document.getElementById("promoCode").value.trim().toUpperCase();
    document.getElementById("promoCode").value = appliedPromo;
    clientSecret = null;
    scheduleQuote();
    initPayment(true);
  });

  ["checkoutEmail", "checkoutName"].forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("blur", function () {
      scheduleQuote();
      initPayment();
    });
    el.addEventListener("input", function () {
      scheduleQuote();
    });
  });

  if (hasPhysical) {
    var shipLine1 = document.getElementById("shipLine1");
    if (shipLine1) {
      shipLine1.addEventListener("blur", function () {
        parseAddressFromLine1();
        scheduleQuote();
        initPayment();
      });
    }
    ["shipLine2", "shipCity", "shipState", "shipPostal", "shipCountry"].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("change", function () {
        scheduleQuote();
        clientSecret = null;
        initPayment();
      });
      el.addEventListener("blur", function () {
        scheduleQuote();
        initPayment();
      });
    });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!clientSecret || !potentialId) {
      initPayment(true);
      if (window.bgAlert) bgAlert("Please wait for the payment form to load.");
      return;
    }
    if (payBtn) payBtn.disabled = true;
    if (statusEl) statusEl.textContent = "Processing payment...";

    stripe.confirmPayment({
      elements: elements,
      confirmParams: {
        return_url: window.location.origin + "/store/checkout",
        receipt_email: val("checkoutEmail"),
      },
      redirect: "if_required",
    }).then(function (result) {
      if (result.error) {
        if (payBtn) payBtn.disabled = false;
        if (statusEl) statusEl.textContent = result.error.message;
        if (window.bgAlert) bgAlert(result.error.message);
        return;
      }
      var pi = result.paymentIntent;
      if (!pi || pi.status !== "succeeded") {
        if (payBtn) payBtn.disabled = false;
        if (statusEl) statusEl.textContent = "Payment was not completed.";
        return;
      }
      fetch("/store/checkout/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ potentialId: potentialId, paymentIntentId: pi.id }),
      })
        .then(function (r) {
          return r.json().then(function (data) {
            if (!r.ok || !data.ok) throw new Error(data.message || "Could not complete order.");
            window.location.href = data.redirect;
          });
        })
        .catch(function (err) {
          if (payBtn) payBtn.disabled = false;
          if (statusEl) statusEl.textContent = err.message;
          if (window.bgAlert) bgAlert(err.message);
        });
    });
  });

  parseAddressFromLine1();
  scheduleQuote();
  initPayment(true);
})();
