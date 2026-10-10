import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/ai-byok.js', import.meta.url), 'utf8');
function loadNative({ providerHttp, secureFail = false, native = true } = {}) {
  const encryptedVault = new Map();
  const network = [];
  const prefWrites = [];
  const secure = {
    getPlatform: async () => ({ value: 'android' }),
    async set({ key, value }) { if (secureFail) throw Error('no keystore'); encryptedVault.set(key, value); return { value: true }; },
    async get({ key }) { if (!encryptedVault.has(key)) throw Error('missing'); return { value: encryptedVault.get(key) }; },
    async remove({ key }) { encryptedVault.delete(key); return { value: true }; }
  };
  const http = {
    async post(options) {
      network.push(options);
      return providerHttp ? providerHttp(options) : { status: 200, data: { choices: [{ message: { content: 'Lernhilfe' } }] } };
    }
  };
  const cap = { isNativePlatform: () => native, isPluginAvailable: () => true,
    registerPlugin: name => name === 'SecureStoragePlugin' ? secure : name === 'CapacitorHttp' ? http : {
      set: async v => prefWrites.push(v)
    }
  };
  const window = { Capacitor: cap };
  vm.runInNewContext(source, { window });
  return { api: window.VTBYOK, encryptedVault, network, prefWrites };
}

test('BYOK: ohne natives Gerät keine unsichere Speicher-Alternative', async () => {
  const { api, encryptedVault } = loadNative({ native: false });
  assert.equal(await api.available(), false);
  await assert.rejects(api.setKey('openai', 'sk-example12345678'), /native App/);
  assert.equal(encryptedVault.size, 0);
});

test('BYOK: Schlüssel nur im nativen Vault und Direktanfrage nur an Anbieter', async () => {
  const { api, encryptedVault, network, prefWrites } = loadNative();
  assert.equal(await api.available(), true);
  await api.setKey('openai', 'sk-example12345678');
  assert.equal(await api.hasKey('openai'), true);
  assert.equal(encryptedVault.get('vt:private-ai-key:openai'), 'sk-example12345678');
  assert.equal(prefWrites.length, 0);
  const reply = await api.request('openai', { word: 'apple' });
  assert.equal(reply.info, 'Lernhilfe');
  assert.equal(reply.provider, 'openai');
  assert.equal(network.length, 1);
  assert.equal(network[0].url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(network[0].headers.Authorization, 'Bearer sk-example12345678');
  assert.doesNotMatch(JSON.stringify(network[0].data), /sk-example12345678/);
});

test('BYOK: Groq erhält keinen OpenAI-Schlüssel und verwendet festes HTTPS', async () => {
  const { api, network } = loadNative();
  await api.setKey('openai', 'sk-openai-secret');
  await assert.rejects(api.request('groq', { word: 'word' }), /Kein API-Schlüssel/);
  await api.setKey('groq', 'gsk-groq-secret');
  await api.request('groq', { word: 'word' });
  assert.equal(network[0].url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(network[0].headers.Authorization, 'Bearer gsk-groq-secret');
});

test('BYOK: Fehler des Providers zeigt keinen Schlüssel an', async () => {
  const { api } = loadNative({ providerHttp: async () => ({ status: 401, data: { message: 'sk-secret-do-not-log' } }) });
  await api.setKey('openai', 'sk-secret-do-not-log');
  await assert.rejects(api.request('openai', { word: 'start' }), e => {
    assert.match(e.message, /abgelehnt/);
    assert.doesNotMatch(e.message, /sk-secret/);
    return true;
  });
});

test('BYOK: Entfernen löscht API-Schlüssel', async () => {
  const { api } = loadNative();
  await api.setKey('openai', 'sk-example12345678');
  await api.removeKey('openai');
  assert.equal(await api.hasKey('openai'), false);
});

test('BYOK: beim Keystore-Fehler bleibt Speichern geschlossen', async () => {
  const { api, encryptedVault } = loadNative({ secureFail: true });
  await assert.rejects(api.setKey('openai', 'sk-example12345678'));
  assert.equal(encryptedVault.size, 0);
});
