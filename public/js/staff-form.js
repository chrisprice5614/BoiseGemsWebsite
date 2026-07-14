(function () {
  'use strict';

  var categories = window.STAFF_CATEGORIES || [];
  var listEl = document.getElementById('staffPlacementsList');
  var addBtn = document.getElementById('staffAddPlacement');
  var photoInput = document.getElementById('staffPhotoInput');
  var photoPreview = document.getElementById('staffPhotoPreview');
  var form = document.getElementById('staffForm');
  if (!listEl || !addBtn) return;

  function categoryOptions(selectedId) {
    return categories.map(function (c) {
      return '<option value="' + c.id + '"' + (Number(selectedId) === Number(c.id) ? ' selected' : '') + '>' +
        String(c.name).replace(/</g, '&lt;') + '</option>';
    }).join('');
  }

  function addRow(data) {
    data = data || {};
    var idx = listEl.children.length;
    var row = document.createElement('div');
    row.className = 'staff-placement-row';
    row.innerHTML =
      '<label class="staff-field staff-field--grow">' +
        '<span class="staff-field-label">Category</span>' +
        '<select name="placements[' + idx + '][category_id]" required>' +
          '<option value="">Choose category…</option>' +
          categoryOptions(data.category_id) +
        '</select>' +
      '</label>' +
      '<label class="staff-field staff-field--grow">' +
        '<span class="staff-field-label">Position title</span>' +
        '<input type="text" name="placements[' + idx + '][position_title]" value="' +
          String(data.position_title || '').replace(/"/g, '&quot;') +
          '" placeholder="e.g. Founder/CEO" required>' +
      '</label>' +
      '<button type="button" class="staff-placement-remove" title="Remove">&times;</button>';
    row.querySelector('.staff-placement-remove').addEventListener('click', function () {
      row.remove();
      reindexRows();
    });
    listEl.appendChild(row);
  }

  function reindexRows() {
    Array.from(listEl.children).forEach(function (row, idx) {
      var sel = row.querySelector('select');
      var inp = row.querySelector('input[type="text"]');
      if (sel) sel.name = 'placements[' + idx + '][category_id]';
      if (inp) inp.name = 'placements[' + idx + '][position_title]';
    });
  }

  addBtn.addEventListener('click', function () { addRow({}); });

  var initial = window.STAFF_INITIAL_PLACEMENTS || [];
  if (initial.length) initial.forEach(addRow);
  else addRow({});

  if (photoInput && photoPreview) {
    photoInput.addEventListener('change', function () {
      var file = photoInput.files && photoInput.files[0];
      if (!file) return;
      photoPreview.src = URL.createObjectURL(file);
    });
    photoPreview.closest('label').addEventListener('click', function () {
      photoInput.click();
    });
  }

  if (form) {
    form.addEventListener('submit', function (e) {
      if (!listEl.querySelector('select')) {
        e.preventDefault();
        if (window.bgAlert) bgAlert('Add at least one category with a position title.');
      }
    });
  }

  var phoneInput = document.getElementById('staffPhoneInput');
  if (phoneInput && window.StaffPhone) {
    window.StaffPhone.attachUSPhoneInput(phoneInput);
  }
})();
