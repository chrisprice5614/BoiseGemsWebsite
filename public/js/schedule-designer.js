/* Boise Gems - admin schedule designer v2 */
(function() {
  'use strict';

  var S = window.BGSchedule;
  if (!S) return;

  var GROUPS = [
    ['whole_corps', 'Whole Corps'],
    ['brass', 'Brass'],
    ['front_ensemble', 'Front Ensemble'],
    ['drumline', 'Drumline'],
    ['guard', 'Guard'],
  ];

  var state = {
    id: 0,
    date: '',
    aud_everyone: 1,
    aud_corps: 0,
    aud_independent: 0,
    times: [],
  };

  var scheduleId = window.SCH_DESIGNER_ID ? Number(window.SCH_DESIGNER_ID) : 0;
  var initialDate = window.SCH_INITIAL_DATE || S.todayYmd();
  var saving = false;

  var coordTarget = null;
  var coordMap = null;
  var coordMarker = null;

  function el(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
  }

  function blankEntry() {
    return {
      group: 'whole_corps',
      location_label: '',
      location_type: null,
      location_address: '',
      location_lat: null,
      location_lng: null,
      content: '',
    };
  }

  function blankTime() {
    return { time: '08:00', end_time: '', title: '', entries: [blankEntry()] };
  }

  function syncMetaFromForm() {
    state.date = el('schMetaDate').value;
    state.aud_everyone = el('schAudEveryone').checked ? 1 : 0;
    state.aud_corps = el('schAudCorps').checked ? 1 : 0;
    state.aud_independent = el('schAudIndependent').checked ? 1 : 0;
  }

  function syncMetaToForm() {
    el('schMetaDate').value = state.date || S.todayYmd();
    el('schAudEveryone').checked = !!state.aud_everyone;
    el('schAudCorps').checked = !!state.aud_corps;
    el('schAudIndependent').checked = !!state.aud_independent;
  }

  function setFlash(msg, err) {
    var box = el('schDesignerFlash');
    if (!box) return;
    box.textContent = msg;
    box.hidden = !msg;
    box.className = 'sch-designer-flash' + (err ? ' sch-designer-flash--err' : '');
  }

  function groupOptions(selected) {
    return GROUPS.map(function(g) {
      return '<option value="' + g[0] + '"' + (selected === g[0] ? ' selected' : '') + '>' + g[1] + '</option>';
    }).join('');
  }

  function renderEntryEditor(entry, ti, ei) {
    var locType = entry.location_type || '';
    return '<div class="sch-des-entry" data-ti="' + ti + '" data-ei="' + ei + '">' +
      '<div class="sch-des-entry-head">' +
        '<div class="sch-field sch-field--grow">' +
          '<span class="sch-field-label">Section</span>' +
          '<select class="sch-des-entry-group" data-ti="' + ti + '" data-ei="' + ei + '">' + groupOptions(entry.group) + '</select>' +
        '</div>' +
        '<button type="button" class="sch-des-remove-entry sch-btn-muted" data-ti="' + ti + '" data-ei="' + ei + '">Remove</button>' +
      '</div>' +
      '<label class="sch-field"><span class="sch-field-label">Location label</span><input type="text" class="sch-des-loc-label" data-ti="' + ti + '" data-ei="' + ei + '" value="' + esc(entry.location_label) + '" placeholder="e.g. Lot A, Warm-up area"></label>' +
      '<div class="sch-des-loc-type">' +
        '<label><input type="radio" name="locType_' + ti + '_' + ei + '" class="sch-des-loc-type-radio" data-ti="' + ti + '" data-ei="' + ei + '" value=""' + (!locType ? ' checked' : '') + '> No map link</label>' +
        '<label><input type="radio" name="locType_' + ti + '_' + ei + '" class="sch-des-loc-type-radio" data-ti="' + ti + '" data-ei="' + ei + '" value="address"' + (locType === 'address' ? ' checked' : '') + '> Address</label>' +
        '<label><input type="radio" name="locType_' + ti + '_' + ei + '" class="sch-des-loc-type-radio" data-ti="' + ti + '" data-ei="' + ei + '" value="coordinates"' + (locType === 'coordinates' ? ' checked' : '') + '> Coordinates</label>' +
      '</div>' +
      (locType === 'address'
        ? '<label class="sch-field"><span class="sch-field-label">Address</span><input type="text" class="sch-des-loc-address" data-ti="' + ti + '" data-ei="' + ei + '" value="' + esc(entry.location_address) + '" placeholder="123 Main St, Boise, ID"></label>'
        : '') +
      (locType === 'coordinates'
        ? '<div class="sch-des-coord-row">' +
            '<span class="sch-des-coord-readout">' +
              (entry.location_lat != null && entry.location_lng != null
                ? esc(entry.location_lat.toFixed(5) + ', ' + entry.location_lng.toFixed(5))
                : 'No coordinates set') +
            '</span>' +
            '<button type="button" class="sch-des-pick-coord" data-ti="' + ti + '" data-ei="' + ei + '">Pick on map</button>' +
          '</div>'
        : '') +
      '<label class="sch-field"><span class="sch-field-label">Content</span><textarea class="sch-des-entry-content" data-ti="' + ti + '" data-ei="' + ei + '" rows="3" placeholder="What happens for this section">' + esc(entry.content) + '</textarea></label>' +
    '</div>';
  }

  function renderTimeEditor(time, ti) {
    var entries = (time.entries || []).map(function(e, ei) { return renderEntryEditor(e, ti, ei); }).join('');
    return '<div class="sch-des-time sch-des-time-panel" data-ti="' + ti + '">' +
      '<div class="sch-des-time-head">' +
        '<div class="sch-field sch-field--time">' +
          '<span class="sch-field-label">Start</span>' +
          '<input type="time" class="sch-des-time-input" data-ti="' + ti + '" value="' + esc(time.time) + '">' +
        '</div>' +
        '<div class="sch-field sch-field--time">' +
          '<span class="sch-field-label">End <span style="font-weight:400;color:#888;">(optional)</span></span>' +
          '<input type="time" class="sch-des-end-time-input" data-ti="' + ti + '" value="' + esc(time.end_time || '') + '">' +
        '</div>' +
        '<div class="sch-field sch-field--grow">' +
          '<span class="sch-field-label">Title</span>' +
          '<input type="text" class="sch-des-time-title" data-ti="' + ti + '" value="' + esc(time.title) + '" placeholder="What happens at this time">' +
        '</div>' +
        '<button type="button" class="sch-des-remove-time sch-btn-muted" data-ti="' + ti + '">Remove</button>' +
      '</div>' +
      '<div class="sch-des-entries">' + entries +
        '<button type="button" class="sch-des-add-entry" data-ti="' + ti + '">+ Section</button>' +
      '</div>' +
    '</div>';
  }

  function renderDesigner() {
    var root = el('schDesignerTimes');
    if (!root) return;
    if (!state.times.length) {
      root.innerHTML = '<p class="sch-empty">No times yet. Add one below.</p>';
      updatePreview();
      return;
    }
    root.innerHTML = state.times.map(renderTimeEditor).join('');
    bindDesignerEvents();
    updatePreview();
  }

  function updatePreview() {
    var box = el('schPreview');
    if (!box || !S.renderScheduleViewer) return;
    S.renderScheduleViewer(box, previewPayload());
  }

  function bindField(elm, onUpdate) {
    if (!elm) return;
    var handler = function() { onUpdate(elm); updatePreview(); };
    elm.addEventListener('change', handler);
    if (elm.tagName === 'INPUT' && (elm.type === 'text' || elm.type === 'time') ||
        elm.tagName === 'TEXTAREA') {
      elm.addEventListener('input', handler);
    }
  }

  function bindDesignerEvents() {
    document.querySelectorAll('.sch-des-time-input').forEach(function(inp) {
      bindField(inp, function(node) { state.times[+node.dataset.ti].time = node.value; });
    });
    document.querySelectorAll('.sch-des-end-time-input').forEach(function(inp) {
      bindField(inp, function(node) { state.times[+node.dataset.ti].end_time = node.value; });
    });
    document.querySelectorAll('.sch-des-time-title').forEach(function(inp) {
      bindField(inp, function(node) { state.times[+node.dataset.ti].title = node.value; });
    });
    document.querySelectorAll('.sch-des-remove-time').forEach(function(btn) {
      btn.onclick = function() {
        bgConfirm('Remove this entire time slot?', function() {
          state.times.splice(+btn.dataset.ti, 1);
          renderDesigner();
        });
      };
    });
    document.querySelectorAll('.sch-des-add-entry').forEach(function(btn) {
      btn.onclick = function() {
        state.times[+btn.dataset.ti].entries.push(blankEntry());
        renderDesigner();
      };
    });
    document.querySelectorAll('.sch-des-remove-entry').forEach(function(btn) {
      btn.onclick = function() {
        var ti = +btn.dataset.ti;
        var ei = +btn.dataset.ei;
        state.times[ti].entries.splice(ei, 1);
        if (!state.times[ti].entries.length) state.times[ti].entries.push(blankEntry());
        renderDesigner();
      };
    });
    document.querySelectorAll('.sch-des-entry-group').forEach(function(sel) {
      bindField(sel, function(node) {
        state.times[+node.dataset.ti].entries[+node.dataset.ei].group = node.value;
      });
    });
    document.querySelectorAll('.sch-des-loc-label').forEach(function(inp) {
      bindField(inp, function(node) {
        state.times[+node.dataset.ti].entries[+node.dataset.ei].location_label = node.value;
      });
    });
    document.querySelectorAll('.sch-des-loc-type-radio').forEach(function(radio) {
      radio.onchange = function() {
        var entry = state.times[+radio.dataset.ti].entries[+radio.dataset.ei];
        var val = radio.value;
        entry.location_type = val || null;
        if (val !== 'address') entry.location_address = '';
        if (val !== 'coordinates') { entry.location_lat = null; entry.location_lng = null; }
        renderDesigner();
      };
    });
    document.querySelectorAll('.sch-des-loc-address').forEach(function(inp) {
      bindField(inp, function(node) {
        state.times[+node.dataset.ti].entries[+node.dataset.ei].location_address = node.value;
      });
    });
    document.querySelectorAll('.sch-des-entry-content').forEach(function(ta) {
      bindField(ta, function(node) {
        state.times[+node.dataset.ti].entries[+node.dataset.ei].content = node.value;
      });
    });
    document.querySelectorAll('.sch-des-pick-coord').forEach(function(btn) {
      btn.onclick = function() {
        openCoordPicker(+btn.dataset.ti, +btn.dataset.ei);
      };
    });
  }

  function initCoordMap(lat, lng) {
    if (!coordMap) {
      coordMap = L.map('schCoordMap').setView([lat, lng], 17);
      L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 19, attribution: 'Tiles &copy; Esri' }
      ).addTo(coordMap);
      L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 19, opacity: 0.7, attribution: '' }
      ).addTo(coordMap);
      coordMap.on('click', function(ev) {
        setCoordMarker(ev.latlng.lat, ev.latlng.lng);
      });
    } else {
      coordMap.invalidateSize();
      coordMap.setView([lat, lng], 17);
    }
    setCoordMarker(lat, lng);
  }

  function openCoordPicker(ti, ei) {
    coordTarget = { ti: ti, ei: ei };
    var entry = state.times[ti].entries[ei];
    var modal = el('schCoordModal');
    modal.hidden = false;
    var lat = entry.location_lat != null ? entry.location_lat : 43.615;
    var lng = entry.location_lng != null ? entry.location_lng : -116.2023;
    setTimeout(function() { initCoordMap(lat, lng); }, 80);
  }

  function setCoordMarker(lat, lng) {
    if (!coordMap) return;
    if (coordMarker) coordMap.removeLayer(coordMarker);
    coordMarker = L.marker([lat, lng]).addTo(coordMap);
    el('schCoordLabel').textContent = lat.toFixed(5) + ', ' + lng.toFixed(5);
    coordTarget.lat = lat;
    coordTarget.lng = lng;
  }

  function closeCoordPicker() {
    el('schCoordModal').hidden = true;
    coordTarget = null;
  }

  function payloadFromState() {
    syncMetaFromForm();
    return {
      id: state.id,
      date: state.date,
      aud_everyone: state.aud_everyone,
      aud_corps: state.aud_corps,
      aud_independent: state.aud_independent,
      times: state.times,
    };
  }

  function previewPayload() {
    var p = payloadFromState();
    p.times = (p.times || []).map(function(t) {
      return {
        time: t.time,
        end_time: t.end_time || '',
        title: t.title,
        entries: (t.entries || []).map(function(e) {
          return {
            group: e.group,
            group_label: (S.GROUP_LABELS && S.GROUP_LABELS[e.group]) || e.group,
            location_label: e.location_label,
            location_type: e.location_type,
            location_address: e.location_address,
            location_lat: e.location_lat,
            location_lng: e.location_lng,
            content: e.content,
          };
        }),
      };
    });
    return p;
  }

  function save() {
    if (saving) return;
    syncMetaFromForm();
    if (!state.date) { setFlash('Choose a date.', true); return; }
    if (!state.aud_everyone && !state.aud_corps && !state.aud_independent) {
      setFlash('Select at least one visibility option.', true);
      return;
    }
    saving = true;
    setFlash('Saving…');
    var body = payloadFromState();
    var url = body.id > 0 ? '/api/web/schedules/update' : '/api/web/schedules';
    fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        saving = false;
        if (!data.ok) throw new Error(data.message || 'Save failed');
        state.id = data.scheduleId || state.id;
        setFlash('Schedule saved.');
        if (!scheduleId && state.id) {
          history.replaceState(null, '', '/admin/schedules/designer/' + state.id);
          scheduleId = state.id;
        }
      })
      .catch(function(e) {
        saving = false;
        setFlash(e.message || 'Save failed', true);
      });
  }

  function loadSchedule() {
    if (!scheduleId) {
      var dateToLoad = initialDate || S.todayYmd();
      setFlash('Loading…');
      fetch('/api/web/schedules?date=' + encodeURIComponent(dateToLoad) + '&edit=1', { credentials: 'same-origin' })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.ok && data.schedules && data.schedules[0]) {
            applySchedule(data.schedules[0]);
            state.id = data.schedules[0].id;
            scheduleId = state.id;
            history.replaceState(null, '', '/admin/schedules/designer/' + state.id);
            setFlash('');
            return;
          }
          state.id = 0;
          state.date = dateToLoad;
          state.times = [];
          syncMetaToForm();
          renderDesigner();
          setFlash('');
        })
        .catch(function() {
          state.id = 0;
          state.date = dateToLoad;
          state.times = [];
          syncMetaToForm();
          renderDesigner();
          setFlash('');
        });
      return;
    }
    setFlash('Loading…');
    fetch('/api/web/schedules/' + scheduleId, { credentials: 'same-origin' })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (!data.ok) throw new Error(data.message || 'Load failed');
        applySchedule(data.schedule);
        setFlash('');
      })
      .catch(function(e) { setFlash(e.message || 'Load failed', true); });
  }

  function applySchedule(sch) {
    state.id = sch.id;
    state.date = sch.date;
    state.aud_everyone = sch.aud_everyone != null ? sch.aud_everyone : 1;
    state.aud_corps = sch.aud_corps || 0;
    state.aud_independent = sch.aud_independent || 0;
    state.times = (sch.times || []).map(function(t) {
      return Object.assign({}, t, { end_time: t.end_time || '' });
    });
    syncMetaToForm();
    renderDesigner();
  }

  function bindMetaPreview() {
    bindField(el('schMetaDate'), function(node) { state.date = node.value; });
    ['schAudEveryone', 'schAudCorps', 'schAudIndependent'].forEach(function(id) {
      var cb = el(id);
      if (!cb) return;
      cb.addEventListener('change', function() {
        syncMetaFromForm();
        updatePreview();
      });
    });
  }

  function init() {
    bindMetaPreview();
    el('schAddTime') && (el('schAddTime').onclick = function() {
      state.times.push(blankTime());
      renderDesigner();
    });
    el('schSaveBtn') && (el('schSaveBtn').onclick = save);
    el('schDeleteBtn') && scheduleId && (el('schDeleteBtn').onclick = function() {
      bgConfirm('Delete this schedule permanently?', function() {
        bgConfirm('Final confirmation: delete this schedule?', function() {
          fetch('/api/web/schedules/' + scheduleId, { method: 'DELETE', credentials: 'same-origin' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
              if (!data.ok) throw new Error(data.message);
              window.location.href = '/admin/schedules';
            })
            .catch(function(e) { setFlash(e.message, true); });
        });
      });
    });

    el('schCoordCancel') && (el('schCoordCancel').onclick = closeCoordPicker);
    el('schCoordUse') && (el('schCoordUse').onclick = function() {
      if (!coordTarget || coordTarget.lat == null) return;
      var entry = state.times[coordTarget.ti].entries[coordTarget.ei];
      entry.location_lat = coordTarget.lat;
      entry.location_lng = coordTarget.lng;
      entry.location_type = 'coordinates';
      closeCoordPicker();
      renderDesigner();
    });
    document.querySelector('#schCoordModal .sch-coord-modal__backdrop')?.addEventListener('click', closeCoordPicker);

    loadSchedule();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
