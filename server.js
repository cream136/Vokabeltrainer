require('dotenv').config();
const express = require('express');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.resolve(__dirname);
const DEFAULT_DATA_FILE = 'IT.csv';
const SESSION_STATE_FILE = 'session-state.json';

let vocabulary = [];
let currentDataset = DEFAULT_DATA_FILE;
const VERB_DATA_FILE = 'verb-data.json';

// ── Lernmodus Zeitformen: unregelmäßige Verben (aus PDF, Quelle: englisch-hilfen.de) ──
let verbDataCache = null;

function getVerbData() {
  if (!verbDataCache) {
    const filePath = path.join(DATA_DIR, VERB_DATA_FILE);
    if (!fs.existsSync(filePath)) {
      verbDataCache = [];
    } else {
      verbDataCache = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  }
  return verbDataCache;
}

function findVerbEntry(infinitive) {
  const clean = (infinitive || '').toString().trim().toLowerCase();
  return getVerbData().find(v => v.infinitive.toLowerCase() === clean) || null;
}

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
  // Einzelwort-Treffer innerhalb des erwarteten Phrasenworts (z. B. "geben" in "etwas geben")
  if (answerWords.length === 1) {
    const core = answerWords[0];
    if ([...expectedWords].some(w => w.includes(core) || core.includes(w))) {
      return true;
    }
  }
  return false;
}

app.use(express.json());
app.use(express.static('public'));

function escapeCsv(value) {
  const text = value.toString().trim();
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return '"' + text.replace(/"/g, '""') + '"';
  }
  return text;
}

function getDatasetFiles() {
  const files = fs.readdirSync(DATA_DIR);
  return files
    .filter(file => /\.(csv|xlsx)$/i.test(file))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

function normalizeDatasetName(name, defaultExtension = '.csv') {
  const safeName = path.basename(name || '').trim();
  if (!safeName) {
    return null;
  }

  const normalized = safeName.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
  const ext = path.extname(normalized).toLowerCase();

  if (ext === '.csv' || ext === '.xlsx') {
    return normalized;
  }

  return `${normalized}${defaultExtension}`;
}

function resolveDatasetPath(dataset) {
  const safeName = path.basename(dataset || '');
  if (!/\.(csv|xlsx)$/i.test(safeName)) {
    return null;
  }

  const filePath = path.join(DATA_DIR, safeName);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return filePath;
}

function normalizeCell(value) {
  return value === undefined || value === null ? '' : value.toString().trim();
}

function loadDataset(dataset) {
  const filePath = resolveDatasetPath(dataset);
  if (!filePath) {
    throw new Error('Dataset not found');
  }

  const workbook = XLSX.readFile(filePath, { codepage: 65001 });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rows = worksheet ? XLSX.utils.sheet_to_json(worksheet, { defval: '' }) : [];

  const englishKeys = ['English', 'english', 'Englisch', 'englisch'];
  const germanKeys = ['German', 'german', 'Deutsch', 'deutsch'];

  const findKey = (row, keys) => keys.find(key => Object.prototype.hasOwnProperty.call(row, key));

  return rows
    .map(row => {
      const rowKeys = Object.keys(row);
      const englishKey = findKey(row, englishKeys);
      const germanKey = findKey(row, germanKeys);

      const english = normalizeCell(englishKey ? row[englishKey] : rowKeys[0] ? row[rowKeys[0]] : '');
      const german = normalizeCell(germanKey ? row[germanKey] : rowKeys[1] ? row[rowKeys[1]] : '');

      return { english, german };
    })
    .filter(item => item.english && item.german);
}

const datasetCache = new Map();

function getVocabularyFor(dataset) {
  const filePath = resolveDatasetPath(dataset);
  if (!filePath) {
    throw new Error('Dataset not found');
  }
  const stat = fs.statSync(filePath);
  const cached = datasetCache.get(dataset);
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    return cached.words;
  }
  const words = loadDataset(dataset);
  datasetCache.set(dataset, { mtimeMs: stat.mtimeMs, words });
  return words;
}

function invalidateDatasetCache(dataset) {
  if (dataset) {
    datasetCache.delete(dataset);
  } else {
    datasetCache.clear();
  }
}

