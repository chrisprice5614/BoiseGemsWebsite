(function () {
  "use strict";

  var root = document.querySelector(".join-corps-experience");
  if (!root) return;

  var bgEl = root.querySelector(".join-corps-experience__bg");
  var gridCanvas = document.getElementById("joinCorpsGrid");
  var topoCanvas = document.getElementById("joinCorpsTopo");
  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var topoOpacity = parseFloat(
    getComputedStyle(root).getPropertyValue("--jc-topo-opacity") ||
      root.dataset.topoOpacity
  );
  if (!isFinite(topoOpacity)) topoOpacity = 0.12;

  var GRID_ALPHA = 0.03;

  /* Brand palette - scroll cycles purple → red → green → purple → red */
  var PALETTE = [
    { r: 96, g: 67, b: 125 },
    { r: 193, g: 39, b: 45 },
    { r: 45, g: 138, b: 78 },
    { r: 96, g: 67, b: 125 },
    { r: 193, g: 39, b: 45 },
  ];

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function lerpColor(c0, c1, t) {
    return {
      r: Math.round(lerp(c0.r, c1.r, t)),
      g: Math.round(lerp(c0.g, c1.g, t)),
      b: Math.round(lerp(c0.b, c1.b, t)),
    };
  }

  function colorAtProgress(p) {
    var n = PALETTE.length - 1;
    var f = p * n;
    var i = Math.min(Math.floor(f), n - 1);
    return lerpColor(PALETTE[i], PALETTE[i + 1], f - i);
  }

  function rgbStr(c) {
    return "rgb(" + c.r + "," + c.g + "," + c.b + ")";
  }

  function shiftColor(c, dr, dg, db) {
    return {
      r: Math.max(0, Math.min(255, c.r + dr)),
      g: Math.max(0, Math.min(255, c.g + dg)),
      b: Math.max(0, Math.min(255, c.b + db)),
    };
  }

  var scrollColor = PALETTE[0];
  var lavaT = 0;

  function scrollProgress() {
    var max = document.documentElement.scrollHeight - window.innerHeight;
    if (max <= 0) return 0;
    return Math.max(0, Math.min(1, window.scrollY / max));
  }

  function updateScrollBackground() {
    scrollColor = colorAtProgress(scrollProgress());
    var base = rgbStr(scrollColor);
    root.style.setProperty("--jc-bg-color", base);
    if (bgEl) bgEl.style.backgroundColor = base;
  }

  /* ── Lava lamp blobs (subtle shifts on solid scroll color) ── */
  var lavaEl = document.createElement("div");
  lavaEl.className = "join-corps-experience__lava";
  lavaEl.setAttribute("aria-hidden", "true");
  var blobs = [
    { ox: 0.22, oy: 0.28, r: 0.42, phase: 0, tint: [28, 12, 36] },
    { ox: 0.72, oy: 0.55, r: 0.38, phase: 2.1, tint: [-18, 22, -8] },
    { ox: 0.48, oy: 0.78, r: 0.34, phase: 4.3, tint: [14, -10, 24] },
  ];
  blobs.forEach(function (_, i) {
    var b = document.createElement("span");
    b.className = "join-corps-experience__lava-blob";
    lavaEl.appendChild(b);
    blobs[i].el = b;
  });
  if (bgEl && bgEl.parentNode) {
    bgEl.parentNode.insertBefore(lavaEl, bgEl.nextSibling);
  }

  function updateLava(dt) {
    if (reducedMotion) return;
    lavaT += dt * 0.00025;
    var w = window.innerWidth;
    var h = window.innerHeight;
    blobs.forEach(function (blob) {
      var t = lavaT + blob.phase;
      var cx = blob.ox * w + Math.sin(t * 1.1) * w * 0.09 + Math.cos(t * 0.67) * w * 0.05;
      var cy = blob.oy * h + Math.cos(t * 0.95) * h * 0.08 + Math.sin(t * 0.53) * h * 0.06;
      var size = Math.min(w, h) * blob.r;
      var c = shiftColor(scrollColor, blob.tint[0], blob.tint[1], blob.tint[2]);
      blob.el.style.width = size + "px";
      blob.el.style.height = size + "px";
      blob.el.style.left = cx - size * 0.5 + "px";
      blob.el.style.top = cy - size * 0.5 + "px";
      blob.el.style.background = "rgba(" + c.r + "," + c.g + "," + c.b + ",0.55)";
    });
  }

  window.addEventListener("scroll", updateScrollBackground, { passive: true });
  window.addEventListener("resize", updateScrollBackground, { passive: true });
  updateScrollBackground();

  /* ── Crystal fractured grid (fixed opacity) ── */
  var gridState = { segs: [], dpr: 1 };

  function seededRandom(seed) {
    var n = (seed || 1) >>> 0;
    return function () {
      n = (Math.imul(1664525, n) + 1013904223) >>> 0;
      return n / 4294967296;
    };
  }

  function buildGrid() {
    if (!gridCanvas) return;
    var w = window.innerWidth;
    var h = window.innerHeight;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    gridCanvas.width = Math.floor(w * dpr);
    gridCanvas.height = Math.floor(h * dpr);
    gridCanvas.style.width = w + "px";
    gridCanvas.style.height = h + "px";

    var cell = Math.max(72, Math.min(140, w / 14));
    var cols = Math.ceil(w / cell) + 1;
    var rows = Math.ceil(h / cell) + 1;
    var rand = seededRandom(2027);
    var verts = [];

    for (var r = 0; r <= rows; r++) {
      verts[r] = [];
      for (var c = 0; c <= cols; c++) {
        var x = c * cell;
        var y = r * cell;
        if (c > 0 && c < cols && r > 0 && r < rows) {
          x += (rand() * 2 - 1) * cell * 0.22;
          y += (rand() * 2 - 1) * cell * 0.22;
        }
        verts[r][c] = { x: x, y: y };
      }
    }

    var segs = [];
    for (var ri = 0; ri < rows; ri++) {
      for (var ci = 0; ci < cols; ci++) {
        segs.push(
          [verts[ri][ci], verts[ri][ci + 1]],
          [verts[ri][ci + 1], verts[ri + 1][ci + 1]],
          [verts[ri + 1][ci + 1], verts[ri + 1][ci]],
          [verts[ri + 1][ci], verts[ri][ci]]
        );
      }
    }
    gridState.segs = segs;
    gridState.dpr = dpr;
  }

  function drawGrid() {
    if (!gridCanvas) return;
    var ctx = gridCanvas.getContext("2d");
    var dpr = gridState.dpr || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, gridCanvas.width / dpr, gridCanvas.height / dpr);
    ctx.strokeStyle = "rgba(255,255,255," + GRID_ALPHA + ")";
    ctx.lineWidth = 1;
    ctx.beginPath();
    gridState.segs.forEach(function (seg) {
      ctx.moveTo(seg[0].x, seg[0].y);
      ctx.lineTo(seg[1].x, seg[1].y);
    });
    ctx.stroke();
  }

  /* ── Topographic contour lines ── */
  var topo = {
    lines: [],
    pointer: { x: -9999, y: -9999, active: false },
    time: 0,
  };

  function fbm(a, z) {
    return (
      Math.sin(a * 3 + z * 0.7) * 0.55 +
      Math.sin(a * 7 - z * 1.3) * 0.28 +
      Math.cos(a * 11 + z * 0.4) * 0.17
    );
  }

  function buildTopo() {
    if (!topoCanvas) return;
    var w = window.innerWidth;
    var h = window.innerHeight;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    topoCanvas.width = Math.floor(w * dpr);
    topoCanvas.height = Math.floor(h * dpr);
    topoCanvas.style.width = w + "px";
    topoCanvas.style.height = h + "px";
    topo.dpr = dpr;

    var cx = w * 0.5;
    var cy = h * 0.48;
    var maxR = Math.hypot(w, h) * 0.65;
    var levels = 24;
    var ptsPer = Math.max(72, Math.floor(w / 12));
    topo.lines = [];

    for (var li = 0; li < levels; li++) {
      var t = li / (levels - 1);
      var baseR = maxR * (0.1 + t * 0.9);
      var wobble = 22 + t * 48;
      var oz = li * 1.37;
      var ox = cx + Math.sin(li * 0.9) * 50;
      var oy = cy + Math.cos(li * 1.1) * 45;
      var pts = [];
      for (var i = 0; i < ptsPer; i++) {
        var a = (i / ptsPer) * Math.PI * 2;
        var r = baseR + fbm(a, oz) * wobble;
        var bx = ox + Math.cos(a) * r;
        var by = oy + Math.sin(a) * r;
        pts.push({
          bx: bx,
          by: by,
          x: bx,
          y: by,
          vx: 0,
          vy: 0,
          phase: a + li * 0.7,
        });
      }
      topo.lines.push(pts);
    }
  }

  function updateTopo(dt) {
    topo.time += dt;
    var repelR = 160;
    var repelForce = 95;
    var px = topo.pointer.x;
    var py = topo.pointer.y;
    var active = topo.pointer.active;
    var driftAmt = reducedMotion ? 0 : 1;

    topo.lines.forEach(function (line, li) {
      line.forEach(function (p) {
        var driftX =
          Math.sin(topo.time * 0.00022 + p.phase) * 5.5 * driftAmt +
          Math.sin(topo.time * 0.00011 + p.phase * 2.1) * 2.8 * driftAmt;
        var driftY =
          Math.cos(topo.time * 0.00019 + p.phase * 1.2) * 5.5 * driftAmt +
          Math.cos(topo.time * 0.00013 + li * 0.4) * 2.8 * driftAmt;

        var targetX = p.bx + driftX;
        var targetY = p.by + driftY;

        if (active) {
          var distX = p.x - px;
          var distY = p.y - py;
          var dist = Math.hypot(distX, distY) || 1;
          if (dist < repelR) {
            var push = Math.pow((repelR - dist) / repelR, 1.6) * repelForce;
            p.vx += (distX / dist) * push * 0.14;
            p.vy += (distY / dist) * push * 0.14;
          }
        }

        p.vx += (targetX - p.x) * 0.045;
        p.vy += (targetY - p.y) * 0.045;
        p.vx *= 0.86;
        p.vy *= 0.86;
        p.x += p.vx;
        p.y += p.vy;
      });
    });
  }

  function drawSmoothLoop(ctx, line) {
    var n = line.length;
    if (n < 3) return;
    ctx.beginPath();
    var p0 = line[0];
    var pLast = line[n - 1];
    ctx.moveTo((p0.x + pLast.x) * 0.5, (p0.y + pLast.y) * 0.5);
    for (var i = 0; i < n; i++) {
      var p = line[i];
      var next = line[(i + 1) % n];
      var mx = (p.x + next.x) * 0.5;
      var my = (p.y + next.y) * 0.5;
      ctx.quadraticCurveTo(p.x, p.y, mx, my);
    }
    ctx.closePath();
    ctx.stroke();
  }

  function drawTopo() {
    if (!topoCanvas) return;
    var ctx = topoCanvas.getContext("2d");
    var dpr = topo.dpr || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, topoCanvas.width / dpr, topoCanvas.height / dpr);
    ctx.strokeStyle = "rgba(0,0,0," + topoOpacity + ")";
    ctx.lineWidth = 1.15;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    topo.lines.forEach(function (line) {
      drawSmoothLoop(ctx, line);
    });
  }

  function onPointer(x, y, on) {
    topo.pointer.x = x;
    topo.pointer.y = y;
    topo.pointer.active = on;
  }

  window.addEventListener("mousemove", function (e) {
    onPointer(e.clientX, e.clientY, true);
  }, { passive: true });
  window.addEventListener("mouseleave", function () {
    topo.pointer.active = false;
  }, { passive: true });
  window.addEventListener("touchstart", function (e) {
    var t = e.touches[0];
    if (t) onPointer(t.clientX, t.clientY, true);
  }, { passive: true });
  window.addEventListener("touchmove", function (e) {
    var t = e.touches[0];
    if (t) onPointer(t.clientX, t.clientY, true);
  }, { passive: true });
  window.addEventListener("touchend", function () {
    topo.pointer.active = false;
  }, { passive: true });

  var lastFrame = performance.now();
  function frame(now) {
    var dt = now - lastFrame;
    lastFrame = now;
    updateLava(dt);
    drawGrid();
    updateTopo(dt);
    drawTopo();
    requestAnimationFrame(frame);
  }

  buildGrid();
  buildTopo();
  window.addEventListener("resize", function () {
    buildGrid();
    buildTopo();
    updateScrollBackground();
  });
  requestAnimationFrame(frame);

  var title = root.querySelector(".join-corps-hero__title");
  var heroCta = root.querySelector(".join-corps-cta--hero");
  if (title) {
    requestAnimationFrame(function () {
      title.classList.add("is-visible");
    });
  }
  if (heroCta) {
    setTimeout(function () {
      heroCta.classList.add("is-visible");
    }, 1400);
  }

  var blocks = root.querySelectorAll(".join-corps-body > *");
  if (blocks.length && "IntersectionObserver" in window) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) {
            en.target.classList.add("is-visible");
            io.unobserve(en.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    blocks.forEach(function (el) {
      io.observe(el);
    });
  } else {
    blocks.forEach(function (el) {
      el.classList.add("is-visible");
    });
  }
})();
