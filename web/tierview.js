// SPDX-License-Identifier: AGPL-3.0-or-later
/* HTML for the move tiers: a badge, the distribution bar, and the list of all legal moves. Pure functions from the
 * classification (GTM_CLASSIFY.summary) and the strings; no DOM. Colours come from classes (the CSP forbids style
 * attributes) and every tier has a distinct glyph and always a name, so colour is never the only cue.
 * Glyphs: the standard annotation symbols as text, and Lucide's star, thumbs-up and check (ISC, see NOTICE). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./classify.js'));
  else root.GTM_TIERVIEW = factory(root.GTM_CLASSIFY);
}(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  var W = 600;
  var ICON = {
    best: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
    excellent: '<path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/><path d="M7 10v12"/>',
    good: '<path d="M20 6 9 17l-5-5"/>'
  };

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(n) { return Number(n).toFixed(1); }

  function icon(tier, T) {
    var inner = ICON[tier] ? '<g class="tier-glyph" transform="translate(4.8 4.8) scale(.6)">' + ICON[tier] + '</g>'
      : '<text class="tier-sym" x="12" y="16.3" text-anchor="middle">' + esc(T.tiers[tier].sym) + '</text>';
    return '<svg class="tier-icon tier-' + tier + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle class="tier-disc" cx="12" cy="12" r="11"/>' + inner + '</svg>';
  }

  /* An icon and the tier's name. `compact` keeps the name for screen readers only (for table cells). */
  function badge(tier, T, compact) {
    var t = T.tiers[tier];
    return '<span class="tier tier-' + tier + (compact ? ' compact' : '') + '" title="' + esc(t.desc) + '">' + icon(tier, T) +
      '<span class="' + (compact ? 'sr-only' : 'tier-name') + '">' + esc(t.name) + '</span></span>';
  }

  /* The legal moves, best tier first, then by cost. */
  function ordered(all) {
    return Object.keys(all).sort(function (a, b) {
      return C.TIERS.indexOf(all[a].tier) - C.TIERS.indexOf(all[b].tier) || all[a].cost - all[b].cost || (a < b ? -1 : 1);
    });
  }

  /* One bar for the whole position: every legal move is a slot, grouped by tier from best to worst, with yours marked.
   * This is the relative scale: its widths say how many moves the position offers at each level. */
  function bar(sum, T, yours) {
    var moves = ordered(sum.all), n = moves.length, slot = W / n, segs = '', i, start = 0;
    while (start < n) {
      var tier = sum.all[moves[start]].tier, end = start;
      while (end < n && sum.all[moves[end]].tier === tier) end++;
      segs += '<rect class="tier-seg tier-' + tier + '" x="' + (start * slot).toFixed(1) + '" y="9" width="' + ((end - start) * slot).toFixed(1) + '" height="20"/>';
      start = end;
    }
    var at = moves.indexOf(yours), cx = (at + 0.5) * slot;
    var marker = '<rect class="tier-you" x="' + (at * slot).toFixed(1) + '" y="6" width="' + Math.max(slot, 3).toFixed(1) + '" height="26"/>' +
      '<polygon class="tier-pin" points="' + (cx - 6).toFixed(1) + ',0 ' + (cx + 6).toFixed(1) + ',0 ' + cx.toFixed(1) + ',7"/>';
    var parts = C.TIERS.filter(function (t) { return sum.counts[t]; }).map(function (t) { return sum.counts[t] + ' ' + T.tiers[t].name; });
    var key = C.TIERS.filter(function (t) { return sum.counts[t]; }).map(function (t) {
      return '<li>' + badge(t, T) + ' <b>' + sum.counts[t] + '</b></li>';
    }).join('');
    return '<figure class="tier-card"><svg class="tier-bar" viewBox="0 0 ' + W + ' 34" preserveAspectRatio="none" role="img" aria-label="' + esc(T.tiers.barAlt(n, parts, T.tiers[sum.yours.tier].name, sum.betterThan)) + '">' +
      segs + marker + '</svg><figcaption><ul class="tier-key">' + key + '</ul></figcaption></figure>';
  }

  /* Every legal move as a button (it draws the move on the board), with its tier, cost and who played or chose it. */
  function list(pos, sum, marks, T) {
    var moves = ordered(sum.all);
    var items = moves.map(function (m) {
      var r = sum.all[m], mk = (marks[m] || []).map(function (k) {
        return '<b class="mark mark-' + k + '" title="' + esc(T.roles[k]) + '"><span aria-hidden="true">' + esc(T.letters[k]) + '</span><span class="sr-only">' + esc(T.roles[k]) + '</span></b>';
      }).join('');
      return '<li><button type="button" class="ml-row" data-uci="' + esc(m) + '" aria-pressed="false"><span class="ml-rank">' + r.rank + '</span>' + icon(r.tier, T) +
        '<span class="ml-san">' + esc(pos.san[m] || m) + '</span><span class="ml-tier">' + esc(T.tiers[r.tier].name) + '</span><span class="ml-cost">' + fmt(r.cost) + '</span><span class="ml-marks">' + mk + '</span></button></li>';
    }).join('');
    return '<details class="all-moves"><summary>' + esc(T.tiers.listTitle(moves.length)) + '</summary><p class="muted small">' + esc(T.tiers.listHint) + '</p><ol class="move-list">' + items + '</ol></details>';
  }

  return { badge: badge, icon: icon, bar: bar, list: list, ordered: ordered };
}));
