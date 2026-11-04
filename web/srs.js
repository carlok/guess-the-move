/* Spaced repetition for the positions you got wrong (a Leitner box system counted in positions played, not in days).
 *
 * A guess that gives up MISTAKE_DROP or more win-% points puts the position in box 1; it comes back after INTERVALS[0]
 * more positions. A retry that is Good or better moves it up a box (longer wait); after GRADUATE good retries in a row it
 * leaves the queue; a retry that is a mistake again goes back to box 1; an inaccuracy waits the same time again.
 * State: {id: {box: 1..3, due: the play count at which it is due, ok: good retries in a row}}. Pure functions, no DOM,
 * no storage; every function returns new objects. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./classify.js'));
  else root.GTM_SRS = factory(root.GTM_CLASSIFY);
}(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  var INTERVALS = [5, 15, 40], GRADUATE = 4, MAX_ENTRIES = 5000;

  function copy(srs) { var out = {}; Object.keys(srs).forEach(function (id) { out[id] = { box: srs[id].box, due: srs[id].due, ok: srs[id].ok }; }); return out; }

  /* The queue after a best-mode guess of position `id` that cost `cost` win-% points; `plays` counts that guess. */
  function update(srs, plays, id, cost) {
    var out = copy(srs), e = out[id];
    if (cost >= C.MISTAKE_DROP) { out[id] = { box: 1, due: plays + INTERVALS[0], ok: 0 }; return out; }
    if (!e) return out;
    if (cost < C.GOOD_DROP) {
      e.ok++;
      if (e.ok >= GRADUATE) { delete out[id]; return out; }
      e.box = Math.min(INTERVALS.length, e.box + 1);
    }
    e.due = plays + INTERVALS[e.box - 1];
    return out;
  }

  /* Ids that are due now, the longest overdue first. */
  function due(srs, plays) {
    return Object.keys(srs).filter(function (id) { return srs[id].due <= plays; })
      .sort(function (a, b) { return srs[a].due - srs[b].due || (a < b ? -1 : 1); });
  }

  /* Every queued id, the one due soonest first (for "retry now"). */
  function queue(srs) {
    return Object.keys(srs).sort(function (a, b) { return srs[a].due - srs[b].due || (a < b ? -1 : 1); });
  }

  function summary(srs, plays) { return { total: Object.keys(srs).length, due: due(srs, plays).length }; }

  /* An untrusted object (storage, an imported file) rebuilt from valid entries only. */
  function sanitize(obj) {
    var out = {}, n = 0;
    if (!obj || typeof obj !== 'object') return out;
    Object.keys(obj).forEach(function (id) {
      var e = obj[id];
      if (n >= MAX_ENTRIES || id.length > 64 || !e || typeof e !== 'object') return;
      var box = e.box, d = e.due, ok = e.ok;
      if (Number.isInteger(box) && box >= 1 && box <= INTERVALS.length && typeof d === 'number' && isFinite(d) && d >= 0 && Number.isInteger(ok) && ok >= 0 && ok < GRADUATE) {
        out[id] = { box: box, due: d, ok: ok }; n++;
      }
    });
    return out;
  }

  /* Union; for an id in both, the one that has been through more good retries (further along) wins. */
  function merge(current, incoming) {
    var out = copy(current);
    Object.keys(incoming).forEach(function (id) {
      if (!out[id] || incoming[id].ok > out[id].ok) out[id] = { box: incoming[id].box, due: incoming[id].due, ok: incoming[id].ok };
    });
    return out;
  }

  return { INTERVALS: INTERVALS, GRADUATE: GRADUATE, update: update, due: due, queue: queue, summary: summary, sanitize: sanitize, merge: merge };
}));
