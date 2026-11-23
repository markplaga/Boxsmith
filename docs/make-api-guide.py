"""Build docs/boxsmith-api-guide.pdf, the illustrated step-by-step API guide.

    pip install reportlab pillow
    python3 docs/make-api-guide.py [screenshot folder]

Screenshots (PNG) are read from the folder given (default docs/guide-images):
  01-tray.png   the page after step 03 (open tray in 3D preview)
  03-top.png    Arrange boxes, Top view of the Frame with three boxes
  04-tilt.png   the same layout with the middle box moved and tilted
  07-color.png  assemblies.render of the copy / step / colour example
Missing images are left out. Fonts: DejaVu Sans, Sans Bold and Sans Mono.
"""
import os, sys
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table, TableStyle,
                                Image, PageBreak, Flowable, KeepTogether, Preformatted)

HERE = os.path.dirname(os.path.abspath(__file__))
IMG = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'guide-images')
OUT = os.path.join(HERE, 'boxsmith-api-guide.pdf')
SITE = 'https://markplaga.github.io/Boxsmith/'
REPO = 'https://github.com/markplaga/Boxsmith'
APIREF = REPO + '/blob/main/API.md'

FONT_DIR = '/usr/share/fonts/truetype/dejavu'
pdfmetrics.registerFont(TTFont('Sans', os.path.join(FONT_DIR, 'DejaVuSans.ttf')))
pdfmetrics.registerFont(TTFont('SansB', os.path.join(FONT_DIR, 'DejaVuSans-Bold.ttf')))
pdfmetrics.registerFont(TTFont('Mono', os.path.join(FONT_DIR, 'DejaVuSansMono.ttf')))
pdfmetrics.registerFontFamily('Sans', normal='Sans', bold='SansB', italic='Sans', boldItalic='SansB')

ACCENT = colors.HexColor('#b8401c')
INK = colors.HexColor('#1f1d1a')
MUTED = colors.HexColor('#6f675d')
CODEBG = colors.HexColor('#f3eee6')
RULE = colors.HexColor('#d9d0c3')

body = ParagraphStyle('body', fontName='Sans', fontSize=9.2, leading=13.4, textColor=INK, spaceAfter=6)
h1 = ParagraphStyle('h1', fontName='SansB', fontSize=24, leading=29, textColor=INK, spaceAfter=4)
sub = ParagraphStyle('sub', parent=body, textColor=MUTED, fontSize=9.6, spaceAfter=0)
h3 = ParagraphStyle('h3', fontName='SansB', fontSize=9.6, leading=13, textColor=INK, spaceBefore=6, spaceAfter=5)
small = ParagraphStyle('small', parent=body, fontSize=8.4, leading=11.6, spaceAfter=4)
cap = ParagraphStyle('cap', parent=body, fontSize=8.2, leading=11, textColor=MUTED)
cell = ParagraphStyle('cell', parent=body, fontSize=8.6, leading=11.6, spaceAfter=0)
cellk = ParagraphStyle('cellk', parent=cell, fontName='Mono', fontSize=8.2)
code = ParagraphStyle('code', fontName='Mono', fontSize=7.9, leading=11, textColor=INK)

W, H = letter
M = 0.62 * inch
CW = W - 2 * M


def c(t):  # inline code
    return '<font face="Mono" size="8.4">' + t + '</font>'


def a(text, url):
    return '<a href="%s" color="#b8401c"><u>%s</u></a>' % (url, text)


class Section(Flowable):
    """Invisible marker: sets the running header for the page it lands on."""
    def __init__(self, name):
        super().__init__(); self.name = name
    def wrap(self, *a): return (0, 0)
    def draw(self): self.canv._section = self.name


class Step(Flowable):
    def __init__(self, num, title):
        super().__init__(); self.num, self.title = num, title
    def wrap(self, aw, ah): return (aw, 24)
    def draw(self):
        cv = self.canv
        cv.setFillColor(ACCENT); cv.roundRect(0, 2, 19, 19, 3, stroke=0, fill=1)
        cv.setFillColor(colors.white); cv.setFont('SansB', 8.2); cv.drawCentredString(9.5, 8.6, self.num)
        cv.setFillColor(INK); cv.setFont('SansB', 11.2); cv.drawString(29, 7.4, self.title)


class Rule(Flowable):
    def wrap(self, aw, ah): self.w = aw; return (aw, 14)
    def draw(self):
        self.canv.setStrokeColor(RULE); self.canv.setLineWidth(0.7); self.canv.line(0, 7, self.w, 7)


