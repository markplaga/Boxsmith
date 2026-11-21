# Boxsmith JavaScript API

[Download the illustrated step-by-step guide (PDF)](docs/boxsmith-api-guide.pdf) (covers placing boxes and saving layouts; the sections below also cover everything added since.)

The API does everything the Boxsmith page does: it builds cut sheets, SVG, DXF, parts lists, costs and assembly cards, arranges and snaps whole boxes, keeps saved materials and recipes, turns pictures into mosaics, and drives the 3D preview. It runs locally.

There are three ways to use it:

| Where | How | What you get |
| --- | --- | --- |
| Node.js, everything | `npm install jsdom @napi-rs/canvas`, then `const { load } = require('./boxsmith-node.js'); const Boxsmith = await load();` | The whole API below, including cut sheets and layout measuring. Call `Boxsmith.close()` when done. |
| Node.js, light | `require('./boxsmith-api.js')` | Settings, layouts and layout files only (`boxes`, `assemblies.place/create/parse/serialize/add/remove/duplicate/update`). No geometry, so no cut sheets or snapping. |
| The Boxsmith page | `window.Boxsmith` in the browser console | The whole API, plus `Boxsmith.browser`, which drives the page itself. |

Dimensions and positions are in millimeters and rotations are in degrees everywhere in the API.

## Quick start: cut files for a box

```js
const fs = require('node:fs');
const { load } = require('./boxsmith-node.js');

(async () => {
  const Boxsmith = await load();
  const design = Boxsmith.design.compute({ type: 'closed', W: 120, D: 80, H: 50, text: 'Spices' });

  console.log(design.outside, design.stats, design.cost, design.warnings);
  for (const file of design.files) fs.writeFileSync(file.name, file.data); // sheet SVGs, DXFs and the assembly card
  Boxsmith.close();
})();
```

## Create a Frame with three boxes inside it

```js
const fs = require('node:fs');
const { boxes, assemblies } = require('./boxsmith-api.js');

const frame = boxes.create('frame', { W: 240, D: 180, H: 50, frameW: 24 });
const closed = boxes.create('closed', { W: 55, D: 45, H: 30 });

const layout = assemblies.create({
  unit: 'mm',
  boxes: [
    assemblies.place(frame),
    ...[-60, 0, 60].map(x => assemblies.place(closed, { position: [x, 0, 0] }))
  ]
});

fs.writeFileSync('frame-and-boxes.json', assemblies.serialize(layout));
```

Open `frame-and-boxes.json` with **Open layout** in Boxsmith. You can also read a saved layout in code with `assemblies.parse(fs.readFileSync('frame-and-boxes.json', 'utf8'))`.

## Specify a box

| Method | Result |
| --- | --- |
| `boxes.list()` | Every generator type, including its `id` and display name. |
| `boxes.defaults(type = 'closed')` | A settings object containing all parameter keys and their defaults. |
| `boxes.create(type, parameters = {})` | A new settings object with your overrides. It rejects unknown types, unknown keys and values of the wrong type. |

Every control on the page is a settings key (a test checks this). `W`, `D` and `H` are width, depth and height. Common keys are `t` for material thickness, `fw` for finger width, `kerf`, and `dimMode` with `'inside'` or `'outside'`. `paint` (`'none'`, `'watercolor'` or `'acrylic'`), `paintColor` (like `'#3a7bd5'`) and `paintStrength` (10 to 100, watercolor only) set the painted look in the preview. Style keys include `frameW` for a Frame's ring width, `drawers` for drawer count and `sides` for polygon sides. `unit` selects the display unit. For a decorated design, a Settings JSON file exported from Boxsmith shows the matching keys and nested artwork records.

## Cut sheets, files, costs: `design`

Needs the full API (Node with `boxsmith-node.js`, or the page).

| Method | Result |
| --- | --- |
| `design.compute(settings, options)` | Everything about one design, described below. |
| `design.files(settings, options)` | Just `files`: `[{ name, type, data }]`, ready to write to disk. |
| `design.sheetSVG(settings, index = 1)` | One cut sheet as SVG text. |
| `design.assemblyCard(settings)` | The printable assembly card as HTML (it has no 3D picture outside the page). |

