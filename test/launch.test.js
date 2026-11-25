'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('the page has a description, Open Graph and Twitter card pointing at the live image', () => {
  const html = read('index.html');
  assert.match(html, /<meta name="description" content="[^"]{40,}">/);
  assert.match(html, /property="og:title" content="Boxsmith — Laser-Cut Box Generator"/);
  assert.match(html, /property="og:url" content="https:\/\/markplaga\.github\.io\/Boxsmith\/"/);
  assert.match(html, /property="og:image" content="https:\/\/markplaga\.github\.io\/Boxsmith\/og\.png"/);
  assert.match(html, /property="og:image:width" content="1200"/);
  assert.match(html, /property="og:image:height" content="630"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(html, /name="twitter:image" content="https:\/\/markplaga\.github\.io\/Boxsmith\/og\.png"/);
  assert.match(html, /id="shareBtn"/);
  assert.match(html, /Copy link to this design/);
  assert.match(html, /id="siteCredit"/);
  assert.match(html, /href="https:\/\/github\.com\/markplaga\/Boxsmith"/);
  assert.match(html, /Mark Plaga/);
  assert.match(html, /id="siteLinks"[^>]*hidden/);
  const shareAt = html.indexOf('src="share.js"');
  const appAt = html.indexOf('src="app.js"');
  const siteAt = html.indexOf('src="site.js"');
  assert.ok(shareAt > 0 && shareAt < appAt, 'share.js loads before app.js');
  assert.ok(html.indexOf('src="site.config.js"') > 0 && html.indexOf('src="site.config.js"') < appAt);
  assert.ok(siteAt > appAt, 'site.js loads after app.js');
});

test('analytics is off until one config value is set, and the follow links are empty slots', () => {
  const cfg = read('site.config.js');
  assert.match(cfg, /analytics:\s*''/);
  assert.match(cfg, /instagram:\s*''/);
  assert.match(cfg, /youtube:\s*''/);
  assert.match(cfg, /kofi:\s*''/);
  const site = read('site.js');
  assert.match(site, /boxsmithTrack = function\(\)\{\}/);
  assert.doesNotMatch(site, /goatcounter\.com\/count"|plausible\.io\/js/);
});

test('the license is MIT, copyright Mark Plaga 2026', () => {
  const license = read('LICENSE');
  assert.match(license, /^MIT License/);
  assert.match(license, /Copyright \(c\) 2026 Mark Plaga/);
  assert.match(license, /THE SOFTWARE IS PROVIDED "AS IS"/);
});

test('the social image is a 1200 by 630 PNG', () => {
  const png = fs.readFileSync(path.join(root, 'og.png'));
  assert.equal(png.toString('ascii', 1, 4), 'PNG');
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
});
