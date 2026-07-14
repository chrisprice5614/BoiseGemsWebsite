(function () {
  var MIN_COL_W = 175;
  var PHOTO_RATIO = 1.08;
  var V_SLANT_FRAC = 0.13;
  var H_SLANT_FRAC = 0.09;
  var SLANT_MIN = 10;
  /* Subpixel bleed so adjacent clips overlap and hide anti-alias gaps. */
  var CLIP_BLEED = 1.25;

  function seededRandom(seed) {
    var n = (Number(seed) || 1) >>> 0;
    return function () {
      n = (Math.imul(1664525, n) + 1013904223) >>> 0;
      return n / 4294967296;
    };
  }

  function sectionSeed(wall, tiles) {
    var s = 0;
    tiles.forEach(function (t) {
      s += Number(t.dataset.staffId) || 0;
    });
    var attr = wall.getAttribute("data-section-index");
    if (attr != null) s += Number(attr) * 7919;
    return s || 1;
  }

  function facetAngle(seed, tileIndex) {
    return Math.round(seededRandom(seed * 500 + tileIndex + 3)() * 360) + "deg";
  }

  function slantForBoundary(seed, index, cellSize, frac) {
    var r = seededRandom(seed * 1000 + index + 17);
    var mag = Math.max(SLANT_MIN, cellSize * frac);
    return Math.round((r() * 2 - 1) * mag);
  }

  /** Push quad corners outward from centroid — still 4 points, fills clip seams. */
  function expandPolygon(points, amount) {
    if (!amount) return points;
    var cx = 0;
    var cy = 0;
    points.forEach(function (p) {
      cx += p.x;
      cy += p.y;
    });
    cx /= points.length;
    cy /= points.length;
    return points.map(function (p) {
      var dx = p.x - cx;
      var dy = p.y - cy;
      var len = Math.hypot(dx, dy) || 1;
      return { x: p.x + (dx / len) * amount, y: p.y + (dy / len) * amount };
    });
  }

  /**
   * Shared vertex mesh: alternating parallelogram rows (left/right lean flips
   * each row) plus small per-vertex Y jitter so top/bottom edges slant too.
   */
  function buildVertexGrid(cols, rows, cellW, cellH, seed) {
    var grid = [];
    var vSlants = [];
    var hMag = Math.max(SLANT_MIN, cellH * H_SLANT_FRAC);

    for (var b = 0; b <= cols; b++) {
      if (b === 0 || b === cols) vSlants.push(0);
      else vSlants.push(slantForBoundary(seed, b, cellW, V_SLANT_FRAC));
    }

    for (var r = 0; r <= rows; r++) {
      grid[r] = [];
      for (var c = 0; c <= cols; c++) {
        var x = c * cellW + (r % 2 === 1 ? vSlants[c] : 0);
        var y = r * cellH;

        var onWall =
          r === 0 || r === rows || c === 0 || c === cols;

        if (!onWall) {
          var ry = seededRandom(seed + c * 419 + r * 733 + 5);
          y += (ry() * 2 - 1) * hMag;
        } else if (c > 0 && c < cols && (r === 0 || r === rows)) {
          var rx = seededRandom(seed + c * 131 + r * 919);
          y += (rx() * 2 - 1) * hMag * 0.65;
        } else if (r > 0 && r < rows && (c === 0 || c === cols)) {
          var rz = seededRandom(seed + c * 211 + r * 811);
          y += (rz() * 2 - 1) * hMag * 0.65;
        }

        grid[r][c] = { x: x, y: y };
      }
    }
    return grid;
  }

  function toClip(points, box) {
    var w = box.w || 1;
    var h = box.h || 1;
    return (
      "polygon(" +
      points
        .map(function (p) {
          return (
            (((p.x - box.x) / w) * 100).toFixed(2) +
            "% " +
            (((p.y - box.y) / h) * 100).toFixed(2) +
            "%"
          );
        })
        .join(", ") +
      ")"
    );
  }

  function layoutWall(wall) {
    var tiles = wall.querySelectorAll(".staff-gem-tile");
    if (!tiles.length) return;

    var W = wall.clientWidth;
    if (W < 40) return;

    var seed = sectionSeed(wall, tiles);
    var cols = Math.max(1, Math.floor(W / MIN_COL_W));
    var cellW = W / cols;
    var cellH = cellW * PHOTO_RATIO;
    var rows = Math.ceil(tiles.length / cols);
    var wallH = rows * cellH;

    var grid = buildVertexGrid(cols, rows, cellW, cellH, seed);

    wall.style.position = "relative";
    wall.style.height = wallH + "px";
    wall.style.minHeight = wallH + "px";

    tiles.forEach(function (tile, i) {
      var col = i % cols;
      var row = Math.floor(i / cols);

      var TL = grid[row][col];
      var TR = grid[row][col + 1];
      var BR = grid[row + 1][col + 1];
      var BL = grid[row + 1][col];
      var pts = [TL, TR, BR, BL];
      var clipPts = expandPolygon(pts, CLIP_BLEED);

      var minX = Math.min(clipPts[0].x, clipPts[1].x, clipPts[2].x, clipPts[3].x);
      var maxX = Math.max(clipPts[0].x, clipPts[1].x, clipPts[2].x, clipPts[3].x);
      var minY = Math.min(clipPts[0].y, clipPts[1].y, clipPts[2].y, clipPts[3].y);
      var maxY = Math.max(clipPts[0].y, clipPts[1].y, clipPts[2].y, clipPts[3].y);
      var box = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };

      var gem = tile.querySelector(".staff-gem-tile__gem");
      if (gem) {
        gem.style.clipPath = toClip(clipPts, box);
        gem.style.webkitClipPath = gem.style.clipPath;
      }

      tile.style.position = "absolute";
      tile.style.left = minX + "px";
      tile.style.top = minY + "px";
      tile.style.width = box.w + "px";
      tile.style.height = box.h + "px";
      tile.style.margin = "0";
      tile.style.clipPath = "none";
      tile.style.transform = "none";
      tile.style.setProperty("--facet-a", facetAngle(seed, i));
      tile.style.setProperty("--facet-b", facetAngle(seed, i + 997));
      tile.style.zIndex = String(row * cols + col + 1);
    });
  }

  function layoutAll() {
    document.querySelectorAll(".staff-gem-wall[data-staff-section]").forEach(layoutWall);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", layoutAll);
  } else {
    layoutAll();
  }

  if (typeof ResizeObserver !== "undefined") {
    var ro = new ResizeObserver(layoutAll);
    document.querySelectorAll(".staff-gem-wall[data-staff-section]").forEach(function (el) {
      ro.observe(el);
    });
  } else {
    window.addEventListener("resize", layoutAll);
  }

  document.querySelectorAll(".staff-gem-tile__img").forEach(function (img) {
    if (img.style.backgroundImage) {
      var probe = new Image();
      probe.onload = probe.onerror = layoutAll;
      probe.src = img.style.backgroundImage.replace(/^url\(["']?|["']?\)$/g, "");
    }
  });
})();
