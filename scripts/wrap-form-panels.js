/**
 * One-off: wrap selected <form> blocks in .form-panel divs.
 * Run: node scripts/wrap-form-panels.js
 */
const fs = require('fs');
const path = require('path');

const viewsDir = path.join(__dirname, '..', 'views');

/** @type {Array<{ file: string, open: string, panelClass?: string, closeBefore?: string }>} */
const wraps = [
  { file: 'contact.ejs', open: '<form action="/contact" method="POST">' },
  { file: 'make-payment.ejs', open: '<form action="/make-payment" method="POST">' },
  { file: 'pay-child.ejs', open: '<form action="/pay-behalf/' },
  { file: 'add-transaction.ejs', open: '<form action="/add-transaction/' },
  { file: 'add-transaction.ejs', open: '<form action="/add-charge/' },
  { file: 'change-address.ejs', open: '<form action="/change-address" method="POST"', panelClass: 'form-panel form-panel--narrow' },
  { file: 'change-email.ejs', open: '<form action="/change-email/' },
  { file: 'change-membership.ejs', open: '<form action="/change-membership/' },
  { file: 'change-account-type.ejs', open: '<form action="/change-account-type/' },
  { file: 'edit-section.ejs', open: '<form action="/edit-section/' },
  { file: 'update-emergency.ejs', open: '<form action="/update-emergency" method="POST"' },
  { file: 'set-tuition.ejs', open: '<form action="/set-tuition" method="POST">' },
  { file: 'set-allergies.ejs', open: '<form action="/set-allergies" method="POST">' },
  { file: 'view-materials.ejs', open: '<form action="/set-materials" method="POST"' },
  { file: 'add-event.ejs', open: '<form action="/add-event" method="POST"' },
  { file: 'edit-event.ejs', open: '<form action="/events/' },
  { file: 'add-form.ejs', open: '<form action="/add-form/' },
  { file: 'edit-form-single.ejs', open: '<form action="/edit-form/' },
  { file: 'staff-new.ejs', open: '<form action="/staff/new" method="POST"' },
  { file: 'staff-edit.ejs', open: '<form action="/staff/<%= staffer.id %>/edit"' },
  { file: 'extend-contract.ejs', open: '<form action="/extend-contract/' },
  { file: 'sign-contract.ejs', open: '<form action="/sign-contract/' },
  { file: 'upload-form.ejs', open: '<form\r\n      <% if (typeof parent', panelClass: 'form-panel form-panel--wide' },
  { file: 'contracts-admin.ejs', open: '<form action="/contracts-admin" method="POST"' },
  { file: 'forgot-password.ejs', open: '<form action="/forgot-password" method="POST">' },
  { file: 'reset-password.ejs', open: '<form action="/reset-password/' },
  { file: 'whistleblower.ejs', open: '<form action="/whistleblower" method="POST"' },
  { file: 'admin-chris-payment.ejs', open: '<form action="/admin/chris-payment/pay" method="POST">' },
  { file: 'admin-donors.ejs', open: '<form action="/admin/donors" method="POST"' },
  { file: 'admin-callbacks.ejs', open: '<form id="cb-form" action="/admin/callbacks"' },
  { file: 'admin-press-kit.ejs', open: '<form action="/admin/press-kit" method="POST"' },
  { file: 'admin-export-members.ejs', open: '<form action="/admin/export-member-info" method="POST"' },
  { file: 'admin-export-members.ejs', open: '<form action="/admin/export-member-info/csv" method="POST"' },
  { file: 'add-member.ejs', open: '<form action="/add-member" method="POST">' },
  { file: 'email-members.ejs', open: '<form method="POST" action="/email-members">' },
  { file: 'send-message.ejs', open: '<form action="/send-message/' },
  { file: 'support-issue.ejs', open: '<form action="/support/issue"' },
  { file: 'files-folder.ejs', open: '<form action="/files/folder/<%= folder.id %>/upload" method="post"' },
  { file: 'instruments.ejs', open: '<form method="POST" action="/instruments/<%= thisUser.id %>/add">' },
  { file: 'admin-volunteer-needs.ejs', open: '<form action="/admin/volunteer-needs" method="POST"' },
  { file: 'staff-admin.ejs', open: '<form action="/staff/reorder" method="POST">' },
];

