# drink.shoephone.net — the Fern Street menu

Static site for one home bar's cocktail list. No build step, no
framework, no database. Everything renders from three JSON files.

This file is the working context. Read it before touching the menu.

## The bar

- One person's shelf, pouring for guests and for himself.
- The organising constraint is **range from few bottles**. The menu is
  large because the ingredients overlap, not because the bar is.
- Two methods, `stirred` and `shaken`, exactly as the printed card. A
  drink is shaken when juice, egg, or syrup carries it.
- Drinks are grouped under a `family` — the section they print under.
  That is the menu's own filing, not a claim about the base spirit.
  So So Cocktail files under Apple Brandy and is mostly gin; Corpse
  Reviver No. 1 files there and leads with cognac. Leave it alone.
  Filtering works on what a drink actually contains, so the two never
  need to agree.

## The shorthand

The house code is the point of this project, so it is worth stating
precisely. It reads left to right in build order, base spirit first, and
ends with one token carrying glass plus garnish.

**It is contextual.** The same token means different things in different
slots, and the decoder resolves it against the ingredient:

- A bare number is **ounces** beside a spirit, **dashes** beside bitters.
  `2` is two ounces of rye or two dashes of Angostura.
- `h` `q` `Q` are 1/2, 1/4, 3/4 oz. Case is meaningful and always will
  be — `q` is a quarter, `Q` is three quarters.
- A digit and a fraction combine: `1h` is 1 1/2 oz.
- `b` is barspoons, `d` is dashes, bare `b`/`d` mean one.
- `r` in an amount slot is a **rinse**. `r` as the last token is a rocks
  glass with no ice. The Sazerac, `2,1b,4,r,r`, is both.
- The last token is the glass (`c` coupe, `r` rocks, `R` rocks with ice)
  followed by garnish letters, packed together. `ccin` is a coupe with
  grated cinnamon, not `c` + `i` + `n` — the decoder matches longest
  first, and that is load-bearing.

Two things carry no amount token:

- **Egg white** is written into the build with `null`. It never had a
  measure in the shorthand and should not gain one.
- **Bitters dropped on the foam** live in the garnish token, not among
  the amounts. The Brass Rail's Angostura is the `3` in `c3`. Those get
  a third build element, `"g"`, so the drink still counts as needing
  them — a drink is not pourable because you skipped the garnish.

## Data model

### `data/cocktails.json`

**IDs are stable keys — never rename or reuse one.** They key the
expanded-recipe state and any link anyone has sent.

Every drink carries both `code` and `build`. This is deliberate
duplication: `code` is transcribed from the paper menu and is the thing
being preserved, `build` is the same drink spelled out for the app.
`scripts/check_menu.py` regenerates the code from the build and refuses
any drink where the two disagree. That check is the only reason a
hundred-odd hand-typed shorthand strings can be trusted.

### `data/bar.json`

Every bottle any drink can call for, grouped by `kind` for the shelf.
`unit: "dash"` is what tells the decoder a bare number counts dashes;
`unit: "none"` marks the unmeasured ones. The checker fails on a
stocked ingredient no drink uses, so the bar cannot quietly drift.

### `data/notation.json`

The key tab, and the table the decoder reads from. Adding a garnish
letter here is what makes it decodable — there is no second list in the
JavaScript.

## The marginal-gain engine

The Bar tab's number beside each unopened bottle is **drinks unlocked**,
computed by adding that bottle to the shelf and re-counting. It is not
how many recipes mention it. A bottle used in twelve drinks that unlocks
none reads `in 12`, greyed, and that is the honest answer.

This is the feature the site exists for. If it ever gets slow, memoise
it — do not replace it with a usage count.

## Design

The printed menu is pure black and white: a heavy rule under a
letterspaced cap, italic ingredient lines, the shorthand set small and
grey in the margin. This is that page after dark.

Dark is the default because a menu gets read in a dim room. **Light mode
is not an inversion** — it is the printed page, near enough to hold the
two side by side.

One accent. Brass carries every earned state: a filter that is on, a
drink you can actually pour, the count that goes up when you buy a
bottle. Nothing else is allowed to be gold.

Type is Montserrat (display, tracked caps, as on the card), Lato (body
and the italic ingredient lines), DM Mono (codes and quantities).
Mobile-first, safe-area aware, no shadows.

Every colour is a token on `:root` with a light counterpart. A literal
hex outside those two blocks is a bug — it will be wrong in one theme.
`--on-brass` exists because brass goes dark in light mode, so text
sitting on the brass fill has to flip with it.

## Conventions

- Commit straight to `main`. No PR branches.
- `make verify` before every commit. It is the whole pipeline.
- Keep it dependency-free. Vanilla JS, no bundler, no package.json.
- Transcribe the paper menu faithfully, including its own typos —
  `Improved Coctail` is spelled that way on the card. Fix a recipe only
  when the user says to, not because a reference book disagrees.