def codeblock(src):
    t = Table([[Preformatted(src.strip('\n'), code)]], colWidths=[CW])
    t.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, -1), CODEBG), ('LEFTPADDING', (0, 0), (-1, -1), 10),
                           ('RIGHTPADDING', (0, 0), (-1, -1), 10), ('TOPPADDING', (0, 0), (-1, -1), 8),
                           ('BOTTOMPADDING', (0, 0), (-1, -1), 8)]))
    return [t, Spacer(1, 8)]


def params(rows, first=1.75 * inch, title=None):
    data = [[Paragraph(k, cellk), Paragraph(v, cell)] for k, v in rows]
    t = Table(data, colWidths=[first, CW - first])
    t.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'TOP'), ('LINEBELOW', (0, 0), (-1, -1), 0.5, RULE),
                           ('TOPPADDING', (0, 0), (-1, -1), 4.5), ('BOTTOMPADDING', (0, 0), (-1, -1), 4.5),
                           ('LEFTPADDING', (0, 0), (-1, -1), 2)]))
    out = [Paragraph(title, h3)] if title else []
    return out + [t, Spacer(1, 8)]


def picture(name, caption, max_h=3.0 * inch, max_w=CW):
    path = os.path.join(IMG, name)
    if not os.path.exists(path):
        print('missing image', path); return []
    from PIL import Image as PI
    w, h = PI.open(path).size
    s = min(max_w / w, max_h / h)
    im = Image(path, width=w * s, height=h * s); im.hAlign = 'LEFT'
    return [Spacer(1, 4), im, Spacer(1, 4), Paragraph(caption, cap)]


def page(section, title, subtitle):
    return [Section(section), Paragraph(title, h1), Paragraph(subtitle, sub), Spacer(1, 4), Rule(), Spacer(1, 4)]


def P(t): return Paragraph(t, body)


def step(n, title, *items):
    flow = [Step(n, title)]
    for it in items:
        if isinstance(it, str): flow.append(P(it))
        elif isinstance(it, list): flow.extend(it)
        else: flow.append(it)
    return [KeepTogether(flow), Spacer(1, 4)]


S = []
# ---------------------------------------------------------------- 1
S += page('START IN THE BROWSER', 'Boxsmith API step by step',
          'Create a box, arrange several intact boxes, then save a layout you can open again.')
S += [P('<b>Choose where to start.</b> Use the browser to see your results as you go. For a script that runs from a '
        'terminal and writes files directly, start on page 8. It can also write cut files, measure layouts, draw '
        'pictures and more.')]
S += step('01', 'Open Boxsmith and its JavaScript console',
          'Open Boxsmith in Chrome or Edge on a desktop or laptop. To open the Console, press <b>Ctrl+Shift+J</b> on '
          'Windows or Linux, or <b>Command+Option+J</b> on Mac. You can also open Developer Tools and select '
          '<b>Console</b>. ' + a('Open Boxsmith', SITE))
S += step('02', 'Check that the API is loaded',
          'Type the line below at the console prompt and press Enter. The current version returns a number. Run '
          'each code block on its own unless the guide says otherwise.', codeblock('Boxsmith.version'))
S += step('03', 'Preview your first box',
          'Run this block. Boxsmith opens <b>3D preview</b> with an open tray. The width, depth, and height are 140, 90, '
          'and 42 mm, and the material is 3 mm thick.',
          codeblock("var tray = Boxsmith.boxes.create('open', {\n  W: 140, D: 90, H: 42, t: 3\n});\nBoxsmith.browser.showBox(tray);"))
S += picture('01-tray.png', 'The sidebar shows the open-tray style and the dimensions passed by the code.', 2.75 * inch)
S += [PageBreak()]
# ---------------------------------------------------------------- 2
S += page('DESIGN A BOX', 'Find types and parameters',
          'Use exact parameter keys from the API. JavaScript treats W and w as different keys.')
S += step('04', 'Find a box type ID',
          'Run the following to see all 18 catalog entries. Use the value in the ID column in your code. For example, '
          'Frame (torus) is ' + c("'frame'") + ', Cube frame is ' + c("'cubeframe'") + ' and Closed box is ' + c("'closed'") + '.',
          codeblock('console.table(Boxsmith.boxes.list().map(({ id, name }) => ({ id, name })));'))
S += step('05', 'Look up the defaults',
          'The object below holds every key the page has, with its starting value. Every control in the sidebar is one '
          'of these keys. Some keys apply only to certain styles. Run the two lines separately.',
          codeblock("Boxsmith.boxes.defaults('frame')\nBoxsmith.boxes.defaults('frame').frameW"))