function saveWordToDataset(dataset, word) {
  const filePath = resolveDatasetPath(dataset);
  if (!filePath) {
    throw new Error('Dataset not found');
  }

  const extension = path.extname(filePath).toLowerCase();

  if (extension === '.csv') {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, 'English,German\n', 'utf8');
    }
    const line = `\n${escapeCsv(word.english)},${escapeCsv(word.german)}`;
    fs.appendFileSync(filePath, line, 'utf8');
    return;
  }

  const workbook = fs.existsSync(filePath) ? XLSX.readFile(filePath, { cellDates: true, raw: false, codepage: 65001 }) : XLSX.utils.book_new();
  const sheetName = workbook.SheetNames[0] || 'Sheet1';
  const worksheet = workbook.Sheets[sheetName];
  const rows = worksheet ? XLSX.utils.sheet_to_json(worksheet, { defval: '' }) : [];

  rows.push({ English: word.english, German: word.german });
  const newWorksheet = XLSX.utils.json_to_sheet(rows, { skipHeader: false });
  workbook.Sheets[sheetName] = newWorksheet;
  if (!workbook.SheetNames.includes(sheetName)) {
    workbook.SheetNames.push(sheetName);
  }

  XLSX.writeFile(workbook, filePath);
}

function getDatasetList() {
  return getDatasetFiles().map(name => ({
    name,
    label: name.replace(/\.(csv|xlsx)$/i, '')
  }));
}

function loadVocabulary(dataset = DEFAULT_DATA_FILE) {
  const availableDatasets = getDatasetFiles();

  if (availableDatasets.length === 0) {
    const defaultPath = path.join(DATA_DIR, DEFAULT_DATA_FILE);
    fs.writeFileSync(defaultPath, 'English,German\n', 'utf8');
    availableDatasets.push(DEFAULT_DATA_FILE);
  }

  const requestedDataset = resolveDatasetPath(dataset) ? dataset : null;
  const fallbackDataset = resolveDatasetPath(DEFAULT_DATA_FILE) ? DEFAULT_DATA_FILE : availableDatasets[0];
  const selectedDataset = requestedDataset || fallbackDataset;

  if (!selectedDataset) {
    throw new Error('Kein Dataset gefunden');
  }

  currentDataset = selectedDataset;
  vocabulary = getVocabularyFor(currentDataset);
  console.log(`Loaded ${vocabulary.length} words from dataset ${currentDataset}`);
}

app.get('/api/datasets', (req, res) => {
  const datasets = getDatasetList();
  res.json({ datasets, defaultDataset: currentDataset || (datasets[0] && datasets[0].name) || '' });
});

app.post('/api/datasets', (req, res) => {
  const nameRaw = (req.body.name || '').toString().trim();
  const name = normalizeDatasetName(nameRaw);

  if (!name) {
    return res.status(400).json({ success: false, message: 'Ungültiger Dateiname.' });
  }

  const filePath = path.join(DATA_DIR, name);
  if (fs.existsSync(filePath)) {
    return res.status(409).json({ success: false, message: 'Dataset existiert bereits.', dataset: name });
  }

  try {
    if (path.extname(name).toLowerCase() === '.csv') {
      fs.writeFileSync(filePath, 'English,German\n', 'utf8');
    } else {
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.aoa_to_sheet([['English', 'German']]);
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
      XLSX.writeFile(workbook, filePath);
    }

    res.status(201).json({ success: true, dataset: name });
  } catch (error) {
    console.error('Error creating dataset:', error);
    res.status(500).json({ success: false, message: 'Fehler beim Erstellen des Datasets.' });
  }
});

