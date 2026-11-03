/* The stats view: pure functions from the guess history to numbers (`summarize`) and to HTML with inline SVG charts
 * (`html`). No DOM, no dependencies, so they are unit-tested in node. Charts are drawn with classes only (no style
 * attributes: the CSP forbids them); colours and type sizes live in style.css. Every chart is a labelled figure with
 * a sentence that says what it shows, so the numbers are readable without seeing the picture.
 * A history entry: {mode, phase, cost, score, mb, mr, mm, t (when), dur (seconds spent, absent in older entries)}. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GTM_STATS = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var W_MAX = 640, W_MIN = 300, SERIES_MAX = 100, AVG_WINDOW = 10, MIN_POINTS = 3, MIN_TIMED = 3, MIN_SPLIT = 6;
  var PHASES = ['opening', 'middlegame', 'endgame'];
  var COST_EDGES = [0.5, 2, 5, 10, 20]; // upper bounds in win-% points; the last bucket is open

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function sum(a) { return a.reduce(function (x, y) { return x + y; }, 0); }
  function mean(a) { return a.length ? sum(a) / a.length : null; }
  function median(a) {
    if (!a.length) return null;
    var s = a.slice().sort(function (x, y) { return x - y; }), m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function round(n) { return Math.round(n); }
  function clock(sec) {
    var s = Math.max(0, Math.round(sec)), m = Math.floor(s / 60), r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }
  /* Share of true answers among entries where the key is known, in percent, or null. */
  function pctOf(list, key) {
    var known = list.filter(function (e) { return e[key] !== null && e[key] !== undefined; });
    return known.length ? 100 * known.filter(function (e) { return e[key]; }).length / known.length : null;
  }
  function movingAverage(values, w) {
    return values.map(function (_, i) { return mean(values.slice(Math.max(0, i - w + 1), i + 1)); });
  }

  function summarize(history) {
    var h = history || [];
    var best = h.filter(function (e) { return e.mode === 'best'; });
    var pred = h.filter(function (e) { return e.mode === 'predict'; });
    var scoresOf = function (list) { return list.map(function (e) { return e.score; }).filter(function (v) { return typeof v === 'number'; }); };
    var timed = h.filter(function (e) { return typeof e.dur === 'number'; });
    var timedBest = best.filter(function (e) { return typeof e.dur === 'number' && typeof e.score === 'number'; });
    var costs = best.map(function (e) { return e.cost; }).filter(function (v) { return typeof v === 'number'; });
    var buckets = COST_EDGES.map(function () { return 0; }).concat([0]);
    costs.forEach(function (c) {
      var i = 0;
      while (i < COST_EDGES.length && c >= COST_EDGES[i]) i++;
      buckets[i]++;
    });
    var phases = PHASES.map(function (p) {
      var sc = scoresOf(best.filter(function (e) { return e.phase === p; }));
      return { phase: p, n: sc.length, mean: mean(sc) };
    }).filter(function (p) { return p.n > 0; });
    var medT = median(timedBest.map(function (e) { return e.dur; }));
    var fast = timedBest.filter(function (e) { return e.dur <= medT; }), slow = timedBest.filter(function (e) { return e.dur > medT; });
    return {
      n: h.length, nBest: best.length, nPredict: pred.length,
      meanBest: mean(scoresOf(best)), meanPredict: mean(scoresOf(pred)),
      found: pctOf(h, 'mb'), real: pctOf(h, 'mr'), maia: pctOf(h, 'mm'),
      medianTime: median(timed.map(function (e) { return e.dur; })),
      bestScores: scoresOf(best).slice(-SERIES_MAX), predictScores: scoresOf(pred).slice(-SERIES_MAX),
      costBuckets: buckets, phases: phases, timedBest: timedBest,
      split: timedBest.length >= MIN_SPLIT && fast.length && slow.length ?
        { at: medT, fast: mean(fast.map(function (e) { return e.score; })), slow: mean(slow.map(function (e) { return e.score; })) } : null
    };
  }

  /* ---------- charts ---------- */

  /* Charts are drawn at the width they are shown at (`w`), so text keeps its size on a phone instead of shrinking with the picture. */
  function svg(w, h, label, body) {
    return '<svg class="chart" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + esc(label) + '">' + body + '</svg>';
  }

  /* y axis 0..100 with grid lines; returns the markup and the mapping functions. */
  function plane(w, h, xLabels) {
    var L = 40, R = 12, T = 12, B = 28, pw = w - L - R, ph = h - T - B, out = '', v;
    for (v = 0; v <= 100; v += 25) {
      var y = T + ph * (1 - v / 100);
      out += '<line class="ch-grid" x1="' + L + '" x2="' + (w - R) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '"/>' +
        '<text class="ch-tick" x="' + (L - 6) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end">' + v + '</text>';
    }
    (xLabels || []).forEach(function (l) {
      out += '<text class="ch-tick" x="' + (L + pw * l.at).toFixed(1) + '" y="' + (h - 8) + '" text-anchor="' + (l.at === 0 ? 'start' : l.at === 1 ? 'end' : 'middle') + '">' + esc(l.text) + '</text>';
    });
    return { grid: out, x: function (f) { return L + pw * f; }, y: function (s) { return T + ph * (1 - Math.max(0, Math.min(100, s)) / 100); } };
  }

  function lineChart(w, scores, label, cls) {
    var n = scores.length, p = plane(w, 240, [{ at: 0, text: '#1' }, { at: 1, text: '#' + n }]);
    var xs = function (i) { return p.x(n === 1 ? 0.5 : i / (n - 1)); };
    var avg = movingAverage(scores, AVG_WINDOW);
    var dots = scores.map(function (s, i) { return '<circle class="ch-dot ' + cls + '" cx="' + xs(i).toFixed(1) + '" cy="' + p.y(s).toFixed(1) + '" r="3"/>'; }).join('');
    var line = avg.map(function (s, i) { return xs(i).toFixed(1) + ',' + p.y(s).toFixed(1); }).join(' ');
    return svg(w, 240, label, p.grid + dots + '<polyline class="ch-line ' + cls + '" points="' + line + '"/>');
  }

  /* Horizontal bars: rows of {label, value, max, text, cls}. */
  function barChart(w, rows, label) {
    var narrow = w < 480, LBL = narrow ? 112 : 150, RIGHT = narrow ? 76 : 90, rowH = 34, body = '';
    rows.forEach(function (r, i) {
      var y = i * rowH, bw = r.max > 0 ? (w - LBL - RIGHT) * Math.max(0, Math.min(r.max, r.value)) / r.max : 0;
      body += '<text class="ch-label" x="0" y="' + (y + 21) + '">' + esc(r.label) + '</text>' +
        '<rect class="ch-track" x="' + LBL + '" y="' + (y + 6) + '" width="' + (w - LBL - RIGHT) + '" height="18" rx="4"/>' +
        '<rect class="ch-bar ' + r.cls + '" x="' + LBL + '" y="' + (y + 6) + '" width="' + bw.toFixed(1) + '" height="18" rx="4"/>' +
        '<text class="ch-value" x="' + w + '" y="' + (y + 21) + '" text-anchor="end">' + esc(r.text) + '</text>';
    });
    return svg(w, rows.length * rowH, label, body);
  }

  function scatter(w, pairs, label) {
    var cap = Math.max(30, Math.ceil((median(pairs.map(function (e) { return e.dur; })) * 3) / 15) * 15);
    var p = plane(w, 240, [{ at: 0, text: '0:00' }, { at: 0.5, text: clock(cap / 2) }, { at: 1, text: clock(cap) + '+' }]);
    var dots = pairs.map(function (e) {
      return '<circle class="ch-dot c-best" cx="' + p.x(Math.min(1, e.dur / cap)).toFixed(1) + '" cy="' + p.y(e.score).toFixed(1) + '" r="3.5"/>';
    }).join('');
    return svg(w, 240, label, p.grid + dots);
  }

  /* ---- the level card: a density of the estimate, and the estimate as you played ---- */

  var R_MIN = 1000, R_MAX = 2200;

  function ratingPlane(w, h, xLabels) {
    var L = 44, R = 12, T = 10, B = 26, pw = w - L - R, ph = h - T - B, out = '', r;
    for (r = R_MIN; r <= R_MAX; r += 400) {
      var y = T + ph * (1 - (r - R_MIN) / (R_MAX - R_MIN));
      out += '<line class="ch-grid" x1="' + L + '" x2="' + (w - R) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '"/>' +
        '<text class="ch-tick" x="' + (L - 6) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end">' + r + '</text>';
    }
    (xLabels || []).forEach(function (l) {
      out += '<text class="ch-tick" x="' + (L + pw * l.at).toFixed(1) + '" y="' + (h - 6) + '" text-anchor="' + (l.at === 0 ? 'start' : l.at === 1 ? 'end' : 'middle') + '">' + esc(l.text) + '</text>';
    });
    return { L: L, T: T, pw: pw, ph: ph, grid: out, y: function (v) { return T + ph * (1 - (Math.max(R_MIN, Math.min(R_MAX, v)) - R_MIN) / (R_MAX - R_MIN)); } };
  }

  /* The posterior over ratings as an area, with the 80% range shaded and the mean marked. Horizontal axis: rating. */
  function densityChart(w, lv, label) {
    var h = 170, L = 12, R = 12, T = 10, B = 26, pw = w - L - R, ph = h - T - B, g = lv.grid, p = lv.density;
    var top = Math.max.apply(null, p) || 1, x = function (r) { return L + pw * (r - R_MIN) / (R_MAX - R_MIN); };
    var pts = g.map(function (r, i) { return x(r).toFixed(1) + ',' + (T + ph * (1 - p[i] / top)).toFixed(1); });
    var area = x(g[0]).toFixed(1) + ',' + (T + ph) + ' ' + pts.join(' ') + ' ' + x(g[g.length - 1]).toFixed(1) + ',' + (T + ph);
    var ticks = '';
    for (var r = R_MIN; r <= R_MAX; r += 200) ticks += '<text class="ch-tick" x="' + x(r).toFixed(1) + '" y="' + (h - 6) + '" text-anchor="' + (r === R_MIN ? 'start' : r === R_MAX ? 'end' : 'middle') + '">' + r + '</text>';
    var band = '<rect class="ch-band" x="' + x(lv.lo).toFixed(1) + '" y="' + T + '" width="' + Math.max(2, x(lv.hi) - x(lv.lo)).toFixed(1) + '" height="' + ph + '"/>';
    return svg(w, h, label, band + '<polygon class="ch-area" points="' + area + '"/><line class="ch-mean" x1="' + x(lv.mean).toFixed(1) + '" x2="' + x(lv.mean).toFixed(1) + '" y1="' + T + '" y2="' + (T + ph) + '"/>' +
      '<line class="ch-grid" x1="' + L + '" x2="' + (w - R) + '" y1="' + (T + ph) + '" y2="' + (T + ph) + '"/>' + ticks);
  }

  /* The estimate and its 80% range after each counted guess. */
  function trendChart(w, series, label) {
    var h = 200, n = series.length, first = series[0].n, last = series[n - 1].n;
    var p = ratingPlane(w, h, [{ at: 0, text: '#' + first }, { at: 1, text: '#' + last }]);
    var x = function (i) { return p.L + p.pw * (n === 1 ? 0.5 : i / (n - 1)); };
    var up = series.map(function (s, i) { return x(i).toFixed(1) + ',' + p.y(s.hi).toFixed(1); });
    var down = series.map(function (s, i) { return x(i).toFixed(1) + ',' + p.y(s.lo).toFixed(1); }).reverse();
    var line = series.map(function (s, i) { return x(i).toFixed(1) + ',' + p.y(s.mean).toFixed(1); }).join(' ');
    return svg(w, h, label, p.grid + '<polygon class="ch-band" points="' + up.concat(down).join(' ') + '"/><polyline class="ch-line c-real" points="' + line + '"/>');
  }

  function levelCard(lv, T, w, raw) {
    var L = T.level, body = '', title = L.title;
    if (lv.unavailable) return need(title, L.unavailable);
    var suggest = '<button id="suggestBtn" type="button">' + esc(L.suggest) + '</button>';
    if (lv.need) return '<div class="chart-card level-card"><h3>' + esc(title) + '</h3><p class="muted">' + esc(L.need(lv.need)) + '</p>' + suggest + '</div>';
    body += '<p class="level-big">' + esc(L.headline(round(lv.mean))) + '</p><p class="level-range">' + esc(L.range(round(lv.lo), round(lv.hi), lv.n)) + '</p>';
    // side by side on a wide page, each drawn at the width it is shown at
    var cw = Math.max(W_MIN, Math.min(W_MAX, raw >= 900 ? Math.floor((raw - 56) / 2) : raw - 40));
    body += '<div class="level-charts"><div>' + densityChart(cw, lv, L.densityAlt(round(lv.mean), round(lv.lo), round(lv.hi))) + '</div>';
    if (lv.series.length >= 2) body += '<div><h4>' + esc(L.trendTitle) + '</h4>' + trendChart(cw, lv.series, L.trendAlt(lv.n)) + '</div>';
    body += '</div>';
    return '<div class="chart-card level-card"><h3>' + esc(title) + '</h3>' + body + '<p class="muted">' + esc(L.caption) + '</p>' +
      '<details class="reliability"><summary>' + esc(L.reliability) + '</summary><p>' + esc(L.reliabilityText) + '</p></details>' + suggest + '</div>';
  }

  function card(title, caption, chart) {
    return '<figure class="chart-card"><figcaption><h3>' + esc(title) + '</h3><p>' + esc(caption) + '</p></figcaption>' + chart + '</figure>';
  }
  function need(title, text) { return '<div class="chart-card"><h3>' + esc(title) + '</h3><p class="muted">' + esc(text) + '</p></div>'; }

  function trend(scores) {
    var k = Math.min(5, Math.floor(scores.length / 2));
    return { k: k, first: mean(scores.slice(0, k)), last: mean(scores.slice(-k)) };
  }

  function html(history, T, opts) {
    var S = summarize(history), V = T.statsView, out = '';
    var w = Math.max(W_MIN, Math.min(W_MAX, Math.round((opts && opts.width) || W_MAX)));
    if (!S.n) return '<p class="empty">' + esc(V.empty) + '</p>';
    var dash = function (v) { return v === null ? '—' : String(round(v)); };
    var pc = function (v) { return v === null ? '—' : round(v) + '%'; };
    var tiles = [[V.kpi.guesses, String(S.n)], [V.kpi.quality, dash(S.meanBest)], [V.kpi.closeness, dash(S.meanPredict)],
      [V.kpi.found, pc(S.found)], [V.kpi.real, pc(S.real)], [V.kpi.maia, pc(S.maia)],
      [V.kpi.time, S.medianTime === null ? '—' : clock(S.medianTime)]];
    out += '<dl class="kpis">' + tiles.map(function (t) { return '<div class="kpi"><dt>' + esc(t[0]) + '</dt><dd>' + esc(t[1]) + '</dd></div>'; }).join('') + '</dl>';

    out += '<div class="charts">';
    if (opts && opts.level) out += levelCard(opts.level, T, w, Math.round((opts && opts.width) || W_MAX));
    // quality over time
    if (S.bestScores.length >= MIN_POINTS) {
      var tr = trend(S.bestScores);
      out += card(V.quality.title, V.quality.caption(S.bestScores.length, tr.k, round(tr.first), round(tr.last)),
        lineChart(w, S.bestScores, V.quality.alt(S.bestScores.length), 'c-best'));
    } else out += need(V.quality.title, V.need(MIN_POINTS, V.modes.best));
    // closeness over time (only once that mode has been played)
    if (S.nPredict) {
      if (S.predictScores.length >= MIN_POINTS) {
        var tp = trend(S.predictScores);
        out += card(V.closeness.title, V.closeness.caption(S.predictScores.length, tp.k, round(tp.first), round(tp.last)),
          lineChart(w, S.predictScores, V.closeness.alt(S.predictScores.length), 'c-real'));
      } else out += need(V.closeness.title, V.need(MIN_POINTS, V.modes.predict));
    }
    // cost histogram
    if (S.nBest) {
      var maxB = Math.max.apply(null, S.costBuckets), total = sum(S.costBuckets);
      var rows = S.costBuckets.map(function (c, i) {
        return { label: V.cost.buckets[i], value: c, max: maxB, text: c + ' (' + round(100 * c / total) + '%)', cls: i === 0 ? 'c-best' : 'c-you' };
      });
      out += card(V.cost.title, V.cost.caption(round(100 * (S.costBuckets[0] + S.costBuckets[1]) / total)), barChart(w, rows, V.cost.alt));
    }
    // by phase
    if (S.phases.length) {
      var prow = S.phases.map(function (p) { return { label: V.phases[p.phase], value: p.mean, max: 100, text: round(p.mean) + '  (n=' + p.n + ')', cls: 'c-real' }; });
      var top = S.phases.slice().sort(function (a, b) { return b.mean - a.mean; });
      out += card(V.phase.title, S.phases.length > 1 ? V.phase.caption(V.phases[top[0].phase], V.phases[top[top.length - 1].phase]) : V.phase.single,
        barChart(w, prow, V.phase.alt));
    }
    // agreement
    var arow = [[V.agree.best, S.found, 'c-best'], [V.agree.real, S.real, 'c-real'], [V.agree.maia, S.maia, 'c-maia']]
      .filter(function (r) { return r[1] !== null; })
      .map(function (r) { return { label: r[0], value: r[1], max: 100, text: round(r[1]) + '%', cls: r[2] }; });
    if (arow.length) out += card(V.agree.title, V.agree.caption, barChart(w, arow, V.agree.alt));
    // time
    if (S.timedBest.length >= MIN_TIMED) {
      out += card(V.time.title, S.split ? V.time.split(clock(S.split.at), round(S.split.fast), round(S.split.slow)) : V.time.caption,
        scatter(w, S.timedBest, V.time.alt(S.timedBest.length)));
    } else out += need(V.time.title, V.need(MIN_TIMED, V.modes.best));
    return out + '</div>';
  }

  return { summarize: summarize, html: html, clock: clock, median: median, movingAverage: movingAverage };
}));
