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

test('cube frames build, boxes step by their own size, and keep their own look', () => {
  const cube = B.boxes.create('cubeframe', { W: 100, D: 100, H: 100, beamW: 20, look: 'walnut' });
  assert.equal(B.design.compute(cube).parts.length, 30);
  assert.throws(() => B.boxes.create('closed', { look: 'oak' }), RangeError);
  let layout = B.assemblies.create({ boxes: [B.assemblies.place(cube)] });
  layout = B.assemblies.duplicate(layout, 0);                      // in place
  assert.deepEqual(layout.boxes[1].position, layout.boxes[0].position);
  assert.equal(layout.boxes[1].settings.look, 'walnut');
  layout = B.assemblies.step(layout, 1, 'right');
  layout = B.assemblies.step(layout, 1, 'up', { count: 2 });
  assert.deepEqual(layout.boxes[1].position, [100, 0, 200]);
  assert.deepEqual(B.assemblies.overlaps(layout), []);
  assert.throws(() => B.assemblies.step(layout, 1, 'sideways'), RangeError);
  layout = B.assemblies.color(layout, 0, { color: '#c0392b' });
  layout = B.assemblies.color(layout, 0, { part: 'Outer Top', color: '#4da3ff' });
  assert.deepEqual(layout.boxes[0].settings.colors, { '*': '#c0392b', 'Outer Top': '#4da3ff' });
  layout = B.assemblies.color(layout, 0, { part: '*', color: null });
  assert.deepEqual(B.assemblies.parse(B.assemblies.serialize(layout)).boxes[0].settings.colors, { 'Outer Top': '#4da3ff' });
  assert.throws(() => B.assemblies.color(layout, 0, { color: 'red' }), TypeError);
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

test('view() takes and returns degrees', () => {
  assert.deepEqual([B.browser.view({ pitch: 0, yaw: 45 }).pitch, B.browser.view().yaw], [0, 45]);
  assert.equal(B.browser.view({ pitch: 90, yaw: 0 }).pitch, 90);
  assert.equal(B.browser.view({ pitch: 35 }).pitch, 35);
  assert.equal(B.browser.view({ yaw: -90 }).yaw, -90);
  assert.throws(() => B.browser.view({ pitch: 120 }), RangeError);
  assert.throws(() => B.browser.view({ yaw: 'left' }), TypeError);
});

test('Boxes to cut goes past 50: 100 boxes nest across as many sheets as needed', () => {
  const one = B.design.compute({ type: 'closed', W: 60, D: 40, H: 30 }, { svg: false, dxf: false, card: false });
  const many = B.design.compute({ type: 'closed', W: 60, D: 40, H: 30, qty: 100 }, { svg: false, dxf: false, card: false });
  const nested = many.sheets.reduce((sum, sheet) => sum + sheet.parts.length, 0);
  assert.equal(nested, 100 * one.parts.length);
  assert.equal(many.stats.parts, nested);                // stats and the nest agree
  assert.equal(many.cost.quantity, 100);
  assert.ok(many.sheets.length > one.sheets.length);
  const capped = B.design.compute({ type: 'closed', W: 60, D: 40, H: 30, qty: 5000 }, { svg: false, dxf: false, card: false });
  assert.equal(capped.cost.quantity, 500);
  assert.equal(capped.stats.parts, capped.sheets.reduce((sum, sheet) => sum + sheet.parts.length, 0));
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /data-k="qty" min="1" max="500"/);
});

test('render options are checked', async () => {
  const layout = B.assemblies.create({ boxes: [B.assemblies.place(B.boxes.create('closed'))] });
  const bad = [[{ pitch: 120 }, RangeError], [{ width: 0 }, RangeError], [{ height: 99999 }, RangeError], [{ width: 1.5 }, TypeError],
    [{ fit: 'yes' }, TypeError], [{ background: 'red' }, RangeError], [{ material: 'gold' }, RangeError], [{ edgeColor: 'blue' }, RangeError],
    [{ lamp: true }, TypeError], [{ zoom: 0 }, RangeError], [{ roll: 3 }, RangeError]];
  for (const [options, type] of bad) await assert.rejects(() => B.assemblies.render(layout, options), type, JSON.stringify(options));
  await assert.rejects(() => B.assemblies.render({ nope: 1 }, {}), TypeError);
  const hidden = B.assemblies.create({ boxes: [B.assemblies.place(B.boxes.create('closed'), { hidden: true })] });
  await assert.rejects(() => B.assemblies.render(hidden, {}), /no visible boxes/);
});

// Pictures need a browser (see boxsmith-node.js). These tests skip themselves where there is none.
const pngSize = png => ({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) });
async function alphaBounds(png) {
  const { loadImage, createCanvas } = require('@napi-rs/canvas');
  const image = await loadImage(png), canvas = createCanvas(image.width, image.height), context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  const { data, width, height } = context.getImageData(0, 0, image.width, image.height);
  let x0 = width, x1 = -1, y0 = height, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] > 8) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { x0, x1, y0, y1, width, height };
}
async function canRender(t) {
  try { await B.design.render({ type: 'closed' }, { width: 64, height: 48 }); return true; }
  catch (error) { if (/playwright-core|Could not start Chrome|WebGL/.test(error.message)) { t.skip(error.message); return false; } throw error; }
}

