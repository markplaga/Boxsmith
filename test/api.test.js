'use strict';
// Run with:  npm install && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('../boxsmith-node.js');

let B;
test.before(async () => { B = await load({ dir: path.join(__dirname, '..') }); });
test.after(() => B && B.close());

test('every control on the page is a setting the API accepts', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const keys = new Set([...html.matchAll(/data-k="([A-Za-z0-9_]+)"/g)].map(m => m[1]));
  const defaults = B.boxes.defaults('closed');
  for (const key of keys) assert.ok(Object.hasOwn(defaults, key), 'missing from the API: ' + key);
});

test('every box type builds cut sheets', () => {
  for (const { id } of B.boxes.list()) {
    const design = B.design.compute({ type: id }, { card: false });
    assert.ok(design.sheets.length >= 1, id + ' made no sheets');
    assert.ok(design.sheets[0].svg.includes('<svg'), id + ' has no SVG');
    assert.ok(design.parts.length >= 1, id + ' has no parts');
  }
});

test('compute gives sizes, files and costs, and leaves the page alone', () => {
  const before = JSON.stringify(B.browser.getSettings());
  const design = B.design.compute({ type: 'closed', W: 120, D: 80, H: 50 });
  assert.deepEqual(design.outside, { W: 120, D: 80, H: 50 });
  assert.ok(design.cost.perBox > 0 && design.stats.laserSeconds > 0);
  assert.ok(design.files.some(f => f.name.endsWith('.dxf')) && design.files.some(f => f.name.endsWith('.html')));
  assert.equal(JSON.stringify(B.browser.getSettings()), before);
});

test('bad settings are refused', () => {
  assert.throws(() => B.design.compute({ type: 'nope' }), RangeError);
  assert.throws(() => B.design.compute({ type: 'closed', W: 'wide' }), TypeError);
  assert.throws(() => B.boxes.create('closed', { paint: 'oil' }), RangeError);
});

test('boxes snap flush, and into a Frame, without colliding', () => {
  const frame = B.assemblies.place(B.boxes.create('frame', { W: 240, D: 180, H: 50, frameW: 24 }));
  const small = B.boxes.create('closed', { W: 55, D: 45, H: 30 });
  let layout = B.assemblies.create({ boxes: [frame, B.assemblies.place(small, { position: [300, 0, 0] }), B.assemblies.place(small, { position: [300, 0, 0] })] });
  assert.deepEqual(B.assemblies.overlaps(layout), [[1, 2]]);
  layout = B.assemblies.snap(layout, 1, { to: 0, side: 'in:c' });
  layout = B.assemblies.snap(layout, 2, { to: 1, side: '+x', gap: 5 });
  assert.deepEqual(B.assemblies.overlaps(layout), []);
  const [a, b] = B.assemblies.measure(layout).slice(1);
  assert.ok(Math.abs(b.bounds.min[0] - a.bounds.max[0] - 5) < 0.01);
  assert.throws(() => B.assemblies.snap(layout, 1, { to: 2, side: 'in:c' }), RangeError); // no opening there
});

test('layouts can be edited without changing the original', () => {
  const box = B.assemblies.place(B.boxes.create('open'));
  const one = B.assemblies.create({ boxes: [box] });
  const two = B.assemblies.duplicate(one, 0, { offset: [100, 0, 0] });
  assert.equal(one.boxes.length, 1);
  assert.deepEqual(two.boxes[1].position, [100, 0, 0]);
  assert.equal(B.assemblies.remove(two, 0).boxes.length, 1);
  assert.equal(B.assemblies.update(two, 1, { hidden: true }).boxes[1].hidden, true);
});

test('a picture becomes a layout of painted boxes', () => {
  const w = 8, h = 8, rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { rgba[i * 4] = (i % w) * 30; rgba[i * 4 + 1] = 100; rgba[i * 4 + 2] = 200; rgba[i * 4 + 3] = 255; }
  const mosaic = B.mosaic.build({ rgba, width: w, height: h }, { cols: 4, colors: 2 });
  assert.equal(mosaic.boxes, mosaic.assembly.boxes.length);
  assert.ok(mosaic.assembly.boxes.every(item => item.settings.paint === 'watercolor'));
});

test('materials and recipes can be saved and used', () => {
  B.library.materials.save({ name: 'Test 3mm', t: 3, kerf: 0.15, price: 12 });
  assert.equal(B.library.materials.apply({ type: 'closed' }, 'Test 3mm').kerf, 0.15);
  B.library.materials.remove('Test 3mm');
  B.library.recipes.save('Tiny', { type: 'closed', W: 40, D: 40, H: 20 });
  assert.equal(B.library.recipes.load('Tiny').W, 40);
  B.library.recipes.remove('Tiny');
  assert.deepEqual(B.library.recipes.list(), []);
});

test('the preview can be driven', () => {
  assert.equal(B.browser.view({ material: 'walnut', explode: 0.3 }).material, 'walnut');
  assert.throws(() => B.browser.view({ material: 'gold' }), RangeError);
  B.browser.setSettings({ type: 'open', W: 100, D: 60, H: 40 });
  assert.equal(B.browser.current().outside.W, 100);
});
