"""
The local-first web dashboard server — pure Python standard library.

``openleads web`` starts a :class:`~http.server.ThreadingHTTPServer` bound to
``127.0.0.1`` only, serves the pre-built single-page app from ``static/``, and
exposes the JSON API in :mod:`openleads.web.api`. There is **no framework, no
Node, and no network egress** beyond what the engine itself does — the app runs
entirely on the user's machine, which is the whole privacy pitch.

Long-running actions (find / send / run) stream newline-delimited JSON so the UI
can render progress live; the browser reads them with ``fetch().body.getReader()``.
"""
from __future__ import annotations

import json
import threading
import webbrowser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from openleads import settings
from openleads.web import api

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

# GET endpoints → zero-arg callables returning a JSON-able dict.
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
        # Same-origin only; no third-party anything. The app is fully local.
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
            "script-src 'self'; connect-src 'self'; font-src 'self'; base-uri 'none'; "
            "form-action 'none'",
        )

    def _send_json(self, payload, status=HTTPStatus.OK) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._security_headers()
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8") or "{}")
            return data if isinstance(data, dict) else {}
        except (ValueError, UnicodeDecodeError):
            return {}

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
        path = self.path.split("?", 1)[0]
        if path in _GET_API:
            try:
                self._send_json(_GET_API[path]())
            except Exception as e:  # noqa: BLE001
                self._send_json({"error": str(e)}, HTTPStatus.INTERNAL_SERVER_ERROR)
            return
        if path.startswith("/api/"):
            self._send_json({"error": "not found"}, HTTPStatus.NOT_FOUND)
            return
        self._serve_static(path)

    def do_POST(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0]
        payload = self._read_json_body()
        if path in _POST_STREAM:
            self._stream(_POST_STREAM[path], payload)
            return
        if path in _POST_JSON:
            try:
                self._send_json(_POST_JSON[path](payload))
            except Exception as e:  # noqa: BLE001
                self._send_json({"error": str(e)}, HTTPStatus.INTERNAL_SERVER_ERROR)
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
