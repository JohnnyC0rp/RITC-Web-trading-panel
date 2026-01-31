import http from "http";
import { request as httpsRequest } from "https";
import { request as httpRequest } from "http";
import { URL } from "url";

const TARGET_REMOTE = "http://flserver.rotman.utoronto.ca:10001";
const TARGET_LOCAL = "http://localhost:9999";
const AUTH_HEADER = "Basic WlVBSS0yOm9tZWdh";

const allowCors = (res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, X-API-Key, X-Proxy-Target"
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
};

const proxy = (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(200);
    allowCors(res);
    res.end();
    return;
  }

  const targetMode = (req.headers["x-proxy-target"] || "remote").toString().toLowerCase();
  const targetBase = targetMode === "local" ? TARGET_LOCAL : TARGET_REMOTE;
  const targetUrl = new URL(req.url, targetBase);
  const isHttps = targetUrl.protocol === "https:";
  const client = isHttps ? httpsRequest : httpRequest;

  const headers = { Accept: "application/json" };
  if (req.headers["authorization"]) {
    headers.Authorization = req.headers["authorization"];
  } else if (targetMode !== "local") {
    headers.Authorization = AUTH_HEADER;
  }
  if (req.headers["x-api-key"]) headers["X-API-Key"] = req.headers["x-api-key"];
  if (req.headers["content-type"]) headers["Content-Type"] = req.headers["content-type"];

  const proxyReq = client(
    {
      method: req.method,
      hostname: targetUrl.hostname,
      port: targetUrl.port,
      path: targetUrl.pathname + targetUrl.search,
      headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.statusMessage, proxyRes.headers);
      allowCors(res);
      proxyRes.pipe(res, { end: true });
    }
  );

  proxyReq.on("error", (err) => {
    res.writeHead(502, { "Content-Type": "application/json" });
    allowCors(res);
    res.end(JSON.stringify({ error: err.message }));
  });

  req.pipe(proxyReq, { end: true });
};

const server = http.createServer(proxy);
server.listen(3001, () => {
  console.log("Proxy running at http://localhost:3001");
  console.log("Remote target:", TARGET_REMOTE);
  console.log("Local target:", TARGET_LOCAL);
});
