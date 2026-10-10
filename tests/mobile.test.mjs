import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/ai-mobile.js', import.meta.url), 'utf8');
function load(fetchImpl, standardUrl = 'https://cloud.example', document = undefined) {
  const saved = new Map();
  const window = {
    VT_AI_CONFIG: { standardUrl },
    localStorage: {
      getItem: key => saved.get(key) ?? null,
      setItem: (key, value) => saved.set(key, value)
    }
  };
  vm.runInNewContext(source, { window, document, URL, fetch: fetchImpl, AbortController, setTimeout, clearTimeout, Date });
  return window.VTMobileAI;
}
function makeUI() {
  const els = {};
  for (const id of ['ai-provider','ai-proxy-url','ai-fallback','ai-own-options','ai-settings-status','ai-settings-save']) {
    els[id] = { value: '', checked: false, textContent: '', classList: { toggle() {} },
      addEventListener(name, fn) { this[name] = fn; } };
  }
  return { els, document: { getElementById(id) { return els[id]; } } };
}

test('öffentliches Standardmodell ohne API-Schlüssel', async () => {
  let requested;
  const client = load(async (url, options) => {
    requested = { url, options };
    return { ok: true, json: async () => ({ success: true, info: 'Hallo', provider: 'test' }) };
  });
  const res = await client.aiHelp({ word: 'go' });
  assert.equal(res.info, 'Hallo');
  assert.equal(requested.url, 'https://cloud.example/api/ai-helper');
  assert.equal(requested.options.headers.Authorization, undefined);
});
test('bei Netzfehler liefert Offline-Hilfe korrekte Verbformen', async () => {
  const client = load(async () => { throw new Error('offline'); });
  const res = await client.aiHelp({ verb: { infinitive: 'go', past: 'went', participle: 'gone', german: 'gehen' } });
  assert.equal(res.offline, true);
  assert.match(res.info, /go – went – gone/);
});
test('kein automatisches Ausweichen vom privaten Server ohne Zustimmung', async () => {
  const requested = [];
  const { document } = makeUI();
  const client = load(async url => { requested.push(url); throw new Error('unreachable'); }, 'https://cloud.example', document);
  const store = { getSettings: async () => ({ aiProvider: 'custom', aiProxyUrl: 'https://privat.example', aiFallback: false }) };
  await client.setup(store);
  const res = await client.aiHelp({ word: 'go' });
  assert.equal(res.offline, true);
  assert.equal(requested.length, 1);
  assert.match(requested[0], /privat\.example/);
});
test('HTTP wird für private KI-Server abgelehnt', () => {
  const client = load(async () => ({}));
  assert.throws(() => client.endpoint('http://example.test'), /HTTPS/);
});
