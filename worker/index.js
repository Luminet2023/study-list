const API_PREFIX = "/api";
const API_GONE_BODY = Object.freeze({
  error: "worker_api_gone",
  message: "The Cloudflare Worker API has been retired.",
});

function isLegacyApiPath(pathname) {
  return pathname === API_PREFIX || pathname.startsWith(`${API_PREFIX}/`);
}

function apiGone() {
  return Response.json(API_GONE_BODY, {
    status: 410,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export default {
  fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (isLegacyApiPath(pathname)) return apiGone();
    return env.ASSETS.fetch(request);
  },
};