S += params([
    ('W, D, H', 'Width, depth, and height'),
    ('t', 'Material thickness'),
    ('kerf', 'Cut width to compensate for'),
    ('fw', 'Finger width for finger joints'),
    ('dimMode', "Use 'inside' or 'outside' dimensions"),
    ('frameW, beamW', 'Ring width for the Frame style; beam width for the Cube frame'),
    ('drawers, sides', 'Drawer count or number of polygon sides'),
    ('paint, paintColor, paintStrength', "Watercolor or acrylic finish for the preview: 'none', 'watercolor' or 'acrylic'; a color like '#3a7bd5'; strength 10 to 100"),
    ('look, colors', "Optional. The material a box keeps in a layout (one of " + c('Boxsmith.looks') + "), and its colors (page 7)"),
    ('unit', 'Display unit, either mm or in'),
], first=2.05 * inch, title='Common box parameters')
S += [P('Use millimeters in the code. The display can show inches, but the API still expects millimeters for lengths '
        'and coordinates. For a 2-inch width, pass ' + c('W: 2 * 25.4') + '.')]
S += step('06', 'Create a design with only the changes you need',
          codeblock("var cabinet = Boxsmith.boxes.create('drawer', { W: 160, drawers: 3 });"),
          'Every setting you omit keeps its default. Unknown keys and values of the wrong type are rejected with a '
          'clear error. For a customized box with artwork, export a Settings JSON file from the app to see how those '
          'settings are structured. ' + a('API reference', APIREF))
S += [PageBreak()]
# ---------------------------------------------------------------- 3
S += page('BUILD THE ASSEMBLY', 'Place three boxes in a Frame',
          'The placements use one Frame at the origin and three closed boxes along the X axis.')
S += step('07', 'Create and open the layout',
          'If a layout is already open that you want to keep, click <b>Save layout</b> first. Run this entire block in the '
          'Console. The last line makes your new assembly the active layout.',
          codeblock("""var frame = Boxsmith.boxes.create('frame', {
  W: 240, D: 180, H: 50, frameW: 24
});
var closed = Boxsmith.boxes.create('closed', {
  W: 55, D: 45, H: 30
});

var layout = Boxsmith.assemblies.create({
  unit: 'mm',
  boxes: [
    Boxsmith.assemblies.place(frame),
    ...[-60, 0, 60].map(x =>
      Boxsmith.assemblies.place(closed, { position: [x, 0, 0] })
    )
  ]
});

Boxsmith.browser.openAssembly(layout);"""))
S += step('08', 'Check the result in Top view',
          'Open the <b>Arrange boxes</b> tab if needed and click <b>Top view</b>. The first entry is the Frame. The three '
          'closed boxes have X positions of −60, 0, and +60 mm. Their Y and Z positions are all 0.')
S += picture('03-top.png', 'Top view of the four placements. The three closed boxes sit inside the rectangular opening.', 3.1 * inch)
S += [PageBreak()]
# ---------------------------------------------------------------- 4
S += page('EDIT AND SAVE', 'Move, rotate, and reopen',
          'The assembly file includes the designs, placements, rotations, visibility, materials, colors and display units.')
S += step('09', 'Change an existing placement',
          'Get a copy of the active layout, change an entry, and open the edited copy. The array starts at index 0, '
          'so ' + c('boxes[2]') + ' is the middle closed box in this example.',
          codeblock("""var draft = Boxsmith.browser.getAssembly();
draft.boxes[2].position = [0, 15, 0];
draft.boxes[2].rotation = [0, 20, 0];
Boxsmith.browser.openAssembly(draft);"""),
          'Position is [x, y, z] in mm. X and Y locate the box center, and Z sets its lowest height after rotation. '
          'Rotation is [x, y, z] in degrees. Press and drag the preview to inspect the tilt. To hide a box, set its '
          + c('hidden') + ' field to true and open the edited copy. Pages 6 and 7 show shorter helpers that do this without '
          'editing the object by hand.')
S += step('10', 'Download and reopen the layout',
          'Click <b>Save layout</b> to download ' + c('boxsmith-layout.json') + ', or run this block to pick a filename in code.',
          codeblock("""Boxsmith.browser.saveAssembly(
  Boxsmith.browser.getAssembly(),
  'frame-and-boxes.json'
);"""),
          'In <b>Arrange boxes</b>, click <b>Open layout</b> and pick the downloaded file. Boxsmith restores the arrangement '
          'and makes it active. You can also use the main <b>Open…</b> button.')
S += picture('04-tilt.png', 'The middle box has moved along Y and tilted around that axis. Save layout and Open layout sit beside the tabs.', 2.9 * inch)
S += [PageBreak()]
# ---------------------------------------------------------------- 5
S += page('CUT FILES AND COSTS', 'Cut sheets, files and price',
          'Everything the Cut sheets tab and the Download menu produce is available as data.')
