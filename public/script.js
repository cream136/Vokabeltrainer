let vocabulary = [];
let wordQueue = [];
let currentWord = null;
let correctCount = 0;
let incorrectCount = 0;
let totalCount = 0;
let answeredWords = { correct: [], incorrect: [] };
let selectedDataset = '';
let learningDirection = 'de-en';

// Speicher-Schicht (storage.js): ServerStore (Express-API) oder LocalStore (Capacitor-App / ?local=1)
let store = null;

// de-en: deutsches Wort wird gezeigt, englische Übersetzung ist gefragt – en-de umgekehrt.
const directionConfig = {
  'de-en': {
    questionKey: 'german',
    answerKey: 'english',
    questionLabel: 'Deutsch',
    answerLabel: 'Englisch',
    banner: 'Deutsch → Englisch',
    answerPlaceholder: 'Englische Übersetzung'
  },
  'en-de': {
    questionKey: 'english',
    answerKey: 'german',
    questionLabel: 'Englisch',
    answerLabel: 'Deutsch',
    banner: 'Englisch → Deutsch',
    answerPlaceholder: 'Deutsche Übersetzung'
  }
};

// ── Lernmodus „Zeitformen“ (unregelmäßige Verben) ──────────────────────────
let learnMode = 'words'; // 'words' | 'tenses'
let verbs = [];
let verbQueue = [];
let currentVerb = null;
let verbTarget = 'all'; // 'all' (Standard: Deutsches Wort → alle 3 Formen) | 'past' | 'participle' | 'infinitive' | 'meaning'
let lastVerbWrongAnswer = '';

const verbTargetLabels = {
  past: 'Simple Past (1. Form)',
  participle: 'Past Participle (2. Form)',
  infinitive: 'Infinitiv (Grundform)',
  meaning: 'Bedeutung'
};

// Effektive Frageart der aktuellen Frage. In „Alle 3“-Modus hat jede Warteschlangen-Einträge
// eine eigene Ziel-Form (item.target), sonst gilt die global gewählte Frageart.
function activeVerbTarget() {
  return (currentVerb && currentVerb.target) || verbTarget;
}

function getVerbTargetLabel() {
  const target = activeVerbTarget();
  if (target === 'all') {
    return 'alle 3 Formen';
  }
  return verbTargetLabels[target] || 'Simple Past';
}

function renderVerbQuestionText(verb) {
  // Die Antwort darf nicht verraten werden:
  // „all“ → nur das deutsche Wort zeigen, „Bedeutung“ → nur die englische Form,
  // „Infinitiv“ → nur 1. Form + Deutsch (keine englische Grundform).
  const target = activeVerbTarget();
  if (target === 'all') {
    return verb.german;
  }
  if (target === 'meaning') {
    return verb.infinitive;
  }
  if (target === 'infinitive') {
    return `${verb.past}  (${verb.german})`;
  }
  return `${verb.infinitive}  (${verb.german})`;
}

function getDirectionConfig() {
  return directionConfig[learningDirection] || directionConfig['de-en'];
}

function updateAnswerInput() {
  const answerInput = document.getElementById('german-input');
  if (learnMode === 'tenses') {
    const target = activeVerbTarget();
    answerInput.placeholder = target === 'all'
      ? 'z. B. go, went, gone'
      : target === 'meaning'
        ? 'Deutsche Bedeutung'
        : target === 'infinitive'
          ? 'Englische Grundform (Infinitiv)'
          : 'Englische Form';
  } else {
    answerInput.placeholder = getDirectionConfig().answerPlaceholder;
  }
  updateQuizLabels();
}

function updateQuizLabels() {
  updateModeUI();
}

function updateModeUI() {
  const directionBanner = document.getElementById('direction-banner');
  const questionLabel = document.getElementById('question-label');
  const answerLabel = document.getElementById('answer-label');
  const answerInput = document.getElementById('german-input');

  if (learnMode === 'tenses') {
    const target = activeVerbTarget();
    if (target === 'all') {
      directionBanner.textContent = 'Deutsch → alle 3 Formen';
      questionLabel.textContent = 'Deutsch';
      answerLabel.textContent = 'Infinitiv · Simple Past · Past Participle';
      answerInput.placeholder = 'go, went, gone';
    } else if (target === 'infinitive') {
      directionBanner.textContent = 'Simple Past → Infinitiv';
      questionLabel.textContent = 'Simple Past (1. Form)';
      answerLabel.textContent = getVerbTargetLabel();
      answerInput.placeholder = 'Englische Grundform (Infinitiv)';
    } else {
      directionBanner.textContent = `Infinitiv → ${getVerbTargetLabel()}`;
      questionLabel.textContent = 'Verb (Infinitiv, Grundform)';
      answerLabel.textContent = getVerbTargetLabel();
      answerInput.placeholder = target === 'meaning' ? 'Deutsche Bedeutung' : 'Englische Form';
    }
    document.querySelector('.ai-desc').textContent =
      'Der KI-Coach erklärt alle drei Formen, Form-Gruppen und Eselsbrücken (Basis: englisch-hilfen.de).';
  } else {
    const config = getDirectionConfig();
    directionBanner.textContent = config.banner;
    questionLabel.textContent = config.questionLabel;
    answerLabel.textContent = config.answerLabel;
    answerInput.placeholder = config.answerPlaceholder;
    document.querySelector('.ai-desc').textContent = '';
  }
  updateAiButtonLabel();
}

function updateAiButtonLabel() {
  const label = document.getElementById('ai-btn-label');
  if (!label) {
    return;
  }
  label.textContent = learnMode === 'tenses'
    ? (lastVerbWrongAnswer ? 'Fehler erklären' : 'Erklären')
    : 'KI-Info';
}

