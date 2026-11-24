# Boxsmith box type files

A box type file is a JSON file that describes a new style of laser-cut box: which flat parts it is made of, how big each one is, where it sits in 3D, and which edges join with fingers. There is no code in it, only numbers and short formulas, so a type file from anyone (or from an AI) is safe to open.

Boxsmith checks a type file in three steps. It reads the format, builds the parts with the current settings, and then tests in 3D that every finger has a partner and that no two parts run into each other. Each problem comes back as a plain sentence with the place in the file it came from, ready to fix or to paste back to an AI.

This page is the whole format. It is written so that it can be given to an AI as is, together with a description of the box you want.

- JSON Schema: [`boxsmith-type.schema.json`](boxsmith-type.schema.json)
- Examples: [`types/`](types/) has the built-in Closed box, Open tray and Cube frame written as type files. They make exactly the same cut sheets as the built-in styles (a test checks this).
- Shared types: [markplaga/markplaga-boxsmith-type](https://github.com/markplaga/markplaga-boxsmith-type)

## A first example

A closed box is one `box` part. Boxsmith works out the fingers, the corners, the kerf and the screw holes the same way as for its own styles.

```json
{
  "format": "boxsmith-type",
  "version": 1,
  "id": "plain-box",
  "name": "Plain box",
  "description": "All six sides",
  "inside": { "W": "2*t", "D": "2*t", "H": "2*t" },
  "parts": [
    { "box": { "size": ["W", "D", "H"], "text": { "on": "top", "rot": 180 } } }
  ],
  "info": { "inner": { "W": "W-2*t", "D": "D-2*t", "H": "H-2*t" } },
  "notes": ["Glue the four walls onto the bottom, then press the top on."]
}
```

## Coordinates and units

- Everything is in millimeters. Angles in formulas are in radians (`rad(90)` turns degrees into radians).
- `X` runs left to right (the width `W`), `Y` runs front to back (the depth `D`), and `Z` runs up (the height `H`). The box sits on the ground at `z = 0`, with its front-left-bottom corner at `[0, 0, 0]`.
- Each flat part is drawn on the cut sheet with `x` to the right and `y` **down**, starting at its top-left corner `[0, 0]`.
- A part's edges are always listed in the order they appear on the cut sheet: **top** (from `[0,0]` to `[w,0]`), **right**, **bottom**, **left**.

## The file

| Key | Required | What it is |
| --- | --- | --- |
| `format` | yes | Always `"boxsmith-type"`. |
| `version` | yes | Always `1`. |
| `id` | yes | 2 to 40 characters: lower-case letters, digits and dashes, starting with a letter (`"tray-with-lip"`). It can't be the id of a built-in style (`closed`, `open`, `cubeframe`, …). |
| `name` | yes | Up to 40 characters. Shown in the style list, on cut sheets and on the assembly card. |
| `description` | no | Up to 80 characters. |
| `icon`, `author`, `typeVersion`, `license` | no | Text. `icon` can be a built-in style id to borrow its picture. |
| `inside` | no | What to add to the size when the user types inside measurements: `{"W": "2*t", "D": "2*t", "H": "t"}`. Leave it out (or `false`) if inside sizes don't apply. |
| `screws` | no | `false` turns off screw joints (T-slots) for this type. |
| `params` | no | The type's own settings (see below). |
| `let` | no | Named values worked out once, in order: `{"rx": "min(14, W*0.12)"}`. Later ones can use earlier ones. |
| `warnings` | no | Messages shown above the cut sheet. Each is text, or `{"when": formula, "text": "…"}`. |
| `parts` | yes | The parts (see below). |
| `info` | no | Sizes shown in the summary: `{"inner": {"W":…, "D":…, "H":…}}` and/or `{"hole": {…}}`, each with an optional `"label"`. |
| `notes` | no | Assembly steps for the assembly card. Each is text, or `{"when": formula, "text": "…"}`. |

Any other key is an error, so a typo doesn't go unnoticed.

## Names you can use in formulas

| Name | Meaning |
| --- | --- |
| `W`, `D`, `H` | Outside width, depth and height (inside sizes plus `inside` when the user picks inside measurements). |
| `t` | Material thickness. |
| `fw` | Finger width. |
| `clr` | Clearance for parts that slide or slot together. |
| `inside` | `true` when the user typed inside measurements. |
| `text` | The text the user wants on the box (`""` if none). |
| `tslot` | The screw size (`"off"`, `"M2.5"`, `"M3"`, `"M4"`). |
| `corners` | The corner style (`"classic"`, `"edge"`, `"pinwheel"`). |
| `tAcr` | Acrylic thickness, for parts with `"material": "acrylic"`. |
| `PI`, `X`, `Y`, `Z` | π, and the three axes as lists (`X` is `[1, 0, 0]`). |

Plus every `param`, every `let`, and the names a part's `for` and `let` add.

## Formulas

A formula is a string such as `"W - 2*t"` or `"notch ? 20 : 0"`. A plain number works anywhere a formula does.

- Numbers, `true`, `false`, text in quotes (`'f'` or `"f"`), and lists `[a, b, c]`. `xs[0]` takes an item from a list (counting from 0).
- `+ - * / %`, comparisons `< <= > >= == !=`, `&&`, `||`, `!`, and `a ? b : c`.
- `+ - * /` also work on lists, item by item: `[1, 2] + [10, 20]` is `[11, 22]`, and `2 * X` is `[2, 0, 0]`. `+` joins text.
- Functions:
  - numbers: `min`, `max`, `abs`, `round(x, places)`, `floor`, `ceil`, `sqrt`, `pow`, `hypot`, `clamp(x, lo, hi)`;
  - angles: `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2(y, x)`, `rad(deg)`, `deg(rad)`;
  - lists: `count(xs)`, `sum(xs)`, `range(n)` or `range(a, b, step)`, `concat(a, b, …)`, `pick(xs, i)`;
  - 3D: `axis(i)` (0 → `X`, 1 → `Y`, 2 → `Z`), `vec(x, y, z)`;
  - shapes (lists of `[x, y]` points): `rect(x, y, w, h)`, `slot(cx, cy, w, h)` (rounded ends), `arc(cx, cy, rx, ry, a0, a1, n)` (`n` segments of an ellipse from angle `a0` to `a1`), `move(points, dx, dy)`;
  - Boxsmith: `fingers(w, h, [top, right, bottom, left])` (a finger-jointed rectangle, as points), `handleHoles(d, h)` (the hand-hold cutouts Boxsmith puts in tray ends), `fmt(x)` (a size written in the user's unit, for warnings and notes), `str(x)`.
- A misspelled name is reported with a suggestion: `there is nothing called "Wd" (did you mean "W"?)`.

**Text with formulas.** Part names, prefixes, warnings and notes can hold formulas in braces: `"Strip {k}"`. `{#k}` counts: it is 1 the first time a part name uses that value of `k`, 2 the second time, and so on, which numbers repeated parts (`"Strip {k}{#k}"` → `Strip A1`, `Strip A2`, …).

## Parameters

Each entry in `params` is one setting the user can change.

```json
{ "key": "lip", "label": "Lip height", "kind": "length", "default": 8, "min": 2, "max": 40, "step": 0.5,
  "help": "How far the lip stands above the walls.", "showIf": "hasLip" }
```

| Field | What it is |
| --- | --- |
| `key` | The name used in formulas. Letters, digits and `_`. Not `W`, `D`, `H` or `t`. |
| `label` | The text the user sees. |
| `kind` | `length` (mm, shown in the user's unit), `number`, `integer`, `bool`, `choice`, `text` or `color` (`"#rrggbb"`). |
| `default` | The starting value. It must suit the kind, and lie inside `min`/`max` or be one of the `choices`. |
| `min`, `max`, `step` | Number kinds only. |
| `choices` | `choice` only: a list of text, or of `{"value": "…", "label": "…"}`. |
| `showIf` | A formula; the control is hidden when it is false. |
| `help` | A longer explanation. |

A param can reuse a standard Boxsmith setting by giving its key and a matching kind: `handles`, `handleH`, `notch`, `notchH`, `cols`, `rows`, `divPct`, `beamW`, `frameW`, `lip`, `lidH` and the others listed in `Boxsmith.boxes.defaults()`. Its value then comes from that setting, so it is saved and shared like any other. A new key is stored in `typeParams` (see the API below).

## Parts

Each entry in `parts` holds exactly one of `box`, `panel` or `dividers`. It can also have:

- `"when": formula`: the part is only made when this is true.
- `"for": {"name": list, …}`: the part is made once for each value (for several names, once for each combination, the first name changing slowest). A list can be written out (`[0, 1, 2]`) or come from a formula (`"range(cols)"`). At most 2000 parts.
- `"let": {…}`: names worked out for each copy, after `for` and before `when`.

### `box`: a finger-jointed box

Up to six panels that already join each other correctly, including the corner style the user picked and screw joints.

| Field | What it is |
| --- | --- |
| `size` | `[w, d, h]`, default `["W", "D", "H"]`. |
| `at` | Where its front-left-bottom corner goes, default `[0, 0, 0]`. |
| `faces` | Which panels to make, from `bottom`, `top`, `front`, `back`, `left`, `right` (default all six). An edge whose neighbor is missing is left plain. |
| `prefix` | Text put before each panel name (`"Outer "` → `Outer Front`). |
| `holes` | Cutouts per face: `{"front": [holes], "left": "formula"}` (see Holes). |
| `topEdges` | A different top edge for a wall: `{"front": edge}`. The edge is `"e"`, `"f"`, `"F"`, or points (see Edges). |
| `text` | Where the user's text goes: `{"on": face, "rot": 0 or 180, "x": formula, "y": formula}`. |

Each face has its own `x`/`y` for holes and text:

- `front`, `back`: `w × h`. `x` runs along `X`, `y` runs down from the top of the wall.
- `left`, `right`: `d × h`. `x` runs along `Y` (front to back), `y` runs down from the top.
- `bottom`, `top`: `w × d`. `x` runs along `X`, `y` runs along `Y` (front to back).

The walls stand on the bottom and the top sits on the walls, so the inside of a `box` with size `[W, D, H]` is `W - 2t` by `D - 2t` by `H - 2t`.

### `panel`: one flat part

| Field | What it is |
| --- | --- |
| `name` | Printed on the cut sheet. Text with formulas, like `"Shelf {i+1}"`. |
| `size` + `edges` | A rectangle `[w, h]` with four edges `[top, right, bottom, left]` (default all `"e"`). |
| `outline` | Or any shape: a list of at least 3 `[x, y]` points, or a formula that gives one. |
| `at` | Where the panel's corner `[0, 0]` goes in 3D, on the face where its thickness starts (the thickness then grows along `n`). Default `[0, 0, 0]`. |
| `u`, `v`, `n` | Which way the panel's `x`, its `y` and its thickness point in 3D. Each is `X`, `-X`, `Y`, `-Y`, `Z`, `-Z`, or a formula giving a unit-long list. They must be at right angles to each other. Default `X`, `Y`, `Z` (lying flat). |
| `holes` | Cutouts (see Holes). |
| `material` | `"wood"` (the default) or `"acrylic"`, which uses the acrylic thickness and its own sheet. |
| `role` | Optional: `"wall"`, `"plate"`, `"lid"`, … for decorations that look for a kind of panel. |
| `text` | Put the user's text on this panel: `{"rot": 0 or 180, "x": formula, "y": formula}` (default the middle). |

A point on the panel at `x`, `y`, at depth `h` into its thickness, ends up at `at + u·x + v·y + n·h`. So:

- lying flat (a bottom or a shelf): `"u": "X", "v": "Y", "n": "Z"`, with `at` at its front-left corner and lowest face;
- standing upright facing the front, with its top edge up: `"u": "X", "v": "-Z", "n": "Y"`, with `at` at its top-left corner;
- standing upright facing the side, top edge up: `"u": "Y", "v": "-Z", "n": "X"`.

### `dividers`: an egg-crate grid

Slotted dividers that fit inside a space, the same as the built-in Dividers option.

| Field | What it is |
| --- | --- |
| `at` | The front-left-bottom corner of the space they fill. |
| `size` | The space: `[w, d, h]`. |
| `cols`, `rows` | How many compartments across and front to back (default 1). |
| `height` | Divider height as a percentage of `h` (default 100). |
| `prefix` | Text before each divider name. |

## Edges

| Edge | What it is |
| --- | --- |
| `"e"` | Plain, straight. |
| `"f"` | Fingers. |
| `"F"` | The partner of `"f"`: gaps where `"f"` has fingers, fingers where it has gaps. |
| points | A shaped edge, as `[x, y]` points from the edge's start (`[0, 0]`) to its end (`[length, 0]`), with `y` going **into** the panel. A notch, for example: `"concat([[0,0],[W/2-15,0]], arc(W/2, 0, 15, 12, PI, 0, 16), [[W/2+15,0],[W,0]])"`. |

Where two panels meet, one edge must be `"f"` and the other `"F"`, and the panels must overlap by one thickness along that edge (each panel's size reaches the outside of the box). Boxsmith spaces the fingers from the finger width `fw` and adds kerf to every edge, so you never place fingers yourself. (These are the edge letters of Boxes.py: `e`, `f`, `F`.)

## Holes

A list of cutouts, or one formula that gives a shape or a list of shapes. Each cutout is one of:

| Hole | What it is |
| --- | --- |
| `{"rect": [x, y, w, h]}` | A rectangle. |
| `{"circle": [cx, cy, r]}` | A circle. |
| `{"slot": [cx, cy, w, h]}` | A slot with rounded ends, centered on `cx`, `cy`. |
| `{"polygon": [[x, y], …]}` | Any shape, or a formula. |
| `{"fingers": {"size": [w, h], "edges": [top, right, bottom, left], "at": [x, y]}}` | A finger-jointed opening, for a panel that passes through or frames into this one. |
| `"formula"` | Gives one shape, a list of shapes, or `[]` for none (`"handles ? handleHoles(D, H) : []"`). |

## Checking a type

`Boxsmith.types.check(type, settings)` reports problems in three stages:

1. **format**: a wrong key, a missing field, a formula that can't be read.
2. **build**: a formula that fails with these settings (a name that doesn't exist, a size that works out to 0, axes that aren't at right angles).
3. **fit**: the parts are built and tested in 3D. Along every edge:
   - where a part has a finger, no other part may be (two edges both `"f"`, or a part in the wrong place);
   - where a part has a gap one thickness deep, exactly one other part must fill it (an `"f"` edge with nothing to join, or two `"F"` edges meeting).
   It also checks that no two panels overlap through their middles, and warns when a part is bigger than the sheet.

Try a type with a few different settings (small and large, inside measurements, each `param`), since a formula can work for one size and not another.

## Writing a type with an AI

Give the AI this page and describe the box. Paste its JSON into the **Type lab** (at the end of the Box style list) and click **Check**; if there are problems, **Copy problems for an AI** and paste them back. From code:

```js
const result = Boxsmith.types.check(JSON.parse(text), { W: 160, D: 100, H: 60 });
if (!result.ok) console.log(Boxsmith.types.explain(result.errors));   // paste these lines back to the AI
```

A good prompt:

```
Here is the Boxsmith box type format (BOX-TYPES.md). Write a type file for: <your box>.
Use "box" parts where you can, and "panel" parts with f/F edges for anything else.
Reply with the JSON only. I will paste back any problems Boxsmith finds.
```

## Sharing types

A type you save in the Type lab is kept in that browser. Settings files and layouts that use it carry the type file with them (under `"types"`), so they open on another computer, which then adds the type to its own My types.

Shared types live in [markplaga/markplaga-boxsmith-type](https://github.com/markplaga/markplaga-boxsmith-type), one file per type. A type's `id` is how Boxsmith tells types apart, so pick one that is unlikely to clash, and raise `typeVersion` when you change a shared type.
