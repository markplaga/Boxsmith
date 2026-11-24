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
  assert.deepEqual([B.browser.view().projection, B.browser.view().fov], ['ortho', 30]);
  const p = B.browser.view({ projection: 'perspective', fov: 40 });
  assert.deepEqual([p.projection, p.fov], ['perspective', 40]);
  assert.throws(() => B.browser.view({ projection: 'fisheye' }), RangeError);
  assert.throws(() => B.browser.view({ fov: 200 }), RangeError);
  B.browser.view({ projection: 'ortho', fov: 30 });
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

test('animation positions use the display unit (or args.unit), converted to mm', () => {
  const hop = z => ({ keyframes: [{ t: 0, boxes: { 0: { position: [0, 0, 0] } } }, { t: 1, boxes: { 0: { position: [1, 0, z] } } }] });
  const endMM = v => Anim.sampleAt(v.anim, 1, {}).boxes[0].position;
  const mm = Anim.validateAnimation(hop(50.8), 1, 'mm');                                  // display unit mm
  const inch = Anim.validateAnimation(hop(2), 1, 'in');                                   // display unit inches
  const override = Anim.validateAnimation(Object.assign(hop(2), { unit: 'in' }), 1, 'mm'); // unit given in args
  assert.equal(mm.anim.unit, 'mm'); assert.equal(inch.anim.unit, 'in'); assert.equal(override.anim.unit, 'in');
  assert.deepEqual(endMM(mm), [1, 0, 50.8]);
  assert.deepEqual(endMM(inch), [25.4, 0, 50.8]);
  assert.deepEqual(endMM(override), endMM(inch));
  // the same physical hop written in mm and in inches ends in the same place
  assert.deepEqual(endMM(Anim.validateAnimation(hop(50.8), 1, 'mm')).map(v => +v.toFixed(9)),
                   endMM(Anim.validateAnimation({ unit: 'in', keyframes: [{ t: 0, boxes: { 0: { position: [0, 0, 0] } } }, { t: 1, boxes: { 0: { position: [1 / 25.4, 0, 2] } } }] }, 1, 'mm')).map(v => +v.toFixed(9)));
  // camera pan is a length too
  const cam = Anim.validateAnimation({ unit: 'in', keyframes: [{ t: 0, boxes: {} }], camera: [{ t: 0, pan: [1, 0, 0] }] }, 1);
  assert.deepEqual(cam.anim.camera[0].pan, [25.4, 0, 0]);
  assert.match(Anim.validateAnimation(Object.assign(hop(1), { unit: 'cm' }), 1).error, /unit/);
});

test('turn rule: up to 180° takes the shortest path, bigger turns are kept as written', () => {
  const mid = (a, b, u = 0.5) => Anim.rotationBetween([0, 0, a], [0, 0, b], u)[2];
  assert.equal(mid(0, 90), 45);                                       // ordinary turn
  assert.deepEqual([0.25, 0.5, 0.75].map(u => mid(0, 360, u)), [90, 180, 270]);   // 0 → 360: a full spin
  assert.deepEqual([0.25, 0.5, 0.75].map(u => mid(350, 370, u)), [355, 360, 365]); // 350 → 370: crosses 0 the short way (20°)
  // 350 → 10 is written as a −340° turn, which is more than 180°, so it is kept as written:
  // the box turns back the long way, through 180°. Write 350 → 370 for the short way.
  assert.deepEqual([0.25, 0.5, 0.75].map(u => mid(350, 10, u)), [265, 180, 95]);
  // the shortest-path case on more than one axis still ends exactly on the key
  assert.deepEqual(Anim.rotationBetween([0, 0, 0], [90, 0, 90], 1), [90, 0, 90]);
});

