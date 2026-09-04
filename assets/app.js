/* drink.shoephone — the cocktail menu.

   Two ideas carry the whole app.

   The first is that the house shorthand is decodable. Every code on the
   printed menu is contextual — a bare number is ounces beside a spirit
   and dashes beside bitters — so the decoder reads each amount against
   the ingredient it belongs to. That is what turns a margin note into a
   recipe without anyone having to type the recipe twice.

   The second is that the menu is a function of the shelf. The point of
   this bar is range from few bottles, so the Bar tab is not a checklist
   for its own sake: it computes what each unopened bottle would add, in
   drinks, and that number is the whole reason to buy one.

   Kin is the third cut: drinks of the same shape in different bottles.
   The Martini and the Manhattan share almost no ingredients and share
   almost the whole pour. scripts/kin.py works that out; this file only
   renders it. */

(function () {
  'use strict';

  var STORE = 'drink.bar.v1';
  var BRAND_STORE = 'drink.brands.v1';

  var FRACTION = { h: '1/2', q: '1/4', Q: '3/4' };

  var data = {};
  var ing = {};          /* id -> ingredient */
  var cocktailBy = {};   /* id -> cocktail */
  var patternBy = {};    /* id -> kin pattern */
  var garnishCodes = []; /* longest first */
  var glassBy = {};
  var garnishBy = {};

  var have = {};         /* id -> true, what is on the shelf */
  var own = {};          /* brand id -> true, which listed bottles you have */
  var open = {};         /* id -> true, which recipes are expanded */
  var noteOpen = {};     /* id -> true, which bottle notes are expanded */
  var recipePane = {};   /* id -> recipe|taste|history|kin; resets on open */
  var glassMarkup = {};  /* art id -> inline svg */

  var filter = emptyFilter();
  var searchTimer = null;

  function emptyFilter() {
    return { method: 'all', family: null, pattern: null, pourable: false, q: '' };
  }

  /* The shelf's running order, fixed on the way into the tab. See
     renderBar. */
  var barOrder = null;
  var lastCan = null;    /* what the tally said last time, to tick it */

  /* ── helpers ───────────────────────────────────────────── */

  function $(s) { return document.querySelector(s); }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  /* Named events for Google Tag Manager. The snippet in index.html
     owns dataLayer; we only push. Each event is one thing a person
     did, with the ids the reports will group by. Skip http so a
     localhost session does not pollute production. In GTM, a GA4
     Event tag that fires on these Custom Event names is enough —
     the params ride along as event parameters. */
  function track(name, params) {
    if (location.protocol !== 'https:') return;
    var payload = { event: name };
    if (params) {
      Object.keys(params).forEach(function (k) {
        if (params[k] !== undefined && params[k] !== null) payload[k] = params[k];
      });
    }
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(payload);
  }

  function drinkName(id) {
    return (cocktailBy[id] && cocktailBy[id].name) || id;
  }

  /* Escape first, then promote `backticked` spans to mono. Case carries
     meaning in this notation, and a proportional face makes l/L and o/O
     a guess. */
  function lit(s) {
    return esc(s).replace(/`([^`]+)`/g, '<code class="lit">$1</code>');
  }

  /* ── the decoder ───────────────────────────────────────── */

  /* An amount is read against its ingredient, because the same token
     means different things in different slots. `2` is two ounces of rye
     and two dashes of Angostura, and only the ingredient knows which. */
  function readAmount(token, ingredient) {
    if (token === null || token === undefined) {
      return { text: '—', note: 'one' };
    }
    if (token === 'r') return { text: 'rinse', note: '' };

    var m;

    if ((m = /^(\d*)b$/.exec(token))) {
      var b = m[1] === '' ? 1 : +m[1];
      return { text: plural(b, 'barspoon', 'barspoons'), note: '' };
    }

    if ((m = /^(\d*)d$/.exec(token))) {
      var d = m[1] === '' ? 1 : +m[1];
      return { text: plural(d, 'dash', 'dashes'), note: '' };
    }

    /* A bare number beside bitters counts dashes, not ounces. */
    if (/^\d+$/.test(token) && ingredient && ingredient.unit === 'dash') {
      return { text: plural(+token, 'dash', 'dashes'), note: '' };
    }

    if ((m = /^(\d+)([hqQ])$/.exec(token))) {
      return { text: m[1] + ' ' + FRACTION[m[2]] + ' oz', note: '' };
    }

    if (FRACTION[token]) return { text: FRACTION[token] + ' oz', note: '' };

    if (/^\d+$/.test(token)) return { text: token + ' oz', note: '' };

    return { text: token, note: '' };
  }

  /* The last token of a code is one word: a glass, then any garnishes
     packed onto it. Longest match first, or `ccin` reads as c + i + n. */
  function readServe(serve) {
    var glass = glassBy[serve[0]];
    var rest = serve.slice(1);
    var found = [];

    while (rest) {
      var hit = null;
      for (var i = 0; i < garnishCodes.length; i++) {
        if (rest.indexOf(garnishCodes[i]) === 0) { hit = garnishCodes[i]; break; }
      }
      if (!hit) break;
      found.push(garnishBy[hit]);
      rest = rest.slice(hit.length);
    }

    return {
      glass: glass ? glass.label : serve[0],
      gloss: glass ? glass.gloss : '',
      garnish: found
    };
  }

  /* ── the shelf ─────────────────────────────────────────── */

  function loadHave() {
    try { have = JSON.parse(localStorage.getItem(STORE)) || {}; }
    catch (e) { have = {}; }
  }

  function saveHave() {
    try { localStorage.setItem(STORE, JSON.stringify(have)); } catch (e) { /* private mode */ }
  }

  function loadOwn() {
    try { own = JSON.parse(localStorage.getItem(BRAND_STORE)) || {}; }
    catch (e) { own = {}; }
  }

  function saveOwn() {
    try { localStorage.setItem(BRAND_STORE, JSON.stringify(own)); } catch (e) { /* private mode */ }
  }

  function bottleHasBrands(i) {
    return !!(i && i.bottles && i.bottles.length);
  }

  /* A listed brand is enough to stock the type. Unknown bottles still
     tick the parent on their own, so this only turns a parent *on*. */
  function syncHaveFromBrands() {
    data.bar.ingredients.forEach(function (i) {
      if (!bottleHasBrands(i)) return;
      var any = i.bottles.some(function (b) { return own[b.id]; });
      if (any) have[i.id] = true;
    });
  }

  function clearBrandsFor(id) {
    var i = ing[id];
    if (!bottleHasBrands(i)) return;
    i.bottles.forEach(function (b) { delete own[b.id]; });
  }

  function stocked() {
    return Object.keys(have).filter(function (k) { return have[k] && ing[k]; });
  }

  /* Two lists, because there are two different questions.

     What a drink *pours* is its build, and missing one of those is the
     end of it. What it *needs* adds whatever the serve token garnishes
     it with — a real call on the shelf, since a lemon twist costs a
     lemon — but never a reason to say no. A Martini with no olive is
     still a Martini.

     So the line is the whole rule: the build gates, the serve token does
     not. The bitters dropped on a sour's foam are in the build with a
     "g" flag rather than in the serve token, which is exactly why those
     still count.

     Worked out once per drink at boot: marginalGain asks these a few
     thousand times per render of the Bar tab. */
  var poursBy = {};
  var needsBy = {};

  function buildNeeds() {
    data.menu.cocktails.forEach(function (d) {
      var pours = [];
      var all = [];

      function add(list, id) { if (id && list.indexOf(id) < 0) list.push(id); }

      d.build.forEach(function (p) { add(pours, p[0]); add(all, p[0]); });
      readServe(d.serve).garnish.forEach(function (g) { add(all, g.ingredient); });

      poursBy[d.id] = pours;
      needsBy[d.id] = all;
    });
  }

  /* Everything a bottle is wanted for, garnish included. This answers
     "who calls for this", which is the shelf's question. */
  function needs(d) { return needsBy[d.id]; }

  /* Only what has to end up in the glass. This is the one that gates. */
  function pours(d) { return poursBy[d.id]; }

  function missingFor(d, held) {
    var out = [];
    pours(d).forEach(function (id) {
      if (!held[id] && out.indexOf(id) < 0) out.push(id);
    });
    return out;
  }

  function canPour(d, held) { return missingFor(d, held).length === 0; }

  function pourableCount(held) {
    return data.menu.cocktails.filter(function (d) { return canPour(d, held); }).length;
  }

  /* What one more bottle is worth, in drinks. This is the number the
     whole bar is organised around, so it is the number on the shelf. */
  function marginalGain(id, held) {
    if (held[id]) return 0;
    var withIt = {};
    Object.keys(held).forEach(function (k) { withIt[k] = held[k]; });
    withIt[id] = true;
    return pourableCount(withIt) - pourableCount(held);
  }

  function usageCount(id) {
    return data.menu.cocktails.filter(function (d) {
      return needs(d).indexOf(id) >= 0;
    }).length;
  }

  /* ── menu view ─────────────────────────────────────────── */

  function ingredientLine(d) {
    return d.build.map(function (p) {
      var i = ing[p[0]];
      return i ? i.short : p[0];
    }).join(', ');
  }

  function matches(d, held) {
    if (filter.method === 'stirred' || filter.method === 'shaken') {
      if (d.method !== filter.method) return false;
    }
    if (filter.family && needs(d).indexOf(filter.family) < 0) return false;
    if (filter.pattern && patternIdOf(d) !== filter.pattern) return false;
    if (filter.pourable && !canPour(d, held)) return false;
    if (filter.q) {
      var hay = (d.name + ' ' + ingredientLine(d) + ' ' + d.code).toLowerCase();
      if (hay.indexOf(filter.q) < 0) return false;
    }
    return true;
  }

  function kinRow(d) {
    return (data.kin && data.kin.drinks[d.id]) || { pattern: null, kin: [] };
  }

  function patternIdOf(d) { return kinRow(d).pattern; }

  function patternOf(d) {
    var id = patternIdOf(d);
    return id ? patternBy[id] : null;
  }

  function paneOf(d) {
    var pane = recipePane[d.id] || 'recipe';
    if (pane === 'taste' && !d.taste) return 'recipe';
    if (pane === 'history' && !d.history) return 'recipe';
    if (pane === 'kin' && !data.kin) return 'recipe';
    return pane;
  }

  function applyRecipePane(recipe, pane) {
    recipe.querySelectorAll('.recipe-tab').forEach(function (tab) {
      var on = tab.getAttribute('data-recipe-tab') === pane;
      tab.classList.toggle('is-on', on);
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tab.tabIndex = on ? 0 : -1;
    });
    recipe.querySelectorAll('.recipe-panel').forEach(function (panel) {
      var on = panel.getAttribute('data-pane') === pane;
      panel.classList.toggle('is-on', on);
      panel.hidden = !on;
    });
  }

  function setRecipePane(id, pane, recipe) {
    recipePane[id] = pane;
    applyRecipePane(recipe, pane);
    track('recipe_pane', { drink_id: id, drink_name: drinkName(id), pane: pane });
  }

  /* First pass of garnish art. Combinations we do not have a drawing
     for yet fall back to the empty glass of that type. */
  function garnishArt(rest) {
    if (!rest) return '';
    if (rest === 'Lw') return 'wheel';
    if (rest === 'c' || rest === 'O' || (rest.charAt(0) === 'c' && rest.indexOf('cin') !== 0)) {
      return 'pick';
    }
    if (rest === 'l' || rest === 'L' || rest === 'o' || rest === 'fo') return 'twist';
    return '';
  }

  function pickGlassArt(serve) {
    var g = serve[0];
    var rest = serve.slice(1);
    var extra = garnishArt(rest);
    if (g === 'c') return extra ? 'nick-nora-' + extra : 'nick-nora';
    if (g === 'r') return extra ? 'rocks-' + extra : 'rocks';
    if (g === 'R') return extra ? 'rocks-cube-' + extra : 'rocks-cube';
    return null;
  }

  function renderGlass(serve) {
    var id = pickGlassArt(serve);
    var svg = id && glassMarkup[id];
    if (!svg) return '';
    var cls = 'drink__glass';
    if (id.indexOf('rocks') === 0) {
      /* Cropped to the tumbler and centred on it (x = 100). A rocks
         glass is shorter than a Nick & Nora, so the CSS scales this
         down rather than stretching it to the row. Garnishes that
         stick out still draw — overflow is visible. */
      svg = svg.replace('viewBox="0 0 200 270"', 'viewBox="45 118 110 146"');
      cls += ' drink__glass--rocks';
    }
    return '<span class="' + cls + '" aria-hidden="true">' + svg + '</span>';
  }

  function renderPours(d, held) {
    var shelfInUse = stocked().length > 0;
    var html = '';

    d.build.forEach(function (p) {
      var i = ing[p[0]] || { name: p[0] };
      var a = readAmount(p[1], i);
      var isGarnish = p[2] === 'g';
      var out = shelfInUse && !held[p[0]];

      html += '<div class="pour">' +
        '<div class="pour__amt' + (p[1] === null ? ' pour__amt--none' : '') + '">' + esc(a.text) + '</div>' +
        '<div class="pour__ing' + (out ? ' is-out' : '') + '">' + esc(i.name) +
        (isGarnish ? '<span class="pour__tag">on top</span>' : '') +
        (a.note ? '<span class="pour__tag">' + esc(a.note) + '</span>' : '') +
        '</div></div>';
    });

    var s = readServe(d.serve);
    html += '<div class="serve">' +
      '<div class="serve__row"><span class="serve__k">Method</span><span>' +
        (d.method === 'stirred'
          ? 'Stir with ice until cold, then strain.'
          : 'Shake hard with ice, then strain.') +
      '</span></div>' +
      '<div class="serve__row"><span class="serve__k">Glass</span><span>' +
        esc(s.glass) + (s.gloss ? ' — ' + esc(s.gloss) : '') +
      '</span></div>' +
      (s.garnish.length
        ? '<div class="serve__row"><span class="serve__k">Garnish</span><span>' +
            s.garnish.map(function (g) {
              var gone = shelfInUse && g.ingredient && !held[g.ingredient];
              return '<span class="serve__g' + (gone ? ' is-out' : '') + '">' +
                esc(g.label) + '</span>';
            }).join(', ') +
          '</span></div>'
        : '') +
      '</div>';

    return html;
  }

  function renderRecipeTabs(d, current) {
    var panes = [{ id: 'recipe', label: 'Recipe' }];
    if (d.taste) panes.push({ id: 'taste', label: 'Taste' });
    if (d.history) panes.push({ id: 'history', label: 'History' });
    if (data.kin) panes.push({ id: 'kin', label: 'Kin' });
    if (panes.length === 1) return '';

    var html = '<div class="recipe-tabs" role="tablist" aria-label="' +
      esc(d.name) + '">';
    panes.forEach(function (p) {
      var on = p.id === current;
      html += '<button type="button" class="recipe-tab' + (on ? ' is-on' : '') + '"' +
        ' role="tab"' +
        ' id="rtab-' + esc(d.id) + '-' + p.id + '"' +
        ' aria-selected="' + (on ? 'true' : 'false') + '"' +
        ' aria-controls="rpanel-' + esc(d.id) + '-' + p.id + '"' +
        ' tabindex="' + (on ? '0' : '-1') + '"' +
        ' data-recipe-tab="' + p.id + '"' +
        ' data-recipe-for="' + esc(d.id) + '">' + p.label + '</button>';
    });
    return html + '</div>';
  }

  function renderRefs(refs) {
    if (!refs || !refs.length) return '';
    var html = '<ul class="recipe-refs">';
    refs.forEach(function (r) {
      if (!r || !r.title || !r.url) return;
      html += '<li><a href="' + esc(r.url) + '" target="_blank" rel="noopener noreferrer">' +
        esc(r.title) + '</a></li>';
    });
    return html + '</ul>';
  }

  function renderPanel(d, pane, current, inner) {
    var on = pane === current;
    return '<div class="recipe-panel recipe-panel--' + pane + (on ? ' is-on' : '') + '"' +
      ' role="tabpanel"' +
      ' id="rpanel-' + esc(d.id) + '-' + pane + '"' +
      ' aria-labelledby="rtab-' + esc(d.id) + '-' + pane + '"' +
      ' data-pane="' + pane + '"' +
      (on ? '' : ' hidden') + '>' + inner + '</div>';
  }

  function renderKin(d) {
    var row = kinRow(d);
    var pat = patternOf(d);
    var html = '<div class="kin">';
    if (pat) {
      html += '<div class="kin__k">' + esc(pat.label) + '</div>' +
        '<p class="kin__blurb">' + esc(pat.blurb) + '</p>';
    }
    if (row.kin && row.kin.length) {
      html += '<div class="kin-list">';
      row.kin.forEach(function (k) {
        var other = cocktailBy[k.id];
        if (!other) return;
        html += '<button type="button" class="kin-item" data-kin="' + esc(k.id) + '">' +
          '<span class="kin-item__name">' + esc(other.name) + '</span>' +
          '<span class="kin-item__why">' + esc(k.why) + '</span>' +
          '</button>';
      });
      html += '</div>';
    }
    if (pat && pat.members && pat.members.length > 1) {
      html += '<button type="button" class="kin-more" data-see-pattern="' + esc(pat.id) + '">' +
        plural(pat.members.length, 'drink', 'drinks') + ' in this family' +
        ' <span aria-hidden="true">&rarr;</span></button>';
    }
    return html + '</div>';
  }

  function renderRecipe(d, held) {
    var html = '<div class="recipe">';
    var extra = !!(d.taste || d.history || data.kin);

    if (!extra) return html + renderPours(d, held) + '</div>';

    var current = paneOf(d);
    html += renderRecipeTabs(d, current);
    html += renderPanel(d, 'recipe', current, renderPours(d, held));
    if (d.taste) {
      html += renderPanel(d, 'taste', current,
        '<p class="recipe-copy">' + esc(d.taste) + '</p>');
    }
    if (d.history) {
      html += renderPanel(d, 'history', current,
        '<p class="recipe-copy">' + esc(d.history) + '</p>' + renderRefs(d.refs));
    }
    if (data.kin) html += renderPanel(d, 'kin', current, renderKin(d));
    return html + '</div>';
  }

  function renderDrink(d, held, showShelf) {
    var missing = missingFor(d, held);
    var cls = 'drink';
    if (showShelf) cls += missing.length ? ' is-short' : ' is-pourable';

    var html = '<div class="' + cls + '" id="drink-' + esc(d.id) + '">' +
      '<button class="drink__head" data-drink="' + esc(d.id) + '" ' +
        'aria-expanded="' + (open[d.id] ? 'true' : 'false') + '">' +
        renderGlass(d.serve) +
        '<span class="drink__text">' +
        '<span class="drink__name">' + esc(d.name) + '</span>' +
        '<span class="drink__code">' + esc(d.code) + '</span>' +
        '<span class="drink__line">' + esc(ingredientLine(d)) + '</span>';

    if (showShelf && missing.length) {
      html += '<span class="drink__missing">Need ' + esc(missing.map(function (m) {
        return (ing[m] || {}).short || m;
      }).join(', ')) + '</span>';
    }

    html += '</span></button>';
    if (open[d.id]) html += renderRecipe(d, held);
    return html + '</div>';
  }

  /* An empty list has more than one cause, and saying the wrong one sends
     people to the Bar tab to fix a shelf that was never the problem. Work
     out which filter is actually doing the excluding and say so. */
  function renderEmpty(held) {
    var canNow = pourableCount(held);

    if (filter.pourable && canNow > 0) {
      /* Each clause is a full predicate, so they read as a sentence
         however many of them there happen to be. */
      var blocking = [];
      if (filter.family) {
        blocking.push('use ' + ((ing[filter.family] || {}).short || filter.family));
      }
      if (filter.method === 'stirred' || filter.method === 'shaken') {
        blocking.push('are ' + filter.method);
      }
      if (filter.pattern) {
        var pat = patternBy[filter.pattern];
        blocking.push('sit in the ' + (pat ? pat.label : filter.pattern) + ' family');
      }
      if (filter.q) blocking.push('match “' + filter.q + '”');

      return '<div class="empty empty--clash">' +
        '<p>You can pour <b>' + canNow + '</b> ' +
          (canNow === 1 ? 'drink' : 'drinks') + ' with what is on the shelf, but ' +
          (blocking.length
            ? 'none of them ' + esc(blocking.join(', nor ')) + '.'
            : 'none of them match the other filters.') +
        '</p>' +
        '<button class="btn" data-clearothers="1">Drop the other filters</button>' +
        '</div>';
    }

    if (filter.pourable) {
      return '<p class="empty">Nothing yet. Stock a few more bottles on the ' +
             'Bar tab and the menu fills in.</p>';
    }

    return '<p class="empty">Nothing on the menu matches that.</p>';
  }

  /* With the shelf filter on, this stops being a filtered list and starts
     being a menu — so it gets a masthead, a count, and a way onto paper. */
  function renderMasthead(n) {
    var bottles = stocked().length;
    return '<div class="tonight">' +
      '<div class="tonight__k">Your menu</div>' +
      '<div class="tonight__n">' + n + '</div>' +
      '<div class="tonight__of">' + (n === 1 ? 'drink' : 'drinks') + ' you can pour tonight</div>' +
      '<p class="tonight__note">Everything the ' + plural(bottles, 'bottle', 'bottles') +
        ' on your shelf will pour, in full. Garnish where you have it.</p>' +
      '<div class="tonight__acts">' +
        '<button class="btn" data-print="1">Print or save as PDF</button>' +
        '<button class="btn" data-pourable="1">Show all ' + data.menu.cocktails.length + '</button>' +
      '</div></div>';
  }

  function renderMenu() {
    var held = have;
    var showShelf = stocked().length > 0;
    var list = data.menu.cocktails.filter(function (d) { return matches(d, held); });

    if (!list.length) {
      $('#menu-body').innerHTML = renderEmpty(held);
      return;
    }

    var html = filter.pourable ? renderMasthead(list.length) : '';

    if (filter.method === 'families' && data.kin) {
      data.kin.patterns.forEach(function (p) {
        var inPat = p.members.map(function (id) { return cocktailBy[id]; })
          .filter(function (d) { return d && list.indexOf(d) >= 0; });
        if (!inPat.length) return;
        html += '<section class="method" id="pattern-' + esc(p.id) + '">' +
          '<h2 class="method__title">' + esc(p.label) + '</h2>' +
          '<div class="method__rule"></div>' +
          '<p class="method__blurb">' + esc(p.blurb) + '</p>';
        inPat.forEach(function (d) { html += renderDrink(d, held, showShelf); });
        html += '</section>';
      });
    } else {
      data.menu.methods.forEach(function (m) {
        var inMethod = list.filter(function (d) { return d.method === m.id; });
        if (!inMethod.length) return;

        html += '<section class="method">' +
          '<h2 class="method__title">' + esc(m.label) + '</h2>' +
          '<div class="method__rule"></div>' +
          '<p class="method__blurb">' + esc(m.blurb) + '</p>';

        data.menu.families.forEach(function (f) {
          var inFamily = inMethod.filter(function (d) { return d.family === f.id; });
          if (!inFamily.length) return;

          html += '<h3 class="family">' + esc(f.label) + '</h3>';
          inFamily.forEach(function (d) { html += renderDrink(d, held, showShelf); });
        });

        html += '</section>';
      });
    }

    $('#menu-body').innerHTML = html;
  }

  function renderFilters() {
    var held = have;
    var n = data.menu.cocktails.filter(function (d) { return matches(d, held); }).length;

    /* The chip row is a horizontal scroller. Rebuilding it from innerHTML
       drops you back at the start, so the chip you just tapped is gone
       and toggling it off means scrolling the whole row again. */
    var chipX = [];
    document.querySelectorAll('#filters .chips').forEach(function (el) {
      chipX.push(el.scrollLeft);
    });

    var seg = [{ id: 'all', label: 'All' }].concat(data.menu.methods.map(function (m) {
      return { id: m.id, label: m.label };
    }));
    if (data.kin) seg.push({ id: 'families', label: 'Families' });

    var html = '<div class="filters">' +
      '<div class="seg' + (seg.length > 3 ? ' seg--wide' : '') + '">' + seg.map(function (s) {
        return '<button class="seg__b' + (filter.method === s.id ? ' is-on' : '') +
          '" data-method="' + s.id + '">' + esc(s.label) + '</button>';
      }).join('') + '</div>' +
      '<input class="search" id="q" type="search" placeholder="Name, ingredient, or code…" ' +
        'value="' + esc(filter.q) + '" autocomplete="off" spellcheck="false">';

    if (filter.method === 'families' && data.kin) {
      html += '<div class="chips">';
      data.kin.patterns.forEach(function (p) {
        html += '<button class="chip' + (filter.pattern === p.id ? ' is-on' : '') +
          '" data-pattern="' + esc(p.id) + '">' + esc(p.label) + '</button>';
      });
      html += '</div>';
    }

    html += '<div class="chips">';

    /* Spirits first — they are how anyone actually chooses a drink —
       then the modifiers that decide the rest of the menu. */
    data.bar.ingredients.filter(function (i) {
      return i.kind === 'base' || i.kind === 'vermouth' || i.kind === 'modifier';
    }).forEach(function (i) {
      html += '<button class="chip' + (filter.family === i.id ? ' is-on' : '') +
        '" data-family="' + esc(i.id) + '">' + esc(i.short) + '</button>';
    });

    /* Carry the shelf count on the control itself. The Bar tab shows the
       same number, and the two disagreeing with no explanation is exactly
       how this filter looked broken. */
    var canNow = stocked().length ? pourableCount(held) : null;

    html += '</div><div class="chips">' +
      '<button class="chip chip--pour' + (filter.pourable ? ' is-on' : '') +
        '" data-pourable="1">' + (filter.pourable ? '✓ ' : '') + 'What I can pour' +
        (canNow === null ? '' : ' · ' + canNow) + '</button>' +
      (filter.family || filter.pattern || filter.q || filter.method !== 'all' || filter.pourable
        ? '<button class="chip" data-clear="1">Clear</button>' : '') +
      '</div>' +
      '<p class="filters__note"><b>' + n + '</b> of ' + data.menu.cocktails.length + ' shown</p>' +
      '</div>';

    $('#filters').innerHTML = html;

    document.querySelectorAll('#filters .chips').forEach(function (el, i) {
      if (i < chipX.length) el.scrollLeft = chipX[i];
    });
  }

  /* ── bar view ──────────────────────────────────────────── */

  /* The checkbox ticks the shelf. The rest of the row reveals notes
     and the shopping list when the bottle has either, and does
     nothing when it does not. */
  var TIER_ORDER = ['solid', 'elevated', 'excellent', 'exceptional', 'alternatives'];
  var TIER_LABEL = {
    solid: 'Solid',
    elevated: 'Elevated',
    excellent: 'Excellent',
    exceptional: 'Exceptional',
    alternatives: 'Alternatives'
  };

  function bottleHasNotes(i) {
    return !!(i.notes && (i.notes.copy || (i.notes.parts && i.notes.parts.length)));
  }

  function bottleHasPane(i) {
    return bottleHasNotes(i) || bottleHasBrands(i);
  }

  function brandMeta(b) {
    var bits = [];
    if (b.size) bits.push(b.size);
    if (b.price != null) bits.push('~$' + b.price);
    return bits.join(' · ');
  }

  function renderBrands(i) {
    var byTier = {};
    i.bottles.forEach(function (b) {
      (byTier[b.tier] || (byTier[b.tier] = [])).push(b);
    });
    var html = '<div class="brands">';
    TIER_ORDER.forEach(function (tier) {
      var list = byTier[tier];
      if (!list) return;
      html += '<h3 class="brands__tier">' + esc(TIER_LABEL[tier]) + '</h3>';
      list.forEach(function (b) {
        var on = !!own[b.id];
        var meta = brandMeta(b);
        html += '<div class="brand' + (on ? ' is-on' : '') + '">' +
          '<button type="button" class="brand__hit" data-brand="' + esc(b.id) +
            '" data-parent="' + esc(i.id) + '"' +
            ' aria-pressed="' + (on ? 'true' : 'false') + '"' +
            ' aria-label="' + esc(b.name) + '">' +
            '<span class="bottle__box"></span>' +
            '<span class="brand__name">' + esc(b.name) + '</span>' +
            (meta ? '<span class="brand__meta">' + esc(meta) + '</span>' : '') +
          '</button>' +
          '</div>';
      });
    });
    return html + '</div>';
  }

  function renderBottleNote(i, shown) {
    var html = '<div class="bottle__note" id="note-' + esc(i.id) + '"' +
      (shown ? '' : ' hidden') + '>';
    if (bottleHasBrands(i)) html += renderBrands(i);
    if (bottleHasNotes(i)) {
      var n = i.notes;
      if (n.parts && n.parts.length) {
        n.parts.forEach(function (p) {
          html += '<div class="pour">' +
            '<div class="pour__amt">' + esc(p.amt) + '</div>' +
            '<div class="pour__ing">' + esc(p.item) + '</div>' +
            '</div>';
        });
      }
      if (n.copy) {
        html += '<p class="bottle__copy">' + esc(n.copy) + '</p>';
      }
    }
    return html + '</div>';
  }

  function renderBottleStat(on, gain, uses) {
    if (!uses) return '';
    return on
      ? '<span class="bottle__in">in ' + uses + '</span>'
      : '<span class="bottle__gain' + (gain ? '' : ' bottle__gain--flat') + '">' +
          (gain ? '+' + gain : 'in ' + uses) + '</span>';
  }

  function revealLabel(i, name) {
    if (bottleHasNotes(i) && i.notes.parts && i.notes.parts.length) return 'How to make ' + name;
    if (bottleHasBrands(i)) return 'Bottles of ' + name;
    return 'Notes on ' + name;
  }

  function renderBottle(i, held, gain, uses) {
    var on = !!held[i.id];
    var hasPane = bottleHasPane(i);
    var shown = !!(hasPane && noteOpen[i.id]);
    var name = i.shelf || i.name;
    var html = '<div class="bottle' + (on ? ' is-on' : '') +
      (shown ? ' is-open' : '') + (hasPane ? ' has-note' : '') + '">' +
      '<div class="bottle__row">' +
      '<button type="button" class="bottle__stock" data-bottle="' + esc(i.id) + '"' +
        ' aria-pressed="' + (on ? 'true' : 'false') + '"' +
        ' aria-label="' + esc(name) + '">' +
        '<span class="bottle__box"></span>' +
      '</button>';
    if (hasPane) {
      html += '<button type="button" class="bottle__hit" data-note="' + esc(i.id) + '"' +
        ' aria-expanded="' + (shown ? 'true' : 'false') + '"' +
        ' aria-controls="note-' + esc(i.id) + '"' +
        ' aria-label="' + esc(revealLabel(i, name)) + '">' +
        '<span class="bottle__name">' + esc(name) + '</span>' +
        renderBottleStat(on, gain, uses) +
        '<span class="bottle__more" aria-hidden="true"></span>' +
        '</button>';
    } else {
      html += '<div class="bottle__hit">' +
        '<span class="bottle__name">' + esc(name) + '</span>' +
        renderBottleStat(on, gain, uses) +
        '</div>';
    }
    html += '</div>';
    if (hasPane) html += renderBottleNote(i, shown);
    return html + '</div>';
  }

  /* The running order of the shelf, worked out once on the way into the
     tab and then held.

     Sorting live is what made this tab hard to use: the moment you tick
     a bottle its gain drops to nothing and the row you just touched
     jumps somewhere else, so the next tick lands on whatever slid into
     its place. Freezing the order on entry keeps the best buys at the
     top where they are worth seeing, and keeps the list still while you
     work down it. Only the numbers move. */
  function freezeBarOrder(held) {
    barOrder = {};
    data.bar.ingredients.map(function (i) {
      return { id: i.id, gain: marginalGain(i.id, held), uses: usageCount(i.id) };
    }).sort(function (a, b) {
      if (b.gain !== a.gain) return b.gain - a.gain;
      return b.uses - a.uses;
    }).forEach(function (r, n) { barOrder[r.id] = n; });
  }

  function renderBar() {
    var held = have;
    var can = pourableCount(held);
    var total = data.menu.cocktails.length;
    var bottles = stocked().length;

    if (!barOrder) freezeBarOrder(held);

    var note;
    if (!bottles) {
      note = 'Tick what is actually on the shelf. The count above is what ' +
             'you can pour tonight, and every bottle below shows what it would add.';
    } else if (!can) {
      note = 'Not enough yet. The gain figures below are drinks unlocked, ' +
             'not drinks that merely use the bottle.';
    } else {
      note = plural(bottles, 'bottle', 'bottles') + ' on the shelf. The count ' +
             'above follows you down the page, so you can watch it move.';
    }

    /* The count is only worth reading if it leads to the list it counts,
       so the whole figure is the way through to that menu. */
    var up = lastCan !== null && can > lastCan;
    lastCan = can;

    var figure = '<span class="tally__n' + (up ? ' is-up' : '') + '">' + can + '</span>' +
      '<span class="tally__of">drinks you can pour<br>of ' + total + '</span>';

    var html = '<div class="tally">' +
      (can
        ? '<button class="tally__hit" data-seemenu="1">' + figure +
            '<span class="tally__cta">See the menu <span aria-hidden="true">&rarr;</span></span>' +
          '</button>'
        : '<div class="tally__fig">' + figure + '</div>') +
      '</div>' +
      '<div class="tally__body">' +
      '<p class="tally__note">' + esc(note) + '</p>' +
      '<div class="tally__acts">' +
        '<button class="btn" data-bar="all">Stock everything</button>' +
        '<button class="btn" data-bar="none">Clear the shelf</button>' +
      '</div></div>';

    data.bar.kinds.forEach(function (k) {
      var rows = data.bar.ingredients.filter(function (i) { return i.kind === k.id; });
      if (!rows.length) return;

      html += '<section class="shelf"><h2 class="shelf__h">' + esc(k.label) + '</h2>' +
        (k.blurb ? '<p class="shelf__blurb">' + esc(k.blurb) + '</p>' : '') +
        (k.id === 'base' && data.bar.bottles_copy
          ? '<p class="shelf__copy">' + esc(data.bar.bottles_copy) + '</p>'
          : '');

      /* Biggest unlock first, in the order frozen on the way in — a row
         never moves out from under the finger that just ticked it. */
      rows.map(function (i) {
        return { i: i, gain: marginalGain(i.id, held), uses: usageCount(i.id) };
      }).sort(function (a, b) {
        return barOrder[a.i.id] - barOrder[b.i.id];
      }).forEach(function (r) {
        html += renderBottle(r.i, held, r.gain, r.uses);
      });

      html += '</section>';
    });

    $('#bar-body').innerHTML = html;
  }

  /* ── key view ──────────────────────────────────────────── */

  function defs(rows) {
    return rows.map(function (r) {
      return '<div class="def">' +
        '<div class="def__c">' + esc(r.code) + '</div>' +
        '<div class="def__l">' + esc(r.label) + '</div>' +
        (r.gloss ? '<div class="def__g">' + esc(r.gloss) + '</div>' : '') +
        '</div>';
    }).join('');
  }

  function renderKey() {
    var n = data.notation;
    var sys = n.system;

    var html = '<div class="sys">' +
      '<h1 class="sys__name">' + esc(sys.name) + '</h1>' +
      '<div class="sys__tag">' + esc(sys.tagline) + '</div>' +
      '<p class="sys__lead">' + esc(sys.lead) + '</p>' +
      '</div>' +

      '<h2 class="key__h">How it works</h2>' +
      '<ol class="rules">' + sys.principles.map(function (r) {
        return '<li class="rule">' +
          '<div class="rule__h">' + esc(r.h) + '</div>' +
          '<p class="rule__t">' + lit(r.t) + '</p>' +
          '</li>';
      }).join('') + '</ol>' +
      '<p class="sys__foot">' + esc(sys.footnote) + '</p>' +

      '<h2 class="key__h">Reading order</h2>' +
      '<p class="key__lead key__lead--tight">' + esc(n.note) + '</p>' +

      '<h2 class="key__h">Ounces</h2>' +
      '<p class="key__sub">Lowercase is small, uppercase is large — <em>q</em> is a quarter, <em>Q</em> is three quarters.</p>' +
      defs(n.amounts) +

      '<h2 class="key__h">Dashes, spoons, rinses</h2>' +
      defs(n.counts) +

      '<h2 class="key__h">Glass</h2>' +
      '<p class="key__sub">The first letter of the last token.</p>' +
      defs(n.glasses) +

      '<h2 class="key__h">Garnish</h2>' +
      '<p class="key__sub">Whatever letters follow the glass. Case matters — <em>l</em> is lemon, <em>L</em> is lime.</p>' +
      defs(n.garnishes) +

      '<h2 class="key__h">Reading one straight through</h2>';

    n.examples.forEach(function (ex) {
      html += '<div class="example">' +
        '<div class="example__n">' + esc(ex.name) + '</div>' +
        '<div class="example__c">' + esc(ex.code) + '</div>' +
        '<pre class="example__l">' + esc(ex.lines.join('\n')) + '</pre>' +
        '</div>';
    });

    html += '<p class="colophon">' +
      esc(data.menu.cocktails.length + ' drinks, ' + data.bar.ingredients.length +
          ' ingredients. Every code here is the one from the printed card; the ' +
          'recipes are generated from it, so the two cannot drift apart.') +
      '</p>' +
      '<p class="sign">© 2026 <a href="https://imti.co/resume/" ' +
        'rel="noopener">Craig Johnston</a></p>';

    $('#key-body').innerHTML = html;
  }

  /* ── routing ───────────────────────────────────────────── */

  var VIEWS = ['menu', 'bar', 'key'];

  function show(view) {
    if (VIEWS.indexOf(view) < 0) view = 'menu';
    VIEWS.forEach(function (v) { $('#view-' + v).hidden = v !== view; });
    document.querySelectorAll('.tab').forEach(function (t) {
      t.classList.toggle('is-active', t.dataset.view === view);
    });
    /* Every view repaints on the way in. The menu depends on the shelf,
       and the shelf is edited on another tab — rendering it once at boot
       and again only when a filter is touched leaves it frozen at
       whatever the bar looked like earlier, still claiming nothing is
       pourable while the badge says otherwise. */
    if (view === 'menu') repaintMenu();
    if (view === 'bar') {
      /* Re-sort on the way in, and only here. Within a visit the shelf
         holds still under your finger; arriving is when it is fair to
         put the best buys back on top. */
      barOrder = null;
      renderBar();
    }
    if (view === 'key') renderKey();
    /* The shell is viewport-tall and #main is what scrolls, so the
       window has nowhere to go. */
    $('#main').scrollTop = 0;
    track('view_tab', { tab: view });
  }

  function route() { show((location.hash || '#menu').slice(1)); }

  /* ── wiring ────────────────────────────────────────────── */

  /* Open a drink and put it on screen. If the current filters hide it,
     drop whatever is hiding it — a kin link that does not lead to the
     drink it names is trivia. */
  function revealDrink(id) {
    var d = cocktailBy[id];
    if (!d) return;
    if (!matches(d, have)) {
      filter.family = null;
      filter.q = '';
      if (filter.pattern && patternIdOf(d) !== filter.pattern) filter.pattern = null;
      if (filter.method === 'stirred' || filter.method === 'shaken') {
        if (d.method !== filter.method) filter.method = 'all';
      }
      if (filter.pourable && !canPour(d, have)) filter.pourable = false;
    }
    open = {};
    open[id] = true;
    recipePane[id] = data.kin ? 'kin' : 'recipe';
    repaintMenu();
    var el = document.getElementById('drink-' + id);
    if (el) el.scrollIntoView({ block: 'center' });
  }

  function refreshCount() {
    var can = pourableCount(have);
    var badge = $('#tab-count');
    if (stocked().length) {
      badge.textContent = can;
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  }

  function repaintMenu() {
    renderFilters();
    renderMenu();
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-recipe-tab],[data-drink],[data-method],[data-family],[data-pattern],' +
      '[data-pourable],[data-clear],[data-clearothers],[data-bottle],[data-brand],[data-note],[data-bar],[data-seemenu],' +
      '[data-print],[data-kin],[data-see-pattern]');
    if (!t) return;

    if (t.dataset.recipeTab) {
      setRecipePane(t.dataset.recipeFor, t.dataset.recipeTab, t.closest('.recipe'));
      return;
    }

    if (t.dataset.drink) {
      var id = t.dataset.drink;
      if (open[id]) {
        delete open[id];
        delete recipePane[id];
        track('drink_close', { drink_id: id, drink_name: drinkName(id) });
      } else {
        open[id] = true;
        recipePane[id] = 'recipe';
        track('drink_open', { drink_id: id, drink_name: drinkName(id) });
      }
      renderMenu();
      return;
    }

    if (t.dataset.method) {
      filter.method = t.dataset.method;
      if (filter.method !== 'families') filter.pattern = null;
      track('filter', { filter_type: 'method', filter_value: filter.method });
      repaintMenu();
      return;
    }

    if (t.dataset.family) {
      filter.family = filter.family === t.dataset.family ? null : t.dataset.family;
      track('filter', { filter_type: 'family', filter_value: filter.family || '' });
      repaintMenu();
      return;
    }

    if (t.dataset.pattern) {
      filter.pattern = filter.pattern === t.dataset.pattern ? null : t.dataset.pattern;
      track('filter', { filter_type: 'pattern', filter_value: filter.pattern || '' });
      repaintMenu();
      return;
    }

    if (t.dataset.kin) {
      var fromEl = t.closest('.drink');
      var fromId = fromEl && fromEl.id ? fromEl.id.replace(/^drink-/, '') : '';
      track('kin_follow', {
        from_id: fromId,
        drink_id: t.dataset.kin,
        drink_name: drinkName(t.dataset.kin)
      });
      revealDrink(t.dataset.kin);
      return;
    }

    if (t.dataset.seePattern) {
      filter.method = 'families';
      filter.pattern = t.dataset.seePattern;
      filter.family = null;
      filter.q = '';
      track('see_pattern', { pattern: t.dataset.seePattern });
      repaintMenu();
      $('#main').scrollTop = 0;
      return;
    }

    if (t.dataset.pourable) {
      filter.pourable = !filter.pourable;
      track('filter', { filter_type: 'pourable', filter_value: filter.pourable ? 'on' : 'off' });
      repaintMenu();
      return;
    }

    /* Jump from the count on the Bar tab to the menu it is counting. */
    if (t.dataset.seemenu) {
      filter = emptyFilter();
      filter.pourable = true;
      track('see_pourable');
      repaintMenu();
      location.hash = '#menu';
      return;
    }

    if (t.dataset.print) {
      track('print_menu');
      window.print();
      return;
    }

    /* Keep the shelf filter, drop whatever else was excluding things. */
    if (t.dataset.clearothers) {
      filter = emptyFilter();
      filter.pourable = true;
      track('filter', { filter_type: 'clear', filter_value: 'others' });
      repaintMenu();
      return;
    }

    if (t.dataset.clear) {
      filter = emptyFilter();
      track('filter', { filter_type: 'clear', filter_value: 'all' });
      repaintMenu();
      return;
    }

    if (t.dataset.note) {
      var nid = t.dataset.note;
      if (noteOpen[nid]) delete noteOpen[nid];
      else noteOpen[nid] = true;
      var bottle = t.closest('.bottle');
      if (!bottle) return;
      var shown = !!noteOpen[nid];
      bottle.classList.toggle('is-open', shown);
      t.setAttribute('aria-expanded', shown ? 'true' : 'false');
      var pane = bottle.querySelector('.bottle__note');
      if (pane) pane.hidden = !shown;
      track('bar_note', { bottle_id: nid, open: shown });
      return;
    }

    if (t.dataset.brand) {
      var brand = t.dataset.brand;
      var parent = t.dataset.parent;
      own[brand] = !own[brand];
      if (!own[brand]) delete own[brand];
      var parentIng = ing[parent];
      var any = parentIng.bottles.some(function (b) { return own[b.id]; });
      if (any) have[parent] = true;
      else delete have[parent];
      saveOwn();
      saveHave();
      var by = $('#main').scrollTop;
      renderBar();
      $('#main').scrollTop = by;
      refreshCount();
      track('bar_brand', { brand_id: brand, bottle_id: parent, stocked: !!own[brand] });
      return;
    }

    if (t.dataset.bottle) {
      have[t.dataset.bottle] = !have[t.dataset.bottle];
      if (!have[t.dataset.bottle]) {
        delete have[t.dataset.bottle];
        clearBrandsFor(t.dataset.bottle);
        saveOwn();
      }
      saveHave();
      /* Every figure on the shelf is relative to what is stocked, so the
         whole list is rewritten. Put the scroll back where it was or the
         row you just ticked leaves the screen. */
      var y = $('#main').scrollTop;
      renderBar();
      $('#main').scrollTop = y;
      refreshCount();
      track('bar_stock', { bottle_id: t.dataset.bottle, stocked: !!have[t.dataset.bottle] });
      return;
    }

    if (t.dataset.bar === 'all') {
      data.bar.ingredients.forEach(function (i) { have[i.id] = true; });
      saveHave(); barOrder = null; renderBar(); refreshCount();
      track('bar_bulk', { action: 'all' });
      return;
    }

    if (t.dataset.bar === 'none') {
      have = {};
      own = {};
      saveHave(); saveOwn(); barOrder = null; renderBar(); refreshCount();
      track('bar_bulk', { action: 'none' });
      return;
    }
  });

  document.addEventListener('keydown', function (e) {
    var tab = e.target.closest('[data-recipe-tab]');
    if (!tab) return;
    var list = tab.parentNode.querySelectorAll('[data-recipe-tab]');
    var i = Array.prototype.indexOf.call(list, tab);
    var next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % list.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + list.length) % list.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = list.length - 1;
    else return;
    e.preventDefault();
    var ntab = list[next];
    setRecipePane(ntab.dataset.recipeFor, ntab.dataset.recipeTab, ntab.closest('.recipe'));
    ntab.focus();
  });

  document.addEventListener('input', function (e) {
    if (e.target.id !== 'q') return;
    filter.q = e.target.value.trim().toLowerCase();
    /* Repaint the list but leave the field alone, or the caret jumps. */
    renderMenu();
    var note = document.querySelector('.filters__note');
    if (note) {
      var n = data.menu.cocktails.filter(function (d) { return matches(d, have); }).length;
      note.innerHTML = '<b>' + n + '</b> of ' + data.menu.cocktails.length + ' shown';
    }
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      searchTimer = null;
      if (filter.q) track('search', { search_term: filter.q });
    }, 700);
  });

  window.addEventListener('hashchange', route);

  /* ── boot ──────────────────────────────────────────────── */

  var GLASS_FILES = [
    'nick-nora', 'nick-nora-twist', 'nick-nora-pick', 'nick-nora-wheel',
    'rocks', 'rocks-twist', 'rocks-pick', 'rocks-wheel',
    'rocks-cube', 'rocks-cube-twist', 'rocks-cube-pick', 'rocks-cube-wheel',
    'rocks-ice'
  ];

  function loadGlassArt() {
    return Promise.all(GLASS_FILES.map(function (id) {
      return fetch('assets/glasses/' + id + '.svg').then(function (r) {
        if (!r.ok) return;
        return r.text().then(function (t) { glassMarkup[id] = t; });
      }).catch(function () { /* art is decorative */ });
    }));
  }

  Promise.all([
    fetch('data/cocktails.json').then(function (r) { return r.json(); }),
    fetch('data/bar.json').then(function (r) { return r.json(); }),
    fetch('data/notation.json').then(function (r) { return r.json(); }),
    fetch('data/kin.json').then(function (r) { return r.json(); }),
    loadGlassArt()
  ]).then(function (res) {
    data.menu = res[0];
    data.bar = res[1];
    data.notation = res[2];
    data.kin = res[3];

    data.bar.ingredients.forEach(function (i) { ing[i.id] = i; });
    data.menu.cocktails.forEach(function (d) { cocktailBy[d.id] = d; });
    data.kin.patterns.forEach(function (p) { patternBy[p.id] = p; });
    data.notation.glasses.forEach(function (g) { glassBy[g.code] = g; });
    data.notation.garnishes.forEach(function (g) { garnishBy[g.code] = g; });
    garnishCodes = data.notation.garnishes.map(function (g) { return g.code; })
      .sort(function (a, b) { return b.length - a.length; });

    buildNeeds();
    loadHave();
    loadOwn();
    syncHaveFromBrands();
    saveHave();

    $('#loading').hidden = true;
    repaintMenu();
    refreshCount();
    route();
  }).catch(function (err) {
    $('#loading').textContent = 'Could not load the menu. ' + err;
  });

  /* Service worker: production only, and actively evicted anywhere else.

     A worker registered on http://localhost:8000 owns that whole origin,
     and every static site here serves './', 'index.html' and
     'assets/app.js' from it. So a worker installed by one project will
     answer for the next one, cache-first, and keep answering after the
     dev server is dead — a page that loads with nothing listening on the
     port is the tell.

     Skipping registration is not enough to undo that: the stale worker
     is already serving the old app.js, so the guard never gets to run.
     Off https, this actively unregisters whatever is there, drops the
     caches, and reloads once into a clean origin.

     iOS home-screen WebViews resume without navigating, so they will
     not check for a new worker on their own. updateViaCache: 'none'
     stops Safari using the four-hour CDN copy of sw.js, and a poke on
     foreground is the check the resume never made. */
  if ('serviceWorker' in navigator) {
    if (location.protocol === 'https:') {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
          .then(function (reg) {
            function poke() { reg.update(); }
            document.addEventListener('visibilitychange', function () {
              if (!document.hidden) poke();
            });
            window.addEventListener('pageshow', poke);
          })
          .catch(function () { /* offline is a bonus */ });
      });
    } else {
      navigator.serviceWorker.getRegistrations().then(function (regs) {
        if (!regs.length) return null;
        return Promise.all(regs.map(function (r) { return r.unregister(); }))
          .then(function () { return caches.keys(); })
          .then(function (keys) {
            return Promise.all(keys.map(function (k) { return caches.delete(k); }));
          })
          .then(function () {
            /* Only reload if a worker was actually answering for us. The
               next load finds no registration and falls straight through,
               so this cannot loop. */
            if (navigator.serviceWorker.controller) location.reload();
          });
      }).catch(function () { /* nothing to clean up */ });
    }
  }
})();