app.post('/api/datasets/rename', (req, res) => {
  const oldName = (req.body.oldName || '').toString().trim();
  const newNameRaw = (req.body.newName || '').toString().trim();
  const oldPath = resolveDatasetPath(oldName);

  if (!oldPath) {
    return res.status(404).json({ success: false, message: 'Das ausgewählte Dataset wurde nicht gefunden.' });
  }

  if (!newNameRaw) {
    return res.status(400).json({ success: false, message: 'Bitte gib einen neuen Namen ein.' });
  }

  const defaultExtension = path.extname(oldName).toLowerCase() || '.csv';
  const newName = normalizeDatasetName(newNameRaw, defaultExtension);
  const newPath = path.join(DATA_DIR, newName);

  if (oldName === newName) {
    return res.json({ success: true, dataset: oldName, unchanged: true });
  }

  if (fs.existsSync(newPath)) {
    return res.status(409).json({ success: false, message: 'Ein Dataset mit diesem Namen existiert bereits.' });
  }

  try {
    fs.renameSync(oldPath, newPath);
    const cached = datasetCache.get(oldName);
    invalidateDatasetCache(oldName);
    if (cached) {
      datasetCache.set(newName, cached);
    }
    if (currentDataset === oldName) {
      currentDataset = newName;
    }
    res.json({ success: true, dataset: newName });
  } catch (error) {
    console.error('Error renaming dataset:', error);
    res.status(500).json({ success: false, message: 'Fehler beim Umbenennen des Datasets.' });
  }
});

app.post('/api/datasets/delete', (req, res) => {
  const name = (req.body.name || '').toString().trim();
  const filePath = resolveDatasetPath(name);

  if (!filePath) {
    return res.status(404).json({ success: false, message: 'Dataset nicht gefunden.' });
  }

  try {
    fs.unlinkSync(filePath);
    invalidateDatasetCache(name);
    if (currentDataset === name) {
      const datasets = getDatasetFiles();
      currentDataset = datasets[0] || '';
      vocabulary = currentDataset ? getVocabularyFor(currentDataset) : [];
    }
    res.json({ success: true, dataset: name });
  } catch (error) {
    console.error('Error deleting dataset:', error);
    res.status(500).json({ success: false, message: 'Fehler beim Löschen des Datasets.' });
  }
});

app.get('/api/vocabulary', (req, res) => {
  const dataset = req.query.dataset || currentDataset;
  try {
    loadVocabulary(dataset);
    res.json(vocabulary);
  } catch (error) {
    console.error('Error loading dataset:', error);
    res.status(500).json({ error: 'Dataset konnte nicht geladen werden.' });
  }
});

app.post('/api/check', (req, res) => {
  const { question, answer, direction = 'de-en', dataset } = req.body;
  const normalizedQuestion = (question || '').toString().trim().toLowerCase();
  const normalizedAnswer = (answer || '').toString().trim().toLowerCase();

  if (!normalizedQuestion || !normalizedAnswer) {
    return res.status(400).json({ correct: false, correctAnswer: 'Unknown word' });
  }

  const targetDataset = dataset || currentDataset;
  let words;
  try {
    words = getVocabularyFor(targetDataset);
  } catch (error) {
    return res.status(404).json({ correct: false, correctAnswer: 'Unknown word' });
  }

  const correctWord = direction === 'en-de'
    ? words.find(v => v.german.toLowerCase() === normalizedQuestion)
    : words.find(v => v.english.toLowerCase() === normalizedQuestion);

  if (!correctWord) {
    return res.json({ correct: false, correctAnswer: 'Unknown word' });
  }

  const expectedAnswer = direction === 'en-de' ? correctWord.english : correctWord.german;
  const isCorrect = expectedAnswer.toLowerCase() === normalizedAnswer;

  res.json({ correct: isCorrect, correctAnswer: expectedAnswer });
});

// ── Lernmodus Zeitformen: unregelmäßige Verben ─────────────────────────────
app.get('/api/verbs', (req, res) => {
  const verbs = getVerbData();
  res.json({ success: true, verbs });
});

app.post('/api/verb-check', (req, res) => {
  const verbRaw = (req.body.verb || '').toString().trim();
  const target = (req.body.target || '').toString();
  const answer = (req.body.answer || '').toString().trim();

  if (!verbRaw || !answer) {
    return res.status(400).json({ success: false, message: 'Verb und Antwort sind erforderlich.' });
  }
  if (!['past', 'participle', 'meaning'].includes(target)) {
    return res.status(400).json({ success: false, message: 'Ungültige Frageart. Zulässig: past, participle, meaning.' });
  }

  const entry = findVerbEntry(verbRaw);
  if (!entry) {
    return res.status(404).json({ success: false, message: 'Dieses Verb ist nicht in der Liste der unregelmäßigen Verben enthalten.' });
  }

  const expectedRaw = target === 'past' ? entry.past : target === 'participle' ? entry.participle : entry.german;
  const accepted = splitVerbVariants(expectedRaw).map(v => v.toLowerCase());
  const correct = target === 'meaning'
    ? (accepted.includes(answer.toLowerCase()) || meaningMatches(expectedRaw, answer))
    : accepted.includes(answer.toLowerCase());

  res.json({ success: true, correct, expected: expectedRaw, accepted, target, verb: entry });
});