S += step('11', 'Compute a design',
          c('design.compute') + ' takes a settings object and returns everything about that box. It never changes the '
          'page, so you can try as many designs as you like.',
          codeblock("""var d = Boxsmith.design.compute(
  Boxsmith.boxes.create('closed', { W: 120, D: 80, H: 50, text: 'Spices' })
);
console.log(d.outside, d.warnings);
console.log(d.stats);
console.log(d.cost);"""))
S += params([
    ('outside, inside', 'Sizes as { W, D, H }. inside is null when the design has none.'),
    ('warnings, notes', 'The same design warnings and assembly notes the page shows.'),
    ('parts', 'Each part with name, material, thickness, width, height and hole count.'),
    ('sheets', 'Each packed sheet: label, size, part count, and its svg and dxf text.'),
    ('stats', 'parts, sheets, bedUsePercent, cutLengthMm, laserSeconds'),
    ('cost', 'materialShare, sheetsIfBoughtWhole, machine, perBox, suggestedPrice'),
    ('files', 'The sheet SVGs, sheet DXFs and the assembly card, named as the page names them.'),
], first=1.5 * inch, title='What compute returns')
S += step('12', 'Choose what to compute',
          'Options: ' + c('svg') + ', ' + c('dxf') + ', ' + c('card') + ' (all true by default) and ' + c('geometry') +
          ", which adds each part's outline and holes.",
          codeblock("""var small = Boxsmith.design.compute(tray, { dxf: false, card: false });
Boxsmith.design.sheetSVG(tray, 1);      // sheet 1 as SVG text
Boxsmith.design.assemblyCard(tray);     // the card as HTML"""))
S += step('13', 'Compute the box that is open in the editor',
          c('browser.current()') + ' computes whatever is in the sidebar. ' + c('browser.download(kind)') + ' works like the '
          "Download menu: 'svg', 'dxf', 'settings', 'card' or 'layout'.",
          codeblock("""Boxsmith.browser.current().cost.suggestedPrice
Boxsmith.browser.download('dxf');"""))
S += [PageBreak()]
# ---------------------------------------------------------------- 6
S += page('ARRANGE WITH CODE', 'Measure, snap and tidy a layout',
          'These helpers do what the Place tab does. Each one returns a new layout and leaves yours unchanged.')
S += step('14', 'Measure the boxes and look for collisions',
          c('assemblies.measure') + " gives each box's bounds, and a Frame's opening. " + c('assemblies.overlaps') +
          ' lists pairs of box numbers whose parts collide. A box sitting in a Frame\'s opening is fine. One touching a wall is not.',
          codeblock("""var m = Boxsmith.assemblies.measure(layout);
console.log(m[1].bounds.size, m[0].opening);
console.log(Boxsmith.assemblies.overlaps(layout));   // [] means none"""))
S += step('15', 'Snap a box against another',
          c('side') + " is '+x', '-x', '+y', '-y' or '+z' for the outside faces. For a Frame, 'in:c' centers a box in the "
          "opening, and 'in:-x', 'in:+x', 'in:-y', 'in:+y' push it against a wall. Rotated boxes snap by their true shape.",
          codeblock("""var a = Boxsmith.assemblies;
let L = a.create({ boxes: [a.place(frame), a.place(closed), a.place(closed)] });
L = a.snap(L, 1, { to: 0, side: 'in:c' });          // into the opening
L = a.snap(L, 2, { to: 1, side: '+x', gap: 5 });    // 5 mm to its right
console.log(a.overlaps(L));                          // []
Boxsmith.browser.openAssembly(L);"""),
          'If a snap cannot work (for example a box too big for the opening), the call throws an error that says why.')
S += step('16', 'Line the boxes up in a row', codeblock("L = a.row(L, { axis: 'x', gap: 10 });   // or axis: 'y'"))
S += step('17', 'Add, remove, duplicate and update',
          'Indexes start at 0. ' + c('update') + ' accepts any of position, rotation, hidden and settings.',
          codeblock("""L = a.add(L, a.place(closed, { position: [0, 80, 0] }));
L = a.duplicate(L, 1, { offset: [0, 60, 0] });
L = a.update(L, 2, { rotation: [0, 0, 90], hidden: false });
L = a.remove(L, 3);"""),
          '<b>Pure and geometry helpers.</b> place, create, add, remove, duplicate, update, color, serialize, parse need no '
          'geometry and also work in the light Node script on page 8. measure, overlaps, snap, row and step need the full '
          'API: the page, or boxsmith-node.js (page 9).')
