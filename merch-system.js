/**
 * Merch store - categories, variant products, cart, Stripe checkout, digital grants.
 */
const path = require("path");
const fs = require("fs");

const STANDARD_SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL"];
const MERCH_IMG_DIR = path.join(__dirname, "public", "img", "merch");
const MERCH_DIGITAL_DIR = path.join(__dirname, "merch-files");

function getStripePublishableKey() {
  return process.env.STRIPE_PUBLISHABLE_KEY || process.env.STRIPE_PUBLIC_KEY || "";
}

function parseCityStateZip(segment) {
  if (!segment) return null;
  const s = String(segment).trim().replace(/\s+/g, " ");
  let m = s.match(/^(.+?),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  if (m) return { city: m[1].trim(), state: m[2].toUpperCase(), postal: m[3] };
  m = s.match(/^(.+?)\s+([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  if (m) return { city: m[1].trim(), state: m[2].toUpperCase(), postal: m[3] };
  m = s.match(/^([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  if (m) return { city: "", state: m[1].toUpperCase(), postal: m[2] };
  return null;
}

/** Split a single-line or multi-line mailing address into checkout fields. */
function parseMailingAddress(raw) {
  const empty = { line1: "", line2: "", city: "", state: "", postal: "", country: "US" };
  if (!raw || !String(raw).trim()) return { ...empty };

  const lines = String(raw)
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length >= 2) {
    const line1 = lines[0];
    if (lines.length === 2) {
      const csp = parseCityStateZip(lines[1]);
      if (csp) return { ...empty, line1, ...csp };
      return { ...empty, line1, line2: lines[1] };
    }
    const last = parseCityStateZip(lines[lines.length - 1]);
    const line2 = lines.length > 2 ? lines.slice(1, -1).join(", ") : "";
    if (last) {
      return { ...empty, line1, line2, city: last.city, state: last.state, postal: last.postal };
    }
    return { ...empty, line1, line2: lines.slice(1).join(", ") };
  }

  const text = lines[0];
  const parts = text.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return { ...empty, line1: text };

  const last = parts[parts.length - 1];
  const secondLast = parts[parts.length - 2];
  const cspLast = parseCityStateZip(last);
  if (cspLast && parts.length >= 3) {
    const city = cspLast.city || secondLast;
    const line1Parts = cspLast.city ? parts.slice(0, -1) : parts.slice(0, -2);
    return {
      ...empty,
      line1: line1Parts.join(", "),
      city,
      state: cspLast.state,
      postal: cspLast.postal,
    };
  }

  if (parts.length >= 4 && /^\d{5}(-\d{4})?$/.test(last) && /^[A-Za-z]{2}$/.test(secondLast)) {
    return {
      ...empty,
      line1: parts.slice(0, -3).join(", "),
      city: parts[parts.length - 3],
      state: secondLast.toUpperCase(),
      postal: last,
    };
  }

  return { ...empty, line1: text };
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "item";
}

function uniqueSlug(db, base, excludeId) {
  let slug = slugify(base);
  let n = 0;
  while (true) {
    const trySlug = n ? `${slug}-${n}` : slug;
    const row = db.prepare("SELECT id FROM merch_products WHERE slug = ?").get(trySlug);
    if (!row || (excludeId && row.id === excludeId)) return trySlug;
    n++;
  }
}

function initMerch(db) {
  fs.mkdirSync(MERCH_IMG_DIR, { recursive: true });
  fs.mkdirSync(MERCH_DIGITAL_DIR, { recursive: true });

  const ssCols = db.prepare("PRAGMA table_info(site_settings)").all().map((c) => c.name);
  if (!ssCols.includes("merch_enabled")) {
    db.prepare("ALTER TABLE site_settings ADD COLUMN merch_enabled INTEGER NOT NULL DEFAULT 0").run();
  }
  if (!ssCols.includes("merch_tax_percent")) {
    db.prepare("ALTER TABLE site_settings ADD COLUMN merch_tax_percent REAL NOT NULL DEFAULT 0").run();
  }
  if (!ssCols.includes("merch_pass_stripe_fee")) {
    db.prepare("ALTER TABLE site_settings ADD COLUMN merch_pass_stripe_fee INTEGER NOT NULL DEFAULT 0").run();
  }
  if (!ssCols.includes("merch_shipping_domestic_cents")) {
    db.prepare("ALTER TABLE site_settings ADD COLUMN merch_shipping_domestic_cents INTEGER NOT NULL DEFAULT 899").run();
  }
  if (!ssCols.includes("merch_shipping_intl_cents")) {
    db.prepare("ALTER TABLE site_settings ADD COLUMN merch_shipping_intl_cents INTEGER NOT NULL DEFAULT 1499").run();
  }
  if (!ssCols.includes("merch_order_notify_emails")) {
    db.prepare("ALTER TABLE site_settings ADD COLUMN merch_order_notify_emails TEXT NOT NULL DEFAULT 'info@fermataworks.com'").run();
  }
  db.prepare(`
    UPDATE site_settings
    SET merch_order_notify_emails = 'info@fermataworks.com'
    WHERE id = 1 AND (merch_order_notify_emails IS NULL OR TRIM(merch_order_notify_emails) = '')
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS merch_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS merch_products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER REFERENCES merch_categories(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      price_cents INTEGER NOT NULL DEFAULT 0,
      default_image TEXT,
      product_type TEXT NOT NULL DEFAULT 'physical' CHECK (product_type IN ('physical', 'digital')),
      digital_filename TEXT,
      digital_original_name TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      out_of_stock INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS merch_colors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES merch_products(id) ON DELETE CASCADE,
      color_name TEXT NOT NULL,
      color_hex TEXT NOT NULL DEFAULT '#60437d',
      enabled INTEGER NOT NULL DEFAULT 1,
      out_of_stock INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0
    )
  `).run();
  const mcCols = db.prepare("PRAGMA table_info(merch_colors)").all().map((c) => c.name);
  if (!mcCols.includes("color_hex")) {
    db.prepare("ALTER TABLE merch_colors ADD COLUMN color_hex TEXT NOT NULL DEFAULT '#60437d'").run();
  }

  db.prepare(`
    CREATE TABLE IF NOT EXISTS merch_color_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      color_id INTEGER NOT NULL REFERENCES merch_colors(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS merch_skus (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES merch_products(id) ON DELETE CASCADE,
      color_id INTEGER REFERENCES merch_colors(id) ON DELETE CASCADE,
      size_label TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      out_of_stock INTEGER NOT NULL DEFAULT 0,
      stock_qty INTEGER,
      UNIQUE(product_id, color_id, size_label)
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS merch_potential_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      cart_json TEXT NOT NULL,
      subtotal_cents INTEGER NOT NULL,
      tax_cents INTEGER NOT NULL,
      stripe_fee_cents INTEGER NOT NULL,
      processing_fee_cents INTEGER NOT NULL,
      total_cents INTEGER NOT NULL,
      stripe_session_id TEXT,
      created_at INTEGER NOT NULL
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS merch_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'paid',
      subtotal_cents INTEGER NOT NULL,
      tax_cents INTEGER NOT NULL,
      stripe_fee_cents INTEGER NOT NULL,
      processing_fee_cents INTEGER NOT NULL,
      total_cents INTEGER NOT NULL,
      stripe_session_id TEXT,
      created_at INTEGER NOT NULL
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS merch_order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES merch_orders(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL,
      color_id INTEGER,
      size_label TEXT NOT NULL DEFAULT '',
      quantity INTEGER NOT NULL DEFAULT 1,
      unit_price_cents INTEGER NOT NULL,
      beneficiary_user_id INTEGER,
      product_name TEXT NOT NULL,
      color_name TEXT,
      product_type TEXT NOT NULL DEFAULT 'physical'
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS merch_digital_grants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      order_id INTEGER NOT NULL,
      granted_at INTEGER NOT NULL,
      UNIQUE(user_id, product_id)
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS merch_promo_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE COLLATE NOCASE,
      promo_type TEXT NOT NULL CHECK (promo_type IN ('percent', 'fixed', 'free_shipping')),
      value INTEGER NOT NULL DEFAULT 0,
      min_order_cents INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    )
  `).run();

  const prodCols = db.prepare("PRAGMA table_info(merch_products)").all().map((c) => c.name);
  if (!prodCols.includes("featured")) {
    db.prepare("ALTER TABLE merch_products ADD COLUMN featured INTEGER NOT NULL DEFAULT 0").run();
  }

  const orderCols = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  for (const table of ["merch_potential_orders", "merch_orders"]) {
    const cols = orderCols(table);
    if (!cols.includes("shipping_cents")) db.prepare(`ALTER TABLE ${table} ADD COLUMN shipping_cents INTEGER NOT NULL DEFAULT 0`).run();
    if (!cols.includes("discount_cents")) db.prepare(`ALTER TABLE ${table} ADD COLUMN discount_cents INTEGER NOT NULL DEFAULT 0`).run();
    if (!cols.includes("promo_code")) db.prepare(`ALTER TABLE ${table} ADD COLUMN promo_code TEXT`).run();
    if (!cols.includes("ship_line1")) db.prepare(`ALTER TABLE ${table} ADD COLUMN ship_line1 TEXT`).run();
    if (!cols.includes("ship_line2")) db.prepare(`ALTER TABLE ${table} ADD COLUMN ship_line2 TEXT`).run();
    if (!cols.includes("ship_city")) db.prepare(`ALTER TABLE ${table} ADD COLUMN ship_city TEXT`).run();
    if (!cols.includes("ship_state")) db.prepare(`ALTER TABLE ${table} ADD COLUMN ship_state TEXT`).run();
    if (!cols.includes("ship_postal")) db.prepare(`ALTER TABLE ${table} ADD COLUMN ship_postal TEXT`).run();
    if (!cols.includes("ship_country")) db.prepare(`ALTER TABLE ${table} ADD COLUMN ship_country TEXT`).run();
    if (!cols.includes("stripe_payment_intent_id")) db.prepare(`ALTER TABLE ${table} ADD COLUMN stripe_payment_intent_id TEXT`).run();
  }
}

const MERCH_DEFAULT_NOTIFY_EMAIL = "info@fermataworks.com";

function parseMerchNotifyEmails(raw) {
  if (!raw || !String(raw).trim()) return [MERCH_DEFAULT_NOTIFY_EMAIL];
  const emails = String(raw)
    .split(/[,;\n]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  return emails.length ? [...new Set(emails)] : [MERCH_DEFAULT_NOTIFY_EMAIL];
}

function getMerchSettings(getSiteSettings) {
  const s = getSiteSettings();
  return {
    enabled: Number(s.merch_enabled) === 1,
    taxPercent: Number(s.merch_tax_percent) || 0,
    shippingDomesticCents: Number(s.merch_shipping_domestic_cents) || 899,
    shippingIntlCents: Number(s.merch_shipping_intl_cents) || 1499,
    orderNotifyEmails: parseMerchNotifyEmails(s.merch_order_notify_emails),
    orderNotifyEmailsRaw: String(s.merch_order_notify_emails || "").trim() || MERCH_DEFAULT_NOTIFY_EMAIL,
  };
}

function isDomesticCountry(country) {
  const c = String(country || "").trim().toUpperCase();
  return c === "US" || c === "USA" || c === "UNITED STATES" || c === "UNITED STATES OF AMERICA";
}

function getPromoByCode(db, code) {
  const raw = String(code || "").trim();
  if (!raw) return null;
  return db.prepare("SELECT * FROM merch_promo_codes WHERE code = ? COLLATE NOCASE AND active = 1").get(raw);
}

function computePromoDiscount(db, promoCode, subtotalCents) {
  const promo = getPromoByCode(db, promoCode);
  if (!promo) return { promo: null, discountCents: 0, freeShipping: false, error: promoCode ? "Invalid promo code." : null };
  if (promo.min_order_cents && subtotalCents < promo.min_order_cents) {
    const min = (promo.min_order_cents / 100).toFixed(2);
    return { promo: null, discountCents: 0, freeShipping: false, error: `Promo requires a $${min} minimum order.` };
  }
  if (promo.promo_type === "percent") {
    return { promo, discountCents: Math.round(subtotalCents * (promo.value / 100)), freeShipping: false, error: null };
  }
  if (promo.promo_type === "fixed") {
    return { promo, discountCents: Math.min(subtotalCents, promo.value), freeShipping: false, error: null };
  }
  if (promo.promo_type === "free_shipping") {
    return { promo, discountCents: 0, freeShipping: true, error: null };
  }
  return { promo: null, discountCents: 0, freeShipping: false, error: "Invalid promo code." };
}

function calculateOrderTotals(subtotalCents, settings, opts = {}) {
  const { discountCents = 0, shippingCents = 0, freeShipping = false } = opts;
  const discountedSub = Math.max(0, subtotalCents - discountCents);
  const taxCents = Math.round(discountedSub * (settings.taxPercent / 100));
  const ship = freeShipping ? 0 : shippingCents;
  const preFee = discountedSub + taxCents + ship;
  const serviceFeeCents = Math.round(preFee * 0.03);
  const totalCents = preFee + serviceFeeCents;
  return {
    subtotalCents,
    discountCents,
    shippingCents: ship,
    taxCents,
    stripeFeeCents: serviceFeeCents,
    processingFeeCents: 0,
    totalCents,
  };
}

function shippingCentsForCart(settings, country, hasPhysical) {
  if (!hasPhysical) return 0;
  return isDomesticCountry(country) ? settings.shippingDomesticCents : settings.shippingIntlCents;
}

function listPromoCodes(db) {
  return db.prepare("SELECT * FROM merch_promo_codes ORDER BY created_at DESC").all();
}

function getCart(req) {
  if (!req.session.merchCart) req.session.merchCart = [];
  return req.session.merchCart;
}

function cartCount(req) {
  return getCart(req).reduce((n, line) => n + (line.qty || 1), 0);
}

function listCategories(db) {
  return db.prepare("SELECT * FROM merch_categories ORDER BY sort_order, name").all();
}

function listProductsAdmin(db) {
  return db.prepare(`
    SELECT p.*, c.name AS category_name
    FROM merch_products p
    LEFT JOIN merch_categories c ON c.id = p.category_id
    ORDER BY p.sort_order, p.name
  `).all();
}

function listActiveProducts(db) {
  return db.prepare(`
    SELECT p.*, c.name AS category_name
    FROM merch_products p
    LEFT JOIN merch_categories c ON c.id = p.category_id
    WHERE p.active = 1
    ORDER BY c.sort_order, c.name, p.sort_order, p.name
  `).all();
}

function listFeaturedProducts(db) {
  return db.prepare(`
    SELECT p.*, c.name AS category_name
    FROM merch_products p
    LEFT JOIN merch_categories c ON c.id = p.category_id
    WHERE p.active = 1 AND p.featured = 1
    ORDER BY p.sort_order, p.name
  `).all();
}

function getProductBySlug(db, slug) {
  return db.prepare("SELECT * FROM merch_products WHERE slug = ? AND active = 1").get(slug);
}

function getProductFull(db, productId) {
  const product = db.prepare("SELECT * FROM merch_products WHERE id = ?").get(productId);
  if (!product) return null;
  const colors = db.prepare("SELECT * FROM merch_colors WHERE product_id = ? ORDER BY sort_order, id").all(productId);
  for (const color of colors) {
    color.images = db.prepare("SELECT * FROM merch_color_images WHERE color_id = ? ORDER BY sort_order, id").all(color.id);
  }
  const skus = db.prepare("SELECT * FROM merch_skus WHERE product_id = ?").all(productId);
  return { product, colors, skus };
}

function productImageUrl(product, color) {
  if (color && color.images && color.images.length) {
    return `/img/merch/${color.images[0].filename}`;
  }
  if (product.default_image) return `/img/merch/${product.default_image}`;
  return "/img/ui/gem.png";
}

function findSku(db, productId, colorId, sizeLabel) {
  return db.prepare(`
    SELECT * FROM merch_skus
    WHERE product_id = ? AND IFNULL(color_id, 0) = IFNULL(?, 0) AND size_label = ?
  `).get(productId, colorId || null, sizeLabel || "");
}

function skuAvailable(sku, product) {
  if (Number(product.out_of_stock)) return false;
  if (!sku) return true;
  if (!Number(sku.enabled)) return false;
  if (sku.stock_qty != null && sku.stock_qty <= 0) return false;
  return true;
}

function userOwnsDigital(db, userId, productId) {
  if (!userId) return false;
  return !!db.prepare("SELECT id FROM merch_digital_grants WHERE user_id = ? AND product_id = ?").get(userId, productId);
}

function calculateTotals(subtotalCents, settings) {
  return calculateOrderTotals(subtotalCents, settings, {});
}

function resolveCartLines(db, cart, buyerUserId) {
  const lines = [];
  let subtotal = 0;
  for (const item of cart) {
    const full = getProductFull(db, item.productId);
    if (!full || !full.product.active) throw new Error("A product in your cart is no longer available.");
    const product = full.product;
    const color = item.colorId ? full.colors.find((c) => c.id === item.colorId) : null;
    if (product.product_type === "physical" && full.colors.length && (!color || !color.enabled)) {
      throw new Error(`Please select a valid color for ${product.name}.`);
    }
    const sizeLabel = item.size || "";
    const sku = findSku(db, product.id, color ? color.id : null, sizeLabel);
    if (product.product_type === "physical" && full.skus.length && !skuAvailable(sku, product)) {
      throw new Error(`${product.name} is out of stock for the selected options.`);
    }
    const qty = product.product_type === "digital" ? 1 : Math.max(1, Math.min(99, Number(item.qty) || 1));
    const beneficiaryId = item.beneficiaryUserId ? Number(item.beneficiaryUserId) : buyerUserId;
    if (product.product_type === "digital") {
      if (userOwnsDigital(db, beneficiaryId, product.id)) {
        throw new Error(`${product.name} has already been purchased for this account.`);
      }
    }
    const lineTotal = product.price_cents * qty;
    subtotal += lineTotal;
    lines.push({
      productId: product.id,
      colorId: color ? color.id : null,
      colorName: color ? color.color_name : null,
      sizeLabel,
      qty,
      unitPriceCents: product.price_cents,
      beneficiaryUserId: beneficiaryId || null,
      productName: product.name,
      productType: product.product_type,
    });
  }
  return { lines, subtotalCents: subtotal };
}

function getDigitalGrantsForUser(db, userId) {
  return db.prepare(`
    SELECT g.*, p.name, p.description, p.digital_original_name, p.digital_filename
    FROM merch_digital_grants g
    JOIN merch_products p ON p.id = g.product_id
    WHERE g.user_id = ?
    ORDER BY g.granted_at DESC
  `).all(userId);
}

function buildVariantsPayload(full) {
  if (!full || !full.colors.length) {
    return { hasVariants: false, sizeLabels: [], colors: [] };
  }
  const sizeLabels = [];
  full.skus.forEach((s) => {
    if (s.size_label && !sizeLabels.includes(s.size_label)) sizeLabels.push(s.size_label);
  });
  const colors = full.colors.map((c) => {
    const sizes = {};
    sizeLabels.forEach((sz) => {
      const sku = full.skus.find((s) => s.color_id === c.id && s.size_label === sz);
      sizes[sz] = {
        enabled: sku ? !!sku.enabled : true,
        stock_qty: sku && sku.stock_qty != null ? sku.stock_qty : "",
      };
    });
    return {
      color_name: c.color_name,
      color_hex: c.color_hex || "#60437d",
      enabled: !!c.enabled,
      existing_images: (c.images || []).map((img) => img.filename),
      sizes,
    };
  });
  return { hasVariants: true, sizeLabels, colors };
}

function getProductSizeLabels(full) {
  if (!full || !full.skus.length) return [];
  const labels = [];
  full.skus.forEach((s) => {
    if (s.size_label && !labels.includes(s.size_label)) labels.push(s.size_label);
  });
  return labels;
}

function saveProductFromBody(db, body, files, productId) {
  const name = String(body.name || "").trim();
  const description = String(body.description || "").trim();
  const categoryId = body.category_id ? Number(body.category_id) : null;
  const priceCents = Math.round(Number(body.price || 0) * 100);
  const productType = body.product_type === "digital" ? "digital" : "physical";
  const active = body.active === "1" || body.active === "on" ? 1 : 0;
  const outOfStock = body.out_of_stock === "1" || body.out_of_stock === "on" ? 1 : 0;
  if (!name) throw new Error("Product name is required.");

  const now = Date.now();
  let id = productId;
  if (id) {
    const slug = uniqueSlug(db, body.slug || name, id);
    db.prepare(`
      UPDATE merch_products SET category_id=?, name=?, slug=?, description=?, price_cents=?,
        product_type=?, active=?, out_of_stock=?, updated_at=?
      WHERE id=?
    `).run(categoryId, name, slug, description, priceCents, productType, active, outOfStock, now, id);
  } else {
    const slug = uniqueSlug(db, name);
    const maxRow = db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM merch_products").get();
    const sortOrder = (maxRow.m || 0) + 1;
    const r = db.prepare(`
      INSERT INTO merch_products (category_id, name, slug, description, price_cents, product_type, active, out_of_stock, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(categoryId, name, slug, description, priceCents, productType, active, outOfStock, sortOrder, now, now);
    id = r.lastInsertRowid;
  }

  if (files && files.default_image && files.default_image[0]) {
    const f = files.default_image[0];
    db.prepare("UPDATE merch_products SET default_image = ? WHERE id = ?").run(f.filename, id);
  }

  if (productType === "digital" && files && files.digital_file && files.digital_file[0]) {
    const f = files.digital_file[0];
    db.prepare("UPDATE merch_products SET digital_filename = ?, digital_original_name = ? WHERE id = ?")
      .run(f.filename, f.originalname, id);
  }

  if (productType === "physical") {
    let variantData = { hasVariants: false, sizeLabels: [], colors: [] };
    try {
      variantData = body.variants_json ? JSON.parse(body.variants_json) : variantData;
    } catch (_) {}

    db.prepare("DELETE FROM merch_skus WHERE product_id = ?").run(id);
    db.prepare("DELETE FROM merch_color_images WHERE color_id IN (SELECT id FROM merch_colors WHERE product_id = ?)").run(id);
    db.prepare("DELETE FROM merch_colors WHERE product_id = ?").run(id);

    if (variantData.hasVariants && variantData.colors && variantData.colors.length) {
      const sizeLabels = Array.isArray(variantData.sizeLabels) ? variantData.sizeLabels : [];
      variantData.colors.forEach((c, ci) => {
        const hex = String(c.color_hex || "#60437d").trim() || "#60437d";
        const cr = db.prepare(`
          INSERT INTO merch_colors (product_id, color_name, color_hex, enabled, out_of_stock, sort_order)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(id, String(c.color_name || "Color").trim() || "Color", hex, 1, 0, ci);
        const colorId = cr.lastInsertRowid;
        sizeLabels.forEach((sz) => {
          const szData = (c.sizes && c.sizes[sz]) || {};
          const enabled = szData.enabled ? 1 : 0;
          db.prepare(`
            INSERT INTO merch_skus (product_id, color_id, size_label, enabled, out_of_stock, stock_qty)
            VALUES (?, ?, ?, ?, 0, ?)
          `).run(
            id,
            colorId,
            sz,
            enabled,
            szData.stock_qty === "" || szData.stock_qty == null ? null : Number(szData.stock_qty)
          );
        });
        const imgKey = `color_image_${ci}`;
        let imgSort = 0;
        (c.existing_images || []).forEach((filename) => {
          if (!filename) return;
          db.prepare("INSERT INTO merch_color_images (color_id, filename, sort_order) VALUES (?, ?, ?)")
            .run(colorId, filename, imgSort++);
        });
        if (files && files[imgKey]) {
          files[imgKey].forEach((file) => {
            db.prepare("INSERT INTO merch_color_images (color_id, filename, sort_order) VALUES (?, ?, ?)")
              .run(colorId, file.filename, imgSort++);
          });
        }
      });
    }
  }

  return id;
}

function sendMerchOrderEmail(sendEmail, potential, orderId, cart, notifyEmails) {
  if (typeof sendEmail !== "function") return;
  const lines = cart.map((line) => {
    let detail = line.productName;
    if (line.colorName) detail += ` (${line.colorName})`;
    if (line.sizeLabel) detail += `, ${line.sizeLabel}`;
    detail += ` x${line.qty}`;
    detail += ` - $${((line.unitPriceCents * line.qty) / 100).toFixed(2)}`;
    return `<li>${detail}</li>`;
  }).join("");
  const total = (potential.total_cents / 100).toFixed(2);

  if (potential.email) {
    const html = `
      <h1 style="text-align:center;">Order Confirmed</h1>
      <p>Hi ${potential.name},</p>
      <p>Thank you for your Boise Gems store order (#${orderId}). Your payment was confirmed.</p>
      <ul>${lines}</ul>
      <p><strong>Total charged:</strong> $${total}</p>
      <p>A tracking email will be sent soon when your order ships.</p>
      <p>Boise Gems Drum &amp; Bugle Corps</p>
    `;
    sendEmail(potential.email, `Order Confirmed #${orderId} | Boise Gems Store`, html);
  }

  const admins = parseMerchNotifyEmails(notifyEmails);
  if (!admins.length) return;

  let shipHtml = "";
  if (potential.ship_line1) {
    shipHtml = `
      <h2>Shipping address</h2>
      <p>
        ${potential.name}<br>
        ${potential.ship_line1}<br>
        ${potential.ship_line2 ? `${potential.ship_line2}<br>` : ""}
        ${potential.ship_city || ""}${potential.ship_state ? `, ${potential.ship_state}` : ""} ${potential.ship_postal || ""}<br>
        ${potential.ship_country || ""}
      </p>
    `;
  }

  const adminHtml = `
    <h1>New store order #${orderId}</h1>
    <p><strong>Customer:</strong> ${potential.name} (${potential.email})</p>
    <h2>Items</h2>
    <ul>${lines}</ul>
    <p><strong>Subtotal:</strong> $${(potential.subtotal_cents / 100).toFixed(2)}</p>
    ${potential.discount_cents ? `<p><strong>Discount:</strong> -$${(potential.discount_cents / 100).toFixed(2)}${potential.promo_code ? ` (${potential.promo_code})` : ""}</p>` : ""}
    ${potential.shipping_cents ? `<p><strong>Shipping:</strong> $${(potential.shipping_cents / 100).toFixed(2)}</p>` : ""}
    ${potential.tax_cents ? `<p><strong>Tax:</strong> $${(potential.tax_cents / 100).toFixed(2)}</p>` : ""}
    <p><strong>Total charged:</strong> $${total}</p>
    ${shipHtml}
  `;
  admins.forEach((email) => {
    sendEmail(email, `New Store Order #${orderId} | Boise Gems`, adminHtml);
  });
}

function finalizeMerchOrder(db, potential, addChrisShare, sendEmail, getSiteSettings) {
  const cart = JSON.parse(potential.cart_json || "[]");
  const insertOrder = db.prepare(`
    INSERT INTO merch_orders (
      user_id, email, name, status, subtotal_cents, tax_cents, stripe_fee_cents, processing_fee_cents,
      total_cents, stripe_session_id, stripe_payment_intent_id, shipping_cents, discount_cents, promo_code,
      ship_line1, ship_line2, ship_city, ship_state, ship_postal, ship_country, created_at
    )
    VALUES (?, ?, ?, 'paid', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const orderId = insertOrder.run(
    potential.user_id || null,
    potential.email,
    potential.name,
    potential.subtotal_cents,
    potential.tax_cents,
    potential.stripe_fee_cents,
    potential.processing_fee_cents,
    potential.total_cents,
    potential.stripe_session_id || null,
    potential.stripe_payment_intent_id || null,
    potential.shipping_cents || 0,
    potential.discount_cents || 0,
    potential.promo_code || null,
    potential.ship_line1 || "",
    potential.ship_line2 || "",
    potential.ship_city || "",
    potential.ship_state || "",
    potential.ship_postal || "",
    potential.ship_country || "",
    Date.now()
  ).lastInsertRowid;

  const insertItem = db.prepare(`
    INSERT INTO merch_order_items (order_id, product_id, color_id, size_label, quantity, unit_price_cents, beneficiary_user_id, product_name, color_name, product_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const line of cart) {
    insertItem.run(
      orderId,
      line.productId,
      line.colorId,
      line.sizeLabel || "",
      line.qty,
      line.unitPriceCents,
      line.beneficiaryUserId,
      line.productName,
      line.colorName,
      line.productType
    );
    let beneficiary = line.beneficiaryUserId;
    if (line.productType === "digital") {
      if (!beneficiary) beneficiary = potential.user_id || null;
      if (!beneficiary && potential.email) {
        const u = db.prepare("SELECT id FROM users WHERE email = ?").get(potential.email);
        if (u) beneficiary = u.id;
      }
      if (beneficiary) {
        db.prepare(`
          INSERT OR IGNORE INTO merch_digital_grants (user_id, product_id, order_id, granted_at)
          VALUES (?, ?, ?, ?)
        `).run(beneficiary, line.productId, orderId, Date.now());
      }
    }
    if (line.productType === "physical" && line.colorId != null) {
      const sku = findSku(db, line.productId, line.colorId, line.sizeLabel || "");
      if (sku && sku.stock_qty != null) {
        const newQty = Math.max(0, sku.stock_qty - line.qty);
        db.prepare("UPDATE merch_skus SET stock_qty = ? WHERE id = ?").run(newQty, sku.id);
      }
    }
  }

  const subtotalStr = (potential.subtotal_cents / 100).toFixed(2);
  addChrisShare(potential.subtotal_cents, `Merch order #${orderId} ($${subtotalStr})`);
  const notifyEmails = getMerchSettings(getSiteSettings).orderNotifyEmails;
  sendMerchOrderEmail(sendEmail, potential, orderId, cart, notifyEmails);
  db.prepare("DELETE FROM merch_potential_orders WHERE id = ?").run(potential.id);
  return orderId;
}

function registerMerchRoutes(app, ctx) {
  const {
    db,
    stripe,
    mustBeAdmin,
    mustBeLoggedIn,
    mustBeLoggedInAny,
    getSiteSettings,
    addChrisShare,
    imageUpload,
    sharp,
    generateCustomFilename,
    parentLinks,
    sendEmail,
    opsSystem,
  } = ctx;

  function merchEnabled(req, res, next) {
    if (!getMerchSettings(getSiteSettings).enabled) return res.status(404).send("Store is not available.");
    next();
  }

  const merchUpload = imageUpload.fields([
    { name: "default_image", maxCount: 1 },
    { name: "digital_file", maxCount: 1 },
    ...Array.from({ length: 12 }, (_, i) => ({ name: `color_image_${i}`, maxCount: 8 })),
  ]);

  async function processMerchImage(req, res, next) {
    try {
      if (!req.files) return next();
      const outDir = MERCH_IMG_DIR;
      fs.mkdirSync(outDir, { recursive: true });
      for (const key of Object.keys(req.files)) {
        for (const file of req.files[key]) {
          if (key === "digital_file") {
            const name = generateCustomFilename() + path.extname(file.originalname || "");
            const dest = path.join(MERCH_DIGITAL_DIR, name);
            fs.writeFileSync(dest, file.buffer);
            file.filename = name;
            continue;
          }
          const name = generateCustomFilename() + ".webp";
          await sharp(file.buffer).rotate().resize(900, 900, { fit: "inside", withoutEnlargement: false }).webp({ quality: 82 }).toFile(path.join(outDir, name));
          file.filename = name;
        }
      }
      next();
    } catch (e) {
      next(e);
    }
  }

  // ── Admin ──
  app.get("/admin/merch", mustBeAdmin, (req, res) => {
    const settings = getMerchSettings(getSiteSettings);
    res.render("admin-merch", {
      settings,
      categories: listCategories(db),
      products: listProductsAdmin(db),
      standardSizes: STANDARD_SIZES,
      flash: req.session.flashMessage || null,
    });
    req.session.flashMessage = null;
  });

  app.post("/admin/merch/settings", mustBeAdmin, (req, res) => {
    const enabled = req.body.merch_enabled === "1" ? 1 : 0;
    const tax = Math.max(0, Math.min(100, Number(req.body.merch_tax_percent) || 0));
    const shipDom = Math.max(0, Math.round(Number(req.body.merch_shipping_domestic || 8.99) * 100));
    const shipIntl = Math.max(0, Math.round(Number(req.body.merch_shipping_intl || 14.99) * 100));
    const notifyEmails = String(req.body.merch_order_notify_emails || "").trim() || MERCH_DEFAULT_NOTIFY_EMAIL;
    db.prepare(`UPDATE site_settings SET merch_enabled=?, merch_tax_percent=?, merch_shipping_domestic_cents=?, merch_shipping_intl_cents=?, merch_order_notify_emails=?, updated_at=? WHERE id=1`)
      .run(enabled, tax, shipDom, shipIntl, notifyEmails, Date.now());
    req.session.flashMessage = "Store settings saved.";
    const back = String(req.body.return_to || "").trim();
    res.redirect(back || "/admin/merch");
  });

  app.post("/admin/merch/promos", mustBeAdmin, (req, res) => {
    const code = String(req.body.code || "").trim().toUpperCase();
    const promoType = String(req.body.promo_type || "percent");
    const value = Math.round(Number(req.body.value || 0));
    const minOrder = Math.round(Number(req.body.min_order || 0) * 100);
    if (!code) {
      req.session.flashMessage = "Promo code is required.";
      return res.redirect(req.body.return_to || "/admin-portal?section=store");
    }
    if (!["percent", "fixed", "free_shipping"].includes(promoType)) {
      req.session.flashMessage = "Invalid promo type.";
      return res.redirect(req.body.return_to || "/admin-portal?section=store");
    }
    try {
      db.prepare(`
        INSERT INTO merch_promo_codes (code, promo_type, value, min_order_cents, active, created_at)
        VALUES (?, ?, ?, ?, 1, ?)
      `).run(code, promoType, promoType === "percent" ? Math.min(100, value) : Math.round(value * 100), minOrder, Date.now());
      req.session.flashMessage = "Promo code added.";
    } catch (e) {
      req.session.flashMessage = "Could not add promo (code may already exist).";
    }
    res.redirect(req.body.return_to || "/admin-portal?section=store");
  });

  app.post("/admin/merch/promos/:id/toggle", mustBeAdmin, (req, res) => {
    const row = db.prepare("SELECT active FROM merch_promo_codes WHERE id = ?").get(req.params.id);
    if (row) db.prepare("UPDATE merch_promo_codes SET active = ? WHERE id = ?").run(row.active ? 0 : 1, req.params.id);
    res.redirect(req.body.return_to || "/admin-portal?section=store");
  });

  app.post("/admin/merch/promos/:id/delete", mustBeAdmin, (req, res) => {
    db.prepare("DELETE FROM merch_promo_codes WHERE id = ?").run(req.params.id);
    res.redirect(req.body.return_to || "/admin-portal?section=store");
  });

  app.post("/admin/merch/categories", mustBeAdmin, (req, res) => {
    const name = String(req.body.name || "").trim();
    if (!name) return res.redirect("/admin/merch");
    const maxRow = db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM merch_categories").get();
    db.prepare("INSERT INTO merch_categories (name, sort_order, created_at) VALUES (?, ?, ?)")
      .run(name, (maxRow.m || 0) + 1, Date.now());
    req.session.flashMessage = "Category added.";
    res.redirect("/admin/merch");
  });

  app.post("/admin/merch/categories/reorder", mustBeAdmin, (req, res) => {
    const ids = Array.isArray(req.body.categoryIds) ? req.body.categoryIds : [];
    const update = db.prepare("UPDATE merch_categories SET sort_order = ? WHERE id = ?");
    ids.forEach((id, i) => update.run(i, Number(id)));
    return res.json({ ok: true });
  });

  app.post("/admin/merch/categories/:id/delete", mustBeAdmin, (req, res) => {
    db.prepare("DELETE FROM merch_categories WHERE id = ?").run(req.params.id);
    res.redirect("/admin/merch");
  });

  app.post("/admin/merch/products/reorder", mustBeAdmin, (req, res) => {
    const ids = Array.isArray(req.body.productIds) ? req.body.productIds : [];
    const update = db.prepare("UPDATE merch_products SET sort_order = ? WHERE id = ?");
    ids.forEach((id, i) => update.run(i, Number(id)));
    return res.json({ ok: true });
  });

  app.get("/admin/merch/products/new", mustBeAdmin, (req, res) => {
    res.render("admin-merch-product", {
      product: null,
      full: null,
      categories: listCategories(db),
      variantsJson: JSON.stringify({ hasVariants: false, sizeLabels: [], colors: [] }),
    });
  });

  app.get("/admin/merch/products/:id/edit", mustBeAdmin, (req, res) => {
    const full = getProductFull(db, Number(req.params.id));
    if (!full) return res.redirect("/admin/merch");
    res.render("admin-merch-product", {
      product: full.product,
      full,
      categories: listCategories(db),
      variantsJson: JSON.stringify(buildVariantsPayload(full)),
    });
  });

  app.post("/admin/merch/products", mustBeAdmin, merchUpload, processMerchImage, (req, res) => {
    try {
      const id = saveProductFromBody(db, req.body, req.files, null);
      req.session.flashMessage = "Product created.";
      res.redirect(`/admin/merch/products/${id}/edit`);
    } catch (e) {
      req.session.flashMessage = e.message || "Save failed.";
      res.redirect("/admin/merch/products/new");
    }
  });

  app.post("/admin/merch/products/:id", mustBeAdmin, merchUpload, processMerchImage, (req, res) => {
    try {
      saveProductFromBody(db, req.body, req.files, Number(req.params.id));
      req.session.flashMessage = "Product saved.";
      res.redirect(`/admin/merch/products/${req.params.id}/edit`);
    } catch (e) {
      req.session.flashMessage = e.message || "Save failed.";
      res.redirect(`/admin/merch/products/${req.params.id}/edit`);
    }
  });

  app.post("/admin/merch/products/:id/delete", mustBeAdmin, (req, res) => {
    db.prepare("DELETE FROM merch_products WHERE id = ?").run(req.params.id);
    res.redirect("/admin/merch");
  });

  app.post("/admin/merch/products/:id/featured", mustBeAdmin, (req, res) => {
    const row = db.prepare("SELECT featured FROM merch_products WHERE id = ?").get(req.params.id);
    if (row) db.prepare("UPDATE merch_products SET featured = ? WHERE id = ?").run(row.featured ? 0 : 1, req.params.id);
    if (req.headers.accept && req.headers.accept.includes("json")) {
      return res.json({ ok: true, featured: row ? !row.featured : false });
    }
    res.redirect("/admin/merch");
  });

  // ── Store ──
  app.get(["/merch", "/shop"], (req, res) => res.redirect(301, "/store"));

  app.get("/store", merchEnabled, (req, res) => {
    const products = listActiveProducts(db);
    const categories = listCategories(db);
    res.render("merch-store", {
      products,
      categories,
      cartCount: cartCount(req),
    });
  });

  app.get("/store/product/:slug", merchEnabled, (req, res) => {
    const product = getProductBySlug(db, req.params.slug);
    if (!product) return res.status(404).send("Product not found.");
    const full = getProductFull(db, product.id);
    let children = [];
    if (req.user && Number(req.user.parent)) {
      children = parentLinks.getChildrenForParent(db, req.user.userid) || [];
    }
    const alreadyOwns = req.user ? userOwnsDigital(db, req.user.userid, product.id) : false;
    const sizeLabels = getProductSizeLabels(full);
    res.render("merch-product", {
      full,
      productImageUrl,
      cartCount: cartCount(req),
      children,
      alreadyOwns,
      sizeLabels,
      flash: req.session.flashMessage || null,
    });
    req.session.flashMessage = null;
  });

  app.post("/store/cart/add", merchEnabled, (req, res) => {
    try {
      const body = req.body || {};
      const productId = Number(body.product_id);
      if (!productId) throw new Error("Invalid product.");
      const colorId = body.color_id ? Number(body.color_id) : null;
      const size = String(body.size || "").trim();
      const qty = Number(body.qty) || 1;
      const beneficiaryUserId = body.beneficiary_user_id ? Number(body.beneficiary_user_id) : null;
      const full = getProductFull(db, productId);
      if (!full || !full.product.active) throw new Error("Product not found.");
      const product = full.product;
      if (product.product_type === "digital") {
        const uid = beneficiaryUserId || (req.user ? req.user.userid : null);
        if (uid && userOwnsDigital(db, uid, product.id)) throw new Error("Already purchased.");
      }
      const cart = getCart(req);
      const existing = cart.find((l) => l.productId === productId && l.colorId === colorId && l.size === size && l.beneficiaryUserId === beneficiaryUserId);
      if (existing && product.product_type !== "digital") existing.qty = Math.min(99, (existing.qty || 1) + qty);
      else cart.push({ productId, colorId, size, qty: product.product_type === "digital" ? 1 : qty, beneficiaryUserId });
      if (req.headers.accept && req.headers.accept.includes("json")) return res.json({ ok: true, count: cartCount(req) });
      res.redirect("/store/cart");
    } catch (e) {
      if (req.headers.accept && req.headers.accept.includes("json")) return res.status(400).json({ ok: false, message: e.message });
      req.session.flashMessage = e.message;
      res.redirect("back");
    }
  });

  app.post("/store/cart/update", merchEnabled, (req, res) => {
    const cart = getCart(req);
    const idx = Number(req.body.index);
    const qty = Number(req.body.qty);
    if (cart[idx]) {
      if (qty <= 0) cart.splice(idx, 1);
      else cart[idx].qty = Math.min(99, qty);
    }
    res.redirect("/store/cart");
  });

  app.post("/store/cart/remove", merchEnabled, (req, res) => {
    const cart = getCart(req);
    cart.splice(Number(req.body.index), 1);
    res.redirect("/store/cart");
  });

  app.get("/store/cart", merchEnabled, (req, res) => {
    const settings = getMerchSettings(getSiteSettings);
    const cart = getCart(req);
    const lines = [];
    let subtotal = 0;
    for (let i = 0; i < cart.length; i++) {
      const item = cart[i];
      const full = getProductFull(db, item.productId);
      if (!full) continue;
      const product = full.product;
      const color = item.colorId ? full.colors.find((c) => c.id === item.colorId) : null;
      const lineTotal = product.price_cents * (item.qty || 1);
      subtotal += lineTotal;
      lines.push({ index: i, item, product, color, lineTotal, image: productImageUrl(product, color) });
    }
    const totals = calculateTotals(subtotal, settings);
    const hasPhysical = lines.some((l) => l.product.product_type === "physical");
    const shipPreview = hasPhysical ? settings.shippingDomesticCents : 0;
    const orderTotals = calculateOrderTotals(subtotal, settings, { shippingCents: shipPreview });
    res.render("merch-cart", {
      lines,
      totals: orderTotals,
      settings,
      hasPhysical,
      cartCount: cartCount(req),
      flash: req.session.flashMessage,
    });
    req.session.flashMessage = null;
  });

  app.get("/store/checkout", merchEnabled, (req, res) => {
    const settings = getMerchSettings(getSiteSettings);
    const cart = getCart(req);
    if (!cart.length) return res.redirect("/store/cart");
    let buyerUserId = req.user ? req.user.userid : null;
    let member = null;
    if (req.user) member = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.userid);
    try {
      const { lines, subtotalCents } = resolveCartLines(db, cart, buyerUserId);
      const hasPhysical = lines.some((l) => l.productType === "physical");
      const totals = calculateOrderTotals(subtotalCents, settings, { shippingCents: hasPhysical ? settings.shippingDomesticCents : 0 });
      const shipParsed = member && member.address ? parseMailingAddress(member.address) : parseMailingAddress("");
      res.render("merch-checkout", {
        lines,
        totals,
        settings,
        member,
        shipParsed,
        hasPhysical,
        cartCount: cartCount(req),
        stripePublishableKey: getStripePublishableKey(),
        flash: req.session.flashMessage,
      });
      req.session.flashMessage = null;
    } catch (e) {
      req.session.flashMessage = e.message;
      res.redirect("/store/cart");
    }
  });

  app.post("/store/checkout/quote", merchEnabled, (req, res) => {
    try {
      const settings = getMerchSettings(getSiteSettings);
      const cart = getCart(req);
      if (!cart.length) return res.status(400).json({ ok: false, message: "Cart is empty." });
      const buyerUserId = req.user ? req.user.userid : null;
      const { lines, subtotalCents } = resolveCartLines(db, cart, buyerUserId);
      const hasPhysical = lines.some((l) => l.productType === "physical");
      const country = String(req.body.ship_country || "US").trim();
      const promo = computePromoDiscount(db, req.body.promo_code, subtotalCents);
      if (promo.error) return res.status(400).json({ ok: false, message: promo.error });
      const ship = shippingCentsForCart(settings, country, hasPhysical);
      const totals = calculateOrderTotals(subtotalCents, settings, {
        discountCents: promo.discountCents,
        shippingCents: ship,
        freeShipping: promo.freeShipping,
      });
      return res.json({
        ok: true,
        totals,
        promoLabel: promo.promo ? promo.promo.code : null,
        hasPhysical,
      });
    } catch (e) {
      return res.status(400).json({ ok: false, message: e.message || "Could not calculate totals." });
    }
  });

  app.post("/store/checkout/pay", merchEnabled, async (req, res) => {
    try {
      const settings = getMerchSettings(getSiteSettings);
      const cart = getCart(req);
      if (!cart.length) return res.status(400).json({ ok: false, message: "Cart is empty." });
      const email = String(req.body.email || "").trim().toLowerCase();
      const name = String(req.body.name || "").trim();
      const shipLine1 = String(req.body.ship_line1 || "").trim();
      const shipLine2 = String(req.body.ship_line2 || "").trim();
      const shipCity = String(req.body.ship_city || "").trim();
      const shipState = String(req.body.ship_state || "").trim();
      const shipPostal = String(req.body.ship_postal || "").trim();
      const shipCountry = String(req.body.ship_country || "US").trim();
      if (!email || !name) return res.status(400).json({ ok: false, message: "Email and name are required." });
      let userId = req.user ? req.user.userid : null;
      if (!userId) {
        const u = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
        if (u) userId = u.id;
      }
      const { lines, subtotalCents } = resolveCartLines(db, cart, userId);
      const hasPhysical = lines.some((l) => l.productType === "physical");
      if (hasPhysical && (!shipLine1 || !shipCity || !shipPostal || !shipCountry)) {
        return res.status(400).json({ ok: false, message: "Shipping address is required." });
      }
      const promo = computePromoDiscount(db, req.body.promo_code, subtotalCents);
      if (promo.error) return res.status(400).json({ ok: false, message: promo.error });
      const ship = shippingCentsForCart(settings, shipCountry, hasPhysical);
      const totals = calculateOrderTotals(subtotalCents, settings, {
        discountCents: promo.discountCents,
        shippingCents: ship,
        freeShipping: promo.freeShipping,
      });
      const cartJson = JSON.stringify(lines);
      const r = db.prepare(`
        INSERT INTO merch_potential_orders (
          user_id, email, name, cart_json, subtotal_cents, tax_cents, stripe_fee_cents, processing_fee_cents,
          total_cents, shipping_cents, discount_cents, promo_code,
          ship_line1, ship_line2, ship_city, ship_state, ship_postal, ship_country, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        userId, email, name, cartJson,
        totals.subtotalCents, totals.taxCents, totals.stripeFeeCents, totals.processingFeeCents, totals.totalCents,
        totals.shippingCents, totals.discountCents, promo.promo ? promo.promo.code : null,
        shipLine1, shipLine2, shipCity, shipState, shipPostal, shipCountry,
        Date.now()
      );
      const potentialId = r.lastInsertRowid;
      const paymentIntent = await stripe.paymentIntents.create({
        amount: totals.totalCents,
        currency: "usd",
        automatic_payment_methods: { enabled: true },
        receipt_email: email,
        metadata: { potential_order_id: String(potentialId) },
      });
      db.prepare("UPDATE merch_potential_orders SET stripe_payment_intent_id = ? WHERE id = ?").run(paymentIntent.id, potentialId);
      return res.json({ ok: true, clientSecret: paymentIntent.client_secret, potentialId });
    } catch (e) {
      console.error("Checkout pay error:", e);
      if (opsSystem) {
        opsSystem.logFailedPayment(db, {
          message: "Merch checkout payment setup failed",
          detail: e,
          req,
          statusCode: 500,
        });
        opsSystem.markLogged(res, e);
      }
      return res.status(500).json({ ok: false, message: e.message || "Payment setup failed." });
    }
  });

  app.post("/store/checkout/complete", merchEnabled, async (req, res) => {
    try {
      const potentialId = Number(req.body.potentialId);
      const paymentIntentId = String(req.body.paymentIntentId || "");
      if (!potentialId || !paymentIntentId) return res.status(400).json({ ok: false, message: "Missing payment info." });
      const potential = db.prepare("SELECT * FROM merch_potential_orders WHERE id = ?").get(potentialId);
      if (!potential) return res.status(404).json({ ok: false, message: "Order not found." });
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
      if (pi.status !== "succeeded") return res.status(400).json({ ok: false, message: "Payment not completed." });
      const existing = db.prepare("SELECT id FROM merch_orders WHERE stripe_payment_intent_id = ?").get(paymentIntentId);
      const orderId = existing ? existing.id : finalizeMerchOrder(db, potential, addChrisShare, sendEmail, getSiteSettings);
      req.session.merchCart = [];
      return res.json({ ok: true, redirect: `/store/success/${orderId}` });
    } catch (e) {
      console.error("Checkout complete error:", e);
      if (opsSystem) {
        opsSystem.logFailedPayment(db, {
          message: "Merch checkout complete failed",
          detail: e,
          req,
          statusCode: 500,
        });
        opsSystem.markLogged(res, e);
      }
      return res.status(500).json({ ok: false, message: "Could not complete order." });
    }
  });

  app.get("/store/success/:id", merchEnabled, (req, res) => {
    let order = db.prepare("SELECT * FROM merch_orders WHERE id = ?").get(req.params.id);
    if (!order) {
      const potential = db.prepare("SELECT * FROM merch_potential_orders WHERE id = ?").get(req.params.id);
      if (potential) {
        const orderId = finalizeMerchOrder(db, potential, addChrisShare, sendEmail, getSiteSettings);
        req.session.merchCart = [];
        order = db.prepare("SELECT * FROM merch_orders WHERE id = ?").get(orderId);
      }
    }
    res.render("merch-success", { cartCount: 0, order });
  });

  app.get("/store/download/:grantId", mustBeLoggedInAny, (req, res) => {
    const grant = db.prepare(`
      SELECT g.*, p.digital_filename, p.digital_original_name, p.name
      FROM merch_digital_grants g
      JOIN merch_products p ON p.id = g.product_id
      WHERE g.id = ?
    `).get(req.params.grantId);
    if (!grant) return res.status(404).send("Not found.");
    const uid = req.user.userid;
    const isParentChild = parentLinks.isParentOf(db, uid, grant.user_id);
    if (grant.user_id !== uid && !Number(req.user.admin) && !isParentChild) return res.status(403).send("Forbidden.");
    const filePath = path.join(MERCH_DIGITAL_DIR, grant.digital_filename);
    if (!fs.existsSync(filePath)) return res.status(404).send("File missing.");
    res.download(filePath, grant.digital_original_name || grant.name);
  });
}

module.exports = {
  STANDARD_SIZES,
  initMerch,
  getMerchSettings,
  getStripePublishableKey,
  parseMailingAddress,
  cartCount,
  getDigitalGrantsForUser,
  listPromoCodes,
  calculateOrderTotals,
  getProductSizeLabels,
  registerMerchRoutes,
  productImageUrl,
};