// ── Ergebnis-Karte & Button-Zustände ───────────────────────────────────────
const ICON_CHECK = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>';
const ICON_CROSS = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"></path></svg>';

function escapeHtml(text) {
  return (text || '').toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// kind: 'correct' | 'incorrect'. chips: Liste von Strings (z. B. die 3 Verbformen).
function showResult(kind, title, detailHtml = '', chips = []) {
  const resultDiv = document.getElementById('result');
  const chipsHtml = chips.length
    ? `<div class="chips">${chips.map(c => `<span class="chip">${escapeHtml(c)}</span>`).join('')}</div>`
    : '';
  resultDiv.innerHTML =
    `<div class="result-title">${kind === 'correct' ? ICON_CHECK : ICON_CROSS}<span>${escapeHtml(title)}</span></div>` +
    (detailHtml ? `<div class="result-detail">${detailHtml}</div>` : '') +
    chipsHtml;
  resultDiv.className = kind;
  document.getElementById('german-input').classList.toggle('is-right', kind === 'correct');
  document.getElementById('german-input').classList.toggle('is-wrong', kind === 'incorrect');
}

// Nach dem Prüfen: „Weiter“ statt „Überspringen“, Prüfen gesperrt.
function setAnswered(answered) {
  document.getElementById('check-btn').disabled = answered;
  document.getElementById('next-btn').classList.toggle('hidden', !answered);
  document.getElementById('next-question-btn').classList.toggle('hidden', answered);
  if (!answered) {
    const input = document.getElementById('german-input');
    input.classList.remove('is-right', 'is-wrong');
  }
}

// ── Design: Nachtmodus | Karteikarte (pro Gerät gespeichert) ──────────────
const THEMES = { nacht: '#0E1013', karte: '#EEF1F6' };

function applyTheme(theme) {
  const name = THEMES[theme] ? theme : 'nacht';
  document.documentElement.dataset.theme = name;
  try {
    localStorage.setItem('vt-theme', name);
  } catch (e) {
    // Privater Modus o. ä. – dann gilt die Wahl nur für diese Sitzung.
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', THEMES[name]);
  }
  document.querySelectorAll('#theme-toggle .seg-btn').forEach(btn => {
    const active = btn.dataset.theme === name;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-checked', active ? 'true' : 'false');
  });
  const quick = document.getElementById('theme-btn');
  if (quick) {
    quick.title = name === 'nacht' ? 'Zu Karteikarte wechseln' : 'Zu Nachtmodus wechseln';
    quick.setAttribute('aria-label', quick.title);
  }
}

function toggleTheme() {
  applyTheme(document.documentElement.dataset.theme === 'nacht' ? 'karte' : 'nacht');
}

function setTab(tab) {
  document.body.dataset.tab = tab;
  document.querySelectorAll('.bottom-nav .nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  window.scrollTo({ top: 0 });
}

function updateProgress() {
  const total = learnMode === 'tenses' ? verbs.length : vocabulary.length;
  const answered = answeredWords.correct.length + answeredWords.incorrect.length;
  const ok = answeredWords.correct.length;
  const bad = answeredWords.incorrect.length;
  const rest = Math.max(total - answered, 0);

  document.getElementById('progress-ok').style.flexGrow = ok;
  document.getElementById('progress-bad').style.flexGrow = bad;
  document.getElementById('progress-rest').style.flexGrow = total > 0 ? rest : 1;
  document.getElementById('progress-count').textContent = `${Math.min(answered, total)} / ${total}`;
  document.getElementById('progress-accuracy').textContent = totalCount > 0
    ? `${Math.round((correctCount / totalCount) * 100)} % richtig`
    : '–';
}

function syncModeUI() {
  const isTenses = learnMode === 'tenses';
  document.querySelectorAll('#mode-toggle .seg-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === learnMode);
  });
  document.getElementById('dataset-field').classList.toggle('hidden', isTenses);
  document.getElementById('direction-field').classList.toggle('hidden', isTenses);
  document.getElementById('tenses-section').classList.toggle('hidden', !isTenses);
  document.getElementById('dataset-section').classList.toggle('hidden', isTenses);
  document.getElementById('addword-section').classList.toggle('hidden', isTenses);
  document.getElementById('total-words-label').textContent = isTenses ? 'Verben gesamt' : 'Wörter gesamt';
  updateModeUI();
}

function setLearnMode(mode) {
  if (mode === learnMode) {
    return;
  }
  learnMode = mode;
  lastVerbWrongAnswer = '';
  syncModeUI();
  // In dem neuen Modus eine frische Runde starten.
  if (learnMode === 'tenses') {
    resetVerbRound();
  } else {
    resetQuiz(selectedDataset);
  }
}

function shuffle(array) {
  const result = array.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function rebuildQueue() {
  wordQueue = shuffle(vocabulary.map(item => ({ ...item })));
}

function rebuildVerbQueue() {
  if (verbs.length === 0) {
    return;
  }
  if (verbTarget === 'all') {
    // Standard-Format: Deutsches Wort → alle 3 Formen (eine Frage pro Verb).
    verbQueue = shuffle(verbs.map(verb => ({ ...verb, target: 'all' })));
    return;
  }
  verbQueue = shuffle(verbs.map(verb => ({ ...verb, target: verbTarget })));
}

// keepQueue: eine wiederhergestellte Warteschlange nicht durch eine neu gemischte ersetzen.
async function loadVerbs({ keepQueue = false } = {}) {
  try {
    verbs = await store.getVerbs();
    document.getElementById('total-words').textContent = verbs.length;
    if (!keepQueue || verbQueue.length === 0) {
      rebuildVerbQueue();
    }
    renderUpcomingWords();
    updateProgress();

    if (verbs.length === 0) {
      document.getElementById('english-word').textContent = 'Keine Verben verfügbar';
      document.getElementById('check-btn').disabled = true;
      return;
    }
    showNextWord();
  } catch (error) {
    console.error('Fehler beim Laden der Verben:', error);
    document.getElementById('result').textContent = 'Fehler beim Laden der unregelmäßigen Verben.';
    document.getElementById('result').className = 'incorrect';
  }
}

function resetVerbRound() {
  currentVerb = null;
  lastVerbWrongAnswer = '';
  correctCount = 0;
  incorrectCount = 0;
  totalCount = 0;
  answeredWords = { correct: [], incorrect: [] };
  updateStats();
  document.getElementById('german-input').disabled = false;
  document.getElementById('result').textContent = 'Runde zurückgesetzt. Lade Verben...';
  document.getElementById('result').className = 'hint';
  setAnswered(false);
  resetAiPanel();
  loadVerbs();
}

async function loadDatasets() {
  try {
    const data = await store.listDatasets();
    const select = document.getElementById('dataset-select');
    select.innerHTML = '';

    if (!data.datasets || data.datasets.length === 0) {
      select.innerHTML = '<option value="">Keine Datensätze gefunden</option>';
      selectedDataset = '';
      return;
    }

    data.datasets.forEach(dataset => {
      const option = document.createElement('option');
      option.value = dataset.name;
      option.textContent = dataset.label;
      if (dataset.name === data.defaultDataset) {
        option.selected = true;
      }
      select.appendChild(option);
    });

    selectedDataset = data.defaultDataset || data.datasets[0].name;
    updateDatasetLabel();
    return data;
  } catch (error) {
    console.error('Fehler beim Laden der Datensätze:', error);
  }
}

// Name des aktiven Datasets im „Listen“-Tab anzeigen (dort gibt es keine Auswahlbox).
function updateDatasetLabel() {
  const label = document.getElementById('current-dataset-label');
  if (label) {
    label.textContent = selectedDataset ? selectedDataset.replace(/\.(csv|xlsx)$/i, '') : '–';
  }
}

async function createDataset() {
  const input = document.getElementById('dataset-name');
  const resultDiv = document.getElementById('result');
  const name = input.value.trim();

  if (!name) {
    resultDiv.textContent = 'Bitte vergib einen Namen für das neue Dataset.';
    resultDiv.className = 'hint';
    return;
  }

  try {
    const data = await store.createDataset(name);
    if (!data.success) {
      resultDiv.textContent = data.message || 'Fehler beim Erstellen des Datasets.';
      resultDiv.className = 'incorrect';
      return;
    }

    const datasets = await loadDatasets();
    selectedDataset = data.dataset || name;
    document.getElementById('dataset-select').value = selectedDataset;
    await loadVocabulary(selectedDataset);

    resultDiv.textContent = data.exists ?
      `Dataset existiert bereits: ${selectedDataset}` :
      `Dataset erstellt: ${selectedDataset}`;
    resultDiv.className = 'correct';
    input.value = '';
  } catch (error) {
    resultDiv.textContent = 'Fehler beim Erstellen des Datasets. Bitte versuche es erneut.';
    resultDiv.className = 'incorrect';
    console.error('Create dataset failed', error);
  }
}

async function renameDataset() {
  const input = document.getElementById('dataset-rename');
  const resultDiv = document.getElementById('result');
  const name = input.value.trim();

  if (!selectedDataset) {
    resultDiv.textContent = 'Bitte wähle zuerst ein Dataset aus.';
    resultDiv.className = 'hint';
    return;
  }

  if (!name) {
    resultDiv.textContent = 'Bitte gib einen neuen Namen ein.';
    resultDiv.className = 'hint';
    return;
  }

  try {
    const data = await store.renameDataset(selectedDataset, name);
    if (!data.success) {
      resultDiv.textContent = data.message || 'Fehler beim Umbenennen des Datasets.';
      resultDiv.className = 'incorrect';
      return;
    }

    const datasets = await loadDatasets();
    selectedDataset = data.dataset;
    document.getElementById('dataset-select').value = selectedDataset;
    await loadVocabulary(selectedDataset);

    resultDiv.textContent = `Dataset umbenannt in ${selectedDataset}`;
    resultDiv.className = 'correct';
    input.value = '';
  } catch (error) {
    resultDiv.textContent = 'Fehler beim Umbenennen des Datasets. Bitte versuche es erneut.';
    resultDiv.className = 'incorrect';
    console.error('Rename dataset failed', error);
  }
}

async function deleteDataset() {
  const resultDiv = document.getElementById('result');

  if (!selectedDataset) {
    resultDiv.textContent = 'Bitte wähle zuerst ein Dataset aus.';
    resultDiv.className = 'hint';
    return;
  }

  const confirmed = confirm(`Möchtest du das Dataset "${selectedDataset}" wirklich löschen?`);
  if (!confirmed) {
    return;
  }

  try {
    const data = await store.deleteDataset(selectedDataset);
    if (!data.success) {
      resultDiv.textContent = data.message || 'Fehler beim Löschen des Datasets.';
      resultDiv.className = 'incorrect';
      return;
    }

    const datasets = await loadDatasets();
    selectedDataset = (datasets && datasets.defaultDataset) || (datasets && datasets.datasets && datasets.datasets[0] && datasets.datasets[0].name) || '';
    document.getElementById('dataset-select').value = selectedDataset;

    if (selectedDataset) {
      await loadVocabulary(selectedDataset);
    } else {
      vocabulary = [];
      wordQueue = [];
      renderUpcomingWords();
      document.getElementById('english-word').textContent = 'Keine Wörter verfügbar';
      document.getElementById('check-btn').disabled = true;
    }

    resultDiv.textContent = `Dataset gelöscht: ${data.dataset}`;
    resultDiv.className = 'correct';
  } catch (error) {
    resultDiv.textContent = 'Fehler beim Löschen des Datasets. Bitte versuche es erneut.';
    resultDiv.className = 'incorrect';
    console.error('Delete dataset failed', error);
  }
}

// Vokabeln eines Datasets holen, ohne die laufende Runde anzufassen.
async function fetchVocabulary(dataset) {
  vocabulary = await store.getVocabulary(dataset);
  document.getElementById('total-words').textContent = vocabulary.length;
}

async function loadVocabulary(dataset = selectedDataset) {
  if (!dataset) {
    await loadDatasets();
    dataset = selectedDataset;
  }

  try {
    await fetchVocabulary(dataset);
    updateStats();
    rebuildQueue();
    renderUpcomingWords();

    if (vocabulary.length === 0) {
      const label = document.querySelector('#dataset-select option:checked')?.textContent || 'Ausgewählter Datensatz';
      alert(`Keine Vokabeln im Datensatz ${label} gefunden.`);
      document.getElementById('english-word').textContent = 'Keine Wörter verfügbar';
      document.getElementById('check-btn').disabled = true;
      return;
    }
    showNextWord();
  } catch (error) {
    console.error('Fehler beim Laden der Vokabeln:', error);
    document.getElementById('result').textContent = 'Fehler beim Laden des Datensatzes.';
    document.getElementById('result').className = 'incorrect';
  }
}

function updateStats() {
  document.getElementById('correct-count').textContent = correctCount;
  document.getElementById('incorrect-count').textContent = incorrectCount;
  document.getElementById('total-count').textContent = totalCount;

  updateWordLists();
  updateProgress();
}

function updateWordLists() {
  const correctList = document.getElementById('correct-words');
  const incorrectList = document.getElementById('incorrect-words');

  correctList.innerHTML = '';
  incorrectList.innerHTML = '';

  answeredWords.correct.forEach(word => {
    const item = document.createElement('div');
    item.className = 'word-list-item';
    item.textContent = formatAnsweredItem(word);
    correctList.appendChild(item);
  });

  answeredWords.incorrect.forEach(word => {
    const item = document.createElement('div');
    item.className = 'word-list-item';
    item.textContent = formatAnsweredItem(word);
    incorrectList.appendChild(item);
  });
}

function formatAnsweredItem(entry) {
  if (entry && entry.infinitive) {
    return `${entry.infinitive} – ${entry.german}  (Past: ${entry.past} · Partizip: ${entry.participle})`;
  }
  return `${entry.english} → ${entry.german}`;
}

function renderUpcomingWords() {
  const list = document.getElementById('upcoming-list');
  list.innerHTML = '';

  const seen = new Set();
  const nextWords = [];
  const pushUnique = item => {
    // Zeitformen-Modus: „swim → past“ und „swim → infinitive“ sind zwei verschiedene Fragen,
    // deshalb wird die Ziel-Form in den Dedupe-Key aufgenommen.
    const key = item.infinitive
      ? `${item.infinitive}|${item.target || verbTarget}`
      : `${item.english}|${item.german}`;
    if (seen.has(key)) return;
    seen.add(key);
    nextWords.push(item);
  };
  const queue = learnMode === 'tenses' ? verbQueue : wordQueue;
  for (const item of queue) {
    if (nextWords.length >= 3) break;
    pushUnique(item);
  }

  if (nextWords.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'upcoming-item';
    empty.textContent = learnMode === 'tenses'
      ? 'Keine bevorstehenden Verben verfügbar.'
      : 'Keine bevorstehenden Wörter verfügbar.';
    list.appendChild(empty);
    return;
  }

  // Kompakte Chips: „Als nächstes“ – ohne die Antwort zu verraten.
  nextWords.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'upcoming-item';
    if (item.infinitive) {
      const itemTarget = item.target || verbTarget;
      row.textContent = itemTarget === 'all' || itemTarget === 'infinitive'
        ? item.german
        : item.infinitive;
    } else {
      const config = getDirectionConfig();
      row.textContent = item[config.questionKey];
    }
    if (index === 0) {
      row.textContent = `Danach: ${row.textContent}`;
    }
    list.appendChild(row);
  });
}

