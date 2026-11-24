# Boxsmith JavaScript API

[Download the illustrated step-by-step guide (PDF)](docs/boxsmith-api-guide.pdf) (12 pages: the browser console, cut files and costs, arranging and snapping boxes, copying, stepping and coloring boxes, Node scripts including the full headless API, mosaics, library and page control, rendering pictures, tests and troubleshooting)

The API does everything the Boxsmith page does: it builds cut sheets, SVG, DXF, parts lists, costs and assembly cards, arranges and snaps whole boxes, keeps saved materials and recipes, turns pictures into mosaics, and drives the 3D preview. It runs locally.

There are three ways to use it:

| Where | How | What you get |
| --- | --- | --- |
| Node.js, everything | `npm install jsdom @napi-rs/canvas`, then `const { load } = require('./boxsmith-node.js'); const Boxsmith = await load();` | The whole API below, including cut sheets and layout measuring. Call `await Boxsmith.close()` when done. For pictures (`render`) also `npm install playwright-core` and have Chrome, Chromium or Edge installed. |
| Node.js, light | `require('./boxsmith-api.js')` | Settings, layouts and layout files only (`boxes`, `assemblies.place/create/parse/serialize/add/remove/duplicate/update/color`, `looks`). No geometry, so no cut sheets or snapping. |
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

Every control on the page is a settings key (a test checks this). `W`, `D` and `H` are width, depth and height. Common keys are `t` for material thickness, `fw` for finger width, `kerf`, and `dimMode` with `'inside'` or `'outside'`. `paint` (`'none'`, `'watercolor'` or `'acrylic'`), `paintColor` (like `'#3a7bd5'`) and `paintStrength` (10 to 100, watercolor only) set the painted look in the preview. `look` is optional and sets the material a box keeps in a layout (see below). Style keys include `frameW` for a Frame's ring width, `beamW` for a Cube frame's beam width, `drawers` for drawer count and `sides` for polygon sides. `unit` selects the display unit. `qty` is the number of boxes to cut (1 to 500); `design.compute` nests every copy across as many sheets as needed, and `stats.parts` counts them all. For a decorated design, a Settings JSON file exported from Boxsmith shows the matching keys and nested artwork records.

## New box styles: `types`

A box type file is JSON that describes a new style of box: its parts, their sizes, where they sit, and which edges have fingers. It holds only numbers and short formulas, no code. [BOX-TYPES.md](BOX-TYPES.md) is the full format, written so you can hand it to an AI; [`boxsmith-type.schema.json`](boxsmith-type.schema.json) is its JSON Schema; [`types/`](types/) has the Closed box, Open tray and Cube frame written as type files.

| Method | Result |
| --- | --- |
| `types.validate(type)` | `{ok, errors, warnings}`. Checks the file without building it. Each problem is `{path, message}`, where `path` is the place in the file (`parts[2].panel.edges[1]`). |
| `types.check(type, settings = {})` | Validates, builds with these settings, and tests the parts in 3D: every finger meets a partner's gap, no two parts run into each other or overlap, and each part fits the sheet. Returns `{ok, stage, errors, warnings, parts, size, notes}`; `stage` is `'format'`, `'build'`, `'fit'` or `'done'`. Nothing stays registered. |
| `types.register(type)` | Adds the type (or replaces one with the same `id`). It then lists in `boxes.list()` and works everywhere a built-in style does: `boxes.create`, `design.compute`, layouts. Throws a `TypeError` with an `errors` list if the file has problems. |
| `types.unregister(id)` | Removes it. |
| `types.get(id)`, `types.list()` | A registered type file, or all of them. |
| `types.explain(errors)` | The problems as plain lines, ready to show or paste back to an AI. |
| `types.parts(settings)` | The parts any style makes, in a form you can compare: name, outline, holes, circles, 3D placement and text, plus the warnings and notes. |
| `types.formula(src, env)`, `types.template(text, env)` | The formula language on its own: `types.formula('2*t + W/2', {t: 3, W: 100})` → `56`. |

A type's own settings go in `typeParams`, keyed by type id, so they can't clash with Boxsmith's settings or another type's:

```js
const frame = JSON.parse(fs.readFileSync('types/cube-frame.json', 'utf8'));
frame.id = 'slim-frame';
frame.params.push({ key: 'slack', label: 'Slack', kind: 'length', default: 2, min: 0, max: 10 });

const report = Boxsmith.types.check(frame, { W: 200, D: 200, H: 200 });
if (!report.ok) throw new Error(Boxsmith.types.explain(report.errors));

Boxsmith.types.register(frame);
const design = Boxsmith.design.compute({ type: 'slim-frame', beamW: 30, typeParams: { 'slim-frame': { slack: 4 } } });
```

