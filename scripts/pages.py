#!/usr/bin/env python3
"""One static page per drink, so a link to a drink is a link to a page.

A hash never leaves the phone. Every crawler that unfurls a link, from
iMessage to Facebook to Googlebot, fetches the address before the `#`
and reads the meta tags it finds there, with no JavaScript run. So the
address the Share tab hands out is `fewbottles.com/drink/<id>/`, and
this script writes that page: the name in the title, the recipe on the
page, the card image in the og tags, a Recipe block of JSON-LD naming
who pours it, and a link into the app. The page is readable with
nothing running, which is the whole point of it.

`python3 scripts/pages.py` writes drink/<id>/index.html for every drink
on the menu and sitemap.xml over the lot. `--check` refuses a stale,
missing or orphaned page the way kin.py refuses a stale kin.json.
"""
import json
import sys
from html import escape
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import llms  # noqa: E402  (path set above; there is no package here)

ROOT = Path(__file__).resolve().parent.parent
PAGES = ROOT / "drink"
SITEMAP = ROOT / "sitemap.xml"
ORIGIN = "https://fewbottles.com"
AUTHOR = "Craig Johnston"
AUTHOR_URL = "https://imti.co/"
GTM = "GTM-WTFK3CCS"
KIN_SHOWN = 6

# The two faces the first screen is set in, served from here. A drink
# page is where a shared link lands, so it preloads them like the app
# does. crossorigin is not optional even same-origin: a font is
# fetched in CORS mode, and a preload that does not say so is fetched
# twice.
PRELOAD = ("montserrat-500-800-latin.woff2", "lato-400-latin.woff2")

GTM_HEAD = (
    "<!-- Google Tag Manager -->\n"
    "<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':\n"
    "new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],\n"
    "j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=\n"
    "'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);\n"
    f"}})(window,document,'script','dataLayer','{GTM}');</script>\n"
    "<!-- End Google Tag Manager -->\n")

GTM_BODY = (
    "<!-- Google Tag Manager (noscript) -->\n"
    f'<noscript><iframe src="https://www.googletagmanager.com/ns.html?id={GTM}"\n'
    'height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>\n'
    "<!-- End Google Tag Manager (noscript) -->\n")

MARK = ('<svg class="topbar__mark" viewBox="0 0 40 40" aria-hidden="true">'
        '<rect width="40" height="40" rx="2"/>'
        '<path d="M13 11h14l-5.4 8.4v7.4h4.1v1.9h-11.4v-1.9h4.1v-7.4z"/></svg>')


def page_url(did):
    return f"{ORIGIN}/drink/{did}/"


def card_url(did):
    return f"{ORIGIN}/assets/cards/{did}.png"


def pours(drink, by_id):
    """`1 oz Apple brandy`, one per build entry, the amount decoded."""
    return [llms.pour_text(part, by_id) for part in drink["build"]]


def description(drink, lines, serve):
    """The meta description: what is in it, then how it is served."""
    return f"{drink['name']}: {', '.join(lines)}. {drink['method'].capitalize()}, {serve.lower()}."


def head(drink, ctx):
    """Everything a crawler reads, and the styles a person does."""
    did, name = drink["id"], escape(drink["name"])
    url, card = page_url(did), card_url(did)
    desc = escape(ctx["desc"])
    alt = escape(f"{drink['name']}, the recipe on a card: {ctx['alt']}.")
    return (
        '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        + GTM_HEAD +
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
        f"<title>{name}, few bottles</title>\n"
        f'<meta name="description" content="{desc}">\n'
        f'<meta name="author" content="{AUTHOR}">\n'
        '<meta name="robots" content="index, follow">\n'
        '<meta name="color-scheme" content="dark light">\n'
        '<meta name="theme-color" content="#121211" media="(prefers-color-scheme: dark)">\n'
        '<meta name="theme-color" content="#FFFFFF" media="(prefers-color-scheme: light)">\n'
        f'<link rel="canonical" href="{url}">\n'
        f'<link rel="author" href="{AUTHOR_URL}">\n'
        '<link rel="icon" href="/assets/icon.svg" type="image/svg+xml">\n'
        '<link rel="apple-touch-icon" href="/assets/icon-180.png">\n'
        '<meta property="og:type" content="article">\n'
        '<meta property="og:site_name" content="few bottles">\n'
        '<meta property="og:locale" content="en_US">\n'
        f'<meta property="og:url" content="{url}">\n'
        f'<meta property="og:title" content="{name}">\n'
        f'<meta property="og:description" content="{desc}">\n'
        f'<meta property="og:image" content="{card}">\n'
        '<meta property="og:image:type" content="image/png">\n'
        '<meta property="og:image:width" content="1200">\n'
        '<meta property="og:image:height" content="630">\n'
        f'<meta property="og:image:alt" content="{alt}">\n'
        f'<meta property="article:author" content="{AUTHOR_URL}">\n'
        '<meta name="twitter:card" content="summary_large_image">\n'
        '<meta name="twitter:site" content="@cjimti">\n'
        '<meta name="twitter:creator" content="@cjimti">\n'
        f'<meta name="twitter:title" content="{name}">\n'
        f'<meta name="twitter:description" content="{desc}">\n'
        f'<meta name="twitter:image" content="{card}">\n'
        f'<meta name="twitter:image:alt" content="{alt}">\n'
        '<script type="application/ld+json">\n' + ctx["ld"] + "\n</script>\n"
        + "".join(f'<link rel="preload" href="/assets/fonts/{f}" '
                  'as="font" type="font/woff2" crossorigin>\n'
                  for f in PRELOAD)
        + '<link rel="stylesheet" href="/assets/app.css">\n'
        "</head>\n")


