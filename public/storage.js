/**
 * Vokabeltrainer – Speicher-Schicht.
 *
 * Zwei austauschbare Implementierungen mit derselben Schnittstelle:
 *  - ServerStore: spricht die Express-API an (Browser / Electron / PWA im WLAN).
 *  - LocalStore:  alles auf dem Gerät (Capacitor-App auf Android/iOS, oder Browser mit ?local=1).
 *                 Prüf-Logik kommt aus core.js, Daten liegen in Capacitor Preferences
 *                 bzw. localStorage. Nur die KI-Hilfe braucht einen erreichbaren Server (Proxy).
 *
 * `createStore()` wählt automatisch: native Capacitor-App → LocalStore, sonst ServerStore.
 */
(function (root) {
  'use strict';

  const Core = root.VTCore;

  // ── Capacitor-Zugriff ohne Bundler: Plugins über das injizierte Global registrieren ──
  const Cap = root.Capacitor || null;
  const isNative = !!(Cap && typeof Cap.isNativePlatform === 'function' && Cap.isNativePlatform());

  function capPlugin(name) {
    try {
      return Cap && typeof Cap.registerPlugin === 'function' ? Cap.registerPlugin(name) : null;
    } catch (e) {
      return null;
    }
  }

  // ── Key-Value-Adapter: Capacitor Preferences, sonst localStorage ──────────
  function createKv() {
    const prefs = isNative ? capPlugin('Preferences') : null;
    if (prefs) {
      return {
        async get(key) { return (await prefs.get({ key })).value; },
        async set(key, value) { await prefs.set({ key, value }); },
        async remove(key) { await prefs.remove({ key }); }
      };
    }
    return {
      async get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
      async set(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* voll / privat */ } },
      async remove(key) { try { localStorage.removeItem(key); } catch (e) { /* ignorieren */ } }
    };
  }

  async function readJson(response) {
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      return null; // z. B. 404-HTML-Seite statt JSON
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ServerStore – Express-API
  // ═══════════════════════════════════════════════════════════════════════════
  function ServerStore() {
    this.kind = 'server';
    this.canExit = true;        // „Beenden“ fährt den Server herunter
    this.hasImportExport = false;
  }

  ServerStore.prototype.init = async function () {};

  ServerStore.prototype.listDatasets = async function () {
    const response = await fetch('/api/datasets');
    const data = await readJson(response);
    return data || { datasets: [], defaultDataset: '' };
  };

  ServerStore.prototype.createDataset = async function (name) {
    const response = await fetch('/api/datasets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const data = (await readJson(response)) || {};
    return { ...data, exists: response.status === 409, success: response.ok || response.status === 409 };
  };

  ServerStore.prototype.renameDataset = async function (oldName, newName) {
    const response = await fetch('/api/datasets/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldName, newName })
    });
    return { success: response.ok, ...((await readJson(response)) || {}) };
  };

  ServerStore.prototype.deleteDataset = async function (name) {
    const response = await fetch('/api/datasets/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    return { success: response.ok, ...((await readJson(response)) || {}) };
  };

  ServerStore.prototype.getVocabulary = async function (dataset) {
    const response = await fetch(`/api/vocabulary?dataset=${encodeURIComponent(dataset)}`);
    if (!response.ok) {
      throw new Error('Dataset konnte nicht geladen werden.');
    }
    return (await readJson(response)) || [];
  };

  ServerStore.prototype.addWord = async function (dataset, english, german) {
    const response = await fetch('/api/add-word', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ english, german, dataset })
    });
    return { success: response.ok, ...((await readJson(response)) || {}) };
  };

  ServerStore.prototype.checkWord = async function (dataset, question, answer, direction) {
    const response = await fetch('/api/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, answer, direction, dataset })
    });
    return (await readJson(response)) || { correct: false, correctAnswer: 'Unknown word' };
  };

  ServerStore.prototype.getVerbs = async function () {
    const response = await fetch('/api/verbs');
    const data = await readJson(response);
    if (!data || !data.success || !Array.isArray(data.verbs)) {
      throw new Error('Keine Verben geladen.');
    }
    return data.verbs;
  };

  ServerStore.prototype.checkVerb = async function (verb, target, answer) {
    const response = await fetch('/api/verb-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verb, target, answer })
    });
    return (await readJson(response)) || { success: false, message: 'Fehler beim Prüfen des Verbs.' };
  };

  ServerStore.prototype.saveState = async function (state) {
    let response;
    try {
      response = await fetch('/api/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state)
      });
    } catch (error) {
      return { success: false, message: 'Der Server ist nicht erreichbar. Läuft die Anwendung (npm start bzw. node server.js)?' };
    }
    const data = await readJson(response);
    if (response.status === 404) {
      return { success: false, message: 'Der Server kennt die Enden-Funktion nicht. Bitte Anwendung neu starten (npm start bzw. node server.js).' };
    }
    const success = response.ok && !!data && data.success === true;
    return { success, message: (data && data.message) || (success ? '' : `Server-Antwort: HTTP ${response.status}`) };
  };

  ServerStore.prototype.loadState = async function () {
    const response = await fetch('/api/state');
    const data = await readJson(response);
    return data && data.hasState && data.state ? data.state : null;
  };

  ServerStore.prototype.aiHelp = async function (payload) {
    const response = await fetch('/api/ai-helper', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return (await readJson(response)) || { success: false, message: 'Fehler bei der KI-Anfrage.' };
  };

  ServerStore.prototype.getSettings = async function () { return {}; };
  ServerStore.prototype.saveSettings = async function () {};

  // ═══════════════════════════════════════════════════════════════════════════
  // LocalStore – alles auf dem Gerät
  // ═══════════════════════════════════════════════════════════════════════════
  const KEY_DATASETS = 'vt:datasets';   // JSON: ["IT.csv", ...]
  const KEY_DATASET = 'vt:ds:';         // + name → JSON [{english, german}]
  const KEY_STATE = 'vt:state';
  const KEY_SETTINGS = 'vt:settings';   // { aiProxyUrl, defaultDataset }

  function LocalStore() {
    this.kind = 'local';
    this.canExit = false;      // „Speichern“ statt „Beenden“
    this.hasImportExport = true;
    this.kv = createKv();
    this.verbsCache = null;
    this.settings = null;
  }

  LocalStore.prototype.readKey = async function (key, fallback) {
    const raw = await this.kv.get(key);
    if (!raw) {
      return fallback;
    }
    try {
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  };

  LocalStore.prototype.writeKey = function (key, value) {
    return this.kv.set(key, JSON.stringify(value));
  };

  // Erststart: mitgelieferte CSV-Listen aus data/index.json ins Gerät übernehmen.
  LocalStore.prototype.init = async function () {
    this.settings = await this.readKey(KEY_SETTINGS, {});
    const names = await this.readKey(KEY_DATASETS, null);
    if (Array.isArray(names)) {
      return;
    }
    const seeded = [];
    try {
      const response = await fetch('data/index.json');
      const files = response.ok ? await response.json() : [];
      for (const file of files) {
        try {
          const csv = await (await fetch(`data/${encodeURIComponent(file)}`)).text();
          const words = Core.csvToWords(csv);
          const name = Core.normalizeDatasetName(file);
          await this.writeKey(KEY_DATASET + name, words);
          seeded.push(name);
        } catch (e) {
          console.warn('Seed-Dataset übersprungen:', file, e);
        }
      }
    } catch (e) {
      console.warn('Keine Seed-Datasets gefunden:', e);
    }
    if (seeded.length === 0) {
      await this.writeKey(KEY_DATASET + 'Vokabeln.csv', []);
      seeded.push('Vokabeln.csv');
    }
    await this.writeKey(KEY_DATASETS, seeded);
  };

  LocalStore.prototype.datasetNames = function () {
    return this.readKey(KEY_DATASETS, []);
  };

  LocalStore.prototype.listDatasets = async function () {
    const names = (await this.datasetNames()).slice().sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    const wanted = this.settings && this.settings.defaultDataset;
    const defaultDataset = names.includes(wanted) ? wanted : (names[0] || '');
    return { datasets: names.map(name => ({ name, label: Core.datasetLabel(name) })), defaultDataset };
  };

  LocalStore.prototype.createDataset = async function (nameRaw, words) {
    const name = Core.normalizeDatasetName(nameRaw);
    if (!name) {
      return { success: false, message: 'Ungültiger Dateiname.' };
    }
    const names = await this.datasetNames();
    if (names.includes(name)) {
      return { success: true, exists: true, dataset: name, message: 'Dataset existiert bereits.' };
    }
    await this.writeKey(KEY_DATASET + name, Array.isArray(words) ? words : []);
    await this.writeKey(KEY_DATASETS, [...names, name]);
    return { success: true, exists: false, dataset: name };
  };

  LocalStore.prototype.renameDataset = async function (oldName, newNameRaw) {
    const names = await this.datasetNames();
    if (!names.includes(oldName)) {
      return { success: false, message: 'Das ausgewählte Dataset wurde nicht gefunden.' };
    }
    const newName = Core.normalizeDatasetName(newNameRaw, '.csv');
    if (!newName) {
      return { success: false, message: 'Bitte gib einen neuen Namen ein.' };
    }
    if (newName === oldName) {
      return { success: true, dataset: oldName, unchanged: true };
    }
    if (names.includes(newName)) {
      return { success: false, message: 'Ein Dataset mit diesem Namen existiert bereits.' };
    }
    const words = await this.readKey(KEY_DATASET + oldName, []);
    await this.writeKey(KEY_DATASET + newName, words);
    await this.kv.remove(KEY_DATASET + oldName);
    await this.writeKey(KEY_DATASETS, names.map(n => (n === oldName ? newName : n)));
    return { success: true, dataset: newName };
  };

  LocalStore.prototype.deleteDataset = async function (name) {
    const names = await this.datasetNames();
    if (!names.includes(name)) {
      return { success: false, message: 'Dataset nicht gefunden.' };
    }
    await this.kv.remove(KEY_DATASET + name);
    await this.writeKey(KEY_DATASETS, names.filter(n => n !== name));
    return { success: true, dataset: name };
  };

  LocalStore.prototype.getVocabulary = async function (dataset) {
    const names = await this.datasetNames();
    if (!names.includes(dataset)) {
      throw new Error('Dataset konnte nicht geladen werden.');
    }
    return this.readKey(KEY_DATASET + dataset, []);
  };

  LocalStore.prototype.addWord = async function (dataset, englishRaw, germanRaw) {
    const english = (englishRaw || '').trim();
    const german = (germanRaw || '').trim();
    if (!english || !german) {
      return { success: false, message: 'Beide Felder müssen ausgefüllt sein.' };
    }
    let words;
    try {
      words = await this.getVocabulary(dataset);
    } catch (e) {
      return { success: false, message: 'Dataset wurde nicht gefunden.' };
    }
    if (words.some(w => w.english.toLowerCase() === english.toLowerCase())) {
      return { success: false, message: 'Dieses Wort existiert bereits.' };
    }
    const word = { english, german };
    await this.writeKey(KEY_DATASET + dataset, [...words, word]);
    return { success: true, word, dataset };
  };

  LocalStore.prototype.checkWord = async function (dataset, question, answer, direction) {
    let words = [];
    try {
      words = await this.getVocabulary(dataset);
    } catch (e) {
      // unbekanntes Dataset → 'Unknown word'
    }
    return Core.checkWord(words, question, answer, direction);
  };

  LocalStore.prototype.getVerbs = async function () {
    if (!this.verbsCache) {
      const response = await fetch('verb-data.json');
      if (!response.ok) {
        throw new Error('Keine Verben geladen.');
      }
      this.verbsCache = await response.json();
    }
    return this.verbsCache;
  };

  LocalStore.prototype.checkVerb = async function (verb, target, answer) {
    if (!Core.VERB_TARGETS.includes(target)) {
      return { success: false, message: 'Ungültige Frageart.' };
    }
    const entry = Core.findVerbEntry(await this.getVerbs(), verb);
    if (!entry) {
      return { success: false, message: 'Dieses Verb ist nicht in der Liste der unregelmäßigen Verben enthalten.' };
    }
    return { success: true, ...Core.checkVerb(entry, target, answer) };
  };

  LocalStore.prototype.saveState = async function (state) {
    const record = Core.buildStateRecord(state, '');
    await this.writeKey(KEY_STATE, record);
    if (record.dataset) {
      await this.saveSettings({ defaultDataset: record.dataset });
    }
    return { success: true, message: 'Lernstand gespeichert.' };
  };

  LocalStore.prototype.loadState = async function () {
    const state = await this.readKey(KEY_STATE, null);
    return state && typeof state === 'object' && state.dataset ? state : null;
  };

  LocalStore.prototype.getSettings = async function () {
    if (!this.settings) {
      this.settings = await this.readKey(KEY_SETTINGS, {});
    }
    return this.settings;
  };

  LocalStore.prototype.saveSettings = async function (patch) {
    this.settings = { ...(await this.getSettings()), ...patch };
    await this.writeKey(KEY_SETTINGS, this.settings);
  };

  // Mobile KI: ausschließlich neuer KI-Router; niemals alte ungeschützte
  // WLAN-HTTP-Fallbacks verwenden oder API-Schlüssel lokal unverschlüsselt speichern.
  LocalStore.prototype.aiHelp = async function (payload) {
    if (root.VTMobileAI) return root.VTMobileAI.aiHelp(payload);
    return { success: false, message: 'Mobile KI-Komponente fehlt. Bitte App aktualisieren.' };
  };

  // ── Import / Export (nur lokal) ───────────────────────────────────────────
  LocalStore.prototype.importCsv = async function (fileName, text) {
    const words = Core.csvToWords(text);
    if (words.length === 0) {
      return { success: false, message: 'Keine Vokabeln in der Datei gefunden (Spalten English, German).' };
    }
    const base = Core.normalizeDatasetName(fileName) || 'Import.csv';
    const names = await this.datasetNames();
    let name = base;
    let counter = 2;
    while (names.includes(name)) {
      name = base.replace(/\.csv$/i, '') + `_${counter++}.csv`;
    }
    await this.createDataset(name, words);
    return { success: true, dataset: name, count: words.length };
  };

  LocalStore.prototype.exportCsv = async function (dataset) {
    const words = await this.getVocabulary(dataset);
    const csv = Core.wordsToCsv(words);
    const fileName = dataset.replace(/\.xlsx$/i, '.csv');

    const Filesystem = isNative ? capPlugin('Filesystem') : null;
    const Share = isNative ? capPlugin('Share') : null;
    if (Filesystem && Share) {
      const written = await Filesystem.writeFile({ path: fileName, data: csv, directory: 'CACHE', encoding: 'utf8' });
      await Share.share({ title: fileName, url: written.uri, dialogTitle: 'Dataset exportieren' });
      return { success: true, shared: true };
    }

    // Browser: als Download anbieten
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { success: true, shared: false };
  };

  // ── Auswahl ───────────────────────────────────────────────────────────────
  function createStore() {
    const params = new URLSearchParams(root.location ? root.location.search : '');
    const forceLocal = params.get('local') === '1' || (root.location && root.location.protocol === 'file:');
    return isNative || forceLocal ? new LocalStore() : new ServerStore();
  }

  root.VTStorage = { createStore, ServerStore, LocalStore, isNative };
}(typeof self !== 'undefined' ? self : this));
