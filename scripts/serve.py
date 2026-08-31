#!/usr/bin/env python3
"""Dev server that refuses to let the browser cache anything.

`python3 -m http.server` sends no Cache-Control header. Chrome then falls
back to heuristic freshness — roughly 10% of the file's age — and serves a
stale app.css without so much as a revalidation request. Editing CSS and
seeing the old page is not a browser quirk worth living with, so every
response here goes out no-store.
"""
import sys
from functools import partial
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("  %s\n" % (fmt % args))


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = partial(NoCacheHandler, directory=str(ROOT))

    # Bind before announcing anything. Printing the URL first means a port
    # already in use looks like a clean start followed by a traceback, and
    # the browser quietly keeps talking to whatever else is on that port.
    try:
        server = HTTPServer(("", port), handler)
    except OSError as err:
        if err.errno in (48, 98):  # EADDRINUSE on macOS / Linux
            sys.exit(
                f"port {port} is already in use — nothing was started.\n"
                f"  find it:  lsof -ti:{port}\n"
                f"  kill it:  lsof -ti:{port} | xargs kill\n"
                f"  or:       make serve PORT={port + 1}"
            )
        raise

    print(f"serving {ROOT} on http://localhost:{port}", flush=True)
    print("no-store — every reload gets the file as it is on disk", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped", flush=True)


if __name__ == "__main__":
    main()
