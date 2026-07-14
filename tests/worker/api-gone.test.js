import { describe, expect, it, vi } from "vitest";

import worker from "../../worker/index.js";

function testEnv(assetResponse = new Response("asset")) {
  return {
    ASSETS: {
      fetch: vi.fn(async () => assetResponse),
    },
  };
}

describe("retired Cloudflare Worker API", () => {
  it.each([
    ["GET", "/api"],
    ["GET", "/api/"],
    ["GET", "/api/v1/auth/session"],
    ["POST", "/api/v1/auth/logout"],
    ["POST", "/api/v1/sync/exchange"],
    ["OPTIONS", "/api/v1/auth/session"],
  ])("returns the stable 410 response for %s %s", async (method, path) => {
    const env = testEnv();
    const response = await worker.fetch(new Request(`https://stellafortuna.luminet.cn${path}`, {
      method,
    }), env);

    expect(response.status).toBe(410);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.json()).toEqual({
      error: "worker_api_gone",
      message: "The Cloudflare Worker API has been retired.",
    });
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it("returns HTTP 410 instead of upgrading legacy WebSocket requests", async () => {
    const env = testEnv();
    const response = await worker.fetch(new Request(
      "https://stellafortuna.luminet.cn/api/v1/sync/ws",
      {
        headers: {
          connection: "Upgrade",
          upgrade: "websocket",
          "sec-websocket-protocol": "stella-sync-v1",
        },
      },
    ), env);

    expect(response.status).toBe(410);
    expect(response.webSocket).toBeNull();
    expect(await response.json()).toMatchObject({ error: "worker_api_gone" });
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it.each([
    "/",
    "/day/2026-07-13",
    "/assets/app.js",
    "/apiary",
    "/api-docs",
  ])("keeps the static asset pipeline for %s", async (path) => {
    const assetResponse = new Response("asset");
    const env = testEnv(assetResponse);
    const request = new Request(`https://stellafortuna.luminet.cn${path}`);

    const response = await worker.fetch(request, env);

    expect(response).toBe(assetResponse);
    expect(env.ASSETS.fetch).toHaveBeenCalledOnce();
    expect(env.ASSETS.fetch).toHaveBeenCalledWith(request);
  });
});