async function addNewWord() {
  const englishInput = document.getElementById('new-english');
  const germanInput = document.getElementById('new-german');
  const english = englishInput.value.trim();
  const german = germanInput.value.trim();
  const resultDiv = document.getElementById('result');

  if (!english || !german) {
    resultDiv.textContent = 'Bitte beide Felder ausfüllen.';
    resultDiv.className = 'hint';
    return;
  }

  try {
    const data = await store.addWord(selectedDataset, english, german);
    if (!data.success) {
      resultDiv.textContent = data.message || 'Fehler beim Hinzufügen.';
      resultDiv.className = 'incorrect';
      return;
    }

    vocabulary.push(data.word);
    wordQueue.push(data.word);
    document.getElementById('total-words').textContent = vocabulary.length;
    renderUpcomingWords();
    englishInput.value = '';
    germanInput.value = '';
    englishInput.focus();

    resultDiv.textContent = `Wort hinzugefügt: ${english} → ${german}`;
    resultDiv.className = 'correct';
  } catch (error) {
    resultDiv.textContent = 'Fehler beim Hinzufügen. Bitte versuche es erneut.';
    resultDiv.className = 'incorrect';
    console.error('Add word failed', error);
  }
}

function resetQuiz(dataset = selectedDataset) {
  if (dataset) {
    selectedDataset = dataset;
  }

  wordQueue = [];
  currentWord = null;
  correctCount = 0;
  incorrectCount = 0;
  totalCount = 0;
  answeredWords = { correct: [], incorrect: [] };
  updateStats();
  document.getElementById('german-input').disabled = false;
  document.getElementById('result').textContent = 'Quiz zurückgesetzt. Lade neue Vokabel...';
  document.getElementById('result').className = 'hint';
  setAnswered(false);
  resetAiPanel();
  loadVocabulary(selectedDataset);
}

