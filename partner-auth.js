const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const SESSION_KEY = "partnerAuth";
const AUTH_CODE_TTL_MS = 2 * 60 * 1000;
const authCodes = new Map();

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Partner registry.
 * Built-in: neopply (from NEOPPLY_* env).
 * Extra clients: PARTNER_AUTH_CLIENTS=acme,other
 *   ACME_PARTNER_SECRET=...
 *   ACME_REDIRECT_URIS=https://acme.com/callback,http://localhost:3000/callback
 *   ACME_HANDOFF=code|id_token  (default: code)
 */
function loadPartners() {
  const partners = new Map();

  const neopplySecret = process.env.NEOPPLY_PARTNER_SECRET;
  const neopplyUris = parseCsv(process.env.NEOPPLY_REDIRECT_URIS);
  if (!neopplyUris.length) {
    neopplyUris.push(
      "https://neopply.com/auth/boise-gems/callback",
      "http://localhost:3000/auth/boise-gems/callback"
    );
  }
  if (neopplySecret) {
    partners.set("neopply", {
      clientId: "neopply",
      secret: neopplySecret,
      redirectUris: new Set(neopplyUris),
      // Hoyoon's existing integration expects id_token on the redirect
      handoff: String(process.env.NEOPPLY_HANDOFF || "id_token").toLowerCase() === "code"
        ? "code"
        : "id_token",
      aud: "neopply",
    });
  }

  for (const rawId of parseCsv(process.env.PARTNER_AUTH_CLIENTS)) {
    const clientId = rawId.trim().toLowerCase();
    if (!clientId || clientId === "neopply") continue;
    const envKey = clientId.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
    const secret = process.env[`${envKey}_PARTNER_SECRET`];
    const uris = parseCsv(process.env[`${envKey}_REDIRECT_URIS`]);
    if (!secret || !uris.length) {
      console.warn(`[partner-auth] Skipping ${clientId}: missing ${envKey}_PARTNER_SECRET or _REDIRECT_URIS`);
      continue;
    }
    const handoff =
      String(process.env[`${envKey}_HANDOFF`] || "code").toLowerCase() === "id_token"
        ? "id_token"
        : "code";
    partners.set(clientId, {
      clientId,
      secret,
      redirectUris: new Set(uris),
      handoff,
      aud: clientId,
    });
  }

  return partners;
}

function getPartners() {
  // Always read env so dotenv order / restarts stay predictable
  return loadPartners();
}

function getPartner(clientId) {
  return getPartners().get(String(clientId || "").trim().toLowerCase()) || null;
}

function pruneAuthCodes() {
  const now = Date.now();
  for (const [code, row] of authCodes.entries()) {
    if (row.expiresAt <= now) authCodes.delete(code);
  }
}

function readPartnerParams(req) {
  const fromBody = req.body || {};
  const fromQuery = req.query || {};
  const fromSession = (req.session && req.session[SESSION_KEY]) || {};
  return {
    client_id: fromBody.client_id || fromQuery.client_id || fromSession.client_id || "",
    redirect_uri: fromBody.redirect_uri || fromQuery.redirect_uri || fromSession.redirect_uri || "",
    state: fromBody.state || fromQuery.state || fromSession.state || "",
    response_type:
      fromBody.response_type ||
      fromQuery.response_type ||
      fromSession.response_type ||
      "",
  };
}

function isValidPartnerFlow(params) {
  const partner = getPartner(params.client_id);
  if (!partner) return false;
  if (!params.state) return false;
  if (!partner.redirectUris.has(params.redirect_uri)) return false;
  return true;
}

function persistPartnerParams(req, params) {
  if (!req.session) return false;
  if (!isValidPartnerFlow(params)) {
    delete req.session[SESSION_KEY];
    return false;
  }
  req.session[SESSION_KEY] = {
    client_id: params.client_id,
    redirect_uri: params.redirect_uri,
    state: params.state,
    response_type: params.response_type || "",
  };
  return true;
}

function clearPartnerParams(req) {
  if (req.session) delete req.session[SESSION_KEY];
}

function partnerParamsForView(req) {
  const params = readPartnerParams(req);
  if (!isValidPartnerFlow(params)) {
    return { client_id: "", redirect_uri: "", state: "", response_type: "" };
  }
  return {
    client_id: params.client_id,
    redirect_uri: params.redirect_uri,
    state: params.state,
    response_type: params.response_type || "",
  };
}

function partnerQueryString(params) {
  if (!isValidPartnerFlow(params)) return "";
  const qs = new URLSearchParams({
    client_id: params.client_id,
    redirect_uri: params.redirect_uri,
    state: params.state,
  });
  if (params.response_type) qs.set("response_type", params.response_type);
  return "?" + qs.toString();
}

function createPartnerIdToken(partner, user, accessToken, { expiresIn = "2m" } = {}) {
  if (!partner || !partner.secret) return null;
  return jwt.sign(
    {
      sub: String(user.id),
      email: user.email,
      access_token: accessToken,
      aud: partner.aud || partner.clientId,
    },
    partner.secret,
    { algorithm: "HS256", expiresIn }
  );
}

