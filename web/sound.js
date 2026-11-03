/* Sound effects, synthesised with the Web Audio API: no audio files, so nothing to license, download or cache.
 * `create(AudioContextConstructor, enabled)` returns {play, setEnabled, isEnabled}. The context is made on the first
 * play() (always inside a user gesture, which the browsers' autoplay rules require) and any failure silences the
 * module for good instead of throwing into the game.
 *
 * A sound is a list of voices: {t: start offset s, d: duration s, f: Hz, f2: Hz at the end (optional glide),
 * type: oscillator wave, g: peak gain} or {noise: true, ...} for a short filtered noise burst (the "wood" of a move). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GTM_SOUND = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SOUNDS = {
    select: [{ f: 620, d: 0.05, g: 0.12 }],
    deselect: [{ f: 420, d: 0.05, g: 0.09 }],
    move: [{ f: 190, f2: 120, d: 0.09, type: 'triangle', g: 0.35 }, { noise: true, d: 0.03, g: 0.18 }],
    capture: [{ f: 150, f2: 80, d: 0.13, type: 'triangle', g: 0.5 }, { noise: true, d: 0.07, g: 0.3 }],
    good: [{ f: 523, d: 0.12, g: 0.2 }, { t: 0.09, f: 659, d: 0.12, g: 0.2 }, { t: 0.18, f: 784, d: 0.24, g: 0.2 }],
    fine: [{ f: 523, d: 0.1, g: 0.16 }, { t: 0.09, f: 587, d: 0.18, g: 0.16 }],
    bad: [{ f: 262, f2: 196, d: 0.28, type: 'triangle', g: 0.25 }],
    error: [{ f: 150, d: 0.1, type: 'square', g: 0.06 }],
    next: [{ f: 500, f2: 700, d: 0.06, g: 0.1 }],
    tick: [{ f: 880, d: 0.03, g: 0.06 }]
  };

  function voice(ctx, v, at) {
    var start = at + (v.t || 0), end = start + v.d, gain = ctx.createGain(), src;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(v.g, start + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    if (v.noise) {
      var n = Math.max(1, Math.floor(ctx.sampleRate * v.d)), buf = ctx.createBuffer(1, n, ctx.sampleRate), data = buf.getChannelData(0), i;
      for (i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
      src = ctx.createBufferSource(); src.buffer = buf;
      var band = ctx.createBiquadFilter(); band.type = 'bandpass'; band.frequency.value = 1400;
      src.connect(band); band.connect(gain);
    } else {
      src = ctx.createOscillator(); src.type = v.type || 'sine';
      src.frequency.setValueAtTime(v.f, start);
      if (v.f2) src.frequency.exponentialRampToValueAtTime(v.f2, end);
      src.connect(gain);
    }
    gain.connect(ctx.destination);
    src.start(start); src.stop(end + 0.02);
  }

  function create(Ctor, enabled) {
    var ctx = null, on = enabled !== false, broken = false;
    function context() {
      if (!ctx && !broken) { try { ctx = new Ctor(); } catch (e) { broken = true; } }
      return ctx;
    }
    return {
      /* Returns true when a sound was scheduled. `delay` (seconds) lets one action chain two sounds. */
      play: function (name, delay) {
        if (!on || broken || !Ctor || !SOUNDS[name]) return false;
        var c = context();
        if (!c) return false;
        try {
          if (c.state === 'suspended') c.resume();
          var at = c.currentTime + (delay || 0);
          SOUNDS[name].forEach(function (v) { voice(c, v, at); });
          return true;
        } catch (e) { broken = true; return false; }
      },
      setEnabled: function (v) { on = !!v; },
      isEnabled: function () { return on; },
      names: Object.keys(SOUNDS)
    };
  }

  return { create: create, SOUNDS: SOUNDS };
}));