async function finishQuiz() {
  const question = store.canExit
    ? 'Möchtest du die Anwendung wirklich beenden? Dein Lernstand wird gespeichert und beim nächsten Start wieder geladen.'
    : 'Lernstand jetzt speichern? Er wird beim nächsten Start der App wieder geladen.';
  if (!confirm(question)) {
    return;
  }

  const resultDiv = document.getElementById('result');
  resultDiv.textContent = store.canExit ? 'Speichere Lernstand und beende die Anwendung...' : 'Speichere Lernstand...';
  resultDiv.className = 'hint';
  document.getElementById('finish-btn').disabled = true;

  const state = {
    mode: learnMode,
    dataset: selectedDataset,
    direction: learningDirection,
    correctCount,
    incorrectCount,
    totalCount,
    answeredWords,
    wordQueue: learnMode === 'tenses' ? verbQueue : wordQueue
  };

  let outcome;
  try {
    outcome = await store.saveState(state);
  } catch (error) {
    console.error('Fehler beim Speichern des Lernstands:', error);
    outcome = { success: false, message: error.message };
  }

  if (!outcome.success) {
    resultDiv.textContent = `Fehler: Der Lernstand konnte nicht gespeichert werden. ${outcome.message || ''}`;
    resultDiv.className = 'incorrect';
    document.getElementById('finish-btn').disabled = false;
    return;
  }

  // Lokaler Modus (App): nur speichern, weiterlernen.
  if (!store.canExit) {
    resultDiv.textContent = 'Lernstand gespeichert – du kannst weiterlernen oder die App schließen.';
    resultDiv.className = 'correct';
    document.getElementById('finish-btn').disabled = false;
    return;
  }

  const accuracy = totalCount > 0 ? Math.round((correctCount / totalCount) * 100) : 0;

  // Fenster schließen (wirkt nur, wenn die Seite per Skript geöffnet wurde).
  window.close();
  // Fallback: saubere Beendet-Anzeige, damit klar ist, dass die App sich geschlossen hat.
  showShutdownScreen(accuracy);
}

