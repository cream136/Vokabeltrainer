/* Mobile KI für den Vokabeltrainer: Standard-Cloud, eigener HTTPS-Proxy,
   Offline-Rückfall. BYOK wird erst nach nativer sicherer Schlüsselablage aktiviert.
   Bewusst kein API-Schlüssel und keine Zugangsdaten in dieser Datei. */
(function (root) {
  'use strict';
  const CACHE_KEY = 'vt-ai-cache-v1'; // enthält ausschließlich generierte Lerntexte, keine Keys
  const CACHE_MAX = 80;
  const CACHE_AGE = 30 * 24 * 60 * 60 * 1000;
  const MAX_TEXT = 6000;
  const CONFIG = root.VT_AI_CONFIG || {};
  let userSettings = { aiProvider: 'standard', aiProxyUrl: '', aiFallback: false, aiConsentProviders: {} };

  function endpoint(baseUrl) {
    const url = new URL(baseUrl);
    if (url.protocol !== 'https:') {
      throw new Error('Für die KI-Verbindung ist HTTPS erforderlich.');
    }
    if (url.username || url.password || url.search || url.hash) {
      throw new Error('KI-Serveradresse enthält unzulässige Bestandteile.');
    }
    const path = url.pathname.replace(/\/+$/, '');
    url.pathname = path.endsWith('/api/ai-helper') ? path : path + '/api/ai-helper';
    return url.toString();
  }

  function isPlaceholder(url) {
    return !url || url.includes('DEIN-WORKER') || url.includes('DEIN-ACCOUNT');
  }

  function safeMarkdown(text) {
    return String(text == null ? '' : text).replace(/[\\`*_\[\]<>]/g, ' ').slice(0, 120);
  }

  function staticExplanation(payload, reason) {
    const verb = payload && payload.verb;
    const preface = '**Offline-Hilfe:** Der KI-Dienst ist gerade nicht erreichbar. ' +
      (reason === 'config' ? 'Die Standard-KI ist noch nicht eingerichtet.\n\n' : 'Du kannst weiterhin lernen.\n\n');
    if (verb && verb.infinitive) {
      const i = safeMarkdown(verb.infinitive);
      const p = safeMarkdown(verb.past);
      const pp = safeMarkdown(verb.participle);
      const de = safeMarkdown(verb.german);
      const group = i === p && p === pp ? 'Alle drei Formen sind gleich.'
        : p === pp ? 'Simple Past und Past Participle sind gleich.'
        : i === pp ? 'Infinitiv und Past Participle sind gleich.'
        : 'Die Formen unterscheiden sich. Lerne die Folge als zusammengehöriges Muster.';
      return preface + `**${i}** (${de})\n\n**Infinitiv – Simple Past – Past Participle:** ${i} – ${p} – ${pp}\n\n${group}\n\n` +
        '**Lerntipp:** Lies die drei Formen laut und wiederhole sie anschließend ohne abzulesen.';
    }
    const word = safeMarkdown(payload && payload.word);
    return preface + `**${word || 'Vokabel'}**\n\n` +
      'Lerntipp: Sprich das Wort laut aus, bilde einen eigenen Beispielsatz und überprüfe die Übersetzung in deiner Vokabelliste.';
  }

  function cacheId(payload) {
    if (payload && payload.verb && payload.verb.infinitive && !payload.userAnswer) {
      return 'v:' + String(payload.verb.infinitive).toLowerCase() + ':' + String(payload.target || 'all');
    }
    if (payload && payload.word) return 'w:' + String(payload.word).toLowerCase();
    return null; // individuelle Fehler nicht persistent speichern
  }

  function readCache(id) {
    if (!id) return null;
    try {
      const list = JSON.parse(root.localStorage.getItem(CACHE_KEY) || '[]');
      const hit = list.find(row => row.id === id && Date.now() - row.at < CACHE_AGE);
      return hit && hit.info;
    } catch (_) { return null; }
  }

  function writeCache(id, info) {
    if (!id || !info) return;
    try {
      let list = JSON.parse(root.localStorage.getItem(CACHE_KEY) || '[]');
      if (!Array.isArray(list)) list = [];
      list = [{ id, info: String(info).slice(0, MAX_TEXT), at: Date.now() },
        ...list.filter(row => row && row.id !== id)].slice(0, CACHE_MAX);
      root.localStorage.setItem(CACHE_KEY, JSON.stringify(list));
    } catch (_) { /* Speicherung optional; Quiz darf niemals daran scheitern. */ }
  }

  async function callRemote(url, payload) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 18000);
    try {
      const response = await fetch(endpoint(url), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data || data.success !== true || typeof data.info !== 'string' || !data.info.trim()) {
        const explanation = data && data.message ? String(data.message).slice(0, 120) : `HTTP ${response.status}`;
        throw new Error(explanation);
      }
      return { success: true, info: data.info.slice(0, MAX_TEXT), provider: data.provider || 'cloud' };
    } finally {
      clearTimeout(timeout);
    }
  }

  const isByok = p => p === 'openai' || p === 'groq';

  async function aiHelp(payload) {
    const settings = userSettings;
    const standardUrl = String(CONFIG.standardUrl || '').trim();
    const selected = settings.aiProvider;
    const chosenUrl = selected === 'custom' ? settings.aiProxyUrl : standardUrl;
    const canTryStandard = !isPlaceholder(standardUrl);
    const cacheKey = cacheId(payload);
    try {
      let result;
      if (isByok(selected)) {
        if (!settings.aiConsentProviders || settings.aiConsentProviders[selected] !== true) {
          throw new Error('Bitte der Datenübermittlung an deinen KI-Anbieter zustimmen.');
        }
        if (!root.VTBYOK) throw new Error('Sicherer Schlüsselspeicher nicht verfügbar.');
        // API-Key gelangt nicht zu unserem Cloudflare-Worker, sondern nur an den gewählten Anbieter.
        result = await root.VTBYOK.request(selected, payload);
      } else {
        if (isPlaceholder(chosenUrl)) throw new Error('KI noch nicht eingerichtet');
        result = await callRemote(chosenUrl, payload);
      }
      // Nur allgemeine Standard-KI-Antworten cachen; keine BYOK- oder Privatserver-Antworten.
      if (selected === 'standard') writeCache(cacheKey, result.info);
      return result;
    } catch (error) {
      // Kein stiller Anbieterwechsel; Fallback ausschließlich nach bewusstem Opt-in.
      if (selected !== 'standard' && settings.aiFallback === true && canTryStandard) {
        try {
          const result = await callRemote(standardUrl, payload);
          writeCache(cacheKey, result.info);
          return { ...result, fallback: true };
        } catch (_) { /* Danach Offline-Modus. */ }
      }
      // Benutzer-/Schlüsselfehler verständlich anzeigen. Niemals auf andere Provider wechseln.
      if (isByok(selected) && /Schlüssel|zustimmen|Schlüsselspeicher|Anbieter abgelehnt|Nutzungslimit/i.test(error.message)) {
        return { success: false, provider: selected, message: error.message };
      }
      const cached = selected === 'standard' || settings.aiFallback === true ? readCache(cacheKey) : null;
      return {
        success: true,
        offline: true,
        provider: 'offline',
        info: cached ? '**Gespeicherte KI-Erklärung (offline):**\n\n' + cached
          : staticExplanation(payload, isPlaceholder(chosenUrl) ? 'config' : 'network')
      };
    }
  }

  async function setup(store) {
    const provider = document.getElementById('ai-provider');
    const urlInput = document.getElementById('ai-proxy-url');
    const fallback = document.getElementById('ai-fallback');
    const fallbackWrap = document.getElementById('ai-fallback-wrap');
    const ownOptions = document.getElementById('ai-own-options');
    const keyOptions = document.getElementById('ai-key-options');
    const keyInput = document.getElementById('ai-byok-key');
    const keyConsent = document.getElementById('ai-byok-consent');
    const keyInfo = document.getElementById('ai-byok-info');
    const keySave = document.getElementById('ai-byok-save');
    const keyRemove = document.getElementById('ai-byok-remove');
    const info = document.getElementById('ai-settings-status');
    const save = document.getElementById('ai-settings-save');
    if (!provider || !urlInput || !fallback || !ownOptions || !info || !save) return;

    const saved = await store.getSettings();
    const allowed = ['standard', 'custom', 'openai', 'groq'];
    const selected = saved.aiProvider || (saved.aiProxyUrl ? 'custom' : 'standard');
    userSettings = {
      aiProvider: allowed.includes(selected) ? selected : 'standard',
      aiProxyUrl: String(saved.aiProxyUrl || ''),
      aiFallback: saved.aiFallback === true,
      aiConsentProviders: saved.aiConsentProviders && typeof saved.aiConsentProviders === 'object'
        ? { ...saved.aiConsentProviders } : {}
    };
    let secureAvailable = false;
    try { secureAvailable = !!(root.VTBYOK && await root.VTBYOK.available()); }
    catch (_) { secureAvailable = false; }
    for (const name of ['openai', 'groq']) {
      const option = provider.querySelector && provider.querySelector(`option[value="${name}"]`);
      if (option) option.disabled = !secureAvailable;
    }
    if (isByok(userSettings.aiProvider) && !secureAvailable) userSettings.aiProvider = 'standard';
    provider.value = userSettings.aiProvider;
    urlInput.value = userSettings.aiProxyUrl;
    fallback.checked = userSettings.aiFallback;

    async function refreshKeyStatus() {
      if (!keyInfo || !isByok(provider.value)) return;
      if (!secureAvailable) {
        keyInfo.textContent = 'Sichere Schlüsselablage auf diesem Gerät nicht verfügbar.';
        return;
      }
      try {
        keyInfo.textContent = await root.VTBYOK.hasKey(provider.value)
          ? 'Ein API-Schlüssel ist sicher auf diesem Gerät hinterlegt.'
          : 'Noch kein API-Schlüssel für diesen Anbieter gespeichert.';
      } catch (_) { keyInfo.textContent = 'Schlüsselspeicher konnte nicht gelesen werden.'; }
    }
    function refresh() {
      const p = provider.value;
      ownOptions.classList.toggle('hidden', p !== 'custom');
      if (keyOptions) keyOptions.classList.toggle('hidden', !isByok(p));
      if (fallbackWrap) fallbackWrap.classList.toggle('hidden', p === 'standard');
      if (keyConsent) keyConsent.checked = !!userSettings.aiConsentProviders[p];
      info.textContent = isPlaceholder(CONFIG.standardUrl)
        ? 'Standard-KI: Worker-Adresse muss vor der Veröffentlichung eingetragen werden.'
        : p === 'standard'
          ? 'Standard-KI: automatisch verbunden, keine Anmeldung erforderlich.'
          : p === 'custom'
            ? 'Eigener HTTPS-Server: nur du entscheidest, ob der Standarddienst als Ersatz genutzt wird.'
            : secureAvailable
              ? 'Eigene KI: Schlüssel im nativen Schlüsselspeicher, API-Aufruf direkt an den Anbieter.'
              : 'Eigene API-Schlüssel sind auf diesem Gerät nicht verfügbar.';
    }
    refresh();
    await refreshKeyStatus();
    provider.addEventListener('change', () => { refresh(); void refreshKeyStatus(); });
    save.addEventListener('click', async () => {
      try {
        const p = provider.value;
        if (p === 'custom') endpoint(urlInput.value.trim());
        if (isByok(p) && !secureAvailable) throw new Error('Sicherer Schlüsselspeicher fehlt.');
        if (isByok(p) && keyConsent && !keyConsent.checked) {
          // Einwilligung widerrufen: Key löschen, Anbieter deaktivieren.
          await root.VTBYOK.removeKey(p);
          const consent = { ...userSettings.aiConsentProviders, [p]: false };
          const changed = { ...userSettings, aiProvider: 'standard', aiConsentProviders: consent };
          await store.saveSettings(changed);
          userSettings = changed;
          provider.value = 'standard';
          refresh();
          info.textContent = 'Zustimmung widerrufen, Schlüssel gelöscht. Standard-KI aktiv.';
          return;
        }
        if (isByok(p) && (userSettings.aiConsentProviders[p] !== true || !await root.VTBYOK.hasKey(p))) {
          throw new Error('Zuerst Einwilligung erteilen und den Schlüssel sicher speichern.');
        }
        const changed = { aiProvider: p, aiProxyUrl: urlInput.value.trim(),
          aiFallback: fallback.checked, aiConsentProviders: { ...userSettings.aiConsentProviders } };
        await store.saveSettings(changed);
        userSettings = changed;
        info.textContent = 'KI-Einstellungen gespeichert.';
      } catch (error) {
        info.textContent = `Nicht gespeichert: ${error.message}`;
      }
    });
    if (keySave && keyInput && keyConsent && keyInfo) {
      keySave.addEventListener('click', async () => {
        try {
          const p = provider.value;
          if (!isByok(p) || !secureAvailable) throw new Error('Diese Funktion ist nicht verfügbar.');
          if (!keyConsent.checked) throw new Error('Bitte der Übermittlung der Lernanfragen zustimmen.');
          await root.VTBYOK.setKey(p, keyInput.value);
          keyInput.value = '';
          const consents = { ...userSettings.aiConsentProviders, [p]: true };
          const changed = { aiProvider: p, aiProxyUrl: urlInput.value.trim(),
            aiFallback: fallback.checked, aiConsentProviders: consents };
          await store.saveSettings(changed);
          userSettings = changed;
          keyInfo.textContent = 'Schlüssel sicher gespeichert. Eigene KI aktiviert.';
          info.textContent = 'Eigener KI-Anbieter ausgewählt.';
        } catch (error) {
          keyInfo.textContent = `Nicht gespeichert: ${error.message}`;
        }
      });
    }
    if (keyRemove && keyInfo) {
      keyRemove.addEventListener('click', async () => {
        try {
          const p = provider.value;
          if (!isByok(p)) return;
          await root.VTBYOK.removeKey(p);
          const consents = { ...userSettings.aiConsentProviders, [p]: false };
          const changed = { ...userSettings, aiConsentProviders: consents,
            aiProvider: userSettings.aiProvider === p ? 'standard' : userSettings.aiProvider };
          await store.saveSettings(changed);
          userSettings = changed;
          provider.value = changed.aiProvider;
          if (keyInput) keyInput.value = '';
          refresh();
          keyInfo.textContent = 'Schlüssel entfernt. Standard-KI wieder ausgewählt.';
          info.textContent = 'Schlüssel gelöscht. Standard-KI aktiv.';
        } catch (_) { keyInfo.textContent = 'Schlüssel konnte nicht entfernt werden.'; }
      });
    }
  }

  root.VTMobileAI = Object.freeze({ setup, aiHelp, staticExplanation, endpoint });
})(window);
