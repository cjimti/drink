# fewbottles.com — no build step, so `verify` is the whole pipeline.

.DEFAULT_GOAL := verify
.PHONY: verify check json syntax lint code style test menu kin llms pages \
        cards assets stage serve icons tools events stats clean

## verify — run every check, then stamp the review-gate sentinel
verify: check
	@scripts/verify-sentinel.sh

## check — everything CI runs
check: json syntax lint test menu assets
	@echo "all checks passed"

## lint — the standard, since there is no eslint and never will be
##
## code:  size, cyclomatic complexity, nesting and the foot-guns, in
##        JavaScript, Python and shell alike
## style: the house rules out of CLAUDE.md — colour tokens with a light
##        counterpart, no shadows, the three fonts, an accessible page,
##        and the three app contracts (TRACK_KEYS, the delegated click
##        wiring, the shelf read as a BigInt)
lint: code style

code:
	@python3 scripts/check_code.py

style:
	@python3 scripts/check_style.py

## test — break every rule on purpose and check that something notices.
##        A linter nobody has seen fail passes everything.
test:
	@python3 scripts/test_checks.py

## json — every data file parses
json:
	@for f in data/*.json manifest.webmanifest; do \
		python3 -m json.tool "$$f" > /dev/null || exit 1; \
		echo "  json    $$f"; \
	done

## syntax — the two scripts the browser loads
syntax:
	@node --check assets/app.js && echo "  syntax  assets/app.js"
	@node --check sw.js && echo "  syntax  sw.js"
	@python3 -m py_compile scripts/*.py
	@echo "  syntax  scripts/*.py"

## menu — every shorthand code agrees with the build it stands for,
##         data/kin.json still matches those builds, the agent dumps,
##         the drink pages and the share cards still match the menu
menu:
	@python3 scripts/check_menu.py
	@python3 scripts/kin.py --check
	@python3 scripts/llms.py --check
	@python3 scripts/pages.py --check
	@python3 scripts/cards.py --check

## kin — regenerate data/kin.json from the builds
kin:
	@python3 scripts/kin.py

## llms — regenerate llms.txt and llms-full.txt from the menu
llms:
	@python3 scripts/llms.py

## pages — regenerate drink/<id>/index.html for every drink, and the sitemap
pages:
	@python3 scripts/pages.py

## cards — redraw whichever share cards in assets/cards are stale.
##         Needs Pillow and rsvg-convert, like icons; the check does not.
cards:
	@python3 scripts/cards.py

## assets — every file index.html asks for is actually here
assets:
	@python3 scripts/check_assets.py

## stage — rehearse the deploy: copy what the site serves into DEST and
##         stamp it with V, exactly as a tag does. DEST must be empty.
V ?= v0.0.0
DEST ?= _site
stage:
	@python3 scripts/stage.py $(V) $(DEST)

## serve — fetch() needs http://, not file://; sends no-store so edits show up
##
## Port 8010, not 8000, and that is deliberate. A service worker owns a
## whole origin, and every static site here serves './', 'index.html' and
## 'assets/app.js'. Two projects sharing localhost:8000 means one can
## answer for the other, cache-first, with no server running at all. One
## port per project keeps the origins apart.
PORT ?= 8010
serve:
	@python3 scripts/serve.py $(PORT)

## stats — the figures the copy quotes, off the data that owns them.
##         The last paragraph is the README sentence, ready to paste.
stats:
	@python3 scripts/stats.py

## events — the custom events app.js pushes to the dataLayer, read off
##          the source rather than kept in a second list that goes stale
events:
	@grep -o "track('[a-z_]*'" assets/app.js | sed "s/track('//;s/'//" | sort -u

## icons — regenerate the home-screen PNG and the social card
icons:
	@python3 scripts/make-icons.py
	@python3 scripts/make-og.py

## tools — turn freshly generated plates in assets/tools into ink on
##         nothing: corner letter painted out, alpha off the drawing,
##         half size. Safe to run on plates already converted.
tools:
	@python3 scripts/make-tools.py

## unstick — a worker from an earlier session is answering for this origin
unstick:
	@echo "A service worker owns an origin, not a project, and serves"
	@echo "cache-first even with no server running. To clear one by hand:"
	@echo ""
	@echo "  Chrome  DevTools > Application > Service Workers > Unregister"
	@echo "          then Application > Storage > Clear site data"
	@echo "  or      visit chrome://serviceworker-internals and unregister"
	@echo ""
	@echo "This project serves on $(PORT) so it never shares an origin with"
	@echo "a sibling site. Loading any page here off https now evicts a"
	@echo "worker automatically, so this should not come up twice."

clean:
	@rm -rf scripts/__pycache__ .claude/.last-verify-passed _site
