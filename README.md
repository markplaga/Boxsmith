# Boxsmith

A laser-cut box generator that runs entirely in the browser. Open `index.html` — no build step, no server.

## Box styles
Closed box · open tray · lift-off lid · split lid · sliding lid · hinged lid (pin) · drawer cabinet (1–8 drawers) · polygon box · rounded box (living-hinge corners) · pencil box (swivel lid) · card file box · nested set · puzzle box (gravity-pin lock) · book box (living-hinge spine) · display case (acrylic cover, wood base) · frame (torus) · cube frame (open through every side) · kerf test

## Features
- Finger joints with kerf compensation, inside/outside dimensions, mm or inches
- Corner construction: front & back, pinwheel, or diagonal pinwheel
- Fit presets, captive-nut T-slot screw joints (M2.5/M3/M4), CNC dogbones
- Egg-crate dividers, hand holds, finger notch
- Multi-line text (raster fill, vector outline or cut-through) with alignment, converted to outlines
- PNG / JPG / SVG artwork on any panel, cut-out patterns, corner accents, rounded or chamfered lid corners
- 3D preview (three.js) with explode, “show it work” animations, screws and nuts, tap-to-select
- Paint finish: preview a watercolor wash or acrylic paint color on any box
- Arrange intact box designs side by side, inside other boxes or in a Frame opening, with snap-to-face, drag to move, step-by-size, duplicate in place, per-box materials, part and acrylic coloring, overlap warnings, and save and open for layout files
- Two-screen editing: pair a second screen (such as an iPad) with a code and edit placement, color, every box setting and the layout from it. Scripts and AI helpers can use the same link to send whole animations, play them, and get back pictures, contact sheets and WebM/GIF recordings. Same-computer windows connect directly; other devices use the small relay in `relay/` (a Hugging Face Docker Space)
- Picture mosaic: upload a picture and Boxsmith picks the paint colours and builds a layout of boxes (optional relief and frame)
- Sheet nesting with hole filling and grain lock, batch quantity, kit-mode hold tabs
- SVG and DXF export (simple or LightBurn-ordered layers), printable assembly card
- Cost estimate, saved materials and recipes (stored in the browser)
- Built-in Help tab; standalone guide in `help.html`

## JavaScript API

Everything the page does can be scripted: cut sheets, SVG and DXF, parts, costs and assembly cards, arranging and snapping whole boxes, saved materials and recipes, picture mosaics, rendering layouts to PNG and the 3D preview. Use it in the browser console, or in Node.js with `npm install jsdom @napi-rs/canvas` and `require('./boxsmith-node.js')`. `npm test` checks that every control on the page is reachable from the API. [API reference and examples](API.md)

## Files
- `index.html` — page and styles
- `app.js` — box geometry, layout, export, UI
- `boxsmith-api.js` — box catalog and portable assembly files
- `boxsmith-engine.js` — adds cut sheets, costs, layout measuring and snapping, mosaic, library and preview control to the API
- `boxsmith-node.js` — runs the whole page headlessly so Node.js gets the complete API (pictures also need `playwright-core` and Chrome)
- `test/` — API tests (`npm test`)
- `box-layout.js` — placement and browser storage for whole boxes
- `mosaic-core.js` — picture-to-mosaic algorithm (colour picking, dithering, layout); also usable from Node
- `mosaic.js` — the Picture mosaic controls
- `tools.js` — tracing, text outlines, artwork, dogbones, patterns, nesting, accents
- `help.html` — standalone help guide
- `three.min.js` — three.js r128 (MIT)