S += [PageBreak()]
# ---------------------------------------------------------------- 7  (new)
S += page('COPY, STEP AND COLOR', 'Copies, steps, materials and color',
          'The code side of Duplicate in place, the Step buttons and the Color row on the Place tab.')
S += step('18', 'Copy in place, then step by the box\'s own size',
          c('duplicate') + ' with no offset puts the copy exactly on the original. ' + c('step') + ' moves a box by its own '
          "width, height or depth (as turned): 'left', 'right', 'up', 'down', 'in' (+Y, away from you) or 'out'. "
          'Add ' + c('{ count: 3 }') + ' to take several steps.',
          codeblock("""var a = Boxsmith.assemblies, B = Boxsmith.boxes;
var tin = B.create('closed', { W: 60, D: 60, H: 40, look: 'walnut' });
let L = a.create({ boxes: [a.place(B.create('display', { W: 120, D: 90, H: 70 })),
                           a.place(tin, { position: [110, 0, 0] })] });
L = a.duplicate(L, 1);  L = a.step(L, 2, 'right');   // a copy one width to the right
L = a.duplicate(L, 1);  L = a.step(L, 2, 'up');      // a copy stacked on top"""),
          'A copy is inserted straight after its original, so the boxes after it move up one index. In the example, the '
          'first copy is index 2 until the second copy takes that place and pushes it to 3.')
S += step('19', 'Give each box its own material',
          'A box\'s ' + c('look') + ' is the material it is drawn in: ' + c('Boxsmith.looks') + ' lists birch, walnut, mdf, clear, '
          'black, pink and card. Boxes added on the page keep the preview material they had, so changing the material '
          'later only changes the box being designed. A box with no look uses the preview or render material.')
S += step('20', 'Color a box, one part, or all its acrylic',
          c('color') + " takes a part name from " + c('design.compute(...).parts') + ", " + c("'acrylic'") + ' for every see-through '
          'part, or ' + c("'*'") + ' (the default) for the whole box. Acrylic stays see-through, just tinted. A part\'s own color '
          'beats the acrylic color, which beats the whole-box color. Pass ' + c('null') + ' to remove one.',
          codeblock("""L = a.color(L, 0, { part: 'acrylic', color: '#2f8cff' });  // the display case cover
L = a.color(L, 3, { color: '#c0392b' });                      // the whole box
L = a.color(L, 2, { part: 'Top', color: '#e8b730' });         // just its top
Boxsmith.browser.openAssembly(L);"""))
S += picture('07-color.png', 'The result, drawn with assemblies.render: tinted acrylic, a walnut box, a copy stacked on it with a yellow top, and a red copy beside it.', 2.45 * inch)
S += [PageBreak()]
# ---------------------------------------------------------------- 8
S += page('RUN FROM A TERMINAL', 'Generate a layout with Node.js',
          'Use this approach to create layout files from a script, without opening Boxsmith first.')
S += step('01', 'Put the API and your script in the same folder',
          'Install Node.js if needed. In Terminal or PowerShell, run ' + c('node --version') + ' to confirm it is available. Create '
          'a folder called ' + c('boxsmith-work') + '. Save the API script to that folder as ' + c('boxsmith-api.js') + '. Use your browser\'s '
          'Save Link As command if the link opens the source. ' + a('Node.js downloads', 'https://nodejs.org/') + ' · ' +
          a('Boxsmith API script', REPO + '/raw/main/boxsmith-api.js'))
S += step('02', 'Save this code as frame-and-boxes.cjs',
          'Use a plain-text editor and save the file in ' + c('boxsmith-work') + ' next to the API script. Check that your editor '
          'kept the ' + c('.cjs') + ' extension.',
          codeblock("""const fs = require('node:fs');
const path = require('node:path');
const { boxes, assemblies } = require('./boxsmith-api.js');

const frame = boxes.create('frame', {
  W: 240, D: 180, H: 50, frameW: 24
});
const closed = boxes.create('closed', { W: 55, D: 45, H: 30 });
const layout = assemblies.create({
  unit: 'mm',
  boxes: [
    assemblies.place(frame),
    ...[-60, 0, 60].map(x =>
      assemblies.place(closed, { position: [x, 0, 0] })
    )
  ]
});

const filename = path.join(__dirname, 'frame-and-boxes.json');
fs.writeFileSync(filename, assemblies.serialize(layout), 'utf8');
console.log(filename);"""))
S += step('03', 'Run the script and open the result',
          'In the terminal, change into the folder containing both files. For a folder in your home directory, use '
          'these commands.', codeblock('cd ~/boxsmith-work\nnode frame-and-boxes.cjs'),
          'The terminal prints the path to ' + c('frame-and-boxes.json') + '. In Boxsmith, choose <b>Arrange boxes</b>, click <b>Open '
          'layout</b>, and select that file.')
