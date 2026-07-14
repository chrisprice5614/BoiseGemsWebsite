(function () {
  "use strict";
  var carousel = document.getElementById("merchFeaturedCarousel");
  if (!carousel) return;
  var slides = carousel.querySelectorAll(".merch-carousel__slide");
  var dots = carousel.querySelectorAll(".merch-carousel__dot");
  if (slides.length < 2) return;

  var index = 0;
  var timer;

  function show(i) {
    index = (i + slides.length) % slides.length;
    slides.forEach(function (s, n) {
      s.classList.toggle("is-active", n === index);
    });
    dots.forEach(function (d, n) {
      d.classList.toggle("is-active", n === index);
    });
  }

  function next() {
    show(index + 1);
  }

  function start() {
    clearInterval(timer);
    timer = setInterval(next, 5000);
  }

  dots.forEach(function (dot) {
    dot.addEventListener("click", function () {
      show(Number(dot.dataset.index));
      start();
    });
  });

  carousel.addEventListener("mouseenter", function () {
    clearInterval(timer);
  });
  carousel.addEventListener("mouseleave", start);

  start();
})();
