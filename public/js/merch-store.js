(function () {
  "use strict";

  var grid = document.getElementById("shopGrid");
  var nav = document.getElementById("shopCatNav");
  var select = document.getElementById("shopCatSelect");
  if (!grid) return;

  var cards = Array.prototype.slice.call(grid.querySelectorAll(".shop-card"));
  var active = "all";
  var animating = false;

  function setActiveButtons(cat) {
    if (!nav) return;
    nav.querySelectorAll(".shop-cat-btn").forEach(function (btn) {
      btn.classList.toggle("is-active", btn.dataset.category === cat);
    });
  }

  function applyFilter(cat) {
    cards.forEach(function (card) {
      var cardCat = String(card.dataset.category || "0");
      var show = cat === "all" || cardCat === String(cat);
      card.hidden = !show;
    });
  }

  function switchCategory(cat) {
    if (animating || cat === active) return;
    animating = true;
    active = cat;
    setActiveButtons(cat);
    if (select) select.value = cat;

    grid.classList.add("shop-grid--out");
    window.setTimeout(function () {
      applyFilter(cat);
    grid.classList.remove("shop-grid--out");
    grid.classList.add("shop-grid--in");
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        grid.classList.remove("shop-grid--in");
        animating = false;
      });
    });
    }, 280);
  }

  if (nav) {
    nav.addEventListener("click", function (e) {
      var btn = e.target.closest(".shop-cat-btn");
      if (!btn) return;
      switchCategory(btn.dataset.category);
    });
  }

  if (select) {
    select.addEventListener("change", function () {
      switchCategory(select.value);
    });
  }
})();
