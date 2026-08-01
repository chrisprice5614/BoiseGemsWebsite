/**
 * Join Independent audition page body HTML (WYSIWYG admin editor).
 */

const DEFAULT_JOIN_INDEPENDENT_HTML = `
<section style="text-align:center; padding:8px 0 20px;">
  <h2 style="margin:0 0 8px;">Steps to Audition</h2>
  <p style="max-width:70ch; margin:0 auto 16px;">Join our indoor WGI program and develop as a musician and performer.</p>
  <ol style="margin:8px auto 16px; padding-left:20px; max-width:70ch; text-align:left;">
    <li style="margin-bottom:8px;"><strong>Create an Account</strong> - Sign up at <a href="/register-member">/register-member</a> so we can keep your info, track RSVPs, and share audition materials.</li>
    <li style="margin-bottom:8px;"><strong>Download Audition Materials</strong> - Log in to the <a href="/login?returnTo=/member-portal">Member Portal</a> and download the packet with warmups, excerpts, and rehearsal guides.</li>
    <li style="margin-bottom:8px;"><strong>Click "BGI Video Audition"</strong> - In the Member Portal pay the $40 season application fee to unlock Omnipply, then follow the submission instructions on the Video Audition website.</li>
  </ol>
</section>

<section style="padding:8px 0;">
  <h2 style="margin:0 0 6px;">How to Audition</h2>
  <p style="margin:0 0 12px;">We make auditions straightforward so you can focus on performing. Follow these steps:</p>
  <ol style="margin:8px 0 16px; padding-left:20px;">
    <li style="margin-bottom:8px;"><strong>Create an account:</strong> Sign up at <a href="/register-member">Register</a> so we can keep your info, track RSVPs, and share updates.</li>
    <li style="margin-bottom:8px;"><strong>Complete your profile:</strong> Add your instrument/part.</li>
    <li style="margin-bottom:8px;"><strong>RSVP for an audition:</strong> Use the <a href="/calendar">Auditions calendar</a> to pick a session and RSVP so we know you'll attend.</li>
    <li style="margin-bottom:8px;"><strong>Show up prepared:</strong> Bring your instrument, water, comfortable shoes, and a positive attitude.</li>
    <li style="margin-bottom:0;"><strong>Expect to be auditioned:</strong> Auditions are short-warmups, basic performance, and a short playing/exercise so we can place you appropriately.</li>
  </ol>

  <div style="margin:14px 0; padding:16px; background:linear-gradient(90deg,#fff8e1,#fff3cf); border-left:6px solid #ffb703; border-radius:8px;">
    <h3 style="margin:0 0 8px;">Video Auditions</h3>
    <p style="margin:0 0 10px; max-width:70ch;">Can't make an in-person audition or prefer to submit first? Follow these three steps to submit a video audition. Make sure audio is clear and follow the order in the audition packet.</p>
    <ol style="margin:0 0 0 20px;">
      <li style="margin-bottom:8px;"><strong>Create an Account</strong> - Sign up at <a href="/register-member">/register-member</a> so we can associate your submission with your profile.</li>
      <li style="margin-bottom:8px;"><strong>Download Audition Materials</strong> - Log in to the <a href="/login?returnTo=/member-portal">Member Portal</a> and download the packet with warmups, excerpts, and rehearsal guides.</li>
      <li style="margin-bottom:0;"><strong>Click "BGI Video Audition"</strong> - In the Member Portal, pay the $40 application fee for the current season to unlock the Omnipply video audition link, then follow the submission instructions.</li>
    </ol>
  </div>

  <h3 style="margin-top:6px;">What to Expect at Your Audition</h3>
  <ul style="margin:8px 0 12px;">
    <li>Warm-up and brief sight-reading/play task</li>
    <li>Basic placement evaluation</li>
    <li>Friendly staff feedback and guidance on next steps</li>
  </ul>

  <h3 style="margin-top:6px;">After Your Audition</h3>
  <p style="margin:8px 0 12px;">If selected, you'll receive an email with placement, rehearsal schedule, and next steps (uniforms, fees, and camp info). If not selected immediately, we may offer mentorship, sectional work, or feedback to help you grow toward future seasons.</p>
  <p style="margin:0;">Next steps: create an account at <a href="/register-member">/register-member</a>, view audition dates at <a href="/calendar">/calendar</a>, or contact the auditions team via <a href="/contact">/contact</a>.</p>
</section>
`.trim();

function getDefaultJoinIndependentHtml() {
  return DEFAULT_JOIN_INDEPENDENT_HTML;
}

function renderJoinIndependentBody(html) {
  const content = String(html || "").trim();
  return content || getDefaultJoinIndependentHtml();
}

module.exports = {
  getDefaultJoinIndependentHtml,
  renderJoinIndependentBody,
};
