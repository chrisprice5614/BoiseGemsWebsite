/* Boise Gems - schedule viewer v2 (time accordion) */
(function(global) {
  'use strict';

  var GROUP_LABELS = {
    whole_corps: 'Whole Corps',
    brass: 'Brass',
    front_ensemble: 'Front Ensemble',
    drumline: 'Drumline',
    guard: 'Guard',
  };

  function pad2(n) { return String(n).padStart(2, '0'); }

  function timeToMinutes(hhmm) {
    if (!hhmm) return null;
    var m = String(hhmm).match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
  }

  function formatTime12(hhmm) {
    var mins = timeToMinutes(hhmm);
    if (mins == null) return hhmm || '';
    var h = Math.floor(mins / 60) % 24;
    var m = mins % 60;
    var ampm = h >= 12 ? 'PM' : 'AM';
    var h12 = h % 12 || 12;
    return h12 + ':' + pad2(m) + ' ' + ampm;
  }

  function formatScheduleDate(ymd) {
    if (!ymd) return '';
    var parts = ymd.split('-');
    if (parts.length !== 3) return ymd;
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }

  function escapeHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function formatTimeSlotLabel(timeSlot) {
    var timeStr = formatTime12(timeSlot.time);
    var endStr = timeSlot.end_time ? formatTime12(timeSlot.end_time) : '';
    if (endStr) timeStr = timeStr + ' - ' + endStr;
    var title = String(timeSlot.title || '').trim();
    if (!title) return timeStr;
    return timeStr + ' - ' + title;
  }

  function mapsHref(entry) {
    if (!entry) return null;
    if (entry.location_type === 'address' && entry.location_address) {
      return 'https://maps.google.com/?q=' + encodeURIComponent(entry.location_address);
    }
    if (entry.location_type === 'coordinates' && entry.location_lat != null && entry.location_lng != null) {
      return 'https://maps.google.com/?q=' + entry.location_lat + ',' + entry.location_lng;
    }
    return null;
  }

  function renderEntry(entry) {
    var label = entry.group_label || GROUP_LABELS[entry.group] || entry.group || '';
    var href = mapsHref(entry);
    var locHtml = '';
    if (entry.location_label) {
      locHtml = href
        ? '<a class="sch-loc-link" href="' + escapeHtml(href) + '" target="_blank" rel="noopener">' + escapeHtml(entry.location_label) + '</a>'
        : '<span class="sch-loc-text">' + escapeHtml(entry.location_label) + '</span>';
    }
    return '<div class="sch-entry">' +
      '<div class="sch-entry-group">' + escapeHtml(label) + '</div>' +
      (locHtml ? '<div class="sch-entry-loc">' + locHtml + '</div>' : '') +
      (entry.content ? '<div class="sch-entry-content">' + escapeHtml(entry.content) + '</div>' : '') +
    '</div>';
  }

  function renderTimeSlot(timeSlot, index) {
    var entries = (timeSlot.entries || []).map(renderEntry).join('');
    if (!entries) entries = '<div class="sch-empty">Nothing scheduled for your section at this time.</div>';
    return '<div class="sch-time" data-sch-time="' + index + '">' +
      '<button type="button" class="sch-time-btn" aria-expanded="false" data-sch-toggle="' + index + '">' +
        '<span class="sch-time-label">' + escapeHtml(formatTimeSlotLabel(timeSlot)) + '</span>' +
        '<ion-icon name="chevron-down" class="sch-time-chevron"></ion-icon>' +
      '</button>' +
      '<div class="sch-time-panel" hidden>' +
        '<div class="sch-time-panel-inner">' +
          entries +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function bindAccordion(root) {
    if (!root) return;
    root.querySelectorAll('[data-sch-toggle]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var wrap = btn.closest('.sch-time');
        var panel = wrap && wrap.querySelector('.sch-time-panel');
        if (!panel) return;
        var open = btn.getAttribute('aria-expanded') === 'true';
        open = !open;
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        wrap.classList.toggle('sch-time--open', open);
        if (open) {
          panel.hidden = false;
          requestAnimationFrame(function() { panel.classList.add('sch-time-panel--open'); });
        } else {
          panel.classList.remove('sch-time-panel--open');
          panel.addEventListener('transitionend', function onEnd(ev) {
            if (ev.propertyName !== 'max-height') return;
            if (!wrap.classList.contains('sch-time--open')) panel.hidden = true;
            panel.removeEventListener('transitionend', onEnd);
          });
        }
      });
    });
  }

  function renderScheduleViewer(container, schedule, opts) {
    opts = opts || {};
    if (!container) return;
    if (!schedule) {
      container.innerHTML = '<div class="sch-empty-day">No schedule published for this day.</div>';
      return;
    }
    var header = opts.hideHeader ? '' : (
      '<div class="sch-day-header">' +
        '<h2 class="sch-day-title">' + escapeHtml(formatScheduleDate(schedule.date)) + '</h2>' +
      '</div>'
    );
    var times = (schedule.times || []).map(renderTimeSlot).join('');
    if (!times) times = '<div class="sch-empty-day">Schedule has no times yet.</div>';
    container.innerHTML = header + '<div class="sch-times">' + times + '</div>';
    bindAccordion(container);
  }

  function todayYmd() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function initSchedulePanel(opts) {
    var dateInput = document.getElementById(opts.dateInputId || 'schDateInput');
    var viewer = document.getElementById(opts.viewerId || 'schViewer');
    var status = document.getElementById(opts.statusId || 'schStatus');
    if (!dateInput || !viewer) return;

    dateInput.value = opts.initialDate || todayYmd();

    function setStatus(msg, isErr) {
      if (!status) return;
      status.textContent = msg || '';
      status.className = 'sch-status' + (isErr ? ' sch-status--err' : '');
    }

    function load() {
      var date = dateInput.value;
      if (!date) return;
      setStatus('Loading…');
      viewer.innerHTML = '<div class="sch-loading">Loading schedule…</div>';
      fetch('/api/web/schedules?date=' + encodeURIComponent(date), { credentials: 'same-origin' })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (!data.ok) throw new Error(data.message || 'Failed to load');
          var schedule = (data.schedules && data.schedules[0]) || null;
          renderScheduleViewer(viewer, schedule);
          setStatus(schedule ? '' : 'No schedule for ' + formatScheduleDate(date));
        })
        .catch(function(e) {
          viewer.innerHTML = '';
          setStatus(e.message || 'Could not load schedule', true);
        });
    }

    dateInput.addEventListener('change', load);
    if (opts.loadOnShow) {
      document.addEventListener('pd-section-shown', function(ev) {
        if (ev.detail && ev.detail.section === opts.sectionId) load();
      });
    }
    load();
  }

  function initScheduleTodayOverview(opts) {
    var wrap = document.getElementById(opts.wrapId || 'schTodayOverview');
    var viewer = document.getElementById(opts.viewerId || 'schTodayViewer');
    if (!wrap || !viewer) return;

    var today = todayYmd();
    fetch('/api/web/schedules?date=' + encodeURIComponent(today), { credentials: 'same-origin' })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (!data.ok) { wrap.hidden = true; return; }
        var schedule = (data.schedules && data.schedules[0]) || null;
        if (!schedule) {
          wrap.hidden = true;
          return;
        }
        wrap.hidden = false;
        renderScheduleViewer(viewer, schedule, { hideHeader: true });
      })
      .catch(function() { wrap.hidden = true; });
  }

  global.BGSchedule = {
    GROUP_LABELS: GROUP_LABELS,
    formatTime12: formatTime12,
    formatTimeSlotLabel: formatTimeSlotLabel,
    formatScheduleDate: formatScheduleDate,
    timeToMinutes: timeToMinutes,
    mapsHref: mapsHref,
    renderScheduleViewer: renderScheduleViewer,
    initSchedulePanel: initSchedulePanel,
    initScheduleTodayOverview: initScheduleTodayOverview,
    todayYmd: todayYmd,
  };
})(window);
