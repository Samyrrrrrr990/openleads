"""
The local-first web dashboard server — pure Python standard library.

``openleads web`` starts a :class:`~http.server.ThreadingHTTPServer` bound to
``127.0.0.1`` only, serves the pre-built single-page app from ``static/``, and
exposes the JSON API in :mod:`openleads.web.api`. There is **no framework, no
Node, and no network egress** beyond what the engine itself does — the app runs
entirely on the user's machine, which is the whole privacy pitch.

Long-running actions (find / send / run) stream newline-delimited JSON so the UI
can render progress live; the browser reads them with ``fetch().body.getReader()``.

Security model: the server only listens on loopback, but a page on *any* website you
visit can still try to reach ``http://127.0.0.1:8787``. So every request must carry a
loopback ``Host`` header (defeats DNS rebinding), every POST must be
``application/json`` (which a cross-site page can't send without a CORS preflight
this server never approves), and a cross-site ``Origin`` / ``Sec-Fetch-Site`` is
refused outright. Without these, a malicious page could export your CRM to its own
webhook or trigger a live send.
"""
from __future__ import annotations

import json
import os
import threading
import urllib.parse
import webbrowser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from openleads import settings
from openleads.web import api, workspace_api

STATIC_DIR = Path(__file__).resolve().parent / "static"

_MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".webmanifest": "application/manifest+json",
}

# Largest request body accepted (a pasted CSV of a few thousand rows fits easily).
MAX_BODY = 25 * 1024 * 1024
_LOOPBACK = {"127.0.0.1", "localhost", "::1", "[::1]"}


def allowed_hosts() -> set:
    """Host names the dashboard answers to: loopback, plus OPENLEADS_ALLOWED_HOSTS."""
    extra = os.environ.get("OPENLEADS_ALLOWED_HOSTS", "")
    return _LOOPBACK | {h.strip().lower() for h in extra.split(",") if h.strip()}


def host_name(host_header: str) -> str:
    """'127.0.0.1:8787' → '127.0.0.1'; '[::1]:8787' → '[::1]'."""
    h = (host_header or "").strip().lower()
    if h.startswith("["):
        return h[: h.find("]") + 1] if "]" in h else h
    return h.rsplit(":", 1)[0] if ":" in h else h


def is_same_origin(origin: str, host_header: str) -> bool:
    """True if a browser ``Origin`` header names this very server."""
    try:
        parts = urllib.parse.urlsplit(origin)
    except ValueError:
        return False
    return parts.scheme in ("http", "https") and parts.netloc.lower() == (host_header or "").lower()


# GET endpoints → callables taking the query-string params as a dict.
_GET_API = {
    "/api/state": api.state,
    "/api/sources": api.sources,
    "/api/settings": api.get_settings,
    "/api/doctor": api.doctor,
    "/api/providers": api.providers_presets,
    "/api/crm": api.crm,
    "/api/recipes": api.recipes_list,
    "/api/watchers": api.watchers,
    "/api/analytics": api.analytics,
}

# POST endpoints that return a single JSON document.
_POST_JSON = {
    "/api/verify": api.verify,
    "/api/write": api.write,
    "/api/settings": api.update_settings,
    "/api/crm": api.crm,
    "/api/recipes/save": api.recipes_save,
    "/api/recipes/delete": api.recipes_delete,
    "/api/watch/save": api.watch_save,
    "/api/watch/delete": api.watch_delete,
    "/api/export": api.export_leads,
}

# POST endpoints that stream NDJSON events via an ``emit`` callback.
_POST_STREAM = {
    "/api/find": api.find,
    "/api/send": api.send,
    "/api/run": api.run_pipeline,
    "/api/enrich": api.enrich,
    "/api/recipes/run": api.recipes_run,
}


# The workspace (People, Companies, Lists, Sequences, …) registers its own routes.
_GET_API.update(workspace_api.GET)
_POST_JSON.update(workspace_api.POST)
_POST_STREAM.update(workspace_api.STREAM)


