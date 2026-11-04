// SPDX-License-Identifier: AGPL-3.0-or-later
/* The report for a training session: average move quality, how many best moves were found, time, the tiers of its
 * moves, and the weakest ones with a button to review each. Pure functions from the session's rows to numbers (`summarize`),
 * HTML (`html`) and a plain-text summary to copy (`text`). A row: {san, uci, tier, cost, score, dur}. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./classify.js'), require('./tierview.js'));
  else root.GTM_REPORT = factory(root.GTM_CLASSIFY, root.GTM_TIERVIEW);
}(typeof self !== 'undefined' ? self : this, function (C, TV) {
  'use strict';

  var FOUND = { brilliant: 1, great: 1, best: 1 };
  var WORST = 3;

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function clock(sec) { var s = Math.max(0, Math.round(sec)); return Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60); }

  function summarize(rows) {
    var n = rows.length, counts = {}, found = 0, time = 0, sum = 0;
    C.TIERS.forEach(function (t) { counts[t] = 0; });
    rows.forEach(function (r) { counts[r.tier]++; if (FOUND[r.tier]) found++; time += r.dur || 0; sum += r.score; });
    var worst = rows.map(function (r, i) { return { row: r, index: i }; })
      .filter(function (x) { return x.row.cost >= C.INACCURACY_DROP; })
      .sort(function (a, b) { return b.row.cost - a.row.cost || a.index - b.index; }).slice(0, WORST);
    return { n: n, quality: n ? sum / n : 0, found: found, time: time, avgTime: n ? time / n : 0, counts: counts, worst: worst };
  }

  /* `rows[i].index` is the position in the session; a review button carries it. */
  function html(rows, T, partial) {
    var s = summarize(rows), L = T.session, out = '';
    out += '<dl class="kpis"><div class="kpi"><dt>' + esc(L.quality) + '</dt><dd>' + Math.round(s.quality) + '</dd></div>' +
      '<div class="kpi"><dt>' + esc(L.found) + '</dt><dd>' + s.found + '/' + s.n + '</dd></div>' +
      '<div class="kpi"><dt>' + esc(L.time) + '</dt><dd>' + clock(s.time) + '</dd></div>' +
      '<div class="kpi"><dt>' + esc(L.avg) + '</dt><dd>' + clock(s.avgTime) + '</dd></div></dl>';
    if (partial) out += '<p class="muted">' + esc(L.partial(s.n)) + '</p>';
    out += '<ul class="tier-key">' + C.TIERS.filter(function (t) { return s.counts[t]; }).map(function (t) { return '<li>' + TV.badge(t, T) + ' <b>' + s.counts[t] + '</b></li>'; }).join('') + '</ul>';
    out += '<h3>' + esc(L.moves) + '</h3><ol class="session-moves">' + rows.map(function (r, i) {
      return '<li><button type="button" class="ml-row session-row" data-index="' + i + '"><span class="ml-rank">' + (i + 1) + '</span>' + TV.icon(r.tier, T) +
        '<span class="ml-san">' + esc(r.san) + '</span><span class="ml-tier">' + esc(T.tiers[r.tier].name) + '</span><span class="ml-cost">' + Number(r.cost).toFixed(1) + '</span><span class="ml-marks">' + clock(r.dur || 0) + '</span></button></li>';
    }).join('') + '</ol>';
    out += s.worst.length ? '<p class="muted small">' + esc(L.worst(s.worst.map(function (x) { return x.index + 1; }))) + '</p>' : '<p class="muted small">' + esc(L.noWorst) + '</p>';
    return out;
  }

  /* A few lines for a message or a note; nothing identifying, and a link to the app if given. */
  function text(rows, T, url) {
    var s = summarize(rows), L = T.session;
    var tiers = C.TIERS.filter(function (t) { return s.counts[t]; }).map(function (t) { return s.counts[t] + ' ' + T.tiers[t].name.toLowerCase(); }).join(', ');
    return L.summaryText(s.n, Math.round(s.quality), s.found, clock(s.avgTime), tiers) + (url ? '\n' + url : '');
  }

  return { FOUND: FOUND, summarize: summarize, html: html, text: text, clock: clock };
}));
