// NOTE: This is the code currently running on Cloudflare. Editing this file will NOT update behavior.
// Please ask Johnny for a manual redeploy on Cloudflare. This file is for local context only.
// Yes, we wish it updated itself too, but alas, no magic wands here.

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // Only allow this host (avoid open proxy abuse)
    const host = url.searchParams.get("host") || "flserver.rotman.utoronto.ca";
    if (host !== "flserver.rotman.utoronto.ca") {
      return new Response("Host not allowed", { status: 403, headers: corsHeaders() });
    }

    // Allow a port override from frontend
    const port = url.searchParams.get("port") || "16530";
    if (!/^\d+$/.test(port)) {
      return new Response("Invalid port", { status: 400, headers: corsHeaders() });
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // Build target URL without proxy-control params
    const targetBase = `http://${host}:${port}`;
    const targetUrl = new URL(url.pathname, targetBase);
    url.searchParams.delete("host");
    url.searchParams.delete("port");
    targetUrl.search = url.searchParams.toString();

    const init = {
      method: request.method,
      headers: new Headers(request.headers),
      body: request.method === "GET" || request.method === "HEAD" ? null : request.body,
    };

    const resp = await fetch(targetUrl.toString(), init);
    const headers = new Headers(resp.headers);
    corsHeaders(headers);
    return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers });
  },
};

function corsHeaders(headers = new Headers()) {
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    "Authorization,Content-Type,Accept,X-API-Key,X-Proxy-Target,X-Proxy-Base"
  );
  return headers;
}