A param that reuses a standard setting (`beamW` above, or `handles`, `cols`, …) reads that setting instead. `boxes.create` checks `typeParams` against each loaded type's `kind`, `min`, `max` and `choices`; values for a type that isn't loaded are kept as they are.

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
| `assemblies.duplicate(layout, index, { offset })` | A copy of that box, moved by `offset`. With no offset the copy sits exactly on the original (the page's *Duplicate in place*). |
| `assemblies.update(layout, index, { position, rotation, hidden, settings })` | The layout with those changes to one box. |
| `assemblies.color(layout, index, { part = '*', color })` | That box colored: `part` is a part name from `design.compute(...).parts` (such as `'Cover Top'`), `'acrylic'` for every see-through part, or `'*'` for the whole box. `color` is `'#rrggbb'`, or `null` to remove it. A part's own color beats `'acrylic'`, which beats the whole-box color. See-through parts (acrylic) stay see-through, just tinted. |
| `assemblies.serialize(layout)` / `assemblies.parse(jsonOrObject)` | The JSON text Boxsmith reopens, or a validated copy of a layout. |

X and Y locate a box's center. Z is the height of its lowest point after rotation, so a tipped box rests on the floor.

Each box in a layout can keep its own material look in `settings.look`: one of `Boxsmith.looks` (`'birch'`, `'walnut'`, `'mdf'`, `'clear'`, `'black'`, `'pink'`, `'card'`). Pictures and the Arrange view draw that box in that material. A box with no `look` uses the render's `material` option (or the page's preview material). Boxes added on the page record the preview material they had. Colors live in `settings.colors`, for example `{ '*': '#c0392b', 'Cover top': '#4da3ff' }`, and are what the page's *Color* row sets.

With geometry (full API only):

