'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../sound.js');

function fakeAudio({ throwOnNew = false, state = 'suspended' } = {}) {
  const log = [];
  class Ctx {
    constructor() { if (throwOnNew) throw new Error('no audio'); this.currentTime = 2; this.sampleRate = 8000; this.state = state; this.destination = {}; log.push('new'); }
    resume() { this.state = 'running'; log.push('resume'); }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
    createOscillator() {
      return { type: '', frequency: { setValueAtTime(f, t) { log.push('f' + f + '@' + t); }, exponentialRampToValueAtTime(f) { log.push('glide' + f); } }, connect() {}, start() { log.push('osc'); }, stop() {} };
    }
    createBuffer(c, n) { log.push('buffer' + n); return { getChannelData: () => new Float32Array(n) }; }
    createBufferSource() { return { connect() {}, start() { log.push('noise'); }, stop() {} }; }
    createBiquadFilter() { return { type: '', frequency: { value: 0 }, connect() {} }; }
  }
  return { Ctx, log };
}

test('the context is made on the first play, resumed when suspended, and reused', () => {
  const { Ctx, log } = fakeAudio();
  const s = S.create(Ctx);
  assert.deepEqual(log, [], 'nothing is created until a sound is requested (autoplay rules)');
  assert.equal(s.play('select'), true);
  assert.equal(s.play('select'), true);
  assert.equal(log.filter((x) => x === 'new').length, 1);
  assert.equal(log.filter((x) => x === 'resume').length, 1, 'only resumed while suspended');
});

test('every named sound plays; a voice with a glide ramps, a noise voice uses a buffer; delay shifts the start', () => {
  const { Ctx, log } = fakeAudio({ state: 'running' });
  const s = S.create(Ctx);
  s.names.forEach((n) => assert.equal(s.play(n), true, n));
  assert.ok(log.some((x) => x.startsWith('glide')), 'move glides');
  assert.ok(log.includes('noise') && log.some((x) => x.startsWith('buffer')), 'capture has a noise burst');
  log.length = 0;
  s.play('select', 0.5);
  assert.ok(log.includes('f620@2.5'), 'starts at currentTime + delay');
  assert.deepEqual(s.names.sort(), Object.keys(S.SOUNDS).sort());
});

test('disabled, unknown name and a missing constructor are silent and report false', () => {
  const { Ctx, log } = fakeAudio();
  const s = S.create(Ctx, false);
  assert.equal(s.isEnabled(), false);
  assert.equal(s.play('move'), false);
  s.setEnabled(true);
  assert.equal(s.isEnabled(), true);
  assert.equal(s.play('nope'), false);
  assert.equal(S.create(undefined).play('move'), false);
  assert.ok(!log.includes('osc') && !log.includes('noise'), 'nothing was scheduled');
});

test('a context that cannot be made, or that fails while playing, silences the module without throwing', () => {
  const dead = S.create(fakeAudio({ throwOnNew: true }).Ctx);
  assert.equal(dead.play('move'), false);
  assert.equal(dead.play('move'), false, 'and it does not retry on every click');
  class Bad { constructor() { this.currentTime = 0; this.state = 'running'; } createGain() { throw new Error('boom'); } }
  const bad = S.create(Bad);
  assert.equal(bad.play('move'), false);
  assert.equal(bad.play('move'), false);
});
