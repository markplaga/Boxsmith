# Boxsmith

A laser-cut box generator that runs entirely in the browser. Open `index.html` — no build step, no server.

## Box styles
Closed box · open tray · lift-off lid · split lid · sliding lid · hinged lid (pin) · drawer cabinet (1–8 drawers) · polygon box · rounded box (living-hinge corners) · pencil box (swivel lid) · card file box · nested set · puzzle box (gravity-pin lock) · book box (living-hinge spine) · display case (acrylic cover, wood base) · kerf test

## Features
- Finger joints with kerf compensation, inside/outside dimensions, mm or inches
- Corner construction: front & back, pinwheel, or diagonal pinwheel
- Fit presets, captive-nut T-slot screw joints (M2.5/M3/M4), CNC dogbones
- Egg-crate dividers, hand holds, finger notch
- Multi-line text (raster fill, vector outline or cut-through) with alignment, converted to outlines
- PNG / JPG / SVG artwork on any panel, cut-out patterns, corner accents, rounded or chamfered lid corners
- 3D preview (three.js) with explode, “show it work” animations, screws and nuts, tap-to-select
- Arrange intact box designs side by side, inside other boxes or in a Frame opening, with save and open for layout files
- Sheet nesting with hole filling and grain lock, batch quantity, kit-mode hold tabs
- SVG and DXF export (simple or LightBurn-ordered layers), printable assembly card
- Cost estimate, saved materials and recipes (stored in the browser)
- Built-in Help tab; standalone guide in `help.html`

## Files
- `index.html` — page and styles
- `app.js` — box geometry, layout, export, UI
- `box-layout.js` — placement and browser storage for whole boxes
- `tools.js` — tracing, text outlines, artwork, dogbones, patterns, nesting, accents
- `help.html` — standalone help guide
- `three.min.js` — three.js r128 (MIT)
