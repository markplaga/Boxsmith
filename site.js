'use strict';
/* Footer links and optional analytics. Reads BOXSMITH_CONFIG from site.config.js.
   With the defaults, this adds the maker credit's links (none yet) and defines a
   no-op tracker. It does not contact any analytics host until analytics is set. */
(function(){
  const cfg = window.BOXSMITH_CONFIG || {};

  function esc(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function safeHttp(value){
    if (!value || typeof value !== 'string') return '';
    try {
      const url = new URL(value.trim());
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
      if (!url.hostname) return '';
      return url.href;
    } catch (e) { return ''; }
  }

  const slot = document.getElementById('siteLinks');
  if (slot) {
    const links = cfg.links && typeof cfg.links === 'object' ? cfg.links : {};
    const html = [['instagram', 'Instagram'], ['youtube', 'YouTube'], ['kofi', 'Ko-fi']].map(([key, label]) => {
      const href = safeHttp(links[key]);
      return href ? '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + label + '</a>' : '';
    }).filter(Boolean).join('');
    if (html) { slot.innerHTML = html; slot.hidden = false; }
  }

  function parseAnalytics(value){
    const raw = String(value || '').trim();
    if (!raw) return null;
    const colon = raw.indexOf(':');
    if (colon < 1) return null;
    const kind = raw.slice(0, colon).toLowerCase();
    const rest = raw.slice(colon + 1).trim();
    if (!rest) return null;
    if (kind === 'goatcounter') {
      if (/^https?:\/\//i.test(rest)) {
        const endpoint = rest.replace(/\/$/, '');
        return {kind, endpoint: /\/count$/i.test(endpoint) ? endpoint : endpoint + '/count'};
      }
      const code = rest.replace(/\.goatcounter\.com.*$/i, '').toLowerCase();
      if (!/^[a-z0-9-]+$/.test(code)) return null;
      return {kind, endpoint: 'https://' + code + '.goatcounter.com/count'};
    }
    if (kind === 'plausible') {
      let domain = rest, host = 'https://plausible.io';
      const at = rest.lastIndexOf('@');
      if (at > 0) { domain = rest.slice(0, at).trim(); host = rest.slice(at + 1).trim().replace(/\/$/, ''); }
      if (!domain || /[\s/]/.test(domain) || !/^https?:\/\//i.test(host)) return null;
      return {kind, domain, host};
    }
    return null;
  }

  const spec = parseAnalytics(cfg.analytics);
  if (!spec) { window.boxsmithTrack = function(){}; return; }

  const pending = [];
  let ready = false;
  function eventPath(name, props){
    const format = props && props.format ? String(props.format).replace(/[^a-z0-9_-]+/gi, '') : '';
    return (format ? name + '/' + format : name).slice(0, 120);
  }
  function flush(){ if (!ready) return; while (pending.length) pending.shift()(); }

  if (spec.kind === 'goatcounter') {
    window.boxsmithTrack = function(name, props){
      if (!name) return;
      const path = eventPath(name, props);
      pending.push(() => { try { if (window.goatcounter && window.goatcounter.count) window.goatcounter.count({path, title: name, event: true}); } catch (e) {} });
      flush();
    };
    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://gc.zgo.at/count.js';
    s.dataset.goatcounter = spec.endpoint;
    s.onload = () => { ready = true; flush(); };
    s.onerror = () => { pending.length = 0; };
    document.head.appendChild(s);
    return;
  }

  window.plausible = window.plausible || function(){ (window.plausible.q = window.plausible.q || []).push(arguments); };
  window.boxsmithTrack = function(name, props){
    if (!name) return;
    const args = [String(name)];
    if (props && typeof props === 'object' && Object.keys(props).length) args.push({props});
    try { window.plausible.apply(null, args); } catch (e) {}
  };
  const s = document.createElement('script');
  s.defer = true;
  s.dataset.domain = spec.domain;
  s.src = spec.host + '/js/script.js';
  document.head.appendChild(s);
})();
