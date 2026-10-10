import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../public/ai-mobile.js', import.meta.url), 'utf8');
function make({ settings, byokRequest, cloudFetch } = {}) {
  const saved = new Map();
  const els = {};
  for (const id of [
    'ai-provider','ai-proxy-url','ai-fallback','ai-fallback-wrap','ai-own-options',
    'ai-key-options','ai-byok-key','ai-byok-consent','ai-byok-info',
    'ai-byok-save','ai-byok-remove','ai-settings-status','ai-settings-save'
  ]) {
    els[id] = { value: '', checked: false, textContent: '', disabled: false,
      classList: { toggle(){} },
      addEventListener(name, cb) { this['event_' + name] = cb; },
      querySelector() { return { disabled: false }; }
    };
  }
  const requests = [];
  const window = {
    VT_AI_CONFIG: { standardUrl: 'https://cloud.example' },
    VTBYOK: {
      available: async () => true,
      request: async (...a) => { requests.push(a); return byokRequest ? byokRequest(...a) : {success:true,info:'BYOK',provider:a[0]}; },
      hasKey: async () => true,
      removeKey: async () => {},
      setKey: async () => {}
    },
    localStorage: { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value) }
  };
  const fetches = [];
  vm.runInNewContext(source, {
    window,
    document: { getElementById: key => els[key] },
    URL, AbortController, Date, setTimeout, clearTimeout,
    fetch: (...args) => { fetches.push(args); return cloudFetch ? cloudFetch(...args) : Promise.resolve({ok:true,json:async()=>({success:true,info:'Standard',provider:'cloudflare'})}); }
  });
  const persisted = { ...settings };
  const store = { getSettings: async()=>persisted, async saveSettings(patch) { Object.assign(persisted,patch); } };
  return { client: window.VTMobileAI, els, store, requests, fetches, persisted };
}

test('Mobil: freiwilliges BYOK ruft ausschließlich den eigenen Anbieter auf', async () => {
  const app = make({ settings: { aiProvider: 'openai', aiConsentProviders: {openai:true} } });
  await app.client.setup(app.store);
  const reply = await app.client.aiHelp({ word: 'tree' });
  assert.equal(reply.provider, 'openai');
  assert.equal(app.requests.length, 1);
  assert.equal(app.fetches.length, 0);
});

test('Mobil: ohne Einwilligung kein BYOK-Aufruf und kein stiller Cloud-Wechsel', async () => {
  const app = make({ settings: { aiProvider: 'groq', aiConsentProviders: {}, aiFallback: false } });
  await app.client.setup(app.store);
  const reply = await app.client.aiHelp({ word: 'tree' });
  assert.equal(reply.success, false);
  assert.equal(app.requests.length, 0);
  assert.equal(app.fetches.length, 0);
});

test('Mobil: BYOK-Ausfall ohne Fallback sendet nichts an den Standarddienst', async () => {
  const app = make({ settings: { aiProvider: 'openai', aiConsentProviders: {openai:true}, aiFallback: false }, byokRequest: async () => {throw Error('Netzfehler');} });
  await app.client.setup(app.store);
  const reply = await app.client.aiHelp({ word: 'tree' });
  assert.equal(reply.offline, true);
  assert.equal(app.fetches.length, 0);
});

test('Mobil: BYOK-Ausfall mit Einwilligung ermöglicht Standard-Fallback', async () => {
  const app = make({ settings: { aiProvider: 'openai', aiConsentProviders: {openai:true}, aiFallback: true }, byokRequest: async () => {throw Error('Netzfehler');} });
  await app.client.setup(app.store);
  const reply = await app.client.aiHelp({ word: 'tree' });
  assert.equal(reply.fallback, true);
  assert.equal(app.fetches.length, 1);
});

test('Mobil: Widerruf löscht eigenen Schlüssel und aktiviert Standard-KI', async () => {
  const app = make({ settings: { aiProvider: 'openai', aiConsentProviders: {openai:true} } });
  await app.client.setup(app.store);
  app.els['ai-byok-consent'].checked = false;
  app.els['ai-settings-save'].event_click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(app.persisted.aiProvider, 'standard');
  assert.equal(app.persisted.aiConsentProviders.openai, false);
});
