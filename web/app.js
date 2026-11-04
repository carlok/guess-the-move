// SPDX-License-Identifier: AGPL-3.0-or-later
/* Guess the Move - UI controller. No dependencies. Needs, in this order: strings.js, scoring.js, board.js.
 *
 * The board is one persistent <svg> with layers: squares, marks (selection, targets, pending), pieces, hover,
 * arrows, ghost. render* functions rewrite a layer; pointermove never re-renders, it only moves the ghost and
 * the hover square (attributes, so the strict CSP is never involved). */
(function () {
  'use strict';

  var T = window.GTM_STRINGS, G = window.GTM, B = window.GTM_BOARD, CL = window.GTM_CLASSIFY, TV = window.GTM_TIERVIEW, SH = window.GTM_SHARE, SRS = window.GTM_SRS, RP = window.GTM_REPORT;
  var SPRITE = 'pieces.svg#';
  var DASH = { you: 'dotted', best: 'solid', real: 'dashed', maia: 'dashdot', preview: 'solid' };
  var WIDTH = { best: 15, real: 12, maia: 11, you: 10, preview: 8 };
  var HISTORY_KEY = 'gtm.v1.history', SEEN_KEY = 'gtm.v1.seen', CONFIRM_KEY = 'gtm.v1.confirm';
  var TRAIL_MAX = 100, LAST_KEY = 'gtm.v1.lastSession', SESSION_LEN = 10, GOAL_KEY = 'gtm.v1.goal', GOALDAY_KEY = 'gtm.v1.goalday', ORIENT_KEY = 'gtm.v1.orientation', COORDS_KEY = 'gtm.v1.coords', SRS_KEY = 'gtm.v1.srs', PLAYS_KEY = 'gtm.v1.plays', SRS_ON_KEY = 'gtm.v1.srson', RETRY_GAP = 2, ADAPTIVE_KEY = 'gtm.v1.adaptive', LEVEL_MIN = 5, LEVEL_WINDOW = 40;
  var ONBOARD_KEY = 'gtm.v1.onboarded', HISTORY_MAX = 500, SOUND_KEY = 'gtm.v1.sound', TIMER_KEY = 'gtm.v1.timer';
  var ARROW_KEYS = { ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, Home: 1 };

  var S = {
    data: null, pos: null, parsed: null, legalFrom: {}, flipped: false,
    mode: 'best', selected: null, promo: null, pending: null, revealed: false, result: null,
    api: null, confirm: false, cursor: null, kbd: false, pid: null, hoverSq: null, liveFlip: false,
    seen: new Set(), history: [], showTimer: true, statsPushed: false,
    session: null, goal: 10, orientation: 'auto', coords: true,
    srs: {}, plays: 0, srsOn: true, sinceRetry: RETRY_GAP, retrying: false,
    adaptive: false, hasAnchors: false, byId: null, picked: null, preview: null, previewLabel: '', tiers: null,
    trail: [], cur: null // positions answered in this visit, and the one being reviewed (null: a live position)
  };
  var snd = null; // sound effects, made in init()
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

  /* ---------- timer: counts up while a position is open, pauses off-screen, restarts with each position ---------- */

  var timer = { acc: 0, since: null };
  function nowMs() { return window.Date.now(); }
  function elapsedMs() { return timer.acc + (timer.since === null ? 0 : nowMs() - timer.since); }
  function clockText(ms) { return window.GTM_STATS.clock(ms / 1000); }
  function renderTimer() { $('timer').textContent = clockText(elapsedMs()); }
  function timerStart() { timer.acc = 0; timer.since = nowMs(); renderTimer(); }
  function timerPause() { if (timer.since !== null) { timer.acc += nowMs() - timer.since; timer.since = null; } }
  function timerStop() { timerPause(); renderTimer(); }
  function timerReset() { timer.acc = 0; timer.since = null; renderTimer(); }
  function overlayOpen() { return !$('menu').hidden || !$('statsView').hidden || !$('reportView').hidden || document.hidden === true; }
  function timerResume() { if (S.pos && !S.revealed && timer.since === null && !overlayOpen()) timer.since = nowMs(); }

  /* ---------- sound ---------- */

  function sfx(name, delay) { if (snd) snd.play(name, delay); }
  function updateSoundButton() {
    var on = !snd || snd.isEnabled();
    $('soundToggle').setAttribute('aria-label', on ? T.sound.on : T.sound.off);
    $('soundToggle').setAttribute('data-state', on ? 'on' : 'off');
  }
  function isCapture(uci) {
    var mover = S.parsed.board[B.sqIndex(uci.slice(0, 2))];
    return !!S.parsed.board[B.sqIndex(uci.slice(2, 4))] || (!!mover && mover.toLowerCase() === 'p' && uci[0] !== uci[2]); // en passant
  }
  function outcomeSound(r) {
    if (r.mode === 'predict') return r.matched.real ? 'good' : (r.score >= 70 ? 'fine' : 'bad');
    if (r.matched.best) return 'good';
    return r.matched.maia || r.matched.real || r.score >= 70 ? 'fine' : 'bad';
  }

  /* ---------- board layers ---------- */

  function layer(id, html) { $(id).innerHTML = html; }

  function renderSquares() { layer('gSquares', SH.squares(S.flipped)); } // the card the answer can be saved as draws the same squares

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

  /* One arrow per distinct move. When several references chose the same move (often: you, Stockfish and the real player),
   * one pill at the arrow lists every letter, so nothing is stacked or hidden. The arrow takes the style of the most
   * informative key; the letters, not the colour, say who chose it. */
  var STYLE_PRIORITY = ['best', 'real', 'maia', 'you', 'preview'];

  function arrowMarkup(uci, keys) {
    var key = STYLE_PRIORITY.filter(function (k) { return keys.indexOf(k) >= 0; })[0], w = WIDTH[key];
    var g = B.arrowGeometry(uci.slice(0, 2), uci.slice(2, 4), S.flipped);
    var line = function (cls, extra) {
      return '<line class="' + cls + '" x1="' + g.x1.toFixed(1) + '" y1="' + g.y1.toFixed(1) + '" x2="' + g.x2.toFixed(1) +
        '" y2="' + g.y2.toFixed(1) + '" stroke-width="' + (w + extra) + '" stroke-linecap="round"/>';
    };
    var pts = g.head.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ');
    var letters = keys.map(function (k) { return k === 'preview' ? S.previewLabel : T.letters[k]; }).join(' '), width = 22 + keys.length * 15 + (keys.length - 1) * 7;
    return '<g class="arrow arrow-' + key + '" data-key="' + key + '" data-keys="' + keys.join(' ') + '" data-dash="' + DASH[key] + '">' +
      line('halo', 7) + line('main', 0) + '<polygon class="head" points="' + pts + '"/>' +
      '<g class="arrow-label"><rect x="' + (g.lx - width / 2).toFixed(1) + '" y="' + (g.ly - 17).toFixed(1) + '" width="' + width + '" height="34" rx="17"/>' +
      '<text x="' + g.lx.toFixed(1) + '" y="' + (g.ly + 1).toFixed(1) + '">' + letters + '</text></g></g>';
  }

  /* The arrows to draw, thickest first: yours and the references once revealed (or the pending move), plus a move previewed from
   * the list when `withPreview`. */
  function arrowGroups(withPreview) {
    var list = [];
    if (S.revealed && S.result) {
      list.push({ uci: S.result.you.uci, key: 'you' });
      S.result.refs.forEach(function (r) { list.push({ uci: r.uci, key: r.key }); });
    } else if (S.pending) {
      list.push({ uci: S.pending, key: 'you' });
    }
    var groups = [], byMove = {};
    list.forEach(function (a) {
      if (!byMove[a.uci]) { byMove[a.uci] = { uci: a.uci, keys: [] }; groups.push(byMove[a.uci]); }
      byMove[a.uci].keys.push(a.key);
    });
    if (withPreview && S.revealed && S.preview && !byMove[S.preview]) groups.push({ uci: S.preview, keys: ['preview'] }); // a move chosen in the list that no role already draws
    var style = function (g) { return STYLE_PRIORITY.filter(function (k) { return g.keys.indexOf(k) >= 0; })[0]; };
    groups.sort(function (a, b) { return WIDTH[style(b)] - WIDTH[style(a)]; }); // thick first, thin on top
    return groups;
  }

  function renderArrows() { layer('gArrows', arrowGroups(true).map(function (g) { return arrowMarkup(g.uci, g.keys); }).join('')); }

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

  /* Where the position on screen sits in the trail: its own index when reviewing or just answered (answered positions
   * are appended at the reveal), and one past the end when it is live and unanswered or there is none, so "previous"
   * is always a different position from the one shown. */
  function trailIndex() {
    if (S.cur !== null) return S.cur;
    return S.pos && S.revealed && !S.pos.custom ? S.trail.length - 1 : S.trail.length;
  }

  function updateActions() {
    var reviewing = S.cur !== null;
    $('back').hidden = trailIndex() === 0; // also offered when every position is answered and no live one is left
    $('tryAgain').hidden = !reviewing;
    $('reviewChip').hidden = !reviewing;
    $('reviewChip').textContent = reviewing && S.trail[S.cur] && S.trail[S.cur].shared ? T.link.sharedChip : T.review.chip;
    $('linkBtn').hidden = !S.pos || !!S.pos.custom;
    $('retryChip').hidden = reviewing || !S.retrying || !S.pos;
    var ses = S.session;
    $('sessionBtn').hidden = !!ses;
    $('sessionChip').hidden = $('sessionEnd').hidden = !ses;
    if (ses) $('sessionChip').textContent = T.session.chip(ses.done ? ses.n : Math.min(ses.n, ses.rows.length + (S.revealed ? 0 : 1)), ses.n);
    $('next').textContent = ses && ses.done && S.revealed && !reviewing ? T.session.seeReport : T.next;
    $('pickChip').hidden = reviewing || S.picked === null || !S.pos;
    if (!$('pickChip').hidden) $('pickChip').textContent = T.level.pickedBits(S.picked);
    $('skip').hidden = !S.pos || S.revealed;
    $('confirm').hidden = !S.pending || S.revealed;
    $('next').hidden = !S.revealed;
    $('chips').hidden = !['reviewChip', 'pickChip', 'retryChip', 'sessionChip', 'sessionEnd'].some(function (id) { return !$(id).hidden; });
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
    var keys = ['you', 'best'].concat(p.real ? ['real'] : [], p.maia ? ['maia'] : []);
    return keys.map(function (k) {
      var label = k === 'maia' ? T.result.maiaAt(p.maia.elo) : (k === 'real' && p.player_elo ? T.result.realAt(p.player_elo) : T.roles[k]);
      return '<span class="legend-item arrow-' + k + '" data-key="' + k + '"><svg class="legend-line" viewBox="0 0 44 14" aria-hidden="true">' +
        '<line class="halo" x1="5" y1="7" x2="39" y2="7" stroke-width="12" stroke-linecap="round"/>' +
        '<line class="main" x1="5" y1="7" x2="39" y2="7" stroke-width="6" stroke-linecap="round"/></svg>' +
        '<b>' + T.letters[k] + '</b> ' + esc(label) + '</span>';
    }).join('');
  }

  /* The link to the original game. On Lichess a "#<ply>" suffix opens the game at that half-move, i.e. at the position
   * that was guessed (assumed from Lichess's behaviour, not verified for every game page). Anything else stays as is. */
  function gameLink(p) {
    return /^https:\/\/lichess\.org\/[A-Za-z0-9]{8,12}$/.test(p.site) && Number.isInteger(p.ply) ? p.site + '#' + p.ply : p.site;
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
    var sum = CL.summary(p, r.you.uci), marks = {};
    S.tiers = sum;
    var rows = [{ key: 'you', uci: r.you.uci, san: r.you.san, cost: r.you.cost, plaus: r.you.plaus, sim: null }].concat(r.refs.map(function (x) {
      return { key: x.key, uci: x.uci, san: x.san, cost: x.cost, plaus: x.plaus, sim: x };
    }));
    rows.forEach(function (row) { (marks[row.uci] = marks[row.uci] || []).push(row.key); });
    var hasMaia = !!p.maia, c = T.result.cols;
    var html = '<p class="headline">' + head + '</p><p class="tier-line">' + TV.badge(sum.yours.tier, T) + ' ' + esc(T.tiers.better(sum.betterThan)) + '</p><p class="detail">' + detail + '</p>' +
      TV.bar(sum, T, r.you.uci) +
      '<table><thead><tr><th><span class="sr-only">Move by</span></th><th>' + c.move + '</th><th class="num">' + c.cost + '</th>' +
      (hasMaia ? '<th class="num">' + c.plausible + '</th>' : '') + '<th class="num">' + c.closeness + '</th></tr></thead><tbody>';
    rows.forEach(function (row) {
      var label = row.key === 'maia' ? T.result.maiaAt(p.maia.elo) : (row.key === 'real' && p.player_elo ? T.result.realAt(p.player_elo) : T.roles[row.key]);
      var closeness = row.sim === null ? '' : (row.sim.same ? T.result.sameMove : fmt(row.sim.similarity, 0) + ' (Δ' + fmt(row.sim.distance) + ')');
      html += '<tr><td><span class="chip chip-' + row.key + '"></span>' + esc(label) + '</td><td>' + esc(row.san) + ' ' + TV.badge(sum.all[row.uci].tier, T, true) +
        '</td><td class="num">' + fmt(row.cost) + costBar(row.cost) + '</td>' + (hasMaia ? '<td class="num">' + plausText(row.plaus) + '</td>' : '') +
        '<td class="num">' + closeness + '</td></tr>';
    });
    html += '</tbody></table><p class="detail muted small">' + T.result.help + '</p>' + TV.list(p, sum, marks, T);
    if (!hasMaia) html += '<p class="detail">' + T.noMaia + '</p>';
    var tags = (p.tags || []).filter(function (t) { return T.tags[t]; });
    if (tags.length) html += '<div class="tags">' + tags.map(function (t) { return '<span class="tag">' + esc(T.tags[t]) + '</span>'; }).join('') + '</div>';
    html += '<div class="result-actions"><button type="button" id="saveImage">' + T.share.saveImage + '</button><button type="button" id="saveFen">' + T.share.saveFen + '</button><button type="button" id="copyFen">' + T.share.copyFen + '</button>' +
      (p.custom ? '' : '<button type="button" id="copyAnswer">' + T.link.copyAnswer + '</button>') + '</div>';
    if (p.site) html += '<p class="detail"><a href="' + esc(gameLink(p)) + '" rel="noopener noreferrer" target="_blank">' + T.sourceGame + '</a></p>';
    if (!p.custom) html += '<p class="detail"><a id="reportIssue" href="' + esc(issueUrl(p)) + '" rel="noopener noreferrer" target="_blank">' + T.issue.link + '</a></p>';
    box.innerHTML = html;
    box.hidden = false;

    $('prompt').hidden = true;
    $('verdict').textContent = verdictText(r, p);
    $('verdict').hidden = false;
    $('legend').innerHTML = legendHtml(p);
    $('legend').hidden = false;
  }

  /* Draw (or stop drawing) a move picked from the list of all legal moves. */
  function togglePreview(uci) {
    S.preview = S.preview === uci ? null : uci;
    S.previewLabel = S.preview && S.tiers ? T.tiers[S.tiers.all[S.preview].tier].sym : '';
    $('result').querySelectorAll('.ml-row').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-uci') === S.preview ? 'true' : 'false'); });
    renderArrows();
  }

  function dayKey(ms) { var d = new Date(ms); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }

  /* "Streak 3 · Today 4/10" above the controls. */
  function renderProgress() {
    $('progress').textContent = T.progress.line(window.GTM_STATS.streaks(S.history).current, window.GTM_STATS.todayCount(S.history, nowMs()), S.goal);
  }

  function renderStats() {
    renderProgress();
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
    if (!p) { el.textContent = ''; $('posInfo').textContent = ''; $('openingLine').hidden = true; return; }
    $('posInfo').textContent = T.posInfo(p);
    $('openingLine').hidden = !(p.game && p.game.opening);
    if (!$('openingLine').hidden) $('openingLine').textContent = T.openingLine(p.game.opening, p.game.eco);
    el.textContent = S.mode === 'predict' ? T.prompt.predict : T.prompt.best(p.stm);
  }

  /* ---------- flow ---------- */

  /* Which side is at the bottom: the side to move (automatic), or always White or Black. */
  function wantFlipped(stm) { return S.orientation === 'auto' ? stm === 'b' : S.orientation === 'black'; }

  function applyCoords() { $('boardSvg').classList.toggle('no-coords', !S.coords); }

  /* The opening family of a position's game ("Sicilian Defense: Najdorf" -> "Sicilian Defense"), or null. */
  function family(p) { var o = p.game && p.game.opening; return o ? String(o).split(':')[0].trim() : null; }

  function passesFilters(p) {
    var phase = $('phase').value, tag = $('tag').value, opening = $('opening').value;
    return (phase === 'any' || p.phase === phase) && (tag === 'any' || (p.tags || []).indexOf(tag) >= 0) && (opening === 'any' || family(p) === opening);
  }

  /* The queued position to retry: the one due first, or any queued one with `any`. It respects the phase and kind
   * filters (not "unseen only": a retry is a position you have seen). */
  function pickRetry(any) {
    var by = positionById(), ids = any ? SRS.queue(S.srs) : SRS.due(S.srs, S.plays), i;
    for (i = 0; i < ids.length; i++) if (by[ids[i]] && passesFilters(by[ids[i]])) return by[ids[i]];
    return null;
  }

  /* The queue without positions the loaded dataset does not have (they could never be shown). */
  function srsPresent() {
    if (!S.data) return S.srs;
    var by = positionById(), out = {};
    Object.keys(S.srs).forEach(function (id) { if (by[id]) out[id] = S.srs[id]; });
    return out;
  }

  function retryNow() {
    var p = S.data && pickRetry(true);
    if (!p) return;
    document.querySelector('input[name=mode][value=best]').checked = true; S.mode = 'best';
    closeStatsView();
    S.sinceRetry = 0;
    loadPosition(p, undefined, undefined, true);
  }

  function applyFilters() {
    var unseen = $('unseen').checked;
    var list = S.data.positions.filter(function (p) { return passesFilters(p) && (!unseen || !S.seen.has(p.id)); });
    $('matchCount').textContent = T.matchCount(list.length);
    return list;
  }

  /* `review` (a trail entry) reopens a position already answered in this visit: the answer is shown, the timer stays
   * stopped at the time taken and nothing is written to the history. Without it the position is a fresh attempt. */
  function loadPosition(p, review, bits, retrying) {
    S.cur = review ? S.trail.indexOf(review) : null;
    S.retrying = !!retrying;
    S.picked = bits === undefined ? null : bits;
    S.pos = p; S.parsed = B.parseFen(p.fen); S.flipped = wantFlipped(S.parsed.stm);
    S.legalFrom = {};
    Object.keys(p.evals).forEach(function (u) { (S.legalFrom[u.slice(0, 2)] = S.legalFrom[u.slice(0, 2)] || []).push(u); });
    S.selected = null; S.promo = null; S.pending = null; S.revealed = false; S.result = null; S.cursor = null; S.preview = null; S.tiers = null;
    $('result').hidden = true;
    svgReset();
    renderSquares(); renderPieces();
    setPrompt(); refresh();
    $('boardSvg').setAttribute('aria-label', T.boardLabel + ' ' + (p.stm === 'w' ? 'White' : 'Black') + ' to move.');
    if (review) {
      S.revealed = true; S.result = G.analyse(p, review.uci, review.mode);
      timer.acc = review.dur * 1000; timer.since = null; renderTimer(); // the time taken then, stopped
      refresh(); renderResult();
      announce(T.review.announce(S.result.you.san, verdictText(S.result, p)));
    } else {
      timerStart(); timerPause(); timerResume(); // a fresh count; stays paused while a view covers the board
    }
  }

  /* Previous: one step back through the positions answered in this visit. From a live position that is the latest one
   * (the unanswered live position is dropped: it never counted); from a review it is the one before. */
  function skipPosition() {
    if (S.pos) S.seen.add(S.pos.id);
    store.set(SEEN_KEY, Array.from(S.seen));
    goNext();
  }

  function goBack() {
    var i = trailIndex() - 1;
    if (i < 0) return;
    sfx('next');
    loadPosition(S.trail[i].pos, S.trail[i]);
  }

  /* Next: while reviewing, the next reviewed position; after the last one (or live) a new position. */
  function goNext() {
    if (S.session && S.session.done && S.revealed && S.cur === null) { openReport(false); return; }
    sfx('next');
    if (S.cur !== null && S.cur + 1 < S.trail.length) { loadPosition(S.trail[S.cur + 1].pos, S.trail[S.cur + 1]); return; }
    nextPosition();
  }

  function tryAgain() {
    if (S.cur === null) return;
    sfx('next');
    loadPosition(S.trail[S.cur].pos);
  }

  function nextPosition() {
    var list = applyFilters();
    var retry = S.srsOn && S.mode === 'best' && S.sinceRetry >= RETRY_GAP ? pickRetry(false) : null;
    if (retry) { S.sinceRetry = 0; loadPosition(retry, undefined, undefined, true); return; }
    S.sinceRetry++;
    if (!list.length) {
      S.cur = null; S.pos = null; svgReset(); setPrompt(); refresh(); $('result').hidden = true; timerReset();
      $('prompt').textContent = $('unseen').checked ? T.prompt.noneUnseen : T.prompt.none;
      return;
    }
    var pick = S.adaptive && S.mode === 'best' && S.hasAnchors ? sharpest(list) : null;
    if (pick) loadPosition(pick.pos, undefined, pick.bits);
    else loadPosition(list[Math.floor(Math.random() * list.length)]);
  }

  function clearSelection() { S.selected = null; S.promo = null; S.pending = null; refresh(); }

  function commit(uci) {
    timerStop();
    S.revealed = true; S.selected = null; S.promo = null; S.pending = null;
    S.result = G.analyse(S.pos, uci, S.pos.custom ? 'best' : S.mode); // an arbitrary position has no real move to predict
    var tier = CL.classifyAll(S.pos)[uci].tier, goalMsg = '';
    if (!S.pos.custom) {  // the session stats are about the dataset, not about positions pasted in
      S.seen.add(S.pos.id);
      store.set(SEEN_KEY, Array.from(S.seen));
      S.history.push({
        id: S.pos.id, mode: S.mode, phase: S.pos.phase, tags: S.pos.tags || [], cost: S.result.you.cost, tier: tier,
        score: S.result.score, mb: S.result.matched.best, mr: S.result.matched.real, mm: S.result.matched.maia, t: Date.now(),
        dur: Math.round(elapsedMs() / 1000),
        fen: S.pos.fen, uci: uci, opp: S.pos.opp_elo || null // what the level estimate needs
      });
      if (S.history.length > HISTORY_MAX) S.history = S.history.slice(-HISTORY_MAX);
      store.set(HISTORY_KEY, S.history);
      if (S.goal && window.GTM_STATS.todayCount(S.history, nowMs()) === S.goal && store.get(GOALDAY_KEY, '') !== dayKey(nowMs())) {
        store.set(GOALDAY_KEY, dayKey(nowMs())); sfx('good', 0.5); goalMsg = ' ' + T.progress.reached(S.goal);
      }
      S.plays++; store.set(PLAYS_KEY, S.plays);
      if (S.mode === 'best') { S.srs = SRS.update(S.srs, S.plays, S.pos.id, S.result.you.cost); store.set(SRS_KEY, S.srs); }
      var entry = { pos: S.pos, uci: uci, mode: S.mode, dur: Math.round(elapsedMs() / 1000) };
      S.trail.push(entry);
      if (S.trail.length > TRAIL_MAX) S.trail.shift();
      if (S.session && !S.session.done && S.mode === 'best') {
        S.session.rows.push({ id: S.pos.id, san: S.result.you.san, uci: uci, tier: tier, cost: S.result.you.cost, score: S.result.score, dur: entry.dur, entry: entry });
        if (S.session.rows.length >= S.session.n) S.session.done = true;
      }
    }
    sfx(isCapture(uci) ? 'capture' : 'move'); sfx(S.result.mode === 'best' && (tier === 'brilliant' || tier === 'great') ? 'brilliant' : outcomeSound(S.result), 0.16); // the fanfare is for finding it, not for predicting
    refresh(); renderResult(); renderStats(); applyFilters(); updateEstimate();
    announce(T.live.played(uci.slice(0, 2), uci.slice(2, 4), verdictText(S.result, S.pos)) + goalMsg);
  }

  /* A move was chosen (clicked, dragged or typed): reveal it, or hold it as pending when confirmation is on. */
  function propose(uci) {
    if (!S.confirm) return commit(uci);
    S.pending = uci; S.promo = null;
    sfx('tick');
    refresh();
    announce(T.live.pending(uci.slice(0, 2), uci.slice(2, 4)));
  }

  function tryMove(from, to) {
    var ucis = (S.legalFrom[from] || []).filter(function (u) { return u.slice(2, 4) === to; });
    if (!ucis.length) return false;
    S.selected = from;
    if (ucis.length > 1) { S.promo = ucis; S.pending = null; sfx('tick'); refresh(); announce(T.live.promo); return true; }
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
    sfx(S.selected ? 'select' : (own ? 'deselect' : 'error'));
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
      sfx('select');
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
      else if (!(sq && tryMove(res.from, sq))) { clearSelection(); sfx('deselect'); announce(T.live.dragCancelled); }
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
    if (e.key === 'Escape' && menuIsOpen()) { closeMenu(); return; }
    if (menuIsOpen()) return; // the menu is modal: board shortcuts stay off while it is open
    if (reportOpen()) { if (e.key === 'Escape') closeReport(true); return; }
    if (statsIsOpen()) { if (e.key === 'Escape') closeStatsView(); return; }
    if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if ((e.key === 'n' || e.key === 'N') && S.revealed) goNext();
    if ((e.key === 'p' || e.key === 'P') && !$('back').hidden) goBack();
    if ((e.key === 's' || e.key === 'S') && !$('skip').hidden) skipPosition();
    if (e.key === '?') { openMenu(); if ($('menuKeys').scrollIntoView) $('menuKeys').scrollIntoView(); }
    if (e.key === 'Escape') {
      if (gest.active()) cancelGesture();
      else if (!S.revealed && (S.selected || S.promo || S.pending)) { clearSelection(); sfx('deselect'); announce(T.live.cancelled); }
    }
  }

  /* ---------- optional api (feature-detected: without it nothing here appears and nothing changes) ---------- */

  function postJson(path, body) {
    return window.fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) throw new Error(j && j.error ? j.error.message : 'HTTP ' + r.status);
          return j;
        });
      });
  }

  function detectApi() {
    return window.fetch('api/healthz').then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j || j.status !== 'ok') return;
      S.api = { maia: !!j.maia };
      $('apiPanel').hidden = false;
      updateEstimate();
    }).catch(function () { /* no api: nothing changes */ });
  }

  function toPosition(j) {
    return {
      id: 'custom', custom: true, fen: j.fen, ply: 0, move_no: Number(j.fen.split(' ')[5]) || 1, stm: j.stm, phase: j.phase,
      player_elo: null, opp_elo: null, real: null, evals: j.evals, san: j.san, maia: j.maia, tags: [], site: null
    };
  }

  function analyseCustom() {
    var fen = $('fenInput').value.trim(), elo = $('eloInput').value.trim(), msg = $('apiMsg');
    if (!fen) { msg.textContent = T.api.needFen; return; }
    var body = { fen: fen };
    if (elo && S.api && S.api.maia) body.elo = Number(elo);
    msg.textContent = T.api.working; $('analyseBtn').disabled = true;
    postJson('api/v1/analyse', body).then(function (j) { loadPosition(toPosition(j)); msg.textContent = ''; })
      .catch(function (e) { msg.textContent = T.api.failed(e.message); })
      .then(function () { $('analyseBtn').disabled = false; });
  }

  function estimable() { return S.history.filter(function (h) { return h.fen && h.uci && h.mode === 'best'; }); }

  function updateEstimate() {
    var n = estimable().length, btn = $('estimateBtn');
    btn.hidden = !(S.api && S.api.maia);
    btn.disabled = n < 5;
    if (!btn.hidden && n < 5) $('estimate').textContent = T.api.estimateNeeds(5 - n);
  }

  function estimateLevel() {
    var items = estimable().slice(-30).map(function (h) { return { fen: h.fen, move: h.uci, opp_elo: h.opp || 1500 }; });
    $('estimate').textContent = T.api.estimating;
    postJson('api/v1/posterior', { history: items }).then(function (j) {
      $('estimate').textContent = T.api.estimated(j.mean, j.interval80[0], j.interval80[1], j.moves);
    }).catch(function (e) { $('estimate').textContent = T.api.failed(e.message); });
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
      S.data = d; S.byId = null;
      S.hasAnchors = d.positions.some(function (p) { return window.GTM_LEVEL.anchorsOf(p); });
      var counts = {};
      d.positions.forEach(function (p) { (p.tags || []).forEach(function (t) { counts[t] = (counts[t] || 0) + 1; }); });
      $('tag').innerHTML = '<option value="any">' + T.anyOption + '</option>' + Object.keys(T.tags).filter(function (t) { return counts[t]; })
        .map(function (t) { return '<option value="' + t + '">' + esc(T.tags[t]) + ' (' + counts[t] + ')</option>'; }).join('');
      var fams = {};
      d.positions.forEach(function (p) { var f = family(p); if (f) fams[f] = (fams[f] || 0) + 1; });
      var top = Object.keys(fams).filter(function (f) { return fams[f] >= 5; }).sort(function (a, b) { return fams[b] - fams[a] || (a < b ? -1 : 1); }).slice(0, 30);
      $('opening').innerHTML = '<option value="any">' + T.anyOption + '</option>' + top.map(function (f) { return '<option value="' + esc(f) + '">' + esc(f) + ' (' + fams[f] + ')</option>'; }).join('');
      $('openingLabel').hidden = !top.length;
      if (d.meta && d.meta.demo) { $('banner').hidden = false; $('banner').textContent = T.demoBanner; $('demoChip').hidden = false; }
      $('skeleton').hidden = true;
      if (menuIsOpen()) renderAbout();
      if (statsIsOpen()) drawStats(); // opened at #stats before the data arrived: the level card needs it
      renderStats();
      if (!consumeRoute()) nextPosition();
    }).catch(function (e) {
      $('skeleton').hidden = true;
      showLoadError(url, e);
    });
  }

  /* ---------- menu: how it works, the data, credits ---------- */

  function menuIsOpen() { return !$('menu').hidden; }

  function renderAbout() {
    var el = $('aboutData'), d = S.data;
    if (!d) { el.innerHTML = '<li>' + T.about.loading + '</li>'; return; }
    var m = d.meta || {}, prov = m.provenance || {}, eng = prov.engine || {}, maia = prov.maia, items = [];
    var dates = d.positions.map(function (p) { return p.game && p.game.date; }).filter(Boolean).sort();
    items.push(T.about.positions(d.positions.length, dates.length ? T.about.dates(dates[0], dates[dates.length - 1]) : ''));
    items.push(T.about.engine(eng.name || m.engine || 'The engine', eng.nodes || m.nodes));
    items.push(maia ? T.about.maia(maia.model, maia.history_plies) : (m.maia ? T.about.maia(m.maia) : T.about.noMaia));
    if (m.source) items.push(T.about.source(m.source));
    if (m.built) items.push(T.about.built(m.built));
    if (prov.players_stored === true) items.push(T.about.namesStored);
    else if (prov.players_stored === false) items.push(T.about.names);
    el.innerHTML = items.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('');
  }

  function openMenu() {
    S.menuReturn = document.activeElement;
    renderAbout();
    $('menu').hidden = false; $('menuBackdrop').hidden = false;
    $('menuBtn').setAttribute('aria-expanded', 'true');
    document.documentElement.classList.add('menu-open');
    timerPause(); sfx('tick');
    $('menuClose').focus();
  }

  function closeMenu() {
    $('menu').hidden = true; $('menuBackdrop').hidden = true;
    $('menuBtn').setAttribute('aria-expanded', 'false');
    document.documentElement.classList.remove('menu-open');
    timerResume(); sfx('tick');
    $('menuBtn').focus();
  }

  /* Keep Tab inside the open menu (it is modal). */
  function trapTab(e) {
    if (e.key !== 'Tab') return;
    var f = Array.prototype.filter.call($('menu').querySelectorAll('a[href], button:not([disabled])'), function (el) { return !el.hidden; });
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  /* ---------- level estimate (web/level.js): from first-time best-move guesses, using the anchors stored in the data ---------- */

  function positionById() {
    if (!S.byId && S.data) { S.byId = {}; S.data.positions.forEach(function (p) { S.byId[p.id] = p; }); }
    return S.byId || {};
  }

  /* One observation per position, the first time it was seen, and only when that was a best-move guess: a second look
   * (a retry, or a position first met in predict mode) comes after the answer was shown and says nothing about level. */
  function levelObservations() {
    var byId = positionById(), seen = {}, obs = [];
    S.history.forEach(function (e) {
      if (seen[e.id]) return;
      seen[e.id] = true;
      var p = byId[e.id];
      if (e.mode === 'best' && e.uci && p && window.GTM_LEVEL.anchorsOf(p)) obs.push({ pos: p, uci: e.uci });
    });
    return obs.slice(-LEVEL_WINDOW);
  }

  function levelModel() {
    if (!S.data) return null;
    if (!S.hasAnchors) return { unavailable: true };
    var obs = levelObservations(), lv = window.GTM_LEVEL;
    if (obs.length < LEVEL_MIN) return { need: LEVEL_MIN - obs.length, n: obs.length };
    var post = lv.posterior(obs), sm = lv.summary(post), series = [];
    for (var k = LEVEL_MIN; k <= obs.length; k++) { var s = lv.summary(lv.posterior(obs.slice(0, k))); series.push({ n: k, mean: s.mean, lo: s.lo, hi: s.hi }); }
    return { n: obs.length, mean: sm.mean, lo: sm.lo, hi: sm.hi, sd: sm.sd, grid: post.grid, density: post.p, series: series };
  }

  /* The position expected to tell most about the level now, from `list`; null when there is none. */
  function sharpest(list) {
    return window.GTM_LEVEL.suggest(list, window.GTM_LEVEL.posterior(levelObservations()), Math.random, 5);
  }

  function suggestAndGo() {
    if (!S.data) return;
    var list = applyFilters(), s = sharpest(list.length ? list : S.data.positions);
    if (!s) return;
    document.querySelector('input[name=mode][value=best]').checked = true; S.mode = 'best';
    closeStatsView();
    loadPosition(s.pos, undefined, s.bits);
  }

  /* ---------- training session and its report ---------- */

  function startSession() {
    S.session = { n: SESSION_LEN, rows: [], done: false };
    document.querySelector('input[name=mode][value=best]').checked = true; S.mode = 'best';
    sfx('next');
    if (S.data) nextPosition(); else updateActions();
  }

  function reportOpen() { return !$('reportView').hidden; }

  function openReport(partial) {
    var rows = S.session.rows;
    var sum = RP.summarize(rows);
    store.set(LAST_KEY, { t: nowMs(), n: sum.n, quality: Math.round(sum.quality), found: sum.found });
    $('reportBody').innerHTML = RP.html(rows, T, partial);
    $('reportMsg').textContent = '';
    timerPause();
    $('gameMain').hidden = true; document.querySelector('footer').hidden = true; $('reportView').hidden = false;
    sfx('good');
    $('reportTitle').focus();
  }

  /* Leave the report. The session ends; `next` goes on to a new position, otherwise the caller picks what to show. */
  function closeReport(next) {
    $('reportView').hidden = true; $('gameMain').hidden = false; document.querySelector('footer').hidden = false;
    S.session = null;
    timerResume();
    if (next) nextPosition(); else updateActions();
  }

  function endSession() {
    if (!S.session) return;
    if (S.session.rows.length) openReport(!S.session.done);
    else { S.session = null; updateActions(); }
  }

  function copyText(text, msgEl, done) {
    var manual = function () { msgEl.textContent = T.link.manual(text); };
    if (window.navigator.clipboard && window.navigator.clipboard.writeText) window.navigator.clipboard.writeText(text).then(function () { sfx('tick'); msgEl.textContent = done; }, manual);
    else manual();
  }

  function reviewFromReport(index) {
    var row = S.session && S.session.rows[index];
    if (!row || S.trail.indexOf(row.entry) < 0) return;
    closeReport(false);
    loadPosition(row.entry.pos, row.entry);
  }

  /* ---------- links: #stats, #p=<position id>, #p=<id>&m=<move> (a shared answer) ---------- */

  function parseHash() {
    var h = window.location.hash.replace(/^#/, '');
    if (h === 'stats') return { view: 'stats' };
    var m = /^p=([0-9a-f]{10})(?:&m=([a-h][1-8][a-h][1-8][qrbn]?))?$/.exec(h);
    return m ? { view: 'position', id: m[1], move: m[2] || null } : null;
  }

  function cleanHash() { window.history.replaceState(null, '', window.location.pathname + window.location.search); }

  /* A pre-filled issue for this position (the issue form's field ids are `position` and `dataset`). Nothing is sent from the
   * page: it is a link, and what it carries is the position id and the dataset's build date. */
  function issueUrl(p) {
    var repo = $('sourceLink').href.replace(/\/$/, ''), built = S.data && S.data.meta && S.data.meta.built ? String(S.data.meta.built).slice(0, 10) : '';
    return repo + '/issues/new?template=position.yml&title=' + encodeURIComponent('Position ' + p.id) + '&position=' + encodeURIComponent(p.id) + '&dataset=' + encodeURIComponent(built);
  }

  function linkTo(uci) {
    return window.location.origin + window.location.pathname + '#p=' + S.pos.id + (uci ? '&m=' + uci : '');
  }

  /* Open the position a link points at (needs the data). A shared answer opens as a review of that move, never written
   * to the history. The address is cleaned afterwards so a reload does not repeat it. Returns false when there is no such route. */
  function consumeRoute() {
    var r = S.route || parseHash();
    S.route = null;
    if (!r || r.view !== 'position') return false;
    cleanHash(); S.statsPushed = false;
    if (statsIsOpen()) showStats(false);
    var p = positionById()[r.id];
    if (!p) { nextPosition(); $('prompt').hidden = false; $('prompt').textContent = T.link.missing + ' ' + $('prompt').textContent; return true; }
    if (r.move && p.evals[r.move]) {
      var entry = { pos: p, uci: r.move, mode: 'best', dur: 0, shared: true };
      S.trail.push(entry);
      if (S.trail.length > TRAIL_MAX) S.trail.shift();
      loadPosition(p, entry);
    } else loadPosition(p);
    return true;
  }

  function copyLink(uci) {
    if (!S.pos || S.pos.custom) return;
    var url = linkTo(uci), say = function (t) { $('linkMsg').textContent = t; };
    var done = function () { sfx('tick'); say(uci ? T.link.copiedAnswer : T.link.copied); };
    if (window.navigator.clipboard && window.navigator.clipboard.writeText) window.navigator.clipboard.writeText(url).then(done, function () { say(T.link.manual(url)); });
    else say(T.link.manual(url)); // no clipboard (an insecure page): show it to copy by hand
  }

  /* ---------- the full stats view (a page of its own, reachable at #stats) ---------- */

  function statsIsOpen() { return !$('statsView').hidden; }

  /* Charts are drawn at the width of the page, so they are redrawn when the window is resized (or the phone turned). */
  /* History entries from before tiers existed get theirs from the dataset (not saved back). */
  function tieredHistory() {
    var by = positionById();
    return S.history.map(function (e) {
      var p = by[e.id];
      if (e.tier || !e.uci || !p || !p.evals || !(e.uci in p.evals)) return e;
      return Object.assign({}, e, { tier: CL.classifyAll(p)[e.uci].tier });
    });
  }

  function drawStats() { $('statsBody').innerHTML = window.GTM_STATS.html(tieredHistory(), T, { width: $('statsBody').clientWidth || undefined, now: nowMs(), goal: S.goal, level: levelModel(), srs: SRS.summary(srsPresent(), S.plays), last: store.get(LAST_KEY, null) }); }

  function showStats(on) {
    if (on === statsIsOpen()) return;
    $('statsView').hidden = !on;
    $('gameMain').hidden = on;
    document.querySelector('footer').hidden = on;
    if (on) { drawStats(); timerPause(); $('statsTitle').focus(); }
    else { timerResume(); $('statsBtn').focus(); }
  }

  function openStatsView() {
    sfx('tick');
    if (window.location.hash !== '#stats') { S.statsPushed = true; window.location.hash = 'stats'; }
    showStats(true);
  }

  function closeStatsView() {
    sfx('tick');
    if (S.statsPushed) { S.statsPushed = false; window.history.back(); } // the hashchange below hides the view
    else { window.history.replaceState(null, '', window.location.pathname + window.location.search); showStats(false); }
  }

  /* ---------- stats backup: download and load ---------- */

  function backupMsg(t) { $('backupMsg').textContent = t; }

  /* Hand a file to the browser's download. */
  function saveBlob(blob, name) {
    var url = window.URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    window.setTimeout(function () { window.URL.revokeObjectURL(url); }, 0);
  }

  /* ---------- saving the answer: an image of the board with the facts, and the FEN ---------- */

  var sprite = null;
  function spriteText() {
    if (!sprite) sprite = window.fetch('pieces.svg').then(function (r) { return r.text ? r.text() : ''; }).catch(function () { return ''; });
    return sprite;
  }

  function cardModel(symbols) {
    var r = S.result, p = S.pos, sum = S.tiers, C = T.share.card, round = function (n) { return Math.round(n); };
    var head = r.mode === 'predict' ? (r.matched.real ? C.exact : C.closeness(round(r.score))) : C.quality(round(r.score)) + ' · ' + C.gave(fmt(r.you.cost));
    var rows = [{ key: 'you', label: T.roles.you, san: r.you.san, cost: fmt(r.you.cost) }].concat(r.refs.map(function (x) {
      return { key: x.key, san: x.san, cost: fmt(x.cost), label: x.key === 'maia' ? T.result.maiaAt(p.maia.elo) : (x.key === 'real' && p.player_elo ? T.result.realAt(p.player_elo) : T.roles[x.key]) };
    }));
    return {
      fen: p.fen, flipped: S.flipped, board: S.parsed.board, symbols: symbols, posLine: T.posInfo(p), ratingLine: '',
      opening: p.game && p.game.opening ? T.openingLine(p.game.opening, p.game.eco) : '', yourSan: r.you.san, tier: sum.yours.tier,
      headline: head, better: T.tiers.better(sum.betterThan), sum: sum, yours: r.you.uci, rows: rows,
      arrows: arrowGroups(false).map(function (g) { return arrowMarkup(g.uci, g.keys); }).join(''), date: new Date(nowMs()).toISOString().slice(0, 10)
    };
  }

  function saveImage() {
    if (!S.pos || !S.revealed || !S.result) return;
    var say = function (t) { $('linkMsg').textContent = t; };
    say(T.share.working);
    spriteText().then(function (text) {
      var card = SH.card(cardModel(SH.symbolsOf(text)), T);
      return SH.rasterize(window, card.svg, card.width, card.height, 2);
    }).then(function (png) {
      saveBlob(new window.Blob([SH.addPngText(png, { FEN: S.pos.fen, Software: 'Guess the Move' })], { type: 'image/png' }), SH.fileName('png', S.pos.id));
      sfx('tick'); say(T.share.imageSaved);
    }).catch(function (e) { say(T.share.failed(e && e.message ? e.message : String(e))); });
  }

  function saveFen() {
    if (!S.pos) return;
    saveBlob(new window.Blob([S.pos.fen + '\n'], { type: 'text/plain' }), SH.fileName('fen', S.pos.id));
    sfx('tick'); $('linkMsg').textContent = T.share.fenSaved;
  }

  function exportStats() {
    var now = nowMs(), body = window.GTM_BACKUP.build(S.history, S.seen, S.data && S.data.meta, now, { srs: S.srs, plays: S.plays });
    saveBlob(new window.Blob([JSON.stringify(body, null, 2) + '\n'], { type: 'application/json' }), window.GTM_BACKUP.fileName(now));
    sfx('tick'); backupMsg(T.backup.exported(S.history.length));
  }

  function importStats(file) {
    var reader = new window.FileReader();
    reader.onerror = function () { backupMsg(T.backup.errors.read); };
    reader.onload = function () {
      var r = window.GTM_BACKUP.parse(String(reader.result));
      if (!r.ok) { backupMsg(T.backup.errors[r.error]); return; }
      var m = window.GTM_BACKUP.merge(S.history, r.history, HISTORY_MAX);
      S.history = m.history;
      r.seen.forEach(function (id) { S.seen.add(id); });
      S.srs = SRS.merge(S.srs, SRS.sanitize(r.srs)); S.plays = Math.max(S.plays, r.plays);
      store.set(HISTORY_KEY, S.history); store.set(SEEN_KEY, Array.from(S.seen)); store.set(SRS_KEY, S.srs); store.set(PLAYS_KEY, S.plays);
      renderStats(); updateEstimate(); if (S.data) applyFilters();
      drawStats();
      sfx('good'); backupMsg(T.backup.imported(m.added, m.duplicates, r.skipped));
    };
    reader.readAsText(file);
  }

  function updateThemeButton() {
    var dark = window.GTM_THEME && window.GTM_THEME.current() === 'dark';
    $('themeToggle').setAttribute('aria-label', dark ? T.toggleThemeToLight : T.toggleThemeToDark);
  }

  /* The scripts this one needs. If one did not load (a 404 from a stale image or a bad deploy, a blocked request) say so
   * plainly instead of failing on the first move with a console error. GTM_SOUND is optional (the page works without it). */
  var REQUIRED = ['GTM_STRINGS', 'GTM', 'GTM_BOARD', 'GTM_CLASSIFY', 'GTM_TIERVIEW', 'GTM_SHARE', 'GTM_SRS', 'GTM_REPORT', 'GTM_STATS', 'GTM_BACKUP', 'GTM_LEVEL'];

  function missingScripts() { return REQUIRED.filter(function (k) { return !window[k]; }); }

  function init() {
    var missing = missingScripts();
    if (missing.length) {
      var el = $('prompt');
      el.hidden = false; $('skeleton').hidden = true;
      el.textContent = 'Part of the page did not load (' + missing.join(', ') + '). Reload the page; if it persists, the server is missing files (a stale image or deploy).';
      return;
    }
    svg = $('boardSvg');
    S.seen = new Set(store.get(SEEN_KEY, []));
    S.history = store.get(HISTORY_KEY, []);
    var goal = Number(store.get(GOAL_KEY, 10)); S.goal = [0, 5, 10, 20, 50].indexOf(goal) >= 0 ? goal : 10; $('goalSelect').value = String(S.goal);
    S.orientation = ['auto', 'white', 'black'].indexOf(store.get(ORIENT_KEY, 'auto')) >= 0 ? store.get(ORIENT_KEY, 'auto') : 'auto'; $('orientation').value = S.orientation;
    S.coords = store.get(COORDS_KEY, true) !== false; $('coordsToggle').checked = S.coords; $('boardSvg').classList.toggle('no-coords', !S.coords);
    S.srs = SRS.sanitize(store.get(SRS_KEY, {})); S.plays = Math.max(0, Math.floor(Number(store.get(PLAYS_KEY, 0)) || 0));
    S.srsOn = store.get(SRS_ON_KEY, true) !== false; $('srsToggle').checked = S.srsOn;
    S.adaptive = store.get(ADAPTIVE_KEY, true) !== false; // on unless the person turned it off
    $('adaptiveToggle').checked = S.adaptive;
    S.showTimer = store.get(TIMER_KEY, true) !== false;
    $('timerToggle').checked = S.showTimer; $('timer').hidden = !S.showTimer;
    snd = window.GTM_SOUND ? window.GTM_SOUND.create(window.AudioContext || window.webkitAudioContext, store.get(SOUND_KEY, true) !== false) : null;
    updateSoundButton();
    S.route = parseHash();
    if (S.route && S.route.view === 'stats') { S.route = null; showStats(true); }
    S.confirm = store.get(CONFIRM_KEY, null);
    if (S.confirm === null) S.confirm = media('(pointer: coarse)'); // a slip of the finger is likelier than a slip of the mouse
    $('confirmToggle').checked = S.confirm;
    if (media('(max-width: 480px)')) $('filters').open = false;
    if (!store.get(ONBOARD_KEY, false)) $('onboarding').hidden = false;
    updateThemeButton();
    $('skeleton').hidden = false;
    load();
    detectApi();

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
    ['phase', 'tag', 'opening', 'unseen'].forEach(function (id) { $(id).addEventListener('change', function () { if (S.data) nextPosition(); }); });
    $('next').addEventListener('click', goNext);
    $('back').addEventListener('click', goBack);
    $('tryAgain').addEventListener('click', tryAgain);
    $('confirm').addEventListener('click', function () { if (S.pending) commit(S.pending); });
    $('skip').addEventListener('click', skipPosition);
    $('resetStats').addEventListener('click', function () {
      S.history = []; S.seen = new Set(); S.srs = {}; S.plays = 0; store.set(HISTORY_KEY, []); store.set(SEEN_KEY, []); store.set(SRS_KEY, {}); store.set(PLAYS_KEY, 0); store.set(LAST_KEY, null); renderStats(); updateEstimate(); if (S.data) applyFilters();
    });
    $('confirmToggle').addEventListener('change', function () {
      S.confirm = $('confirmToggle').checked; store.set(CONFIRM_KEY, S.confirm);
      if (!S.confirm && S.pending) { S.pending = null; refresh(); }
    });
    $('themeToggle').addEventListener('click', function () { window.GTM_THEME.toggle(); updateThemeButton(); sfx('tick'); });
    $('soundToggle').addEventListener('click', function () {
      if (snd) { snd.setEnabled(!snd.isEnabled()); store.set(SOUND_KEY, snd.isEnabled()); }
      updateSoundButton(); sfx('tick');
    });
    $('goalSelect').addEventListener('change', function () { S.goal = Number($('goalSelect').value); store.set(GOAL_KEY, S.goal); renderProgress(); });
    $('orientation').addEventListener('change', function () {
      S.orientation = $('orientation').value; store.set(ORIENT_KEY, S.orientation);
      if (S.pos) { S.flipped = wantFlipped(S.parsed.stm); renderSquares(); renderPieces(); refresh(); }
    });
    $('coordsToggle').addEventListener('change', function () { S.coords = $('coordsToggle').checked; store.set(COORDS_KEY, S.coords); applyCoords(); });
    $('sessionBtn').addEventListener('click', startSession);
    $('sessionEnd').addEventListener('click', endSession);
    $('reportBack').addEventListener('click', function () { closeReport(true); });
    $('reportAgain').addEventListener('click', function () { closeReport(false); startSession(); });
    $('reportCopy').addEventListener('click', function () { if (S.session) copyText(RP.text(S.session.rows, T, window.location.origin + window.location.pathname), $('reportMsg'), T.session.copied); });
    $('reportBody').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.session-row') : null;
      if (b) reviewFromReport(Number(b.getAttribute('data-index')));
    });
    $('srsToggle').addEventListener('change', function () { S.srsOn = $('srsToggle').checked; store.set(SRS_ON_KEY, S.srsOn); });
    $('adaptiveToggle').addEventListener('change', function () { S.adaptive = $('adaptiveToggle').checked; store.set(ADAPTIVE_KEY, S.adaptive); });
    $('result').addEventListener('click', function (e) {
      if (e.target && e.target.id === 'copyAnswer') { copyLink(S.result.you.uci); return; }
      if (e.target && e.target.id === 'saveImage') { saveImage(); return; }
      if (e.target && e.target.id === 'saveFen') { saveFen(); return; }
      if (e.target && e.target.id === 'copyFen') { copyText(S.pos.fen, $('linkMsg'), T.share.fenCopied); return; }
      var b = e.target.closest ? e.target.closest('.ml-row') : null;
      if (b) togglePreview(b.getAttribute('data-uci'));
    });
    $('statsBody').addEventListener('click', function (e) { if (e.target && e.target.id === 'suggestBtn') suggestAndGo(); if (e.target && e.target.id === 'retryNowBtn') retryNow(); });
    $('timerToggle').addEventListener('change', function () { S.showTimer = $('timerToggle').checked; store.set(TIMER_KEY, S.showTimer); $('timer').hidden = !S.showTimer; });
    $('statsBtn').addEventListener('click', openStatsView);
    $('openStats').addEventListener('click', openStatsView);
    $('statsBack').addEventListener('click', closeStatsView);
    $('exportBtn').addEventListener('click', exportStats);
    $('importBtn').addEventListener('click', function () { $('importFile').click(); });
    $('importFile').addEventListener('change', function () {
      var f = $('importFile').files && $('importFile').files[0];
      if (f) importStats(f);
      $('importFile').value = ''; // the same file can be chosen again
    });
    window.addEventListener('resize', function () { if (statsIsOpen()) drawStats(); });
    window.addEventListener('hashchange', function () {
      var r = parseHash();
      if (r && r.view === 'position') { S.route = r; if (S.data) consumeRoute(); } else showStats(window.location.hash === '#stats');
    });
    $('linkBtn').addEventListener('click', function () { copyLink(null); });
    document.addEventListener('visibilitychange', function () { if (document.hidden) timerPause(); else timerResume(); });
    window.setInterval(function () { if (timer.since !== null) renderTimer(); }, 250);
    $('analyseBtn').addEventListener('click', analyseCustom);
    $('estimateBtn').addEventListener('click', estimateLevel);
    $('menuBtn').addEventListener('click', function () { if (menuIsOpen()) closeMenu(); else openMenu(); });
    $('menuClose').addEventListener('click', closeMenu);
    $('menuBackdrop').addEventListener('click', closeMenu);
    $('menu').addEventListener('keydown', trapTab);
    $('tourBtn').addEventListener('click', function () { closeMenu(); $('onboarding').hidden = false; });
    $('onboardingClose').addEventListener('click', function () { $('onboarding').hidden = true; store.set(ONBOARD_KEY, true); });
    document.addEventListener('keydown', onDocKey);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
}());