app.post('/api/add-word', (req, res) => {
  const english = (req.body.english || '').toString().trim();
  const german = (req.body.german || '').toString().trim();
  const dataset = req.body.dataset || currentDataset;

  if (!english || !german) {
    return res.status(400).json({ success: false, message: 'Beide Felder müssen ausgefüllt sein.' });
  }

  if (!resolveDatasetPath(dataset)) {
    return res.status(404).json({ success: false, message: 'Dataset wurde nicht gefunden.' });
  }

  let targetWords;
  try {
    targetWords = getVocabularyFor(dataset);
  } catch (error) {
    return res.status(404).json({ success: false, message: 'Dataset wurde nicht gefunden.' });
  }

  const exists = targetWords.some(v => v.english.toLowerCase() === english.toLowerCase());
  if (exists) {
    return res.status(409).json({ success: false, message: 'Dieses Wort existiert bereits.' });
  }

  const newWord = { english, german };

  try {
    saveWordToDataset(dataset, newWord);
    invalidateDatasetCache(dataset);
    if (dataset === currentDataset) {
      vocabulary = getVocabularyFor(currentDataset);
    }
    res.json({ success: true, word: newWord, dataset });
  } catch (error) {
    console.error('Error saving word to dataset:', error);
    res.status(500).json({ success: false, message: 'Fehler beim Speichern des Wortes.' });
  }
});

