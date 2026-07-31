(function () {
  "use strict";

  var VIEW_KEY = "bgFilesView";
  var SORT_KEY = "bgFilesSort";
  var itemsEl = document.getElementById("filesDriveItems");
  if (!itemsEl) return;

  var canManage = document.body.dataset.canManage === "1";
  var folderId = document.body.dataset.folderId || null;
  var viewBtns = document.querySelectorAll(".files-drive__view-btn[data-view]");
  var sortEl = document.getElementById("filesSort");
  var searchEl = document.getElementById("filesSearch");
  var emptyEl = document.getElementById("filesEmpty");
  var searchEmptyEl = document.getElementById("filesSearchEmpty");
  var dropZone = document.getElementById("filesDropZone");

  var previewModal = document.getElementById("filesPreviewModal");
  var previewTitle = document.getElementById("filesPreviewTitle");
  var previewBody = document.getElementById("filesPreviewBody");
  var previewDownload = document.getElementById("filesPreviewDownload");

  var uploadModal = document.getElementById("filesUploadModal");
  var uploadCount = document.getElementById("filesUploadCount");
  var uploadError = document.getElementById("filesUploadError");
  var pendingFiles = null;
  var permsFileId = null;
  var permsTargets = null;

  var ctx = document.getElementById("filesCtx");
  var ctxTarget = null;
  var ctxMode = null; // file | folder | empty | multi
  var lastSelectedFile = null;

  var allItems = [];
  var searchTimer = null;
  var searching = false;

  function iconFor(kind) {
    if (kind === "audio") return "musical-notes";
    if (kind === "image") return "image";
    if (kind === "folder") return "folder";
    return "document-text";
  }

  function captureItems() {
    allItems = Array.prototype.slice.call(itemsEl.querySelectorAll(".files-drive-item")).map(function (el) {
      return {
        el: el,
        kind: el.dataset.kind,
        id: el.dataset.id,
        name: el.dataset.name || "",
        created: Number(el.dataset.created || 0),
        type: el.dataset.type || "",
        url: el.dataset.url || "",
        mime: el.dataset.mime || "",
        iconKind: el.dataset.iconKind || (el.dataset.kind === "folder" ? "folder" : "pdf"),
      };
    });
  }

  function setView(mode) {
    var isList = mode === "list";
    localStorage.setItem(VIEW_KEY, isList ? "list" : "grid");
    itemsEl.classList.toggle("is-list", isList);
    viewBtns.forEach(function (btn) {
      btn.classList.toggle("is-active", btn.dataset.view === (isList ? "list" : "grid"));
    });
  }

  function compareItems(a, b, sort) {
    if (sort === "type") {
      var ta = a.kind === "folder" ? "0folder" : "1" + (a.type || "");
      var tb = b.kind === "folder" ? "0folder" : "1" + (b.type || "");
      if (ta !== tb) return ta.localeCompare(tb);
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    }
    if (sort === "newest") return b.created - a.created || a.name.localeCompare(b.name);
    if (sort === "oldest") return a.created - b.created || a.name.localeCompare(b.name);
    if (sort === "za") return b.name.localeCompare(a.name, undefined, { sensitivity: "base" });
    // folders first for az
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  }

  function applySort() {
    var sort = (sortEl && sortEl.value) || localStorage.getItem(SORT_KEY) || "az";
    if (sortEl) sortEl.value = sort;
    localStorage.setItem(SORT_KEY, sort);
    var visible = allItems.filter(function (it) { return !it.el.hidden; });
    visible.sort(function (a, b) { return compareItems(a, b, sort); });
    visible.forEach(function (it) { itemsEl.appendChild(it.el); });
  }

  function updateEmpty() {
    var anyVisible = allItems.some(function (it) { return !it.el.hidden; });
    if (searching) {
      if (emptyEl) emptyEl.hidden = true;
      if (searchEmptyEl) searchEmptyEl.hidden = anyVisible;
      return;
    }
    if (searchEmptyEl) searchEmptyEl.hidden = true;
    if (emptyEl) emptyEl.hidden = anyVisible;
  }

  function filterLocal(q) {
    searching = !!q;
    allItems.forEach(function (it) {
      var match = !q || it.name.toLowerCase().indexOf(q) !== -1;
      it.el.hidden = !match;
      it.el.classList.toggle("is-search-hit", !!q && match);
    });
    applySort();
    updateEmpty();
  }

  function clearSearchResultsExtras() {
    itemsEl.querySelectorAll("[data-search-result='1']").forEach(function (el) { el.remove(); });
    allItems = allItems.filter(function (it) { return it.el.dataset.searchResult !== "1"; });
  }

  function makeSearchFolderCard(folder) {
    var a = document.createElement("a");
    a.href = "/files/folder/" + folder.id;
    a.className = "files-drive-item files-drive-card";
    a.dataset.kind = "folder";
    a.dataset.id = String(folder.id);
    a.dataset.name = folder.name;
    a.dataset.created = String(folder.created_at || folder.updated_at || 0);
    a.dataset.type = "folder";
    a.dataset.searchResult = "1";
    a.innerHTML =
      '<div class="files-drive-card__icon"><ion-icon name="folder"></ion-icon></div>' +
      '<p class="files-drive-card__name"></p>' +
      '<p class="files-drive-card__meta">In subfolder</p>';
    a.querySelector(".files-drive-card__name").textContent = folder.name;
    return a;
  }

  function makeSearchFileCard(file) {
    var btn = document.createElement("div");
    btn.role = "button";
    btn.tabIndex = 0;
    btn.className = "files-drive-item files-drive-card";
    btn.dataset.kind = "file";
    btn.dataset.id = String(file.id);
    btn.dataset.name = file.title;
    btn.dataset.url = file.stored_path;
    btn.dataset.mime = file.mime_type || "";
    btn.dataset.iconKind = file.iconKind || "pdf";
    btn.dataset.created = String(file.created_at || 0);
    btn.dataset.type = file.typeLabel || "PDF";
    btn.dataset.allowAnyone = file.allow_noncontracted ? "1" : "0";
    btn.dataset.allowCorps = file.allow_corps ? "1" : "0";
    btn.dataset.allowIndependent = file.allow_independent ? "1" : "0";
    btn.dataset.searchResult = "1";
    var icon = iconFor(file.iconKind || "pdf");
    btn.innerHTML =
      '<div class="files-drive-card__icon"><ion-icon name="' + icon + '"></ion-icon></div>' +
      '<p class="files-drive-card__name"></p>' +
      '<p class="files-drive-card__meta"></p>';
    btn.querySelector(".files-drive-card__name").textContent = file.title;
    btn.querySelector(".files-drive-card__meta").textContent = (file.typeLabel || "PDF") + " · in subfolder";
    return btn;
  }

  function runDeepSearch(q) {
    searching = true;
    clearSearchResultsExtras();
    // show local matches first
    allItems.forEach(function (it) {
      if (it.el.dataset.searchResult === "1") return;
      var match = it.name.toLowerCase().indexOf(q) !== -1;
      it.el.hidden = !match;
    });

    if (!folderId) {
      applySort();
      updateEmpty();
      return;
    }

    fetch("/files/folder/" + folderId + "/search?q=" + encodeURIComponent(q), {
      headers: { Accept: "application/json" },
      credentials: "same-origin",
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || !data.ok) return;
        var localIds = {};
        allItems.forEach(function (it) {
          if (it.el.dataset.searchResult !== "1") localIds[it.kind + ":" + it.id] = true;
        });
        (data.folders || []).forEach(function (folder) {
          if (localIds["folder:" + folder.id]) return;
          var el = makeSearchFolderCard(folder);
          itemsEl.appendChild(el);
        });
        (data.files || []).forEach(function (file) {
          if (localIds["file:" + file.id]) return;
          // skip files already visible in this folder
          var already = allItems.some(function (it) {
            return it.kind === "file" && String(it.id) === String(file.id) && it.el.dataset.searchResult !== "1";
          });
          if (already) return;
          var el = makeSearchFileCard(file);
          itemsEl.appendChild(el);
        });
        captureItems();
        applySort();
        updateEmpty();
      })
      .catch(function () {
        applySort();
        updateEmpty();
      });
  }

  function onSearchInput() {
    clearTimeout(searchTimer);
    var q = (searchEl.value || "").trim().toLowerCase();
    searchTimer = setTimeout(function () {
      if (!q) {
        searching = false;
        clearSearchResultsExtras();
        captureItems();
        allItems.forEach(function (it) { it.el.hidden = false; });
        applySort();
        updateEmpty();
        return;
      }
      if (folderId) runDeepSearch(q);
      else filterLocal(q);
    }, 220);
  }

  function hideCtx() {
    if (ctx) ctx.hidden = true;
    ctxTarget = null;
    ctxMode = null;
  }

  function showCtx(x, y, mode, target) {
    if (!ctx) return;
    ctxMode = mode;
    ctxTarget = target;
    var downloadBtn = ctx.querySelector('[data-action="download"]');
    var renameBtn = ctx.querySelector('[data-action="rename"]');
    var permsBtn = ctx.querySelector('[data-action="permissions"]');
    var deleteBtn = ctx.querySelector('[data-action="delete"]');
    var uploadBtn = ctx.querySelector('[data-action="upload"]');
    var createBtn = ctx.querySelector('[data-action="create-folder"]');

    if (mode === "empty") {
      downloadBtn.hidden = true;
      renameBtn.hidden = true;
      permsBtn.hidden = true;
      deleteBtn.hidden = true;
      uploadBtn.hidden = !canManage;
      createBtn.hidden = !canManage;
      if (!canManage) return;
    } else if (mode === "folder") {
      downloadBtn.hidden = true;
      renameBtn.hidden = true;
      permsBtn.hidden = true;
      uploadBtn.hidden = true;
      createBtn.hidden = true;
      deleteBtn.hidden = !canManage;
      if (!canManage) return;
    } else if (mode === "multi") {
      downloadBtn.hidden = true;
      renameBtn.hidden = true;
      uploadBtn.hidden = true;
      createBtn.hidden = true;
      permsBtn.hidden = !canManage;
      deleteBtn.hidden = !canManage;
      if (!canManage) return;
    } else {
      uploadBtn.hidden = true;
      createBtn.hidden = true;
      downloadBtn.hidden = false;
      renameBtn.hidden = !canManage;
      permsBtn.hidden = !canManage;
      deleteBtn.hidden = !canManage;
    }

    ctx.hidden = false;
    var rect = ctx.getBoundingClientRect();
    var left = Math.min(x, window.innerWidth - rect.width - 8);
    var top = Math.min(y, window.innerHeight - rect.height - 8);
    ctx.style.left = Math.max(8, left) + "px";
    ctx.style.top = Math.max(8, top) + "px";
  }

  function getSelectedFiles() {
    return Array.prototype.slice.call(itemsEl.querySelectorAll(".files-drive-item[data-kind='file'].is-selected"))
      .filter(function (el) { return !el.hidden; });
  }

  function clearFileSelection() {
    itemsEl.querySelectorAll(".files-drive-item.is-selected").forEach(function (el) {
      el.classList.remove("is-selected");
    });
  }

  function getVisibleFileEls() {
    return Array.prototype.slice.call(itemsEl.querySelectorAll(".files-drive-item[data-kind='file']"))
      .filter(function (el) { return !el.hidden; });
  }

  function selectFileRange(fromEl, toEl) {
    var files = getVisibleFileEls();
    var a = files.indexOf(fromEl);
    var b = files.indexOf(toEl);
    if (a < 0 || b < 0) {
      clearFileSelection();
      toEl.classList.add("is-selected");
      return;
    }
    var lo = Math.min(a, b);
    var hi = Math.max(a, b);
    clearFileSelection();
    for (var i = lo; i <= hi; i++) files[i].classList.add("is-selected");
  }

  function stripFileExtension(name) {
    var raw = String(name || "").trim();
    if (!raw) return "";
    var stripped = raw.replace(/\.[A-Za-z0-9]{1,10}$/, "").trim();
    return stripped || raw;
  }

  function titleLooksLikeHasExtension(name) {
    return /\.[A-Za-z0-9]{1,10}$/.test(String(name || "").trim());
  }

  function openPreview(item) {
    if (!previewModal) return;
    var url = item.dataset.url;
    var name = item.dataset.name || "File";
    var kind = item.dataset.iconKind || "pdf";
    previewTitle.textContent = name;
    previewDownload.href = url;
    previewDownload.setAttribute("download", name);
    previewBody.innerHTML = "";
    if (kind === "audio") {
      var audio = document.createElement("audio");
      audio.className = "fd-preview-audio";
      audio.controls = true;
      audio.src = url;
      audio.autoplay = true;
      previewBody.appendChild(audio);
    } else if (kind === "image") {
      var imgWrap = document.createElement("div");
      imgWrap.className = "fd-preview-image-wrap";
      var img = document.createElement("img");
      img.className = "fd-preview-image";
      img.src = url;
      img.alt = name;
      imgWrap.appendChild(img);
      previewBody.appendChild(imgWrap);
    } else {
      var iframe = document.createElement("iframe");
      iframe.className = "fd-preview-pdf";
      iframe.src = url;
      iframe.title = name;
      previewBody.appendChild(iframe);
    }
    previewModal.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closePreview() {
    if (!previewModal) return;
    previewModal.hidden = true;
    previewBody.innerHTML = "";
    document.body.style.overflow = "";
  }

  function openUploadModal(fileList) {
    if (!uploadModal || !canManage) return;
    pendingFiles = fileList;
    uploadCount.textContent = fileList.length + " file" + (fileList.length === 1 ? "" : "s") + " ready to upload.";
    uploadError.hidden = true;
    document.getElementById("upAnyone").checked = false;
    document.getElementById("upCorps").checked = true;
    document.getElementById("upIndependent").checked = false;
    uploadModal.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeUpload() {
    if (!uploadModal) return;
    uploadModal.hidden = true;
    pendingFiles = null;
    document.body.style.overflow = "";
  }

  function syncAnyoneExclusive(anyoneId, corpsId, indepId) {
    var anyone = document.getElementById(anyoneId);
    var corps = document.getElementById(corpsId);
    var indep = document.getElementById(indepId);
    if (!anyone) return;
    anyone.addEventListener("change", function () {
      if (anyone.checked) {
        corps.checked = false;
        indep.checked = false;
      }
    });
    [corps, indep].forEach(function (el) {
      el.addEventListener("change", function () {
        if (el.checked) anyone.checked = false;
      });
    });
  }

  function doUpload() {
    if (!pendingFiles || !folderId) return;
    var anyone = document.getElementById("upAnyone").checked;
    var corps = document.getElementById("upCorps").checked;
    var independent = document.getElementById("upIndependent").checked;
    if (!anyone && !corps && !independent) {
      uploadError.textContent = "Choose at least one permission.";
      uploadError.hidden = false;
      return;
    }
    var fd = new FormData();
    Array.prototype.forEach.call(pendingFiles, function (file) {
      fd.append("files", file);
    });
    fd.append("allow_anyone", anyone ? "1" : "0");
    fd.append("allow_corps", corps ? "1" : "0");
    fd.append("allow_independent", independent ? "1" : "0");
    var upSensitive = document.getElementById("upSensitive");
    fd.append("sensitive", upSensitive && upSensitive.checked ? "1" : "0");

    var btn = document.getElementById("filesUploadConfirm");
    if (btn) btn.disabled = true;
    fetch("/files/folder/" + folderId + "/upload", {
      method: "POST",
      body: fd,
      headers: { Accept: "application/json" },
      credentials: "same-origin",
    })
      .then(function (r) {
        return r.json().then(function (data) {
          return { ok: r.ok, data: data };
        });
      })
      .then(function (res) {
        if (!res.ok || !res.data.ok) {
          uploadError.textContent = (res.data && res.data.message) || "Upload failed.";
          uploadError.hidden = false;
          return;
        }
        closeUpload();
        window.location.reload();
      })
      .catch(function () {
        uploadError.textContent = "Upload failed.";
        uploadError.hidden = false;
      })
      .finally(function () {
        if (btn) btn.disabled = false;
      });
  }

  function openPerms(itemOrItems) {
    var items = Array.isArray(itemOrItems) ? itemOrItems : [itemOrItems];
    items = items.filter(Boolean);
    if (!items.length) return;
    permsTargets = items;
    permsFileId = items[0].dataset.id;
    var label = items.length === 1
      ? (items[0].dataset.name || "")
      : items.length + " selected files";
    document.getElementById("filesPermsFileName").textContent = label;
    // If multi, start from first file's flags; bulk will overwrite all
    var sample = items[0];
    document.getElementById("permAnyone").checked = sample.dataset.allowAnyone === "1";
    document.getElementById("permCorps").checked = sample.dataset.allowCorps === "1" && sample.dataset.allowAnyone !== "1";
    document.getElementById("permIndependent").checked =
      sample.dataset.allowIndependent === "1" && sample.dataset.allowAnyone !== "1";
    document.getElementById("filesPermsError").hidden = true;
    document.getElementById("filesPermsModal").hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closePerms() {
    document.getElementById("filesPermsModal").hidden = true;
    permsFileId = null;
    permsTargets = null;
    document.body.style.overflow = "";
  }

  function savePerms() {
    var anyone = document.getElementById("permAnyone").checked;
    var corps = document.getElementById("permCorps").checked;
    var independent = document.getElementById("permIndependent").checked;
    var err = document.getElementById("filesPermsError");
    if (!anyone && !corps && !independent) {
      err.textContent = "Choose at least one permission.";
      err.hidden = false;
      return;
    }
    var targets = (permsTargets && permsTargets.length)
      ? permsTargets
      : allItems.filter(function (it) { return String(it.id) === String(permsFileId); }).map(function (it) { return it.el; });
    if (!targets.length) return;

    var body = new URLSearchParams();
    body.set("allow_anyone", anyone ? "1" : "0");
    body.set("allow_corps", corps ? "1" : "0");
    body.set("allow_independent", independent ? "1" : "0");

    var saveBtn = document.getElementById("filesPermsSave");
    if (saveBtn) saveBtn.disabled = true;

    Promise.all(targets.map(function (el) {
      return fetch("/files/item/" + el.dataset.id + "/permissions", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: body.toString(),
        credentials: "same-origin",
      }).then(function (r) { return r.json(); });
    }))
      .then(function (results) {
        var failed = results.find(function (data) { return !data || !data.ok; });
        if (failed) {
          err.textContent = failed.message || "Could not save.";
          err.hidden = false;
          return;
        }
        var data = results[0];
        targets.forEach(function (el) {
          el.dataset.allowAnyone = data.allow_noncontracted ? "1" : "0";
          el.dataset.allowCorps = data.allow_corps ? "1" : "0";
          el.dataset.allowIndependent = data.allow_independent ? "1" : "0";
        });
        closePerms();
      })
      .catch(function () {
        err.textContent = "Could not save.";
        err.hidden = false;
      })
      .finally(function () {
        if (saveBtn) saveBtn.disabled = false;
      });
  }

  var nameModal = document.getElementById("filesNameModal");
  var nameInput = document.getElementById("filesNameInput");
  var nameTitle = document.getElementById("filesNameTitle");
  var nameError = document.getElementById("filesNameError");
  var nameWarning = document.getElementById("filesNameWarning");
  var nameConfirm = document.getElementById("filesNameConfirm");
  var nameMode = null;
  var nameTarget = null;

  function openNameModal(opts) {
    if (!nameModal) return;
    nameMode = opts.mode;
    nameTarget = opts.target || null;
    nameTitle.textContent = opts.title || "Name";
    nameInput.value = opts.value || "";
    nameError.hidden = true;
    if (nameWarning) nameWarning.hidden = nameMode !== "create-folder";
    nameModal.hidden = false;
    document.body.style.overflow = "hidden";
    setTimeout(function () {
      nameInput.focus();
      nameInput.select();
    }, 30);
  }

  function closeNameModal() {
    if (!nameModal) return;
    nameModal.hidden = true;
    nameMode = null;
    nameTarget = null;
    document.body.style.overflow = "";
  }

  function submitNameModal() {
    var next = String(nameInput.value || "").trim();
    if (!next) {
      nameError.textContent = "Enter a name.";
      nameError.hidden = false;
      nameInput.focus();
      return;
    }
    if (nameMode === "create-folder") {
      var body = new URLSearchParams();
      body.set("name", next);
      nameConfirm.disabled = true;
      fetch("/files/folder/" + folderId + "/new-folder", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: body.toString(),
        credentials: "same-origin",
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (!data.ok) {
            nameError.textContent = data.message || "Could not create folder.";
            nameError.hidden = false;
            return;
          }
          window.location.reload();
        })
        .catch(function () {
          nameError.textContent = "Could not create folder.";
          nameError.hidden = false;
        })
        .finally(function () {
          nameConfirm.disabled = false;
        });
      return;
    }
    if (nameMode === "rename-file" && nameTarget) {
      function proceedRename(finalName, targetEl) {
        var item = targetEl || nameTarget;
        if (!item) return;
        if (finalName === item.dataset.name) {
          closeNameModal();
          return;
        }
        var renameBody = new URLSearchParams();
        renameBody.set("title", finalName);
        if (nameConfirm) nameConfirm.disabled = true;
        fetch("/files/item/" + item.dataset.id + "/rename", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          },
          body: renameBody.toString(),
          credentials: "same-origin",
        })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (!data.ok) {
              if (nameError) {
                nameError.textContent = data.message || "Rename failed.";
                nameError.hidden = false;
              }
              return;
            }
            item.dataset.name = data.title;
            var nameEl = item.querySelector(".files-drive-card__name");
            if (nameEl) nameEl.textContent = data.title;
            closeNameModal();
            captureItems();
            applySort();
          })
          .catch(function () {
            if (nameError) {
              nameError.textContent = "Rename failed.";
              nameError.hidden = false;
            }
          })
          .finally(function () {
            if (nameConfirm) nameConfirm.disabled = false;
          });
      }

      if (titleLooksLikeHasExtension(next)) {
        var cleaned = stripFileExtension(next);
        var targetEl = nameTarget;
        nameInput.value = cleaned;
        closeNameModal();
        if (window.bgAlert) {
          bgAlert("Changing the extension will NOT change the filetype.", function () {
            proceedRename(cleaned, targetEl);
          });
        } else {
          proceedRename(cleaned, targetEl);
        }
        return;
      }
      proceedRename(stripFileExtension(next), nameTarget);
    }
  }

  function renameFile(item) {
    openNameModal({
      mode: "rename-file",
      title: "Rename file",
      value: item.dataset.name || "",
      target: item,
    });
  }

  function deleteFile(item) {
    deleteFiles([item]);
  }

  function deleteFiles(items) {
    items = (items || []).filter(Boolean);
    if (!items.length) return;
    var label = items.length === 1
      ? ('"' + (items[0].dataset.name || "this file") + '"')
      : (items.length + " selected files");
    function go() {
      Promise.all(items.map(function (item) {
        return fetch("/files/item/" + item.dataset.id + "/delete", {
          method: "POST",
          headers: { Accept: "application/json" },
          credentials: "same-origin",
        }).then(function (r) { return r.json().then(function (data) { return { item: item, data: data }; }); });
      }))
        .then(function (results) {
          var failed = results.find(function (r) { return !r.data || !r.data.ok; });
          if (failed) {
            if (window.bgAlert) bgAlert((failed.data && failed.data.message) || "Delete failed.");
            return;
          }
          results.forEach(function (r) { r.item.remove(); });
          clearFileSelection();
          lastSelectedFile = null;
          captureItems();
          updateEmpty();
        });
    }
    if (window.bgConfirm) bgConfirm("Delete " + label + "?", go);
    else go();
  }

  function deleteFolder(item) {
    var name = item.dataset.name || "this folder";
    function go() {
      fetch("/files/folder/" + item.dataset.id + "/delete", {
        method: "POST",
        headers: { Accept: "application/json" },
        credentials: "same-origin",
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (!data.ok) {
            if (window.bgAlert) bgAlert(data.message || "Delete failed.");
            return;
          }
          item.remove();
          captureItems();
          updateEmpty();
        });
    }
    if (window.bgConfirm) {
      bgConfirm('Delete folder "' + name + '" and everything inside it?', go);
    } else {
      go();
    }
  }

  function createFolder() {
    if (!folderId || !canManage) return;
    openNameModal({
      mode: "create-folder",
      title: "Create folder",
      value: "",
    });
  }

  if (nameModal) {
    document.querySelectorAll("[data-close-name]").forEach(function (el) {
      el.addEventListener("click", closeNameModal);
    });
    if (nameConfirm) nameConfirm.addEventListener("click", submitNameModal);
    if (nameInput) {
      nameInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          submitNameModal();
        }
      });
    }
  }

  function downloadUrl(url, name) {
    var a = document.createElement("a");
    a.href = url;
    a.download = name || "";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // Init view/sort
  setView(localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid");
  if (sortEl) {
    sortEl.value = localStorage.getItem(SORT_KEY) || "az";
    sortEl.addEventListener("change", applySort);
  }
  viewBtns.forEach(function (btn) {
    btn.addEventListener("click", function () {
      setView(btn.dataset.view);
    });
  });

  captureItems();
  applySort();
  updateEmpty();

  if (searchEl) searchEl.addEventListener("input", onSearchInput);

  itemsEl.addEventListener("click", function (e) {
    var item = e.target.closest(".files-drive-item");
    if (!item || item.hidden) return;

    // Navigating into a folder always clears selection
    if (item.dataset.kind === "folder") {
      clearFileSelection();
      lastSelectedFile = null;
      return;
    }

    if (item.dataset.kind !== "file") return;

    // Members: click opens preview (no multi-select)
    if (!canManage) {
      e.preventDefault();
      openPreview(item);
      return;
    }

    e.preventDefault();
    var additive = e.ctrlKey || e.metaKey;

    if (e.shiftKey && lastSelectedFile && itemsEl.contains(lastSelectedFile) && !lastSelectedFile.hidden) {
      selectFileRange(lastSelectedFile, item);
      return;
    }

    if (additive) {
      item.classList.toggle("is-selected");
      lastSelectedFile = item;
      return;
    }

    clearFileSelection();
    item.classList.add("is-selected");
    lastSelectedFile = item;
  });

  // Staff open preview with double-click; members already open on single click
  itemsEl.addEventListener("dblclick", function (e) {
    if (!canManage) return;
    var item = e.target.closest(".files-drive-item");
    if (!item || item.hidden || item.dataset.kind !== "file") return;
    e.preventDefault();
    openPreview(item);
  });

  if (dropZone) {
    dropZone.addEventListener("click", function (e) {
      if (e.target.closest(".files-drive-item")) return;
      if (e.target.closest("#filesCtx")) return;
      clearFileSelection();
      lastSelectedFile = null;
    });
  }

  // Breadcrumb / other folder links also clear selection before navigation
  document.querySelectorAll(".files-drive__breadcrumb a, a.files-drive-item").forEach(function (link) {
    link.addEventListener("click", function () {
      clearFileSelection();
      lastSelectedFile = null;
    });
  });

  function prepareCtxHit(hit) {
    if (!hit) return null;
    if (hit.mode === "file" && canManage) {
      var selected = getSelectedFiles();
      if (selected.length > 1 && hit.target.classList.contains("is-selected")) {
        return { mode: "multi", target: hit.target, targets: selected };
      }
      if (!hit.target.classList.contains("is-selected")) {
        clearFileSelection();
        hit.target.classList.add("is-selected");
        lastSelectedFile = hit.target;
      }
    } else if (hit.mode === "empty") {
      clearFileSelection();
      lastSelectedFile = null;
    } else if (hit.mode === "folder") {
      clearFileSelection();
      lastSelectedFile = null;
    }
    return hit;
  }

  function resolveCtxFromPoint(x, y, fallbackEl) {
    var el = document.elementFromPoint(x, y) || fallbackEl;
    if (!el) return null;
    var item = el.closest && el.closest(".files-drive-item");
    if (item && itemsEl.contains(item) && !item.hidden) {
      if (item.dataset.kind === "file") return { mode: "file", target: item };
      if (item.dataset.kind === "folder" && canManage) return { mode: "folder", target: item };
      return null;
    }
    if (canManage && dropZone && (dropZone === el || dropZone.contains(el))) {
      return { mode: "empty", target: null };
    }
    return null;
  }

  document.addEventListener("contextmenu", function (e) {
    var hit = prepareCtxHit(resolveCtxFromPoint(e.clientX, e.clientY, e.target));
    if (!hit) return;
    e.preventDefault();
    showCtx(e.clientX, e.clientY, hit.mode, hit.target);
    if (hit.mode === "multi") ctx._multiTargets = hit.targets;
    else ctx._multiTargets = null;
  });

  // Mobile: press and hold for the same context menu
  var lpTimer = null;
  var lpTriggered = false;
  var lpStartX = 0;
  var lpStartY = 0;
  var suppressClickUntil = 0;

  function clearLongPress() {
    if (lpTimer) {
      clearTimeout(lpTimer);
      lpTimer = null;
    }
  }

  function onLongPressStart(e) {
    if (!e.touches || e.touches.length !== 1) return;
    var t = e.touches[0];
    lpStartX = t.clientX;
    lpStartY = t.clientY;
    lpTriggered = false;
    clearLongPress();
    lpTimer = setTimeout(function () {
      lpTimer = null;
      var hit = prepareCtxHit(resolveCtxFromPoint(lpStartX, lpStartY, e.target));
      if (!hit) return;
      lpTriggered = true;
      suppressClickUntil = Date.now() + 500;
      showCtx(lpStartX, lpStartY, hit.mode, hit.target);
      if (ctx) ctx._multiTargets = hit.mode === "multi" ? hit.targets : null;
      if (navigator.vibrate) {
        try { navigator.vibrate(12); } catch (err) {}
      }
    }, 480);
  }

  function onLongPressMove(e) {
    if (!lpTimer || !e.touches || !e.touches.length) return;
    var t = e.touches[0];
    if (Math.abs(t.clientX - lpStartX) > 12 || Math.abs(t.clientY - lpStartY) > 12) {
      clearLongPress();
    }
  }

  function onLongPressEnd(e) {
    clearLongPress();
    if (lpTriggered) {
      e.preventDefault();
      suppressClickUntil = Date.now() + 500;
    }
  }

  var lpTarget = dropZone || itemsEl;
  lpTarget.addEventListener("touchstart", onLongPressStart, { passive: true });
  lpTarget.addEventListener("touchmove", onLongPressMove, { passive: true });
  lpTarget.addEventListener("touchend", onLongPressEnd, { passive: false });
  lpTarget.addEventListener("touchcancel", clearLongPress, { passive: true });

  document.addEventListener("click", function (e) {
    if (Date.now() < suppressClickUntil) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (ctx && !ctx.hidden && ctx.contains(e.target)) return;
    hideCtx();
  }, true);

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      hideCtx();
      closePreview();
      closeUpload();
      closePerms();
      closeNameModal();
    }
  });

  var filePicker = document.createElement("input");
  filePicker.type = "file";
  filePicker.multiple = true;
  filePicker.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;";
  document.body.appendChild(filePicker);
  function pickUpload() {
    if (!canManage) return;
    filePicker.value = "";
    filePicker.click();
  }
  filePicker.addEventListener("change", function () {
    if (!filePicker.files || !filePicker.files.length) return;
    openUploadModal(Array.prototype.slice.call(filePicker.files));
  });

  if (ctx) {
    ctx.addEventListener("click", function (e) {
      e.stopPropagation();
      var btn = e.target.closest("[data-action]");
      if (!btn || btn.hidden) return;
      var action = btn.dataset.action;
      var target = ctxTarget;
      var mode = ctxMode;
      var multiTargets = ctx._multiTargets || null;
      hideCtx();
      if (action === "upload") return pickUpload();
      if (action === "create-folder") return createFolder();
      if (mode === "multi" && multiTargets && multiTargets.length) {
        if (action === "permissions") return openPerms(multiTargets);
        if (action === "delete") return deleteFiles(multiTargets);
        return;
      }
      if (!target) return;
      if (action === "download") return downloadUrl(target.dataset.url, target.dataset.name);
      if (action === "rename") return renameFile(target);
      if (action === "permissions") return openPerms(target);
      if (action === "delete") {
        if (mode === "folder") return deleteFolder(target);
        return deleteFile(target);
      }
    });
  }

  document.querySelectorAll("[data-close-preview]").forEach(function (el) {
    el.addEventListener("click", closePreview);
  });
  document.querySelectorAll("[data-close-upload]").forEach(function (el) {
    el.addEventListener("click", closeUpload);
  });
  document.querySelectorAll("[data-close-perms]").forEach(function (el) {
    el.addEventListener("click", closePerms);
  });

  var uploadConfirm = document.getElementById("filesUploadConfirm");
  if (uploadConfirm) uploadConfirm.addEventListener("click", doUpload);
  var permsSave = document.getElementById("filesPermsSave");
  if (permsSave) permsSave.addEventListener("click", savePerms);

  syncAnyoneExclusive("upAnyone", "upCorps", "upIndependent");
  syncAnyoneExclusive("permAnyone", "permCorps", "permIndependent");

  // Drag and drop upload (no instructional overlay - silent highlight only)
  if (canManage && dropZone) {
    var dragDepth = 0;
    function hasFiles(e) {
      var types = e.dataTransfer && e.dataTransfer.types;
      return types && (types.indexOf ? types.indexOf("Files") !== -1 : [].indexOf.call(types, "Files") !== -1);
    }
    dropZone.addEventListener("dragenter", function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth++;
      dropZone.classList.add("is-dragover");
    });
    dropZone.addEventListener("dragover", function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    });
    dropZone.addEventListener("dragleave", function (e) {
      if (!hasFiles(e)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) dropZone.classList.remove("is-dragover");
    });
    dropZone.addEventListener("drop", function (e) {
      e.preventDefault();
      dragDepth = 0;
      dropZone.classList.remove("is-dragover");
      var files = e.dataTransfer && e.dataTransfer.files;
      if (!files || !files.length) return;
      openUploadModal(files);
    });
  }
})();
