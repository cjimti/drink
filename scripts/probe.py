#!/usr/bin/env python3
"""Ask the live origin what a visitor gets before any HTML runs.

    python3 scripts/probe.py            (make probe)

Read-only. It follows no redirect and writes nothing. The transport and
the response headers are Cloudflare settings, not files in the tree, so
no checker can see them; the 12 September rounds found an http page
answering 200 by hand. This makes that a command.

Not part of `make verify`: CI has no business passing or failing on the
state of the live edge, and a laptop with no signal would fail a tree
that is fine.

The CSP check reads the inline scripts out of the tree and wants every
one of their hashes named in script-src, enforced or report-only. It is
the tree that ships at the next tag, so a hash missing here is a script
the policy would block.
"""
import http.client
import ssl
import sys
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))
import stage  # noqa: E402  (path set above; there is no package here)

ROOT = Path(__file__).resolve().parent.parent
HOST = "fewbottles.com"
HOME = f"https://{HOST}/"
PAGE = f"https://{HOST}/drink/martini/"

# Plain addresses that have to leave http before they serve anything.
# www may go to https://www first and to the bare host from there; the
# point is that no page is ever served in plaintext.
REDIRECTS = [f"http://{HOST}/", f"http://www.{HOST}/",
             f"http://{HOST}/drink/martini/"]

# A Python from python.org on a Mac ships with no trust store until its
# Install Certificates script is run, and the system bundle is right
# there. Verification is never turned off; it is pointed at a bundle.
SYSTEM_CAS = Path("/etc/ssl/cert.pem")

# Header, and the value it must hold, or None for present at all.
HEADERS = [
    ("strict-transport-security", None),
    ("x-content-type-options", "nosniff"),
    ("referrer-policy", None),
    ("permissions-policy", None),
]
CSP = ("content-security-policy", "content-security-policy-report-only")


def tls():
    """A verifying context, on the system bundle if Python has none."""
    paths = ssl.get_default_verify_paths()
    if not (paths.cafile or paths.capath) and SYSTEM_CAS.exists():
        return ssl.create_default_context(cafile=str(SYSTEM_CAS))
    return ssl.create_default_context()


def fetch(url):
    """(status, {lower-case header: value}) without following anything."""
    parts = urlsplit(url)
    if parts.scheme == "https":
        conn = http.client.HTTPSConnection(parts.hostname, timeout=10,
                                           context=tls())
    else:
        conn = http.client.HTTPConnection(parts.hostname, timeout=10)
    try:
        conn.request("GET", parts.path or "/",
                     headers={"User-Agent": "fewbottles-probe"})
        res = conn.getresponse()
        return res.status, {k.lower(): v for k, v in res.getheaders()}
    finally:
        conn.close()


def check_redirect(url, status, headers):
    """(ok, line) for a plain address that should be a 301 onto https.

    Same path, https, a permanent status. A 302 is not good enough: a
    crawler keeps the http address as the canonical one.
    """
    where = headers.get("location", "")
    to = urlsplit(where)
    if (status in (301, 308) and to.scheme == "https"
            and to.path == urlsplit(url).path):
        return True, f"{url} {status} to {where}"
    said = f"{status} to {where}" if where else f"{status}, no Location"
    return False, f"{url} answers {said}, not a 301 to the same path on https"


def check_headers(url, headers):
    """(ok, line) per required response header."""
    out = []
    for name, value in HEADERS:
        got = headers.get(name)
        if got is None:
            out.append((False, f"{url} has no {name}"))
        elif value is not None and got.strip().lower() != value:
            out.append((False, f"{url} {name} is {got!r}, not {value!r}"))
        else:
            out.append((True, f"{url} {name}: {got}"))
    return out


def script_src(policy):
    """The script-src sources of a policy, or default-src when it has none."""
    found = {}
    for part in policy.split(";"):
        words = part.split()
        if words:
            found[words[0].lower()] = words[1:]
    return found.get("script-src", found.get("default-src"))


def check_csp(url, headers, hashes):
    """(ok, line) for the policy and each inline script it has to allow."""
    name = next((n for n in CSP if n in headers), None)
    if name is None:
        return [(False, f"{url} has no Content-Security-Policy, "
                        f"enforced or report-only")]
    sources = script_src(headers[name])
    if sources is None:
        return [(False, f"{url} {name} has no script-src or default-src")]
    out = [(True, f"{url} {name} present")]
    if "'unsafe-inline'" in sources:
        out.append((False, f"{url} script-src allows 'unsafe-inline'"))
    for key, pages in hashes.items():
        if f"'{key}'" in sources:
            out.append((True, f"{url} script-src names {pages[0]}'s script"))
        else:
            out.append((False, f"{url} script-src does not name '{key}' "
                               f"({pages[0]}, {len(pages)} page(s))"))
    return out


def probe(hashes):
    """Every check against the live site, as (ok, line)."""
    out = []
    for url in REDIRECTS:
        try:
            status, headers = fetch(url)
        except (OSError, http.client.HTTPException) as e:
            out.append((False, f"{url} did not answer: {e}"))
            continue
        out.append(check_redirect(url, status, headers))
    for url in (HOME, PAGE):
        try:
            _, headers = fetch(url)
        except (OSError, http.client.HTTPException) as e:
            out.append((False, f"{url} did not answer: {e}"))
            continue
        out += check_headers(url, headers)
        out += check_csp(url, headers, hashes)
    return out


def main():
    """Print one line per check; exit non-zero when any is short."""
    hashes = stage.inline_hashes(ROOT, stage.tracked())
    results = probe(hashes)
    for ok, line in results:
        print(f"  {'probe ' if ok else 'PROBE '}  {line}")
    bad = sum(1 for ok, _ in results if not ok)
    if bad:
        print(f"  PROBE   {bad} of {len(results)} check(s) short on the "
              f"live site")
        return 1
    print(f"  probe   {len(results)} check(s) hold on the live site")
    return 0


if __name__ == "__main__":
    sys.exit(main())
