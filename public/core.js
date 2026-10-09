/**
 * Vokabeltrainer – gemeinsame Kernlogik (Browser, Capacitor-App und Node-Server).
 *
 * Prüf-Regeln für Wörter und unregelmäßige Verben, Dataset-Namen und CSV.
 * Läuft als UMD: im Browser als `window.VTCore`, in Node per `require('./public/core.js')`.
 * Keine DOM- und keine Dateisystem-Zugriffe – alles hier ist reine Logik.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.VTCore = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERB_TARGETS = ['all', 'past', 'participle', 'meaning', 'infinitive'];

  // ── Verben ────────────────────────────────────────────────────────────────

  // Varianten in einem Form-Feld ("was/were", "bid, bade", "borne/born (AE)") in einzelne erlaubte Antworten aufteilen
  function splitVerbVariants(value) {
    return (value || '').toString()
      .split(/[,\/]/)
      .map(part => part.replace(/\s*\(AE\)\s*/g, ' ').replace(/\s*\(aus\)\s*/g, ' ').trim())
      .filter(part => part.length > 0);
  }

  // Deutsche Bedeutung: flexibel prüfen ("tragen" zählt für "etwas tragen (literarisch)").
  function meaningMatches(expectedRaw, answer) {
    const clean = value => (value || '').toString()
      .replace(/\([^)]*\)/g, ' ')
      .toLowerCase()
      .replace(/[.!?]+/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 0);

    const expectedWords = new Set(clean(expectedRaw));
    const answerWords = clean(answer);
    if (answerWords.length === 0) {
      return false;
    }

    const hitCount = answerWords.filter(w => expectedWords.has(w)).length;
    if (hitCount / answerWords.length >= 0.7) {
      return true;
    }
    // Einzelwort-Treffer innerhalb der erwarteten Phrase (z. B. "geben" in "etwas geben").
    // Mindestens 4 Zeichen und ein ganzes erwartetes Wort, sonst zählt "e" für alles.
    if (answerWords.length === 1) {
      const core = answerWords[0];
      if (core.length >= 4 && expectedWords.has(core)) {
        return true;
      }
    }
    return false;
  }

  function findVerbEntry(verbs, infinitive) {
    const clean = (infinitive || '').toString().trim().toLowerCase();
    return (verbs || []).find(v => v.infinitive.toLowerCase() === clean) || null;
  }

  /**
   * Antwort zu einem Verb prüfen.
   * target 'all': alle drei Formen in einer Antwort ("be, was/were, been");
   * sonst genau eine Form bzw. die deutsche Bedeutung.
   */
  function checkVerb(entry, target, answerRaw) {
    const answer = (answerRaw || '').toString().trim();
    if (!entry || !answer || !VERB_TARGETS.includes(target)) {
      return { correct: false, expected: '', accepted: [], target, verb: entry };
    }

    if (target === 'all') {
      // Jede erwartete Form (inkl. Varianten wie „was/were“ oder „born (AE)“) muss vorkommen;
      // fremde zusätzliche Wörter zählen als falsch.
      const forms = [entry.infinitive, entry.past, entry.participle];
      const variantsFor = form => splitVerbVariants(form).map(v => v.toLowerCase());
      const allVariants = [...new Set(forms.flatMap(variantsFor))];
      // Auch "/" und "·" trennen, damit „be, was/were, been“ so eingegeben werden
      // kann, wie die Lösung angezeigt wird.
      const answerTokens = answer.toLowerCase()
        .split(/[\s,;\/·–-]+/)
        .map(token => token.replace(/\s*\(ae\)\s*/g, '').replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      const covered = forms.every(form => variantsFor(form).some(v => answerTokens.includes(v)));
      const noStrayTokens = answerTokens.length > 0 && answerTokens.every(token => allVariants.includes(token));
      return {
        correct: covered && noStrayTokens,
        expected: forms.join(' · '),
        accepted: allVariants,
        target,
        verb: entry
      };
    }

    const expectedRaw = target === 'past' ? entry.past
      : target === 'participle' ? entry.participle
        : target === 'infinitive' ? entry.infinitive
          : entry.german;
    const accepted = splitVerbVariants(expectedRaw).map(v => v.toLowerCase());
    const correct = target === 'meaning'
      ? (accepted.includes(answer.toLowerCase()) || meaningMatches(expectedRaw, answer))
      : accepted.includes(answer.toLowerCase());

    return { correct, expected: expectedRaw, accepted, target, verb: entry };
  }

  // ── Wörter ────────────────────────────────────────────────────────────────

  /**
   * Übersetzung prüfen. direction 'de-en': deutsches Wort gezeigt, englische Antwort erwartet.
   * Liefert { correct, correctAnswer } – correctAnswer 'Unknown word', wenn die Frage nicht im Dataset ist.
   */
  function checkWord(words, questionRaw, answerRaw, direction) {
    const question = (questionRaw || '').toString().trim().toLowerCase();
    const answer = (answerRaw || '').toString().trim().toLowerCase();
    if (!question || !answer) {
      return { correct: false, correctAnswer: 'Unknown word' };
    }

    const word = direction === 'en-de'
      ? (words || []).find(v => v.english.toLowerCase() === question)
      : (words || []).find(v => v.german.toLowerCase() === question);
    if (!word) {
      return { correct: false, correctAnswer: 'Unknown word' };
    }

    const expected = direction === 'en-de' ? word.german : word.english;
    return { correct: expected.toLowerCase() === answer, correctAnswer: expected };
  }

  // ── Dataset-Namen ─────────────────────────────────────────────────────────

  function normalizeDatasetName(name, defaultExtension) {
    const ext0 = defaultExtension || '.csv';
    const safeName = (name || '').toString().split(/[\\/]/).pop().trim();
    if (!safeName) {
      return null;
    }
    const normalized = safeName.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
    if (/\.(csv|xlsx)$/i.test(normalized)) {
      return normalized;
    }
    return `${normalized}${ext0}`;
  }

  function datasetLabel(name) {
    return (name || '').replace(/\.(csv|xlsx)$/i, '');
  }

  // ── CSV ───────────────────────────────────────────────────────────────────

  function escapeCsv(value) {
    const text = (value === undefined || value === null ? '' : value).toString().trim();
    if (text.includes(',') || text.includes('"') || text.includes('\n')) {
      return '"' + text.replace(/"/g, '""') + '"';
    }
    return text;
  }

  // Einfacher RFC-4180-Parser: Anführungszeichen, "" als Escape, CRLF/LF.
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    const src = (text || '').replace(/^﻿/, '');

    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (quoted) {
        if (ch === '"') {
          if (src[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            quoted = false;
          }
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        quoted = true;
      } else if (ch === ',' || ch === ';') {
        row.push(field);
        field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && src[i + 1] === '\n') {
          i++;
        }
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += ch;
      }
    }
    if (field.length > 0 || row.length > 0) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }

  const ENGLISH_HEADERS = ['english', 'englisch'];
  const GERMAN_HEADERS = ['german', 'deutsch'];

  // CSV-Text → [{ english, german }]. Spalten per Kopfzeile (English/German, Englisch/Deutsch),
  // sonst die ersten beiden Spalten. Leere Zeilen werden übersprungen.
  function csvToWords(text) {
    const rows = parseCsv(text).filter(r => r.some(cell => cell.trim().length > 0));
    if (rows.length === 0) {
      return [];
    }

    const header = rows[0].map(h => h.trim().toLowerCase());
    let englishIndex = header.findIndex(h => ENGLISH_HEADERS.includes(h));
    let germanIndex = header.findIndex(h => GERMAN_HEADERS.includes(h));
    let dataRows = rows;
    if (englishIndex >= 0 || germanIndex >= 0) {
      dataRows = rows.slice(1);
    }
    if (englishIndex < 0) englishIndex = 0;
    if (germanIndex < 0) germanIndex = englishIndex === 0 ? 1 : 0;

    return dataRows
      .map(r => ({
        english: (r[englishIndex] || '').trim(),
        german: (r[germanIndex] || '').trim()
      }))
      .filter(w => w.english && w.german);
  }

  function wordsToCsv(words) {
    const lines = ['English,German'];
    for (const w of words || []) {
      lines.push(`${escapeCsv(w.english)},${escapeCsv(w.german)}`);
    }
    return lines.join('\n') + '\n';
  }

  // ── Lernstand ─────────────────────────────────────────────────────────────

  // Beliebige Client-Daten in ein sauberes Lernstand-Objekt überführen.
  function buildStateRecord(state, fallbackDataset) {
    const answeredWords = state && state.answeredWords ? state.answeredWords : {};
    return {
      savedAt: new Date().toISOString(),
      mode: state && state.mode === 'tenses' ? 'tenses' : 'words',
      dataset: state && state.dataset ? state.dataset : (fallbackDataset || ''),
      direction: state && state.direction === 'en-de' ? 'en-de' : 'de-en',
      correctCount: Number(state && state.correctCount) || 0,
      incorrectCount: Number(state && state.incorrectCount) || 0,
      totalCount: Number(state && state.totalCount) || 0,
      answeredWords: {
        correct: answeredWords && Array.isArray(answeredWords.correct) ? answeredWords.correct : [],
        incorrect: answeredWords && Array.isArray(answeredWords.incorrect) ? answeredWords.incorrect : []
      },
      incorrectWords: state && Array.isArray(state.incorrectWords) ? state.incorrectWords : [],
      wordQueue: state && Array.isArray(state.wordQueue) ? state.wordQueue : []
    };
  }

  return {
    VERB_TARGETS,
    splitVerbVariants,
    meaningMatches,
    findVerbEntry,
    checkVerb,
    checkWord,
    normalizeDatasetName,
    datasetLabel,
    escapeCsv,
    parseCsv,
    csvToWords,
    wordsToCsv,
    buildStateRecord
  };
}));
