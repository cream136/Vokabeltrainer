import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cloudflare-worker/src/index.mjs';

const BASE = 'https://example.workers.dev';
function env({ allowed = true, fail = false } = {}) {
  const calls = [];
  return {
    calls,
    AI: { async run(model, input) {
      calls.push({ model, input });
      if (fail) throw Error('UNSAFE_INTERNAL_ERROR');
      return { response: 'Hilfreiche Erklärung.' };
    } },
    AI_RATE_LIMIT: { async limit() { return { success: allowed }; } },
    AI_MODEL: '@cf/meta/llama-3.1-8b-instruct-fp8',
    WEB_ORIGIN: ''
  };
}
async function req(path, body, origin = 'capacitor://localhost') {
  return new Request(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Origin: origin },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
}

test('health check benötigt kein AI-Inferenzmodell', async () => {
  const r = await worker.fetch(new Request(BASE + '/health'), env());
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
});
test('gültiges Wort erzeugt nur eine KI-Anfrage', async () => {
  const e = env();
  const r = await worker.fetch(await req('/api/ai-helper', { word: 'go' }), e);
  const body = await r.json();
  assert.equal(r.status, 200);
  assert.equal(body.success, true);
  assert.equal(e.calls.length, 1);
  assert.match(e.calls[0].input.messages[1].content, /go/);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'capacitor://localhost');
});
test('ungültige Eingabe und fremde Origins werden abgewiesen', async () => {
  assert.equal((await worker.fetch(await req('/api/ai-helper', {}), env())).status, 400);
  assert.equal((await worker.fetch(await req('/api/ai-helper', { word:'test' }, 'https://fremde-seite.example'), env())).status, 403);
});
test('Rate Limit sperrt vor AI-Verbrauch', async () => {
  const e = env({ allowed: false });
  const r = await worker.fetch(await req('/api/ai-helper', { word: 'test' }), e);
  assert.equal(r.status, 429);
  assert.equal(e.calls.length, 0);
});
test('KI-Rohfehler werden nicht an Nutzer verraten', async () => {
  const r = await worker.fetch(await req('/api/ai-helper', { word: 'test' }), env({ fail: true }));
  assert.equal(r.status, 503);
  assert.doesNotMatch(await r.text(), /UNSAFE_INTERNAL_ERROR/);
});
test('große Nutzdaten werden abgewiesen', async () => {
  const r = await worker.fetch(await req('/api/ai-helper', { word: 'x'.repeat(10000) }), env());
  assert.equal(r.status, 413);
});
