'use strict';
/* Design links. The ?d= parameter is a base64url JSON payload of the settings that
   differ from the defaults (plus any custom box type the design needs). A missing
   parameter leaves the page on its saved settings, or the defaults. */
(function(root, factory){
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BoxsmithShare = api;
})(globalThis, function(){
  const MAX = 16000;          // long enough for a full design; artwork past this is left out
  const MAX_RAW = 500000;     // refuse enormous links instead of freezing the page

  function pack(obj){
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }
  function unpack(raw){
    if (typeof raw !== 'string' || !raw || raw.length > MAX_RAW || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
    try {
      const pad = raw.length % 4 === 0 ? '' : '='.repeat(4 - (raw.length % 4));
      const bin = atob(raw.replace(/-/g, '+').replace(/_/g, '/') + pad);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 255;
      const obj = JSON.parse(new TextDecoder().decode(bytes));
      if (!obj || typeof obj !== 'object' || Array.isArray(obj) || obj.v !== 1) return null;
      return obj;
    } catch (e) { return null; }
  }
  function plainObject(value){
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }
  function valueOk(sample, value, key){
    if (Array.isArray(sample)) {
      if (!Array.isArray(value) || value.length > 24) return false;
      if (key === 'art') return value.every(item => plainObject(item) && JSON.stringify(item).length < 200000);
      if (key === 'frameBands') return value.every(item => typeof item === 'string' && item.length <= 32);
      return value.every(item => item === null || ['string', 'number', 'boolean'].includes(typeof item) || plainObject(item));
    }
    if (plainObject(sample)) {
      if (!plainObject(value)) return false;
      try { return JSON.stringify(value).length < 50000; } catch (e) { return false; }
    }
    if (typeof sample === 'number') return typeof value === 'number' && Number.isFinite(value);
    if (typeof sample === 'boolean') return typeof value === 'boolean';
    if (typeof sample === 'string') return typeof value === 'string' && value.length < 200000;
    return false;
  }
  function cleanTypes(types){
    if (!plainObject(types) || !Object.keys(types).length) return null;
    try { if (JSON.stringify(types).length > 200000) return null; } catch (e) { return null; }
    return types;
  }
  function delta(defaults, state, includeArt){
    const out = {};
    for (const key of Object.keys(defaults)) {
      if (key === 'art' && !includeArt) continue;
      if (!Object.prototype.hasOwnProperty.call(state, key)) continue;
      if (JSON.stringify(state[key]) === JSON.stringify(defaults[key])) continue;
      if (!valueOk(defaults[key], state[key], key)) continue;
      out[key] = state[key];
    }
    return out;
  }
  function artDiffers(defaults, state){
    return Object.prototype.hasOwnProperty.call(state, 'art') && JSON.stringify(state.art) !== JSON.stringify(defaults.art);
  }
  function payload(defaults, state, types, includeArt){
    const body = {v: 1};
    const changed = delta(defaults, state, includeArt);
    if (Object.keys(changed).length) body.s = changed;
    const extra = cleanTypes(types);
    if (extra) body.types = extra;
    return body;
  }

  /** @returns {{d:string, omittedArt:boolean}} d is '' only when the design cannot be encoded. */
  function encode(defaults, state, types){
    if (!plainObject(defaults) || !plainObject(state)) return {d: '', omittedArt: false};
    const full = pack(payload(defaults, state, types, true));
    if (full.length <= MAX || !artDiffers(defaults, state)) return {d: full, omittedArt: false};
    return {d: pack(payload(defaults, state, types, false)), omittedArt: true};
  }

  /** Settings that were accepted, already merged onto the defaults. null if the link is not a design. */
  function decode(defaults, raw){
    if (!plainObject(defaults)) return null;
    const body = unpack(raw);
    if (!body) return null;
    const src = body.s === undefined ? {} : body.s;
    if (!plainObject(src)) return null;
    const settings = {};
    for (const key of Object.keys(defaults)) {
      if (!Object.prototype.hasOwnProperty.call(src, key)) continue;
      if (!valueOk(defaults[key], src[key], key)) continue;
      settings[key] = src[key];
    }
    let types = null;
    if (body.types !== undefined) {
      if (!plainObject(body.types)) return null;
      types = body.types;
    }
    return {settings: JSON.parse(JSON.stringify(Object.assign({}, defaults, settings))), types};
  }

  return {encode, decode};
});