test('Import animation reads the saved animation file formats', () => {
  const args = { unit: 'mm', keyframes: [{ t: 0, boxes: { 0: { position: [0, 0, 0] } } }] };
  for (const file of [[{ op: 'animate', args }], { t: 'cmd', op: 'animate', args }, { op: 'animate', args }, args, [{ op: 'fit', args: {} }, { op: 'animate', args }]])
    assert.deepEqual(Anim.parseAnimationFile(JSON.stringify(file)).args, args);
  assert.match(Anim.parseAnimationFile(JSON.stringify({ format: 'boxsmith-layout', version: 1, boxes: [] })).error, /layout file/);
  assert.match(Anim.parseAnimationFile('{"hello":1}').error, /No animation/);
  assert.match(Anim.parseAnimationFile('not json').error, /JSON/);
});

test('a zip of animations, designs and videos becomes a named library', async () => {
  const zlib = require('node:zlib');
  // a tiny zip writer: one stored entry, the rest deflated, all inside one folder
  const entries = [
    ['pack/', ''], ['pack/README.md', 'hello'],
    ['pack/animations/bot-heart-climb-anim.json', JSON.stringify([{ op: 'animate', args: { keyframes: [{ t: 0, boxes: {} }, { t: 2.5, boxes: {} }], base: { format: 'boxsmith-layout', boxes: [{}, {}, {}] } } }])],
    ['pack/animations/bot-wave-anim.json', JSON.stringify({ op: 'animate', args: { keyframes: [{ t: 1, boxes: {} }] } })],
    ['pack/designs/bot-tower.json', JSON.stringify({ format: 'boxsmith-layout', version: 1, boxes: [{}, {}] })],
    ['pack/videos/bot-heart-climb.mp4', 'not really a video'],
    ['pack/.DS_Store', 'junk']
  ];
  const locals = [], central = []; let offset = 0;
  entries.forEach(([name, text], k) => {
    const data = Buffer.from(text), stored = k === 1 || !text, body = stored ? data : zlib.deflateRawSync(data);
    const n = Buffer.from(name), head = Buffer.alloc(30), dir = Buffer.alloc(46);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(stored ? 0 : 8, 8); head.writeUInt32LE(body.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(n.length, 26);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(stored ? 0 : 8, 10); dir.writeUInt32LE(body.length, 20); dir.writeUInt32LE(data.length, 24); dir.writeUInt16LE(n.length, 28); dir.writeUInt32LE(offset, 42);
    locals.push(head, n, body); central.push(dir, n); offset += 30 + n.length + body.length;
  });
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  const zip = Buffer.concat([...locals, cd, end]);

  const files = await Anim.readZip(zip);
  assert.deepEqual(files.map(f => f.name), ['pack/README.md', 'pack/animations/bot-heart-climb-anim.json', 'pack/animations/bot-wave-anim.json', 'pack/designs/bot-tower.json', 'pack/videos/bot-heart-climb.mp4']);
  assert.equal(Buffer.from(files[0].bytes).toString(), 'hello');
  const lib = Anim.buildLibrary(files, 'download-123.zip');
  assert.equal(lib.title, 'Pack');                                                   // the folder inside the zip, not the download name
  assert.deepEqual(lib.animations.map(a => [a.name, a.duration, a.boxes, !!a.video]), [['Heart climb', 2.5, 3, true], ['Wave', 1, null, false]]);
  assert.deepEqual(lib.designs.map(d => [d.name, d.boxes]), [['Tower', 2]]);
  await assert.rejects(Anim.readZip(Buffer.from('not a zip at all, just some text that is long enough')), /not a zip/);
});

test('camera keys: per-key ease, falling back to the animation easing; yaw is never wrapped', () => {
  const keys = [{ t: 0, boxes: { 0: { position: [0, 0, 0] } } }];
  const E = Anim.EASE;
  const mk = (camera, easing) => Anim.validateAnimation({ keyframes: keys, camera, easing }, 1).anim;
  const yawAt = (a, t) => Anim.sampleAt(a, t, {}, { yaw: 0, pitch: 30, zoom: 1, pan: [0, 0, 0] }).camera.yaw;
  // the issue's example: easeInOut from 0 to 2 s, then linear from 2 to 6 s
  const a = mk([{ t: 0, yaw: -35, ease: 'easeInOut' }, { t: 2, yaw: 0, ease: 'linear' }, { t: 6, yaw: 120 }]);
  for (const t of [0.25, 0.5, 1, 1.5, 1.9]) assert.ok(Math.abs(yawAt(a, t) - (-35 + 35 * E.easeInOut(t / 2))) < 1e-9);
  for (const t of [2.5, 3, 4, 5.5]) assert.ok(Math.abs(yawAt(a, t) - 120 * (t - 2) / 4) < 1e-9);   // constant speed
  assert.equal(yawAt(a, 0), -35); assert.equal(yawAt(a, 2), 0); assert.equal(yawAt(a, 6), 120);
  // every ease name works, and a key without ease uses the animation's easing
  for (const name of ['linear', 'easeIn', 'easeOut', 'easeInOut', 'smoothstep']) {
    const b = mk([{ t: 0, yaw: 0, ease: name }, { t: 1, yaw: 100 }]);
    assert.ok(Math.abs(yawAt(b, 0.3) - 100 * E[name](0.3)) < 1e-9, name);
    const g = mk([{ t: 0, yaw: 0 }, { t: 1, yaw: 100 }], name);
    assert.ok(Math.abs(yawAt(g, 0.3) - 100 * E[name](0.3)) < 1e-9, 'global ' + name);
  }
  // existing animations (no ease anywhere) play exactly as before: the global easeInOut on every span
  const old = mk([{ t: 0, yaw: 10, zoom: 1 }, { t: 1, yaw: 50 }, { t: 3, yaw: 20, zoom: 2 }]);
  assert.ok(Math.abs(yawAt(old, 2) - (50 - 30 * E.easeInOut(0.5))) < 1e-9);
  // yaw is unwrapped: 350 -> 10 goes back through 180, 0 -> 720 is two whole orbits
  const w = mk([{ t: 0, yaw: 350, ease: 'linear' }, { t: 1, yaw: 10 }]);
  assert.equal(yawAt(w, 0.5), 180);
  const two = mk([{ t: 0, yaw: 0, ease: 'linear' }, { t: 4, yaw: 720 }]);
  assert.equal(yawAt(two, 2), 360);
  // a bad ease is refused with a message
  const bad = Anim.validateAnimation({ keyframes: keys, camera: [{ t: 0, yaw: 0, ease: 'bouncy' }] }, 1);
  assert.equal(bad.ok, false); assert.match(bad.error, /camera\[0\]\.ease/);
});

test('camera keys: catmullRom passes every key with no jump in speed; linear stays the default', () => {
  const keys = [{ t: 0, boxes: { 0: { position: [0, 0, 0] } } }];
  const view = { yaw: 0, pitch: 30, zoom: 1, pan: [0, 0, 0] };
  const cam = [{ t: 0, yaw: -40, zoom: 1, pan: [0, 0, 0] }, { t: 1, yaw: 10, pan: [100, 0, 50] }, { t: 1.5, yaw: 90, zoom: 2 },
    { t: 3, yaw: 100, pan: [0, 300, 0] }, { t: 4, yaw: 400, zoom: 1.2 }, { t: 6, yaw: 380, pan: [0, 0, 0] }];
  const spl = Anim.validateAnimation({ keyframes: keys, camera: cam, cameraInterp: 'catmullRom' }, 1).anim;
  const lin = Anim.validateAnimation({ keyframes: keys, camera: cam, easing: 'linear' }, 1).anim;
  assert.equal(Anim.validateAnimation({ keyframes: keys, camera: cam }, 1).anim.cameraInterp, 'linear');
  const at = (a, t) => Anim.sampleAt(a, t, {}, view).camera;
  // every key is hit exactly, endpoints included
  for (const k of cam) for (const f of ['yaw', 'zoom', 'pan']) if (k[f] !== undefined) assert.deepEqual(at(spl, k.t)[f], k[f], f + ' at ' + k.t);
  // speed just before and just after each interior key is the same (it is not for linear)
  const h = 1e-6, vel = (a, f, t, side) => side < 0 ? (at(a, t)[f] - at(a, t - h)[f]) / h : (at(a, t + h)[f] - at(a, t)[f]) / h;
  for (const t of [1, 1.5, 3, 4]) {
    const l = vel(spl, 'yaw', t, -1), r = vel(spl, 'yaw', t, 1);
    assert.ok(Math.abs(l - r) < 1e-3 * Math.max(1, Math.abs(l)), 'yaw speed at ' + t + ': ' + l + ' vs ' + r);
    assert.ok(Math.abs(vel(lin, 'yaw', t, -1) - vel(lin, 'yaw', t, 1)) > 1, 'linear has a kink at ' + t);
  }
  for (const t of [1, 3]) {          // pan is keyed at 0, 1, 3, 6
    const pan = (a, t) => at(a, t).pan, l = pan(spl, t).map((v, i) => (v - pan(spl, t - h)[i]) / h), r = pan(spl, t + h).map((v, i) => (v - pan(spl, t)[i]) / h);
    l.forEach((v, i) => assert.ok(Math.abs(v - r[i]) < 1e-2 * Math.max(1, Math.abs(v)), 'pan speed at ' + t));
  }
  // yaw is never wrapped: 100 -> 400 passes through 250, and 400 -> 380 stays above 360
  assert.ok(at(spl, 3.5).yaw > 150 && at(spl, 3.5).yaw < 350);
  assert.ok(at(spl, 5).yaw > 370);
  // a hold (two keys with the same value) stays still, with no overshoot
  const hold = Anim.validateAnimation({ keyframes: keys, cameraInterp: 'catmullRom', camera: [{ t: 0, yaw: 0 }, { t: 1, yaw: 90 }, { t: 2, yaw: 90 }, { t: 3, yaw: 0 }] }, 1).anim;
  for (let t = 1; t <= 2; t += 0.1) assert.ok(Math.abs(at(hold, t).yaw - 90) < 1e-9);
  for (let t = 0; t <= 3; t += 0.05) assert.ok(at(hold, t).yaw <= 90 + 1e-9);
  // and a bad value is refused
  assert.match(Anim.validateAnimation({ keyframes: keys, cameraInterp: 'bezier' }, 1).error, /cameraInterp/);
});

test('camera keys: projection defaults to ortho, and fov keys ease like the other fields', () => {
  const keys = [{ t: 0, boxes: { 0: { position: [0, 0, 0] } } }];
  assert.equal(Anim.validateAnimation({ keyframes: keys }, 1).anim.projection, 'ortho');
  const a = Anim.validateAnimation({ keyframes: keys, projection: 'perspective', camera: [{ t: 0, fov: 20, ease: 'linear' }, { t: 2, fov: 60 }] }, 1).anim;
  assert.equal(a.projection, 'perspective');
  const fov = t => Anim.sampleAt(a, t, {}, { yaw: 0, pitch: 0, zoom: 1, pan: [0, 0, 0], fov: 30 }).camera.fov;
  assert.equal(fov(0), 20); assert.equal(fov(1), 40); assert.equal(fov(2), 60);
  assert.match(Anim.validateAnimation({ keyframes: keys, projection: 'fisheye' }, 1).error, /projection/);
  assert.match(Anim.validateAnimation({ keyframes: keys, camera: [{ t: 0, fov: 200 }] }, 1).error, /fov/);
});

test('constant-rate video: frame times and the WebM writer', () => {
  const t = Anim.cfrTimes(8, 30);
  assert.equal(t.length, 240); assert.equal(t[1], 1 / 30); assert.ok(Math.abs(t[239] - 239 / 30) < 1e-12);
  assert.equal(Anim.cfrTimes(40.36, 30).length, 1211);            // round(duration × 30)
  const w = Anim.makeWebM({ width: 64, height: 48, fps: 30, videoCodec: 'V_VP8', durationMs: 100,
    chunks: [0, 1, 2].map(k => ({ track: 1, us: k * 1e6 / 30, data: new Uint8Array([k]), key: k === 0 })) });
  const hex = Buffer.from(w).toString('hex');
  assert.ok(hex.startsWith('1a45dfa3'));                              // EBML
  assert.ok(hex.includes('23e383' + '84' + (Math.round(1e9 / 30)).toString(16).padStart(8, '0')));   // DefaultDuration = 1/30 s
  assert.ok(hex.includes('1c53bb6b'));                                // Cues, so players can seek
});

test('soundtracks: named in the animation, matched in a zip, fitted to the animation length', () => {
  const files = [{ name: 'Reel/boxbot-reel-loop-sfx-v1.mp3' }, { name: 'Reel/other.wav' }];
  assert.equal(Anim.findSoundtrack('BOXBOT-reel-loop-sfx-v1.mp3', files), files[0]);          // by name, folders and case ignored
  assert.equal(Anim.findSoundtrack(undefined, files, 'boxbot-reel-loop-anim'), files[0]);     // by the animation's own name
  assert.equal(Anim.findSoundtrack(undefined, files, 'tower-crash-anim'), null);
  assert.equal(Anim.findSoundtrack('https://example.com/a.mp3', files), null);                // URLs are fetched, not matched
  const [ch] = Anim.fitAudio([new Float32Array([1, 2, 3, 4, 5])], 4, 2);                      // 2 s at 4 Hz = 8 samples
  assert.deepEqual([...ch], [1, 2, 3, 4, 5, 0, 0, 0]);
  assert.equal(Anim.fitAudio([new Float32Array(100)], 10, 3)[0].length, 30);                  // longer audio is cut
  const ok = Anim.validateAnimation({ keyframes: [{ t: 0, boxes: {} }], soundtrack: 'sfx.mp3' }, 1);
  assert.equal(ok.anim.soundtrack, 'sfx.mp3');
  assert.match(Anim.validateAnimation({ keyframes: [{ t: 0, boxes: {} }], soundtrack: 5 }, 1).error, /soundtrack/);
});

test('WebM writer: an Opus track, with the last packet trimmed to the video length', () => {
  const w = Anim.makeWebM({ width: 64, height: 48, fps: 30, videoCodec: 'V_VP8', durationMs: 100,
    audio: { codec: 'A_OPUS', sampleRate: 48000, channels: 2, codecPrivate: Anim.opusHead(2, 48000), codecDelayNs: 6500000 },
    chunks: [{ track: 1, us: 0, data: new Uint8Array([1]), key: true }, { track: 2, us: 0, data: new Uint8Array([2]), key: true },
      { track: 2, us: 20000, data: new Uint8Array([3]), key: true, discardNs: 6833333 }] });
  const hex = Buffer.from(w).toString('hex');
  assert.ok(hex.includes(Buffer.from('A_OPUS').toString('hex')) && hex.includes(Buffer.from('OpusHead').toString('hex')));
  assert.ok(hex.includes('75a2'));                                     // DiscardPadding on the last audio block
  assert.equal(Buffer.from(Anim.opusHead(2, 48000)).toString('hex').slice(16, 20), '0102');   // version 1, 2 channels
});

test('groups: layout files, group keys and camera targets', () => {
  const s = B.boxes.create('closed');
  const f = B.assemblies.create({ boxes: [{ settings: s }, { settings: s }, { settings: s, group: 'hand' }],
    groups: [{ id: 'bot', boxes: [0, 1], origin: [1, 2, 3] }, { id: 'hand', parent: 'bot' }] });
  assert.deepEqual(f.groups, [{ id: 'bot', origin: [1, 2, 3], boxes: [0, 1] }, { id: 'hand', origin: [0, 0, 0], parent: 'bot', boxes: [2] }]);
  assert.ok(!('groups' in B.assemblies.create({ boxes: [{ settings: s }] })));             // files without groups are unchanged
  assert.deepEqual(B.assemblies.parse(B.assemblies.serialize(f)).groups, f.groups);
  assert.throws(() => B.assemblies.create({ boxes: [{ settings: s }], groups: [{ id: 'a', parent: 'b' }, { id: 'b', parent: 'a' }] }), /own parents/);
  assert.throws(() => B.assemblies.create({ boxes: [{ settings: s }], groups: [{ id: 'a', boxes: [0] }, { id: 'b', boxes: [0] }] }), /two groups/);
  // group keys: per-key ease, the box turn rule, scale, step fields
  const a = Anim.validateAnimation({ easing: 'linear', keyframes: [
    { t: 0, groups: { bot: { position: [0, 0, 0], rotation: [0, 0, 0] } } },
    { t: 2, groups: { bot: { position: [100, 0, 0], rotation: [0, 0, 180], scale: 2, colors: { '*': '#ff0000' } } } }] }, 3, 'mm', ['bot', 'hand']).anim;
  const g = t => Anim.groupsAt(a, t, { bot: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 } }).bot;
  assert.deepEqual(g(1).position, [50, 0, 0]); assert.ok(Math.abs(g(1).rotation[2] - 90) < 1e-9); assert.equal(g(1).scale, 1.5);
  assert.equal(g(1).colors, undefined); assert.deepEqual(g(2).colors, { '*': '#ff0000' });
  assert.match(Anim.validateAnimation({ keyframes: [{ t: 0, groups: { nope: {} } }] }, 1, 'mm', ['bot']).error, /no group nope/);
  assert.match(Anim.validateAnimation({ keyframes: [{ t: 0, groups: { bot: { scale: 0 } } }] }, 1, 'mm', ['bot']).error, /scale/);
  // camera target: resolved through view.resolveTarget, blended with pan keys
  const c = Anim.validateAnimation({ keyframes: [{ t: 0, boxes: {} }], camera: [{ t: 0, pan: [0, 0, 0], ease: 'linear' }, { t: 2, target: { group: 'bot', offset: [0, 0, 10], lag: 0.5 } }] }, 1, 'mm', ['bot']).anim;
  assert.deepEqual(c.camera[1].target, { group: 'bot', offset: [0, 0, 10], lag: 0.5 });
  const view = { yaw: 0, pitch: 0, zoom: 1, pan: [0, 0, 0], fov: 30, resolveTarget: (T, t) => [t * 100, 0, T.offset[2]] };
  assert.deepEqual(Anim.sampleAt(c, 1, {}, view).camera.pan, [50, 0, 5]);   // halfway from [0,0,0] to the target at t=1 ([100,0,10])
  assert.deepEqual(Anim.sampleAt(c, 3, {}, view).camera.pan, [300, 0, 10]); // past the last key it keeps following
  assert.match(Anim.validateAnimation({ keyframes: [{ t: 0, boxes: {} }], camera: [{ t: 0, pan: [0, 0, 0], target: { group: 'bot' } }] }, 1, 'mm', ['bot']).error, /both pan and target/);
});

