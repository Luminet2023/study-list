import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

import { signJwt } from "../worker/jwt.js";

function parseDevVars(source) {
  return Object.fromEntries(source
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const separator = line.indexOf("=");
      return [line.slice(0, separator), line.slice(separator + 1).replace(/^['"]|['"]$/gu, "")];
    }));
}

const targetSub = String(process.env.TARGET_LINUXDO_SUB ?? "395868").trim();
if (!/^\d+$/u.test(targetSub)) throw new Error("TARGET_LINUXDO_SUB 必须是数字 user.id");
const devVars = parseDevVars(await readFile(new URL("../.dev.vars", import.meta.url), "utf8"));
if (!devVars.SESSION_JWT_SECRET) throw new Error(".dev.vars 缺少 SESSION_JWT_SECRET");

const now = Math.floor(Date.now() / 1000);
const token = await signJwt({
  iss: "http://localhost:5173",
  aud: "stellafortuna",
  sub: targetSub,
  username: "Luminet",
  name: "Luminet",
  iat: now,
  nbf: now - 5,
  exp: now + 60 * 60,
}, devVars.SESSION_JWT_SECRET);

const server = createServer((request, response) => {
  if (request.url !== "/login") {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  response.writeHead(302, {
    location: "http://localhost:5173/#/raffle",
    "set-cookie": `stella_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600`,
    "cache-control": "no-store",
  });
  response.end();
});

server.listen(8790, "127.0.0.1", () => {
  console.log("Local test login ready: http://localhost:8790/login");
});