`options` are `svg` and `dxf` (default `true`), `card` (default `true`) and `geometry` (`false`; adds each part's cut outline). `compute` returns:

- `name`, `type`, `settings` (the full settings used), `outside` and `inside` sizes (`{ W, D, H }`, with `inside` null when the design has none).
- `warnings` (the same messages the page shows) and `notes` (assembly notes).
- `parts`: `{ name, material, thickness, width, height, holes }` for one box.
- `sheets`: `{ index, material, thickness, label, width, height, parts, svg, dxf }`, packed with your bed size, grain, gap and quantity.
- `stats`: `{ parts, sheets, bedUsePercent, cutLengthMm, laserSeconds }`.
- `cost`: `{ quantity, materialShare, sheetsIfBoughtWhole, machine, perBox, suggestedPrice }`.
- `files`: the sheet SVGs, sheet DXFs and assembly card, named as the page names them.

Computing a design never changes anything on the page.

## Build, measure and arrange assemblies: `assemblies`

Pure helpers (always available). Each returns a new layout and leaves yours unchanged.

| Method | Result |
| --- | --- |
| `assemblies.place(settings, options = {})` | A copy of a box design with `position: [x, y, z]`, `rotation: [x, y, z]` and `hidden`. |
| `assemblies.create({ boxes, unit })` | A versioned layout from placements. `unit` is `'mm'` or `'in'` (display only). |
| `assemblies.add(layout, placement)` | The layout with one more box. |
| `assemblies.remove(layout, index)` | The layout without that box. |
| `assemblies.duplicate(layout, index, { offset })` | A copy of that box placed next to it, moved by `offset`. |
| `assemblies.update(layout, index, { position, rotation, hidden, settings })` | The layout with those changes to one box. |
| `assemblies.serialize(layout)` / `assemblies.parse(jsonOrObject)` | The JSON text Boxsmith reopens, or a validated copy of a layout. |

X and Y locate a box's center. Z is the height of its lowest point after rotation, so a tipped box rests on the floor.

With geometry (full API only):

| Method | Result |
| --- | --- |
| `assemblies.measure(layout)` | For each box: `bounds` (`min`, `max`, `size`, `center`), `hidden`, and a Frame's `opening`. |
| `assemblies.overlaps(layout)` | Pairs of box indexes whose parts collide, such as `[[1, 2]]`. A box in a Frame's opening is fine; one touching a wall is not. |
| `assemblies.snap(layout, index, { to, side, gap = 0 })` | The box moved flush against a face of box `to`. `side` is `'+x'`, `'-x'`, `'+y'`, `'-y'` or `'+z'`. For a Frame, `'in:c'` centers it in the opening, and `'in:-x'`, `'in:+x'`, `'in:-y'` or `'in:+y'` push it against a wall. |
| `assemblies.row(layout, { axis = 'x', gap = 10 })` | The boxes in a row along `x` or `y` with that gap. |

```js
let layout = assemblies.create({ boxes: [assemblies.place(frame), assemblies.place(closed), assemblies.place(closed)] });
layout = assemblies.snap(layout, 1, { to: 0, side: 'in:c' });                 // into the Frame's opening
layout = assemblies.snap(layout, 2, { to: 1, side: '+x', gap: 5 });           // 5 mm to its right
console.log(assemblies.overlaps(layout));                                       // []
```

## Picture mosaic: `mosaic`

`mosaic.build({ rgba, width, height }, options)` turns a picture into a layout of painted boxes, like the Picture mosaic panel. `rgba` is RGBA bytes (a canvas `ImageData.data`, or a decoded PNG). Options: `cols` (boxes across, 24), `colors` (6), `faces` (`'sides'`, `'side'` or `'top'`), `paint` (`'watercolor'` or `'acrylic'`), `strength`, `dither`, `relief` (`'none'` or a stepped relief) with `steps`, `frame` (add a Frame, `false`), `ring` (the Frame's ring width in mm), and `settings` (the tile box, defaults to a closed box). It returns `{ assembly, columns, rows, boxes, palette }`.

## Saved materials and recipes: `library`

| Method | Result |
| --- | --- |
| `library.materials.list()` / `presets()` | Saved materials (`{ name, t, kerf, price, look }`) or the built-in starting list. |
| `library.materials.save({ name, t, kerf, price, look })` / `remove(name)` | Save or delete one. |
| `library.materials.apply(settings, name)` | Settings with that material's thickness, kerf and sheet price filled in. |
| `library.recipes.list()` / `load(name)` | Saved box designs by name. |
| `library.recipes.save(name, settings)` / `remove(name)` | Save or delete one. |

In the browser these share the page's saved list. In Node they last only as long as the loaded page.

## Drive the page: `Boxsmith.browser`

Browser (or the Node page) only.

| Method | Effect |
| --- | --- |
| `browser.showBox(settings)` | Applies the settings to the editor and opens 3D preview. |
| `browser.getSettings()` / `setSettings(settings)` / `updateSettings(changes)` | Read the editor's settings, replace them, or change a few. |
| `browser.current()` | The same result as `design.compute`, for the editor's box. |
| `browser.showTab(name)` | `'preview'`, `'sheets'`, `'arrange'`, `'guide'` or `'help'`. |
| `browser.view(changes)` | Reads and changes the preview: `material` (`birch`, `walnut`, `mdf`, `clear`, `black`, `pink`, `card`), `explode`, `spin`, `yaw`, `pitch`, `zoom`, `hardware`, `stereo` (`'off'`, `'cross'`, `'parallel'`), `stereoDepth`, `edgeColor` (`'#rrggbb'` or `null`), `lamp` (`{ on, gain, color }`), `maximize`. Returns the current view. |
| `browser.play(loop)` | Plays the "show it work" animation. |
| `browser.snapshot()` | The preview as a PNG data URL. |
| `browser.topView()` | Turns on the Arrange boxes top view. |
| `browser.openAssembly(layout)` / `getAssembly()` / `saveAssembly(layout, filename)` | Open a layout in Arrange boxes, read the current one, or download one. |
| `browser.download(kind)` | Downloads `'svg'`, `'dxf'`, `'settings'`, `'card'` or `'layout'`, as the Download menu does. |

For example, `Boxsmith.browser.showBox(Boxsmith.boxes.create('open', { W: 100 }))` opens a tray in 3D preview.

## Tests

`npm install` then `npm test` runs `test/api.test.js` against the real page. It checks that every control on the page is an API setting, every box type builds, and the layout, mosaic, library and preview calls work.
