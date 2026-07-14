/**
 * Generates public/img/ui/crystal-voronoi.png
 * Run: node scripts/generate-crystal-voronoi.js
 */
const path = require('path');
const sharp = require('sharp');

const WIDTH = 4096;
const HEIGHT = 5120;
const OUT = path.join(__dirname, '..', 'public', 'img', 'ui', 'crystal-voronoi.png');
const SEED = 0x6a09e667;

const PURPLES = [
  [168, 138, 198], [190, 162, 220], [145, 118, 178],
  [205, 178, 232], [128, 98, 162], [178, 148, 210],
  [155, 125, 188], [198, 170, 225]
];

const TARGET_SITES = Math.floor((WIDTH * HEIGHT) / 120000);
const MIN_SITE_DIST = 92;
const EDGE_RADIUS = 6;
const EDGE_AA = 1.5;
const MAX_DARK_FRACTION = 0.045;
const MAX_EDGE_BLOCK_FILL = 0.28;
const DARK_THRESHOLD = 35;
const EDGE_R = 52;
const EDGE_G = 52;
const EDGE_B = 58;

// Global contrast: 1 = full range, lower = flatter. Everything is pulled
// toward CONTRAST_MID by (1 - CONTRAST) to reduce tonal separation.
const CONTRAST = 0.42;
const CONTRAST_MID = [122, 98, 142];

