/* drink.shoephone — the Fern Street menu.

   Two ideas carry the whole app.

   The first is that the house shorthand is decodable. Every code on the
   printed menu is contextual — a bare number is ounces beside a spirit
   and dashes beside bitters — so the decoder reads each amount against
   the ingredient it belongs to. That is what turns a margin note into a
   recipe without anyone having to type the recipe twice.

   The second is that the menu is a function of the shelf. The point of
   this bar is range from few bottles, so the Bar tab is not a checklist
   for its own sake: it computes what each unopened bottle would add, in
   drinks, and that number is the whole reason to buy one. */

(function () {
  'use strict';

  var STORE = 'drink.bar.v1';

  var FRACTION = { h: '1/2', q: '1/4', Q: '3/4' };

  var data = {};
  var ing = {};          /* id -> ingredient */
  var garnishCodes = []; /* longest first */
  var glassBy = {};
  var garnishBy = {};

  var have = {};         /* id -> true, what is on the shelf */
  var open = {};         /* id -> true, which recipes are expanded */

  var filter = { method: 'all', family: null, pourable: false, q: '' };

  /* ── helpers ───────────────────────────────────────────── */

  function $(s) { return document.querySelector(s); }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

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
      garnish: found.map(function (g) { return g.label; })
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

  function stocked() { return Object.keys(have).filter(function (k) { return have[k]; }); }

  /* Every ingredient a drink needs, garnish pours included — a drink is
     not pourable because you skipped the bitters that go on top. */
  function needs(d) {
    return d.build.map(function (p) { return p[0]; });
  }

  function missingFor(d, held) {
    var out = [];
    needs(d).forEach(function (id) {
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
    if (filter.method !== 'all' && d.method !== filter.method) return false;
    if (filter.family && needs(d).indexOf(filter.family) < 0) return false;
    if (filter.pourable && !canPour(d, held)) return false;
    if (filter.q) {
      var hay = (d.name + ' ' + ingredientLine(d) + ' ' + d.code).toLowerCase();
      if (hay.indexOf(filter.q) < 0) return false;
    }
    return true;
  }

  function renderRecipe(d, held) {
    var shelfInUse = stocked().length > 0;
    var html = '<div class="recipe">';

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
            esc(s.garnish.join(', ')) + '</span></div>'
        : '') +
      '</div>';

    return html + '</div>';
  }

  function renderDrink(d, held, showShelf) {
    var missing = missingFor(d, held);
    var cls = 'drink';
    if (showShelf) cls += missing.length ? ' is-short' : ' is-pourable';

    var html = '<div class="' + cls + '">' +
      '<button class="drink__head" data-drink="' + esc(d.id) + '" ' +
        'aria-expanded="' + (open[d.id] ? 'true' : 'false') + '">' +
        '<span class="drink__name">' + esc(d.name) + '</span>' +
        '<span class="drink__code">' + esc(d.code) + '</span>' +
        '<span class="drink__line">' + esc(ingredientLine(d)) + '</span>';

    if (showShelf && missing.length) {
      html += '<span class="drink__missing">Need ' + esc(missing.map(function (m) {
        return (ing[m] || {}).short || m;
      }).join(', ')) + '</span>';
    }

    html += '</button>';
    if (open[d.id]) html += renderRecipe(d, held);
    return html + '</div>';
  }

  function renderMenu() {
    var held = have;
    var showShelf = stocked().length > 0;
    var list = data.menu.cocktails.filter(function (d) { return matches(d, held); });

    if (!list.length) {
      $('#menu-body').innerHTML = '<p class="empty">Nothing on the menu matches that.</p>';
      return;
    }

    var html = '';

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

    $('#menu-body').innerHTML = html;
  }

  function renderFilters() {
    var held = have;
    var n = data.menu.cocktails.filter(function (d) { return matches(d, held); }).length;

    var seg = [{ id: 'all', label: 'All' }].concat(data.menu.methods.map(function (m) {
      return { id: m.id, label: m.label };
    }));

    var html = '<div class="filters">' +
      '<div class="seg">' + seg.map(function (s) {
        return '<button class="seg__b' + (filter.method === s.id ? ' is-on' : '') +
          '" data-method="' + s.id + '">' + esc(s.label) + '</button>';
      }).join('') + '</div>' +
      '<input class="search" id="q" type="search" placeholder="Name, ingredient, or code…" ' +
        'value="' + esc(filter.q) + '" autocomplete="off" spellcheck="false">' +
      '<div class="chips">';

    /* Spirits first — they are how anyone actually chooses a drink —
       then the modifiers that decide the rest of the menu. */
    data.bar.ingredients.filter(function (i) {
      return i.kind === 'base' || i.kind === 'vermouth' || i.kind === 'modifier';
    }).forEach(function (i) {
      html += '<button class="chip' + (filter.family === i.id ? ' is-on' : '') +
        '" data-family="' + esc(i.id) + '">' + esc(i.short) + '</button>';
    });

    html += '</div><div class="chips">' +
      '<button class="chip chip--pour' + (filter.pourable ? ' is-on' : '') +
        '" data-pourable="1">' + (filter.pourable ? '✓ ' : '') + 'What I can pour</button>' +
      (filter.family || filter.q || filter.method !== 'all' || filter.pourable
        ? '<button class="chip" data-clear="1">Clear</button>' : '') +
      '</div>' +
      '<p class="filters__note"><b>' + n + '</b> of ' + data.menu.cocktails.length + ' shown</p>' +
      '</div>';

    $('#filters').innerHTML = html;
  }

  /* ── bar view ──────────────────────────────────────────── */

  function renderBar() {
    var held = have;
    var can = pourableCount(held);
    var total = data.menu.cocktails.length;
    var bottles = stocked().length;

    var note;
    if (!bottles) {
      note = 'Tick what is actually on the shelf. The count above is what ' +
             'you can pour tonight, and every bottle below shows what it would add.';
    } else if (!can) {
      note = 'Not enough yet. The gain figures below are drinks unlocked, ' +
             'not drinks that merely use the bottle.';
    } else {
      note = plural(bottles, 'bottle', 'bottles') + ' on the shelf. ' +
             'Sort by what each unopened one would add and the menu grows fastest.';
    }

    var html = '<div class="tally">' +
      '<div class="tally__n">' + can + '</div>' +
      '<div class="tally__of">drinks you can pour · of ' + total + '</div>' +
      '<p class="tally__note">' + esc(note) + '</p>' +
      '<div class="tally__acts">' +
        '<button class="btn" data-bar="all">Stock everything</button>' +
        '<button class="btn" data-bar="none">Clear the shelf</button>' +
      '</div></div>';

    data.bar.kinds.forEach(function (k) {
      var rows = data.bar.ingredients.filter(function (i) { return i.kind === k.id; });
      if (!rows.length) return;

      html += '<section class="shelf"><h2 class="shelf__h">' + esc(k.label) + '</h2>' +
        (k.blurb ? '<p class="shelf__blurb">' + esc(k.blurb) + '</p>' : '');

      /* Biggest unlock first. Bottles already stocked keep their place
         at the top so the shelf reads as a shelf, not a leaderboard. */
      rows.map(function (i) {
        return { i: i, gain: marginalGain(i.id, held), uses: usageCount(i.id) };
      }).sort(function (a, b) {
        if (!!held[a.i.id] !== !!held[b.i.id]) return held[a.i.id] ? -1 : 1;
        if (b.gain !== a.gain) return b.gain - a.gain;
        return b.uses - a.uses;
      }).forEach(function (r) {
        var on = !!held[r.i.id];
        html += '<button class="bottle' + (on ? ' is-on' : '') + '" data-bottle="' + esc(r.i.id) + '">' +
          '<span class="bottle__box"></span>' +
          '<span class="bottle__name">' + esc(r.i.name) + '</span>' +
          (on
            ? '<span class="bottle__in">in ' + r.uses + '</span>'
            : '<span class="bottle__gain' + (r.gain ? '' : ' bottle__gain--flat') + '">' +
                (r.gain ? '+' + r.gain : 'in ' + r.uses) + '</span>') +
          '</button>';
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

    var html = '<p class="key__lead">' + esc(n.note) + '</p>' +

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
      esc(data.menu.menu.house + ' ' + data.menu.menu.number + ' — ' +
          data.menu.cocktails.length + ' drinks, ' + data.bar.ingredients.length +
          ' ingredients. Every code here is the one printed on the paper menu; ' +
          'the recipes are generated from it, so the two cannot drift apart.') +
      '</p>';

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
    if (view === 'bar') renderBar();
    if (view === 'key') renderKey();
    window.scrollTo(0, 0);
  }

  function route() { show((location.hash || '#menu').slice(1)); }

  /* ── wiring ────────────────────────────────────────────── */

  function refreshCount() {
    var can = pourableCount(have);
    var badge = $('#tab-count');
    if (stocked().length) {
      badge.textContent = can;
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
    $('#topbar-meta').textContent = data.menu.cocktails.length + ' drinks';
  }

  function repaintMenu() {
    renderFilters();
    renderMenu();
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-drink],[data-method],[data-family],[data-pourable],[data-clear],[data-bottle],[data-bar]');
    if (!t) return;

    if (t.dataset.drink) {
      open[t.dataset.drink] = !open[t.dataset.drink];
      renderMenu();
      return;
    }

    if (t.dataset.method) { filter.method = t.dataset.method; repaintMenu(); return; }

    if (t.dataset.family) {
      filter.family = filter.family === t.dataset.family ? null : t.dataset.family;
      repaintMenu();
      return;
    }

    if (t.dataset.pourable) { filter.pourable = !filter.pourable; repaintMenu(); return; }

    if (t.dataset.clear) {
      filter = { method: 'all', family: null, pourable: false, q: '' };
      repaintMenu();
      return;
    }

    if (t.dataset.bottle) {
      have[t.dataset.bottle] = !have[t.dataset.bottle];
      if (!have[t.dataset.bottle]) delete have[t.dataset.bottle];
      saveHave();
      renderBar();
      refreshCount();
      return;
    }

    if (t.dataset.bar === 'all') {
      data.bar.ingredients.forEach(function (i) { have[i.id] = true; });
      saveHave(); renderBar(); refreshCount(); return;
    }

    if (t.dataset.bar === 'none') {
      have = {};
      saveHave(); renderBar(); refreshCount(); return;
    }
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
  });

  window.addEventListener('hashchange', route);

  /* ── boot ──────────────────────────────────────────────── */

  Promise.all([
    fetch('data/cocktails.json').then(function (r) { return r.json(); }),
    fetch('data/bar.json').then(function (r) { return r.json(); }),
    fetch('data/notation.json').then(function (r) { return r.json(); })
  ]).then(function (res) {
    data.menu = res[0];
    data.bar = res[1];
    data.notation = res[2];

    data.bar.ingredients.forEach(function (i) { ing[i.id] = i; });
    data.notation.glasses.forEach(function (g) { glassBy[g.code] = g; });
    data.notation.garnishes.forEach(function (g) { garnishBy[g.code] = g; });
    garnishCodes = data.notation.garnishes.map(function (g) { return g.code; })
      .sort(function (a, b) { return b.length - a.length; });

    loadHave();

    $('#loading').hidden = true;
    repaintMenu();
    refreshCount();
    route();
  }).catch(function (err) {
    $('#loading').textContent = 'Could not load the menu. ' + err;
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* offline is a bonus */ });
    });
  }
})();