S += [Paragraph('This light script needs nothing but boxsmith-api.js. It builds settings and layouts (including copies and '
                'colors), and reads and writes layout files. For cut sheets, snapping, stepping and everything else, use the '
                'full Node entry on the next page.', cap), PageBreak()]
# ---------------------------------------------------------------- 9
S += page('RUN FROM A TERMINAL', 'The full API in Node.js',
          'The same cut files, costs, snapping, mosaic and library as the page, with no browser window.')
S += step('04', 'Install the two packages',
          c('boxsmith-node.js') + ' loads the real Boxsmith page in a headless engine. Put boxsmith-node.js, boxsmith-api.js, '
          'boxsmith-engine.js, index.html and the other page scripts from the Boxsmith repository in one folder, then '
          'install the two packages it needs.',
          codeblock('cd ~/boxsmith-work\nnpm install jsdom @napi-rs/canvas'),
          'Cloning the repository (' + c('git clone ' + REPO) + ') and running ' + c('npm install') + ' inside it does all of '
          'this in one step.')
S += step('05', 'Write the cut files for a box',
          'Save this as ' + c('cut-files.cjs') + '. ' + c('load()') + ' returns the whole API, and the calls return plain objects.',
          codeblock("""const fs = require('node:fs');
const { load } = require('./boxsmith-node.js');
(async () => {
  const B = await load();
  const box = B.boxes.create('closed', { W: 120, D: 80, H: 50 });
  for (const file of B.design.files(box)) fs.writeFileSync(file.name, file.data);
  console.log(B.design.compute(box).cost.perBox);
  await B.close();
})();"""),
          'Run it with ' + c('node cut-files.cjs') + '. The folder now holds the sheet SVG, the sheet DXF and the assembly '
          'card for the box. Open the DXF in your laser software.')
S += step('06', 'Arrange boxes and check for collisions',
          'Inside the same ' + c('async') + ' block, before ' + c('B.close()') + ':',
          codeblock("""const a = B.assemblies;
const frame = B.boxes.create('frame', { W: 240, D: 180, H: 50, frameW: 24 });
const closed = B.boxes.create('closed', { W: 55, D: 45, H: 30 });
let L = a.create({ boxes: [a.place(frame), a.place(closed), a.place(closed)] });
L = a.snap(L, 1, { to: 0, side: 'in:c' });
L = a.snap(L, 2, { to: 1, side: '+x', gap: 5 });
console.log(a.overlaps(L));    // []
fs.writeFileSync('layout.json', a.serialize(L));"""),
          'Always call ' + c('B.close()') + ' when you are done, or the script will not exit. Errors thrown by the API are '
          'normal JavaScript errors, so try/catch works as usual. Dimensions are millimeters and rotations are degrees throughout.')
S += [PageBreak()]
# ---------------------------------------------------------------- 10
S += page('MOSAIC, LIBRARY AND PAGE', 'Mosaics, materials and the page',
          'Turn pictures into boxes, keep materials, and drive the preview.')
