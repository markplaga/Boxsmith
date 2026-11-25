'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const share = require('../share.js');

const defaults = {
  type: 'closed', W: 120, D: 90, H: 70, text: '', on: true,
  art: [], frameBands: [], typeParams: {}
};

test('a design link round-trips the settings that changed', () => {
  const state = Object.assign({}, defaults, {type: 'open', W: 200, text: 'Spices — 3 mm'});
  const enc = share.encode(defaults, state);
  assert.equal(enc.omittedArt, false);
  assert.ok(enc.d);
  const back = share.decode(defaults, enc.d);
  assert.equal(back.settings.type, 'open');
  assert.equal(back.settings.W, 200);
  assert.equal(back.settings.text, 'Spices — 3 mm');
  assert.equal(back.settings.D, 90);
  assert.equal(back.settings.on, true);
  assert.deepEqual(back.settings.art, []);
});

test('the default design still encodes, so a shared link does not depend on saved settings', () => {
  const enc = share.encode(defaults, defaults);
  assert.ok(enc.d);
  const back = share.decode(defaults, enc.d);
  assert.deepEqual(back.settings, defaults);
  assert.equal(back.types, null);
});

test('small artwork is kept and huge artwork is left out', () => {
  const small = Object.assign({}, defaults, {W: 80, art: [{id: 1, type: 'png', data: 'abc'}]});
  const kept = share.encode(defaults, small);
  assert.equal(kept.omittedArt, false);
  assert.equal(share.decode(defaults, kept.d).settings.art[0].data, 'abc');

  const huge = Object.assign({}, defaults, {W: 80, art: [{id: 1, type: 'png', data: 'x'.repeat(20000)}]});
  const dropped = share.encode(defaults, huge);
  assert.equal(dropped.omittedArt, true);
  assert.equal(dropped.d.length < 16000, true);
  const back = share.decode(defaults, dropped.d);
  assert.equal(back.settings.W, 80);
  assert.deepEqual(back.settings.art, []);
});

test('a custom box type rides along in the link', () => {
  const types = {'my-box': {id: 'my-box', name: 'My box'}};
  const enc = share.encode(defaults, Object.assign({}, defaults, {type: 'my-box'}), types);
  const back = share.decode(defaults, enc.d);
  assert.equal(back.settings.type, 'my-box');
  assert.equal(back.types['my-box'].name, 'My box');
});

test('junk, unknown keys and the wrong kind of value are ignored', () => {
  assert.equal(share.decode(defaults, ''), null);
  assert.equal(share.decode(defaults, '!!!'), null);
  assert.equal(share.decode(defaults, 'abcd'), null);
  const bad = share.encode(defaults, defaults).d; // a valid envelope to mutate
  const body = JSON.parse(Buffer.from(bad.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  body.s = {W: 'wide', evil: 1, type: 'open', on: 'yes', art: 'nope'};
  body.extra = true;
  let bin = Buffer.from(JSON.stringify(body)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  const back = share.decode(defaults, bin);
  assert.equal(back.settings.W, 120);
  assert.equal(back.settings.type, 'open');
  assert.equal(back.settings.on, true);
  assert.equal(back.settings.evil, undefined);
  assert.deepEqual(back.settings.art, []);
});

test('a link from a newer format is refused', () => {
  const raw = Buffer.from(JSON.stringify({v: 2, s: {W: 10}})).toString('base64url');
  assert.equal(share.decode(defaults, raw), null);
});
