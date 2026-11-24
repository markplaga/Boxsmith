'use strict';

/* Boxsmith in Node.js, with every feature of the page (cut sheets, SVG/DXF, costs, layouts, snapping, mosaic).
   It runs the real page headlessly, so it needs two npm packages:   npm install jsdom @napi-rs/canvas
   Rendering pictures (assemblies.render, design.render) also needs a browser, because jsdom has no WebGL:
                                                                     npm install playwright-core
   and Chrome, Chromium or Edge installed (or BOXSMITH_CHROME=/path/to/it, or load({ chrome: '/path' })).
   The browser starts the first time you render and is closed by close().
   Usage:   const { load } = require('./boxsmith-node.js');
            const Boxsmith = await load();
            const result = Boxsmith.design.compute({ type: 'closed', W: 120, D: 80, H: 50 });
            ...
            Boxsmith.close();                                       // when you are done
   The folder with index.html and the scripts is found next to this file; pass { dir } to use another one. */

const fs = require('node:fs');
const path = require('node:path');

async function load({ dir = __dirname, timeout = 20000, chrome } = {}) {
  let jsdom;
  try { jsdom = require('jsdom'); require.resolve('@napi-rs/canvas'); }
  catch (error) { throw new Error('boxsmith-node.js needs: npm install jsdom @napi-rs/canvas'); }
  const { JSDOM, VirtualConsole } = jsdom;
  const root = path.resolve(dir);

  // Put the page's own scripts inline, so nothing is fetched (this also skips the web fonts) and it works
  // the same in every jsdom version.
  let html = await fs.promises.readFile(path.join(root, 'index.html'), 'utf8');
  html = html.replace(/<link[^>]*fonts\.googleapis[^>]*>/g, '');
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)];
  for (const [tag, name] of scripts) {
    const file = path.join(root, name);
    if (!file.startsWith(root)) throw new Error('Unexpected script path: ' + name);
    const code = (await fs.promises.readFile(file, 'utf8')).replace(/<\/script/gi, '<\\/script');
    html = html.replace(tag, () => '<script>' + code + '</script>');
  }

  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => { if (!/Not implemented/.test(String(error.message))) console.error('[boxsmith]', error.message); });
  const dom = new JSDOM(html, {
    url: 'http://boxsmith.local/index.html', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole,
    beforeParse(window) {
      window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
      window.matchMedia = window.matchMedia || (query => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
      window.URL.createObjectURL = () => 'blob:boxsmith';
      window.URL.revokeObjectURL = () => {};
    },
  });
  const { window } = dom;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Boxsmith did not start in time')), timeout);
    const ready = () => { clearTimeout(timer); resolve(); };
    if (window.document.readyState === 'complete') ready(); else window.addEventListener('load', ready);
  });
  if (window.BOX) window.BOX.noSave = true;
  const api = window.Boxsmith;
  if (!api || !api.design) throw new Error('Boxsmith loaded without its engine. Check that boxsmith-engine.js is next to index.html.');
  // The page runs in its own JavaScript realm. Hand back plain objects and errors from this one, so that
  // `instanceof RangeError`, deepEqual and JSON all behave as you would expect.
  const plain = value => (value === undefined || value === null || typeof value !== 'object') ? value : JSON.parse(JSON.stringify(value));
  const wrap = target => {
    const out = {};
    for (const key of Object.keys(target)) {
      const value = target[key];
      if (typeof value === 'function') {
        out[key] = (...args) => {
          const done = result => (result && typeof result.then === 'function') ? result.then(plain, rethrow) : plain(result);
          try { return done(value.apply(target, args)); } catch (error) { return rethrow(error); }
        };
      } else if (value && typeof value === 'object' && !Array.isArray(value)) out[key] = wrap(value);
      else out[key] = plain(value);
    }
    return out;
  };
  const rethrow = error => {
    const Type = (error && globalThis[error.name] && /Error$/.test(error.name)) ? globalThis[error.name] : Error;
    const out = new Type(error && error.message ? error.message : String(error));
    if (error && Array.isArray(error.errors)) out.errors = plain(error.errors);   // box type problems, one per entry
    throw out;
  };
  const node = wrap(api);
  delete node._checkRender;

  // ---- pictures: the real page in headless Chromium (software GL, so no graphics card is needed) ----
  let browser = null, starting = null;
  const pageError = error => {
    const text = String((error && error.message) || error).split('\n')[0].replace(/^[\w.]+: (?:(?:Type|Range)?Error: )?/, '');
    return new Error(text);
  };
  const renderPage = () => starting || (starting = (async () => {
    let playwright;
    try { playwright = require('playwright-core'); }
    catch (error) { throw new Error('Rendering from Node needs: npm install playwright-core (and Chrome, Chromium or Edge installed)'); }
    const args = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
    if (typeof process.getuid === 'function' && process.getuid() === 0) args.push('--no-sandbox');
    const executablePath = chrome || process.env.BOXSMITH_CHROME;
    const attempts = executablePath ? [{ executablePath }] : [{ channel: 'chrome' }, { channel: 'msedge' }, {}];
    let last;
    for (const attempt of attempts) {
      try { browser = await playwright.chromium.launch({ headless: true, args, ...attempt }); break; }
      catch (error) { last = error; }
    }
    if (!browser) throw new Error('Could not start Chrome for rendering. Install Chrome or Chromium, or set BOXSMITH_CHROME to its path. (' + String(last && last.message).split('\n')[0] + ')');
    const page = await browser.newPage();
    await page.route('**/*', route => {
      const url = route.request().url();
      if (url === 'http://boxsmith.local/index.html') route.fulfill({ contentType: 'text/html', body: html });
      else route.abort();
    });
    await page.goto('http://boxsmith.local/index.html', { waitUntil: 'load', timeout });
    await page.waitForFunction(() => !!(window.Boxsmith && Boxsmith.assemblies && Boxsmith.assemblies.render), null, { timeout });
    await page.evaluate(() => { if (window.BOX) window.BOX.noSave = true; });
    return page;
  })().catch(error => { starting = null; if (browser) { browser.close().catch(() => {}); browser = null; } throw error; }));

  const renderChecked = async (layout, options) => {
    let checked;
    try { checked = api._checkRender(layout, options); } catch (error) { return rethrow(error); }
    const page = await renderPage();
    try {
      const result = await page.evaluate(([file, opts]) => Boxsmith.assemblies.render(file, opts), [plain(checked.layout), plain(checked.options)]);
      return { png: Buffer.from(result.png.slice(result.png.indexOf(',') + 1), 'base64'), width: result.width, height: result.height };
    } catch (error) { throw pageError(error); }
  };
  node.assemblies.render = (layout, options) => renderChecked(layout, options);
  node.design.render = async (settings, options) => {
    try {
      const { type = 'closed', ...rest } = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
      const box = api.boxes.create(type, rest);
      return renderChecked(api.assemblies.create({ boxes: [api.assemblies.place(box)] }), options);
    } catch (error) { return rethrow(error); }
  };
  /** The headless Chromium page that does the rendering (starts it if needed): the real Boxsmith page, with WebGL. */
  node.page = () => renderPage();
  node.close = () => {
    window.close();
    const open = browser; browser = null; starting = null;
    return open ? open.close() : undefined;
  };
  return node;

}

module.exports = { load };
