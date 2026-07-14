(function () {
  if (!document.querySelector('.pd-layout')) return;

  var _pdSkipHistory = false;

  function pdPortalUrl(sec) {
    var url = new URL(window.location.href);
    if (!sec || sec === 'overview') url.searchParams.delete('section');
    else url.searchParams.set('section', sec);
    return url.pathname + url.search;
  }

  function pdCurrentSection() {
    if (history.state && history.state.pdSection) return history.state.pdSection;
    var param = new URLSearchParams(window.location.search).get('section');
    return param || 'overview';
  }

  function pdFindNavBtn(sec) {
    return document.querySelector('.pd-nav-item[onclick*="' + sec + '"]');
  }

  function pdUpdateMobileBar(sec, btn) {
    var titleEl = document.getElementById('pdMobileTitle');
    if (titleEl && btn) titleEl.textContent = btn.dataset.label || sec;

    var navBtn = document.getElementById('pdMobileNavBtn');
    if (!navBtn) return;

    var onOverview = !sec || sec === 'overview';
    if (onOverview) {
      navBtn.innerHTML = '<ion-icon name="chevron-forward-circle"></ion-icon> Navigation';
      navBtn.setAttribute('aria-label', 'Open navigation');
    } else {
      navBtn.innerHTML = '<ion-icon name="arrow-back"></ion-icon> Back';
      navBtn.setAttribute('aria-label', 'Back to previous section');
    }
  }

  function pdShowInternal(btn, sec) {
    document.querySelectorAll('.pd-nav-item').forEach(function (b) {
      b.classList.remove('pd-active');
    });
    if (btn) btn.classList.add('pd-active');
    document.querySelectorAll('.pd-section').forEach(function (s) {
      s.classList.remove('pd-active');
    });
    var el = document.getElementById('pd-sec-' + sec);
    if (el) el.classList.add('pd-active');
    pdUpdateMobileBar(sec, btn);
    if (window.matchMedia('(max-width:760px)').matches) pdCloseSidebar();
    document.dispatchEvent(new CustomEvent('pd-section-shown', { detail: { section: sec } }));
  }

  window.pdShow = function (btn, sec, fromHistory) {
    if (!sec) sec = 'overview';
    if (!btn) btn = pdFindNavBtn(sec);
    pdShowInternal(btn, sec);
    if (_pdSkipHistory || fromHistory) return;
    history.pushState({ pdSection: sec }, '', pdPortalUrl(sec));
  };

  window.pdOpenSidebar = function () {
    document.getElementById('pdSidebar').classList.add('pd-open');
    document.getElementById('pdOverlay').classList.add('pd-open');
  };

  window.pdCloseSidebar = function () {
    document.getElementById('pdSidebar').classList.remove('pd-open');
    document.getElementById('pdOverlay').classList.remove('pd-open');
  };

  window.pdMobileBarAction = function () {
    var sec = pdCurrentSection();
    if (sec && sec !== 'overview') history.back();
    else pdOpenSidebar();
  };

  window.addEventListener('popstate', function (e) {
    var sec = (e.state && e.state.pdSection) || 'overview';
    _pdSkipHistory = true;
    pdShowInternal(pdFindNavBtn(sec), sec);
    _pdSkipHistory = false;
  });

  (function bootPortalSection() {
    var sec = new URLSearchParams(window.location.search).get('section') || 'overview';
    var btn = pdFindNavBtn(sec);
    if (btn) pdShowInternal(btn, sec);
    history.replaceState({ pdSection: sec }, '', pdPortalUrl(sec));
  })();
})();