S += step('07', 'Turn a picture into a mosaic of boxes',
          c('mosaic.build') + ' works like the Picture mosaic panel. It takes RGBA pixels and returns a layout of painted '
          'boxes you can save or open. This example makes a small gradient. For a real picture, read its pixels from a '
          'canvas (or @napi-rs/canvas in Node). Options are listed in the API reference.',
          codeblock("""const w = 64, h = 64, rgba = new Uint8ClampedArray(w * h * 4);
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  const i = (y * w + x) * 4;
  rgba[i] = x * 4; rgba[i + 1] = y * 4; rgba[i + 2] = 128; rgba[i + 3] = 255;
}
const m = Boxsmith.mosaic.build({ rgba, width: w, height: h }, {
  cols: 12, colors: 5, paint: 'watercolor', frame: true
});
console.log(m.columns, m.rows, m.boxes, m.palette);
// m.assembly is a layout: open it, or save it with assemblies.serialize"""))
S += step('08', 'Keep materials and recipes',
          'A material remembers thickness, kerf, sheet price and look. A recipe is a saved box design. In the browser both '
          'share the page\'s own saved lists. In Node they last as long as the loaded page.',
          codeblock("""var lib = Boxsmith.library;
lib.materials.save({ name: 'Birch 3mm', t: 3, kerf: 0.15, price: 12 });
var s = lib.materials.apply(Boxsmith.boxes.create('closed'), 'Birch 3mm');
lib.recipes.save('Spice tin', Boxsmith.boxes.create('closed', { W: 120 }));
lib.recipes.list();         // ['Spice tin']
lib.recipes.load('Spice tin');"""))
S += step('09', 'Control the 3D preview',
          c('browser.view') + ' reads and changes the preview and returns the current view. Keys: material, explode, spin, '
          'yaw and pitch (degrees; pitch 90 is straight down), zoom, hardware, stereo, stereoDepth, edgeColor, lamp, '
          'maximize. Changing material affects only the box being designed; arranged boxes keep their own.',
          codeblock("""Boxsmith.browser.view({ material: 'walnut', explode: 40, spin: true });
Boxsmith.browser.view({ yaw: 30, pitch: 20, zoom: 1.2, lamp: { on: true } });
Boxsmith.browser.play(true);          // the "show it work" animation
var png = Boxsmith.browser.snapshot(); // PNG data URL"""))
S += step('10', 'Edit the sidebar and switch tabs',
          codeblock("""Boxsmith.browser.updateSettings({ W: 150, paint: 'acrylic', paintColor: '#3a7bd5' });
Boxsmith.browser.showTab('sheets');   // preview, sheets, arrange, guide, help
Boxsmith.browser.topView();"""))
S += [PageBreak()]
# ---------------------------------------------------------------- 11
S += page('DRAW PICTURES', 'Render a layout to a PNG',
          'Draw an Arrange boxes layout, or one box, from code, without touching the page.')
S += step('11', 'Render in the browser',
          c('assemblies.render') + ' takes a layout (an object or its JSON text) and returns a promise. It draws on its own '
          'offscreen canvas, so your current view, tab and layout stay as they are. In the browser ' + c('png') + ' is a data URL. '
          + c('design.render(settings, options)') + ' does one box. Each box is drawn in its own look and colors.',
          codeblock("""var picture = await Boxsmith.assemblies.render(layout, { pitch: 90, width: 1200 });
console.log(picture.width, picture.height);   // picture.png is a data URL for an <img>"""))
S += step('12', 'Write render.png from Node',
          'Rendering in Node uses headless Chrome, because jsdom has no WebGL. Install one more package, and have Chrome, '
          'Chromium or Edge on the computer. Set ' + c('BOXSMITH_CHROME') + ' to its path if it is not found.',
          codeblock('npm install jsdom @napi-rs/canvas playwright-core'),
          'Save as ' + c('render.cjs') + ' next to boxsmith-node.js and run ' + c('node render.cjs') + '. Here ' + c('png') + ' is a Buffer.',
          codeblock("""const fs = require('node:fs');
const { load } = require('./boxsmith-node.js');
(async () => {
  const Boxsmith = await load();
  const { boxes, assemblies } = Boxsmith;
  const frame = boxes.create('frame', { W: 240, D: 180, H: 50, frameW: 24 });
  const tile = boxes.create('closed', {
    W: 55, D: 45, H: 30, paint: 'acrylic', paintColor: '#3a7bd5'
  });
  const layout = assemblies.create({ boxes: [
    assemblies.place(frame),
    ...[-60, 0, 60].map(x => assemblies.place(tile, { position: [x, 0, 0] }))
  ] });
  const picture = await assemblies.render(layout, { pitch: 50, yaw: 30 });
  fs.writeFileSync('render.png', picture.png);
  await Boxsmith.close();    // closes the browser too
})();"""))
S += params([
    ('pitch, yaw, size', 'pitch is degrees down from horizontal (90 = straight down); yaw turns around the vertical. Defaults 35, 30, 1600 × 1200 px (width, height).'),
    ('fit, zoom', 'fit: true (default) frames every visible box. zoom applies only when fit is false.'),
    ('material, edgeColor, lamp', 'As in browser.view. Default material is birch; boxes with their own look keep it.'),
    ('background, showHidden', "'#rrggbb' or 'transparent' (default white). showHidden: true also draws hidden boxes."),
], first=1.75 * inch, title='Choose the view (all options are optional, angles in degrees)')
S += [PageBreak()]
# ---------------------------------------------------------------- 12
S += page('REUSE AND TROUBLESHOOT', 'Work with saved layouts',
          'Use the same layout file whether it was created in Boxsmith or generated by a script.')
S += [Paragraph('Read an existing layout in Node.js', h3),
      P('Add this to a script that already imports fs and assemblies. Run it from the folder containing the JSON file.')]