class Handler(BaseHTTPRequestHandler):
    server_version = "OpenLeads"
    protocol_version = "HTTP/1.0"  # connection-close framing → simple streaming

    # ---- logging: quiet by default ------------------------------------- #
    def log_message(self, fmt, *args):  # noqa: A002 - match base signature
        pass

    # ---- helpers ------------------------------------------------------- #
    def _security_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        # Same-origin only; no third-party anything. The app is fully local.
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
            "script-src 'self'; connect-src 'self'; font-src 'self'; base-uri 'none'; "
            "form-action 'none'; frame-ancestors 'none'",
        )

    def _refuse(self, status, message: str) -> None:
        self._send_json({"error": message}, status)

    def _host_ok(self) -> bool:
        """Reject DNS-rebinding: the Host header must name this machine."""
        if host_name(self.headers.get("Host", "")) in allowed_hosts():
            return True
        self._refuse(HTTPStatus.FORBIDDEN, "host not allowed")
        return False

    def _cross_site(self) -> bool:
        """True (and refused) if the browser says this request came from another site."""
        site = (self.headers.get("Sec-Fetch-Site") or "").lower()
        origin = self.headers.get("Origin")
        # Sandboxed iframes and file:// pages send "Origin: null"; ours never do.
        if site == "cross-site" or (origin is not None
                                    and not is_same_origin(origin, self.headers.get("Host", ""))):
            self._refuse(HTTPStatus.FORBIDDEN, "cross-site request refused")
            return True
        return False

    def _send_json(self, payload, status=HTTPStatus.OK) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._security_headers()
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self):
        """The request's JSON object, or None after sending an error response."""
        ctype = (self.headers.get("Content-Type") or "").split(";", 1)[0].strip().lower()
        if ctype != "application/json":
            self._refuse(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, "send JSON (application/json)")
            return None
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = -1
        if length < 0 or length > MAX_BODY:
            self._refuse(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "request body too large")
            return None
        if not length:
            return {}
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8") or "{}")
        except (ValueError, UnicodeDecodeError):
            self._refuse(HTTPStatus.BAD_REQUEST, "malformed JSON body")
            return None
        if not isinstance(data, dict):
            self._refuse(HTTPStatus.BAD_REQUEST, "JSON body must be an object")
            return None
        return data

    def _serve_static(self, path: str) -> None:
        rel = path.lstrip("/") or "index.html"
        target = (STATIC_DIR / rel).resolve()
        # path-traversal guard: must stay inside STATIC_DIR
        if not str(target).startswith(str(STATIC_DIR)) or not target.is_file():
            # SPA fallback: unknown non-API path → index.html
            target = STATIC_DIR / "index.html"
            if not target.is_file():
                self._send_json({"error": "dashboard assets missing"},
                                HTTPStatus.NOT_FOUND)
                return
        body = target.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", _MIME.get(target.suffix, "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        # static assets are content-stable per build; index must stay fresh
        if target.suffix in (".css", ".js", ".woff2", ".svg"):
            self.send_header("Cache-Control", "no-cache")
        self._security_headers()
        self.end_headers()
        self.wfile.write(body)

    def _json_call(self, handler, payload: dict) -> None:
        """Run a JSON handler: ValueError → 400 with its message, anything else → 500."""
        try:
            result = handler(payload)
        except ValueError as e:
            self._send_json({"ok": False, "error": str(e)}, HTTPStatus.BAD_REQUEST)
            return
        except Exception as e:  # noqa: BLE001 — never leak a traceback to the client
            self._send_json({"ok": False, "error": str(e)}, HTTPStatus.INTERNAL_SERVER_ERROR)
            return
        self._send_json(result)

    def _stream(self, handler, payload: dict) -> None:
        """Run a streaming handler, flushing one NDJSON line per event."""
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self._security_headers()
        self.end_headers()

        def emit(event: dict) -> None:
            line = (json.dumps(event) + "\n").encode("utf-8")
            self.wfile.write(line)
            self.wfile.flush()

        try:
            handler(payload, emit)
        except BrokenPipeError:
            pass  # client navigated away mid-stream
        except Exception as e:  # noqa: BLE001 — never leak a traceback to the client
            try:
                emit({"type": "error", "message": str(e)})
            except OSError:
                pass

    # ---- routes -------------------------------------------------------- #
    def do_GET(self) -> None:  # noqa: N802
        if not self._host_ok():
            return
        path, _, qs = self.path.partition("?")
        if path in _GET_API:
            if self._cross_site():
                return
            params = {k: v[-1] for k, v in urllib.parse.parse_qs(qs).items()}
            self._json_call(_GET_API[path], params)
            return
        if path.startswith("/api/"):
            self._send_json({"error": "not found"}, HTTPStatus.NOT_FOUND)
            return
        self._serve_static(path)

    def do_POST(self) -> None:  # noqa: N802
        if not self._host_ok() or self._cross_site():
            return
        path = self.path.split("?", 1)[0]
        payload = self._read_json_body()
        if payload is None:
            return
        if path in _POST_STREAM:
            self._stream(_POST_STREAM[path], payload)
            return
        if path in _POST_JSON:
            self._json_call(_POST_JSON[path], payload)
            return
        self._send_json({"error": "not found"}, HTTPStatus.NOT_FOUND)


def serve(port: int | None = None, open_browser: bool = True,
          host: str = "127.0.0.1") -> int:
    """Start the dashboard. Blocks until Ctrl-C. Returns a process exit code."""
    port = int(port or settings.get("web_port") or 8787)
    try:
        httpd = ThreadingHTTPServer((host, port), Handler)
    except OSError as e:
        print(f"[!] could not bind {host}:{port} — {e}")
        print("    another OpenLeads dashboard may be running; try --port <N>.")
        return 2

    url = f"http://{host}:{port}/"
    line = "─" * 56
    print(f"\n  ┌{line}┐")
    print("  │  OpenLeads dashboard — running locally, privately       │")
    print(f"  │  {url:<53}│")
    print("  │  No data leaves this machine.  Press Ctrl-C to stop.    │")
    print(f"  └{line}┘\n")

    if open_browser:
        threading.Timer(0.4, lambda: webbrowser.open(url)).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  Dashboard stopped. Bye 👋")
    finally:
        httpd.server_close()
    return 0
