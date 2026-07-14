/**
 * Analyze crystal-voronoi.png for triangle/wedge artifacts.
 * Run: node scripts/analyze-crystal-voronoi.js
 */
const path = require('path');
const sharp = require('sharp');

const IMG = path.join(__dirname, '..', 'public', 'img', 'ui', 'crystal-voronoi.png');
const DARK_THRESHOLD = 35;
const BLOCK = 48;
const MARGIN = 150;
const MAX_BLOCK_DARK_FILL = 0.35;

async function main() {
  const { data, info } = await sharp(IMG).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  let darkCount = 0;
  let minR = 255;
  let maxR = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      minR = Math.min(minR, r);
      maxR = Math.max(maxR, r);
      if (r < DARK_THRESHOLD && g < DARK_THRESHOLD && b < DARK_THRESHOLD) darkCount++;
    }
  }

  const darkPct = (100 * darkCount) / (width * height);
  console.log(`Image: ${width}x${height}, RGB range ${minR}-${maxR}`);
  console.log(`Near-black pixels (<${DARK_THRESHOLD}): ${darkCount} (${darkPct.toFixed(2)}%)`);

  const bad = [];
  for (let by = MARGIN; by < height - MARGIN; by += BLOCK) {
    for (let bx = MARGIN; bx < width - MARGIN; bx += BLOCK) {
      let dark = 0;
      let blockTotal = 0;
      for (let y = by; y < Math.min(by + BLOCK, height); y++) {
        for (let x = bx; x < Math.min(bx + BLOCK, width); x++) {
          const i = (y * width + x) * channels;
          blockTotal++;
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          if (r < DARK_THRESHOLD && g < DARK_THRESHOLD && b < DARK_THRESHOLD) dark++;
        }
      }
      const f = dark / blockTotal;
      if (f > MAX_BLOCK_DARK_FILL) bad.push({ bx, by, f });
    }
  }

  bad.sort((a, b) => b.f - a.f);
  console.log(`Interior dark wedge blocks: ${bad.length}`);
  for (const b of bad.slice(0, 5)) {
    console.log(`  (${b.bx}, ${b.by}) ${(b.f * 100).toFixed(0)}%`);
  }

  const pass = darkPct < 1 && bad.length === 0;
  console.log(pass ? '\nPASS: no black triangle artifacts detected' : '\nFAIL: artifacts remain');
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