// ── Session-State: Speichern & Beenden ──────────────────────────────────────
function buildStateRecord(state) {
  const answeredWords = state && state.answeredWords ? state.answeredWords : {};
  return {
    savedAt: new Date().toISOString(),
    mode: state && state.mode === 'tenses' ? 'tenses' : 'words',
    dataset: state && state.dataset ? state.dataset : currentDataset,
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

app.post('/api/finish', (req, res) => {
  const record = buildStateRecord(req.body);
  const statePath = path.join(DATA_DIR, SESSION_STATE_FILE);

  try {
    fs.writeFileSync(statePath, JSON.stringify(record, null, 2), 'utf8');
    console.log(`Lernstand gespeichert: ${record.dataset} (${record.totalCount} Versuche)`);
  } catch (error) {
    console.error('Fehler beim Speichern des Lernstands:', error);
    return res.status(500).json({ success: false, message: 'Fehler beim Speichern des Lernstands.' });
  }

  res.json({ success: true, message: 'Lernstand gespeichert. Die Anwendung wird beendet.' });

  // Server sauber schließen: laufende Anfragen abwarten, dann enden.
  const forceExit = setTimeout(() => {
    console.log('Timeout überschritten – Server wird erzwungen beendet.');
    process.exit(0);
  }, 2000);

  server.close(() => {
    clearTimeout(forceExit);
    console.log('✅ Alle Verbindungen geschlossen – Server sauber beendet.');
    process.exit(0);
  });
});

app.get('/api/state', (req, res) => {
  const statePath = path.join(DATA_DIR, SESSION_STATE_FILE);
  try {
    if (!fs.existsSync(statePath)) {
      return res.json({ hasState: false });
    }
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (!state || typeof state !== 'object' || !state.dataset) {
      return res.json({ hasState: false });
    }
    res.json({ hasState: true, state });
  } catch (error) {
    console.error('Fehler beim Laden des Lernstands:', error);
    res.json({ hasState: false });
  }
});

// ── AI Helper ────────────────────────────────────────────────────────────────
const AI_PROVIDER = (process.env.AI_PROVIDER || 'openai').toLowerCase();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.1';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

// Zeitlimits pro Provider (ms): Ein zu langsamer Provider (z. B. langsames
// lokales Modell, das gerade lädt/generiert) blockiert die Antwort nicht –
// die Fallback-Kette wechselt einfach zum nächsten Provider.
const AI_TIMEOUTS = {
  ollama: parseInt(process.env.AI_OLLAMA_TIMEOUT_MS || '20000', 10),
  openai: parseInt(process.env.AI_CLOUD_TIMEOUT_MS || '30000', 10),
  groq: parseInt(process.env.AI_CLOUD_TIMEOUT_MS || '30000', 10),
  gemini: parseInt(process.env.AI_CLOUD_TIMEOUT_MS || '30000', 10)
};

// Fetch mit Timeout: verhindert, dass KI-Anfragen ewig hängen.
async function fetchWithTimeout(url, options, timeoutMs, provider) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Timeout nach ${Math.round(timeoutMs / 1000)}s bei ${provider} – wechsle zum nächsten Provider`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Lernsystem aus englisch-hilfen.de: Form-Gruppen, Präfix-Regel und Spezialfälle.
// Dient als Wissensbasis, damit die KI Erklärungen und Eselsbrücken liefert,
// die mit der Lehrbuchliste (Klassen 6–12) und englisch-hilfen.de übereinstimmen.
const VERB_LEARNING_KNOWLEDGE = `Lernsystem für unregelmäßige Verben (Quelle: englisch-hilfen.de):
1) Gruppe "alle drei Formen gleich" (keine -ed-Endung, einfach auswendig): bet–bet–bet, burst–burst–burst, cost–cost–cost, cut–cut–cut, hit–hit–hit, hurt–hurt–hurt, let–let–let, put–put–put, read–read–read, set–set–set, shut–shut–shut.
2) Gruppe "Infinitiv = Simple Past, Partizip anders": beat–beat–beaten.
3) Gruppe "Infinitiv = Past Participle, Simple Past anders": come–came–come, run–ran–run, become–became–become.
4) Gruppe "Simple Past = Past Participle": bring–brought–brought, build–built–built, buy–bought–bought, catch–caught–caught, deal–dealt–dealt, feed–fed–fed, feel–felt–felt, fight–fought–fought, find–found–found, get–got–got/gotten, hang–hung–hung, have–had–had, hear–heard–heard, hold–held–held, keep–kept–kept, lay–laid–laid, lead–led–led, leave–left–left, lend–lent–lent, lose–lost–lost, make–made–made, mean–meant–meant, meet–met–met, pay–paid–paid, say–said–said, sell–sold–sold, send–sent–sent, shine–shone–shone, shoot–shot–shot, sit–sat–sat, sleep–slept–slept, slide–slid–slid, spend–spent–spent, stand–stood–stood, stick–stuck–stuck, sweep–swept–swept, swing–swung–swung, teach–taught–taught, tell–told–told, think–thought–thought, understand–understood–understood, win–won–won.
5) Gruppe "alle drei Formen unterschiedlich": be–was/were–been, begin–began–begun, blow–blew–blown, break–broke–broken, choose–chose–chosen, do–did–done, draw–drew–drawn, drink–drank–drunk, drive–drove–driven, eat–ate–eaten, fall–fell–fallen, fly–flew–flown, forget–forgot–forgotten, freeze–froze–frozen, give–gave–given, go–went–gone, grow–grew–grown, hide–hid–hidden, know–knew–known, lie (liegen)–lay–lain, ride–rode–ridden, ring–rang–rung, rise–rose–risen, see–saw–seen, shake–shook–shaken, show–showed–shown, sing–sang–sung, sink–sank–sunk, speak–spoke–spoken, spring–sprang–sprung, steal–stole–stolen, swear–swore–sworn, swim–swam–swum, take–took–taken, tear–tore–torn, throw–threw–thrown, wake–woke–woken, wear–wore–worn, weave–wove–woven, write–wrote–written.
Merkregeln:
- Präfix-Regel: Grundform beherrschen, dann einfach das Präfix anhängen: bid→forbid, cast→broadcast/forecast, go→forego/undergo, stand→understand/withstand, tell→foretell, take→overtake/undertake.
- Spezialfälle: burn, dream und show haben auch eine regelmäßige -ed-Form; "lie" (lügen) ist regelmäßig (lie–lied–lied), aber "lie" (liegen) ist unregelmäßig (lie–lay–lain); "read" (lesen) sieht in allen Formen gleich aus, wird im Simple Past aber wie "red" ausgesprochen.
- FALSE FRIEND: become bedeutet "werden", nicht "bekommen"!`;

function buildVerbTensePrompt(entry, target, userAnswer) {
  const targetLabels = { past: 'Simple Past (1. Form)', participle: 'Past Participle (2. Form)', meaning: 'deutsche Bedeutung' };
  const targetLabel = targetLabels[target] || 'richtigen Form';
  const given = (userAnswer || '').toString().trim();
  const givenText = given
    ? `Der Schüler hat "${given}" geschrieben – das war falsch.`
    : 'Bitte erkläre die korrekte Form ausführlich.';

  return `Du bist ein erfahrener Englisch-Deutsch-Lehrer und hilfst einem Schüler (Klasse 6–12) bei unregelmäßigen Verben.