function showShutdownScreen(accuracy) {
  const container = document.querySelector('.container');
  if (!container) {
    return;
  }

  let summary = '';
  if (totalCount > 0) {
    summary = `<p>Letzter Stand: ${correctCount} richtig, ${incorrectCount} falsch von ${totalCount} Versuchen (${accuracy} %).</p>`;
  }

  container.innerHTML = `
    <div class="shutdown">
      <h1>Vokabeltrainer wurde beendet</h1>
      <p>Dein Lernstand wurde gespeichert und wird beim nächsten Start automatisch geladen.</p>
      ${summary}
      <p>Du kannst dieses Fenster jetzt schließen.</p>
    </div>`;
  const nav = document.querySelector('.bottom-nav');
  if (nav) {
    nav.remove();
  }
}

async function restoreLastState() {
  try {
    const saved = await store.loadState();
    if (!saved) {
      return;
    }

    const select = document.getElementById('dataset-select');

    // Zeitformen-Modus: Verben-Runde wiederherstellen (Dataset ist hier nicht relevant).
    if (saved.mode === 'tenses') {
      learnMode = 'tenses';
      syncModeUI();

      correctCount = Number(saved.correctCount) || 0;
      incorrectCount = Number(saved.incorrectCount) || 0;
      totalCount = Number(saved.totalCount) || 0;
      answeredWords = {
        correct: saved.answeredWords && Array.isArray(saved.answeredWords.correct) ? saved.answeredWords.correct : [],
        incorrect: saved.answeredWords && Array.isArray(saved.answeredWords.incorrect) ? saved.answeredWords.incorrect : []
      };
      if (Array.isArray(saved.wordQueue) && saved.wordQueue.length > 0) {
        verbQueue = saved.wordQueue;
      }
      currentVerb = null;

      updateStats();
      await loadVerbs({ keepQueue: true });
      // Hinweis erst nach loadVerbs setzen – showNextVerb überschreibt die Ergebniszeile.
      const resultDiv = document.getElementById('result');
      resultDiv.textContent = '🔄 Letzter Lernstand wiederhergestellt – die Verben-Runde kann fortgesetzt werden.';
      resultDiv.className = 'hint';
      return;
    }

    const datasetExists = Array.from(select.options).some(option => option.value === saved.dataset);
    if (!datasetExists) {
      return;
    }

    selectedDataset = saved.dataset;
    select.value = saved.dataset;
    learningDirection = (saved.direction === 'en-de' || saved.direction === 'de-en') ? saved.direction : 'de-en';
    document.getElementById('direction-select').value = learningDirection;
    updateAnswerInput();

    // Das gespeicherte Dataset kann vom Server-Standard abweichen – Vokabeln
    // dazu laden, sonst füllt rebuildQueue() später Wörter des falschen Datasets nach.
    await fetchVocabulary(saved.dataset);
    rebuildQueue();

    correctCount = Number(saved.correctCount) || 0;
    incorrectCount = Number(saved.incorrectCount) || 0;
    totalCount = Number(saved.totalCount) || 0;
    answeredWords = {
      correct: saved.answeredWords && Array.isArray(saved.answeredWords.correct) ? saved.answeredWords.correct : [],
      incorrect: saved.answeredWords && Array.isArray(saved.answeredWords.incorrect) ? saved.answeredWords.incorrect : []
    };
    if (Array.isArray(saved.wordQueue) && saved.wordQueue.length > 0) {
      wordQueue = saved.wordQueue;
    }
    // Altes Standformat: fehlbeantwortete Wörter an das Ende der Queue anhängen.
    if (Array.isArray(saved.incorrectWords)) {
      for (const item of saved.incorrectWords) {
        if (item && !wordQueue.some(v => v.english === item.english && v.german === item.german)) {
          wordQueue.push(item);
        }
      }
    }
    currentWord = null;

    updateStats();
    showNextWord();
    // Hinweis erst nach showNextWord setzen – das überschreibt sonst die Ergebniszeile.
    const resultDiv = document.getElementById('result');
    resultDiv.textContent = '🔄 Letzter Lernstand wiederhergestellt – die Runde kann fortgesetzt werden.';
    resultDiv.className = 'hint';
  } catch (error) {
    console.error('Fehler beim Wiederherstellen des letzten Standes:', error);
  }
}

