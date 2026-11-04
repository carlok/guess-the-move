// SPDX-License-Identifier: AGPL-3.0-or-later
/* Saving an answer as an image, and the FEN beside it.
 *
 * The page's board cannot be serialised as it is: its pieces are `<use>` references to an external sprite and its arrows are
 * styled by the page's style sheet, and an SVG drawn as an image can load neither. So the card is built as one standalone SVG
 * (the board, the arrows, a panel of facts, the FEN) with its own <style> and the piece symbols inlined, drawn onto a canvas
 * and saved as a PNG. The FEN is also written into the PNG itself (a tEXt chunk), so the picture carries its position.
 * Everything except `rasterize` is a pure function: no DOM, no storage. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./board.js'), require('./classify.js'), require('./tierview.js'));
  else root.GTM_SHARE = factory(root.GTM_BOARD, root.GTM_CLASSIFY, root.GTM_TIERVIEW);
}(typeof self !== 'undefined' ? self : this, function (B, C, TV) {
  'use strict';

  var W = 1200, H = 760, BOARD = 640, BX = 40, BY = 60, PX = 720, PW = 440;
  /* The light-theme colours, always (a shared picture should read the same wherever it lands). tests/ check them against style.css. */
  var COLORS = {
    sqLight: '#f0d9b5', sqDark: '#b58863', coordLight: '#7a5a3b', coordDark: '#fff3df', halo: 'rgba(20, 20, 20, .55)',
    you: '#cc79a7', best: '#009e73', real: '#0072b2', maia: '#e69f00', bg: '#f6f5f1', fg: '#1d1d1b', muted: '#5f5f59', line: '#d8d6cc'
  };
  var TIER_COLORS = { brilliant: '#0e8f8f', great: '#5b4bd6', best: '#1f8a3d', excellent: '#4f8f2a', good: '#7b8a17', inaccuracy: '#b07d00', mistake: '#c9561a', blunder: '#c62828' };
  var FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  var PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* Greedy word wrap to at most `max` characters a line (a longer word keeps its own line, or is cut for a FEN). */
  function wrap(text, max, cut) {
    var lines = [], line = '';
    String(text).split(' ').forEach(function (w) {
      while (cut && w.length > max) { if (line) { lines.push(line); line = ''; } lines.push(w.slice(0, max)); w = w.slice(max); }
      if (line && (line + ' ' + w).length > max) { lines.push(line); line = w; } else line = line ? line + ' ' + w : w;
    });
    if (line) lines.push(line);
    return lines;
  }

  /* The `<symbol>` elements of the piece sprite (pieces.svg), to be inlined. */
  function symbolsOf(spriteText) { return (String(spriteText).match(/<symbol\b[\s\S]*?<\/symbol>/g) || []).join(''); }

  function css() {
    var c = COLORS, t = Object.keys(TIER_COLORS).map(function (k) { return '.tier-' + k + '{--t:' + TIER_COLORS[k] + '}'; }).join('');
    return 'svg{--c-you:' + c.you + ';--c-best:' + c.best + ';--c-real:' + c.real + ';--c-maia:' + c.maia + ';--halo:' + c.halo + '}' +
      '.sq.light{fill:' + c.sqLight + '}.sq.dark{fill:' + c.sqDark + '}.coord{font:700 20px ' + FONT + '}.coord.on-light{fill:' + c.coordLight + '}.coord.on-dark{fill:' + c.coordDark + '}' +
      '.arrow-you{--c:var(--c-you)}.arrow-best{--c:var(--c-best)}.arrow-real{--c:var(--c-real)}.arrow-maia{--c:var(--c-maia)}' +
      '.arrow .halo{stroke:var(--halo);fill:none}.arrow .main{stroke:var(--c);fill:none}.arrow .head{fill:var(--c);stroke:var(--halo);stroke-width:4px;stroke-linejoin:round;paint-order:stroke}' +
      '.arrow-label rect{fill:#fff;stroke:var(--c);stroke-width:5px}.arrow-label text{fill:#111;font:700 22px ' + FONT + ';white-space:pre;text-anchor:middle;dominant-baseline:central}' +
      '.arrow-real .halo,.arrow-real .main{stroke-dasharray:22 14}.arrow-maia .halo,.arrow-maia .main{stroke-dasharray:26 10 4 10}.arrow-you .halo,.arrow-you .main{stroke-dasharray:1 16}' +
      '.arrow-real .head,.arrow-maia .head,.arrow-you .head{stroke-dasharray:none}' +
      '.tier-disc{fill:var(--t);stroke:#fff;stroke-width:1}.tier-sym{fill:#fff;font:800 11px ' + FONT + '}.tier-glyph path{fill:none;stroke:#fff;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}' + t +
      '.t{font-family:' + FONT + ';fill:' + c.fg + '}.m{fill:' + c.muted + '}.b{font-weight:700}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}';
  }

  function text(x, y, size, str, cls) { return '<text class="t' + (cls ? ' ' + cls : '') + '" x="' + x + '" y="' + y + '" font-size="' + size + '">' + esc(str) + '</text>'; }
  function lines(x, y, size, arr, step, cls) { return arr.map(function (l, i) { return text(x, y + i * step, size, l, cls); }).join(''); }

  function pieces(board, flipped) {
    var s = '';
    board.forEach(function (ch, i) {
      if (!ch) return;
      var p = B.xy(i, flipped);
      s += '<use href="#' + B.spriteId(ch) + '" x="' + p[0] * 100 + '" y="' + p[1] * 100 + '" width="100" height="100"/>';
    });
    return s;
  }

  /* Distribution of the legal moves over the tiers, one slot each, best first, yours outlined. */
  function bar(sum, yours, x, y, w) {
    var moves = TV.ordered(sum.all), n = moves.length, slot = w / n, out = '', start = 0, end;
    while (start < n) {
      var tier = sum.all[moves[start]].tier;
      end = start;
      while (end < n && sum.all[moves[end]].tier === tier) end++;
      out += '<rect x="' + (x + start * slot).toFixed(1) + '" y="' + y + '" width="' + ((end - start) * slot).toFixed(1) + '" height="20" fill="' + TIER_COLORS[tier] + '" stroke="#f6f5f1" stroke-width="1"/>';
      start = end;
    }
    var at = moves.indexOf(yours);
    return out + '<rect x="' + (x + at * slot).toFixed(1) + '" y="' + (y - 3) + '" width="' + Math.max(slot, 3).toFixed(1) + '" height="26" fill="none" stroke="' + COLORS.fg + '" stroke-width="3"/>';
  }

  /* model: {fen, flipped, board, symbols, arrows (markup), posLine, ratingLine, opening, yourSan, tier, headline, detail,
   * better, sum, yours, rows: [{key, label, san, cost}], date}. Returns {svg, width, height}. */
  function card(model, T) {
    var S = T.share.card, y = 100, out = '';
    out += '<rect width="' + W + '" height="' + H + '" fill="' + COLORS.bg + '"/>';
    out += text(BX, 40, 26, S.title, 'b');
    out += '<g transform="translate(' + BX + ' ' + BY + ') scale(' + BOARD / 800 + ')"><g>' + B.squares(model.flipped) + '</g><g>' + pieces(model.board, model.flipped) + '</g><g>' + model.arrows + '</g></g>';
    out += '<rect x="' + BX + '" y="' + BY + '" width="' + BOARD + '" height="' + BOARD + '" fill="none" stroke="' + COLORS.line + '" stroke-width="2"/>';
    var pl = wrap(model.posLine, 36); out += lines(PX, y, 22, pl, 28, 'b'); y += pl.length * 28;
    if (model.ratingLine) { out += text(PX, y, 18, model.ratingLine, 'm'); y += 26; }
    if (model.opening) { var ol = wrap(model.opening, 44); out += lines(PX, y, 17, ol, 23, 'm'); y += ol.length * 23; }
    y += 8; out += '<line x1="' + PX + '" y1="' + y + '" x2="' + (PX + PW) + '" y2="' + y + '" stroke="' + COLORS.line + '" stroke-width="2"/>';
    y += 30; out += text(PX, y, 17, S.yourMove, 'm');
    y += 54; out += text(PX, y, 54, model.yourSan, 'b');
    var iw = Math.max(model.yourSan.length * 31, 100);
    var icon = TV.icon(model.tier, T).replace('<svg class="tier-icon', '<svg x="' + (PX + iw + 8) + '" y="' + (y - 40) + '" width="44" height="44" class="tier-icon');
    out += icon + text(PX + iw + 62, y - 8, 26, T.tiers[model.tier].name, 'b');
    y += 34; var hl = wrap(model.headline, 40); out += lines(PX, y, 20, hl, 26); y += hl.length * 26;
    out += text(PX, y, 17, model.better, 'm'); y += 34;
    out += bar(model.sum, model.yours, PX, y, PW); y += 52;
    model.rows.forEach(function (r) {
      out += '<circle cx="' + (PX + 8) + '" cy="' + (y - 6) + '" r="8" fill="' + COLORS[r.key] + '"/>' + text(PX + 26, y, 20, r.label, 'm') + text(PX + 210, y, 20, r.san, 'b') + text(PX + PW, y, 18, r.cost, 'm').replace('<text ', '<text text-anchor="end" ');
      y += 30;
    });
    var fl = wrap(model.fen, 50, true), fy = H - 40 - (fl.length - 1) * 20;
    out += text(PX, fy - 30, 14, S.fen, 'm') + lines(PX, fy, 15, fl, 20, 'mono');
    out += text(BX, H - 18, 14, S.footer, 'm') + text(BX + BOARD, H - 18, 14, model.date, 'm').replace('<text ', '<text text-anchor="end" ');
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '"><style>' + css() + '</style><defs>' + model.symbols + '</defs>' + out + '</svg>';
    return { svg: svg, width: W, height: H };
  }

  /* ---- PNG: put text into the picture itself ---- */

  var CRC = (function () {
    var t = [], n, k, c;
    for (n = 0; n < 256; n++) { c = n; for (k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  }());
  function crc32(bytes) { var c = 0xffffffff, i; for (i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  function u32(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }
  function latin1(s) { var out = [], i; for (i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 255); return out; }

  function isPng(bytes) { return PNG_SIGNATURE.every(function (b, i) { return bytes[i] === b; }); }

  /* The PNG with a tEXt chunk per entry ({keyword: text}, Latin-1) right after the header. Throws if it is not a PNG. */
  function addPngText(bytes, entries) {
    if (!isPng(bytes)) throw new Error('not a PNG');
    var ihdrEnd = 8 + 4 + 4 + 13 + 4, chunks = [];
    Object.keys(entries).forEach(function (k) {
      var type = latin1('tEXt'), data = latin1(k).concat([0], latin1(entries[k]));
      chunks = chunks.concat(u32(data.length), type, data, u32(crc32(type.concat(data))));
    });
    var out = new Uint8Array(bytes.length + chunks.length);
    out.set(bytes.subarray(0, ihdrEnd), 0); out.set(chunks, ihdrEnd); out.set(bytes.subarray(ihdrEnd), ihdrEnd + chunks.length);
    return out;
  }

  /* {keyword: text} of the tEXt chunks of a PNG (and `width`, `height` from the header, as numbers under those names). */
  function readPng(bytes) {
    if (!isPng(bytes)) throw new Error('not a PNG');
    var out = {}, pos = 8, len, type, i, data;
    while (pos + 8 <= bytes.length) {
      len = ((bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3]) >>> 0;
      type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
      data = bytes.subarray(pos + 8, pos + 8 + len);
      if (type === 'IHDR') { out.width = ((data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3]) >>> 0; out.height = ((data[4] << 24) | (data[5] << 16) | (data[6] << 8) | data[7]) >>> 0; }
      if (type === 'tEXt') {
        i = data.indexOf(0);
        out[String.fromCharCode.apply(null, data.subarray(0, i))] = String.fromCharCode.apply(null, data.subarray(i + 1));
      }
      pos += 12 + len;
    }
    return out;
  }

  /* Draw the card on a canvas and return PNG bytes. Needs a real image decoder and canvas, so the end-to-end test covers it. */
  /* node:coverage disable */
  function rasterize(win, svg, width, height, scale) {
    return new Promise(function (resolve, reject) {
      var img = new win.Image();
      img.onload = function () {
        var canvas = win.document.createElement('canvas');
        canvas.width = width * scale; canvas.height = height * scale;
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(function (blob) {
          if (!blob) { reject(new Error('the browser could not make a PNG')); return; }
          new win.Response(blob).arrayBuffer().then(function (buf) { resolve(new Uint8Array(buf)); }, reject);
        }, 'image/png');
      };
      img.onerror = function () { reject(new Error('the card could not be drawn')); };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }

  /* node:coverage enable */

  function fileName(kind, id) { return 'guess-the-move-' + String(id || 'position').replace(/[^A-Za-z0-9_-]/g, '') + '.' + kind; }

  return {
    W: W, H: H, COLORS: COLORS, TIER_COLORS: TIER_COLORS, wrap: wrap, symbolsOf: symbolsOf, card: card, crc32: crc32,
    addPngText: addPngText, readPng: readPng, isPng: isPng, rasterize: rasterize, fileName: fileName
  };
}));
