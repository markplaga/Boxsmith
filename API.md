# Boxsmith JavaScript API

[Download the illustrated step-by-step guide (PDF)](docs/boxsmith-api-guide.pdf)

Use `require('./boxsmith-api.js')` in Node.js, or use `window.Boxsmith` on the Boxsmith page. The API runs locally. The example below creates a file that opens in **Arrange boxes**.

## Create a Frame with three boxes inside it

Save this script next to `boxsmith-api.js` and run it with Node.js.

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

Open `frame-and-boxes.json` with **Open layout** in Boxsmith. You can also open a file saved by Boxsmith in code with `assemblies.parse(fs.readFileSync('frame-and-boxes.json', 'utf8'))`.

## Specify a box

| Method | Result |
| --- | --- |
| `boxes.list()` | Every generator type, including its `id` and display name. |
| `boxes.defaults(type = 'closed')` | A settings object containing all parameter keys and their defaults. |
| `boxes.create(type, parameters = {})` | A new settings object with your overrides. It rejects unknown types, unknown keys and values of the wrong type. |

`W`, `D` and `H` are width, depth and height. Common parameters include `t` for material thickness, `fw` for finger width, `kerf`, and `dimMode` with values `'inside'` and `'outside'`. Style-specific examples include `frameW` for Frame ring width, `drawers` for drawer count, and `sides` for polygon sides. All dimensions are in millimeters. `unit` selects the display unit. For a decorated design, a Settings JSON file exported from Boxsmith shows the corresponding settings and nested artwork records.

## Build and save an assembly

| Method | Result |
| --- | --- |
| `assemblies.place(settings, options = {})` | A copy of a box design with its own position, rotation and visibility. |
| `assemblies.create({ boxes, unit })` | A versioned assembly from an array of placements. `unit` defaults to `'mm'`. |
| `assemblies.serialize(assembly)` | The JSON text that Boxsmith can reopen. |
| `assemblies.parse(jsonOrObject)` | Validates the layout format and returns a copy of the assembly. |

Placement options are `position: [x, y, z]` in millimeters, `rotation: [x, y, z]` in degrees, and `hidden`, which defaults to `false`. Position and rotation default to `[0, 0, 0]`. X and Y locate the box center. Z sets the height of the lowest point after rotation. The API accepts placements explicitly. Check physical clearance in your arrangement before cutting.

## Work with an open Boxsmith page

The full Boxsmith page adds these methods. For example, run `Boxsmith.browser.showBox(Boxsmith.boxes.create('open', { W: 100 }))` in the browser console to open a tray design in **3D preview**.

| Method | Effect |
| --- | --- |
| `Boxsmith.browser.showBox(settings)` | Applies the settings to the single-box editor and opens 3D preview. |
| `Boxsmith.browser.openAssembly(jsonOrObject)` | Opens the assembly in **Arrange boxes** and makes it the active layout. |
| `Boxsmith.browser.getAssembly()` | Returns a copy of the current assembly. |
| `Boxsmith.browser.saveAssembly(assembly, filename)` | Downloads the given assembly. Both arguments are optional and default to the current layout and `boxsmith-layout.json`. |
