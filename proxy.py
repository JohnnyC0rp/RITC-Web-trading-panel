#!/usr/bin/env python3
"""Simple CORS-friendly proxy for RIT REST API (GET/POST/DELETE)."""

from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import base64
import json
import urllib.request


def _load_creds() -> dict:
    path = Path(__file__).parent / "creds" / "rit_rest.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def _build_auth_header(creds: dict) -> str | None:
    if creds.get("authorization_header"):
        return creds["authorization_header"]
    if creds.get("username") and creds.get("password"):
        token = base64.b64encode(f"{creds['username']}:{creds['password']}".encode()).decode()
        return f"Basic {token}"
    return None


CREDS = _load_creds()
TARGET_REMOTE = CREDS.get("dma_base_url") or CREDS.get("base_url") or "http://flserver.rotman.utoronto.ca:10001"
TARGET_LOCAL = CREDS.get("client_base_url") or "http://localhost:9999"
AUTH_HEADER = _build_auth_header(CREDS)


class ProxyHandler(BaseHTTPRequestHandler):
    def _forward(self, method):
        target_mode = (self.headers.get("X-Proxy-Target") or "remote").strip().lower()
        override_base = (self.headers.get("X-Proxy-Base") or "").strip()
        if override_base and override_base.startswith(("http://", "https://")):
            target = override_base
        else:
            target = TARGET_LOCAL if target_mode == "local" else TARGET_REMOTE
        url = target + self.path
        body = None
        if method in {"POST", "PUT", "PATCH"}:
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length) if length else None

        headers = {"Accept": "application/json"}
        # Forward auth headers if present, otherwise use built-in remote auth.
        auth = self.headers.get("Authorization")
        api_key = self.headers.get("X-API-Key")
        if auth:
            headers["Authorization"] = auth
        elif target_mode != "local" and AUTH_HEADER:
            headers["Authorization"] = AUTH_HEADER

        if api_key:
            headers["X-API-Key"] = api_key

        if body is not None:
            headers["Content-Type"] = self.headers.get("Content-Type", "application/json")

        req = urllib.request.Request(url, data=body, headers=headers, method=method)
        with urllib.request.urlopen(req) as resp:
            self.send_response(resp.status)
            for k, v in resp.headers.items():
                if k.lower() in {"transfer-encoding", "content-encoding"}:
                    continue
                self.send_header(k, v)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header(
                "Access-Control-Allow-Headers",
                "Authorization, Content-Type, X-API-Key, X-Proxy-Target, X-Proxy-Base",
            )
            self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
            self.end_headers()
            self.wfile.write(resp.read())

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header(
            "Access-Control-Allow-Headers",
            "Authorization, Content-Type, X-API-Key, X-Proxy-Target, X-Proxy-Base",
        )
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.end_headers()

    def do_GET(self):
        self._forward("GET")

    def do_POST(self):
        self._forward("POST")

    def do_DELETE(self):
        self._forward("DELETE")


if __name__ == "__main__":
    print("Proxy running at http://0.0.0.0:3001 (LAN accessible)")
    print("Remote target:", TARGET_REMOTE)
    print("Local target :", TARGET_LOCAL)
    HTTPServer(("0.0.0.0", 3001), ProxyHandler).serve_forever()