function findFormBlock(content, openPrefix) {
  const idx = content.indexOf(openPrefix);
  if (idx === -1) return null;

  // Find the opening <form ...> tag end
  let tagEnd = content.indexOf('>', idx);
  if (tagEnd === -1) return null;
  tagEnd += 1;

  // Match closing </form> with simple depth (nested forms shouldn't exist)
  const closeTag = '</form>';
  let depth = 1;
  let pos = tagEnd;
  while (depth > 0 && pos < content.length) {
    const nextOpen = content.indexOf('<form', pos);
    const nextClose = content.indexOf(closeTag, pos);
    if (nextClose === -1) return null;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      pos = nextOpen + 5;
    } else {
      depth--;
      if (depth === 0) {
        return { start: idx, tagEnd, closeStart: nextClose, closeEnd: nextClose + closeTag.length };
      }
      pos = nextClose + closeTag.length;
    }
  }
  return null;
}

function wrapForm(content, openPrefix, panelClass) {
  const block = findFormBlock(content, openPrefix);
  if (!block) return { content, changed: false };

  const before = content.slice(0, block.start);
  const formOpen = content.slice(block.start, block.tagEnd);
  const formBody = content.slice(block.tagEnd, block.closeStart);
  const formClose = content.slice(block.closeStart, block.closeEnd);
  const after = content.slice(block.closeEnd);

  // Strip inline form box overrides from opening tag
  let cleanedOpen = formOpen
    .replace(/\s*style="[^"]*"/g, '')
    .replace(/\s*style='[^']*'/g, '');

  const cls = panelClass || 'form-panel';
  const wrapped = `${before}<div class="${cls}">\n${cleanedOpen}${formBody}${formClose}\n</div>${after}`;
  return { content: wrapped, changed: true };
}

let total = 0;
for (const spec of wraps) {
  const filePath = path.join(viewsDir, spec.file);
  if (!fs.existsSync(filePath)) {
    console.warn('Missing:', spec.file);
    continue;
  }
  let content = fs.readFileSync(filePath, 'utf8');
  if (content.includes(`class="${spec.panelClass || 'form-panel'}">\n${spec.open}`) ||
      content.includes(`class="form-panel">\n${spec.open}`)) {
    continue;
  }
  const result = wrapForm(content, spec.open, spec.panelClass);
  if (result.changed) {
    fs.writeFileSync(filePath, result.content, 'utf8');
    console.log('Wrapped:', spec.file, spec.open.slice(0, 40));
    total++;
  } else {
    console.warn('No match:', spec.file, spec.open.slice(0, 40));
  }
}

// volunteer.ejs: replace vol-card with form-panel for contact form section
const volPath = path.join(viewsDir, 'volunteer.ejs');
let vol = fs.readFileSync(volPath, 'utf8');
vol = vol.replace(
  '<div class="vol-card" style="margin-top: 32px;">',
  '<div class="form-panel" style="margin-top: 32px;">'
);
fs.writeFileSync(volPath, vol, 'utf8');
console.log('Updated volunteer.ejs vol-card -> form-panel');

// admin-instrument-checkout: main checkout section uses form-panel
const coPath = path.join(viewsDir, 'admin-instrument-checkout.ejs');
let co = fs.readFileSync(coPath, 'utf8');
co = co.replace(
  '<div class="checkout-card" style="max-width:600px; margin:0 auto 24px auto;">',
  '<div class="form-panel form-panel--narrow" style="margin:0 auto 24px auto;">'
);
fs.writeFileSync(coPath, co, 'utf8');
console.log('Updated admin-instrument-checkout.ejs checkout wrapper');

console.log('Done. Wrapped', total, 'forms.');
