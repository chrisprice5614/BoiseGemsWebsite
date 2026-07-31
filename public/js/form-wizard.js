(function () {
  "use strict";

  var pdfjsLib = null;

  function loadPdfJs() {
    if (pdfjsLib) return Promise.resolve(pdfjsLib);
    return import("/vendor/pdfjs/pdf.min.mjs").then(function (mod) {
      pdfjsLib = mod;
      pdfjsLib.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.min.mjs";
      return pdfjsLib;
    });
  }

  function uid() {
    return "f" + Math.random().toString(36).slice(2, 9);
  }

  function createPlacer(opts) {
    var fileInput = opts.fileInput;
    var pagesEl = opts.pagesEl;
    var toolsEl = opts.toolsEl;
    var listEl = opts.listEl;
    var fieldsInput = opts.fieldsInput;
    var fields = Array.isArray(opts.initialFields) ? opts.initialFields.slice() : [];
    var activeType = "text";
    var placing = false;
    var selectedId = null;
    var pdfDoc = null;
    var objectUrl = null;

    function syncHidden() {
      if (fieldsInput) fieldsInput.value = JSON.stringify(fields);
      renderList();
    }

    function ensurePlaceHint() {
      var shell = pagesEl && pagesEl.closest(".fw-pdf-shell");
      if (!shell) return null;
      var hint = shell.querySelector(".fw-place-hint");
      if (!hint) {
        hint = document.createElement("div");
        hint.className = "fw-place-hint";
        hint.hidden = true;
        hint.innerHTML = '<span class="fw-place-hint__text">Click to add input</span>';
        var layout = shell.querySelector(".fw-pdf-layout");
        if (layout) layout.insertBefore(hint, layout.firstChild);
        else shell.insertBefore(hint, shell.firstChild);
      }
      return hint;
    }

    function updatePlaceUi() {
      if (toolsEl) {
        toolsEl.classList.toggle("is-placing", placing);
        toolsEl.querySelectorAll("[data-field-type]").forEach(function (btn) {
          var isActive = btn.getAttribute("data-field-type") === activeType;
          btn.classList.toggle("is-active", isActive && placing);
          btn.classList.toggle("is-armed", isActive && placing);
        });
      }
      var shell = pagesEl && pagesEl.closest(".fw-pdf-shell");
      if (shell) shell.classList.toggle("is-placing", placing);
      var hint = ensurePlaceHint();
      if (hint) {
        hint.hidden = !placing;
        hint.querySelector(".fw-place-hint__text").textContent = "Click to add input";
      }
    }

    function setType(type) {
      activeType = type || "text";
      placing = true;
      updatePlaceUi();
    }

    function clearPlacing() {
      placing = false;
      updatePlaceUi();
    }

    function renderList() {
      if (!listEl) return;
      if (!fields.length) {
        listEl.innerHTML = "<p style='margin:0;color:#6b5585;'>No boxes yet. Tap the PDF where people should type or sign.</p>";
        return;
      }
      listEl.innerHTML = fields.map(function (f) {
        return (
          '<div class="fw-field-list__item" data-id="' + f.id + '">' +
            "<div><strong>" + escapeHtml(f.label || typeLabel(f.type)) + "</strong>" +
            " <span style='opacity:.7'>(page " + f.page + ")</span></div>" +
            '<button type="button" class="form-wizard__secondary" data-remove="' + f.id + '">Remove</button>' +
          "</div>"
        );
      }).join("");
    }

    function typeLabel(t) {
      if (t === "signature") return "Signature";
      if (t === "date") return "Date";
      if (t === "initials") return "Initials";
      return "Text";
    }

    function escapeHtml(s) {
      return String(s || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function defaultSize(type) {
      if (type === "signature") return { w: 0.28, h: 0.045 };
      if (type === "date") return { w: 0.16, h: 0.035 };
      if (type === "initials") return { w: 0.1, h: 0.035 };
      return { w: 0.22, h: 0.035 };
    }

    function edgeHit(box, clientX, clientY) {
      var rect = box.getBoundingClientRect();
      var edge = 10;
      var nearL = clientX - rect.left <= edge;
      var nearR = rect.right - clientX <= edge;
      var nearT = clientY - rect.top <= edge;
      var nearB = rect.bottom - clientY <= edge;
      if (nearT && nearL) return "nw";
      if (nearT && nearR) return "ne";
      if (nearB && nearL) return "sw";
      if (nearB && nearR) return "se";
      if (nearL) return "w";
      if (nearR) return "e";
      if (nearT) return "n";
      if (nearB) return "s";
      return null;
    }

    function cursorForEdge(edge) {
      if (!edge) return "move";
      if (edge === "n" || edge === "s") return "ns-resize";
      if (edge === "e" || edge === "w") return "ew-resize";
      if (edge === "ne" || edge === "sw") return "nesw-resize";
      return "nwse-resize";
    }

    var ctxMenu = document.getElementById("fwFieldCtx");
    if (!ctxMenu) {
      ctxMenu = document.createElement("div");
      ctxMenu.id = "fwFieldCtx";
      ctxMenu.className = "fw-ctx";
      ctxMenu.hidden = true;
      ctxMenu.innerHTML = '<button type="button" class="fw-ctx__item fw-ctx__item--danger" data-action="delete">Delete</button>';
      document.body.appendChild(ctxMenu);
    }
    var ctxFieldId = null;

    function hideFieldCtx() {
      ctxMenu.hidden = true;
      ctxFieldId = null;
    }

    function showFieldCtx(x, y, fieldId) {
      ctxFieldId = fieldId;
      ctxMenu.hidden = false;
      var rect = ctxMenu.getBoundingClientRect();
      var left = Math.min(x, window.innerWidth - rect.width - 8);
      var top = Math.min(y, window.innerHeight - rect.height - 8);
      ctxMenu.style.left = Math.max(8, left) + "px";
      ctxMenu.style.top = Math.max(8, top) + "px";
    }

    function deleteField(id) {
      fields = fields.filter(function (f) { return f.id !== id; });
      if (selectedId === id) selectedId = null;
      hideFieldCtx();
      paintOverlays();
    }

    ctxMenu.onclick = function (e) {
      e.stopPropagation();
      var btn = e.target.closest("[data-action]");
      if (!btn) return;
      if (btn.dataset.action === "delete" && ctxFieldId) deleteField(ctxFieldId);
      hideFieldCtx();
    };
    document.addEventListener("click", hideFieldCtx);
    document.addEventListener("scroll", hideFieldCtx, true);

    function paintOverlays() {
      if (!pagesEl) return;
      pagesEl.querySelectorAll(".fw-page").forEach(function (pageEl) {
        var pageNum = Number(pageEl.getAttribute("data-page"));
        var overlay = pageEl.querySelector(".fw-page__overlay");
        if (!overlay) return;
        overlay.innerHTML = "";
        fields.filter(function (f) { return Number(f.page) === pageNum; }).forEach(function (f) {
          var box = document.createElement("div");
          box.className = "fw-field" +
            (f.type === "signature" || f.type === "initials" ? " is-signature" : "") +
            (f.type === "date" ? " is-date" : "") +
            (f.id === selectedId ? " is-selected" : "");
          box.style.left = (f.x * 100) + "%";
          box.style.top = (f.y * 100) + "%";
          box.style.width = (f.w * 100) + "%";
          box.style.height = (f.h * 100) + "%";
          box.dataset.id = f.id;
          box.innerHTML = '<div class="fw-field__label">' + escapeHtml(f.label || typeLabel(f.type)) + "</div>";
          overlay.appendChild(box);
        });
      });
      syncHidden();
    }

    function bindOverlayEvents() {
      if (!pagesEl) return;
      pagesEl.querySelectorAll(".fw-page__overlay").forEach(function (overlay) {
        overlay.onclick = function (e) {
          if (e.target.closest(".fw-field")) return;
          hideFieldCtx();
          if (!placing) return;
          var pageEl = overlay.closest(".fw-page");
          var rect = overlay.getBoundingClientRect();
          var x = (e.clientX - rect.left) / rect.width;
          var y = (e.clientY - rect.top) / rect.height;
          var size = defaultSize(activeType);
          var field = {
            id: uid(),
            type: activeType,
            label: typeLabel(activeType),
            page: Number(pageEl.getAttribute("data-page")),
            x: Math.min(0.95 - size.w, Math.max(0, x - size.w / 2)),
            y: Math.min(0.95 - size.h, Math.max(0, y - size.h / 2)),
            w: size.w,
            h: size.h,
            required: true,
          };
          fields.push(field);
          selectedId = field.id;
          paintOverlays();
          clearPlacing();
        };

        overlay.oncontextmenu = function (e) {
          var box = e.target.closest(".fw-field");
          if (!box || !overlay.contains(box)) return;
          e.preventDefault();
          e.stopPropagation();
          selectedId = box.dataset.id;
          paintOverlays();
          showFieldCtx(e.clientX, e.clientY, box.dataset.id);
        };
      });

      pagesEl.onmousemove = function (e) {
        if (document.documentElement.classList.contains("is-fw-dragging")) return;
        var box = e.target.closest(".fw-field");
        pagesEl.querySelectorAll(".fw-field").forEach(function (b) {
          b.style.cursor = "move";
        });
        if (!box || !pagesEl.contains(box)) {
          pagesEl.style.cursor = "";
          return;
        }
        var cur = cursorForEdge(edgeHit(box, e.clientX, e.clientY));
        box.style.cursor = cur;
        pagesEl.style.cursor = cur;
      };

      pagesEl.onmousedown = function (e) {
        if (e.button !== 0) return;
        var box = e.target.closest(".fw-field");
        if (!box || !pagesEl.contains(box)) return;
        e.preventDefault();
        e.stopPropagation();
        hideFieldCtx();
        var id = box.dataset.id;
        selectedId = id;
        var field = fields.find(function (f) { return f.id === id; });
        if (!field) return;
        var overlay = box.parentElement;
        var rect = overlay.getBoundingClientRect();
        var edge = edgeHit(box, e.clientX, e.clientY);
        var startX = e.clientX;
        var startY = e.clientY;
        var orig = { x: field.x, y: field.y, w: field.w, h: field.h };
        var minW = 0.04;
        var minH = 0.02;
        var dragCursor = cursorForEdge(edge);
        var liveBox = box;

        function lockCursor(cur) {
          document.documentElement.classList.add("is-fw-dragging");
          var style = document.getElementById("fw-drag-cursor-style");
          if (!style) {
            style = document.createElement("style");
            style.id = "fw-drag-cursor-style";
            document.head.appendChild(style);
          }
          style.textContent =
            "html.is-fw-dragging, html.is-fw-dragging * { cursor: " + cur + " !important; }";
        }

        function unlockCursor() {
          document.documentElement.classList.remove("is-fw-dragging");
          var style = document.getElementById("fw-drag-cursor-style");
          if (style) style.remove();
          pagesEl.style.cursor = "";
        }

        function applyBoxStyle() {
          if (!liveBox || !liveBox.isConnected) {
            liveBox = pagesEl.querySelector('.fw-field[data-id="' + id + '"]');
          }
          if (!liveBox) return;
          liveBox.style.left = (field.x * 100) + "%";
          liveBox.style.top = (field.y * 100) + "%";
          liveBox.style.width = (field.w * 100) + "%";
          liveBox.style.height = (field.h * 100) + "%";
          liveBox.style.cursor = dragCursor;
        }

        lockCursor(dragCursor);
        liveBox.classList.add("is-selected");
        liveBox.style.cursor = dragCursor;

        function onMove(ev) {
          var dx = (ev.clientX - startX) / rect.width;
          var dy = (ev.clientY - startY) / rect.height;
          if (!edge) {
            field.x = Math.min(1 - field.w, Math.max(0, orig.x + dx));
            field.y = Math.min(1 - field.h, Math.max(0, orig.y + dy));
          } else {
            var x = orig.x;
            var y = orig.y;
            var w = orig.w;
            var h = orig.h;
            if (edge.indexOf("e") !== -1) {
              w = Math.min(1 - x, Math.max(minW, orig.w + dx));
            }
            if (edge.indexOf("s") !== -1) {
              h = Math.min(1 - y, Math.max(minH, orig.h + dy));
            }
            if (edge.indexOf("w") !== -1) {
              var newX = Math.min(orig.x + orig.w - minW, Math.max(0, orig.x + dx));
              w = orig.w + (orig.x - newX);
              x = newX;
            }
            if (edge.indexOf("n") !== -1) {
              var newY = Math.min(orig.y + orig.h - minH, Math.max(0, orig.y + dy));
              h = orig.h + (orig.y - newY);
              y = newY;
            }
            field.x = x;
            field.y = y;
            field.w = Math.max(minW, w);
            field.h = Math.max(minH, h);
          }
          applyBoxStyle();
          lockCursor(dragCursor);
        }
        function onUp() {
          unlockCursor();
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
          syncHidden();
          paintOverlays();
        }
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      };
    }

    async function renderPdfFromFile(file) {
      if (!file || !pagesEl) return;
      pagesEl.innerHTML = "<p style='padding:20px;text-align:center;'>Loading PDF...</p>";
      await loadPdfJs();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(file);
      var data = await fetch(objectUrl).then(function (r) { return r.arrayBuffer(); });
      pdfDoc = await pdfjsLib.getDocument({ data: data }).promise;
      pagesEl.innerHTML = "";
      for (var p = 1; p <= pdfDoc.numPages; p++) {
        var page = await pdfDoc.getPage(p);
        var viewport = page.getViewport({ scale: 1.2 });
        var wrap = document.createElement("div");
        wrap.className = "fw-page";
        wrap.setAttribute("data-page", String(p));
        var canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        var overlay = document.createElement("div");
        overlay.className = "fw-page__overlay";
        wrap.appendChild(canvas);
        wrap.appendChild(overlay);
        pagesEl.appendChild(wrap);
        await page.render({ canvasContext: canvas.getContext("2d"), viewport: viewport }).promise;
      }
      bindOverlayEvents();
      paintOverlays();
      updatePlaceUi();
    }

    async function renderPdfFromUrl(url) {
      if (!url || !pagesEl) return;
      pagesEl.innerHTML = "<p style='padding:20px;text-align:center;'>Loading PDF...</p>";
      await loadPdfJs();
      pdfDoc = await pdfjsLib.getDocument(url).promise;
      pagesEl.innerHTML = "";
      for (var p = 1; p <= pdfDoc.numPages; p++) {
        var page = await pdfDoc.getPage(p);
        var viewport = page.getViewport({ scale: 1.2 });
        var wrap = document.createElement("div");
        wrap.className = "fw-page";
        wrap.setAttribute("data-page", String(p));
        var canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        var overlay = document.createElement("div");
        overlay.className = "fw-page__overlay";
        wrap.appendChild(canvas);
        wrap.appendChild(overlay);
        pagesEl.appendChild(wrap);
        await page.render({ canvasContext: canvas.getContext("2d"), viewport: viewport }).promise;
      }
      bindOverlayEvents();
      paintOverlays();
      updatePlaceUi();
    }

    if (toolsEl) {
      toolsEl.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-field-type]");
        if (!btn) return;
        setType(btn.getAttribute("data-field-type"));
      });
      updatePlaceUi();
    }

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && placing) clearPlacing();
    });

    if (listEl) {
      listEl.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-remove]");
        if (!btn) return;
        var id = btn.getAttribute("data-remove");
        fields = fields.filter(function (f) { return f.id !== id; });
        if (selectedId === id) selectedId = null;
        paintOverlays();
      });
    }

    if (fileInput) {
      fileInput.addEventListener("change", function () {
        var file = fileInput.files && fileInput.files[0];
        if (!file) return;
        fields = [];
        selectedId = null;
        renderPdfFromFile(file);
      });
    }

    syncHidden();

    return {
      getFields: function () { return fields.slice(); },
      setFields: function (next) {
        fields = Array.isArray(next) ? next.slice() : [];
        paintOverlays();
      },
      renderPdfFromUrl: renderPdfFromUrl,
      renderPdfFromFile: renderPdfFromFile,
    };
  }

  // -------- Wizard for /add-form --------
  var form = document.getElementById("addFormWizard");
  if (form) {
    var steps = Array.prototype.slice.call(form.querySelectorAll(".form-wizard__step"));
    var dots = Array.prototype.slice.call(document.querySelectorAll(".form-wizard__dot"));
    var idx = 0;
    var placer = createPlacer({
      fileInput: document.getElementById("wizardPdf"),
      pagesEl: document.getElementById("wizardPdfPages"),
      toolsEl: document.getElementById("wizardTools"),
      listEl: document.getElementById("wizardFieldList"),
      fieldsInput: document.getElementById("fieldsJson"),
    });

    function showStep(n) {
      idx = Math.max(0, Math.min(steps.length - 1, n));
      steps.forEach(function (s, i) { s.classList.toggle("is-active", i === idx); });
      dots.forEach(function (d, i) {
        d.classList.toggle("is-active", i === idx);
        d.classList.toggle("is-done", i < idx);
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
    }

    function validateStep(n) {
      var err = document.getElementById("wizardError");
      if (err) { err.hidden = true; err.textContent = ""; }
      function fail(msg) {
        if (err) { err.hidden = false; err.textContent = msg; }
        if (window.bgAlert) bgAlert(msg);
        return false;
      }
      if (n === 0) {
        var title = String(form.title.value || "").trim();
        if (!title) return fail("Please type a name for this form.");
      }
      if (n === 1) {
        var desc = String(form.description.value || "").trim();
        if (!desc) return fail("Please type a short description.");
      }
      if (n === 2) {
        var file = form.document_path && form.document_path.files && form.document_path.files[0];
        if (!file) return fail("Please choose a PDF to upload.");
        if (!placer.getFields().length) {
          return fail("Add at least one box on the PDF for people to fill in or sign.");
        }
      }
      if (n === 3) {
        var any =
          form.audience_corps.checked ||
          form.audience_independent.checked ||
          form.audience_affiliate.checked ||
          form.audience_staff.checked;
        if (!any) return fail("Check at least one group who needs this form.");
      }
      if (n === 4) {
        if (!form.due_date.value) return fail("Please choose a due date.");
        if (!form.expire_date.value) return fail("Please choose an expiration date.");
      }
      return true;
    }

    form.addEventListener("click", function (e) {
      var next = e.target.closest("[data-next]");
      var back = e.target.closest("[data-back]");
      if (next) {
        e.preventDefault();
        if (!validateStep(idx)) return;
        showStep(idx + 1);
      }
      if (back) {
        e.preventDefault();
        showStep(idx - 1);
      }
    });

    form.addEventListener("submit", function (e) {
      if (!validateStep(0) || !validateStep(1) || !validateStep(2) || !validateStep(3) || !validateStep(4)) {
        e.preventDefault();
        return;
      }
      document.getElementById("fieldsJson").value = JSON.stringify(placer.getFields());
    });

    showStep(0);
  }

  // -------- Fill / sign UI --------
  var fillRoot = document.getElementById("formFillRoot");
  if (fillRoot) {
    var pdfUrl = fillRoot.getAttribute("data-pdf");
    var fields = [];
    try { fields = JSON.parse(fillRoot.getAttribute("data-fields") || "[]"); } catch (_) { fields = []; }
    var prefill = {};
    try { prefill = JSON.parse(fillRoot.getAttribute("data-prefill") || "{}"); } catch (_) { prefill = {}; }
    if (!prefill || typeof prefill !== "object" || Array.isArray(prefill)) prefill = {};
    var pagesEl = document.getElementById("formFillPages");
    var valuesInput = document.getElementById("fieldValues");
    var signForm = document.getElementById("formFillForm");

    async function renderFill() {
      if (!pdfUrl || !pagesEl) return;
      pagesEl.innerHTML = "<p style='text-align:center;padding:24px;'>Loading the form...</p>";
      await loadPdfJs();
      var doc = await pdfjsLib.getDocument(pdfUrl).promise;
      pagesEl.innerHTML = "";
      for (var p = 1; p <= doc.numPages; p++) {
        var page = await doc.getPage(p);
        var viewport = page.getViewport({ scale: 1.15 });
        var wrap = document.createElement("div");
        wrap.className = "fw-page";
        wrap.setAttribute("data-page", String(p));
        var canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        var overlay = document.createElement("div");
        overlay.className = "fw-page__overlay";
        wrap.appendChild(canvas);
        wrap.appendChild(overlay);
        pagesEl.appendChild(wrap);
        await page.render({ canvasContext: canvas.getContext("2d"), viewport: viewport }).promise;

        fields.filter(function (f) { return Number(f.page) === p; }).forEach(function (f) {
          var box = document.createElement("div");
          box.className = "ff-field-box" +
            (f.type === "signature" || f.type === "initials" ? " is-signature" : "") +
            (f.type === "date" ? " is-date" : "");
          box.style.left = (f.x * 100) + "%";
          box.style.top = (f.y * 100) + "%";
          box.style.width = (f.w * 100) + "%";
          box.style.height = (f.h * 100) + "%";
          var input = document.createElement("input");
          input.type = f.type === "date" ? "date" : "text";
          input.name = "fld_" + f.id;
          input.dataset.fieldId = f.id;
          input.placeholder = f.label || (f.type === "signature" ? "Type your name to sign" : "Type here");
          // Partial submit is allowed - nothing on the PDF is required by the browser.
          input.required = false;
          var prior = prefill[f.id] != null ? String(prefill[f.id]).trim() : "";
          if (prior) {
            input.value = prior;
            // Keep prior signatures/initials locked so a later signer cannot wipe them.
            if (f.type === "signature" || f.type === "initials") {
              input.readOnly = true;
              input.title = "Already signed - kept for this legal document";
              box.classList.add("is-locked");
            }
          }
          box.appendChild(input);
          overlay.appendChild(box);
        });
      }
    }

    if (signForm) {
      signForm.addEventListener("submit", function () {
        var map = {};
        fillRoot.querySelectorAll("[data-field-id]").forEach(function (input) {
          map[input.dataset.fieldId] = input.value;
        });
        // Push bottom signature into empty signature/initial boxes only (do not overwrite locked priors).
        var mainSig = signForm.signature && signForm.signature.value;
        fields.forEach(function (f) {
          if ((f.type === "signature" || f.type === "initials") && !String(map[f.id] || "").trim() && mainSig) {
            map[f.id] = mainSig;
          }
        });
        // Preserve prior non-empty values client-side as well
        Object.keys(prefill).forEach(function (key) {
          if (!String(map[key] || "").trim() && String(prefill[key] || "").trim()) {
            map[key] = prefill[key];
          }
        });
        if (valuesInput) valuesInput.value = JSON.stringify(map);
        // Intentionally no block for missing fields - users may submit partially.
      });
    }

    renderFill().catch(function (err) {
      console.error(err);
      if (pagesEl) pagesEl.innerHTML = "<p style='color:#c1272d;text-align:center;'>Could not load the PDF.</p>";
    });
  }

  window.FormWizardPlacer = { createPlacer: createPlacer, loadPdfJs: loadPdfJs };
})();