test('a single box renders to a PNG of the right size', async t => {
  if (!await canRender(t)) return;
  const picture = await B.design.render({ type: 'closed', W: 100, D: 70, H: 40, paint: 'acrylic', paintColor: '#3a7bd5' }, { width: 640, height: 480 });
  assert.ok(Buffer.isBuffer(picture.png));
  assert.deepEqual(pngSize(picture.png), { width: 640, height: 480 });
  assert.deepEqual([picture.width, picture.height], [640, 480]);
  assert.ok(picture.png.length > 2000);
  const defaults = await B.design.render({ type: 'open' });
  assert.deepEqual(pngSize(defaults.png), { width: 1600, height: 1200 });
});

test('a layout of 101 boxes renders in a few seconds, and fit frames every box', async t => {
  if (!await canRender(t)) return;
  const { boxes, assemblies } = B, frame = boxes.create('frame', { W: 640, D: 640, H: 40, frameW: 20 });
  const list = [assemblies.place(frame)];
  for (let i = 0; i < 100; i++) {
    const tile = boxes.create('closed', { W: 50, D: 50, H: 30, paint: i % 2 ? 'acrylic' : 'watercolor', paintColor: ['#3a7bd5', '#d5483a', '#3ab05a', '#e0b030'][i % 4] });
    list.push(assemblies.place(tile, { position: [(i % 10) * 60 - 270, Math.floor(i / 10) * 60 - 270, 0], rotation: [0, 0, (i % 7) * 9] }));
  }
  const layout = assemblies.create({ boxes: list });
  assert.equal(layout.boxes.length, 101);
  const started = Date.now();
  const picture = await assemblies.render(layout, { pitch: 90, yaw: 0, width: 800, height: 600, background: 'transparent' });
  assert.ok(Date.now() - started < 15000, 'took ' + (Date.now() - started) + ' ms');
  assert.deepEqual(pngSize(picture.png), { width: 800, height: 600 });
  const b = await alphaBounds(picture.png);
  assert.ok(b.x0 > 0 && b.y0 > 0 && b.x1 < b.width - 1 && b.y1 < b.height - 1, 'every box is inside the picture, with a margin');
  assert.ok(b.y1 - b.y0 > b.height * 0.85 || b.x1 - b.x0 > b.width * 0.85, 'and it fills the picture');

  // fit leaves out hidden boxes: a far-away hidden box does not shrink the framing...
  const far = assemblies.add(layout, assemblies.place(boxes.create('closed'), { position: [5000, 5000, 0], hidden: true }));
  const same = await alphaBounds((await assemblies.render(far, { pitch: 90, yaw: 0, width: 800, height: 600, background: 'transparent' })).png);
  assert.deepEqual(same, b);
  // ...unless showHidden asks for it, and then the layout shrinks to make room.
  const withFar = await alphaBounds((await assemblies.render(far, { pitch: 90, yaw: 0, width: 800, height: 600, background: 'transparent', showHidden: true })).png);
  assert.ok(withFar.x1 - withFar.x0 < b.x1 - b.x0 + 1 || withFar.y1 - withFar.y0 < b.y1 - b.y0 + 1);
  assert.ok(withFar.x1 < withFar.width && withFar.y1 < withFar.height);
});