function mintAuthCode({ partner, user, accessToken, redirectUri }) {
  pruneAuthCodes();
  const code = crypto.randomBytes(24).toString("hex");
  authCodes.set(code, {
    clientId: partner.clientId,
    userId: Number(user.id),
    email: user.email,
    accessToken,
    redirectUri,
    expiresAt: Date.now() + AUTH_CODE_TTL_MS,
  });
  return code;
}

function consumeAuthCode(code, { clientId, redirectUri }) {
  pruneAuthCodes();
  const row = authCodes.get(code);
  if (!row) return null;
  authCodes.delete(code);
  if (row.expiresAt <= Date.now()) return null;
  if (row.clientId !== clientId) return null;
  if (row.redirectUri !== redirectUri) return null;
  return row;
}

function resolveHandoff(partner, params) {
  const rt = String(params.response_type || "").toLowerCase();
  if (rt === "code" || rt === "authorization_code") return "code";
  if (rt === "id_token") return "id_token";
  return partner.handoff || "code";
}

/**
 * After successful Gems login/register/MFA: send user back to the partner.
 * Preferred: authorization code on redirect; partner exchanges at POST /api/partner/token.
 * Legacy (Neopply): id_token on redirect when handoff=id_token.
 */
function sendBackToPartner(req, res, { user, accessToken }) {
  const params = readPartnerParams(req);
  if (!isValidPartnerFlow(params)) return false;

  const partner = getPartner(params.client_id);
  if (!partner) return false;

  const handoff = resolveHandoff(partner, params);
  clearPartnerParams(req);

  const url = new URL(params.redirect_uri);
  url.searchParams.set("state", params.state);

  if (handoff === "id_token") {
    const idToken = createPartnerIdToken(partner, user, accessToken);
    if (!idToken) {
      console.error(`[partner-auth] Missing secret for ${partner.clientId}`);
      return false;
    }
    url.searchParams.set("id_token", idToken);
    res.redirect(url.toString());
    return true;
  }

  const code = mintAuthCode({
    partner,
    user,
    accessToken,
    redirectUri: params.redirect_uri,
  });
  url.searchParams.set("code", code);
  res.redirect(url.toString());
  return true;
}

function exchangePartnerToken({ clientId, clientSecret, code, redirectUri }) {
  const partner = getPartner(clientId);
  if (!partner) return { ok: false, status: 401, message: "Unknown client_id" };
  if (!clientSecret || clientSecret !== partner.secret) {
    return { ok: false, status: 401, message: "Invalid client credentials" };
  }
  if (!partner.redirectUris.has(redirectUri)) {
    return { ok: false, status: 400, message: "Invalid redirect_uri" };
  }

  const row = consumeAuthCode(code, { clientId: partner.clientId, redirectUri });
  if (!row) return { ok: false, status: 400, message: "Invalid or expired code" };

  const idToken = createPartnerIdToken(
    partner,
    { id: row.userId, email: row.email },
    row.accessToken,
    { expiresIn: "2m" }
  );
  if (!idToken) return { ok: false, status: 503, message: "Partner not configured" };

  return {
    ok: true,
    status: 200,
    body: {
      token_type: "Bearer",
      expires_in: 120,
      id_token: idToken,
      access_token: row.accessToken,
      sub: String(row.userId),
      email: row.email,
    },
  };
}

// ── Neopply embed helpers (video audition iframe) ─────────────

function getNeopplyCorpsEmbedBaseUrl(section) {
  const sec = String(section || "").trim().toLowerCase();
  const bySection = {
    brass: process.env.NEOPPLY_CORPS_EMBED_URL_BRASS,
    drumline: process.env.NEOPPLY_CORPS_EMBED_URL_DRUMLINE,
    "front ensemble": process.env.NEOPPLY_CORPS_EMBED_URL_FRONTENSEMBLE,
  };
  return (
    bySection[sec] ||
    process.env.NEOPPLY_CORPS_EMBED_URL ||
    "https://neopply.com/embed/boise-gems/corps"
  );
}

function buildNeopplyCorpsEmbedUrl(user, accessToken, section) {
  const partner = getPartner("neopply");
  if (!partner) return null;
  const idToken = createPartnerIdToken(partner, user, accessToken, { expiresIn: "15m" });
  if (!idToken) return null;
  const url = new URL(getNeopplyCorpsEmbedBaseUrl(section));
  url.searchParams.set("id_token", idToken);
  return url.toString();
}

/** @deprecated Use createPartnerIdToken via getPartner("neopply") */
function createNeopplyIdToken(user, accessToken, opts) {
  const partner = getPartner("neopply");
  return createPartnerIdToken(partner, user, accessToken, opts);
}

module.exports = {
  getPartners,
  getPartner,
  readPartnerParams,
  isValidPartnerFlow,
  persistPartnerParams,
  clearPartnerParams,
  partnerParamsForView,
  partnerQueryString,
  createPartnerIdToken,
  sendBackToPartner,
  exchangePartnerToken,
  getNeopplyCorpsEmbedBaseUrl,
  buildNeopplyCorpsEmbedUrl,
  createNeopplyIdToken,
  // Compatibility aliases used by older call sites
  readNeopplyParams: readPartnerParams,
  isValidNeopplyFlow: isValidPartnerFlow,
  persistNeopplyParams: persistPartnerParams,
  clearNeopplyParams: clearPartnerParams,
  sendBackToNeopply: sendBackToPartner,
};