Verb: ${entry.infinitive} (${entry.german})
Richtige Formen laut Lehrbuchliste:
- Infinitiv (Grundform): ${entry.infinitive}
- Simple Past (1. Form): ${entry.past}
- Past Participle (2. Form): ${entry.participle}
Es wurde nach der Form "Simple Past / Past Participle / Bedeutung" gefragt – konkret: ${targetLabel}.
${givenText}

Nutze dieses Lernsystem (Quelle: englisch-hilfen.de), um eine passende Eselsbrücke zu bauen:
${VERB_LEARNING_KNOWLEDGE}

Erkläre dem Schüler auf Deutsch, klar, ermutigend und maximal 150 Wörter, mit Markdown:
1. **Warum die gegebene Antwort nicht passt** (falls eine angegeben wurde).
2. **Alle drei Formen im Überblick** – zeige sie als eine Zeile "Infinitiv – Simple Past – Past Participle", nenne die Form-Gruppe, zu der das Verb gehört (z. B. "alle drei Formen gleich" oder "Simple Past = Past Participle"), und sage je Form in einem kurzen Satz, woran man sie erkennt bzw. wie man sie sich merkt. Auch wenn nur eine einzelne Form gefragt war, decken deine Erklärungen damit alle drei Formen ab.
3. **Eselsbrücke / Merkhilfe**, die zu genau dieser Form-Gruppe passt (z. B. Präfix-Regel, Vokalwechsel-Muster, Vergleich mit einem verwandten Verb).
4. **Ein Beispielsatz** mit der richtigen Form (Englisch + deutsche Übersetzung).`;
}

function buildAiPrompt(word) {
  return `Du bist ein erfahrener Englisch-Deutsch-Lehrer.
Zum englischen Wort "${word}" gib mir bitte die folgenden Informationen:

1. **Wortart** (Nomen / Verb / Adjektiv / Adverb / Präposition / ...)
2. **Konjugation** – NUR wenn es ein Verb ist:
   - Infinitiv (Grundform): ...
   - Simple Past (1. Form): ...
   - Past Participle (2. Form): ...
   - Regelmäßig oder unregelmäßig?
3. **2–3 Beispielsätze** (Englisch mit deutscher Übersetzung)
4. **Synonyme / verwandte Wörter** (falls vorhanden)
5. **Aussprache-Hinweis** (falls relevant)

Sei präzise, antworte ausschließlich auf Deutsch und nutze Markdown-Formatierung.`;
}

async function callOllama(prompt) {
  const response = await fetchWithTimeout(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      keep_alive: '30m', // Modell nach dem Laden 30 Min. im Speicher halten (schnelle Folge-Abfragen)
      num_predict: 400, // Antwortlänge begrenzen → schnellere Antwort, keine Endlossätze
      messages: [
        { role: 'system', content: 'Du bist ein freundlicher, präziser Englisch-Deutsch-Lehrer. Antworte immer auf Deutsch.' },
        { role: 'user', content: prompt }
      ],
      stream: false
    })
  }, AI_TIMEOUTS.ollama, 'ollama');
  if (!response.ok) {
    throw new Error(`Ollama-Fehler: ${response.status} ${await response.text()}`);
  }
  const data = await response.json();
  return data.message?.content || data.response || '';
}

async function callOpenAI(prompt) {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY ist nicht gesetzt. Bitte trage es in der .env-Datei ein.');
  }
  const response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: 'Du bist ein freundlicher, präziser Englisch-Deutsch-Lehrer. Antworte immer auf Deutsch.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 400,
      temperature: 0.3
    })
  }, AI_TIMEOUTS.openai, 'openai');
  if (!response.ok) {
    throw new Error(`OpenAI-Fehler: ${response.status} ${await response.text()}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