function getNextWordFromQueue() {
  if (wordQueue.length === 0) {
    rebuildQueue();
  }

  return wordQueue.shift();
}

function showNextWord() {
  if (learnMode === 'tenses') {
    showNextVerb();
    return;
  }

  const resultDiv = document.getElementById('result');
  const config = getDirectionConfig();
  resultDiv.textContent = 'Gib die Übersetzung ein und klicke auf Prüfen.';
  resultDiv.className = 'hint';

  currentWord = getNextWordFromQueue();
  if (!currentWord) {
    document.getElementById('english-word').textContent = 'Keine Wörter verfügbar';
    document.getElementById('german-input').value = '';
    updateAnswerInput();
    document.getElementById('check-btn').disabled = true;
    renderUpcomingWords();
    return;
  }

  document.getElementById('english-word').textContent = currentWord[config.questionKey];
  document.getElementById('german-input').value = '';
  updateAnswerInput();
  document.getElementById('german-input').focus();
  setAnswered(false);
  renderUpcomingWords();
  resetAiPanel();
}

function showNextVerb() {
  const resultDiv = document.getElementById('result');
  resultDiv.textContent = `Gib ${getVerbTargetLabel()} ein und klicke auf Prüfen.`;
  resultDiv.className = 'hint';

  if (verbQueue.length === 0) {
    rebuildVerbQueue();
  }

  currentVerb = verbQueue.shift();
  if (!currentVerb) {
    document.getElementById('english-word').textContent = 'Keine Verben verfügbar';
    document.getElementById('german-input').value = '';
    document.getElementById('check-btn').disabled = true;
    renderUpcomingWords();
    return;
  }

  lastVerbWrongAnswer = '';
  document.getElementById('english-word').textContent = renderVerbQuestionText(currentVerb);
  document.getElementById('german-input').value = '';
  updateModeUI();
  document.getElementById('german-input').focus();
  setAnswered(false);
  renderUpcomingWords();
  resetAiPanel();
}

async function checkVerbAnswer(autoNext = false) {
  const resultDiv = document.getElementById('result');
  const verb = (currentVerb && currentVerb.infinitive) || document.getElementById('english-word').textContent.trim();
  const answer = document.getElementById('german-input').value.trim();

  if (!answer) {
    resultDiv.textContent = 'Bitte gib eine Antwort ein.';
    resultDiv.className = 'hint';
    return;
  }

  try {
    const data = await store.checkVerb(verb, activeVerbTarget(), answer);
    if (!data.success) {
      resultDiv.textContent = data.message || 'Fehler beim Prüfen des Verbs.';
      resultDiv.className = 'incorrect';
      return;
    }

    totalCount++;

    const verbForms = data.verb
      ? [data.verb.infinitive, data.verb.past, data.verb.participle]
      : (data.expected || '').split(' · ');

    if (data.correct) {
      correctCount++;
      lastVerbWrongAnswer = '';
      showResult('correct', 'Richtig', '', verbForms);
      if (currentVerb && !answeredWords.correct.some(v => v.infinitive === currentVerb.infinitive)) {
        answeredWords.correct.push(currentVerb);
      }
    } else {
      incorrectCount++;
      lastVerbWrongAnswer = answer;
      showResult('incorrect', 'Nicht ganz',
        activeVerbTarget() === 'all'
          ? 'Richtig ist – tippe unten auf „Fehler erklären“ für eine Eselsbrücke:'
          : `Richtig: <strong>${escapeHtml(data.expected)}</strong>`,
        activeVerbTarget() === 'all' ? verbForms : []);
      // Die fehlerhafte Frage (Verb + Ziel-Form) kommt am Ende der Runde noch einmal dran –
      // aber nur, falls sie nicht bereits als eigene Frage in der Warteschlange steht.
      if (currentVerb && !verbQueue.some(v => v.infinitive === currentVerb.infinitive && v.target === activeVerbTarget())) {
        verbQueue.push({ ...currentVerb, target: activeVerbTarget() });
      }
      if (currentVerb && !answeredWords.incorrect.some(v => v.infinitive === currentVerb.infinitive)) {
        answeredWords.incorrect.push(currentVerb);
      }
    }

    updateStats();
    updateAiButtonLabel();
    setAnswered(true);

    // Nur bei richtiger Antwort automatisch weiter (Enter-Tastatur-Flow).
    // Bei falscher Antwort bleibt die Seite stehen – Zeit zum Lesen,
    // dann manuell über „Nächstes Wort“ weiter.
    if (autoNext && data.correct) {
      setTimeout(() => {
        showNextWord();
      }, 2000);
    }
  } catch (error) {
    console.error('Fehler beim Prüfen des Verbs:', error);
    resultDiv.textContent = 'Fehler beim Prüfen der Antwort.';
    resultDiv.className = 'incorrect';
  }
}

