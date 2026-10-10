// Vokabeltrainer: Nur KI-Endpunkt, KEINE öffentlichen Dataset- oder Admin-APIs.
// Free-Plan zwingend beibehalten; Cache/Limits sind KEIN Identitätsnachweis.
const ALLOWED_ORIGINS = new Set([
  'capacitor://localhost', 'http://localhost', 'https://localhost'
]);
const MAX_BYTES = 7000;
const SYSTEM = 'Du bist ein freundlicher und fachlich präziser Englischlehrer für Schüler. ' +
  'Antworte auf Deutsch, sachlich, altersgerecht, maximal 160 Wörter, mit Markdown. ' +
  'Erfinde keine Lehrbuchdaten. Fordere keine persönlichen Daten an.';

function cors(origin, env) {
  const ownOrigin = String(env.WEB_ORIGIN || '').trim();
  if (!origin || (!ALLOWED_ORIGINS.has(origin) && origin !== ownOrigin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  };
}
function reply(data, status = 200, extra = {}) {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra }
  });
}
function clipped(value, limit) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}
async function readSmallBody(request, maxBytes) {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0, text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel().catch(() => {});
      const err = new Error('TOO_LARGE');
      err.status = 413;
      throw err;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function getPrompt(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  if (body.verb && typeof body.verb === 'object') {
    const entry = body.verb;
    const v = clipped(entry.infinitive, 80), past = clipped(entry.past, 100);
    const part = clipped(entry.participle, 100), german = clipped(entry.german, 120);
    const given = clipped(body.userAnswer, 150);
    if (!v || !past || !part || !german) return null;
    const target = ['all','past','participle','infinitive','meaning'].includes(body.target) ? body.target : 'all';
    return `Erkläre die englischen unregelmäßigen Verbformen zu ${v} (${german}).\n` +
      `Lernliste: Infinitiv ${v}, Simple Past ${past}, Past Participle ${part}.\n` +
      `Geprüfte Form: ${target}. ${given ? `Antwort des Schülers: ${given}.` : ''}\n` +
      'Erkläre das Muster, eine Eselsbrücke und einen kurzen Beispielsatz mit deutscher Übersetzung. ' +
      'Die mitgelieferten korrekten Formen sind die maßgebliche Lernliste.';
  }
  const word = clipped(body.word, 100);
  if (!word) return null;
  return `Erkläre das englische Wort „${word}“ für Deutschlernende: ` +
    'Wortart, deutsche Bedeutung, 2 kurze Beispielsätze mit Übersetzung; ' +
    'falls Verb, Infinitiv, Simple Past und Past Participle. Bitte keine unbelegten Bedeutungen.';
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    const origin = request.headers.get('Origin');
    const headers = cors(origin, env);
    if (pathname === '/health' && request.method === 'GET') {
      return reply({ ok: true, name: 'vokabeltrainer-ai' }, 200, headers);
    }
    if (pathname !== '/api/ai-helper') return reply({ success: false, message: 'Nicht gefunden' }, 404, headers);
    if (origin && !Object.keys(headers).length) return reply({ success: false, message: 'Origin nicht erlaubt' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return reply({ success: false, message: 'Methode nicht erlaubt' }, 405, headers);
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.toLowerCase().startsWith('application/json')) {
      return reply({ success: false, message: 'JSON erforderlich' }, 415, headers);
    }
    const sizeHeader = Number(request.headers.get('content-length'));
    if (sizeHeader > MAX_BYTES) return reply({ success: false, message: 'Anfrage zu groß' }, 413, headers);
    let input;
    try {
      input = JSON.parse(await readSmallBody(request, MAX_BYTES));
    } catch (error) {
      return error.status === 413
        ? reply({ success: false, message: 'Anfrage zu groß' }, 413, headers)
        : reply({ success: false, message: 'Ungültiges JSON' }, 400, headers);
    }
    const prompt = getPrompt(input);
    if (!prompt) return reply({ success: false, message: 'Wort oder Verb fehlt' }, 400, headers);
    if (!env.AI || !env.AI_RATE_LIMIT) {
      return reply({ success: false, message: 'KI-Dienst noch nicht konfiguriert' }, 503, headers);
    }
    // Vorläufiges Abuse-Limit je IP. Geteilte IPs (Schul-WLAN/Mobilfunk)
    // können betroffen sein. Kein genaues globales Tageskontingent.
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const { success } = await env.AI_RATE_LIMIT.limit({ key: 'ai:' + ip });
    if (!success) return reply({ success: false, message: 'Zu viele Anfragen. Bitte später erneut versuchen.' }, 429, headers);
    try {
      const model = String(env.AI_MODEL || '@cf/meta/llama-3.1-8b-instruct-fp8');
      const response = await env.AI.run(model, {
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: prompt }
        ],
        max_tokens: 420,
        temperature: 0.3
      });
      const info = typeof response?.response === 'string' ? response.response.trim() : '';
      if (!info) throw new Error('Leere Modellantwort');
      return reply({ success: true, info: info.slice(0, 6000), provider: 'cloudflare-workers-ai' }, 200, headers);
    } catch (error) {
      // Keine Rohfehler/Prompts/Personendaten in öffentlichen Antworten ausgeben.
      console.error('AI inference failed:', error?.name || 'unknown');
      return reply({ success: false, message: 'KI momentan nicht verfügbar, bitte später erneut versuchen.' }, 503, headers);
    }
  }
};