/* ---------- custom box types ---------- */
const typeFile = name => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'types', name + '.json'), 'utf8'));

test('box types: the formula language', () => {
  const T = B.types;
  assert.equal(T.formula('2*t + max(W, D)/2', { t: 3, W: 100, D: 60 }), 56);
  assert.deepEqual(T.formula('[1,2] + [10,20]', {}), [11, 22]);
  assert.deepEqual(T.formula('a ? axis(1) : -Z', { a: 1 }), [0, 1, 0]);
  assert.equal(T.template('Strip {k}{#k}', { k: 'A' }), 'Strip A1');
  assert.throws(() => T.formula('Wd + 1', { W: 1 }), /did you mean "W"/);
});

test('box types: the file format is checked with plain messages', () => {
  for (const f of ['closed-box', 'open-tray', 'cube-frame']) assert.equal(B.types.validate(typeFile(f)).ok, true, f);
  const r = B.types.validate({ format: 'boxsmith-type', version: 1, id: 'closed', name: 'X', parts: [{ box: { size: ['W', 'D'] }, panel: {} }] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.path === 'id'), 'built-in ids are taken');
  assert.ok(r.errors.some(e => e.path === 'parts[0]'), 'one component per entry');
  assert.throws(() => B.types.register({ format: 'nope' }), e => Array.isArray(e.errors) && e.errors.length > 0);
});

