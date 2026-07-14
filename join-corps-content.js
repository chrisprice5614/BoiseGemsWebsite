/**
 * Join Corps page content — HTML from WYSIWYG admin editor.
 */
const marked = require("marked");

const DEFAULT_JOIN_CORPS_MARKDOWN = `{align:center}
## The Journey Begins

{/align}

Every summer season is a new chapter. **Boise Gems** brings together musicians from across Idaho and beyond for a marching arts experience unlike anything else in the Treasure Valley.

{align:center}
### Create. Audition. Perform.

{/align}

{align:center}
## How It Works

{/align}

**Create an account** so we can keep your info and share updates.

**Download audition materials** from the member portal once you're signed in.

**RSVP for an audition** on the calendar and show up ready to play.

{align:left}
### What to Expect

{/align}

- Warm-ups and brief playing exercises
- Basic marching evaluation
- Friendly staff feedback and placement guidance

{align:center}
## Ready?

{/align}

The 2027 season is calling. Take the first step today.
`;

const ALIGN_RE = /\{align:(left|center|right)\}\s*\n([\s\S]*?)\n\{\/align\}/gi;

function ensureAlignBlocks(md) {
  const src = String(md || "").trim();
  if (!src) return "";
  if (/\{align:/i.test(src)) return src;
  return src
    .split(/\n\n+/)
    .filter((p) => p.trim())
    .map((chunk) => `{align:left}\n${chunk.trim()}\n{/align}`)
    .join("\n\n");
}

function parseMarkdownBlock(body) {
  return marked.parse(String(body || "").trim(), { breaks: true, gfm: true });
}

/** One-time migration: legacy markdown → HTML */
function renderJoinCorpsMarkdown(md) {
  const src = ensureAlignBlocks(String(md || "").trim() || DEFAULT_JOIN_CORPS_MARKDOWN);
  const parts = [];
  let last = 0;
  let match;

  ALIGN_RE.lastIndex = 0;
  while ((match = ALIGN_RE.exec(src)) !== null) {
    const before = src.slice(last, match.index).trim();
    if (before) parts.push(parseMarkdownBlock(before));
    const align = match[1].toLowerCase();
    const inner = parseMarkdownBlock(match[2]);
    parts.push(`<div class="jc-align jc-align--${align}">${inner}</div>`);
    last = match.index + match[0].length;
  }

  const tail = src.slice(last).trim();
  if (tail) parts.push(parseMarkdownBlock(tail));

  if (!parts.length) return parseMarkdownBlock(src);
  return parts.join("\n");
}

function getDefaultJoinCorpsHtml() {
  return renderJoinCorpsMarkdown(DEFAULT_JOIN_CORPS_MARKDOWN);
}

function renderJoinCorpsBody(html) {
  const content = String(html || "").trim();
  return content || getDefaultJoinCorpsHtml();
}

module.exports = {
  DEFAULT_JOIN_CORPS_MARKDOWN,
  getDefaultJoinCorpsHtml,
  renderJoinCorpsMarkdown,
  renderJoinCorpsBody,
};