async function checkAnswer(autoNext = false) {
  if (learnMode === 'tenses') {
    checkVerbAnswer(autoNext);
    return;
  }

  const question = document.getElementById('english-word').textContent;
  const answer = document.getElementById('german-input').value.trim();
  const resultDiv = document.getElementById('result');

  if (!answer) {
    resultDiv.textContent = 'Bitte gib eine Antwort ein.';
    resultDiv.className = 'hint';
    return;
  }

  try {
    const data = await store.checkWord(selectedDataset, question, answer, learningDirection);
    totalCount++;

    if (data.correct) {
      correctCount++;
      showResult('correct', 'Richtig', escapeHtml(data.correctAnswer));
      if (currentWord && !answeredWords.correct.some(v => v.english === currentWord.english && v.german === currentWord.german)) {
        answeredWords.correct.push(currentWord);
      }
    } else {
      incorrectCount++;
      showResult('incorrect', 'Nicht ganz', `Richtig: <strong>${escapeHtml(data.correctAnswer)}</strong>`);
      // Wort kommt am Ende der Runde noch einmal dran, blockiert aber nicht die nächsten Wörter.
      if (currentWord && !wordQueue.some(v => v.english === currentWord.english && v.german === currentWord.german)) {
        wordQueue.push(currentWord);
      }
      if (currentWord && !answeredWords.incorrect.some(v => v.english === currentWord.english && v.german === currentWord.german)) {
        answeredWords.incorrect.push(currentWord);
      }
    }

    updateStats();
    setAnswered(true);

    // Nur bei richtiger Antwort automatisch weiter (Enter-Tastatur-Flow).
    // Bei falscher Antwort bleibt die Seite stehen – Zeit zum Lesen,
    // dann manuell über „Nächstes Wort“ weiter.
    if (autoNext && data.correct) {
      setTimeout(() => {
        showNextWord();
      }, 2000);
    }
  } catch (error) {
    console.error('Fehler beim Prüfen der Antwort:', error);
  }
}

// ── KI-Hilfe ──────────────────────────────────────────────────────────────────
async function fetchAiHelper() {
  const word = document.getElementById('english-word').textContent.trim();
  const btnLabel = document.getElementById('ai-btn-label');
  const spinner = document.getElementById('ai-spinner');
  const resultDiv = document.getElementById('ai-result');
  const aiBtn = document.getElementById('ai-btn');

  if (learnMode === 'tenses' && !currentVerb) {
    resultDiv.textContent = 'Bitte warte, bis ein Verb geladen ist.';
    resultDiv.classList.remove('hidden');
    resultDiv.classList.add('ai-error');
    return;
  }

  if (learnMode !== 'tenses' && (!word || word === 'Lädt...' || word === 'Keine Wörter verfügbar')) {
    resultDiv.textContent = 'Bitte warte, bis ein Wort geladen ist.';
    resultDiv.classList.remove('hidden');
    resultDiv.classList.add('ai-error');
    return;
  }

  aiBtn.disabled = true;
  btnLabel.classList.add('hidden');
  spinner.classList.remove('hidden');
  resultDiv.classList.add('hidden');
  resultDiv.classList.remove('ai-error');

  try {
    const data = await store.aiHelp(learnMode === 'tenses'
      ? { verb: currentVerb, target: activeVerbTarget(), userAnswer: lastVerbWrongAnswer }
      : { word });

    if (data.success) {
      resultDiv.innerHTML = renderMarkdown(data.info);
      resultDiv.classList.remove('hidden');
    } else {
      resultDiv.textContent = data.message || 'Fehler bei der KI-Anfrage.';
      resultDiv.classList.remove('hidden');
      resultDiv.classList.add('ai-error');
    }
  } catch (error) {
    console.error('AI Helper Fehler:', error);
    resultDiv.textContent = 'Fehler: Alle KI-Provider fehlgeschlagen. Bitte API-Keys in der .env-Datei prüfen (OPENAI_API_KEY, GROQ_API_KEY oder GEMINI_API_KEY).';
    resultDiv.classList.remove('hidden');
    resultDiv.classList.add('ai-error');
  } finally {
    aiBtn.disabled = false;
    btnLabel.classList.remove('hidden');
    spinner.classList.add('hidden');
  }
}

