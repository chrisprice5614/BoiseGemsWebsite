(function () {
  "use strict";

  var variantState = JSON.parse(document.getElementById("variantsData").textContent || "{}");
  if (!variantState.sizeLabels) variantState.sizeLabels = [];
  if (!variantState.colors) variantState.colors = [];
  if (variantState.hasVariants == null) variantState.hasVariants = false;

  var modal = document.getElementById("variantsModal");
  var addSizeModal = document.getElementById("addSizeModal");
  var form = document.getElementById("merchProductForm");

  function syncSizeMaps() {
    variantState.colors.forEach(function (c) {
      if (!c.sizes) c.sizes = {};
      variantState.sizeLabels.forEach(function (sz) {
        if (!c.sizes[sz]) c.sizes[sz] = { enabled: true, stock_qty: "" };
      });
      Object.keys(c.sizes).forEach(function (k) {
        if (variantState.sizeLabels.indexOf(k) === -1) delete c.sizes[k];
      });
    });
  }

  function updateSummary() {
    var el = document.getElementById("variantSummary");
    var openBtn = document.getElementById("openVariantsBtn");
    var addBtn = document.getElementById("addVariantsBtn");
    var removeBtn = document.getElementById("removeAllVariantsBtn");
    if (!el) return;
    if (!variantState.hasVariants) {
      el.textContent = "Simple product with no size or color options.";
      if (openBtn) openBtn.style.display = "none";
      if (addBtn) addBtn.style.display = "";
      if (removeBtn) removeBtn.style.display = "none";
    } else {
      var nc = variantState.colors.length;
      var ns = variantState.sizeLabels.length;
      el.textContent = nc + " color" + (nc === 1 ? "" : "s") + ", " + ns + " size" + (ns === 1 ? "" : "s");
      if (openBtn) openBtn.style.display = "";
      if (addBtn) addBtn.style.display = "none";
      if (removeBtn) removeBtn.style.display = "";
    }
  }

  function openModal(el) {
    if (el) el.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeModal(el) {
    if (el) el.hidden = true;
    document.body.style.overflow = "";
  }

  function renderVariantModal() {
    var sizesList = document.getElementById("variantSizesList");
    var colorsList = document.getElementById("variantColorsList");
    var fileInputs = document.getElementById("variantFileInputs");
    if (!sizesList || !colorsList) return;

    sizesList.innerHTML = "";
    variantState.sizeLabels.forEach(function (sz, si) {
      var li = document.createElement("li");
      li.className = "merch-size-chip";
      li.dataset.size = sz;
      li.innerHTML =
        '<span class="merch-cat-grip merch-size-grip" aria-hidden="true">⠿</span>' +
        '<span class="merch-size-chip-label">' + escapeHtml(sz) + "</span>" +
        '<button type="button" class="merch-chip-remove" data-size-index="' + si + '">×</button>';
      sizesList.appendChild(li);
    });

    colorsList.innerHTML = "";
    fileInputs.innerHTML = "";
    variantState.colors.forEach(function (c, ci) {
      var card = document.createElement("div");
      card.className = "merch-color-card";
      card.dataset.colorIndex = ci;

      var matrixHead = variantState.sizeLabels.map(function (sz) {
        return "<th>" + escapeHtml(sz) + "</th>";
      }).join("");

      var matrixCells = variantState.sizeLabels.map(function (sz) {
        var d = (c.sizes && c.sizes[sz]) || { enabled: true, stock_qty: "" };
        return (
          '<td class="merch-matrix-cell">' +
          '<label class="merch-matrix-active"><input type="checkbox" data-ci="' + ci + '" data-sz="' + escapeHtml(sz) + '" data-field="enabled" ' + (d.enabled ? "checked" : "") + "> Active</label>" +
          '<input type="number" class="merch-matrix-stock" min="0" placeholder="Stock" data-ci="' + ci + '" data-sz="' + escapeHtml(sz) + '" data-field="stock_qty" value="' + (d.stock_qty !== "" && d.stock_qty != null ? d.stock_qty : "") + '">' +
          "</td>"
        );
      }).join("");

      var thumbs = (c.existing_images || []).map(function (fn, ti) {
        return (
          '<div class="merch-color-thumb-wrap">' +
          '<img src="/img/merch/' + escapeHtml(fn) + '" class="merch-color-thumb" alt="">' +
          '<button type="button" class="merch-thumb-remove" data-ci="' + ci + '" data-img-index="' + ti + '" aria-label="Remove photo">×</button>' +
          "</div>"
        );
      }).join("");

      card.innerHTML =
        '<div class="merch-color-card-head">' +
        '<span class="merch-cat-grip merch-color-grip" aria-hidden="true">⠿</span>' +
        '<input type="text" class="merch-color-name" data-ci="' + ci + '" value="' + escapeHtml(c.color_name || "") + '" placeholder="Color name">' +
        '<input type="color" class="merch-color-picker" data-ci="' + ci + '" value="' + escapeHtml(c.color_hex || "#60437d") + '">' +
        '<button type="button" class="merch-color-remove" data-ci="' + ci + '">Remove color</button>' +
        "</div>" +
        '<div class="merch-color-images">' + thumbs + "</div>" +
        '<label class="merch-file-label">Photos for this color (add multiple)</label>' +
        '<div id="colorFileSlot' + ci + '"></div>' +
        (variantState.sizeLabels.length
          ? '<table class="merch-matrix"><thead><tr><th></th>' + matrixHead + "</tr></thead><tbody><tr><th>" + escapeHtml(c.color_name || "Color") + "</th>" + matrixCells + "</tr></tbody></table>"
          : '<p class="merch-matrix-hint">Add at least one size above.</p>');

      colorsList.appendChild(card);

      var slot = document.getElementById("colorFileSlot" + ci);
      var inp = document.createElement("input");
      inp.type = "file";
      inp.name = "color_image_" + ci;
      inp.accept = "image/*";
      inp.multiple = true;
      slot.appendChild(inp);
    });

    bindModalInputs();

    if (typeof Sortable !== "undefined") {
      if (sizesList._sortable) sizesList._sortable.destroy();
      sizesList._sortable = new Sortable(sizesList, {
        animation: 150,
        handle: ".merch-size-grip",
        draggable: ".merch-size-chip",
        onEnd: function () {
          variantState.sizeLabels = Array.from(sizesList.querySelectorAll(".merch-size-chip")).map(function (el) {
            return el.dataset.size;
          });
          syncSizeMaps();
          renderVariantModal();
        },
      });

      if (colorsList._sortable) colorsList._sortable.destroy();
      colorsList._sortable = new Sortable(colorsList, {
        animation: 150,
        handle: ".merch-color-grip",
        draggable: ".merch-color-card",
        onEnd: function () {
          var reordered = [];
          colorsList.querySelectorAll(".merch-color-card").forEach(function (el) {
            reordered.push(variantState.colors[Number(el.dataset.colorIndex)]);
          });
          variantState.colors = reordered;
          renderVariantModal();
        },
      });
    }
  }

  function syncFromModal() {
    document.querySelectorAll(".merch-color-name").forEach(function (inp) {
      var ci = Number(inp.dataset.ci);
      variantState.colors[ci].color_name = inp.value;
    });
    document.querySelectorAll(".merch-color-picker").forEach(function (inp) {
      var ci = Number(inp.dataset.ci);
      variantState.colors[ci].color_hex = inp.value;
    });
    document.querySelectorAll(".merch-matrix-cell input").forEach(function (inp) {
      var ci = Number(inp.dataset.ci);
      var sz = inp.dataset.sz;
      var field = inp.dataset.field;
      if (!variantState.colors[ci].sizes[sz]) variantState.colors[ci].sizes[sz] = {};
      if (field === "enabled") variantState.colors[ci].sizes[sz].enabled = inp.checked;
      else if (field === "stock_qty") variantState.colors[ci].sizes[sz].stock_qty = inp.value;
    });
  }

  function bindModalInputs() {
    document.querySelectorAll(".merch-chip-remove[data-size-index]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var idx = Number(btn.dataset.sizeIndex);
        var sz = variantState.sizeLabels[idx];
        bgConfirm('Remove size "' + sz + '"?', function () {
          variantState.sizeLabels.splice(idx, 1);
          syncSizeMaps();
          renderVariantModal();
        });
      });
    });
    document.querySelectorAll(".merch-color-remove").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var ci = Number(btn.dataset.ci);
        bgConfirm("Remove this color?", function () {
          variantState.colors.splice(ci, 1);
          if (!variantState.colors.length) variantState.hasVariants = false;
          renderVariantModal();
          updateSummary();
        });
      });
    });
    document.querySelectorAll(".merch-thumb-remove").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var ci = Number(btn.dataset.ci);
        var ti = Number(btn.dataset.imgIndex);
        if (!variantState.colors[ci] || !variantState.colors[ci].existing_images) return;
        variantState.colors[ci].existing_images.splice(ti, 1);
        renderVariantModal();
      });
    });
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  function startVariants() {
    variantState.hasVariants = true;
    variantState.sizeLabels = [];
    variantState.colors = [];
    syncSizeMaps();
    updateSummary();
    renderVariantModal();
    openModal(modal);
  }

  document.getElementById("addVariantsBtn").addEventListener("click", startVariants);
  document.getElementById("openVariantsBtn").addEventListener("click", function () {
    syncSizeMaps();
    renderVariantModal();
    openModal(modal);
  });

  document.getElementById("variantsModalClose").addEventListener("click", function () {
    syncFromModal();
    closeModal(modal);
    updateSummary();
  });

  document.getElementById("variantsModalDone").addEventListener("click", function () {
    syncFromModal();
    closeModal(modal);
    updateSummary();
  });

  document.getElementById("removeAllVariantsBtn").addEventListener("click", function () {
    bgConfirm("Remove all variants? This product will be a simple item with no sizes or colors.", function () {
      variantState.hasVariants = false;
      variantState.sizeLabels = [];
      variantState.colors = [];
      updateSummary();
    });
  });

  document.getElementById("addSizeBtn").addEventListener("click", function () {
    document.getElementById("newSizeName").value = "";
    openModal(addSizeModal);
    setTimeout(function () { document.getElementById("newSizeName").focus(); }, 50);
  });

  document.getElementById("addSizeCancel").addEventListener("click", function () {
    closeModal(addSizeModal);
  });

  document.getElementById("addSizeConfirm").addEventListener("click", function () {
    var name = String(document.getElementById("newSizeName").value || "").trim().toUpperCase();
    if (!name) {
      bgAlert("Enter a size name.");
      return;
    }
    if (variantState.sizeLabels.indexOf(name) !== -1) {
      bgAlert("That size already exists.");
      return;
    }
    variantState.sizeLabels.push(name);
    syncSizeMaps();
    closeModal(addSizeModal);
    renderVariantModal();
  });

  document.getElementById("addColorBtn").addEventListener("click", function () {
    syncFromModal();
    variantState.colors.push({
      color_name: "New Color",
      color_hex: "#60437d",
      existing_images: [],
      sizes: {},
    });
    syncSizeMaps();
    renderVariantModal();
  });

  document.getElementById("productType").addEventListener("change", function () {
    var digital = this.value === "digital";
    document.getElementById("digitalFields").style.display = digital ? "" : "none";
    document.getElementById("physicalVariantSection").style.display = digital ? "none" : "";
  });

  form.addEventListener("submit", function () {
    syncFromModal();
    document.getElementById("variantsJsonField").value = JSON.stringify(variantState);
  });

  var delBtn = document.getElementById("merchProductDeleteBtn");
  if (delBtn) {
    delBtn.addEventListener("click", function () {
      bgConfirm("Delete this product?", function () {
        document.getElementById("merchProductDeleteForm").submit();
      });
    });
  }

  updateSummary();
})();
