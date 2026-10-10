/* Native, freiwillige Bring-Your-Own-Key-KI.
 * Keys werden ausschließlich im iOS Keychain/Android Keystore abgelegt.
 * Web/PWA: BYOK nicht verfügbar (kein sicherer Browser-Key-Speicher).
 * Kein Fallback auf Klartext, Preferences oder localStorage.
 * Native API-Aufrufe gehen DIREKT an den gewählten Anbieter per HTTPS.
 */
(function (root) {
  'use strict';
  const CAP = root.Capacitor || null;
  const KEY_PREFIX = 'vt:private-ai-key:';
  const CONFIGS = Object.freeze({
    openai: { url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' },
    groq: { url: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.3-70b-versatile' }
  });

  function native() {
    return !!(CAP && typeof CAP.isNativePlatform === 'function' && CAP.isNativePlatform() &&
      typeof CAP.registerPlugin === 'function');
  }

  function securePlugin() {
    return native() ? CAP.registerPlugin('SecureStoragePlugin') : null;
  }
  function nativeHttp() {
    return native() ? CAP.registerPlugin('CapacitorHttp') : null;
  }
  function validProvider(provider) {
    if (!Object.prototype.hasOwnProperty.call(CONFIGS, provider)) {
      throw new Error('Unbekannter KI-Anbieter.');
    }
    return provider;
  }

  async function available() {
    if (!native()) return false;
    if (typeof CAP.isPluginAvailable === 'function' &&
      (!CAP.isPluginAvailable('SecureStoragePlugin') || !CAP.isPluginAvailable('CapacitorHttp'))) return false;
    const secure = securePlugin();
    const http = nativeHttp();
    if (!secure || !http || typeof http.post !== 'function' ||
        typeof secure.getPlatform !== 'function' || typeof secure.set !== 'function' ||
        typeof secure.get !== 'function' || typeof secure.remove !== 'function') return false;
    try {
      const platform = await secure.getPlatform();
      return platform && (platform.value === 'ios' || platform.value === 'android');
    } catch (_) {
      return false;
    }
  }

  async function requireNative() {
    if (!await available()) {
      throw new Error('Eigene API-Schlüssel erfordern die native App mit sicherem Schlüsselspeicher.');
    }
    return securePlugin();
  }
  async function setKey(provider, secret) {
    validProvider(provider);
    const value = String(secret || '').trim();
    if (value.length < 8 || value.length > 400 || /\s/.test(value)) {
      throw new Error('Bitte einen gültigen API-Schlüssel eingeben.');
    }
    const secure = await requireNative();
    await secure.set({ key: KEY_PREFIX + provider, value });
    // Schlüssel weder zurückgeben noch in Logs, Settings oder Fehlerdetails übernehmen.
    return { stored: true };
  }
  async function hasKey(provider) {
    validProvider(provider);
    const secure = await requireNative();
    try {
      const item = await secure.get({ key: KEY_PREFIX + provider });
      return typeof item?.value === 'string' && !!item.value;
    } catch (_) {
      return false; // Das Plugin wirft auch bei einem noch nicht existierenden Schlüssel.
    }
  }
  async function removeKey(provider) {
    validProvider(provider);
    const secure = await requireNative();
    try { await secure.remove({ key: KEY_PREFIX + provider }); }
    catch (_) { /* Bereits nicht vorhandenen Schlüssel wie gelöscht behandeln. */ }
  }
  function trim(v, max) { return typeof v === 'string' ? v.trim().slice(0, max) : ''; }
  function buildPrompt(payload) {
    if (payload && payload.verb && typeof payload.verb === 'object') {
      const v = trim(payload.verb.infinitive, 80);
      const past = trim(payload.verb.past, 100);
      const part = trim(payload.verb.participle, 100);
      const de = trim(payload.verb.german, 100);
      const answer = trim(payload.userAnswer, 150);
      if (!v || !past || !part || !de) throw new Error('Die Verbformen sind unvollständig.');
      const target = trim(payload.target, 20);
      return `Erkläre für Deutschlernende das Verb ${v} (${de}). ` +
        `Infinitiv: ${v}, Simple Past: ${past}, Past Participle: ${part}. ` +
        `Gefragte Form: ${target || 'all'}. ${answer ? `Falsche Antwort: ${answer}. ` : ''}` +
        'Gib die drei Formen, Form-Gruppe, eine präzise Eselsbrücke und einen Beispielsatz mit Übersetzung an.';
    }
    const word = trim(payload && payload.word, 100);
    if (!word) throw new Error('Bitte ein gültiges Wort auswählen.');
    return `Erkläre das englische Wort „${word}“ auf Deutsch: Wortart, Bedeutung, ` +
      'bei Verben die drei Formen, zwei Beispiele mit deutscher Übersetzung und eine Merkhilfe.';
  }

  async function request(provider, payload) {
    const config = CONFIGS[validProvider(provider)];
    const keyStore = await requireNative();
    let item;
    try { item = await keyStore.get({ key: KEY_PREFIX + provider }); }
    catch (_) { throw new Error('Kein API-Schlüssel hinterlegt. Bitte in den KI-Einstellungen eingeben.'); }
    const key = typeof item?.value === 'string' ? item.value : '';
    if (!key) throw new Error('Kein API-Schlüssel hinterlegt.');
    const http = nativeHttp();
    const body = {
      model: config.model,
      messages: [
        { role: 'system', content: 'Du bist ein präziser, altersgerechter Englischlehrer. Antworte nur auf Deutsch, maximal 160 Wörter, Markdown. Frage nie nach persönlichen Daten.' },
        { role: 'user', content: buildPrompt(payload) }
      ],
      max_tokens: 400,
      temperature: 0.3
    };
    let response;
    try {
      response = await http.post({
        url: config.url,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': 'Bearer ' + key
        },
        data: body,
        connectTimeout: 10000,
        readTimeout: 25000
      });
    } catch (_) {
      throw new Error('Verbindung zum gewählten KI-Anbieter fehlgeschlagen.');
    }
    const status = Number(response && response.status);
    if (status === 401 || status === 403) {
      throw new Error('Der eigene API-Schlüssel wurde vom Anbieter abgelehnt.');
    }
    if (status === 429) throw new Error('Dein KI-Anbieter meldet ein Nutzungslimit.');
    if (status < 200 || status >= 300) throw new Error(`KI-Anbieter nicht verfügbar (HTTP ${status || '?' }).`);
    const parsed = typeof response.data === 'string' ? (() => {
      try { return JSON.parse(response.data); } catch (_) { return null; }
    })() : response.data;
    const info = parsed?.choices?.[0]?.message?.content;
    if (typeof info !== 'string' || !info.trim()) throw new Error('Der KI-Anbieter hat keine Erklärung geliefert.');
    return { success: true, info: info.trim().slice(0, 6000), provider };
  }

  root.VTBYOK = Object.freeze({ available, setKey, hasKey, removeKey, request });
})(window);
