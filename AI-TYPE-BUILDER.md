# Building a Boxsmith type with an AI

Give this page to an AI, together with a description of what you want built (“a robot”, “a tray with a lid that slides”, “a lamp shade”). The AI writes the type file, **connects to Boxsmith and tests the file itself until it passes**, and only then hands it to you, with everything you need to build it.

The Type lab does this for you: under **Have an AI write one**, describe the box and click **Copy AI prompt**. The prompt holds this page, the format, examples and your description. With **Let the AI check on this screen** ticked, it also holds a live connection code for your Boxsmith screen.

The format itself is in [BOX-TYPES.md](BOX-TYPES.md). This page is the working method on top of it.

---

## Instructions for the AI

You are writing a box type file for Boxsmith, a laser-cut box generator. Do not hand the file to the user until Boxsmith has checked it and it passes. Follow these steps in order.

### 1. Get the format

It is included below this page when the prompt came from the Type lab. Otherwise read [BOX-TYPES.md](https://github.com/markplaga/Boxsmith/blob/main/BOX-TYPES.md), or, if you are connected through the Remote (step 2, way B), send `{"t":"cmd","op":"typeFormat","args":{"examples":true}}`: it returns the format, the JSON Schema, the setting keys a param can reuse, and example type files.

### 2. Connect to Boxsmith

Use the first of these you can. Each one runs Boxsmith's own checker, the same one the Type lab uses.

**A. A browser tool (best).** Open `https://markplaga.github.io/Boxsmith/` and run JavaScript in the page. `Boxsmith.types.check(type, settings)` checks a type file and builds it in 3D. Nothing is saved.

**B. The Remote (a WebSocket).** If the prompt gives a Remote code, the user's Boxsmith screen is already waiting for you. (Otherwise ask the user to open Boxsmith, go to **Arrange boxes → 📱 Remote → Show a code here**, and tell you the 6-digit code.)

1. Open a WebSocket to `wss://marktheartist-boxsmith-relay.hf.space/ws` (it can take a few seconds to wake up).
2. Send `{"t":"join","room":"<code>","role":"remote"}`. The relay answers `{"t":"joined",…}`. Then send `{"t":"hello"}`; the screen answers with `{"t":"state",…}`.
3. Send each check as `{"t":"cmd","op":"typeCheck","args":{"type":<file>,"settings":<settings>,"tag":"run-7"}}`. The reply is `{"t":"typeCheck","tag":"run-7","ok":…,"stage":…,"errors":[…],"warnings":[…],"parts":…,"text":"…","settings":{…}}`; `text` is the problems as plain lines, and `tag` comes back so you can match replies to runs.
4. To run many at once, send `{"t":"cmd","op":"batch","args":{"cmds":[{"op":"typeCheck","args":{…}}, …]}}` (up to 500 commands; 100 at a time is plenty). Each check gets its own reply, then one `state` follows the batch. Problems with a command itself (a missing `type`, say) come back as `{"t":"note","text":"…"}`.
5. A big reply (`typeFormat`) arrives in pieces: `{"t":"chunk","id":…,"part":1,"of":3,"data":"…"}`. Join the `data` of every piece with the same `id` in `part` order and `JSON.parse` the result.
6. Ignore messages you don't need (`state`, `peers`, `got`). The relay allows about 60 messages a second; a `batch` counts as one. Full protocol: *Remote control* in [API.md](https://github.com/markplaga/Boxsmith/blob/main/API.md).

**C. Node.** If you can run code with internet access:

```
git clone https://github.com/markplaga/Boxsmith && cd Boxsmith && npm install jsdom @napi-rs/canvas
```

```js
const { load } = require('./boxsmith-node.js');
const Boxsmith = await load({ dir: '.' });
// Boxsmith.types.check(type, settings) works the same as in the browser; Boxsmith.close() when done
```

**D. No tools.** Tell the user plainly that the file has **not** been checked. Ask them to paste it into the Type lab, click **Check**, then **Copy problems for an AI**, and paste the problems back to you.

### 3. Test at many settings, not just one

A formula can work at one size and fail at another. Run this self-test (way A or C as is; for way B, build the same list of settings and send them as `typeCheck` commands in a `batch`, with a `tag` for each). It tries 10 sizes and setups, each with every param at its default, its min, its max, and every choice. A check takes about 10–60 ms.

```js
function selfTest(type) {
  const std = new Set(Object.keys(Boxsmith.boxes.defaults()));
  const sizes = [{}, {W:60,D:40,H:40}, {W:160,D:100,H:200}, {W:300,D:180,H:400},
    {W:120,D:80,H:180,dimMode:'inside'}, {W:200,D:120,H:300,t:6,fw:12},
    {W:200,D:120,H:300,corners:'edge'}, {W:200,D:120,H:300,corners:'pinwheel'},
    {W:200,D:120,H:300,tslot:'M3',t:6}, {W:150,D:100,H:250,text:'Hi'}];
  const variants = [{}];
  for (const p of type.params || []) {
    const vals = p.kind === 'bool' ? [!p.default]
      : p.kind === 'choice' ? p.choices.map(c => typeof c === 'object' ? c.value : c).filter(v => v !== p.default)
      : ['number','integer','length'].includes(p.kind) ? [p.min, p.max].filter(v => v !== undefined && v !== p.default) : [];
    for (const v of vals) variants.push({ [p.key]: v });
  }
  const failures = []; let runs = 0;
  for (const s of sizes) for (const v of variants) {
    const settings = { ...s, typeParams: { [type.id]: {} } };
    for (const [k, val] of Object.entries(v)) (std.has(k) ? settings : settings.typeParams[type.id])[k] = val;
    runs++;
    let r; try { r = Boxsmith.types.check(type, settings); } catch (e) { failures.push({ settings, error: e.message }); continue; }
    if (!r.ok) failures.push({ settings, stage: r.stage, problems: Boxsmith.types.explain(r.errors).split('\n').slice(0, 8) });
  }
  const d = Boxsmith.types.check(type, {});
  return { runs, passed: runs - failures.length, failures: failures.slice(0, 10),
           defaultWarnings: (d.warnings || []).map(w => w.message), notes: d.notes };
}
```

Things that trip people up:

- A type's own settings go in `typeParams`, **keyed by the type id**: `{ W: 200, typeParams: { 'my-type': { knob: true } } }`. Putting `knob: true` at the top level throws “Unknown box parameter”.
- A param whose key is a standard Boxsmith setting (`handles`, `cols`, `lip`, …) goes at the top level, not in `typeParams`. The self-test handles this.
- `check()` returns `parts` as a number (how many parts), not a list.
- `{}` means Boxsmith's defaults (120 × 90 × 70 mm outside, 3 mm material), not what is on the user's screen. The prompt from the Type lab says what size the user is working at; test that too.

Also try a few combinations a user is likely to pick together (all the big settings at once, all the small ones), and any pose or angle settings at their extremes.

### 4. Fix and repeat

Each problem names a part and an edge (“"Torso Bottom", top edge … it runs into "Torso Front"”). Fix the cause, not the one size that failed, and run the whole self-test again. Repeat until every run passes and the default settings give no warnings.

### 5. Hand it over

Only now reply to the user, with:

1. **The type file**, complete, in one ```json block.
2. **The test result** in one line: how many runs passed and which way you connected (A, B or C). If you could only use way D, say clearly that it is untested.
3. **A build guide**:
   - what each setting does, with its default;
   - anything to buy or cut besides the sheet (dowels, bolts, magnets, acrylic), with sizes, written as `notes` in the file so they follow the settings;
   - the assembly order, also in `notes`;
   - anything that can still go wrong at certain settings, and which setting avoids it.
4. If you are connected by the Remote and the user wants it, send `{"t":"cmd","op":"typeAdd","args":{"type":<file>,"use":true}}` so the new style is ready in their style list.

When the user asks for a change, change the file, run the whole self-test again, and hand over the whole new file. Raise `typeVersion` each time (Boxsmith uses it to offer an Update for shared types).

---

## Design rules

- **Keep every box at least about 5 thicknesses (`5*t`) in every direction.** A box under 2 thicknesses has its top and bottom panels running into each other. Use `max(…, 5*t)` in `let`. Small decorative boxes (eyes, knobs) can go down to `3*t`.
- **Make sizes percentages of W, D and H** (params like “Head width (% of W)”), so the design keeps its proportions at any size. Choose defaults that add up to 100% of each dimension, and add a `warning` that gives the real size when the user's percentages don't add up.
- **Let small sizes grow instead of fail.** When the user's size is too small, clamp the parts to their minimum and warn with the real size, rather than producing broken parts.
- **Keep holes clear of the finger joints.** Keep a hole's edge at least `2*t` from any panel edge. A hole for a pivot needs the part around it to be at least `2 * (2*t + radius + 1)` across.
- **Parts that move need clearance.** A part that turns on a pivot needs a gap of at least `t + clr` from its neighbor, and room for its corners to sweep: a corner a distance `a` below the pivot and `d/2` to the side sweeps a radius of `hypot(d/2, a)`.
- **A `box` part can't be turned.** To pose a part at an angle, build it from six `panel` parts turned around the pivot with `u`, `v` and `n` formulas, using these edges. Bottom and top: all `"f"`. Front and back: `["F","f","F","f"]`. Left and right sides: all `"F"`. Boxsmith checks turned panels in 3D like any other.
- **Use rectangles for small spacers and washers.** Round `outline` panels with a hole in the middle are sometimes misread as finger joints by the checker. Square ones always pass.
- **Hinges and pivots:** make them from holes plus a `dowel` part through them, with its `diameter` tied to the hole size (`"holeD - 0.1"`). The dowel is drawn in 3D, listed under To buy, and checked: it must pass through a hole with room for it in every part it crosses. For a bolt instead of a dowel, list it in `notes` using `fmt()` so it follows the settings.
