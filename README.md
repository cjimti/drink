# fewbottles.com

The house cocktail menu, as a web app instead of a printed card. A
hundred-odd classics, two methods, one small bar. No build step, no
framework, no database — everything renders from three JSON files.

Live at **[fewbottles.com](https://fewbottles.com)**. `drink.shoephone.net`
still opens the menu and sends you here.

## What it does that paper cannot

**Decodes the shorthand.** Every drink carries the house code exactly as
printed — `2,1,q,3,10,2b,R` — and tapping it spells the drink out in
ounces, dashes, glass and garnish. The codes are contextual, so the
decoder reads each amount against the ingredient it belongs to: a bare
`2` is two ounces of rye and two dashes of Angostura.

**Answers "what can I actually make?"** The Bar tab is a shelf
inventory. Tick the bottles you own and the menu marks what is pourable,
what is one bottle short, and which bottle it is. The whole point of
this bar is range from few bottles, so every unopened bottle shows what
it would add — in drinks unlocked, not drinks it merely appears in.

That number is frequently surprising. From gin, bourbon, both vermouths,
two bitters and the staples you can pour 14 drinks; the best next bottle
is not a spirit at all but orange liqueur, at +9.

**Turns the shelf into a menu.** The count on the Bar tab is a way in,
not a statistic — tapping it opens the list it counts, formatted as a
menu with its own masthead. It prints, so the thing you hand a guest can
be regenerated from whatever is actually on the shelf that night.

**Filters the way you choose a drink.** Stirred or shaken, then by any
spirit or modifier, then by what the shelf can actually support.
Families regroups the same list by shape — Martini, Sour, Daisy — so
the Manhattan sits with the Martini, not just under bourbon.

**Names the other drinks of the same shape.** A Kin pane on every recipe
lists the nearest swaps (`scotch for bourbon`) and leads through to the
family those drinks sit in.

## Layout

| Path | What it is |
|------|-----------|
| `index.html` | The whole shell. Three tabs, no router beyond the hash. |
| `assets/app.js` | Decoder, filters, and the marginal-gain engine. |
| `assets/app.css` | Every colour is a token, defined twice — dark and light. |
| `data/cocktails.json` | The menu. Each drink carries both a `code` and a `build`. |
| `data/bar.json` | Every bottle any drink can call for, garnish included. |
| `data/notation.json` | The shorthand key, and what the decoder reads from. |
| `data/kin.json` | Generated families of shape, and each drink's nearest neighbours. |
| `scripts/check_menu.py` | Regenerates each code from its build and refuses a mismatch. |
| `scripts/kin.py` | Rebuilds `data/kin.json` from the builds. `--check` refuses a drift. |
| `scripts/check_assets.py` | Missing files, and ids `app.js` reaches for that nothing renders. |
| `llms.txt` | Map for agents: what this is, and a one-line index of every drink. |
| `llms-full.txt` | The menu spelled out. Generated; `make verify` refuses a drift. |
| `robots.txt` / `sitemap.xml` | Crawler entry. The sitemap is the one page. |

## Working on it

```sh
make serve     # http://localhost:8010 — no-store, so edits show up
make verify    # the whole pipeline
make kin       # rebuild data/kin.json from the builds
make llms      # rebuild llms.txt and llms-full.txt from the menu
make icons     # redraw the home-screen PNG and the X/social card
```

`make verify` is the only gate. It parses every JSON file, syntax-checks
the two scripts the browser loads, confirms every asset `index.html` asks
for exists and every element id `app.js` reaches for is real, and — the
one that matters — checks that every shorthand code still agrees with
the recipe it stands for, that `data/kin.json` still matches those
builds, and that the agent dumps still match the menu.

The service worker registers in production only, and off https the app
actively unregisters any worker it finds. A worker owns an *origin*, not
a project — every static site here serves `./`, `index.html` and
`assets/app.js`, so one left on `localhost:8000` will answer for the next
project that runs there, cache-first, with no server needed. This repo
serves on **8010** so the origins never overlap. If a page ever loads
with nothing listening on the port, that is what you are looking at;
`make unstick` prints the manual recovery.

Push to `main` and the workflow deploys.

## Adding a drink

Add one object to `cocktails` in `data/cocktails.json`:

```json
{ "id": "red-hook", "name": "Red Hook", "method": "stirred",
  "family": "rye", "code": "2,h,h,cc", "serve": "cc",
  "build": [["rye","2"],["sweet-vermouth","h"],["maraschino","h"]] }
```

`code` and `build` are two hands writing the same drink, which is exactly
why the checker compares them. Write the code as it appears on the paper
menu, spell the build out, and let `make verify` catch the disagreement.

Then run `make kin` so the new drink joins its family, and `make llms`
so it lands in the agent dumps. Verify will fail on a stale copy of either.

Ingredients that take no measure (egg white) get `null`. An ingredient
poured on top rather than into the shaker — the bitters in a `c3` sour —
gets a third element, `"g"`, so it counts toward what the drink needs
without appearing among the comma-separated amounts.

Any new bottle goes in `data/bar.json` first, or the checker rejects it.