// Minimaler Markdown-Renderer für die KI-Antwort: erst HTML escapen, dann
// nur Fett, Kursiv, Inline-Code, Listen und Absätze umsetzen.
function renderMarkdown(text) {
  const escaped = (text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const inline = line => line
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');

  const html = [];
  let listTag = null;
  const closeList = () => {
    if (listTag) {
      html.push(`</${listTag}>`);
      listTag = null;
    }
  };

  for (const rawLine of escaped.split(/\r?\n/)) {
    const line = rawLine.trim();
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    const numbered = line.match(/^\d+[.)]\s+(.*)$/);
    const heading = line.match(/^#{1,6}\s+(.*)$/);

    if (bullet || numbered) {
      const tag = bullet ? 'ul' : 'ol';
      if (listTag !== tag) {
        closeList();
        html.push(`<${tag}>`);
        listTag = tag;
      }
      html.push(`<li>${inline((bullet || numbered)[1])}</li>`);
    } else if (!line) {
      closeList();
    } else if (heading) {
      closeList();
      html.push(`<p><strong>${inline(heading[1])}</strong></p>`);
    } else {
      closeList();
      html.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  return `<div class="markdown-body">${html.join('')}</div>`;
}

function resetAiPanel() {
  const resultDiv = document.getElementById('ai-result');
  if (resultDiv) {
    resultDiv.textContent = '';
    resultDiv.classList.add('hidden');
    resultDiv.classList.remove('ai-error');
  }
}

// ── Lokaler Modus: Import/Export & KI-Server-Adresse ───────────────────────
async function importCsvFile(file) {
  const resultDiv = document.getElementById('result');
  if (!file) {
    return;
  }
  try {
    const text = await file.text();
    const data = await store.importCsv(file.name, text);
    if (!data.success) {
      resultDiv.textContent = data.message || 'Import fehlgeschlagen.';
      resultDiv.className = 'incorrect';
      return;
    }
    await loadDatasets();
    selectedDataset = data.dataset;
    document.getElementById('dataset-select').value = selectedDataset;
    updateDatasetLabel();
    await loadVocabulary(selectedDataset);
    resultDiv.textContent = `Importiert: ${data.count} Vokabeln in „${VTCore.datasetLabel(data.dataset)}“.`;
    resultDiv.className = 'correct';
  } catch (error) {
    console.error('Import fehlgeschlagen:', error);
    resultDiv.textContent = 'Import fehlgeschlagen. Ist es eine CSV-Datei mit den Spalten English, German?';
    resultDiv.className = 'incorrect';
  }
}

async function exportCurrentDataset() {
  const resultDiv = document.getElementById('result');
  if (!selectedDataset) {
    resultDiv.textContent = 'Bitte wähle zuerst ein Dataset aus.';
    resultDiv.className = 'hint';
    return;
  }
  try {
    const data = await store.exportCsv(selectedDataset);
    resultDiv.textContent = data.shared ? 'Dataset zum Teilen bereitgestellt.' : 'Dataset als CSV heruntergeladen.';
    resultDiv.className = 'correct';
  } catch (error) {
    console.error('Export fehlgeschlagen:', error);
    resultDiv.textContent = 'Export fehlgeschlagen.';
    resultDiv.className = 'incorrect';
  }
}

async function setupLocalModeUI() {
  const isLocal = store.kind === 'local';
  document.querySelectorAll('.local-only').forEach(el => el.classList.toggle('hidden', !isLocal));
  document.getElementById('finish-btn').textContent = store.canExit ? 'Speichern & Beenden' : 'Lernstand speichern';
  if (!isLocal) {
    return;
  }

  const settings = await store.getSettings();
  const urlInput = document.getElementById('ai-proxy-url');
  urlInput.value = settings.aiProxyUrl || '';
  document.getElementById('ai-proxy-save-btn').addEventListener('click', async () => {
    await store.saveSettings({ aiProxyUrl: urlInput.value.trim() });
    const resultDiv = document.getElementById('result');
    resultDiv.textContent = urlInput.value.trim() ? 'KI-Server gespeichert.' : 'KI-Server entfernt.';
    resultDiv.className = 'correct';
  });

  const fileInput = document.getElementById('import-csv-file');
  document.getElementById('import-csv-btn').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    await importCsvFile(fileInput.files && fileInput.files[0]);
    fileInput.value = '';
  });
  document.getElementById('export-csv-btn').addEventListener('click', exportCurrentDataset);
}

document.addEventListener('DOMContentLoaded', async () => {
  applyTheme(document.documentElement.dataset.theme || 'nacht');
  store = VTStorage.createStore();
  await store.init();
  await setupLocalModeUI();
  document.getElementById('theme-btn').addEventListener('click', toggleTheme);
  document.querySelectorAll('#theme-toggle .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
  });

  await loadDatasets();
  updateAnswerInput();
  await loadVocabulary();
  await restoreLastState();

  document.getElementById('dataset-select').addEventListener('change', async (event) => {
    selectedDataset = event.target.value;
    updateDatasetLabel();
    resetQuiz(selectedDataset);
  });

  document.querySelectorAll('.bottom-nav .nav-btn').forEach(btn => {
    btn.addEventListener('click', () => setTab(btn.dataset.tab));
  });

  document.getElementById('direction-select').addEventListener('change', (event) => {
    learningDirection = event.target.value;
    updateAnswerInput();
    resetQuiz(selectedDataset);
  });

  document.getElementById('create-dataset-btn').addEventListener('click', createDataset);
  document.getElementById('rename-dataset-btn').addEventListener('click', renameDataset);
  document.getElementById('delete-dataset-btn').addEventListener('click', deleteDataset);
  document.getElementById('ai-btn').addEventListener('click', fetchAiHelper);

  document.querySelectorAll('#mode-toggle .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => setLearnMode(btn.dataset.mode));
  });

  document.getElementById('check-btn').addEventListener('click', () => checkAnswer(false));
  document.getElementById('next-btn').addEventListener('click', showNextWord);
  document.getElementById('restart-btn').addEventListener('click', () => {
    if (learnMode === 'tenses') {
      resetVerbRound();
    } else {
      resetQuiz(selectedDataset);
    }
  });
  document.getElementById('next-question-btn').addEventListener('click', showNextWord);
  document.getElementById('finish-btn').addEventListener('click', finishQuiz);
  document.getElementById('add-word-btn').addEventListener('click', addNewWord);

  document.getElementById('german-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      checkAnswer(true);
    }
  });

  document.getElementById('new-german').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addNewWord();
    }
  });
});