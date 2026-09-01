const jwt = require("jsonwebtoken");

const NEOPPLY_ALLOWED_REDIRECT_URIS = new Set([
  "https://neopply.com/auth/boise-gems/callback",
  "http://localhost:3000/auth/boise-gems/callback",
]);

const SESSION_KEY = "neopplyPartner";

function readNeopplyParams(req) {
  const fromBody = req.body || {};
  const fromQuery = req.query || {};
  const fromSession = (req.session && req.session[SESSION_KEY]) || {};
  return {
    client_id: fromBody.client_id || fromQuery.client_id || fromSession.client_id || "",
    redirect_uri: fromBody.redirect_uri || fromQuery.redirect_uri || fromSession.redirect_uri || "",
    state: fromBody.state || fromQuery.state || fromSession.state || "",
  };
}

function isValidNeopplyFlow(params) {
  return (
    params.client_id === "neopply" &&
    NEOPPLY_ALLOWED_REDIRECT_URIS.has(params.redirect_uri) &&
    !!params.state
  );
}

function persistNeopplyParams(req, params) {
  if (!req.session) return false;
  if (!isValidNeopplyFlow(params)) {
    delete req.session[SESSION_KEY];
    return false;
  }
  req.session[SESSION_KEY] = {
    client_id: params.client_id,
    redirect_uri: params.redirect_uri,
    state: params.state,
  };
  return true;
}

function clearNeopplyParams(req) {
  if (req.session) delete req.session[SESSION_KEY];
}

function partnerParamsForView(req) {
  const params = readNeopplyParams(req);
  if (!isValidNeopplyFlow(params)) {
    return { client_id: "", redirect_uri: "", state: "" };
  }
  return params;
}

function partnerQueryString(params) {
  if (!isValidNeopplyFlow(params)) return "";
  const qs = new URLSearchParams({
    client_id: params.client_id,
    redirect_uri: params.redirect_uri,
    state: params.state,
  });
  return "?" + qs.toString();
}

function createNeopplyIdToken(user, accessToken, { expiresIn = "2m" } = {}) {
  const secret = process.env.NEOPPLY_PARTNER_SECRET;
  if (!secret) return null;
  return jwt.sign(
    {
      sub: String(user.id),
      email: user.email,
      access_token: accessToken,
      aud: "neopply",
    },
    secret,
    { algorithm: "HS256", expiresIn }
  );
}

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
  const idToken = createNeopplyIdToken(user, accessToken, { expiresIn: "15m" });
  if (!idToken) return null;
  const url = new URL(getNeopplyCorpsEmbedBaseUrl(section));
  url.searchParams.set("id_token", idToken);
  return url.toString();
}

function sendBackToNeopply(req, res, { user, accessToken }) {
  const params = readNeopplyParams(req);
  if (!isValidNeopplyFlow(params)) return false;

  const idToken = createNeopplyIdToken(user, accessToken);
  if (!idToken) {
    console.error("NEOPPLY_PARTNER_SECRET is not configured");
    return false;
  }

  clearNeopplyParams(req);

  const url = new URL(params.redirect_uri);
  url.searchParams.set("id_token", idToken);
  url.searchParams.set("state", params.state);
  res.redirect(url.toString());
  return true;
}

module.exports = {
  NEOPPLY_ALLOWED_REDIRECT_URIS,
  readNeopplyParams,
  isValidNeopplyFlow,
  persistNeopplyParams,
  clearNeopplyParams,
  partnerParamsForView,
  partnerQueryString,
  createNeopplyIdToken,
  getNeopplyCorpsEmbedBaseUrl,
  buildNeopplyCorpsEmbedUrl,
  sendBackToNeopply,
};