S += codeblock("""const saved = assemblies.parse(
  fs.readFileSync('frame-and-boxes.json', 'utf8')
);
console.table(saved.boxes.map(box => ({
  type: box.settings.type,
  position: box.position.join(', '),
  rotation: box.rotation.join(', ')
})));""")
S += params([
    ('boxes.list / defaults / create', 'Find a type, look up its keys, make a settings object.'),
    ('design.compute / files', 'Cut sheets, SVG, DXF, parts, costs and warnings for one box.'),
    ('assemblies.place / create / add / remove / duplicate / update', 'Build and edit a layout.'),
    ('assemblies.color, looks', 'Color a box, one part or its acrylic; the materials a box can keep.'),
    ('assemblies.measure / overlaps / snap / row / step', 'Measure, check for collisions, snap, line up and step (full API).'),
    ('assemblies.serialize / parse', 'Layout to JSON text, and back.'),
    ('mosaic.build', 'Turn a picture into a layout of painted boxes.'),
    ('library.materials / recipes', 'Saved materials and saved box designs.'),
    ('assemblies.render / design.render', 'Draw a layout or one box to a PNG.'),
    ('browser.*', 'Drive the Boxsmith page: preview, view, tabs, download, open layouts.'),
], first=2.6 * inch, title='Pick the method that matches your job')
S += [Paragraph('Test the API', h3),
      P('In the repository, ' + c('npm install') + ' then ' + c('npm test') + ' checks every page control against the API and runs every '
        'box type, layout, copy, step, color, mosaic, library and preview call. For method signatures, see the ' + a('Boxsmith API reference', APIREF) + '.'),
      Paragraph('If something looks wrong', h3),
      Paragraph('<b>“Boxsmith is not defined.”</b> Open the Console on the Boxsmith tab, wait for the page to load, then reload if needed.', small),
      Paragraph('<b>“Unknown box parameter.”</b> Compare your spelling with ' + c("Boxsmith.boxes.defaults('closed')") + '. Use uppercase W, D, and H for dimensions.', small),
      Paragraph('<b>“Cannot find module.”</b> Make sure boxsmith-api.js (or boxsmith-node.js and its page files) is next to your script. For the '
        'full Node entry also run ' + c('npm install jsdom @napi-rs/canvas') + '. Check for an extra .txt extension. A script that never '
        'exits needs ' + c('close()') + '.', small),
      Paragraph('<b>The wrong box moved, or boxes overlap.</b> A duplicate is inserted right after its original, so later '
        'indexes shift by one; ' + c('measure') + ' shows which is which. ' + c('assemblies.overlaps') + ' or Top view finds '
        'collisions. Inches × 25.4 gives millimeters.', small)]


def on_page(cv, doc):
    cv.saveState()
    sec = getattr(cv, '_section', '')
    cv.setStrokeColor(ACCENT); cv.setLineWidth(1.6); cv.line(M, H - 0.42 * inch, M + 14, H - 0.42 * inch)
    cv.setFillColor(ACCENT); cv.setFont('SansB', 7.2)
    cv.drawString(M + 20, H - 0.42 * inch - 2.6, 'BOXSMITH API  /  ' + sec)
    cv.setStrokeColor(RULE); cv.setLineWidth(0.6); cv.line(M, 0.52 * inch, W - M, 0.52 * inch)
    cv.setFillColor(MUTED); cv.setFont('SansB', 7); cv.drawString(M, 0.36 * inch, 'BOXSMITH  /  JAVASCRIPT API')
    cv.setFont('Sans', 7); cv.drawRightString(W - M, 0.36 * inch, '%d / %d' % (doc.page, TOTAL))
    cv.restoreState()


class Doc(BaseDocTemplate):
    def afterFlowable(self, f):
        if isinstance(f, Section):
            self.canv._section = f.name
            if os.environ.get('GUIDE_DEBUG'): print('section', f.name, 'starts page', self.page)


def build():
    doc = Doc(OUT, pagesize=letter, leftMargin=M, rightMargin=M, topMargin=0.68 * inch, bottomMargin=0.7 * inch,
              title='Boxsmith API | Step-by-step guide', author='Boxsmith')
    frame = Frame(M, 0.7 * inch, CW, H - 0.68 * inch - 0.7 * inch, id='f', leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    doc.addPageTemplates([PageTemplate(id='p', frames=[frame], onPageEnd=on_page)])
    doc.build(list(S))
    return doc.page


TOTAL = sum(isinstance(f, PageBreak) for f in S) + 1    # every page ends with an explicit break
pages = build()
assert pages == TOTAL, 'a page overflowed: %d pages built, %d planned' % (pages, TOTAL)
print(OUT, TOTAL, 'pages')