async function callGroq(prompt) {
  if (!GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY ist nicht gesetzt. Bitte in der .env-Datei eintragen (kostenlos: https://console.groq.com/keys).');
  }
  const response = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: 'Du bist ein freundlicher, präziser Englisch-Deutsch-Lehrer. Antworte immer auf Deutsch.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 400,
      temperature: 0.3
    })
  }, AI_TIMEOUTS.groq, 'groq');
  if (!response.ok) {
    throw new Error(`Groq-Fehler: ${response.status} ${await response.text()}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

async function callGemini(prompt) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY ist nicht gesetzt. Bitte in der .env-Datei eintragen (kostenlos: https://aistudio.google.com/app/apikey).');
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      systemInstruction: { parts: [{ text: 'Du bist ein freundlicher, präziser Englisch-Deutsch-Lehrer. Antworte immer auf Deutsch.' }] },
      maxOutputTokens: 400
    })
  }, AI_TIMEOUTS.gemini, 'gemini');
  if (!response.ok) {
    throw new Error(`Gemini-Fehler: ${response.status} ${await response.text()}`);
  }
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
}

app.post('/api/ai-helper', async (req, res) => {
  const word = (req.body.word || '').toString().trim();
  const verb = req.body.verb;

  // Lernmodus Zeitformen: Verb-Fehler-Erklärung (mit englisch-hilfen.de-Wissensbasis)
  // ansonsten: klassische Wort-Info.
  let prompt = null;
  if (verb && typeof verb === 'object' && verb.infinitive) {
    prompt = buildVerbTensePrompt(verb, (req.body.target || 'past'), req.body.userAnswer || '');
  } else if (word) {
    prompt = buildAiPrompt(word);
  }

  if (!prompt) {
    return res.status(400).json({ success: false, message: 'Bitte gib ein Wort oder ein Verb an.' });
  }

  // Fallback-Kette: Primär-Provider zuerst, danach die alternativen Provider.
  const chain = [AI_PROVIDER, ...['openai', 'groq', 'gemini', 'ollama'].filter(p => p !== AI_PROVIDER)];

  const callMap = {
    openai: callOpenAI,
    groq: callGroq,
    gemini: callGemini,
    ollama: callOllama
  };

  const errors = [];
  const startedAt = Date.now();
  for (const provider of chain) {
    const call = callMap[provider];
    if (!call) {
      continue;
    }
    // Ein Provider liefert gelegentlich 200 mit leerem Inhalt (z. B. Groq-Rate-Limit)
    // → bis zu 3 Versuche pro Provider, dann nächste Station in der Kette.
    let info = '';
    for (let attempt = 1; attempt <= 3 && !info; attempt++) {
      try {
        info = await call(prompt);
      } catch (error) {
        console.error(`KI-Hilfe ${provider} fehlgeschlagen:`, error.message);
        errors.push(`${provider}: ${error.message}`);
        break; // Hard-Fehler (Timeout, 4xx/5xx) → sofort weiter zur nächsten Kette
      }
      if (!info && attempt < 3) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }
    if (info) {
      console.log(`KI-Hilfe über Provider: ${provider} (${Date.now() - startedAt} ms)`);
      return res.json({ success: true, info, provider, timeMs: Date.now() - startedAt });
    }
    errors.push(`${provider}: leere Antwort`);
  }

  res.status(502).json({
    success: false,
    message: `Alle KI-Provider fehlgeschlagen:\n${errors.join('\n')}`
  });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  loadVocabulary(DEFAULT_DATA_FILE);
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Server also accessible at http://0.0.0.0:${PORT} (for network access)`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} ist bereits belegt. Versuche einen anderen Port mit PORT=3000 node server.js`);
  } else {
    console.error('Serverfehler:', err);
  }
});