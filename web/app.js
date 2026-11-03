/* Guess the Move - UI controller. No dependencies. Needs, in this order: strings.js, scoring.js, board.js.
 *
 * The board is one persistent <svg> with layers: squares, marks (selection, targets, pending), pieces, hover,
 * arrows, ghost. render* functions rewrite a layer; pointermove never re-renders, it only moves the ghost and
 * the hover square (attributes, so the strict CSP is never involved). */
(function () {
  'use strict';

  var T = window.GTM_STRINGS, G = window.GTM, B = window.GTM_BOARD;
  var SPRITE = 'pieces.svg#';
  var DASH = { you: 'dotted', best: 'solid', real: 'dashed', maia: 'dashdot' };
  var WIDTH = { best: 15, real: 12, maia: 10, you: 8 };
  var HISTORY_KEY = 'gtm.v1.history', SEEN_KEY = 'gtm.v1.seen', CONFIRM_KEY = 'gtm.v1.confirm';
  var ONBOARD_KEY = 'gtm.v1.onboarded', HISTORY_MAX = 500;
  var ARROW_KEYS = { ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, Home: 1 };

  var S = {
    data: null, pos: null, parsed: null, legalFrom: {}, flipped: false,
    mode: 'best', selected: null, promo: null, pending: null, revealed: false, result: null,
    confirm: false, cursor: null, kbd: false, pid: null, hoverSq: null, liveFlip: false,
    seen: new Set(), history: []
  };
  var gest = B.gesture();

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(n, d) { return Number(n).toFixed(d === undefined ? 1 : d); }
  function media(q) { return !!(window.matchMedia && window.matchMedia(q).matches); }

  var store = {
    get: function (k, dflt) {
      try { var v = window.localStorage.getItem(k); return v === null || v === undefined ? dflt : JSON.parse(v); } catch (e) { return dflt; }
    },
    set: function (k, v) { try { window.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* optional */ } }
  };

  /* Screen-reader announcements. A trailing no-break space makes an identical message announce again. */
  function announce(text) {
    S.liveFlip = !S.liveFlip;
    $('live').textContent = text + (S.liveFlip ? ' ' : '');
  }

  /* ---------- board layers ---------- */

  function layer(id, html) { $(id).innerHTML = html; }

  function renderSquares() {
    var s = '', i, p, x, y, f, r, onLight;
    for (i = 0; i < 64; i++) {
      p = B.xy(i, S.flipped); f = i % 8; r = Math.floor(i / 8);
      s += '<rect class="sq ' + ((f + r) % 2 === 1 ? 'light' : 'dark') + '" data-sq="' + B.sqName(i) + '" x="' + p[0] * 100 +
        '" y="' + p[1] * 100 + '" width="100" height="100"/>';
    }
    for (i = 0; i < 64; i++) {
      p = B.xy(i, S.flipped); x = p[0] * 100; y = p[1] * 100; f = i % 8; r = Math.floor(i / 8);
      onLight = (f + r) % 2 === 1;
      var cls = 'coord ' + (onLight ? 'on-light' : 'on-dark');
      if (p[1] === 7) s += '<text class="' + cls + '" aria-hidden="true" x="' + (x + 80) + '" y="' + (y + 92) + '">' + B.FILES[f] + '</text>';
      if (p[0] === 0) s += '<text class="' + cls + '" aria-hidden="true" x="' + (x + 6) + '" y="' + (y + 24) + '">' + (r + 1) + '</text>';
    }
    layer('gSquares', s);
  }

  function renderPieces() {
    var s = '';
    S.parsed.board.forEach(function (ch, i) {
      if (!ch) return;
      var p = B.xy(i, S.flipped);
      s += '<use class="piece" data-psq="' + B.sqName(i) + '" href="' + SPRITE + B.spriteId(ch) + '" x="' + p[0] * 100 +
        '" y="' + p[1] * 100 + '" width="100" height="100" aria-hidden="true"/>';
    });
    layer('gPieces', s);
  }

  function squareRect(cls, name) {
    var p = B.xy(B.sqIndex(name), S.flipped);
    return '<rect class="' + cls + '" x="' + p[0] * 100 + '" y="' + p[1] * 100 + '" width="100" height="100"/>';
  }

  function targets(from) {
    var seen = {};
    (S.legalFrom[from] || []).forEach(function (u) { seen[u.slice(2, 4)] = true; });
    return Object.keys(seen);
  }

  function renderMarks() {
    var s = '';
    if (S.pos) {
      if (S.pending) s += squareRect('pending', S.pending.slice(0, 2)) + squareRect('pending', S.pending.slice(2, 4));
      if (S.selected) {
        s += squareRect('sel', S.selected);
        targets(S.selected).forEach(function (to) {
          var c = B.center(to, S.flipped);
          s += S.parsed.board[B.sqIndex(to)]
            ? '<circle class="ring" cx="' + c[0] + '" cy="' + c[1] + '" r="44"/>'
            : '<circle class="dot" cx="' + c[0] + '" cy="' + c[1] + '" r="16"/>';
        });
      }
      if (S.kbd && S.cursor) s += squareRect('cursor', S.cursor);
    }
    layer('gMarks', s);
  }

  function arrowMarkup(a, n) {
    var g = B.arrowGeometry(a.uci.slice(0, 2), a.uci.slice(2, 4), n, S.flipped), w = WIDTH[a.key];
    var line = function (cls, extra) {
      return '<line class="' + cls + '" x1="' + g.x1.toFixed(1) + '" y1="' + g.y1.toFixed(1) + '" x2="' + g.x2.toFixed(1) +
        '" y2="' + g.y2.toFixed(1) + '" stroke-width="' + (w + extra) + '" stroke-linecap="round"/>';
    };
    var pts = g.head.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ');
    return '<g class="arrow arrow-' + a.key + '" data-key="' + a.key + '" data-dash="' + DASH[a.key] + '">' +
      line('halo', 7) + line('main', 0) + '<polygon class="head" points="' + pts + '"/>' +
      '<g class="arrow-label"><circle cx="' + g.lx.toFixed(1) + '" cy="' + g.ly.toFixed(1) + '" r="17"/><text x="' + g.lx.toFixed(1) +
      '" y="' + (g.ly + 1).toFixed(1) + '">' + T.letters[a.key] + '</text></g></g>';
  }

  function renderArrows() {
    var list = [];
    if (S.revealed && S.result) {
      list.push({ uci: S.result.you.uci, key: 'you' });
      S.result.refs.forEach(function (r) { list.push({ uci: r.uci, key: r.key }); });
    } else if (S.pending) {
      list.push({ uci: S.pending, key: 'you' });
    }
    list.sort(function (a, b) { return WIDTH[b.key] - WIDTH[a.key]; }); // thick first, thin on top
    var used = {};
    layer('gArrows', list.map(function (a) {
      var n = used[a.uci] || 0; used[a.uci] = n + 1;
      return arrowMarkup(a, n);
    }).join(''));
  }

  function renderBoard() {
    if (!S.pos) { ['gSquares', 'gMarks', 'gPieces', 'gArrows'].forEach(function (id) { layer(id, ''); }); return; }
    renderMarks(); renderArrows();
  }

  function renderPromo() {
    var promo = $('promo');
    if (S.promo) {
      promo.hidden = false;
      promo.innerHTML = '<span>Promote to:</span>' + S.promo.map(function (u) {
        return '<button type="button" data-uci="' + esc(u) + '">' + T.promoNames[u[4]] + '</button>';
      }).join('');
    } else { promo.hidden = true; promo.innerHTML = ''; }
  }

  function refresh() { renderBoard(); renderPromo(); updateActions(); }

  function updateActions() {
    $('skip').hidden = !S.pos || S.revealed;
    $('confirm').hidden = !S.pending || S.revealed;
    $('next').hidden = !S.revealed;
  }

  /* ---------- results ---------- */

  function plausText(v) { return v === null || v === undefined ? '—' : (v * 100 < 10 ? fmt(v * 100, 1) : fmt(v * 100, 0)) + '%'; }

  function costBar(cost) {
    var w = Math.max(0, Math.min(100, cost));
    return '<svg class="cost-bar" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true">' +
      '<rect class="bg" width="100" height="6" rx="3"/><rect class="fill" width="' + w.toFixed(1) + '" height="6" rx="3"/></svg>';
  }

  function verdictText(r, p) {
    if (r.mode === 'predict') return r.matched.real ? T.verdict.exactReal : T.verdict.near(Math.round(r.score));
    if (r.matched.best) return T.verdict.foundBest;
    if (r.matched.maia) return T.verdict.likeMaia(p.maia && p.maia.elo);
    if (r.matched.real) return T.verdict.likeReal;
    return T.verdict.lost(fmt(r.you.cost));
  }

  function legendHtml(p) {
    var keys = ['you', 'best', 'real'].concat(p.maia ? ['maia'] : []);
    return keys.map(function (k) {
      var label = k === 'maia' ? T.result.maiaAt(p.maia.elo) : (k === 'real' && p.player_elo ? T.result.realAt(p.player_elo) : T.roles[k]);
      return '<span class="legend-item arrow-' + k + '" data-key="' + k + '"><svg class="legend-line" viewBox="0 0 44 14" aria-hidden="true">' +
        '<line class="halo" x1="5" y1="7" x2="39" y2="7" stroke-width="12" stroke-linecap="round"/>' +
        '<line class="main" x1="5" y1="7" x2="39" y2="7" stroke-width="6" stroke-linecap="round"/></svg>' +
        '<b>' + T.letters[k] + '</b> ' + esc(label) + '</span>';
    }).join('');
  }

  function renderResult() {
    var r = S.result, p = S.pos, box = $('result'), real = r.refs[1];
    var head, detail;
    if (r.mode === 'predict') {
      head = r.matched.real ? T.result.exact : T.result.closeness(fmt(r.score, 0));
      detail = r.matched.real ? T.result.exactDetail(p.player_elo) : T.result.realDiffers(esc(real.san), fmt(real.distance));
    } else {
      head = T.result.quality(fmt(r.score, 0));
      detail = T.result.lost(fmt(r.you.cost), r.you.rank, r.you.n);
    }
    var rows = [{ key: 'you', san: r.you.san, cost: r.you.cost, plaus: r.you.plaus, sim: null }].concat(r.refs.map(function (x) {
      return { key: x.key, san: x.san, cost: x.cost, plaus: x.plaus, sim: x };
    }));
    var hasMaia = !!p.maia, c = T.result.cols;
    var html = '<p class="headline">' + head + '</p><p class="detail">' + detail + '</p>' +
      '<table><thead><tr><th><span class="sr-only">Move by</span></th><th>' + c.move + '</th><th class="num">' + c.cost + '</th>' +
      (hasMaia ? '<th class="num">' + c.plausible + '</th>' : '') + '<th class="num">' + c.closeness + '</th></tr></thead><tbody>';
    rows.forEach(function (row) {
      var label = row.key === 'maia' ? T.result.maiaAt(p.maia.elo) : (row.key === 'real' && p.player_elo ? T.result.realAt(p.player_elo) : T.roles[row.key]);
      var closeness = row.sim === null ? '' : (row.sim.same ? T.result.sameMove : fmt(row.sim.similarity, 0) + ' (Δ' + fmt(row.sim.distance) + ')');
      html += '<tr><td><span class="chip chip-' + row.key + '"></span>' + esc(label) + '</td><td>' + esc(row.san) +
        '</td><td class="num">' + fmt(row.cost) + costBar(row.cost) + '</td>' + (hasMaia ? '<td class="num">' + plausText(row.plaus) + '</td>' : '') +
        '<td class="num">' + closeness + '</td></tr>';
    });
    html += '</tbody></table><p class="detail muted small">' + T.result.help + '</p>';
    if (!hasMaia) html += '<p class="detail">' + T.noMaia + '</p>';
    var tags = (p.tags || []).filter(function (t) { return T.tags[t]; });
    if (tags.length) html += '<div class="tags">' + tags.map(function (t) { return '<span class="tag">' + esc(T.tags[t]) + '</span>'; }).join('') + '</div>';
    if (p.site) html += '<p class="detail"><a href="' + esc(p.site) + '" rel="noopener noreferrer" target="_blank">' + T.sourceGame + '</a></p>';
    box.innerHTML = html;
    box.hidden = false;

    $('prompt').hidden = true;
    $('verdict').textContent = verdictText(r, p);
    $('verdict').hidden = false;
    $('legend').innerHTML = legendHtml(p);
    $('legend').hidden = false;
  }

  function renderStats() {
    var h = S.history, el = $('stats');
    if (!h.length) { el.innerHTML = '<p class="muted">' + T.stats.none + '</p>'; return; }
    function avg(list) { return list.length ? list.reduce(function (a, b) { return a + b; }, 0) / list.length : null; }
    function pct(list, key) {
      var v = list.filter(function (e) { return e[key] !== null && e[key] !== undefined; });
      return v.length ? fmt(100 * v.filter(function (e) { return e[key]; }).length / v.length, 0) + '%' : '—';
    }
    var best = h.filter(function (e) { return e.mode === 'best'; }), pred = h.filter(function (e) { return e.mode === 'predict'; });
    var a1 = avg(best.map(function (e) { return e.score; })), a2 = avg(pred.map(function (e) { return e.score; }));
    var st = T.stats;
    el.innerHTML = '<table><tbody>' +
      '<tr><td>' + st.guesses + '</td><td class="num">' + h.length + '</td></tr>' +
      '<tr><td>' + st.bestMean + '</td><td class="num">' + (a1 === null ? '—' : fmt(a1, 0)) + ' (' + best.length + ')</td></tr>' +
      '<tr><td>' + st.predictMean + '</td><td class="num">' + (a2 === null ? '—' : fmt(a2, 0)) + ' (' + pred.length + ')</td></tr>' +
      '<tr><td>' + st.foundBest + '</td><td class="num">' + pct(h, 'mb') + '</td></tr>' +
      '<tr><td>' + st.matchedReal + '</td><td class="num">' + pct(h, 'mr') + '</td></tr>' +
      '<tr><td>' + st.matchedMaia + '</td><td class="num">' + pct(h, 'mm') + '</td></tr></tbody></table>';
  }

  function setPrompt() {
    var p = S.pos, el = $('prompt');
    el.hidden = false; $('verdict').hidden = true; $('legend').hidden = true;
    if (!p) { el.textContent = ''; $('posInfo').textContent = ''; return; }
    $('posInfo').textContent = T.posInfo(p);
    el.textContent = S.mode === 'predict' ? T.prompt.predict : T.prompt.best(p.stm);
  }

  /* ---------- flow ---------- */

  function applyFilters() {
    var phase = $('phase').value, tag = $('tag').value, unseen = $('unseen').checked;
    var list = S.data.positions.filter(function (p) {
      return (phase === 'any' || p.phase === phase) && (tag === 'any' || (p.tags || []).indexOf(tag) >= 0) &&
        (!unseen || !S.seen.has(p.id));
    });
    $('matchCount').textContent = T.matchCount(list.length);
    return list;
  }

  function loadPosition(p) {
    S.pos = p; S.parsed = B.parseFen(p.fen); S.flipped = S.parsed.stm === 'b';
    S.legalFrom = {};
    Object.keys(p.evals).forEach(function (u) { (S.legalFrom[u.slice(0, 2)] = S.legalFrom[u.slice(0, 2)] || []).push(u); });
    S.selected = null; S.promo = null; S.pending = null; S.revealed = false; S.result = null; S.cursor = null;
    $('result').hidden = true;
    svgReset();
    renderSquares(); renderPieces();
    setPrompt(); refresh();
    $('boardSvg').setAttribute('aria-label', T.boardLabel + ' ' + (p.stm === 'w' ? 'White' : 'Black') + ' to move.');
  }

  function nextPosition() {
    var list = applyFilters();
    if (!list.length) {
      S.pos = null; svgReset(); setPrompt(); refresh(); $('result').hidden = true;
      $('prompt').textContent = $('unseen').checked ? T.prompt.noneUnseen : T.prompt.none;
      return;
    }
    loadPosition(list[Math.floor(Math.random() * list.length)]);
  }

  function clearSelection() { S.selected = null; S.promo = null; S.pending = null; refresh(); }

  function commit(uci) {
    S.revealed = true; S.selected = null; S.promo = null; S.pending = null;
    S.result = G.analyse(S.pos, uci, S.mode);
    S.seen.add(S.pos.id);
    store.set(SEEN_KEY, Array.from(S.seen));
    S.history.push({
      id: S.pos.id, mode: S.mode, phase: S.pos.phase, tags: S.pos.tags || [], cost: S.result.you.cost,
      score: S.result.score, mb: S.result.matched.best, mr: S.result.matched.real, mm: S.result.matched.maia, t: Date.now()
    });
    if (S.history.length > HISTORY_MAX) S.history = S.history.slice(-HISTORY_MAX);
    store.set(HISTORY_KEY, S.history);
    refresh(); renderResult(); renderStats(); applyFilters();
    announce(T.live.played(uci.slice(0, 2), uci.slice(2, 4), verdictText(S.result, S.pos)));
  }

  /* A move was chosen (clicked, dragged or typed): reveal it, or hold it as pending when confirmation is on. */
  function propose(uci) {
    if (!S.confirm) return commit(uci);
    S.pending = uci; S.promo = null;
    refresh();
    announce(T.live.pending(uci.slice(0, 2), uci.slice(2, 4)));
  }

  function tryMove(from, to) {
    var ucis = (S.legalFrom[from] || []).filter(function (u) { return u.slice(2, 4) === to; });
    if (!ucis.length) return false;
    S.selected = from;
    if (ucis.length > 1) { S.promo = ucis; S.pending = null; refresh(); announce(T.live.promo); return true; }
    propose(ucis[0]);
    return true;
  }

  /* Tap, click or Enter on a square. */
  function onSquare(name) {
    if (!S.pos || S.revealed) return;
    if (S.selected && S.selected !== name && tryMove(S.selected, name)) return;
    S.promo = null; S.pending = null;
    var own = !!S.legalFrom[name];
    S.selected = own && S.selected !== name ? name : null;
    refresh();
    announce(S.selected ? T.live.selected(name, targets(name).length) : (own ? T.live.cancelled : T.live.noPiece(name)));
  }

  /* ---------- pointer input (mouse, touch, pen) ---------- */

  var svg;
  function boardRect() { return svg.getBoundingClientRect(); }
  function squareAt(e) { return B.squareFromPoint(e.clientX, e.clientY, boardRect(), S.flipped); }
  function svgReset() { layer('gGhost', ''); $('hoverSq').setAttribute('class', 'hover off'); svg.removeAttribute('data-dragging'); S.hoverSq = null; }

  function startDrag() {
    var from = gest.from(), ch = S.parsed.board[B.sqIndex(from)];
    svg.setAttribute('data-dragging', 'true');
    var origin = svg.querySelector('[data-psq="' + from + '"]');
    if (origin) origin.classList.add('drag-origin');
    layer('gGhost', '<use class="ghost" href="' + SPRITE + B.spriteId(ch) + '" width="120" height="120" aria-hidden="true"/>');
  }

  function moveGhost(e) {
    var v = B.toViewBox(e.clientX, e.clientY, boardRect());
    var ghost = $('gGhost').firstChild, lift = e.pointerType === 'touch' ? 55 : 0; // lift it above the finger
    ghost.setAttribute('x', (v[0] - 60).toFixed(1));
    ghost.setAttribute('y', (v[1] - 60 - lift).toFixed(1));
    var sq = squareAt(e);
    if (sq === S.hoverSq) return;
    S.hoverSq = sq;
    var hover = $('hoverSq');
    if (!sq) { hover.setAttribute('class', 'hover off'); return; }
    var p = B.xy(B.sqIndex(sq), S.flipped);
    hover.setAttribute('x', p[0] * 100); hover.setAttribute('y', p[1] * 100);
    hover.setAttribute('class', 'hover ' + (targets(gest.from()).indexOf(sq) >= 0 ? 'ok' : 'no'));
  }

  function endDrag() {
    var origin = svg.querySelector('.drag-origin');
    if (origin) origin.classList.remove('drag-origin');
    svgReset();
  }

  /* The pointer sequence ended without a move: the browser took it (pointercancel), the pointer capture was lost,
   * or Escape was pressed. A drag in progress is put back, leaving no commit, no selection and no ghost. */
  function cancelGesture() {
    var wasDragging = gest.dragging();
    gest.cancel(); S.pid = null;
    if (!wasDragging) return;
    endDrag();
    clearSelection();
    announce(T.live.dragCancelled);
  }

  function onPointerDown(e) {
    if (!S.pos || S.revealed || gest.active()) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    var sq = squareAt(e);
    if (!sq) return;
    S.kbd = false; S.pid = e.pointerId;
    if (gest.down(sq, e.clientX, e.clientY, !!S.legalFrom[sq], S.selected === sq)) {
      S.selected = sq; S.promo = null; S.pending = null; // select on press, so a drag already shows its targets
      refresh();
    }
    try { svg.setPointerCapture(e.pointerId); } catch (err) { /* not supported or pointer already gone */ }
  }

  function onPointerMove(e) {
    if (e.pointerId !== S.pid) return;
    var m = gest.move(e.clientX, e.clientY);
    if (m === 'start') startDrag();
    if (m) moveGhost(e);
  }

  function onPointerUp(e) {
    if (e.pointerId !== S.pid) return;
    var sq = squareAt(e), res = gest.up();
    S.pid = null;
    try { svg.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
    if (res.type === 'drop') {
      endDrag();
      if (sq === res.from) { S.selected = res.from; refresh(); announce(T.live.selected(sq, targets(sq).length)); }
      else if (!(sq && tryMove(res.from, sq))) { clearSelection(); announce(T.live.dragCancelled); }
    } else if (res.type === 'tap') {
      if (res.selectedOnDown) announce(T.live.selected(res.sq, targets(res.sq).length)); else onSquare(res.sq);
    }
  }

  /* ---------- keyboard ---------- */

  function describeCursor() {
    announce(T.live.cursor(S.cursor, B.pieceName(S.parsed.board[B.sqIndex(S.cursor)])));
  }

  function onBoardKey(e) {
    if (!S.pos || e.ctrlKey || e.metaKey || e.altKey) return;
    if (ARROW_KEYS[e.key]) {
      e.preventDefault();
      S.kbd = true;
      S.cursor = B.step(S.cursor || B.homeSquare(S.flipped), e.key, S.flipped);
      renderMarks(); describeCursor();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      S.kbd = true;
      if (!S.cursor) S.cursor = B.homeSquare(S.flipped);
      onSquare(S.cursor);
      renderMarks();
    }
  }

  function onDocKey(e) {
    if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if ((e.key === 'n' || e.key === 'N') && S.revealed) nextPosition();
    if (e.key === 'Escape') {
      if (gest.active()) cancelGesture();
      else if (!S.revealed && (S.selected || S.promo || S.pending)) { clearSelection(); announce(T.live.cancelled); }
    }
  }

  /* ---------- start-up ---------- */

  function showLoadError(url, e) {
    var msg = window.navigator.onLine === false ? T.prompt.offline(url) : T.prompt.loadError(url, e.message);
    $('prompt').hidden = false;
    $('prompt').innerHTML = '<span>' + esc(msg) + '</span> <button id="retry" type="button">' + T.prompt.retry + '</button>';
    $('retry').addEventListener('click', load);
  }

  function load() {
    var url = new URLSearchParams(window.location.search).get('data') || 'data/positions.json';
    $('skeleton').hidden = false;
    $('prompt').textContent = '';
    window.fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (d) {
      if (!d || d.schema !== 1 || !Array.isArray(d.positions)) throw new Error('unsupported data file (expected schema 1)');
      S.data = d;
      var counts = {};
      d.positions.forEach(function (p) { (p.tags || []).forEach(function (t) { counts[t] = (counts[t] || 0) + 1; }); });
      $('tag').innerHTML = '<option value="any">' + T.anyOption + '</option>' + Object.keys(T.tags).filter(function (t) { return counts[t]; })
        .map(function (t) { return '<option value="' + t + '">' + esc(T.tags[t]) + ' (' + counts[t] + ')</option>'; }).join('');
      if (d.meta && d.meta.demo) { $('banner').hidden = false; $('banner').textContent = T.demoBanner; }
      $('skeleton').hidden = true;
      renderStats(); nextPosition();
    }).catch(function (e) {
      $('skeleton').hidden = true;
      showLoadError(url, e);
    });
  }

  function updateThemeButton() {
    var dark = window.GTM_THEME && window.GTM_THEME.current() === 'dark';
    $('themeToggle').setAttribute('aria-label', dark ? T.toggleThemeToLight : T.toggleThemeToDark);
  }

  function init() {
    svg = $('boardSvg');
    S.seen = new Set(store.get(SEEN_KEY, []));
    S.history = store.get(HISTORY_KEY, []);
    S.confirm = store.get(CONFIRM_KEY, null);
    if (S.confirm === null) S.confirm = media('(pointer: coarse)'); // a slip of the finger is likelier than a slip of the mouse
    $('confirmToggle').checked = S.confirm;
    if (media('(max-width: 480px)')) $('filters').open = false;
    if (!store.get(ONBOARD_KEY, false)) $('onboarding').hidden = false;
    updateThemeButton();
    $('skeleton').hidden = false;
    load();

    svg.addEventListener('pointerdown', onPointerDown);
    svg.addEventListener('pointermove', onPointerMove);
    svg.addEventListener('pointerup', onPointerUp);
    svg.addEventListener('pointercancel', cancelGesture);
    svg.addEventListener('lostpointercapture', function () { if (gest.dragging()) cancelGesture(); });
    // Real mouse and touch clicks (detail > 0) were handled by the pointer events above; a click with detail 0 comes from
    // assistive technology or a script, and still has to work.
    svg.addEventListener('click', function (e) {
      if (e.detail !== 0) return;
      var t = e.target.closest ? e.target.closest('[data-sq]') : null;
      if (t) onSquare(t.getAttribute('data-sq'));
    });
    svg.addEventListener('keydown', onBoardKey);
    svg.addEventListener('focus', function () {
      S.kbd = !gest.active();
      if (S.kbd && S.pos) { S.cursor = S.cursor || B.homeSquare(S.flipped); renderMarks(); }
    });
    svg.addEventListener('blur', function () { S.kbd = false; renderMarks(); });

    $('promo').addEventListener('click', function (e) {
      var u = e.target.getAttribute && e.target.getAttribute('data-uci');
      if (u) propose(u);
    });
    document.querySelectorAll('input[name=mode]').forEach(function (el) {
      el.addEventListener('change', function () { if (el.checked) { S.mode = el.value; if (!S.revealed) setPrompt(); } });
    });
    ['phase', 'tag', 'unseen'].forEach(function (id) { $(id).addEventListener('change', function () { if (S.data) nextPosition(); }); });
    $('next').addEventListener('click', nextPosition);
    $('confirm').addEventListener('click', function () { if (S.pending) commit(S.pending); });
    $('skip').addEventListener('click', function () { if (S.pos) S.seen.add(S.pos.id); store.set(SEEN_KEY, Array.from(S.seen)); nextPosition(); });
    $('resetStats').addEventListener('click', function () {
      S.history = []; S.seen = new Set(); store.set(HISTORY_KEY, []); store.set(SEEN_KEY, []); renderStats(); if (S.data) applyFilters();
    });
    $('confirmToggle').addEventListener('change', function () {
      S.confirm = $('confirmToggle').checked; store.set(CONFIRM_KEY, S.confirm);
      if (!S.confirm && S.pending) { S.pending = null; refresh(); }
    });
    $('themeToggle').addEventListener('click', function () { window.GTM_THEME.toggle(); updateThemeButton(); });
    $('helpBtn').addEventListener('click', function () { $('onboarding').hidden = !$('onboarding').hidden; });
    $('onboardingClose').addEventListener('click', function () { $('onboarding').hidden = true; store.set(ONBOARD_KEY, true); });
    document.addEventListener('keydown', onDocKey);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
}());