def json_ld(drink, ctx):
    """A Recipe that names its author, on the same ids index.html uses."""
    did = drink["id"]
    steps = [ctx["how"], f"Serve: {ctx['serve'].lower()}."]
    recipe = {
        "@type": "Recipe",
        "@id": page_url(did) + "#recipe",
        "name": drink["name"],
        "url": page_url(did),
        "image": card_url(did),
        "description": ctx["desc"],
        "author": {"@id": f"{ORIGIN}/#person"},
        "isPartOf": {"@id": f"{ORIGIN}/#website"},
        "recipeCategory": "Cocktail",
        "recipeYield": "1 drink",
        "recipeIngredient": ctx["lines"],
        "recipeInstructions": [{"@type": "HowToStep", "text": s} for s in steps],
        "keywords": ", ".join(k for k in (ctx["family"], drink["method"], ctx["shape"]) if k),
    }
    person = {
        "@type": "Person",
        "@id": f"{ORIGIN}/#person",
        "name": AUTHOR,
        "url": AUTHOR_URL,
        "sameAs": [AUTHOR_URL, "https://x.com/cjimti", "https://github.com/cjimti"],
    }
    site = {
        "@type": "WebSite",
        "@id": f"{ORIGIN}/#website",
        "url": f"{ORIGIN}/",
        "name": "few bottles",
        "publisher": {"@id": f"{ORIGIN}/#person"},
    }
    crumbs = {
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "few bottles", "item": f"{ORIGIN}/"},
            {"@type": "ListItem", "position": 2, "name": drink["name"], "item": page_url(did)},
        ],
    }
    graph = {"@context": "https://schema.org", "@graph": [recipe, person, site, crumbs]}
    return json.dumps(graph, indent=2, ensure_ascii=False)


def topbar():
    return (
        '<header class="topbar">\n'
        f'  <a class="topbar__brand" href="/">{MARK}'
        '<span class="topbar__name">fewbottles.com</span></a>\n'
        '  <nav class="topbar__tabs" aria-label="Sections">\n'
        '    <a class="toptab" href="/#menu">Menu</a>\n'
        '    <a class="toptab" href="/#bar">Bar</a>\n'
        '    <a class="toptab" href="/#key">Key</a>\n'
        '    <a class="toptab" href="/#info">Info</a>\n'
        "  </nav>\n</header>\n")


def kin_list(drink, ctx):
    """The nearest drinks of the same shape, each a link to its own page."""
    rows = ctx["kin"].get(drink["id"], {}).get("kin", [])[:KIN_SHOWN]
    rows = [r for r in rows if r["id"] in ctx["names"]]
    if not rows:
        return ""
    items = "".join(
        f'    <li><a href="/drink/{r["id"]}/">{escape(ctx["names"][r["id"]])}</a>'
        f'<span class="page__why">{escape(r["why"])}</span></li>\n' for r in rows)
    shape = ctx["shape"] or "shape"
    return (f'  <section class="page__section">\n    <h2>Same shape, other bottles</h2>\n'
            f'    <p class="page__note">The {shape} family, with the bottle that changed.</p>\n'
            f'    <ul class="page__kin">\n{items}    </ul>\n  </section>\n')


def article(drink, ctx):
    """The drink, spelled out: what goes in, how it is made, what it is."""
    did = drink["id"]
    lines = "".join(f"      <li>{escape(p)}</li>\n" for p in ctx["lines"])
    html = (
        f'  <p class="page__eyebrow">{escape(ctx["family"])}, {escape(drink["method"])}</p>\n'
        f'  <h1 class="page__name">{escape(drink["name"])}</h1>\n'
        # ARIA has no aria-label on a paragraph, so a reader dropped the
        # word and read a bare 2,1,1,cl. The word goes in the paragraph
        # instead, where nothing can ignore it.
        f'  <p class="page__code"><span class="sr-only">Barline </span>'
        f'{escape(drink["code"])}</p>\n'
        f'  <ul class="page__pours">\n{lines}    </ul>\n'
        f'  <p class="page__method">{escape(ctx["how"])}</p>\n'
        f'  <p class="page__serve">{escape(ctx["serve"])}.</p>\n'
        f'  <p class="page__open"><a class="btn" href="/#drink/{did}">Open in the menu</a></p>\n')
    if drink.get("taste"):
        html += (f'  <section class="page__section">\n    <h2>Taste</h2>\n'
                 f'    <p>{escape(drink["taste"])}</p>\n  </section>\n')
    if drink.get("history"):
        refs = "".join(
            f'      <li><a href="{escape(r["url"])}" rel="noopener">{escape(r["title"])}</a></li>\n'
            for r in drink.get("refs") or [] if r.get("title") and r.get("url"))
        html += (f'  <section class="page__section">\n    <h2>History</h2>\n'
                 f'    <p>{escape(drink["history"])}</p>\n'
                 + (f'    <ul class="recipe-refs">\n{refs}    </ul>\n' if refs else "")
                 + "  </section>\n")
    html += kin_list(drink, ctx)
    return html