test('rendering leaves the page, its tab and its layout alone', async t => {
  if (!await canRender(t)) return;
  const before = JSON.stringify([B.browser.getSettings(), B.browser.getAssembly(), B.browser.view()]);
  const layout = B.assemblies.create({ boxes: [B.assemblies.place(B.boxes.create('open'))] });
  await B.assemblies.render(layout, { material: 'walnut', pitch: 10, lamp: { on: true } });
  assert.equal(JSON.stringify([B.browser.getSettings(), B.browser.getAssembly(), B.browser.view()]), before);
});

test('view({ pitch: 90 }) is the Top view of Arrange boxes', async t => {
  if (!await canRender(t)) return;                      // needs the real page with WebGL
  const result = await (await B.page()).evaluate(() => {
    const layout = Boxsmith.assemblies.create({ boxes: [Boxsmith.assemblies.place(Boxsmith.boxes.create('closed'))] });
    Boxsmith.browser.openAssembly(layout);
    Boxsmith.browser.view({ pitch: 20, yaw: 40 });
    Boxsmith.browser.topView();                          // the Top view button: π/2 radians internally
    const button = Boxsmith.browser.view();
    Boxsmith.browser.view({ pitch: 20, yaw: 40 });
    const api = Boxsmith.browser.view({ pitch: 90, yaw: 0 });
    return { button, api };
  });
  assert.equal(result.button.pitch, 90);
  assert.equal(result.api.pitch, result.button.pitch);
  assert.equal(result.api.yaw, result.button.yaw);
});

/* ---------- Remote animation helpers (remote-anim.js) ---------- */
const Anim = require('../remote-anim.js');

test('animation: positions and rotations interpolate at mid-times', () => {
  const v = Anim.validateAnimation({ easing: 'linear', keyframes: [
    { t: 0, boxes: { 0: { position: [0, 0, 0], rotation: [0, 0, 0] } } },
    { t: 2, boxes: { 0: { position: [100, 40, 60], rotation: [0, 0, 90] } } },
    { t: 4, boxes: { 0: { position: [100, 40, 0], rotation: [0, 0, 360] } } }
  ] }, 2);
  assert.equal(v.ok, true);
  assert.equal(v.anim.duration, 4);
  const at = t => Anim.sampleAt(v.anim, t, {}).boxes[0];
  assert.deepEqual(at(1).position, [50, 20, 30]);
  assert.deepEqual(at(1).rotation, [0, 0, 45]);                       // ≤ 180°: shortest-path slerp
  assert.deepEqual(at(3).rotation, [0, 0, 225]);                      // > 180°: kept as written, so 360 spins fully
  assert.deepEqual(at(9).position, [100, 40, 0]);                     // after the last key, hold it
  // easeInOut is symmetric: the middle of a segment is still the middle
  const e = Anim.validateAnimation({ keyframes: [{ t: 0, boxes: { 0: { position: [0, 0, 0] } } }, { t: 1, boxes: { 0: { position: [0, 0, 10] } } }] }, 1);
  const mid = Anim.sampleAt(e.anim, 0.5, {}).boxes[0].position[2], early = Anim.sampleAt(e.anim, 0.25, {}).boxes[0].position[2];
  assert.ok(Math.abs(mid - 5) < 1e-9 && early < 2.5);
  // a box with only a later key eases in from its starting pose; colors hold until their key's time
  const s = Anim.validateAnimation({ easing: 'linear', keyframes: [{ t: 2, boxes: { 1: { position: [0, 0, 80], colors: { acrylic: '#2f8cff' } } } }] }, 2);
  const start = { 1: { position: [0, 0, 0], rotation: [0, 0, 0], colors: undefined } };
  assert.deepEqual(Anim.sampleAt(s.anim, 1, start).boxes[1].position, [0, 0, 40]);
  assert.equal(Anim.sampleAt(s.anim, 1.99, start).boxes[1].colors, undefined);
  assert.deepEqual(Anim.sampleAt(s.anim, 2, start).boxes[1].colors, { acrylic: '#2f8cff' });
  // tilted rotations survive the round trip through quaternions
  for (const r of [[10, 20, 30], [-45, 60, 170]]) assert.deepEqual(Anim.quatToEuler(Anim.eulerToQuat(r)), r);
});

