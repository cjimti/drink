# drink.shoephone.net — no build step, so `verify` is the whole pipeline.

.DEFAULT_GOAL := verify
.PHONY: verify check json syntax menu assets serve icons clean

## verify — run every check, then stamp the review-gate sentinel
verify: check
	@scripts/verify-sentinel.sh

## check — everything CI runs
check: json syntax menu assets
	@echo "all checks passed"

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
	@python3 -m py_compile scripts/check_menu.py scripts/make-icons.py
	@echo "  syntax  scripts/*.py"

## menu — every shorthand code agrees with the build it stands for
menu:
	@python3 scripts/check_menu.py

## assets — every file index.html asks for is actually here
assets:
	@python3 scripts/check_assets.py

## serve — fetch() needs http://, not file://; sends no-store so edits show up
PORT ?= 8000
serve:
	@python3 scripts/serve.py $(PORT)

## icons — regenerate the home-screen icon
icons:
	@python3 scripts/make-icons.py

clean:
	@rm -rf scripts/__pycache__ .claude/.last-verify-passed
