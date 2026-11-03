/* Guess the Move - UI. No dependencies. Needs scoring.js (window.GTM) loaded first. */
(function () {
  'use strict';

  var FILES = 'abcdefgh';
  var GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟︎' };
  var COLORS = { you: '#d946ef', best: '#16a34a', real: '#2563eb', maia: '#f59e0b' };
  var ROLE = { you: 'Your move', best: 'Stockfish', real: 'Real player', maia: 'Maia' };
  var PROMO_NAME = { q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' };
  var TAG_LABEL = {
    real_blunder: 'Real player blundered', real_mistake: 'Real player erred',
    real_is_best: 'Real player found the best move', only_move: 'Only one good move',
    maia_miss: 'Surprising for that level', maia_error: 'Typical human error',
    hard_find: 'Hard-to-find best move', trivial: 'Trivial'
  };
  var HISTORY_KEY = 'gtm.v1.history', SEEN_KEY = 'gtm.v1.seen', HISTORY_MAX = 500;

  var S = {
    data: null, pos: null, parsed: null, legalFrom: {}, flipped: false,
    mode: 'best', selected: null, promo: null, revealed: false, result: null,
    seen: new Set(), history: []
  };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(n, d) { return Number(n).toFixed(d === undefined ? 1 : d); }

  var store = {
    get: function (k, dflt) {
      try { var v = window.localStorage.getItem(k); return v ? JSON.parse(v) : dflt; } catch (e) { return dflt; }
    },
    set: function (k, v) { try { window.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* optional */ } }
  };

  /* ---------- board helpers ---------- */

  function parseFen(fen) {
    var parts = fen.split(' '), board = new Array(64).fill(null);
    parts[0].split('/').forEach(function (row, i) {
      var rank = 7 - i, file = 0;
      row.split('').forEach(function (ch) {
        if (/\d/.test(ch)) file += Number(ch); else { board[rank * 8 + file] = ch; file++; }
      });
    });
    return { board: board, stm: parts[1] };
  }
  function sqName(i) { return FILES[i % 8] + (Math.floor(i / 8) + 1); }
  function sqIndex(n) { return (Number(n[1]) - 1) * 8 + FILES.indexOf(n[0]); }
  function xy(i, flipped) {
    var f = i % 8, r = Math.floor(i / 8);
    return flipped ? [7 - f, r] : [f, 7 - r];
  }
  function center(name) {
    var p = xy(sqIndex(name), S.flipped);
    return [p[0] * 100 + 50, p[1] * 100 + 50];
  }

  function arrowSvg(list) {
    var defs = '', body = '', used = {};
    Object.keys(COLORS).forEach(function (k) {
      defs += '<marker id="ah-' + k + '" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="4" markerHeight="4" orient="auto">' +
        '<path d="M0 0L10 5L0 10z" fill="' + COLORS[k] + '"/></marker>';
    });
    list.forEach(function (a) {
      var from = a.uci.slice(0, 2), to = a.uci.slice(2, 4);
      var c1 = center(from), c2 = center(to);
      var dx = c2[0] - c1[0], dy = c2[1] - c1[1], len = Math.sqrt(dx * dx + dy * dy) || 1;
      var key = a.uci, n = used[key] || 0; used[key] = n + 1;
      var off = n * 9, nx = -dy / len * off, ny = dx / len * off;
      var x1 = c1[0] + nx + dx / len * 18, y1 = c1[1] + ny + dy / len * 18;
      var x2 = c2[0] + nx - dx / len * 30, y2 = c2[1] + ny - dy / len * 30;
      body += '<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) +
        '" stroke="' + COLORS[a.key] + '" stroke-width="' + a.w + '" stroke-linecap="round" opacity=".85" marker-end="url(#ah-' + a.key + ')"' +
        (a.dash ? ' stroke-dasharray="14 10"' : '') + '/>';
    });
    return '<defs>' + defs + '</defs>' + body;
  }

  function boardSvg() {
    var s = '<svg viewBox="0 0 800 800" xmlns="http://www.w3.org/2000/svg" id="boardSvg" role="img" aria-label="Chess position">';
    var i, x, y, f, r, p;
    for (i = 0; i < 64; i++) {
      p = xy(i, S.flipped); x = p[0] * 100; y = p[1] * 100; f = i % 8; r = Math.floor(i / 8);
      var light = (f + r) % 2 === 1;
      s += '<rect class="sq ' + (light ? 'light' : 'dark') + '" data-sq="' + sqName(i) + '" x="' + x + '" y="' + y + '" width="100" height="100"/>';
    }
    for (i = 0; i < 64; i++) {  // coordinates on the outer edges
      p = xy(i, S.flipped); x = p[0] * 100; y = p[1] * 100; f = i % 8; r = Math.floor(i / 8);
      var onLight = (f + r) % 2 === 1, cls = 'coord ' + (onLight ? 'on-light' : 'on-dark');
      if (p[1] === 7) s += '<text class="' + cls + '" x="' + (x + 80) + '" y="' + (y + 92) + '">' + FILES[f] + '</text>';
      if (p[0] === 0) s += '<text class="' + cls + '" x="' + (x + 6) + '" y="' + (y + 24) + '">' + (r + 1) + '</text>';
    }
    if (S.selected) {
      p = xy(sqIndex(S.selected), S.flipped);
      s += '<rect class="sel" x="' + p[0] * 100 + '" y="' + p[1] * 100 + '" width="100" height="100"/>';
      (S.legalFrom[S.selected] || []).forEach(function (u) {
        var to = u.slice(2, 4), c = center(to), occupied = S.parsed.board[sqIndex(to)];
        s += occupied ? '<circle class="ring" cx="' + c[0] + '" cy="' + c[1] + '" r="44"/>'
                      : '<circle class="dot" cx="' + c[0] + '" cy="' + c[1] + '" r="16"/>';
      });
    }
    for (i = 0; i < 64; i++) {
      var ch = S.parsed.board[i];
      if (!ch) continue;
      p = xy(i, S.flipped);
      var white = ch === ch.toUpperCase();
      s += '<text class="piece ' + (white ? 'w' : 'b') + '" x="' + (p[0] * 100 + 50) + '" y="' + (p[1] * 100 + 54) + '">' + GLYPH[ch.toLowerCase()] + '</text>';
    }
    if (S.revealed && S.result) {
      var arrows = [{ uci: S.result.you.uci, key: 'you', w: 9 }];
      S.result.refs.forEach(function (r) { arrows.push({ uci: r.uci, key: r.key, w: r.key === 'best' ? 15 : 12, dash: r.key === 'maia' }); });
      arrows.sort(function (a, b) { return b.w - a.w; });  // thick first, thin on top
      s += arrowSvg(arrows);
    }
    return s + '</svg>';
  }

  /* ---------- rendering ---------- */

  function render() {
    if (!S.pos) { $('boardWrap').innerHTML = ''; return; }
    $('boardWrap').innerHTML = boardSvg();
    var promo = $('promo');
    if (S.promo) {
      promo.hidden = false;
      promo.innerHTML = '<span>Promote to:</span>' + S.promo.map(function (u) {
        return '<button type="button" data-uci="' + esc(u) + '">' + PROMO_NAME[u[4]] + '</button>';
      }).join('');
    } else { promo.hidden = true; promo.innerHTML = ''; }
  }

  function plausText(v) { return v === null || v === undefined ? '—' : (v * 100 < 10 ? fmt(v * 100, 1) : fmt(v * 100, 0)) + '%'; }

  function renderResult() {
    var r = S.result, p = S.pos, box = $('result');
    var best = r.refs[0], real = r.refs[1];
    var head, detail;
    if (r.mode === 'predict') {
      var exact = r.matched.real;
      head = exact ? 'Exact match with the real move!' : 'Closeness to the real move: <span class="big">' + fmt(r.score, 0) + '</span>/100';
      detail = exact ? 'You played what the ' + (p.player_elo ? '~' + p.player_elo + ' player' : 'real player') + ' played.'
        : 'Real move ' + esc(real.san) + ' differs from yours by ' + fmt(real.distance) + ' win-% points.';
    } else {
      head = 'Move quality: <span class="big">' + fmt(r.score, 0) + '</span>/100';
      detail = 'You lost ' + fmt(r.you.cost) + ' win-% points versus the best move; yours ranks ' + r.you.rank + ' of ' + r.you.n + '.';
    }
    var rows = [{ key: 'you', san: r.you.san, cost: r.you.cost, plaus: r.you.plaus, sim: null }].concat(r.refs.map(function (x) {
      return { key: x.key, san: x.san, cost: x.cost, plaus: x.plaus, sim: x };
    }));
    var maiaLabel = p.maia ? 'Maia ' + p.maia.elo : 'Maia';
    var hasMaia = !!p.maia;
    var html = '<p class="headline">' + head + '</p><p class="detail">' + detail + '</p>' +
      '<table><thead><tr><th></th><th>Move</th><th class="num">Cost</th>' + (hasMaia ? '<th class="num">Plausible</th>' : '') +
      '<th class="num">Your closeness</th></tr></thead><tbody>';
    rows.forEach(function (row) {
      var label = row.key === 'maia' ? maiaLabel : (row.key === 'real' && p.player_elo ? 'Real player ' + p.player_elo : ROLE[row.key]);
      var closeness = row.sim === null ? '' : (row.sim.same ? 'same move' : fmt(row.sim.similarity, 0) + ' (Δ' + fmt(row.sim.distance) + ')');
      html += '<tr><td><span class="chip chip-' + row.key + '"></span>' + esc(label) + '</td><td>' + esc(row.san) +
        '</td><td class="num">' + fmt(row.cost) + '</td>' + (hasMaia ? '<td class="num">' + plausText(row.plaus) + '</td>' : '') +
        '<td class="num">' + closeness + '</td></tr>';
    });
    html += '</tbody></table>';
    if (!p.maia) html += '<p class="detail">No human-model data for this position (unknown rating), so plausibility is not shown.</p>';
    if (p.tags && p.tags.length) {
      html += '<div class="tags">' + p.tags.filter(function (t) { return TAG_LABEL[t]; }).map(function (t) {
        return '<span class="tag">' + esc(TAG_LABEL[t]) + '</span>';
      }).join('') + '</div>';
    }
    if (p.site) html += '<p class="detail"><a href="' + esc(p.site) + '" rel="noopener noreferrer" target="_blank">Source game</a></p>';
    box.innerHTML = html;
    box.hidden = false;
  }

  function renderStats() {
    var h = S.history, el = $('stats');
    if (!h.length) { el.innerHTML = '<p class="muted">No guesses yet.</p>'; return; }
    function avg(list) { return list.length ? list.reduce(function (a, b) { return a + b; }, 0) / list.length : null; }
    function pct(list, key) {
      var v = list.filter(function (e) { return e[key] !== null && e[key] !== undefined; });
      return v.length ? fmt(100 * v.filter(function (e) { return e[key]; }).length / v.length, 0) + '%' : '—';
    }
    var best = h.filter(function (e) { return e.mode === 'best'; }), pred = h.filter(function (e) { return e.mode === 'predict'; });
    var a1 = avg(best.map(function (e) { return e.score; })), a2 = avg(pred.map(function (e) { return e.score; }));
    el.innerHTML = '<table><tbody>' +
      '<tr><td>Guesses</td><td class="num">' + h.length + '</td></tr>' +
      '<tr><td>Best-move mode: mean quality</td><td class="num">' + (a1 === null ? '—' : fmt(a1, 0)) + ' (' + best.length + ')</td></tr>' +
      '<tr><td>Predict mode: mean closeness</td><td class="num">' + (a2 === null ? '—' : fmt(a2, 0)) + ' (' + pred.length + ')</td></tr>' +
      '<tr><td>Found a best-eval move</td><td class="num">' + pct(h, 'mb') + '</td></tr>' +
      '<tr><td>Matched the real move</td><td class="num">' + pct(h, 'mr') + '</td></tr>' +
      '<tr><td>Matched Maia\'s move</td><td class="num">' + pct(h, 'mm') + '</td></tr></tbody></table>';
  }

  function setPrompt() {
    var p = S.pos;
    if (!p) { $('prompt').textContent = ''; $('posInfo').textContent = ''; return; }
    $('posInfo').textContent = (p.stm === 'w' ? 'White' : 'Black') + ' to move · move ' + p.move_no + ' · ' + p.phase +
      (p.player_elo ? ' · played by a ~' + p.player_elo + ' player' : '');
    $('prompt').textContent = S.mode === 'predict'
      ? 'What did the real player do here? Tap a piece, then its destination.'
      : 'Find the best move for ' + (p.stm === 'w' ? 'White' : 'Black') + '. Tap a piece, then its destination.';
  }

  /* ---------- flow ---------- */

  function applyFilters() {
    var phase = $('phase').value, tag = $('tag').value, unseen = $('unseen').checked;
    var list = S.data.positions.filter(function (p) {
      return (phase === 'any' || p.phase === phase) && (tag === 'any' || (p.tags || []).indexOf(tag) >= 0) &&
        (!unseen || !S.seen.has(p.id));
    });
    $('matchCount').textContent = list.length + ' position' + (list.length === 1 ? '' : 's') + ' match';
    return list;
  }

  function loadPosition(p) {
    S.pos = p; S.parsed = parseFen(p.fen); S.flipped = S.parsed.stm === 'b';
    S.legalFrom = {};
    Object.keys(p.evals).forEach(function (u) { (S.legalFrom[u.slice(0, 2)] = S.legalFrom[u.slice(0, 2)] || []).push(u); });
    S.selected = null; S.promo = null; S.revealed = false; S.result = null;
    $('result').hidden = true; $('next').hidden = true; $('skip').hidden = false;
    setPrompt(); render();
  }

  function nextPosition() {
    var list = applyFilters();
    if (!list.length) {
      S.pos = null; render(); setPrompt(); $('result').hidden = true; $('next').hidden = true;
      $('prompt').textContent = $('unseen').checked
        ? 'No unseen positions match. Untick "Unseen only" or change the filters.'
        : 'No positions match these filters.';
      return;
    }
    loadPosition(list[Math.floor(Math.random() * list.length)]);
  }

  function commit(uci) {
    S.revealed = true; S.selected = null; S.promo = null;
    S.result = window.GTM.analyse(S.pos, uci, S.mode);
    S.seen.add(S.pos.id);
    store.set(SEEN_KEY, Array.from(S.seen));
    S.history.push({
      id: S.pos.id, mode: S.mode, phase: S.pos.phase, tags: S.pos.tags || [], cost: S.result.you.cost,
      score: S.result.score, mb: S.result.matched.best, mr: S.result.matched.real, mm: S.result.matched.maia, t: Date.now()
    });
    if (S.history.length > HISTORY_MAX) S.history = S.history.slice(-HISTORY_MAX);
    store.set(HISTORY_KEY, S.history);
    render(); renderResult(); renderStats();
    if ($('result').scrollIntoView) $('result').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    $('next').hidden = false; $('skip').hidden = true; applyFilters();
  }

  function onSquare(name) {
    if (!S.pos || S.revealed) return;
    if (S.selected && S.selected !== name) {
      var ucis = (S.legalFrom[S.selected] || []).filter(function (u) { return u.slice(2, 4) === name; });
      if (ucis.length === 1) return commit(ucis[0]);
      if (ucis.length > 1) { S.promo = ucis; return render(); }
    }
    S.promo = null;
    S.selected = S.legalFrom[name] && S.selected !== name ? name : null;
    render();
  }

  function init() {
    S.seen = new Set(store.get(SEEN_KEY, []));
    S.history = store.get(HISTORY_KEY, []);
    var url = new URLSearchParams(window.location.search).get('data') || 'data/positions.json';

    window.fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (d) {
      if (!d || d.schema !== 1 || !Array.isArray(d.positions)) throw new Error('unsupported data file (expected schema 1)');
      S.data = d;
      var counts = {};
      d.positions.forEach(function (p) { (p.tags || []).forEach(function (t) { counts[t] = (counts[t] || 0) + 1; }); });
      $('tag').innerHTML = '<option value="any">Any</option>' + Object.keys(TAG_LABEL).filter(function (t) { return counts[t]; })
        .map(function (t) { return '<option value="' + t + '">' + esc(TAG_LABEL[t]) + ' (' + counts[t] + ')</option>'; }).join('');
      if (d.meta && d.meta.demo) {
        var b = $('banner');
        b.hidden = false;
        b.textContent = 'Demo data: three public-domain 19th-century games, no ratings, so no human-model (Maia) data. ' +
          'Build a real set with the pipeline (see README).';
      }
      renderStats(); nextPosition();
    }).catch(function (e) {
      $('prompt').textContent = 'Could not load ' + url + ' (' + e.message + '). Serve this folder over HTTP, e.g. "python3 -m http.server -d web", ' +
        'and make sure data/positions.json exists (see README).';
    });

    $('boardWrap').addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('[data-sq]') : null;
      if (t) onSquare(t.getAttribute('data-sq'));
    });
    $('promo').addEventListener('click', function (e) {
      var u = e.target.getAttribute && e.target.getAttribute('data-uci');
      if (u) commit(u);
    });
    document.querySelectorAll('input[name=mode]').forEach(function (el) {
      el.addEventListener('change', function () { if (el.checked && !S.revealed) { S.mode = el.value; setPrompt(); } else if (el.checked) { S.mode = el.value; } });
    });
    ['phase', 'tag', 'unseen'].forEach(function (id) { $(id).addEventListener('change', function () { if (S.data) nextPosition(); }); });
    $('next').addEventListener('click', nextPosition);
    $('skip').addEventListener('click', function () { if (S.pos) S.seen.add(S.pos.id); store.set(SEEN_KEY, Array.from(S.seen)); nextPosition(); });
    $('resetStats').addEventListener('click', function () {
      S.history = []; S.seen = new Set(); store.set(HISTORY_KEY, []); store.set(SEEN_KEY, []); renderStats(); if (S.data) applyFilters();
    });
    document.addEventListener('keydown', function (e) {
      if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
      if ((e.key === 'n' || e.key === 'N') && S.revealed) nextPosition();
      if (e.key === 'Escape' && !S.revealed) { S.selected = null; S.promo = null; render(); }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
}());