| Method | Result |
| --- | --- |
| `assemblies.measure(layout)` | For each box: `bounds` (`min`, `max`, `size`, `center`), `hidden`, and a Frame's `opening`. |
| `assemblies.overlaps(layout)` | Pairs of box indexes whose parts collide, such as `[[1, 2]]`. A box in a Frame's opening is fine; one touching a wall is not. |
| `assemblies.snap(layout, index, { to, side, gap = 0 })` | The box moved flush against a face of box `to`. `side` is `'+x'`, `'-x'`, `'+y'`, `'-y'` or `'+z'`. For a Frame, `'in:c'` centers it in the opening, and `'in:-x'`, `'in:+x'`, `'in:-y'` or `'in:+y'` push it against a wall. |
| `assemblies.row(layout, { axis = 'x', gap = 10 })` | The boxes in a row along `x` or `y` with that gap. |
| `assemblies.step(layout, index, direction, { count = 1 })` | The box moved by its own size, as turned (the page's *Step* buttons). `direction` is `'left'`, `'right'`, `'up'`, `'down'`, `'in'` (+Y, away from you) or `'out'` (−Y). |

```js
let layout = assemblies.create({ boxes: [assemblies.place(frame), assemblies.place(closed), assemblies.place(closed)] });
layout = assemblies.snap(layout, 1, { to: 0, side: 'in:c' });                 // into the Frame's opening
layout = assemblies.snap(layout, 2, { to: 1, side: '+x', gap: 5 });           // 5 mm to its right
console.log(assemblies.overlaps(layout));                                       // []
```

## Picture mosaic: `mosaic`

`mosaic.build({ rgba, width, height }, options)` turns a picture into a layout of painted boxes, like the Picture mosaic panel. `rgba` is RGBA bytes (a canvas `ImageData.data`, or a decoded PNG). Options: `cols` (boxes across, 24), `colors` (6), `faces` (`'sides'`, `'side'` or `'top'`), `paint` (`'watercolor'` or `'acrylic'`), `strength`, `dither`, `relief` (`'none'` or a stepped relief) with `steps`, `frame` (add a Frame, `false`), `ring` (the Frame's ring width in mm), and `settings` (the tile box, defaults to a closed box). It returns `{ assembly, columns, rows, boxes, palette }`.

## Pictures: `assemblies.render` and `design.render`

Draw a layout, or one box, to a PNG from code. The picture uses the same scene and paint code as Arrange boxes, so acrylic and watercolor paint, rotations, heights and hardware match the app. It is drawn on its own offscreen canvas and camera, so the page's view, tab and layout are not touched. Both calls return a promise.

| Method | Result |
| --- | --- |
| `assemblies.render(layout, options)` | `{ png, width, height }` for a layout object or its JSON text (anything `assemblies.parse` accepts). |
| `design.render(settings, options)` | The same, for one box design. |

`png` is a data URL in the browser and a `Buffer` in Node. All options are optional; angles are in degrees.

| Option | Meaning |
| --- | --- |
| `pitch` | Degrees down from horizontal, `-90` to `90`. Default `35`. `90` looks straight down. |
| `yaw` | Degrees around the vertical axis. Default `30`. |
| `width`, `height` | Pixels, whole numbers from 1 to 8192. Default `1600` by `1200`. |
| `fit` | `true` (default) frames every visible box with a small margin. `false` uses `zoom` instead. |
| `zoom` | Used only when `fit` is `false`. Default `1`. |
| `material`, `edgeColor`, `lamp` | As in `browser.view`: `material` (default `'birch'`; boxes with their own `settings.look` keep it), `edgeColor` (`'#rrggbb'`), `lamp` (`{ on, gain, color }`). A render never uses the page's current preview settings, so the same call always gives the same picture. |
| `background` | `'#rrggbb'` or `'transparent'`. Default white. |
| `showHidden` | `true` also draws boxes marked `hidden`. Default `false`. |

Bad values throw a `TypeError` or `RangeError` that says which option was wrong, and a layout with no visible boxes throws an `Error`.

```js
// render.cjs  (npm install jsdom @napi-rs/canvas playwright-core)
const fs = require('node:fs');
const { load } = require('./boxsmith-node.js');

(async () => {
  const Boxsmith = await load();
  const { boxes, assemblies } = Boxsmith;

  const frame = boxes.create('frame', { W: 240, D: 180, H: 50, frameW: 24 });
  const tile = boxes.create('closed', { W: 55, D: 45, H: 30, paint: 'acrylic', paintColor: '#3a7bd5' });
  const layout = assemblies.create({
    boxes: [assemblies.place(frame), ...[-60, 0, 60].map(x => assemblies.place(tile, { position: [x, 0, 0] }))]
  });

  const picture = await assemblies.render(layout, { pitch: 50, yaw: 30, width: 1200, height: 800 });
  fs.writeFileSync('render.png', picture.png);          // a Buffer in Node

  const top = await Boxsmith.design.render({ type: 'open', W: 140, D: 90, H: 42 }, { pitch: 90, background: 'transparent' });
  fs.writeFileSync('tray-top.png', top.png);

  await Boxsmith.close();                                // also closes the browser used for drawing
})();
```

In the browser: `const { png } = await Boxsmith.assemblies.render(layout, { pitch: 90 });` and use `png` as an image `src`.

**In Node** the picture is drawn by the real page in headless Chromium, because jsdom has no WebGL. `boxsmith-node.js` starts it the first time you render, uses software GL (no graphics card needed), and keeps it for later renders until `close()`. It needs the `playwright-core` package and Chrome, Chromium or Edge on the computer. It looks for an installed Chrome or Edge; set `BOXSMITH_CHROME=/path/to/chrome` or `load({ chrome: '/path/to/chrome' })` to choose one. A layout of 101 boxes renders in about a second on a typical computer, plus a second or so the first time to start the browser.

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
| `browser.view(changes)` | Reads and changes the preview: `material` (`birch`, `walnut`, `mdf`, `clear`, `black`, `pink`, `card`), `explode`, `spin`, `yaw` and `pitch` in degrees (pitch is down from horizontal, so `90` is straight down, the Top view), `zoom`, `hardware`, `stereo` (`'off'`, `'cross'`, `'parallel'`), `stereoDepth`, `projection` (`'ortho'` or `'perspective'`), `fov` (the perspective lens, 5–120° vertical; reported in both projections, the same as the Remote state's `view.fov`), `edgeColor` (`'#rrggbb'` or `null`), `lamp` (`{ on, gain, color }`), `maximize`. Returns the current view. Changing `material` affects only the box being designed; boxes already arranged keep their own look. |
| `browser.play(loop)` | Plays the "show it work" animation. |
| `browser.snapshot()` | The preview as a PNG data URL. |
| `browser.topView()` | Turns on the Arrange boxes top view. |
| `browser.openAssembly(layout)` / `getAssembly()` / `saveAssembly(layout, filename)` | Open a layout in Arrange boxes, read the current one, or download one. |
| `browser.download(kind)` | Downloads `'svg'`, `'dxf'`, `'settings'`, `'card'` or `'layout'`, as the Download menu does. |

For example, `Boxsmith.browser.showBox(Boxsmith.boxes.create('open', { W: 100 }))` opens a tray in 3D preview.

## Remote control: two screens, scripts and AI helpers

The **📱 Remote** button in Arrange boxes links a second screen to the one showing the model (the *host*). Anything that can send JSON can be that second screen: a person on an iPad, a script, or an AI helper. The host owns the layout; the remote sends commands and gets state, notes, pictures and recordings back.

**Connecting.** Two windows in one browser use `new BroadcastChannel('boxsmith-remote-' + code)`. Anything else opens a WebSocket to the relay (`wss://marktheartist-boxsmith-relay.hf.space/ws`) and first sends `{"t":"join","room":"482917","role":"remote"}` with the 6-digit code the host shows. Then send `{"t":"hello"}`; the host answers with a `state` message.

**Commands** are `{"t":"cmd","op":"…","args":{…}}`. The host answers every command (or batch) with one fresh `state`. Anything wrong comes back as `{"t":"note","text":"…"}`: a bad index, a number that isn't finite, an unknown op. Nothing is thrown.

| op | args | What it does |
| --- | --- | --- |
| `select` | `{ index }` (`-1` for none) | Selects a box. |
| `part` | `{ name }` (a part name, `'acrylic'` or `null`) | Picks one part of the selected box for coloring. |
| `set` | `{ k: 0–2, value, rot? }` | Sets x, y or z of the position (in the display unit), or of the turn in degrees with `rot: true`. |
| `step` | `{ key: '0:1' }` (`axis:direction`) | Moves the box by its own size (axis 0 x, 1 y, 2 z). |
| `turn` | `{ kind: 'z:90' }` (`'z:-90'`, `'x:90'`, `'y:90'`, `'reset'`) | The Rotate buttons. |
| `snap` | `{ to, side, gap? }` | Snaps against box `to` (sides as in `assemblies.snap`). |
| `dup`, `hide`, `remove` | `{ inPlace? }` for `dup` | The Boxes buttons. |
| `color`, `nocolor` | `{ hex: '#rrggbb' }` | Colors the selected box or part. |
| `design`, `add` | `{ index, settings }` / `{ settings }` | Replaces a box's design in place, or adds a new box. |
| `view` | `{ yaw?, pitch?, zoom?, pan?, projection?, fov? }` | Sets the camera (degrees). `projection` is `'ortho'` or `'perspective'`; `fov` is the perspective lens, 5–120° vertical. |
| `groupCreate` | `{ id, boxes: [i, …], origin?, parent? }` | Makes a group of those boxes. `origin` (the pivot, display unit) defaults to the centre of their base. See *Groups*. |
| `groupRemove` | `{ id }` | Ungroups: its boxes and groups move up to its parent (or out of any group). |
| `groupMove` | `{ id, by: [dx, dy, dz] }` or `{ id, to: [x, y, z] }` | Moves every box in the group (and the groups inside it), and its origin, by an amount or so the origin lands at `to`. Display unit. |
| `groupDuplicate` | `{ id, newId?, offset? }` | Copies the group's boxes and the groups inside it, with their structure and origins, as new groups (`newId`, else `id-2`, `id-3`, …). In place unless `offset`. Replies `{"t":"group","op":"duplicated","from":"bot17","id":"bot17-2"}`. |
| `groupSelect` | `{ id }` | Selects the group's first box. |
| `noFrame` | `{ value: true \| false, index? }` or `{ value, group }` | Marks a box (default: the selected one) as ground or backdrop: it still draws, but the camera's framing ignores it. See *Ground and backdrop boxes*. |
| `frame` | `{ boxes?: [i, …] \| 'all', groups?: [id, …], margin?, yaw?, pitch? }` | Zooms and pans so those boxes (or everything in those groups, where they are right now) (default: every box not hidden and not marked `noFrame`) fill the view, leaving `margin` (default 0.1, a fraction of their size) free on each side. `yaw` and `pitch` (degrees) turn the view first. Works in either projection. |
| `fit`, `top`, `place`, `maximize`, `stereo`, `units`, `save`, `open`, `clear` | `{ mode }` for `stereo`, `{ unit }` for `units`, `{ json }` for `open` | The Layout & view controls. |
| `state` | none | Does nothing but answer with a fresh `state` (as every command does), with no note. `{"t":"hello"}` does the same. |
| `batch` | `{ cmds: [{ op, args }, …] }` (up to 500) | Runs them all, then sends one state. No need to pace commands for the relay's 60 messages a second. |
| `animate` | see below | Loads an animation and plays it (unless `autoplay: false`). Positions are in the display unit, the same as `set`. |
| `library` | none, or `{ kind: 'animation' \| 'design', index }` | With no args, replies `{"t":"library","library":{…}}` listing what's in the zip imported on the model screen. With `kind` and `index`, plays an animation or opens a design from it. |
| `libraryPlay` | `{ index \| name, autoplay?: true, loop? }` | Loads a library animation exactly as if its `animate` file had been sent, without sending it: the remote names it and the model screen reads it from the zip it already has open. Plays at once unless `autoplay: false`. `loop` overrides the file's own setting. Replies `{"t":"anim","state":"loaded",…}` once it's ready (autoplay or not), then the usual playing and done messages. |
| `libraryLoadDesign` | `{ index \| name }` | Opens a design from the library. |
| `play`, `pause`, `stop`, `seek` | `{ t }` for `seek` | Playback. `stop` puts every animated box and the camera back where they were. |
| `capture` | see below | Pictures of the view or the animation. |
| `export` | `{ format: 'webm' \| 'gif', fps?, width?, height?, audio? }` | Records the animation from start to finish. The host also shows a Download button. WebM is a true constant frame rate (default 30 fps): see Export below. |
| `record`, `recordStop` | `{ fps?, width?, height?, id? }` for `record` | Live recording: captures whatever the view shows in real time (manual orbiting and zooming, edits, animations started mid-take) until `recordStop`, then replies `{"t":"export","live":true,"format":"webm","data":"data:video/webm;base64,…",…}`, split into chunks when big. Default 30 fps, 1280 × 800. See Export below. |

**State** (`{"t":"state",…}`) includes `boxes` (label, position, rotation, colors, hidden), `sel`, `part`, `parts`, `unit`, `stereo`, `view` (`yaw`, `pitch` in degrees, `zoom`, `pan`, `projection`, `fov`), `camera` (what the camera shows, in mm: see below), `anim` (`playing`, `t`, `duration`, `loop`, or `null`) and `exporting`.

### Soundtrack

An animation can name a soundtrack, and the model screen plays it live, in step with the animation:

```json
{ "op": "animate", "args": { "soundtrack": "boxbot-reel-loop-sfx-v1.mp3", "loop": true, "keyframes": [ … ] } }
```

- `soundtrack` is the name of an audio file (mp3, wav, ogg, m4a, aac, flac, opus), an `https:` URL, or a `data:audio/…;base64,…` URL. A file name is found in the zip the animation came from, or among the files picked together with it in **▶ Import animation** (choose the `.json` and the `.mp3` at the same time), or in the zip library open on the model screen. In a zip, an animation without `soundtrack` uses the one audio file whose name starts with its own (`boxbot-reel-loop-anim.json` → `boxbot-reel-loop-sfx-v1.mp3`). A remote's *Import an animation from this device* also takes the audio file and sends it along as a data URL.
- The sound starts when play is pressed, pauses and seeks with the animation, and loops when it loops. It is cut or padded with silence to exactly the animation's length, so each loop restarts it on the same sample.
- **Sync.** While the sound plays, the animation takes its time from the audio clock, less the device's output latency, so it shows what you're hearing and the two can't drift apart over any number of loops. Each frame is drawn for the moment it will be on screen. If the audio clock stalls or the browser suspends audio, the animation carries on by the system clock and the sound restarts at the animation's time. Measured in Chrome over three loops of a 40.36 s reel, a sound at 2.93 s was heard within about one frame (33 ms at 30 fps) of the frame showing 2.93 s on every loop, with no drift.
- Browsers only allow sound after a tap, click or key press on that page. The model screen's first tap enables it; if an animation started from a remote before then, its sound joins in, in step, at that first tap. While it waits, the state says `blocked`.
- The state's `anim.soundtrack` is `{name, state, seconds}`, where `state` is `loading`, `ready`, `playing`, `blocked` or `error` (with `error` saying why, e.g. the file wasn't found), or `null`.

### Groups

A group is several boxes that move as one unit, such as a character made of a body and two pieces. Groups can sit inside other groups. A layout file lists them:

```json
"groups": [ { "id": "bot17", "boxes": [49, 50, 51], "origin": [1200, 300, 0] },
            { "id": "bot17-arm", "boxes": [52], "origin": [1260, 300, 90], "parent": "bot17" } ]
```

- `boxes` are the box indexes directly in the group (a box is in at most one group, its innermost). A box can name its group instead (`"group": "bot17"` on the box). `origin` is the group's pivot in mm. `parent` puts a group inside another. `noFrame: true` keeps the whole group out of camera framing (see *Ground and backdrop boxes*).
- Box positions are still where each box sits at rest, so a layout with groups looks and edits exactly like one without. Groups are kept when layouts and animations are saved and opened, and `state.boxes[i].group` names each box's group.
- **Group keys.** Keyframes can move groups, by id, as well as (or instead of) boxes. Every box in the group, and in the groups inside it, moves rigidly with it, so a turn carries the pieces along a true arc and they never drift apart:

  ```json
  { "t": 2, "groups": { "bot17": { "position": [1800, 300, 0], "rotation": [0, 0, 180], "scale": 1, "ease": "linear" } } }
  ```

  `position` is where the group's origin is (display unit), `rotation` turns it about its origin (degrees, the same order as box rotations), and `scale` sizes it about its origin. Each key's `ease` shapes the span to its next key (else the animation's `easing`). `"groupInterp": "catmullRom"` in the animate args gives position and scale a smooth spline, like `cameraInterp`. Rotation follows the box turn rule (see *Turns*). `colors` (applied to every box in the group, over their own colours) and `hidden` switch at their key's time. Unkeyed, a group stays where it rests.
- A box's own keys inside a group are in the group's frame: they say where it sits relative to the group at rest, and the group's motion carries that along. So a piece can wave while its group walks.
- **Framing doesn't move.** The layout's framing (`layoutCenter`, `visible`, the camera keys' meaning) comes from where boxes rest, and moving groups never changes it during an animation.
- Poses depend only on the time, so `seek(t)` always gives exactly the same picture (frame-by-frame exports are repeatable).
- `state.groups` lists each group: `{id, parent, origin, noFrame, boxes, center, bounds: {min, max}, pose}`, with `center` and `bounds` (mm) where the group is right now, and `pose` while an animation moves it.

### Ground and backdrop boxes

A box whose settings include `"noFrame": true` still draws (and is cut, priced and saved like any other), but it doesn't count toward the layout's framing: the centre and radius the camera works from, and so `layoutCenter`, `visible`, `zoom` and every camera key, come from the other boxes. So a big ground slab or backdrop can be added under an existing shot without reframing it. In a test, a 20-box tower framed with radius 3357 mm; adding a 29 × 22 m slab made it 18613 mm and shrank the shot about 5.5×, and with `noFrame` on the slab it was 3357 mm again, exactly. Set it with the **Ground (camera ignores)** checkbox in Arrange boxes, the Remote `noFrame` op, or by putting `"noFrame": true` in a box's `settings` in a layout or an animation's `base`; it's kept when layouts and animations are saved and opened again. If every box is marked, they all count. Layouts without it frame exactly as before.

```json
{ "settings": { "type": "closed", "W": 29000, "D": 22000, "H": 40, "noFrame": true }, "position": [-14500, -11000, -40] }
```

### Camera framing in the state

`state.camera` says exactly what the view shows, so a shot can be framed by arithmetic instead of guesswork. Lengths are millimetres, whatever the display unit.

```json
"camera": { "projection": "ortho", "fov": 30,
  "lookAt": [0, 0, 3371], "layoutCenter": [0, 0, 3371],
  "visible": { "width": 14783, "height": 9239 },
  "canvas": { "width": 1280, "height": 800, "pixelRatio": 2 },
  "axes": { "right": [0.825, -0.565, 0], "up": [0.167, 0.244, 0.955], "forward": [0.54, 0.788, -0.296] } }
```

- `layoutCenter` is the centre of all the boxes' bounds (its z is half the layout's height, not the floor). `view.pan` is measured from it, so `lookAt` = `layoutCenter` + `pan`.
- `visible` is the width and height the view covers at the look-at point, at the current zoom and canvas size. It is inversely proportional to zoom: `visible.height` = (its value at zoom 1) ÷ zoom. A point at `lookAt + axes.up × visible.height/2` sits exactly on the top edge.
- `canvas` is the model screen's 3D view in CSS pixels. Captures and exports letterbox this view into the size you ask for, so ask for the same aspect ratio to keep the framing. In stereo, `stereo: true` is added and each eye gets half the width.
- `axes` are the camera's right, up and forward directions in world space.
- `projection` and `fov` (degrees) are the current projection. In perspective, `visible` is measured on the plane through the look-at point, and `distance` and `eye` (the camera's position) are added.
- The values are live: during playback every state reflects the camera at that moment (send `{"t":"hello"}` for a fresh state at any time).

### Animate

```json
{ "t": "cmd", "op": "animate", "args": {
  "unit": "mm", "fps": 30, "easing": "easeInOut", "cameraInterp": "linear", "projection": "ortho", "loop": false,
  "keyframes": [
    { "t": 0,   "boxes": { "0": { "position": [0, 0, 0],  "rotation": [0, 0, 0] } } },
    { "t": 0.5, "boxes": { "0": { "position": [0, 0, 60], "rotation": [0, 0, 60] } } },
    { "t": 1,   "boxes": { "0": { "position": [0, 0, 0],  "rotation": [0, 0, 120] } } },
    { "t": 1.5, "boxes": { "0": { "position": [0, 0, 60], "rotation": [0, 0, 180] } } },
    { "t": 2,   "boxes": { "0": { "position": [0, 0, 0],  "rotation": [0, 0, 240] },
                           "1": { "colors": { "acrylic": "#2f8cff" } } } },
    { "t": 2.5, "boxes": { "0": { "position": [0, 0, 60], "rotation": [0, 0, 300] } } },
    { "t": 3,   "boxes": { "0": { "position": [0, 0, 0],  "rotation": [0, 0, 360] } } }
  ],
  "camera": [ { "t": 0, "yaw": -35, "pitch": 30, "zoom": 1 }, { "t": 3, "yaw": 35, "pitch": 30, "zoom": 1 } ]
} }
```

That makes box 0 hop 60 mm three times while turning a full circle, tints box 1's acrylic blue from 2 seconds, and swings the camera round.

**Units.** Positions are in the display unit, the same as `set`. That's the `unit` in the state (`'mm'` or `'in'`), unless `"unit": "mm"` or `"unit": "in"` in the `animate` args overrides it. Camera `pan` uses the same unit. The `playing` message echoes the unit used: `{"t":"anim","state":"playing","time":0,"unit":"mm"}`. One difference to watch: the positions in the state's `boxes` are always in millimetres. Divide them by the state's `scale` (25.4 when the unit is inches, otherwise 1) to get display units.

- Each box key may hold `position`, `rotation`, `colors`, `hidden` and `settings`. Only the boxes you list move; the rest hold still. A box whose first key comes after 0 eases in from where it stood.
- Positions and the camera ease between keys. `easing` is `'easeInOut'` (the default), `'linear'`, `'easeIn'`, `'easeOut'` or `'smoothstep'`. Camera keys can also carry their own `ease` (see Camera keys below).
- **Turns.** Each axis is compared separately between two keys. If every axis changes by 180° or less, the box takes the shortest path: 0 → 90 turns 90°. If any axis changes by more than 180°, the angles are kept exactly as written and eased one by one. So 0 → 360 spins a full circle, and 350 → 10 is a −340° turn that goes back the long way, through 180°. To cross 0 the short way, write 350 → 370 (a 20° turn). The keys' angles are taken literally, not reduced to 0–360 first.
- `colors`, `hidden` and `settings` switch at their key's time and hold until the next. A `settings` key rebuilds that box; each design is built once when the animation loads, and playback otherwise only moves boxes.
- Playback follows the real clock at up to `fps` frames a second, so it stays on time on a slow device. Optional `base` is a layout (object or JSON text) to open first.
- Limits: 2000 keyframes, 120 seconds, `fps` 1–60.
- While an animation plays, the model screen hides its whole interface and fills the screen (cinema mode). It comes back when playback ends, pauses or stops. A tap, click, Esc or Space on the model screen pauses it. Exports play without cinema mode.
- As soon as an animation has loaded (from `animate`, `libraryPlay` or `library`, with or without autoplay), the host sends `{"t":"anim","state":"loaded","time":0,"duration":8,"name":"Stadium wave","autoplay":false,"soundtrack":null}`. Wait for it before sending `export`, `seek` or `capture`. Then it sends `{"t":"anim","state":"playing","time":0}` when playback starts and `{"t":"anim","state":"done","time":3}` at the end.

### Camera keys

Each camera key has a time `t` and any of `yaw`, `pitch` (degrees), `zoom`, `fov` (perspective only) and `pan` (`[x, y, z]` in the display unit, relative to the layout's centre). A field that a key leaves out is carried by the keys that do set it, so `yaw` and `zoom` can be keyed at different times.

- **Per-key ease.** A key may carry `ease`: `'linear'`, `'easeIn'`, `'easeOut'`, `'easeInOut'` or `'smoothstep'`. It shapes the span from that key to the next one, for every field that changes across that span. A key without `ease` uses the animation's `easing`. So holds, eased moves and constant-speed orbits can sit in one animation without dense keys:

  ```json
  "camera": [ { "t": 0, "yaw": -35, "ease": "easeInOut" }, { "t": 2, "yaw": 0, "ease": "linear" }, { "t": 6, "yaw": 120 } ]
  ```

  That eases from −35° to 0° over 2 seconds, then orbits at a steady 30° a second.
- **Perspective.** `"projection": "perspective"` in the `animate` args draws the animation through a lens instead of orthographically, so near things look bigger and the scene has depth and parallax. The default is `"ortho"`, and an animation without `projection` always plays orthographic, whatever the view was set to, so existing files look exactly as before. Camera keys may then carry `fov`, the vertical field of view in degrees (5–120; the view starts at 30), which eases like the other fields. The camera keeps the same orbit, and `zoom` keeps its meaning: at the look-at point, perspective shows exactly what orthographic shows at the same zoom. To do that the camera stands at distance = visible height ÷ (2·tan(fov/2)), which is a base distance divided by `zoom`. So `fov` sets how strong the perspective is (about 25–40° looks like a normal camera lens; wider is more dramatic), and animating `fov` while `zoom` holds is a dolly zoom: the subject stays the same size while the background stretches or flattens. To push in, animate `zoom`. The near and far planes follow the camera, so the stage, the floor and tall layouts (a 6.7 m tower) never clip. Stop puts the view's own projection back.
- **Following a group.** Instead of `pan`, a key can carry `"target": {"group": "bot17", "offset": [0, 0, 75], "lag": 0.3}`. Its look-at point is then the group's origin (carried by the group and any groups around it, but not by the motion of the pieces inside it) plus `offset` (display unit). `lag` (seconds, 0–10, default 0) makes the camera trail smoothly: it looks at where the target was on average over the last `lag` seconds. This is worked out from the time alone, so `seek` and frame-by-frame exports are exact. A key with `target` and a key with `pan` blend into each other like any two keys, so the camera can glide onto a character and off again. Past the last target key, the camera keeps following. In a test of a character walking 1700 mm a second: with lag 0 it stayed exactly centred; with lag 0.5 s it trailed by up to about 0.25 s of its motion just after a sharp turn, then recentred. Keys without `target` behave exactly as before.
- **Yaw is never wrapped.** Camera angles are plain numbers and go straight from one key's value to the next, never the shortest way round. 350 → 10 swings back 340° through 180°; write 350 → 370 to cross 0 the short way. 0 → 720 makes two whole orbits. (Box turns follow the different rule under Turns, above.)
- Before a field's first key, the view the animation started from holds and eases in, using the animation's `easing`.
- **Smooth paths: `"cameraInterp": "catmullRom"`** (in the `animate` args; the default is `"linear"`). Yaw, pitch, zoom and pan then follow a Catmull-Rom spline through the keys, so the camera's speed carries smoothly through every key instead of changing abruptly there. Every key is still reached exactly at its time, endpoints included. The spline's knots are the key times (so a key's timing is never moved), and the slope at each key is the time-weighted average of the slopes on either side. Two neighbouring keys with the same value make a true hold: the camera stays still between them, with no overshoot, and slows into and out of it smoothly. With `catmullRom` the animation's `easing` is not applied to the camera, because the spline sets the speed; a key's own `ease` still reshapes its span (an `easeInOut` key brings the camera to rest at both ends of that span). Yaw is not wrapped here either.

### Export

`export` with `format: 'webm'` renders the animation frame by frame rather than recording it as it plays, so the video has a **true constant frame rate**: frame *k* shows the animation at exactly *k*/fps seconds, there are round(duration × fps) frames (240 for 8 s at 30 fps), and the WebM says so (`ffprobe` reports `r_frame_rate` and `avg_frame_rate` 30/1). That keeps sound sync and editing frame-accurate however slow the model screen is; a slow device just takes longer to finish, with a "Recording video… n%" indicator, and the model screen doesn't play the animation while it records. Video is VP9 (VP8 where VP9 can't be encoded), with a key frame every 2 seconds and seek points. The reply adds `frames`, `cfr: true` and `codec`. **Sound in the video.** When the animation has a soundtrack (see Soundtrack), a WebM export includes it as an Opus audio track (48 kHz, stereo), already in sync, so no separate ffmpeg step is needed. The audio is exactly as long as the video (round(duration × fps) ÷ fps seconds: the last Opus packet is trimmed with DiscardPadding), and the reply adds `audio: {codec:'opus', seconds, sampleRate, channels}`. `audio: false` leaves it out. GIFs have no sound. If the browser can't encode audio, the video comes without it and a note says so. Browsers without WebCodecs (very old ones) fall back to recording playback in real time, and the reply then says `cfr: false`. Matroska stores times in whole milliseconds, so at 30 fps successive frames are 33 or 34 ms apart while staying exactly on the 1/30 s grid overall.

**Live recording** (`record` … `recordStop`, or **● Record** in Layout & view on the model screen) films the view as it happens instead of rendering a timeline, so a take can start with someone orbiting by hand and continue with an animation that a remote starts. It is also a true constant frame rate: time is cut into 1/fps slots on the real clock, each slot gets the picture the view shows at that moment with timestamp slot/fps, and if the device is too slow for a slot the current picture fills it, so the frames are always exactly 1/fps apart and there are (seconds recorded × fps) of them. Each slot is drawn fresh at the take's own size (see *Pictures at the size you ask for* below) with the animation posed for that slot's exact time, so every frame is new as long as the device can draw a frame within 1/fps. If it can't, the recording comes first: the screen skips a redraw rather than the video losing a frame, and only slots the device truly couldn't reach repeat the previous picture. While it records, a **● REC 0:12** badge shows on the model screen (it isn't in the video; clicking it stops the take). The state has `recording: {fps, width, height, seconds}` or `null`. The model screen also offers the file for download. Limits: 10 minutes a take, `fps` 1–60, up to 1920 × 1920. `export` waits until a live recording has stopped. Needs WebCodecs (current Chrome, Edge, Safari 17+).

**Pictures at the size you ask for.** Captures, exports and live recordings don't copy the screen. Each frame is rendered by the model screen at exactly the requested width and height, with the same camera (look-at point, zoom, projection; one eye if stereo is on) on a white background. So the result is the same whatever size the browser window is, whatever its pixel density, and whether or not it's full screen. When the requested size has the same shape as the screen's 3D view, the framing matches what's on screen (and `state.camera.visible`). For another shape, the shorter side keeps the screen's scale around the same look-at point.

### Capture

```json
{ "t": "cmd", "op": "capture", "args": { "mode": "sheet", "count": 12, "id": "review-1" } }
```

- `mode: 'still'` captures the current view. `'frames'` renders the animation at the times in `at`, or `count` evenly spaced times. `'sheet'` puts those frames in one grid PNG with `#n  t = 1.25 s` printed in each cell. It's the easiest way for a reviewer, human or AI, to see a whole animation at once.
- `width` and `height` (default 640 × 400, or 320 × 200 per cell for a sheet), `format` (`'png'` or `'jpeg'`) and `quality` (0.1–1).
- Captures never disturb the live view. Each frame is posed, drawn and read, and the live pose and camera are put back, all before the screen next updates.
- The reply is `{"t":"capture","id":"review-1","mode":"sheet","images":["data:image/png;base64,…"],"times":[…]}`.

**Saved animation files.** An animation file is the `animate` command saved as JSON, usually as a list with one command: `[{"op":"animate","args":{…}}]`. A single `{"op":"animate","args":{…}}`, a full `{"t":"cmd",…}` message, or the bare `args` object also work. Put the layout in `args.base` so the file plays on its own. **▶ Import animation** in Arrange boxes (and *Import an animation from this device* on a remote) reads these. `BoxsmithAnim.parseAnimationFile(text)` in `remote-anim.js` returns `{args}` or `{error}`.

**Zip libraries.** Import animation also takes a `.zip`. Every animation file in it becomes a library entry, and its name comes from the file name: a prefix all the files share and a trailing `-anim` are dropped, so `boxbot-heart-climb-anim.json` becomes *Heart climb*, or `args.name` sets it directly. A video with the same base name (`boxbot-heart-climb.mp4`) becomes that entry's 🎬 button, and layout files become designs. Remotes see the library in the state (`library: {title, current, animations:[{index, name, duration, boxes}], designs:[{index, name, boxes}]}`, where `current` is like `"animation:2"`), or ask for it with `{"op":"library","args":{}}`. Play an entry with `{"op":"libraryPlay","args":{"name":"Tower crash"}}` or by `index`. Names match whatever the case, spaces, dashes or underscores, so `"tower-crash"` works too, and a name that isn't there gets a note listing the ones that are. This is the way to play big animations: the 10–15 MB file never crosses the relay, and the model screen starts it in a few seconds. To record one, load it with `"autoplay": false`, then send `export`. `{"op":"libraryLoadDesign","args":{"name":"Heart"}}` opens a design. The older `{"op":"library","args":{"kind":"animation","index":0}}` still works. `BoxsmithAnim.readZip` and `buildLibrary` in `remote-anim.js` do the reading.

**Big messages and the relay's limits.** The relay passes on messages up to 32 MiB. A bigger one is refused, and the sender gets `{"t":"error","code":"too_large","limit":33554432,"size":N}` back, so nothing vanishes silently. Sending more than 60 messages a second gets `{"t":"error","code":"rate_limited"}`; use `batch`. Anything can also be sent in `chunk` pieces, which is how Boxsmith sends everything over 7.5 MiB: `{"t":"chunk","id":"reel-v2","part":1,"of":4,"data":"…"}`, where `data` is the next slice of the whole message's JSON text, about 4 MiB per piece is a good size, and the receiver joins the pieces in `part` order and handles the result like any message. The relay's README has the full protocol with a Python example. For an animation in an open zip library, `libraryPlay` avoids sending it at all.

**Long, big replies over the relay.** Boxsmith sends anything over 1 MiB to the relay in 1 MiB `chunk` pieces, a few at a time as the connection drains, so a slow upload never blocks the link (state and progress messages slip in between), and the relay counts arriving bytes as a sign the screen is alive. While an export or capture is rendered and sent, remotes get progress: `{"t":"progress","id":"v3","of":"export","phase":"rendering","percent":45}`, then `{"t":"progress","id":"v3","of":"export","phase":"sending","percent":30,"bytes":…,"total":…}`. A message cut up like this carries a `wid`; when a whole one has arrived, the receiver answers `{"t":"got","wid":"…"}` (Boxsmith's own pages do this automatically; a script should too). If the connection drops mid-reply, the relay keeps the room, remotes get `{"t":"hostgone"}` and then `{"t":"hostback"}` when the model screen reconnects, and the model screen sends again anything not confirmed with `got` in the last 5 minutes. Pieces carry the same ids as before, so repeats can be ignored. If an export itself fails, a `note` says why. A remote that never sends `got` may receive a reply twice after a reconnect; keep the first per `wid`.

**Big replies.** Messages over about 7.5 MB are split. A capture with many images arrives as several `capture` messages with `part` and `of`. Anything still too big, such as a long recording, arrives as `{"t":"chunk","id","part","of","data"}` pieces: join the `data` strings in `part` order and parse the result. `BoxsmithAnim.joinParts` in `remote-anim.js` does it for you. The same splitting works in the other direction for large `open`, `add` or `animate` messages.

## Tests

`npm install` then `npm test` runs `test/api.test.js` against the real page. It checks that every control on the page is an API setting, every box type builds, 100 boxes nest across sheets, and the layout, mosaic, library, preview and render calls work. The render tests need Chrome and skip themselves if it is missing.