function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function smoothstep(t) {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function placeSites(rand) {
  const sites = [];
  const maxAttempts = TARGET_SITES * 80;

  for (let attempt = 0; attempt < maxAttempts && sites.length < TARGET_SITES; attempt++) {
    const x = rand() * WIDTH;
    const y = rand() * HEIGHT;
    let ok = true;

    for (let i = 0; i < sites.length; i++) {
      const dx = x - sites[i].x;
      const dy = y - sites[i].y;
      if (dx * dx + dy * dy < MIN_SITE_DIST * MIN_SITE_DIST) {
        ok = false;
        break;
      }
    }

    if (!ok) continue;

    const i = sites.length;
    const p = PURPLES[i % PURPLES.length];
    const q = PURPLES[(i + 4) % PURPLES.length];
    const gradAngle = rand() * Math.PI * 2;

    sites.push({
      x,
      y,
      gradCos: Math.cos(gradAngle),
      gradSin: Math.sin(gradAngle),
      rLo: 32 + p[0] * 0.48,
      gLo: 28 + p[1] * 0.44,
      bLo: 38 + p[2] * 0.5,
      rHi: Math.min(255, 48 + q[0] * 0.78),
      gHi: Math.min(255, 40 + q[1] * 0.74),
      bHi: Math.min(255, 55 + q[2] * 0.8),
      projMin: Infinity,
      projMax: -Infinity
    });
  }

  return sites;
}

function findSite(sites, x, y) {
  let d1 = Infinity;
  let si = 0;

  for (let i = 0; i < sites.length; i++) {
    const dx = x - sites[i].x;
    const dy = y - sites[i].y;
    const d = dx * dx + dy * dy;
    if (d < d1) {
      d1 = d;
      si = i;
    }
  }

  return si;
}

function edgeStrength(dist) {
  if (dist >= EDGE_RADIUS) return 0;
  if (dist <= EDGE_RADIUS - EDGE_AA) return 1;
  return 1 - smoothstep((dist - (EDGE_RADIUS - EDGE_AA)) / EDGE_AA);
}

function buildBoundaryDistance(owner) {
  const total = WIDTH * HEIGHT;
  const dist = new Float32Array(total);
  dist.fill(1e9);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  for (let y = 0; y < HEIGHT; y++) {
    const row = y * WIDTH;
    for (let x = 0; x < WIDTH; x++) {
      const idx = row + x;
      const cell = owner[idx];
      let boundary = false;

      if (x + 1 < WIDTH && owner[idx + 1] !== cell) boundary = true;
      if (y + 1 < HEIGHT && owner[idx + WIDTH] !== cell) boundary = true;
      if (x > 0 && owner[idx - 1] !== cell) boundary = true;
      if (y > 0 && owner[idx - WIDTH] !== cell) boundary = true;

      if (boundary) {
        dist[idx] = 0;
        queue[tail++] = idx;
      }
    }
  }

  while (head < tail) {
    const idx = queue[head++];
    const d = dist[idx];
    if (d >= EDGE_RADIUS) continue;

    const x = idx % WIDTH;
    const y = (idx / WIDTH) | 0;

    if (x > 0) {
      const ni = idx - 1;
      if (dist[ni] > d + 1) {
        dist[ni] = d + 1;
        queue[tail++] = ni;
      }
    }
    if (x + 1 < WIDTH) {
      const ni = idx + 1;
      if (dist[ni] > d + 1) {
        dist[ni] = d + 1;
        queue[tail++] = ni;
      }
    }
    if (y > 0) {
      const ni = idx - WIDTH;
      if (dist[ni] > d + 1) {
        dist[ni] = d + 1;
        queue[tail++] = ni;
      }
    }
    if (y + 1 < HEIGHT) {
      const ni = idx + WIDTH;
      if (dist[ni] > d + 1) {
        dist[ni] = d + 1;
        queue[tail++] = ni;
      }
    }
  }

  return dist;
}

function drawCrystalVoronoi() {
  const rand = seededRandom(SEED);
  const sites = placeSites(rand);
  const owner = new Uint16Array(WIDTH * HEIGHT);
  const data = Buffer.alloc(WIDTH * HEIGHT * 4);

  for (let y = 0; y < HEIGHT; y++) {
    const row = y * WIDTH;
    for (let x = 0; x < WIDTH; x++) {
      const si = findSite(sites, x, y);
      const idx = row + x;
      owner[idx] = si;
      const s = sites[si];
      const proj = (x - s.x) * s.gradCos + (y - s.y) * s.gradSin;
      if (proj < s.projMin) s.projMin = proj;
      if (proj > s.projMax) s.projMax = proj;
    }
  }

  for (const s of sites) {
    if (!Number.isFinite(s.projMin) || !Number.isFinite(s.projMax) || s.projMax - s.projMin < 1) {
      s.projMin = -40;
      s.projMax = 40;
    }
  }

  const boundaryDist = buildBoundaryDistance(owner);

  for (let y = 0; y < HEIGHT; y++) {
    const vert = y / HEIGHT;
    const baseR = lerp(6, 24, vert);
    const baseG = lerp(6, 24, vert);
    const baseB = lerp(8, 28, vert);
    const row = y * WIDTH;

    for (let x = 0; x < WIDTH; x++) {
      const idx = row + x;
      const si = owner[idx];
      const s = sites[si];
      const i4 = idx * 4;

      const proj = (x - s.x) * s.gradCos + (y - s.y) * s.gradSin;
      const rawT = Math.max(0, Math.min(1, (proj - s.projMin) / (s.projMax - s.projMin)));
      const t = lerp(rawT, smoothstep(rawT), 0.35);

      let cellR = lerp(s.rLo, s.rHi, t);
      let cellG = lerp(s.gLo, s.gHi, t);
      let cellB = lerp(s.bLo, s.bHi, t);

      cellR = lerp(cellR, baseR, 0.26);
      cellG = lerp(cellG, baseG, 0.26);
      cellB = lerp(cellB, baseB, 0.26);

      const strength = edgeStrength(boundaryDist[idx]);

      let outR = lerp(cellR, EDGE_R, strength);
      let outG = lerp(cellG, EDGE_G, strength);
      let outB = lerp(cellB, EDGE_B, strength);

      // Compress the whole image toward a mid purple for much lower contrast.
      outR = lerp(CONTRAST_MID[0], outR, CONTRAST);
      outG = lerp(CONTRAST_MID[1], outG, CONTRAST);
      outB = lerp(CONTRAST_MID[2], outB, CONTRAST);

      data[i4] = Math.round(outR);
      data[i4 + 1] = Math.round(outG);
      data[i4 + 2] = Math.round(outB);
      data[i4 + 3] = 255;
    }
  }

  return { data, sites };
}

function isEdgePixel(r, g, b) {
  return Math.abs(r - EDGE_R) <= 3 && Math.abs(g - EDGE_G) <= 3 && Math.abs(b - EDGE_B) <= 4;
}

function analyzeBuffer(data, width, height) {
  let darkCount = 0;
  let wedgeCount = 0;
  let edgeBlockCount = 0;
  const channels = 4;
  const BLOCK = 48;
  const MARGIN = 150;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      if (data[i] < DARK_THRESHOLD && data[i + 1] < DARK_THRESHOLD && data[i + 2] < DARK_THRESHOLD) {
        darkCount++;
      }
    }
  }

  for (let by = MARGIN; by < height - MARGIN; by += BLOCK) {
    for (let bx = MARGIN; bx < width - MARGIN; bx += BLOCK) {
      let dark = 0;
      let edge = 0;
      let blockTotal = 0;
      for (let y = by; y < Math.min(by + BLOCK, height); y++) {
        for (let x = bx; x < Math.min(bx + BLOCK, width); x++) {
          const i = (y * width + x) * channels;
          blockTotal++;
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          if (r < DARK_THRESHOLD && g < DARK_THRESHOLD && b < DARK_THRESHOLD) dark++;
          if (isEdgePixel(r, g, b)) edge++;
        }
      }
      const darkFill = dark / blockTotal;
      const edgeFill = edge / blockTotal;
      if (darkFill > 0.35) wedgeCount++;
      if (edgeFill > MAX_EDGE_BLOCK_FILL) edgeBlockCount++;
    }
  }

  return {
    darkFrac: darkCount / (width * height),
    wedgeBlocks: wedgeCount,
    edgeBlocks: edgeBlockCount
  };
}

async function main() {
  console.log(`Generating ${WIDTH}x${HEIGHT} crystal voronoi...`);
  const { data, sites } = drawCrystalVoronoi();
  const { darkFrac, wedgeBlocks, edgeBlocks } = analyzeBuffer(data, WIDTH, HEIGHT);

  console.log(`Sites placed: ${sites.length} (target ${TARGET_SITES}, min dist ${MIN_SITE_DIST}px)`);
  console.log(`Dark pixel fraction: ${(darkFrac * 100).toFixed(2)}%`);
  console.log(`Dark wedge blocks: ${wedgeBlocks}`);
  console.log(`Heavy edge blocks (>${MAX_EDGE_BLOCK_FILL * 100}%): ${edgeBlocks}`);

  if (darkFrac > MAX_DARK_FRACTION || wedgeBlocks > 0) {
    console.warn('WARNING: possible triangle artifacts');
    process.exit(1);
  }

  if (edgeBlocks > 0) {
    console.warn(`Note: ${edgeBlocks} blocks have dense edge crossings (expected at junctions)`);
  }

  await sharp(data, { raw: { width: WIDTH, height: HEIGHT, channels: 4 } })
    .png({ compressionLevel: 6 })
    .toFile(OUT);
  console.log(`Wrote ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
