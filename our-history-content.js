/**
 * Our History page content — HTML from WYSIWYG admin editor.
 */

const DEFAULT_OUR_HISTORY_HTML = `
<p>Gems Drum and Bugle Corps is a recently established drum corps in the Treasure Valley. Our goal is to provide youth with performing arts programs that will help make them more well-rounded individuals in both life and their performing arts pursuits.</p>
<p>We were founded in 2022 with the simple realization that Idaho was lacking this type of opportunity, and our founders wanted to provide our community and state with this type of program. Thus Gems were created, and will strive for excellence in all ways.</p>
<p>In 2023, we fielded our first corps, and toured to three cities in the northwest. These include Kennewick, Washington, Boise, Idaho, and Salt Lake City, Utah. We made our official DCI debut at Corps Encore in Salt Lake City, and were proud to represent Idaho on the international stage. The 2023 program was entitled <em>Esto Perpetua</em>, which is also Idaho's state motto.</p>
<p>In 2024, the Gems fielded a corps of over 80+ members from 8 different states. The 2024 program, <em>Ghost Stallion</em>, featured music from <em>The Rite of Spring</em>, <em>Mahler 5</em>, and <em>Symphonie Fantastique</em> alongside original compositions and arrangements.</p>
<p>The 2025 season brought firsts in design, production, and growth, and closed with the announcement of Boise Gems Independent as the next chapter of Gems Performing Arts.</p>
`.trim();

function stripEmDashes(text) {
  return String(text || "")
    .replace(/\u2014/g, "-")
    .replace(/\u2013/g, "-")
    .replace(/&mdash;/gi, "-")
    .replace(/&#8212;/gi, "-")
    .replace(/&#x2014;/gi, "-");
}

function getDefaultOurHistoryHtml() {
  return stripEmDashes(DEFAULT_OUR_HISTORY_HTML);
}

function renderOurHistoryBody(html) {
  const content = stripEmDashes(String(html || "").trim());
  return content || getDefaultOurHistoryHtml();
}

module.exports = {
  DEFAULT_OUR_HISTORY_HTML,
  getDefaultOurHistoryHtml,
  renderOurHistoryBody,
  stripEmDashes,
};