def page(drink, ctx):
    n = ctx["count"]
    return (
        head(drink, ctx) + '<body class="page">\n' + GTM_BODY + topbar() +
        '<main id="main" class="page__main">\n<article class="page__drink">\n'
        + article(drink, ctx) +
        f'  <p class="page__all"><a href="/">All {n} drinks</a>, and which ones your own shelf pours.</p>\n'
        "</article>\n</main>\n"
        '<footer class="page__foot">\n'
        f'  <p>My shelf, my menu. <a href="{AUTHOR_URL}" rel="author">{AUTHOR}</a>, '
        f'<a href="/">fewbottles.com</a>.</p>\n'
        "</footer>\n</body>\n</html>\n")


def context(drink, tables):
    """Everything a page needs that is not on the drink object itself."""
    menu, by_id, notation, kin = tables
    families = {f["id"]: f["label"] for f in menu["families"]}
    labels = {p["id"]: p["label"] for p in kin.get("patterns", [])}
    row = kin.get("drinks", {}).get(drink["id"], {})
    lines = pours(drink, by_id)
    said = llms.serve_line(drink, notation, llms.garnish_codes(notation)).split(", ")
    # `Rocks, iced, lemon twist`: the glass leads, the rest reads on.
    serve = ", ".join(said[:1] + [p.lower() for p in said[1:]])
    ctx = {
        "count": len(menu["cocktails"]),
        "names": {d["id"]: d["name"] for d in menu["cocktails"]},
        "kin": kin.get("drinks", {}),
        "family": families.get(drink["family"], drink["family"]),
        "how": llms.method_line(drink, llms.methods_by_id(menu)),
        "shape": labels.get(row.get("pattern") or ""),
        "lines": lines,
        "serve": serve,
        "alt": f"{', '.join(lines)}, {drink['method']}, {serve.lower()}",
        "desc": description(drink, lines, serve),
    }
    ctx["ld"] = json_ld(drink, ctx)
    return ctx


def sitemap(menu):
    urls = [f"{ORIGIN}/"] + [page_url(d["id"]) for d in menu["cocktails"]]
    body = "".join(
        f"  <url>\n    <loc>{u}</loc>\n"
        f"    <changefreq>{'weekly' if i == 0 else 'monthly'}</changefreq>\n"
        f"    <priority>{'1.0' if i == 0 else '0.6'}</priority>\n  </url>\n"
        for i, u in enumerate(urls))
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
            + body + "</urlset>\n")


def render():
    """{relative path: text} for every file this script owns."""
    menu = llms.load("cocktails.json")
    bar = llms.load("bar.json")
    notation = llms.load("notation.json")
    kin = llms.load("kin.json")
    by_id = {i["id"]: i for i in bar["ingredients"]}
    tables = (menu, by_id, notation, kin)
    out = {f"drink/{d['id']}/index.html": page(d, context(d, tables))
           for d in menu["cocktails"]}
    out["sitemap.xml"] = sitemap(menu)
    return out


def on_disk():
    """Every page under drink/, so an orphan is noticed."""
    return {str(p.relative_to(ROOT)) for p in PAGES.glob("*/index.html")}


def check_texts(texts, present):
    """Stale, missing or orphaned pages, as messages. Empty means clean."""
    errs = []
    for rel, body in sorted(texts.items()):
        path = ROOT / rel
        if not path.exists():
            errs.append(f"{rel} is missing")
        elif path.read_text() != body:
            errs.append(f"{rel} is stale")
    for rel in sorted(present - set(texts)):
        errs.append(f"{rel} is for a drink no longer on the menu")
    return errs


def main(argv):
    texts = render()
    if "--check" in argv:
        errs = check_texts(texts, on_disk())
        for e in errs[:8]:
            print(f"  PAGES   {e}: run make pages")
        if len(errs) > 8:
            print(f"  PAGES   and {len(errs) - 8} more")
        if errs:
            return 1
        print(f"  pages   {len(texts) - 1} drink page(s) current, sitemap.xml lists them")
        return 0
    for rel in on_disk() - set(texts):
        (ROOT / rel).unlink()
        print(f"  pages   removed {rel}")
    for rel, body in texts.items():
        path = ROOT / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body)
    print(f"  pages   wrote {len(texts) - 1} drink page(s) and sitemap.xml")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
