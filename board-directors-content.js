/**
 * Board of Directors page content — Markdown source + rendered HTML.
 */

const { marked } = require("marked");

const DEFAULT_BOARD_MARKDOWN = `
The Board of Directors provides governance and strategic oversight for Boise Gems Performing Arts, ensuring our programs remain strong, sustainable, and focused on serving youth through music education.

Board members bring experience in education, the arts, business, and community leadership. Together they guide the organization's mission, support its ensembles, and help expand opportunities for performers across Idaho and beyond.
`.trim();

function stripEmDashes(text) {
  return String(text || "")
    .replace(/\u2014/g, "-")
    .replace(/\u2013/g, "-")
    .replace(/&mdash;/gi, "-")
    .replace(/&#8212;/gi, "-")
    .replace(/&#x2014;/gi, "-");
}

function getDefaultBoardMarkdown() {
  return stripEmDashes(DEFAULT_BOARD_MARKDOWN);
}

function markdownToHtml(markdown) {
  const md = stripEmDashes(String(markdown || "").trim());
  if (!md) return "";
  return stripEmDashes(marked.parse(md, { async: false }));
}

function getDefaultBoardHtml() {
  return markdownToHtml(getDefaultBoardMarkdown());
}

function renderBoardBody(html, markdown) {
  const fromHtml = stripEmDashes(String(html || "").trim());
  if (fromHtml) return fromHtml;
  const fromMd = markdownToHtml(markdown);
  return fromMd || getDefaultBoardHtml();
}

function resolveBoardMarkdown(markdown, html) {
  const md = stripEmDashes(String(markdown || "").trim());
  if (md) return md;
  // Fallback: if only HTML exists (legacy/empty md), leave editor empty rather than HTML soup
  if (String(html || "").trim()) return "";
  return getDefaultBoardMarkdown();
}

module.exports = {
  DEFAULT_BOARD_MARKDOWN,
  getDefaultBoardMarkdown,
  getDefaultBoardHtml,
  markdownToHtml,
  renderBoardBody,
  resolveBoardMarkdown,
  stripEmDashes,
};