test('box types: the three type files make the same parts as the built-ins', () => {
  const cases = { closed: ['closed-box', [{}, { W: 201, D: 90, H: 41, t: 4.5 }, { dimMode: 'inside', corners: 'pinwheel' }, { tslot: 'M3', t: 6, fw: 14 }]],
    open: ['open-tray', [{}, { notch: true, handles: true, cols: 3, rows: 2 }, { dimMode: 'inside', corners: 'edge', notch: true, notchH: 20 }]],
    cubeframe: ['cube-frame', [{}, { beamW: 5 }, { beamW: 80, W: 300, D: 120, H: 90 }, { dimMode: 'inside', beamW: 30 }]] };
  for (const [built, [file, settings]] of Object.entries(cases)) {
    const def = typeFile(file);
    B.types.register(def);
    try {
      for (const s of settings) {
        assert.deepEqual(B.types.parts({ ...s, type: file }), B.types.parts({ ...s, type: built }), file + ' ' + JSON.stringify(s));
        const c = B.types.check(def, s);
        assert.equal(c.ok, true, file + ' ' + JSON.stringify(s) + ': ' + JSON.stringify(c.errors));
      }
    } finally { B.types.unregister(file); }
  }
});

test('box types: check finds joints that do not meet, overlaps and build errors', () => {
  const base = { format: 'boxsmith-type', version: 1, name: 'Test' };
  const pair = (id, a, b) => ({ ...base, id, parts: [
    { panel: { name: 'A', size: [100, 60], edges: [a, 'e', 'e', 'e'], u: 'X', v: 'Y', n: 'Z' } },
    { panel: { name: 'B', size: [100, 60], edges: [b, 'e', 'e', 'e'], at: [0, 't', 0], u: 'X', v: 'Z', n: '-Y' } }] });
  assert.equal(B.types.check(pair('good-pair', 'f', 'F')).ok, true);
  const same = B.types.check(pair('same-pair', 'f', 'f'));
  assert.equal(same.stage, 'fit');
  assert.ok(same.errors.some(e => /runs into "B"/.test(e.message)) && same.errors.some(e => /finger gaps/.test(e.message)));
  const lone = B.types.check({ ...base, id: 'lone', parts: [{ panel: { name: 'A', size: [100, 60], edges: ['f', 'e', 'e', 'e'] } }] });
  assert.match(lone.errors[0].message, /no other part fills/);
  const over = B.types.check({ ...base, id: 'over', parts: [{ panel: { name: 'A', size: [100, 60] } }, { panel: { name: 'B', size: [100, 60], at: [20, 10, 0] } }] });
  assert.ok(over.errors.some(e => /overlap through the middle/.test(e.message)));
  const bad = B.types.check({ ...base, id: 'bad-axes', parts: [{ panel: { name: 'A', size: [10, 10], u: '2*X' } }] });
  assert.equal(bad.stage, 'build'); assert.match(bad.errors[0].message, /one unit long/);
  assert.equal(B.types.get('good-pair'), null, 'check leaves nothing registered');
});

