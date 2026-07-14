(function () {
  const modal = document.getElementById("plModalOverlay");
  if (!modal) return;

  const form = document.getElementById("plModalForm");
  const emailInput = document.getElementById("plModalEmail");
  const submitBtn = document.getElementById("plModalSubmit");
  const feedback = document.getElementById("plModalFeedback");
  const titleEl = document.getElementById("plModalTitle");
  const hintEl = document.getElementById("plModalHint");

  const openButtons = document.querySelectorAll("[data-pl-open]");
  const mode = modal.dataset.mode || "parent_to_child";

  function setFeedback(type, html) {
    feedback.hidden = false;
    feedback.className = "pl-modal-feedback pl-modal-feedback--" + type;
    feedback.innerHTML = html;
  }

  function clearFeedback() {
    feedback.hidden = true;
    feedback.innerHTML = "";
    feedback.className = "pl-modal-feedback";
  }

  function openModal() {
    clearFeedback();
    if (emailInput) {
      emailInput.value = "";
      emailInput.disabled = false;
    }
    if (submitBtn) submitBtn.disabled = false;
    modal.hidden = false;
    if (emailInput) emailInput.focus();
  }

  function closeModal() {
    modal.hidden = true;
  }

  openButtons.forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      openModal();
    });
  });

  modal.querySelectorAll("[data-pl-close]").forEach(function (el) {
    el.addEventListener("click", closeModal);
  });

  if (form) {
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      clearFeedback();

      const email = String(emailInput?.value || "").trim();
      if (!email) {
        setFeedback("error", "Please enter an email address.");
        return;
      }

      if (submitBtn) submitBtn.disabled = true;
      if (emailInput) emailInput.disabled = true;

      try {
        const res = await fetch("/api/web/parent-link/request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email }),
        });
        const data = await res.json();

        if (data.ok) {
          setFeedback(
            "success",
            '<ion-icon name="checkmark-circle"></ion-icon> Request sent!'
          );
        } else if (data.code === "not_found") {
          setFeedback(
            "error",
            "No email found. Please have them create an account."
          );
          if (submitBtn) submitBtn.disabled = false;
          if (emailInput) emailInput.disabled = false;
        } else {
          setFeedback("error", data.message || "Something went wrong.");
          if (submitBtn) submitBtn.disabled = false;
          if (emailInput) emailInput.disabled = false;
        }
      } catch (err) {
        setFeedback("error", "Network error. Please try again.");
        if (submitBtn) submitBtn.disabled = false;
        if (emailInput) emailInput.disabled = false;
      }
    });
  }

  if (titleEl) {
    titleEl.textContent =
      mode === "child_to_parent" ? "Add Parent / Guardian" : "Add Child";
  }
  if (hintEl) {
    hintEl.textContent =
      mode === "child_to_parent"
        ? "Enter your parent or guardian's email. They must have a parent account on file."
        : "Enter your child's member account email. They will receive a request to accept the link.";
  }

  // Incoming requests
  const listEl = document.getElementById("plRequestsList");
  if (!listEl) return;

  async function loadRequests() {
    try {
      const res = await fetch("/api/web/parent-link/requests/incoming");
      const data = await res.json();
      if (!data.ok) return;
      renderRequests(data.requests || []);
    } catch (_) {}
  }

  function renderRequests(requests) {
    const section = document.getElementById("plRequestsSection");
    if (!requests.length) {
      if (section) section.hidden = true;
      listEl.innerHTML = "";
      return;
    }
    if (section) section.hidden = false;

    listEl.innerHTML = requests
      .map(function (req) {
        const name =
          (req.requester_first || "") + " " + (req.requester_last || "");
        const label =
          req.direction === "parent_to_child"
            ? "wants to link as your parent/guardian"
            : "wants to link as your child";
        return (
          '<div class="pl-request-card" data-req-id="' +
          req.id +
          '">' +
          '<div class="pl-request-main">' +
          '<div class="pl-request-name">' +
          escapeHtml(name.trim() || "Unknown") +
          "</div>" +
          '<div class="pl-request-email">' +
          escapeHtml(req.requester_email || "") +
          "</div>" +
          '<div class="pl-request-meta">' +
          escapeHtml(label) +
          "</div>" +
          "</div>" +
          '<div class="pl-request-actions">' +
          '<button type="button" class="pd-action-btn pd-action-btn--primary" data-pl-accept="' +
          req.id +
          '">Accept</button>' +
          '<button type="button" class="pd-action-btn" data-pl-decline="' +
          req.id +
          '">Decline</button>' +
          "</div>" +
          "</div>"
        );
      })
      .join("");

    listEl.querySelectorAll("[data-pl-accept]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        respondRequest(btn.dataset.plAccept, "accept", btn);
      });
    });
    listEl.querySelectorAll("[data-pl-decline]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        respondRequest(btn.dataset.plDecline, "decline", btn);
      });
    });
  }

  async function respondRequest(id, action, btn) {
    if (btn) btn.disabled = true;
    try {
      const res = await fetch("/api/web/parent-link/requests/" + id + "/" + action, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (data.ok) {
        if (action === "accept") {
          window.location.reload();
        } else {
          loadRequests();
        }
      } else {
        alert(data.message || "Could not update request.");
        if (btn) btn.disabled = false;
      }
    } catch (_) {
      alert("Network error. Please try again.");
      if (btn) btn.disabled = false;
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  loadRequests();
})();
