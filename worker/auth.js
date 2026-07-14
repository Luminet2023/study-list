import { randomBase64Url, sha256Base64Url, sha256Hex, signJwt, verifyJwt } from "./jwt.js";

const AUTHORIZATION_ENDPOINT = "https://connect.linux.do/oauth2/authorize";
const TOKEN_ENDPOINT = "https://connect.linux.do/oauth2/token";
const USER_ENDPOINT = "https://connect.linux.do/api/user";
const SESSION_COOKIE = "stella_session";
const OAUTH_COOKIE = "stella_oauth";
const SESSION_SECONDS = 31 * 24 * 60 * 60;

function json(value, status = 200, headers = {}) {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store", ...headers },
  });
}

function parseCookies(request) {
  const cookies = {};
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    cookies[part.slice(0, separator).trim()] = decodeURIComponent(part.slice(separator + 1).trim());
  }
  return cookies;
}

function cookie(name, value, options = {}) {
  const segments = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "Secure", "SameSite=Lax"];
  if (options.maxAge !== undefined) segments.push(`Max-Age=${options.maxAge}`);
  return segments.join("; ");
}

function redirectUri(url, env) {
  return env.LINUXDO_REDIRECT_URI || `${url.origin}/api/v1/auth/callback`;
}

async function fetchJson(url, init) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("upstream timeout"), 10_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const value = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`Linux DO OAuth upstream returned ${response.status}: ${value?.error ?? "unknown error"}`);
    }
    return value;
  } finally {
    clearTimeout(timeout);
  }
}

function publicUser(payload) {
  return {
    id: payload.subject ?? payload.sub,
    username: payload.username ?? "",
    name: payload.displayName ?? payload.name ?? payload.username ?? "Linux DO 用户",
    avatarUrl: payload.avatarUrl ?? "",
    email: payload.email ?? "",
  };
}

function linuxDoProfile(payload, options = {}) {
  const subject = String(payload?.subject ?? payload?.sub ?? payload?.id ?? "");
  if (!subject) throw new Error("missing_user_subject");
  const email = typeof payload?.email === "string" && payload.email.trim()
    ? payload.email.trim()
    : undefined;
  return {
    subject,
    username: String(payload?.username ?? payload?.login ?? ""),
    displayName: String(payload?.displayName ?? payload?.name ?? payload?.username ?? payload?.login ?? "Linux DO 用户"),
    avatarUrl: String(payload?.avatarUrl ?? payload?.avatar_url ?? ""),
    ...(email ? { email } : {}),
    lastLoginAtMs: Number(options.lastLoginAtMs) || Date.now(),
  };
}

async function persistLinuxDoProfile(env, profile) {
  const ownerKey = await sha256Hex(`linuxdo:${profile.subject}`);
  return env.USER_SYNC.getByName(ownerKey).upsertUserProfile(profile, ownerKey);
}

export async function handleLinuxDoLogin(request, env) {
  const url = new URL(request.url);
  const state = randomBase64Url();
  const verifier = randomBase64Url(48);
  const challenge = await sha256Base64Url(verifier);
  const now = Math.floor(Date.now() / 1000);
  const oauthCookie = await signJwt({
    purpose: "linuxdo-oauth",
    state,
    verifier,
    returnTo: "/",
    iat: now,
    exp: now + 10 * 60,
  }, env.SESSION_JWT_SECRET);

  const authorize = new URL(AUTHORIZATION_ENDPOINT);
  authorize.searchParams.set("client_id", env.LINUXDO_CLIENT_ID);
  authorize.searchParams.set("redirect_uri", redirectUri(url, env));
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("scope", "openid profile email");
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "S256");
  return new Response(null, {
    status: 302,
    headers: {
      location: authorize.toString(),
      "set-cookie": cookie(OAUTH_COOKIE, oauthCookie, { maxAge: 10 * 60 }),
      "cache-control": "no-store",
    },
  });
}

export async function handleLinuxDoCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (url.searchParams.has("error")) return json({ error: "oauth_denied" }, 400);
  if (!code || !state) return json({ error: "missing_oauth_parameters" }, 400);

  const oauth = await verifyJwt(parseCookies(request)[OAUTH_COOKIE], env.SESSION_JWT_SECRET, {
    purpose: "linuxdo-oauth",
  });
  if (!oauth || oauth.state !== state || !oauth.verifier) return json({ error: "invalid_oauth_state" }, 400);

  const token = await fetchJson(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(url, env),
      code_verifier: oauth.verifier,
      client_id: env.LINUXDO_CLIENT_ID,
      client_secret: env.LINUXDO_CLIENT_SECRET,
    }),
  });
  if (!token?.access_token) return json({ error: "missing_access_token" }, 502);

  const user = await fetchJson(USER_ENDPOINT, {
    headers: { authorization: `Bearer ${token.access_token}`, accept: "application/json" },
  });
  const now = Math.floor(Date.now() / 1000);
  const profile = linuxDoProfile(user, { lastLoginAtMs: now * 1000 });
  const savedProfile = await persistLinuxDoProfile(env, profile);
  const session = await signJwt({
    iss: url.origin,
    aud: "stellafortuna",
    sub: savedProfile.subject,
    username: savedProfile.username,
    name: savedProfile.displayName,
    avatarUrl: savedProfile.avatarUrl,
    email: savedProfile.email ?? "",
    iat: now,
    nbf: now - 5,
    exp: now + SESSION_SECONDS,
  }, env.SESSION_JWT_SECRET);

  return new Response(null, {
    status: 302,
    headers: [
      ["location", oauth.returnTo || "/"],
      ["set-cookie", cookie(SESSION_COOKIE, session, { maxAge: SESSION_SECONDS })],
      ["set-cookie", cookie(OAUTH_COOKIE, "", { maxAge: 0 })],
      ["cache-control", "no-store"],
    ],
  });
}

export async function getSession(request, env) {
  return verifyJwt(parseCookies(request)[SESSION_COOKIE], env.SESSION_JWT_SECRET);
}

export async function handleSession(request, env) {
  const session = await getSession(request, env);
  if (!session) return json({ authenticated: false, user: null });
  const profile = await persistLinuxDoProfile(
    env,
    linuxDoProfile(session, { lastLoginAtMs: Number(session.iat) * 1000 }),
  );
  return json({ authenticated: true, user: publicUser(profile) });
}

export function handleLogout() {
  return json({ authenticated: false }, 200, {
    "set-cookie": cookie(SESSION_COOKIE, "", { maxAge: 0 }),
  });
}
