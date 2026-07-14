const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64UrlEncode(input) {
  const bytes = input instanceof Uint8Array ? input : encoder.encode(String(input));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlDecode(input) {
  const padded = input.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function importKey(secret, usage) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usage,
  );
}

export async function signJwt(payload, secret) {
  if (!secret || secret.length < 32) throw new Error("SESSION_JWT_SECRET must contain at least 32 characters");
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${header}.${body}`;
  const signature = await crypto.subtle.sign("HMAC", await importKey(secret, ["sign"]), encoder.encode(signingInput));
  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export async function verifyJwt(token, secret, options = {}) {
  if (!token || !secret) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(decoder.decode(base64UrlDecode(parts[0])));
    if (header.alg !== "HS256" || header.typ !== "JWT") return null;
    const valid = await crypto.subtle.verify(
      "HMAC",
      await importKey(secret, ["verify"]),
      base64UrlDecode(parts[2]),
      encoder.encode(`${parts[0]}.${parts[1]}`),
    );
    if (!valid) return null;
    const payload = JSON.parse(decoder.decode(base64UrlDecode(parts[1])));
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(payload.exp) || payload.exp <= now) return null;
    if (payload.nbf && payload.nbf > now + 30) return null;
    if (options.purpose && payload.purpose !== options.purpose) return null;
    return payload;
  } catch {
    return null;
  }
}

export function randomBase64Url(size = 32) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export async function sha256Base64Url(value) {
  return base64UrlEncode(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

export async function sha256Hex(value) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