test('animation: bad input is rejected with a message, never thrown', () => {
  const bad = args => Anim.validateAnimation(args, 2);
  assert.match(bad({ keyframes: [{ t: 0, boxes: { 5: {} } }] }).error, /no box 5/);
  assert.match(bad({ keyframes: [{ t: 0, boxes: { 0: { position: [0, NaN, 0] } } }] }).error, /finite/);
  assert.match(bad({ keyframes: [{ t: 121, boxes: {} }] }).error, /120 s/);
  assert.match(bad({ keyframes: Array.from({ length: 2001 }, (_, k) => ({ t: k / 100, boxes: {} })) }).error, /2000/);
  assert.match(bad({ keyframes: [{ t: 0, boxes: {} }], easing: 'bounce' }).error, /easing/);
  assert.match(bad(null).error, /object/);
});

test('batch runs every command, reports the failures, and never throws', () => {
  const ran = [];
  const run = (op, args) => { if (op === 'select' && !(args.index >= 0 && args.index < 2)) return 'There is no box ' + args.index + '.'; if (op === 'boom') throw new Error('kaput'); ran.push(op); };
  const r = Anim.runBatch([{ op: 'select', args: { index: 0 } }, { op: 'color', args: { hex: '#c0392b' } }, { op: 'select', args: { index: 9 } }, { op: 'boom' }, { op: 'batch' }, { nope: 1 }], run);
  assert.deepEqual(ran, ['select', 'color']);
  assert.equal(r.ran, 2);
  assert.equal(r.errors.length, 4);
  assert.match(r.errors[0], /no box 9/);
  assert.match(r.errors[1], /kaput/);
  assert.equal(Anim.runBatch('nope', run).errors.length, 1);
  assert.equal(Anim.runBatch(Array(501).fill({ op: 'fit' }), run).errors.length, 1);
});

test('big messages are split under the relay limit and put back together', () => {
  const limit = 700000;
  const capture = { t: 'capture', id: 'c1', images: Array.from({ length: 5 }, () => 'data:image/png;base64,' + 'A'.repeat(300000)), times: [0, 1, 2, 3, 4] };
  const parts = Anim.splitMessage(capture, limit);
  assert.ok(parts.length > 1 && parts.every(p => JSON.stringify(p).length <= limit));
  assert.deepEqual(parts.flatMap(p => p.times), capture.times);
  assert.ok(parts.every(p => p.part >= 1 && p.of === parts.length));
  const video = { t: 'export', id: 'e1', data: 'data:video/webm;base64,' + 'B'.repeat(2500000) };
  const chunks = Anim.splitMessage(video, 1000000), store = {};
  assert.ok(chunks.length === 3 && chunks.every(c => c.t === 'chunk' && JSON.stringify(c).length <= 1000000));
  let whole = null;
  for (const c of chunks.reverse()) whole = Anim.joinParts(store, c) || whole;   // order doesn't matter
  assert.deepEqual(whole, video);
  assert.deepEqual(Anim.splitMessage({ t: 'state', small: true }, limit), [{ t: 'state', small: true }]);
});

test('the GIF encoder writes a valid animated GIF', () => {
  const w = 8, h = 4, frame = c => Uint8ClampedArray.from({ length: w * h * 4 }, (_, i) => (i % 4 === 3 ? 255 : c));
  const gif = Anim.encodeGIF([frame(0), frame(255)], w, h, 5);
  assert.equal(Buffer.from(gif.slice(0, 6)).toString(), 'GIF89a');
  assert.equal(gif[6] | (gif[7] << 8), w);
  assert.equal(gif[gif.length - 1], 0x3b);
  assert.equal([...gif].filter((b, i) => b === 0x2c && gif[i - 1] === 0).length >= 2, true);   // two image blocks
});