test('box types: a registered type works like a built-in, with its own parameters', () => {
  const def = typeFile('cube-frame');
  def.id = 'my-frame'; def.params.push({ key: 'slack', kind: 'length', default: 2, min: 0, max: 10, label: 'Gap' });
  B.types.register(def);
  try {
    assert.ok(B.boxes.list().some(t => t.id === 'my-frame'));
    const d = B.design.compute({ type: 'my-frame', beamW: 30, typeParams: { 'my-frame': { slack: 4 } } }, { card: false });
    assert.ok(d.parts.length > 6);
    assert.throws(() => B.boxes.create('my-frame', { typeParams: { 'my-frame': { slack: 99 } } }), /slack/);
  } finally { B.types.unregister('my-frame'); }
  assert.ok(!B.boxes.list().some(t => t.id === 'my-frame'));
});

test('box types: the JSON Schema accepts the example type files', () => {
  const Ajv = require('ajv/dist/2020');
  const validate = new Ajv({ allErrors: true, strict: false }).compile(require('../boxsmith-type.schema.json'));
  for (const f of ['closed-box', 'open-tray', 'cube-frame']) assert.equal(validate(typeFile(f)), true, f + ': ' + JSON.stringify(validate.errors));
  assert.equal(validate({ format: 'boxsmith-type', version: 1, id: 'x', name: 'X', parts: [] }), false);
});
